/**
 * Feature detection for ARC-1.
 *
 * Probes SAP system capabilities to determine which optional features
 * are available (abapGit, RAP, AMDP, UI5, Transport, HANA).
 *
 * Each feature can be:
 * - "auto": probe SAP system at startup, enable if available
 * - "on": force enabled (skip probe, fail if feature is used but unavailable)
 * - "off": force disabled (skip probe, hide related tools)
 *
 * The "safety network" concept: if a feature is "auto" and the probe
 * returns 404 (endpoint doesn't exist), the feature is gracefully
 * disabled. This prevents errors when connecting to older SAP systems.
 *
 * Probe endpoints are lightweight HEAD requests — they don't fetch data,
 * just check if the endpoint exists (returns 200 or 404).
 */

import { Version } from '@abaplint/core';
import type { FeatureConfig, FeatureMode } from './config.js';
import { fetchDiscoveryDocument } from './discovery.js';
import { AdtApiError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import type { AuthProbeResult, FeatureStatus, ResolvedFeatures, SystemType } from './types.js';
import { parseInstalledComponents, parseSyntaxConfigurations } from './xml-parser.js';

/** Probe definition: which URL to check for each feature */
interface FeatureProbe {
  id: keyof ResolvedFeatures;
  endpoint: string;
  description: string;
}

const PROBES: FeatureProbe[] = [
  { id: 'hana', endpoint: '/sap/bc/adt/ddic/sysinfo/hanainfo', description: 'HANA database' },
  { id: 'abapGit', endpoint: '/sap/bc/adt/abapgit/repos', description: 'abapGit integration' },
  { id: 'gcts', endpoint: '/sap/bc/cts_abapvcs/system', description: 'gCTS (git-enabled CTS)' },
  { id: 'rap', endpoint: '/sap/bc/adt/ddic/ddl/sources', description: 'RAP/CDS development' },
  { id: 'amdp', endpoint: '/sap/bc/adt/debugger/amdp', description: 'AMDP debugging' },
  { id: 'ui5', endpoint: '/sap/bc/adt/filestore/ui5-bsp', description: 'UI5/Fiori BSP' },
  { id: 'transport', endpoint: '/sap/bc/adt/cts/transportrequests', description: 'CTS transport management' },
  { id: 'ui5repo', endpoint: '/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV', description: 'UI5 ABAP Repository Deploy' },
  {
    id: 'flp',
    endpoint: '/sap/opu/odata/UI2/PAGE_BUILDER_CUST/',
    description: 'FLP customization (PAGE_BUILDER_CUST)',
  },
];

/** Per-feature probe outcome — `available` plus an optional human-readable reason. */
interface ProbeOutcome {
  available: boolean;
  /** Free-text diagnostic, surfaced via FeatureStatus.message when present. */
  reason?: string;
}

/** Resolve a single feature based on its mode */
function resolveFeature(mode: FeatureMode, probeOutcome: ProbeOutcome, id: string, description: string): FeatureStatus {
  if (mode === 'on') {
    return { id, available: true, mode: 'on', message: 'Forced on by configuration' };
  }
  if (mode === 'off') {
    return { id, available: false, mode: 'off', message: 'Disabled by configuration' };
  }
  // auto
  const baseMessage = probeOutcome.available ? `${description} is available` : `${description} is not available`;
  const message = probeOutcome.reason ? `${baseMessage} — ${probeOutcome.reason}` : baseMessage;
  return {
    id,
    available: probeOutcome.available,
    mode: 'auto',
    message,
    probedAt: new Date().toISOString(),
  };
}

/**
 * Probe all features and return resolved status.
 *
 * Runs all probes in parallel for speed.
 * Each probe is a HEAD request — if it returns 2xx, the feature exists.
 * 404 or network error means the feature is not available.
 */
export async function probeFeatures(
  client: AdtHttpClient,
  config: FeatureConfig,
  systemTypeOverride?: string,
): Promise<ResolvedFeatures> {
  const modeMap: Record<string, FeatureMode> = {
    hana: config.hana,
    abapGit: config.abapGit,
    gcts: config.gcts,
    rap: config.rap,
    amdp: config.amdp,
    ui5: config.ui5,
    transport: config.transport,
    ui5repo: config.ui5repo,
    flp: config.flp,
  };

  // Only probe features that are in "auto" mode
  const probesToRun = PROBES.filter((p) => modeMap[p.id] === 'auto');

  // Run feature probes + system detection + text search probe + auth probe + discovery in parallel
  const [probeResults, systemDetection, textSearchResult, authProbeResult, discoveryResult] = await Promise.all([
    Promise.all(
      probesToRun.map(async (probe) => {
        try {
          await client.get(probe.endpoint);
          return classifyFeatureProbeStatus(probe.id, 200);
        } catch (err) {
          if (err instanceof AdtApiError) {
            return classifyFeatureProbeStatus(probe.id, err.statusCode);
          }
          // Network-level error (no AdtApiError) → cannot reach SAP at all → unavailable.
          return { id: probe.id, available: false, reason: 'network error' };
        }
      }),
    ),
    detectSystemFromComponents(client),
    probeTextSearch(client),
    probeAuthorization(client),
    fetchDiscoveryDocument(client),
  ]);

  const { map: discoveryMap, nhiPresent: discoveryNhiPresent } = discoveryResult;

  // Build result map keyed by feature id, carrying both availability and any diagnostic reason.
  const resultMap = new Map<string, ProbeOutcome>();
  for (const result of probeResults) {
    resultMap.set(result.id, { available: result.available, reason: result.reason });
  }

  // Component-based HANA detection overrides the endpoint probe when the hanainfo
  // endpoint is absent (e.g. some S/4HANA releases). Only applies in auto mode.
  if (!resultMap.get('hana')?.available && systemDetection.hasHana && modeMap.hana === 'auto') {
    resultMap.set('hana', {
      available: true,
      reason: 'inferred from installed components (hanainfo endpoint absent)',
    });
  }

  // Discovery-based HANA detection: NHI (Native HANA Integration) workspaces are only
  // registered on HANA-based systems. Fires when both the hanainfo probe and the components
  // feed failed to confirm HANA (e.g. empty components feed + hanainfo 404).
  if (!resultMap.get('hana')?.available && discoveryNhiPresent && modeMap.hana === 'auto') {
    resultMap.set('hana', {
      available: true,
      reason: 'inferred from ADT discovery document (NHI workspace present — Native HANA Integration)',
    });
  }

  // Resolve all features
  const result: Record<string, FeatureStatus> = {};
  for (const probe of PROBES) {
    const mode = modeMap[probe.id] ?? 'auto';
    const outcome = resultMap.get(probe.id) ?? { available: false };
    result[probe.id] = resolveFeature(mode, outcome, probe.id, probe.description);
  }

  const resolved = result as unknown as ResolvedFeatures;
  // Prefer SAP_BASIS from installed components. If that feed does not expose a
  // release, fall back to the ADT syntax configuration metadata.
  const abapRelease = systemDetection.abapRelease ?? (await detectReleaseFromSyntaxConfigurations(client));
  if (abapRelease) {
    resolved.abapRelease = abapRelease;
  }
  // Apply system type: manual override takes precedence over auto-detection
  if (systemTypeOverride && systemTypeOverride !== 'auto') {
    resolved.systemType = systemTypeOverride as SystemType;
  } else if (systemDetection.systemType) {
    resolved.systemType = systemDetection.systemType;
  }
  resolved.textSearch = textSearchResult;
  resolved.authProbe = authProbeResult;
  resolved.discoveryMap = discoveryMap;
  return resolved;
}

/**
 * Map SAP_BASIS release string to the closest @abaplint/core Version.
 *
 * abaplint versions are additive — each version accepts all syntax from
 * previous versions plus new features. We map to the closest matching
 * version, falling back to Cloud (the superset) for unknown releases.
 *
 * SAP_BASIS release examples: "700", "702", "740", "750", "757", "758"
 * BTP ABAP Environment reports release like "sap_btp" or similar.
 */
export function mapSapReleaseToAbaplintVersion(release: string): Version {
  const r = release.replace(/\D/g, ''); // strip non-digits ("750" → "750", "7.57" → "757")
  const num = Number.parseInt(r, 10);

  if (Number.isNaN(num)) return Version.Cloud;

  if (num >= 758) return Version.v758;
  if (num >= 757) return Version.v757;
  if (num >= 756) return Version.v756;
  if (num >= 755) return Version.v755;
  if (num >= 754) return Version.v754;
  if (num >= 753) return Version.v753;
  if (num >= 752) return Version.v752;
  if (num >= 751) return Version.v751;
  if (num >= 750) return Version.v750;
  // v740 has sub-versions in abaplint
  if (num >= 74008) return Version.v740sp08;
  if (num >= 74005) return Version.v740sp05;
  if (num >= 740) return Version.v740sp02;
  if (num >= 702) return Version.v702;
  return Version.v700;
}

/** Result of component-based system detection */
interface SystemDetection {
  abapRelease?: string;
  systemType?: SystemType;
  hasHana?: boolean;
}

/**
 * Detect SAP_BASIS release and system type from installed components.
 *
 * System type detection:
 * - BTP ABAP Environment has `SAP_CLOUD` component (and no `SAP_ABA`)
 * - On-premise has `SAP_ABA` component (and no `SAP_CLOUD`)
 *
 * This reuses the same `/sap/bc/adt/system/components` call — zero extra HTTP requests.
 */
async function detectSystemFromComponents(client: AdtHttpClient): Promise<SystemDetection> {
  try {
    const resp = await client.get('/sap/bc/adt/system/components', { Accept: 'application/atom+xml;type=feed' });
    if (resp.statusCode >= 400) return {};
    const components = parseInstalledComponents(resp.body);
    const basis = components.find((c) => c.name.toUpperCase() === 'SAP_BASIS');
    const hasSapCloud = components.some((c) => c.name.toUpperCase() === 'SAP_CLOUD');
    const systemType: SystemType | undefined = hasSapCloud ? 'btp' : 'onprem';
    return {
      abapRelease: basis?.release || undefined,
      systemType,
      hasHana: detectHanaFromComponents(components),
    };
  } catch {
    return {};
  }
}

/**
 * Fallback release detection via ADT syntax configurations.
 *
 * Used when `/sap/bc/adt/system/components` does not expose a SAP_BASIS
 * release. The Standard ABAP language entry (`version="X"`) carries the parser
 * release in its link `etag` attribute, e.g. `etag="757"`.
 */
async function detectReleaseFromSyntaxConfigurations(client: AdtHttpClient): Promise<string | undefined> {
  try {
    const resp = await client.get('/sap/bc/adt/abapsource/syntax/configurations', {
      Accept: 'application/vnd.sap.adt.syntaxconfigurations+xml',
    });
    if (resp.statusCode >= 400) return undefined;
    const configs = parseSyntaxConfigurations(resp.body);
    return configs.find((c) => c.version === 'X')?.etag || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Detect HANA presence from ADT discovery document NHI signal (exported for testing).
 *
 * NHI (Native HANA Integration) workspaces at /sap/bc/adt/nhi/* are only registered
 * on HANA-based SAP systems. This is the last fallback when both the hanainfo endpoint
 * probe and the software components feed fail to produce a signal.
 */
export function detectHanaFromDiscovery(nhiPresent: boolean): boolean {
  return nhiPresent;
}

/**
 * Detect HANA DB presence from installed software components (exported for testing).
 *
 * Rules (any match → HANA):
 * 1. Component name contains `HDB` or `HANA` (e.g. `HDB`, `HANA_XS`) — direct DB indicator,
 *    typically present on Suite-on-HANA systems.
 * 2. Component name starts with `S4` (e.g. `S4CORE`, `S4FND`, `S4CEXT`) — S/4HANA is
 *    HANA-only, and `S4` is SAP's reserved prefix for S/4HANA software components.
 *    On S/4HANA 2021+ the core component is `S4FND`, not `S4CORE`.
 * 3. Component name `BW4CORE` — BW/4HANA is also HANA-only.
 *
 * DB release info is intentionally not surfaced: only HDB-named components carry a
 * meaningful release; S4/BW4CORE releases describe the ABAP stack, not the DB.
 */
export function detectHanaFromComponents(components: Array<{ name: string }>): boolean {
  for (const c of components) {
    const name = c.name.toUpperCase();
    if (/HDB|HANA/.test(name)) return true;
    if (/^S4[A-Z]/.test(name)) return true;
    if (name === 'BW4CORE') return true;
  }
  return false;
}

/**
 * Detect system type from installed components (exported for testing).
 * Returns 'btp' if SAP_CLOUD component is present, 'onprem' otherwise.
 */
export function detectSystemType(
  components: Array<{ name: string; release: string; description: string }>,
): SystemType {
  const hasSapCloud = components.some((c) => c.name.toUpperCase() === 'SAP_CLOUD');
  return hasSapCloud ? 'btp' : 'onprem';
}

/**
 * Probe text search (source_code) availability with a real request.
 *
 * Unlike HEAD-based feature probes, this does a real GET with a query
 * to detect auth, SICF, and framework errors that HEAD doesn't surface.
 */
export async function probeTextSearch(client: AdtHttpClient): Promise<{ available: boolean; reason?: string }> {
  try {
    await client.get('/sap/bc/adt/repository/informationsystem/textSearch?searchString=SY-SUBRC&maxResults=1');
    return { available: true };
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      return classifyTextSearchError((err as { statusCode: number }).statusCode);
    }
    return { available: false, reason: 'Network error — cannot reach the textSearch endpoint.' };
  }
}

export function classifyTextSearchError(statusCode: number): { available: boolean; reason?: string } {
  switch (statusCode) {
    case 401:
    case 403:
      return {
        available: false,
        reason: 'User lacks authorization for source code search (check S_ADT_RES authorization object).',
      };
    case 404:
      return {
        available: false,
        reason:
          'textSearch ICF service not activated — activate /sap/bc/adt/repository/informationsystem/textSearch in SICF.',
      };
    case 500:
      return { available: false, reason: 'Search framework error (component BC-DWB-AIE) — check SAP Note 3605050.' };
    case 501:
      return { available: false, reason: 'Not implemented — source code search requires SAP_BASIS >= 7.51.' };
    default:
      return { available: false, reason: `textSearch returned HTTP ${statusCode}.` };
  }
}

/**
 * Probe basic SAP authorization at startup.
 *
 * Lightweight read-only probes to check if the configured SAP user has
 * search and transport access. Results are logged at info/warn level —
 * missing authorization is informational, not a server error.
 *
 * Does NOT probe write operations (too risky — would modify state).
 */
export async function probeAuthorization(client: AdtHttpClient): Promise<AuthProbeResult> {
  const [searchResult, transportResult] = await Promise.all([probeSearchAccess(client), probeTransportAccess(client)]);

  return {
    searchAccess: searchResult.available,
    searchReason: searchResult.reason,
    transportAccess: transportResult.available,
    transportReason: transportResult.reason,
  };
}

async function probeSearchAccess(client: AdtHttpClient): Promise<{ available: boolean; reason?: string }> {
  try {
    const resp = await client.get(
      '/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=CL_ABAP_*&maxResults=1',
    );
    if (resp.statusCode < 400) {
      return { available: true };
    }
    return classifyAuthProbeError(resp.statusCode, 'search');
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      return classifyAuthProbeError((err as { statusCode: number }).statusCode, 'search');
    }
    return { available: false, reason: 'Network error — cannot reach the search endpoint.' };
  }
}

async function probeTransportAccess(client: AdtHttpClient): Promise<{ available: boolean; reason?: string }> {
  try {
    const resp = await client.get('/sap/bc/adt/cts/transportrequests?user=__PROBE__');
    if (resp.statusCode < 400) {
      return { available: true };
    }
    return classifyAuthProbeError(resp.statusCode, 'transport');
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      return classifyAuthProbeError((err as { statusCode: number }).statusCode, 'transport');
    }
    return { available: false, reason: 'Network error — cannot reach the transport endpoint.' };
  }
}

