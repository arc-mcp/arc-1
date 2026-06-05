import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['tests/helpers/skip-telemetry-setup.ts'],
    include: ['tests/integration/**/*.test.ts'],
    // SAP can be slow — allow 30s per test
    testTimeout: 30000,
    // Live SAP suite hooks can list CTS state or seed objects; keep this above
    // the default 10s so setup/cleanup does not fail before tests can skip.
    hookTimeout: 60000,
    // Run test files one at a time — SAP has limited work processes and
    // parallel files exhaust them, causing "Service cannot be reached" errors.
    fileParallelism: false,
    // Run tests within each file sequentially to avoid SAP session conflicts
    sequence: {
      concurrent: false,
    },
    reporters: ['default', ['json', { outputFile: 'test-results/integration.json' }]],
  },
});
