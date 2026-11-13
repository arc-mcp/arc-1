/** Multi-target write barrier in AdtHttpClient.request(): no transient retry + dual request ceiling on the wire. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError, AdtSafetyError } from '../../../src/adt/errors.js';
import { isPinnedTransportAllowed } from '../../../src/adt/safety.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

const mockFetch = vi.fn();
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: mockFetch };
});
const { AdtHttpClient } = await import('../../../src/adt/http.js');

const policy = {
  target: 'A4H/001',
  enabled: true,
  allowedPackages: ['$TMP'],
  allowedTransports: ['A4HK9*'],
  serverAllowedTransports: ['A4HK900001'],
};
const http = (pinnedWrite?: typeof policy) =>
  new AdtHttpClient({ baseUrl: 'http://sap:8000', username: 'u', password: 'p', client: '001', pinnedWrite });
const busy = () => mockResponse(503, 'busy', { 'retry-after': '0' });
const sent = (method: string) => mockFetch.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === method);

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (_url: unknown, init: any = {}) =>
    init.method === 'HEAD' ? mockResponse(200, '', { 'x-csrf-token': 'T' }) : busy(),
  );
});

describe('pinned write barrier', () => {
  it.each(['post', 'put', 'delete'] as const)('sends a failed %s once', async (method) => {
    const client = http(policy);
    const call =
      method === 'delete' ? client.delete('/sap/bc/adt/x') : client[method]('/sap/bc/adt/x', 'b', 'text/plain');
    await expect(call).rejects.toBeInstanceOf(AdtApiError);
    expect(sent(method.toUpperCase())).toHaveLength(1);
  });

  it('keeps the single retry after definitive rejections: CSRF 403 refresh and 415 negotiation', async () => {
    let first = true;
    mockFetch.mockImplementation(async (_url: unknown, init: any = {}) => {
      if (init.method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'T' });
      const reject = first;
      first = false;
      return reject
        ? mockResponse(403, 'CSRF token validation failed', { 'x-csrf-token': 'Required' })
        : mockResponse(200, '');
    });
    await http(policy).post('/sap/bc/adt/x', 'b', 'application/vnd.sap.test+xml');
    expect(sent('POST')).toHaveLength(2);
    mockFetch.mockClear();
    first = true;
    mockFetch.mockImplementation(async (_url: unknown, init: any = {}) => {
      if (init.method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'T' });
      const reject = first;
      first = false;
      return reject ? mockResponse(415, 'Unsupported Media Type') : mockResponse(200, '');
    });
    await http(policy).put('/sap/bc/adt/x', 'b', 'application/vnd.sap.test+xml');
    const puts = sent('PUT');
    expect(puts).toHaveLength(2);
    expect(puts[1][1].headers['Content-Type']).toBe('application/xml');
  });

  it.each(['post', 'put', 'delete'] as const)('%s: resends a 403 only on the CSRF challenge', async (method) => {
    const send = (client: InstanceType<typeof AdtHttpClient>) =>
      method === 'delete' ? client.delete('/sap/bc/adt/x') : client[method]('/sap/bc/adt/x', 'b', 'text/plain');
    for (const [label, challenge, client, sends] of [
      ['pinned, CSRF challenge', 'required', http(policy), 2],
      ['pinned, plain 403', undefined, http(policy), 1],
      ['single-target, plain 403', undefined, http(), 2],
    ] as const) {
      mockFetch.mockReset();
      mockFetch.mockImplementation(async (_url: unknown, init: any = {}) =>
        init.method === 'HEAD'
          ? mockResponse(200, '', { 'x-csrf-token': 'T' })
          : mockResponse(403, 'Forbidden', challenge ? { 'x-csrf-token': challenge } : {}),
      );
      await expect(send(client)).rejects.toBeInstanceOf(AdtApiError);
      expect(sent(method.toUpperCase()), label).toHaveLength(sends);
    }
  });

  it('still retries reads, and leaves clients without an enabled policy unaffected', async () => {
    await expect(http(policy).get('/sap/bc/adt/x')).rejects.toBeInstanceOf(AdtApiError);
    expect(sent('GET')).toHaveLength(2);
    for (const client of [http(), http({ ...policy, enabled: false })]) {
      mockFetch.mockClear();
      await expect(client.put('/sap/bc/adt/x?corrNr=OTHER', 'b', 'text/plain')).rejects.toBeInstanceOf(AdtApiError);
      expect(sent('PUT')).toHaveLength(2);
    }
  });

  it('checks corrNr against both lists before sending', async () => {
    mockFetch.mockImplementation(async () => mockResponse(200, '', { 'x-csrf-token': 'T' }));
    const client = http(policy);
    await expect(client.put('/sap/bc/adt/x?corrNr=A4HK900002', 'b', 'text/plain')).rejects.toBeInstanceOf(
      AdtSafetyError,
    );
    for (const path of ['/sap/bc/adt/x?corrNr=A4HK900001&corrNr=B4HK900001', '/sap/bc/adt/x?CORRNR=B4HK900001'])
      await expect(client.put(path, 'b', 'text/plain')).rejects.toBeInstanceOf(AdtSafetyError);
    expect(sent('PUT')).toHaveLength(0);
    await client.put('/sap/bc/adt/x?lockHandle=L&corrNr=A4HK900001', 'b', 'text/plain');
    await client.put('/sap/bc/adt/x?lockHandle=L', 'b', 'text/plain');
    expect(sent('PUT')).toHaveLength(2);
    await expect(
      client.withStatefulSession((session) => session.post('/sap/bc/adt/x?corrNr=B4HK900001', 'b', 'text/plain')),
    ).rejects.toBeInstanceOf(AdtSafetyError);
    expect(sent('POST')).toHaveLength(0);
  });

  it('requires both lists; an empty destination list refuses, an empty server list does not restrict', () => {
    expect(isPinnedTransportAllowed(policy, 'A4HK900001')).toBe(true);
    expect(isPinnedTransportAllowed(policy, 'A4HK900002')).toBe(false);
    expect(isPinnedTransportAllowed({ ...policy, serverAllowedTransports: [] }, 'A4HK900002')).toBe(true);
    expect(isPinnedTransportAllowed({ ...policy, allowedTransports: [] }, 'A4HK900001')).toBe(false);
  });
});
