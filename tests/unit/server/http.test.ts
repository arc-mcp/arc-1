import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { describe, expect, it } from 'vitest';
import { createStandardVerifier, extractOidcScopes } from '../../../src/server/http.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

describe('createStandardVerifier', () => {
  it('accepts a viewer API key and returns read-only auth info', async () => {
    const verifier = createStandardVerifier({
      ...DEFAULT_CONFIG,
      apiKeys: [{ key: 'viewer-secret', profile: 'viewer' }],
    });

    const before = Math.floor(Date.now() / 1000);
    const auth = await verifier('viewer-secret');

    expect(auth.token).toBe('viewer-secret');
    expect(auth.clientId).toBe('api-key:viewer');
    expect(auth.scopes).toEqual(['read']);
    expect(auth.expiresAt).toBeGreaterThanOrEqual(before + 365 * 24 * 60 * 60 - 1);
  });

  it('accepts an admin API key and returns expanded admin scopes', async () => {
    const verifier = createStandardVerifier({
      ...DEFAULT_CONFIG,
      apiKeys: [{ key: 'admin-secret', profile: 'admin' }],
    });

    const auth = await verifier('admin-secret');

    expect(auth.clientId).toBe('api-key:admin');
    expect(auth.scopes).toEqual(['admin', 'data', 'git', 'read', 'sql', 'transports', 'write']);
  });

  it('rejects an unknown bearer token when OIDC is not configured', async () => {
    const verifier = createStandardVerifier({
      ...DEFAULT_CONFIG,
      apiKeys: [{ key: 'known-secret', profile: 'viewer' }],
    });

    await expect(verifier('unknown-secret')).rejects.toBeInstanceOf(InvalidTokenError);
  });
});

describe('extractOidcScopes', () => {
  it('extracts scopes from space-separated string claim (standard OIDC)', () => {
    const scopes = extractOidcScopes({ scope: 'read write' });
    expect(scopes).toContain('read');
    expect(scopes).toContain('write');
  });

  it('extracts scopes from array claim (Azure AD style)', () => {
    const scopes = extractOidcScopes({ scp: ['read', 'data'] });
    expect(scopes).toContain('read');
    expect(scopes).toContain('data');
  });

  it('filters out unknown scopes', () => {
    const scopes = extractOidcScopes({ scope: 'read openid profile email write' });
    expect(scopes).toContain('read');
    expect(scopes).toContain('write');
    expect(scopes).not.toContain('openid');
    expect(scopes).not.toContain('profile');
    expect(scopes).not.toContain('email');
  });

  it('returns read-only when no scope claims present (safe default)', () => {
    const scopes = extractOidcScopes({ sub: 'user123' });
    expect(scopes).toEqual(['read']);
  });

  it('applies implied scope expansion: sql adds data', () => {
    const scopes = extractOidcScopes({ scope: 'sql' });
    expect(scopes).toContain('sql');
    expect(scopes).toContain('data');
  });

  it('applies implied scope expansion: write adds read', () => {
    const scopes = extractOidcScopes({ scope: 'write' });
    expect(scopes).toContain('write');
    expect(scopes).toContain('read');
  });

  it('returns minimum read when scopes are present but none are known', () => {
    const scopes = extractOidcScopes({ scope: 'openid profile email' });
    expect(scopes).toEqual(['read']);
  });

  it('prefers scope claim over scp claim', () => {
    const scopes = extractOidcScopes({ scope: 'read', scp: ['write', 'admin'] });
    expect(scopes).toContain('read');
    expect(scopes).not.toContain('admin');
  });

  it('handles empty scope string', () => {
    const scopes = extractOidcScopes({ scope: '' });
    expect(scopes).toEqual(['read']);
  });

  it('handles scp array with non-string values', () => {
    const scopes = extractOidcScopes({ scp: ['read', 42, null, 'write'] as unknown[] });
    expect(scopes).toContain('read');
    expect(scopes).toContain('write');
  });

  it('extracts scopes from scp as space-delimited string (Entra delegated tokens)', () => {
    const scopes = extractOidcScopes({ scp: 'read write data' });
    expect(scopes).toContain('read');
    expect(scopes).toContain('write');
    expect(scopes).toContain('data');
  });

  it('filters unknown scopes from scp string (Entra delegated tokens)', () => {
    const scopes = extractOidcScopes({ scp: 'User.Read read openid' });
    expect(scopes).toContain('read');
    expect(scopes).not.toContain('User.Read');
    expect(scopes).not.toContain('openid');
  });

  it('does not overgrant when scp is a string with no known scopes', () => {
    const scopes = extractOidcScopes({ scp: 'User.Read User.Write' });
    expect(scopes).toEqual(['read']);
  });
});
