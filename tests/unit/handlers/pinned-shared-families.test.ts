/**
 * Per-type-family checks for pinned writes through the shared handlers. Handlers are shared, so the
 * per-type risk is package resolution and where the CTS request goes on the wire.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

const ALLOWED = 'A4HK900001';
const FOREIGN = 'A4HK999999';
const config = {
  ...DEFAULT_CONFIG,
  targetId: 'A4H/001',
  multiTargetEndpoints: true,
  multiTargetWrite: {
    target: 'A4H/001',
    enabled: true,
    allowedPackages: ['$TMP', 'ZTEAM'],
    allowedTransports: [ALLOWED],
    serverAllowedTransports: [],
  },
  allowWrites: true,
  // ZOTHER passes the server ceiling: only the destination list refuses it.
  allowedPackages: ['$TMP', 'ZTEAM', 'ZOTHER'],
  ppEnabled: true,
  ppStrict: true,
  lintBeforeWrite: false,
  abapRelease: '758',
};
const client = () => new AdtClient({ baseUrl: 'http://sap:8000', safety: { ...defaultSafetyConfig(), ...config } });

let pkg: string;
let lockRequest: string;
let failMutation: boolean;
const requests: Array<{ method: string; path: string; body: string }> = [];
beforeEach(() => {
  vi.resetAllMocks();
  pkg = 'ZTEAM';
  lockRequest = '';
  failMutation = false;
  requests.length = 0;
  mockFetch.mockImplementation(async (url: unknown, options: any = {}) => {
    const parsed = new URL(String(url));
    const path = parsed.pathname + parsed.search;
    const method = options.method ?? 'GET';
    const body = String(options.body ?? '');
    requests.push({ method, path, body });
    if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'T' });
    if (path.includes('transportchecks'))
      return mockResponse(
        200,
        `<DATA><DEVCLASS>${pkg}</DEVCLASS><DLVUNIT>${pkg === '$TMP' ? 'LOCAL' : 'HOME'}</DLVUNIT><RESULT>S</RESULT><RECORDING>${pkg === '$TMP' ? '' : 'X'}</RECORDING></DATA>`,
      );
    if (path.includes('_action=LOCK'))
      return mockResponse(200, `<DATA><LOCK_HANDLE>LH</LOCK_HANDLE><CORRNR>${lockRequest}</CORRNR></DATA>`);
    if (path.includes('_action=UNLOCK')) return mockResponse(200, '');
    if (path.includes('/activation?'))
      return mockResponse(
        200,
        '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties activationExecuted="true"/></chkl:messages>',
      );
    if (method === 'PUT' || method === 'DELETE' || method === 'POST')
      return mockResponse(failMutation && method !== 'POST' ? 503 : 200, '', { 'retry-after': '0' });
    if (/\/source\/|\/oo\/classes\/[^/]+\/includes\//.test(parsed.pathname))
      return mockResponse(200, 'REPORT ztest.\n');
    return mockResponse(
      200,
      `<adtcore:object xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZTEST"><adtcore:packageRef adtcore:name="${pkg}"/></adtcore:object>`,
    );
  });
});

type Op = [label: string, tool: 'SAPWrite' | 'SAPActivate', args: Record<string, unknown>];
const src = (type: string, name: string, source: string, extra: Record<string, unknown> = {}): Op[] => [
  [`${type} create`, 'SAPWrite', { action: 'create', type, name, source, package: 'ZOTHER', ...extra }],
  [`${type} update`, 'SAPWrite', { action: 'update', type, name, source, ...extra }],
  [`${type} delete`, 'SAPWrite', { action: 'delete', type, name, ...extra }],
  [`${type} activate`, 'SAPActivate', { type, name, ...extra }],
];
const OPS: Op[] = [
  ...src('PROG', 'ZTEST', 'REPORT ztest.'),
  ...src('INCL', 'ZTEST_INC', '* include'),
  ...src('DDLS', 'ZI_TEST', 'define view entity ZI_TEST as select from t000 { key mandt }'),
  ...src('DDLX', 'ZC_TEST', '@Metadata.layer: #CORE annotate entity ZC_TEST with { }'),
  ...src('DCLS', 'ZI_TEST', '@MappingRole: true define role ZI_TEST { grant select on ZI_TEST; }'),
  ...src('BDEF', 'ZI_TEST', 'managed implementation in class zbp_i_test unique; define behavior for ZI_TEST { }'),
  ...src('SRVD', 'ZUI_TEST', 'define service ZUI_TEST { expose ZI_TEST; }'),
  [
    'CLAS include update',
    'SAPWrite',
    { action: 'update', type: 'CLAS', name: 'ZCL_TEST', include: 'testclasses', source: '* test' },
  ],
  ...src('CLAS', 'ZCL_TEST', 'CLASS zcl_test DEFINITION PUBLIC. ENDCLASS.\nCLASS zcl_test IMPLEMENTATION. ENDCLASS.'),
  ...src('INTF', 'ZIF_TEST', 'INTERFACE zif_test PUBLIC. ENDINTERFACE.'),
  [
    'CLAS edit_method',
    'SAPWrite',
    { action: 'edit_method', type: 'CLAS', name: 'ZCL_TEST', method: 'run', source: 'METHOD run. ENDMETHOD.' },
  ],
  [
    'FUGR create',
    'SAPWrite',
    { action: 'create', type: 'FUGR', name: 'ZFG_TEST', package: 'ZOTHER', description: 'x' },
  ],
  ['FUGR delete', 'SAPWrite', { action: 'delete', type: 'FUGR', name: 'ZFG_TEST' }],
  ...src('FUNC', 'Z_TEST_FM', 'FUNCTION z_test_fm.\nENDFUNCTION.', { group: 'ZFG_TEST' }),
  ...src('INCL', 'LZFG_TESTF01', '* group include', { group: 'ZFG_TEST' }),
  [
    'DOMA create',
    'SAPWrite',
    {
      action: 'create',
      type: 'DOMA',
      name: 'ZDO_TEST',
      package: 'ZOTHER',
      description: 'x',
      dataType: 'CHAR',
      length: 10,
    },
  ],
  ['DOMA update', 'SAPWrite', { action: 'update', type: 'DOMA', name: 'ZDO_TEST', description: 'y' }],
  ['DOMA delete', 'SAPWrite', { action: 'delete', type: 'DOMA', name: 'ZDO_TEST' }],
  [
    'DTEL create',
    'SAPWrite',
    {
      action: 'create',
      type: 'DTEL',
      name: 'ZDE_TEST',
      package: 'ZOTHER',
      description: 'x',
      typeKind: 'domain',
      typeName: 'ZDO_TEST',
    },
  ],
  ['DTEL update', 'SAPWrite', { action: 'update', type: 'DTEL', name: 'ZDE_TEST', shortLabel: 'y' }],
  ['DTEL delete', 'SAPWrite', { action: 'delete', type: 'DTEL', name: 'ZDE_TEST' }],
  ...src('TABL', 'ZTAB_TEST', 'define table ztab_test { key client : abap.clnt not null; }'),
  [
    'TTYP create',
    'SAPWrite',
    { action: 'create', type: 'TTYP', name: 'ZTT_TEST', package: 'ZOTHER', description: 'x', rowType: 'BAPIRET2' },
  ],
  ['TTYP delete', 'SAPWrite', { action: 'delete', type: 'TTYP', name: 'ZTT_TEST' }],
  [
    'MSAG create',
    'SAPWrite',
    {
      action: 'create',
      type: 'MSAG',
      name: 'ZMSG_TEST',
      package: 'ZOTHER',
      description: 'x',
      messages: [{ number: '001', shortText: 'x' }],
    },
  ],
  [
    'MSAG update',
    'SAPWrite',
    { action: 'update', type: 'MSAG', name: 'ZMSG_TEST', messages: [{ number: '001', shortText: 'y' }] },
  ],
  ['MSAG delete', 'SAPWrite', { action: 'delete', type: 'MSAG', name: 'ZMSG_TEST' }],
  [
    'ENQU create',
    'SAPWrite',
    {
      action: 'create',
      type: 'ENQU',
      name: 'EZTEST',
      package: 'ZOTHER',
      description: 'x',
      source: JSON.stringify({ primaryTable: { tableName: 'ZTAB_TEST', lockMode: 'E' } }),
    },
  ],
  [
    'ENQU update',
    'SAPWrite',
    { action: 'update', type: 'ENQU', name: 'EZTEST', source: JSON.stringify({ allowRFC: true }) },
  ],
  ['ENQU delete', 'SAPWrite', { action: 'delete', type: 'ENQU', name: 'EZTEST' }],
  [
    'TABL/DTT update',
    'SAPWrite',
    { action: 'update', type: 'TABL/DTT', name: 'ZTAB_TEST', source: '{"dataClass":"APPL1"}' },
  ],
  [
    'TABL/DTI create',
    'SAPWrite',
    {
      action: 'create',
      type: 'TABL/DTI',
      name: 'ZTAB_TEST~001',
      source:
        '{"formatVersion":"1","header":{"description":"x","originalLanguage":"en"},"indexFields":[{"fieldName":"CLIENT"}]}',
    },
  ],
  ['TABL/DTI delete', 'SAPWrite', { action: 'delete', type: 'TABL/DTI', name: 'ZTAB_TEST~001' }],
  [
    'APLO create',
    'SAPWrite',
    { action: 'create', type: 'APLO', name: 'ZAPLO_TEST', package: 'ZOTHER', description: 'x', source: '{}' },
  ],
  ['APLO delete', 'SAPWrite', { action: 'delete', type: 'APLO', name: 'ZAPLO_TEST' }],
  [
    'SRVB create',
    'SAPWrite',
    {
      action: 'create',
      type: 'SRVB',
      name: 'ZUI_TEST_O4',
      package: 'ZOTHER',
      description: 'x',
      serviceDefinition: 'ZUI_TEST',
      bindingType: 'ODATA',
      odataVersion: 'V4',
    },
  ],
  ['SRVB update', 'SAPWrite', { action: 'update', type: 'SRVB', name: 'ZUI_TEST_O4', serviceDefinition: 'ZUI_OTHER' }],
  ['SRVB delete', 'SAPWrite', { action: 'delete', type: 'SRVB', name: 'ZUI_TEST_O4' }],
  ['SKTD update', 'SAPWrite', { action: 'update', type: 'SKTD', name: 'ZDOC', source: 'prose' }],
  ['SKTD delete', 'SAPWrite', { action: 'delete', type: 'SKTD', name: 'ZDOC' }],
  ['ENHO update', 'SAPWrite', { action: 'update', type: 'ENHO', name: 'ZENHO_TEST', source: '{}' }],
  ['ENHO delete', 'SAPWrite', { action: 'delete', type: 'ENHO', name: 'ZENHO_TEST' }],
  ['text symbols', 'SAPWrite', { action: 'edit_text_symbols', type: 'PROG', name: 'ZTEST', source: '001 Hello' }],
  ['add_method', 'SAPWrite', { action: 'add_method', type: 'CLAS', name: 'ZCL_TEST', method: 'METHODS extra.' }],
  [
    'edit_class_definition',
    'SAPWrite',
    {
      action: 'edit_class_definition',
      type: 'CLAS',
      name: 'ZCL_TEST',
      source: 'CLASS zcl_test DEFINITION PUBLIC. ENDCLASS.',
    },
  ],
  [
    'local edit_method',
    'SAPWrite',
    {
      action: 'edit_method',
      type: 'CLAS',
      name: 'ZCL_TEST',
      method: 'lcl_helper~run',
      source: 'METHOD run. ENDMETHOD.',
    },
  ],
  [
    'edit_unit',
    'SAPWrite',
    { action: 'edit_unit', type: 'PROG', name: 'ZTEST', unit: 'target', source: 'FORM target.\nENDFORM.' },
  ],
  [
    'add_unit',
    'SAPWrite',
    { action: 'add_unit', type: 'PROG', name: 'ZTEST', unit: 'extra', source: 'FORM extra.\nENDFORM.' },
  ],
  [
    'batch_create',
    'SAPWrite',
    { action: 'batch_create', package: 'ZOTHER', objects: [{ type: 'PROG', name: 'ZB1', source: 'REPORT zb1.' }] },
  ],
  [
    'batch_create activateAtEnd',
    'SAPWrite',
    {
      action: 'batch_create',
      package: 'ZOTHER',
      activateAtEnd: true,
      objects: [
        { type: 'PROG', name: 'ZB1', source: 'REPORT zb1.' },
        { type: 'PROG', name: 'ZB2', source: 'REPORT zb2.' },
      ],
    },
  ],
  [
    'scaffold_rap_handlers',
    'SAPWrite',
    { action: 'scaffold_rap_handlers', type: 'CLAS', name: 'ZBP_I_TEST', bdefName: 'ZI_TEST', autoApply: true },
  ],
  [
    'generate_behavior_implementation',
    'SAPWrite',
    { action: 'generate_behavior_implementation', type: 'CLAS', name: 'ZBP_I_TEST', bdefName: 'ZI_TEST' },
  ],
  [
    'CLAS+INTF batch activate',
    'SAPActivate',
    {
      objects: [
        { type: 'CLAS', name: 'ZCL_TEST' },
        { type: 'INTF', name: 'ZIF_TEST' },
      ],
    },
  ],
];

const isMutation = (r: { method: string; path: string }) =>
  r.method === 'PUT' || r.method === 'DELETE' || (r.method === 'POST' && !r.path.includes('transportchecks'));
const call = (tool: string, args: Record<string, unknown>) => handleToolCall(client(), config, tool, args);
const inTeam = (args: Record<string, unknown>) => JSON.parse(JSON.stringify(args).replaceAll('ZOTHER', 'ZTEAM'));
const assertLockReleased = () => {
  const locked = requests.filter((r) => r.path.includes('_action=LOCK')).map((r) => r.path.split('?')[0]);
  for (const path of locked) expect(requests.some((r) => r.path.startsWith(`${path}?_action=UNLOCK`))).toBe(true);
};

describe.each(OPS)('pinned shared handler: %s', (_label, tool, args) => {
  it('refuses a package outside the destination list before any mutation', async () => {
    pkg = 'ZOTHER';
    expect((await call(tool, args)).isError).toBe(true);
    expect(requests.filter(isMutation)).toEqual([]);
  });

  it('never sends a request off the destination list, from the caller or the lock', async () => {
    pkg = 'ZTEAM';
    lockRequest = FOREIGN;
    await call(tool, inTeam(args));
    if (tool === 'SAPWrite') expect((await call(tool, { ...inTeam(args), transport: FOREIGN })).isError).toBe(true);
    expect(requests.filter((r) => r.path.includes(FOREIGN) || r.body.includes(FOREIGN))).toEqual([]);
    assertLockReleased();
  });

  it('sends a failed save once, carries the request only as corrNr, and releases the lock', async () => {
    failMutation = true;
    await call(tool, tool === 'SAPWrite' ? { ...inTeam(args), transport: ALLOWED } : inTeam(args));
    const sent = requests
      .filter((r) => r.method === 'PUT' || r.method === 'DELETE')
      .map((r) => `${r.method} ${r.path}`);
    expect(new Set(sent).size).toBe(sent.length);
    for (const r of requests.filter((r) => r.body.includes('A4HK'))) expect(r.path).toContain(`corrNr=${ALLOWED}`);
    assertLockReleased();
  });
});
