/** Classic FLP list text, shared by the single-target handler and the pinned companion reads. */
import { FLP_TILE_PAGE_SIZE } from '../adt/flp.js';
import type { FlpCatalog, FlpGroup, FlpTileInstance } from '../adt/types.js';

export function catalogLines(catalogs: FlpCatalog[]): string {
  const customCount = catalogs.filter((c) => /^(Z|Y)/i.test(c.domainId)).length;
  return [
    `${catalogs.length} catalogs (${customCount} custom Z/Y). Columns: domainId | title | type | scope | chips`,
    ...catalogs.map(
      (c) => `${c.domainId} | ${c.title || '(no title)'} | ${c.type || '-'} | ${c.scope || '-'} | ${c.chipCount}`,
    ),
  ].join('\n');
}

export function groupLines(groups: FlpGroup[]): string {
  return [
    `${groups.length} groups. Columns: id | title`,
    ...groups.map((g) => `${g.id} | ${g.title || '(no title)'}`),
  ].join('\n');
}

export function tileLines(tiles: FlpTileInstance[], catalogId: string): string {
  const truncated = tiles.length === FLP_TILE_PAGE_SIZE ? ` (capped at ${FLP_TILE_PAGE_SIZE} — may be truncated)` : '';
  return [
    `${tiles.length} tiles${truncated} in catalog "${catalogId}". Columns: instanceId | title | chipId | semanticObject | semanticAction`,
    ...tiles.map((t) => {
      const so = (t.configuration as Record<string, unknown> | null)?.semantic_object ?? '';
      const sa = (t.configuration as Record<string, unknown> | null)?.semantic_action ?? '';
      return `${t.instanceId} | ${t.title || '(no title)'} | ${t.chipId} | ${so} | ${sa}`;
    }),
  ].join('\n');
}
