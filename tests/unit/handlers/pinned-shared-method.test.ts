import { beforeEach, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const writeHelpers = await import('../../../src/handlers/write-helpers.js');
const { requestContext } = await import('../../../src/server/context.js');
const owner = '/sap/bc/adt/oo/classes/zcl_test';
const initial = `CLASS zcl_test DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 METHODS value RETURNING VALUE(result) TYPE i.
 METHODS other RETURNING VALUE(result) TYPE i.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
 METHOD value.
 result = 1.
 ENDMETHOD.
 METHOD other.
 result = 99.
 ENDMETHOD.
ENDCLASS.\n`;
const body = 'METHOD value.\n result = 2.\nENDMETHOD.';
const policy = {
  target: 'A4H/001',
  enabled: true,
  allowedPackages: ['$TMP'],
  allowedTransports: [],
  serverAllowedTransports: [],
};
const config = {
  ...DEFAULT_CONFIG,
  targetId: 'A4H/001',
  multiTargetEndpoints: true,
  multiTargetWrite: policy,
  allowWrites: true,
  allowedPackages: ['$TMP'],
  ppEnabled: true,
  ppStrict: true,
  lintBeforeWrite: false,
};
const args = {
  action: 'edit_method',
  type: 'CLAS',
  name: 'ZCL_TEST',
  method: 'value',
  source: body,
  expectedSourceHash: sourceHash(initial),
};
interface Options {
  packageDrift?: boolean;
  recordingDrift?: boolean;
  saveStatus?: number;
  networkFailure?: boolean;
  readbackMismatch?: boolean;
  readbackStatus?: number;
  unlockFailure?: boolean;
  closeFailure?: boolean;
  controller?: AbortController;
}
function backend(options: Options = {}) {
  const state = {
    source: initial,
    locked: false,
    packages: 0,
    recordings: 0,
    sourceReads: 0,
    puts: 0,
    unlocks: 0,
    closes: 0,
    requests: [] as {
      method: string;
      path: string;
      body: string;
      headers: Record<string, string>;
      locked: boolean;
      aborted?: boolean;
    }[],
  };
  mockFetch.mockImplementation(async (url: unknown, init: any = {}) => {
    const parsed = new URL(String(url)),
      method = init.method ?? 'GET';
    state.requests.push({
      method,
      path: parsed.pathname + parsed.search,
      body: String(init.body ?? ''),
      headers: init.headers ?? {},
      locked: state.locked,
      aborted: init.signal?.aborted,
    });
    if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'T' });
    if (parsed.pathname === '/sap/bc/adt/checkruns')
      return mockResponse(
        200,
        '<chkrun:checkRunReports xmlns:chkrun="http://www.sap.com/adt/checkrun"><chkrun:checkReport chkrun:reporter="abapCheckRun" chkrun:status="processed"><chkrun:checkMessage chkrun:type="W" chkrun:shortText="Native syntax warning" chkrun:uri="/sap/bc/adt/oo/classes/zcl_test/source/main#start=8,1"/></chkrun:checkReport></chkrun:checkRunReports>',
      );
    if (parsed.pathname.includes('/http/sessions')) {
      state.closes++;
      return mockResponse(options.closeFailure ? 503 : 200, '');
    }
    if (parsed.searchParams.get('_action') === 'LOCK') {
      state.locked = true;
      return mockResponse(200, '<DATA><LOCK_HANDLE>owned</LOCK_HANDLE><IS_LOCAL>X</IS_LOCAL></DATA>', {
        'set-cookie': 'sap-contextid=owned-session; Path=/',
      });
    }
    if (parsed.searchParams.get('_action') === 'UNLOCK') {
      state.unlocks++;
      if (!options.unlockFailure) state.locked = false;
      return mockResponse(options.unlockFailure ? 503 : 200, '');
    }
    if (method === 'GET' && parsed.pathname.toLowerCase() === owner) {
      state.packages++;
      return mockResponse(
        200,
        `<class:abapClass xmlns:class="http://www.sap.com/adt/oo/classes" xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="${options.packageDrift && state.packages > 1 ? 'ZFOREIGN' : '$TMP'}"/></class:abapClass>`,
      );
    }
    if (parsed.pathname.includes('transportchecks')) {
      state.recordings++;
      return mockResponse(
        200,
        `<DATA><DEVCLASS>$TMP</DEVCLASS><DLVUNIT>${options.recordingDrift && state.recordings > 1 ? 'HOME' : 'LOCAL'}</DLVUNIT><OPERATION/><RESULT>S</RESULT><RECORDING/></DATA>`,
      );
    }
    if (parsed.pathname.toLowerCase() === `${owner}/source/main`) {
      if (method === 'PUT') {
        state.puts++;
        if (options.networkFailure) throw new TypeError('fetch failed');
        if (options.saveStatus) return mockResponse(options.saveStatus, 'refused');
        state.source = String(init.body)
          .replace(/\r?\n/g, '\r\n')
          .replace(/[\r\n]+$/, '');
        return mockResponse(200, '');
      }
      state.sourceReads++;
      if (options.controller && state.sourceReads === 1) options.controller.abort();
      if (state.sourceReads > 1 && options.readbackStatus) return mockResponse(options.readbackStatus, 'unavailable');
      return mockResponse(
        200,
        state.sourceReads > 1 && options.readbackMismatch
          ? state.source.replace('result = 2.', 'result = 3.')
          : state.source,
      );
    }
    throw new Error(`Unexpected ${method} ${parsed.pathname}`);
  });
  return state;
}
const call = (changes: Record<string, unknown> = {}, overrides: Partial<ServerConfig> = {}) => {
  const effective = { ...config, ...overrides };
  return handleToolCall(
    new AdtClient({ baseUrl: 'http://sap:8000', safety: { ...defaultSafetyConfig(), ...effective } }),
    effective,
    'SAPWrite',
    { ...args, ...changes },
  );
};
const payload = (result: Awaited<ReturnType<typeof call>>) => JSON.parse(result.content[0].text);
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

