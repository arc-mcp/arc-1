import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtNetworkError } from '../../../src/adt/errors.js';
import { redactAuditEvent } from '../../../src/server/audit.js';
import { logger } from '../../../src/server/logger.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

const mockFetch = vi.fn();
const mockClientRequest = vi.fn();
const mockClientClose = vi.fn();
class MockClient {
  request = mockClientRequest;
  close = mockClientClose;
}
vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<typeof import('undici')>()),
  fetch: mockFetch,
  Client: MockClient,
}));
const { AdtHttpClient } = await import('../../../src/adt/http.js');
const config = { baseUrl: 'https://sap.example.com', client: '001', sessionType: 'stateful' as const };

function request(index: number) {
  const [url, options] = mockFetch.mock.calls[index]!;
  return { path: new URL(url).pathname, method: options.method, headers: options.headers };
}

function rejectStatefulDiscovery() {
  mockFetch.mockResolvedValueOnce(mockResponse(400, 'PRIVATE_BODY', { 'x-csrf-token': 'REJECTED_TOKEN' }));
  mockFetch.mockResolvedValueOnce(mockResponse(400, 'PRIVATE_BODY', { 'x-csrf-token': 'REJECTED_TOKEN' }));
}

function mockClientResponse(statusCode: number, text: string, headers: Record<string, string | string[]> = {}) {
  const body = Object.assign(Readable.from([Buffer.from(text)]), { text: async () => text });
  return { statusCode, headers, body };
}

function clientRequestHeaders(index: number): Record<string, string> {
  return mockClientRequest.mock.calls[index]![0].headers;
}

