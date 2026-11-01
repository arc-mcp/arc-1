import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMutationContext } from '../../../src/adt/mutation-http.js';
import { resolvePinnedRequest } from '../../../src/adt/pinned-write-policy.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { requestContext } = await import('../../../src/server/context.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { handlePinnedWrite } = await import('../../../src/handlers/write/pinned.js');
const writeHelpers = await import('../../../src/handlers/write-helpers.js');
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
function client() {
  return new AdtClient({
    baseUrl: 'http://sap:8000',
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
  // Prototype spies follow the request/session client clones; restore them between cases.
  vi.restoreAllMocks();
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
      const result = resolvePinnedRequest(adt.http, adt.safety, 'A4HK900002', {
        deadline: Date.now() + 300_000,
        noReplay: true,
        retryTransientErrors: false,
      });
      if (parent === 'A4HK900001') await expect(result).resolves.toBe(parent);
      else await expect(result).rejects.toThrow();
    },
  );
  it('directs a failed pinned method splice to SAPRead without saving source', async () => {
    const result = await handlePinnedWrite(
      client(),
      { ...update(), action: 'edit_method', method: 'valu', source: 'result = 3.' },
      config,
    );
    expect(result.isError).toBe(true);
    expect(payload(result).message).toContain('Use SAPRead with method="*"');
    expect(requests.some((request) => request.method === 'PUT')).toBe(false);
  });

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
    vi.spyOn(AdtClient.prototype, 'resolveObjectPackage').mockResolvedValueOnce('$TMP').mockResolvedValueOnce('ZTEAM');
    const result = await handlePinnedWrite(c, update(), config);
    expect(payload(result).message).toContain('package changed');
    expect(saves()).toHaveLength(0);
  });
  it('cancels unsent save phases but still attempts cleanup on its own budget', async () => {
    const controller = new AbortController();
    const c = client();
    const resolve = c.resolveObjectPackage.bind(c);
    let calls = 0;
    vi.spyOn(AdtClient.prototype, 'resolveObjectPackage').mockImplementation(async (...args) => {
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
  it.each([
    { action: 'create', type: 'CLAS', name: 'ZCL_TEST', package: '$TMP' },
    { action: 'update', type: 'CLAS', name: 'ZCL_TEST', expectedSourceHash: sourceHash(initial) },
    { action: 'edit_method', type: 'CLAS', name: 'ZCL_TEST', method: 'VALUE', expectedSourceHash: sourceHash(initial) },
  ])('requires source for $action before any backend request', async (args) => {
    const result = await handlePinnedWrite(client(), args, config);
    expect(payload(result)).toMatchObject({
      error: 'PINNED_WRITE_REFUSED',
      state: 'unchanged',
      message: 'A non-empty source is required.',
    });
    expect(requests).toHaveLength(0);
  });
  it('requires a hash before any backend request and rejects a stale hash under lock', async () => {
    const missing = update();
    delete (missing as Partial<typeof missing>).expectedSourceHash;
    expect((await handlePinnedWrite(client(), missing, config)).isError).toBe(true);
    expect(requests).toHaveLength(0);
    const result = await handlePinnedWrite(client(), { ...update(), expectedSourceHash: '0'.repeat(64) }, config);
    expect(payload(result)).toMatchObject({ error: 'PINNED_WRITE_REFUSED', state: 'unchanged', retryable: false });
    expect(saves()).toHaveLength(0);
    expect(requests.some((r) => r.path.includes('_action=UNLOCK'))).toBe(true);
  });
  it('reports that no save was sent when ordinary preflight fails', async () => {
    const c = client();
    vi.spyOn(AdtClient.prototype, 'resolveObjectPackage').mockRejectedValue(new Error('Metadata unavailable'));
    const result = await handlePinnedWrite(c, update(), config);
    expect(payload(result)).toMatchObject({
      error: 'PINNED_WRITE_REFUSED',
      state: 'unchanged',
      message: 'No create, source save or activation request was sent. Review the reported phase before continuing.',
      retryable: false,
    });
    expect(saves()).toHaveLength(0);
  });
  it('rechecks subtree membership under the lock and refuses a package moved out of scope', async () => {
    const c = client();
    c.safety.multiTargetWrite = { ...policy, allowedPackages: ['ZROOT/**'] };
    const hierarchy = vi.spyOn(AdtClient.prototype, 'getSubpackages');
    const packages = vi.spyOn(AdtClient.prototype, 'resolveObjectPackage');
    let checks = 0;
    hierarchy.mockImplementation(async (root) => (root === 'ZROOT' && ++checks === 1 ? ['$TMP'] : []));
    const result = await handlePinnedWrite(c, update(), config);
    expect(payload(result)).toMatchObject({ state: 'unchanged', phase: 'locked-policy' });
    expect(checks).toBe(2);
    expect(saves()).toHaveLength(0);
    expect(requests.some((r) => r.path.includes('_action=UNLOCK'))).toBe(true);
    const preflight = packages.mock.contexts[0] as InstanceType<typeof AdtClient>;
    const locked = packages.mock.contexts[1] as InstanceType<typeof AdtClient>;
    expect(locked.http).not.toBe(preflight.http);
    expect((hierarchy.mock.contexts[0] as InstanceType<typeof AdtClient>).http).toBe(preflight.http);
    expect((hierarchy.mock.contexts[1] as InstanceType<typeof AdtClient>).http).toBe(locked.http);
    expect(getMutationContext(locked.http, locked.safety)).toBe(getMutationContext(preflight.http, preflight.safety));
    expect(getMutationContext(locked.http, locked.safety)).toBeDefined();
    const budgets = hierarchy.mock.calls.map((call) => call[2]);
    expect(budgets.every((budget) => budget?.noReplay && budget.deadline === budgets[0]?.deadline)).toBe(true);
  });
  it.each(['preflight', 'under-lock'] as const)('aborts during the hierarchy walk: %s', async (stage) => {
    const c = client();
    const controller = new AbortController();
    c.safety.multiTargetWrite = { ...policy, allowedPackages: ['ZROOT/**'] };
    const fallback = mockFetch.getMockImplementation()!;
    let roots = 0;
    const visited: string[] = [];
    mockFetch.mockImplementation(async (url: unknown, options: any) => {
      const parsed = new URL(String(url));
      if (!parsed.pathname.endsWith('/repository/nodestructure')) return fallback(url, options);
      const root = parsed.searchParams.get('parent_name')!;
      visited.push(root);
      if (root === 'ZROOT' && ++roots === (stage === 'preflight' ? 1 : 2)) controller.abort();
      return mockResponse(
        200,
        root === 'ZROOT'
          ? '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><TREE_CONTENT><SEU_ADT_REPOSITORY_OBJ_NODE><OBJECT_TYPE>DEVC/K</OBJECT_TYPE><OBJECT_NAME>$TMP</OBJECT_NAME></SEU_ADT_REPOSITORY_OBJ_NODE></TREE_CONTENT></DATA></asx:values></asx:abap>'
          : '',
      );
    });
    const hierarchy = vi.spyOn(AdtClient.prototype, 'getSubpackages');
    const result = await requestContext.run({ requestId: 'hierarchy-cancel', signal: controller.signal }, () =>
      handlePinnedWrite(c, update(), config),
    );
    expect(payload(result)).toMatchObject({
      state: 'unchanged',
      phase: stage === 'preflight' ? 'validation' : 'locked-policy',
    });
    expect(visited).toEqual(stage === 'preflight' ? ['ZROOT'] : ['ZROOT', 'ZROOT']);
    expect(requests.some((r) => r.path.includes('_action=LOCK'))).toBe(stage === 'under-lock');
    expect(requests.some((r) => r.path.includes('_action=UNLOCK'))).toBe(stage === 'under-lock');
    expect(requests.some((r) => r.path.includes('/source/main'))).toBe(false);
    expect(saves()).toHaveLength(0);
    expect(hierarchy.mock.calls.every((call) => call[2]?.signal === controller.signal)).toBe(true);
  });
  it('independently denies a server subtree even when the destination subtree would allow the package', async () => {
    const c = client();
    c.safety.allowedPackages = ['ZGLOBAL/**'];
    c.safety.multiTargetWrite = { ...policy, allowedPackages: ['ZDEST/**'] };
    vi.spyOn(AdtClient.prototype, 'getSubpackages').mockImplementation(async (root) =>
      root === 'ZDEST' ? ['$TMP'] : [],
    );
    expect((await handlePinnedWrite(c, update(), config)).isError).toBe(true);
    expect(requests.some((r) => r.path.includes('_action=LOCK'))).toBe(false);
    expect(saves()).toHaveLength(0);
  });
  it('shares a hierarchy decision across both create gates, then refreshes under the lock', async () => {
    const c = client();
    c.safety.allowedPackages = ['ZROOT/**'];
    c.safety.multiTargetWrite = { ...policy, allowedPackages: ['ZROOT/**'] };
    const hierarchy = vi
      .spyOn(AdtClient.prototype, 'getSubpackages')
      .mockImplementation(async (root) => (root === 'ZROOT' ? ['$TMP'] : []));
    const result = await handlePinnedWrite(
      c,
      { action: 'create', type: 'CLAS', name: 'ZCL_TEST', package: '$TMP', source: initial },
      config,
    );
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(hierarchy.mock.calls.filter(([root]) => root === 'ZROOT')).toHaveLength(2);
    expect(hierarchy.mock.calls.filter(([root]) => root === '$TMP')).toHaveLength(0);
  });
  it('refuses activation when subtree membership changes before the first preaudit submission', async () => {
    const c = client();
    c.safety.multiTargetWrite = { ...policy, allowedPackages: ['ZROOT/**'] };
    let roots = 0;
    vi.spyOn(AdtClient.prototype, 'getSubpackages').mockImplementation(async (root) =>
      root === 'ZROOT' && ++roots === 1 ? ['$TMP'] : [],
    );
    const result = await handlePinnedActivation(c, { type: 'CLAS', name: 'ZCL_TEST' });
    expect(result.isError).toBe(true);
    expect(roots).toBe(2);
    expect(requests.some((r) => r.path.includes('/activation?'))).toBe(false);
  });
  it('refuses subtree drift after the preaudit prompt and keeps hierarchy reads inside the original policy', async () => {
    const c = client();
    const controller = new AbortController();
    c.safety.multiTargetWrite = { ...policy, allowedPackages: ['ZROOT/**'] };
    activationRefs = [owner];
    let roots = 0;
    const hierarchy = vi
      .spyOn(AdtClient.prototype, 'getSubpackages')
      .mockImplementation(async (root) => (root === 'ZROOT' && ++roots < 3 ? ['$TMP'] : []));
    const result = await requestContext.run({ requestId: 'post-prompt-drift', signal: controller.signal }, () =>
      handlePinnedActivation(c, { type: 'CLAS', name: 'ZCL_TEST' }),
    );
    expect(result.isError).toBe(true);
    expect(roots).toBe(3);
    const submissions = requests.filter((r) => r.path.includes('/activation?'));
    expect(submissions).toHaveLength(1);
    expect(submissions[0].path).toContain('preauditRequested=true');
    const deadline = hierarchy.mock.calls[0][2]?.deadline;
    expect(Number.isFinite(deadline)).toBe(true);
    for (const call of hierarchy.mock.calls)
      expect(call[2]).toMatchObject({
        deadline,
        signal: controller.signal,
        noReplay: true,
        retryTransientErrors: false,
      });
  });
  it('actually aborts a hanging activation at the remaining outer deadline', async () => {
    const c = client();
    const started = Date.now();
    let now = started;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fallback = mockFetch.getMockImplementation()!;
    let pending = 0;
    mockFetch.mockImplementation(async (url: unknown, options: any) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/activation')) {
        pending++;
        return new Promise((_, reject) => {
          const abort = () => reject(new DOMException('Aborted', 'AbortError'));
          if (options.signal.aborted) abort();
          else options.signal.addEventListener('abort', abort, { once: true });
        });
      }
      const result = await fallback(url, options);
      if (path === owner && options?.method === 'GET') now = started + 299_950;
      return result;
    });
    const result = await handlePinnedActivation(c, { type: 'CLAS', name: 'ZCL_TEST' });
    expect(result.isError).toBe(true);
    expect(pending).toBe(1);
    expect(payload(result)).toMatchObject({ retryable: false, state: 'activation-not-confirmed' });
  });
  it('keeps activation HTTP inside the original deadline after a slow preflight', async () => {
    const c = client();
    const started = Date.now();
    let now = started;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const fallback = mockFetch.getMockImplementation()!;
      mockFetch.mockImplementation(async (url: unknown, options: any) => {
        const result = await fallback(url, options);
        if (new URL(String(url)).pathname === owner && options?.method === 'GET') now += 10_000;
        return result;
      });
      const post = vi.spyOn(c.http, 'post');
      const result = await handlePinnedActivation(c, { type: 'CLAS', name: 'ZCL_TEST' });
      expect(result.isError, result.content[0].text).toBeUndefined();
      const activation = post.mock.calls.filter(([path]) => path.includes('/activation?'));
      expect(activation.length).toBeGreaterThan(0);
      for (const call of activation)
        expect(call[4]).toMatchObject({ deadline: started + 300_000, noReplay: true, retryTransientErrors: false });
    } finally {
      clock.mockRestore();
    }
  });
  it.each(['missing', 'Y', ''])('refuses unproven/mismatched local lock evidence: %s', async (value) => {
    local = value;
    const result = await handlePinnedWrite(client(), update(), config);
    expect(result.isError).toBe(true);
    expect(saves()).toHaveLength(0);
  });
  it.each(['update', 'edit_method'])(
    'canonicalizes a verified task to its allowed parent before %s',
    async (action) => {
      pkg = 'ZTEAM';
      local = '';
      const result = await handlePinnedWrite(
        client(),
        {
          ...update(),
          action,
          transport: 'A4HK900002',
          ...(action === 'edit_method' ? { method: 'value', source: 'result = 2.' } : {}),
        },
        config,
      );
      expect(result.isError, result.content[0].text).toBeUndefined();
      expect(saves()[0].path).toContain('corrNr=A4HK900001');
      expect(saves()[0].path).not.toContain('A4HK900002');
      expect(payload(result).transport).toBe('A4HK900001');
    },
  );
  it('refuses a destination-denied recording request', async () => {
    pkg = 'ZTEAM';
    local = '';
    const c = client();
    c.safety.multiTargetWrite = { ...policy, allowedTransports: [] };
    const result = await handlePinnedWrite(c, { ...update(), transport: 'A4HK900002' }, config);
    expect(result.isError).toBe(true);
    expect(saves()).toHaveLength(0);
  });
  it.each([400, 401, 403, 404, 409, 412, 415, 422, 423, 429, 500, 503])(
    'never replays failed saves (%i), and preserves primary failure when unlock fails',
    async (status) => {
      failSave = status;
      failUnlock = true;
      const result = await handlePinnedWrite(client(), update(), config);
      expect(payload(result)).toMatchObject({
        error: status < 429 ? 'PINNED_WRITE_REFUSED' : 'PINNED_WRITE_INCOMPLETE',
        state: status < 429 ? 'source-save-rejected' : 'source-save-unknown',
        statusCode: status,
        retryable: false,
        cleanupFailed: true,
      });
      expect(saves()).toHaveLength(1);
      expect(requests.filter((r) => r.path.includes('_action=UNLOCK'))).toHaveLength(1);
    },
  );
  it('keeps ordinary reads on a write-capable client retryable', async () => {
    const fallback = mockFetch.getMockImplementation()!;
    let first = true;
    mockFetch.mockImplementation(async (url: unknown, options: any) => {
      if (new URL(String(url)).pathname.endsWith('/source/main') && first) {
        first = false;
        return mockResponse(503, 'busy');
      }
      return fallback(url, options);
    });
    expect((await client().http.get(`${owner}/source/main`)).body).toBe(initial);
    expect(first).toBe(false);
  });
  it.each([true, false])('reports verified saved hash and actual session cleanup: closed=%s', async (closed) => {
    failUnlock = true;
    const fallback = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation(async (url: unknown, options: any) => {
      if (String(url).includes('_action=LOCK'))
        return mockResponse(200, '<DATA><LOCK_HANDLE>lock-test</LOCK_HANDLE><IS_LOCAL>X</IS_LOCAL></DATA>', {
          'set-cookie': 'sap-contextid=owned; Path=/',
        });
      if (String(url).includes('/http/sessions')) return mockResponse(closed ? 200 : 503, '');
      return fallback(url, options);
    });
    const result = payload(await handlePinnedWrite(client(), update(), config));
    expect(result).toMatchObject({
      state: 'saved-inactive',
      sourceHash: sourceHash(replacement),
      cleanupFailed: true,
      sessionClosed: closed,
    });
    expect(result.cleanup).toContain(closed ? 'was closed' : 'was not confirmed');
  });
  it.each(
    ['create', 'update', 'edit_method'].flatMap((action) =>
      ['unlock', 'close', 'both'].map((failure) => ({ action, failure })),
    ),
  )('retains confirmed source, warnings and parent request on cleanup failure: %j', async ({ action, failure }) => {
    pkg = 'ZTEAM';
    local = '';
    failUnlock = failure !== 'close';
    vi.spyOn(writeHelpers, 'runPreWriteLint').mockReturnValue({
      blocked: false,
      warnings: 'Saved-source lint warning',
    });
    const fallback = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation(async (url: unknown, options: any) => {
      const response = await fallback(url, options);
      if (String(url).includes('_action=LOCK')) response.headers.set('set-cookie', 'sap-contextid=owned; Path=/');
      if (String(url).includes('/http/sessions') && failure !== 'unlock') return mockResponse(503, '');
      return response;
    });
    const input = {
      ...update(),
      action,
      transport: 'A4HK900002',
      ...(action === 'create' ? { package: 'ZTEAM', expectedSourceHash: undefined } : {}),
      ...(action === 'edit_method' ? { method: 'value', source: 'result = 2.' } : {}),
    };
    const result = await handlePinnedWrite(client(), input, config);
    expect(result.isError).toBe(true);
    expect(payload(result)).toMatchObject({
      error: 'PINNED_WRITE_INCOMPLETE',
      state: 'saved-inactive',
      sourceHash: sourceHash(source),
      phase: failure === 'close' ? 'session-close' : 'unlock',
      sessionClosed: failure === 'unlock',
      transport: 'A4HK900001',
      warnings: 'Saved-source lint warning',
      retryable: false,
    });
    expect(source).toContain('result = 2.');
    expect(saves()).toHaveLength(1);
    expect(requests.filter((r) => r.path.includes('_action=UNLOCK'))).toHaveLength(1);
    expect(requests.filter((r) => r.path.includes('/http/sessions'))).toHaveLength(1);
  });
  it.each(['update', 'edit_method'])(
    'retains selected parent but no confirmed hash/warnings after uncertain %s',
    async (action) => {
      pkg = 'ZTEAM';
      local = '';
      failSave = 503;
      vi.spyOn(writeHelpers, 'runPreWriteLint').mockReturnValue({ blocked: false, warnings: 'Not saved' });
      const result = payload(
        await handlePinnedWrite(
          client(),
          {
            ...update(),
            action,
            transport: 'A4HK900002',
            ...(action === 'edit_method' ? { method: 'value', source: 'result = 2.' } : {}),
          },
          config,
        ),
      );
      expect(result).toMatchObject({
        state: 'source-save-unknown',
        phase: 'source-save',
        transport: 'A4HK900001',
        retryable: false,
      });
      expect(result.sourceHash).toBeUndefined();
      expect(result.warnings).toBeUndefined();
      expect(source).toBe(initial);
      expect(saves()).toHaveLength(1);
    },
  );
  it('preserves a created stub when SAP rejects its source', async () => {
    failSave = 422;
    const result = payload(
      await handlePinnedWrite(
        client(),
        {
          action: 'create',
          type: 'INTF',
          name: 'ZIF_TEST',
          source: 'INTERFACE zif_test PUBLIC. ENDINTERFACE.',
          package: '$TMP',
        },
        config,
      ),
    );
    expect(result).toMatchObject({
      error: 'PINNED_WRITE_INCOMPLETE',
      state: 'created-source-rejected',
      statusCode: 422,
      retryable: false,
    });
  });
  it('normalizes long interior newline runs without changing their bytes', async () => {
    const large = replacement.replace('result = 2.', `${'\n'.repeat(50000)}result = 2.`);
    const result = payload(await handlePinnedWrite(client(), { ...update(), source: large }, config));
    expect(result).toMatchObject({ state: 'saved-inactive', sourceHash: sourceHash(large) });
  });
  it.each(['orphan', 'multiple', 'wrong-task', 'valid', 'released-task', 'released-task-lock'])(
    'validates every CTS lock holder: %s',
    async (mode) => {
      pkg = 'ZTEAM';
      local = '';
      const fallback = mockFetch.getMockImplementation()!;
      mockFetch.mockImplementation(async (url: unknown, options: any) => {
        if (String(url).includes('transportchecks')) {
          const headers = mode === 'orphan' ? '' : '<REQ_HEADER><TRKORR>A4HK900001</TRKORR></REQ_HEADER>';
          const extra =
            mode === 'multiple'
              ? '<LOCK_HOLDER><REQ_HEADER><TRKORR>A4HK900099</TRKORR></REQ_HEADER></LOCK_HOLDER>'
              : '';
          const task = mode === 'wrong-task' ? 'A4HK900099' : 'A4HK900002';
          return mockResponse(
            200,
            `<DATA><DEVCLASS>ZTEAM</DEVCLASS><DLVUNIT>HOME</DLVUNIT><OPERATION/><RESULT>S</RESULT><LOCKS><CTS_OBJECT_LOCK><LOCK_HOLDER>${headers}<TASK_HEADERS><CTS_TASK_HEADER><TRKORR>${task}</TRKORR></CTS_TASK_HEADER></TASK_HEADERS></LOCK_HOLDER>${extra}</CTS_OBJECT_LOCK></LOCKS></DATA>`,
          );
        }
        if (mode === 'released-task-lock' && String(url).includes('transportrequests/A4HK900002'))
          return mockResponse(
            200,
            '<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="A4HK900001" tm:type="K" tm:status="D"/><tm:task tm:number="A4HK900002" tm:parent="A4HK900001" tm:status="R"/></tm:root>',
          );
        if (mode.startsWith('released-task') && String(url).includes('transportrequests'))
          return mockResponse(
            200,
            '<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="A4HK900001" tm:type="K" tm:status="D"><tm:task tm:number="A4HK900002" tm:status="R"/></tm:request></tm:root>',
          );
        if (mode === 'released-task-lock' && String(url).includes('_action=LOCK'))
          return mockResponse(
            200,
            '<DATA><LOCK_HANDLE>lock-test</LOCK_HANDLE><CORRNR>A4HK900002</CORRNR><IS_LOCAL/></DATA>',
          );
        return fallback(url, options);
      });
      const result = await handlePinnedWrite(client(), { ...update(), transport: 'A4HK900001' }, config);
      expect(result.isError, result.content[0].text).toBe(
        ['valid', 'released-task', 'released-task-lock'].includes(mode) ? undefined : true,
      );
      expect(saves()).toHaveLength(['valid', 'released-task', 'released-task-lock'].includes(mode) ? 1 : 0);
      if (saves().length) expect(saves()[0].path).toContain('corrNr=A4HK900001');
    },
  );
  it('rejects a caller-selected released task even though lock evidence may contain it', async () => {
    const fallback = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation(async (url: unknown, options: any) => {
      if (String(url).includes('transportrequests'))
        return mockResponse(
          200,
          '<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="A4HK900001" tm:type="K" tm:status="D"><tm:task tm:number="A4HK900002" tm:status="R"/></tm:request></tm:root>',
        );
      return fallback(url, options);
    });
    const c = client();
    await expect(
      resolvePinnedRequest(c.http, c.safety, 'A4HK900002', {
        deadline: Date.now() + 300_000,
        noReplay: true,
        retryTransientErrors: false,
      }),
    ).rejects.toThrow('The selected task must be modifiable');
  });
  it.each([{ serverAllowedTransports: [] }, { serverAllowedTransports: ['A4HK999999'] }])(
    'independently enforces the server CTS write ceiling: %j',
    async ({ serverAllowedTransports }) => {
      pkg = 'ZTEAM';
      local = '';
      const c = client();
      c.safety.multiTargetWrite = { ...policy, serverAllowedTransports };
      const result = await handlePinnedWrite(c, { ...update(), transport: 'A4HK900001' }, config);
      expect(result.isError).toBe(serverAllowedTransports.length ? true : undefined);
      expect(saves()).toHaveLength(serverAllowedTransports.length ? 0 : 1);
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
