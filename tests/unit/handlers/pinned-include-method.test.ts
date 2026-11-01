import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const unexpected: string[] = [];
beforeEach(() => {
  unexpected.length = 0;
});
afterEach(() => expect(unexpected).toEqual([]));

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const quality = await import('../../../src/handlers/write-helpers.js');
const owner = '/sap/bc/adt/oo/classes/zcl_include';
const includes = ['definitions', 'implementations', 'macros', 'testclasses'];
const config = {
  ...DEFAULT_CONFIG,
  targetId: 'A4H/001',
  multiTargetEndpoints: true,
  allowWrites: true,
  ppEnabled: true,
  ppStrict: true,
  allowedPackages: ['$TMP'],
  lintBeforeWrite: true,
  checkBeforeWrite: true,
  multiTargetWrite: {
    target: 'A4H/001',
    enabled: true,
    allowedPackages: ['$TMP'],
    allowedTransports: [],
    serverAllowedTransports: [],
  },
};
// Authored source with two local owners sharing a method name. The qualified selector must
// preserve both the other method in its class and the other class's entire implementation.
const source = (local: string) => `CLASS ${local} IMPLEMENTATION.
 METHOD run.
 DATA(value) = 1.
 ENDMETHOD.
 METHOD untouched.
 DATA(value) = 99.
 ENDMETHOD.
ENDCLASS.
CLASS lcl_neighbor IMPLEMENTATION.
 METHOD run.
 DATA(value) = 88.
 ENDMETHOD.
ENDCLASS.\n`;
interface Faults {
  missing?: boolean;
  packageDrift?: boolean;
  recordingDrift?: boolean;
  putStatus?: number;
  readbackStatus?: number;
  readbackMismatch?: boolean;
  unlockFailure?: boolean;
  closeFailure?: boolean;
}
function backend(local = 'lcl_worker', faults: Faults = {}, initial = source(local)) {
  const originals = new Map(includes.map((kind) => [kind, initial]));
  const stored = new Map(originals);
  const requests: { path: string; method: string; locked: boolean; headers: Record<string, string> }[] = [];
  let locked = false,
    saved = false;
  mockFetch.mockImplementation(async (url: unknown, init: any = {}) => {
    const uri = new URL(String(url)),
      path = uri.pathname,
      method = init.method ?? 'GET';
    requests.push({ path: path + uri.search, method, locked, headers: init.headers ?? {} });
    if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'token' });
    if (uri.searchParams.get('_action') === 'LOCK') {
      if (path !== owner) unexpected.push(`Wrong lock owner: ${path}`);
      locked = true;
      return mockResponse(200, '<DATA><LOCK_HANDLE>owner-lock</LOCK_HANDLE><IS_LOCAL>X</IS_LOCAL></DATA>', {
        'set-cookie': 'sap-contextid=owned; Path=/',
      });
    }
    if (uri.searchParams.get('_action') === 'UNLOCK') {
      if (path !== owner) unexpected.push(`Wrong lock owner: ${path}`);
      locked = false;
      return mockResponse(faults.unlockFailure ? 503 : 200, '');
    }
    if (path.includes('/http/sessions')) return mockResponse(faults.closeFailure ? 503 : 200, '');
    if (path === owner && method === 'GET')
      return mockResponse(
        200,
        `<class:abapClass xmlns:class="http://www.sap.com/adt/oo/classes" xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="${faults.packageDrift && locked ? 'ZFOREIGN' : '$TMP'}"/></class:abapClass>`,
      );
    if (path.includes('transportchecks'))
      return mockResponse(
        200,
        `<DATA><DEVCLASS>$TMP</DEVCLASS><DLVUNIT>LOCAL</DLVUNIT><OPERATION/><RESULT>S</RESULT><RECORDING>${faults.recordingDrift && locked ? 'X' : ''}</RECORDING></DATA>`,
      );
    const kind = includes.find((value) => path === `${owner}/includes/${value}`);
    if (kind) {
      if (!locked) unexpected.push(`Unlocked include access: ${method} ${path}`);
      if (method === 'PUT') {
        if (uri.searchParams.get('lockHandle') !== 'owner-lock') unexpected.push('Wrong include lock handle');
        if (faults.putStatus) return mockResponse(faults.putStatus, 'refused');
        stored.set(
          kind,
          String(init.body)
            .replace(/\r?\n/g, '\r\n')
            .replace(/[\r\n]+$/, ''),
        );
        saved = true;
        return mockResponse(200, '');
      }
      if (method !== 'GET') unexpected.push(`Unexpected include mutation: ${method}`); // No include initialization or delete fallback.
      if (faults.missing)
        return mockResponse(
          404,
          '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><type id="ExceptionResourceNotFound"/></exc:exception>',
        );
      if (saved && faults.readbackStatus) return mockResponse(faults.readbackStatus, 'unavailable');
      return mockResponse(200, saved && faults.readbackMismatch ? 'foreign source' : stored.get(kind)!);
    }
    unexpected.push(`${method} ${path}`);
    return mockResponse(599, 'Unexpected fixture request');
  });
  return { originals, stored, requests };
}
async function invoke(extra: Record<string, unknown> = {}, selectedConfig = config) {
  const args = {
    action: 'edit_method',
    type: 'CLAS',
    name: 'ZCL_INCLUDE',
    method: 'lcl_worker~run',
    source: ' DATA(value) = 2.',
    expectedSourceHash: sourceHash(source('lcl_worker')),
    ...extra,
  };
  const result = await handleToolCall(
    new AdtClient({ baseUrl: 'http://sap:8000', safety: { ...defaultSafetyConfig(), ...selectedConfig } }),
    selectedConfig,
    'SAPWrite',
    args,
  );
  const text = result.content[0].text;
  return { result, body: text.startsWith('{') ? JSON.parse(text) : { message: text } };
}
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

