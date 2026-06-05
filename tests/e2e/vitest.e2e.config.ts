import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['tests/helpers/skip-telemetry-setup.ts', 'tests/e2e/global-setup.ts'],
    include: ['tests/e2e/**/*.e2e.test.ts'],
    // SAP can be slow — allow 120s per test (BAPIRET2 where-used, DDLX reads, dump triggers)
    testTimeout: 120_000,
    // Hook timeout — setup/teardown may create objects on SAP
    hookTimeout: 120_000,
    // Run test files one at a time — all E2E tests share a single MCP server
    // backed by one SAP connection. Parallel files cause request queuing,
    // timeouts, and cascade failures when the transport breaks.
    fileParallelism: false,
    // Run tests within each file sequentially
    sequence: {
      concurrent: false,
    },
    // Reporters: console + JUnit XML for GH Actions artifact
    reporters: [
      'default',
      [
        'junit',
        {
          outputFile: process.env.E2E_LOG_DIR
            ? `${process.env.E2E_LOG_DIR}/junit-results.xml`
            : '/tmp/arc1-e2e-logs/junit-results.xml',
        },
      ],
      [
        'json',
        {
          outputFile: process.env.E2E_LOG_DIR ? `${process.env.E2E_LOG_DIR}/e2e.json` : 'test-results/e2e.json',
        },
      ],
    ],
  },
});
