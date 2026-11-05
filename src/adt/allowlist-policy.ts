/** Pure allowlist checks: no dependency on runtime safety or transport implementations. */
import { AdtSafetyError } from './errors.js';
import type { SafetyConfig } from './safety.js';
export const DENY_ALL_LIST_ENTRY = '__ARC1_DENY_ALL__';
export function listDeniesAll(list: readonly string[]): boolean {
  return list.includes(DENY_ALL_LIST_ENTRY);
}

export function isTransportInWhitelist(config: Pick<SafetyConfig, 'allowedTransports'>, transport: string): boolean {
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

export function checkPinnedRequest(safety: SafetyConfig, request: string): void {
  if (
    !safety.multiTargetWrite?.enabled ||
    !safety.multiTargetWrite.allowedTransports.length ||
    !isTransportInWhitelist({ allowedTransports: [...safety.multiTargetWrite.allowedTransports] }, request) ||
    !isTransportInWhitelist({ allowedTransports: [...safety.multiTargetWrite.serverAllowedTransports] }, request)
  ) {
    throw new AdtSafetyError('CTS request is not allowed by both server and destination transport policies.');
  }
}

/** Explicit '*' on BOTH policies; legacy empty-global semantics are not this private opt-in. */
export function hasExplicitUnrestrictedRequestPolicy(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.includes('*') &&
    !value.includes(DENY_ALL_LIST_ENTRY) &&
    // Check every entry, including sparse slots; a wildcard cannot conceal malformed policy.
    Array.from(value).every((entry) => typeof entry === 'string' && /^(?:\*|[A-Z0-9]{1,20}\*?)$/.test(entry))
  );
}

/** Native-owned generated children have no independent package reader in this private profile. */
export function hasExplicitUnrestrictedPackagePolicy(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.includes('*') &&
    !value.includes(DENY_ALL_LIST_ENTRY) &&
    Array.from(value).every(
      (entry) => typeof entry === 'string' && /^(?:\*|(?:\/[A-Z0-9_]+\/)?[A-Z$][A-Z0-9_$]*(?:\*|\/\*\*)?)$/.test(entry),
    )
  );
}
