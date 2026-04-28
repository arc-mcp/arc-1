import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError, AdtNetworkError } from '../../../src/adt/errors.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

// Mock undici's fetch and Client (used by AdtHttpClient.doFetch / doProxyRequest)
const mockFetch = vi.fn();
const mockClientRequest = vi.fn();
const mockClientClose = vi.fn().mockResolvedValue(undefined);

class MockClient {
  request = mockClientRequest;
  close = mockClientClose;
}

vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: mockFetch, Client: MockClient };
});

// Import after mock setup
const { AdtHttpClient } = await import('../../../src/adt/http.js');
type AdtHttpConfig = ConstructorParameters<typeof AdtHttpClient>[0];

function getDefaultConfig(): AdtHttpConfig {
  return {
    baseUrl: 'http://sap.example.com:8000',
    username: 'admin',
    password: 'secret',
    client: '001',
    language: 'EN',
  };
}

/** Helper to get the options (second arg) from a fetch call */
function fetchOptions(callIndex = 0): RequestInit & Record<string, unknown> {
  return mockFetch.mock.calls[callIndex]?.[1] ?? {};
}

/** Helper to get the URL (first arg) from a fetch call */
function fetchUrl(callIndex = 0): string {
  return mockFetch.mock.calls[callIndex]?.[0] ?? '';
}

/** Helper to get headers from a fetch call */
function fetchHeaders(callIndex = 0): Record<string, string> {
  return (fetchOptions(callIndex).headers as Record<string, string>) ?? {};
}

/** Helper to create a mock undici Client response (for proxy tests) */
function mockClientResponse(statusCode: number, body: string, headers: Record<string, string> = {}) {
  return {
    statusCode,
    headers,
    body: { text: async () => body },
  };
}

/** Helper to get headers from a Client.request call */
function clientRequestHeaders(callIndex = 0): Record<string, string> {
  return (mockClientRequest.mock.calls[callIndex]?.[0]?.headers as Record<string, string>) ?? {};
}

/** Helper to get the path from a Client.request call */
function clientRequestPath(callIndex = 0): string {
  return mockClientRequest.mock.calls[callIndex]?.[0]?.path ?? '';
}

