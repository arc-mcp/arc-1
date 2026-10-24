import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type HttpRequestEvent, redactAuditEvent } from '../../../src/server/audit.js';
import { logger } from '../../../src/server/logger.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

const mockFetch = vi.fn();
vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<typeof import('undici')>()),
  fetch: mockFetch,
}));
const { AdtHttpClient } = await import('../../../src/adt/http.js');

const config = { baseUrl: 'https://sap.example.com', username: 'admin', password: 'secret', client: '001' };
const closePath = '/sap/bc/adt/core/http/sessions';

function request(index: number) {
  const [url, options] = mockFetch.mock.calls[index]!;
  return { path: new URL(url).pathname, method: options.method, headers: options.headers };
}

describe('stateful ADT session lifecycle', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each(['GET', 'CSRF'])('emits the configured stateless header for %s', async (operation) => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
    const client = new AdtHttpClient({ ...config, sessionType: 'stateless' });

    if (operation === 'CSRF') await client.fetchCsrfToken();
    else await client.get(closePath);

    expect(request(0).headers['X-sap-adt-sessiontype']).toBe('stateless');
  });

  it('audits the CSRF HEAD fallback without exposing secrets', async () => {
    const emit = vi.spyOn(logger, 'emitAudit').mockImplementation(() => undefined);
    mockFetch.mockResolvedValueOnce(mockResponse(200, '', {}, ['sap-contextid=PRIVATE_CONTEXT; Path=/']));
    mockFetch.mockResolvedValueOnce(mockResponse(400, 'PRIVATE_BODY'));
    mockFetch.mockResolvedValueOnce(mockResponse(200, 'PRIVATE_BODY', { 'x-csrf-token': 'PRIVATE_TOKEN' }));
    const client = new AdtHttpClient({ ...config, sessionType: 'stateful' });
    await client.get('/open');
    await client.fetchCsrfToken();

    const events = emit.mock.calls
      .map(([event]) => redactAuditEvent(event))
      .filter((event) => event.event === 'http_csrf_fetch');
    expect(events).toMatchObject([
      {
        method: 'HEAD',
        path: '/sap/bc/adt/core/discovery',
        statusCode: 400,
        success: false,
        adtMode: 'stateful',
        hasContext: true,
      },
      {
        method: 'GET',
        path: '/sap/bc/adt/core/discovery',
        statusCode: 200,
        success: true,
        adtMode: 'stateful',
        hasContext: true,
      },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/PRIVATE_|admin|secret/);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('retries stateful discovery without the session header when HEAD and GET return 400', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(400, ''));
    mockFetch.mockResolvedValueOnce(mockResponse(400, 'Service cannot be reached'));
    mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'TOKEN' }));

    const client = new AdtHttpClient({ ...config, sessionType: 'stateful' });
    await expect(client.fetchCsrfToken()).resolves.toBe('/sap/bc/adt/core/discovery');

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(request(0)).toMatchObject({ method: 'HEAD' });
    expect(request(0).headers['X-sap-adt-sessiontype']).toBe('stateful');
    expect(request(1)).toMatchObject({ method: 'GET' });
    expect(request(1).headers['X-sap-adt-sessiontype']).toBe('stateful');
    expect(request(2)).toMatchObject({ method: 'GET' });
    expect(request(2).headers['X-sap-adt-sessiontype']).toBeUndefined();
  });

  it('audits tokenless stateless responses before rejecting a login page', async () => {
    const emit = vi.spyOn(logger, 'emitAudit').mockImplementation(() => undefined);
    mockFetch.mockResolvedValueOnce(mockResponse(200, ''));
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, '<html><body>System Logon</body></html>', { 'content-type': 'text/html' }),
    );
    await expect(new AdtHttpClient(config).fetchCsrfToken()).rejects.toMatchObject({ statusCode: 401 });
    const events = emit.mock.calls
      .map(([event]) => redactAuditEvent(event))
      .filter((event) => event.event === 'http_csrf_fetch');
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event).toMatchObject({
        level: 'debug',
        statusCode: 200,
        success: false,
        adtMode: 'unspecified',
        hasContext: false,
      });
    }
  });

  it('keeps lock/unlock stateful and closes the same context before returning the result', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
    mockFetch.mockResolvedValueOnce(mockResponse(200, 'locked', {}, ['sap-contextid=CONTEXT_1; Path=/']));
    mockFetch.mockResolvedValueOnce(mockResponse(200, 'unlocked'));
    mockFetch.mockResolvedValueOnce(mockResponse(200, '', {}, ['sap-contextid=0; Path=/']));
    const client = new AdtHttpClient(config);

    const result = await client.withStatefulSession(async (session) => {
      await session.post('/lock', '<xml/>');
      await session.post('/unlock');
      return 'written';
    });

    expect(result).toBe('written');
    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect(request(1).headers['X-sap-adt-sessiontype']).toBe('stateful');
    expect(request(2).headers).toMatchObject({
      'X-sap-adt-sessiontype': 'stateful',
      Cookie: 'sap-contextid=CONTEXT_1',
    });
    expect(request(3)).toMatchObject({
      path: closePath,
      method: 'GET',
      headers: {
        Accept: '*/*',
        'sap-adt-purpose': 'close-session',
        'sap-contextid': 'CONTEXT_1',
        'X-sap-adt-sessiontype': 'stateless',
        Cookie: 'sap-contextid=CONTEXT_1',
      },
    });
  });

  it('inherits authentication state without leaking the child context or stateless transition to the parent', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }, ['SAP_SESSIONID=PARENT; Path=/']));
    mockFetch.mockResolvedValueOnce(mockResponse(200, '', {}, ['sap-contextid=CHILD; Path=/']));
    mockFetch.mockResolvedValueOnce(mockResponse(200, '', {}, ['sap-contextid=0; Path=/']));
    mockFetch.mockResolvedValueOnce(mockResponse(200, 'parent request'));
    const client = new AdtHttpClient(config);
    await client.fetchCsrfToken();

    await client.withStatefulSession((session) => session.post('/lock'));
    await client.post('/parent');

    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect(request(1).headers).toMatchObject({ 'X-CSRF-Token': 'T', Cookie: 'SAP_SESSIONID=PARENT' });
    expect(request(2).headers.Authorization).toBe(request(1).headers.Authorization);
    expect(request(3).headers).toMatchObject({ 'X-CSRF-Token': 'T', Cookie: 'SAP_SESSIONID=PARENT' });
    expect(request(3).headers['X-sap-adt-sessiontype']).toBeUndefined();
  });

  it.each([200, 500])('preserves the callback error when cleanup returns HTTP %s', async (status) => {
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    mockFetch.mockResolvedValueOnce(mockResponse(200, 'opened', {}, ['sap-contextid=CONTEXT_2; Path=/']));
    mockFetch.mockResolvedValueOnce(mockResponse(status, 'cleanup response'));
    const originalError = new Error('write failed');
    const client = new AdtHttpClient(config);

    await expect(
      client.withStatefulSession(async (session) => {
        await session.get('/open');
        throw originalError;
      }),
    ).rejects.toBe(originalError);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(request(1).path).toBe(closePath);
  });

  it.each([403, 500])(
    'preserves success on cleanup HTTP %s without fallback or response text in warnings',
    async (status) => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'opened', {}, ['sap-contextid=CONTEXT_3; Path=/']));
      mockFetch.mockResolvedValueOnce(mockResponse(status, 'PRIVATE_SAP_RESPONSE'));
      const client = new AdtHttpClient(config);

      const result = await client.withStatefulSession(async (session) => {
        await session.get('/open');
        return 'written';
      });

      expect(result).toBe('written');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledExactlyOnceWith('Failed to close stateful ADT session.', { statusCode: status });
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('PRIVATE_SAP_RESPONSE');
    },
  );

  it.each([
    { status: 200, reset: true },
    { status: 400, reset: true },
    { status: 400, reset: false },
  ])(
    'handles a missing close resource with discovery HTTP $status, context reset=$reset',
    async ({ status, reset }) => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'opened', {}, ['sap-contextid=CONTEXT_750; Path=/']));
      mockFetch.mockResolvedValueOnce(mockResponse(404, 'close resource absent'));
      // The NW 7.50 backport resets the context but returns HTTP 400.
      mockFetch.mockResolvedValueOnce(mockResponse(status, '', {}, reset ? ['sap-contextid=0; Path=/'] : []));
      const client = new AdtHttpClient(config);

      const result = await client.withStatefulSession(async (session) => {
        await session.get('/open');
        return 'written';
      });

      expect(result).toBe('written');
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(request(2)).toMatchObject({
        path: '/sap/bc/adt/core/discovery',
        method: 'HEAD',
        headers: { 'X-sap-adt-sessiontype': 'stateless', Cookie: 'sap-contextid=CONTEXT_750' },
      });
      if (reset) expect(warnSpy).not.toHaveBeenCalled();
      else
        expect(warnSpy).toHaveBeenCalledExactlyOnceWith('Failed to close stateful ADT session.', { statusCode: 400 });
    },
  );

  it.each([undefined, '0'])('skips cleanup without an active context (sap-contextid=%s)', async (contextId) => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, '', {}, contextId ? [`sap-contextid=${contextId}; Path=/`] : []));
    const client = new AdtHttpClient(config);

    await client.withStatefulSession((session) => session.get('/no-context'));

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each([200, 500])('redacts the context header from debug audit on cleanup HTTP %s', async (status) => {
    vi.stubEnv('ARC1_LOG_HTTP_DEBUG', 'true');
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const emitSpy = vi.spyOn(logger, 'emitAudit').mockImplementation(() => undefined);
    mockFetch.mockResolvedValueOnce(mockResponse(200, '', {}, ['sap-contextid=PRIVATE_CONTEXT; Path=/']));
    mockFetch.mockResolvedValueOnce(mockResponse(status, '', { 'Sap-ContextId': 'PRIVATE_CONTEXT' }));
    const client = new AdtHttpClient(config);

    await client.withStatefulSession((session) => session.get('/open'));

    const closeEvent = emitSpy.mock.calls
      .map(([event]) => event)
      .find((event) => event.event === 'http_request' && event.path === closePath) as HttpRequestEvent;
    expect(closeEvent.requestHeaders?.['sap-contextid']).toBe('[REDACTED]');
    if (status === 200) expect(closeEvent.responseHeaders?.['sap-contextid']).toBe('[REDACTED]');
    expect(JSON.stringify(emitSpy.mock.calls)).not.toContain('PRIVATE_CONTEXT');
  });
});

