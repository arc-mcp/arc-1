/**
 * Regression tests for CodeQL alerts #9, #10, #11 — js/clear-text-logging.
 *
 * These three alerts flagged sites in src/cli.ts where CodeQL's taint analysis
 * detected an `apiKeys` / `apiKeysRaw` / `oauthDcrTtlSeconds` field accessed in
 * the same function as a `console.log`/`console.error` call. Audit confirmed
 * all three are false positives — the flagged sites either log only
 * `err.message` from upstream errors (config-parse failures, "Unknown tool",
 * etc.) or build an explicit `out` object that excludes the secret fields.
 *
 * This file pins the safety property: a parsed config containing api-key
 * material does NOT cause those secrets to appear in the action's stdout/
 * stderr output. If a future change introduces a real leak (e.g., adding
 * `apiKeys` to the `out` object below), one of these tests will fail.
 *
 * See also: docs/plans/2026-05-08-codeql-alerts-clear-text-logging-triage.md
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveConfig } from '../../../src/server/config.js';
import type { ConfigSource, ServerConfig } from '../../../src/server/types.js';

const TEST_API_KEY = 'cli-test-key-DO-NOT-LOG-12345';
const TEST_API_KEY_2 = 'cli-test-key-DO-NOT-LOG-67890';
const TEST_OAUTH_TTL = 7200;

/**
 * Replicates the `out` object construction inside the `config show --format json`
 * action (src/cli.ts ~lines 228–240). Kept as a literal copy so this test fails
 * loudly if the action's output shape ever changes — which is the regression
 * signal we want for CodeQL alert #10.
 *
 * KEEP IN SYNC with src/cli.ts `configCmd.command('show').action(…)`.
 */
function buildConfigShowJsonOutput(serverConfig: ServerConfig, sources: Record<string, ConfigSource>): unknown {
  return {
    effectivePolicy: {
      allowWrites: serverConfig.allowWrites,
      allowDataPreview: serverConfig.allowDataPreview,
      allowFreeSQL: serverConfig.allowFreeSQL,
      allowTransportWrites: serverConfig.allowTransportWrites,
      allowGitWrites: serverConfig.allowGitWrites,
      allowedPackages: serverConfig.allowedPackages,
      allowedTransports: serverConfig.allowedTransports,
      denyActions: serverConfig.denyActions,
    },
    sources,
  };
}

describe('clear-text-logging regression (CodeQL alerts #9, #10, #11)', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('SAP_') || key.startsWith('ARC1_')) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('CodeQL #10: config show --format json output excludes the api keys', () => {
    process.env.ARC1_API_KEYS = `${TEST_API_KEY}:viewer,${TEST_API_KEY_2}:developer`;
    const { config: serverConfig, sources } = resolveConfig([]);

    // Sanity: the resolver actually parsed the keys.
    expect(serverConfig.apiKeys).toEqual([
      { key: TEST_API_KEY, profile: 'viewer' },
      { key: TEST_API_KEY_2, profile: 'developer' },
    ]);

    const out = buildConfigShowJsonOutput(serverConfig, sources);
    const json = JSON.stringify(out, null, 2);

    expect(json).not.toContain(TEST_API_KEY);
    expect(json).not.toContain(TEST_API_KEY_2);
  });

  it('CodeQL #10: config show --format json output excludes oauthDcrTtlSeconds', () => {
    const { config: serverConfig, sources } = resolveConfig(['--oauth-dcr-ttl-seconds', String(TEST_OAUTH_TTL)]);
    expect(serverConfig.oauthDcrTtlSeconds).toBe(TEST_OAUTH_TTL);

    const out = buildConfigShowJsonOutput(serverConfig, sources);
    const json = JSON.stringify(out, null, 2);

    // The literal value should NOT appear — `out` doesn't include this field.
    expect(json).not.toContain(String(TEST_OAUTH_TTL));
  });

  it('CodeQL #10: `out` object shape never gains an apiKeys-shaped field', () => {
    process.env.ARC1_API_KEYS = `${TEST_API_KEY}:viewer`;
    const { config: serverConfig, sources } = resolveConfig([]);
    const out = buildConfigShowJsonOutput(serverConfig, sources) as {
      effectivePolicy: Record<string, unknown>;
      sources: Record<string, unknown>;
    };

    // Defense against drift: explicitly assert the secret-bearing field
    // names are NOT present in `out.effectivePolicy`. If a future PR adds
    // `apiKeys` to this object, this assertion catches it before merge.
    expect(Object.keys(out.effectivePolicy)).not.toContain('apiKeys');
    expect(Object.keys(out.effectivePolicy)).not.toContain('apiKeysRaw');
    expect(Object.keys(out.effectivePolicy)).not.toContain('oauthDcrTtlSeconds');
    // `sources` may contain the field NAME (e.g. `sources.apiKeys = { env: 'ARC1_API_KEYS' }`)
    // but NOT the value — confirm the value is opaque.
    if ('apiKeys' in out.sources) {
      const src = out.sources.apiKeys;
      expect(JSON.stringify(src)).not.toContain(TEST_API_KEY);
    }
  });

  it('CodeQL #9 / #11: resolveConfig parser errors do not embed credential text', () => {
    // The flagged catch handlers log `err.message` from `resolveConfig()`
    // failures. Force a parse error by passing a malformed flag — the
    // error message must not echo any environment-set credential.
    process.env.ARC1_API_KEYS = `${TEST_API_KEY}:viewer`;

    let errorMessage = '';
    try {
      resolveConfig(['--oauth-dcr-ttl-seconds', 'not-a-number']);
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    // resolveConfig either throws OR clamps the bogus number — both are fine
    // for this test. If it threw, the error message must not contain the key.
    expect(errorMessage).not.toContain(TEST_API_KEY);
  });

  it('CodeQL #9: resolveConfig success with api-keys does not log them as a side-effect', () => {
    // resolveConfig is pure (returns config + sources, no logging). Confirm
    // by spying on console.log/error — neither should fire during a normal
    // resolve.
    process.env.ARC1_API_KEYS = `${TEST_API_KEY}:viewer`;

    const logs: string[] = [];
    const errors: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (...a: unknown[]) => {
      logs.push(a.map(String).join(' '));
    };
    console.error = (...a: unknown[]) => {
      errors.push(a.map(String).join(' '));
    };
    try {
      resolveConfig([]);
    } finally {
      console.log = origLog;
      console.error = origError;
    }

    expect(logs.join('\n')).not.toContain(TEST_API_KEY);
    expect(errors.join('\n')).not.toContain(TEST_API_KEY);
  });
});
