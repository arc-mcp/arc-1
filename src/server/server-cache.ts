/** Cache startup kept separate from MCP tool and authorization construction. */
import type { Cache } from '../cache/cache.js';
import { CachingLayer } from '../cache/caching-layer.js';
import { MemoryCache } from '../cache/memory.js';
import { logger } from './logger.js';
import type { ServerConfig } from './types.js';

/** Load the native SQLite dependency only for the explicit persistent-cache opt-in. */
export async function createCachingLayer(config: ServerConfig): Promise<CachingLayer | undefined> {
  const mode = config.cacheMode;
  if (mode === 'none') return undefined;
  let cache: Cache;
  if (mode === 'sqlite') {
    logger.warn(
      'ARC1_CACHE=sqlite stores SAP source in plaintext at rest; use ARC1_CACHE=memory/none or encrypted storage for IP-sensitive landscapes.',
    );
    try {
      // Keep the optional native better-sqlite3 dependency out of memory/none startup paths.
      const { SqliteCache } = await import('../cache/sqlite.js');
      cache = new SqliteCache(config.cacheFile);
    } catch (err) {
      logger.warn('SQLite cache unavailable (better-sqlite3 not loaded) — falling back to memory cache', {
        error: err instanceof Error ? err.message : String(err),
      });
      cache = new MemoryCache();
    }
  } else {
    cache = new MemoryCache();
  }
  const maxActivityEntries = config.uiMode === 'off' ? 0 : undefined;
  return new CachingLayer(cache, maxActivityEntries);
}
