import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AdtClientConfig } from '../../../src/adt/config.js';
import { PerUserTransportPool } from '../../../src/server/per-user-transport.js';

let elapsed = 0;
let wallTime = 1_800_000_000_000;
function jwt(sub = 'alice', exp: unknown = wallTime / 1000 + 3600) {
  return `header.${Buffer.from(JSON.stringify({ sub, exp })).toString('base64url')}.signature`;
}
function config(): Partial<AdtClientConfig> {
  return {
    baseUrl: 'http://sap:8000',
    client: '001',
    sapConnectivityAuth: `Bearer ${jwt()}`,
    btpProxy: {
      protocol: 'http',
      host: 'proxy',
      port: 20003,
      locationId: 'CC',
      getProxyToken: async () => 'service-token',
    },
  };
}
function client(pool: PerUserTransportPool, changes: Partial<AdtClientConfig> = {}, destination = 'PP') {
  return pool.client({ ...config(), ...changes }, destination).client;
}
beforeEach(() => {
  elapsed = 0;
  wallTime = 1_800_000_000_000;
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
  vi.spyOn(Date, 'now').mockImplementation(() => wallTime);
});
afterEach(() => vi.restoreAllMocks());

it('shares only the transport, never the AdtClient and its metadata/package caches', () => {
  const pool = new PerUserTransportPool(600_000);
  const first = client(pool);
  const next = client(pool);
  expect(next).not.toBe(first);
  expect(next.http).toBe(first.http);
  expect(pool.size).toBe(1);
});

it.each([
  ['credential', () => ({ sapConnectivityAuth: `Bearer ${jwt('bob')}` })],
  ['URL', () => ({ baseUrl: 'http://other-sap:8000' })],
  ['SAP client', () => ({ client: '002' })],
  ['proxy protocol', () => ({ btpProxy: { ...config().btpProxy!, protocol: 'https' as const } })],
  ['proxy host', () => ({ btpProxy: { ...config().btpProxy!, host: 'other-proxy' } })],
  ['proxy port', () => ({ btpProxy: { ...config().btpProxy!, port: 20004 } })],
  ['Cloud Connector', () => ({ btpProxy: { ...config().btpProxy!, locationId: 'OTHER' } })],
] as const)('isolates a changed %s', (_name, change) => {
  const pool = new PerUserTransportPool(600_000);
  const first = client(pool);
  expect(client(pool, change()).http).not.toBe(first.http);
});

it('isolates different destination names', () => {
  const pool = new PerUserTransportPool(600_000);
  expect(client(pool).http).not.toBe(client(pool, {}, 'OTHER').http);
});

it.each([
  ['reserved proxy credential', () => ({ sapConnectivityAuth: undefined, ppProxyAuth: `Bearer ${jwt()}` })],
  ['no proxy', () => ({ btpProxy: undefined })],
  ['Bearer', () => ({ sapConnectivityAuth: undefined, bearerTokenProvider: async () => 'bearer' })],
  ['SAML', () => ({ sapConnectivityAuth: undefined, samlAuthorization: 'SAML2.0 assertion' })],
  ['opaque credential', () => ({ sapConnectivityAuth: 'opaque-credential' })],
  ['unknown credential expiry', () => ({ sapConnectivityAuth: `Bearer ${jwt('alice', null)}` })],
  ['expired credential', () => ({ sapConnectivityAuth: `Bearer ${jwt('alice', wallTime / 1000)}` })],
] as const)('keeps %s request-local', (_name, change) => {
  const pool = new PerUserTransportPool(600_000);
  expect(client(pool, change()).http).not.toBe(client(pool, change()).http);
  expect(pool.size).toBe(0);
});

it('expires at an absolute monotonic age even when continually used and the wall clock moves backwards', () => {
  const pool = new PerUserTransportPool(1000);
  const cfg = config();
  const first = pool.client(cfg, 'PP').client;
  elapsed = 999;
  wallTime -= 60_000;
  expect(pool.client(cfg, 'PP').client.http).toBe(first.http);
  elapsed = 1000;
  expect(pool.client(cfg, 'PP').client.http).not.toBe(first.http);
});

it('retires short-lived credentials even when an older entry is still live', () => {
  const pool = new PerUserTransportPool(600_000);
  const older = client(pool);
  const cfg = { ...config(), sapConnectivityAuth: `Bearer ${jwt('bob', wallTime / 1000 + 1)}` };
  elapsed = 10;
  const first = pool.client(cfg, 'PP').client;
  elapsed += 1000;
  wallTime += 1000;
  expect(pool.client(cfg, 'PP').client.http).not.toBe(first.http);
  expect(pool.size).toBe(1);
  // The expired credential never removes another user's live transport.
  expect(
    pool.client({ ...config(), sapConnectivityAuth: `Bearer ${jwt('alice', wallTime / 1000 + 3599)}` }, 'PP').client
      .http,
  ).toBe(older.http);
});

it('bounds entries by evicting the oldest transport', () => {
  const pool = new PerUserTransportPool(600_000, 2);
  const alice = client(pool);
  const bob = client(pool, { sapConnectivityAuth: `Bearer ${jwt('bob')}` });
  client(pool, { sapConnectivityAuth: `Bearer ${jwt('carol')}` });
  expect(pool.size).toBe(2);
  expect(client(pool, { sapConnectivityAuth: `Bearer ${jwt('bob')}` }).http).toBe(bob.http);
  expect(client(pool).http).not.toBe(alice.http);
});
