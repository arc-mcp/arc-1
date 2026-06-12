/**
 * Canonical naming the ARC-1 test suites use for the throwaway SAP objects they
 * create, plus a pure selector the janitor (scripts/test-janitor.ts) uses to
 * decide what to sweep.
 */

import type { AdtSearchResult } from '../../src/adt/types.js';
import { PERSISTENT_OBJECTS } from '../e2e/fixtures.js';

/** Exact names of managed persistent fixtures — these must NEVER be swept. */
export const PERSISTENT_FIXTURE_NAMES: readonly string[] = PERSISTENT_OBJECTS.map((o) => o.name);

/**
 * Name prefixes the integration + e2e suites use for transient objects, for the
 * janitor to sweep leftovers from crashed/interrupted runs.
 *
 * This is a CURATED list, NOT auto-derived — keep it in step with the prefixes
 * the suites pass to uniqueName/generateUniqueName. `ZARC1` covers the whole
 * ZARC1* namespace (incl. ZARC1FG/FM function groups, ZARC1MC message classes,
 * ZARC1SKTD, …). Deletion is best-effort: standalone objects delete cleanly,
 * while types needing ordered teardown (FUNC modules under a group, RAP behavior
 * pools) may be reported as failures to remove manually. The `$ARC1T_*` PACKAGES
 * that RAP tests create are NOT swept here — delete those manually (e.g. SE80) if
 * they accumulate.
 */
export const TEST_OBJECT_PREFIXES: readonly string[] = [
  'ZARC1', // the whole ZARC1* test namespace (ZARC1_*, ZARC1FG, ZARC1MC, ZARC1SKTD, …)
  'ZARC360', // #360 schema-pollution tests
  'ZCL_ARC1', // ZCL_ARC1_E303*, ZCL_ARC1_CSURG*, …
  'ZIF_ARC1',
  'ZI_ARC1', // DDLS views
  'ZTABL_ARC1',
  'ZSTR_ARC1',
  'ZRES_', // ZRES_TADIR_*, ZRES_TGHOST_*, ZRES_*PAR/CHD
];

/** Minimal shape of a search hit the selector needs. */
export type SweepableObject = Pick<AdtSearchResult, 'objectName' | 'objectType' | 'uri' | 'packageName'>;

/** A leftover object the janitor may delete. */
export interface SweepCandidate {
  name: string;
  type: string;
  uri: string;
  packageName: string;
}

/**
 * Strip the NW 7.50 search-result display decoration ("ZIF_X (Interface)") to
 * the bare object name. Shared with tests/e2e/setup.ts so the janitor and the
 * fixture-sync agree on what an object is called (otherwise a decorated hit
 * would slip past the persistent-fixture exclusion below).
 */
export function bareObjectName(objectName: string): string {
  return objectName.split(/\s|\(/)[0];
}

/**
 * From raw search hits, pick the objects that are (a) NOT a persistent fixture
 * and (b) STRICT-prefix-match one of the test prefixes (ADT quick-search is
 * fuzzy, so the strict bare-name `startsWith` filter is what keeps unrelated
 * objects safe). De-duplicated by bare type + name.
 */
export function selectSweepCandidates(
  results: readonly SweepableObject[],
  prefixes: readonly string[] = TEST_OBJECT_PREFIXES,
  excludeNames: readonly string[] = PERSISTENT_FIXTURE_NAMES,
): SweepCandidate[] {
  const exclude = new Set(excludeNames.map((n) => n.toUpperCase()));
  const upperPrefixes = prefixes.map((p) => p.toUpperCase());
  const byKey = new Map<string, SweepCandidate>();
  for (const r of results) {
    const name = bareObjectName(r.objectName ?? '').toUpperCase();
    if (!name || !r.uri) continue;
    if (exclude.has(name)) continue;
    if (!upperPrefixes.some((p) => name.startsWith(p))) continue;
    const bareType = (r.objectType?.split('/')[0] ?? r.objectType ?? '').toUpperCase();
    byKey.set(`${bareType}|${name}`, {
      name,
      type: r.objectType,
      uri: r.uri,
      packageName: r.packageName,
    });
  }
  return [...byKey.values()];
}
