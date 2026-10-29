/** Exercise the actual HTTP/streaming/send boundaries; no SAP credentials or transport mocks. */
import { createServer, type RequestListener, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { ExtensionDiscoverySession } from '../../../src/adt/extension-discovery.js';
import { discoverSourcePlugins } from '../../../src/adt/source-plugin-discovery.js';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }),
  );
});
const empty = '<enhancements/>';
const metadata = (name = 'ZROOT', type = 'PROG/P') =>
  `<object name="${name}" type="${type}" version="active"><link href="source/main/enhancements/elements" rel="http://www.sap.com/adt/relations/enhancements"/></object>`;
const request = { root: { type: 'PROG', name: 'ZROOT', version: 'active' }, scope: 'program ZROOT' };
const selection = { unit: { type: 'PROG' as const, name: 'ZROOT' }, source: '' };
async function setup(listener: RequestListener) {
  const server = createServer(listener);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test listener');
  return new AdtClient({ baseUrl: `http://127.0.0.1:${address.port}`, retryUnauthorized: false });
}
describe('source plug-in transport bounds', () => {
  it.each([401, 403, 429])('makes no alternate provider or include sends after terminal HTTP %s', async (code) => {
    let sends = 0;
    const client = await setup((req, res) => {
      sends++;
      if (req.url!.includes('/enhancements/')) {
        res.statusCode = code;
        res.end('sensitive diagnostic');
      } else res.end(metadata());
    });
    const s = new ExtensionDiscoverySession('sources', request, client.safety);
    await discoverSourcePlugins(client, s, request, { ...selection, source: 'INCLUDE ZCHILD.' });
    expect(sends).toBe(2);
    expect(s.finish().consumed.sends).toBe(sends);
    expect(s.stopped).toBe(true);
    expect(JSON.stringify(s.result)).not.toContain('sensitive diagnostic');
  });
  it('caps actual sends across all include metadata, elements and source reads', async () => {
    let sends = 0;
    const client = await setup((req, res) => {
      sends++;
      const path = new URL(req.url!, 'http://local.invalid').pathname;
      if (path.endsWith('/enhancements/elements')) res.end(empty);
      else if (path.endsWith('/source/main')) res.end('');
      else
        res.end(path.includes('/includes/') ? metadata(path.split('/').at(-1)!.toUpperCase(), 'PROG/I') : metadata());
    });
    const s = new ExtensionDiscoverySession('sources', request, client.safety);
    await discoverSourcePlugins(client, s, request, {
      ...selection,
      source: Array.from({ length: 12 }, (_, i) => `INCLUDE Z${i}.`).join('\n'),
    });
    expect(sends).toBe(20);
    expect(s.finish().consumed.sends).toBe(20);
    expect(s.result.omissions.requests).toBe(1);
    expect(s.stopped).toBe(true);
  });
  it('stops while streaming a response above the aggregate wire-byte allowance', async () => {
    let sends = 0;
    const client = await setup((req, res) => {
      sends++;
      if (!req.url!.includes('/enhancements/')) {
        res.end(metadata());
        return;
      }
      res.write('<enhancements>');
      res.write('x'.repeat(70 * 1024));
      res.end('x'.repeat(70 * 1024));
    });
    const s = new ExtensionDiscoverySession('summary', request, client.safety);
    await discoverSourcePlugins(client, s, request, selection);
    expect(s.result.omissions.wire_bytes).toBe(1);
    expect(sends).toBe(2);
    expect(s.stopped).toBe(true);
    expect(s.result.nodes).toEqual([]);
  });
  it('uses the caller deadline and never starts child reads after it', async () => {
    let sends = 0;
    const client = await setup((_req, res) => {
      sends++;
      const timer = setTimeout(() => res.end(metadata()), 200);
      res.on('close', () => clearTimeout(timer));
    });
    const s = new ExtensionDiscoverySession('sources', request, client.safety, { deadline: Date.now() + 40 });
    await discoverSourcePlugins(client, s, request, { ...selection, source: 'INCLUDE ZCHILD.' });
    expect(s.result.omissions.deadline).toBe(1);
    expect(sends).toBeLessThanOrEqual(1);
    expect(s.finish().consumed.elapsedMs).toBeLessThan(1000);
  });
  it('propagates explicit caller cancellation', async () => {
    const client = await setup((_req, res) => res.end(metadata()));
    const controller = new AbortController();
    controller.abort();
    const s = new ExtensionDiscoverySession('sources', request, client.safety, { signal: controller.signal });
    await expect(discoverSourcePlugins(client, s, request, selection)).rejects.toThrow();
  });
});
