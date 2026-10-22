import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePinnedRequest } from '../../../src/adt/pinned-write-policy.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { requestContext } = await import('../../../src/server/context.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { handlePinnedWrite } = await import('../../../src/handlers/write/pinned.js');
const { handlePinnedActivation, validatePinnedActivationReferences } = await import(
  '../../../src/handlers/write/pinned-activation.js'
);
const { activate, activateBatch } = await import('../../../src/adt/devtools.js');

const owner = '/sap/bc/adt/oo/classes/zcl_test';
const initial =
  'CLASS zcl_test DEFINITION PUBLIC FINAL CREATE PUBLIC.\n PUBLIC SECTION.\n METHODS value RETURNING VALUE(result) TYPE i.\nENDCLASS.\nCLASS zcl_test IMPLEMENTATION.\n METHOD value.\n result = 1.\n ENDMETHOD.\nENDCLASS.\n';
const replacement = initial.replace('result = 1.', 'result = 2.');
const policy = {
  target: 'A4H/001',
  enabled: true,
  allowedPackages: ['$TMP', 'ZTEAM'],
  allowedTransports: ['A4HK900001'],
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
function client() {
  return new AdtClient({
    baseUrl: 'http://sap:8000',
    strictMultiTargetWrites: true,
    retryUnauthorized: false,
    safety: { ...defaultSafetyConfig(), ...config },
  });
}
let source: string;
let normalizeLineEndings: boolean;
let storedSourceTransform: (value: string) => string;
let pkg: string;
let local: string;
let failSave: number;
let failUnlock: boolean;
let activationRefs: string[] | undefined;
let activationResponse: string;
const requests: Array<{ path: string; method: string; body: string }> = [];
beforeEach(() => {
  vi.resetAllMocks();
  source = initial;
  normalizeLineEndings = false;
  storedSourceTransform = (value) => value;
  pkg = '$TMP';
  local = 'X';
  failSave = 0;
  failUnlock = false;
  activationRefs = undefined;
  activationResponse =
    '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties activationExecuted="true"/></chkl:messages>';
  requests.length = 0;
  mockFetch.mockImplementation(async (url: unknown, options: any = {}) => {
    const parsed = new URL(String(url));
    const path = parsed.pathname + parsed.search;
    const method = options.method ?? 'GET';
    const body = String(options.body ?? '');
    requests.push({ path, method, body });
    if (path.includes('transportchecks'))
      return mockResponse(
        200,
        `<DATA><DEVCLASS>${pkg}</DEVCLASS><DLVUNIT>${pkg === '$TMP' ? 'LOCAL' : 'HOME'}</DLVUNIT><OPERATION>${body.includes('<OPERATION>I</OPERATION>') ? 'I' : ''}</OPERATION><RESULT>S</RESULT><RECORDING>${pkg === '$TMP' ? '' : 'X'}</RECORDING></DATA>`,
      );
    if (path.includes('transportrequests'))
      return mockResponse(
        200,
        '<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="A4HK900001" tm:type="K" tm:status="D"><tm:task tm:number="A4HK900002" tm:status="D"/></tm:request></tm:root>',
      );
    if (path.includes('_action=LOCK'))
      return mockResponse(
        200,
        `<DATA><LOCK_HANDLE>lock-test</LOCK_HANDLE><CORRNR>${pkg === '$TMP' ? '' : 'A4HK900001'}</CORRNR>${local === 'missing' ? '' : `<IS_LOCAL>${local}</IS_LOCAL>`}</DATA>`,
      );
    if (path.includes('_action=UNLOCK')) return mockResponse(failUnlock ? 503 : 200, '');
    if (path.includes('/activation?')) {
      if (activationRefs && path.includes('preauditRequested=true'))
        return mockResponse(
          200,
          `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects"><ioc:entry><ioc:object><ioc:ref xmlns:adtcore="http://www.sap.com/adt/core" adtcore:uri="${activationRefs[0]}" adtcore:name="ZCL_TEST"/></ioc:object></ioc:entry></ioc:inactiveObjects>`,
        );
      return mockResponse(200, activationResponse);
    }
    if (parsed.pathname.endsWith('/source/main')) {
      if (method === 'PUT') {
        if (failSave) return mockResponse(failSave, 'Backend failure');
        source = storedSourceTransform(normalizeLineEndings ? body.replace(/\r?\n/g, '\r\n') : body);
      }
      return mockResponse(200, source);
    }
    if ((parsed.pathname === owner || parsed.pathname === '/sap/bc/adt/oo/interfaces/zif_test') && method === 'GET')
      return mockResponse(
        200,
        `<class:abapClass xmlns:class="http://www.sap.com/adt/oo/classes" xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="${pkg}"/></class:abapClass>`,
      );
    return mockResponse(200, '', { 'x-csrf-token': 'test-token' });
  });
});
function saves() {
  return requests.filter((r) => r.method === 'PUT');
}
function payload(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}
const update = () => ({
  action: 'update',
  type: 'CLAS',
  name: 'ZCL_TEST',
  source: replacement,
  expectedSourceHash: sourceHash(initial),
});

describe('pinned mutation lifecycle on the real ADT HTTP stack', () => {
  it('saves and reads back under an owning lock through shared dispatch', async () => {
    const result = await handleToolCall(client(), config, 'SAPWrite', update());
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(payload(result).state).toBe('saved-inactive');
    expect(saves()).toHaveLength(1);
    expect(requests.some((r) => r.path.includes('_action=UNLOCK'))).toBe(true);
  });
  it('accepts SAP CRLF normalization and returns the actual stored-byte hash', async () => {
    normalizeLineEndings = true;
    const result = await handlePinnedWrite(client(), update(), config);
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(payload(result).sourceHash).toBe(sourceHash(replacement.replace(/\n/g, '\r\n')));
  });
  it.each(['remove', 'add'])('accepts terminal line-break normalization: %s', async (mode) => {
    normalizeLineEndings = true;
    storedSourceTransform = (value) => (mode === 'remove' ? value.replace(/(?:\r?\n)+$/, '') : `${value}\r\n`);
    const result = await handlePinnedWrite(client(), update(), config);
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(payload(result).sourceHash).toBe(sourceHash(source));
  });
  it('does not accept a changed non-terminal source byte as normalization', async () => {
    storedSourceTransform = (value) => value.replace('result = 2.', 'result = 9.');
    const result = await handlePinnedWrite(client(), update(), config);
    expect(result.isError).toBe(true);
    expect(payload(result)).toMatchObject({ state: 'source-save-unknown', retryable: false });
  });
  it.each(['A4HK900001', 'A4HK999999', ''])(
    'verifies sibling task membership against its parent tree: %s',
    async (parent) => {
      const fallback = mockFetch.getMockImplementation()!;
      mockFetch.mockImplementation(async (url: unknown, options: any) => {
        if (String(url).includes('/transportrequests/A4HK900002'))
          return mockResponse(
            200,
            `<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="A4HK900001" tm:type="K" tm:status="D"/><tm:task tm:number="A4HK900002" tm:parent="${parent}" tm:status="D"/></tm:root>`,
          );
        return fallback(url, options);
      });
      const adt = client();
      const result = resolvePinnedRequest(adt.http, adt.safety, 'A4HK900002');
      if (parent === 'A4HK900001') await expect(result).resolves.toBe(parent);
      else await expect(result).rejects.toThrow();
    },
  );
  it('creates with no JWT display responsible and preserves the scoped metadata path', async () => {
    const result = await handlePinnedWrite(
      client(),
      { action: 'create', type: 'CLAS', name: 'ZCL_TEST', source: initial, package: '$TMP' },
      config,
    );
    expect(result.isError, result.content[0].text).toBeUndefined();
    const create = requests.find((r) => r.method === 'POST' && r.path.startsWith('/sap/bc/adt/oo/classes?'));
    expect(
      create?.body ?? requests.find((r) => r.method === 'POST' && r.path === '/sap/bc/adt/oo/classes')?.body,
    ).not.toContain('adtcore:responsible');
  });
  it('splices only an existing main-source method under the full-source hash', async () => {
    const result = await handlePinnedWrite(
      client(),
      { ...update(), action: 'edit_method', method: 'value', source: 'result = 3.' },
      config,
    );
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(saves()[0].body).toContain('result = 3.');
    expect(saves()[0].body).toContain('CLASS zcl_test DEFINITION');
  });
  it('refuses an owner package change under lock even if both packages are allowed', async () => {
    const c = client();
    vi.spyOn(c, 'resolveObjectPackage').mockResolvedValueOnce('$TMP').mockResolvedValueOnce('ZTEAM');
    const result = await handlePinnedWrite(c, update(), config);
    expect(payload(result).message).toContain('package changed');
    expect(saves()).toHaveLength(0);
  });
  it('cancels unsent save phases but still attempts cleanup on its own budget', async () => {
    const controller = new AbortController();
    const c = client();
    const resolve = c.resolveObjectPackage.bind(c);
    let calls = 0;
    vi.spyOn(c, 'resolveObjectPackage').mockImplementation(async (...args) => {
      const value = await resolve(...args);
      if (++calls === 2) controller.abort();
      return value;
    });
    const result = await requestContext.run({ requestId: 'cancel-test', signal: controller.signal }, () =>
      handlePinnedWrite(c, update(), config),
    );
    expect(payload(result).retryable).toBe(false);
    expect(saves()).toHaveLength(0);
    expect(requests.filter((r) => r.path.includes('_action=UNLOCK'))).toHaveLength(1);
  });
  it('requires a hash before any backend request and rejects a stale hash under lock', async () => {
    const missing = update();
    delete (missing as Partial<typeof missing>).expectedSourceHash;
    expect((await handlePinnedWrite(client(), missing, config)).isError).toBe(true);
    expect(requests).toHaveLength(0);
    const result = await handlePinnedWrite(client(), { ...update(), expectedSourceHash: '0'.repeat(64) }, config);
    expect(payload(result)).toMatchObject({ state: 'unchanged', retryable: false });
    expect(saves()).toHaveLength(0);
    expect(requests.some((r) => r.path.includes('_action=UNLOCK'))).toBe(true);
  });
  it.each(['missing', 'Y', ''])('refuses unproven/mismatched local lock evidence: %s', async (value) => {
    local = value;
    const result = await handlePinnedWrite(client(), update(), config);
    expect(result.isError).toBe(true);
    expect(saves()).toHaveLength(0);
  });
  it('canonicalizes a verified task to its allowed parent before saving', async () => {
    pkg = 'ZTEAM';
    local = '';
    const result = await handlePinnedWrite(client(), { ...update(), transport: 'A4HK900002' }, config);
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(saves()[0].path).toContain('corrNr=A4HK900001');
    expect(saves()[0].path).not.toContain('A4HK900002');
  });
  it('refuses a destination-denied recording request even when the global list is empty', async () => {
    pkg = 'ZTEAM';
    local = '';
    const c = client();
    c.safety.multiTargetWrite = { ...policy, allowedTransports: [] };
    const result = await handlePinnedWrite(c, { ...update(), transport: 'A4HK900002' }, config);
    expect(result.isError).toBe(true);
    expect(saves()).toHaveLength(0);
  });
  it.each([401, 403, 429, 500, 503])(
    'never replays failed saves (%i), and preserves primary failure when unlock fails',
    async (status) => {
      failSave = status;
      failUnlock = true;
      const result = await handlePinnedWrite(client(), update(), config);
      expect(payload(result)).toMatchObject({
        state: 'source-save-unknown',
        statusCode: status,
        retryable: false,
        cleanupFailed: true,
      });
      expect(saves()).toHaveLength(1);
      expect(requests.filter((r) => r.path.includes('_action=UNLOCK'))).toHaveLength(1);
    },
  );
  it('reports partial create state on source failure', async () => {
    failSave = 500;
    const result = await handlePinnedWrite(
      client(),
      {
        action: 'create',
        type: 'INTF',
        name: 'ZIF_TEST',
        source: 'INTERFACE zif_test PUBLIC. ENDINTERFACE.',
        package: '$TMP',
      },
      config,
    );
    expect(result.isError).toBe(true);
    expect(payload(result).state).toMatch(/^created-/);
    expect(payload(result).retryable).toBe(false);
  });
  it('requires a validator at low-level multi-target activation and refuses batch recovery', async () => {
    const c = client();
    await expect(activate(c.http, c.safety, owner)).rejects.toThrow('validation context');
    await expect(activateBatch(c.http, c.safety, [{ url: owner, name: 'ZCL_TEST' }])).rejects.toThrow('forbidden');
    expect(requests).toHaveLength(0);
  });
  it('refuses foreign, encoded, query and unknown activation references', () => {
    for (const uri of [
      `${owner}2`,
      `${owner}/source/main`,
      `${owner}?x=1`,
      'https://sap.example' + owner,
      owner.replace('zcl', '%7acl'),
      `${owner}/includes/unknown`,
    ])
      expect(() => validatePinnedActivationReferences(owner, 'CLAS', [{ uri }])).toThrow();
    expect(() =>
      validatePinnedActivationReferences(owner, 'CLAS', [{ uri: owner }, { uri: `${owner}/includes/definitions` }]),
    ).not.toThrow();
  });
  it('validates expanded references before the confirmation POST', async () => {
    activationRefs = ['/sap/bc/adt/oo/classes/zcl_other'];
    const denied = await handlePinnedActivation(client(), { type: 'CLAS', name: 'ZCL_TEST' });
    expect(denied.isError).toBe(true);
    expect(requests.filter((r) => r.path.includes('/activation?'))).toHaveLength(1);
    requests.length = 0;
    activationRefs = [`${owner}/includes/definitions`];
    const allowed = await handlePinnedActivation(client(), { type: 'CLAS', name: 'ZCL_TEST' });
    expect(allowed.isError, allowed.content[0].text).toBeUndefined();
    expect(requests.filter((r) => r.path.includes('/activation?'))).toHaveLength(2);
  });
  it.each([
    '',
    '<html>Login</html>',
    '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties activationExecuted="false"/></chkl:messages>',
  ])('never claims activation success without SAP execution evidence: %s', async (response) => {
    activationResponse = response;
    for (const refs of [undefined, [`${owner}/includes/definitions`]]) {
      activationRefs = refs;
      const result = await handlePinnedActivation(client(), { type: 'CLAS', name: 'ZCL_TEST' });
      expect(result.isError).toBe(true);
      expect(payload(result)).toMatchObject({ state: 'activation-not-confirmed', retryable: false });
    }
  });
  it('activates only after package and recording checks', async () => {
    const result = await handlePinnedActivation(client(), { type: 'CLAS', name: 'ZCL_TEST' });
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(requests.filter((r) => r.path.includes('/activation?'))).toHaveLength(1);
  });
});
