/**
 * Experimental local SAML 2.0 bearer-assertion issuer.
 *
 * ARC-1 acts as the SAML identity provider that the ABAP system trusts (transaction SAML2), the
 * same role the BTP subaccount plays for a `SAMLAssertion` destination. After the OIDC middleware
 * has verified the end user's JWT, the explicitly configured NameID claim is placed into a
 * short-lived, signed SAML 2.0 bearer assertion that `AdtHttpClient` sends verbatim as
 * `Authorization: SAML2.0 <base64>` plus `x-sap-security-session: create`.
 *
 * Supported on-premise from S/4HANA 2020 (SAP BTP Connectivity, "SAML Assertion Authentication").
 * No BTP Destination Service or Cloud Connector is involved. The shared SAP_USER never leaks into
 * this path: the caller builds the per-user client with `buildAdtConfig(..., { perUser: true })`.
 */
import { createPrivateKey, randomBytes, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SignedXml } from 'xml-crypto';
import type { ServerConfig } from '../server/types.js';

export const SAML_NAMEID_FORMAT_EMAIL = 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress';
export const SAML_NAMEID_FORMAT_UNSPECIFIED = 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified';
export const SAML_AUTHN_CONTEXT_PREVIOUS_SESSION = 'urn:oasis:names:tc:SAML:2.0:ac:classes:PreviousSession';

export type SamlNameIdFormat = 'email' | 'unspecified';

export interface SamlBearerIdp {
  /** SAML Issuer / entity ID that the ABAP system trusts. */
  issuer: string;
  /** Audience the ABAP system expects (its local SAML2 provider name). */
  audience: string;
  /** SubjectConfirmationData Recipient; defaults to the SAP base URL. */
  recipient: string;
  /** Explicit JWT claim carrying the SAP-side identity. */
  nameIdClaim: string;
  nameIdFormat: SamlNameIdFormat;
  authnContextClassRef: string;
  /** Assertion validity window in seconds (NotOnOrAfter = now + ttl). */
  ttlSeconds: number;
  privateKeyPem: string;
  certificatePem: string;
}

