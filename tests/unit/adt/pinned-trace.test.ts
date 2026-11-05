import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AdtApiError, AdtNetworkError } from '../../../src/adt/errors.js';
import type { AdtHttpClient, AdtRequestOptions, AdtResponse } from '../../../src/adt/http.js';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import {
  cancelPinnedProfilerTrace,
  parsePinnedSqlTrace,
  parsePinnedTraceCancel,
  parsePinnedTraceStart,
  setPinnedSqlTraceState,
  startPinnedProfilerTrace,
} from '../../../src/adt/pinned-trace.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';

const BASE = '/sap/bc/adt/runtime/traces/abaptraces';
const CLIENT = '001';
const ST05 = '/sap/bc/adt/st05/trace/state';
const ST05_TYPE = 'application/vnd.sap.adt.perf.trace.state.v1+xml';
const stateXml = readFileSync(new URL('../../fixtures/xml/st05-trace-state.xml', import.meta.url), 'utf8');

const policy = {
  enabled: true,
  target: 'A4H/001',
  allowedPackages: ['$TMP'],
  allowedTransports: [],
  serverAllowedTransports: [],
};
const safety = { ...defaultSafetyConfig(), allowWrites: true, multiTargetWrite: policy };

function context(signal?: AbortSignal, deadline = Date.now() + 60_000) {
  return pinnedMutationContext(safety, { deadline, signal }, { unlockFailed: false });
}

const requestId = (host = 'vhcala4hci_A4H_00%2c1%2c20260625093701') => `${BASE}/requests/${host}`;

