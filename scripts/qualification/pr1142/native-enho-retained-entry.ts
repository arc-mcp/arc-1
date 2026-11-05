/** Fixed three-stage continuation only. Five completed stages and acknowledged PUT never replay. */
import { readFixedCollectionsIntent } from './native-ddic-collections-prerequisites.js';
import { type DdicPhaseDependencies, runFixedDdicPhases } from './native-ddic-phases.js';
import { isDirectEntry } from './native-declarative-entry.js';
import type { EnhoFixture } from './native-enho-fixtures.js';
import {
  ENHO_RETAINED_MODE,
  ENHO_RETAINED_PROTOCOL,
  ENHO_RETAINED_STAGES,
  ENHO_RETAINED_SUFFIX,
  retainedEnhoFixtures,
} from './native-enho-retained-fixed.js';
import { verifyRetainedEnhoHistory } from './native-enho-retained-history.js';
export function runRetainedEnhoPhases(args: string[], dependencies?: DdicPhaseDependencies<EnhoFixture>) {
  return runFixedDdicPhases(
    args,
    new URL(import.meta.url),
    {
      protocol: ENHO_RETAINED_PROTOCOL,
      flag: 'enhancement-owned-retained-v1',
      suffixBytes: 6,
      fixedSuffix: ENHO_RETAINED_SUFFIX,
      retainedOwners: retainedEnhoFixtures(ENHO_RETAINED_SUFFIX).map((v) => v.owner),
      verifyHistory: verifyRetainedEnhoHistory,
      inventory: 'valid-unfiltered',
      stages: ENHO_RETAINED_STAGES,
      failureGraph: 'fixed-retained-owned-stub-and-disabled-enhancement',
      fixtures: retainedEnhoFixtures,
      intent: (binding) => readFixedCollectionsIntent(binding, ENHO_RETAINED_PROTOCOL, retainedEnhoFixtures),
      helpers: async () => {
        const h = await import('./native-enho-runner.js');
        const d = await import('./native-enho-driver.js');
        return {
          runtime: { ...h.enhoRuntime, execute: (input) => d.runNativeEnho(input, ENHO_RETAINED_MODE) },
          client: h.enhoClient,
          preflight: (c, f, r, v) => h.enhoGetOnlyPreflight(c, f, r, v, ENHO_RETAINED_MODE),
        };
      },
    },
    dependencies,
  );
}
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runRetainedEnhoPhases(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error(
      'Retained enhancement stopped. Preserve the consumed claim and both owner diagnostics. Never replay.',
    );
    process.exitCode = 1;
  }
}
