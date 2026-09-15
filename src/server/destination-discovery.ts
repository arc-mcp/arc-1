/** Secret-safe startup discovery for destination-discovered multi-target mode. */

import { createHash } from 'node:crypto';

import {
  type BTPConfig,
  type Destination,
  DestinationServiceRequestError,
  listDestinationsAtLevel,
} from '@arc-mcp/xsuaa-auth/btp';
import { authLibLogger } from './logger.js';
import { isSupportedMultiTargetArcProperty, isWriteRelatedArcProperty } from './multi-target-destination-config.js';

export interface DestinationAuthorizationOptions {
  readonly authorizationMode?: 'legacy' | 'xsuaa-attribute';
}

export interface DiscoveredDestination {
  readonly name: string;
  readonly type: string;
  readonly urlState: 'missing' | 'invalid' | 'valid';
  readonly urlFingerprint?: string;
  readonly authentication: string;
  readonly proxyType: string;
  readonly sapSysId?: string;
  readonly sapClient?: string;
  readonly description?: string;
  readonly sapLanguage?: string;
  /** Safe destination behavior setting. Credentials are deliberately never projected. */
  readonly preemptive?: string;
  readonly hasCloudConnectorLocationId: boolean;
  readonly cloudConnectorLocationIdFingerprint?: string;
  readonly arcProperties: Readonly<Record<string, string>>;
  /** Bounded validation facts replace unknown property names in enforced mode. */
  readonly arcValidation?: Readonly<{ unknownPropertyCount: number; hasWriteProperty: boolean }>;
}

export interface DestinationDiscoveryResult {
  readonly subaccount: readonly DiscoveredDestination[];
  readonly instanceNames: readonly string[];
  readonly scannedCount: number;
  readonly unrelatedCount: number;
  readonly arcAdjacentWithoutMarkerCount: number;
  readonly arcRelatedAtLeast?: number;
}

export class DestinationDiscoveryError extends Error {
  constructor(
    readonly code: 'DESTINATION_TOKEN_FAILED' | 'DESTINATION_LIST_FAILED' | 'DESTINATION_RESPONSE_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'DestinationDiscoveryError';
  }
}

function stringProperty(properties: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = properties[key];
  return typeof value === 'string' ? value : undefined;
}

/** Preserve an explicitly supplied safe scalar so validation can fail closed on malformed values. */
function projectedScalar(properties: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = properties[key];
  if (value === undefined) return undefined;
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return String(value);
  return '';
}

export function opaqueDestinationValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
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

export function projectMultiTargetDestination(
  destination: Destination,
  options: DestinationAuthorizationOptions = {},
): DiscoveredDestination | undefined {
  const properties = destination.originalProperties;
  if (!properties) return undefined;
  const arcProperties: Record<string, string> = {};
  let unknownPropertyCount = 0;
  let hasWriteProperty = false;
  for (const [key, value] of Object.entries(properties)) {
    if (!key.toLowerCase().startsWith('arc1.')) continue;
    if (options.authorizationMode === 'xsuaa-attribute' && !isSupportedMultiTargetArcProperty(key)) {
      unknownPropertyCount += 1;
      hasWriteProperty ||= isWriteRelatedArcProperty(key);
      continue;
    }
    // Supported values are needed by the validator. Unknown/wrong-case keys are
    // retained for fail-closed diagnostics, but their untrusted values are discarded.
    arcProperties[key] = isSupportedMultiTargetArcProperty(key)
      ? typeof value === 'string'
        ? value
        : String(value ?? '')
      : '';
  }
  if (Object.keys(arcProperties).length === 0 && unknownPropertyCount === 0) return undefined;
  const rawUrl = destination.URL ?? stringProperty(properties, 'URL') ?? '';
  const canonicalUrl = rawUrl ? canonicalDestinationUrl(rawUrl) : undefined;
  const locationId = destination.CloudConnectorLocationId ?? stringProperty(properties, 'CloudConnectorLocationId');

  return Object.freeze({
    name: destination.Name,
    type: destination.Type ?? stringProperty(properties, 'Type') ?? '',
    urlState: rawUrl ? (canonicalUrl ? 'valid' : 'invalid') : 'missing',
    urlFingerprint: canonicalUrl ? opaqueDestinationValue(canonicalUrl) : undefined,
    authentication: destination.Authentication,
    proxyType: destination.ProxyType,
    sapSysId: stringProperty(properties, 'sap-sysid'),
    sapClient: destination['sap-client'] ?? stringProperty(properties, 'sap-client'),
    description: stringProperty(properties, 'Description'),
    sapLanguage: stringProperty(properties, 'sap-language'),
    preemptive: projectedScalar(properties, 'Preemptive'),
    hasCloudConnectorLocationId: !!locationId,
    cloudConnectorLocationIdFingerprint: locationId ? opaqueDestinationValue(locationId) : undefined,
    arcProperties: Object.freeze(arcProperties),
    ...(options.authorizationMode === 'xsuaa-attribute'
      ? { arcValidation: Object.freeze({ unknownPropertyCount, hasWriteProperty }) }
      : {}),
  });
}

