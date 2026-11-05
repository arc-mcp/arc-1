/** Fixed continuation after the consumed omission-only MSAG update; preparation/check remain purely offline. */
import type { CollectionsFixture } from './native-ddic-collections-fixtures.js';
import { readFixedCollectionsIntent } from './native-ddic-collections-prerequisites.js';
import {
  COLLECTIONS_REMOVAL,
  COLLECTIONS_REMOVAL_STAGES,
  COLLECTIONS_REMOVAL_SUFFIX,
  collectionsRemovalFixtures,
} from './native-ddic-collections-removal-fixed.js';
import { verifyCollectionsRemovalHistory } from './native-ddic-collections-removal-history.js';
import { type DdicPhaseDependencies, runFixedDdicPhases } from './native-ddic-phases.js';
import { isDirectEntry } from './native-declarative-entry.js';
export function runNativeCollectionsRemoval(
  args: string[],
  dependencies?: DdicPhaseDependencies<CollectionsFixture> & { verifyHistory: () => void },
) {
  return runFixedDdicPhases(
    args,
    new URL(import.meta.url),
    {
      protocol: COLLECTIONS_REMOVAL,
      flag: 'ddic-collections-removal-v1',
      suffixBytes: 6,
      fixedSuffix: COLLECTIONS_REMOVAL_SUFFIX,
      retainedOwners: collectionsRemovalFixtures(COLLECTIONS_REMOVAL_SUFFIX).map((f) => f.owner),
      verifyHistory: dependencies?.verifyHistory ?? verifyCollectionsRemovalHistory,
      stages: COLLECTIONS_REMOVAL_STAGES,
      failureGraph: 'three-active-DDIC-owners-after-omission-only-save',
      fixtures: collectionsRemovalFixtures,
      intent: (binding) => readFixedCollectionsIntent(binding, COLLECTIONS_REMOVAL, collectionsRemovalFixtures),
      helpers: async () => {
        const h = await import('./native-ddic-collections-removal-runner.js');
        return {
          runtime: h.collectionsRemovalRuntime,
          client: h.ddicClient,
          preflight: h.collectionsRemovalPreflight,
        };
      },
    },
    dependencies,
  );
}
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeCollectionsRemoval(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('Fixed message removal stopped. Preserve all claims and evidence; never replay.');
    process.exitCode = 1;
  }
}
