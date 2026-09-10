import type { Version } from '@abaplint/core';
import { hashSource } from '../cache/cache.js';
import type { CachingLayer } from '../cache/caching-layer.js';
import { DEFAULT_CONTRACT_VERSION, extractContract } from './contract.js';
import { DEFAULT_DEPENDENCY_VERSION, extractDependencies } from './deps.js';
import type { Contract, Dependency } from './types.js';

/** Process-local pure parse memoization. Never contains ASTs, aggregates or fullSource. */
export class ContextParseCache {
  private readonly entries = new Map<string, { json: string; bytes: number }>();
  private bytes = 0;
  constructor(
    private readonly maxEntries = 128,
    private readonly maxBytes = 4 * 1024 * 1024,
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new RangeError('Parse cache limits must be positive integers.');
    }
  }

  private memo<T>(key: string, build: () => T, cacheable: (value: T) => boolean): T {
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return JSON.parse(hit.json) as T;
    }
    const value = build();
    if (!cacheable(value)) return value;
    const json = JSON.stringify(value),
      bytes = Buffer.byteLength(key) + Buffer.byteLength(json);
    if (bytes > this.maxBytes) return value;
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { json, bytes });
    this.bytes += bytes;
    return value;
  }

  contract(
    source: string,
    name: string,
    type: Contract['type'],
    version: Version = DEFAULT_CONTRACT_VERSION,
  ): Contract {
    const key = JSON.stringify(['contract', type, name, version, hashSource(source)]);
    return this.memo(
      key,
      () => extractContract(source, name, type, version),
      (value) => value.success,
    );
  }

  dependencies(source: string, name: string, version: Version = DEFAULT_DEPENDENCY_VERSION): Dependency[] {
    const key = JSON.stringify(['dependencies', name, version, hashSource(source)]);
    return this.memo(
      key,
      () => extractDependencies(source, name, true, version),
      () => true,
    );
  }

  stats() {
    return { entries: this.entries.size, bytes: this.bytes };
  }
}

// Per CachingLayer (and hence per destination), garbage collected with its owner. No persistence:
// the installed abaplint library version is fixed for this process. PP passes no dependency cache.
const caches = new WeakMap<CachingLayer, ContextParseCache>();
export function contextParseCache(owner?: CachingLayer): ContextParseCache | undefined {
  if (!owner) return undefined;
  let cache = caches.get(owner);
  if (!cache) {
    cache = new ContextParseCache();
    caches.set(owner, cache);
  }
  return cache;
}

/** Call only after source retrieval under the caller's cache/identity policy. */
export function parseDependencies(source: string, name: string, version?: Version, owner?: CachingLayer) {
  return (
    contextParseCache(owner)?.dependencies(source, name, version) ?? extractDependencies(source, name, true, version)
  );
}

export function parseContract(
  source: string,
  name: string,
  type: Contract['type'],
  version?: Version,
  owner?: CachingLayer,
) {
  return (
    contextParseCache(owner)?.contract(source, name, type, version) ?? extractContract(source, name, type, version)
  );
}
