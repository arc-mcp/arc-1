/** Historical fixed DOMA/DTEL phase entry. Root, flags, fixture graph and receipts remain unchanged. */
import { DDIC_PROTOCOL, DDIC_STAGES, type DdicFixture, ddicFixtures } from './native-ddic-fixtures.js';
import { type DdicPhaseDependencies as Dependencies, runFixedDdicPhases } from './native-ddic-phases.js';
import { readDdicIntent } from './native-ddic-prerequisites.js';
import { isDirectEntry } from './native-declarative-entry.js';

export { assertDdicRuntime } from './native-ddic-phases.js';
export type DdicPhaseDependencies = Dependencies<DdicFixture>;
export function runNativeDdicFoundation(args: string[], dependencies?: DdicPhaseDependencies) {
  return runFixedDdicPhases(
    args,
    new URL(import.meta.url),
    {
      protocol: DDIC_PROTOCOL,
      flag: 'ddic-foundation-v1',
      suffixBytes: 8,
      stages: DDIC_STAGES,
      failureGraph: 'fixed-two-owner-graph',
      fixtures: ddicFixtures,
      intent: readDdicIntent,
      helpers: async () => {
        const h = await import('./native-ddic-runner.js');
        return { runtime: h.ddicRuntime, client: h.ddicClient, preflight: h.ddicGetOnlyPreflight };
      },
    },
    dependencies,
  );
}

if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeDdicFoundation(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('Fixed DDIC qualification stopped. Preserve all evidence; never repeat a claimed attempt.');
    process.exitCode = 1;
  }
}
