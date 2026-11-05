/** Separate permanent claim for the fixed unfinished publication/cleanup tail. */
import { readFixedCollectionsIntent } from './native-ddic-collections-prerequisites.js';
import { type DdicPhaseDependencies, runFixedDdicPhases } from './native-ddic-phases.js';
import { isDirectEntry } from './native-declarative-entry.js';
import type { RapFixture } from './native-rap-fixtures.js';
import { rapSettings } from './native-rap-fixtures.js';
import { RAP_RETAINED_SUFFIX, rapRetainedFixtures } from './native-rap-retained-fixed.js';
import { RAP_RETAINED_V4_PROTOCOL, RAP_RETAINED_V4_STAGES } from './native-rap-retained-v4-fixed.js';
import { verifyRapRetainedV4History } from './native-rap-retained-v4-history.js';
export function runNativeRapRetainedV4Phases(
  args: string[],
  dependencies?: DdicPhaseDependencies<RapFixture> & { verifyHistory: () => void },
) {
  const f = rapRetainedFixtures(RAP_RETAINED_SUFFIX);
  return runFixedDdicPhases(
    args,
    new URL(import.meta.url),
    {
      protocol: RAP_RETAINED_V4_PROTOCOL,
      flag: 'rap-documents-retained-v4',
      suffixBytes: 6,
      fixedSuffix: RAP_RETAINED_SUFFIX,
      retainedOwners: [...f.map((v) => v.owner), rapSettings(f).owner],
      verifyHistory: dependencies?.verifyHistory ?? verifyRapRetainedV4History,
      inventory: 'valid-unfiltered',
      stages: RAP_RETAINED_V4_STAGES,
      failureGraph: 'fixed-retained-managed-RAP-document-tail',
      fixtures: rapRetainedFixtures,
      deletedOwners: (f) => [...f].reverse().map((v) => v.owner),
      intent: (binding) => readFixedCollectionsIntent(binding, RAP_RETAINED_V4_PROTOCOL, rapRetainedFixtures),
      helpers: async () => {
        const h = await import('./native-rap-retained-runner.js');
        return { runtime: h.rapRetainedV4Runtime, client: h.rapClient, preflight: h.rapRetainedV4Preflight };
      },
    },
    dependencies,
  );
}
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeRapRetainedV4Phases(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('Retained RAP tail stopped. Preserve all old and new claims; never replay.');
    process.exitCode = 1;
  }
}
