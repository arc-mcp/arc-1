import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isIncludeSaveResult } from '../../../scripts/qualification/pr1142/include-qualification.mjs';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import { requestContext } from '../../../src/server/context.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { mockFetch } from './setup-undici-mock.js';

const { AdtClient } = await import('../../../src/adt/client.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { handlePinnedWrite } = await import('../../../src/handlers/write/pinned.js');
const quality = await import('../../../src/handlers/write-helpers.js');
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
let cancel: AbortController | undefined;
let cancelAfterInit: boolean;
const requests: Array<{ path: string; method: string; body: string }> = [];
const typedAbsence =
  '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><type id="ExceptionResourceNotFound"/></exc:exception>';
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  stored = original;
  cancel = undefined;
  cancelAfterInit = false;
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
        if (cancelAfterInit) cancel?.abort();
        return mockResponse(201, '');
      }
      if (method === 'PUT') {
        if (putFailure) return mockResponse(putFailure, '');
        stored = readbackMismatch ? '* Another edit\n' : body;
        return mockResponse(200, '');
      }
      if (!cancelAfterInit) cancel?.abort();
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
async function invoke(extra: Record<string, unknown> = {}, settings: ServerConfig = config) {
  const client = new AdtClient({ baseUrl: 'http://sap:8000', safety: { ...defaultSafetyConfig(), ...settings } });
  const result = await handleToolCall(client, settings, 'SAPWrite', args(extra));
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
      expect(body).not.toHaveProperty('ok');
      expect(
        isIncludeSaveResult(body, { target: config.targetId, name: 'ZCL_INCLUDE', include, initialized: false }),
      ).toBe(true);
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

  it.each(['update', 'edit_class_definition'])(
    'preserves explicit empty include replacement through single-target %s',
    async (action) => {
      const legacy = {
        ...config,
        targetId: undefined,
        multiTargetEndpoints: false,
        multiTargetWrite: undefined,
        ppEnabled: false,
        ppStrict: false,
      };
      const client = new AdtClient({ baseUrl: 'http://sap:8000', safety: { ...defaultSafetyConfig(), ...legacy } });
      const result = await handleToolCall(client, legacy, 'SAPWrite', args({ source: '', action }));
      expect(result.isError, result.content[0].text).toBeUndefined();
      expect(stored).toBe(action === 'update' ? '' : '\n');
      expect(includeWrites()).toHaveLength(1);
    },
  );

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
      expect(JSON.parse(result.content[0].text)).toMatchObject({ error: 'PINNED_WRITE_REFUSED', state: 'unchanged' });
      expect(includeWrites()).toHaveLength(0);
      expect(stored).toBeUndefined();
    },
  );

  it.each([
    { source: '', expectedSourceHash: undefined },
    { source: ' \r\n\t', expectedSourceHash: undefined },
    { source: ' \r\n\t', expectedSourceHash: sourceHash(original) },
  ])('the direct pinned adapter refuses blank input before SAP I/O: %j', async (input) => {
    const client = new AdtClient({ baseUrl: 'http://sap:8000', safety: { ...defaultSafetyConfig(), ...config } });
    const result = await handlePinnedWrite(client, args(input), config);
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({ error: 'PINNED_WRITE_REFUSED', state: 'unchanged' });
    expect(requests).toHaveLength(0);
  });

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
      expect(
        isIncludeSaveResult(body, {
          target: config.targetId,
          name: 'ZCL_INCLUDE',
          include: 'definitions',
          initialized: true,
        }),
      ).toBe(true);
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

  it.each(
    [false, true].flatMap((initialized) => ['unlock', 'close', 'both'].map((failure) => ({ initialized, failure }))),
  )('retains include and parent evidence on cleanup failure: %j', async ({ initialized, failure }) => {
    transportable = true;
    unlockFailure = failure !== 'close';
    if (initialized) stored = undefined;
    const fallback = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation(async (url: unknown, options: any) => {
      const response = await fallback(url, options);
      if (String(url).includes('_action=LOCK')) response.headers.set('set-cookie', 'sap-contextid=owned; Path=/');
      if (String(url).includes('/http/sessions') && failure !== 'unlock') return mockResponse(503, '');
      return response;
    });
    const { result, body } = await invoke({
      transport: 'A4HK900002',
      ...(initialized ? { expectedSourceHash: undefined } : {}),
    });
    expect(result.isError).toBe(true);
    expect(body).toMatchObject({
      state: 'saved-inactive',
      sourceHash: sourceHash(stored!),
      include: 'definitions',
      initialized,
      transport: 'A4HK900001',
      phase: failure === 'close' ? 'session-close' : 'unlock',
      sessionClosed: failure === 'unlock',
      retryable: false,
    });
    expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(1);
    expect(requests.filter((r) => r.path.includes('_action=UNLOCK'))).toHaveLength(1);
    expect(requests.filter((r) => r.path.includes('/http/sessions'))).toHaveLength(1);
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
    { action: 'edit_method_signature', method: 'VALUE' },
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

describe('shared whole-include definition replacement', () => {
  it.each(['definitions', 'implementations', 'macros', 'testclasses'])(
    'replaces and initializes %s through edit_class_definition',
    async (include) => {
      let outcome = await invoke({ action: 'edit_class_definition', include });
      expect(outcome.result.isError, outcome.result.content[0].text).toBeUndefined();
      expect(outcome.body).toMatchObject({
        action: 'edit_class_definition',
        include,
        initialized: false,
        state: 'saved-inactive',
        sourceHash: sourceHash(stored!),
      });
      stored = undefined;
      requests.length = 0;
      outcome = await invoke({ action: 'edit_class_definition', include, expectedSourceHash: undefined });
      expect(outcome.result.isError, outcome.result.content[0].text).toBeUndefined();
      expect(outcome.body).toMatchObject({
        initialized: true,
        state: 'saved-inactive',
        sourceHash: sourceHash(stored!),
      });
      expect(includeWrites().map((r) => r.method)).toEqual(['POST', 'PUT']);
      expect(requests.some((r) => r.path.includes('/source/main') || r.path.includes('/objectstructure'))).toBe(false);
    },
  );
  it('preserves the existing definition-action newline behavior when clearing a hashed include', async () => {
    const { result, body } = await invoke({ action: 'edit_class_definition', source: '' });
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(stored).toBe('\n');
    expect(body.sourceHash).toBe(sourceHash(stored!));
  });
  it.each([
    { expectedSourceHash: undefined },
    { expectedSourceHash: 'a'.repeat(64) },
    { source: '', expectedSourceHash: undefined },
    { source: '  ', expectedSourceHash: sourceHash(original) },
  ])('refuses unsafe replacement %j before any mutation', async (extra) => {
    const { result } = await invoke({ action: 'edit_class_definition', ...extra });
    expect(result.isError).toBe(true);
    expect(includeWrites()).toHaveLength(0);
  });
  it.each([400, 503])('retains initialized include state when the definition save fails with %s', async (status) => {
    stored = undefined;
    putFailure = status;
    const { result, body } = await invoke({ action: 'edit_class_definition', expectedSourceHash: undefined });
    expect(result.isError).toBe(true);
    expect(body).toMatchObject({
      initialized: true,
      state: status === 400 ? 'created-include-source-rejected' : 'created-include-source-unknown',
    });
    expect(body.sourceHash).toBeUndefined();
    expect(includeWrites().map((r) => r.method)).toEqual(['POST', 'PUT']);
  });
  it('classifies a rejected initialization without claiming a source save', async () => {
    stored = undefined;
    initFailure = 403;
    const { result, body } = await invoke({ action: 'edit_class_definition', expectedSourceHash: undefined });
    expect(result.isError).toBe(true);
    expect(body.state).toBe('include-initialization-rejected');
    expect(includeWrites().map((r) => r.method)).toEqual(['POST']);
  });
  it.each(['update', 'edit_class_definition'])(
    'skips fragment lint and syntax with global checks enabled for %s',
    async (action) => {
      const lint = vi.spyOn(quality, 'runPreWriteLint'),
        syntax = vi.spyOn(quality, 'runPreWriteSyntaxCheck');
      const { result } = await invoke({ action }, { ...config, lintBeforeWrite: true, checkBeforeWrite: true });
      expect(result.isError, result.content[0].text).toBeUndefined();
      expect(lint).not.toHaveBeenCalled();
      expect(syntax).not.toHaveBeenCalled();
    },
  );
  it('preserves confirmed replacement evidence on cleanup failure', async () => {
    unlockFailure = true;
    const { result, body } = await invoke({ action: 'edit_class_definition' });
    expect(result.isError).toBe(true);
    expect(body).toMatchObject({
      state: 'saved-inactive',
      sourceHash: sourceHash(stored!),
      initialized: false,
      cleanupFailed: true,
      sessionClosed: true,
    });
  });
});

for (const route of ['pinned', 'legacy']) {
  it.each([
    'METHOD lif_x~run.\nENDMETHOD. " pretty printer',
    'METHOD lif_x~run.\nENDMETHOD .',
    'METHOD lif_x~run. ENDMETHOD.',
  ])(`${route} refuses ambiguous formatted include bodies without PUT (%s)`, async (first) => {
    stored = `CLASS lcl_worker IMPLEMENTATION. " note\n${first}\nENDCLASS.\nCLASS lcl_neighbor IMPLEMENTATION.\nMETHOD lif_x~run.\nENDMETHOD.\nENDCLASS.`;
    const settings =
      route === 'pinned'
        ? config
        : {
            ...config,
            targetId: undefined,
            multiTargetWrite: undefined,
            multiTargetEndpoints: false,
            ppEnabled: false,
            ppStrict: false,
          };
    const { result } = await invoke(
      {
        action: 'edit_method',
        include: 'implementations',
        method: 'lif_x~run',
        source: 'RETURN.',
        expectedSourceHash: sourceHash(stored),
      },
      settings,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Ambiguous');
    expect(includeWrites()).toHaveLength(0);
  });
  it(`${route} refuses an include method replacement escaping its class`, async () => {
    stored = 'CLASS lcl_worker IMPLEMENTATION.\nMETHOD run.\nENDMETHOD.\nENDCLASS.';
    const settings =
      route === 'pinned'
        ? config
        : {
            ...config,
            targetId: undefined,
            multiTargetWrite: undefined,
            multiTargetEndpoints: false,
            ppEnabled: false,
            ppStrict: false,
          };
    const { result } = await invoke(
      {
        action: 'edit_method',
        include: 'implementations',
        method: 'lcl_worker~run',
        source: 'DATA(x) = 1.\nENDCLASS.\nCLASS lcl_foreign IMPLEMENTATION.',
        expectedSourceHash: sourceHash(stored),
      },
      settings,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Replacement must contain only');
    expect(includeWrites()).toHaveLength(0);
  });
}
it.each(['save', 'initialization'])('omits an unconfirmed recording on a transportable %s rejection', async (phase) => {
  transportable = true;
  if (phase === 'save') putFailure = 403;
  else {
    stored = undefined;
    initFailure = 403;
  }
  const { result, body } = await invoke({
    transport: 'A4HK900001',
    ...(phase === 'initialization' ? { expectedSourceHash: undefined } : {}),
  });
  expect(result.isError).toBe(true);
  expect(body.error).toBe('PINNED_WRITE_REFUSED');
  expect(body.transport).toBeUndefined();
});

it.each([true, false])(
  'honors cancellation before whole-include save/initialization (existing=%s)',
  async (existing) => {
    cancel = new AbortController();
    if (!existing) stored = undefined;
    const { result, body } = await requestContext.run({ requestId: 'include-cancel', signal: cancel.signal }, () =>
      invoke(existing ? {} : { expectedSourceHash: undefined }),
    );
    expect(result.isError).toBe(true);
    expect(body.state).toBe('unchanged');
    expect(includeWrites()).toHaveLength(0);
    expect(requests.some((r) => r.path.includes('UNLOCK'))).toBe(true);
  },
);

it('retains confirmed include creation when cancellation prevents its source PUT', async () => {
  cancel = new AbortController();
  cancelAfterInit = true;
  stored = undefined;
  const { result, body } = await requestContext.run({ requestId: 'include-init-cancel', signal: cancel.signal }, () =>
    invoke({ expectedSourceHash: undefined }),
  );
  expect(result.isError).toBe(true);
  expect(body).toMatchObject({ state: 'created-include-source-not-saved', initialized: true });
  expect(body.sourceHash).toBeUndefined();
  expect(includeWrites().map((request) => request.method)).toEqual(['POST']);
});
