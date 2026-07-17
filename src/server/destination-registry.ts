/** Immutable validation registry for destination-discovered multi-target mode. */

import { createHash } from 'node:crypto';
import type { SafetyConfig } from '../adt/safety.js';
import type { DestinationDiscoveryResult, DiscoveredDestination } from './destination-discovery.js';
import type { ServerConfig } from './types.js';

export const TARGET_ID_PATTERN = /^[A-Z][A-Z0-9]{2}\/[0-9]{3}$/;
export const SAP_SYSID_PATTERN = /^[A-Z][A-Z0-9]{2}$/;
export const MULTI_TARGET_MAX = 256;

const ALLOWED_ARC_PROPERTIES = new Set(['arc1.enabled', 'arc1.allow_data_preview', 'arc1.allow_free_sql']);
const WRITE_PROPERTIES = new Set([
  'arc1.allow_writes',
  'arc1.allowed_packages',
  'arc1.allow_transport_writes',
  'arc1.allow_git_writes',
]);

export type TargetExclusionCode =
  | 'ACTIVE'
  | 'ARC1_ENABLED_MISSING'
  | 'ARC1_DISABLED'
  | 'ARC1_ENABLED_INVALID'
  | 'MISSING_NAME'
  | 'INVALID_NAME'
  | 'MISSING_URL'
  | 'INVALID_URL'
  | 'MISSING_SYSID'
  | 'INVALID_SYSID'
  | 'MISSING_CLIENT'
  | 'INVALID_CLIENT'
  | 'UNSUPPORTED_TYPE'
  | 'UNSUPPORTED_PROXY'
  | 'UNSUPPORTED_AUTH'
  | 'MISSING_DESCRIPTION'
  | 'INVALID_LANGUAGE'
  | 'UNKNOWN_ARC1_PROPERTY'
  | 'INVALID_POLICY'
  | 'UNSUPPORTED_V1_WRITE_CONFIG'
  | 'DUPLICATE_DESTINATION_NAME'
  | 'DUPLICATE_TARGET'
  | 'SHADOWED_BY_INSTANCE'
  | 'TARGET_LIMIT_EXCEEDED'
  | 'LIMITED_BY_INSTANCE';

export interface TargetPolicy {
  readonly allowDataPreview: boolean;
  readonly allowFreeSQL: boolean;
}

export interface TargetDescriptor {
  readonly target: string;
  readonly sid: string;
  readonly client: string;
  readonly description: string;
  readonly language: string;
  readonly destinationName: string;
  readonly authentication: 'PrincipalPropagation';
  readonly proxyType: 'OnPremise';
  readonly hasCloudConnectorLocationId: boolean;
  readonly requestedPolicy: TargetPolicy;
  readonly effectivePolicy: TargetPolicy;
  readonly connectionFingerprint: string;
  readonly fingerprint: string;
}

export interface TargetDiagnostic {
  readonly destinationName: string;
  readonly target?: string;
  readonly status: 'active' | 'disabled' | 'ignored' | 'quarantined';
  readonly code: TargetExclusionCode;
  readonly message: string;
  readonly description?: string;
  readonly type?: string;
  readonly authentication?: string;
  readonly proxyType?: string;
  readonly sid?: string;
  readonly client?: string;
  readonly language?: string;
  readonly hasCloudConnectorLocationId: boolean;
  readonly requestedPolicy?: TargetPolicy;
  readonly effectivePolicy?: TargetPolicy;
  readonly limitedByInstance?: boolean;
  readonly warnings: readonly TargetExclusionCode[];
  /** Canonical supported ARC-1 settings only. Unknown property values are never retained. */
  readonly arcConfig: Readonly<{
    enabled?: boolean;
    allowDataPreview?: boolean;
    allowFreeSQL?: boolean;
    unknownProperties?: readonly string[];
  }>;
}

