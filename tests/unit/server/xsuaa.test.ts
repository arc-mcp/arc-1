/**
 * Tests for the XSUAA chained token verifier and helpers. The DCR client
 * store is covered separately in `stateless-client-store.test.ts`.
 */

import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { describe, expect, it, vi } from 'vitest';
import { createChainedTokenVerifier } from '../../../src/server/xsuaa.js';

// ─── createChainedTokenVerifier ──────────────────────────────────────

describe('createChainedTokenVerifier', () => {
  it('returns API key auth when token matches (multi-key admin profile)', async () => {
    const verifier = createChainedTokenVerifier({
      apiKeys: [{ key: 'my-key', profile: 'admin' }],
    });
    const result = await verifier('my-key');
    expect(result.clientId).toBe('api-key:admin');
    expect(result.scopes).toContain('admin');
    expect(result.scopes).toContain('read');
    expect(result.scopes).toContain('write');
    expect(result.scopes).toContain('transports');
    expect(result.scopes).toContain('git');
    // Must have expiresAt for MCP SDK's requireBearerAuth middleware
    expect(result.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('throws when API key does not match and no other verifiers', async () => {
    const verifier = createChainedTokenVerifier({
      apiKeys: [{ key: 'my-key', profile: 'viewer' }],
    });
    await expect(verifier('wrong-key')).rejects.toThrow('Token validation failed');
  });

  it('tries XSUAA verifier first', async () => {
    const xsuaaVerifier = vi.fn().mockResolvedValue({
      token: 'xsuaa-token',
      clientId: 'xsuaa-client',
      scopes: ['read'],
      extra: {},
    } satisfies AuthInfo);

    const verifier = createChainedTokenVerifier({ apiKeys: [{ key: 'my-key', profile: 'viewer' }] }, xsuaaVerifier);
    const result = await verifier('xsuaa-token');
    expect(result.clientId).toBe('xsuaa-client');
    expect(xsuaaVerifier).toHaveBeenCalledWith('xsuaa-token');
  });

  it('falls through to OIDC when XSUAA fails', async () => {
    const xsuaaVerifier = vi.fn().mockRejectedValue(new Error('Invalid token'));
    const oidcVerifier = vi.fn().mockResolvedValue({
      token: 'oidc-token',
      clientId: 'oidc-client',
      scopes: ['read', 'write', 'admin'],
      extra: {},
    } satisfies AuthInfo);

    const verifier = createChainedTokenVerifier({}, xsuaaVerifier, oidcVerifier);
    const result = await verifier('oidc-token');
    expect(result.clientId).toBe('oidc-client');
    expect(xsuaaVerifier).toHaveBeenCalled();
    expect(oidcVerifier).toHaveBeenCalled();
  });

  it('falls through to API key when both XSUAA and OIDC fail', async () => {
    const xsuaaVerifier = vi.fn().mockRejectedValue(new Error('XSUAA fail'));
    const oidcVerifier = vi.fn().mockRejectedValue(new Error('OIDC fail'));

    const verifier = createChainedTokenVerifier(
      { apiKeys: [{ key: 'my-key', profile: 'admin' }] },
      xsuaaVerifier,
      oidcVerifier,
    );
    const result = await verifier('my-key');
    expect(result.clientId).toBe('api-key:admin');
  });

  it('throws when all verifiers fail and no API key', async () => {
    const xsuaaVerifier = vi.fn().mockRejectedValue(new Error('XSUAA fail'));
    const oidcVerifier = vi.fn().mockRejectedValue(new Error('OIDC fail'));

    const verifier = createChainedTokenVerifier({}, xsuaaVerifier, oidcVerifier);
    await expect(verifier('invalid-token')).rejects.toThrow('Token validation failed');
    await expect(verifier('invalid-token')).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('works with no verifiers configured', async () => {
    const verifier = createChainedTokenVerifier({});
    await expect(verifier('any-token')).rejects.toThrow('Token validation failed');
    await expect(verifier('any-token')).rejects.toBeInstanceOf(InvalidTokenError);
  });

  // --- Multi-key API key support ---

  it('matches multi-key with viewer profile', async () => {
    const verifier = createChainedTokenVerifier({
      apiKeys: [{ key: 'viewer-key', profile: 'viewer' }],
    });
    const result = await verifier('viewer-key');
    expect(result.clientId).toBe('api-key:viewer');
    expect(result.scopes).toEqual(['read']);
    expect(result.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('matches multi-key with developer-sql profile (includes transports, git, data, sql)', async () => {
    const verifier = createChainedTokenVerifier({
      apiKeys: [{ key: 'dev-key', profile: 'developer-sql' }],
    });
    const result = await verifier('dev-key');
    expect(result.clientId).toBe('api-key:developer-sql');
    // developer-sql now includes transports + git per new API_KEY_PROFILES
    expect(result.scopes).toContain('read');
    expect(result.scopes).toContain('write');
    expect(result.scopes).toContain('data');
    expect(result.scopes).toContain('sql');
    expect(result.scopes).toContain('transports');
    expect(result.scopes).toContain('git');
  });

  it('matches correct key from multiple apiKeys', async () => {
    const verifier = createChainedTokenVerifier({
      apiKeys: [
        { key: 'viewer-key', profile: 'viewer' },
        { key: 'dev-key', profile: 'developer' },
      ],
    });
    const viewerResult = await verifier('viewer-key');
    expect(viewerResult.scopes).toEqual(['read']);

    const devResult = await verifier('dev-key');
    // developer now has read, write, transports, git
    expect(devResult.scopes).toContain('read');
    expect(devResult.scopes).toContain('write');
    expect(devResult.scopes).toContain('transports');
    expect(devResult.scopes).toContain('git');
  });

  it('rejects unknown key when only apiKeys is configured', async () => {
    const verifier = createChainedTokenVerifier({
      apiKeys: [{ key: 'known-key', profile: 'viewer' }],
    });
    await expect(verifier('unknown-key')).rejects.toThrow('Token validation failed');
  });
});

// ─── XSUAA scope extraction (via chained verifier mock) ────────────

describe('XSUAA scope extraction and implied expansion', () => {
  it('extracts data scope from XSUAA token', async () => {
    const xsuaaVerifier = vi.fn().mockImplementation(async () => ({
      token: 'tok',
      clientId: 'xsuaa-client',
      scopes: ['read', 'data'],
      extra: {},
    }));
    const verifier = createChainedTokenVerifier({}, xsuaaVerifier);
    const result = await verifier('tok');
    expect(result.scopes).toContain('data');
    expect(result.scopes).toContain('read');
  });

  it('extracts sql scope from XSUAA token', async () => {
    const xsuaaVerifier = vi.fn().mockImplementation(async () => ({
      token: 'tok',
      clientId: 'xsuaa-client',
      scopes: ['read', 'sql', 'data'],
      extra: {},
    }));
    const verifier = createChainedTokenVerifier({}, xsuaaVerifier);
    const result = await verifier('tok');
    expect(result.scopes).toContain('sql');
    expect(result.scopes).toContain('data');
  });

  it('legacy tokens with only read/write/admin still work', async () => {
    const xsuaaVerifier = vi.fn().mockImplementation(async () => ({
      token: 'tok',
      clientId: 'xsuaa-client',
      scopes: ['read', 'write', 'admin'],
      extra: {},
    }));
    const verifier = createChainedTokenVerifier({}, xsuaaVerifier);
    const result = await verifier('tok');
    expect(result.scopes).toEqual(['read', 'write', 'admin']);
    expect(result.scopes).not.toContain('data');
    expect(result.scopes).not.toContain('sql');
  });
});

// ─── createXsuaaTokenVerifier implied scope expansion ───────────────

describe('expandScopes (scope expansion integration)', () => {
  it('admin scope implies all 7 scopes', async () => {
    const { expandScopes } = await import('../../../src/authz/policy.js');
    const result = expandScopes(['admin']);
    expect(result).toContain('read');
    expect(result).toContain('write');
    expect(result).toContain('data');
    expect(result).toContain('sql');
    expect(result).toContain('transports');
    expect(result).toContain('git');
    expect(result).toContain('admin');
    expect(result.length).toBe(7);
  });

  it('write implies read', async () => {
    const { expandScopes } = await import('../../../src/authz/policy.js');
    expect(expandScopes(['write']).sort()).toEqual(['read', 'write']);
  });

  it('sql implies data', async () => {
    const { expandScopes } = await import('../../../src/authz/policy.js');
    expect(expandScopes(['sql']).sort()).toEqual(['data', 'sql']);
  });
});

// ─── createXsuaaOAuthProvider ────────────────────────────────────────

// Stub credentials shape — enough for createXsuaaOAuthProvider to construct.
// JWKS / network calls are lazy and only happen on first token verification,
// so factory-level construction works fine in unit tests.
const STUB_XSUAA_CREDS = {
  clientid: 'sb-stub!t1',
  clientsecret: 'stub-xsuaa-clientsecret-40-chars-long-AAAA',
  url: 'https://stub.authentication.eu10.hana.ondemand.com',
  xsappname: 'arc1',
  uaadomain: 'authentication.eu10.hana.ondemand.com',
  verificationkey: '-----BEGIN PUBLIC KEY-----\nstub\n-----END PUBLIC KEY-----',
};

describe('createXsuaaOAuthProvider', () => {
  it('createXsuaaTokenVerifier returns a function', async () => {
    const { createXsuaaTokenVerifier } = await import('../../../src/server/xsuaa.js');
    expect(typeof createXsuaaTokenVerifier).toBe('function');
  });

  it('defaults to dcrSigningSource: xsuaa when dcrSigningSecret is omitted', async () => {
    const { createXsuaaOAuthProvider } = await import('../../../src/server/xsuaa.js');
    const { logger } = await import('../../../src/server/logger.js');
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    try {
      const result = createXsuaaOAuthProvider(STUB_XSUAA_CREDS, 'https://arc1.example.com');
      expect(result.clientStore).toBeDefined();
      expect(infoSpy).toHaveBeenCalledWith(
        'XSUAA OAuth provider created (stateless DCR)',
        expect.objectContaining({ dcrSigningSource: 'xsuaa' }),
      );
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('uses dcrSigningSource: env when a valid dcrSigningSecret is provided', async () => {
    const { createXsuaaOAuthProvider } = await import('../../../src/server/xsuaa.js');
    const { logger } = await import('../../../src/server/logger.js');
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    try {
      createXsuaaOAuthProvider(STUB_XSUAA_CREDS, 'https://arc1.example.com', {
        dcrSigningSecret: 'a-real-32-byte-secret-string-OK!',
      });
      expect(infoSpy).toHaveBeenCalledWith(
        'XSUAA OAuth provider created (stateless DCR)',
        expect.objectContaining({ dcrSigningSource: 'env' }),
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('DCR signing key uses dedicated ARC1_DCR_SIGNING_SECRET'),
      );
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('falls back to xsuaa source when dcrSigningSecret is empty string (with warn)', async () => {
    const { createXsuaaOAuthProvider } = await import('../../../src/server/xsuaa.js');
    const { logger } = await import('../../../src/server/logger.js');
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      const result = createXsuaaOAuthProvider(STUB_XSUAA_CREDS, 'https://arc1.example.com', {
        dcrSigningSecret: '',
      });
      expect(result.clientStore).toBeDefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ARC1_DCR_SIGNING_SECRET was set but is empty'));
      expect(infoSpy).toHaveBeenCalledWith(
        'XSUAA OAuth provider created (stateless DCR)',
        expect.objectContaining({ dcrSigningSource: 'xsuaa' }),
      );
    } finally {
      infoSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('falls back to xsuaa source when dcrSigningSecret is whitespace-only (with warn)', async () => {
    const { createXsuaaOAuthProvider } = await import('../../../src/server/xsuaa.js');
    const { logger } = await import('../../../src/server/logger.js');
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      const result = createXsuaaOAuthProvider(STUB_XSUAA_CREDS, 'https://arc1.example.com', {
        dcrSigningSecret: '   \t  ',
      });
      expect(result.clientStore).toBeDefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ARC1_DCR_SIGNING_SECRET was set but is empty'));
      expect(infoSpy).toHaveBeenCalledWith(
        'XSUAA OAuth provider created (stateless DCR)',
        expect.objectContaining({ dcrSigningSource: 'xsuaa' }),
      );
    } finally {
      infoSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('emits the TTL-disabled INFO line when dcrTtlSeconds <= 0', async () => {
    const { createXsuaaOAuthProvider } = await import('../../../src/server/xsuaa.js');
    const { logger } = await import('../../../src/server/logger.js');
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    try {
      createXsuaaOAuthProvider(STUB_XSUAA_CREDS, 'https://arc1.example.com', { dcrTtlSeconds: 0 });
      expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('DCR client_id TTL is disabled'));
    } finally {
      infoSpy.mockRestore();
    }
  });
});

// ─── getAppUrl ───────────────────────────────────────────────────────

describe('getAppUrl', () => {
  it('extracts app URL from VCAP_APPLICATION', async () => {
    const { getAppUrl } = await import('../../../src/adt/btp.js');

    const originalEnv = process.env.VCAP_APPLICATION;
    process.env.VCAP_APPLICATION = JSON.stringify({
      application_uris: ['arc1-mcp-server.cfapps.us10-001.hana.ondemand.com'],
    });

    expect(getAppUrl()).toBe('https://arc1-mcp-server.cfapps.us10-001.hana.ondemand.com');

    process.env.VCAP_APPLICATION = originalEnv;
  });

  it('returns undefined when VCAP_APPLICATION is not set', async () => {
    const { getAppUrl } = await import('../../../src/adt/btp.js');

    const originalEnv = process.env.VCAP_APPLICATION;
    delete process.env.VCAP_APPLICATION;

    expect(getAppUrl()).toBeUndefined();

    process.env.VCAP_APPLICATION = originalEnv;
  });

  it('returns undefined for invalid JSON', async () => {
    const { getAppUrl } = await import('../../../src/adt/btp.js');

    const originalEnv = process.env.VCAP_APPLICATION;
    process.env.VCAP_APPLICATION = 'not-json';

    expect(getAppUrl()).toBeUndefined();

    process.env.VCAP_APPLICATION = originalEnv;
  });

  it('falls back to uris field', async () => {
    const { getAppUrl } = await import('../../../src/adt/btp.js');

    const originalEnv = process.env.VCAP_APPLICATION;
    process.env.VCAP_APPLICATION = JSON.stringify({
      uris: ['my-app.cfapps.eu10.hana.ondemand.com'],
    });

    expect(getAppUrl()).toBe('https://my-app.cfapps.eu10.hana.ondemand.com');

    process.env.VCAP_APPLICATION = originalEnv;
  });
});
