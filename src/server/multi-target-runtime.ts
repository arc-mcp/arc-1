/** Per-target configuration construction and uncached Destination drift validation. */

import type { Destination } from '@arc-mcp/xsuaa-auth/btp';
import { opaqueDestinationValue } from './destination-discovery.js';
import {
  sanitizeTargetDescription,
  type TargetDescriptor,
  type TargetPolicy,
  targetFingerprint,
  targetSafety,
} from './destination-registry.js';
import type { ServerConfig } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

const SUPPORTED_ARC_PROPERTIES = new Set(['arc1.enabled', 'arc1.allow_data_preview', 'arc1.allow_free_sql']);

function property(destination: Destination, key: string): string | undefined {
  const value = destination.originalProperties?.[key];
  return typeof value === 'string' ? value : undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return undefined;
}

export function canonicalDestinationUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    url.hash = '';
    url.username = '';
    url.password = '';
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    return undefined;
  }
}

/** Build from safe defaults plus an explicit instance allowlist; never copy legacy SAP credentials. */
export function buildMultiTargetConfig(base: ServerConfig, target: TargetDescriptor): ServerConfig {
  const safety = targetSafety(target);
  return {
    ...DEFAULT_CONFIG,
    url: '',
    client: target.client,
    language: target.language,
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
    ppEnabled: true,
    ppStrict: true,
    ppStrictExplicit: true,
    ppAllowSharedCookies: false,
    disableSaml2: false,
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
    destinationName: target.destinationName,
    targetId: target.target,
  };
}

export function buildAggregateConfig(base: ServerConfig, targets: readonly TargetDescriptor[]): ServerConfig {
  const unionData = targets.some((target) => target.effectivePolicy.allowDataPreview);
  const unionSql = targets.some((target) => target.effectivePolicy.allowFreeSQL);
  const seed: TargetDescriptor = {
    target: 'ZZZ/000',
    sid: 'ZZZ',
    client: '000',
    description: 'aggregate',
    language: base.language,
    destinationName: '__aggregate__',
    authentication: 'PrincipalPropagation',
    proxyType: 'OnPremise',
    hasCloudConnectorLocationId: false,
    requestedPolicy: { allowDataPreview: unionData, allowFreeSQL: unionSql },
    effectivePolicy: { allowDataPreview: unionData, allowFreeSQL: unionSql },
    connectionFingerprint: '',
    fingerprint: '',
  };
  const config = buildMultiTargetConfig(base, seed);
  config.destinationName = undefined;
  config.targetId = undefined;
  return config;
}

export type DriftResult = { ok: true; url: string } | { ok: false; code: 'TARGET_CONFIG_CHANGED'; message: string };

/** Compare a fresh uncached Find result with the immutable startup snapshot. */
export function validateTargetDrift(
  destination: Destination,
  target: TargetDescriptor,
  base: ServerConfig,
): DriftResult {
  const originalProperties = destination.originalProperties;
  const arcPropertyKeys = originalProperties
    ? Object.keys(originalProperties).filter((key) => key.toLowerCase().startsWith('arc1.'))
    : [];
  const hasUnsupportedArcProperty = arcPropertyKeys.some((key) => !SUPPORTED_ARC_PROPERTIES.has(key));
  const url = canonicalDestinationUrl(destination.URL);
  const sid = property(destination, 'sap-sysid');
  const client = destination['sap-client'] ?? property(destination, 'sap-client');
  const language = property(destination, 'sap-language')?.trim().toUpperCase() || base.language;
  const description = sanitizeTargetDescription(property(destination, 'Description'), target.target);
  const enabled = parseBoolean(property(destination, 'arc1.enabled'));
  const allowDataPreview = parseBoolean(property(destination, 'arc1.allow_data_preview'));
  const allowFreeSQL = parseBoolean(property(destination, 'arc1.allow_free_sql'));
  if (
    !url ||
    !originalProperties ||
    hasUnsupportedArcProperty ||
    destination.Name !== target.destinationName ||
    destination.Type !== 'HTTP' ||
    destination.Authentication !== 'PrincipalPropagation' ||
    destination.ProxyType !== 'OnPremise' ||
    enabled !== true ||
    allowDataPreview === undefined ||
    allowFreeSQL === undefined ||
    sid !== target.sid ||
    client !== target.client
  ) {
    return {
      ok: false,
      code: 'TARGET_CONFIG_CHANGED',
      message: `Target ${target.target} configuration changed after startup. Restart ARC-1 to reload destinations.`,
    };
  }

  const requestedPolicy: TargetPolicy = { allowDataPreview, allowFreeSQL };
  const effectivePolicy: TargetPolicy = {
    allowDataPreview: base.allowDataPreview && allowDataPreview,
    allowFreeSQL: base.allowFreeSQL && allowFreeSQL,
  };
  const freshFingerprint = targetFingerprint({
    target: `${sid}/${client}`,
    sid,
    client,
    description,
    language,
    destinationName: destination.Name,
    urlFingerprint: opaqueDestinationValue(url),
    authentication: 'PrincipalPropagation',
    proxyType: 'OnPremise',
    hasCloudConnectorLocationId: !!destination.CloudConnectorLocationId,
    cloudConnectorLocationIdFingerprint: destination.CloudConnectorLocationId
      ? opaqueDestinationValue(destination.CloudConnectorLocationId)
      : undefined,
    requestedPolicy,
    effectivePolicy,
  });
  if (freshFingerprint !== target.fingerprint) {
    return {
      ok: false,
      code: 'TARGET_CONFIG_CHANGED',
      message: `Target ${target.target} configuration changed after startup. Restart ARC-1 to reload destinations.`,
    };
  }
  return { ok: true, url };
}
