/** Bounded display-only projection. Never use these fields for connection validation or drift. */
import type { TargetDiagnostic } from './destination-registry.js';
import { SAP_SYSID_PATTERN, TARGET_ID_PATTERN, TARGET_SYSTEM_ALIAS_PATTERN } from './multi-target-identity.js';

const SAFE_NAME = /^[A-Za-z0-9_.-]{1,200}$/;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

export function boundedCatalogText(value: string | undefined, maximum: number): string | undefined {
  if (typeof value !== 'string' || value.length > maximum * 4) return undefined;
  const normalized = value
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized && normalized.length <= maximum ? normalized : undefined;
}

export function projectEnforcedDiagnostic(entry: TargetDiagnostic): TargetDiagnostic {
  const unknownPropertyCount = Math.max(
    entry.arcConfig.unknownPropertyCount ?? 0,
    entry.arcConfig.unknownProperties?.length ?? 0,
  );
  const arcConfig = Object.freeze({
    ...(typeof entry.arcConfig.enabled === 'boolean' ? { enabled: entry.arcConfig.enabled } : {}),
    ...(typeof entry.arcConfig.allowDataPreview === 'boolean'
      ? { allowDataPreview: entry.arcConfig.allowDataPreview }
      : {}),
    ...(typeof entry.arcConfig.allowFreeSQL === 'boolean' ? { allowFreeSQL: entry.arcConfig.allowFreeSQL } : {}),
    ...(TARGET_SYSTEM_ALIAS_PATTERN.test(entry.arcConfig.targetAlias ?? '')
      ? { targetAlias: entry.arcConfig.targetAlias }
      : {}),
    ...(unknownPropertyCount ? { unknownPropertyCount } : {}),
  });
  return Object.freeze({
    destinationName: SAFE_NAME.test(entry.destinationName) ? entry.destinationName : '',
    ...(TARGET_ID_PATTERN.test(entry.target ?? '') ? { target: entry.target } : {}),
    status: entry.status,
    code: entry.code,
    message:
      entry.code === 'UNKNOWN_ARC1_PROPERTY'
        ? 'Unsupported ARC-1 destination properties; inspect the configuration in BTP Cockpit.'
        : (boundedCatalogText(entry.message, 256) ?? 'Destination configuration requires administrator review.'),
    ...(boundedCatalogText(entry.description, 160) ? { description: boundedCatalogText(entry.description, 160) } : {}),
    ...(entry.type === 'HTTP' ? { type: entry.type } : {}),
    ...(entry.authentication === 'PrincipalPropagation' || entry.authentication === 'BasicAuthentication'
      ? { authentication: entry.authentication }
      : {}),
    ...(entry.proxyType === 'OnPremise' ? { proxyType: entry.proxyType } : {}),
    ...(SAP_SYSID_PATTERN.test(entry.sid ?? '') ? { sid: entry.sid } : {}),
    ...(/^\d{3}$/.test(entry.client ?? '') ? { client: entry.client } : {}),
    ...(/^[A-Z]{2}$/.test(entry.language ?? '') ? { language: entry.language } : {}),
    hasCloudConnectorLocationId: entry.hasCloudConnectorLocationId === true,
    ...(entry.requestedPolicy ? { requestedPolicy: entry.requestedPolicy } : {}),
    ...(entry.effectivePolicy ? { effectivePolicy: entry.effectivePolicy } : {}),
    ...(entry.limitedByInstance ? { limitedByInstance: true } : {}),
    arcConfig,
    warnings: Object.freeze([...new Set(entry.warnings.filter((code) => SAFE_CODE.test(code)))].sort().slice(0, 16)),
  });
}

/** Code-unit order is independent of operating-system locale and ICU version. */
export function compareCatalogStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
