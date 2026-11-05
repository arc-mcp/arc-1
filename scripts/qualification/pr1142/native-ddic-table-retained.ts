/** Separate permanent claim for the exact unfinished table graph. */
import { readFixedCollectionsIntent } from './native-ddic-collections-prerequisites.js';
import { type DdicPhaseDependencies, runFixedDdicPhases } from './native-ddic-phases.js';
import { type TableFixture, tableDeletedOwners } from './native-ddic-table-fixtures.js';
import {
  retainedTableFixtures,
  retainedTableOwners,
  TABLE_RETAINED_PROTOCOL,
  TABLE_RETAINED_STAGES,
  TABLE_RETAINED_SUFFIX,
} from './native-ddic-table-retained-fixed.js';
import { verifyRetainedTableHistory } from './native-ddic-table-retained-history.js';
import { isDirectEntry } from './native-declarative-entry.js';
export function runNativeRetainedTablePhases(
  args: string[],
  dependencies?: DdicPhaseDependencies<TableFixture> & { verifyHistory: () => void },
) {
  return runFixedDdicPhases(
    args,
    new URL(import.meta.url),
    {
      protocol: TABLE_RETAINED_PROTOCOL,
      flag: 'ddic-table-retained-v1',
      suffixBytes: 6,
      fixedSuffix: TABLE_RETAINED_SUFFIX,
      retainedOwners: retainedTableOwners(),
      inventory: 'valid-unfiltered',
      verifyHistory: dependencies?.verifyHistory ?? verifyRetainedTableHistory,
      stages: TABLE_RETAINED_STAGES,
      failureGraph: 'fixed-retained-table-settings-lock-index',
      deletedOwners: tableDeletedOwners,
      fixtures: retainedTableFixtures,
      intent: (binding) => readFixedCollectionsIntent(binding, TABLE_RETAINED_PROTOCOL, retainedTableFixtures),
      helpers: async () => {
        const h = await import('./native-ddic-table-retained-runner.js');
        return { runtime: h.retainedTableRuntime, client: h.ddicClient, preflight: h.retainedTablePreflight };
      },
    },
    dependencies,
  );
}
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeRetainedTablePhases(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('Fixed retained table graph stopped. Preserve original and new claims and residuals; never replay.');
    process.exitCode = 1;
  }
}
