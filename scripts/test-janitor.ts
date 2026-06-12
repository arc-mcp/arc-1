/**
 * Test-object janitor.
 *
 * Sweeps leftover transient objects that a crashed / interrupted integration or
 * e2e run left on the SAP system (normal runs clean up after themselves). Finds
 * objects whose name strict-prefix-matches one of TEST_OBJECT_PREFIXES, excludes
 * the managed persistent fixtures, and deletes them with the same lock-aware
 * retry the suites use.
 *
 * SAFE BY DEFAULT — dry run unless `--execute` is passed:
 *   npm run test:cleanup              # list what WOULD be deleted
 *   npm run test:cleanup -- --execute # actually delete
 *
 * Needs SAP credentials (TEST_SAP_URL / SAP_URL …), the same as the integration
 * suite. Does not require a running MCP server.
 */

import { unrestrictedSafetyConfig } from '../src/adt/safety.js';
import type { AdtSearchResult } from '../src/adt/types.js';
import { retryDelete } from '../tests/integration/crud-harness.js';
import { getTestClient } from '../tests/integration/helpers.js';
import { selectSweepCandidates, TEST_OBJECT_PREFIXES } from '../tests/helpers/test-prefixes.js';

const SEARCH_CAP = 200;

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const client = getTestClient();
  const safety = unrestrictedSafetyConfig();

  console.log(`\n[janitor] ${execute ? 'EXECUTE' : 'DRY RUN'} — scanning for leftover test objects...`);
  console.log(`[janitor] prefixes: ${TEST_OBJECT_PREFIXES.join(', ')}\n`);

  const hits: AdtSearchResult[] = [];
  for (const prefix of TEST_OBJECT_PREFIXES) {
    // The trailing `*` is ESSENTIAL: ADT quick-search does NOT do implicit prefix
    // matching — searchObject('ZARC1') returns 0 hits, searchObject('ZARC1*')
    // returns the matches (verified live). selectSweepCandidates re-filters with a
    // strict bare-name startsWith, so the wildcard only widens the server query.
    const results = await client.searchObject(`${prefix}*`, SEARCH_CAP);
    hits.push(...results);
    if (results.length >= SEARCH_CAP) {
      console.warn(
        `[janitor] ⚠ prefix "${prefix}" hit the ${SEARCH_CAP}-result cap — some matches may be missing; re-run after this pass.`,
      );
    }
  }

  const candidates = selectSweepCandidates(hits);
  if (candidates.length === 0) {
    console.log('[janitor] No leftover test objects found. Nothing to do.');
    return;
  }

  console.log(`[janitor] ${candidates.length} candidate leftover object(s):`);
  for (const c of candidates) {
    console.log(`  ${c.type.padEnd(10)} ${c.name.padEnd(30)} [pkg ${c.packageName || '?'}]`);
  }

  if (!execute) {
    console.log('\n[janitor] Dry run — pass `-- --execute` to delete. No objects were modified.');
    return;
  }

  console.log('');
  let deleted = 0;
  const failed: string[] = [];
  for (const c of candidates) {
    const result = await retryDelete(client.http, safety, c.uri);
    if (result.success) {
      deleted++;
      console.log(`  ✓ deleted ${c.type} ${c.name}`);
    } else {
      failed.push(`${c.type} ${c.name}`);
      console.warn(`  ✗ ${c.type} ${c.name}: ${result.lastError ?? 'unknown error'}`);
    }
  }

  console.log(`\n[janitor] Deleted ${deleted}/${candidates.length}. Failed: ${failed.length}.`);
  if (failed.length > 0) {
    console.log(`[janitor] Still present (delete manually if stale): ${failed.join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n[janitor] failed: ${message}`);
  process.exit(1);
});