export interface SamlBearerAssertion {
  xml: string;
  /** Ready-to-send `Authorization` header value. */
  authorization: string;
  nameId: string;
  notOnOrAfter: Date;
}

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const escapeXml = (value: string): string => value.replace(/[&<>"']/g, (c) => XML_ESCAPES[c] ?? c);
const isoSeconds = (date: Date): string => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Build the issuer configuration from server config. Returns undefined when the feature is not
 * configured (no key file). Throws on incomplete configuration or unreadable key material.
 */
export function loadSamlBearerIdp(config: ServerConfig): SamlBearerIdp | undefined {
  if (!config.samlIdpKeyFile) return undefined;
  if (!config.samlIdpCertFile || !config.samlIdpIssuer || !config.samlAudience || !config.samlNameIdClaim) {
    throw new Error(
      'SAP_PP_SAML_IDP_KEY_FILE requires SAP_PP_SAML_IDP_CERT_FILE, SAP_PP_SAML_ISSUER, SAP_PP_SAML_AUDIENCE and SAP_PP_SAML_NAMEID_CLAIM.',
    );
  }
  const privateKeyPem = readFileSync(config.samlIdpKeyFile, 'utf8');
  const certificatePem = readFileSync(config.samlIdpCertFile, 'utf8');
  if (!/^-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+-----END (?:RSA )?PRIVATE KEY-----\s*$/.test(privateKeyPem)) {
    throw new Error(`SAP_PP_SAML_IDP_KEY_FILE does not contain a PEM private key: ${config.samlIdpKeyFile}`);
  }
  if (!/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(certificatePem)) {
    throw new Error(`SAP_PP_SAML_IDP_CERT_FILE does not contain a PEM certificate: ${config.samlIdpCertFile}`);
  }
  let certificate: X509Certificate;
  try {
    if (createPrivateKey(privateKeyPem).asymmetricKeyType !== 'rsa') throw new Error('not RSA');
  } catch {
    throw new Error('SAP_PP_SAML_IDP_KEY_FILE must contain a valid RSA private key');
  }
  try {
    certificate = new X509Certificate(certificatePem);
    if (certificate.publicKey.asymmetricKeyType !== 'rsa') throw new Error('not RSA');
  } catch {
    throw new Error('SAP_PP_SAML_IDP_CERT_FILE must contain a valid RSA certificate');
  }
  const now = Date.now();
  if (now < Date.parse(certificate.validFrom) || now >= Date.parse(certificate.validTo)) {
    throw new Error('SAP_PP_SAML_IDP_CERT_FILE is not currently valid (check certificate dates)');
  }
  const idp: SamlBearerIdp = {
    issuer: config.samlIdpIssuer,
    audience: config.samlAudience,
    recipient: config.samlRecipient || config.url || '',
    nameIdClaim: config.samlNameIdClaim,
    nameIdFormat: config.samlNameIdFormat,
    authnContextClassRef: config.samlAuthnContextClassRef,
    ttlSeconds: config.samlAssertionTtlSeconds,
    privateKeyPem,
    certificatePem,
  };
  try {
    const assertion = buildSamlBearerAssertion(idp, 'arc1-startup-self-check', new Date(now));
    const verifier = new SignedXml({ publicCert: certificatePem });
    const signature = assertion.xml.match(/<(?:\w+:)?Signature\b[\s\S]*?<\/(?:\w+:)?Signature>/)?.[0];
    if (!signature) throw new Error('signature missing');
    verifier.loadSignature(signature);
    if (!verifier.checkSignature(assertion.xml)) throw new Error('signature mismatch');
  } catch {
    throw new Error('SAP_PP_SAML_IDP_KEY_FILE and SAP_PP_SAML_IDP_CERT_FILE do not form a valid signing pair');
  }
  return idp;
}

/**
 * Read the NameID value from an already-verified JWT. The signature was checked by the HTTP auth
 * middleware; this only decodes the payload. Fails closed on a missing or non-string claim.
 */
export function resolveSamlNameId(verifiedJwt: string, claim: string): string {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(verifiedJwt.split('.')[1] ?? '', 'base64url').toString('utf8'));
  } catch {
    throw new Error('Principal propagation (SAML bearer): user token payload is not decodable');
  }
  const value = payload[claim];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Principal propagation (SAML bearer): user token has no usable '${claim}' claim`);
  }
  if (claim === 'email' && payload.email_verified !== true) {
    throw new Error("Principal propagation (SAML bearer): 'email' claim requires email_verified === true");
  }
  const characters = Array.from(value);
  const hasControl = characters.some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
  if (characters.length > 256 || hasControl) {
    throw new Error(
      `Principal propagation (SAML bearer): '${claim}' claim contains controls or exceeds 256 characters`,
    );
  }
  return value.trim();
}

/** Create a signed SAML 2.0 bearer assertion for `nameId` and the matching Authorization header. */
export function buildSamlBearerAssertion(idp: SamlBearerIdp, nameId: string, now = new Date()): SamlBearerAssertion {
  const id = `_${randomBytes(16).toString('hex')}`;
  const notBefore = new Date(now.getTime() - 60_000);
  const notOnOrAfter = new Date(now.getTime() + idp.ttlSeconds * 1000);
  const format = idp.nameIdFormat === 'email' ? SAML_NAMEID_FORMAT_EMAIL : SAML_NAMEID_FORMAT_UNSPECIFIED;

  const unsigned =
    `<saml2:Assertion xmlns:saml2="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" IssueInstant="${isoSeconds(now)}" Version="2.0">` +
    `<saml2:Issuer>${escapeXml(idp.issuer)}</saml2:Issuer>` +
    '<saml2:Subject>' +
    `<saml2:NameID Format="${format}">${escapeXml(nameId)}</saml2:NameID>` +
    '<saml2:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">' +
    `<saml2:SubjectConfirmationData NotOnOrAfter="${isoSeconds(notOnOrAfter)}" Recipient="${escapeXml(idp.recipient)}"/>` +
    '</saml2:SubjectConfirmation>' +
    '</saml2:Subject>' +
    `<saml2:Conditions NotBefore="${isoSeconds(notBefore)}" NotOnOrAfter="${isoSeconds(notOnOrAfter)}">` +
    `<saml2:AudienceRestriction><saml2:Audience>${escapeXml(idp.audience)}</saml2:Audience></saml2:AudienceRestriction>` +
    '</saml2:Conditions>' +
    `<saml2:AuthnStatement AuthnInstant="${isoSeconds(now)}" SessionIndex="${id}">` +
    `<saml2:AuthnContext><saml2:AuthnContextClassRef>${escapeXml(idp.authnContextClassRef)}</saml2:AuthnContextClassRef></saml2:AuthnContext>` +
    '</saml2:AuthnStatement>' +
    '</saml2:Assertion>';

  const signer = new SignedXml({
    privateKey: idp.privateKeyPem,
    publicCert: idp.certificatePem,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  });
  signer.addReference({
    xpath: "/*[local-name(.)='Assertion']",
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
  });
  // The SAML schema requires ds:Signature directly after Issuer.
  signer.computeSignature(unsigned, {
    location: { reference: "/*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: 'after' },
  });
  const xml = signer.getSignedXml();
  return {
    xml,
    authorization: `SAML2.0 ${Buffer.from(xml, 'utf8').toString('base64')}`,
    nameId,
    notOnOrAfter,
  };
}
