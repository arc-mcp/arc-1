import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdtClient } from '../../../src/adt/client.js';
import type { InactiveObject } from '../../../src/adt/types.js';
import { InactiveListCache } from '../../../src/cache/inactive-list-cache.js';

function makeClient(username: string, objects: InactiveObject[]): AdtClient {
  return {
    username,
    getInactiveObjects: vi.fn().mockResolvedValue(objects),
  } as unknown as AdtClient;
}

describe('InactiveListCache', () => {
  let cache: InactiveListCache;

  beforeEach(() => {
    vi.useRealTimers();
    cache = new InactiveListCache();
  });

  it('getOrFetch fetches from client on first call and caches', async () => {
    const client = makeClient('MARIAN', [{ name: 'ZCL_A', type: 'CLAS/OC', uri: '/a' }]);

    expect(await cache.getOrFetch(client)).toHaveLength(1);
    expect(await cache.getOrFetch(client)).toHaveLength(1);
    expect(client.getInactiveObjects).toHaveBeenCalledTimes(1);
  });

  it('uses an explicit user key instead of client.username', async () => {
    const alice = makeClient('', [{ name: 'ZCL_ALICE', type: 'CLAS/OC', uri: '/alice' }]);
    const bob = makeClient('', [{ name: 'ZCL_BOB', type: 'CLAS/OC', uri: '/bob' }]);

    expect(await cache.getOrFetch(alice, 'sub-alice')).toEqual([{ name: 'ZCL_ALICE', type: 'CLAS/OC', uri: '/alice' }]);
    expect(await cache.getOrFetch(bob, 'sub-bob')).toEqual([{ name: 'ZCL_BOB', type: 'CLAS/OC', uri: '/bob' }]);
    expect(await cache.getOrFetch(alice, 'sub-alice')).toEqual([{ name: 'ZCL_ALICE', type: 'CLAS/OC', uri: '/alice' }]);

    expect(alice.getInactiveObjects).toHaveBeenCalledTimes(1);
    expect(bob.getInactiveObjects).toHaveBeenCalledTimes(1);
    expect(cache.getCached('sub-alice')?.[0]?.name).toBe('ZCL_ALICE');
    expect(cache.getCached('sub-bob')?.[0]?.name).toBe('ZCL_BOB');
  });

  it('bypasses the cache when no non-empty key is available', async () => {
    const client = makeClient('', [{ name: 'ZCL_A', type: 'CLAS/OC', uri: '/a' }]);

    await cache.getOrFetch(client, '');
    await cache.getOrFetch(client, '  ');

    expect(client.getInactiveObjects).toHaveBeenCalledTimes(2);
    expect(cache.stats()).toEqual({ userCount: 0, totalEntries: 0 });
  });

  it('bypasses the cache for an explicit undefined key even when client.username is set', async () => {
    const client = makeClient('SHARED_DISPLAY', [{ name: 'ZCL_A', type: 'CLAS/OC', uri: '/a' }]);

    await cache.getOrFetch(client, undefined);
    await cache.getOrFetch(client, undefined);

    expect(client.getInactiveObjects).toHaveBeenCalledTimes(2);
    expect(cache.stats()).toEqual({ userCount: 0, totalEntries: 0 });
  });

  it('getOrFetch refetches after TTL expiry', async () => {
    vi.useFakeTimers();
    const client = makeClient('MARIAN', [{ name: 'ZCL_A', type: 'CLAS/OC', uri: '/a' }]);

    await cache.getOrFetch(client);
    vi.advanceTimersByTime(60_001);
    await cache.getOrFetch(client);
    expect(client.getInactiveObjects).toHaveBeenCalledTimes(2);
  });

  it('invalidate clears one user entry only', async () => {
    const marian = makeClient('MARIAN', [{ name: 'ZCL_A', type: 'CLAS/OC', uri: '/a' }]);
    const other = makeClient('OTHER', [{ name: 'ZCL_B', type: 'CLAS/OC', uri: '/b' }]);

    await cache.getOrFetch(marian);
    await cache.getOrFetch(other);
    cache.invalidate('MARIAN');

    expect(cache.getCached('MARIAN')).toBeNull();
    expect(cache.getCached('OTHER')).toHaveLength(1);
  });

  it('getCached returns null when not cached', () => {
    expect(cache.getCached('MARIAN')).toBeNull();
  });

  it('getCached returns cached list when present', async () => {
    const objects = [{ name: 'ZCL_A', type: 'CLAS/OC', uri: '/a' }];
    const client = makeClient('MARIAN', objects);

    await cache.getOrFetch(client);
    expect(cache.getCached('MARIAN')).toEqual(objects);
  });

  it('clear drops all entries', async () => {
    await cache.getOrFetch(makeClient('MARIAN', [{ name: 'ZCL_A', type: 'CLAS/OC', uri: '/a' }]));
    await cache.getOrFetch(makeClient('OTHER', [{ name: 'ZCL_B', type: 'CLAS/OC', uri: '/b' }]));

    cache.clear();

    expect(cache.getCached('MARIAN')).toBeNull();
    expect(cache.getCached('OTHER')).toBeNull();
  });

  it('stats reports counts correctly', async () => {
    await cache.getOrFetch(makeClient('MARIAN', [{ name: 'ZCL_A', type: 'CLAS/OC', uri: '/a' }]));
    await cache.getOrFetch(
      makeClient('OTHER', [
        { name: 'ZCL_B', type: 'CLAS/OC', uri: '/b' },
        { name: 'ZCL_C', type: 'CLAS/OC', uri: '/c' },
      ]),
    );

    expect(cache.stats()).toEqual({ userCount: 2, totalEntries: 3 });
  });
});
