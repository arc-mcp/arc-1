/** Fixed fresh six-owner lifecycle; shared source-bound claim and JPEG prerequisite phases. */
import { readFixedCollectionsIntent } from './native-ddic-collections-prerequisites.js';
import { type DdicPhaseDependencies, runFixedDdicPhases } from './native-ddic-phases.js';
import { isDirectEntry } from './native-declarative-entry.js';
import { RAP_PROTOCOL, RAP_STAGES, type RapFixture, rapDeletedOwners, rapFixtures } from './native-rap-fixtures.js';
export function runNativeRapPhases(args: string[], dependencies?: DdicPhaseDependencies<RapFixture>) {
  return runFixedDdicPhases(
    args,
    new URL(import.meta.url),
    {
      protocol: RAP_PROTOCOL,
      flag: 'rap-publication-v1',
      suffixBytes: 6,
      stages: RAP_STAGES,
      failureGraph: 'fixed-managed-rap-pool-service-binding-graph',
      fixtures: rapFixtures,
      deletedOwners: rapDeletedOwners,
      intent: (binding) => readFixedCollectionsIntent(binding, RAP_PROTOCOL, rapFixtures),
      helpers: async () => {
        const h = await import('./native-rap-runner.js');
        return { runtime: h.rapRuntime, client: h.rapClient, preflight: h.rapGetOnlyPreflight };
      },
    },
    dependencies,
  );
}
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeRapPhases(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('Fixed RAP/publication qualification stopped; preserve every claim and residual. Never replay.');
    process.exitCode = 1;
  }
}
