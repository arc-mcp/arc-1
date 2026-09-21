import { createHash } from 'node:crypto';
import { Registry } from '@abaplint/core';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdtClient, SourceReadOptions } from '../../../src/adt/client.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import { type Cache, hashSource } from '../../../src/cache/cache.js';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { SqliteCache } from '../../../src/cache/sqlite.js';
import { handleSAPContext } from '../../../src/handlers/context.js';

const source = (name: string, targets: string[] = [], method = 'go') =>
  `CLASS ${name} DEFINITION PUBLIC. PUBLIC SECTION. CLASS-METHODS ${method}. ENDCLASS.
CLASS ${name} IMPLEMENTATION. METHOD ${method}. ${targets.map((t) => `${t}=>go( ).`).join(' ')} ENDMETHOD. ENDCLASS.`;
const root = source('ZCL_ROOT', ['ZCL_A', 'ZCL_B']);
function fixture() {
  const sources = new Map([
    ['ZCL_A', source('ZCL_A', ['ZCL_C'])],
    ['ZCL_B', source('ZCL_B')],
    ['ZCL_C', source('ZCL_C')],
  ]);
  const calls: { conditional: boolean; bytes: number }[] = [];
  const denied = new Map<string, number>();
  const client = {
    getClass: async (name: string, _include?: string, options: SourceReadOptions = {}) => {
      name = name.toUpperCase();
      const call = { conditional: !!options.ifNoneMatch, bytes: 0 };
      calls.push(call);
      if (denied.has(name)) throw new AdtApiError('Access failure', denied.get(name)!, '/synthetic');
      const body = sources.get(name);
      if (body === undefined) throw new AdtApiError('Missing dependency', 404, '/synthetic');
      const etag = createHash('sha256').update(body).digest('hex');
      if (options.ifNoneMatch === etag) return { source: '', etag, notModified: true };
      call.bytes = Buffer.byteLength(body);
      return { source: body, etag };
    },
  } as unknown as AdtClient;
  return { sources, calls, denied, client };
}
const run = async (
  f: ReturnType<typeof fixture>,
  cache: CachingLayer,
  options: { depth: number; maxDeps: number },
  perUser = false,
) =>
  (
    await handleSAPContext(
      f.client,
      { type: 'CLAS', name: 'ZCL_ROOT', source: root, includeKtd: false, ...options },
      cache,
      { isPerUserClient: perUser, userKey: perUser ? 'verified-user' : undefined },
    )
  ).content[0]!.text;

describe.each(['memory', 'sqlite'] as const)('SAPContext freshness (%s)', (backend) => {
  const stores: Cache[] = [];
  const layer = () => {
    const store = backend === 'memory' ? new MemoryCache() : new SqliteCache(':memory:');
    stores.push(store);
    return new CachingLayer(store);
  };
  afterEach(() => {
    vi.restoreAllMocks();
    for (const store of stores.splice(0)) store.close();
  });

  it.each([
    [
      { depth: 1, maxDeps: 1 },
      { depth: 2, maxDeps: 3 },
    ],
    [
      { depth: 2, maxDeps: 3 },
      { depth: 1, maxDeps: 1 },
    ],
  ])('does not reuse aggregate options %j → %j', async (first, next) => {
    const f = fixture(),
      cache = layer();
    await run(f, cache, first);
    expect(await run(f, cache, next)).toBe(await run(fixture(), layer(), next));
    expect(cache.stats().contractCount).toBe(0);
  });

  it('refreshes changed dependencies while the root and legacy aggregate stay unchanged', async () => {
    const f = fixture(),
      cache = layer();
    await run(f, cache, { depth: 1, maxDeps: 1 });
    if (backend === 'sqlite') {
      // Existing SQLite files may retain old aggregates. No production API can read or update them.
      const db = (cache.cache as unknown as { db: Database.Database }).db;
      db.prepare('INSERT INTO dep_graphs VALUES (?, ?, ?, ?, ?)').run(
        hashSource(root),
        'ZCL_ROOT',
        'CLAS',
        JSON.stringify([{ name: 'ZCL_A', type: 'CLAS', methodCount: 1, source: 'STALE CONTRACT', success: true }]),
        '2026-01-01',
      );
    }
    f.sources.set('ZCL_A', source('ZCL_A', [], 'fresh_api'));
    const result = await run(f, cache, { depth: 1, maxDeps: 1 });
    expect(result).toContain('fresh_api');
    expect(result).not.toContain('STALE CONTRACT');
    expect(cache.stats().contractCount).toBe(backend === 'sqlite' ? 1 : 0);
  });

  it('retains conditional reads and zero-body 304 source reuse', async () => {
    const parse = vi.spyOn(Registry.prototype, 'parse');
    const f = fixture(),
      cache = layer(),
      options = { depth: 2, maxDeps: 3 };
    const first = await run(f, cache, options);
    expect(parse.mock.calls.length).toBeGreaterThan(0);
    parse.mockClear();
    f.calls.length = 0;
    expect(await run(f, cache, options)).toBe(first);
    expect(f.calls).toEqual(Array.from({ length: 3 }, () => ({ conditional: true, bytes: 0 })));
    expect(parse).not.toHaveBeenCalled();
    f.sources.set('ZCL_A', source('ZCL_A', ['ZCL_C'], 'fresh_api'));
    expect(await run(f, cache, options)).toContain('fresh_api');
    expect(parse.mock.calls.length).toBeGreaterThan(0);
  });

  it.each([403, 404])('does not serve stale contracts after HTTP %i', async (status) => {
    const f = fixture(),
      cache = layer(),
      options = { depth: 1, maxDeps: 1 };
    await run(f, cache, options);
    f.denied.set('ZCL_A', status);
    const result = await run(f, cache, options);
    expect(result).toContain('1 failed');
    expect(result).not.toContain('CLASS-METHODS');
    if (status === 404) expect(cache.getCachedSource('CLAS', 'ZCL_A')).toBeNull();
  });

  it('preserves per-user dependency-source bypass', async () => {
    const f = fixture(),
      cache = layer(),
      options = { depth: 1, maxDeps: 1 };
    await run(f, cache, options);
    f.denied.set('ZCL_A', 403);
    expect(await run(f, cache, options, true)).toContain('1 failed');
    expect(f.calls.at(-1)?.conditional).toBe(false);
  });

  it('does not reuse shared parse results under principal propagation', async () => {
    const f = fixture(),
      cache = layer(),
      options = { depth: 2, maxDeps: 3 };
    const first = await run(f, cache, options);
    const parse = vi.spyOn(Registry.prototype, 'parse');
    f.calls.length = 0;
    expect(await run(f, cache, options, true)).toBe(first);
    expect(parse.mock.calls.length).toBeGreaterThan(0);
    expect(f.calls.every((call) => !call.conditional)).toBe(true);
  });
});
