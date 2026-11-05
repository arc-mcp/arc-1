/** Fixed continuation after the consumed v2 MSAG observer stop; preparation/check remain purely offline. */
import type { CollectionsFixture } from './native-ddic-collections-fixtures.js';
import { readFixedCollectionsIntent } from './native-ddic-collections-prerequisites.js';
import {
  COLLECTIONS_RETAINED,
  COLLECTIONS_RETAINED_STAGES,
  COLLECTIONS_RETAINED_SUFFIX,
  collectionsRetainedFixtures,
} from './native-ddic-collections-retained-fixed.js';
import { verifyCollectionsRetainedHistory } from './native-ddic-collections-retained-history.js';
import { type DdicPhaseDependencies, runFixedDdicPhases } from './native-ddic-phases.js';
import { isDirectEntry } from './native-declarative-entry.js';
export function runNativeCollectionsRetained(
  args: string[],
  dependencies?: DdicPhaseDependencies<CollectionsFixture> & { verifyHistory: () => void },
) {
  return runFixedDdicPhases(
    args,
    new URL(import.meta.url),
    {
      protocol: COLLECTIONS_RETAINED,
      flag: 'ddic-collections-retained-v1',
      suffixBytes: 6,
      fixedSuffix: COLLECTIONS_RETAINED_SUFFIX,
      retainedOwners: collectionsRetainedFixtures(COLLECTIONS_RETAINED_SUFFIX).map((f) => f.owner),
      verifyHistory: dependencies?.verifyHistory ?? verifyCollectionsRetainedHistory,
      stages: COLLECTIONS_RETAINED_STAGES,
      failureGraph: 'three-retained-active-DDIC-owners',
      fixtures: collectionsRetainedFixtures,
      intent: (binding) => readFixedCollectionsIntent(binding, COLLECTIONS_RETAINED, collectionsRetainedFixtures),
      helpers: async () => {
        const h = await import('./native-ddic-collections-retained-runner.js');
        return {
          runtime: h.collectionsRetainedRuntime,
          client: h.ddicClient,
          preflight: h.collectionsRetainedPreflight,
        };
      },
    },
    dependencies,
  );
}
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeCollectionsRetained(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('Retained collections stopped. Preserve all claims and evidence; never replay.');
    process.exitCode = 1;
  }
}
