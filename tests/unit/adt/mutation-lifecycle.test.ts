import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { safeUpdateClassInclude, safeUpdateSource, updateSource, withLockedMutation } from '../../../src/adt/crud.js';
import { AdtSafetyError } from '../../../src/adt/errors.js';
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import {
  type MutationContext,
  pinnedMutationContext,
  singleTargetMutationContext,
} from '../../../src/adt/mutation-context.js';
import { mutationHttp } from '../../../src/adt/mutation-http.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

const mockFetch = vi.fn();
vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<typeof import('undici')>()),
  fetch: mockFetch,
}));
const { AdtHttpClient } = await import('../../../src/adt/http.js');
const owner = '/sap/bc/adt/oo/classes/zcl_test';
const lockBody = '<DATA><LOCK_HANDLE>lock-test</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA>';

function fixture(target = 'A4H/001') {
  const safety = {
    ...defaultSafetyConfig(),
    allowWrites: true,
    multiTargetWrite: {
      target,
      enabled: true,
      allowedPackages: ['$TMP'],
      allowedTransports: [],
      serverAllowedTransports: [],
    },
  };
  const controller = new AbortController();
  const cleanup = { unlockFailed: false, sessionClosed: undefined as boolean | undefined };
  const context = pinnedMutationContext(safety, { deadline: Date.now() + 300_000, signal: controller.signal }, cleanup);
  const http = new AdtHttpClient({ baseUrl: 'https://sap.example.com', username: 'writer', password: 'test' });
  return { http, safety, context, cleanup, controller, scoped: mutationHttp(http, safety, context) };
}

beforeEach(() => {
  mockFetch.mockReset().mockImplementation(async (url: string, options) => {
    if (options.method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'token' });
    if (url.includes('_action=LOCK')) return mockResponse(200, lockBody, {}, ['sap-contextid=owning; Path=/']);
    return mockResponse(200, 'source');
  });
});
afterEach(() => vi.restoreAllMocks());

