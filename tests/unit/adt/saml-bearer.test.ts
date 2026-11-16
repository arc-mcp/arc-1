import { DOMParser } from '@xmldom/xmldom';
import { afterAll, describe, expect, it, vi } from 'vitest';
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
import { makeSamlMaterial } from '../../helpers/saml-material.js';

const material = makeSamlMaterial();
const certPem = material.certificatePem;
afterAll(material.cleanup);

function idp(overrides: Partial<SamlBearerIdp> = {}): SamlBearerIdp {
  return {
    issuer: 'arc1-unit-test-saml-idp',
    audience: 'A4H_001',
    recipient: 'https://sap.example:50001',
    nameIdClaim: 'email',
    nameIdFormat: 'email',
    authnContextClassRef: 'urn:oasis:names:tc:SAML:2.0:ac:classes:PreviousSession',
    ttlSeconds: 300,
    privateKeyPem: material.privateKeyPem,
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
    const verifier = new SignedXml({ publicCert: material.publicKeyPem });
    verifier.loadSignature(signature);
    expect(verifier.checkSignature(result.xml)).toBe(true);
    expect(verifier.signatureAlgorithm).toBe('http://www.w3.org/2001/04/xmldsig-more#rsa-sha256');
  });

  it('rejects verification after tampering with the NameID', () => {
    const result = buildSamlBearerAssertion(idp(), 'jane@example.com');
    const tampered = result.xml.replace('jane@example.com', 'admin@example.com');
    const doc = new DOMParser().parseFromString(tampered, 'text/xml');
    const signature = doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0]!;
    const verifier = new SignedXml({ publicCert: material.publicKeyPem });
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
    expect(resolveSamlNameId(jwtWith({ email: ' Jane@Example.com ', email_verified: true }), 'email')).toBe(
      'Jane@Example.com',
    );
    expect(resolveSamlNameId(jwtWith({ user_name: 'JDOE' }), 'user_name')).toBe('JDOE');
  });

  it('fails closed on a missing, empty, or non-string claim', () => {
    expect(() => resolveSamlNameId(jwtWith({ sub: 'x' }), 'email')).toThrow(/no usable 'email' claim/);
    expect(() => resolveSamlNameId(jwtWith({ email: '' }), 'email')).toThrow(/no usable 'email' claim/);
    expect(() => resolveSamlNameId(jwtWith({ email: ['a@b'] }), 'email')).toThrow(/no usable 'email' claim/);
    expect(() => resolveSamlNameId('not.a-jwt', 'email')).toThrow(/not decodable/);
  });

  it('requires a boolean verified email and rejects controls or long NameIDs', () => {
    for (const email_verified of [undefined, false, 'true']) {
      expect(() => resolveSamlNameId(jwtWith({ email: 'a@example.com', email_verified }), 'email')).toThrow(
        /email_verified === true/,
      );
    }
    expect(() => resolveSamlNameId(jwtWith({ user_name: 'A\nB' }), 'user_name')).toThrow(/contains controls/);
    expect(() => resolveSamlNameId(jwtWith({ user_name: '\nA' }), 'user_name')).toThrow(/contains controls/);
    expect(() => resolveSamlNameId(jwtWith({ user_name: 'A'.repeat(257) }), 'user_name')).toThrow(/256 characters/);
    expect(() => resolveSamlNameId(jwtWith({ user_name: `${'A'.repeat(256)} ` }), 'user_name')).toThrow(
      /256 characters/,
    );
  });
});

describe('loadSamlBearerIdp', () => {
  it('is disabled without a key file', () => {
    expect(loadSamlBearerIdp(serverConfig())).toBeUndefined();
  });

  it('loads key material and defaults the recipient to the SAP URL', () => {
    const loaded = loadSamlBearerIdp(
      serverConfig({
        samlIdpKeyFile: material.keyFile,
        samlIdpCertFile: material.certFile,
        samlIdpIssuer: 'arc1-unit-test-saml-idp',
        samlAudience: 'A4H_001',
        samlNameIdClaim: 'email',
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
    expect(() => loadSamlBearerIdp(serverConfig({ samlIdpKeyFile: material.keyFile }))).toThrow(
      /requires SAP_PP_SAML_IDP_CERT_FILE/,
    );
    expect(() =>
      loadSamlBearerIdp(
        serverConfig({
          samlIdpKeyFile: material.certFile,
          samlIdpCertFile: material.certFile,
          samlIdpIssuer: 'x',
          samlAudience: 'y',
          samlNameIdClaim: 'email',
        }),
      ),
    ).toThrow(/does not contain a PEM private key/);
  });

  it('rejects an EC key, a mismatched certificate, and an expired certificate', () => {
    const ec = makeSamlMaterial('ec');
    const other = makeSamlMaterial();
    const config = serverConfig({
      samlIdpKeyFile: material.keyFile,
      samlIdpCertFile: material.certFile,
      samlIdpIssuer: 'x',
      samlAudience: 'y',
      samlNameIdClaim: 'email',
    });
    try {
      expect(() => loadSamlBearerIdp({ ...config, samlIdpKeyFile: ec.keyFile })).toThrow(/RSA private key/);
      expect(() => loadSamlBearerIdp({ ...config, samlIdpCertFile: other.certFile })).toThrow(/valid signing pair/);
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2100-01-01T00:00:00Z'));
      expect(() => loadSamlBearerIdp(config)).toThrow(/not currently valid/);
    } finally {
      vi.useRealTimers();
      ec.cleanup();
      other.cleanup();
    }
  });
});
