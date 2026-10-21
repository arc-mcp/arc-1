import type { AdtClient } from '../adt/client.js';
import type { WhereUsedResult } from '../adt/codeintel.js';
import { loadUsageSnippets, matchesUsageType, type UsageOptions } from '../adt/where-used-native.js';

/** Native method/include nodes may omit their type; inherit it only through the returned tree. */
function ownerOf(row: WhereUsedResult, byUri: Map<string, WhereUsedResult>): WhereUsedResult {
  let owner = row;
  const seen = new Set<string>();
  for (let depth = 0; depth < 32 && !owner.type && owner.parentUri && !seen.has(owner.parentUri); depth++) {
    seen.add(owner.parentUri);
    const parent = byUri.get(owner.parentUri);
    if (!parent) break;
    owner = parent;
  }
  return owner;
}

export async function expandUsageDetails(
  client: AdtClient,
  rows: WhereUsedResult[],
  filter: string | undefined,
  options: UsageOptions,
  limit: number,
  supportsSnippets: boolean,
  deadline: number,
) {
  const byUri = new Map(rows.map((row) => [row.uri, row]));
  const relevant = rows
    .map((row) => ({ row, owner: ownerOf(row, byUri) }))
    .filter(
      ({ row, owner }) =>
        (!filter || matchesUsageType(owner.type, filter)) &&
        (!options.packages?.length ||
          (owner.type !== 'DEVC/K' &&
            options.packages.includes((row.packageName || owner.packageName || '').toUpperCase()))),
    );
  const identified = new Map(
    relevant.filter(({ row }) => row.objectIdentifier).map((entry) => [entry.row.objectIdentifier!, entry]),
  );
  const identifiers = supportsSnippets ? [...identified.keys()].slice(0, 10) : [];
  const snippets = await loadUsageSnippets(client, identifiers, deadline);
  const requested = new Set(identifiers);
  if (snippets.some((snippet) => !requested.has(snippet.objectIdentifier)))
    throw new Error('SAP returned snippets for an unrequested where-used identifier.');
  const unexpandedEntries = relevant.filter(({ row }) => row.isResult !== false && !row.objectIdentifier).length;
  const truncated = identified.size > identifiers.length || snippets.length > limit;
  return {
    detail: options.detail,
    identifiersAvailable: identified.size,
    identifiersExpanded: identifiers.length,
    identifiersWithoutUsages: identifiers.filter((id) => !snippets.some((snippet) => snippet.objectIdentifier === id))
      .length,
    unexpandedEntries,
    shown: Math.min(snippets.length, limit),
    truncated,
    ...(supportsSnippets
      ? {}
      : { warning: 'Usage snippets are unavailable for this lookup. Use the object list and SAPRead.' }),
    countMeaning:
      'Usage entries from at most 10 expandable nodes; entries without native identifiers are not expanded. Not a complete inventory.',
    coordinateMeaning:
      'SAP coordinates: line is 1-based; columns follow the native match range. A component identifies method-relative positions.',
    usages: snippets.slice(0, limit).map((snippet) => {
      const { row, owner } = identified.get(snippet.objectIdentifier)!;
      const fragment = new URLSearchParams(snippet.uri.split('#')[1]?.replaceAll(';', '&'));
      const start = fragment.get('start')?.split(',');
      const column = start?.[1] ?? /^(\d+)-/.exec(snippet.matches)?.[1];
      const content = snippet.content;
      return {
        object: owner.name,
        type: owner.type,
        packageName: row.packageName || owner.packageName,
        uri: snippet.uri,
        ...(fragment.get('name') ? { component: fragment.get('name') } : {}),
        ...(start?.[0] && /^\d+$/.test(start[0]) ? { line: Number(start[0]) } : {}),
        ...(column && /^\d+$/.test(column) ? { column: Number(column) } : {}),
        matches: snippet.matches,
        ...(options.detail === 'snippets'
          ? { snippet: content.slice(0, 1000), ...(content.length > 1000 ? { snippetTruncated: true } : {}) }
          : {}),
      };
    }),
  };
}
