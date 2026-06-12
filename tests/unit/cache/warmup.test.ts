import { describe, expect, it, vi } from 'vitest';
import type { AdtClient } from '../../../src/adt/client.js';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { runWarmup } from '../../../src/cache/warmup.js';

class TransactionTrackingCache extends MemoryCache {
  transactionCalls = 0;

  override transaction<T>(fn: () => T): T {
    this.transactionCalls += 1;
    return super.transaction(fn);
  }
}

describe('cache warmup', () => {
  it('stores fetched object writes in one transaction per warmup batch', async () => {
    const cache = new TransactionTrackingCache();
    const cachingLayer = new CachingLayer(cache);
    const client = {
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

    const result = await runWarmup(client, cachingLayer);

    expect(result).toMatchObject({ totalObjects: 2, fetched: 2, failed: 0 });
    expect(cache.transactionCalls).toBe(1);
    expect(cache.getSource('CLAS', 'ZCL_WARMUP_TX')?.etag).toBe('class-etag');
    expect(cache.getSource('INTF', 'ZIF_WARMUP_TX')?.etag).toBe('interface-etag');
    expect(cache.getNode('CLAS:ZCL_WARMUP_TX')).not.toBeNull();
    expect(cachingLayer.isWarmupAvailable).toBe(true);
  });
});