export interface RegistryFailure {
  readonly code: 'TARGET_LIMIT_EXCEEDED' | 'REGISTRY_DISCOVERY_ERROR';
  readonly message: string;
}

export interface RegistryCounts {
  readonly scanned: number;
  readonly unrelated: number;
  readonly arcAdjacent: number;
  readonly arcRelated: number;
  readonly enabled: number;
  readonly active: number;
  readonly disabled: number;
  readonly ignored: number;
  readonly quarantined: number;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return undefined;
}

export function sanitizeTargetDescription(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const withoutControls = Array.from(value.normalize('NFKC'), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) ? ' ' : character;
  }).join('');
  const normalized = withoutControls.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 && normalized.length <= 160 ? normalized : fallback;
}

interface FingerprintInput extends Omit<TargetDescriptor, 'fingerprint' | 'connectionFingerprint'> {
  readonly urlFingerprint: string;
  readonly cloudConnectorLocationIdFingerprint?: string;
}

export function targetConnectionFingerprint(value: {
  urlFingerprint: string;
  client: string;
  cloudConnectorLocationIdFingerprint?: string;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        urlFingerprint: value.urlFingerprint,
        client: value.client,
        cloudConnectorLocationIdFingerprint: value.cloudConnectorLocationIdFingerprint ?? '',
      }),
    )
    .digest('hex');
}

