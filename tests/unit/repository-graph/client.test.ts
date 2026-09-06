import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { GraphClient } from '../../../src/repository-graph/client.js';
import { graphInputSchema, graphResponseSchema } from '../../../src/repository-graph/contract.js';
import { jsonResponse, KEY, request, response } from './helpers.js';

function client(fetcher: typeof fetch = fetch, timeoutMs = 5000, url = 'https://graph.example') {
  return new GraphClient({ url, systemKey: 'TEST-001', audience: 'trial', readKey: () => KEY }, fetcher, timeoutMs);
}
describe('graph HTTP contract', () => {
  it('injects fixed system/audience and sends only the graph credential', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(response()));
    await expect(client(fetcher).query(request())).resolves.toEqual(response());
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://graph.example/v2/query');
    expect(init?.redirect).toBe('error');
    expect(init?.headers).toEqual({
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
      accept: 'application/json',
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({ systemKey: 'TEST-001', audience: 'trial' });
  });
  it.each([
    { apiVersion: 1 },
    { systemKey: 'OTHER' },
    { audience: 'other' },
    { action: 'status' },
    { secret: KEY },
    { coverage: { status: 'complete' } },
    { hasMore: true },
    { nodes: [{ id: 1 }] },
  ])('rejects malformed or misbound response %j', async (patch) => {
    await expect(
      client(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ...response(), ...patch }))).query(request()),
    ).rejects.toThrow('incompatible');
  });
  it.each([401, 403, 404, 500])('hides raw backend errors, HTTP %i', async (status) => {
    await expect(
      client(vi.fn<typeof fetch>().mockResolvedValue(new Response(`<html>${KEY}</html>`, { status }))).query(request()),
    ).rejects.toThrow(/^Repository graph: (unauthorized|incompatible|unavailable)$/);
  });
  it('rejects overlarge streamed JSON without emitting its content', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ...response(), raw: 'x'.repeat(512001) }));
    await expect(client(fetcher).query(request())).rejects.toThrow('incompatible');
  });
  it('enforces edge closure and unique IDs', () => {
    expect(
      graphResponseSchema.safeParse({
        ...response(),
        edges: [{ id: 1, sourceId: 1, targetId: 2, relation: 'references', evidenceMethod: 'test' }],
      }).success,
    ).toBe(false);
  });
  it('rejects caller-selected systems, URLs and unbounded inputs', () => {
    for (const patch of [
      { systemKey: 'OTHER' },
      { url: 'http://evil' },
      { depth: 4 },
      { maxNodes: 101 },
      { query: 'x'.repeat(256) },
      { kinds: ['unknown'] },
    ])
      expect(graphInputSchema.safeParse({ action: 'search', query: 'Z', ...patch }).success).toBe(false);
    expect(graphInputSchema.safeParse({ action: 'path', type: 'CLAS', name: 'Z' }).success).toBe(false);
    expect(
      graphInputSchema.safeParse({ action: 'impact', type: 'CLAS', name: 'Z', kinds: ['belongs_to'] }).success,
    ).toBe(false);
  });
  it.each([
    { startStatus: 'found' },
    { targetStatus: 'found' },
    { pathFound: true },
    { coverage: { ...response().coverage, status: 'complete' } },
    { coverage: { ...response().coverage, generation: null } },
  ])('rejects semantically false search/coverage claims %j', async (patch) => {
    await expect(
      client(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ...response(), ...patch }))).query(request()),
    ).rejects.toThrow('incompatible');
  });
  it('rejects a found traversal root with no matching node', async () => {
    const args = graphInputSchema.parse({ action: 'neighbors', name: 'ZCL_ROOT', type: 'CLAS' });
    await expect(
      client(
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ...response('neighbors'), startStatus: 'found' })),
      ).query(args),
    ).rejects.toThrow('incompatible');
  });
  it('single-client admission is bounded and cancellation releases slots', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
          ),
      );
    const c = client(fetcher);
    const abort = new AbortController();
    const pending = Array.from({ length: 8 }, () => c.query(request(), abort.signal));
    await expect(c.query(request())).rejects.toThrow('busy');
    abort.abort();
    expect((await Promise.allSettled(pending)).every((item) => item.status === 'rejected')).toBe(true);
    fetcher.mockResolvedValue(jsonResponse(response()));
    await expect(c.query(request())).resolves.toMatchObject({ apiVersion: 2 });
  });
  it('real HTTP: refuses redirects and bounds slow response bodies and caller cancellation', async () => {
    let mode = 'redirect';
    let redirected = 0;
    const server = createServer((req, res) => {
      if (req.url === '/leak') {
        redirected++;
        res.end(KEY);
        return;
      }
      if (mode === 'redirect') {
        res.writeHead(302, { location: '/leak' });
        res.end();
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('{');
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const c = client(fetch, 100, `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    try {
      await expect(c.query(request())).rejects.toThrow('unavailable');
      expect(redirected).toBe(0);
      mode = 'slow';
      await expect(c.query(request())).rejects.toThrow('unavailable');
      const abort = new AbortController();
      const pending = c.query(request(), abort.signal);
      abort.abort();
      await expect(pending).rejects.toThrow('cancelled');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