describe('stateful CSRF discovery recovery (#1044)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockClientRequest.mockReset();
    mockClientClose.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([200, 400])('audits every probe including the headerless GET %s without secrets', async (status) => {
    const emit = vi.spyOn(logger, 'emitAudit').mockImplementation(() => undefined);
    rejectStatefulDiscovery();
    mockFetch.mockResolvedValueOnce(mockResponse(status, 'PRIVATE_BODY', { 'x-csrf-token': 'PRIVATE_TOKEN' }));
    const client = new AdtHttpClient({ ...config, cookies: { 'sap-contextid': 'PRIVATE_CONTEXT' } });
    if (status === 200) await client.fetchCsrfToken();
    else await expect(client.fetchCsrfToken()).rejects.toMatchObject({ statusCode: status });

    const events = emit.mock.calls
      .map(([event]) => redactAuditEvent(event))
      .filter((e) => e.event === 'http_csrf_fetch');
    expect(events).toMatchObject([
      { method: 'HEAD', statusCode: 400, success: false, adtMode: 'stateful', hasContext: true },
      { method: 'GET', statusCode: 400, success: false, adtMode: 'stateful', hasContext: true },
      { method: 'GET', statusCode: status, success: status === 200, adtMode: 'unspecified', hasContext: true },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/PRIVATE_|REJECTED_TOKEN/);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it.each([undefined, 'stateless'] as const)('does not relax session mode %s', async (sessionType) => {
    rejectStatefulDiscovery();
    await expect(new AdtHttpClient({ ...config, sessionType }).fetchCsrfToken()).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(request(1).headers['X-sap-adt-sessiontype']).toBe(sessionType);
  });

  it.each([200, 403, 405])('does not broaden recovery when HEAD returned %s', async (status) => {
    mockFetch.mockResolvedValueOnce(mockResponse(status, ''));
    mockFetch.mockResolvedValueOnce(mockResponse(400, ''));
    await expect(new AdtHttpClient(config).fetchCsrfToken()).rejects.toMatchObject({ statusCode: 400 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 500])('preserves the stateful GET failure %s', async (status) => {
    mockFetch.mockResolvedValueOnce(mockResponse(400, ''));
    mockFetch.mockResolvedValueOnce(mockResponse(status, '', { 'x-csrf-token': 'REJECTED_TOKEN' }));
    await expect(new AdtHttpClient(config).fetchCsrfToken()).rejects.toMatchObject({ statusCode: status });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 403, 500])('rejects a token from headerless failure %s without further probes', async (status) => {
    rejectStatefulDiscovery();
    mockFetch.mockResolvedValueOnce(mockResponse(status, '', { 'x-csrf-token': 'REJECTED_TOKEN' }));
    await expect(new AdtHttpClient(config).fetchCsrfToken()).rejects.toMatchObject({ statusCode: status });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('rejects a headerless login page before any write', async () => {
    rejectStatefulDiscovery();
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, '<html><body>System Logon</body></html>', { 'content-type': 'text/html' }),
    );
    await expect(new AdtHttpClient(config).post('/lock')).rejects.toMatchObject({ statusCode: 401 });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('keeps legacy discovery bounded when the headerless response is tokenless', async () => {
    rejectStatefulDiscovery();
    mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'required' }));
    mockFetch.mockResolvedValueOnce(mockResponse(200, ''));
    await expect(new AdtHttpClient(config).post('/lock')).rejects.toMatchObject({
      statusCode: 200,
      path: '/sap/bc/adt/discovery',
    });
    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect(request(3).headers['X-sap-adt-sessiontype']).toBeUndefined();
  });

  it.each(['deadline', 'abort'] as const)('honors caller %s before the headerless attempt', async (kind) => {
    const controller = new AbortController();
    const options = { deadline: Date.now() + 60_000, signal: controller.signal };
    mockFetch.mockResolvedValueOnce(mockResponse(400, ''));
    mockFetch.mockImplementationOnce(async () => {
      if (kind === 'deadline') options.deadline = Date.now() - 1;
      else controller.abort();
      return mockResponse(400, '');
    });
    await expect(new AdtHttpClient(config).fetchCsrfToken(options)).rejects.toBeInstanceOf(AdtNetworkError);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it.each([200, 400])('preserves identity and the lock lifecycle when PUT returns %s', async (status) => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    mockFetch.mockResolvedValueOnce(mockResponse(400, '', {}, ['SAP_SESSIONID=FIRST; Path=/']));
    mockFetch.mockResolvedValueOnce(mockResponse(400, '', {}, ['SAP_SESSIONID=SECOND; Path=/']));
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, '', { 'x-csrf-token': 'TOKEN' }, ['SAP_SESSIONID=FINAL; Path=/']),
    );
    mockFetch.mockResolvedValueOnce(mockResponse(200, 'locked', {}, ['sap-contextid=CONTEXT; Path=/']));
    mockFetch.mockResolvedValueOnce(mockResponse(status, 'write result'));
    mockFetch.mockResolvedValueOnce(mockResponse(200, 'unlocked'));
    mockFetch.mockResolvedValueOnce(mockResponse(200, '', {}, ['sap-contextid=0; Path=/']));
    const client = new AdtHttpClient({
      ...config,
      sapConnectivityAuth: 'Bearer PRIVATE_USER',
      disableSaml: true,
      username: 'must-not-fallback',
      password: 'must-not-fallback',
    });
    const operation = client.withStatefulSession(async (session) => {
      await session.post('/lock');
      try {
        return await session.put('/source', 'replacement');
      } finally {
        await session.post('/unlock');
      }
    });
    if (status === 200) await expect(operation).resolves.toMatchObject({ statusCode: status });
    else await expect(operation).rejects.toMatchObject({ statusCode: status, path: '/source' });

    expect(mockFetch).toHaveBeenCalledTimes(7);
    expect(request(1).headers.Cookie).toBe('SAP_SESSIONID=FIRST');
    expect(request(2).headers.Cookie).toBe('SAP_SESSIONID=SECOND');
    expect(request(2).headers['X-sap-adt-sessiontype']).toBeUndefined();
    for (const index of [3, 4, 5]) {
      expect(request(index).headers).toMatchObject({ 'X-sap-adt-sessiontype': 'stateful', 'X-CSRF-Token': 'TOKEN' });
      expect(request(index).headers.Cookie).toContain('SAP_SESSIONID=FINAL');
    }
    expect(request(4).headers.Cookie).toContain('sap-contextid=CONTEXT');
    expect(request(5).headers.Cookie).toContain('sap-contextid=CONTEXT');
    expect(request(6)).toMatchObject({
      path: '/sap/bc/adt/core/http/sessions',
      headers: { 'X-sap-adt-sessiontype': 'stateless', 'sap-contextid': 'CONTEXT' },
    });
    for (let index = 0; index < 7; index++) {
      expect(request(index).headers).toMatchObject({
        'SAP-Connectivity-Authentication': 'Bearer PRIVATE_USER',
        'X-SAP-SAML2': 'disabled',
      });
      expect(request(index).headers.Authorization).toBeUndefined();
    }
    expect(warn).not.toHaveBeenCalled();
  });
  it.each([200, 403])('keeps the lock context during CSRF refresh when the retried PUT returns %s', async (status) => {
    const client = new AdtHttpClient({ ...config, sessionType: undefined, username: 'user', password: 'password' });
    mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'PARENT' }));
    await client.fetchCsrfToken();
    mockFetch.mockClear();

    mockFetch.mockResolvedValueOnce(mockResponse(200, 'locked', {}, ['sap-contextid=LOCKCTX; Path=/']));
    mockFetch.mockResolvedValueOnce(mockResponse(403, 'refresh required'));
    rejectStatefulDiscovery();
    mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'FRESH' }));
    mockFetch.mockResolvedValueOnce(mockResponse(status, 'write result'));
    mockFetch.mockResolvedValueOnce(mockResponse(200, 'unlocked'));
    mockFetch.mockResolvedValueOnce(mockResponse(200, '', {}, ['sap-contextid=0; Path=/']));

    const operation = client.withStatefulSession(async (session) => {
      await session.post('/lock');
      try {
        return await session.put('/source', 'replacement');
      } finally {
        await session.post('/unlock');
      }
    });
    if (status === 200) await expect(operation).resolves.toMatchObject({ statusCode: status });
    else await expect(operation).rejects.toMatchObject({ statusCode: status, path: '/source' });

    expect(mockFetch).toHaveBeenCalledTimes(8);
    expect(request(0).headers['X-CSRF-Token']).toBe('PARENT');
    for (const index of [2, 3]) expect(request(index).headers['X-sap-adt-sessiontype']).toBe('stateful');
    expect(request(4).headers['X-sap-adt-sessiontype']).toBeUndefined();
    for (const index of [5, 6]) {
      expect(request(index).headers).toMatchObject({ 'X-sap-adt-sessiontype': 'stateful', 'X-CSRF-Token': 'FRESH' });
    }
    for (let index = 1; index < 8; index++) {
      expect(request(index).headers.Cookie).toContain('sap-contextid=LOCKCTX');
      expect(request(index).headers.Authorization).toBe(request(0).headers.Authorization);
    }
    expect(request(0).headers.Authorization).toBe(`Basic ${Buffer.from('user:password').toString('base64')}`);
    expect(request(7)).toMatchObject({
      path: '/sap/bc/adt/core/http/sessions',
      headers: { 'X-sap-adt-sessiontype': 'stateless', 'sap-contextid': 'LOCKCTX' },
    });
  });

  it('keeps BTP identity and the proxy connection through headerless CSRF recovery and a stateful write', async () => {
    mockClientRequest
      .mockResolvedValueOnce(mockClientResponse(400, ''))
      .mockResolvedValueOnce(mockClientResponse(400, ''))
      .mockResolvedValueOnce(
        mockClientResponse(200, '', { 'x-csrf-token': 'TOKEN', 'set-cookie': ['SAP_SESSIONID=SESSION; Path=/'] }),
      )
      .mockResolvedValueOnce(mockClientResponse(200, 'locked', { 'set-cookie': ['sap-contextid=CONTEXT; Path=/'] }))
      .mockResolvedValueOnce(mockClientResponse(200, 'written'))
      .mockResolvedValueOnce(mockClientResponse(200, 'unlocked'))
      .mockResolvedValueOnce(mockClientResponse(200, '', { 'set-cookie': ['sap-contextid=0; Path=/'] }));
    const client = new AdtHttpClient({
      ...config,
      sapConnectivityAuth: 'Bearer user-token',
      btpProxy: {
        host: 'proxy.example.com',
        port: 20003,
        protocol: 'http',
        getProxyToken: async () => 'proxy-token',
      },
    });

    await client.withStatefulSession(async (session) => {
      await session.post('/lock');
      await session.put('/source', 'replacement');
      await session.post('/unlock');
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockClientRequest).toHaveBeenCalledTimes(7);
    expect(mockClientClose).toHaveBeenCalledOnce();
    expect(clientRequestHeaders(2)['X-sap-adt-sessiontype']).toBeUndefined();
    for (let index = 0; index < 7; index++) {
      expect(clientRequestHeaders(index)).toMatchObject({
        'SAP-Connectivity-Authentication': 'Bearer user-token',
        'Proxy-Authorization': 'Bearer proxy-token',
      });
      expect(clientRequestHeaders(index).Authorization).toBeUndefined();
    }
    for (const index of [3, 4, 5]) {
      expect(clientRequestHeaders(index)).toMatchObject({
        'X-sap-adt-sessiontype': 'stateful',
        'X-CSRF-Token': 'TOKEN',
      });
      expect(clientRequestHeaders(index).Cookie).toContain('SAP_SESSIONID=SESSION');
    }
    expect(clientRequestHeaders(6)).toMatchObject({
      'X-sap-adt-sessiontype': 'stateless',
      'sap-contextid': 'CONTEXT',
    });
  });
});
