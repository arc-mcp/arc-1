import { createServer, type RequestListener, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { discoverDdicAppends } from '../../../src/adt/ddic-extensions.js';
import { ExtensionDiscoverySession } from '../../../src/adt/extension-discovery.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { buildStructureHierarchy } from '../../../src/adt/structure-hierarchy.js';
import { handleSAPRead } from '../../../src/handlers/read.js';

const base = '/sap/bc/adt/ddic/tables/zbase';
const source = 'define table zbase {\n key id : abap.int4;\n}\n';
const meta = (href = './zbase/enhancement/elements', name = 'zbase') =>
  `<blueSource name="${name}" type="TABL/DT" version="active"><link rel="http://www.sap.com/adt/relations/enhancements" href="${href}"/></blueSource>`;
const elements =
  '<elementInfo name="zbase" type="TABL/DT"><elementInfo name="zappend" type="TABL/DS" uri="/sap/bc/adt/ddic/structures/zappend/source/main"/></elementInfo>';
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
async function setup(listener?: RequestListener) {
  const sends: string[] = [];
  const server = createServer((req, res) => {
    sends.push(`${req.method} ${req.url}`);
    if (new URL(req.url!, 'http://local').pathname.toLowerCase() === `${base}/source/main`) {
      res.end(source);
      return;
    }
    if (listener) {
      listener(req, res);
      return;
    }
    if (new URL(req.url!, 'http://local').pathname.toLowerCase() === base) res.end(meta());
    else res.end(elements);
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP');
  return {
    sends,
    client: new AdtClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      safety: defaultSafetyConfig(),
      retryUnauthorized: false,
    }),
  };
}
const read = (client: AdtClient, args: Record<string, unknown> = {}) =>
  handleSAPRead(client, { type: 'TABL', name: 'zbase', ...args }, undefined, { isPerUserClient: false }, false);
const summary = (text: string) => JSON.parse(text.replace(/^\[extensions\] /, ''));

describe('optional DDIC phase through real HTTP transport', () => {
  it.each([403, 429, 200])(
    'explicit structure preserves the root and cannot index-fallback after unsafe/status %s',
    async (status) => {
      const { client, sends } = await setup((_req, res) => {
        res.statusCode = status;
        res.end('<html/>');
      });
      const result = await buildStructureHierarchy(client, 'zbase');
      expect(result.tree.structure).toBe('ZBASE');
      expect(result.summary.appends).toBe(0);
      expect(sends).toHaveLength(2);
      expect(sends.every((send) => send.startsWith('GET'))).toBe(true);
      expect(result.extensionDiscovery?.providers).toEqual(
        expect.arrayContaining([expect.objectContaining({ status: status === 403 ? 'denied' : 'incomplete' })]),
      );
    },
  );
  it('disables transient retries during CSRF bootstrap too', async () => {
    const { client, sends } = await setup((_req, res) => {
      res.statusCode = 503;
      res.end('busy');
    });
    const s = new ExtensionDiscoverySession(
      'summary',
      { root: { type: 'TABL', name: 'zbase', version: 'active' }, scope: 'object' },
      client.safety,
    );
    await s.provider({ id: 'oracle', family: 'test', status: 'returned', coverage: 'selected_source' }, () =>
      s
        .read('TABL', (options) => client.http.post('/sap/bc/adt/test', 'read', 'text/plain', undefined, options))
        .then(() => {}),
    );
    expect(sends).toHaveLength(1);
    expect(sends[0]).toContain('HEAD');
    expect(s.result.providers[0]?.reason).toBe('http_503');
  });
  it('charges multiple error bodies against one aggregate response allowance', async () => {
    const { client, sends } = await setup((_req, res) => {
      res.statusCode = 404;
      res.end('x'.repeat(80 * 1024));
    });
    const s = new ExtensionDiscoverySession(
      'summary',
      { root: { type: 'TABL', name: 'zbase', version: 'active' }, scope: 'object' },
      client.safety,
    );
    for (let i = 0; i < 3; i++)
      await s.provider({ id: 'oracle', family: 'test', status: 'returned', coverage: 'selected_source' }, () =>
        s.read('TABL', (options) => client.http.get('/sap/bc/adt/test', undefined, options)).then(() => {}),
      );
    expect(sends).toHaveLength(2);
    expect(s.stopped).toBe(true);
    expect(s.result.omissions.wire_bytes).toBe(1);
    expect(s.options.responseBudget!.consumedBytes).toBeGreaterThanOrEqual(80 * 1024);
  });
  it('keeps CSRF GET fallback bodies inside the same streamed allowance', async () => {
    const { client, sends } = await setup((req, res) => {
      if (req.method === 'HEAD') {
        res.statusCode = 405;
        res.end();
        return;
      }
      res.setHeader('x-csrf-token', 'LOCAL');
      res.end('x'.repeat(80 * 1024));
    });
    const s = new ExtensionDiscoverySession(
      'summary',
      { root: { type: 'TABL', name: 'zbase', version: 'active' }, scope: 'object' },
      client.safety,
    );
    await s.provider({ id: 'oracle', family: 'test', status: 'returned', coverage: 'selected_source' }, () =>
      s
        .read('TABL', (options) => client.http.post('/sap/bc/adt/test', 'read', 'text/plain', undefined, options))
        .then(() => {}),
    );
    expect(sends.map((line) => line.split(' ')[0])).toEqual(['HEAD', 'GET', 'POST']);
    expect(s.result.omissions.wire_bytes).toBe(1);
    expect(s.stopped).toBe(true);
  });
  it('preserves the first block, sends only two linked GETs, and none returns the whole legacy result', async () => {
    const { client, sends } = await setup();
    expect(await read(client, { extensions: 'none' })).toEqual({ content: [{ type: 'text', text: source }] });
    expect(sends).toHaveLength(1);
    sends.length = 0;
    const result = await read(client);
    expect(result.content[0]).toEqual({ type: 'text', text: source });
    expect(result.isError).toBeUndefined();
    expect(summary(result.content[1]!.text)).toMatchObject({
      identities: [{ name: 'ZAPPEND' }],
      consumed: { sends: 2 },
    });
    expect(sends).toHaveLength(3);
    expect(sends.every((path) => !/where|usage|zappend/i.test(path))).toBe(true);
  });
  it('partial reads default none, explicit coverage labels owning scope, and inactive mode never reads active providers', async () => {
    const { client, sends } = await setup();
    const partial = await read(client, { lineStart: 1, lineEnd: 1 });
    expect(partial.content).toHaveLength(1);
    expect(sends).toHaveLength(1);
    const explicit = await read(client, { lineStart: 1, lineEnd: 1, extensions: 'summary' });
    expect(summary(explicit.content[1]!.text).scope).toContain('owning object/source');
    sends.length = 0;
    const inactive = await read(client, { version: 'inactive' });
    expect(summary(inactive.content[1]!.text).providers[0]).toMatchObject({
      status: 'unsupported',
      reason: 'unsupported_version',
    });
    expect(sends.some((path) => /enhancement/.test(path))).toBe(false);
  });
  it.each([401, 403, 429, 500])('preserves the base and stops optional fallback on HTTP %s', async (status) => {
    const { client, sends } = await setup((_req, res) => {
      res.statusCode = status;
      res.end('private authentication body');
    });
    const result = await read(client);
    expect(result.content[0]!.text).toBe(source);
    expect(result.isError).toBeUndefined();
    expect(sends).toHaveLength(2);
    expect(result.content[1]!.text).not.toContain('private');
    expect(summary(result.content[1]!.text).providers[0]).toMatchObject({
      status: [401, 403].includes(status) ? 'denied' : 'incomplete',
      reason: `http_${status}`,
    });
  });
  it.each([
    ['missing', 'not_advertised'],
    ['empty', 'returned'],
  ])('keeps %s relation separate from valid empty response', async (mode, status) => {
    const { client, sends } = await setup((req, res) =>
      res.end(
        new URL(req.url!, 'http://local').pathname.toLowerCase() === base
          ? mode === 'missing'
            ? '<blueSource name="zbase" type="TABL/DT"/>'
            : meta()
          : '<elementInfo><properties/></elementInfo>',
      ),
    );
    const result = await read(client);
    expect(summary(result.content[1]!.text).providers[0].status).toBe(status);
    expect(sends).toHaveLength(mode === 'missing' ? 2 : 3);
  });
  it.each([
    meta('./other/enhancements'),
    meta('https://evil.invalid/x'),
    meta(undefined, 'zother'),
    '<html/>',
    '<blueSource>',
  ])('blocks malformed/wrong-root metadata before following links: %s', async (xml) => {
    const { client, sends } = await setup((_req, res) => res.end(xml));
    const result = await read(client);
    expect(result.content[0]!.text).toBe(source);
    expect(sends).toHaveLength(2);
    expect(summary(result.content[1]!.text).providers[0].reason).toBe('invalid_provider_response');
  });
  it('honors hidden TABL denial while preserving an already obtained base', async () => {
    const { client, sends } = await setup();
    client.safety.denyActions = ['SAPRead.TABL'];
    const result = await read(client);
    expect(sends).toHaveLength(1);
    expect(summary(result.content[1]!.text).providers[0].status).toBe('denied');
  });
  it.each(['summary', 'sources'] as const)('enforces streaming response bytes for %s', async (mode) => {
    const { client } = await setup((_req, res) => {
      for (let i = 0; i < 300; i++) res.write('x'.repeat(1024));
      res.end();
    });
    await client.getTabl('zbase');
    const s = new ExtensionDiscoverySession(
      mode,
      { root: { type: 'TABL', name: 'zbase', version: 'active' }, scope: 'object' },
      client.safety,
    );
    await discoverDdicAppends(client, s, 'zbase');
    expect(s.stopped).toBe(true);
    expect(s.result.omissions.wire_bytes).toBe(1);
    expect(s.options.attemptBudget!.used).toBe(1);
  });
  it('enforces the deadline in flight and propagates explicit caller cancellation', async () => {
    const { client, sends } = await setup((_req, res) => {
      const timer = setTimeout(() => res.end(meta()), 200);
      res.on('close', () => clearTimeout(timer));
    });
    await client.getTabl('zbase');
    const request = { root: { type: 'TABL', name: 'zbase', version: 'active' }, scope: 'object' };
    const s = new ExtensionDiscoverySession('summary', request, client.safety, { deadline: Date.now() + 30 });
    await discoverDdicAppends(client, s, 'zbase');
    expect(s.result.omissions.deadline).toBe(1);
    expect(sends).toHaveLength(2);
    const abort = new ExtensionDiscoverySession('summary', request, client.safety, { signal: AbortSignal.abort() });
    await expect(discoverDdicAppends(client, abort, 'zbase')).rejects.toThrow();
    expect(sends).toHaveLength(2);
  });
  it.each(['summary', 'sources'] as const)(
    'counts actual GET, CSRF and POST sends against the %s cap',
    async (mode) => {
      const { client, sends } = await setup((req, res) => {
        if (req.method === 'HEAD') res.setHeader('x-csrf-token', 'LOCAL');
        res.end('ok');
      });
      const s = new ExtensionDiscoverySession(
        mode,
        { root: { type: 'TABL', name: 'zbase', version: 'active' }, scope: 'object' },
        client.safety,
      );
      await s.provider({ id: 'oracle', family: 'test', status: 'returned', coverage: 'selected_source' }, async () => {
        await s.read('TABL', (opts) => client.http.post('/sap/bc/adt/test', 'read', 'text/plain', undefined, opts));
        for (let i = 0; i < s.limits.sends; i++)
          await s.read('TABL', (opts) => client.http.get('/sap/bc/adt/test', undefined, opts));
      });
      expect(sends).toHaveLength(s.limits.sends);
      expect(s.result.omissions.requests).toBe(1);
      expect(sends.slice(0, 2).map((line) => line.split(' ')[0])).toEqual(['HEAD', 'POST']);
    },
  );
});