it.each(includes)('edits an explicitly selected %s under the owner lock and preserves neighbors', async (include) => {
  const state = backend();
  const lint = vi.spyOn(quality, 'runPreWriteLint');
  const syntax = vi.spyOn(quality, 'runPreWriteSyntaxCheck');
  const { result, body } = await invoke({ include });
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(body).toMatchObject({
    action: 'edit_method',
    state: 'saved-inactive',
    include,
    sourceHash: sourceHash(state.stored.get(include)!),
  });
  const changed = state.stored.get(include)!.replace(/\r\n/g, '\n');
  expect(changed).toBe(source('lcl_worker').replace('DATA(value) = 1.', 'DATA(value) = 2.').trimEnd());
  for (const other of includes.filter((kind) => kind !== include))
    expect(state.stored.get(other)).toBe(state.originals.get(other));
  expect(state.requests.filter((r) => r.method === 'PUT')).toHaveLength(1);
  expect(
    state.requests
      .filter((r) => r.path.includes('/includes/'))
      .every((r) => r.path.startsWith(`${owner}/includes/${include}`)),
  ).toBe(true);
  expect(state.requests.filter((r) => r.path.includes('_action=UNLOCK'))).toHaveLength(1);
  expect(state.requests.filter((r) => r.path.includes('/http/sessions'))).toHaveLength(1);
  expect(lint).not.toHaveBeenCalled();
  expect(syntax).not.toHaveBeenCalled();
});