/**
 * Classify the HTTP status of a single feature-probe request into `{ available, reason? }`.
 *
 * Decision table:
 * - **2xx** → endpoint exists and we got a clean response → available.
 * - **400, 405, 500, other 4xx/5xx** → endpoint exists; SAP returned a request-shape /
 *   server error after dispatching to the handler → available. (Some collection endpoints
 *   intentionally return 400 without query params, e.g. `/ddic/ddl/sources`.)
 * - **401** → request was rejected by ICM/SICF before authorization could even run.
 *   This carries NO signal about endpoint existence — could be missing creds, expired
 *   session, wrong client, etc. Reporting `available: true` here would be a lie on
 *   any system where auth is misconfigured. Classify as unavailable.
 * - **403** → endpoint exists, but the user lacks the specific authorization to use it.
 *   From the caller's perspective the feature is unusable, so report unavailable —
 *   matches `classifyAuthProbeError` semantics for textSearch / authProbe.
 * - **404** → ICF service not activated, endpoint not registered → unavailable.
 *
 * Exported for testing.
 */
export function classifyFeatureProbeStatus(
  id: string,
  statusCode: number,
): { id: string; available: boolean; reason?: string } {
  if (statusCode >= 200 && statusCode < 300) {
    return { id, available: true };
  }
  if (statusCode === 401) {
    return { id, available: false, reason: 'auth failure (401) — cannot determine availability' };
  }
  if (statusCode === 403) {
    return { id, available: false, reason: 'forbidden (403) — endpoint exists but user lacks authorization' };
  }
  if (statusCode === 404) {
    return { id, available: false, reason: 'endpoint not found (404) — ICF service not activated' };
  }
  // 400 / 405 / 4xx / 5xx other than auth/missing → endpoint exists, request was dispatched.
  return { id, available: true };
}