it('uses one locked shared edit and returns the native normalized source hash', async () => {
  const state = backend();
  const result = await call();
  expect(result.isError).toBeUndefined();
  expect(payload(result)).toMatchObject({
    action: 'edit_method',
    state: 'saved-inactive',
    sourceHash: sourceHash(state.source),
  });
  expect(state.source).toContain('result = 2.');
  expect(state.source).toContain('result = 99.');
  expect(state.puts).toBe(1);
  expect(state.unlocks).toBe(1);
  expect(state.closes).toBe(1);
  const sourceRequests = state.requests.filter((r) => r.path.startsWith(`${owner}/source/main`));
  expect(sourceRequests).toHaveLength(3);
  expect(sourceRequests.every((r) => r.locked && r.headers['X-sap-adt-sessiontype'] === 'stateful')).toBe(true);
  expect(sourceRequests.filter((r) => r.method === 'GET').every((r) => r.headers['Cache-Control'] === 'no-cache')).toBe(
    true,
  );
});
it.each([
  { expectedSourceHash: undefined },
  { expectedSourceHash: 'bad' },
  { method: '' },
  { include: 'main' },
  { include: 'text_symbols' },
  { action: 'add_method' },
])('refuses unsupported or incomplete input before SAP: %j', async (changes) => {
  backend();
  expect((await call(changes)).isError).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
});
it.each(['packageDrift', 'recordingDrift'] as const)('rechecks %s under the lock', async (mode) => {
  const state = backend({ [mode]: true });
  const result = await call();
  expect(payload(result)).toMatchObject({ state: 'unchanged', phase: 'locked-policy' });
  expect(state.puts).toBe(0);
  expect(state.sourceReads).toBe(0);
  expect(state.unlocks).toBe(1);
  expect(state.closes).toBe(1);
});
it.each([{ expectedSourceHash: '0'.repeat(64) }, { source: 'METHOD other. ENDMETHOD.' }])(
  'preserves the locked source on stale or mismatched input %j',
  async (changes) => {
    const state = backend();
    expect((await call(changes)).isError).toBe(true);
    expect(state.puts).toBe(0);
    expect(state.source).toBe(initial);
    expect(state.unlocks).toBe(1);
    expect(state.closes).toBe(1);
  },
);
it('cancels the save but closes the owning session with independent cleanup', async () => {
  const controller = new AbortController(),
    state = backend({ controller });
  const result = await requestContext.run({ requestId: 'method-cancel', signal: controller.signal }, () => call());
  expect(payload(result).state).toBe('unchanged');
  expect(state.puts).toBe(0);
  expect(state.unlocks).toBe(1);
  expect(state.closes).toBe(1);
  const cleanup = state.requests.filter((r) => r.path.includes('_action=UNLOCK') || r.path.includes('/http/sessions'));
  expect(cleanup).toHaveLength(2);
  expect(cleanup.every((r) => r.aborted !== true)).toBe(true);
});
it.each([403, 422, 429, 503])('does not replay a method save returning %s, even when unlock fails', async (status) => {
  const state = backend({ saveStatus: status, unlockFailure: true });
  expect(payload(await call())).toMatchObject({
    state: status < 429 ? 'source-save-rejected' : 'source-save-unknown',
    phase: 'source-save',
    statusCode: status,
    cleanupFailed: true,
    sessionClosed: true,
    retryable: false,
  });
  expect(state.puts).toBe(1);
  expect(state.unlocks).toBe(1);
  expect(state.closes).toBe(1);
});
it('retains an unknown outcome after a submitted request rejects', async () => {
  const state = backend({ networkFailure: true });
  expect(payload(await call())).toMatchObject({ state: 'source-save-unknown', phase: 'source-save', retryable: false });
  expect(state.puts).toBe(1);
  expect(state.unlocks).toBe(1);
  expect(state.closes).toBe(1);
});
it.each([{ readbackMismatch: true }, { readbackStatus: 503 }])(
  'does not confirm a save whose read-back fails: %j',
  async (options) => {
    const state = backend(options),
      result = payload(await call());
    expect(result).toMatchObject({ state: 'source-save-unknown', phase: 'source-readback' });
    expect(result.sourceHash).toBeUndefined();
    expect(state.puts).toBe(1);
    expect(state.sourceReads).toBe(2);
    expect(state.unlocks).toBe(1);
    expect(state.closes).toBe(1);
  },
);
it.each([{ unlockFailure: true }, { closeFailure: true }])(
  'keeps a verified save visible when cleanup fails: %j',
  async (options) => {
    const state = backend(options),
      result = await call();
    expect(result.isError).toBe(true);
    expect(payload(result)).toMatchObject({
      state: 'saved-inactive',
      sourceHash: sourceHash(state.source),
      phase: options.unlockFailure ? 'unlock' : 'session-close',
      sessionClosed: !options.closeFailure,
    });
    expect(state.puts).toBe(1);
    expect(state.unlocks).toBe(1);
    expect(state.closes).toBe(1);
  },
);

