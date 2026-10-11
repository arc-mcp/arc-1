// Regression for #968: a blocked typed sibling should win
// over a failing table-entity proof, and no proof request should be needed to deny it.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { DataSourceBlocklistGuard } from '../../../src/adt/data-source-policy.js';
import { AdtApiError } from '../../../src/adt/errors.js';

const captured = readFileSync(
  new URL('../../fixtures/xml/cds-dependency-graph-btp-table-entity.xml', import.meta.url),
  'utf8',
);
const typedBlockedLeaf =
  '<abapsource:elementInfo adtcore:name="USR02" adtcore:type="TABL/DT"><abapsource:properties>' +
  '<abapsource:entry abapsource:key="TYPE">TABLE</abapsource:entry><abapsource:entry abapsource:key="RELATION">INNER_JOIN</abapsource:entry>' +
  '<abapsource:entry abapsource:key="ENTITY_NAME"/><abapsource:entry abapsource:key="NODE_NAME">USR02</abapsource:entry>' +
  '<abapsource:entry abapsource:key="DB_EXISTS">X</abapsource:entry><abapsource:entry abapsource:key="AC_STATE">NA</abapsource:entry>' +
  '</abapsource:properties></abapsource:elementInfo>';
const cut = captured.lastIndexOf('</abapsource:elementInfo>');
const graph = captured.slice(0, cut) + typedBlockedLeaf + captured.slice(cut);
const search = (name: string) => [
  { objectName: name, objectType: 'STOB/DO', uri: `/sap/bc/adt/ddic/ddl/sources/${name.toLowerCase()}/source/main` },
];

describe('review #968: blocked sibling vs. failing table-entity proof', () => {
  it('reports DATA_SOURCE_BLOCKED without spending proof requests', async () => {
    const backend = {
      searchObject: vi.fn(async (name: string) => search(name)),
      readTableReplacement: vi.fn(async () => undefined),
      dependencyGraphAccept: () => undefined,
      readDependencyGraph: vi.fn(async () => graph),
      readActiveDdlMetadata: vi.fn(async () => {
        throw new AdtApiError('forbidden', 403, '/ddl', '');
      }),
    };
    const err = await new DataSourceBlocklistGuard(['USR02'], backend).enforceSources(['ZVIEW_ENTITY']).catch((e) => e);
    expect(graph).toContain('USR02');
    expect(err.code).toBe('DATA_SOURCE_BLOCKED');
    expect(backend.readActiveDdlMetadata).not.toHaveBeenCalled();
  });
});
