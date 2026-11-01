import { beforeEach, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import { requestContext } from '../../../src/server/context.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const quality = await import('../../../src/handlers/write-helpers.js');
const config = {
  ...DEFAULT_CONFIG,
  client: '001',
  allowWrites: true,
  lintBeforeWrite: false,
  ppEnabled: true,
  ppStrict: true,
  multiTargetEndpoints: true,
  targetId: 'A4H/001',
  allowedPackages: ['$TMP'],
  multiTargetWrite: {
    enabled: true,
    target: 'A4H/001',
    allowedPackages: ['$TMP'],
    allowedTransports: [],
    serverAllowedTransports: [],
  },
};
const texts = {
  CLAS: 'CLASS zcl_new DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_new IMPLEMENTATION.\nENDCLASS.',
  INTF: 'INTERFACE zif_new PUBLIC.\nENDINTERFACE.',
};
let owner = '',
  collection = '',
  created = false,
  locked = false,
  saved = false,
  stored = '',
  fault = '';
let cancellation: AbortController | undefined;
const calls: { path: string; method: string; body: string; locked: boolean }[] = [];
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  created = false;
  locked = false;
  saved = false;
  stored = '* native template\n';
  fault = '';
  cancellation = undefined;
  calls.length = 0;
  mockFetch.mockImplementation(async (url, init: any = {}) => {
    const uri = new URL(String(url)),
      method = init.method ?? 'GET',
      path = uri.pathname.toLowerCase();
    calls.push({ path: path + uri.search, method, body: String(init.body ?? ''), locked });
    if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'token' });
    if (path.includes('transportchecks'))
      return mockResponse(
        200,
        `<DATA><DEVCLASS>$TMP</DEVCLASS><DLVUNIT>LOCAL</DLVUNIT><OPERATION>${String(init.body).includes('<OPERATION>I</OPERATION>') ? 'I' : ''}</OPERATION><RESULT>S</RESULT><RECORDING/></DATA>`,
      );
    if (path === collection && method === 'POST') {
      expect(created).toBe(false);
      if (fault === 'create-reject' || fault === 'create-unknown')
        return mockResponse(fault === 'create-reject' ? 403 : 503, '');
      created = true;
      if (fault === 'cancel-created') cancellation!.abort();
      return mockResponse(201, '<created/>');
    }
    if (uri.searchParams.get('_action') === 'LOCK') {
      expect(created).toBe(true);
      locked = true;
      return mockResponse(200, '<DATA><LOCK_HANDLE>new-lock</LOCK_HANDLE><CORRNR/><IS_LOCAL>X</IS_LOCAL></DATA>', {
        'set-cookie': 'sap-contextid=owned; Path=/',
      });
    }
    if (uri.searchParams.get('_action') === 'UNLOCK') {
      locked = false;
      return mockResponse(fault === 'unlock' ? 503 : 200, '');
    }
    if (path.includes('/http/sessions')) return mockResponse(200, '');
    if (path === owner) {
      expect(created).toBe(true);
      expect(locked).toBe(true);
      return mockResponse(
        200,
        `<root xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="${fault === 'package' ? 'ZFOREIGN' : '$TMP'}"/></root>`,
      );
    }
    if (path === `${owner}/source/main`) {
      expect(created).toBe(true);
      expect(locked).toBe(true);
      if (method === 'GET') {
        if (!saved && fault === 'cancel-read') cancellation!.abort();
        return mockResponse(fault === 'initial-read' || (saved && fault === 'readback') ? 503 : 200, stored);
      }
      expect(method).toBe('PUT');
      if (fault === 'save-reject' || fault === 'save-unknown')
        return mockResponse(fault === 'save-reject' ? 422 : 503, '');
      saved = true;
      stored = String(init.body);
      return mockResponse(200, '');
    }
    throw Error(`Unexpected ${method} ${path}`);
  });
});
async function invoke(type: keyof typeof texts = 'CLAS', extra: Record<string, unknown> = {}) {
  collection = `/sap/bc/adt/oo/${type === 'CLAS' ? 'classes' : 'interfaces'}`;
  const name = type === 'CLAS' ? 'ZCL_NEW' : 'ZIF_NEW';
  owner = `${collection}/${name.toLowerCase()}`;
  const result = await handleToolCall(
    new AdtClient({ baseUrl: 'http://sap:8000', client: '001', safety: { ...defaultSafetyConfig(), ...config } }),
    config,
    'SAPWrite',
    { action: 'create', type, name, package: ' $tmp ', source: texts[type], ...extra },
  );
  const text = result.content[0].text;
  return { result, body: text.startsWith('{') ? JSON.parse(text) : { message: text } };
}
it.each(['CLAS', 'INTF'] as const)(
  'creates %s through the shared handler and verifies its saved native source',
  async (type) => {
    const { result, body } = await invoke(type);
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(body).toMatchObject({ state: 'saved-inactive', sourceHash: sourceHash(texts[type]) });
    expect(stored).toBe(texts[type]);
    const post = calls.filter((c) => c.method === 'POST' && c.path.split('?')[0] === collection);
    expect(post).toHaveLength(1);
    expect(post[0]!.body).toContain('$TMP');
    expect(post[0]!.body).not.toContain('responsible=');
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'GET' && c.path.split('?')[0] === `${owner}/source/main`)).toHaveLength(2);
    expect(locked).toBe(false);
  },
);
it.each([
  ['create-reject', 'creation-rejected', false],
  ['create-unknown', 'creation-unknown', false],
  ['package', 'created-source-not-confirmed', true],
  ['initial-read', 'created-source-not-confirmed', true],
  ['save-reject', 'created-source-rejected', true],
  ['save-unknown', 'created-source-unknown', true],
  ['readback', 'created-source-unknown', true],
  ['unlock', 'saved-inactive', true],
] as const)('preserves the exact creation outcome on %s', async (failure, state, exists) => {
  fault = failure;
  const diagnostic = vi.spyOn(quality, 'tryPostSaveSyntaxCheck');
  const { result, body } = await invoke();
  expect(result.isError).toBe(true);
  expect(body.state).toBe(state);
  expect(created).toBe(exists);
  expect(diagnostic).not.toHaveBeenCalled();
  expect(calls.filter((c) => c.method === 'POST' && c.path.split('?')[0] === collection)).toHaveLength(1);
  expect(calls.filter((c) => c.method === 'PUT').length).toBeLessThanOrEqual(1);
  expect(body.sourceHash).toBe(state === 'saved-inactive' ? sourceHash(texts.CLAS) : undefined);
});
it.each(['cancel-created', 'cancel-read'])(
  'retains the created owner when %s prevents its source save',
  async (failure) => {
    fault = failure;
    cancellation = new AbortController();
    const { result, body } = await requestContext.run({ requestId: 'create-cancel', signal: cancellation.signal }, () =>
      invoke(),
    );
    expect(result.isError).toBe(true);
    expect(body.state).toBe('created-source-not-confirmed');
    expect(created).toBe(true);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    expect(body.sourceHash).toBeUndefined();
  },
);
it('runs pinned advisory syntax under the owning lock and retains its note only after confirmation', async () => {
  vi.spyOn(quality, 'runPreWriteSyntaxCheck').mockImplementation(async () => {
    expect(locked).toBe(true);
    expect(saved).toBe(false);
    return 'native syntax advisory';
  });
  const { result, body } = await invoke();
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(body.warnings).toBe('native syntax advisory');
});
it('blocks configured lint before creating a native shell', async () => {
  vi.spyOn(quality, 'runPreWriteLint').mockReturnValue({
    blocked: true,
    result: { isError: true, content: [{ type: 'text', text: 'lint refusal' }] },
  });
  const { result, body } = await invoke();
  expect(result.isError).toBe(true);
  expect(body.state).toBe('unchanged');
  expect(created).toBe(false);
  expect(calls.some((c) => (c.method === 'POST' && !c.path.includes('transportchecks')) || c.method === 'PUT')).toBe(
    false,
  );
});
