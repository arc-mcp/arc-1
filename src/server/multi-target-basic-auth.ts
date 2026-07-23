/** Request-local client preparation and authentication canary for shared Basic targets. */

import type { BTPConfig, BTPProxyConfig, Destination } from '@arc-mcp/xsuaa-auth/btp';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { AdtClient } from '../adt/client.js';
import type { AdtClientConfig } from '../adt/config.js';
import { AdtApiError, classifySapDomainError } from '../adt/errors.js';
import { classifyMultiTargetSapError } from '../handlers/dispatch.js';
import { setCachedDiscovery, setCachedFeatures } from '../handlers/feature-cache.js';
import type { ToolResult } from '../handlers/shared.js';
import type { TargetDescriptor } from './destination-registry.js';
import { authLibLogger, logger } from './logger.js';
import {
  RuntimeDestinationLevelError,
  resolveRuntimeSubaccountDestination,
} from './multi-target-destination-runtime.js';
import { TargetConfigChangedError, validateTargetDrift } from './multi-target-runtime.js';
import type { MultiTargetErrorBuilder } from './multi-target-server.js';
import {
  type MultiTargetSharedAuthState,
  SharedAuthBlockedError,
  SharedAuthBusyError,
  type SharedAuthLease,
} from './multi-target-shared-auth-state.js';
import type { ServerConfig } from './types.js';

const SHARED_BASIC_CANARY_ENDPOINT = '/sap/bc/adt/core/discovery';
const ATOM_PUBLISHING_NAMESPACE = 'http://www.w3.org/2007/app';
const discoveryParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: false,
  parseTagValue: false,
  trimValues: true,
});

export type SharedBasicSetupCode =
  | 'BASIC_CREDENTIALS_MISSING'
  | 'BASIC_CREDENTIALS_INVALID'
  | 'CLOUD_CONNECTOR_ACCESS_DENIED'
  | 'DESTINATION_AUTH_SETUP_FAILED'
  | 'SAP_TARGET_TEMPORARILY_UNAVAILABLE';

export class SharedBasicSetupError extends Error {
  constructor(
    readonly code: SharedBasicSetupCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'SharedBasicSetupError';
  }
}

function validateCredentials(destination: Destination): { username: string; password: string } {
  const username = destination.User;
  const password = destination.Password;
  if (typeof username !== 'string' || username.trim().length === 0 || typeof password !== 'string' || !password) {
    throw new SharedBasicSetupError(
      'BASIC_CREDENTIALS_MISSING',
      'The selected Basic destination must contain non-empty User and Password fields. Update the destination, then try again without restarting ARC-1.',
      false,
    );
  }
  if (username !== username.trim()) {
    throw new SharedBasicSetupError(
      'BASIC_CREDENTIALS_INVALID',
      'The selected Basic destination User must not have leading or trailing whitespace. Update the destination, then try again without restarting ARC-1.',
      false,
    );
  }
  if (username.includes(':')) {
    throw new SharedBasicSetupError(
      'BASIC_CREDENTIALS_INVALID',
      'The selected Basic destination User must not contain a colon. Update the destination, then try again without restarting ARC-1.',
      false,
    );
  }
  return { username, password };
}

function isRecognizableAdtDiscovery(body: string, headers: Record<string, string>): boolean {
  const contentType = Object.entries(headers).find(([name]) => name.toLowerCase() === 'content-type')?.[1] ?? '';
  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const trimmed = body.trim();
  if (!trimmed || /<!doctype\s+html|<html\b/i.test(trimmed)) return false;
  if (mediaType !== '' && mediaType !== 'application/xml' && mediaType !== 'text/xml' && !mediaType.endsWith('+xml')) {
    return false;
  }
  if (XMLValidator.validate(trimmed) !== true) return false;
  try {
    const parsed = discoveryParser.parse(trimmed) as Record<string, unknown>;
    const rootElements = Object.keys(parsed).filter((key) => !key.startsWith('?'));
    if (rootElements.length !== 1) return false;
    const rootName = rootElements[0];
    const separator = rootName.indexOf(':');
    const prefix = separator < 0 ? undefined : rootName.slice(0, separator);
    const localName = separator < 0 ? rootName : rootName.slice(separator + 1);
    if (localName !== 'service') return false;
    const service = parsed[rootName];
    if (!service || typeof service !== 'object' || Array.isArray(service)) return false;
    const serviceRecord = service as Record<string, unknown>;
    const namespace = serviceRecord[prefix ? `@_xmlns:${prefix}` : '@_xmlns'];
    // SAP_BASIS 758 can return a valid, authenticated empty AtomPub service from
    // /core/discovery. The namespace-qualified service root is the stable canary;
    // workspace and extension children vary by release.
    return namespace === ATOM_PUBLISHING_NAMESPACE;
  } catch {
    return false;
  }
}

