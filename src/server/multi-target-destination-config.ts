/**
 * Destination-property contract for multi-target v1.
 *
 * Keep this file deliberately small: discovery, startup validation, and runtime
 * drift checks must all agree on the exact same property names and value syntax.
 */

import { isValidAllowedPackagePattern, splitAllowedPackageList } from '../adt/safety.js';

const WRITE_ARC_PROPERTY_LIST = Object.freeze([
  'arc1.allow_writes',
  'arc1.allowed_packages',
  'arc1.allow_transport_writes',
  'arc1.allow_git_writes',
]);

// Write keys are supported (ADR-0008) so discovery and runtime drift projection retain their values.
export const MULTI_TARGET_ARC_PROPERTIES = Object.freeze([
  'arc1.enabled',
  'arc1.allow_data_preview',
  'arc1.allow_free_sql',
  'arc1.target_alias',
  ...WRITE_ARC_PROPERTY_LIST,
]);

const SUPPORTED_ARC_PROPERTIES = new Set(MULTI_TARGET_ARC_PROPERTIES);
const MAX_DESTINATION_PACKAGE_PATTERNS = 64;

export interface DestinationWritePolicy {
  readonly allowWrites: boolean;
  /** Never empty — `[]` means "all packages" to safety.ts. Read-only policies carry ['$TMP']. */
  readonly allowedPackages: readonly string[];
  readonly allowTransportWrites: boolean;
  readonly allowGitWrites: boolean;
}

export const READ_ONLY_WRITE_POLICY: DestinationWritePolicy = Object.freeze({
  allowWrites: false,
  allowedPackages: Object.freeze(['$TMP']),
  allowTransportWrites: false,
  allowGitWrites: false,
});

export type WritePolicyParseResult =
  | { ok: true; policy: DestinationWritePolicy }
  | { ok: false; code: 'WRITE_REQUIRES_PRINCIPAL_PROPAGATION' | 'INVALID_WRITE_POLICY'; message: string };

export function isSupportedMultiTargetArcProperty(key: string): boolean {
  return SUPPORTED_ARC_PROPERTIES.has(key);
}

/** Parse the destination-service boolean format without inventing a default. */
export function parseDestinationBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return undefined;
}

const WRITE_BOOLEAN_PROPERTIES = Object.freeze([
  'arc1.allow_writes',
  'arc1.allow_transport_writes',
  'arc1.allow_git_writes',
]);

function invalidWritePolicy(message: string): WritePolicyParseResult {
  return { ok: false, code: 'INVALID_WRITE_POLICY', message };
}

/**
 * Parse the destination write opt-in (ADR-0008). Fails closed:
 * - no write key → read-only policy;
 * - non-PrincipalPropagation → only explicit valid `false` keys stay read-only (Q3); anything that
 *   requests writes (`true`, an invalid value, or any `arc1.allowed_packages`) is refused;
 * - PP → strict booleans, sub-flags require `allow_writes=true`, and `allow_writes=true` requires a
 *   non-empty, strictly valid `arc1.allowed_packages` list (never `[]`, which safety.ts reads as "all").
 *
 * The result is the REQUESTED policy only; the instance ceilings are applied by the registry.
 */
export function parseDestinationWritePolicy(
  properties: Readonly<Record<string, string>>,
  authentication: string,
): WritePolicyParseResult {
  const present = WRITE_ARC_PROPERTY_LIST.filter((key) => properties[key] !== undefined);
  if (present.length === 0) return { ok: true, policy: READ_ONLY_WRITE_POLICY };

  if (authentication !== 'PrincipalPropagation') {
    const onlyExplicitFalse = present.every(
      (key) => key !== 'arc1.allowed_packages' && parseDestinationBoolean(properties[key]) === false,
    );
    if (onlyExplicitFalse) return { ok: true, policy: READ_ONLY_WRITE_POLICY };
    return {
      ok: false,
      code: 'WRITE_REQUIRES_PRINCIPAL_PROPAGATION',
      message: 'Multi-target writes require a PrincipalPropagation destination; remove the arc1 write properties.',
    };
  }

  const flags: Record<string, boolean> = {};
  for (const key of WRITE_BOOLEAN_PROPERTIES) {
    const raw = properties[key];
    if (raw === undefined) {
      flags[key] = false;
      continue;
    }
    const parsed = parseDestinationBoolean(raw);
    if (parsed === undefined) return invalidWritePolicy(`${key} must be true or false.`);
    flags[key] = parsed;
  }

  if (!flags['arc1.allow_writes']) {
    if (flags['arc1.allow_transport_writes'] || flags['arc1.allow_git_writes']) {
      return invalidWritePolicy(
        'arc1.allow_transport_writes and arc1.allow_git_writes require arc1.allow_writes=true.',
      );
    }
    return { ok: true, policy: READ_ONLY_WRITE_POLICY };
  }

  const rawPackages = properties['arc1.allowed_packages'];
  if (rawPackages === undefined) {
    return invalidWritePolicy('arc1.allow_writes=true requires arc1.allowed_packages.');
  }
  const { entries, hadEmptyEntries } = splitAllowedPackageList(rawPackages);
  if (entries.length === 0 || hadEmptyEntries) {
    return invalidWritePolicy('arc1.allowed_packages must be a comma-separated list without empty entries.');
  }
  if (entries.length > MAX_DESTINATION_PACKAGE_PATTERNS) {
    return invalidWritePolicy(`arc1.allowed_packages allows at most ${MAX_DESTINATION_PACKAGE_PATTERNS} patterns.`);
  }
  if (!entries.every(isValidAllowedPackagePattern)) {
    return invalidWritePolicy('arc1.allowed_packages entries must be NAME, PREFIX*, ROOT/** or *.');
  }

  return {
    ok: true,
    policy: Object.freeze({
      allowWrites: true,
      allowedPackages: Object.freeze([...entries]),
      allowTransportWrites: flags['arc1.allow_transport_writes'],
      allowGitWrites: flags['arc1.allow_git_writes'],
    }),
  };
}
