/** Complete, caller-sensitive catalog for the explicitly opted-in authorization mode. */
import type { ToolResult } from '../handlers/shared.js';
import { textResult, toolJson } from '../handlers/shared.js';
import type { DestinationRegistry, TargetDescriptor } from './destination-registry.js';
import { compareCatalogStrings, projectEnforcedDiagnostic } from './multi-target-catalog-projection.js';

export const TARGET_CATALOG_MAX_RESULT_BYTES = 512 * 1024;

export interface TargetCatalogEnforcement {
  readonly allowsTarget: (target: string) => boolean;
  readonly authorization: Readonly<{
    mode: 'xsuaa-attribute';
    grantMode: 'none' | 'exact' | 'all';
    status: 'valid' | 'TARGET_GRANT_MISSING' | 'TARGET_GRANT_MALFORMED' | 'TARGET_GRANT_LIMIT_EXCEEDED';
    exactGrantCount?: number;
  }>;
}

export interface EnforcedCatalogOptions {
  admin: boolean;
  query?: string;
  enforcement: TargetCatalogEnforcement;
  runtimeAuth?: (target: string) => { status: string; checkedAt?: string };
}

const SHARED_AUTH_STATES = new Set([
  'not_checked',
  'checking',
  'healthy',
  'configuration_invalid',
  'authentication_failed',
  'authorization_failed',
  'temporarily_unavailable',
]);
const NORMAL_SHARED_AUTH_STATES = new Set(['not_checked', 'checking', 'healthy']);
const CHECKED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function matchesTarget(target: TargetDescriptor, query: string): boolean {
  return !query || target.target.toLowerCase().includes(query) || target.description.toLowerCase().includes(query);
}

function authorizationView(enforcement: TargetCatalogEnforcement): Record<string, unknown> {
  const value = enforcement.authorization;
  return {
    mode: 'xsuaa-attribute',
    grantMode: value.grantMode,
    status: value.status,
    ...(value.grantMode === 'exact' ? { exactGrantCount: value.exactGrantCount } : {}),
  };
}

function failureView(
  registry: DestinationRegistry,
  enforcement: TargetCatalogEnforcement,
  failure = registry.failure,
): Record<string, unknown> {
  return {
    targets: [],
    admin: {
      state: 'error',
      source: 'btp-subaccount',
      loadedAt: registry.loadedAt,
      revision: registry.revision,
      authorization: authorizationView(enforcement),
      countsComplete: registry.countsComplete,
      ...(registry.countsComplete ? { counts: registry.counts } : {}),
      ...(registry.arcRelatedAtLeast === undefined ? {} : { arcRelatedAtLeast: registry.arcRelatedAtLeast }),
      failure,
      destinations: [],
    },
  };
}

export function buildEnforcedTargetCatalog(registry: DestinationRegistry, options: EnforcedCatalogOptions): unknown {
  if (registry.failure) return options.admin ? failureView(registry, options.enforcement) : [];
  const query = options.query?.trim().toLowerCase() ?? '';
  const targets = registry.targets
    .filter((target) => matchesTarget(target, query))
    .sort((a, b) => compareCatalogStrings(a.target, b.target));
  const publicTargets = targets
    .filter((target) => options.admin || options.enforcement.allowsTarget(target.target))
    .map((target) => ({
      target: target.target,
      description: target.description,
      identity: target.identity,
      ...(options.admin ? { granted: options.enforcement.allowsTarget(target.target) } : {}),
    }));
  if (!options.admin) return publicTargets;

  const shared = registry.targets.filter((target) => target.identity === 'shared');
  const statusCounts: Record<string, number> = {};
  const exceptions: Array<{ target: string; status: string; checkedAt?: string }> = [];
  for (const target of shared) {
    const state = options.runtimeAuth?.(target.target) ?? { status: 'not_checked' };
    const status = SHARED_AUTH_STATES.has(state.status) ? state.status : 'temporarily_unavailable';
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    if (!NORMAL_SHARED_AUTH_STATES.has(status) && matchesTarget(target, query)) {
      const checkedAt = state.checkedAt && CHECKED_AT.test(state.checkedAt) ? state.checkedAt : undefined;
      exceptions.push({ target: target.target, status, ...(checkedAt ? { checkedAt } : {}) });
    }
  }
  exceptions.sort((a, b) => compareCatalogStrings(a.target, b.target));
  const destinations = registry.diagnostics
    .map(projectEnforcedDiagnostic)
    .map((entry) => ({ ...entry, destinationName: entry.destinationName || undefined }))
    .filter(
      (entry) =>
        !query ||
        [entry.destinationName, entry.target, entry.description, entry.status, entry.code, entry.message].some(
          (value) => value?.toLowerCase().includes(query),
        ),
    )
    .sort((a, b) =>
      compareCatalogStrings(
        `${a.destinationName ?? ''}\0${a.target ?? ''}\0${a.code}`,
        `${b.destinationName ?? ''}\0${b.target ?? ''}\0${b.code}`,
      ),
    );
  return {
    targets: publicTargets,
    admin: {
      state: registry.counts.quarantined ? 'degraded' : 'ready',
      source: 'btp-subaccount',
      loadedAt: registry.loadedAt,
      revision: registry.revision,
      counts: registry.counts,
      countsComplete: true,
      authorization: authorizationView(options.enforcement),
      ...(shared.length
        ? {
            sharedAuthentication: {
              targets: shared.length,
              statusCounts,
              ...(exceptions.length ? { exceptions } : {}),
            },
          }
        : {}),
      destinations,
    },
  };
}

export function catalogResultWithinBudget(result: ToolResult): boolean {
  return Buffer.byteLength(JSON.stringify(result), 'utf8') <= TARGET_CATALOG_MAX_RESULT_BYTES;
}

/** The budget covers the entire wire wrapper, including escaped JSON text. */
export function buildEnforcedTargetCatalogResult(
  registry: DestinationRegistry,
  options: EnforcedCatalogOptions,
): ToolResult {
  const result = textResult(toolJson(buildEnforcedTargetCatalog(registry, options)));
  if (registry.failure) result.isError = true;
  if (catalogResultWithinBudget(result)) return result;
  return {
    ...textResult(
      toolJson(
        options.admin
          ? failureView(registry, options.enforcement, {
              code: 'CATALOG_SIZE_LIMIT_EXCEEDED',
              message: 'Complete target catalog exceeds its size limit; no partial inventory is returned.',
            })
          : { error: 'CATALOG_SIZE_LIMIT_EXCEEDED', message: 'Target catalog exceeds its size limit.' },
      ),
    ),
    isError: true,
  };
}

/** Reserve the complete operator view and maximum bounded passive-health fields at startup. */
export function enforcedCatalogFitsSnapshot(registry: DestinationRegistry): boolean {
  const payload = buildEnforcedTargetCatalog(registry, {
    admin: true,
    enforcement: {
      allowsTarget: () => false,
      authorization: {
        mode: 'xsuaa-attribute',
        grantMode: 'exact',
        status: 'valid',
        exactGrantCount: 256,
      },
    },
    runtimeAuth: () => ({ status: 'temporarily_unavailable', checkedAt: '9999-12-31T23:59:59.999Z' }),
  });
  // Mixed passive-state counts and the longest grant-error status add small metadata differences.
  // Reserve these before accepting a snapshot; the final serialized-result guard remains authoritative.
  return (
    Buffer.byteLength(JSON.stringify(textResult(toolJson(payload))), 'utf8') + 1024 <= TARGET_CATALOG_MAX_RESULT_BYTES
  );
}
