/** Fresh full graph after audited cleanup; no consumed claim or old owner can be reused. */
import {
  COLLECTIONS_STAGES,
  type CollectionsFixture,
  collectionsFixtures,
} from './native-ddic-collections-fixtures.js';
import { readFixedCollectionsIntent } from './native-ddic-collections-prerequisites.js';
import { verifyCollectionsV2History } from './native-ddic-collections-v2-history.js';
import { type DdicPhaseDependencies, runFixedDdicPhases } from './native-ddic-phases.js';
import { STRUCTURE_SUFFIX } from './native-ddic-structure-cleanup-fixed.js';
import { isDirectEntry } from './native-declarative-entry.js';

export const COLLECTIONS_V2_PROTOCOL = 'pr1142-native-ddic-collections-v2';
export function collectionsV2Fixtures(suffix: string) {
  if (suffix === STRUCTURE_SUFFIX) throw new Error('The consumed collections suffix cannot be reused.');
  return collectionsFixtures(suffix);
}
export function runNativeCollectionsV2(
  args: string[],
  dependencies?: DdicPhaseDependencies<CollectionsFixture> & { verifyHistory: () => void },
) {
  return runFixedDdicPhases(
    args,
    new URL(import.meta.url),
    {
      protocol: COLLECTIONS_V2_PROTOCOL,
      flag: 'ddic-collections-v2',
      suffixBytes: 6,
      verifyHistory: dependencies?.verifyHistory ?? verifyCollectionsV2History,
      stages: COLLECTIONS_STAGES,
      failureGraph: 'fixed-three-fresh-owner-graph',
      fixtures: collectionsV2Fixtures,
      intent: (binding) => readFixedCollectionsIntent(binding, COLLECTIONS_V2_PROTOCOL, collectionsV2Fixtures),
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
    const result = await runNativeCollectionsV2(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('Fresh collections qualification stopped. Preserve all claims and evidence; never replay.');
    process.exitCode = 1;
  }
}
