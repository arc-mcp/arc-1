import { describe, expect, it, vi } from 'vitest';
import type { AdtClient } from '../../../src/adt/client.js';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { SqliteCache } from '../../../src/cache/sqlite.js';
import { runWarmup } from '../../../src/cache/warmup.js';

class TransactionTrackingCache extends MemoryCache {
  transactionCalls = 0;

  override transaction<T>(fn: () => T): T {
    this.transactionCalls += 1;
    return super.transaction(fn);
  }
}

class TransactionTrackingSqliteCache extends SqliteCache {
  transactionCalls = 0;

  override transaction<T>(fn: () => T): T {
    this.transactionCalls += 1;
    return super.transaction(fn);
  }
}

// One CLAS that depends on one INTF, both returned in a single warmup batch.
function makeWarmupClient(): AdtClient {
  return {
    runQuery: vi.fn(async (sql: string) => ({
      rows: sql.includes("LIKE 'Z%'")
        ? [
            { OBJECT: 'CLAS', OBJ_NAME: 'ZCL_WARMUP_TX', DEVCLASS: 'ZPKG' },
            { OBJECT: 'INTF', OBJ_NAME: 'ZIF_WARMUP_TX', DEVCLASS: 'ZPKG' },
          ]
        : [],
    })),
    getClass: vi.fn(async () => ({
      source: [
        'CLASS zcl_warmup_tx DEFINITION PUBLIC FINAL CREATE PUBLIC.',
        '  PUBLIC SECTION.',
        '    INTERFACES zif_warmup_tx.',
        'ENDCLASS.',
        'CLASS zcl_warmup_tx IMPLEMENTATION.',
        'ENDCLASS.',
      ].join('\n'),
      etag: 'class-etag',
    })),
    getInterface: vi.fn(async () => ({
      source: ['INTERFACE zif_warmup_tx PUBLIC.', 'ENDINTERFACE.'].join('\n'),
      etag: 'interface-etag',
    })),
  } as unknown as AdtClient;
}

describe('cache warmup', () => {
  it('stores fetched object writes in one transaction per warmup batch', async () => {
    const cache = new TransactionTrackingCache();
    const cachingLayer = new CachingLayer(cache);

    const result = await runWarmup(makeWarmupClient(), cachingLayer);

    expect(result).toMatchObject({ totalObjects: 2, fetched: 2, failed: 0 });
    expect(cache.transactionCalls).toBe(1);
    expect(cache.getSource('CLAS', 'ZCL_WARMUP_TX')?.etag).toBe('class-etag');
    expect(cache.getSource('INTF', 'ZIF_WARMUP_TX')?.etag).toBe('interface-etag');
    expect(cache.getNode('CLAS:ZCL_WARMUP_TX')).not.toBeNull();
    expect(cachingLayer.isWarmupAvailable).toBe(true);
  });

  // The MemoryCache test above only proves the closure-collection logic, since
  // MemoryCache.transaction() is a no-op pass-through. This exercises the real
  // better-sqlite3 transaction path — the actual target of this change — and
  // proves writes (incl. ETags) survive the commit.
  it('commits a warmup batch through a real SQLite transaction with ETags preserved', async () => {
    const cache = new TransactionTrackingSqliteCache(':memory:');
    const cachingLayer = new CachingLayer(cache);

    try {
      const result = await runWarmup(makeWarmupClient(), cachingLayer);

      expect(result).toMatchObject({ totalObjects: 2, fetched: 2, failed: 0 });
      expect(cache.transactionCalls).toBe(1);
      expect(cache.getSource('CLAS', 'ZCL_WARMUP_TX')?.etag).toBe('class-etag');
      expect(cache.getSource('INTF', 'ZIF_WARMUP_TX')?.etag).toBe('interface-etag');
      expect(cache.getNode('CLAS:ZCL_WARMUP_TX')).not.toBeNull();
      expect(cachingLayer.isWarmupAvailable).toBe(true);
    } finally {
      cache.close();
    }
  });
});
