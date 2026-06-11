/**
 * Shared config + feature factories for the handler-surface tests
 * (tool-definitions-snapshot, schema-key-sync, registry-sync).
 *
 * One home for "what does an all-gates-on server look like" so a new gate flag or feature gate is
 * added in exactly one place. Divergent per-file copies are how a tool silently drops out of a
 * test's view (e.g. a parity test that then passes vacuously) without anyone noticing.
 */

import type { FeatureStatus, ResolvedFeatures } from '../../../src/adt/types.js';
import type { ServerConfig } from '../../../src/server/types.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

export function feat(id: string, available: boolean): FeatureStatus {
  // Deterministic: no probedAt timestamp, no message (keeps snapshots stable).
  return { id, available, mode: 'auto' };
}

/**
 * Keys of ResolvedFeatures whose value is a FeatureStatus — the toggleable backend features.
 * Excludes the metadata keys (abapRelease/systemType/textSearch/authProbe/discoveryMap) so an
 * override like `features({ textSearch: false })` is a compile error instead of being silently
 * dropped (those keys aren't mapped below).
 */
type FeatureKey = {
  // `-?` strips optionality before indexing: without it the optional metadata keys contribute
  // `undefined` to the union, which makes Record<FeatureKey, boolean> a TS2344 error. (tests/ are
  // outside tsconfig's typecheck today, so tsc wouldn't flag it in CI — but IDEs and any future
  // tests-covering typecheck would.)
  [K in keyof ResolvedFeatures]-?: ResolvedFeatures[K] extends FeatureStatus ? K : never;
}[keyof ResolvedFeatures];

/** A complete ResolvedFeatures with every feature available unless overridden. */
export function features(overrides: Partial<Record<FeatureKey, boolean>> = {}): ResolvedFeatures {
  const on = (k: FeatureKey) => (overrides[k] === undefined ? true : (overrides[k] as boolean));
  return {
    hana: feat('hana', on('hana')),
    abapGit: feat('abapGit', on('abapGit')),
    gcts: feat('gcts', on('gcts')),
    rap: feat('rap', on('rap')),
    amdp: feat('amdp', on('amdp')),
    ui5: feat('ui5', on('ui5')),
    transport: feat('transport', on('transport')),
    ui5repo: feat('ui5repo', on('ui5repo')),
    flp: feat('flp', on('flp')),
  };
}

export const onprem = (o: Partial<ServerConfig> = {}): ServerConfig => ({
  ...DEFAULT_CONFIG,
  systemType: 'onprem',
  ...o,
});
export const btp = (o: Partial<ServerConfig> = {}): ServerConfig => ({ ...DEFAULT_CONFIG, systemType: 'btp', ...o });

/** Maximal write/data surface — registers SAPWrite, SAPTransport, SAPGit, SAPQuery, SAPManage. */
export const FULL: Partial<ServerConfig> = {
  allowWrites: true,
  allowTransportWrites: true,
  allowGitWrites: true,
  allowDataPreview: true,
  allowFreeSQL: true,
};

/** onprem/btp config with every gate flag on — every tool registered. */
export const fullConfig = (isBtp: boolean): ServerConfig => (isBtp ? btp(FULL) : onprem(FULL));
