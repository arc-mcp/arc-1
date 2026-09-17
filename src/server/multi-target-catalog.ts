/** Secret-safe reader and administrator views for the SAPTargets MCP tool. */

import type { DestinationRegistry, TargetDescriptor, TargetDiagnostic } from './destination-registry.js';

export const TARGET_CATALOG_DIAGNOSTIC_LIMIT = 50;
export const TARGET_CATALOG_SHARED_AUTH_EXCEPTION_LIMIT = 8;
export const TARGET_CATALOG_MAX_OFFSET = 1_000_000;
export const TARGET_CATALOG_MAX_QUERY_LENGTH = 160;

function targetMatches(target: TargetDescriptor, query: string): boolean {
  return !query || target.target.toLowerCase().includes(query) || target.description.toLowerCase().includes(query);
}

function diagnosticMatches(entry: DestinationRegistry['diagnostics'][number], query: string): boolean {
  if (!query) return true;
  return [entry.destinationName, entry.target, entry.status, entry.code, entry.message, entry.description]
    .filter((value): value is string => typeof value === 'string')
    .some((value) => value.toLowerCase().includes(query));
}

export interface TargetCatalogOptions {
  admin: boolean;
  query?: string;
  offset?: number;
  /** Passive process-local health only; this callback must never probe SAP. */
  runtimeAuth?: (target: string) => { status: string; checkedAt?: string };
}

// `checking` is an ordinary in-flight canary, not an operator exception. Completed failures such
// as `temporarily_unavailable` deliberately remain exceptional and visible to administrators.
const NORMAL_SHARED_AUTH_STATES = new Set(['not_checked', 'checking', 'healthy']);

function incrementStatus(counts: Record<string, number>, status: string): void {
  counts[status] = (counts[status] ?? 0) + 1;
}

function safeDiagnostic(entry: TargetDiagnostic): Record<string, unknown> {
  return {
    destinationName: entry.destinationName,
    target: entry.target,
    status: entry.status,
    code: entry.code,
    message: entry.message,
    description: entry.description,
    type: entry.type,
    proxyType: entry.proxyType,
    sid: entry.sid,
    client: entry.client,
    language: entry.language,
    hasCloudConnectorLocationId: entry.hasCloudConnectorLocationId,
    arcConfig: entry.arcConfig,
    requestedPolicy: entry.requestedPolicy,
    effectivePolicy: entry.effectivePolicy,
    limitedByInstance: entry.limitedByInstance,
    warnings: entry.warnings,
  };
}

/**
 * Build the role-sensitive SAPTargets result.
 *
 * Readers retain the deliberately small `{target, description}[]` response. Admins additionally
 * receive registry state and diagnostics. To keep the default result practical at 100–256 targets,
 * the unfiltered admin view includes details only for non-active destinations; accepted targets in
 * the public list are active by definition. Supplying `query` includes matching active diagnostics,
 * and `offset` pages the deterministically sorted, bounded diagnostic result.
 * Destination URLs, credentials, tokens, certificates, and raw Cloud Connector location IDs are not
 * retained by DestinationRegistry and cannot enter this result.
 */
export function buildTargetCatalog(
  registry: DestinationRegistry,
  options: TargetCatalogOptions,
): Record<string, unknown> | Array<{ target: string; description: string; identity: TargetDescriptor['identity'] }> {
  const query = options.query?.trim().toLowerCase() ?? '';
  const targets = registry.targets.filter((target) => targetMatches(target, query));
  if (!options.admin) {
    return targets.map((target) => ({
      target: target.target,
      description: target.description,
      identity: target.identity,
    }));
  }

  const sharedAuthStatusCounts: Record<string, number> = {};
  const sharedAuthExceptions: Array<{ target: string; status: string; checkedAt?: string }> = [];
  let sharedAuthTargetCount = 0;
  const publicTargets = targets.map((target) => {
    const runtimeAuth =
      target.authentication === 'BasicAuthentication' && options.runtimeAuth
        ? options.runtimeAuth(target.target)
        : undefined;
    if (runtimeAuth) {
      sharedAuthTargetCount += 1;
      incrementStatus(sharedAuthStatusCounts, runtimeAuth.status);
      if (!NORMAL_SHARED_AUTH_STATES.has(runtimeAuth.status)) {
        sharedAuthExceptions.push({ target: target.target, ...runtimeAuth });
      }
    }
    return {
      target: target.target,
      description: target.description,
      identity: target.identity,
    };
  });
  const diagnosticOffset = options.offset ?? 0;
  const matchingDiagnostics = registry.diagnostics
    .filter((entry) => (query ? diagnosticMatches(entry, query) : entry.status !== 'active'))
    .sort((left, right) =>
      `${left.destinationName}\0${left.target ?? ''}\0${left.code}`.localeCompare(
        `${right.destinationName}\0${right.target ?? ''}\0${right.code}`,
      ),
    );
  const diagnostics = matchingDiagnostics
    .slice(diagnosticOffset, diagnosticOffset + TARGET_CATALOG_DIAGNOSTIC_LIMIT)
    .map(safeDiagnostic);
  const diagnosticNextOffset =
    diagnosticOffset + diagnostics.length < matchingDiagnostics.length
      ? diagnosticOffset + diagnostics.length
      : undefined;
  sharedAuthExceptions.sort((left, right) => String(left.target).localeCompare(String(right.target)));

  return {
    targets: publicTargets,
    admin: {
      state: registry.failure ? 'error' : registry.counts.quarantined > 0 ? 'degraded' : 'ready',
      source: 'btp-subaccount',
      loadedAt: registry.loadedAt,
      revision: registry.revision,
      counts: registry.counts,
      ...(sharedAuthTargetCount > 0
        ? {
            sharedAuthentication: {
              targets: sharedAuthTargetCount,
              statusCounts: sharedAuthStatusCounts,
              ...(sharedAuthExceptions.length > 0
                ? {
                    exceptionTotal: sharedAuthExceptions.length,
                    exceptionReturned: Math.min(
                      sharedAuthExceptions.length,
                      TARGET_CATALOG_SHARED_AUTH_EXCEPTION_LIMIT,
                    ),
                    exceptionsTruncated: sharedAuthExceptions.length > TARGET_CATALOG_SHARED_AUTH_EXCEPTION_LIMIT,
                    exceptions: sharedAuthExceptions.slice(0, TARGET_CATALOG_SHARED_AUTH_EXCEPTION_LIMIT),
                  }
                : {}),
            },
          }
        : {}),
      failure: registry.failure,
      diagnosticMode: query ? 'matching' : 'exceptions',
      diagnosticOffset,
      diagnosticTotal: matchingDiagnostics.length,
      diagnosticReturned: diagnostics.length,
      diagnosticsTruncated: diagnosticOffset > 0 || diagnosticNextOffset !== undefined,
      diagnosticNextOffset,
      destinations: diagnostics,
    },
  };
}
