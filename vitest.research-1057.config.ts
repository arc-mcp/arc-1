/** Temporary research only. Run the unchanged original test without preceding suite files. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';
import { assertOriginalTestOnly, ORIGINAL_TEST } from './tests/helpers/where-used-suite.js';
import integration from './vitest.integration.config.js';

export const ORDER_PROOF = 'test-results/1057-public/order.json';

export class OriginalTestOnly extends BaseSequencer {
  async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    assertOriginalTestOnly(files.map((file) => file.moduleId));
    mkdirSync('test-results/1057-public', { recursive: true });
    writeFileSync(ORDER_PROOF, JSON.stringify({ fileCount: 1, targetRank: 1, predecessor: null }), {
      mode: 0o600,
    });
    return files;
  }
}

export default defineConfig({
  ...integration,
  test: {
    ...integration.test,
    include: [ORIGINAL_TEST],
    sequence: { ...integration.test?.sequence, sequencer: OriginalTestOnly },
  },
});
