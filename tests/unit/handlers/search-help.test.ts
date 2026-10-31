import { readFileSync } from 'node:fs';
import { createServer, type RequestListener, type Server } from 'node:http';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { readSearchHelpMetadata } from '../../../src/adt/search-help.js';
import { handleToolCall } from '../../../src/handlers/dispatch.js';
import { resetCachedFeatures } from '../../../src/handlers/feature-cache.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

const body = readFileSync(new URL('../../fixtures/shlp/758-scustom.xml', import.meta.url), 'utf8');
const empty = readFileSync(new URL('../../fixtures/shlp/750-unavailable.xml', import.meta.url), 'utf8');
const path = '/sap/bc/adt/ddic/elementinfo';
const servers: Server[] = [];
afterEach(async () => {
  resetCachedFeatures();
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }),
  );
});
async function setup(listener: RequestListener, proxy = false, language = 'DE') {
  const server = createServer(listener);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected loopback listener');
  return new AdtClient({
    safety: defaultSafetyConfig(),
    baseUrl: proxy ? 'http://sap.invalid:8000' : `http://127.0.0.1:${address.port}`,
    client: '001',
    language,
    retryUnauthorized: false,
    ...(proxy
      ? {
          btpProxy: {
            protocol: 'http' as const,
            host: '127.0.0.1',
            port: address.port,
            getProxyToken: async () => 'synthetic-token',
          },
        }
      : {}),
  });
}
const config = { ...DEFAULT_CONFIG, systemType: 'onprem' as const };
const invoke = (client: AdtClient, tool = 'SAPRead', args: Record<string, unknown> = {}) =>
  handleToolCall(client, config, tool, { type: 'SHLP', name: 'SCUSTOM', ...args });
const text = (result: Awaited<ReturnType<typeof invoke>>) =>
  result.content.map((c) => ('text' in c ? c.text : '')).join('');

describe.each([false, true])('SHLP real HTTP proxy=%s', (proxy) => {
  it.each(['SAPRead', 'SAPContext'])(
    '%s uses one read with presence-only discovery and closed data/write gates',
    async (tool) => {
      const requests: URL[] = [];
      const client = await setup((req, res) => {
        requests.push(new URL(req.url!, 'http://local'));
        expect(req.method).toBe('GET');
        res.end(body);
      }, proxy);
      client.http.setDiscoveryMap(new Map([[path, []]]));
      const result = await invoke(client, tool, { type: 'SHLP/DH' });
      expect(result.isError).toBeUndefined();
      expect(JSON.parse(text(result))).toMatchObject({
        name: 'SCUSTOM',
        completeness: 'partial',
        language: { requested: 'DE', effective: null },
      });
      expect(requests).toHaveLength(1);
      expect(requests[0]?.pathname).toBe(path);
      expect(requests[0]?.searchParams.get('sap-client')).toBe('001');
      expect(requests[0]?.searchParams.get('sap-language')).toBe('DE');
      expect(client.safety.allowWrites).toBe(false);
      expect(client.safety.allowDataPreview).toBe(false);
    },
  );
  it.each([401, 403, 404, 500])('preserves HTTP %s as an error with no fallback', async (status) => {
    let calls = 0;
    const client = await setup((_req, res) => {
      calls++;
      res.writeHead(status);
      res.end('Synthetic failure');
    }, proxy);
    expect((await invoke(client)).isError).toBe(true);
    expect(calls).toBe(1);
  });
  it('reports unnamed 200 as unavailable, not a successful empty help', async () => {
    const client = await setup((_req, res) => res.end(empty), proxy);
    for (const tool of ['SAPRead', 'SAPContext']) {
      const result = await invoke(client, tool);
      expect(result.isError).toBe(true);
      expect(JSON.parse(text(result))).toMatchObject({ availability: 'not_available' });
    }
  });
  it('enforces a streaming response limit', async () => {
    const client = await setup((_req, res) => {
      res.write('x'.repeat(1024 * 1024));
      res.end('y'.repeat(2 * 1024 * 1024));
    }, proxy);
    const result = await invoke(client);
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/limit|large/i);
  });
  it('rejects oversized gzip through the decoded cap or proxy encoding guard', async () => {
    const compressed = gzipSync('x'.repeat(2 * 1024 * 1024 + 1));
    const client = await setup((req, res) => {
      if (proxy) expect(req.headers['accept-encoding']).toBe('identity');
      res.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Length': compressed.length });
      res.end(compressed);
    }, proxy);
    const result = await invoke(client);
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(proxy ? /Unexpected Content-Encoding 'gzip'/ : /limit|large/i);
  });
  it('encodes a namespaced name exactly once on the wire', async () => {
    const namespaced = readFileSync(new URL('../../fixtures/shlp/758-namespace.xml', import.meta.url), 'utf8');
    const requests: string[] = [];
    const client = await setup((req, res) => {
      requests.push(req.url!);
      res.end(namespaced);
    }, proxy);
    const result = await invoke(client, 'SAPRead', { name: '/aif/address_fields' });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(text(result)).name).toBe('/AIF/ADDRESS_FIELDS');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('path=%2FAIF%2FADDRESS_FIELDS');
    expect(new URL(requests[0]!, 'http://local').searchParams.get('path')).toBe('/AIF/ADDRESS_FIELDS');
  });
  it('propagates MCP cancellation into a stalled response', async () => {
    const controller = new AbortController();
    const client = await setup((_req, res) => {
      res.write('<elementInfo>');
      controller.abort();
    }, proxy);
    const result = await handleToolCall(
      client,
      config,
      'SAPRead',
      { type: 'SHLP', name: 'SCUSTOM' },
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      controller.signal,
    );
    expect(result.isError).toBe(true);
  });
});

