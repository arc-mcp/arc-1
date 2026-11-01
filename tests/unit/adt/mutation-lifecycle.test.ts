import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  safeUpdateClassInclude,
  safeUpdateSource,
  updateSource,
  withAdditionalMutationLock,
  withLockedMutation,
} from '../../../src/adt/crud.js';
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
  it('runs post-unlock work on the same scoped session before its single close', async () => {
    const { http, safety, context, cleanup } = fixture();
    const posts = vi.spyOn(AdtHttpClient.prototype, 'post');
    const policy = {
      beforeLock: () => {},
      validateLock: async () => {},
      afterUnlock: async (session: typeof http) => {
        expect(() => withAdditionalMutationLock(session, '/pool', policy, vi.fn())).toThrow('active pinned');
        await session.post('/after-unlock', 'activation');
      },
    };
    const result = await withLockedMutation(http, safety, context, owner, policy, async (session) => {
      await session.put('/save', 'new text');
      return 'saved';
    });
    expect(result).toBe('saved');
    const calls = mockFetch.mock.calls as [string, RequestInit][];
    const urls = calls.map(([url]) => url);
    const unlock = urls.findIndex((url) => url.includes('_action=UNLOCK'));
    const followup = urls.findIndex((url) => url.includes('/after-unlock'));
    const close = urls.findIndex((url) => url.includes('/http/sessions'));
    expect(unlock).toBeGreaterThan(urls.findIndex((url) => url.includes('/save')));
    expect(followup).toBeGreaterThan(unlock);
    expect(close).toBeGreaterThan(followup);
    expect(urls.filter((url) => url.includes('/http/sessions'))).toHaveLength(1);
    expect(new Headers(calls[followup][1].headers).get('Cookie')).toContain('sap-contextid=owning');
    expect(posts.mock.calls.find(([url]) => url === '/after-unlock')?.[4]).toMatchObject(context.requestPolicy);
    expect(cleanup).toEqual({ unlockFailed: false, sessionClosed: true });
  });

  it.each(['validation', 'save', 'unlock', 'cancellation'] as const)(
    'does not run post-unlock work after %s fails',
    async (failure) => {
      const { http, safety, context, cleanup, controller } = fixture();
      const fallback = mockFetch.getMockImplementation()!;
      mockFetch.mockImplementation(async (url, options) =>
        failure === 'unlock' && String(url).includes('_action=UNLOCK')
          ? mockResponse(503, 'unlock uncertain')
          : fallback(url, options),
      );
      const afterUnlock = vi.fn();
      await expect(
        withLockedMutation(
          http,
          safety,
          context,
          owner,
          {
            beforeLock: () => {},
            validateLock: async () => {
              if (failure === 'validation') throw new Error('validation');
            },
            afterUnlock,
          },
          async () => {
            if (failure === 'save') throw new Error('save');
            if (failure === 'cancellation') controller.abort();
            return 'saved';
          },
        ),
      ).rejects.toThrow();
      expect(afterUnlock).not.toHaveBeenCalled();
      expect(mockFetch.mock.calls.filter(([url]) => String(url).includes('_action=UNLOCK'))).toHaveLength(1);
      expect(cleanup).toMatchObject({ unlockFailed: failure === 'unlock', sessionClosed: true });
      if (failure === 'unlock') expect(cleanup).toMatchObject({ unlockFailures: [{ uri: owner, statusCode: 503 }] });
    },
  );

  it('does not replay uncertain post-unlock work and still closes the owning session', async () => {
    const { http, safety, context, cleanup } = fixture();
    const fallback = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation(async (url, options) =>
      String(url).includes('/after-unlock')
        ? mockResponse(503, 'activation uncertain', { 'retry-after': '0' })
        : fallback(url, options),
    );
    await expect(
      withLockedMutation(
        http,
        safety,
        context,
        owner,
        {
          beforeLock: () => {},
          validateLock: async () => {},
          afterUnlock: async (session) => {
            await session.post('/after-unlock', 'activation');
          },
        },
        async () => 'saved',
      ),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(mockFetch.mock.calls.filter(([url]) => String(url).includes('/after-unlock'))).toHaveLength(1);
    expect(cleanup).toEqual({ unlockFailed: false, sessionClosed: true });
  });

  it('refuses additional locks outside the active owning coordinator, including a borrowed completed session', async () => {
    const { http, scoped, safety, context } = fixture();
    const policy = { beforeLock: () => {}, validateLock: async () => {} };
    const operation = vi.fn();
    expect(() => withAdditionalMutationLock(scoped, '/pool', policy, operation)).toThrow('active pinned');
    expect(mockFetch).not.toHaveBeenCalled();
    let borrowed = scoped;
    await withLockedMutation(http, safety, context, owner, policy, async (session) => {
      borrowed = session;
    });
    const before = mockFetch.mock.calls.length;
    expect(() => withAdditionalMutationLock(borrowed, '/pool', policy, operation)).toThrow('active pinned');
    expect(mockFetch).toHaveBeenCalledTimes(before);
    expect(operation).not.toHaveBeenCalled();
  });

  it('does not reacquire an owner already held by the coordinator', async () => {
    const { http, safety, context } = fixture();
    const policy = { beforeLock: () => {}, validateLock: async () => {} };
    const operation = vi.fn();
    await withLockedMutation(http, safety, context, owner, policy, async (session) => {
      await expect(withAdditionalMutationLock(session, owner, policy, operation)).rejects.toThrow('already locked');
    });
    expect(operation).not.toHaveBeenCalled();
    expect(mockFetch.mock.calls.filter(([url]) => String(url).includes('_action=LOCK'))).toHaveLength(1);
  });

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
  it('rejects non-finite nested budgets before they can erase the outer deadline', async () => {
    const { scoped } = fixture();
    expect(() => scoped.get('/source', undefined, { deadline: Number.NaN })).toThrow('deadline');
    expect(() =>
      scoped.withStatefulSession(async () => {}, { timeoutMs: Number.NaN, noReplay: false, onClose: () => {} }),
    ).toThrow('budget');
    expect(mockFetch).not.toHaveBeenCalled();
  });

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

  it.each(['response-lost', 'database-error'] as const)('does not replay a nested PUT after %s', async (failure) => {
    const { scoped, safety } = fixture();
    const fallback = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation(async (url: string, options) => {
      if (options.method !== 'PUT') return fallback(url, options);
      if (failure === 'response-lost') throw new TypeError('fetch failed');
      return mockResponse(500, 'database connection is not open');
    });
    await expect(updateSource(scoped, safety, `${owner}/source/main`, 'x', 'test')).rejects.toMatchObject(
      failure === 'response-lost' ? { name: 'AdtNetworkError' } : { statusCode: 500 },
    );
    expect(mockFetch.mock.calls.filter(([, options]) => options.method === 'PUT')).toHaveLength(1);
  });

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
    expect(cleanup.sessionClosed).toBeUndefined();
    expect(closed).toHaveBeenCalledExactlyOnceWith(true);
    const close = mockFetch.mock.calls.find(([url]) => url.includes('/http/sessions'));
    expect(close?.[1].headers['sap-contextid']).toBe('owning');
  });
});

