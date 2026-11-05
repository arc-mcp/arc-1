/** Separate permanent claim for the fixed unfinished document/service/publication/cleanup tail. */
import { readFixedCollectionsIntent } from './native-ddic-collections-prerequisites.js';
import { type DdicPhaseDependencies, runFixedDdicPhases } from './native-ddic-phases.js';
import { isDirectEntry } from './native-declarative-entry.js';
import type { RapFixture } from './native-rap-fixtures.js';
import { rapSettings } from './native-rap-fixtures.js';
import { RAP_RETAINED_INDICES, RAP_RETAINED_SUFFIX, rapRetainedFixtures } from './native-rap-retained-fixed.js';
import { RAP_RETAINED_V3_PROTOCOL, RAP_RETAINED_V3_STAGES } from './native-rap-retained-v3-fixed.js';
import { verifyRapRetainedV3History } from './native-rap-retained-v3-history.js';
export function runNativeRapRetainedV3Phases(
  args: string[],
  dependencies?: DdicPhaseDependencies<RapFixture> & { verifyHistory: () => void },
) {
  const f = rapRetainedFixtures(RAP_RETAINED_SUFFIX);
  return runFixedDdicPhases(
    args,
    new URL(import.meta.url),
    {
      protocol: RAP_RETAINED_V3_PROTOCOL,
      flag: 'rap-documents-retained-v3',
      suffixBytes: 6,
      fixedSuffix: RAP_RETAINED_SUFFIX,
      retainedOwners: [...RAP_RETAINED_INDICES.map((i) => f[i].owner), rapSettings(f).owner],
      verifyHistory: dependencies?.verifyHistory ?? verifyRapRetainedV3History,
      inventory: 'valid-unfiltered',
      stages: RAP_RETAINED_V3_STAGES,
      failureGraph: 'fixed-retained-managed-RAP-document-tail',
      fixtures: rapRetainedFixtures,
      deletedOwners: (f) => [...f].reverse().map((v) => v.owner),
      intent: (binding) => readFixedCollectionsIntent(binding, RAP_RETAINED_V3_PROTOCOL, rapRetainedFixtures),
      helpers: async () => {
        const h = await import('./native-rap-retained-runner.js');
        return { runtime: h.rapRetainedV3Runtime, client: h.rapClient, preflight: h.rapRetainedV3Preflight };
      },
    },
    dependencies,
  );
}
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeRapRetainedV3Phases(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('Retained RAP tail stopped. Preserve all old and new claims; never replay.');
    process.exitCode = 1;
  }
}
