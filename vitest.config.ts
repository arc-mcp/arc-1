import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['tests/integration/**'],
    testTimeout: 10000,
    // Ensure clean module state between tests
    isolate: true,
    // Keep supertest's requests on its own server (see the helper's comment).
    setupFiles: ['tests/helpers/supertest-loopback.ts'],
    reporters: ['default', ['json', { outputFile: 'test-results/unit.json' }]],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      // No thresholds — informational only for now
    },
  },
});