function adjacentWithoutMarker(destination: Destination): boolean {
  const properties = destination.originalProperties;
  if (!properties) return false;
  const hasSapIdentity = properties['sap-sysid'] !== undefined || properties['sap-client'] !== undefined;
  const hasArcProperty = Object.keys(properties).some((key) => key.toLowerCase().startsWith('arc1.'));
  return hasSapIdentity && !hasArcProperty;
}

function classifyError(error: unknown): DestinationDiscoveryError {
  if (error instanceof DestinationServiceRequestError) {
    if (error.operation === 'token') {
      return new DestinationDiscoveryError(
        'DESTINATION_TOKEN_FAILED',
        'Destination Service authentication failed; check the bound destination service credentials.',
      );
    }
    return new DestinationDiscoveryError(
      error.status && error.status >= 400 ? 'DESTINATION_LIST_FAILED' : 'DESTINATION_RESPONSE_INVALID',
      error.status
        ? `Destination Service discovery returned HTTP ${error.status}.`
        : 'Destination Service discovery failed.',
    );
  }
  return new DestinationDiscoveryError('DESTINATION_LIST_FAILED', 'Destination Service discovery failed.');
}

/** Fetch one immutable startup snapshot. Raw Destination Service objects do not escape this function. */
export async function discoverDestinations(
  btpConfig: BTPConfig,
  options: DestinationAuthorizationOptions = {},
): Promise<DestinationDiscoveryResult> {
  try {
    const [subaccountRaw, instanceRaw] = await Promise.all([
      listDestinationsAtLevel(btpConfig, 'subaccount', authLibLogger),
      listDestinationsAtLevel(btpConfig, 'instance', authLibLogger),
    ]);
    const subaccount: DiscoveredDestination[] = [];
    for (const destination of subaccountRaw) {
      const projected = projectMultiTargetDestination(destination, options);
      if (!projected) continue;
      if (options.authorizationMode === 'xsuaa-attribute' && subaccount.length === 256) {
        // No first-page inventory survives a failed complete-snapshot bound.
        return Object.freeze({
          subaccount: Object.freeze([]),
          instanceNames: Object.freeze([]),
          scannedCount: 0,
          unrelatedCount: 0,
          arcAdjacentWithoutMarkerCount: 0,
          arcRelatedAtLeast: 257,
        });
      }
      subaccount.push(projected);
    }
    const instanceNames = instanceRaw.map((entry) => entry.Name);
    const arcAdjacentWithoutMarkerCount = subaccountRaw.filter(adjacentWithoutMarker).length;
    const scannedCount = subaccountRaw.length;
    const unrelatedCount = Math.max(0, scannedCount - subaccount.length - arcAdjacentWithoutMarkerCount);
    return Object.freeze({
      subaccount: Object.freeze(subaccount),
      instanceNames: Object.freeze(instanceNames),
      scannedCount,
      unrelatedCount,
      arcAdjacentWithoutMarkerCount,
    });
  } catch (error) {
    throw classifyError(error);
  }
}
