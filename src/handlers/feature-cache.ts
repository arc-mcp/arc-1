/**
 * Process-wide cache of probed SAP feature status + ADT discovery MIME map.
 *
 * The single home of this mutable module state, keyed by destination so one
 * process can serve multiple SAP systems (multi-destination mode). The default
 * key ('') is used in single-destination mode — the historical behavior.
 *
 * Readers usually omit the key argument: it is resolved from the request
 * context (AsyncLocalStorage), which dispatch populates per tool call. Public
 * SID/client target IDs take precedence over legacy internal destination names.
 * Writers (the startup/first-request probe) pass the destination explicitly.
 */

import type { ResolvedFeatures } from '../adt/types.js';
import { getCurrentContext } from '../server/context.js';

interface FeatureStore {
  features: ResolvedFeatures | undefined;
  discovery: Map<string, string[]>;
}

/** Key for single-target mode. Multi-target feature state uses the public SID/client ID. */
const DEFAULT_KEY = '';

const stores = new Map<string, FeatureStore>();

function storeFor(destination?: string): FeatureStore {
  const context = getCurrentContext();
  const key = destination ?? context?.target ?? context?.destination ?? DEFAULT_KEY;
  let store = stores.get(key);
  if (!store) {
    store = { features: undefined, discovery: new Map() };
    stores.set(key, store);
  }
  return store;
}

/** Reset cached features across all destinations (for testing) */
export function resetCachedFeatures(): void {
  stores.clear();
}

/** Set cached features directly (probe result, or for testing BTP mode, etc.) */
export function setCachedFeatures(features: ResolvedFeatures | undefined, destination?: string): void {
  storeFor(destination).features = features;
}

/** Get cached features (for tool definition adaptation) */
export function getCachedFeatures(destination?: string): ResolvedFeatures | undefined {
  return storeFor(destination).features;
}

/** Set startup-cached ADT discovery MIME map. */
export function setCachedDiscovery(map: Map<string, string[]>, destination?: string): void {
  storeFor(destination).discovery = map;
}

/** Get startup-cached ADT discovery MIME map. */
export function getCachedDiscovery(destination?: string): Map<string, string[]> {
  return storeFor(destination).discovery;
}

/** True/false if the ADT /ddic/tables endpoint is advertised by discovery; undefined if not probed. */
export function isTablesEndpointAvailable(destination?: string): boolean | undefined {
  const store = storeFor(destination);
  const map = store.features?.discoveryMap ?? store.discovery;
  if (!map || map.size === 0) return undefined;
  return map.has('/sap/bc/adt/ddic/tables');
}

/**
 * True/false if the ADT /ddic/tabletypes endpoint is advertised by discovery; undefined if not probed.
 * Live-verified absent on NW 7.50 (404 + not in discovery) and present on S/4 758 + ABAP 816 (FEAT-65).
 */
export function isTableTypesEndpointAvailable(destination?: string): boolean | undefined {
  const store = storeFor(destination);
  const map = store.features?.discoveryMap ?? store.discovery;
  if (!map || map.size === 0) return undefined;
  return map.has('/sap/bc/adt/ddic/tabletypes');
}

/**
 * True/false if the ADT /ddic/domains endpoint is advertised by discovery; undefined if not probed.
 * Live-verified absent on NW 7.50 (404 + not in discovery, on both a dev-edition and a real
 * ECC EhP8 7.50 SP31 system) and present on S/4 758 + ABAP 816.
 */
export function isDomainsEndpointAvailable(destination?: string): boolean | undefined {
  const store = storeFor(destination);
  const map = store.features?.discoveryMap ?? store.discovery;
  if (!map || map.size === 0) return undefined;
  return map.has('/sap/bc/adt/ddic/domains');
}

/**
 * True/false if the ADT /packages endpoint is advertised by discovery; undefined if not probed.
 * The whole resource is absent before 7.52 — even a GET of an existing package 404s there.
 */
export function isPackagesEndpointAvailable(destination?: string): boolean | undefined {
  const store = storeFor(destination);
  const map = store.features?.discoveryMap ?? store.discovery;
  if (!map || map.size === 0) return undefined;
  return map.has('/sap/bc/adt/packages');
}

/** True when the probed system is BTP ABAP Environment. */
export function isBtpSystem(destination?: string): boolean {
  return storeFor(destination).features?.systemType === 'btp';
}
