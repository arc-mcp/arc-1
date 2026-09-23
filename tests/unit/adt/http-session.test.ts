import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpRequestEvent } from '../../../src/server/audit.js';
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
