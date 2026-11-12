import type { AdtClient } from '../adt/client.js';
import { canonicalHostRelativeAdtPath } from '../adt/path-safety.js';

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

/** Preserve explicit groups and avoid lookups for ordinary Z/Y standalone includes. */
export async function resolveIncludeGroupForMutation(
  client: AdtClient,
  name: string,
  group: unknown,
): Promise<string | undefined> {
  const explicit = String(group ?? '').trim();
  if (explicit) return explicit;
  if (!/^(?:\/[^/]+\/)?L/i.test(name)) return undefined;
  return resolveIncludeGroup(client, name, true);
}
