import { describe, expect, it } from 'vitest';
import {
  createSpnegoTokenAcquirer,
  deriveSpn,
  normalizeSpn,
  resolveSpn,
  SpnegoAuthError,
  SpnegoUnavailableError,
} from '../../../src/adt/spnego.js';

describe('SPNEGO service principal names', () => {
  it('derives HTTP/<host> from the SAP base URL', () => {
    expect(deriveSpn('https://sapdev.corp.example.com:44300/sap/bc')).toBe('HTTP/sapdev.corp.example.com');
    expect(deriveSpn('http://sap.example.com')).toBe('HTTP/sap.example.com');
  });

  it('does not canonicalize the host — an alias stays the alias', () => {
    // The SPN must be predictable and auditable; a reverse lookup would make it depend on DNS state.
    expect(deriveSpn('https://sap-alias.example.com')).toBe('HTTP/sap-alias.example.com');
  });

  it('strips IPv6 brackets so the KDC error names a readable principal', () => {
    expect(deriveSpn('https://[2001:db8::1]:44300')).toBe('HTTP/2001:db8::1');
  });

  it('rejects a base URL it cannot parse', () => {
    expect(() => deriveSpn('')).toThrow(SpnegoAuthError);
    expect(() => deriveSpn('not-a-url')).toThrow(/valid SAP_URL/);
  });

  it('accepts a bare host override and prefixes the HTTP service class', () => {
    expect(normalizeSpn('sap.example.com')).toBe('HTTP/sap.example.com');
    expect(normalizeSpn('  HTTP/sap.example.com  ')).toBe('HTTP/sap.example.com');
  });

  it('keeps a non-HTTP service class the operator supplied', () => {
    expect(normalizeSpn('SAP/sapdev.example.com')).toBe('SAP/sapdev.example.com');
  });

  it('rejects an empty or non-printable override', () => {
    expect(() => normalizeSpn('   ')).toThrow(/empty/);
    expect(() => normalizeSpn('HTTP/sap host')).toThrow(/printable ASCII/);
    expect(() => normalizeSpn('HTTP/sap\u0000host')).toThrow(/printable ASCII/);
  });

  it('prefers the explicit override over the derived SPN', () => {
    expect(resolveSpn('https://alias.example.com', 'physical.example.com')).toBe('HTTP/physical.example.com');
    expect(resolveSpn('https://alias.example.com', undefined)).toBe('HTTP/alias.example.com');
  });
});

describe('SPNEGO token acquisition without the native module', () => {
  it('reports an actionable error naming the platform and the packagings without a prebuild', async () => {
    // `kerberos` is an optionalDependency and is absent in this test environment, which is exactly
    // the Alpine / win32-arm64 / .mcpb situation operators hit.
    const acquire = createSpnegoTokenAcquirer();
    await expect(acquire('HTTP/sap.example.com')).rejects.toBeInstanceOf(SpnegoUnavailableError);
    await expect(acquire('HTTP/sap.example.com')).rejects.toThrow(
      new RegExp(`optional 'kerberos' native module.*${process.platform}/${process.arch}`, 's'),
    );
  });

  it('never falls back to an unauthenticated request', async () => {
    // The acquirer must reject, not resolve to an empty token: resolving would let the caller send
    // a request with no credential at all.
    await expect(createSpnegoTokenAcquirer()('HTTP/sap.example.com')).rejects.toThrow();
  });
});
