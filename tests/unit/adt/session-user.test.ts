/**
 * "Who am I" for one ADT session (src/adt/session-user.ts).
 *
 * The body shape is REFERENCE-DERIVED: the `SystemInfo` type SAP Fiori tools declares for
 * `/sap/bc/adt/core/http/systeminformation` (`@sap-ux/axios-extension`) and the fields
 * vibing-steampunk reads from it — not a live capture (docs/research/2026-10-22-abap-debugger-one-shot-capture.md §7.3).
 */
import { describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import {
  getSessionUser,
  isPlausibleSapUser,
  parseSessionUser,
  SYSTEM_INFORMATION_PATH,
} from '../../../src/adt/session-user.js';

const SYSTEM_INFORMATION = JSON.stringify({
  systemID: 'A4H',
  client: '001',
  userName: 'developer',
  userFullName: 'Developer',
  language: 'EN',
});

function httpAnswering(get: ReturnType<typeof vi.fn>) {
  return { get } as unknown as AdtHttpClient;
}

describe('parseSessionUser', () => {
  it('returns the upper-cased userName', () => {
    expect(parseSessionUser(SYSTEM_INFORMATION)).toBe('DEVELOPER');
    expect(parseSessionUser('{"UserName":" cb9980000123 "}')).toBe('CB9980000123');
  });

  it('names nobody for e-mails, over-long or missing names, and non-JSON bodies', () => {
    expect(parseSessionUser('{"userName":"jane.doe@example.com"}')).toBeUndefined();
    expect(parseSessionUser('{"userName":"ABCDEFGHIJKLM"}')).toBeUndefined();
    expect(parseSessionUser('{"userName":""}')).toBeUndefined();
    expect(parseSessionUser('{"userFullName":"Developer"}')).toBeUndefined();
    expect(parseSessionUser('{"userName":42}')).toBeUndefined();
    expect(parseSessionUser('["DEVELOPER"]')).toBeUndefined();
    expect(parseSessionUser('<html>logon page</html>')).toBeUndefined();
  });

  it('accepts exactly what a logon user can be', () => {
    expect(isPlausibleSapUser('DEVELOPER')).toBe(true);
    expect(isPlausibleSapUser('ABCDEFGHIJKL')).toBe(true);
    expect(isPlausibleSapUser('A B')).toBe(false);
    expect(isPlausibleSapUser('')).toBe(false);
  });
});

describe('getSessionUser', () => {
  it("asks this session's systeminformation with SAP's own media type", async () => {
    const get = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: SYSTEM_INFORMATION });
    await expect(getSessionUser(httpAnswering(get), unrestrictedSafetyConfig())).resolves.toBe('DEVELOPER');
    expect(get).toHaveBeenCalledWith(
      SYSTEM_INFORMATION_PATH,
      { Accept: 'application/vnd.sap.adt.core.http.systeminformation.v1+json' },
      { suppressNotFoundLog: true },
    );
    expect(SYSTEM_INFORMATION_PATH).toBe('/sap/bc/adt/core/http/systeminformation');
  });

  it('reads an absent resource (SAP_BASIS 7.50 and older) as "SAP did not say"', async () => {
    for (const status of [404, 405, 406, 501]) {
      const get = vi.fn().mockRejectedValue(new AdtApiError('absent', status, SYSTEM_INFORMATION_PATH));
      await expect(getSessionUser(httpAnswering(get), unrestrictedSafetyConfig())).resolves.toBeUndefined();
    }
  });

  it('lets real failures through instead of hiding them behind a fallback', async () => {
    for (const status of [401, 403, 500]) {
      const get = vi.fn().mockRejectedValue(new AdtApiError('failed', status, SYSTEM_INFORMATION_PATH));
      await expect(getSessionUser(httpAnswering(get), unrestrictedSafetyConfig())).rejects.toMatchObject({
        statusCode: status,
      });
    }
    const network = vi.fn().mockRejectedValue(new Error('socket hang up'));
    await expect(getSessionUser(httpAnswering(network), unrestrictedSafetyConfig())).rejects.toThrow('socket hang up');
  });
});

// Where the release lacks systeminformation, only a `username` that IS the logon user may name the
// debug user — never a JWT display claim (src/handlers/debug.ts resolveDebugUser).
describe('usernameIsLogonUser (is `username` the SAP logon user or a display name?)', () => {
  const base = { baseUrl: 'http://sap:8000', safety: unrestrictedSafetyConfig() };

  it('is true for Basic auth and for SAP_USER beside operator cookies', () => {
    expect(new AdtClient({ ...base, username: 'admin', password: 'secret' }).usernameIsLogonUser).toBe(true);
    expect(new AdtClient({ ...base, username: 'admin', cookieString: 'MYSAPSSO2=x' }).usernameIsLogonUser).toBe(true);
    expect(
      new AdtClient({ ...base, username: 'admin', password: 'secret' }).withSafety(unrestrictedSafetyConfig())
        .usernameIsLogonUser,
    ).toBe(true);
  });

  it('is false when per-user tokens authenticate and `username` is only a JWT display claim', () => {
    const display = { ...base, username: 'JDOE' };
    expect(new AdtClient({ ...display, ppProxyAuth: 'Bearer pp' }).usernameIsLogonUser).toBe(false);
    expect(new AdtClient({ ...display, sapConnectivityAuth: 'saml' }).usernameIsLogonUser).toBe(false);
    expect(new AdtClient({ ...display, samlAuthorization: 'SAML2.0 x' }).usernameIsLogonUser).toBe(false);
    expect(new AdtClient({ ...display, bearerTokenProvider: async () => 'jwt' }).usernameIsLogonUser).toBe(false);
    expect(new AdtClient(base).usernameIsLogonUser).toBe(false);
  });
});
