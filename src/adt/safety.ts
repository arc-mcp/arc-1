/**
 * Safety system for ARC-1.
 *
 * Gates all operations before they reach SAP. This is the first line of defense
 * against unintended modifications — it runs before any HTTP call.
 *
 * Design (post-authz-refactor-v2):
 *   - Safety flags are all POSITIVE opt-ins (`allow*=true` to enable a capability).
 *     Defaults are restrictive. No mix of negations and opt-ins.
 *   - Every mutation requires the matching server flag AND the user's scope
 *     (two-gate rule; scope check happens in the handler layer).
 *   - `allowWrites=false` is a TRUE no-mutation block — it stops object writes,
 *     transport writes, git writes, and activation (no loopholes).
 *   - Fine-grained per-action denials are expressed via `denyActions` (parsed
 *     from `SAP_DENY_ACTIONS`), not via op-code allow/block lists.
 *
 * Internal only: `OperationType` is the classification used by the safety
 * engine. It is NOT admin-facing — the env vars `SAP_ALLOWED_OPS` /
 * `SAP_DISALLOWED_OPS` were removed in v0.7. Admins configure via the `allow*`
 * flags and `SAP_DENY_ACTIONS`.
 */

import { AdtSafetyError } from './errors.js';
import type { PackageHierarchyResolver } from './package-hierarchy.js';

/** Suffix that marks an `allowedPackages` entry as "this package + DEVCLASS subtree". */
export const SUBTREE_SUFFIX = '/**';

/**
 * Operation type codes (internal classification).
 * NOT admin-facing — the code just uses these as a compact categorical label.
 */
export const OperationType = {
  Read: 'R',
  Search: 'S',
  Query: 'Q',
  FreeSQL: 'F',
  Create: 'C',
  Update: 'U',
  Delete: 'D',
  Activate: 'A',
  Test: 'T',
  Lock: 'L',
  Intelligence: 'I',
  Workflow: 'W',
  Transport: 'X',
} as const;

export type OperationTypeCode = (typeof OperationType)[keyof typeof OperationType];

/** Mutating operation types — blocked when `allowWrites=false`. */
const MUTATING_OPS = 'CDUAWX';
const DENY_ALL_LIST_ENTRY = '__ARC1_DENY_ALL__';

function listDeniesAll(list: string[]): boolean {
  return list.includes(DENY_ALL_LIST_ENTRY);
}

function displayAllowList(list: string[]): string {
  return listDeniesAll(list) ? '[]' : `[${list.join(',')}]`;
}

export interface SafetyConfig {
  allowWrites: boolean;
  allowDataPreview: boolean;
  allowFreeSQL: boolean;
  allowTransportWrites: boolean;
  allowGitWrites: boolean;
  allowedPackages: string[];
  allowedTransports: string[];
  /** Resolved deny-action patterns from SAP_DENY_ACTIONS. Populated at config-parse time. */
  denyActions: string[];
}

/**
 * Safe defaults — mirrors DEFAULT_CONFIG in src/server/types.ts.
 * Use this when a test needs the real ship default without re-deriving it.
 * If you change DEFAULT_CONFIG's safety fields, update this to match.
 */
export function defaultSafetyConfig(): SafetyConfig {
  return {
    allowWrites: false,
    allowDataPreview: false,
    allowFreeSQL: false,
    allowTransportWrites: false,
    allowGitWrites: false,
    allowedPackages: ['$TMP'],
    allowedTransports: [],
    denyActions: [],
  };
}

/** No restrictions — use with caution. */
export function unrestrictedSafetyConfig(): SafetyConfig {
  return {
    allowWrites: true,
    allowDataPreview: true,
    allowFreeSQL: true,
    allowTransportWrites: true,
    allowGitWrites: true,
    allowedPackages: [],
    allowedTransports: [],
    denyActions: [],
  };
}

