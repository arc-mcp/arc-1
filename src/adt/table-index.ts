/** Classic transparent-table secondary indexes; the JSON lifecycle uses the blues engine. */
import { AdtError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { parseXml } from './xml-parser.js';

export const TABLE_INDEX_COLLECTION = '/sap/bc/adt/ddic/db/indexes';
const TABLE_NAME = /^(?:\/[A-Z0-9_]+\/)?[A-Z][A-Z0-9_]*$/;

function tableName(name: string): string {
  const value = name.toUpperCase();
  if (!TABLE_NAME.test(value) || value.length > 30) throw new AdtError('Invalid table name for secondary indexes.');
  return value;
}

export function parseTableIndexName(name: string): { table: string; index: string } {
  const parts = name.toUpperCase().split('~');
  if (parts.length !== 2 || !/^[A-Z0-9]{1,3}$/.test(parts[1]!))
    throw new AdtError('TABL/DTI name must be TABLE~INDEX, with a 1–3 character alphanumeric index ID.');
  return { table: tableName(parts[0]!), index: parts[1]! };
}

export function tableIndexParentUrl(name: string): string {
  return `/sap/bc/adt/ddic/tables/${encodeURIComponent(parseTableIndexName(name).table.toLowerCase())}`;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AdtError('Invalid ADT index listing.');
  return value as Record<string, unknown>;
}

export function parseTableIndexList(xml: string, name: string) {
  const table = tableName(name);
  const data = object(object(parseXml(xml).abap).values).DATA;
  if (!Array.isArray(data) || data.length !== 1) throw new AdtError('Invalid ADT index listing data.');
  const tree = object(data[0]).TREE_CONTENT;
  if (tree === undefined || tree === null) throw new AdtError('Invalid ADT table index listing.');
  if (tree === '') return [];
  const nodes = object(tree).SEU_ADT_REPOSITORY_OBJ_NODE;
  if (!Array.isArray(nodes)) throw new AdtError('Invalid ADT table index nodes.');
  return nodes
    .filter((node) => node.OBJECT_TYPE === 'TABL/DTI')
    .map((node) => {
      const index = String(node.OBJECT_NAME ?? '')
        .trim()
        .toUpperCase();
      const name = `${table}~${index}`;
      parseTableIndexName(name);
      const uri = String(node.OBJECT_URI ?? '');
      let decoded: string;
      try {
        decoded = decodeURIComponent(uri);
      } catch {
        throw new AdtError('Invalid ADT index URI.');
      }
      if (decoded.toUpperCase() !== `${TABLE_INDEX_COLLECTION}/${name}`.toUpperCase())
        throw new AdtError('ADT index URI does not match its table and index ID.');
      return { type: 'TABL/DTI', name, index, description: String(node.DESCRIPTION ?? ''), uri };
    });
}

export async function listTableIndexes(http: AdtHttpClient, safety: SafetyConfig, name: string) {
  checkOperation(safety, OperationType.Read, 'ListTableIndexes');
  const table = tableName(name);
  // A missing table must not look like a valid table with no indexes.
  await http.get(`/sap/bc/adt/ddic/tables/${encodeURIComponent(table.toLowerCase())}`);
  const response = await http.post(
    `/sap/bc/adt/repository/nodestructure?parent_type=TABL%2FDT&parent_name=${encodeURIComponent(table)}&withShortDescriptions=true`,
    '',
    'application/xml',
    { Accept: 'application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.RepositoryObjectTreeContent' },
  );
  return parseTableIndexList(response.body, table);
}
