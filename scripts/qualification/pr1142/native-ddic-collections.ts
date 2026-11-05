/** Fresh fixed structure→TTYP plus independent MSAG phase entry. Root, flags, fixture graph and receipts remain unchanged. */
import {
  COLLECTIONS_PROTOCOL,
  COLLECTIONS_STAGES,
  type CollectionsFixture,
  collectionsFixtures,
} from './native-ddic-collections-fixtures.js';
import { readCollectionsIntent } from './native-ddic-collections-prerequisites.js';
import { type DdicPhaseDependencies as Dependencies, runFixedDdicPhases } from './native-ddic-phases.js';
import { isDirectEntry } from './native-declarative-entry.js';

export { assertDdicRuntime } from './native-ddic-phases.js';
export type DdicPhaseDependencies = Dependencies<CollectionsFixture>;
export function runNativeDdicCollectionsPhases(args: string[], dependencies?: DdicPhaseDependencies) {
  return runFixedDdicPhases(
    args,
    new URL(import.meta.url),
    {
      protocol: COLLECTIONS_PROTOCOL,
      flag: 'ddic-collections-v1',
      suffixBytes: 6,
      stages: COLLECTIONS_STAGES,
      failureGraph: 'fixed-three-owner-graph',
      fixtures: collectionsFixtures,
      intent: readCollectionsIntent,
      helpers: async () => {
        const h = await import('./native-ddic-collections-runner.js');
        return { runtime: h.collectionsRuntime, client: h.collectionsClient, preflight: h.collectionsGetOnlyPreflight };
      },
    },
    dependencies,
  );
}

if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeDdicCollectionsPhases(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('Fixed DDIC qualification stopped. Preserve all evidence; never repeat a claimed attempt.');
    process.exitCode = 1;
  }
}