/** Synthetic role-bearing feed; the June 758 research does not prove these author roles. TRC-1 must. */
function feed(
  entries: Array<
    Partial<Record<'id' | 'admin' | 'trace' | 'client' | 'process' | 'object' | 'expires', string>> & { max?: string }
  >,
): string {
  const body = entries
    .map((entry) => {
      const expires = entry.expires ?? new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d+Z$/, 'Z');
      return `<atom:entry xml:lang="EN"><atom:author trc:role="admin" xmlns:trc="http://www.sap.com/adt/runtime/traces/abaptraces"><atom:name>${entry.admin ?? 'MARIAN'}</atom:name></atom:author><atom:author trc:role="trace" xmlns:trc="http://www.sap.com/adt/runtime/traces/abaptraces"><atom:name>${entry.trace ?? 'MARIAN'}</atom:name></atom:author><atom:content type="application/atom+xml" src="${entry.id ?? requestId()}"/><atom:id>${entry.id ?? requestId()}</atom:id><atom:title>fixture</atom:title><trc:extendedData xmlns:trc="http://www.sap.com/adt/runtime/traces/abaptraces"><trc:host>vhcala4hci</trc:host><trc:client trc:role="admin">${entry.client ?? CLIENT}</trc:client><trc:client trc:role="trace">${entry.client ?? CLIENT}</trc:client><trc:description>fixture</trc:description><trc:expires>${expires}</trc:expires><trc:processType trc:processTypeId="${BASE}/processtypes/${entry.process ?? 'http'}"/><trc:object trc:objectTypeId="${BASE}/objecttypes/${entry.object ?? 'url'}"/><trc:executions trc:maximal="${entry.max ?? '1'}" trc:completed="0"/></trc:extendedData></atom:entry>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?><atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:title>ABAP Trace Requests A4H</atom:title>${body}</atom:feed>`;
}

function response(body = '', headers: Record<string, string> = {}): AdtResponse {
  return { statusCode: 200, headers, body };
}

interface Call {
  method: string;
  path: string;
  body?: string;
  headers?: Record<string, string>;
  options?: AdtRequestOptions;
}

function fake(script: {
  post?: (path: string) => AdtResponse | Error;
  get?: (path: string, count: number) => AdtResponse | Error;
  put?: () => AdtResponse | Error;
  del?: () => AdtResponse | Error;
}) {
  const calls: Call[] = [];
  let gets = 0;
  const answer = (value: AdtResponse | Error | undefined): AdtResponse => {
    if (value instanceof Error) throw value;
    return value ?? response();
  };
  const http = {
    post: vi.fn(
      async (
        path: string,
        body?: string,
        _type?: string,
        headers?: Record<string, string>,
        options?: AdtRequestOptions,
      ) => {
        calls.push({ method: 'POST', path, body, headers, options });
        return answer(script.post?.(path));
      },
    ),
    get: vi.fn(async (path: string, headers?: Record<string, string>, options?: AdtRequestOptions) => {
      calls.push({ method: 'GET', path, headers, options });
      return answer(script.get?.(path, ++gets));
    }),
    put: vi.fn(
      async (
        path: string,
        body?: string,
        _type?: string,
        headers?: Record<string, string>,
        options?: AdtRequestOptions,
      ) => {
        calls.push({ method: 'PUT', path, body, headers, options });
        return answer(script.put?.());
      },
    ),
    delete: vi.fn(async (path: string, headers?: Record<string, string>, options?: AdtRequestOptions) => {
      calls.push({ method: 'DELETE', path, headers, options });
      return answer(script.del?.());
    }),
  };
  return { http: http as unknown as AdtHttpClient, calls, writes: () => calls.filter((call) => call.method !== 'GET') };
}

const started = (overrides: Parameters<typeof feed>[0][number] = {}) => ({
  post: (path: string) =>
    path.endsWith('/parameters')
      ? response('', { location: `${BASE}/parameters/8EDEEFE4F3661FE19C8F2D46C4CC38A2` })
      : response(feed([overrides])),
});

describe('pinned profiler request input contract', () => {
  it.each([undefined, '', '  ', '*', 'MAR*', 'A+B', 'user@example.com', 'THIRTEENCHARS', 'A B', 'A,B', 7])(
    'refuses trace user %j so nothing can widen or inherit an identity',
    (traceUser) => {
      expect(() => parsePinnedTraceStart({ traceUser })).toThrow('exact SAP user');
    },
  );

  it('normalizes one exact user and applies the conservative pinned defaults', () => {
    expect(parsePinnedTraceStart({ traceUser: 'marian' })).toMatchObject({
      traceUser: 'MARIAN',
      processType: 'http',
      objectType: 'url',
      maxExecutions: 1,
      expiresHours: 24,
      sqlTrace: true,
      aggregate: true,
    });
  });

  it.each([
    { maxExecutions: 0 },
    { maxExecutions: 101 },
    { maxExecutions: 1.5 },
    { maxExecutions: '5' },
    { expiresHours: 0 },
    { expiresHours: -1 },
    { expiresHours: 24.5 },
    { expiresHours: Number.POSITIVE_INFINITY },
    { processType: 'shared' },
    { processType: 'constructor' },
    { processType: 'dialog', objectType: 'url' },
    { sqlTrace: 'true' },
    { description: 'x'.repeat(121) },
    { description: 'one\ntwo' },
  ])('refuses out-of-contract input %j before any request', (extra) => {
    expect(() => parsePinnedTraceStart({ traceUser: 'MARIAN', ...extra })).toThrow();
  });

  it.each([
    'https://evil.example/x',
    'http://sap/x',
    `${BASE}/requests/../../oo/classes/z`,
    `${BASE}/requests/a%2fb`,
    'a/b',
    42,
  ])('refuses cancellation id %j', (id) => {
    expect(() => parsePinnedTraceCancel({ id, traceUser: 'MARIAN' })).toThrow();
  });
});

describe('startPinnedProfilerTrace', () => {
  it('submits exactly two no-replay POSTs for the exact user and route client, using the create response as proof', async () => {
    const { http, calls } = fake(started());
    const before = Date.now();
    const result = await startPinnedProfilerTrace(http, safety, context(), CLIENT, { traceUser: 'marian' });
    expect(result).toMatchObject({
      ok: true,
      state: 'armed',
      retryable: false,
      scope: { resource: 'profiler-request', server: '*', traceClient: CLIENT, traceUser: 'MARIAN' },
      readback: 'skipped-would-consume-trace',
      request: { user: 'MARIAN', actingUser: 'MARIAN', client: CLIENT },
    });
    expect(calls.map((call) => call.method)).toEqual(['POST', 'POST']);
    const query = new URLSearchParams(calls[1].path.split('?')[1]);
    expect(query.get('traceUser')).toBe('MARIAN');
    expect(query.get('traceClient')).toBe(CLIENT);
    expect(query.get('server')).toBe('*');
    expect(query.get('maximalExecutions')).toBe('1');
    expect(query.get('parametersId')).toBe(`${BASE}/parameters/8EDEEFE4F3661FE19C8F2D46C4CC38A2`);
    expect(Date.parse(query.get('expires') as string)).toBeLessThanOrEqual(before + 24 * 3_600_000 + 2000);
    for (const call of calls)
      expect(call.options).toMatchObject({ noReplay: true, retryTransientErrors: false, deadline: expect.any(Number) });
    expect(result.next).toContain('trace_cancel');
  });

  it('reads back a request that the read itself cannot consume', async () => {
    const entry = { process: 'dialog', object: 'transaction' };
    const { http, calls } = fake({ ...started(entry), get: () => response(feed([entry])) });
    const result = await startPinnedProfilerTrace(http, safety, context(), CLIENT, {
      traceUser: 'MARIAN',
      processType: 'dialog',
    });
    expect(result).toMatchObject({ ok: true, state: 'armed', readback: 'confirmed' });
    expect(calls.at(-1)).toMatchObject({ method: 'GET', path: `${BASE}/requests?user=MARIAN` });
  });

  it('reads back an http request armed for a different SAP user because this identity cannot consume it', async () => {
    const entry = { admin: 'WRITER1', trace: 'OTHER' };
    const { http } = fake({ ...started(entry), get: () => response(feed([entry])) });
    const result = await startPinnedProfilerTrace(http, safety, context(), CLIENT, { traceUser: 'OTHER' });
    expect(result).toMatchObject({
      ok: true,
      state: 'armed',
      readback: 'confirmed',
      request: { actingUser: 'WRITER1' },
    });
  });

  it('reports a request missing from its listing as unverified, never armed', async () => {
    const entry = { process: 'dialog', object: 'transaction' };
    const { http, writes } = fake({ ...started(entry), get: () => response(feed([])) });
    const result = await startPinnedProfilerTrace(http, safety, context(), CLIENT, {
      traceUser: 'MARIAN',
      processType: 'dialog',
    });
    expect(result).toMatchObject({ ok: false, state: 'armed-unverified', readback: 'not-listed' });
    expect(writes()).toHaveLength(2);
  });

  it.each([
    [{ trace: 'OTHER' }, 'traceUser'],
    [{ client: '002' }, 'traceClient'],
    [{ max: '5' }, 'maxExecutions'],
    [{ process: 'batch' }, 'processType'],
    [{ object: 'any' }, 'objectType'],
    [{ expires: '2099-01-01T00:00:00Z' }, 'expires'],
  ] as const)('leaves a native mismatch %j armed-unverified without an automatic cancel', async (entry, field) => {
    const { http, writes } = fake(started(entry));
    const result = await startPinnedProfilerTrace(http, safety, context(), CLIENT, { traceUser: 'MARIAN' });
    expect(result).toMatchObject({ ok: false, state: 'armed-unverified', retryable: false });
    expect(result.mismatches).toContain(field);
    expect(writes().map((call) => call.method)).toEqual(['POST', 'POST']);
  });

  it('refuses an entry without an explicit trace role instead of accepting the acting user as subject', async () => {
    const body = feed([{}]).replace(
      'trc:role="trace" xmlns:trc="http://www.sap.com/adt/runtime/traces/abaptraces"><atom:name>MARIAN',
      'trc:role="other" xmlns:trc="http://www.sap.com/adt/runtime/traces/abaptraces"><atom:name>MARIAN',
    );
    const { http } = fake({
      ...started(),
      post: (path) =>
        path.endsWith('/parameters') ? response('', { location: `${BASE}/parameters/AB` }) : response(body),
    });
    const result = await startPinnedProfilerTrace(http, safety, context(), CLIENT, { traceUser: 'MARIAN' });
    expect(result).toMatchObject({ ok: false, state: 'armed-unverified' });
    expect(result.mismatches).toContain('traceUser');
  });

  it.each([
    [new AdtApiError('Forbidden', 403, BASE), 'parameters-rejected', 403],
    [new AdtNetworkError('socket hang up'), 'parameters-unconfirmed', undefined],
    [new AdtApiError('Busy', 503, BASE), 'parameters-unconfirmed', 503],
  ] as const)('stops after a first POST that failed with %s', async (failure, state, statusCode) => {
    const { http, calls } = fake({ post: () => failure as unknown as Error });
    const result = await startPinnedProfilerTrace(http, safety, context(), CLIENT, { traceUser: 'MARIAN' });
    expect(result).toMatchObject({ ok: false, state, phase: 'parameters', retryable: false });
    expect(result.statusCode).toBe(statusCode);
    expect(calls).toHaveLength(1);
  });

  it.each([undefined, 'https://evil.example/x', `${BASE}/parameters/../../oo/classes/z`, `${BASE}/requests/AB`])(
    'treats an unusable parameters location %j as unconfirmed and sends no request',
    async (location) => {
      const { http, calls } = fake({ post: () => response('', location ? { location } : {}) });
      const result = await startPinnedProfilerTrace(http, safety, context(), CLIENT, { traceUser: 'MARIAN' });
      expect(result).toMatchObject({ ok: false, state: 'parameters-unconfirmed' });
      expect(calls).toHaveLength(1);
    },
  );

  it('reports orphaned parameters when SAP refuses the second POST, without replaying either', async () => {
    const { http, calls } = fake({
      post: (path) =>
        path.endsWith('/parameters')
          ? response('', { location: `${BASE}/parameters/AB` })
          : new AdtApiError('Forbidden', 403, BASE),
    });
    const result = await startPinnedProfilerTrace(http, safety, context(), CLIENT, { traceUser: 'MARIAN' });
    expect(result).toMatchObject({
      ok: false,
      state: 'parameters-orphaned',
      requestOutcome: 'rejected',
      parametersId: `${BASE}/parameters/AB`,
      statusCode: 403,
    });
    expect(calls).toHaveLength(2);
  });

  it('reports an ambiguous second POST as possibly armed and sends nothing else', async () => {
    const { http, calls } = fake({
      post: (path) =>
        path.endsWith('/parameters')
          ? response('', { location: `${BASE}/parameters/AB` })
          : new AdtNetworkError('reset'),
    });
    const result = await startPinnedProfilerTrace(http, safety, context(), CLIENT, { traceUser: 'MARIAN' });
    expect(result).toMatchObject({ ok: false, state: 'request-unconfirmed', parametersId: `${BASE}/parameters/AB` });
    expect(result.message).toContain('trace_requests');
    expect(calls).toHaveLength(2);
  });

  it('reports an unusable create response as unconfirmed', async () => {
    const { http } = fake({
      post: (path) =>
        path.endsWith('/parameters') ? response('', { location: `${BASE}/parameters/AB` }) : response(feed([])),
    });
    await expect(
      startPinnedProfilerTrace(http, safety, context(), CLIENT, { traceUser: 'MARIAN' }),
    ).resolves.toMatchObject({
      ok: false,
      state: 'request-unconfirmed',
    });
  });

  it('does not submit when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { http, calls } = fake(started());
    const result = await startPinnedProfilerTrace(http, safety, context(controller.signal), CLIENT, {
      traceUser: 'MARIAN',
    });
    expect(result).toMatchObject({ ok: false, state: 'unchanged', phase: 'parameters' });
    expect(calls).toHaveLength(0);
  });

  it('reports orphaned parameters when cancelled between the two POSTs', async () => {
    const controller = new AbortController();
    const { http, calls } = fake({
      post: () => {
        controller.abort();
        return response('', { location: `${BASE}/parameters/AB` });
      },
    });
    const result = await startPinnedProfilerTrace(http, safety, context(controller.signal), CLIENT, {
      traceUser: 'MARIAN',
    });
    expect(result).toMatchObject({ ok: false, state: 'parameters-orphaned', requestOutcome: 'not-sent' });
    expect(calls).toHaveLength(1);
  });

  it.each([
    ['read-only ceiling', { ...safety, allowWrites: false }, CLIENT],
    ['unusable client', safety, ''],
  ] as const)('refuses before SAP for %s', async (_label, configured, client) => {
    const { http, calls } = fake(started());
    const result = await startPinnedProfilerTrace(http, configured, context(), client, { traceUser: 'MARIAN' });
    expect(result).toMatchObject({ ok: false, state: 'unchanged' });
    expect(calls).toHaveLength(0);
  });

  it('refuses an unregistered or mismatched mutation context', async () => {
    const { http, calls } = fake(started());
    const other = { ...safety, multiTargetWrite: { ...policy, target: 'B4H/001' } };
    const foreign = pinnedMutationContext(other, { deadline: Date.now() + 1000 }, { unlockFailed: false });
    const result = await startPinnedProfilerTrace(http, safety, foreign, CLIENT, { traceUser: 'MARIAN' });
    expect(result.state).toBe('unchanged');
    expect(calls).toHaveLength(0);
  });
});

