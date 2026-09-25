/** Explicit, uncached source snapshots for optimistic write preconditions. */
import type { AdtClient } from '../adt/client.js';
import { checkOperation, OperationType } from '../adt/safety.js';
import { sourceHash } from '../adt/source-precondition.js';
import {
  classIncludeUrl,
  functionModuleObjectUrl,
  normalizeClassWriteInclude,
  sourceUrlForType,
} from './object-types.js';
import { errorResult, type ToolResult, textResult, toolJson } from './shared.js';

const TYPES = new Set(['PROG', 'INCL', 'CLAS', 'INTF', 'FUNC', 'DDLS', 'DCLS', 'BDEF', 'SRVD', 'DDLX']);
const CLASS_EDITS = new Set([
  'edit_method',
  'edit_class_definition',
  'edit_method_signature',
  'add_method',
  'delete_method',
  'change_method_visibility',
]);

export function sourcePreconditionError(type: string, action: string, hash: unknown): string | undefined {
  if (hash === undefined) return undefined;
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))
    return 'expectedSourceHash must be the 64-character SHA-256 from SAPRead(format="editable").';
  if (
    !TYPES.has(type) ||
    !(
      action === 'update' ||
      (action === 'edit_unit' && (type === 'PROG' || type === 'INCL')) ||
      (type === 'CLAS' && CLASS_EDITS.has(action))
    )
  ) {
    return 'expectedSourceHash supports text-source update and class/procedural surgery only; it cannot guard metadata, server-driven objects, creation or deletion.';
  }
  return undefined;
}

export async function readEditableSource(
  client: AdtClient,
  args: Record<string, unknown>,
  type: string,
  name: string,
): Promise<ToolResult> {
  if (!name || !TYPES.has(type))
    return errorResult(
      'format="editable" requires name and a text-source type: PROG, INCL, CLAS, INTF, FUNC, DDLS, DCLS, BDEF, SRVD or DDLX.',
    );
  if (args.action || args.version || args.method || args.grep || args.includeSignature || args.expand_includes) {
    return errorResult(
      'format="editable" reads the complete editable source. Omit action, version, method, grep, includeSignature and expand_includes.',
    );
  }
  const include = normalizeClassWriteInclude(args.include);
  if (args.include && (type !== 'CLAS' || (!include && String(args.include).toLowerCase() !== 'main')))
    return errorResult('format="editable" supports only CLAS source includes (or main).');
  let url: string;
  if (type === 'FUNC') {
    const group = String(args.group ?? '') || (await client.resolveFunctionGroup(name));
    if (!group) return errorResult('Cannot resolve function group; provide group for the editable FUNC read.');
    url = `${functionModuleObjectUrl(group, name)}/source/main`;
  } else if (type === 'INCL' && args.group) {
    url = `/sap/bc/adt/functions/groups/${encodeURIComponent(String(args.group).toLowerCase())}/includes/${encodeURIComponent(name.toLowerCase())}`;
  } else {
    url = include ? classIncludeUrl(name, include) : sourceUrlForType(type, name);
  }
  checkOperation(client.safety, OperationType.Read, 'GetEditableSource');
  const { body: source } = await client.http.get(url, { 'Cache-Control': 'no-cache' });
  return textResult(toolJson({ source, sourceHash: sourceHash(source) }));
}
