import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { AdtHttpClient } from '../../../src/adt/http.js';
import { resolveConfig } from '../../../src/server/config.js';
import { buildAdtConfig, VERSION } from '../../../src/server/server.js';

const version = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version;
const received: Array<{ method: string; path: string; agent: string | undefined }> = [];
let posts = 0;
let baseUrl: string;
const server = createServer((req, res) => {
  received.push({ method: req.method!, path: req.url!, agent: req.headers['user-agent'] });
  if (req.headers['x-csrf-token'] === 'fetch') res.setHeader('x-csrf-token', 'TOKEN');
  if (req.headers['x-sap-adt-sessiontype'] === 'stateful')
    res.setHeader('set-cookie', 'sap-contextid=TEST_CONTEXT; Path=/');
  if (req.method === 'POST' && ++posts === 1) res.statusCode = 403;
  res.end('ok');
});
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  received.length = 0;
  posts = 0;
  vi.stubEnv('SAP_USER_AGENT', '');
});
afterEach(() => vi.unstubAllEnvs());

it.each([undefined, 'arc-1/company-test'])(
  'sends %s on reads, CSRF refresh, stateful writes and close',
  async (override) => {
    if (override) vi.stubEnv('SAP_USER_AGENT', override);
    const { config } = resolveConfig(['--url', baseUrl]);
    const client = new AdtClient(buildAdtConfig(config));
    await client.http.get('/read');
    if (!override) await new AdtHttpClient({ baseUrl }).get('/direct');
    await client.http.withStatefulSession((session) => session.post('/write'));
    expect(posts).toBe(2);
    expect(received.filter((r) => r.method === 'HEAD')).toHaveLength(2);
    expect(received.some((r) => r.path.includes('/http/sessions'))).toBe(true);
    expect(received.map((r) => r.agent)).toEqual(received.map(() => override ?? `arc-1/${version}`));
    expect(VERSION).toBe(version);
  },
);

it('gives the CLI override precedence and records its configuration source', () => {
  vi.stubEnv('SAP_USER_AGENT', 'arc-1/environment');
  const { config, sources } = resolveConfig(['--user-agent', '  arc-1/cli  ']);
  expect(config.userAgent).toBe('arc-1/cli');
  expect(sources.userAgent).toEqual({ flag: '--user-agent' });
});

it.each(['arc-1/ok\r\nX-Test: injected', 'arc-1/ä', 'x'.repeat(257)])(
  'rejects an unsafe or overlong configured header',
  (value) => {
    vi.stubEnv('SAP_USER_AGENT', value);
    expect(() => resolveConfig([])).toThrow(/SAP_USER_AGENT/);
    expect(() => new AdtHttpClient({ baseUrl, userAgent: value })).toThrow(/SAP_USER_AGENT/);
  },
);