describe('cancelPinnedProfilerTrace', () => {
  const id = requestId();
  const listing = (...entries: Parameters<typeof feed>[0]) => response(feed(entries));

  it('deletes the native listed path once and proves absence', async () => {
    const { http, calls } = fake({ get: (_path, count) => (count === 1 ? listing({ id }) : listing()) });
    const result = await cancelPinnedProfilerTrace(http, safety, context(), CLIENT, {
      // Decodes to the same native id; DELETE must still use the verified native spelling.
      id: `${BASE}/requests/vhcala4hci_A4H_00%2C1%2C20260625093701`,
      traceUser: 'marian',
    });
    expect(result).toMatchObject({ ok: true, state: 'cancelled', scope: { traceUser: 'MARIAN', traceClient: CLIENT } });
    expect(calls.map((call) => call.method)).toEqual(['GET', 'DELETE', 'GET']);
    expect(calls[1].path).toBe(id);
    expect(calls[1].options).toMatchObject({ noReplay: true, retryTransientErrors: false });
  });

  it.each([
    ['not listed', listing()],
    ['another listed request', listing({ id: requestId('other%2c1%2c2') })],
    ['another client', listing({ id, client: '002' })],
    ['another traced user', listing({ id, trace: 'OTHER' })],
  ] as const)('sends no DELETE for %s', async (_label, list) => {
    const { http, writes } = fake({ get: () => list });
    const result = await cancelPinnedProfilerTrace(http, safety, context(), CLIENT, { id, traceUser: 'MARIAN' });
    expect(result).toMatchObject({ ok: false, state: 'unchanged' });
    expect(writes()).toHaveLength(0);
  });

  it('never turns a repository path into a DELETE', async () => {
    const { http, calls } = fake({ get: () => listing({ id }) });
    const result = await cancelPinnedProfilerTrace(http, safety, context(), CLIENT, {
      id: '/sap/bc/adt/oo/classes/zcl_victim',
      traceUser: 'MARIAN',
    });
    expect(result.state).toBe('unchanged');
    expect(calls).toHaveLength(0);
  });

  it.each([
    [new AdtApiError('Forbidden', 403, id), 'cancel-rejected'],
    [new AdtNetworkError('reset'), 'cancel-unconfirmed'],
    [new AdtApiError('Busy', 500, id), 'cancel-unconfirmed'],
  ] as const)('reports DELETE failure %s without retry', async (failure, state) => {
    const { http, calls } = fake({ get: () => listing({ id }), del: () => failure as unknown as Error });
    const result = await cancelPinnedProfilerTrace(http, safety, context(), CLIENT, { id, traceUser: 'MARIAN' });
    expect(result).toMatchObject({ ok: false, state, phase: 'write', retryable: false });
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });

  it('does not claim cancellation when the request is still listed or the listing is unavailable', async () => {
    const still = fake({ get: () => listing({ id }) });
    await expect(
      cancelPinnedProfilerTrace(still.http, safety, context(), CLIENT, { id, traceUser: 'MARIAN' }),
    ).resolves.toMatchObject({ ok: false, state: 'cancel-unconfirmed', phase: 'readback' });
    const lost = fake({ get: (_path, count) => (count === 1 ? listing({ id }) : new AdtNetworkError('reset')) });
    await expect(
      cancelPinnedProfilerTrace(lost.http, safety, context(), CLIENT, { id, traceUser: 'MARIAN' }),
    ).resolves.toMatchObject({ ok: false, state: 'cancel-unconfirmed', phase: 'readback' });
  });

  it('does not delete after cancellation', async () => {
    const controller = new AbortController();
    const { http, writes } = fake({
      get: () => {
        controller.abort();
        return listing({ id });
      },
    });
    const result = await cancelPinnedProfilerTrace(http, safety, context(controller.signal), CLIENT, {
      id,
      traceUser: 'MARIAN',
    });
    expect(result.state).toBe('unchanged');
    expect(writes()).toHaveLength(0);
  });
});

