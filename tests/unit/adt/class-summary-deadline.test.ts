import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverClassExtensions } from '../../../src/adt/class-extensions.js';
import { AdtClient } from '../../../src/adt/client.js';
import { ExtensionDiscoverySession, renderExtensionDiscovery } from '../../../src/adt/extension-discovery.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';

const name = 'CL_OO_ADT_ENHANCED_CLASS';
const root = `/sap/bc/adt/oo/classes/${name.toLowerCase()}`;
const request = { root: { type: 'CLAS', name, version: 'active' }, scope: 'owning object' };
const fixture = readFileSync(new URL('../../fixtures/class-extensions/class-exted.xml', import.meta.url), 'utf8');
const servers: Server[] = [];
const timers: ReturnType<typeof setTimeout>[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const timer of timers.splice(0)) clearTimeout(timer);
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }),
  );
});

async function setup(delay: number) {
  const paths: string[] = [];
  const server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://local').pathname;
    paths.push(`${req.method} ${path}`);
    if (req.method === 'HEAD') {
      res.writeHead(400);
      res.end();
      return;
    }
    if (path === '/sap/bc/adt/core/discovery') {
      res.setHeader('x-csrf-token', 'TEST');
      res.end('<service/>');
      return;
    }
    if (req.method === 'POST') {
      timers.push(setTimeout(() => res.end(fixture), delay));
      return;
    }
    if (path.endsWith('/enhancements/implementations')) {
      res.end('<enhancementImplementation/>');
      return;
    }
    res.end(
      `<abapClass name="${name}" type="CLAS/OC" version="active"><link rel="http://www.sap.com/adt/relations/enhancementImplementations" href="${root}/enhancements/implementations"/></abapClass>`,
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  return { client: new AdtClient({ baseUrl: `http://127.0.0.1:${address.port}`, retryUnauthorized: false }), paths };
}
async function discover(client: AdtClient, session: ExtensionDiscoverySession) {
  await discoverClassExtensions(
    client,
    session,
    request,
    { unit: { type: 'CLAS', name, section: 'main' }, source: '' },
    '758',
  );
  return session.finish();
}

describe('class summary deadline', () => {
  it.each(['CLAS', 'INTF', 'TABL', 'PROG', 'INCL', 'FUNC', 'FUGR', 'BDEF'])(
    'selects the actual budget for %s without changing other caps',
    (type) => {
      vi.useFakeTimers();
      vi.setSystemTime(10000);
      const session = new ExtensionDiscoverySession(
        'summary',
        { ...request, root: { ...request.root, type } },
        defaultSafetyConfig(),
      );
      const timeMs = type === 'CLAS' ? 5000 : 2000;
      expect(session.limits).toEqual({
        timeMs,
        sends: 6,
        responseBytes: 131072,
        nodes: 8,
        depth: 0,
        outputBytes: 2048,
      });
      expect(session.options.deadline).toBe(10000 + timeMs);
      expect(new ExtensionDiscoverySession('sources', request, defaultSafetyConfig()).options.deadline).toBe(22000);
    },
  );
  it('finishes both summary providers after a slow relation and cold-client CSRF bootstrap', async () => {
    const { client, paths } = await setup(2600);
    const result = await discover(client, new ExtensionDiscoverySession('summary', request, client.safety));
    expect(result.nodes.map((node) => node.name)).toEqual(['CL_OO_ADT_ENHANCED_CLASS1']);
    expect(result.providers.map((provider) => [provider.id, provider.status])).toEqual([
      ['class_exted_obj', 'returned'],
      ['source_plugins', 'returned'],
    ]);
    expect(result.omissions.deadline).toBeUndefined();
    expect(result.sources).toEqual([]);
    expect(result.consumed.sends).toBe(6);
    expect(result.consumed.responseBytes).toBeLessThanOrEqual(131072);
    expect(paths.some((path) => path.includes('/source/'))).toBe(false);
  });
  it('still reports incomplete discovery and stops subsequent providers at five seconds', async () => {
    const { client, paths } = await setup(5600);
    const result = await discover(client, new ExtensionDiscoverySession('summary', request, client.safety));
    expect(result.nodes).toEqual([]);
    expect(result.omissions.deadline).toBe(1);
    expect(result.providers).toMatchObject([
      { status: 'incomplete', reason: 'deadline' },
      { status: 'incomplete', reason: 'optional_phase_stopped' },
    ]);
    expect(renderExtensionDiscovery(result)[0]?.text).toContain('"reason":"deadline"');
    expect(paths.some((path) => path.endsWith('/enhancements/implementations'))).toBe(false);
  });
  it('honors a shorter caller deadline', async () => {
    const { client } = await setup(1000);
    const deadline = Date.now() + 150;
    const session = new ExtensionDiscoverySession('summary', request, client.safety, { deadline });
    expect(session.options.deadline).toBe(deadline);
    expect((await discover(client, session)).omissions.deadline).toBe(1);
  });
  it('propagates cancellation', async () => {
    const { client } = await setup(1000);
    const controller = new AbortController();
    const session = new ExtensionDiscoverySession('summary', request, client.safety, { signal: controller.signal });
    timers.push(setTimeout(() => controller.abort(), 100));
    await expect(discover(client, session)).rejects.toThrow();
  });
});
