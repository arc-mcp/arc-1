/** Per-target configuration construction and uncached Destination drift validation. */

import type { Destination } from '@arc-mcp/xsuaa-auth/btp';
import { canonicalDestinationUrl, projectMultiTargetDestination } from './destination-discovery.js';
import {
  evaluateStandaloneTargetDescriptor,
  multiTargetSafety,
  type TargetDescriptor,
  targetSafety,
} from './destination-registry.js';
import type { ServerConfig } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

/**
 * Build from safe defaults plus an explicit instance allowlist.
 *
 * This intentionally does not spread `base`: single-target credentials and future
 * write-capable settings must be reviewed before they can enter multi-target mode.
 */
function buildReadOnlyRuntimeConfig(
  base: ServerConfig,
  safety: ReturnType<typeof multiTargetSafety>,
  target?: TargetDescriptor,
): ServerConfig {
  // The aggregate tool surface is intentionally authentication-neutral and keeps
  // the existing strict-PP posture. Only a resolved Basic target switches the
  // per-call SAP client to shared credentials.
  const usesSharedBasicIdentity = target?.authentication === 'BasicAuthentication';
  return {
    ...DEFAULT_CONFIG,
    url: '',
    client: target?.client ?? base.client,
    language: target?.language ?? base.language,
    // Wire representation only — safe to inherit. `insecure` deliberately is NOT:
    // multi-target never disables TLS verification, per-target or otherwise.
    gzipDataPreviewBody: base.gzipDataPreviewBody,
    transport: 'http-streamable',
    httpAddr: base.httpAddr,
    allowWrites: safety.allowWrites,
    allowDataPreview: safety.allowDataPreview,
    allowFreeSQL: safety.allowFreeSQL,
    allowTransportWrites: safety.allowTransportWrites,
    allowGitWrites: safety.allowGitWrites,
    allowedPackages: [...safety.allowedPackages],
    allowedTransports: [...safety.allowedTransports],
    denyActions: [...new Set([...base.denyActions, ...safety.denyActions])],
    featureAbapGit: base.featureAbapGit,
    featureGcts: base.featureGcts,
    featureRap: base.featureRap,
    featureAmdp: base.featureAmdp,
    featureUi5: base.featureUi5,
    featureTransport: base.featureTransport,
    featureHana: base.featureHana,
    featureUi5Repo: base.featureUi5Repo,
    featureFlp: base.featureFlp,
    systemType: 'onprem',
    xsuaaAuth: true,
    allowHttpNoAuth: false,
    ppEnabled: !usesSharedBasicIdentity,
    ppStrict: !usesSharedBasicIdentity,
    ppStrictExplicit: true,
    ppAllowSharedCookies: false,
    disableSaml2: usesSharedBasicIdentity,
    toolMode: 'standard',
    schemaNullableOptionals: base.schemaNullableOptionals,
    plugins: [],
    allowPluginExecute: false,
    allowPluginRawWrites: false,
    lintBeforeWrite: base.lintBeforeWrite,
    checkBeforeWrite: false,
    cacheMode: 'none',
    maxConcurrent: base.maxConcurrent,
    authRateLimit: base.authRateLimit,
    mcpHttpRateLimit: base.mcpHttpRateLimit,
    rateLimit: base.rateLimit,
    allowedOrigins: [...base.allowedOrigins],
    logLevel: base.logLevel,
    logFormat: base.logFormat,
    minimalErrors: base.minimalErrors,
    verbose: base.verbose,
    multiTargetEndpoints: true,
    destinationName: target?.destinationName,
    targetId: target?.target,
  };
}

/** Build the isolated runtime for one discovered target. */
export function buildMultiTargetConfig(base: ServerConfig, target: TargetDescriptor): ServerConfig {
  return buildReadOnlyRuntimeConfig(base, targetSafety(target), target);
}

/**
 * Build only the union needed to advertise the aggregate tools/list surface.
 * Every tool call replaces this with buildMultiTargetConfig for its selected target.
 */
export function buildAggregateToolSurfaceConfig(
  base: ServerConfig,
  targets: readonly TargetDescriptor[],
): ServerConfig {
  return buildReadOnlyRuntimeConfig(
    base,
    multiTargetSafety({
      allowDataPreview: targets.some((target) => target.effectivePolicy.allowDataPreview),
      allowFreeSQL: targets.some((target) => target.effectivePolicy.allowFreeSQL),
    }),
  );
}

export type DriftResult = { ok: true; url: string } | { ok: false; code: 'TARGET_CONFIG_CHANGED'; message: string };

export class TargetConfigChangedError extends Error {
  readonly code = 'TARGET_CONFIG_CHANGED';

  constructor(
    readonly target: string,
    message: string,
  ) {
    super(message);
    this.name = 'TargetConfigChangedError';
  }
}

function targetChanged(target: TargetDescriptor): DriftResult {
  return {
    ok: false,
    code: 'TARGET_CONFIG_CHANGED',
    message: `Target ${target.target} configuration changed after startup. Restart ARC-1 to reload destinations.`,
  };
}

/** Compare a fresh uncached Find result with the immutable startup snapshot. */
export function validateTargetDrift(
  destination: Destination,
  target: TargetDescriptor,
  base: ServerConfig,
): DriftResult {
  const url = canonicalDestinationUrl(destination.URL);
  const projected = projectMultiTargetDestination(destination);
  const freshTarget = projected ? evaluateStandaloneTargetDescriptor(projected, base) : undefined;
  if (!url || freshTarget?.fingerprint !== target.fingerprint) {
    return targetChanged(target);
  }
  return { ok: true, url };
}
