/** Presentation-only native ADT links. No SAP or filesystem access. */
import { expandHyperfocusedArgs } from '../handlers/hyperfocused.js';
import {
  detectLocalHandlerInclude,
  normalizeObjectType,
  normalizeTypeArgsForValidation,
  objectBasePath,
} from '../handlers/object-types.js';
import type { ToolResult } from '../handlers/shared.js';
import type { IdeLinkContext } from './ide-request.js';
import { SAP_SYSID_PATTERN } from './multi-target-identity.js';
import type { ServerConfig } from './types.js';

export const IDE_LINK_LIMIT = 8;
const MAX_RESULT_CHARS = 256 * 1024;
const MAX_CANDIDATES = 1000;
const SOURCE_TYPES = new Set(['CLAS', 'INTF', 'PROG', 'DDLS']);

export interface IdeObject {
  type: string;
  name: string;
  include?: string;
}

/** SID navigation is a local project-selection aid, not an exact backend binding. */
export function buildEclipseLink(systemId: string, object: IdeObject): string | undefined {
  if (!SAP_SYSID_PATTERN.test(systemId)) return undefined;
  const type = normalizeObjectType(object.type);
  if (!SOURCE_TYPES.has(type) || object.name.length > 80 || !/^(?:\/[A-Z0-9_]+\/)?[A-Z0-9_]+$/i.test(object.name)) {
    return undefined;
  }
  const include = object.include?.trim().toLowerCase();
  // Initial qualification covers main objects only. Do not promise include/version/fragment navigation.
  if (include && include !== 'main') return undefined;
  return `adt://${systemId}${objectBasePath(type)}${encodeURIComponent(object.name.toLowerCase())}`;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function identity(value: unknown): IdeObject | undefined {
  const row = asObject(value);
  if (!row || typeof row.type !== 'string' || typeof row.name !== 'string') return undefined;
  return { type: row.type, name: row.name, ...(typeof row.include === 'string' ? { include: row.include } : {}) };
}

/** Only known result envelopes; never mine arbitrary source, SQL rows, messages or plugin output for names. */
function candidates(tool: string, args: Record<string, unknown>, result: ToolResult): IdeObject[] {
  if (tool === 'SAPRead' && !args.action) {
    const object = identity(args);
    const type = object && normalizeObjectType(object.type);
    // These readers ignore filler include arguments; structured CLAS reads return the whole class.
    if (object && (type === 'PROG' || type === 'INTF' || (type === 'CLAS' && args.format === 'structured'))) {
      delete object.include;
    }
    // grep returns a successful explanatory result for a missing include. Do not promise it can open.
    if (type === 'CLAS' && args.grep && args.include) return [];
    if (
      object &&
      type === 'CLAS' &&
      args.format !== 'structured' &&
      args.include === undefined &&
      typeof args.method === 'string'
    ) {
      object.include = detectLocalHandlerInclude(args.method);
    }
    return object ? [object] : [];
  }
  if (tool !== 'SAPSearch' && !(tool === 'SAPNavigate' && args.action === 'references')) return [];
  if (tool === 'SAPSearch' && args.searchType === 'source_code') return [];
  const text = result.content[0]?.text;
  if (!text || text.length > MAX_RESULT_CHARS) return [];
  const payload: unknown = JSON.parse(text);
  const envelope = asObject(payload);
  let rows: unknown[] = [];
  if (tool === 'SAPSearch' && (!args.searchType || args.searchType === 'object')) {
    if (Array.isArray(payload)) rows = payload;
  } else if (tool === 'SAPSearch' && args.searchType === 'tadir_lookup') {
    // Only ADT-confirmed matches; database-only TADIR rows can be ghosts.
    if (Array.isArray(envelope?.lookups)) {
      for (const lookup of envelope.lookups.slice(0, MAX_CANDIDATES)) {
        const item = asObject(lookup);
        if (item?.found !== true || !Array.isArray(item.matches)) continue;
        for (const match of item.matches.slice(0, MAX_CANDIDATES - rows.length)) {
          if (asObject(match)?._origin === 'adt') rows.push(match);
        }
        if (rows.length >= MAX_CANDIDATES) break;
      }
    }
  } else if (tool === 'SAPNavigate' && Array.isArray(envelope?.references)) rows = envelope.references;
  return rows.slice(0, MAX_CANDIDATES).flatMap((row) => {
    const record = asObject(row);
    const object =
      tool === 'SAPNavigate' ? identity(row) : identity(record && { type: record.objectType, name: record.objectName });
    return object ? [object] : [];
  });
}

/** Keep the original payload block byte-identical, including valid JSON. Best-effort, bounded and synchronous. */
export function appendIdeLinks(
  result: ToolResult,
  tool: string,
  args: Record<string, unknown>,
  config: ServerConfig,
  requestContext?: IdeLinkContext,
): ToolResult {
  if (result.isError || config.ideLinks !== 'eclipse') return result;
  // HTTP presentation comes exclusively from this request, never a sticky/global client preference.
  if (config.transport === 'http-streamable') {
    if (
      requestContext?.style !== 'eclipse' ||
      requestContext.target !== config.targetId ||
      requestContext.systemId !== config.ideSystemId ||
      (config.multiTargetEndpoints && !config.targetId)
    )
      return result;
  } else if (config.multiTargetEndpoints || config.targetId || config.destinationName) {
    return result;
  }
  const systemId = config.ideSystemId;
  if (!SAP_SYSID_PATTERN.test(systemId)) return result;
  try {
    if (tool === 'SAP') {
      const expanded = expandHyperfocusedArgs(args);
      if ('error' in expanded) return result;
      tool = expanded.toolName;
      args = normalizeTypeArgsForValidation(tool, expanded.expandedArgs);
    }
    const links = new Map<string, string>();
    for (const object of candidates(tool, args, result)) {
      const link = buildEclipseLink(systemId, object);
      if (!link || links.has(link)) continue;
      links.set(link, `- [${object.name.toUpperCase()} (${normalizeObjectType(object.type)})](${link})`);
      if (links.size >= IDE_LINK_LIMIT) break;
    }
    if (!links.size) return result;
    return {
      ...result,
      content: [
        ...result.content,
        {
          type: 'text',
          text: `\nOpen current source in Eclipse ADT (${config.targetId ? `target: ${config.targetId}; ` : ''}SAP SID: ${systemId}; client: ${config.client}; up to ${IDE_LINK_LIMIT} links). Check the local project matches this backend; duplicate SIDs may show a project chooser.\n${[...links.values()].join('\n')}`,
        },
      ],
    };
  } catch {
    // Optional presentation must not turn an otherwise successful research call into a failure.
    return result;
  }
}
