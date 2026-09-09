import { Registry, Version } from '@abaplint/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { DEFAULT_CONTRACT_VERSION, extractContract } from '../../../src/context/contract.js';
import { DEFAULT_DEPENDENCY_VERSION, extractDependencies } from '../../../src/context/deps.js';
import { ContextParseCache, contextParseCache } from '../../../src/context/parse-cache.js';
import * as parserConfig from '../../../src/lint/abaplint-config-cache.js';

const source =
  'CLASS zcl_a DEFINITION PUBLIC. PUBLIC SECTION. METHODS go. ENDCLASS. CLASS zcl_a IMPLEMENTATION. METHOD go. zcl_b=>run( ). ENDMETHOD. ENDCLASS.';
afterEach(() => vi.restoreAllMocks());
describe('content-addressed context parse cache', () => {
  it('uses the extractor defaults for both memo keys and builds', () => {
    const cache = new ContextParseCache();
    const configure = vi.spyOn(parserConfig, 'getDefaultAbaplintConfig');
    const contract = cache.contract(source, 'ZCL_A', 'CLAS');
    const dependencies = cache.dependencies(source, 'ZCL_A');
    expect(configure.mock.calls).toEqual([[DEFAULT_CONTRACT_VERSION], [DEFAULT_DEPENDENCY_VERSION]]);
    expect(cache.contract(source, 'ZCL_A', 'CLAS', DEFAULT_CONTRACT_VERSION)).toEqual(contract);
    expect(cache.dependencies(source, 'ZCL_A', DEFAULT_DEPENDENCY_VERSION)).toEqual(dependencies);
    expect(cache.stats().entries).toBe(2);
    expect(configure).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, Version.v758])(
    'matches uncached extraction and effective configuration (version=%s)',
    (version) => {
      const configure = vi.spyOn(parserConfig, 'getDefaultAbaplintConfig');
      const expectedContract = extractContract(source, 'ZCL_A', 'CLAS', version);
      const expectedDependencies = extractDependencies(source, 'ZCL_A', true, version);
      const uncachedVersions = [...configure.mock.calls];
      configure.mockClear();
      const cache = new ContextParseCache();
      expect(cache.contract(source, 'ZCL_A', 'CLAS', version)).toEqual(expectedContract);
      expect(cache.dependencies(source, 'ZCL_A', version)).toEqual(expectedDependencies);
      expect(configure.mock.calls).toEqual(uncachedVersions);
    },
  );

  it('separates content, name, type and parser language version, returning independent objects', () => {
    const cache = new ContextParseCache(),
      parse = vi.spyOn(Registry.prototype, 'parse');
    const original = cache.contract(source, 'ZCL_A', 'CLAS');
    original.source = 'mutated';
    original.fullSource = 'not cached';
    const hit = cache.contract(source, 'ZCL_A', 'CLAS');
    expect(hit.source).not.toBe('mutated');
    expect(hit.fullSource).toBeUndefined();
    expect(parse).toHaveBeenCalledTimes(1);
    cache.contract(source.replace('METHODS go.', 'METHODS other.'), 'ZCL_A', 'CLAS');
    cache.contract(source, 'ZCL_OTHER', 'CLAS');
    cache.contract(source, 'ZCL_A', 'INTF');
    cache.contract(source, 'ZCL_A', 'CLAS', Version.v758);
    expect(parse).toHaveBeenCalledTimes(5);
  });
  it('caches dependency extraction separately without sharing caller mutations', () => {
    const cache = new ContextParseCache(),
      parse = vi.spyOn(Registry.prototype, 'parse');
    const first = cache.dependencies(source, 'ZCL_A');
    expect(first.map((dep) => dep.name.toUpperCase())).toContain('ZCL_B');
    first.length = 0;
    expect(cache.dependencies(source, 'ZCL_A')).not.toHaveLength(0);
    expect(parse).toHaveBeenCalledTimes(1);
  });
  it('isolates owners and has no cache when dependency payload caching is bypassed', () => {
    const first = new CachingLayer(new MemoryCache()),
      second = new CachingLayer(new MemoryCache());
    expect(contextParseCache()).toBeUndefined();
    expect(contextParseCache(first)).toBe(contextParseCache(first));
    expect(contextParseCache(second)).not.toBe(contextParseCache(first));
  });
  it('evicts the least recently used entry at the count limit', () => {
    const cache = new ContextParseCache(2),
      parse = vi.spyOn(Registry.prototype, 'parse');
    for (const name of ['A', 'B', 'A', 'C', 'A', 'B']) cache.contract(source, name, 'CLAS');
    expect(parse).toHaveBeenCalledTimes(4);
    expect(cache.stats().entries).toBe(2);
  });
  it('bounds retained bytes and bypasses oversized values', () => {
    const cache = new ContextParseCache(100, 400),
      parse = vi.spyOn(Registry.prototype, 'parse');
    for (let i = 0; i < 20; i++) cache.contract(source, `ZCL_${i}`, 'CLAS');
    expect(cache.stats().bytes).toBeLessThanOrEqual(400);
    const tiny = new ContextParseCache(100, 1);
    parse.mockClear();
    tiny.contract(source, 'ZCL_A', 'CLAS');
    tiny.contract(source, 'ZCL_A', 'CLAS');
    expect(tiny.stats()).toEqual({ entries: 0, bytes: 0 });
    expect(parse).toHaveBeenCalledTimes(2);
  });
  it('never caches failed contract extraction', () => {
    const cache = new ContextParseCache();
    vi.spyOn(Registry.prototype, 'parse').mockImplementation(() => {
      throw new Error('Synthetic parser failure');
    });
    expect(cache.contract(source, 'ZCL_A', 'CLAS').success).toBe(false);
    expect(cache.stats().entries).toBe(0);
    vi.restoreAllMocks();
    expect(cache.contract(source, 'ZCL_A', 'CLAS').success).toBe(true);
  });
});