describe('sessions a caller opens and ends itself (openStatefulSession)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("starts its own context and remembers the sap-contextid naming SAP's application server", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, '{}', {}, ['sap-contextid=SID%3aANON%3aappserver-t4w2x%3aKX9qZ-NEW; path=/']),
    );
    const parent = new AdtHttpClient(config);
    (parent as any).cookieJar.set('sap-contextid', 'SID%3aANON%3aappserver-old%3aPARENT-NEW');
    const session = parent.openStatefulSession();
    expect(session.sessionContextId).toBeUndefined(); // never inherits a context

    await session.get('/sap/bc/adt/core/http/systeminformation');

    expect(request(0).headers['X-sap-adt-sessiontype']).toBe('stateful');
    expect(session.sessionContextId).toBe('SID%3aANON%3aappserver-t4w2x%3aKX9qZ-NEW');
    expect(parent.sessionContextId).toBe('SID%3aANON%3aappserver-old%3aPARENT-NEW');
  });

  it("ends it with Eclipse's close-session request on that context, and only when there is one", async () => {
    mockFetch.mockResolvedValue(mockResponse(200, ''));
    const session = new AdtHttpClient(config).openStatefulSession();
    expect(await session.endStatefulSession()).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();

    (session as any).cookieJar.set('sap-contextid', 'SID%3aANON%3aappserver-t4w2x%3aKX9qZ-NEW');
    expect(await session.endStatefulSession()).toBe(true);
    expect(request(0)).toMatchObject({ path: closePath, method: 'GET' });
    expect(request(0).headers).toMatchObject({
      'X-sap-adt-sessiontype': 'stateless',
      'sap-adt-purpose': 'close-session',
      'sap-contextid': 'SID%3aANON%3aappserver-t4w2x%3aKX9qZ-NEW',
    });
  });

  it('never fails the caller when SAP does not close the context', async () => {
    mockFetch.mockResolvedValue(mockResponse(500, 'boom'));
    const session = new AdtHttpClient(config).openStatefulSession();
    (session as any).cookieJar.set('sap-contextid', 'SID%3aANON%3aappserver-t4w2x%3aKX9qZ-NEW');
    await expect(session.endStatefulSession({ retryTransientErrors: false })).resolves.toBe(false);
  });
});