describe('parsePinnedSqlTrace', () => {
  it.each([
    [{ sqlOn: true }, 'exact SAP user'],
    [{ sqlOn: true, user: '' }, 'exact SAP user'],
    [{ sqlOn: true, user: '*' }, 'exact SAP user'],
    [{ sqlOn: true, user: 'A%' }, 'exact SAP user'],
    [{ sqlOn: true, allUsers: true }, 'refused until its native representation is qualified'],
    [{ sqlOn: true, allUsers: true, user: 'MARIAN' }, 'mutually exclusive'],
    [{ sqlOn: false, user: 'MARIAN' }, 'inactive defaults'],
    [{ sqlOn: 'true', user: 'MARIAN' }, 'boolean'],
  ] as const)('refuses %j', (input, message) => {
    expect(() => parsePinnedSqlTrace(input)).toThrow(message);
  });
});

describe('setPinnedSqlTraceState', () => {
  const headers = { 'content-type': `${ST05_TYPE}; charset=utf-8` };
  const state = (body: string, extra: Record<string, string> = {}) => response(body, { ...headers, ...extra });
  const arm = (body: string, user = 'MARIAN') =>
    body
      .replaceAll('<ts:sqlOn>false</ts:sqlOn>', '<ts:sqlOn>true</ts:sqlOn>')
      .replaceAll('<ts:traceUser/>', `<ts:traceUser>${user}</ts:traceUser>`);
  const secondInstance = stateXml.replace(
    '</ts:traceStateInstanceTable>',
    `${stateXml.match(/<ts:traceStateInstance>.*<\/ts:traceStateInstance>/)?.[0].replace('vhcala4hci_A4H_00', 'vhcala4hci_A4H_01')}</ts:traceStateInstanceTable>`,
  );

  function stateful(initial: string, onPut?: (body: string) => string) {
    let current = initial;
    const script = {
      get: () => state(current),
      put: () => response(''),
    };
    const faked = fake(script);
    const { http } = faked;
    const put = http.put;
    (http as unknown as { put: unknown }).put = vi.fn(async (...args: Parameters<AdtHttpClient['put']>) => {
      const result = await put(...args);
      current = onPut ? onPut(args[1] as string) : (args[1] as string);
      return result;
    });
    return faked;
  }

  it('arms every instance for one exact user, preserving every unrelated native field', async () => {
    const { http, calls } = stateful(secondInstance);
    const result = await setPinnedSqlTraceState(http, safety, context(), { sqlOn: true, user: 'marian' });
    expect(result).toMatchObject({
      ok: true,
      state: 'updated',
      concurrency: 'native-unconditional',
      scope: { resource: 'st05-application-server-instances', clientIsolated: false, ownUserOnly: false },
    });
    expect(result.after?.map((instance) => [instance.instance, instance.traceTypes.sql, instance.filter.user])).toEqual(
      [
        ['vhcala4hci_A4H_00', true, 'MARIAN'],
        ['vhcala4hci_A4H_01', true, 'MARIAN'],
      ],
    );
    const put = calls.find((call) => call.method === 'PUT') as Call;
    expect(put.body).toBe(arm(secondInstance));
    expect(put.options).toMatchObject({ noReplay: true, retryTransientErrors: false });
    expect(calls.map((call) => call.method)).toEqual(['GET', 'PUT', 'GET']);
    expect(result.next).toContain('sqlOn=false');
  });

  it('escapes a permitted XML-significant user character once and verifies its decoded readback', async () => {
    const { http, calls } = stateful(stateXml);
    const result = await setPinnedSqlTraceState(http, safety, context(), { sqlOn: true, user: 'a&b' });
    expect(result).toMatchObject({ ok: true, state: 'updated' });
    expect(result.after?.[0].filter.user).toBe('A&B');
    expect(calls.find((call) => call.method === 'PUT')?.body).toContain('<ts:traceUser>A&amp;B</ts:traceUser>');
  });

  it('refuses disarming when native PUT would clear another active trace type', async () => {
    const armed = arm(stateXml, 'OTHER').replace('<ts:authOn>false</ts:authOn>', '<ts:authOn>true</ts:authOn>');
    const { http, calls } = stateful(armed);
    const result = await setPinnedSqlTraceState(http, safety, context(), { sqlOn: false });
    expect(result).toMatchObject({ ok: false, state: 'unchanged' });
    expect(calls.map((call) => call.method)).toEqual(['GET']);
    expect(result.before?.[0].filter.user).toBe('OTHER');
  });

  it.each([
    ['already off', stateXml, { sqlOn: false }],
    ['already on for the same user', arm(stateXml), { sqlOn: true, user: 'MARIAN' }],
  ] as const)('sends no PUT when %s', async (_label, initial, input) => {
    const { http, calls } = stateful(initial);
    await expect(setPinnedSqlTraceState(http, safety, context(), input)).resolves.toMatchObject({
      ok: true,
      state: 'unchanged',
    });
    expect(calls.map((call) => call.method)).toEqual(['GET']);
  });

  it.each([
    ['an active SQL trace for another user', arm(stateXml, 'OTHER')],
    ['an active all-user SQL trace', stateXml.replace('<ts:sqlOn>false</ts:sqlOn>', '<ts:sqlOn>true</ts:sqlOn>')],
    [
      'another active trace type sharing the filter',
      stateXml.replace('<ts:rfcOn>false</ts:rfcOn>', '<ts:rfcOn>true</ts:rfcOn>'),
    ],
  ] as const)('refuses to replace %s', async (_label, initial) => {
    const { http, calls } = stateful(initial);
    const result = await setPinnedSqlTraceState(http, safety, context(), { sqlOn: true, user: 'MARIAN' });
    expect(result).toMatchObject({ ok: false, state: 'unchanged' });
    expect(result.message).toContain('another filter');
    expect(calls.map((call) => call.method)).toEqual(['GET']);
  });

  it.each([
    ['a missing traceUser element', stateXml.replace('<ts:traceUser/>', '')],
    ['an unexpected element prefix', stateXml.replaceAll('ts:', 'st:').replaceAll('xmlns:ts', 'xmlns:st')],
    ['another namespace', stateXml.replace('/tracestate"', '/other"')],
    ['a CDATA user filter', stateXml.replace('<ts:traceUser/>', '<ts:traceUser><![CDATA[A]]></ts:traceUser>')],
    ['a non-boolean state', stateXml.replace('<ts:sqlOn>false</ts:sqlOn>', '<ts:sqlOn>maybe</ts:sqlOn>')],
    ['a DTD', `<!DOCTYPE x [<!ENTITY a "b">]>${stateXml}`],
    [
      'no instance',
      '<?xml version="1.0"?><ts:traceStateInstanceTable xmlns:ts="http://www.sap.com/adt/tools/performance/tracestate"/>',
    ],
    ['malformed XML', '<ts:traceStateInstanceTable'],
  ] as const)('refuses %s before any PUT', async (_label, body) => {
    const { http, calls } = stateful(body);
    const result = await setPinnedSqlTraceState(http, safety, context(), { sqlOn: true, user: 'MARIAN' });
    expect(result).toMatchObject({ ok: false, state: 'unchanged', phase: 'read' });
    expect(calls.map((call) => call.method)).toEqual(['GET']);
  });

  it('refuses another representation version', async () => {
    const { http, writes } = fake({ get: () => response(stateXml, { 'content-type': 'application/xml' }) });
    const result = await setPinnedSqlTraceState(http, safety, context(), { sqlOn: true, user: 'MARIAN' });
    expect(result.state).toBe('unchanged');
    expect(writes()).toHaveLength(0);
  });

  it('guards the PUT with a strong native ETag and refuses a malformed one', async () => {
    const { http, calls } = fake({
      get: (_path, count) => (count === 1 ? state(stateXml, { etag: '"v1"' }) : state(arm(stateXml))),
    });
    await expect(
      setPinnedSqlTraceState(http, safety, context(), { sqlOn: true, user: 'MARIAN' }),
    ).resolves.toMatchObject({
      ok: true,
      concurrency: 'strong-etag',
    });
    expect(calls.find((call) => call.method === 'PUT')?.headers).toEqual({ 'If-Match': '"v1"' });
    const bad = fake({ get: () => state(stateXml, { etag: 'bare' }) });
    const refused = await setPinnedSqlTraceState(bad.http, safety, context(), { sqlOn: true, user: 'MARIAN' });
    expect(refused).toMatchObject({ ok: false, state: 'unchanged' });
    expect(refused.message).toContain('ST05 ETag');
    expect(bad.writes()).toHaveLength(0);
  });

  it.each([
    [new AdtApiError('Conflict', 412, ST05), 'update-rejected'],
    [new AdtApiError('Forbidden', 403, ST05), 'update-rejected'],
    [new AdtNetworkError('reset'), 'update-unconfirmed'],
    [new AdtApiError('Busy', 503, ST05), 'update-unconfirmed'],
  ] as const)('reports PUT failure %s once, with no replay', async (failure, state_) => {
    const { http, calls } = fake({ get: () => state(stateXml), put: () => failure as unknown as Error });
    const result = await setPinnedSqlTraceState(http, safety, context(), { sqlOn: true, user: 'MARIAN' });
    expect(result).toMatchObject({ ok: false, state: state_, phase: 'write', retryable: false });
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
  });

  it.each([
    [
      'one instance not applied',
      (body: string) => body.replace('<ts:sqlOn>true</ts:sqlOn>', '<ts:sqlOn>false</ts:sqlOn>'),
    ],
    [
      'another filter on one instance',
      (body: string) => body.replace('<ts:traceUser>MARIAN</ts:traceUser>', '<ts:traceUser>OTHER</ts:traceUser>'),
    ],
    ['an unexpected instance set', (body: string) => body.replace('vhcala4hci_A4H_01', 'vhcala4hci_A4H_02')],
    ['a changed unrelated field', (body: string) => body.replace('<ts:stackTraceOn>false', '<ts:stackTraceOn>true')],
    ['a changed unrelated filter', (body: string) => body.replace('<ts:program/>', '<ts:program>ZOTHER</ts:program>')],
  ] as const)('leaves %s unconfirmed', async (_label, mutate) => {
    const { http } = stateful(secondInstance, mutate);
    const result = await setPinnedSqlTraceState(http, safety, context(), { sqlOn: true, user: 'MARIAN' });
    expect(result).toMatchObject({ ok: false, state: 'update-unconfirmed', phase: 'readback', retryable: false });
  });

  it('accepts SAP-owned stamps and per-response flags that differ on read-back', async () => {
    const { http } = stateful(stateXml, (body) =>
      body
        .replace('<ts:modificationUser>MARIAN', '<ts:modificationUser>WRITER1')
        .replace('<ts:isLocal>true', '<ts:isLocal>false')
        .replace(/<ts:modificationDateTime>[^<]*/, '<ts:modificationDateTime>2027-01-01T00:00:00Z'),
    );
    await expect(
      setPinnedSqlTraceState(http, safety, context(), { sqlOn: true, user: 'MARIAN' }),
    ).resolves.toMatchObject({
      ok: true,
      state: 'updated',
    });
  });

  it.each([
    ['malformed XML', '<ts:traceStateInstanceTable'],
    ['an unknown shape', stateXml.replace('<ts:traceUser/>', '')],
    ['an unexpected namespace', stateXml.replace('/tracestate"', '/other"')],
  ])('retains submission uncertainty for %s after an accepted PUT', async (_label, body) => {
    const { http, calls } = fake({ get: (_path, count) => (count === 1 ? state(stateXml) : state(body)) });
    const result = await setPinnedSqlTraceState(http, safety, context(), { sqlOn: true, user: 'MARIAN' });
    expect(result).toMatchObject({ ok: false, state: 'update-unconfirmed', phase: 'readback', retryable: false });
    expect(result.message).toContain('submission outcome is not confirmed');
    expect(result.message).toContain('sql_trace_state');
    expect(result.message).toContain('Unknown native ST05 state XML');
    expect(result.message).not.toMatch(/(?:nothing|no .*change) was submitted/i);
    expect(calls.map((call) => call.method)).toEqual(['GET', 'PUT', 'GET']);
  });

  it('does not submit after cancellation and treats a failed read-back as unconfirmed', async () => {
    const controller = new AbortController();
    const before = fake({
      get: () => {
        controller.abort();
        return state(stateXml);
      },
    });
    await expect(
      setPinnedSqlTraceState(before.http, safety, context(controller.signal), { sqlOn: true, user: 'MARIAN' }),
    ).resolves.toMatchObject({ ok: false, state: 'unchanged' });
    expect(before.writes()).toHaveLength(0);
    const lost = fake({ get: (_path, count) => (count === 1 ? state(stateXml) : new AdtNetworkError('reset')) });
    await expect(
      setPinnedSqlTraceState(lost.http, safety, context(), { sqlOn: true, user: 'MARIAN' }),
    ).resolves.toMatchObject({
      ok: false,
      state: 'update-unconfirmed',
      phase: 'readback',
    });
  });

  it('refuses a read-only ceiling before SAP', async () => {
    const { http, calls } = fake({});
    const result = await setPinnedSqlTraceState(http, { ...safety, allowWrites: false }, context(), {
      sqlOn: true,
      user: 'MARIAN',
    });
    expect(result.state).toBe('unchanged');
    expect(calls).toHaveLength(0);
  });
});
