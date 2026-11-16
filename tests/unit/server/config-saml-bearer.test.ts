import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseArgs, validateConfig } from '../../../src/server/config.js';

describe('experimental local SAML bearer issuer config', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('SAP_') || key.startsWith('ARC1_')) delete process.env[key];
    }
    process.env.SAP_URL = 'https://sap.example:50001';
    process.env.SAP_USER = 'STARTUP';
    process.env.SAP_PASSWORD = 'secret';
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  function setIssuer() {
    process.env.SAP_PP_SAML_IDP_KEY_FILE = '/keys/idp.key';
    process.env.SAP_PP_SAML_IDP_CERT_FILE = '/keys/idp.crt';
    process.env.SAP_PP_SAML_ISSUER = 'arc1-local-saml-idp';
    process.env.SAP_PP_SAML_AUDIENCE = 'A4H_001';
  }

  it('has no default NameID claim but defaults format, context and TTL', () => {
    const config = parseArgs([]);
    expect(config.samlIdpKeyFile).toBeUndefined();
    expect(config.samlNameIdClaim).toBeUndefined();
    expect(config.samlNameIdFormat).toBe('email');
    expect(config.samlAuthnContextClassRef).toBe('urn:oasis:names:tc:SAML:2.0:ac:classes:PreviousSession');
    expect(config.samlAssertionTtlSeconds).toBe(300);
    expect(() => validateConfig(config)).not.toThrow();
  });

  it('requires an explicit NameID claim whenever the issuer is configured', () => {
    setIssuer();
    process.env.SAP_PP_ENABLED = 'true';
    process.env.SAP_OIDC_ISSUER = 'https://tenant.accounts.ondemand.com';
    process.env.SAP_OIDC_AUDIENCE = 'arc1-client';
    expect(() => validateConfig(parseArgs([]))).toThrow(/requires SAP_PP_SAML_NAMEID_CLAIM/);
  });

  it('accepts a complete issuer with PP and OIDC enabled, clamping the TTL', () => {
    setIssuer();
    process.env.SAP_PP_ENABLED = 'true';
    process.env.SAP_PP_STRICT = 'false';
    process.env.SAP_OIDC_ISSUER = 'https://tenant.accounts.ondemand.com';
    process.env.SAP_OIDC_AUDIENCE = 'arc1-client';
    process.env.SAP_PP_SAML_TTL_SECONDS = '5';
    process.env.SAP_PP_SAML_NAMEID_CLAIM = 'user_name';
    process.env.SAP_PP_SAML_NAMEID_FORMAT = 'unspecified';
    process.env.SAP_PP_SAML_RECIPIENT = 'https://sap.example:50001/sap/bc/adt';
    const config = parseArgs([]);
    expect(config.samlIdpKeyFile).toBe('/keys/idp.key');
    expect(config.samlAssertionTtlSeconds).toBe(30);
    expect(config.samlNameIdClaim).toBe('user_name');
    expect(config.samlNameIdFormat).toBe('unspecified');
    expect(config.samlRecipient).toBe('https://sap.example:50001/sap/bc/adt');
    expect(() => validateConfig(config)).not.toThrow();
  });

  it('rejects an invalid NameID format', () => {
    process.env.SAP_PP_SAML_NAMEID_FORMAT = 'persistent';
    expect(() => parseArgs([])).toThrow(/SAP_PP_SAML_NAMEID_FORMAT must be email or unspecified/);
  });

  it('fails closed on a half-configured issuer', () => {
    process.env.SAP_PP_SAML_IDP_KEY_FILE = '/keys/idp.key';
    process.env.SAP_PP_ENABLED = 'true';
    process.env.SAP_OIDC_ISSUER = 'https://tenant.accounts.ondemand.com';
    process.env.SAP_OIDC_AUDIENCE = 'arc1-client';
    expect(() => validateConfig(parseArgs([]))).toThrow(/needs all of SAP_PP_SAML_IDP_KEY_FILE/);
  });

  it('requires SAP_PP_ENABLED and an OIDC issuer', () => {
    setIssuer();
    process.env.SAP_PP_SAML_NAMEID_CLAIM = 'email';
    process.env.SAP_OIDC_ISSUER = 'https://tenant.accounts.ondemand.com';
    process.env.SAP_OIDC_AUDIENCE = 'arc1-client';
    expect(() => validateConfig(parseArgs([]))).toThrow(/requires SAP_PP_ENABLED=true/);

    delete process.env.SAP_OIDC_ISSUER;
    delete process.env.SAP_OIDC_AUDIENCE;
    process.env.SAP_PP_ENABLED = 'true';
    expect(() => validateConfig(parseArgs([]))).toThrow(/requires SAP_OIDC_ISSUER/);
  });

  it('refuses to combine with multi-target mode or XSUAA', () => {
    setIssuer();
    process.env.SAP_PP_SAML_NAMEID_CLAIM = 'email';
    process.env.SAP_PP_ENABLED = 'true';
    process.env.SAP_OIDC_ISSUER = 'https://tenant.accounts.ondemand.com';
    process.env.SAP_OIDC_AUDIENCE = 'arc1-client';
    process.env.SAP_XSUAA_AUTH = 'true';
    expect(() => validateConfig(parseArgs([]))).toThrow(/cannot combine with multi-target mode or XSUAA/);
  });
});
