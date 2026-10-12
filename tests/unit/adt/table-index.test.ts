import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildServerDrivenMetadataXml, serverDrivenObjectUrl } from '../../../src/adt/server-driven.js';
import { parseTableIndexList, parseTableIndexName, tableIndexParentUrl } from '../../../src/adt/table-index.js';

const nodes = readFileSync(new URL('../../fixtures/table-index-nodes-758.xml', import.meta.url), 'utf8');
it('reads the native child IDs instead of guessing from padded TECH_NAME', () => {
  const result = parseTableIndexList(nodes, 'DD03L');
  expect(result.map((row) => row.name)).toEqual([
    'DD03L~1',
    'DD03L~6',
    'DD03L~H0P',
    'DD03L~H14',
    'DD03L~HP2',
    'DD03L~HYT',
  ]);
  expect(result[0]?.uri).toBe('/sap/bc/adt/ddic/db/indexes/dd03l%7e1');
});
it('distinguishes an empty tree from a malformed response', () => {
  expect(parseTableIndexList('<abap><values><DATA><TREE_CONTENT/></DATA></values></abap>', 'ZTEST')).toEqual([]);
  expect(() => parseTableIndexList('<html>login</html>', 'ZTEST')).toThrow();
});
it('refuses malformed or mismatched index URIs', () => {
  for (const uri of ['dd03l%7eWRONG', 'other%7e1', '%ZZ', 'https://other/1'])
    expect(() => parseTableIndexList(nodes.replace('dd03l%7e1', uri), 'DD03L')).toThrow();
});
it('preserves native names and encodes namespaces for both index and parent', () => {
  expect(parseTableIndexName('/ABC/TABLE~Z01')).toEqual({ table: '/ABC/TABLE', index: 'Z01' });
  expect(tableIndexParentUrl('/ABC/TABLE~Z01')).toBe('/sap/bc/adt/ddic/tables/%2Fabc%2Ftable');
  expect(serverDrivenObjectUrl('TABL/DTI', '/ABC/TABLE~Z01')).toBe('/sap/bc/adt/ddic/db/indexes/%2Fabc%2Ftable~z01');
  const xml = buildServerDrivenMetadataXml('TABL/DTI', '/ABC/TABLE~Z01', '$TMP', 'A & B');
  expect(xml).toContain('adtcore:type="TABL/DTI"');
  expect(xml).toContain('<adtcore:containerRef adtcore:name="/ABC/TABLE" adtcore:type="TABL/DT"');
  expect(xml).toContain('adtcore:description="A &amp; B"');
});
it.each(['ZTEST', 'ZTEST~', 'ZTEST~0001', 'ZTEST~A~B', '../ZTEST~001', 'ZTEST?x~001'])(
  'refuses ambiguous object names %s',
  (name) => expect(() => parseTableIndexName(name)).toThrow(),
);