/** Check if an operation type is allowed by the safety config. */
export function isOperationAllowed(config: SafetyConfig, op: OperationTypeCode): boolean {
  // Mutating ops (Create/Update/Delete/Activate/Workflow/Transport) require allowWrites
  if (MUTATING_OPS.includes(op) && !config.allowWrites) return false;

  // Transport mutation has an additional gate
  if (op === OperationType.Transport && !config.allowTransportWrites) return false;

  // Table preview
  if (op === OperationType.Query && !config.allowDataPreview) return false;

  // Free SQL
  if (op === OperationType.FreeSQL && !config.allowFreeSQL) return false;

  // All other ops (Read/Search/Intelligence/Test/Lock) are always allowed at this layer.
  // User-gating happens at the scope layer (ACTION_POLICY + hasRequiredScope).
  return true;
}

/** Check operation and throw AdtSafetyError if blocked. */
export function checkOperation(config: SafetyConfig, op: OperationTypeCode, opName: string): void {
  if (!isOperationAllowed(config, op)) {
    throw new AdtSafetyError(
      `Operation '${opName}' (type ${op}) is blocked by safety configuration (${explainOperationBlock(config, op)})`,
    );
  }
}

/** Returns a human-readable reason why an operation is blocked. Assumes the op IS blocked. */
function explainOperationBlock(config: SafetyConfig, op: OperationTypeCode): string {
  if (MUTATING_OPS.includes(op) && !config.allowWrites)
    return 'reason: allowWrites=false blocks mutations (C/D/U/A/W/X)';
  if (op === OperationType.Transport && !config.allowTransportWrites) return 'reason: allowTransportWrites=false';
  if (op === OperationType.Query && !config.allowDataPreview) return 'reason: allowDataPreview=false';
  if (op === OperationType.FreeSQL && !config.allowFreeSQL) return 'reason: allowFreeSQL=false';
  return 'reason: unknown';
}

/**
 * Static (synchronous) outcome of evaluating `allowedPackages` against `pkg`.
 *   - 'allowed': the package matches an exact / prefix-wildcard / subtree-root rule.
 *   - 'denied': no rule matches and no subtree rule could possibly match.
 *   - 'needs-hierarchy': at least one `X/**` rule exists where `pkg !== X`; the
 *     decision requires DEVCLASS hierarchy resolution. The caller MUST resolve
 *     via `checkPackage(..., resolver)` (async) — falling back to
 *     `isPackageAllowed`'s boolean form will treat it as DENIED (fail-closed).
 */
export type PackageAllowDecision = 'allowed' | 'denied' | 'needs-hierarchy';

/**
 * Evaluate the static portion of `allowedPackages`.
 *
 * Subtree (`X/**`) rules can only be statically resolved when the package
 * equals the subtree root. Any other case requires hierarchy resolution and
 * is reported as 'needs-hierarchy'.
 */
export function decidePackageAllowed(config: SafetyConfig, pkg: string): PackageAllowDecision {
  if (listDeniesAll(config.allowedPackages)) return 'denied';
  if (config.allowedPackages.length === 0) return 'allowed';

  const upperPkg = pkg.toUpperCase();
  let hasSubtreeRule = false;

  for (const allowed of config.allowedPackages) {
    const upperAllowed = allowed.toUpperCase();

    if (upperAllowed === upperPkg) return 'allowed';

    if (upperAllowed.endsWith(SUBTREE_SUFFIX)) {
      const root = upperAllowed.slice(0, -SUBTREE_SUFFIX.length);
      // Empty root (`/**` alone, or `**` missed the leading slash) is a misconfig — ignore.
      if (root.length === 0) continue;
      if (root === upperPkg) return 'allowed';
      hasSubtreeRule = true;
      continue;
    }

    // Prefix wildcard: "Z*" matches "ZTEST", "ZRAY", etc.
    if (upperAllowed.endsWith('*')) {
      const prefix = upperAllowed.slice(0, -1);
      if (upperPkg.startsWith(prefix)) return 'allowed';
    }
  }

  return hasSubtreeRule ? 'needs-hierarchy' : 'denied';
}

/**
 * Synchronous, fail-closed view of `allowedPackages`. Subtree rules that need
 * hierarchy resolution return `false` here — callers wanting the precise answer
 * must use `checkPackage(..., resolver)` (async).
 *
 * Kept exported because non-write code paths (effective-policy logging,
 * CLI display) rely on a quick synchronous check.
 */
