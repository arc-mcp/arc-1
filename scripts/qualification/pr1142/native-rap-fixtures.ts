/** One closed managed RAP graph. No ABAP execution and no caller-selected owner or resume point. */
import type { DdicWorkflowFixture } from './native-ddic-workflow.js';
export const RAP_PROTOCOL = 'pr1142-native-rap-publication-v1';
export interface RapFixture extends DdicWorkflowFixture {
  type: 'TABL/DT' | 'DDLS' | 'CLAS' | 'BDEF' | 'SRVD' | 'SRVB' | 'SKTD';
  create: {
    source?: string;
    serviceDefinition?: string;
    odataVersion?: string;
    category?: string;
    version?: string;
    refObjectType?: string;
    refObjectName?: string;
    refObjectDescription?: string;
  };
}
export function rapFixtures(suffix: string): RapFixture[] {
  if (!/^[A-F0-9]{12}$/.test(suffix)) throw new Error('Fixed fresh RAP suffix required.');
  const table = `ZTRP${suffix}`,
    view = `ZRRP_${suffix}`,
    pool = `ZBP_RP_${suffix}`,
    service = `ZSRP_${suffix}`,
    binding = `ZBRP_${suffix}`;
  const names = [table, view, pool, view, service, binding];
  const types: RapFixture['type'][] = ['TABL/DT', 'DDLS', 'CLAS', 'BDEF', 'SRVD', 'SRVB'];
  const collections = [
    'ddic/tables',
    'ddic/ddl/sources',
    'oo/classes',
    'bo/behaviordefinitions',
    'ddic/srvd/sources',
    'businessservices/bindings',
  ];
  const owners = names.map(
    (name, i) => `/sap/bc/adt/${collections[i]}/${i === 0 || i === 5 ? name : name.toLowerCase()}`,
  );
  const descriptions = names.map((_, i) => `ARC1 RAP ${suffix} ${types[i]}`);
  const sources = [
    `@EndUserText.label : '${descriptions[0]}'\n@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE\n@AbapCatalog.tableCategory : #TRANSPARENT\n@AbapCatalog.deliveryClass : #A\n@AbapCatalog.dataMaintenance : #RESTRICTED\ndefine table ${table.toLowerCase()} {\n  key client : abap.clnt not null;\n  key id : sysuuid_x16 not null;\n  name : abap.char(40);\n}\n`,
    `@EndUserText.label: '${descriptions[1]}'\n@AccessControl.authorizationCheck: #NOT_ALLOWED\ndefine root view entity ${view}\n  as select from ${table.toLowerCase()}\n{\n  key id as Id,\n  name as Name\n}\n`,
    `CLASS ${pool.toLowerCase()} DEFINITION\n  PUBLIC ABSTRACT FINAL\n  FOR BEHAVIOR OF ${view.toLowerCase()}.\nENDCLASS.\n\nCLASS ${pool.toLowerCase()} IMPLEMENTATION.\nENDCLASS.\n`,
    `managed implementation in class ${pool.toLowerCase()} unique;\nstrict ( 2 );\n\ndefine behavior for ${view} alias Item\npersistent table ${table.toLowerCase()}\nlock master\nauthorization master ( instance )\n{\n  field ( readonly ) Id;\n  create;\n  update;\n  delete;\n  action approve result [1] $self;\n  mapping for ${table.toLowerCase()} {\n    Id = id;\n    Name = name;\n  }\n}\n`,
    `@EndUserText.label: '${descriptions[4]}'\ndefine service ${service} {\n  expose ${view} as Item;\n}\n`,
  ];
  const dependencies = [
    [],
    [owners[0]],
    [owners[1]],
    [owners[0], owners[1], owners[2]],
    [owners[1], owners[3]],
    [owners[4]],
  ];
  return names.map((name, i) => ({
    type: types[i],
    name,
    owner: owners[i],
    packageName: '$TMP',
    description: descriptions[i],
    dependencies: dependencies[i],
    create:
      i === 5
        ? { serviceDefinition: service, odataVersion: 'V4', category: '1', version: '0001' }
        : { source: sources[i] },
    update: {},
  }));
}
export const RAP_STAGES = [
  'create-table',
  'activate-table',
  'create-view',
  'activate-view',
  'create-pool',
  'create-bdef',
  'preview-generation',
  'apply-generation',
  'batch-activate-pool-bdef',
  'create-service',
  'activate-service',
  'create-binding',
  'activate-binding',
  'publish',
  'unpublish',
  'delete-generated-binding',
  'delete-service',
  'delete-bdef',
  'delete-pool',
  'delete-view',
  'delete-table',
] as const;
export const rapDeletedOwners = (f: readonly RapFixture[]) => [f[5], f[4], f[3], f[2], f[1], f[0]].map((v) => v.owner);
export const rapSettings = (f: readonly RapFixture[]) => ({
  name: f[0].name,
  owner: `/sap/bc/adt/ddic/db/settings/${f[0].name.toLowerCase()}`,
});
