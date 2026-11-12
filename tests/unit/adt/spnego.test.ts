import { describe, expect, it } from 'vitest';
import {
  createSpnegoTokenAcquirer,
  deriveSpn,
  normalizeSpn,
  resolveSpn,
  SpnegoAuthError,
  SpnegoUnavailableError,
  spnegoUnavailableMessage,
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
  // These assert the Alpine / win32-arm64 / .mcpb situation. They must not depend on whether the
  // optional module happens to be built in the environment running the suite — it is absent in CI
  // and present on a developer box that ran `npm rebuild kerberos`.
  it('reports an actionable error naming the platform and the packagings without a prebuild', () => {
    const message = spnegoUnavailableMessage();
    expect(message).toContain(`${process.platform}/${process.arch}`);
    expect(message).toContain('npm rebuild kerberos');
    expect(message).toMatch(/win32-x64/);
    expect(message).toMatch(/musl|Alpine/);
    expect(message).toContain('SAP_COOKIE_FILE');
  });

  it('never falls back to an unauthenticated request when the module cannot load', async () => {
    // The acquirer must reject, not resolve to an empty token: resolving would let the caller send
    // a request with no credential at all.
    const acquire = createSpnegoTokenAcquirer(async () => {
      throw new SpnegoUnavailableError(spnegoUnavailableMessage());
    });
    await expect(acquire('HTTP/sap.example.com')).rejects.toBeInstanceOf(SpnegoUnavailableError);
  });
});

describe('SPNEGO mechanism selection', () => {
  /** A stand-in for the native module, so the assertion does not need a built binary. */
  function fakeKerberos(overrides: Record<string, unknown> = {}) {
    const calls: Array<{ service: string; options?: Record<string, unknown> }> = [];
    const module = {
      GSS_MECH_OID_SPNEGO: 6,
      initializeClient: async (service: string, options?: Record<string, unknown>) => {
        calls.push({ service, options });
        return { step: async () => 'dG9rZW4=' };
      },
      ...overrides,
    };
    return { module, calls };
  }

  it('requests the SPNEGO mechanism, not the raw Kerberos default', async () => {
    // The HTTP `Negotiate` scheme carries SPNEGO tokens. The module's default mech selects the
    // Windows "Kerberos" SSP, whose bare AP-REQ a SPNEGO-configured SAP ICM rejects with 401 —
    // after happily issuing the service ticket, so the failure mimics an SPN problem.
    const { module, calls } = fakeKerberos();
    const token = await createSpnegoTokenAcquirer(async () => module)('HTTP/sap.example.com');
    expect(token).toBe('dG9rZW4=');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.service).toBe('HTTP/sap.example.com');
    expect(calls[0]?.options).toEqual({ mechOID: 6 });
  });

  it('never passes a guessed mech OID when the module stops exporting the constant', async () => {
    // Hard-coding the number would let a future constant change silently send the wrong mechanism;
    // omitting the option falls back to the module's own default instead.
    const { module, calls } = fakeKerberos({ GSS_MECH_OID_SPNEGO: undefined });
    await createSpnegoTokenAcquirer(async () => module)('HTTP/sap.example.com');
    expect(calls[0]?.options).toEqual({});
  });

  it('passes no credential, so SSPI/GSSAPI uses the process identity', async () => {
    const { module, calls } = fakeKerberos();
    await createSpnegoTokenAcquirer(async () => module)('HTTP/sap.example.com');
    expect(calls[0]?.options).not.toHaveProperty('user');
    expect(calls[0]?.options).not.toHaveProperty('pass');
    expect(calls[0]?.options).not.toHaveProperty('principal');
  });
});

describe('SPNEGO downgrade refusal', () => {
  /** Base64 of "NTLMSSP\0\x01…" — what SSPI hands back when it cannot get a service ticket. */
  const NTLM_TYPE1 = 'TlRMTVNTUAABAAAAl4II4gAAAAAAAAAAAAAAAAAAAAAKADk4AAAADw==';

  it('refuses an NTLM token instead of sending a silent downgrade', async () => {
    // Selecting the SPNEGO mech means the Windows "Negotiate" SSP, which falls back to NTLM rather
    // than failing when the SPN has no ticket. Sending it would log the operator on over a weaker
    // protocol with no mutual auth, and hide the real fault (almost always a wrong SPN).
    const module = {
      GSS_MECH_OID_SPNEGO: 6,
      initializeClient: async () => ({ step: async () => NTLM_TYPE1 }),
    };
    const acquire = createSpnegoTokenAcquirer(async () => module);

    await expect(acquire('HTTP/wrong.example.com')).rejects.toBeInstanceOf(SpnegoAuthError);
    await expect(acquire('HTTP/wrong.example.com')).rejects.toThrow(/NTLM token.*not a Kerberos one/s);
    await expect(acquire('HTTP/wrong.example.com')).rejects.toThrow(/SAP_SPNEGO_SPN/);
  });

  it('accepts a SPNEGO token, which is what a real ticket produces', async () => {
    const module = {
      GSS_MECH_OID_SPNEGO: 6,
      initializeClient: async () => ({ step: async () => 'YIGyBgYrBgEFBQKggacwgaSg' }),
    };
    await expect(createSpnegoTokenAcquirer(async () => module)('HTTP/sap.example.com')).resolves.toBe(
      'YIGyBgYrBgEFBQKggacwgaSg',
    );
  });
});
