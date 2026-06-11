import type { AdtClient } from '../adt/client.js';
import type { InactiveObject } from '../adt/types.js';

interface CachedInactiveList {
  userKey: string;
  objects: InactiveObject[];
  fetchedAt: number;
}

export class InactiveListCache {
  private byUserKey = new Map<string, CachedInactiveList>();
  private ttlMs = 60_000;

  async getOrFetch(client: AdtClient, ...userKeyArg: [] | [string | undefined]): Promise<InactiveObject[]> {
    const keySource = userKeyArg.length > 0 ? userKeyArg[0] : client.username;
    const key = typeof keySource === 'string' ? keySource.trim() : '';
    if (!key) return client.getInactiveObjects();

    const cached = this.byUserKey.get(key);
    if (cached && Date.now() - cached.fetchedAt < this.ttlMs) {
      return cached.objects;
    }

    const objects = await client.getInactiveObjects();
    this.byUserKey.set(key, {
      userKey: key,
      objects,
      fetchedAt: Date.now(),
    });
    return objects;
  }

  getCached(userKey: string): InactiveObject[] | null {
    return this.byUserKey.get(userKey.trim())?.objects ?? null;
  }

  invalidate(userKey: string | undefined): void {
    const key = userKey?.trim();
    if (!key) return;
    this.byUserKey.delete(key);
  }

  clear(): void {
    this.byUserKey.clear();
  }

  stats(): { userCount: number; totalEntries: number } {
    let totalEntries = 0;
    for (const cached of this.byUserKey.values()) {
      totalEntries += cached.objects.length;
    }
    return {
      userCount: this.byUserKey.size,
      totalEntries,
    };
  }
}
