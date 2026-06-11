/**
 * Cache-security context for per-user (principal-propagation) clients — upstream fix #393.
 *
 * Under PP, every user gets their own SAP session; shared per-process caches (the inactive-object
 * list, the dependency-payload cache) must be keyed per user — or bypassed — so one user's view
 * never leaks into another's. handleToolCall builds the context once per call and threads it into
 * the read/write/activate/context handlers and the server-driven write engine.
 *
 * Moved verbatim from intent.ts during the Stage B handler split (this is the leaf home for the
 * helpers because five handler modules + dispatch consume them).
 */

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { AdtClient } from '../adt/client.js';
import type { CachingLayer } from '../cache/caching-layer.js';

export interface CacheSecurityContext {
  isPerUserClient: boolean;
  userKey?: string;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function resolveCacheUserKey(authInfo: AuthInfo | undefined): string | undefined {
  if (!authInfo) return undefined;
  const extra = (authInfo.extra ?? {}) as {
    userName?: unknown;
    email?: unknown;
    sub?: unknown;
    preferred_username?: unknown;
    iss?: unknown;
  };
  const issuerOrClient = nonEmptyString(extra.iss) ?? nonEmptyString(authInfo.clientId) ?? 'unknown-auth-source';
  const namespace = issuerOrClient.toLowerCase();

  const userName = nonEmptyString(extra.userName);
  if (userName) return `${namespace}:userName:${userName.toUpperCase()}`;

  const email = nonEmptyString(extra.email);
  if (email) return `${namespace}:email:${email.toLowerCase()}`;

  const sub = nonEmptyString(extra.sub);
  if (sub) return `${namespace}:sub:${sub}`;

  const preferredUsername = nonEmptyString(extra.preferred_username);
  if (preferredUsername) return `${namespace}:preferred_username:${preferredUsername.toLowerCase()}`;

  return undefined;
}

export function buildCacheSecurityContext(
  authInfo: AuthInfo | undefined,
  isPerUserClient?: boolean,
): CacheSecurityContext {
  if (!isPerUserClient) return { isPerUserClient: false };
  return {
    isPerUserClient: true,
    userKey: resolveCacheUserKey(authInfo),
  };
}

export function inactiveListUserKey(client: AdtClient, cacheSecurity: CacheSecurityContext): string | undefined {
  return cacheSecurity.isPerUserClient ? cacheSecurity.userKey : client.username;
}

export function invalidateInactiveList(
  cachingLayer: CachingLayer | undefined,
  client: AdtClient,
  cacheSecurity: CacheSecurityContext,
): void {
  cachingLayer?.inactiveLists.invalidate(inactiveListUserKey(client, cacheSecurity));
}

export function contextCacheForDependencyPayloads(
  cachingLayer: CachingLayer | undefined,
  cacheSecurity: CacheSecurityContext,
): CachingLayer | undefined {
  return cacheSecurity.isPerUserClient ? undefined : cachingLayer;
}
