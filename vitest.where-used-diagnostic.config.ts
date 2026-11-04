import { configDefaults, defineConfig } from 'vitest/config';

/** No skip-telemetry setup: it would erase the required integration run's evidence. */
export default defineConfig({
  test: {
    include: ['tests/integration/where-used-fresh-activation.diagnostic.test.ts'],
    exclude: configDefaults.exclude,
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
    sequence: { concurrent: false },
    reporters: ['default', ['json', { outputFile: 'test-results/where-used-fresh-activation.json' }]],
  },
});
