/**
 * Canonical naming the ARC-1 test suites use for the throwaway SAP objects they
 * create, plus a pure selector the janitor (scripts/test-janitor.ts) uses to
 * decide what to sweep. Single source of truth so a new test prefix can't drift
 * out of the cleanup set silently (see Engineering Playbook §3 in AGENTS.md).
 */

import { PERSISTENT_OBJECTS } from '../e2e/fixtures.js';

/** Exact names of managed persistent fixtures — these must NEVER be swept. */
export const PERSISTENT_FIXTURE_NAMES: readonly string[] = PERSISTENT_OBJECTS.map((o) => o.name);

/**
 * Name prefixes the integration + e2e suites use for transient objects. The
 * janitor sweeps leftovers (from crashed/interrupted runs) that start with one
 * of these. Kept deliberately to cleanly-deletable workbench types (PROG/CLAS/
 * INTF/DDLS/TABL/DOMA/DTEL); RAP/FUGR fixtures self-clean in finally blocks and
 * need ordered teardown, so they're intentionally out of scope here.
 */
export const TEST_OBJECT_PREFIXES: readonly string[] = [
  'ZARC1_', // broad integration + e2e: ZARC1_ACT*, ZARC1_DOMA*, ZARC1_E2E_*, ZARC1_TDOM*, …
  'ZARC360', // #360 schema-pollution tests
  'ZCL_ARC1', // ZCL_ARC1_E303*, ZCL_ARC1_CSURG*, …
  'ZIF_ARC1',
  'ZI_ARC1', // DDLS views
  'ZTABL_ARC1',
  'ZSTR_ARC1',
  'ZRES_', // ZRES_TADIR_*, ZRES_TGHOST_*, ZRES_*PAR/CHD
];

/** Package-name prefixes the suites create (e.g. RAP local packages). */
export const TEST_PACKAGE_PREFIXES: readonly string[] = ['$ARC1T_'];

/** Minimal shape of a search hit the selector needs (subset of AdtSearchResult). */
export interface SweepableObject {
  objectName: string;
  objectType: string;
  uri: string;
  packageName: string;
}

/** A leftover object the janitor may delete. */
export interface SweepCandidate {
  name: string;
  type: string;
  uri: string;
  packageName: string;
}

/**
 * From raw search hits, pick the objects that are (a) NOT a persistent fixture
 * and (b) STRICT-prefix-match one of the test prefixes (ADT quick-search is
 * fuzzy/substring, so the strict `startsWith` filter is what keeps unrelated
 * objects safe). De-duplicated by type+name.
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
    const name = r.objectName?.toUpperCase();
    if (!name || !r.uri) continue;
    if (exclude.has(name)) continue;
    if (!upperPrefixes.some((p) => name.startsWith(p))) continue;
    byKey.set(`${r.objectType}|${name}`, {
      name,
      type: r.objectType,
      uri: r.uri,
      packageName: r.packageName,
    });
  }
  return [...byKey.values()];
}
