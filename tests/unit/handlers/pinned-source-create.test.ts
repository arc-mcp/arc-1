import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import { requestContext } from '../../../src/server/context.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';
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
  PROG: "REPORT zprog_new.\nWRITE 'created'.",
  INCL: '* New independent include.\n',
};
let owner = '',
  collection = '',
  created = false,
  locked = false,
  saved = false,
  stored = '',
  fault = '';
let cancellation: AbortController | undefined;
let transportable = false;
const calls: { path: string; method: string; body: string; locked: boolean; created: boolean }[] = [];
const unexpected: string[] = [];
afterEach(() => expect(unexpected).toEqual([]));
beforeEach(() => {
  unexpected.length = 0;
  vi.restoreAllMocks();
  vi.resetAllMocks();
  created = false;
  locked = false;
  saved = false;
  stored = '* native template\n';
  fault = '';
  transportable = false;
  cancellation = undefined;
  calls.length = 0;
  mockFetch.mockImplementation(async (url, init: any = {}) => {
    const uri = new URL(String(url)),
      method = init.method ?? 'GET',
      path = uri.pathname.toLowerCase();
    calls.push({ path: path + uri.search, method, body: String(init.body ?? ''), locked, created });
    if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'token' });
    if (path.includes('transportchecks'))
      return mockResponse(
        200,
        `<DATA><DEVCLASS>${transportable ? 'ZTEAM' : '$TMP'}</DEVCLASS><DLVUNIT>${transportable ? 'HOME' : 'LOCAL'}</DLVUNIT><OPERATION>${String(init.body).includes('<OPERATION>I</OPERATION>') ? 'I' : ''}</OPERATION><RESULT>S</RESULT><RECORDING>${transportable || (fault === 'recording-drift' && locked) ? 'X' : ''}</RECORDING></DATA>`,
      );
    if (path.includes('transportrequests'))
      return mockResponse(
        200,
        '<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="A4HK900001" tm:type="K" tm:status="D"/></tm:root>',
      );
    if (path.includes('/checkruns'))
      return mockResponse(200, '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"/>');
    if (path === collection && method === 'POST') {
      if (fault === 'create-reject' || fault === 'create-unknown')
        return mockResponse(fault === 'create-reject' ? 403 : 503, '');
      created = true;
      if (fault === 'cancel-created') cancellation!.abort();
      return mockResponse(201, '<created/>');
    }
    if (uri.searchParams.get('_action') === 'LOCK') {
      locked = true;
      return mockResponse(
        200,
        `<DATA><LOCK_HANDLE>new-lock</LOCK_HANDLE><CORRNR>${transportable ? 'A4HK900001' : ''}</CORRNR><IS_LOCAL>${transportable ? '' : 'X'}</IS_LOCAL></DATA>`,
        {
          'set-cookie': 'sap-contextid=owned; Path=/',
        },
      );
    }
    if (uri.searchParams.get('_action') === 'UNLOCK') {
      locked = false;
      return mockResponse(fault === 'unlock' ? 503 : 200, '');
    }
    if (path.includes('/http/sessions')) return mockResponse(200, '');
    if (path === owner) {
      const root = collection.endsWith('/programs')
        ? 'program:abapProgram'
        : collection.endsWith('/includes')
          ? 'include:abapInclude'
          : 'root';
      return mockResponse(
        200,
        `<${root} xmlns:program="http://www.sap.com/adt/programs/programs" xmlns:include="http://www.sap.com/adt/programs/includes" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${owner.split('/').at(-1)!.toUpperCase()}" adtcore:type="${fault === 'owner-identity' ? 'FUGR/I' : `PROG/${root === 'include:abapInclude' ? 'I' : 'P'}`}" program:programType="executableProgram"><adtcore:packageRef adtcore:type="DEVC/K" adtcore:name="${fault === 'package' ? 'ZFOREIGN' : transportable ? 'ZTEAM' : '$TMP'}"/></${root}>`,
      );
    }
    if (path === `${owner}/source/main`) {
      if (method === 'GET') {
        if (!saved && fault === 'cancel-read') cancellation!.abort();
        return mockResponse(fault === 'initial-read' || (saved && fault === 'readback') ? 503 : 200, stored);
      }
      if (fault === 'save-reject' || fault === 'save-unknown')
        return mockResponse(fault === 'save-reject' ? 422 : 503, '');
      saved = true;
      stored = String(init.body);
      return mockResponse(200, '');
    }
    unexpected.push(`${method} ${path}`);
    return mockResponse(599, 'Unexpected test request');
  });
});
async function invoke(
  type: keyof typeof texts = 'CLAS',
  extra: Record<string, unknown> = {},
  settings: ServerConfig = config,
) {
  collection =
    '/sap/bc/adt/' +
    { CLAS: 'oo/classes', INTF: 'oo/interfaces', PROG: 'programs/programs', INCL: 'programs/includes' }[type];
  const name = { CLAS: 'ZCL_NEW', INTF: 'ZIF_NEW', PROG: 'ZPROG_NEW', INCL: 'ZINCL_NEW' }[type];
  owner = `${collection}/${name.toLowerCase()}`;
  const result = await handleToolCall(
    new AdtClient({ baseUrl: 'http://sap:8000', client: '001', safety: { ...defaultSafetyConfig(), ...settings } }),
    settings,
    'SAPWrite',
    { action: 'create', type, name, package: ' $tmp ', source: texts[type], ...extra },
  );
  const sourceCalls = calls.filter((c) => c.path.split('?')[0] === `${owner}/source/main`);
  expect(sourceCalls.every((c) => c.created && c.locked && ['GET', 'PUT'].includes(c.method))).toBe(true);
  expect(sourceCalls.filter((c) => c.method === 'PUT').every((c) => c.path.includes('lockHandle=new-lock'))).toBe(true);
  expect(
    calls.filter((c) => c.path.split('?')[0] === owner && c.method === 'GET').every((c) => c.created && c.locked),
  ).toBe(true);
  expect(calls.filter((c) => c.path.includes('_action=LOCK')).every((c) => c.created)).toBe(true);
  expect(calls.filter((c) => c.path.split('?')[0] === collection && c.method === 'POST').every((c) => !c.created)).toBe(
    true,
  );
  const text = result.content[0].text;
  return { result, body: text.startsWith('{') ? JSON.parse(text) : { message: text } };
}
it.each(['CLAS', 'INTF', 'PROG', 'INCL'] as const)(
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
    expect(calls.filter((c) => c.method === 'GET' && c.path.split('?')[0] === owner)).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'GET' && c.path.split('?')[0] === `${owner}/source/main`)).toHaveLength(2);
    expect(locked).toBe(false);
  },
);
it.each(
  (
    [
      ['create-reject', 'creation-rejected', false],
      ['create-unknown', 'creation-unknown', false],
      ['package', 'created-source-not-confirmed', true],
      ['initial-read', 'created-source-not-confirmed', true],
      ['save-reject', 'created-source-rejected', true],
      ['save-unknown', 'created-source-unknown', true],
      ['readback', 'created-source-unknown', true],
      ['unlock', 'saved-inactive', true],
    ] as const
  ).flatMap((row) => (['CLAS', 'PROG', 'INCL'] as const).map((kind) => [kind, ...row] as const)),
)('preserves %s creation outcome on %s', async (kind, failure, state, exists) => {
  fault = failure;
  const diagnostic = vi.spyOn(quality, 'tryPostSaveSyntaxCheck');
  const { result, body } = await invoke(kind);
  expect(result.isError).toBe(true);
  expect(body.state).toBe(state);
  const expected = {
    'create-reject': ['create', 403],
    'create-unknown': ['create', 503],
    package: ['locked-policy', undefined],
    'initial-read': ['source-read', 503],
    'save-reject': ['source-save', 422],
    'save-unknown': ['source-save', 503],
    readback: ['source-readback', 503],
    unlock: ['unlock', undefined],
  }[failure];
  expect(body.phase).toBe(expected[0]);
  if (failure === 'package') expect(body.message).toMatch(/package/i);
  expect(body.statusCode).toBe(expected[1]);
  expect(created).toBe(exists);
  expect(diagnostic).not.toHaveBeenCalled();
  expect(calls.filter((c) => c.method === 'POST' && c.path.split('?')[0] === collection)).toHaveLength(1);
  expect(calls.filter((c) => c.method === 'PUT').length).toBeLessThanOrEqual(1);
  expect(body.sourceHash).toBe(state === 'saved-inactive' ? sourceHash(texts[kind]) : undefined);
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
    expect(body.phase).toBe(failure === 'cancel-created' ? 'lock' : 'edit-preparation');
    expect(body.statusCode).toBeUndefined();
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

it('refuses recording drift under the new owner lock before source PUT', async () => {
  fault = 'recording-drift';
  const { result, body } = await invoke();
  expect(result.isError).toBe(true);
  expect(body).toMatchObject({ state: 'created-source-not-confirmed', phase: 'locked-policy' });
  expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
});
it('cancels before creation without a native request', async () => {
  cancellation = new AbortController();
  cancellation.abort();
  const { result, body } = await requestContext.run({ requestId: 'create-before', signal: cancellation.signal }, () =>
    invoke(),
  );
  expect(result.isError).toBe(true);
  expect(body.state).toBe('unchanged');
  expect(calls).toHaveLength(0);
});
it.each(['CLAS', 'PROG', 'INCL'] as const)('uses the verified request on native %s creation and save', async (kind) => {
  transportable = true;
  const settings = {
    ...config,
    allowedPackages: ['ZTEAM'],
    multiTargetWrite: {
      ...config.multiTargetWrite,
      allowedPackages: ['ZTEAM'],
      allowedTransports: ['A4HK900001'],
      serverAllowedTransports: ['A4HK900001'],
    },
  };
  const { result } = await invoke(kind, { package: 'ZTEAM', transport: 'A4HK900001' }, settings);
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(calls.find((c) => c.method === 'POST' && c.path.split('?')[0] === collection)?.path).toContain(
    'corrNr=A4HK900001',
  );
  expect(calls.find((c) => c.method === 'PUT')?.path).toContain('corrNr=A4HK900001');
});
it.each([false, true])('runs actual configured lint before shell creation (invalid=%s)', async (invalid) => {
  const { result, body } = await invoke('CLAS', invalid ? { source: 'CLASS zcl_new DEFINITION. nonsense !!!' } : {}, {
    ...config,
    lintBeforeWrite: true,
  });
  expect(!!result.isError).toBe(invalid);
  expect(created).toBe(!invalid);
  if (invalid) {
    expect(body.state).toBe('unchanged');
    expect(body.message).toMatch(/lint/i);
  }
});
it('runs the actual inline SAP syntax request under the new owner lock', async () => {
  const { result } = await invoke('CLAS', {}, { ...config, checkBeforeWrite: true });
  expect(result.isError, result.content[0].text).toBeUndefined();
  const checks = calls.filter((c) => c.path.includes('/checkruns'));
  expect(checks).toHaveLength(1);
  expect(checks[0]).toMatchObject({ locked: true, created: true, method: 'POST' });
  expect(checks[0]!.body).toContain(Buffer.from(texts.CLAS).toString('base64'));
  expect(calls.indexOf(checks[0]!)).toBeLessThan(calls.findIndex((c) => c.method === 'PUT'));
});

it.each(['PROG', 'INCL'] as const)('requires native %s identity under its newly created owner lock', async (kind) => {
  fault = 'owner-identity';
  const { result, body } = await invoke(kind);
  expect(result.isError).toBe(true);
  expect(body).toMatchObject({ state: 'created-source-not-confirmed', phase: 'locked-policy' });
  expect(body.message).toContain('standalone native PROG/INCL');
  expect(calls.filter((c) => c.method === 'GET' && c.path.split('?')[0] === owner)).toHaveLength(1);
  expect(calls.find((c) => c.method === 'GET' && c.path.split('?')[0] === owner)).toMatchObject({
    created: true,
    locked: true,
  });
  expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  expect(calls.filter((c) => c.path.includes('_action=UNLOCK'))).toHaveLength(1);
});
