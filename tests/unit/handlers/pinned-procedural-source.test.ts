import { beforeEach, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import { requestContext } from '../../../src/server/context.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const quality = await import('../../../src/handlers/write-helpers.js');
const original =
  "FORM selected.\n  WRITE 'old'.\nENDFORM.\nFORM neighbor.\nENDFORM.\nMODULE status OUTPUT.\n  SET PF-STATUS 'OLD'.\nENDMODULE.";
const replacement = "FORM selected.\n  WRITE 'new'.\nENDFORM.";
const config: ServerConfig = {
  ...DEFAULT_CONFIG,
  client: '001',
  targetId: 'A4H/001',
  multiTargetEndpoints: true,
  allowWrites: true,
  ppEnabled: true,
  ppStrict: true,
  lintBeforeWrite: false,
  allowedPackages: ['$TMP'],
  multiTargetWrite: {
    enabled: true,
    target: 'A4H/001',
    allowedPackages: ['$TMP'],
    allowedTransports: [],
    serverAllowedTransports: [],
  },
};
let stored = original,
  owner = '',
  locked = false,
  saved = false,
  fault = '',
  transportable = false;
let cancellation: AbortController | undefined;
const requests: { path: string; method: string; locked: boolean; body: string }[] = [];
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  stored = original;
  locked = false;
  saved = false;
  fault = '';
  cancellation = undefined;
  transportable = false;
  requests.length = 0;
  mockFetch.mockImplementation(async (url, init: any = {}) => {
    const uri = new URL(String(url)),
      path = uri.pathname.toLowerCase(),
      method = init.method ?? 'GET';
    requests.push({ path: path + uri.search, method, locked, body: String(init.body ?? '') });
    if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'token' });
    if (uri.searchParams.get('_action') === 'LOCK') {
      expect(path).toBe(owner);
      locked = true;
      return mockResponse(
        200,
        `<DATA><LOCK_HANDLE>program-lock</LOCK_HANDLE><CORRNR>${transportable ? 'A4HK900002' : ''}</CORRNR><IS_LOCAL>${transportable ? '' : 'X'}</IS_LOCAL></DATA>`,
        { 'set-cookie': 'sap-contextid=owned; Path=/' },
      );
    }
    if (uri.searchParams.get('_action') === 'UNLOCK') {
      expect(path).toBe(owner);
      locked = false;
      return mockResponse(fault === 'unlock' ? 503 : 200, '');
    }
    if (path.includes('/http/sessions')) return mockResponse(fault === 'close' ? 503 : 200, '');
    if (path === owner && method === 'GET') {
      const include = owner.includes('/includes/');
      const activeFault = !fault.endsWith('-locked') || locked ? fault.replace(/-locked$/, '') : '';
      const root = include && activeFault !== 'owner-root' ? 'abapInclude' : 'abapProgram';
      const name = activeFault === 'owner-name' ? 'ZOTHER' : decodeURIComponent(owner.split('/').at(-1)!).toUpperCase();
      const nativeType = activeFault === 'owner-type' ? 'FUGR/I' : `PROG/${include ? 'I' : 'P'}`;
      const pkg =
        activeFault === 'owner-package'
          ? ''
          : `<adtcore:packageRef adtcore:type="DEVC/K" adtcore:name="${fault === 'package' && locked ? 'ZFOREIGN' : transportable ? 'ZTEAM' : '$TMP'}"/>`;
      const context =
        activeFault === 'owner-group'
          ? '<adtcore:contextRef adtcore:type="FUGR/I" adtcore:name="SAPLZFOO" adtcore:uri="/sap/bc/adt/functions/groups/zfoo/source/main"/>'
          : activeFault === 'owner-container'
            ? '<adtcore:containerRef adtcore:type="FUGR/F"/>'
            : '';
      return mockResponse(
        200,
        `<program:${root} xmlns:program="http://www.sap.com/adt/programs/${include ? 'includes' : 'programs'}" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${name}" adtcore:type="${nativeType}" ${include ? '' : `program:programType="${activeFault === 'owner-kind' ? 'functionPool' : 'executableProgram'}"`}>${pkg}${context}</program:${root}>`,
      );
    }
    if (path.includes('transportchecks'))
      return mockResponse(
        200,
        `<DATA><DEVCLASS>${transportable ? 'ZTEAM' : '$TMP'}</DEVCLASS><DLVUNIT>${transportable ? 'HOME' : 'LOCAL'}</DLVUNIT><OPERATION/><RESULT>S</RESULT><RECORDING>${transportable || (fault === 'recording' && locked) ? 'X' : ''}</RECORDING></DATA>`,
      );
    if (path.includes('transportrequests'))
      return mockResponse(
        200,
        '<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="A4HK900001" tm:type="K" tm:status="D"><tm:task tm:number="A4HK900002" tm:status="D"/></tm:request></tm:root>',
      );
    if (path === `${owner}/source/main`) {
      if (method === 'GET' && fault === 'cancel-read') cancellation!.abort();
      if (method === 'GET')
        return mockResponse(
          fault === 'read' || (saved && fault === 'readback-status') ? 503 : 200,
          saved && fault === 'readback-mismatch' ? 'foreign source' : stored,
        );
      expect(method).toBe('PUT');
      expect(uri.searchParams.get('lockHandle')).toBe('program-lock');
      if (fault === 'save') return mockResponse(503, 'unavailable');
      stored = String(init.body);
      saved = true;
      return mockResponse(200, '');
    }
    throw Error(`Unexpected request ${method} ${path}`);
  });
});
async function invoke(type = 'PROG', action = 'edit_unit', extra: Record<string, unknown> = {}, settings = config) {
  const name = typeof extra.name === 'string' ? extra.name : 'ZARC1_PROGRAM';
  owner = `/sap/bc/adt/programs/${type === 'PROG' ? 'programs' : 'includes'}/${encodeURIComponent(name.toLowerCase()).toLowerCase()}`;
  const requestStart = requests.length;
  const result = await handleToolCall(
    new AdtClient({ baseUrl: 'http://sap:8000', client: '001', safety: { ...defaultSafetyConfig(), ...settings } }),
    settings,
    'SAPWrite',
    {
      action,
      type,
      name,
      source: replacement,
      ...(action === 'update' ? {} : { unit: 'selected' }),
      expectedSourceHash: sourceHash(original),
      ...extra,
    },
  );
  expect(
    requests
      .slice(requestStart)
      .filter((r) => r.path.split('?')[0] === `${owner}/source/main`)
      .every((r) => r.locked),
  ).toBe(true);
  const text = result.content[0].text;
  return { result, body: text.startsWith('{') ? JSON.parse(text) : { message: text } };
}
it.each(['PROG', 'INCL'])(
  '%s updates and FORM/MODULE edits share the owning lock and exact read-back',
  async (type) => {
    for (const [action, extra, expected] of [
      ['update', { source: original.replace("'old'", "'whole'") }, original.replace("'old'", "'whole'")],
      ['edit_unit', {}, original.replace("'old'", "'new'")],
      [
        'edit_unit',
        { unit: 'status', source: "MODULE status OUTPUT.\n  SET PF-STATUS 'NEW'.\nENDMODULE." },
        original.replace("'OLD'", "'NEW'"),
      ],
      ['add_unit', { unit: 'added', source: 'FORM added.\nENDFORM.' }, `${original}\nFORM added.\nENDFORM.\n`],
    ] as const) {
      stored = original;
      saved = false;
      requests.length = 0;
      const { result, body } = await invoke(type, action, extra);
      expect(result.isError, result.content[0].text).toBeUndefined();
      expect(stored).toBe(expected);
      expect(body).toMatchObject({ state: 'saved-inactive', sourceHash: sourceHash(expected), type, action });
      expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(1);
      expect(
        requests.filter((r) => r.path.split('?')[0] === `${owner}/source/main` && r.method === 'GET'),
      ).toHaveLength(2);
      expect(requests.some((r) => r.path.includes('UNLOCK'))).toBe(true);
      expect(requests.some((r) => r.path.includes('/http/sessions'))).toBe(true);
      expect(locked).toBe(false);
    }
  },
);
it.each(['PROG', 'INCL'])('%s refuses stale source and malformed/foreign input without a save', async (type) => {
  for (const extra of [
    { expectedSourceHash: 'f'.repeat(64) },
    { unit: 'missing' },
    { source: 'FORM foreign.\nENDFORM.' },
    { source: 'FORM selected.\nENDFORM.\nFORM injected.\nENDFORM.' },
  ]) {
    requests.length = 0;
    const { result, body } = await invoke(type, 'edit_unit', extra);
    expect(result.isError).toBe(true);
    expect(body.state).toBe('unchanged');
    expect(body.sourceHash).toBeUndefined();
    expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(0);
    expect(locked).toBe(false);
  }
});
it.each([
  { expectedSourceHash: undefined },
  { expectedSourceHash: 'bad' },
  { unit: '' },
  { source: '' },
  { group: 'ZFOREIGN' },
  { include: 'definitions' },
  { url: '/sap/other' },
  { name: 'Z/../FOREIGN' },
  { name: 'Z'.repeat(41) },
])('refuses unqualified procedural input before native calls (%j)', async (extra) => {
  expect((await invoke('INCL', 'edit_unit', extra)).result.isError).toBe(true);
  expect(requests).toHaveLength(0);
});
it.each(['package', 'recording', 'read'])(
  'refuses %s failure before any source save and closes its own session',
  async (failure) => {
    fault = failure;
    const { result, body } = await invoke();
    expect(result.isError).toBe(true);
    expect(body.state).toBe('unchanged');
    expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(0);
    expect(locked).toBe(false);
    expect(requests.some((r) => r.path.includes('/http/sessions'))).toBe(true);
  },
);
it.each(['save', 'readback-status', 'readback-mismatch'])(
  'does not replay %s or claim an exact successful save',
  async (failure) => {
    fault = failure;
    const { result, body } = await invoke();
    expect(result.isError).toBe(true);
    expect(body.state).toBe('source-save-unknown');
    expect(body.sourceHash).toBeUndefined();
    expect(body.warnings).toBeUndefined();
    expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(1);
    expect(locked).toBe(false);
  },
);
it.each(['unlock', 'close'])('retains confirmed saved content when %s cleanup fails', async (failure) => {
  fault = failure;
  const { result, body } = await invoke();
  expect(result.isError).toBe(true);
  expect(body).toMatchObject({ state: 'saved-inactive', sourceHash: sourceHash(stored) });
  expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(1);
});
it('uses the proven Workbench parent request when the lock returns a task', async () => {
  transportable = true;
  const settings = {
    ...config,
    allowedPackages: ['ZTEAM'],
    multiTargetWrite: {
      ...config.multiTargetWrite!,
      allowedPackages: ['ZTEAM'],
      allowedTransports: ['A4HK900001'],
      serverAllowedTransports: ['A4HK900001'],
    },
  };
  const { result, body } = await invoke('INCL', 'edit_unit', { transport: 'A4HK900001' }, settings);
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(body.transport).toBe('A4HK900001');
  expect(new URL(requests.find((r) => r.method === 'PUT')!.path, 'http://sap').searchParams.get('corrNr')).toBe(
    'A4HK900001',
  );
});
it('runs configured syntax checks under the owner lock and retains advisory warnings only after read-back', async () => {
  vi.spyOn(quality, 'runPreWriteSyntaxCheck').mockImplementation(async () => {
    expect(locked).toBe(true);
    expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(0);
    return 'advisory syntax note';
  });
  const { body } = await invoke(
    'PROG',
    'update',
    { source: original.replace("'old'", "'whole'") },
    { ...config, checkBeforeWrite: true },
  );
  expect(body).toMatchObject({ state: 'saved-inactive', warnings: 'advisory syntax note' });
});
it('refuses shared-line procedural edits without modifying neighboring source', async () => {
  stored = 'FORM selected. ENDFORM. FORM neighbor. ENDFORM.';
  const { result, body } = await invoke('PROG', 'edit_unit', { expectedSourceHash: sourceHash(stored) });
  expect(result.isError).toBe(true);
  expect(JSON.stringify(body)).toContain('shares a boundary line');
  expect(body.state).toBe('unchanged');
  expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(0);
});
it('accepts existing namespaced program identifiers up to the native 40-character field envelope', async () => {
  const name = `/ARC1/${'Z'.repeat(34)}`;
  const { result } = await invoke('INCL', 'edit_unit', { name });
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(requests.filter((r) => r.method === 'PUT')[0]?.path).toContain(
    encodeURIComponent(name.toLowerCase()).toLowerCase(),
  );
});

