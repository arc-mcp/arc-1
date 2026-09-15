/** Pure, fail-closed target grants from the verified XSUAA attribute boundary. */

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { TARGET_ID_PATTERN } from './multi-target-identity.js';

export type MultiTargetAuthorizationMode = 'legacy' | 'xsuaa-attribute';
export type TargetGrantFailure = 'TARGET_GRANT_MISSING' | 'TARGET_GRANT_MALFORMED' | 'TARGET_GRANT_LIMIT_EXCEEDED';

export type TargetGrant =
  | Readonly<{ mode: 'none'; status: TargetGrantFailure }>
  | Readonly<{ mode: 'exact'; status: 'valid'; targets: readonly string[]; exactGrantCount: number }>
  | Readonly<{ mode: 'all'; status: 'valid' }>;

const ATTRIBUTE = 'arc1_targets';
const MAX_RAW_VALUES = 1_024;
const MAX_VALUE_BYTES = 128;
const MAX_TOTAL_BYTES = 16 * 1_024;
const MAX_UNIQUE_VALUES = 256;
const MAX_TARGET_LENGTH = 36;
const EMPTY_TARGETS: readonly never[] = Object.freeze([]);

function none(status: TargetGrantFailure): TargetGrant {
  return Object.freeze({ mode: 'none', status });
}

/** Only own data properties are accepted; inherited values/accessors are not claims. */
function ownValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

/**
 * Consume only the auth package's verified, allowlisted values and extraction status.
 * This function neither verifies JWTs nor authorizes legacy mode. The HTTP boundary must
 * supply AuthInfo from its configured XSUAA verifier; callers cannot supply their own extra.
 */
export function parseTargetGrant(authInfo?: Pick<AuthInfo, 'extra'>): TargetGrant {
  const extra = ownValue(authInfo, 'extra');
  const values = ownValue(ownValue(extra, 'xsuaaUserAttributes'), ATTRIBUTE);
  const status = ownValue(ownValue(extra, 'xsuaaUserAttributeStatus'), ATTRIBUTE);
  if (status === 'missing') return none('TARGET_GRANT_MISSING');
  if (status === 'invalid') return none('TARGET_GRANT_MALFORMED');
  if (status === 'limit_exceeded') return none('TARGET_GRANT_LIMIT_EXCEEDED');
  if (status === undefined && values === undefined) return none('TARGET_GRANT_MISSING');
  if (status !== 'valid') return none('TARGET_GRANT_MALFORMED');
  if (typeof values !== 'string' && !Array.isArray(values)) return none('TARGET_GRANT_MALFORMED');

  const rawValues: readonly unknown[] = typeof values === 'string' ? [values] : values;
  if (rawValues.length > MAX_RAW_VALUES) return none('TARGET_GRANT_LIMIT_EXCEEDED');
  if (rawValues.length === 0) return none('TARGET_GRANT_MISSING');

  // Bound every original value before trimming or deduplication. The cheap code-unit
  // guard avoids scanning an arbitrarily large string merely to measure its UTF-8 bytes.
  let totalBytes = 0;
  for (const value of rawValues) {
    if (typeof value !== 'string') return none('TARGET_GRANT_MALFORMED');
    if (value.length > MAX_VALUE_BYTES) return none('TARGET_GRANT_LIMIT_EXCEEDED');
    const bytes = Buffer.byteLength(value, 'utf8');
    totalBytes += bytes;
    if (bytes > MAX_VALUE_BYTES || totalBytes > MAX_TOTAL_BYTES) return none('TARGET_GRANT_LIMIT_EXCEEDED');
  }

  const canonical = new Set<string>();
  for (const value of rawValues as readonly string[]) {
    const trimmed = value.trim();
    const slash = trimmed.indexOf('/');
    // Identical normalization to aggregate normalizeTarget: uppercase only the system
    // segment, then apply the shared public-ID grammar. Never split CSV or expand globs.
    const normalized = slash >= 0 ? `${trimmed.slice(0, slash).toUpperCase()}${trimmed.slice(slash)}` : trimmed;
    if (normalized !== '*' && !TARGET_ID_PATTERN.test(normalized)) return none('TARGET_GRANT_MALFORMED');
    canonical.add(normalized);
    if (canonical.size > MAX_UNIQUE_VALUES) return none('TARGET_GRANT_LIMIT_EXCEEDED');
  }

  // A broad grant must not conceal a later malformed value or exceed the unique bound.
  if (canonical.has('*')) return Object.freeze({ mode: 'all', status: 'valid' });
  const targets = Object.freeze([...canonical].sort());
  return Object.freeze({ mode: 'exact', status: 'valid', targets, exactGrantCount: targets.length });
}

/** The requested ID must already be canonical; even all-target grants never accept bad syntax. */
export function isTargetGranted(grant: TargetGrant, targetId: string): boolean {
  if (
    typeof targetId !== 'string' ||
    targetId.length > MAX_TARGET_LENGTH ||
    targetId !== targetId.trim() ||
    !TARGET_ID_PATTERN.test(targetId)
  ) {
    return false;
  }
  return grant.mode === 'all' || (grant.mode === 'exact' && grant.targets.includes(targetId));
}

/** Filter an immutable registry projection without mutating it or revealing unknown grants. */
export function projectGrantedTargets<T extends { readonly target: string }>(
  targets: readonly T[],
  grant: TargetGrant,
): readonly T[] {
  if (grant.mode === 'none') return EMPTY_TARGETS;
  return Object.freeze(targets.filter((target) => isTargetGranted(grant, target.target)));
}
