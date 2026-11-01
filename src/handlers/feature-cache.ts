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
 * Writers (startup/first-request probes and shared-client live-relations discovery fallback) pass
 * the destination explicitly when configured.
 */

import type { ResolvedFeatures } from '../adt/types.js';
import { getCurrentContext } from '../server/context.js';

interface FeatureStore {
  features: Partial<ResolvedFeatures> | undefined;
  discovery: Map<string, string[]>;
  probeComplete: boolean;
}

const FEATURE_KEYS = ['hana', 'abapGit', 'gcts', 'rap', 'amdp', 'ui5', 'transport', 'ui5repo', 'flp'] as const;
// Non-ADT endpoints can respond independently of the caller's ADT access.
const ADT_FEATURE_KEYS = ['hana', 'abapGit', 'rap', 'amdp', 'ui5', 'transport'] as const;

/** Key for single-target mode. Multi-target feature state uses the public SID/client ID. */
const DEFAULT_KEY = '';

const stores = new Map<string, FeatureStore>();

function storeFor(destination?: string): FeatureStore {
  const context = getCurrentContext();
  const key = destination ?? context?.target ?? context?.destination ?? DEFAULT_KEY;
  let store = stores.get(key);
  if (!store) {
    store = { features: undefined, discovery: new Map(), probeComplete: false };
    stores.set(key, store);
  }
  return store;
}

/** Reset cached features across all destinations (for testing) */
export function resetCachedFeatures(): void {
  stores.clear();
}

/** Install a completed probe directly, or clear it (also used by test fixtures). */
export function setCachedFeatures(features: Partial<ResolvedFeatures> | undefined, destination?: string): void {
  const store = storeFor(destination);
  store.features = features;
  store.probeComplete = features !== undefined;
}

/** Get cached features (for tool definition adaptation) */
export function getCachedFeatures(destination?: string): Partial<ResolvedFeatures> | undefined {
  return storeFor(destination).features;
}

/** Lazy operation facts do not establish that the full feature probe completed. */
export function hasCompletedFeatureProbe(destination?: string): boolean {
  return storeFor(destination).probeComplete;
}

/** Config-only probes stay retryable; safe partial facts do not imply every feature is known. */
export function cacheProbedFeatures(features: ResolvedFeatures, perUser: boolean, destination?: string): void {
  if (cacheFeatureEvidence(features, perUser, destination)) storeFor(destination).probeComplete = true;
}

/** Share safe facts and report whether they can complete this identity's full probe. */
export function cacheFeatureEvidence(
  features: Partial<ResolvedFeatures>,
  perUser: boolean,
  destination?: string,
): boolean {
  const evidence = { ...features };
  const authFailure = /(authorization|auth failure|forbidden|\b401\b|\b403\b)/i;
  for (const key of FEATURE_KEYS) {
    const status = evidence[key];
    if (
      status?.mode === 'auto' &&
      !status.available &&
      (/network error|not probed|cannot determine/i.test(status.message ?? '') ||
        (perUser && authFailure.test(status.message ?? '')))
    )
      delete evidence[key];
  }
  if (perUser) delete evidence.authProbe;
  if (evidence.textSearch && !evidence.textSearch.available && !evidence.textSearch.unsupported)
    delete evidence.textSearch;
  if (!evidence.discoveryMap?.size) delete evidence.discoveryMap;
  if (Object.values(evidence).some((value) => value !== undefined)) {
    const store = storeFor(destination);
    store.features = { ...store.features, ...evidence };
    if (evidence.discoveryMap) store.discovery = evidence.discoveryMap;
  }
  return !!(
    evidence.textSearch?.available ||
    evidence.discoveryMap ||
    evidence.abapRelease ||
    evidence.systemTypeSource === 'probe' ||
    // One shared identity may retain its denials; PP needs positive ADT evidence.
    (!perUser && (evidence.textSearch || FEATURE_KEYS.some((key) => evidence[key]?.mode === 'auto'))) ||
    ADT_FEATURE_KEYS.some((key) => evidence[key]?.mode === 'auto' && evidence[key]?.available)
  );
}

/** Set validated ADT discovery capability hints (never object data or authorization results). */
export function setCachedDiscovery(map: Map<string, string[]>, destination?: string): void {
  storeFor(destination).discovery = map;
}

/** Get cached ADT discovery capability hints. */
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

/** True/false if the ADT lock-object (ENQU) collection is advertised by discovery; undefined if not probed. */
export function isLockObjectsEndpointAvailable(destination?: string): boolean | undefined {
  const store = storeFor(destination);
  const map = store.features?.discoveryMap ?? store.discovery;
  if (!map || map.size === 0) return undefined;
  return map.has('/sap/bc/adt/ddic/lockobjects/sources');
}

/** True/false if the ADT BAdI-implementation (ENHO/XHB) collection is advertised by discovery; undefined if not probed. */
export function isEnhoXhbEndpointAvailable(destination?: string): boolean | undefined {
  const store = storeFor(destination);
  const map = store.features?.discoveryMap ?? store.discovery;
  if (!map || map.size === 0) return undefined;
  return map.has('/sap/bc/adt/enhancements/enhoxhb');
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
