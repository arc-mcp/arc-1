/** Fixed fresh table graph; no credential/runtime import before reviewed preflight or exclusive claim. */
import { readFixedCollectionsIntent } from './native-ddic-collections-prerequisites.js';
import { type DdicPhaseDependencies, runFixedDdicPhases } from './native-ddic-phases.js';
import {
  TABLE_PROTOCOL,
  TABLE_STAGES,
  type TableFixture,
  tableDeletedOwners,
  tableFixtures,
} from './native-ddic-table-fixtures.js';
import { isDirectEntry } from './native-declarative-entry.js';
export function runNativeTableGraphPhases(args: string[], dependencies?: DdicPhaseDependencies<TableFixture>) {
  return runFixedDdicPhases(
    args,
    new URL(import.meta.url),
    {
      protocol: TABLE_PROTOCOL,
      flag: 'ddic-table-graph-v1',
      suffixBytes: 6,
      stages: TABLE_STAGES,
      failureGraph: 'fixed-table-settings-lock-index-graph',
      fixtures: tableFixtures,
      deletedOwners: tableDeletedOwners,
      intent: (binding) => readFixedCollectionsIntent(binding, TABLE_PROTOCOL, tableFixtures),
      helpers: async () => {
        const h = await import('./native-ddic-table-runner.js');
        return { runtime: h.tableRuntime, client: h.tableClient, preflight: h.tableGetOnlyPreflight };
      },
    },
    dependencies,
  );
}
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeTableGraphPhases(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('Fixed table graph stopped. Preserve every claim and current residual; never replay.');
    process.exitCode = 1;
  }
}