export function classifyAuthProbeError(
  statusCode: number,
  probeType: 'search' | 'transport',
): { available: boolean; reason?: string } {
  if (statusCode === 401 || statusCode === 403) {
    if (probeType === 'search') {
      return {
        available: false,
        reason: 'User lacks authorization for object search (check S_ADT_RES authorization object).',
      };
    }
    return {
      available: false,
      reason: 'User lacks authorization for transport management (check S_TRANSPRT authorization object).',
    };
  }
  if (statusCode === 404) {
    return {
      available: false,
      reason: `${probeType} ICF service not activated in SICF.`,
    };
  }
  return { available: false, reason: `${probeType} probe returned HTTP ${statusCode}.` };
}

/** Get features without probing (for offline/test scenarios) */
export function resolveWithoutProbing(config: FeatureConfig): ResolvedFeatures {
  const result: Record<string, FeatureStatus> = {};
  const descriptions: Record<string, string> = {
    hana: 'HANA database',
    abapGit: 'abapGit integration',
    gcts: 'gCTS (git-enabled CTS)',
    rap: 'RAP/CDS development',
    amdp: 'AMDP debugging',
    ui5: 'UI5/Fiori BSP',
    transport: 'CTS transport management',
    ui5repo: 'UI5 ABAP Repository Deploy',
    flp: 'FLP customization (PAGE_BUILDER_CUST)',
  };

  for (const [id, mode] of Object.entries(config)) {
    result[id] = resolveFeature(
      mode as FeatureMode,
      // Without probing, "auto" defaults to unavailable. No probe ran, so no reason to surface.
      { available: mode === 'on' },
      id,
      descriptions[id] ?? id,
    );
  }

  return result as unknown as ResolvedFeatures;
}
