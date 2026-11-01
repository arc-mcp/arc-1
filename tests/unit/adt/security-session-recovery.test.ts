import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockResponse } from '../../helpers/mock-fetch.js';

const mockFetch = vi.fn();
vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<typeof import('undici')>()),
  fetch: mockFetch,
}));
const { AdtHttpClient } = await import('../../../src/adt/http.js');
const { logger } = await import('../../../src/server/logger.js');
const config = { baseUrl: 'https://sap.example.test', username: 'user', password: 'secret', client: '001' };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function sessionResponse(session: string, token?: string) {
  return mockResponse(200, 'ok', token ? { 'x-csrf-token': token } : {}, [`SAP_SESSIONID_A4H_001=${session}; Path=/`]);
}

const nextTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('SAP security session recovery', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lets only one surviving waiter bootstrap after a network rejection', async () => {
    let issued = 0;
    mockFetch.mockRejectedValueOnce(new Error('connection reset')).mockImplementation(async (_url, init) => {
      if (init.headers.Cookie) return mockResponse(200, 'ok');
      const session = `S${++issued}`;
      await nextTurn();
      return sessionResponse(session);
    });
    const client = new AdtHttpClient(config);
    const results = await Promise.allSettled(['/a', '/b', '/c', '/d'].map((path) => client.get(path)));

    expect(results.map((result) => result.status)).toEqual(['rejected', 'fulfilled', 'fulfilled', 'fulfilled']);
    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect(issued).toBe(1);
  });

  it.each([503, 429, 502, 401])(
    'keeps cold HTTP %i recovery serialized until SAP establishes a session',
    async (status) => {
      let coldInFlight = 0;
      let maxColdInFlight = 0;
      let issued = 0;
      let calls = 0;
      mockFetch.mockImplementation(async (_url, init) => {
        if (init.headers.Cookie) return mockResponse(200, 'ok');
        coldInFlight++;
        maxColdInFlight = Math.max(maxColdInFlight, coldInFlight);
        const first = ++calls === 1;
        await nextTurn();
        coldInFlight--;
        return first ? mockResponse(status, 'gateway error', { 'retry-after': '0' }) : sessionResponse(`S${++issued}`);
      });
      const client = new AdtHttpClient(config);
      const results = await Promise.allSettled(['/a', '/b', '/c', '/d'].map((path) => client.get(path)));

      expect(issued).toBe(1);
      expect(maxColdInFlight).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(status === 502 ? 4 : 5);
      expect(results.map((result) => result.status)).toEqual([
        status === 502 ? 'rejected' : 'fulfilled',
        'fulfilled',
        'fulfilled',
        'fulfilled',
      ]);
    },
  );

  it('does not invalidate a waiter session when an earlier cold 401 body finishes', async () => {
    const bodyStarted = deferred();
    const bodyRelease = deferred();
    let ownerCalls = 0;
    let issued = 0;
    const cookies: Array<string | undefined> = [];
    mockFetch.mockImplementation(async (url, init) => {
      cookies.push(init.headers.Cookie);
      if (new URL(url).pathname === '/owner' && ++ownerCalls === 1) {
        const response = mockResponse(401, 'Unauthorized');
        vi.spyOn(response, 'text').mockImplementation(async () => {
          bodyStarted.resolve();
          await bodyRelease.promise;
          return 'Unauthorized';
        });
        return response;
      }
      return init.headers.Cookie ? mockResponse(200, 'ok') : sessionResponse(`S${++issued}`);
    });
    const client = new AdtHttpClient(config);
    const owner = client.get('/owner');
    await bodyStarted.promise;
    await client.get('/waiter');
    bodyRelease.resolve();
    await owner;
    await client.get('/after');

    expect(issued).toBe(1);
    expect(cookies).toEqual([undefined, undefined, 'SAP_SESSIONID_A4H_001=S1', 'SAP_SESSIONID_A4H_001=S1']);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('does not reset a newer session when an old 401 response arrives', async () => {
    const oldStarted = deferred();
    const oldRelease = deferred();
    let oldCalls = 0;
    let resetCalls = 0;
    const cookies: Array<string | undefined> = [];
    mockFetch.mockImplementation(async (url, init) => {
      cookies.push(init.headers.Cookie);
      const path = new URL(url).pathname;
      if (path === '/warm') return sessionResponse('OLD');
      if (path === '/old' && ++oldCalls === 1) {
        oldStarted.resolve();
        await oldRelease.promise;
        return mockResponse(401, 'Unauthorized');
      }
      if (path === '/reset') return ++resetCalls === 1 ? mockResponse(401, 'Unauthorized') : sessionResponse('FRESH');
      return mockResponse(200, 'ok');
    });
    const client = new AdtHttpClient(config);
    await client.get('/warm');
    const old = client.get('/old');
    await oldStarted.promise;
    await client.get('/reset');
    oldRelease.resolve();
    await old;
    await client.get('/after');

    expect(cookies).toEqual([
      undefined,
      'SAP_SESSIONID_A4H_001=OLD',
      'SAP_SESSIONID_A4H_001=OLD',
      undefined,
      'SAP_SESSIONID_A4H_001=FRESH',
      'SAP_SESSIONID_A4H_001=FRESH',
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(6);
  });

  it('keeps the shared Basic rejection guard when unauthorized retries are disabled', async () => {
    const cookies: Array<string | undefined> = [];
    mockFetch.mockImplementation(async (url, init) => {
      cookies.push(init.headers.Cookie);
      const path = new URL(url).pathname;
      if (path === '/warm') return sessionResponse('S1');
      return mockResponse(path === '/denied' ? 401 : 200, 'response');
    });
    const client = new AdtHttpClient({ ...config, retryUnauthorized: false });
    await client.get('/warm');
    await expect(client.get('/denied')).rejects.toThrow();
    await expect(client.get('/after')).rejects.toThrow('already rejected');

    expect(cookies).toEqual([undefined, 'SAP_SESSIONID_A4H_001=S1']);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it.each([401, 500])('includes the internal HTTP %i reset retry in bootstrap', async (status) => {
    const retryStarted = deferred();
    const release = deferred();
    let resets = 0;
    const cold: string[] = [];
    mockFetch.mockImplementation(async (url, init) => {
      const path = new URL(url).pathname;
      if (path === '/warm') return sessionResponse('S0');
      if (path === '/reset' && ++resets === 1) {
        return mockResponse(status, status === 500 ? 'database connection is not open' : 'Unauthorized');
      }
      if (!init.headers.Cookie) cold.push(path);
      if (path === '/reset') retryStarted.resolve();
      await release.promise;
      return sessionResponse('S1');
    });
    const client = new AdtHttpClient(config);
    await client.get('/warm');
    const retry = client.get('/reset');
    await retryStarted.promise;
    const follower = client.get('/follower');
    await nextTurn();
    const coldBeforeResponse = [...cold];
    release.resolve();
    await Promise.all([retry, follower]);

    expect(coldBeforeResponse).toEqual(['/reset']);
    expect(cold).toEqual(['/reset']);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('ignores old response cookies and does not open a newer reset gate', async () => {
    const oldStarted = deferred();
    const oldRelease = deferred();
    const retryStarted = deferred();
    const retryRelease = deferred();
    let resets = 0;
    let followerCookie: string | undefined;
    mockFetch.mockImplementation(async (url, init) => {
      const path = new URL(url).pathname;
      if (path === '/warm') return sessionResponse('S0');
      if (path === '/old') {
        oldStarted.resolve();
        await oldRelease.promise;
        return sessionResponse('STALE');
      }
      if (path === '/reset') {
        if (++resets === 1) return mockResponse(401, 'Unauthorized');
        retryStarted.resolve();
        await retryRelease.promise;
        return sessionResponse('FRESH');
      }
      followerCookie = init.headers.Cookie;
      return mockResponse(200, 'ok');
    });
    const client = new AdtHttpClient(config);
    await client.get('/warm');
    const old = client.get('/old');
    await oldStarted.promise;
    const retry = client.get('/reset');
    await retryStarted.promise;
    oldRelease.resolve();
    await old;
    const follower = client.get('/follower');
    await nextTurn();
    const sentBeforeFreshResponse = followerCookie;
    retryRelease.resolve();
    await Promise.all([retry, follower]);

    expect(sentBeforeFreshResponse).toBeUndefined();
    expect(followerCookie).toBe('SAP_SESSIONID_A4H_001=FRESH');
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });

  it('opens on response headers before a slow response body finishes', async () => {
    const bodyStarted = deferred();
    const bodyRelease = deferred();
    let followerCookie: string | undefined;
    mockFetch.mockImplementation(async (url, init) => {
      if (new URL(url).pathname === '/slow') {
        const response = sessionResponse('S1');
        vi.spyOn(response, 'text').mockImplementation(async () => {
          bodyStarted.resolve();
          await bodyRelease.promise;
          return 'slow body';
        });
        return response;
      }
      followerCookie = init.headers.Cookie;
      return mockResponse(200, 'ok');
    });
    const client = new AdtHttpClient(config);
    const slow = client.get('/slow');
    await bodyStarted.promise;
    const follower = client.get('/follower');
    await nextTurn();
    const cookieBeforeBody = followerCookie;
    bodyRelease.resolve();
    await Promise.all([slow, follower]);

    expect(cookieBeforeBody).toBe('SAP_SESSIONID_A4H_001=S1');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('includes a standalone CSRF fetch and preserves queued request headers', async () => {
    const started = deferred();
    const release = deferred();
    const sent: Record<string, string>[] = [];
    mockFetch.mockImplementation(async (_url, init) => {
      sent.push(init.headers);
      if (init.method === 'HEAD') {
        started.resolve();
        await release.promise;
        return sessionResponse('S1', 'TOKEN-S1');
      }
      return mockResponse(200, 'ok');
    });
    const client = new AdtHttpClient({ ...config, sessionType: 'stateful' });
    const csrf = client.fetchCsrfToken();
    await started.promise;
    const follower = client.get('/follower', { Accept: 'application/test', 'X-Custom': 'kept' });
    await nextTurn();
    const sendsBeforeResponse = sent.length;
    release.resolve();
    await Promise.all([csrf, follower]);
    await client.post('/write', 'body');

    expect(sendsBeforeResponse).toBe(1);
    expect(sent[1]).toMatchObject({
      Cookie: 'SAP_SESSIONID_A4H_001=S1',
      Accept: 'application/test',
      'X-Custom': 'kept',
      'X-sap-adt-sessiontype': 'stateful',
      Authorization: `Basic ${Buffer.from('user:secret').toString('base64')}`,
    });
    expect(sent[2]).toMatchObject({ Cookie: 'SAP_SESSIONID_A4H_001=S1', 'X-CSRF-Token': 'TOKEN-S1' });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it.each(['abort', 'deadline'])('drops only the waiter on %s without sending it', async (kind) => {
    const started = deferred();
    const release = deferred();
    const paths: string[] = [];
    mockFetch.mockImplementation(async (url) => {
      const path = new URL(url).pathname;
      paths.push(path);
      if (path === '/owner') {
        started.resolve();
        await release.promise;
      }
      return sessionResponse('S1');
    });
    const client = new AdtHttpClient(config);
    const owner = client.get('/owner');
    await started.promise;
    const controller = new AbortController();
    const waiter = client.get('/cancelled', undefined, {
      ...(kind === 'abort' ? { signal: controller.signal } : { deadline: Date.now() + 20 }),
    });
    const rejection = expect(waiter).rejects.toMatchObject({ name: 'AdtNetworkError' });
    const survivor = client.get('/survivor');
    if (kind === 'abort') controller.abort('PRIVATE_REASON');
    await rejection;
    release.resolve();
    await Promise.all([owner, survivor]);

    expect(paths).toEqual(['/owner', '/survivor']);
  });

  it('hands a cancelled owner to one survivor without cancelling the remaining callers', async () => {
    const started = deferred();
    let issued = 0;
    mockFetch.mockImplementation(async (url, init) => {
      if (new URL(url).pathname === '/owner') {
        started.resolve();
        await new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
        });
      }
      if (init.headers.Cookie) return mockResponse(200, 'ok');
      const session = `S${++issued}`;
      await nextTurn();
      return sessionResponse(session);
    });
    const client = new AdtHttpClient(config);
    const controller = new AbortController();
    const owner = client.get('/owner', undefined, { signal: controller.signal });
    const result = Promise.allSettled([owner]);
    await started.promise;
    const followers = ['/a', '/b', '/c'].map((path) => client.get(path));
    controller.abort('PRIVATE_REASON');
    const [failure] = await result;
    await Promise.all(followers);

    expect(failure?.status).toBe('rejected');
    if (failure?.status === 'rejected') expect(failure.reason.message).not.toContain('PRIVATE_REASON');
    expect(issued).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('keeps queued cold writes on matching CSRF/session pairs without extra sends', async () => {
    let probes = 0;
    const sent: Array<{ cookie?: string; token?: string }> = [];
    const probeCookies: Array<string | undefined> = [];
    mockFetch.mockImplementation(async (_url, init) => {
      if (init.method === 'HEAD') {
        probeCookies.push(init.headers.Cookie);
        const session = `S${++probes}`;
        await nextTurn();
        return sessionResponse(session, `TOKEN-${session}`);
      }
      sent.push({ cookie: init.headers.Cookie, token: init.headers['X-CSRF-Token'] });
      return mockResponse(200, 'ok');
    });
    const client = new AdtHttpClient(config);
    await Promise.all([client.post('/a', 'one'), client.post('/b', 'two')]);

    expect(probeCookies).toEqual([undefined, 'SAP_SESSIONID_A4H_001=S1']);
    expect(sent).toHaveLength(2);
    for (const request of sent) {
      const session = /SAP_SESSIONID_A4H_001=(S\d+)/.exec(request.cookie ?? '')?.[1];
      expect(session).toBeDefined();
      expect(request.token).toBe(`TOKEN-${session}`);
    }
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('keeps bootstrap ownership and cookies independent between clients', async () => {
    const firstStarted = deferred();
    const firstRelease = deferred();
    const sent: Array<{ path: string; cookie?: string }> = [];
    mockFetch.mockImplementation(async (url, init) => {
      const path = new URL(url).pathname;
      sent.push({ path, cookie: init.headers.Cookie });
      if (path === '/first') {
        firstStarted.resolve();
        await firstRelease.promise;
      }
      return sessionResponse(path === '/first' ? 'FIRST' : 'SECOND');
    });
    const first = new AdtHttpClient(config);
    const second = new AdtHttpClient({ ...config, username: 'other' });
    const pending = first.get('/first');
    await firstStarted.promise;
    const independent = second.get('/second');
    await nextTurn();
    const beforeFirstResponse = sent.map((request) => request.path);
    firstRelease.resolve();
    await Promise.all([pending, independent]);
    await second.get('/second-again');

    expect(beforeFirstResponse).toEqual(['/first', '/second']);
    expect(sent[2]).toEqual({ path: '/second-again', cookie: 'SAP_SESSIONID_A4H_001=SECOND' });
  });

  it('does not restore cookies or CSRF from an owner invalidated while pending', async () => {
    const started = deferred();
    const release = deferred();
    let probes = 0;
    const sent: Record<string, string>[] = [];
    mockFetch.mockImplementation(async (_url, init) => {
      sent.push(init.headers);
      if (init.method === 'HEAD') {
        if (++probes === 1) {
          started.resolve();
          await release.promise;
          return sessionResponse('STALE', 'TOKEN-STALE');
        }
        return sessionResponse('FRESH', 'TOKEN-FRESH');
      }
      return mockResponse(200, 'ok');
    });
    const client = new AdtHttpClient({ ...config, cookieString: 'MYSAPSSO2=old', cookies: { MYSAPSSO2: 'old' } });
    const stale = client.fetchCsrfToken();
    const result = Promise.allSettled([stale]);
    await started.promise;
    client.markCookiesStale();
    release.resolve();
    const [staleResult] = await result;
    await client.post('/write', 'body');

    expect(staleResult?.status).toBe('rejected');
    expect(probes).toBe(2);
    expect(sent[1]?.Cookie).toBeUndefined();
    expect(sent[2]).toMatchObject({ Cookie: 'SAP_SESSIONID_A4H_001=FRESH', 'X-CSRF-Token': 'TOKEN-FRESH' });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it.each(['ordinary', 'negotiation'])('does not restore an old token after a slow %s body', async (kind) => {
    const bodyStarted = deferred();
    const bodyRelease = deferred();
    let oldCalls = 0;
    let writeHeaders: Record<string, string> | undefined;
    mockFetch.mockImplementation(async (url, init) => {
      if (new URL(url).pathname === '/old') {
        if (++oldCalls === 1 && kind === 'negotiation') return mockResponse(406, 'Not acceptable');
        const response = sessionResponse('OLD', 'TOKEN-OLD');
        vi.spyOn(response, 'text').mockImplementation(async () => {
          bodyStarted.resolve();
          await bodyRelease.promise;
          return 'old body';
        });
        return response;
      }
      if (init.method === 'HEAD') return sessionResponse('FRESH', 'TOKEN-FRESH');
      writeHeaders = init.headers;
      return mockResponse(200, 'ok');
    });
    const client = new AdtHttpClient({ ...config, cookieString: 'MYSAPSSO2=old' });
    const old = client.get('/old', { Accept: 'application/vnd.sap.adt.test.v1+xml' });
    await bodyStarted.promise;
    client.markCookiesStale();
    await client.fetchCsrfToken();
    bodyRelease.resolve();
    await old;
    await client.post('/write', 'body');

    expect(writeHeaders).toMatchObject({ Cookie: 'SAP_SESSIONID_A4H_001=FRESH', 'X-CSRF-Token': 'TOKEN-FRESH' });
    expect(mockFetch).toHaveBeenCalledTimes(kind === 'ordinary' ? 3 : 4);
  });

  it('retains a queued request session on its content-negotiation retry', async () => {
    const ownerStarted = deferred();
    const ownerRelease = deferred();
    const cookies: Array<string | undefined> = [];
    mockFetch.mockImplementation(async (url, init) => {
      if (new URL(url).pathname === '/owner') {
        ownerStarted.resolve();
        await ownerRelease.promise;
        return sessionResponse('S1');
      }
      cookies.push(init.headers.Cookie);
      return cookies.length === 1 ? mockResponse(406, 'Not acceptable') : mockResponse(200, 'ok');
    });
    const client = new AdtHttpClient(config);
    const owner = client.get('/owner');
    await ownerStarted.promise;
    const queued = client.get('/negotiated', { Accept: 'application/vnd.sap.adt.test.v1+xml' });
    await nextTurn();
    ownerRelease.resolve();
    await Promise.all([owner, queued]);

    expect(cookies).toEqual(['SAP_SESSIONID_A4H_001=S1', 'SAP_SESSIONID_A4H_001=S1']);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('audits the context actually sent by a queued CSRF probe', async () => {
    const started = deferred();
    const release = deferred();
    const audit = vi.spyOn(logger, 'emitAudit').mockImplementation(() => undefined);
    let csrfCookie: string | undefined;
    mockFetch.mockImplementation(async (_url, init) => {
      if (init.method === 'GET') {
        started.resolve();
        await release.promise;
        return mockResponse(200, 'ok', {}, ['SAP_SESSIONID_A4H_001=S1; Path=/', 'sap-contextid=CONTEXT; Path=/']);
      }
      csrfCookie = init.headers.Cookie;
      return sessionResponse('S1', 'TOKEN-S1');
    });
    const client = new AdtHttpClient({ ...config, sessionType: 'stateful' });
    const owner = client.get('/owner');
    await started.promise;
    const csrf = client.fetchCsrfToken();
    await nextTurn();
    release.resolve();
    await Promise.all([owner, csrf]);

    expect(csrfCookie).toContain('sap-contextid=CONTEXT');
    const event = audit.mock.calls.map(([value]) => value).find((value) => value.event === 'http_csrf_fetch');
    expect(event).toMatchObject({ hasContext: true, adtMode: 'stateful', success: true });
    expect(JSON.stringify(event)).not.toContain('CONTEXT');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it.each([406, 429, 503])('reuses the cold owner session on its HTTP %i retry', async (status) => {
    const cookies: Array<string | undefined> = [];
    mockFetch.mockImplementation(async (_url, init) => {
      cookies.push(init.headers.Cookie);
      return cookies.length === 1
        ? mockResponse(status, 'retry', { 'retry-after': '0' }, ['SAP_SESSIONID_A4H_001=S1; Path=/'])
        : mockResponse(200, 'ok');
    });
    const client = new AdtHttpClient(config);
    await client.get('/owner', { Accept: 'application/vnd.sap.adt.test.v1+xml' });

    expect(cookies).toEqual([undefined, 'SAP_SESSIONID_A4H_001=S1']);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it.each([415, 429, 503])('keeps a rotated cookie/token pair on a modifying HTTP %i retry', async (status) => {
    const writes: Array<{ cookie?: string; token?: string }> = [];
    mockFetch.mockImplementation(async (_url, init) => {
      if (init.method === 'HEAD') return sessionResponse('S0', 'TOKEN-S0');
      writes.push({ cookie: init.headers.Cookie, token: init.headers['X-CSRF-Token'] });
      return writes.length === 1
        ? mockResponse(status, 'retry', { 'retry-after': '0', 'x-csrf-token': 'TOKEN-S1' }, [
            'SAP_SESSIONID_A4H_001=S1; Path=/',
          ])
        : mockResponse(200, 'ok');
    });
    const client = new AdtHttpClient(config);
    await client.post('/write', 'body', 'application/vnd.sap.adt.test.v1+xml');

    expect(writes).toEqual([
      { cookie: 'SAP_SESSIONID_A4H_001=S0', token: 'TOKEN-S0' },
      { cookie: 'SAP_SESSIONID_A4H_001=S1', token: 'TOKEN-S1' },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