export interface PrepareSharedBasicClientOptions {
  readonly instanceConfig: ServerConfig;
  readonly btpConfig: BTPConfig;
  readonly target: TargetDescriptor;
  readonly lease: SharedAuthLease;
  /** Supplies the existing isolated multi-target safety and server-wide semaphore. */
  readonly buildClientConfig: (proxy: BTPProxyConfig) => Partial<AdtClientConfig>;
}

export interface PreparedSharedBasicClient {
  readonly client: AdtClient;
  /** True once this request-local client observes any final/synthetic HTTP 401. */
  readonly wasAuthenticationRejected: () => boolean;
}

/** Resolve current credentials and create a fresh request-local ADT client while the target gate is held. */
export async function prepareSharedBasicClient(
  options: PrepareSharedBasicClientOptions,
): Promise<PreparedSharedBasicClient> {
  const { createConnectivityProxy } = await import('@arc-mcp/xsuaa-auth/btp');
  const { instanceConfig, btpConfig, target, lease } = options;
  let destination: Destination;
  try {
    destination = await resolveRuntimeSubaccountDestination(btpConfig, target.destinationName);
  } catch (error) {
    if (error instanceof RuntimeDestinationLevelError) {
      lease.markConfigurationInvalid();
      throw new TargetConfigChangedError(target.target, error.message);
    }
    lease.markLookupUnavailable();
    throw new SharedBasicSetupError(
      'DESTINATION_AUTH_SETUP_FAILED',
      `ARC-1 could not resolve the Basic destination for target ${target.target}. Check the Destination service binding and try again.`,
      true,
    );
  }

  const drift = validateTargetDrift(destination, target, instanceConfig);
  if (!drift.ok) {
    lease.markConfigurationInvalid();
    throw new TargetConfigChangedError(target.target, drift.message);
  }

  let credentials: { username: string; password: string };
  try {
    credentials = validateCredentials(destination);
  } catch (error) {
    lease.markConfigurationInvalid();
    throw error;
  }
  const { changed } = lease.bindCredentials(credentials.username, credentials.password);
  // Clear prior-user feature/discovery evidence as soon as a new generation is bound.
  // Later proxy/client setup may fail; deferring invalidation until it returns would
  // make the retry see changed=false and retain stale evidence indefinitely.
  if (changed) {
    setCachedFeatures(undefined, target.target);
    setCachedDiscovery(new Map(), target.target);
  }
  let proxy: BTPProxyConfig | null | undefined;
  try {
    proxy = createConnectivityProxy(btpConfig, destination.CloudConnectorLocationId, authLibLogger);
  } catch {
    lease.markLookupUnavailable();
    throw new SharedBasicSetupError(
      'DESTINATION_AUTH_SETUP_FAILED',
      `ARC-1 could not create the Cloud Connector proxy for target ${target.target}. Check the Connectivity service binding and try again.`,
      true,
    );
  }
  if (!proxy) {
    lease.markLookupUnavailable();
    throw new SharedBasicSetupError(
      'DESTINATION_AUTH_SETUP_FAILED',
      `ARC-1 could not create the Cloud Connector proxy for target ${target.target}. Check the Connectivity service binding and try again.`,
      true,
    );
  }

  try {
    const adtConfig = options.buildClientConfig(proxy);
    adtConfig.baseUrl = drift.url;
    adtConfig.username = credentials.username;
    adtConfig.password = credentials.password;
    adtConfig.cookies = {};
    adtConfig.cookieFile = undefined;
    adtConfig.cookieString = undefined;
    adtConfig.bearerTokenProvider = undefined;
    adtConfig.sapConnectivityAuth = undefined;
    adtConfig.ppProxyAuth = undefined;
    adtConfig.samlAuthorization = undefined;
    adtConfig.btpProxy = proxy;
    adtConfig.disableSaml = true;
    adtConfig.retryUnauthorized = false;
    let authenticationRejected = false;
    adtConfig.onUnauthorized = () => {
      authenticationRejected = true;
      lease.markAuthenticationFailed();
    };
    return {
      client: new AdtClient(adtConfig),
      wasAuthenticationRejected: () => authenticationRejected,
    };
  } catch {
    lease.markLookupUnavailable();
    throw new SharedBasicSetupError(
      'DESTINATION_AUTH_SETUP_FAILED',
      `ARC-1 could not prepare the isolated SAP client for target ${target.target}. Check the Connectivity service binding and try again.`,
      true,
    );
  }
}

