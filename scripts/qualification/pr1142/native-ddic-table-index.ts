/** Separate permanent claim for the exact unfinished table graph. */
import { readFixedCollectionsIntent } from './native-ddic-collections-prerequisites.js';
import { type DdicPhaseDependencies, runFixedDdicPhases } from './native-ddic-phases.js';
import { type TableFixture, tableDeletedOwners } from './native-ddic-table-fixtures.js';
import {
  indexTailFixtures,
  indexTailOwners,
  TABLE_INDEX_PROTOCOL,
  TABLE_INDEX_STAGES,
  TABLE_INDEX_SUFFIX,
} from './native-ddic-table-index-fixed.js';
import { verifyIndexTailHistory } from './native-ddic-table-index-history.js';
import { isDirectEntry } from './native-declarative-entry.js';
export function runNativeIndexTailPhases(
  args: string[],
  dependencies?: DdicPhaseDependencies<TableFixture> & { verifyHistory: () => void },
) {
  return runFixedDdicPhases(
    args,
    new URL(import.meta.url),
    {
      protocol: TABLE_INDEX_PROTOCOL,
      flag: 'ddic-table-index-tail-v1',
      suffixBytes: 6,
      fixedSuffix: TABLE_INDEX_SUFFIX,
      retainedOwners: indexTailOwners(),
      inventory: 'valid-unfiltered',
      verifyHistory: dependencies?.verifyHistory ?? verifyIndexTailHistory,
      stages: TABLE_INDEX_STAGES,
      failureGraph: 'fixed-retained-index-reactivation-cleanup',
      deletedOwners: tableDeletedOwners,
      fixtures: indexTailFixtures,
      intent: (binding) => readFixedCollectionsIntent(binding, TABLE_INDEX_PROTOCOL, indexTailFixtures),
      helpers: async () => {
        const h = await import('./native-ddic-table-index-runner.js');
        return { runtime: h.indexTailRuntime, client: h.ddicClient, preflight: h.indexTailPreflight };
      },
    },
    dependencies,
  );
}
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeIndexTailPhases(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('Fixed retained table graph stopped. Preserve original and new claims and residuals; never replay.');
    process.exitCode = 1;
  }
}
