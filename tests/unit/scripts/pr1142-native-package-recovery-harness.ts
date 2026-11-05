import { readFileSync } from 'node:fs';
import { packageRecoveryGraph as graph } from '../../../scripts/qualification/pr1142/native-package-recovery-fixed.js';
import { harness } from './pr1142-native-package-harness.js';

const { runNativePackageCleanup } = await import('../../../scripts/qualification/pr1142/native-package-driver.js');

export { graph };
export function recoveryHarness(options: Parameters<typeof harness>[0] = {}) {
  const metadata = Object.fromEntries(
    [graph.root, graph.child, graph.clas].map((owner) => [
      owner.owner,
      readFileSync(new URL(`../../fixtures/native-local-package-recovery/${owner.kind}.xml`, import.meta.url), 'utf8'),
    ]),
  );
  const h = harness({ ...options, graph, retained: { metadata, source: graph.clas.source.replace(/\n/g, '\r\n') } });
  let stopped = false,
    broken = false;
  return {
    ...h,
    metadata,
    stop: () => {
      stopped = true;
    },
    breakSource: () => {
      broken = true;
    },
    run: (freshUntil = Date.now() + 240_000) =>
      runNativePackageCleanup({
        base: h.client,
        graph,
        freshUntil,
        record: (row) => {
          h.records.push(row);
          h.hooks.record?.(row);
        },
        verify: () => {
          h.hooks.verify?.();
          if (broken) throw new Error('Synthetic binding drift.');
        },
        shouldStop: () => stopped,
      }),
  };
}
