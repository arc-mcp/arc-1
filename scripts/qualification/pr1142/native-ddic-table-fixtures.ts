/** Pure closed table graph. Settings are an implicit resource, never an independent CREATE/DELETE owner. */
import type { DdicWorkflowFixture } from './native-ddic-workflow.js';
export const TABLE_PROTOCOL = 'pr1142-native-ddic-table-graph-v1';
export interface TableFixture extends DdicWorkflowFixture {
  type: 'TABL/DT' | 'TABL/DTT' | 'ENQU' | 'TABL/DTI';
  create: { source?: string };
  update: { source?: string };
}
export function tableFixtures(suffix: string): TableFixture[] {
  if (!/^[A-F0-9]{12}$/.test(suffix)) throw new Error('Fresh fixed table suffix required.');
  const table = `ZTTG${suffix}`,
    lock = `EZTG${suffix}`,
    index = `${table}~001`,
    owner = `/sap/bc/adt/ddic/tables/${table}`,
    description = `ARC1 table graph ${suffix}`;
  const indexSource = (updated: boolean) =>
    JSON.stringify({
      formatVersion: '1',
      header: { description: `ARC1 index ${suffix}`, originalLanguage: 'en' },
      uniqueIndex: false,
      bufferIndexOnly: false,
      textIndex: false,
      indexFields: ['CLIENT', 'STATUS', ...(updated ? ['ID'] : [])].map((fieldName) => ({ fieldName })),
    });
  return [
    {
      type: 'TABL/DT',
      name: table,
      owner,
      packageName: '$TMP',
      description,
      dependencies: [],
      create: {
        source: `@EndUserText.label : '${description}'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #RESTRICTED
define table ${table.toLowerCase()} {
  key client : abap.clnt not null;
  key id : abap.char(10) not null;
  status : abap.char(1);
}
`,
      },
      update: {},
    },
    {
      type: 'TABL/DTT',
      name: table,
      owner: `/sap/bc/adt/ddic/db/settings/${table.toLowerCase()}`,
      packageName: '$TMP',
      description,
      dependencies: [owner],
      create: {},
      update: { source: JSON.stringify({ sizeCategory: 2 }) },
    },
    {
      type: 'ENQU',
      name: lock,
      owner: `/sap/bc/adt/ddic/lockobjects/sources/${lock}`,
      packageName: '$TMP',
      description: `ARC1 lock ${suffix}`,
      dependencies: [owner],
      create: { source: JSON.stringify({ allowRFC: false, primaryTable: { tableName: table, lockMode: 'E' } }) },
      update: { source: JSON.stringify({ primaryTable: { tableName: table, lockMode: 'S' } }) },
    },
    {
      type: 'TABL/DTI',
      name: index,
      owner: `/sap/bc/adt/ddic/db/indexes/${index.toLowerCase()}`,
      packageName: '$TMP',
      description: `ARC1 index ${suffix}`,
      dependencies: [owner],
      create: { source: indexSource(false) },
      update: { source: indexSource(true) },
    },
  ];
}
export const TABLE_STAGES = [
  'create-TABL/DT',
  'activate-TABL/DT',
  'adopt-TABL/DTT',
  'stale-TABL/DTT',
  'update-TABL/DTT',
  'activate-TABL/DTT',
  'create-ENQU',
  'activate-ENQU',
  'stale-ENQU',
  'update-ENQU',
  'reactivate-ENQU',
  'create-TABL/DTI',
  'activate-TABL/DTI',
  'stale-TABL/DTI',
  'update-TABL/DTI',
  'reactivate-TABL/DTI',
  'delete-TABL/DTI',
  'delete-ENQU',
  'delete-TABL/DT',
] as const;
export const tableDeletedOwners = (fixtures: readonly TableFixture[]) =>
  [...fixtures]
    .reverse()
    .filter((f) => f.type !== 'TABL/DTT')
    .map((f) => f.owner);
