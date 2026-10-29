import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdtHttpClient as HttpClient } from '../../../src/adt/http.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

const mockFetch = vi.fn();
vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<typeof import('undici')>()),
  fetch: mockFetch,
}));
const { AdtHttpClient } = await import('../../../src/adt/http.js');

const root = '/sap/bc/adt/oo/classes/ZCL_CACHE';
const source = `${root}/source/main`;
const modes = [
  {
    name: '406 Accept',
    header: 'Accept',
    status: 406,
    fallback: '*/*',
    request: (client: HttpClient, path: string, explicit?: string) =>
      client.get(path, explicit ? { Accept: explicit } : undefined),
  },
  {
    name: '415 Content-Type',
    header: 'Content-Type',
    status: 415,
    fallback: undefined,
    request: (client: HttpClient, path: string, explicit?: string) => client.put(path, '<metadata/>', explicit),
  },
] as const;

function headers(index = mockFetch.mock.calls.length - 1): Record<string, string> {
  return mockFetch.mock.calls[index][1].headers;
}

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(async () => mockResponse(200, 'ok', { 'x-csrf-token': 'T' }));
});

describe.each(modes)('exact negotiated resource: $name', (mode) => {
  async function client() {
    const http = new AdtHttpClient({ baseUrl: 'https://sap.example.com', client: '001' });
    // Use the real CSRF bootstrap so request assertions below concern only negotiation.
    if (mode.status === 415) await http.fetchCsrfToken();
    mockFetch.mockClear();
    return http;
  }

  async function negotiate(http: HttpClient, path: string, explicit = 'application/custom+xml') {
    mockFetch.mockResolvedValueOnce(mockResponse(mode.status, 'Unsupported media type'));
    mockFetch.mockResolvedValueOnce(mockResponse(200, 'ok'));
    await mode.request(http, path, explicit);
  }

  it('shares query, fragment and trailing-slash variants of the exact path', async () => {
    const http = await client();
    await negotiate(http, `${root}/?version=inactive#metadata`);
    expect(headers()[mode.header]).toBe('application/xml');
    for (const suffix of ['', '/', '?version=active', '#metadata', '/?version=inactive#metadata']) {
      const before = mockFetch.mock.calls.length;
      await mode.request(http, `${root}${suffix}`);
      expect(mockFetch).toHaveBeenCalledTimes(before + 1);
      expect(headers()[mode.header]).toBe('application/xml');
    }
  });

  it('does not inherit metadata media types on children, ancestors or similarly named objects', async () => {
    const http = await client();
    await negotiate(http, root);
    for (const path of [
      source,
      `${root}/objectstructure`,
      `${root}/versions`,
      `${root}/includes/implementations`,
      `${root}2`,
      '/sap/bc/adt/oo/classes',
      '/sap/bc/adt/oo/classes/ZCL_OTHER',
    ]) {
      const before = mockFetch.mock.calls.length;
      await mode.request(http, path);
      expect(mockFetch).toHaveBeenCalledTimes(before + 1);
      expect(headers()[mode.header], path).toBe(mode.fallback);
    }
  });

  it('keeps parent and child negotiations independent in both directions', async () => {
    const http = await client();
    http.setDiscoveryMap(new Map([[source, ['text/plain']]]));
    await negotiate(http, root);
    await negotiate(http, source, 'application/xml');
    const childType = mode.status === 406 ? '*/*' : 'application/*';
    expect(headers()[mode.header]).toBe(childType);
    await mode.request(http, root);
    expect(headers()[mode.header]).toBe('application/xml');
    await mode.request(http, `${source}?version=inactive`);
    expect(headers()[mode.header]).toBe(childType);
    await mode.request(http, `${source}/versions`);
    expect(headers()[mode.header]).toBe('text/plain');
    await mode.request(http, `${root}/objectstructure`);
    expect(headers()[mode.header]).toBe(mode.fallback);
  });

  it('preserves explicit caller headers without replacing the negotiated entry', async () => {
    const http = await client();
    await negotiate(http, root);
    await mode.request(http, root, 'text/plain');
    expect(headers()[mode.header]).toBe('text/plain');
    await mode.request(http, root);
    expect(headers()[mode.header]).toBe('application/xml');
    if (mode.status === 415) {
      await http.put(root, 'body', undefined, { 'Content-Type': 'application/json' });
      expect(headers()['Content-Type']).toBe('application/json');
      await mode.request(http, root);
      expect(headers()['Content-Type']).toBe('application/xml');
    }
  });

  it('uses child discovery after a parent negotiation and cache before discovery on the parent', async () => {
    const http = await client();
    const metadataType = 'application/vnd.sap.adt.oo.classes.v4+xml';
    http.setDiscoveryMap(
      new Map([
        ['/sap/bc/adt/oo/classes', [metadataType]],
        [source, ['text/plain']],
      ]),
    );
    await negotiate(http, root);
    await mode.request(http, root);
    expect(headers()[mode.header]).toBe('application/xml');
    await mode.request(http, `${source}?version=active`);
    expect(headers()[mode.header]).toBe('text/plain');
    await mode.request(http, '/sap/bc/adt/oo/classes/ZCL_OTHER');
    expect(headers()[mode.header]).toBe(metadataType);
  });

  it('does not cache a failed retry', async () => {
    const http = await client();
    mockFetch.mockResolvedValueOnce(mockResponse(mode.status, 'Unsupported media type'));
    mockFetch.mockResolvedValueOnce(mockResponse(mode.status, 'Still unsupported'));
    await expect(mode.request(http, root, 'application/custom+xml')).rejects.toMatchObject({
      statusCode: mode.status,
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await mode.request(http, root);
    expect(headers()[mode.header]).toBe(mode.fallback);
  });

  it('uses object discovery after a collection-level negotiation', async () => {
    const http = await client();
    const collection = '/sap/bc/adt/oo/classes';
    const metadataType = 'application/vnd.sap.adt.oo.classes.v4+xml';
    http.setDiscoveryMap(new Map([[collection, [metadataType]]]));
    await negotiate(http, collection);
    await mode.request(http, collection);
    expect(headers()[mode.header]).toBe('application/xml');
    await mode.request(http, root);
    expect(headers()[mode.header]).toBe(metadataType);
  });

  it('copies exact entries into stateful sessions without copying session negotiations back', async () => {
    const http = await client();
    await negotiate(http, root);
    await http.withStatefulSession(async (session) => {
      await mode.request(session, root);
      expect(headers()[mode.header]).toBe('application/xml');
      expect(headers()['X-sap-adt-sessiontype']).toBe('stateful');
      await mode.request(session, source);
      expect(headers()[mode.header]).toBe(mode.fallback);
      await negotiate(session, source);
      await mode.request(session, source);
      expect(headers()[mode.header]).toBe('application/xml');
    });
    await mode.request(http, root);
    expect(headers()[mode.header]).toBe('application/xml');
    await mode.request(http, source);
    expect(headers()[mode.header]).toBe(mode.fallback);
  });
});