/** Authenticate once before feature probing without poisoning credentials on ambiguous infrastructure 403s. */
export async function runSharedBasicCanary(client: AdtClient, lease: SharedAuthLease, target: string): Promise<void> {
  try {
    const response = await client.http.get(SHARED_BASIC_CANARY_ENDPOINT, { Accept: 'application/atomsvc+xml' });
    if (!isRecognizableAdtDiscovery(response.body, response.headers)) {
      lease.markTemporarilyUnavailable();
      throw new SharedBasicSetupError(
        'SAP_TARGET_TEMPORARILY_UNAVAILABLE',
        'ARC-1 received an unrecognized response from the shared Basic authentication canary. Check SAP and intermediary health, then try again.',
        true,
      );
    }
    lease.markHealthy();
  } catch (error) {
    if (error instanceof SharedAuthBlockedError) throw error;
    if (error instanceof SharedBasicSetupError) throw error;
    if (error instanceof AdtApiError && error.statusCode === 401) {
      lease.markAuthenticationFailed();
      throw new SharedAuthBlockedError('authentication_failed');
    }
    if (error instanceof AdtApiError && error.statusCode === 403) {
      const targetFailure = classifyMultiTargetSapError(error, target, 'shared Basic authentication canary', 'shared');
      if (targetFailure?.code === 'CLOUD_CONNECTOR_ACCESS_DENIED') {
        lease.markTemporarilyUnavailable();
        throw new SharedBasicSetupError(targetFailure.code, targetFailure.message, true);
      }
      const classification = classifySapDomainError(error.statusCode, error.responseBody, error.path);
      if (classification?.category === 'authorization') {
        lease.markAuthorizationFailed();
        throw new SharedAuthBlockedError('authorization_failed');
      }
    }
    lease.markTemporarilyUnavailable();
    throw new SharedBasicSetupError(
      'SAP_TARGET_TEMPORARILY_UNAVAILABLE',
      'ARC-1 could not complete the shared Basic authentication canary. Check SAP and Cloud Connector availability, then try again.',
      true,
    );
  }
}

export interface HandleSharedBasicCallOptions {
  readonly isJwt: boolean;
  readonly btpConfig?: BTPConfig;
  readonly sharedAuthState?: MultiTargetSharedAuthState;
  readonly instanceConfig: ServerConfig;
  readonly target: TargetDescriptor;
  readonly requestId: string;
  readonly user?: string;
  readonly clientId?: string;
  readonly toolName: string;
  readonly multiError: MultiTargetErrorBuilder;
  readonly buildClientConfig: (proxy: BTPProxyConfig) => Partial<AdtClientConfig>;
  readonly dispatch: (
    client: AdtClient,
    postDispatchResult: () => ToolResult | undefined,
  ) => Promise<Record<string, unknown>>;
}

/** Run one complete serialized Basic invocation and translate its setup/guard failures for MCP. */
export async function handleSharedBasicCall(options: HandleSharedBasicCallOptions): Promise<Record<string, unknown>> {
  const { target, multiError } = options;
  if (!options.isJwt) {
    return multiError(
      'BASIC_XSUAA_REQUIRED',
      'Shared Basic multi-target routes require an XSUAA JWT. Sign in with an ARC-1 role and try again.',
      { retryable: false },
      'shared_auth_failed',
    );
  }
  if (!options.btpConfig || !options.sharedAuthState) {
    return multiError(
      'DESTINATION_AUTH_SETUP_FAILED',
      'Shared Basic authentication cannot start because BTP runtime configuration is unavailable.',
      { retryable: true },
      'shared_auth_failed',
    );
  }

  try {
    return await options.sharedAuthState.runExclusive(target.target, async (lease) => {
      const prepared = await prepareSharedBasicClient({
        instanceConfig: options.instanceConfig,
        btpConfig: options.btpConfig as BTPConfig,
        target,
        lease,
        buildClientConfig: options.buildClientConfig,
      });
      await runSharedBasicCanary(prepared.client, lease, target.target);
      logger.emitAudit({
        timestamp: new Date().toISOString(),
        level: 'info',
        event: 'auth_shared_created',
        requestId: options.requestId,
        user: options.user,
        clientId: options.clientId,
        target: target.target,
        tool: options.toolName,
        identity: 'shared',
      });
      return options.dispatch(prepared.client, () => {
        if (!prepared.wasAuthenticationRejected()) return undefined;
        const error = new SharedAuthBlockedError('authentication_failed');
        return multiError(
          error.code,
          error.message,
          {
            retryable: error.retryable,
          },
          'shared_auth_failed',
        ) as unknown as ToolResult;
      });
    });
  } catch (error) {
    if (error instanceof SharedAuthBusyError || error instanceof SharedAuthBlockedError) {
      return multiError(error.code, error.message, { retryable: error.retryable }, 'shared_auth_failed');
    }
    if (error instanceof SharedBasicSetupError) {
      return multiError(error.code, error.message, { retryable: error.retryable }, 'shared_auth_failed');
    }
    if (error instanceof TargetConfigChangedError) {
      return multiError(error.code, error.message, { retryable: false }, 'shared_auth_failed');
    }
    return multiError(
      'DESTINATION_AUTH_SETUP_FAILED',
      `Shared Basic authentication for target ${target.target} could not be prepared. Check the destination and service bindings, then try again.`,
      { retryable: true },
      'shared_auth_failed',
    );
  }
}
