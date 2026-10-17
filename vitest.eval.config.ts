import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/evals/**/*.test.ts'],
    // The comparative benchmark is explicitly opt-in; ordinary routing evals must not start it.
    exclude: process.env.DIAGNOSTIC_VALUE_EVAL === '1' ? [] : ['tests/evals/diagnostic-value.test.ts'],
    // LLM calls can be slow, especially with local models
    testTimeout: 120_000,
    // Run sequentially — avoid overwhelming Ollama with concurrent requests
    sequence: {
      concurrent: false,
    },
    // Reporters: console + JSON for parsing results
    reporters: ['default'],
  },
});
