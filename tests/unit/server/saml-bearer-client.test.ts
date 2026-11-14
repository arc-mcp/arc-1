import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SamlBearerIdp } from '../../../src/adt/saml-bearer.js';
import { createSamlBearerPerUserClient, loadSamlBearerIssuer } from '../../../src/server/saml-bearer-client.js';
import { buildAdtConfig } from '../../../src/server/server.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';

const fixture = (name: string) => fileURLToPath(new URL(`../../fixtures/saml/${name}`, import.meta.url));

const idp: SamlBearerIdp = {
  issuer: 'arc1-unit-test-saml-idp',
  audience: 'A4H_001',
  recipient: 'https://sap.example:50001',
  nameIdClaim: 'email',
  nameIdFormat: 'email',
  authnContextClassRef: 'urn:oasis:names:tc:SAML:2.0:ac:classes:PreviousSession',
  ttlSeconds: 300,
  privateKeyPem: readFileSync(fixture('test-idp.key'), 'utf8'),
  certificatePem: readFileSync(fixture('test-idp.crt'), 'utf8'),
};

const serverConfig: ServerConfig = {
  ...DEFAULT_CONFIG,
  url: 'https://sap.example:50001',
  username: 'STARTUP_TECH_USER',
  password: 'shared-secret',
  ppEnabled: true,
};

function jwtWith(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256' })}.${b64(payload)}.sig`;
}

const buildPerUserAdtConfig = () => buildAdtConfig(serverConfig, undefined, undefined, { perUser: true });

describe('createSamlBearerPerUserClient', () => {
  it('builds a request-local client carrying only the SAML Authorization header, never the shared password', () => {
    const result = createSamlBearerPerUserClient({
      idp,
      token: jwtWith({ sub: 'abc', email: 'jane@example.com' }),
      requestId: 'req-1',
      fallbackUser: 'oidc-user',
      buildPerUserAdtConfig,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nameId).toBe('jane@example.com');
    const cfg = result.client.http.config;
    expect(cfg.samlAuthorization?.startsWith('SAML2.0 ')).toBe(true);
    expect(cfg.username).toBe('jane@example.com');
    expect(cfg.password).toBeUndefined();
    expect(Object.keys(cfg.cookies ?? {})).toHaveLength(0);
    expect(cfg.baseUrl).toBe('https://sap.example:50001');
    const assertionXml = Buffer.from(cfg.samlAuthorization!.slice('SAML2.0 '.length), 'base64').toString('utf8');
    expect(assertionXml).toContain(
      '<saml2:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">jane@example.com',
    );
    expect(assertionXml).not.toContain('STARTUP_TECH_USER');
  });

  it('returns a tool error (no shared fallback) when the token lacks the NameID claim', () => {
    const result = createSamlBearerPerUserClient({
      idp,
      token: jwtWith({ sub: 'abc' }),
      requestId: 'req-2',
      buildPerUserAdtConfig,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.isError).toBe(true);
    expect(result.error.content[0]?.text).toMatch(/Principal propagation failed: .*no usable 'email' claim/);
  });
});

describe('loadSamlBearerIssuer', () => {
  it('returns undefined when the issuer is not configured', () => {
    expect(loadSamlBearerIssuer(serverConfig)).toBeUndefined();
  });

  it('loads the configured issuer', () => {
    const loaded = loadSamlBearerIssuer({
      ...serverConfig,
      samlIdpKeyFile: fixture('test-idp.key'),
      samlIdpCertFile: fixture('test-idp.crt'),
      samlIdpIssuer: 'arc1-unit-test-saml-idp',
      samlAudience: 'A4H_001',
    });
    expect(loaded?.issuer).toBe('arc1-unit-test-saml-idp');
    expect(loaded?.recipient).toBe('https://sap.example:50001');
  });
});
