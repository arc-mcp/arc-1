/**
 * Destination-property contract for multi-target v1.
 *
 * Keep this file deliberately small: discovery, startup validation, and runtime
 * drift checks must all agree on the exact same property names and value syntax.
 */

export const MULTI_TARGET_ARC_PROPERTIES = Object.freeze([
  'arc1.enabled',
  'arc1.allow_data_preview',
  'arc1.allow_free_sql',
  'arc1.target_alias',
]);

const SUPPORTED_ARC_PROPERTIES = new Set(MULTI_TARGET_ARC_PROPERTIES);
const WRITE_ARC_PROPERTIES = new Set([
  'arc1.allow_writes',
  'arc1.allowed_packages',
  'arc1.allow_transport_writes',
  'arc1.allow_git_writes',
]);

export function isSupportedMultiTargetArcProperty(key: string): boolean {
  return SUPPORTED_ARC_PROPERTIES.has(key);
}

export function isWriteRelatedArcProperty(key: string): boolean {
  return WRITE_ARC_PROPERTIES.has(key);
}

/** Parse the destination-service boolean format without inventing a default. */
export function parseDestinationBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return undefined;
}