describe('required mutation context', () => {
  it.each([true, false])('refuses legacy wrappers on multi-target clients: enabled=%s', async (enabled) => {
    const { http, safety } = fixture();
    safety.multiTargetWrite.enabled = enabled;
    await expect(safeUpdateSource(http, safety, owner, `${owner}/source/main`, 'x')).rejects.toBeInstanceOf(
      AdtSafetyError,
    );
    await expect(
      safeUpdateClassInclude(http, safety, owner, `${owner}/includes/testclasses`, 'x'),
    ).rejects.toBeInstanceOf(AdtSafetyError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuses absent, reconstructed, disabled and different-target contexts before opening a session', async () => {
    const { http, safety, context } = fixture();
    const other = fixture('OTHER/001');
    const legacy = singleTargetMutationContext(defaultSafetyConfig());
    const policy = { beforeLock: vi.fn(), validateLock: vi.fn() };
    for (const invalid of [undefined, { ...context }, other.context, legacy]) {
      await expect(
        withLockedMutation(http, safety, invalid as MutationContext, owner, policy, vi.fn()),
      ).rejects.toThrow('context');
    }
    safety.multiTargetWrite.enabled = false;
    expect(() => mutationHttp(http, safety, context)).toThrow('context');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(policy.beforeLock).not.toHaveBeenCalled();
  });

  it('returns the original single-target transport and preserves absent request options', async () => {
    const { http } = fixture();
    const safety = defaultSafetyConfig();
    const scoped = mutationHttp(http, safety, singleTargetMutationContext(safety));
    expect(scoped).toBe(http);
    const get = vi.spyOn(http, 'get');
    await scoped.get('/source');
    expect(get).toHaveBeenCalledExactlyOnceWith('/source');
  });
});

describe('request policy reaches the real ADT transport', () => {
  it('applies policy to every public request method and preserves stricter nested budgets', async () => {
    const { http, scoped, context } = fixture();
    const get = vi.spyOn(http, 'get');
    const head = vi.spyOn(http, 'head');
    const post = vi.spyOn(http, 'post');
    const put = vi.spyOn(http, 'put');
    const del = vi.spyOn(http, 'delete');
    const csrf = vi.spyOn(http, 'fetchCsrfToken');
    const input: AdtRequestOptions = {
      deadline: context.requestPolicy.deadline + 1000,
      noReplay: false,
      retryTransientErrors: true,
    };
    await scoped.get('/source', undefined, input);
    await scoped.head('/source', undefined, input);
    await scoped.post('/mutation', '', undefined, undefined, input);
    await scoped.put('/mutation', '', undefined, undefined, input);
    await scoped.delete('/mutation', undefined, input);
    await scoped.fetchCsrfToken(input);
    const expected = {
      deadline: context.requestPolicy.deadline,
      signal: context.requestPolicy.signal,
      noReplay: true,
      retryTransientErrors: false,
    };
    for (const options of [
      get.mock.calls[0][2],
      head.mock.calls[0][2],
      post.mock.calls[0][4],
      put.mock.calls[0][4],
      del.mock.calls[0][2],
      csrf.mock.calls.at(-1)?.[0],
    ])
      expect(options).toMatchObject(expected);
    const tighter = Date.now() + 5000;
    await scoped.get('/source', undefined, { deadline: tighter, suppressNotFoundLog: true });
    expect(get.mock.calls.at(-1)?.[2]).toMatchObject({ ...expected, deadline: tighter, suppressNotFoundLog: true });
    expect(context.requestPolicy.deadline).toBeGreaterThan(tighter);
  });

  it.each([401, 403, 406, 415, 429, 500, 503])(
    'nested helpers cannot replay a mutation after HTTP %s',
    async (status) => {
      const { scoped, safety } = fixture();
      const fallback = mockFetch.getMockImplementation()!;
      mockFetch.mockImplementation(async (url: string, options) =>
        options.method === 'PUT'
          ? mockResponse(status, 'failure', { 'x-csrf-token': 'Required', 'retry-after': '0' })
          : fallback(url, options),
      );
      // This existing helper has no request-options parameter.
      await expect(updateSource(scoped, safety, `${owner}/source/main`, 'x', 'test')).rejects.toMatchObject({
        statusCode: status,
      });
      expect(mockFetch.mock.calls.filter(([, options]) => options.method === 'PUT')).toHaveLength(1);
    },
  );

  it.each(['outer', 'inner'] as const)(
    'retains %s cancellation even when the other signal is supplied',
    async (aborted) => {
      const { scoped, http, controller } = fixture();
      const inner = new AbortController();
      const get = vi.spyOn(http, 'get');
      await scoped.get('/source', undefined, { signal: inner.signal });
      const effective = get.mock.calls[0][2]?.signal;
      (aborted === 'outer' ? controller : inner).abort();
      expect(effective?.aborted).toBe(true);
      const calls = mockFetch.mock.calls.length;
      await expect(scoped.get('/unsent', undefined, { signal: inner.signal })).rejects.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(calls);
    },
  );

  it('carries the scope into nested sessions and uses bounded independent session closure', async () => {
    const { scoped, controller, cleanup } = fixture();
    const closed = vi.fn();
    await expect(
      scoped.withStatefulSession(
        async (session) => {
          await session.post(`${owner}?_action=LOCK`);
          controller.abort();
          await session.put('/unsent', 'x', undefined, undefined, {
            signal: new AbortController().signal,
            noReplay: false,
          });
        },
        { timeoutMs: 60_000, noReplay: false, onClose: closed },
      ),
    ).rejects.toThrow();
    expect(mockFetch.mock.calls.filter(([, options]) => options.method === 'PUT')).toHaveLength(0);
    expect(cleanup.sessionClosed).toBe(true);
    expect(closed).toHaveBeenCalledExactlyOnceWith(true);
    const close = mockFetch.mock.calls.find(([url]) => url.includes('/http/sessions'));
    expect(close?.[1].headers['sap-contextid']).toBe('owning');
  });
});

describe('shared lock lifecycle', () => {
  it.each(['abort', 'deadline'] as const)(
    'cleans up on its owning session after %s without replacing the primary error',
    async (cause) => {
      const { scoped, safety, context, cleanup, controller } = fixture();
      const policy = {
        beforeLock: vi.fn(),
        validateLock: vi.fn(async () => {
          if (cause === 'abort') controller.abort();
          else vi.spyOn(Date, 'now').mockReturnValue(context.requestPolicy.deadline + 1);
        }),
      };
      await expect(
        withLockedMutation(scoped, safety, context, owner, policy, async (session) => {
          await updateSource(session, safety, `${owner}/source/main`, 'x', 'test');
        }),
      ).rejects.toThrow();
      expect(mockFetch.mock.calls.filter(([, options]) => options.method === 'PUT')).toHaveLength(0);
      const unlock = mockFetch.mock.calls.filter(([url]) => url.includes('_action=UNLOCK'));
      expect(unlock).toHaveLength(1);
      expect(unlock[0][1].headers.Cookie).toContain('sap-contextid=owning');
      expect(cleanup).toEqual({ unlockFailed: false, sessionClosed: true });
    },
  );

  it('does not run the mutation when locked-policy validation fails, but still unlocks', async () => {
    const { http, safety, context } = fixture();
    const error = new AdtSafetyError('package drift');
    const operation = vi.fn();
    await expect(
      withLockedMutation(
        http,
        safety,
        context,
        owner,
        {
          beforeLock: () => {},
          validateLock: async () => {
            throw error;
          },
        },
        operation,
      ),
    ).rejects.toBe(error);
    expect(operation).not.toHaveBeenCalled();
    expect(mockFetch.mock.calls.filter(([url]) => url.includes('_action=UNLOCK'))).toHaveLength(1);
  });
});