export function targetFingerprint(value: FingerprintInput): string {
  const canonical = JSON.stringify({
    destinationName: value.destinationName,
    description: value.description,
    urlFingerprint: value.urlFingerprint,
    authentication: value.authentication,
    proxyType: value.proxyType,
    client: value.client,
    cloudConnectorLocationIdFingerprint: value.cloudConnectorLocationIdFingerprint ?? '',
    sid: value.sid,
    language: value.language,
    allowDataPreview: value.requestedPolicy.allowDataPreview,
    allowFreeSQL: value.requestedPolicy.allowFreeSQL,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function immutableArcConfig(properties: Readonly<Record<string, string>>): TargetDiagnostic['arcConfig'] {
  const unknownProperties = Object.keys(properties)
    .filter((key) => !ALLOWED_ARC_PROPERTIES.has(key))
    .sort();
  return Object.freeze({
    enabled: parseBoolean(properties['arc1.enabled']),
    allowDataPreview: parseBoolean(properties['arc1.allow_data_preview']),
    allowFreeSQL: parseBoolean(properties['arc1.allow_free_sql']),
    ...(unknownProperties.length > 0 ? { unknownProperties: Object.freeze(unknownProperties) } : {}),
  });
}

interface CandidateEvaluation {
  readonly source: DiscoveredDestination;
  readonly diagnostic: TargetDiagnostic;
  readonly target?: TargetDescriptor;
  readonly enabled: boolean;
}

function evaluate(source: DiscoveredDestination, base: ServerConfig): CandidateEvaluation {
  const arcConfig = immutableArcConfig(source.arcProperties);
  const diagnosticBase = {
    destinationName: source.name,
    type: source.type,
    authentication: source.authentication,
    proxyType: source.proxyType,
    hasCloudConnectorLocationId: source.hasCloudConnectorLocationId,
    arcConfig,
    warnings: Object.freeze([]),
  } as const;

  const enabledRaw = source.arcProperties['arc1.enabled'];
  const enabled = parseBoolean(enabledRaw);
  if (enabledRaw === undefined) {
    return {
      source,
      enabled: false,
      diagnostic: {
        ...diagnosticBase,
        status: 'ignored',
        code: 'ARC1_ENABLED_MISSING',
        message: 'ARC-1 marker arc1.enabled is missing.',
      },
    };
  }
  if (enabled === undefined) {
    return {
      source,
      enabled: false,
      diagnostic: {
        ...diagnosticBase,
        status: 'quarantined',
        code: 'ARC1_ENABLED_INVALID',
        message: 'arc1.enabled must be true or false.',
      },
    };
  }
  if (!enabled) {
    return {
      source,
      enabled: false,
      diagnostic: {
        ...diagnosticBase,
        status: 'disabled',
        code: 'ARC1_DISABLED',
        message: 'ARC-1 target is explicitly disabled.',
      },
    };
  }

  for (const key of Object.keys(source.arcProperties)) {
    if (WRITE_PROPERTIES.has(key)) {
      return {
        source,
        enabled: true,
        diagnostic: {
          ...diagnosticBase,
          status: 'quarantined',
          code: 'UNSUPPORTED_V1_WRITE_CONFIG',
          message: 'Write-related destination configuration is not supported in multi-target v1.',
        },
      };
    }
    if (!ALLOWED_ARC_PROPERTIES.has(key)) {
      return {
        source,
        enabled: true,
        diagnostic: {
          ...diagnosticBase,
          status: 'quarantined',
          code: 'UNKNOWN_ARC1_PROPERTY',
          message: `Unsupported ARC-1 destination property: ${key}`,
        },
      };
    }
  }

  const dataRequested = parseBoolean(source.arcProperties['arc1.allow_data_preview']);
  const sqlRequested = parseBoolean(source.arcProperties['arc1.allow_free_sql']);
  if (
    (source.arcProperties['arc1.allow_data_preview'] !== undefined && dataRequested === undefined) ||
    (source.arcProperties['arc1.allow_free_sql'] !== undefined && sqlRequested === undefined)
  ) {
    return {
      source,
      enabled: true,
      diagnostic: {
        ...diagnosticBase,
        status: 'quarantined',
        code: 'INVALID_POLICY',
        message: 'ARC-1 data and SQL policy values must be true or false.',
      },
    };
  }
  if (!source.name) {
    return {
      source,
      enabled: true,
      diagnostic: {
        ...diagnosticBase,
        status: 'quarantined',
        code: 'MISSING_NAME',
        message: 'Destination name is required.',
      },
    };
  }
  if (!/^[A-Za-z0-9_.-]{1,200}$/.test(source.name)) {
    return {
      source,
      enabled: true,
      diagnostic: {
        ...diagnosticBase,
        status: 'quarantined',
        code: 'INVALID_NAME',
        message: 'Destination name contains unsupported characters or is too long.',
      },
    };
  }
  if (source.type !== 'HTTP') {
    return {
      source,
      enabled: true,
      diagnostic: {
        ...diagnosticBase,
        status: 'quarantined',
        code: 'UNSUPPORTED_TYPE',
        message: 'Destination Type must be HTTP.',
      },
    };
  }
  if (source.urlState === 'missing') {
    return {
      source,
      enabled: true,
      diagnostic: {
        ...diagnosticBase,
        status: 'quarantined',
        code: 'MISSING_URL',
        message: 'Destination URL is required.',
      },
    };
  }
  if (source.urlState !== 'valid' || !source.urlFingerprint) {
    return {
      source,
      enabled: true,
      diagnostic: {
        ...diagnosticBase,
        status: 'quarantined',
        code: 'INVALID_URL',
        message: 'Destination URL must be a valid HTTP or HTTPS URL.',
      },
    };
  }
  if (source.authentication !== 'PrincipalPropagation') {
    return {
      source,
      enabled: true,
      diagnostic: {
        ...diagnosticBase,
        status: 'quarantined',
        code: 'UNSUPPORTED_AUTH',
        message: 'Destination Authentication must be PrincipalPropagation.',
      },
    };
  }
  if (source.proxyType !== 'OnPremise') {
    return {
      source,
      enabled: true,
      diagnostic: {
        ...diagnosticBase,
        status: 'quarantined',
        code: 'UNSUPPORTED_PROXY',
        message: 'Destination ProxyType must be OnPremise.',
      },
    };
  }
  if (!source.sapSysId) {
    return {
      source,
      enabled: true,
      diagnostic: {
        ...diagnosticBase,
        status: 'quarantined',
        code: 'MISSING_SYSID',
        message: 'Destination property sap-sysid is required.',
      },
    };
  }
  if (!SAP_SYSID_PATTERN.test(source.sapSysId)) {
    return {
      source,
      enabled: true,
      diagnostic: {
        ...diagnosticBase,
        status: 'quarantined',
        code: 'INVALID_SYSID',
        message: 'sap-sysid must match three uppercase alphanumeric characters and start with a letter.',
      },
    };
  }
  if (!source.sapClient) {
    return {
      source,
      enabled: true,
      diagnostic: {
        ...diagnosticBase,
        status: 'quarantined',
        code: 'MISSING_CLIENT',
        message: 'Destination property sap-client is required.',
      },
    };
  }
  if (!/^\d{3}$/.test(source.sapClient)) {
    return {
      source,
      enabled: true,
      diagnostic: {
        ...diagnosticBase,
        status: 'quarantined',
        code: 'INVALID_CLIENT',
        message: 'sap-client must contain exactly three digits.',
      },
    };
  }
  const language = source.sapLanguage?.trim().toUpperCase() || base.language;
  if (!/^[A-Z]{2}$/.test(language)) {
    return {
      source,
      enabled: true,
      diagnostic: {
        ...diagnosticBase,
        status: 'quarantined',
        code: 'INVALID_LANGUAGE',
        message: 'sap-language must contain exactly two letters.',
      },
    };
  }

  const targetId = `${source.sapSysId}/${source.sapClient}`;
  const description = sanitizeTargetDescription(source.description, targetId);
  const descriptionFallback = description === targetId && source.description !== targetId;
  const requestedPolicy = Object.freeze({
    allowDataPreview: dataRequested ?? false,
    allowFreeSQL: sqlRequested ?? false,
  });
  const effectivePolicy = Object.freeze({
    allowDataPreview: base.allowDataPreview && requestedPolicy.allowDataPreview,
    allowFreeSQL: base.allowFreeSQL && requestedPolicy.allowFreeSQL,
  });
  const withoutFingerprints: Omit<TargetDescriptor, 'fingerprint' | 'connectionFingerprint'> = {
    target: targetId,
    sid: source.sapSysId,
    client: source.sapClient,
    description,
    language,
    destinationName: source.name,
    authentication: 'PrincipalPropagation',
    proxyType: 'OnPremise',
    hasCloudConnectorLocationId: source.hasCloudConnectorLocationId,
    requestedPolicy,
    effectivePolicy,
  };
  const connectionFingerprint = targetConnectionFingerprint({
    urlFingerprint: source.urlFingerprint,
    client: source.sapClient,
    cloudConnectorLocationIdFingerprint: source.cloudConnectorLocationIdFingerprint,
  });
  const target = Object.freeze({
    ...withoutFingerprints,
    connectionFingerprint,
    fingerprint: targetFingerprint({
      ...withoutFingerprints,
      urlFingerprint: source.urlFingerprint,
      cloudConnectorLocationIdFingerprint: source.cloudConnectorLocationIdFingerprint,
    }),
  });
  return {
    source,
    enabled: true,
    target,
    diagnostic: {
      ...diagnosticBase,
      target: targetId,
      description,
      sid: source.sapSysId,
      client: source.sapClient,
      language,
      status: 'active',
      code: 'ACTIVE',
      message: 'Destination is active on pinned and aggregate multi-target routes.',
      requestedPolicy,
      effectivePolicy,
      limitedByInstance:
        requestedPolicy.allowDataPreview !== effectivePolicy.allowDataPreview ||
        requestedPolicy.allowFreeSQL !== effectivePolicy.allowFreeSQL,
      warnings: Object.freeze(descriptionFallback ? ['MISSING_DESCRIPTION'] : []),
    },
  };
}

function registryRevision(diagnostics: readonly TargetDiagnostic[], targets: readonly TargetDescriptor[] = []): string {
  const targetFingerprints = new Map(targets.map((target) => [target.destinationName, target.fingerprint]));
  const canonical = diagnostics
    .map((entry) => ({
      destinationName: entry.destinationName,
      target: entry.target ?? '',
      status: entry.status,
      code: entry.code ?? '',
      message: entry.message,
      description: entry.description ?? '',
      type: entry.type ?? '',
      authentication: entry.authentication ?? '',
      proxyType: entry.proxyType ?? '',
      hasCloudConnectorLocationId: entry.hasCloudConnectorLocationId,
      arcConfig: entry.arcConfig,
      requestedPolicy: entry.requestedPolicy,
      effectivePolicy: entry.effectivePolicy,
      warnings: entry.warnings,
      targetFingerprint: targetFingerprints.get(entry.destinationName) ?? '',
    }))
    .sort((a, b) => a.destinationName.localeCompare(b.destinationName));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function conflictMessage(code: TargetExclusionCode): string {
  switch (code) {
    case 'DUPLICATE_DESTINATION_NAME':
      return 'More than one subaccount destination uses this destination name; every claimant is quarantined.';
    case 'DUPLICATE_TARGET':
      return 'More than one destination claims this SID/client target; every claimant is quarantined.';
    case 'SHADOWED_BY_INSTANCE':
      return 'A service-instance destination has the same name and could shadow this subaccount destination.';
    default:
      return 'Destination configuration conflict.';
  }
}

function countsFor(
  discovery: DestinationDiscoveryResult,
  diagnostics: readonly TargetDiagnostic[],
  enabled: number,
  active: number,
): RegistryCounts {
  return {
    scanned: discovery.scannedCount,
    unrelated: discovery.unrelatedCount,
    arcAdjacent: discovery.arcAdjacentWithoutMarkerCount,
    arcRelated: discovery.subaccount.length,
    enabled,
    active,
    disabled: diagnostics.filter((entry) => entry.status === 'disabled').length,
    ignored: diagnostics.filter((entry) => entry.status === 'ignored').length,
    quarantined: diagnostics.filter((entry) => entry.status === 'quarantined').length,
  };
}

export class DestinationRegistry {
  readonly targets: readonly TargetDescriptor[];
  readonly diagnostics: readonly TargetDiagnostic[];
  readonly revision: string;
  readonly failure?: RegistryFailure;
  readonly loadedAt: string;
  readonly counts: RegistryCounts;
  readonly arcAdjacentWithoutMarkerCount: number;
  private readonly byTarget: ReadonlyMap<string, TargetDescriptor>;

  private constructor(args: {
    targets: readonly TargetDescriptor[];
    diagnostics: readonly TargetDiagnostic[];
    revision: string;
    failure?: RegistryFailure;
    loadedAt?: string;
    counts: RegistryCounts;
    arcAdjacentWithoutMarkerCount: number;
  }) {
    this.targets = Object.freeze([...args.targets]);
    this.diagnostics = Object.freeze([...args.diagnostics]);
    this.revision = args.revision;
    this.failure = args.failure;
    this.loadedAt = args.loadedAt ?? new Date().toISOString();
    this.counts = Object.freeze({ ...args.counts });
    this.arcAdjacentWithoutMarkerCount = args.arcAdjacentWithoutMarkerCount;
    this.byTarget = new Map(this.targets.map((target) => [target.target, target]));
    Object.freeze(this);
  }

  static unavailable(failure: RegistryFailure): DestinationRegistry {
    return new DestinationRegistry({
      targets: [],
      diagnostics: [],
      revision: createHash('sha256').update(`${failure.code}:${failure.message}`).digest('hex'),
      failure: Object.freeze({ ...failure }),
      counts: {
        scanned: 0,
        unrelated: 0,
        arcAdjacent: 0,
        arcRelated: 0,
        enabled: 0,
        active: 0,
        disabled: 0,
        ignored: 0,
        quarantined: 0,
      },
      arcAdjacentWithoutMarkerCount: 0,
    });
  }

  static fromDiscovery(discovery: DestinationDiscoveryResult, base: ServerConfig): DestinationRegistry {
    const evaluated = discovery.subaccount.map((source) => evaluate(source, base));
    const enabledCount = evaluated.filter((entry) => entry.enabled).length;
    if (enabledCount > MULTI_TARGET_MAX) {
      const diagnostics = evaluated.map((entry) =>
        entry.enabled
          ? Object.freeze({
              ...entry.diagnostic,
              status: 'quarantined' as const,
              code: 'TARGET_LIMIT_EXCEEDED' as const,
              message: `Enabled target count exceeds the limit of ${MULTI_TARGET_MAX}; no discovered target is active.`,
            })
          : entry.diagnostic,
      );
      return new DestinationRegistry({
        targets: [],
        diagnostics,
        revision: registryRevision(diagnostics),
        failure: Object.freeze({
          code: 'TARGET_LIMIT_EXCEEDED',
          message: `${enabledCount} enabled multi-target destinations exceed the limit of ${MULTI_TARGET_MAX}.`,
        }),
        counts: countsFor(discovery, diagnostics, enabledCount, 0),
        arcAdjacentWithoutMarkerCount: discovery.arcAdjacentWithoutMarkerCount,
      });
    }

    const destinationCounts = new Map<string, number>();
    const targetCounts = new Map<string, number>();
    const instanceNames = new Set(discovery.instanceNames);
    for (const entry of evaluated) {
      destinationCounts.set(entry.source.name, (destinationCounts.get(entry.source.name) ?? 0) + 1);
      if (entry.target) targetCounts.set(entry.target.target, (targetCounts.get(entry.target.target) ?? 0) + 1);
    }

    const diagnostics: TargetDiagnostic[] = [];
    const targets: TargetDescriptor[] = [];
    for (const entry of evaluated) {
      let conflict: TargetExclusionCode | undefined;
      if ((destinationCounts.get(entry.source.name) ?? 0) > 1) conflict = 'DUPLICATE_DESTINATION_NAME';
      else if (instanceNames.has(entry.source.name)) conflict = 'SHADOWED_BY_INSTANCE';
      else if (entry.target && (targetCounts.get(entry.target.target) ?? 0) > 1) conflict = 'DUPLICATE_TARGET';

      if (conflict && entry.enabled) {
        diagnostics.push(
          Object.freeze({
            ...entry.diagnostic,
            status: 'quarantined',
            code: conflict,
            message: conflictMessage(conflict),
          }),
        );
      } else {
        diagnostics.push(Object.freeze(entry.diagnostic));
        if (entry.target && entry.diagnostic.status === 'active') targets.push(entry.target);
      }
    }
    targets.sort((a, b) => a.target.localeCompare(b.target));
    diagnostics.sort((a, b) => a.destinationName.localeCompare(b.destinationName));
    return new DestinationRegistry({
      targets,
      diagnostics,
      revision: registryRevision(diagnostics, targets),
      counts: countsFor(discovery, diagnostics, enabledCount, targets.length),
      arcAdjacentWithoutMarkerCount: discovery.arcAdjacentWithoutMarkerCount,
    });
  }

  get(target: string): TargetDescriptor | undefined {
    return this.byTarget.get(target);
  }

  get available(): boolean {
    return !this.failure;
  }
}

export function targetSafety(target: TargetDescriptor): SafetyConfig {
  return {
    allowWrites: false,
    allowDataPreview: target.effectivePolicy.allowDataPreview,
    allowFreeSQL: target.effectivePolicy.allowFreeSQL,
    allowTransportWrites: false,
    allowGitWrites: false,
    allowedPackages: ['$TMP'],
    allowedTransports: [],
    denyActions: ['SAPDiagnose.atc', 'SAPDiagnose.unittest'],
  };
}
