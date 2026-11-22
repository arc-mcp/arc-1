/**
 * SAPWrite action="generate" (SAP's RAP service generators). Mock-only: answers mirror the 7.58
 * handler output for a table ZTRAVEL. Reading or searching first is allowed; the first other call must be
 * generate with the right generator and dryRun (boolean or "true", as the schema accepts).
 */
import { buildInput } from '../../../src/adt/service-generator.js';
import type { EvalScenario } from '../types.js';

const objects = [
  ['DDLS/DF', 'ZR_TRAVEL'],
  ['BDEF/BDO', 'ZR_TRAVEL'],
  ['CLAS/OC', 'ZBP_TRAVEL'],
  ['TABL/DT', 'ZTRAVEL_D'],
  ['DDLS/DF', 'ZC_TRAVEL'],
  ['BDEF/BDO', 'ZC_TRAVEL'],
  ['DDLX/EX', 'ZC_TRAVEL'],
  ['SRVD/SRV', 'ZUI_TRAVEL_O4'],
  ['SRVB/SVB', 'ZUI_TRAVEL_O4'],
].map(([type, name]) => ({ type, name }));
const input = {
  metadata: { package: '$TMP', masterLanguage: 'EN' },
  general: { referenceObjectName: 'ZTRAVEL', description: 'ZTRAVEL' },
  businessObject: {
    dataModelEntity: { cdsName: 'ZR_TRAVEL' },
    behavior: { implementationType: 'Managed', implementationClass: 'ZBP_TRAVEL', draftTable: 'ZTRAVEL_D' },
  },
  serviceProjection: { name: 'ZC_TRAVEL' },
  businessService: {
    serviceDefinition: { name: 'ZUI_TRAVEL_O4' },
    serviceBinding: { name: 'ZUI_TRAVEL_O4', bindingType: 'OData V4 - UI' },
  },
};
const TABLE =
  "@EndUserText.label : 'Travel'\n@AbapCatalog.tableCategory : #TRANSPARENT\ndefine table ztravel {\n  key client : abap.clnt not null;\n  key travel_id : sysuuid_x16 not null;\n  description : abap.char(40);\n  local_last_changed_at : abp_locinst_lastchange_tstmpl;\n  last_changed_at : abp_lastchange_tstmpl;\n}";

/** Mirrors the handler: real override rules (src/adt/service-generator.ts), $TMP default, dry-run vs run output. */
async function executor(tool: string, args: Record<string, unknown>): Promise<string> {
  if (tool === 'SAPRead' && String(args.type).startsWith('TABL')) return TABLE;
  if (tool !== 'SAPWrite' || args.action !== 'generate') return '[]';
  if (args.generator !== 'ui-service' && args.generator !== 'webapi-service')
    return 'Error: "generator" is required: "ui-service" or "webapi-service".';
  const packageName = String(args.package ?? '$TMP').toUpperCase();
  let effective: Record<string, unknown>;
  try {
    effective = buildInput(input, args.source ? JSON.parse(String(args.source)) : {}, packageName, 'EN');
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
  const binding = String((effective.businessService as { serviceBinding: { name: string } }).serviceBinding.name);
  const planned = objects.map((o) => (o.type === 'SRVB/SVB' ? { ...o, name: binding } : o));
  const base = { generator: args.generator, table: 'ZTRAVEL', package: packageName };
  if (args.dryRun === true || args.dryRun === 'true') {
    return JSON.stringify({
      ...base,
      dryRun: true,
      valid: true,
      objects: planned,
      input: effective,
      next: `Show these objects to the user, then run again without dryRun to create them. To rename, pass source with only the keys to change (no "input" wrapper), e.g. {"businessService":{"serviceBinding":{"name":"${binding}_NEW"}}}.`,
    });
  }
  return JSON.stringify({
    ...base,
    dryRun: false,
    objects: planned.map((o) => ({ ...o, state: 'found' })),
    next: `Publish with SAPActivate action="publish_srvb" name="${binding}", then SAPRead type="SRVB" name="${binding}" include="service_info".`,
  });
}

const generateDry = (extra: Record<string, unknown> = {}) =>
  [true, 'true'].map((dryRun) => ({
    tool: 'SAPWrite',
    requiredArgs: { action: 'generate', type: 'TABL', name: 'ZTRAVEL', dryRun, ...extra },
  }));
const common: Pick<
  EvalScenario,
  'category' | 'tags' | 'mockOnly' | 'mockToolExecutor' | 'maxToolCalls' | 'preliminary' | 'requireFullParameters'
> = {
  category: 'write',
  tags: ['generate'],
  mockOnly: true,
  mockToolExecutor: executor,
  maxToolCalls: 4,
  preliminary: [{ tool: 'SAPRead' }, { tool: 'SAPSearch' }],
  requireFullParameters: true,
};

export const SCENARIOS: EvalScenario[] = [
  {
    ...common,
    id: 'generate-explicit-ui-service',
    description: "Explicit: SAP's generator for a UI service, preview first",
    prompt:
      "Use SAP's object generator to create an OData UI service for the table ZTRAVEL in package $TMP. Show me what it would create before creating anything.",
    optimal: generateDry({ generator: 'ui-service' }),
  },
  {
    ...common,
    id: 'generate-natural-ui-service',
    description: 'Natural request without the word generator',
    prompt:
      'Create a RAP OData UI service with a Fiori Elements preview for the existing table ZTRAVEL in package $TMP.',
    optimal: generateDry({ generator: 'ui-service' }),
  },
  {
    ...common,
    id: 'generate-natural-web-api',
    description: 'Natural request for a Web API service',
    prompt: 'Expose the existing database table ZTRAVEL as an OData V4 Web API through RAP, in package $TMP.',
    optimal: generateDry({ generator: 'webapi-service' }),
  },
  {
    ...common,
    id: 'generate-rename-binding',
    description: 'Rename one proposed object through source',
    prompt:
      'Generate the RAP UI service stack for table ZTRAVEL in $TMP, but the service binding must be called ZUI_TRAVEL_BOOKING instead of the proposed name. Check it before anything is created.',
    maxToolCalls: 5,
    optimal: generateDry({ generator: 'ui-service' }),
  },
  {
    ...common,
    id: 'generate-transportable',
    description: 'Transportable package with a request',
    prompt:
      'Generate a RAP OData UI service for table ZTRAVEL into package ZTRAVEL_APP on transport request A4HK900123. Preview it first.',
    optimal: generateDry({ generator: 'ui-service', package: 'ZTRAVEL_APP', transport: 'A4HK900123' }),
  },
];
