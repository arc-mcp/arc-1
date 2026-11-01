/** Temporary research only. Preserve e21b7159e's uncached, single-project integration order. */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';
import integration from './vitest.integration.config.js';

const ORIGINAL = 'tests/integration/where-used-details.integration.test.ts';
const PREDECESSOR = 'tests/integration/mutation-lifecycle.integration.test.ts';
export const ORDER_PROOF = 'test-results/1057-public/order.json';

export class OriginalIntegrationOrder extends BaseSequencer {
  async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const sizes = new Map(
      files.map((file) => [
        file,
        // The only instrumented integration file was 4169 bytes at the frozen baseline.
        relative(process.cwd(), file.moduleId) === ORIGINAL ? 4169 : statSync(file.moduleId).size,
      ]),
    );
    const order = [...files].sort((a, b) => sizes.get(b)! - sizes.get(a)!);
    const target = order.findIndex((file) => relative(process.cwd(), file.moduleId) === ORIGINAL);
    if (files.length !== 35 || target !== 26 || relative(process.cwd(), order[target - 1]!.moduleId) !== PREDECESSOR)
      throw new Error('1057: frozen integration order not reproduced');
    mkdirSync('test-results/1057-public', { recursive: true });
    writeFileSync(ORDER_PROOF, JSON.stringify({ fileCount: 35, targetRank: 27, predecessor: PREDECESSOR }), {
      mode: 0o600,
    });
    return order;
  }
}

export default defineConfig({
  ...integration,
  test: { ...integration.test, sequence: { ...integration.test?.sequence, sequencer: OriginalIntegrationOrder } },
});
