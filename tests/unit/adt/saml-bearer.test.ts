import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { SignedXml } from 'xml-crypto';
import {
  buildSamlBearerAssertion,
  loadSamlBearerIdp,
  resolveSamlNameId,
  SAML_NAMEID_FORMAT_EMAIL,
  SAML_NAMEID_FORMAT_UNSPECIFIED,
  type SamlBearerIdp,
} from '../../../src/adt/saml-bearer.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';

const fixture = (name: string) => fileURLToPath(new URL(`../../fixtures/saml/${name}`, import.meta.url));
const certPem = readFileSync(fixture('test-idp.crt'), 'utf8');

function idp(overrides: Partial<SamlBearerIdp> = {}): SamlBearerIdp {
  return {
    issuer: 'arc1-unit-test-saml-idp',
    audience: 'A4H_001',
    recipient: 'https://sap.example:50001',
    nameIdClaim: 'email',
    nameIdFormat: 'email',
    authnContextClassRef: 'urn:oasis:names:tc:SAML:2.0:ac:classes:PreviousSession',
    ttlSeconds: 300,
    privateKeyPem: readFileSync(fixture('test-idp.key'), 'utf8'),
    certificatePem: certPem,
    ...overrides,
  };
}

function jwtWith(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

function serverConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return { ...DEFAULT_CONFIG, url: 'https://sap.example:50001', ...overrides } as ServerConfig;
}

describe('buildSamlBearerAssertion', () => {
  it('produces a schema-shaped bearer assertion whose enveloped signature verifies with the certificate', () => {
    const now = new Date('2026-11-14T18:00:00Z');
    const result = buildSamlBearerAssertion(idp(), 'jane@example.com', now);

    expect(result.authorization.startsWith('SAML2.0 ')).toBe(true);
    expect(Buffer.from(result.authorization.slice('SAML2.0 '.length), 'base64').toString('utf8')).toBe(result.xml);
    expect(result.nameId).toBe('jane@example.com');
    expect(result.notOnOrAfter.toISOString()).toBe('2026-11-14T18:05:00.000Z');

    const doc = new DOMParser().parseFromString(result.xml, 'text/xml');
    const text = (tag: string) => doc.getElementsByTagNameNS('urn:oasis:names:tc:SAML:2.0:assertion', tag)[0];
    expect(text('Issuer')?.textContent).toBe('arc1-unit-test-saml-idp');
    expect(text('NameID')?.textContent).toBe('jane@example.com');
    expect(text('NameID')?.getAttribute('Format')).toBe(SAML_NAMEID_FORMAT_EMAIL);
    expect(text('Audience')?.textContent).toBe('A4H_001');
    expect(text('SubjectConfirmation')?.getAttribute('Method')).toBe('urn:oasis:names:tc:SAML:2.0:cm:bearer');
    expect(text('SubjectConfirmationData')?.getAttribute('Recipient')).toBe('https://sap.example:50001');
    expect(text('SubjectConfirmationData')?.getAttribute('NotOnOrAfter')).toBe('2026-11-14T18:05:00Z');
    expect(text('Conditions')?.getAttribute('NotBefore')).toBe('2026-11-14T17:59:00Z');
    expect(text('AuthnContextClassRef')?.textContent).toBe('urn:oasis:names:tc:SAML:2.0:ac:classes:PreviousSession');

    // ds:Signature must directly follow Issuer (SAML core schema order).
    const assertion = doc.documentElement!;
    const children = Array.from(assertion.childNodes).filter((n) => n.nodeType === 1);
    expect(children[0]?.localName).toBe('Issuer');
    expect(children[1]?.localName).toBe('Signature');

    const signature = doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0]!;
    const verifier = new SignedXml({ publicCert: certPem });
    verifier.loadSignature(signature);
    expect(verifier.checkSignature(result.xml)).toBe(true);
    expect(verifier.signatureAlgorithm).toBe('http://www.w3.org/2001/04/xmldsig-more#rsa-sha256');
  });

  it('rejects verification after tampering with the NameID', () => {
    const result = buildSamlBearerAssertion(idp(), 'jane@example.com');
    const tampered = result.xml.replace('jane@example.com', 'admin@example.com');
    const doc = new DOMParser().parseFromString(tampered, 'text/xml');
    const signature = doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0]!;
    const verifier = new SignedXml({ publicCert: certPem });
    verifier.loadSignature(signature);
    let valid: boolean;
    try {
      valid = verifier.checkSignature(tampered);
    } catch {
      valid = false;
    }
    expect(valid).toBe(false);
  });

  it('escapes XML metacharacters in the NameID and switches to the unspecified format', () => {
    const result = buildSamlBearerAssertion(idp({ nameIdFormat: 'unspecified' }), "O'BRIEN<&>");
    const doc = new DOMParser().parseFromString(result.xml, 'text/xml');
    const nameId = doc.getElementsByTagNameNS('urn:oasis:names:tc:SAML:2.0:assertion', 'NameID')[0];
    expect(nameId?.getAttribute('Format')).toBe(SAML_NAMEID_FORMAT_UNSPECIFIED);
    expect(nameId?.textContent).toBe("O'BRIEN<&>");
    expect(result.xml).not.toContain('<&>');
  });

  it('mints a unique ID per assertion', () => {
    const a = buildSamlBearerAssertion(idp(), 'jane@example.com');
    const b = buildSamlBearerAssertion(idp(), 'jane@example.com');
    expect(a.xml.match(/ID="(_[0-9a-f]{32})"/)?.[1]).not.toBe(b.xml.match(/ID="(_[0-9a-f]{32})"/)?.[1]);
  });
});

