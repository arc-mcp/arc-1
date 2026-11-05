/** Separate permanent claim for the fixed unfinished document/service/publication/cleanup tail. */
import { readFixedCollectionsIntent } from './native-ddic-collections-prerequisites.js';
import { type DdicPhaseDependencies, runFixedDdicPhases } from './native-ddic-phases.js';
import { isDirectEntry } from './native-declarative-entry.js';
import type { RapFixture } from './native-rap-fixtures.js';
import { rapSettings } from './native-rap-fixtures.js';
import {
  RAP_RETAINED_INDICES,
  RAP_RETAINED_PROTOCOL,
  RAP_RETAINED_STAGES,
  RAP_RETAINED_SUFFIX,
  rapRetainedFixtures,
} from './native-rap-retained-fixed.js';
import { verifyRapRetainedHistory } from './native-rap-retained-history.js';
export function runNativeRapRetainedPhases(
  args: string[],
  dependencies?: DdicPhaseDependencies<RapFixture> & { verifyHistory: () => void },
) {
  const f = rapRetainedFixtures(RAP_RETAINED_SUFFIX);
  return runFixedDdicPhases(
    args,
    new URL(import.meta.url),
    {
      protocol: RAP_RETAINED_PROTOCOL,
      flag: 'rap-documents-retained-v1',
      suffixBytes: 6,
      fixedSuffix: RAP_RETAINED_SUFFIX,
      retainedOwners: [...RAP_RETAINED_INDICES.map((i) => f[i].owner), rapSettings(f).owner],
      verifyHistory: dependencies?.verifyHistory ?? verifyRapRetainedHistory,
      inventory: 'valid-unfiltered',
      stages: RAP_RETAINED_STAGES,
      failureGraph: 'fixed-retained-managed-RAP-document-tail',
      fixtures: rapRetainedFixtures,
      deletedOwners: (f) => [...f].reverse().map((v) => v.owner),
      intent: (binding) => readFixedCollectionsIntent(binding, RAP_RETAINED_PROTOCOL, rapRetainedFixtures),
      helpers: async () => {
        const h = await import('./native-rap-retained-runner.js');
        return { runtime: h.rapRetainedRuntime, client: h.rapClient, preflight: h.rapRetainedPreflight };
      },
    },
    dependencies,
  );
}
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeRapRetainedPhases(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('Retained RAP tail stopped. Preserve all old and new claims; never replay.');
    process.exitCode = 1;
  }
}