it.each(['METHOD value.\n result = .\nENDMETHOD.', 'result = 2'])(
  'blocks a real lint error on the spliced class without a source save: %s',
  async (source) => {
    const state = backend();
    const result = await call({ source }, { lintBeforeWrite: true });
    expect(result.isError).toBe(true);
    expect(payload(result)).toMatchObject({ state: 'unchanged', phase: 'edit-preparation' });
    expect(payload(result).message).toContain('Pre-write lint check failed');
    expect(payload(result).message).toContain('parser_error');
    expect(state.puts).toBe(0);
    expect(state.source).toBe(initial);
    expect(state.unlocks).toBe(1);
    expect(state.closes).toBe(1);
  },
);

it.each([{}, { unlockFailure: true }, { closeFailure: true }])(
  'retains lint and native syntax warnings with a verified save: %j',
  async (options) => {
    const state = backend(options);
    const lint = vi
      .spyOn(writeHelpers, 'runPreWriteLint')
      .mockReturnValue({ blocked: false, warnings: 'Lint warning fixture' });
    const result = await call({}, { lintBeforeWrite: true, checkBeforeWrite: true });
    expect(result.isError).toBe(Object.keys(options).length ? true : undefined);
    const parsed = payload(result);
    expect(parsed).toMatchObject({ state: 'saved-inactive', sourceHash: sourceHash(state.source) });
    expect(parsed.warnings).toContain('Lint warning fixture');
    expect(parsed.warnings).toContain('Native syntax warning');
    expect(lint).toHaveBeenCalledOnce();
    const lintSource = lint.mock.calls[0]![0];
    expect(lintSource).toContain('result = 2.');
    expect(lintSource).toContain('result = 99.');
    const checks = state.requests.filter((request) => request.path.startsWith('/sap/bc/adt/checkruns'));
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ method: 'POST', locked: true });
    expect(checks[0]!.headers['X-sap-adt-sessiontype']).toBe('stateful');
    expect(checks[0]!.body).toContain(Buffer.from(lintSource).toString('base64'));
    expect(state.requests.indexOf(checks[0]!)).toBeLessThan(state.requests.findIndex((r) => r.method === 'PUT'));
    expect(state.puts).toBe(1);
    expect(state.unlocks).toBe(1);
    expect(state.closes).toBe(1);
  },
);

it('saves a valid spliced class with real lint enabled', async () => {
  const state = backend();
  const result = await call({}, { lintBeforeWrite: true });
  expect(result.isError).toBeUndefined();
  expect(payload(result)).toMatchObject({ state: 'saved-inactive', sourceHash: sourceHash(state.source) });
  expect(state.source).toContain('result = 2.');
  expect(state.source).toContain('result = 99.');
  expect(state.puts).toBe(1);
  expect(state.unlocks).toBe(1);
  expect(state.closes).toBe(1);
});

it.each([
  'program = sy-repid.',
  "class = 'ZCL_X'.",
  "function = 'Z_FM'.",
  'interface ?= ref.',
  'CLASS zcl DEFINITION LOAD.',
])('both write profiles preserve valid keyword-named statements: %s', async (statement) => {
  for (const pinned of [false, true]) {
    const state = backend();
    state.source = initial.replace('result = 1.', statement);
    const result = await call(
      { source: `${statement}\nresult = 2.`, expectedSourceHash: sourceHash(state.source) },
      pinned ? {} : { multiTargetWrite: undefined, multiTargetEndpoints: false, targetId: undefined },
    );
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(state.puts).toBe(1);
    expect(state.source).toContain(statement);
    expect(state.source).toContain('result = 99.');
    expect(state.requests.filter((r) => r.method === 'PUT').every((r) => r.locked)).toBe(true);
  }
});