describe('resolveSamlNameId', () => {
  it('reads the configured claim from the verified JWT payload', () => {
    expect(resolveSamlNameId(jwtWith({ email: ' Jane@Example.com ' }), 'email')).toBe('Jane@Example.com');
    expect(resolveSamlNameId(jwtWith({ user_name: 'JDOE' }), 'user_name')).toBe('JDOE');
  });

  it('fails closed on a missing, empty, or non-string claim', () => {
    expect(() => resolveSamlNameId(jwtWith({ sub: 'x' }), 'email')).toThrow(/no usable 'email' claim/);
    expect(() => resolveSamlNameId(jwtWith({ email: '' }), 'email')).toThrow(/no usable 'email' claim/);
    expect(() => resolveSamlNameId(jwtWith({ email: ['a@b'] }), 'email')).toThrow(/no usable 'email' claim/);
    expect(() => resolveSamlNameId('not.a-jwt', 'email')).toThrow(/not decodable/);
  });
});

describe('loadSamlBearerIdp', () => {
  it('is disabled without a key file', () => {
    expect(loadSamlBearerIdp(serverConfig())).toBeUndefined();
  });

  it('loads key material and defaults the recipient to the SAP URL', () => {
    const loaded = loadSamlBearerIdp(
      serverConfig({
        samlIdpKeyFile: fixture('test-idp.key'),
        samlIdpCertFile: fixture('test-idp.crt'),
        samlIdpIssuer: 'arc1-unit-test-saml-idp',
        samlAudience: 'A4H_001',
      }),
    );
    expect(loaded).toMatchObject({
      issuer: 'arc1-unit-test-saml-idp',
      audience: 'A4H_001',
      recipient: 'https://sap.example:50001',
      nameIdClaim: 'email',
      nameIdFormat: 'email',
      ttlSeconds: 300,
    });
    expect(loaded?.privateKeyPem).toContain('PRIVATE KEY');
    expect(loaded?.certificatePem).toContain('BEGIN CERTIFICATE');
  });

  it('throws on incomplete trust parameters or non-PEM files', () => {
    expect(() => loadSamlBearerIdp(serverConfig({ samlIdpKeyFile: fixture('test-idp.key') }))).toThrow(
      /requires SAP_PP_SAML_IDP_CERT_FILE/,
    );
    expect(() =>
      loadSamlBearerIdp(
        serverConfig({
          samlIdpKeyFile: fixture('test-idp.crt'),
          samlIdpCertFile: fixture('test-idp.crt'),
          samlIdpIssuer: 'x',
          samlAudience: 'y',
        }),
      ),
    ).toThrow(/does not contain a PEM private key/);
  });
});