describe('shared lock lifecycle', () => {
  it('reports only the owning close when an independent nested session fails to close', async () => {
    const { scoped, safety, context, cleanup } = fixture();
    const fallback = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation(async (url: string, options) => {
      if (url.includes('/child')) return mockResponse(200, '', {}, ['sap-contextid=child; Path=/']);
      if (url.includes('/http/sessions') && options.headers['sap-contextid'] === 'child')
        return mockResponse(503, 'close unavailable');
      return fallback(url, options);
    });
    const childClosed = vi.fn();
    await withLockedMutation(
      scoped,
      safety,
      context,
      owner,
      { beforeLock: () => {}, validateLock: async () => {} },
      async (session) => {
        await session.withStatefulSession(
          async (child) => {
            await child.get('/child');
          },
          { timeoutMs: 30_000, noReplay: true, onClose: childClosed },
        );
        expect(childClosed).toHaveBeenCalledExactlyOnceWith(false);
        expect(cleanup.sessionClosed).toBeUndefined();
      },
    );
    expect(cleanup.sessionClosed).toBe(true);
    const closes = mockFetch.mock.calls.filter(([url]) => url.includes('/http/sessions'));
    expect(closes.map(([, options]) => options.headers['sap-contextid'])).toEqual(['child', 'owning']);
  });

  it('does not report a sibling session as the owner when the mutation is refused before opening', async () => {
    const { scoped, safety, context, cleanup } = fixture();
    await scoped.withStatefulSession(async (session) => {
      await session.post(`${owner}?_action=LOCK`);
    });
    expect(cleanup.sessionClosed).toBeUndefined();
    safety.allowWrites = false;
    await expect(
      withLockedMutation(
        scoped,
        safety,
        context,
        owner,
        { beforeLock: () => {}, validateLock: async () => {} },
        vi.fn(),
      ),
    ).rejects.toBeInstanceOf(AdtSafetyError);
    expect(cleanup.sessionClosed).toBeUndefined();
  });

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
