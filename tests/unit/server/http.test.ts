import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { describe, expect, it } from 'vitest';
import { createStandardVerifier } from '../../../src/server/http.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

// These tests cover ARC-1's WIRING of the standard-mode verifier onto the
// `@arc-mcp/xsuaa-auth` package's chained verifier (constant-time api-key compare
// + hardened OIDC). The package ships its own 200+ tests for the verifier
// internals (scope extraction, fallback semantics, the `algorithms` allowlist,
// timing-safe docs/compare), so we only assert that ARC-1 maps `config.apiKeys`
// profiles to the right scopes/clientId and rejects unknown tokens — i.e. that
// the adoption preserves ARC-1's observable api-key contract.
describe('createStandardVerifier (api-key wiring)', () => {
  it('accepts a JWT-shaped viewer API key and marks it as API-key auth', async () => {
    const verifier = await createStandardVerifier({
      ...DEFAULT_CONFIG,
      apiKeys: [{ key: 'viewer.secret.value', profile: 'viewer' }],
    });

    const before = Math.floor(Date.now() / 1000);
    const auth = await verifier('viewer.secret.value');

    expect(auth.token).toBe('viewer.secret.value');
    expect(auth.clientId).toBe('api-key:viewer');
    expect(auth.scopes).toEqual(['read']);
    expect(auth.expiresAt).toBeGreaterThanOrEqual(before + 365 * 24 * 60 * 60 - 1);
  });

  it('accepts an admin API key and returns expanded admin scopes', async () => {
    const verifier = await createStandardVerifier({
      ...DEFAULT_CONFIG,
      apiKeys: [{ key: 'admin-secret', profile: 'admin' }],
    });

    const auth = await verifier('admin-secret');

    expect(auth.clientId).toBe('api-key:admin');
    expect(auth.scopes).toEqual(['admin', 'data', 'git', 'read', 'sql', 'transports', 'write']);
  });

  it('rejects an unknown bearer token when OIDC is not configured', async () => {
    const verifier = await createStandardVerifier({
      ...DEFAULT_CONFIG,
      apiKeys: [{ key: 'known-secret', profile: 'viewer' }],
    });

    await expect(verifier('unknown-secret')).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('drops api-key entries with an unknown profile (defense in depth)', async () => {
    // toApiKeyEntries skips profiles not in API_KEY_PROFILES, so a token whose
    // profile is bogus never matches — mirrors the old matchApiKey `undefined`.
    const verifier = await createStandardVerifier({
      ...DEFAULT_CONFIG,
      apiKeys: [{ key: 'bogus-secret', profile: 'not-a-real-profile' }],
    });

    await expect(verifier('bogus-secret')).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('rejects any token when neither api-keys nor OIDC are configured', async () => {
    const verifier = await createStandardVerifier({ ...DEFAULT_CONFIG });

    await expect(verifier('anything')).rejects.toBeInstanceOf(InvalidTokenError);
  });
});
