import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockResponse } from '../../helpers/mock-fetch.js';

const { mockFetch, mockProxyRequest } = vi.hoisted(() => ({ mockFetch: vi.fn(), mockProxyRequest: vi.fn() }));
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  class MockClient {
    request = mockProxyRequest;
    close = vi.fn().mockResolvedValue(undefined);
    destroy = vi.fn().mockResolvedValue(undefined);
  }
  return { ...actual, fetch: mockFetch, Client: MockClient };
});
const { AdtHttpClient } = await import('../../../src/adt/http.js');
const { postCreate } = await import('../../../src/adt/create-request.js');
const { parseDiscoveryDocument } = await import('../../../src/adt/xml-parser.js');
const CATALOG =
  '<app:service xmlns:app="http://www.w3.org/2007/app"><app:workspace><app:collection href="/sap/bc/adt/programs/programs"/></app:workspace></app:service>';
const config = {
  baseUrl: 'https://sap.example',
  username: 'user',
  password: 'secret',
  client: '800',
  language: 'EN',
};
const calls = () => mockFetch.mock.calls as [string, RequestInit][];

beforeEach(() => vi.resetAllMocks());

describe('query-sensitive discovery (#1189)', () => {
  it.each(['/sap/bc/adt/discovery'])('sends configured SAP context in headers for GET %s', async (path) => {
    mockFetch.mockResolvedValue(mockResponse(200, '<service/>'));
    await new AdtHttpClient(config).get(path);
    expect(calls()[0]?.[0]).toBe(config.baseUrl + path);
    const headers = new Headers(calls()[0]?.[1].headers);
    expect(headers.get('sap-client')).toBe('800');
    expect(headers.get('sap-language')).toBe('EN');
    expect(headers.get('x-sap-saml2')).toBeNull();
    expect(headers.get('authorization')).toBe(`Basic ${Buffer.from('user:secret').toString('base64')}`);
  });

  it.each([false, true])(
    'does not invent SAP context headers when unconfigured (disableSaml: %s)',
    async (disableSaml) => {
      mockFetch.mockResolvedValue(mockResponse(200, '<service/>'));
      await new AdtHttpClient({ baseUrl: config.baseUrl, disableSaml }).get('/sap/bc/adt/discovery');
      const headers = new Headers(calls()[0]?.[1].headers);
      expect(headers.has('sap-client')).toBe(false);
      expect(headers.has('sap-language')).toBe(false);
      expect(new URL(calls()[0]![0]).search).toBe(disableSaml ? '?saml2=disabled' : '');
      expect(headers.get('x-sap-saml2')).toBe(disableSaml ? 'disabled' : null);
    },
  );

  it.each([
    ['GET', '/sap/bc/adt/oo/classes'],
    ['GET', '/sap/bc/adt/core/discovery'],
    ['GET', '/sap/bc/adt/discovery/other'],
    ['GET', '/sap/bc/adt/discovery?foo=1'],
    ['HEAD', '/sap/bc/adt/discovery'],
    ['POST', '/sap/bc/adt/discovery'],
  ])('keeps ordinary URL context for %s %s', async (method, path) => {
    mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'TOKEN' }));
    const client = new AdtHttpClient(config);
    if (method === 'POST') await client.post(path, '<request/>');
    else if (method === 'HEAD') await client.head(path);
    else await client.get(path);
    const [raw, init] = calls().at(-1)!;
    const url = new URL(raw);
    expect(url.searchParams.get('sap-client')).toBe('800');
    expect(url.searchParams.get('sap-language')).toBe('EN');
    expect(url.searchParams.get('saml2')).toBeNull();
    if (path.includes('?foo')) expect(url.searchParams.get('foo')).toBe('1');
    expect(new Headers(init.headers).has('sap-client')).toBe(false);
  });

  it.each([
    [405, '/sap/bc/adt/core/discovery', false],
    [405, '/sap/bc/adt/core/discovery', true],
    [404, '/sap/bc/adt/discovery', false],
    [404, '/sap/bc/adt/discovery', true],
  ] as const)('keeps CSRF query and identity (HEAD %s, %s, disableSaml: %s)', async (status, path, disableSaml) => {
    mockFetch.mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve(
        init.method === 'HEAD' ? mockResponse(status, '') : mockResponse(200, '', { 'x-csrf-token': 'TOKEN' }),
      ),
    );
    const client = new AdtHttpClient({
      ...config,
      disableSaml,
      sessionType: 'stateful',
      cookies: { 'sap-contextid': 'OWNER', SAP_SESSIONID_TEST_800: 'SEC' },
    });
    await expect(client.fetchCsrfToken()).resolves.toBe(path);
    expect(calls()).toHaveLength(2);
    expect(new URL(calls()[0]![0]).searchParams.get('sap-client')).toBe('800');
    const [url, init] = calls()[1]!;
    expect(new URL(url).pathname).toBe(path);
    expect(new URL(url).searchParams.get('sap-client')).toBe('800');
    expect(new URL(url).searchParams.get('sap-language')).toBe('EN');
    expect(new URL(url).searchParams.get('saml2')).toBe(disableSaml ? 'disabled' : null);
    const headers = new Headers(init.headers);
    expect(headers.has('sap-client')).toBe(false);
    expect(headers.has('sap-language')).toBe(false);
    expect(headers.get('x-sap-saml2')).toBe(disableSaml ? 'disabled' : null);
    expect(headers.get('x-sap-adt-sessiontype')).toBe('stateful');
    expect(headers.get('cookie')).toContain('sap-contextid=OWNER');
    expect(headers.get('cookie')).toContain('SAP_SESSIONID_TEST_800=SEC');
    expect(headers.get('x-csrf-token')).toBe('fetch');
    expect(headers.get('authorization')).toBe(`Basic ${Buffer.from('user:secret').toString('base64')}`);
  });

  it('preserves bearer identity on discovery', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, '<service/>'));
    await new AdtHttpClient({ ...config, bearerTokenProvider: async () => 'USER_TOKEN' }).get('/sap/bc/adt/discovery');
    expect(new Headers(calls()[0]?.[1].headers).get('authorization')).toBe('Bearer USER_TOKEN');
    expect(new URL(calls()[0]![0]).search).toBe('');
  });

  it.each(['/sap/bc/adt/discovery'])('preserves context and identity through Connectivity for %s', async (path) => {
    const body = Object.assign(Readable.from(['<service/>']), { text: async () => '<service/>' });
    mockProxyRequest.mockResolvedValue({ statusCode: 200, headers: {}, body });
    await new AdtHttpClient({
      ...config,
      sapConnectivityAuth: 'Bearer USER_TOKEN',
      btpProxy: {
        host: 'proxy.example',
        port: 20003,
        protocol: 'http',
        getProxyToken: async () => 'PROXY_TOKEN',
      },
    }).get(path);
    const request = mockProxyRequest.mock.calls[0]![0];
    expect(request.path).toBe(config.baseUrl + path);
    expect(request.headers).toMatchObject({
      'sap-client': '800',
      'sap-language': 'EN',
      'SAP-Connectivity-Authentication': 'Bearer USER_TOKEN',
      'Proxy-Authorization': 'Bearer PROXY_TOKEN',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('keeps the SAML query bypass even when 740 discovery stays incomplete', async () => {
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(
        mockResponse(
          200,
          new URL(url).search
            ? '<app:service><app:workspace><app:collection href="/sap/bc/esproxy/types"/></app:workspace></app:service>'
            : CATALOG,
        ),
      ),
    );
    const result = await new AdtHttpClient({ ...config, disableSaml: true }).get('/sap/bc/adt/discovery');
    expect(parseDiscoveryDocument(result.body).size).toBe(0);
    const [url, init] = calls()[0]!;
    expect(new URL(url).searchParams.get('saml2')).toBe('disabled');
    expect(new URL(url).searchParams.get('sap-client')).toBe('800');
    expect(new URL(url).searchParams.get('sap-language')).toBe('EN');
    expect(new Headers(init.headers).get('x-sap-saml2')).toBe('disabled');
    expect(new Headers(init.headers).has('sap-client')).toBe(false);
  });

  it('does not change program-create MIME headers or add attempts for a presence-only catalog', async () => {
    const requests = [];
    for (const populated of [false, true]) {
      vi.resetAllMocks();
      mockFetch.mockResolvedValue(mockResponse(200, '<created/>', { 'x-csrf-token': 'TOKEN' }));
      const client = new AdtHttpClient(config);
      if (populated) client.setDiscoveryMap(parseDiscoveryDocument(CATALOG));
      await postCreate(client, '/sap/bc/adt/programs/programs', '<program/>', 'application/*');
      const sends = calls().filter(([, init]) => init.method === 'POST');
      expect(sends).toHaveLength(1);
      const [url, init] = sends[0]!;
      const headers = new Headers(init.headers);
      requests.push({ url, body: init.body, accept: headers.get('accept'), contentType: headers.get('content-type') });
    }
    expect(requests[1]).toEqual(requests[0]);
  });

  it.each([false, true])('does not replay a generic program-create 400 (populated catalog: %s)', async (populated) => {
    mockFetch.mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve(
        init.method === 'POST'
          ? mockResponse(400, '<exception><message>Rejected create</message></exception>')
          : mockResponse(200, '', { 'x-csrf-token': 'TOKEN' }),
      ),
    );
    const client = new AdtHttpClient(config);
    if (populated) client.setDiscoveryMap(parseDiscoveryDocument(CATALOG));
    await expect(
      postCreate(client, '/sap/bc/adt/programs/programs', '<program/>', 'application/xml'),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(calls().filter(([, init]) => init.method === 'POST')).toHaveLength(1);
  });

  it.each([false, true])('keeps the existing #907 create fallback (populated catalog: %s)', async (populated) => {
    const noHandler =
      '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionContentHandlerNotFound"/><message>No content handler found</message></exc:exception>';
    mockFetch.mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve(
        init.method !== 'POST'
          ? mockResponse(200, '', { 'x-csrf-token': 'TOKEN' })
          : new Headers(init.headers).get('content-type') === 'application/*'
            ? mockResponse(400, noHandler)
            : mockResponse(201, '<created/>'),
      ),
    );
    const client = new AdtHttpClient(config);
    if (populated) client.setDiscoveryMap(parseDiscoveryDocument(CATALOG));
    await expect(
      postCreate(client, '/sap/bc/adt/programs/programs', '<program/>', 'application/*'),
    ).resolves.toMatchObject({ statusCode: 201 });
    expect(
      calls()
        .filter(([, init]) => init.method === 'POST')
        .map(([, init]) => new Headers(init.headers).get('content-type')),
    ).toEqual(['application/*', 'application/vnd.sap.adt.programs.programs+xml']);
  });
});
