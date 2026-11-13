/** Pinned PROG writes served by the single-target handlers, plus the admission list. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import { ACTION_POLICY } from '../../../src/authz/policy.js';
import { pinnedMutationAllowed, SHARED_PINNED_ACTIONS } from '../../../src/server/multi-target-write-surface.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

const owner = '/sap/bc/adt/programs/programs/ztest';
const initial = 'REPORT ztest.\nWRITE 1.\n';
const replacement = 'REPORT ztest.\nWRITE 2.\n';
const policy = {
  target: 'A4H/001',
  enabled: true,
  allowedPackages: ['$TMP', 'ZTEAM'],
  allowedTransports: ['A4HK900001'],
  serverAllowedTransports: ['A4HK900001'],
};
const config = {
  ...DEFAULT_CONFIG,
  targetId: 'A4H/001',
  multiTargetEndpoints: true,
  multiTargetWrite: policy,
  allowWrites: true,
  allowedPackages: ['$TMP', 'ZTEAM'],
  ppEnabled: true,
  ppStrict: true,
  lintBeforeWrite: false,
};
const client = () => new AdtClient({ baseUrl: 'http://sap:8000', safety: { ...defaultSafetyConfig(), ...config } });

let source: string;
let pkg: string;
let lockRequest: string;
let failSave: number;
let failUnlock: boolean;
let preauditExtra: string;
const requests: Array<{ path: string; method: string }> = [];
beforeEach(() => {
  vi.resetAllMocks();
  source = initial;
  pkg = '$TMP';
  lockRequest = '';
  failSave = 0;
  failUnlock = false;
  preauditExtra = '';
  requests.length = 0;
  mockFetch.mockImplementation(async (url: unknown, options: any = {}) => {
    const parsed = new URL(String(url));
    const path = parsed.pathname + parsed.search;
    const method = options.method ?? 'GET';
    requests.push({ path, method });
    if (path.includes('transportchecks'))
      return mockResponse(
        200,
        `<DATA><DEVCLASS>${pkg}</DEVCLASS><DLVUNIT>${pkg === '$TMP' ? 'LOCAL' : 'HOME'}</DLVUNIT><OPERATION>${String(options.body ?? '').includes('<OPERATION>I</OPERATION>') ? 'I' : ''}</OPERATION><RESULT>S</RESULT><RECORDING>${pkg === '$TMP' ? '' : 'X'}</RECORDING></DATA>`,
      );
    if (path.includes('preauditRequested=true') && preauditExtra)
      return mockResponse(
        200,
        `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="http://www.sap.com/adt/core">${[
          '/sap/bc/adt/programs/programs/ztest',
          preauditExtra,
        ]
          .map(
            (uri) =>
              `<ioc:entry><ioc:object><ioc:ref adtcore:uri="${uri}" adtcore:type="PROG/P" adtcore:name="${uri.split('/').pop()?.toUpperCase()}"/></ioc:object></ioc:entry>`,
          )
          .join('')}</ioc:inactiveObjects>`,
      );
    if (path.includes('/activation?'))
      return mockResponse(
        200,
        '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties activationExecuted="true"/></chkl:messages>',
      );
    if (parsed.pathname.startsWith('/sap/bc/adt/textelements/') && method === 'GET')
      return mockResponse(200, '<textElement name="ZTEST" type="PROG/PX" version="active"/>');
    if (method === 'DELETE') return mockResponse(failSave || 200, '');
    if (path.includes('_action=LOCK'))
      return mockResponse(200, `<DATA><LOCK_HANDLE>lock-test</LOCK_HANDLE><CORRNR>${lockRequest}</CORRNR></DATA>`);
    if (path.includes('_action=UNLOCK')) return mockResponse(failUnlock ? 503 : 200, '');
    if (parsed.pathname.endsWith('/source/main')) {
      if (method === 'PUT') {
        if (failSave) return mockResponse(failSave, 'Backend failure');
        source = String(options.body ?? '');
      }
      return mockResponse(200, source);
    }
    if (parsed.pathname.toLowerCase() === owner && method === 'GET')
      return mockResponse(
        200,
        `<program:abapProgram xmlns:program="http://www.sap.com/adt/programs/programs" xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="${pkg}"/></program:abapProgram>`,
      );
    return mockResponse(200, '', { 'x-csrf-token': 'test-token' });
  });
});
const update = (extra: Record<string, unknown> = {}) => ({
  action: 'update',
  type: 'PROG',
  name: 'ZTEST',
  source: replacement,
  expectedSourceHash: sourceHash(initial),
  ...extra,
});
const puts = () => requests.filter((r) => r.method === 'PUT');
const call = (args: Record<string, unknown>) => handleToolCall(client(), config, 'SAPWrite', args);

describe('pinned PROG writes through the single-target handler', () => {
  it('saves under the lock and unlocks', async () => {
    const result = await call(update());
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(source).toBe(replacement);
    expect(puts()).toHaveLength(1);
    expect(requests.some((r) => r.path.includes('_action=UNLOCK'))).toBe(true);
  });

  it('refuses a stale hash without saving', async () => {
    const result = await call(update({ expectedSourceHash: sourceHash('other') }));
    expect(result.isError).toBe(true);
    expect(puts()).toHaveLength(0);
  });

  it('refuses a package outside the destination allowlist before locking', async () => {
    pkg = 'ZOTHER';
    const result = await call(update());
    expect(result.isError).toBe(true);
    expect(requests.some((r) => r.path.includes('_action=LOCK'))).toBe(false);
  });

  it('refuses a request outside the destination allowlist, caller-supplied or from the lock', async () => {
    pkg = 'ZTEAM';
    expect((await call(update({ transport: 'A4HK999999' }))).isError).toBe(true);
    lockRequest = 'A4HK999999';
    expect((await call(update())).isError).toBe(true);
    expect(puts()).toHaveLength(0);
    lockRequest = 'A4HK900001';
    expect((await call(update())).isError).toBeUndefined();
    expect(puts()[0].path).toContain('corrNr=A4HK900001');
  });

  it('does not replay a failed save', async () => {
    failSave = 503;
    const result = await call(update());
    expect(result.isError).toBe(true);
    expect(puts()).toHaveLength(1);
  });

  it('reports an unconfirmed unlock instead of plain success', async () => {
    failUnlock = true;
    const result = await call(update());
    expect(result.isError).toBe(true);
    expect(requests.filter((r) => r.path.includes('_action=UNLOCK'))).toHaveLength(1);
  });

  it('creates in an allowed package and saves the source', async () => {
    const args = { action: 'create', type: 'PROG', name: 'ZTEST', package: '$TMP', source: replacement };
    const result = await call(args);
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(requests.some((r) => r.method === 'POST' && r.path.startsWith('/sap/bc/adt/programs/programs?'))).toBe(true);
    expect(source).toBe(replacement);
  });

  it('refuses creation in a package or request outside the destination ceiling before any POST', async () => {
    const base = { action: 'create', type: 'PROG', name: 'ZTEST', source: replacement };
    expect((await call({ ...base, package: 'ZOTHER' })).isError).toBe(true);
    pkg = 'ZTEAM';
    expect((await call({ ...base, package: 'ZTEAM', transport: 'A4HK999999' })).isError).toBe(true);
    expect(requests.filter((r) => r.method !== 'GET' && !r.path.includes('transportchecks'))).toHaveLength(0);
  });

  it('deletes under the lock without replaying a failed DELETE', async () => {
    const args = { action: 'delete', type: 'PROG', name: 'ZTEST' };
    failSave = 503;
    expect((await call(args)).isError).toBe(true);
    expect(requests.filter((r) => r.method === 'DELETE')).toHaveLength(1);
    failSave = 0;
    const result = await call(args);
    expect(result.isError, result.content[0].text).toBeUndefined();
  });

  it('refuses deleting through a request outside the destination ceiling', async () => {
    pkg = 'ZTEAM';
    lockRequest = 'A4HK999999';
    expect((await call({ action: 'delete', type: 'PROG', name: 'ZTEST' })).isError).toBe(true);
    expect(requests.filter((r) => r.method === 'DELETE')).toHaveLength(0);
    expect(requests.some((r) => r.path.includes('_action=UNLOCK'))).toBe(true);
  });

  it('activates through the shared handler; single and batch, package-checked', async () => {
    const result = await handleToolCall(client(), config, 'SAPActivate', { type: 'PROG', name: 'ZTEST' });
    expect(result.isError, result.content[0].text).toBeUndefined();
    const objects = [{ type: 'PROG', name: 'ZTEST' }];
    const batch = await handleToolCall(client(), config, 'SAPActivate', { objects });
    expect(batch.isError, batch.content[0].text).toBeUndefined();
    pkg = 'ZOTHER';
    expect((await handleToolCall(client(), config, 'SAPActivate', { type: 'PROG', name: 'ZTEST' })).isError).toBe(true);
    expect((await handleToolCall(client(), config, 'SAPActivate', { objects })).isError).toBe(true);
  });

  it('refuses to confirm objects SAP adds to the activation, and accepts own sub-resources', async () => {
    const args = { type: 'PROG', name: 'ZTEST' };
    preauditExtra = '/sap/bc/adt/programs/programs/zother';
    const refused = await handleToolCall(client(), config, 'SAPActivate', args);
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain('ZOTHER');
    expect(requests.filter((r) => r.path.includes('preauditRequested=false'))).toHaveLength(0);
    preauditExtra = '/sap/bc/adt/programs/programs/ztest/source/main';
    const own = await handleToolCall(client(), config, 'SAPActivate', args);
    expect(own.isError, own.content[0].text).toBeUndefined();
  });

  it('refuses preaudit=false, unlisted tools and a request off the allowlist at admission', async () => {
    for (const [tool, args] of [
      ['SAPActivate', { type: 'PROG', name: 'ZTEST', preaudit: false }],
      ['SAPActivate', { action: 'publish_srvb', name: 'ZTEST' }],
      ['SAPWrite', update({ transport: 'A4HK999999' })],
      ['SAPWrite', { action: 'batch_create', objects: [{ type: 'PROG', name: 'ZA', transport: 'A4HK999999' }] }],
    ] as const)
      expect(pinnedMutationAllowed(tool, args, config), JSON.stringify(args)).toBe(false);
    expect(pinnedMutationAllowed('SAPWrite', update({ action: 'edit_unit' }), config)).toBe(true);
  });

  it('refuses fields outside the single-target schema; CLAS/INTF use the same rule as every type', async () => {
    for (const args of [update({ target: 'A4H/001' }), update({ unknownField: 'x' })])
      expect(pinnedMutationAllowed('SAPWrite', args, config), JSON.stringify(args)).toBe(false);
    for (const args of [
      { action: 'update', type: 'CLAS', name: 'ZCL_TEST', source: 'x', lintBeforeWrite: false },
      { action: 'update', type: 'CLAS', name: 'ZCL_TEST', source: 'x', include: 'testclasses' },
      { action: 'edit_method', type: 'CLAS', name: 'ZCL_TEST', method: 'm', source: 'x' },
    ])
      expect(pinnedMutationAllowed('SAPWrite', args, config), JSON.stringify(args)).toBe(true);
    const result = await call(update({ unknownField: 'x' }));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not enabled for this multi-target connection');
    expect(requests).toHaveLength(0);
  });

  it('refuses non-admitted mutations on direct dispatch before any request', async () => {
    for (const [tool, args] of [
      ['SAPManage', { action: 'create_package', name: 'ZNEW', description: 'x', superPackage: 'ZTEAM' }],
      ['SAPManage', { action: 'delete_package', name: 'ZTEAM' }],
      ['SAPManage', { action: 'set_api_state', type: 'CLAS', name: 'ZCL_TEST', apiState: 'released' }],
      ['SAPTransport', { action: 'create', description: 'x', package: 'ZTEAM' }],
      ['SAPTransport', { action: 'release', id: 'A4HK900001' }],
      ['SAPDiagnose', { action: 'set_sql_trace_state', enabled: true }],
      ['SAPGit', { action: 'pull', repoId: 'R' }],
      ['SAPActivate', { action: 'publish_srvb', name: 'ZSB' }],
      ['SAPLint', { action: 'set_formatter_settings', indentation: true }],
      [
        'SAPWrite',
        {
          action: 'edit_content',
          type: 'PROG',
          name: 'ZTEST',
          oldContent: 'old',
          newContent: 'new',
          expectedSourceHash: sourceHash('old'),
        },
      ],
    ] as const) {
      const result = await handleToolCall(client(), config, tool, args);
      expect(result.isError, `${tool} ${JSON.stringify(args)}`).toBe(true);
      expect(result.content[0].text).toContain('not enabled for this multi-target connection');
    }
    expect(requests).toHaveLength(0);
  });

  it('decides every SAPWrite/SAPActivate policy action explicitly', () => {
    const notAdmitted = new Set(['SAPActivate.publish_srvb', 'SAPActivate.unpublish_srvb']);
    for (const key of Object.keys(ACTION_POLICY).filter((k) => /^SAP(?:Write|Activate)\./.test(k)))
      expect(SHARED_PINNED_ACTIONS.has(key) !== notAdmitted.has(key), key).toBe(true);
  });
});
