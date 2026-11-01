import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { mockFetch } from './setup-undici-mock.js';

const { AdtClient } = await import('../../../src/adt/client.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const owner = '/sap/bc/adt/oo/classes/zcl_include';
const original = '* Original include\n';
const replacement = '* Updated include\n';
const config = {
  ...DEFAULT_CONFIG,
  targetId: 'A4H/001',
  multiTargetEndpoints: true,
  allowWrites: true,
  ppEnabled: true,
  ppStrict: true,
  lintBeforeWrite: false,
  allowedPackages: ['$TMP', 'ZTEAM'],
  multiTargetWrite: {
    target: 'A4H/001',
    enabled: true,
    allowedPackages: ['$TMP', 'ZTEAM'],
    allowedTransports: ['A4HK900001'],
    serverAllowedTransports: ['A4HK900001'],
  },
};
let stored: string | undefined;
let absence: string;
let initFailure: number;
let putFailure: number;
let readbackMismatch: boolean;
let packageChange: boolean;
let recordingChange: boolean;
let unlockFailure: boolean;
let transportable: boolean;
let locked: boolean;
const requests: Array<{ path: string; method: string; body: string }> = [];
const typedAbsence =
  '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><type id="ExceptionResourceNotFound"/></exc:exception>';
beforeEach(() => {
  vi.resetAllMocks();
  stored = original;
  absence = typedAbsence;
  initFailure = 0;
  putFailure = 0;
  readbackMismatch = false;
  packageChange = false;
  recordingChange = false;
  unlockFailure = false;
  transportable = false;
  locked = false;
  requests.length = 0;
  mockFetch.mockImplementation(async (url: unknown, options: any = {}) => {
    const parsed = new URL(String(url));
    const method = options.method ?? 'GET';
    const body = String(options.body ?? '');
    requests.push({ path: parsed.pathname + parsed.search, method, body });
    const pkg = packageChange && locked ? 'ZFOREIGN' : transportable ? 'ZTEAM' : '$TMP';
    if (parsed.pathname.includes('transportchecks'))
      return mockResponse(
        200,
        `<DATA><DEVCLASS>${pkg}</DEVCLASS><DLVUNIT>${transportable ? 'HOME' : 'LOCAL'}</DLVUNIT><OPERATION></OPERATION><RESULT>S</RESULT><RECORDING>${transportable || (recordingChange && locked) ? 'X' : ''}</RECORDING></DATA>`,
      );
    if (parsed.pathname.includes('transportrequests'))
      return mockResponse(
        200,
        '<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="A4HK900001" tm:type="K" tm:status="D"><tm:task tm:number="A4HK900002" tm:status="D"/></tm:request></tm:root>',
      );
    if (parsed.searchParams.get('_action') === 'LOCK') {
      locked = true;
      return mockResponse(
        200,
        `<DATA><LOCK_HANDLE>class-lock</LOCK_HANDLE><CORRNR>${transportable ? 'A4HK900002' : ''}</CORRNR><IS_LOCAL>${transportable ? '' : 'X'}</IS_LOCAL></DATA>`,
        unlockFailure ? { 'set-cookie': 'sap-contextid=owned; Path=/' } : {},
      );
    }
    if (parsed.searchParams.get('_action') === 'UNLOCK') return mockResponse(unlockFailure ? 503 : 200, '');
    if (parsed.pathname.toLowerCase() === owner && method === 'GET')
      return mockResponse(
        200,
        `<class:abapClass xmlns:class="http://www.sap.com/adt/oo/classes" xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="${pkg}"/></class:abapClass>`,
      );
    if (parsed.pathname.toLowerCase().startsWith(`${owner}/includes/`)) {
      expect(locked).toBe(true);
      if (method === 'POST') {
        if (initFailure) return mockResponse(initFailure, '');
        stored = '';
        return mockResponse(201, '');
      }
      if (method === 'PUT') {
        if (putFailure) return mockResponse(putFailure, '');
        stored = readbackMismatch ? '* Another edit\n' : body;
        return mockResponse(200, '');
      }
      return stored === undefined ? mockResponse(404, absence) : mockResponse(200, stored);
    }
    return mockResponse(200, '', { 'x-csrf-token': 'test-token' });
  });
});
const args = (extra: Record<string, unknown> = {}) => ({
  action: 'update',
  type: 'CLAS',
  name: 'ZCL_INCLUDE',
  include: 'definitions',
  source: replacement,
  expectedSourceHash: sourceHash(original),
  ...extra,
});
async function invoke(extra: Record<string, unknown> = {}) {
  const client = new AdtClient({ baseUrl: 'http://sap:8000', safety: { ...defaultSafetyConfig(), ...config } });
  const result = await handleToolCall(client, config, 'SAPWrite', args(extra));
  const text = result.content[0].text;
  return { result, body: text.startsWith('{') ? JSON.parse(text) : { message: text } };
}
const includeWrites = () => requests.filter((r) => r.path.includes('/includes/') && ['POST', 'PUT'].includes(r.method));

describe('pinned class include handler and native lock policy', () => {
  it.each(['definitions', 'implementations', 'macros', 'testclasses'])(
    'saves %s with its own hash under the class lock',
    async (include) => {
      const { result, body } = await invoke({ include });
      expect(result.isError, result.content[0].text).toBeUndefined();
      expect(body).toMatchObject({
        state: 'saved-inactive',
        include,
        initialized: false,
        sourceHash: sourceHash(replacement),
      });
      expect(includeWrites()).toHaveLength(1);
      expect(includeWrites()[0].path).toContain(`/includes/${include}?lockHandle=class-lock`);
      expect(requests.filter((r) => r.path.includes('_action=LOCK'))[0].path).toContain(`${owner}?`);
      expect(requests.filter((r) => r.path.includes('_action=UNLOCK'))).toHaveLength(1);
      expect(requests.some((r) => r.path.includes('/source/main'))).toBe(false);
    },
  );

  it('clears an existing include only with the exact hash', async () => {
    const { body } = await invoke({ source: '' });
    expect(body).toMatchObject({ state: 'saved-inactive', sourceHash: sourceHash('') });
    expect(stored).toBe('');
  });

  it('preserves explicit empty include replacement through the shared single-target dispatch too', async () => {
    const legacy = {
      ...config,
      targetId: undefined,
      multiTargetEndpoints: false,
      multiTargetWrite: undefined,
      ppEnabled: false,
      ppStrict: false,
    };
    const client = new AdtClient({ baseUrl: 'http://sap:8000', safety: { ...defaultSafetyConfig(), ...legacy } });
    const result = await handleToolCall(client, legacy, 'SAPWrite', args({ source: '' }));
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(stored).toBe('');
    expect(includeWrites()).toHaveLength(1);
  });

  it.each([
    { source: '', expectedSourceHash: undefined },
    { source: ' \r\n\t', expectedSourceHash: undefined },
    { source: ' \r\n\t', expectedSourceHash: sourceHash(original) },
  ])('refuses ambiguous blank source without a single-target PUT: %j', async (input) => {
    const legacy = {
      ...config,
      targetId: undefined,
      multiTargetEndpoints: false,
      multiTargetWrite: undefined,
      ppEnabled: false,
      ppStrict: false,
    };
    const client = new AdtClient({ baseUrl: 'http://sap:8000', safety: { ...defaultSafetyConfig(), ...legacy } });
    const result = await handleToolCall(client, legacy, 'SAPWrite', args(input));
    expect(result.isError).toBe(true);
    expect(includeWrites()).toHaveLength(0);
    expect(stored).toBe(original);
  });

  it.each(['', ' \r\n\t'])(
    'never initializes an absent pinned include from blank source without a hash: %j',
    async (source) => {
      stored = undefined;
      const { result } = await invoke({ source, expectedSourceHash: undefined });
      expect(result.isError).toBe(true);
      expect(includeWrites()).toHaveLength(0);
      expect(stored).toBeUndefined();
    },
  );

  it.each([undefined, 'a'.repeat(64)])('refuses missing or stale include hashes: %s', async (expectedSourceHash) => {
    const { body } = await invoke({ expectedSourceHash });
    expect(body).toMatchObject({ state: 'unchanged', phase: 'include-read' });
    expect(includeWrites()).toHaveLength(0);
  });

  it.each([false, true])(
    'initializes a verified missing include with the parent request (transportable=%s)',
    async (cts) => {
      stored = undefined;
      transportable = cts;
      const { result, body } = await invoke({
        expectedSourceHash: undefined,
        ...(cts ? { transport: 'A4HK900002' } : {}),
      });
      expect(result.isError, result.content[0].text).toBeUndefined();
      expect(body).toMatchObject({ state: 'saved-inactive', initialized: true });
      expect(includeWrites().map((r) => r.method)).toEqual(['POST', 'PUT']);
      for (const request of includeWrites()) {
        const url = new URL(request.path, 'http://sap');
        expect(url.searchParams.get('lockHandle')).toBe('class-lock');
        expect(url.searchParams.get('corrNr')).toBe(cts ? 'A4HK900001' : null);
      }
    },
  );

  it.each([
    '<html>Missing service</html>',
    '<exc:exception><message>No suitable resource found</message></exc:exception>',
  ])('refuses untyped or service absence without initializing: %s', async (bodyText) => {
    stored = undefined;
    absence = bodyText;
    const { result } = await invoke({ expectedSourceHash: undefined });
    expect(result.isError).toBe(true);
    expect(includeWrites()).toHaveLength(0);
  });

  it('rechecks the class package before touching its include', async () => {
    packageChange = true;
    const { result, body } = await invoke();
    expect(result.isError).toBe(true);
    expect(body).toMatchObject({ state: 'unchanged', phase: 'locked-policy' });
    expect(requests.some((r) => r.path.includes('/includes/'))).toBe(false);
    expect(requests.filter((r) => r.path.includes('_action=UNLOCK'))).toHaveLength(1);
  });

  it('refuses recording drift under the lock before reading or writing an include', async () => {
    recordingChange = true;
    const { result } = await invoke();
    expect(result.isError).toBe(true);
    expect(requests.some((r) => r.path.includes('/includes/'))).toBe(false);
    expect(requests.filter((r) => r.path.includes('_action=UNLOCK'))).toHaveLength(1);
  });

  it.each([false, true])('retains saved include evidence when unlock fails (initialized=%s)', async (initialized) => {
    if (initialized) stored = undefined;
    unlockFailure = true;
    const { result, body } = await invoke(initialized ? { expectedSourceHash: undefined } : {});
    expect(result.isError).toBe(true);
    expect(body).toMatchObject({
      error: 'PINNED_WRITE_INCOMPLETE',
      state: 'saved-inactive',
      include: 'definitions',
      initialized,
      sourceHash: sourceHash(replacement),
      cleanupFailed: true,
      sessionClosed: true,
    });
    expect(includeWrites().map((r) => r.method)).toEqual(initialized ? ['POST', 'PUT'] : ['PUT']);
    expect(requests.filter((r) => r.path.includes('_action=UNLOCK'))).toHaveLength(1);
    expect(requests.some((r) => r.method === 'DELETE')).toBe(false);
  });

  it.each([400, 503])('retains the partial initialization if the source save fails with %s', async (status) => {
    stored = undefined;
    putFailure = status;
    const { body } = await invoke({ expectedSourceHash: undefined });
    expect(body).toMatchObject({
      error: 'PINNED_WRITE_INCOMPLETE',
      initialized: true,
      state: status === 400 ? 'created-include-source-rejected' : 'created-include-source-unknown',
    });
    expect(stored).toBe('');
    expect(includeWrites().map((r) => r.method)).toEqual(['POST', 'PUT']);
    expect(requests.some((r) => r.method === 'DELETE')).toBe(false);
  });

  it.each([400, 503])('does not replay or save after initialization fails with %s', async (status) => {
    stored = undefined;
    initFailure = status;
    const { body } = await invoke({ expectedSourceHash: undefined });
    expect(body.state).toBe(status === 400 ? 'include-initialization-rejected' : 'include-initialization-unknown');
    expect(body.initialized).toBeUndefined();
    expect(includeWrites().map((r) => r.method)).toEqual(['POST']);
  });

  it('does not claim a confirmed save when include readback differs', async () => {
    readbackMismatch = true;
    const { body } = await invoke();
    expect(body).toMatchObject({
      error: 'PINNED_WRITE_INCOMPLETE',
      state: 'source-save-unknown',
      phase: 'source-readback',
    });
    expect(body.sourceHash).toBeUndefined();
  });

  it.each([
    { type: 'INTF' },
    { action: 'create', package: '$TMP', expectedSourceHash: undefined },
    { action: 'delete', source: undefined, expectedSourceHash: undefined },
    { action: 'edit_method', method: 'VALUE' },
    { include: 'main' },
    { include: 'text_symbols' },
    { include: '../source/main' },
    { include: { nested: true } },
  ])('refuses unsupported selectors before SAP access: %j', async (extra) => {
    const { result } = await invoke(extra);
    expect(result.isError).toBe(true);
    expect(requests).toHaveLength(0);
  });
});