export function isPackageAllowed(config: SafetyConfig, pkg: string): boolean {
  return decidePackageAllowed(config, pkg) === 'allowed';
}

/** Extract the subtree roots from `allowedPackages` (uppercased, empty roots dropped). */
function extractSubtreeRoots(config: SafetyConfig): string[] {
  const roots: string[] = [];
  for (const allowed of config.allowedPackages) {
    const upper = allowed.toUpperCase();
    if (!upper.endsWith(SUBTREE_SUFFIX)) continue;
    const root = upper.slice(0, -SUBTREE_SUFFIX.length);
    if (root.length === 0) continue;
    roots.push(root);
  }
  return roots;
}

/**
 * Check package and throw AdtSafetyError if blocked.
 *
 * If `allowedPackages` contains subtree (`X/**`) rules, a `resolver` is
 * required to evaluate them. Any resolver failure is treated as DENY
 * (fail-closed); the original failure is included in the thrown message.
 *
 * Reads are never package-gated; this function is only called on write paths.
 */
export async function checkPackage(
  config: SafetyConfig,
  pkg: string,
  resolver?: PackageHierarchyResolver | null,
): Promise<void> {
  const decision = decidePackageAllowed(config, pkg);
  if (decision === 'allowed') return;
  if (decision === 'denied') {
    throw new AdtSafetyError(
      `Operations on package '${pkg}' are blocked by safety configuration (allowed: ${displayAllowList(config.allowedPackages)})`,
    );
  }

  // 'needs-hierarchy' — every subtree rule must be tried.
  if (!resolver) {
    throw new AdtSafetyError(
      `Operations on package '${pkg}' need DEVCLASS hierarchy resolution for a subtree allowedPackages rule, ` +
        `but no resolver was passed to checkPackage (allowed: ${displayAllowList(config.allowedPackages)}). ` +
        `This is an internal wiring bug — please file an issue.`,
    );
  }
  const roots = extractSubtreeRoots(config);
  const errors: string[] = [];
  for (const root of roots) {
    try {
      if (await resolver.isDescendantOrSelf(root, pkg)) return;
    } catch (err) {
      // Capture and keep trying other roots — one root's failure must not bias
      // decisions on unrelated roots. If ALL roots fail, the package is denied
      // and the captured errors are surfaced.
      errors.push(`${root}${SUBTREE_SUFFIX}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (errors.length > 0) {
    throw new AdtSafetyError(
      `Operations on package '${pkg}' blocked: DEVCLASS hierarchy resolution failed (${errors.join('; ')})`,
    );
  }
  throw new AdtSafetyError(
    `Operations on package '${pkg}' are blocked by safety configuration (allowed: ${displayAllowList(config.allowedPackages)})`,
  );
}

/** Check if a transport is in the whitelist. */
function isTransportInWhitelist(config: SafetyConfig, transport: string): boolean {
  if (listDeniesAll(config.allowedTransports)) return false;
  if (config.allowedTransports.length === 0) return true;

  const upperTransport = transport.toUpperCase();

  for (const allowed of config.allowedTransports) {
    const upperAllowed = allowed.toUpperCase();
    if (upperAllowed === upperTransport) return true;
    if (upperAllowed.endsWith('*')) {
      const prefix = upperAllowed.slice(0, -1);
      if (upperTransport.startsWith(prefix)) return true;
    }
  }

  return false;
}

/**
 * Check transport operation. Writes require `allowWrites && allowTransportWrites`.
 * Reads are always allowed at this layer (scope check enforces user gating upstream).
 */
export function checkTransport(config: SafetyConfig, transport: string, opName: string, isWrite: boolean): void {
  if (isWrite) {
    if (!config.allowWrites) {
      throw new AdtSafetyError(
        `Transport write '${opName}' is blocked: allowWrites=false. Set SAP_ALLOW_WRITES=true to enable writes.`,
      );
    }
    if (!config.allowTransportWrites) {
      throw new AdtSafetyError(
        `Transport write '${opName}' is blocked: allowTransportWrites=false. Set SAP_ALLOW_TRANSPORT_WRITES=true to enable transport mutations.`,
      );
    }
  }

  // Transport whitelist applies to both read and write
  if (transport && transport !== '*' && config.allowedTransports.length > 0) {
    if (!isTransportInWhitelist(config, transport)) {
      throw new AdtSafetyError(
        `Operation '${opName}' on transport '${transport}' is blocked by safety configuration (allowed: ${displayAllowList(config.allowedTransports)})`,
      );
    }
  }
}

/**
 * Check git operation. Writes require `allowWrites && allowGitWrites`.
 * Reads are always allowed at this layer.
 */
export function checkGit(config: SafetyConfig, operation: string, isWrite = true): void {
  if (!isWrite) return;
  if (!config.allowWrites) {
    throw new AdtSafetyError(
      `Git write '${operation}' is blocked: allowWrites=false. Set SAP_ALLOW_WRITES=true to enable writes.`,
    );
  }
  if (!config.allowGitWrites) {
    throw new AdtSafetyError(
      `Git write '${operation}' is blocked: allowGitWrites=false. Set SAP_ALLOW_GIT_WRITES=true to enable git mutations.`,
    );
  }
}

/**
 * Derive a per-user effective safety config by merging the server ceiling with
 * the user's JWT scopes. Scopes can only RESTRICT further, never loosen.
 *
 * Uses the scope expansion rules from src/authz/policy.ts (admin implies all,
 * write implies read, sql implies data). Callers should pass the already-expanded
 * scope list for speed; this function re-expands as a safety net.
 */
export function deriveUserSafety(serverConfig: SafetyConfig, scopes: string[]): SafetyConfig {
  // Inline the expansion to avoid the circular import with src/authz/policy.ts.
  // Keep in sync with expandScopes() there.
  const expanded = new Set(scopes);
  if (expanded.has('admin')) {
    expanded.add('read');
    expanded.add('write');
    expanded.add('data');
    expanded.add('sql');
    expanded.add('transports');
    expanded.add('git');
  }
  if (expanded.has('write')) expanded.add('read');
  if (expanded.has('sql')) expanded.add('data');

  const effective: SafetyConfig = {
    ...serverConfig,
    allowedPackages: [...serverConfig.allowedPackages],
    allowedTransports: [...serverConfig.allowedTransports],
    denyActions: [...serverConfig.denyActions],
  };

  if (!expanded.has('write')) effective.allowWrites = false;
  if (!expanded.has('data')) effective.allowDataPreview = false;
  if (!expanded.has('sql')) effective.allowFreeSQL = false;
  if (!expanded.has('transports')) effective.allowTransportWrites = false;
  if (!expanded.has('git')) effective.allowGitWrites = false;

  return effective;
}

/**
 * Derive a per-user effective safety by intersecting a partial SafetyConfig
 * (from an API-key profile) with the server ceiling. Tight side wins field-by-field.
 *
 * Semantics:
 *   - Boolean fields: result is `server && profile` (both must be true for capability on).
 *   - `allowedPackages`:
 *       * If either side is `[]` (no restriction), use the other.
 *       * Else intersection by prefix semantics — profile entries covered by the
 *         server ceiling survive. If none survive, the effective list denies all
 *         packages/transports (true intersection).
 *   - `allowedTransports`: same as allowedPackages.
 *   - `denyActions`: union (both the server and profile denies apply).
 */
export function deriveUserSafetyFromProfile(
  serverConfig: SafetyConfig,
  profileSafety: Partial<SafetyConfig>,
): SafetyConfig {
  const and = (a: boolean, b: boolean | undefined): boolean => (b === undefined ? a : a && b);

  const intersectList = (server: string[], profile: string[] | undefined): string[] => {
    if (!profile) return [...server];
    if (server.length === 0 && profile.length === 0) return [];
    if (server.length === 0) return [...profile];
    if (profile.length === 0) return [...server];
    // Profile narrows server: keep profile entries that are covered by server.
    // "Covered by" means: there exists a server entry equal to the profile entry, or a
    // server wildcard that matches it.
    //
    // Subtree patterns ("ZFOO/**") need special handling — we cannot resolve the
    // DEVCLASS hierarchy at config-load time without a live SAP session, so the
    // static "covers" decision is intentionally conservative:
    //   - server "ZFOO/**" covers profile "ZFOO"          (root is statically known)
    //   - server "ZFOO/**" covers profile "ZFOO/**"       (identical — handled by s===p)
    //   - server "ZFOO/**" covers profile "ZSUB"          → NO (descendant cannot be
    //                                                      statically proven)
    //   - server "Z*"      covers profile "ZFOO/**"       → NO (server prefix may not
    //                                                      reach non-Z descendants of ZFOO;
    //                                                      profile's intended scope would
    //                                                      leak past the server ceiling)
    //   - server "*"       covers anything (already true via s.endsWith('*') logic below)
    //
    // The runtime check (checkPackage) re-validates against the resolved hierarchy
    // for any entry that survives intersection, so this layer is purely structural.
    const covers = (serverPat: string, profilePat: string): boolean => {
      const s = serverPat.toUpperCase();
      const p = profilePat.toUpperCase();
      if (s === p) return true;
      // Server unrestricted wildcard '*' covers everything.
      if (s === '*') return true;
      // Profile subtree narrows to an unknown-at-config-time set. Only covered by
      // identical server subtree (handled above) or '*' (handled above) — never by a
      // server prefix wildcard, because the subtree may contain names that don't
      // share the prefix.
      if (p.endsWith(SUBTREE_SUFFIX)) return false;
      // Server subtree: only the literal root is statically proven covered.
      if (s.endsWith(SUBTREE_SUFFIX)) {
        const serverRoot = s.slice(0, -SUBTREE_SUFFIX.length);
        return p === serverRoot;
      }
      // Server prefix wildcard.
      if (s.endsWith('*')) {
        const serverPrefix = s.slice(0, -1);
        if (p.endsWith('*')) {
          // Profile prefix is narrower than server prefix iff profile's literal prefix
          // starts with the server's. E.g. server "Z*" covers profile "ZF*".
          const profilePrefix = p.slice(0, -1);
          return profilePrefix.startsWith(serverPrefix);
        }
        // Profile is exact: "ZF" is covered by "Z*".
        return p.startsWith(serverPrefix);
      }
      return false;
    };
    const narrowed = profile.filter((p) => server.some((s) => covers(s, p)));
    // True intersection: disjoint constraints mean no package/transport is allowed.
    // We cannot return [] here because [] means "unrestricted" in SafetyConfig.
    return narrowed.length > 0 ? narrowed : [DENY_ALL_LIST_ENTRY];
  };

  const effective: SafetyConfig = {
    allowWrites: and(serverConfig.allowWrites, profileSafety.allowWrites),
    allowDataPreview: and(serverConfig.allowDataPreview, profileSafety.allowDataPreview),
    allowFreeSQL: and(serverConfig.allowFreeSQL, profileSafety.allowFreeSQL),
    allowTransportWrites: and(serverConfig.allowTransportWrites, profileSafety.allowTransportWrites),
    allowGitWrites: and(serverConfig.allowGitWrites, profileSafety.allowGitWrites),
    allowedPackages: intersectList(serverConfig.allowedPackages, profileSafety.allowedPackages),
    allowedTransports: intersectList(serverConfig.allowedTransports, profileSafety.allowedTransports),
    denyActions: [...new Set([...serverConfig.denyActions, ...(profileSafety.denyActions ?? [])])],
  };

  return effective;
}

/** Human-readable description of the safety configuration. */
export function describeSafety(config: SafetyConfig): string {
  const parts: string[] = [];

  if (config.allowWrites) parts.push('WRITES');
  if (config.allowDataPreview) parts.push('DATA-PREVIEW');
  if (config.allowFreeSQL) parts.push('FREE-SQL');
  if (config.allowTransportWrites) parts.push('TRANSPORT-WRITES');
  if (config.allowGitWrites) parts.push('GIT-WRITES');
  if (config.allowedPackages.length > 0) parts.push(`Packages=${displayAllowList(config.allowedPackages)}`);
  if (config.allowedTransports.length > 0) parts.push(`Transports=${displayAllowList(config.allowedTransports)}`);
  if (config.denyActions.length > 0) parts.push(`DenyActions=${config.denyActions.length}`);
  return parts.length === 0 ? 'READ-ONLY' : parts.join(', ');
}