it.each([
  ['lhc_worker', 'implementations'],
  ['lcl_worker', 'implementations'],
  ['ltc_worker', 'testclasses'],
])('infers %s into %s and reports the selected hash resource', async (local, include) => {
  const state = backend(local);
  const { result, body } = await invoke({ method: ` ${local}~run `, expectedSourceHash: sourceHash(source(local)) });
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(body).toMatchObject({ include, sourceHash: sourceHash(state.stored.get(include)!) });
  expect(state.requests.find((r) => r.method === 'PUT')?.path).toContain(`${owner}/includes/${include}?`);
});
it('lets an explicit include override prefix inference', async () => {
  const state = backend('ltc_worker');
  const { result, body } = await invoke({
    method: 'ltc_worker~run',
    include: 'implementations',
    expectedSourceHash: sourceHash(source('ltc_worker')),
  });
  expect(result.isError).toBeUndefined();
  expect(body.include).toBe('implementations');
  expect(state.stored.get('testclasses')).toBe(state.originals.get('testclasses'));
});
it.each([{ expectedSourceHash: '0'.repeat(64) }, { method: 'run' }, { source: 'METHOD other. ENDMETHOD.' }])(
  'refuses stale or ambiguous edits without changing any include: %j',
  async (changes) => {
    const state = backend();
    const { result, body } = await invoke({ include: 'implementations', ...changes });
    expect(result.isError).toBe(true);
    expect(body.state).toBe('unchanged');
    expect(body.phase).toBe(changes.expectedSourceHash ? 'source-read' : 'edit-preparation');
    expect(body.message).toMatch(changes.expectedSourceHash ? /expectedSourceHash/ : /method|qualified|ambiguous/i);
    expect(state.requests.filter((r) => r.method === 'PUT')).toHaveLength(0);
    expect(state.stored).toEqual(state.originals);
    expect(state.requests.filter((r) => r.path.includes('_action=UNLOCK'))).toHaveLength(1);
  },
);
it.each([{ expectedSourceHash: undefined }, { include: 'text_symbols' }, { type: 'INTF' }])(
  'refuses unadmitted input before SAP: %j',
  async (extra) => {
    backend();
    expect((await invoke(extra)).result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  },
);
it.each(['missing', 'packageDrift', 'recordingDrift'] as const)(
  'refuses %s without initializing or saving',
  async (fault) => {
    const state = backend('lcl_worker', { [fault]: true });
    const { result, body } = await invoke();
    expect(result.isError).toBe(true);
    expect(body.state).toBe('unchanged');
    expect(body.phase).toBe(fault === 'missing' ? 'source-read' : 'locked-policy');
    if (fault === 'missing') expect(body.message).toMatch(/Include.*does not exist/);
    else expect(body.message).toMatch(fault === 'packageDrift' ? /package/i : /transport|recording|local/i);
    expect(
      state.requests.filter((r) => r.method === 'PUT' || (r.path.includes('/includes/') && r.method !== 'GET')),
    ).toHaveLength(0);
    expect(state.stored).toEqual(state.originals);
  },
);
it.each([{ putStatus: 503 }, { readbackStatus: 503 }, { readbackMismatch: true }])(
  'reports uncertain saves without replay or a confirmed hash: %j',
  async (faults) => {
    const state = backend('lcl_worker', faults);
    const { result, body } = await invoke();
    expect(result.isError).toBe(true);
    expect(body).toMatchObject({ state: 'source-save-unknown', include: 'implementations', retryable: false });
    expect(body.sourceHash).toBeUndefined();
    expect(state.requests.filter((r) => r.method === 'PUT')).toHaveLength(1);
    expect(state.requests.filter((r) => r.path.includes('_action=UNLOCK'))).toHaveLength(1);
  },
);
it.each([{ unlockFailure: true }, { closeFailure: true }])(
  'retains the selected source evidence after cleanup failure: %j',
  async (faults) => {
    const state = backend('lcl_worker', faults);
    const { result, body } = await invoke();
    expect(result.isError).toBe(true);
    expect(body).toMatchObject({
      state: 'saved-inactive',
      include: 'implementations',
      sourceHash: sourceHash(state.stored.get('implementations')!),
      retryable: false,
    });
    expect(state.requests.filter((r) => r.method === 'PUT')).toHaveLength(1);
    expect(state.requests.filter((r) => r.path.includes('/http/sessions'))).toHaveLength(1);
  },
);

it('refuses a present include without the selected method, without initializing it', async () => {
  const state = backend();
  state.stored.set('implementations', '* Empty existing include\n');
  const { result, body } = await invoke({ expectedSourceHash: sourceHash(state.stored.get('implementations')!) });
  expect(result.isError).toBe(true);
  expect(body.state).toBe('unchanged');
  expect(state.stored.get('implementations')).toBe('* Empty existing include\n');
  expect(state.requests.filter((r) => r.path.includes('/includes/') && r.method !== 'GET')).toHaveLength(0);
  expect(state.requests.filter((r) => r.path.includes('_action=UNLOCK'))).toHaveLength(1);
});

it('refuses an ambiguous interface-qualified include method before saving', async () => {
  const initial = source('lcl_worker').replaceAll('METHOD run.', 'METHOD lif_x~run.');
  const state = backend('lcl_worker', {}, initial);
  const { result } = await invoke({
    include: 'implementations',
    method: 'lif_x~run',
    expectedSourceHash: sourceHash(initial),
  });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain('Ambiguous');
  expect(result.content[0].text).toContain('lcl_worker~lif_x~run');
  expect(state.requests.some((r) => r.method === 'PUT')).toBe(false);
  expect(state.requests.some((r) => r.path.includes('_action=UNLOCK'))).toBe(true);
});
it('edits a doubly qualified include method without changing the other class', async () => {
  const initial = source('lcl_worker').replaceAll('METHOD run.', 'METHOD lif_x~run.');
  const state = backend('lcl_worker', {}, initial);
  const { result, body } = await invoke({
    include: 'implementations',
    method: 'lcl_neighbor~lif_x~run',
    expectedSourceHash: sourceHash(initial),
  });
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(body.state).toBe('saved-inactive');
  expect(state.stored.get('implementations')!.replaceAll('\r\n', '\n')).toBe(
    initial.replace('DATA(value) = 88.', 'DATA(value) = 2.').trimEnd(),
  );
});
