/** Fixed two-owner Basic-native contract. Offline preparation/check and permanent one-shot execution. */
import { readFixedCollectionsIntent } from './native-ddic-collections-prerequisites.js';
import { type DdicPhaseDependencies, runFixedDdicPhases } from './native-ddic-phases.js';
import { isDirectEntry } from './native-declarative-entry.js';
import { ENHO_PROTOCOL, ENHO_STAGES, type EnhoFixture, enhoFixtures } from './native-enho-fixtures.js';
export function runNativeEnhoPhases(args: string[], dependencies?: DdicPhaseDependencies<EnhoFixture>) {
  return runFixedDdicPhases(
    args,
    new URL(import.meta.url),
    {
      protocol: ENHO_PROTOCOL,
      flag: 'enhancement-owned-stub-v1',
      suffixBytes: 6,
      stages: ENHO_STAGES,
      failureGraph: 'fixed-owned-stub-and-disabled-enhancement',
      fixtures: enhoFixtures,
      deletedOwners: (f) => [...f].reverse().map((v) => v.owner),
      intent: (binding) => readFixedCollectionsIntent(binding, ENHO_PROTOCOL, enhoFixtures),
      helpers: async () => {
        const h = await import('./native-enho-runner.js');
        return { runtime: h.enhoRuntime, client: h.enhoClient, preflight: h.enhoGetOnlyPreflight };
      },
    },
    dependencies,
  );
}
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeEnhoPhases(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('Fixed enhancement qualification stopped. Preserve the claim and every residual; never replay.');
    process.exitCode = 1;
  }
}