it('caller deadlines expire before a send and interrupt a stalled native body', async () => {
  let calls = 0;
  const client = await setup((_req, res) => {
    calls++;
    res.write('<elementInfo>');
  });
  await expect(
    readSearchHelpMetadata(client.http, client.safety, 'SCUSTOM', { deadline: Date.now() - 1 }),
  ).rejects.toThrow();
  expect(calls).toBe(0);
  await expect(
    readSearchHelpMetadata(client.http, client.safety, 'SCUSTOM', { deadline: Date.now() + 100 }),
  ).rejects.toThrow();
  expect(calls).toBe(1);
});

it('does not cache metadata across requests or callers and reports the actual transport language', async () => {
  let firstCalls = 0,
    secondCalls = 0;
  const first = await setup(
    (_req, res) => {
      firstCalls++;
      res.end(firstCalls === 1 ? body : empty);
    },
    false,
    'EN',
  );
  const second = await setup(
    (_req, res) => {
      secondCalls++;
      res.end(body);
    },
    false,
    'FR',
  );
  expect(JSON.parse(text(await invoke(first))).language).toEqual({ requested: 'EN', effective: null });
  expect((await invoke(first)).isError).toBe(true);
  expect(JSON.parse(text(await invoke(second, 'SAPContext'))).language).toEqual({ requested: 'FR', effective: null });
  expect([firstCalls, secondCalls]).toEqual([2, 1]);
});
it('keeps concurrent callers and their cookies isolated on the same SAP endpoint', async () => {
  const requests: Array<{ identity: string; cookie: string | undefined }> = [];
  await setup((req, res) => {
    const identity = req.headers.authorization === 'Bearer caller-a' ? 'a' : 'b';
    requests.push({ identity, cookie: req.headers.cookie });
    res.setHeader('Set-Cookie', `SAP_SESSION=${identity}; Path=/`);
    res.end(identity === 'a' ? body : empty);
  });
  const address = servers.at(-1)!.address();
  if (!address || typeof address === 'string') throw new Error('Expected loopback listener');
  const caller = (identity: string) =>
    new AdtClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      client: '001',
      safety: defaultSafetyConfig(),
      bearerTokenProvider: async () => `caller-${identity}`,
    });
  const a = caller('a');
  const b = caller('b');
  for (const tool of ['SAPRead', 'SAPContext']) {
    const [first, second] = await Promise.all([invoke(a, tool), invoke(b, tool)]);
    expect(first.isError).toBeUndefined();
    expect(second.isError).toBe(true);
    expect(JSON.parse(text(second)).availability).toBe('not_available');
  }
  for (const identity of ['a', 'b']) {
    expect(requests.filter((r) => r.identity === identity)).toEqual([
      { identity, cookie: undefined },
      { identity, cookie: `SAP_SESSION=${identity}` },
    ]);
  }
});
it('refuses known absence and source/draft options before HTTP, but unknown discovery reads', async () => {
  let calls = 0;
  const client = await setup((_req, res) => {
    calls++;
    res.end(body);
  });
  client.http.setDiscoveryMap(new Map([['/other', []]]));
  expect((await invoke(client)).isError).toBe(true);
  client.http.setDiscoveryMap(new Map());
  for (const args of [
    { version: 'inactive' },
    { version: 'auto' },
    { format: 'editable' },
    { format: 'structured' },
    { action: 'diff' },
    { method: 'X' },
    { grep: 'X' },
    { lineStart: 1, lineEnd: 2 },
    { include: 'main' },
    { name: 'X?path=Y' },
  ]) {
    expect((await invoke(client, 'SAPRead', args)).isError).toBe(true);
  }
  for (const args of [
    { action: 'usages' },
    { action: 'structure' },
    { action: 'impact' },
    { source: 'x' },
    { includeKtd: true },
  ]) {
    expect((await invoke(client, 'SAPContext', args)).isError).toBe(true);
  }
  expect(calls).toBe(0);
  expect((await invoke(client, 'SAPContext', { action: 'deps', includeKtd: false })).isError).toBeUndefined();
  expect(calls).toBe(1);
});
it('BTP and denied scopes/actions cannot reach the native read', async () => {
  let calls = 0;
  const client = await setup((_req, res) => {
    calls++;
    res.end(body);
  });
  for (const tool of ['SAPRead', 'SAPContext']) {
    const args = { type: 'SHLP', name: 'SCUSTOM' };
    expect((await handleToolCall(client, { ...config, systemType: 'btp' }, tool, args)).isError).toBe(true);
    expect((await handleToolCall(client, { ...config, denyActions: [tool] }, tool, args)).isError).toBe(true);
    expect(
      (await handleToolCall(client, config, tool, args, { token: 'synthetic', clientId: 'test', scopes: [] })).isError,
    ).toBe(true);
    expect(
      (await handleToolCall(client, config, tool, args, { token: 'synthetic', clientId: 'test', scopes: ['read'] }))
        .isError,
    ).toBeUndefined();
  }
  expect(calls).toBe(2);
});
