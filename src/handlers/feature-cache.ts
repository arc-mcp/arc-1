/**
 * Process-wide cache of probed SAP feature status + ADT discovery MIME map.
 *
 * The single home of this mutable module state (extracted from intent.ts, Stage B). Handlers
 * read `cachedFeatures`/`cachedDiscovery` as ESM live bindings; the only writers are the probe
 * (via setCachedFeatures) and the test/startup accessors below. Keeping the state in one module
 * means every handler module shares the same instance instead of accidentally forking it.
 */

import type { ResolvedFeatures } from '../adt/types.js';

/** Cached feature status — populated on first probe. Imported read-only elsewhere (live binding). */
export let cachedFeatures: ResolvedFeatures | undefined;
/** Startup-cached ADT discovery MIME map. */
export let cachedDiscovery: Map<string, string[]> = new Map();

/** Reset cached features (for testing) */
export function resetCachedFeatures(): void {
  cachedFeatures = undefined;
  cachedDiscovery = new Map();
}

/** Set cached features directly (probe result, or for testing BTP mode, etc.) */
export function setCachedFeatures(features: ResolvedFeatures | undefined): void {
  cachedFeatures = features;
}

/** Get cached features (for tool definition adaptation) */
export function getCachedFeatures(): ResolvedFeatures | undefined {
  return cachedFeatures;
}

/** Set startup-cached ADT discovery MIME map. */
export function setCachedDiscovery(map: Map<string, string[]>): void {
  cachedDiscovery = map;
}

/** Get startup-cached ADT discovery MIME map. */
export function getCachedDiscovery(): Map<string, string[]> {
  return cachedDiscovery;
}
