/** Level-pinned Destination Service resolution for multi-target request paths. */

import type { BTPConfig, Destination, PerUserAuthTokens } from '@arc-mcp/xsuaa-auth/btp';
import { logger } from './logger.js';
import { isSupportedMultiTargetArcProperty } from './multi-target-destination-config.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MAX_REQUEST_TIMEOUT_MS = 60_000;

export type RuntimeDestinationLevelCode = 'DESTINATION_NOT_FOUND_AT_SUBACCOUNT' | 'INSTANCE_DESTINATION_SHADOW';

export class RuntimeDestinationLevelError extends Error {
  constructor(
    readonly code: RuntimeDestinationLevelCode,
    readonly destinationName: string,
  ) {
    super(
      code === 'INSTANCE_DESTINATION_SHADOW'
        ? `Destination '${destinationName}' is shadowed by a service-instance destination. Remove the instance-level destination and restart ARC-1.`
        : `Destination '${destinationName}' no longer exists at subaccount level. Restore it and restart ARC-1.`,
    );
    this.name = 'RuntimeDestinationLevelError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringProperty(properties: Readonly<Record<string, unknown>>, key: string): string {
  const value = properties[key];
  return typeof value === 'string' ? value : '';
}

function boundedTimeoutMs(configured: number | undefined): number {
  if (configured === undefined || !Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }
  return Math.max(1, Math.min(Math.floor(configured), MAX_REQUEST_TIMEOUT_MS));
}

async function withRequestTimeout<T>(
  configuredTimeoutMs: number | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), boundedTimeoutMs(configuredTimeoutMs));
  timer.unref?.();
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function destinationServiceAccessToken(btpConfig: BTPConfig): Promise<string> {
  const tokenUrl = btpConfig.destinationTokenUrl || `${btpConfig.xsuaaUrl.replace(/\/$/, '')}/oauth/token`;
  return withRequestTimeout(btpConfig.requestTimeoutMs, async (signal) => {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: btpConfig.destinationClientId,
        client_secret: btpConfig.destinationSecret,
      }).toString(),
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Destination Service token request returned HTTP ${response.status}`);
    }
    const data: unknown = await response.json();
    if (!isRecord(data) || typeof data.access_token !== 'string' || data.access_token.length === 0) {
      throw new Error('Destination Service token response was invalid');
    }
    return data.access_token;
  });
}

function safeOriginalProperties(configuration: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const safe: Record<string, unknown> = {};
  const standardKeys = [
    'Name',
    'Type',
    'URL',
    'Authentication',
    'ProxyType',
    'sap-sysid',
    'sap-client',
    'sap-language',
    'Description',
    'CloudConnectorLocationId',
    'Preemptive',
  ];
  for (const key of standardKeys) {
    if (configuration[key] !== undefined) safe[key] = configuration[key];
  }
  for (const [key, value] of Object.entries(configuration)) {
    if (!key.toLowerCase().startsWith('arc1.')) continue;
    // Unknown/wrong-case ARC keys must remain visible to fail-closed validation, but their
    // untrusted values are unnecessary and could themselves contain sensitive material.
    safe[key] = isSupportedMultiTargetArcProperty(key) ? value : '';
  }
  return Object.freeze(safe);
}

function destinationFromConfiguration(configuration: Readonly<Record<string, unknown>>): Destination {
  return {
    Name: stringProperty(configuration, 'Name'),
    URL: stringProperty(configuration, 'URL'),
    Authentication: stringProperty(configuration, 'Authentication'),
    ProxyType: stringProperty(configuration, 'ProxyType'),
    User: stringProperty(configuration, 'User'),
    Password: stringProperty(configuration, 'Password'),
    Type: stringProperty(configuration, 'Type') || undefined,
    'sap-client': stringProperty(configuration, 'sap-client') || undefined,
    CloudConnectorLocationId: stringProperty(configuration, 'CloudConnectorLocationId') || undefined,
    originalProperties: safeOriginalProperties(configuration),
  };
}

/**
 * Resolve the current destination through Find, but accept it only when Destination Service reports
 * a subaccount owner. This keeps request-time Basic rotation and PP drift checks efficient while
 * rejecting the instance-over-subaccount precedence that the generic Find API normally applies.
 */
export async function resolveRuntimeSubaccountDestination(
  btpConfig: BTPConfig,
  destinationName: string,
): Promise<Destination> {
  const accessToken = await destinationServiceAccessToken(btpConfig);
  const baseUrl = btpConfig.destinationUrl.replace(/\/$/, '');
  const url = `${baseUrl}/destination-configuration/v1/destinations/${encodeURIComponent(destinationName)}?$skipTokenRetrieval=true`;
  return withRequestTimeout(btpConfig.requestTimeoutMs, async (signal) => {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    });
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      throw new RuntimeDestinationLevelError('DESTINATION_NOT_FOUND_AT_SUBACCOUNT', destinationName);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Destination Service runtime lookup returned HTTP ${response.status}`);
    }
    const data: unknown = await response.json();
    if (!isRecord(data) || !isRecord(data.owner)) {
      throw new Error('Destination Service runtime lookup returned an invalid response');
    }
    if (typeof data.owner.InstanceId === 'string' && data.owner.InstanceId.length > 0) {
      throw new RuntimeDestinationLevelError('INSTANCE_DESTINATION_SHADOW', destinationName);
    }
    if (typeof data.owner.SubaccountId !== 'string' || data.owner.SubaccountId.length === 0) {
      throw new RuntimeDestinationLevelError('DESTINATION_NOT_FOUND_AT_SUBACCOUNT', destinationName);
    }
    if (!isRecord(data.destinationConfiguration)) {
      throw new Error('Destination Service runtime lookup returned an invalid destination configuration');
    }
    return destinationFromConfiguration(data.destinationConfiguration);
  });
}

async function validateJwtForConnectivity(
  btpConfig: BTPConfig,
  destinationName: string,
  userJwt: string,
): Promise<boolean> {
  if (!btpConfig.connectivityClientId || !btpConfig.connectivitySecret || !btpConfig.connectivityTokenUrl) {
    return false;
  }
  try {
    return await withRequestTimeout(btpConfig.requestTimeoutMs, async (signal) => {
      const response = await fetch(btpConfig.connectivityTokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          client_id: btpConfig.connectivityClientId,
          client_secret: btpConfig.connectivitySecret,
          assertion: userJwt,
          token_format: 'jwt',
          response_type: 'token',
        }).toString(),
        signal,
      });
      await response.arrayBuffer();
      if (!response.ok) {
        logger.warn('PP jwt-bearer validation failed', { destination: destinationName, status: response.status });
      }
      return response.ok;
    });
  } catch (error) {
    logger.warn('PP jwt-bearer validation failed', {
      destination: destinationName,
      reason: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'request_failed',
    });
    return false;
  }
}

/** Resolve PP from an owner-confirmed subaccount destination and verified user JWT. */
export async function resolveRuntimeSubaccountPpDestination(
  btpConfig: BTPConfig,
  destinationName: string,
  userJwt: string,
): Promise<{ destination: Destination; authTokens: PerUserAuthTokens }> {
  const destination = await resolveRuntimeSubaccountDestination(btpConfig, destinationName);
  const authTokens: PerUserAuthTokens = {};
  if (await validateJwtForConnectivity(btpConfig, destinationName, userJwt)) {
    // PP Option 2: the exchange validates the user token; Cloud Connector consumes the original
    // token from SAP-Connectivity-Authentication to create the short-lived user certificate.
    authTokens.sapConnectivityAuth = `Bearer ${userJwt}`;
  }
  return { destination, authTokens };
}
