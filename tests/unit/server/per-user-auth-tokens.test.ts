import { describe, expect, it } from 'vitest';
import { applyPerUserAuthTokens, buildAdtConfig } from '../../../src/server/server.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

// A per-user AdtClientConfig as createPerUserClient would build it: shared Basic creds
// stripped (perUser: true), URL pointing at the (cloud) target.
function baseConfig() {
  return buildAdtConfig(
    {
      ...DEFAULT_CONFIG,
      url: 'https://abc123.abap.us10.hana.ondemand.com',
      username: 'TECH',
      password: 'secret',
    },
    undefined,
    undefined,
    { perUser: true },
  );
}

describe('applyPerUserAuthTokens', () => {
  it('wires a destination-exchanged Bearer token (OAuth2UserTokenExchange, cloud-to-cloud) as a bearerTokenProvider', async () => {
    const cfg = applyPerUserAuthTokens(baseConfig(), { bearerToken: 'abap-user-token' }, 'jdoe@example.com', 'ABAP_PP');

    expect(cfg.bearerTokenProvider).toBeDefined();
    await expect(cfg.bearerTokenProvider?.()).resolves.toBe('abap-user-token');
    // Bearer path must clear shared Basic creds and must NOT set the on-prem (Cloud Connector) PP fields.
    expect(cfg.password).toBeUndefined();
    expect(cfg.username).toBe('jdoe@example.com');
    expect(cfg.sapConnectivityAuth).toBeUndefined();
    expect(cfg.ppProxyAuth).toBeUndefined();
  });

  it('prefers ppProxyAuth (Option 1) over a Bearer token when both are present', () => {
    const cfg = applyPerUserAuthTokens(
      baseConfig(),
      { ppProxyAuth: 'exchanged-jwt', bearerToken: 'abap-user-token' },
      'jdoe@example.com',
      'ABAP_PP',
    );

    expect(cfg.ppProxyAuth).toBe('exchanged-jwt');
    expect(cfg.bearerTokenProvider).toBeUndefined();
  });

  it('uses sapConnectivityAuth (Option 2) over a Bearer token when no ppProxyAuth', () => {
    const cfg = applyPerUserAuthTokens(
      baseConfig(),
      { sapConnectivityAuth: 'Bearer user-jwt', bearerToken: 'abap-user-token' },
      'jdoe@example.com',
      'ABAP_PP',
    );

    expect(cfg.sapConnectivityAuth).toBe('Bearer user-jwt');
    expect(cfg.bearerTokenProvider).toBeUndefined();
  });

  it('wires a SAMLAssertion Authorization header (S/4HANA Public Cloud, same flow as BAS)', () => {
    const cfg = applyPerUserAuthTokens(
      baseConfig(),
      { samlAssertionAuthorization: 'SAML2.0 ass=base64assertion' },
      'jdoe@example.com',
      'S4HC_PP',
    );

    expect(cfg.samlAuthorization).toBe('SAML2.0 ass=base64assertion');
    // SAML path must clear shared Basic creds and must NOT set the other per-user auth modes.
    expect(cfg.password).toBeUndefined();
    expect(cfg.username).toBe('jdoe@example.com');
    expect(cfg.bearerTokenProvider).toBeUndefined();
    expect(cfg.sapConnectivityAuth).toBeUndefined();
    expect(cfg.ppProxyAuth).toBeUndefined();
  });

  it('prefers a Bearer token over a SAML assertion when both are present', () => {
    const cfg = applyPerUserAuthTokens(
      baseConfig(),
      { bearerToken: 'abap-user-token', samlAssertionAuthorization: 'SAML2.0 ass=x' },
      'jdoe@example.com',
      'S4HC_PP',
    );

    expect(cfg.bearerTokenProvider).toBeDefined();
    expect(cfg.samlAuthorization).toBeUndefined();
  });

  it('throws when the Destination Service returns no usable per-user token', () => {
    expect(() => applyPerUserAuthTokens(baseConfig(), {}, 'jdoe@example.com', 'ABAP_PP')).toThrow(
      /Principal propagation failed for destination 'ABAP_PP'/,
    );
  });
});