describe('AdtHttpClient', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ─── GET Requests ──────────────────────────────────────────────────

  describe('GET requests', () => {
    it('makes a GET request to the correct URL with sap-client and sap-language', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, '<source>REPORT zhello.</source>'));

      const client = new AdtHttpClient(getDefaultConfig());
      const response = await client.get('/sap/bc/adt/programs/programs/ZHELLO/source/main');

      expect(fetchOptions(0).method).toBe('GET');
      expect(fetchUrl(0)).toContain('/sap/bc/adt/programs/programs/ZHELLO/source/main');
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('REPORT zhello');
    });

    it('includes sap-client and sap-language in URL', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, ''));

      const client = new AdtHttpClient(getDefaultConfig());
      await client.get('/sap/bc/adt/core/discovery');

      expect(fetchUrl(0)).toContain('sap-client=001');
      expect(fetchUrl(0)).toContain('sap-language=EN');
    });

    it('handles response with empty body', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, ''));
      const client = new AdtHttpClient(getDefaultConfig());
      const resp = await client.get('/some/path');
      expect(resp.body).toBe('');
    });

    it('passes extra headers through', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));
      const client = new AdtHttpClient(getDefaultConfig());
      await client.get('/path', { Accept: 'application/xml' });
      expect(fetchHeaders(0).Accept).toBe('application/xml');
    });

    it('omits sap-client and sap-language when not configured', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, ''));
      const client = new AdtHttpClient({ baseUrl: 'http://sap:8000' });
      await client.get('/sap/bc/adt/core/discovery');
      expect(fetchUrl(0)).not.toContain('sap-client');
      expect(fetchUrl(0)).not.toContain('sap-language');
    });
  });

  // ─── POST/PUT/DELETE ───────────────────────────────────────────────

  describe('modifying requests', () => {
    it('POST sends body and content type', async () => {
      // CSRF fetch
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      // POST
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'created'));

      const client = new AdtHttpClient(getDefaultConfig());
      const resp = await client.post('/path', '<xml/>', 'application/xml');
      expect(resp.body).toBe('created');
      expect(fetchHeaders(1)['Content-Type']).toBe('application/xml');
    });

    it('PUT sends body and content type', async () => {
      // CSRF fetch
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      // PUT
      mockFetch.mockResolvedValueOnce(mockResponse(200, ''));

      const client = new AdtHttpClient(getDefaultConfig());
      await client.put('/path', 'source code', 'text/plain');
      expect(fetchOptions(1).method).toBe('PUT');
      expect(fetchOptions(1).body).toBe('source code');
    });

    it('DELETE request works', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, ''));

      const client = new AdtHttpClient(getDefaultConfig());
      await client.delete('/path');
      expect(fetchOptions(1).method).toBe('DELETE');
    });
  });

  // ─── CSRF Token Handling ───────────────────────────────────────────

  describe('CSRF token handling', () => {
    it('fetches CSRF token before first modifying request', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'TOKEN123' }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient(getDefaultConfig());
      await client.post('/sap/bc/adt/checkruns', '<xml/>', 'application/xml');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      // First call is CSRF fetch (HEAD)
      expect(fetchOptions(0).method).toBe('HEAD');
      expect(fetchHeaders(0)['X-CSRF-Token']).toBe('fetch');
      // Second call uses the token
      expect(fetchHeaders(1)['X-CSRF-Token']).toBe('TOKEN123');
    });

    it('retries CSRF fetch with GET when HEAD returns 403 (S/4HANA Public Cloud compat)', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(403, 'Forbidden'));
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'TOKEN' }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient(getDefaultConfig());
      await client.post('/sap/bc/adt/checkruns', '<xml/>', 'application/xml');

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(fetchOptions(0).method).toBe('HEAD');
      expect(fetchOptions(1).method).toBe('GET');
      expect(fetchHeaders(2)['X-CSRF-Token']).toBe('TOKEN');
    });

    it('throws when both HEAD and GET return 403', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(403, 'Forbidden'));
      mockFetch.mockResolvedValueOnce(mockResponse(403, 'Forbidden'));

      const client = new AdtHttpClient(getDefaultConfig());
      try {
        await client.fetchCsrfToken();
        throw new Error('Expected fetchCsrfToken to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(AdtApiError);
        expect(error).toMatchObject({
          statusCode: 403,
          message: expect.stringMatching(/forbidden/i),
        });
      }
    });

    it('does not use GET fallback when HEAD returns 401', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(401, 'Unauthorized'));

      const client = new AdtHttpClient(getDefaultConfig());
      await expect(client.fetchCsrfToken()).rejects.toMatchObject({
        statusCode: 401,
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(fetchOptions(0).method).toBe('HEAD');
    });

    it('does not re-fetch CSRF token for second POST', async () => {
      // CSRF fetch
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T1' }));
      // First POST
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));
      // Second POST (should reuse token)
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok2'));

      const client = new AdtHttpClient(getDefaultConfig());
      await client.post('/path1', '<xml/>');
      await client.post('/path2', '<xml/>');
      expect(mockFetch).toHaveBeenCalledTimes(3); // CSRF + 2 POSTs
    });

    it('does not fetch CSRF token for GET requests', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));
      const client = new AdtHttpClient(getDefaultConfig());
      await client.get('/path');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('retries on 403 with fresh CSRF token', async () => {
      // CSRF fetch
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'OLD_TOKEN' }));
      // POST → 403
      mockFetch.mockResolvedValueOnce(mockResponse(403, 'CSRF token expired'));
      // Re-fetch CSRF
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'NEW_TOKEN' }));
      // Retry POST → 200
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'success'));

      const client = new AdtHttpClient(getDefaultConfig());
      const response = await client.post('/sap/bc/adt/activation', '<xml/>');

      expect(response.statusCode).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('stores CSRF token from any response header', async () => {
      // GET response includes a token
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok', { 'x-csrf-token': 'FROM_GET' }));
      // POST should use that token (no separate CSRF fetch)
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'created'));

      const client = new AdtHttpClient(getDefaultConfig());
      await client.get('/path');
      await client.post('/path2', '<xml/>');

      // Should use token from GET response, so only 2 calls total
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(fetchHeaders(1)['X-CSRF-Token']).toBe('FROM_GET');
    });

    it('ignores "Required" token value in response headers', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok', { 'x-csrf-token': 'Required' }));

      const client = new AdtHttpClient(getDefaultConfig());
      await client.get('/path');
      // csrfToken should still be empty — so next POST will fetch
    });
  });

  // ─── Cookie Jar ────────────────────────────────────────────────────

  describe('cookie jar', () => {
    it('persists Set-Cookie headers from responses', async () => {
      // First request returns cookies
      mockFetch.mockResolvedValueOnce(
        mockResponse(200, 'ok', {}, [
          'SAP_SESSIONID_A4H_001=abc123; Path=/; HttpOnly',
          'sap-usercontext=lang=EN; Path=/',
        ]),
      );
      // Second request should include those cookies
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok2'));

      const client = new AdtHttpClient(getDefaultConfig());
      await client.get('/first');
      await client.get('/second');

      const secondHeaders = fetchHeaders(1);
      expect(secondHeaders.Cookie).toContain('SAP_SESSIONID_A4H_001=abc123');
      expect(secondHeaders.Cookie).toContain('sap-usercontext=lang=EN');
    });

    it('CSRF token works with cookie jar (session correlation)', async () => {
      // CSRF fetch → returns session cookie
      mockFetch.mockResolvedValueOnce(
        mockResponse(200, '', { 'x-csrf-token': 'TOKEN_ABC' }, ['SAP_SESSIONID=sess123; Path=/']),
      );
      // POST should include both token AND cookie
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'created'));

      const client = new AdtHttpClient(getDefaultConfig());
      await client.post('/sap/bc/adt/datapreview/ddic', 'data', 'text/plain');

      const postHeaders = fetchHeaders(1);
      expect(postHeaders['X-CSRF-Token']).toBe('TOKEN_ABC');
      expect(postHeaders.Cookie).toContain('SAP_SESSIONID=sess123');
    });

    it('merges config cookies with jar cookies', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok', {}, ['jarCookie=jar1; Path=/']));
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok2'));

      const client = new AdtHttpClient({
        ...getDefaultConfig(),
        cookies: { configCookie: 'cfg1' },
      });
      await client.get('/first');
      await client.get('/second');

      const headers = fetchHeaders(1);
      expect(headers.Cookie).toContain('configCookie=cfg1');
      expect(headers.Cookie).toContain('jarCookie=jar1');
    });

    it('handles Set-Cookie with no value gracefully', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok', {}, ['=noname; Path=/']));
      const client = new AdtHttpClient(getDefaultConfig());
      // Should not throw
      await client.get('/path');
    });
  });

  // ─── Error Handling ────────────────────────────────────────────────

  describe('error handling', () => {
    it('throws AdtApiError on 404', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(404, 'Object not found'));

      const client = new AdtHttpClient(getDefaultConfig());
      await expect(client.get('/sap/bc/adt/programs/programs/ZNOTFOUND/source/main')).rejects.toThrow(AdtApiError);
    });

    it('throws AdtApiError on 500', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(500, 'Internal Server Error'));

      const client = new AdtHttpClient(getDefaultConfig());
      await expect(client.get('/sap/bc/adt/core/discovery')).rejects.toThrow(AdtApiError);
    });

    it('throws AdtApiError(401) when ADT path returns HTML login page', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse(200, '<html><body>login</body></html>', { 'content-type': 'text/html; charset=UTF-8' }),
      );

      const client = new AdtHttpClient(getDefaultConfig());
      await expect(client.get('/sap/bc/adt/core/discovery')).rejects.toMatchObject({
        statusCode: 401,
        message: expect.stringContaining('HTML login page'),
      });
    });

    it('throws AdtApiError(401) when ADT path returns a DOCTYPE logon document', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse(200, '<!DOCTYPE html>\n<html><head><title>System Logon</title></head></html>', {
          'content-type': 'text/html; charset=UTF-8',
        }),
      );

      const client = new AdtHttpClient(getDefaultConfig());
      await expect(client.get('/sap/bc/adt/core/discovery')).rejects.toMatchObject({
        statusCode: 401,
        message: expect.stringContaining('HTML login page'),
      });
    });

    it('passes through HTML fragment responses (e.g. gateway error log detail)', async () => {
      // Real /sap/bc/adt/gw/errorlog/{type}/{tx} returns HTML fragments that
      // start with <h4 id="..."> and have text/html content-type — they must
      // not trigger the login-page heuristic.
      const fragment = '<h4 id="OVERVIEW"><u>Content</u></h4><a href="#HEADER">Header Information</a><br>';
      mockFetch.mockResolvedValueOnce(mockResponse(200, fragment, { 'content-type': 'text/html; charset=utf-8' }));

      const client = new AdtHttpClient(getDefaultConfig());
      const response = await client.get('/sap/bc/adt/gw/errorlog/FrontendError/ABC123');

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(fragment);
    });

    it('accepts XML response on ADT path', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, '<adt/>', { 'content-type': 'application/xml' }));

      const client = new AdtHttpClient(getDefaultConfig());
      const response = await client.get('/sap/bc/adt/core/discovery');

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('<adt/>');
    });

    it('throws AdtApiError on 401 during CSRF fetch with client info', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(401, 'Unauthorized'));

      const client = new AdtHttpClient(getDefaultConfig());
      await expect(client.fetchCsrfToken()).rejects.toThrow(/sap-client=001/);
    });

    it('throws AdtApiError on 403 during CSRF fetch', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(403, 'Forbidden'));
      mockFetch.mockResolvedValueOnce(mockResponse(403, 'Forbidden'));

      const client = new AdtHttpClient(getDefaultConfig());
      await expect(client.fetchCsrfToken()).rejects.toThrow(AdtApiError);
    });

    it('throws AdtApiError when CSRF token is missing from response', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, ''));

      const client = new AdtHttpClient(getDefaultConfig());
      await expect(client.fetchCsrfToken()).rejects.toThrow(AdtApiError);
    });

    it('truncates long error bodies to 500 chars', async () => {
      const longBody = 'X'.repeat(1000);
      mockFetch.mockResolvedValueOnce(mockResponse(404, longBody));

      const client = new AdtHttpClient(getDefaultConfig());
      try {
        await client.get('/path');
      } catch (e) {
        expect((e as AdtApiError).message.length).toBeLessThanOrEqual(600);
      }
    });

    it('wraps network errors in AdtNetworkError', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

      const client = new AdtHttpClient(getDefaultConfig());
      await expect(client.get('/path')).rejects.toThrow(AdtNetworkError);
    });

    it('wraps CSRF fetch network errors in AdtNetworkError', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

      const client = new AdtHttpClient(getDefaultConfig());
      await expect(client.fetchCsrfToken()).rejects.toThrow(AdtNetworkError);
    });

    it('wraps all non-AdtApiError errors as AdtNetworkError', async () => {
      // Previously TypeError would pass through — now all errors become AdtNetworkError
      mockFetch.mockRejectedValueOnce(new TypeError('null'));
      const client = new AdtHttpClient(getDefaultConfig());
      await expect(client.get('/path')).rejects.toThrow(AdtNetworkError);
    });
  });

  // ─── Config Cookies ────────────────────────────────────────────────

  describe('config cookies', () => {
    it('includes cookies in request headers', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient({
        ...getDefaultConfig(),
        cookies: { 'sap-usercontext': 'abc', SAP_SESSIONID: 'xyz' },
      });
      await client.get('/sap/bc/adt/core/discovery');

      expect(fetchHeaders(0).Cookie).toContain('sap-usercontext=abc');
      expect(fetchHeaders(0).Cookie).toContain('SAP_SESSIONID=xyz');
    });

    it('sends cookies with CSRF fetch when configured', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'TOKEN' }));

      const client = new AdtHttpClient({
        ...getDefaultConfig(),
        cookies: { 'sap-usercontext': 'abc' },
      });
      await client.fetchCsrfToken();

      expect(fetchHeaders(0).Cookie).toContain('sap-usercontext=abc');
    });
  });

  // ─── Stateful Sessions ─────────────────────────────────────────────

  describe('stateful sessions', () => {
    it('creates isolated session for withStatefulSession', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'SESSION_TOKEN' }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'locked'));

      const client = new AdtHttpClient(getDefaultConfig());
      (client as any).csrfToken = 'MAIN_TOKEN';

      await client.withStatefulSession(async (session) => {
        const resp = await session.post('/sap/bc/adt/lock', '<lock/>');
        return resp;
      });
    });

    it('session client includes stateful header', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'locked'));

      const client = new AdtHttpClient(getDefaultConfig());
      (client as any).csrfToken = 'T';

      await client.withStatefulSession(async (session) => {
        await session.post('/lock', '<xml/>');
      });

      // The POST from session client should have stateful header
      const lastCallHeaders = fetchHeaders(mockFetch.mock.calls.length - 1);
      expect(lastCallHeaders['X-sap-adt-sessiontype']).toBe('stateful');
    });

    it('session client shares CSRF token with parent', async () => {
      const client = new AdtHttpClient(getDefaultConfig());
      (client as any).csrfToken = 'PARENT_TOKEN';

      await client.withStatefulSession(async (session) => {
        // Session should have the parent's token
        expect((session as any).csrfToken).toBe('PARENT_TOKEN');
      });
    });

    it('session client shares cookie jar with parent', async () => {
      const client = new AdtHttpClient(getDefaultConfig());
      (client as any).cookieJar.set('SAP_SESSIONID', 'sess1');

      await client.withStatefulSession(async (session) => {
        expect((session as any).cookieJar.get('SAP_SESSIONID')).toBe('sess1');
      });
    });
  });

  // ─── URL Building ──────────────────────────────────────────────────

  describe('URL building', () => {
    it('handles trailing slash in baseUrl', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, ''));
      const client = new AdtHttpClient({ ...getDefaultConfig(), baseUrl: 'http://sap:8000/' });
      await client.get('/sap/bc/adt/core/discovery');
      expect(fetchUrl(0)).not.toContain('//sap/bc');
    });

    it('handles path without leading slash', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, ''));
      const client = new AdtHttpClient(getDefaultConfig());
      await client.get('sap/bc/adt/core/discovery');
      expect(fetchUrl(0)).toContain('/sap/bc/adt/core/discovery');
    });
  });

  describe('SAML disable', () => {
    it('adds X-SAP-SAML2 header when disableSaml=true', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient({ ...getDefaultConfig(), disableSaml: true });
      await client.get('/sap/bc/adt/core/discovery');

      expect(fetchHeaders(0)['X-SAP-SAML2']).toBe('disabled');
    });

    it('adds saml2=disabled query param when disableSaml=true', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient({ ...getDefaultConfig(), disableSaml: true });
      await client.get('/sap/bc/adt/core/discovery');

      expect(fetchUrl(0)).toContain('saml2=disabled');
    });

    it('does not add SAML header or query param when disableSaml=false', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient(getDefaultConfig());
      await client.get('/sap/bc/adt/core/discovery');

      expect(fetchHeaders(0)['X-SAP-SAML2']).toBeUndefined();
      expect(fetchUrl(0)).not.toContain('saml2=disabled');
    });
  });

  // ─── TLS / Insecure ────────────────────────────────────────────────

  describe('insecure mode', () => {
    it('creates client with undici Agent when insecure=true', () => {
      const client = new AdtHttpClient({ ...getDefaultConfig(), insecure: true });
      expect(client).toBeDefined();
      // Verify a dispatcher was created
      expect((client as any).dispatcher).toBeDefined();
    });

    it('does not create dispatcher when insecure=false', () => {
      const client = new AdtHttpClient(getDefaultConfig());
      expect((client as any).dispatcher).toBeUndefined();
    });
  });

  // ─── Basic Auth ────────────────────────────────────────────────────

  describe('basic auth', () => {
    it('sends Authorization Basic header with correct encoding', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient(getDefaultConfig());
      await client.get('/path');

      const expectedAuth = `Basic ${Buffer.from('admin:secret').toString('base64')}`;
      expect(fetchHeaders(0).Authorization).toBe(expectedAuth);
    });

    it('does not send Basic Auth when bearerTokenProvider is configured', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient({
        ...getDefaultConfig(),
        bearerTokenProvider: async () => 'bearer-token-123',
      });
      await client.get('/path');

      expect(fetchHeaders(0).Authorization).toBe('Bearer bearer-token-123');
      expect(fetchHeaders(0).Authorization).not.toContain('Basic');
    });

    it('does not send Basic Auth when sapConnectivityAuth is configured', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient({
        ...getDefaultConfig(),
        sapConnectivityAuth: 'Bearer saml-assertion-for-user',
      });
      await client.get('/path');

      expect(fetchHeaders(0).Authorization).toBeUndefined();
    });

    it('does not send Basic Auth when ppProxyAuth is configured', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient({
        ...getDefaultConfig(),
        ppProxyAuth: 'Bearer exchanged-token',
      });
      await client.get('/path');

      expect(fetchHeaders(0).Authorization).toBeUndefined();
    });

    it('does not send Authorization when no credentials configured', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient({ baseUrl: 'http://sap:8000' });
      await client.get('/path');

      expect(fetchHeaders(0).Authorization).toBeUndefined();
    });

    it('sends Basic Auth header with CSRF fetch', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'CSRF_TOKEN_OK' }));

      const client = new AdtHttpClient(getDefaultConfig());
      await client.fetchCsrfToken();

      const expectedAuth = `Basic ${Buffer.from('admin:secret').toString('base64')}`;
      expect(fetchHeaders(0).Authorization).toBe(expectedAuth);
    });
  });

  // ─── Timeout ───────────────────────────────────────────────────────

  describe('timeout', () => {
    it('passes AbortSignal.timeout to fetch', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient(getDefaultConfig());
      await client.get('/path');

      // Verify signal was passed
      expect(fetchOptions(0).signal).toBeDefined();
    });

    it('wraps timeout errors as AdtNetworkError', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      mockFetch.mockRejectedValueOnce(abortError);

      const client = new AdtHttpClient(getDefaultConfig());
      await expect(client.get('/path')).rejects.toThrow(AdtNetworkError);
    });
  });

  // ─── Principal Propagation ─────────────────────────────────────────

  describe('principal propagation', () => {
    it('sends SAP-Connectivity-Authentication header when sapConnectivityAuth is set', async () => {
      const ppConfig: AdtHttpConfig = {
        ...getDefaultConfig(),
        sapConnectivityAuth: 'Bearer saml-assertion-for-user',
      };
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'OK'));

      const client = new AdtHttpClient(ppConfig);
      await client.get('/sap/bc/adt/programs/programs/ZTEST/source/main');

      expect(fetchHeaders(0)['SAP-Connectivity-Authentication']).toBe('Bearer saml-assertion-for-user');
    });

    it('does NOT send SAP-Connectivity-Authentication when not configured', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'OK'));

      const client = new AdtHttpClient(getDefaultConfig());
      await client.get('/sap/bc/adt/programs/programs/ZTEST/source/main');

      expect(fetchHeaders(0)['SAP-Connectivity-Authentication']).toBeUndefined();
    });

    it('sends SAP-Connectivity-Authentication on the CSRF fetch so the token binds to the user session', async () => {
      const ppConfig: AdtHttpConfig = {
        ...getDefaultConfig(),
        sapConnectivityAuth: 'Bearer saml-assertion-for-user',
      };
      // CSRF fetch (HEAD) → token returned
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'PP_TOKEN' }));
      // POST → 200
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient(ppConfig);
      await client.post('/sap/bc/adt/repository/informationsystem/search', 'body', 'application/xml');

      expect(fetchHeaders(0)['SAP-Connectivity-Authentication']).toBe('Bearer saml-assertion-for-user');
      expect(fetchHeaders(1)['SAP-Connectivity-Authentication']).toBe('Bearer saml-assertion-for-user');
    });

    it('omits SAP-Connectivity-Authentication on CSRF fetch when ppProxyAuth (Option 1) is used', async () => {
      const ppConfig: AdtHttpConfig = {
        ...getDefaultConfig(),
        sapConnectivityAuth: 'Bearer saml-assertion-for-user',
        ppProxyAuth: 'Bearer exchanged-token',
      };
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'PP_TOKEN' }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient(ppConfig);
      await client.post('/sap/bc/adt/repository/informationsystem/search', 'body', 'application/xml');

      expect(fetchHeaders(0)['SAP-Connectivity-Authentication']).toBeUndefined();
      expect(fetchHeaders(1)['SAP-Connectivity-Authentication']).toBeUndefined();
    });
  });

  // ─── Proactive MIME Discovery ─────────────────────────────────────

  describe('discovery-aware header selection', () => {
    it('uses discovered Accept for object-level paths (shallow match)', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient(getDefaultConfig());
      client.setDiscoveryMap(new Map([['/sap/bc/adt/oo/classes', ['application/vnd.sap.adt.oo.classes.v4+xml']]]));

      await client.get('/sap/bc/adt/oo/classes/ZCL_FOO');
      expect(fetchHeaders(0).Accept).toBe('application/vnd.sap.adt.oo.classes.v4+xml');
    });

    it('does NOT apply discovery to deep sub-resource paths like /source/main', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient(getDefaultConfig());
      client.setDiscoveryMap(new Map([['/sap/bc/adt/oo/classes', ['application/vnd.sap.adt.oo.classes.v4+xml']]]));

      await client.get('/sap/bc/adt/oo/classes/ZCL_FOO/source/main');
      expect(fetchHeaders(0).Accept).toBe('*/*');
    });

    it('does not override explicit Accept with discovery result', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient(getDefaultConfig());
      client.setDiscoveryMap(new Map([['/sap/bc/adt/oo/classes', ['application/vnd.sap.adt.oo.classes.v4+xml']]]));

      await client.get('/sap/bc/adt/oo/classes/ZCL_FOO', { Accept: 'application/xml' });
      expect(fetchHeaders(0).Accept).toBe('application/xml');
    });

    it('falls back to default Accept for unknown paths', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient(getDefaultConfig());
      client.setDiscoveryMap(new Map([['/sap/bc/adt/oo/classes', ['application/vnd.sap.adt.oo.classes.v4+xml']]]));

      await client.get('/sap/bc/adt/unmapped/endpoint');
      expect(fetchHeaders(0).Accept).toBe('*/*');
    });

    it('keeps default behavior when discovery map is empty', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient(getDefaultConfig());
      await client.get('/sap/bc/adt/programs/programs/ZHELLO/source/main');
      expect(fetchHeaders(0).Accept).toBe('*/*');
    });

    it('caches successful 406 retry headers for later requests', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(406, 'Not Acceptable'));
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok2'));

      const client = new AdtHttpClient(getDefaultConfig());
      await client.get('/sap/bc/adt/repository/informationsystem/search', { Accept: 'application/custom+xml' });
      await client.get('/sap/bc/adt/repository/informationsystem/search');

      expect(fetchHeaders(2).Accept).toBe('application/xml');
    });

    it('caches successful 415 retry Content-Type for later writes', async () => {
      // CSRF fetch
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      // First POST and retry
      mockFetch.mockResolvedValueOnce(mockResponse(415, 'Unsupported'));
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));
      // Second POST should use cached Content-Type
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok2'));

      const client = new AdtHttpClient(getDefaultConfig());
      await client.post('/sap/bc/adt/ddic/ddl/sources/ZI_TRAVEL/source/main', '<source/>', 'text/xml');
      await client.post('/sap/bc/adt/ddic/ddl/sources/ZI_TRAVEL/source/main', '<source2/>');

      expect(fetchHeaders(3)['Content-Type']).toBe('application/xml');
    });

    it('stateful sessions inherit discovery map', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient(getDefaultConfig());
      client.setDiscoveryMap(new Map([['/sap/bc/adt/oo/classes', ['application/vnd.sap.adt.oo.classes.v4+xml']]]));

      await client.withStatefulSession(async (session) => {
        await session.get('/sap/bc/adt/oo/classes/ZCL_SESSION');
      });

      expect(fetchHeaders(0).Accept).toBe('application/vnd.sap.adt.oo.classes.v4+xml');
      expect(fetchHeaders(0)['X-sap-adt-sessiontype']).toBe('stateful');
    });

    it('explicit extra headers win over discovery for Accept and Content-Type', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient(getDefaultConfig());
      client.setDiscoveryMap(
        new Map([['/sap/bc/adt/ddic/ddl/sources', ['application/vnd.sap.adt.ddic.ddl.sources.v2+xml']]]),
      );

      await client.post('/sap/bc/adt/ddic/ddl/sources/ZI_TRAVEL', '<source/>', undefined, {
        Accept: 'application/json',
        'Content-Type': 'text/plain',
      });

      expect(fetchHeaders(1).Accept).toBe('application/json');
      expect(fetchHeaders(1)['Content-Type']).toBe('text/plain');
    });
  });

  // ─── 406/415 Content Negotiation Retry ─────────────────────────────

  describe('406/415 content negotiation retry', () => {
    it('retries GET with fallback Accept on 406', async () => {
      // First request → 406
      mockFetch.mockResolvedValueOnce(mockResponse(406, 'Not Acceptable'));
      // Retry with fallback Accept → 200
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient(getDefaultConfig());
      const resp = await client.get('/path', { Accept: 'application/vnd.sap.adt.custom+xml' });

      expect(resp.statusCode).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      // Retry should use fallback Accept (application/xml since original was specific)
      expect(fetchHeaders(1).Accept).toBe('application/xml');
    });

    it('406 skips retry when default Accept */* has no useful fallback', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(406, 'Not Acceptable'));

      const client = new AdtHttpClient(getDefaultConfig());
      // Default Accept is */* — no better fallback available, should throw
      await expect(client.get('/path')).rejects.toThrow();

      // Only one fetch call — no retry
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('uses inferred Accept from SAP error body on 406', async () => {
      const errorBody =
        '<exc:exception><exc:localizedMessage>Expected application/vnd.sap.adt.transportorganizertree.v1+xml</exc:localizedMessage></exc:exception>';
      mockFetch.mockResolvedValueOnce(mockResponse(406, errorBody));
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient(getDefaultConfig());
      const resp = await client.get('/path', { Accept: 'application/xml' });

      expect(resp.statusCode).toBe(200);
      expect(fetchHeaders(1).Accept).toBe('application/vnd.sap.adt.transportorganizertree.v1+xml');
    });

    it('retries POST with fallback Content-Type on 415', async () => {
      // CSRF fetch
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      // POST → 415
      mockFetch.mockResolvedValueOnce(mockResponse(415, 'Unsupported Media Type'));
      // Retry with application/xml → 200
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'created'));

      const client = new AdtHttpClient(getDefaultConfig());
      const resp = await client.post('/path', '<data/>', 'text/xml');

      expect(resp.statusCode).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(3);
      // Retry Content-Type should fall back to application/xml
      expect(fetchHeaders(2)['Content-Type']).toBe('application/xml');
    });

    it('does not retry on non-406/415 errors', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(500, 'Internal Server Error'));

      const client = new AdtHttpClient(getDefaultConfig());
      await expect(client.get('/path')).rejects.toThrow(AdtApiError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('does not retry infinitely — only retries once for 406', async () => {
      // First 406
      mockFetch.mockResolvedValueOnce(mockResponse(406, 'Not Acceptable'));
      // Retry also 406 — should NOT retry again, should throw
      mockFetch.mockResolvedValueOnce(mockResponse(406, 'Still Not Acceptable'));

      const client = new AdtHttpClient(getDefaultConfig());
      await expect(client.get('/path', { Accept: 'application/custom+xml' })).rejects.toThrow(AdtApiError);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('does not retry infinitely — only retries once for 415', async () => {
      // CSRF fetch
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      // First 415
      mockFetch.mockResolvedValueOnce(mockResponse(415, 'Unsupported'));
      // Retry also 415 — should throw
      mockFetch.mockResolvedValueOnce(mockResponse(415, 'Still Unsupported'));

      const client = new AdtHttpClient(getDefaultConfig());
      await expect(client.post('/path', '<d/>', 'text/xml')).rejects.toThrow(AdtApiError);
      expect(mockFetch).toHaveBeenCalledTimes(3); // CSRF + POST + retry
    });

    it('preserves CSRF token and cookies during 406 retry', async () => {
      // CSRF fetch returns cookie
      mockFetch.mockResolvedValueOnce(
        mockResponse(200, '', { 'x-csrf-token': 'MY_TOKEN' }, ['SAP_SESSIONID=sess1; Path=/']),
      );
      // POST → 406
      mockFetch.mockResolvedValueOnce(mockResponse(406, 'Not Acceptable'));
      // Retry → 200
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient(getDefaultConfig());
      const resp = await client.post('/path', '<d/>', 'application/custom+xml', {
        Accept: 'application/custom+xml',
      });

      expect(resp.statusCode).toBe(200);
      // Retry should still have CSRF token
      expect(fetchHeaders(2)['X-CSRF-Token']).toBe('MY_TOKEN');
      // Retry should still have session cookie
      expect(fetchHeaders(2).Cookie).toContain('SAP_SESSIONID=sess1');
    });

    it('406 skips retry when Accept is already */* and no inferred type', async () => {
      // Default Accept is */* — no useful fallback, should throw without retry
      mockFetch.mockResolvedValueOnce(mockResponse(406, 'Not Acceptable'));

      const client = new AdtHttpClient(getDefaultConfig());
      await expect(client.get('/path')).rejects.toThrow();

      // Only one fetch call — no retry
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('406 falls back to wildcard when Accept is application/xml and no inferred type', async () => {
      // Accept: application/xml → 406, no inferred type in error body → retry with */*
      mockFetch.mockResolvedValueOnce(mockResponse(406, 'Not Acceptable'));
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient(getDefaultConfig());
      const resp = await client.get('/path', { Accept: 'application/xml' });

      expect(resp.statusCode).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(fetchHeaders(1).Accept).toBe('*/*');
    });

    it('negotiation retry guard is per-request, not per-instance', async () => {
      const client = new AdtHttpClient(getDefaultConfig());

      // First request: 406 → retry → success
      mockFetch.mockResolvedValueOnce(mockResponse(406, 'Not Acceptable'));
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'first ok'));
      const resp1 = await client.get('/path', { Accept: 'application/custom+xml' });
      expect(resp1.statusCode).toBe(200);

      // Second request on same instance: should also retry (guard is per-request)
      mockFetch.mockResolvedValueOnce(mockResponse(406, 'Not Acceptable'));
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'second ok'));
      const resp2 = await client.get('/path', { Accept: 'application/custom+xml' });
      expect(resp2.statusCode).toBe(200);

      // 4 total fetches: 2 per request (original + retry)
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('415 retries with application/* when Content-Type is application/xml', async () => {
      // CSRF fetch
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      // POST with application/xml → 415
      mockFetch.mockResolvedValueOnce(mockResponse(415, 'Unsupported'));
      // Retry with application/* → 200
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'created'));

      const client = new AdtHttpClient(getDefaultConfig());
      const resp = await client.post('/path', '<d/>', 'application/xml');

      expect(resp.statusCode).toBe(200);
      // CSRF fetch + initial POST + retry POST
      expect(mockFetch).toHaveBeenCalledTimes(3);
      // Verify retry used application/* content type
      const retryCall = mockFetch.mock.calls[2];
      expect(retryCall[1].headers['Content-Type']).toBe('application/*');
    });

    it('415 skips retry when Content-Type is already application/*', async () => {
      // CSRF fetch
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      // POST with application/* → 415 (no useful fallback, should throw without retry)
      mockFetch.mockResolvedValueOnce(mockResponse(415, 'Unsupported'));

      const client = new AdtHttpClient(getDefaultConfig());
      await expect(client.post('/path', '<d/>', 'application/*')).rejects.toThrow();

      // CSRF fetch + one POST — no retry
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // ─── 401 Session Timeout Auto-Retry ────────────────────────────────

  describe('401 session timeout auto-retry', () => {
    it('retries GET on 401 after session reset', async () => {
      // GET → 401
      mockFetch.mockResolvedValueOnce(
        mockResponse(401, 'Unauthorized', { 'www-authenticate': 'Basic realm="SAP"' }, [
          'sap-usercontext=sap-client=001; path=/',
        ]),
      );
      // Retry GET → 200
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'success'));

      const client = new AdtHttpClient(getDefaultConfig());
      const resp = await client.get('/sap/bc/adt/programs/programs/ZTEST/source/main');

      expect(resp.statusCode).toBe(200);
      expect(resp.body).toBe('success');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('retries POST on 401 with fresh CSRF token', async () => {
      // Initial CSRF fetch
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'TOKEN1' }));
      // POST → 401
      mockFetch.mockResolvedValueOnce(mockResponse(401, 'Unauthorized'));
      // CSRF re-fetch during retry
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'TOKEN2' }));
      // Retry POST → 200
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'created'));

      const client = new AdtHttpClient(getDefaultConfig());
      const resp = await client.post('/sap/bc/adt/activation', '<xml/>');

      expect(resp.statusCode).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(4);
      // Retry POST should have fresh CSRF token
      expect(fetchHeaders(3)['X-CSRF-Token']).toBe('TOKEN2');
    });

    it('does not retry on 401 when already retrying (guard)', async () => {
      // GET → 401
      mockFetch.mockResolvedValueOnce(mockResponse(401, 'Unauthorized'));
      // Retry also → 401 (should not retry again)
      mockFetch.mockResolvedValueOnce(mockResponse(401, 'Still Unauthorized'));

      const client = new AdtHttpClient(getDefaultConfig());
      await expect(client.get('/path')).rejects.toThrow(AdtApiError);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('does not retry non-401 errors', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(500, 'Internal Server Error'));

      const client = new AdtHttpClient(getDefaultConfig());
      await expect(client.get('/path')).rejects.toThrow(AdtApiError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('clears cookies on 401 retry', async () => {
      // CSRF fetch → sets session cookie
      mockFetch.mockResolvedValueOnce(
        mockResponse(200, '', { 'x-csrf-token': 'T' }, ['SAP_SESSIONID_A4H_001=SESSION1; Path=/']),
      );
      // POST → 401
      mockFetch.mockResolvedValueOnce(mockResponse(401, 'Unauthorized'));
      // CSRF re-fetch during retry
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T2' }));
      // Retry POST → 200
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient(getDefaultConfig());
      await client.post('/path', '<xml/>');

      // Retry request should NOT contain the old session cookie
      const retryCookie = fetchHeaders(3).Cookie ?? '';
      expect(retryCookie).not.toContain('SAP_SESSIONID_A4H_001=SESSION1');
    });

    it('refreshes bearer token on 401 retry', async () => {
      const tokenProvider = vi.fn().mockResolvedValueOnce('token1').mockResolvedValueOnce('token2');

      // GET with token1 → 401
      mockFetch.mockResolvedValueOnce(mockResponse(401, 'Unauthorized'));
      // Retry with token2 → 200
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient({
        ...getDefaultConfig(),
        bearerTokenProvider: tokenProvider,
      });
      const resp = await client.get('/path');

      expect(resp.statusCode).toBe(200);
      expect(fetchHeaders(1).Authorization).toBe('Bearer token2');
    });

    it('401 retry guard is per-request not per-instance', async () => {
      const client = new AdtHttpClient(getDefaultConfig());

      // First request: 401 → retry → success
      mockFetch.mockResolvedValueOnce(mockResponse(401, 'Unauthorized'));
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'first ok'));
      const resp1 = await client.get('/path1');
      expect(resp1.statusCode).toBe(200);

      // Second request: also 401 → retry → success (guard resets between requests)
      mockFetch.mockResolvedValueOnce(mockResponse(401, 'Unauthorized'));
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'second ok'));
      const resp2 = await client.get('/path2');
      expect(resp2.statusCode).toBe(200);

      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('preserves config cookies on 401 retry', async () => {
      // GET → 401
      mockFetch.mockResolvedValueOnce(mockResponse(401, 'Unauthorized'));
      // Retry → 200
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient({
        ...getDefaultConfig(),
        cookies: { configCookie: 'cfg1' },
      });
      await client.get('/path');

      // Retry should include the config cookie
      expect(fetchHeaders(1).Cookie).toContain('configCookie=cfg1');
    });

    it('401 retry falls through to 406 negotiation recovery', async () => {
      // GET → 401
      mockFetch.mockResolvedValueOnce(mockResponse(401, 'Unauthorized'));
      // Retry → 406 (negotiation failure)
      mockFetch.mockResolvedValueOnce(mockResponse(406, 'Not Acceptable'));
      // 406 fallback retry → 200
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient(getDefaultConfig());
      const resp = await client.get('/path', { Accept: 'application/vnd.sap.adt.custom+xml' });

      expect(resp.statusCode).toBe(200);
      // 3 fetches: original 401, retry 406, negotiation fallback 200
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('auth retry guard is per-request scope (local variable)', async () => {
      // Verify two separate instances can both retry independently
      // This confirms the guard is not shared across instances/requests
      const client1 = new AdtHttpClient(getDefaultConfig());
      const client2 = new AdtHttpClient(getDefaultConfig());

      // Client 1: 401 → retry → 200
      mockFetch.mockResolvedValueOnce(mockResponse(401, 'Unauthorized'));
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok1'));
      const resp1 = await client1.get('/path1');
      expect(resp1.statusCode).toBe(200);

      // Client 2: 401 → retry → 200 (not blocked by client1's retry)
      mockFetch.mockResolvedValueOnce(mockResponse(401, 'Unauthorized'));
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok2'));
      const resp2 = await client2.get('/path2');
      expect(resp2.statusCode).toBe(200);

      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  // ─── Proxy Configuration ──────────────────────────────────────────

  describe('proxy configuration', () => {
    it('uses undici Client for proxy requests (standard HTTP proxy, not CONNECT)', async () => {
      mockClientRequest.mockResolvedValueOnce(mockClientResponse(200, 'ok'));

      const client = new AdtHttpClient({
        ...getDefaultConfig(),
        btpProxy: {
          host: 'proxy.example.com',
          port: 20003,
          protocol: 'http',
          getProxyToken: async () => 'proxy-token',
        },
      });

      // No static dispatcher on the client — proxy uses Client directly
      expect((client as any).dispatcher).toBeUndefined();

      await client.get('/path');

      // Should use Client.request (not fetch) for proxy requests
      expect(mockClientRequest).toHaveBeenCalledTimes(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('sends Proxy-Authorization and full URL via Client for standard HTTP proxy protocol', async () => {
      mockClientRequest.mockResolvedValueOnce(mockClientResponse(200, 'ok'));

      const client = new AdtHttpClient({
        ...getDefaultConfig(),
        btpProxy: {
          host: 'proxy.example.com',
          port: 20003,
          protocol: 'http',
          getProxyToken: async () => 'proxy-token-xyz',
        },
      });
      await client.get('/path');

      // Proxy-Authorization should be in the Client request headers
      expect(clientRequestHeaders(0)['Proxy-Authorization']).toBe('Bearer proxy-token-xyz');
      // The path should be the full URL (standard HTTP proxy protocol)
      expect(clientRequestPath(0)).toBe('http://sap.example.com:8000/path?sap-client=001&sap-language=EN');
    });
  });

  // ─── 503 Retry ──────────────────────────────────────────────────────

  describe('503 retry with backoff', () => {
    it('retries GET on 503 and succeeds on second attempt', async () => {
      // First call: CSRF fetch (HEAD), second: GET returns 503, third: retry returns 200
      mockFetch
        .mockResolvedValueOnce(mockResponse(503, 'Service Unavailable'))
        .mockResolvedValueOnce(mockResponse(200, 'OK'));

      const client = new AdtHttpClient(getDefaultConfig());
      (client as any).csrfToken = 'T'; // skip CSRF fetch

      const response = await client.get('/sap/bc/adt/programs/programs/ZHELLO/source/main');
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('OK');
      // Two fetch calls: original 503 + retry
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws AdtApiError when GET retry also returns 503', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse(503, 'Service Unavailable'))
        .mockResolvedValueOnce(mockResponse(503, 'Still Unavailable'));

      const client = new AdtHttpClient(getDefaultConfig());
      (client as any).csrfToken = 'T';

      await expect(client.get('/sap/bc/adt/programs/programs/ZHELLO/source/main')).rejects.toThrow(AdtApiError);
    });

    it('retries HEAD on 503', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse(503, 'Service Unavailable'))
        .mockResolvedValueOnce(mockResponse(200, ''));

      const client = new AdtHttpClient(getDefaultConfig());
      (client as any).csrfToken = 'T';

      const response = await client.head('/sap/bc/adt/core/discovery');
      expect(response.statusCode).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('retries POST on 503 (ICM rejects before WP execution)', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse(503, 'Service Unavailable'))
        .mockResolvedValueOnce(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T2' }));

      const client = new AdtHttpClient(getDefaultConfig());
      (client as any).csrfToken = 'T';

      const result = await client.post('/sap/bc/adt/some/action', '<xml/>');
      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('<ok/>');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('retries PUT on 503', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse(503, 'Service Unavailable'))
        .mockResolvedValueOnce(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T2' }));

      const client = new AdtHttpClient(getDefaultConfig());
      (client as any).csrfToken = 'T';

      const result = await client.put('/sap/bc/adt/some/action', '<xml/>');
      expect(result.statusCode).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('retries DELETE on 503', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse(503, 'Service Unavailable'))
        .mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T2' }));

      const client = new AdtHttpClient(getDefaultConfig());
      (client as any).csrfToken = 'T';

      const result = await client.delete('/sap/bc/adt/some/action');
      expect(result.statusCode).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // ─── Semaphore Integration ──────────────────────────────────────────

  describe('semaphore integration', () => {
    it('limits concurrency when semaphore is provided', async () => {
      const { Semaphore } = await import('../../../src/adt/semaphore.js');
      const sem = new Semaphore(1);

      let concurrent = 0;
      let maxConcurrent = 0;
      mockFetch.mockImplementation(async () => {
        concurrent++;
        if (concurrent > maxConcurrent) maxConcurrent = concurrent;
        await new Promise((resolve) => setTimeout(resolve, 20));
        concurrent--;
        return mockResponse(200, 'ok');
      });

      const client = new AdtHttpClient({ ...getDefaultConfig(), semaphore: sem });
      (client as any).csrfToken = 'T';

      await Promise.all([client.get('/path1'), client.get('/path2'), client.get('/path3')]);

      expect(maxConcurrent).toBe(1);
    });
  });

  // ─── Cookie hot-reload on stale 401 ─────────────────────────────────
  //
  // Verifies the lazy reload state machine: persistent 401 in cookie-auth
  // mode clears the cookie jar and re-reads the configured cookieFile on
  // the NEXT request, with no restart. See docs/plans/pr-alpha-cookie-hot-reload.md
  // and docs/adr/0001-discovery-driven-endpoint-routing.md (architectural context).

  describe('cookie hot-reload', () => {
    let tmpFile = '';

    function writeNetscapeCookieFile(cookies: Record<string, string>): string {
      const fs = require('node:fs');
      const os = require('node:os');
      const path = require('node:path');
      const file = path.join(os.tmpdir(), `arc1-test-cookies-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
      const lines = ['# Netscape HTTP Cookie File'];
      for (const [k, v] of Object.entries(cookies)) {
        lines.push(`sap.example.com\tFALSE\t/\tFALSE\t0\t${k}\t${v}`);
      }
      fs.writeFileSync(file, `${lines.join('\n')}\n`);
      return file;
    }

    afterEach(() => {
      if (tmpFile) {
        const fs = require('node:fs');
        try {
          fs.unlinkSync(tmpFile);
        } catch {
          // best-effort-cleanup
        }
        tmpFile = '';
      }
    });

    it('clears cookies on persistent 401 in cookie-auth mode', async () => {
      tmpFile = writeNetscapeCookieFile({ MYSAPSSO2: 'stale-value' });
      // First GET → 401, retry GET → still 401 (persistent)
      mockFetch.mockResolvedValueOnce(mockResponse(401, 'Unauthorized'));
      mockFetch.mockResolvedValueOnce(mockResponse(401, 'Unauthorized'));

      const client = new AdtHttpClient({
        ...getDefaultConfig(),
        username: undefined,
        password: undefined,
        cookies: { MYSAPSSO2: 'stale-value' },
        cookieFile: tmpFile,
      });
      await expect(client.get('/sap/bc/adt/programs/programs/ZTEST/source/main')).rejects.toThrow();

      // After persistent 401 in cookie-auth mode: cookies cleared, flag set.
      expect((client as any).config.cookies).toEqual({});
      expect((client as any).cookiesCleared).toBe(true);
    });

    it('reloads cookies from file on the next request after clearing', async () => {
      tmpFile = writeNetscapeCookieFile({ MYSAPSSO2: 'fresh-value' });
      // Pre-set the client into cleared state.
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const client = new AdtHttpClient({
        ...getDefaultConfig(),
        username: undefined,
        password: undefined,
        cookies: {},
        cookieFile: tmpFile,
      });
      (client as any).cookiesCleared = true;
      (client as any).csrfToken = 'T';

      await client.get('/sap/bc/adt/discovery');

      // Inspect the fetch call: the Cookie header must contain the reloaded value.
      const headers = (mockFetch.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
      expect(headers.Cookie).toContain('MYSAPSSO2=fresh-value');
      // After reload, the cleared flag is reset.
      expect((client as any).cookiesCleared).toBe(false);
      // config.cookies has the reloaded entry.
      expect((client as any).config.cookies).toEqual({ MYSAPSSO2: 'fresh-value' });
    });

    it('warns and skips reload when only cookieString is configured (no cookieFile)', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const warnSpy = vi.spyOn((await import('../../../src/server/logger.js')).logger, 'warn');
      const client = new AdtHttpClient({
        ...getDefaultConfig(),
        username: undefined,
        password: undefined,
        cookies: { MYSAPSSO2: 'stale' },
        cookieString: 'MYSAPSSO2=stale',
      });
      (client as any).cookiesCleared = true;
      (client as any).csrfToken = 'T';

      await client.get('/sap/bc/adt/discovery');

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('SAP_COOKIE_STRING cannot be refreshed'));
      // Cleared flag is still reset (one-shot semantics).
      expect((client as any).cookiesCleared).toBe(false);
      // config.cookies is unchanged (no source to reload from).
      expect((client as any).config.cookies).toEqual({ MYSAPSSO2: 'stale' });
      warnSpy.mockRestore();
    });

    it('warns when cookieFile reload returns empty result', async () => {
      tmpFile = writeNetscapeCookieFile({}); // Empty cookie file (only the header comment)
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const warnSpy = vi.spyOn((await import('../../../src/server/logger.js')).logger, 'warn');
      const client = new AdtHttpClient({
        ...getDefaultConfig(),
        username: undefined,
        password: undefined,
        cookies: { OLD: 'x' },
        cookieFile: tmpFile,
      });
      (client as any).cookiesCleared = true;
      (client as any).csrfToken = 'T';

      await client.get('/sap/bc/adt/discovery');

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Cookie reload returned empty result'));
      // config.cookies should be left unchanged on empty reload.
      expect((client as any).config.cookies).toEqual({ OLD: 'x' });
      warnSpy.mockRestore();
    });

    it('warns when cookieFile is unreadable (path does not exist)', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));

      const warnSpy = vi.spyOn((await import('../../../src/server/logger.js')).logger, 'warn');
      const client = new AdtHttpClient({
        ...getDefaultConfig(),
        username: undefined,
        password: undefined,
        cookies: { OLD: 'x' },
        cookieFile: '/no/such/path/that/exists.txt',
      });
      (client as any).cookiesCleared = true;
      (client as any).csrfToken = 'T';

      await client.get('/sap/bc/adt/discovery');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to reload cookies from source'),
        expect.any(Object),
      );
      // config.cookies left unchanged.
      expect((client as any).config.cookies).toEqual({ OLD: 'x' });
      warnSpy.mockRestore();
    });

    it('clears cookies in HTML-login fallback when in cookie-auth mode', async () => {
      tmpFile = writeNetscapeCookieFile({ MYSAPSSO2: 'stale' });
      // 200 with HTML body that looks like a login page.
      const loginHtml = '<html><head><title>Logon Error Message</title></head><body>Logon ticket invalid</body></html>';
      mockFetch.mockResolvedValueOnce(mockResponse(200, loginHtml, { 'content-type': 'text/html' }));

      const client = new AdtHttpClient({
        ...getDefaultConfig(),
        username: undefined,
        password: undefined,
        cookies: { MYSAPSSO2: 'stale' },
        cookieFile: tmpFile,
      });
      (client as any).csrfToken = 'T';

      await expect(client.get('/sap/bc/adt/discovery')).rejects.toThrow();

      expect((client as any).config.cookies).toEqual({});
      expect((client as any).cookiesCleared).toBe(true);
    });

    it('does NOT clear cookies on 401 when not in cookie-auth mode (basic auth)', async () => {
      // Persistent 401 with basic auth — should not clear anything cookie-related.
      mockFetch.mockResolvedValueOnce(mockResponse(401, 'Unauthorized'));
      mockFetch.mockResolvedValueOnce(mockResponse(401, 'Unauthorized'));

      const client = new AdtHttpClient({
        ...getDefaultConfig(),
        cookies: { OLD: 'x' },
      });
      await expect(client.get('/sap/bc/adt/programs/programs/ZTEST/source/main')).rejects.toThrow();

      expect((client as any).config.cookies).toEqual({ OLD: 'x' });
      expect((client as any).cookiesCleared).toBe(false);
    });
  });
});
