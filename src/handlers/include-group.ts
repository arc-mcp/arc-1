import type { AdtClient } from '../adt/client.js';
import { canonicalHostRelativeAdtPath } from '../adt/path-safety.js';
import { errorResult, type ToolResult } from './shared.js';

/** Owning group of a function-group include, or undefined for a standalone include. */
export async function resolveIncludeGroup(
  client: AdtClient,
  includeName: string,
  allowMissing: boolean,
): Promise<string | undefined> {
  const [lookup] = await client.lookupObjects([includeName]);
  const matches = (lookup?.matches ?? []).filter((r) => r.objectType === 'FUGR/I' || r.objectType === 'PROG/I');
  if (matches.length === 0 && allowMissing) return undefined;
  const owners = new Map<string, string | undefined>();
  const unverified = new Error(
    `Cannot verify the owning group of include "${includeName}". Provide "group" explicitly.`,
  );
  for (const r of matches) {
    const path = canonicalHostRelativeAdtPath(r.uri, '/sap/bc/adt/', { allowRawEncodedSlash: true });
    if (!path || path.includes('?')) throw unverified;
    const grouped = path.match(/^\/sap\/bc\/adt\/functions\/groups\/([^/]+)\/includes\/([^/?#]+)$/i);
    if (
      r.objectType === 'FUGR/I' &&
      grouped &&
      decodeURIComponent(grouped[2]).toUpperCase() === includeName.toUpperCase()
    ) {
      const group = decodeURIComponent(grouped[1]).toUpperCase();
      owners.set(group, group);
    } else if (
      r.objectType === 'PROG/I' &&
      path.toUpperCase() === `/sap/bc/adt/programs/includes/${encodeURIComponent(includeName)}`.toUpperCase()
    ) {
      owners.set('standalone', undefined);
    } else {
      throw unverified;
    }
  }
  if (owners.size !== 1) throw unverified;
  return owners.values().next().value;
}

/** SAPWrite actions that may target a FUGR structural include without an explicit `group`. */
const GROUP_RESOLVE_ACTIONS = new Set(['update', 'edit_unit', 'add_unit', 'edit_content']);

/**
 * Fill an omitted `args.group` for a SAPWrite INCL target from the include itself. Fail-closed: an
 * unverifiable or ambiguous owner returns an error instead of writing through the flat endpoint.
 */
export async function applyIncludeGroup(
  client: AdtClient,
  args: Record<string, unknown>,
  type: string,
  name: string,
  action: string,
): Promise<ToolResult | undefined> {
  if (type !== 'INCL' || String(args.group ?? '').trim() || !GROUP_RESOLVE_ACTIONS.has(action)) return undefined;
  try {
    const owner = await resolveIncludeGroup(client, name, true);
    if (owner) args.group = owner;
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e));
  }
  return undefined;
}