it.each(['update', 'edit_unit', 'add_unit'])(
  'refuses classic %s on a BTP target before native work',
  async (action) => {
    const { result } = await invoke('PROG', action, {}, { ...config, systemType: 'btp' });
    expect(result.isError).toBe(true);
    expect(requests).toHaveLength(0);
  },
);

it.each(['LZFOOF01', '/NS/LZFOOF01', 'SAPLZFOO', '/NS/SAPLZFOO'])(
  'refuses generated/function-group source names before SAP: %s',
  async (name) => {
    for (const type of ['PROG', 'INCL']) {
      const { result } = await invoke(type, 'edit_unit', { name });
      expect(result.isError).toBe(true);
      expect(requests).toHaveLength(0);
    }
  },
);
it.each(['owner-root', 'owner-name', 'owner-type', 'owner-package', 'owner-group', 'owner-container'])(
  'requires positive native INCL identity and ownership: %s',
  async (failure) => {
    fault = failure;
    const { result } = await invoke('INCL');
    expect(result.isError).toBe(true);
    expect(requests.some((r) => r.path.includes('_action=LOCK') || r.method === 'PUT')).toBe(false);
  },
);
it('refuses a non-procedural native program kind', async () => {
  fault = 'owner-kind';
  expect((await invoke()).result.isError).toBe(true);
  expect(requests.some((r) => r.path.includes('_action=LOCK') || r.method === 'PUT')).toBe(false);
});
it.each(['owner-type-locked', 'owner-name-locked', 'owner-group-locked'])(
  'rechecks native source ownership under the lock: %s',
  async (failure) => {
    fault = failure;
    expect((await invoke('INCL')).result.isError).toBe(true);
    expect(requests.some((r) => r.method === 'PUT')).toBe(false);
    expect(requests.some((r) => r.path.includes('_action=UNLOCK'))).toBe(true);
    expect(locked).toBe(false);
  },
);
it.each(['edit_unit', 'add_unit'])(
  'runs actual configured lint under the lock before %s can save invalid ABAP',
  async (action) => {
    const lint = quality.runPreWriteLint;
    const lintLocks: boolean[] = [];
    vi.spyOn(quality, 'runPreWriteLint').mockImplementation((...args) => {
      lintLocks.push(locked);
      return lint(...args);
    });
    const unit = action === 'add_unit' ? 'added' : 'selected';
    const { result } = await invoke(
      'PROG',
      action,
      { unit, source: `FORM ${unit}.\nTHIS IS NOT VALID ABAP.\nENDFORM.` },
      { ...config, lintBeforeWrite: true },
    );
    expect(result.isError).toBe(true);
    expect(lintLocks).toEqual([true]);
    expect(requests.some((r) => r.method === 'PUT')).toBe(false);
    expect(locked).toBe(false);
  },
);
it.each(['before', 'read'])(
  'cancels procedural edits at %s without a PUT and releases any owning lock',
  async (point) => {
    cancellation = new AbortController();
    if (point === 'before') cancellation.abort();
    else fault = 'cancel-read';
    const { result } = await requestContext.run({ requestId: 'procedural-cancel', signal: cancellation.signal }, () =>
      invoke(),
    );
    expect(result.isError).toBe(true);
    expect(requests.some((r) => r.method === 'PUT')).toBe(false);
    if (point === 'before') expect(requests).toHaveLength(0);
    else expect(requests.some((r) => r.path.includes('_action=UNLOCK'))).toBe(true);
    expect(locked).toBe(false);
  },
);
it('edits using the exact hash returned by SAPRead editable', async () => {
  owner = '/sap/bc/adt/programs/programs/zarc1_program';
  const client = new AdtClient({
    baseUrl: 'http://sap:8000',
    client: '001',
    safety: { ...defaultSafetyConfig(), ...config },
  });
  const read = await handleToolCall(client, config, 'SAPRead', {
    type: 'PROG',
    name: 'ZARC1_PROGRAM',
    format: 'editable',
  });
  expect(read.isError, read.content[0].text).toBeUndefined();
  const snapshot = JSON.parse(read.content[0].text);
  expect(snapshot.source).toBe(original);
  const { result } = await invoke('PROG', 'edit_unit', { expectedSourceHash: snapshot.sourceHash });
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(stored).toBe(original.replace("'old'", "'new'"));
});
