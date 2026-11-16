import { afterAll, describe, expect, it, vi } from 'vitest';
import type { AdtHttpConfig } from '../../../src/adt/http.js';
import { AdtHttpClient } from '../../../src/adt/http.js';
import type { SamlBearerIdp } from '../../../src/adt/saml-bearer.js';
import { logger } from '../../../src/server/logger.js';
import {
  createSamlBearerPerUserClient,
  loadSamlBearerIssuer,
  runSamlBearerToolCall,
} from '../../../src/server/saml-bearer-client.js';
import { buildAdtConfig } from '../../../src/server/server.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';
import { makeSamlMaterial } from '../../helpers/saml-material.js';

const material = makeSamlMaterial();
afterAll(material.cleanup);

const idp: SamlBearerIdp = {
  issuer: 'arc1-unit-test-saml-idp',
  audience: 'A4H_001',
  recipient: 'https://sap.example:50001',
  nameIdClaim: 'email',
  nameIdFormat: 'email',
  authnContextClassRef: 'urn:oasis:names:tc:SAML:2.0:ac:classes:PreviousSession',
  ttlSeconds: 300,
  privateKeyPem: material.privateKeyPem,
  certificatePem: material.certificatePem,
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
      token: jwtWith({ sub: 'abc', email: 'jane@example.com', email_verified: true }),
      requestId: 'req-1',
      fallbackUser: 'oidc-user',
      buildPerUserAdtConfig,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nameId).toBe('jane@example.com');
    // `config` is private on AdtHttpClient; the test inspects the per-user Layer B fields it received.
    const cfg = (result.client.http as unknown as { config: AdtHttpConfig }).config;
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
    const audit = vi.spyOn(logger, 'emitAudit').mockImplementation(() => {});
    const result = createSamlBearerPerUserClient({
      idp,
      token: jwtWith({ sub: 'abc' }),
      requestId: 'req-2',
      fallbackUser: 'arc1-local',
      buildPerUserAdtConfig,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.isError).toBe(true);
    expect(result.error.content[0]?.text).toMatch(/Principal propagation failed: .*no usable 'email' claim/);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ user: 'oidc-sub:abc', success: false }));
    audit.mockRestore();
  });

  it('refuses a changed unverified email for the same subject before building an assertion', () => {
    const accepted = createSamlBearerPerUserClient({
      idp,
      token: jwtWith({ sub: 'same-subject', email: 'b@example.com', email_verified: true }),
      requestId: 'req-3',
      buildPerUserAdtConfig,
    });
    expect(accepted.ok).toBe(true);
    let built = false;
    const rejected = createSamlBearerPerUserClient({
      idp,
      token: jwtWith({ sub: 'same-subject', email: 'a@example.com', email_verified: false }),
      requestId: 'req-4',
      buildPerUserAdtConfig: () => {
        built = true;
        return buildPerUserAdtConfig();
      },
    });
    expect(rejected.ok).toBe(false);
    expect(built).toBe(false);
    if (!rejected.ok) expect(rejected.error.content[0]?.text).toMatch(/email_verified === true/);
  });
});

describe('loadSamlBearerIssuer', () => {
  it('returns undefined when the issuer is not configured', () => {
    expect(loadSamlBearerIssuer(serverConfig)).toBeUndefined();
  });

  it('loads the configured issuer', () => {
    const loaded = loadSamlBearerIssuer({
      ...serverConfig,
      samlIdpKeyFile: material.keyFile,
      samlIdpCertFile: material.certFile,
      samlIdpIssuer: 'arc1-unit-test-saml-idp',
      samlAudience: 'A4H_001',
      samlNameIdClaim: 'email',
    });
    expect(loaded?.issuer).toBe('arc1-unit-test-saml-idp');
    expect(loaded?.recipient).toBe('https://sap.example:50001');
  });

  it('warns when the local issuer disables SAP TLS verification', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const config = {
      ...serverConfig,
      insecure: true,
      samlIdpKeyFile: material.keyFile,
      samlIdpCertFile: material.certFile,
      samlIdpIssuer: 'arc1-unit-test-saml-idp',
      samlAudience: 'A4H_001',
      samlNameIdClaim: 'email',
    };
    loadSamlBearerIssuer(config);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('captured assertion is a bearer credential'));
    warn.mockRestore();
  });
});

describe('runSamlBearerToolCall', () => {
  it('dispatches with the per-user client and refuses an unverified email before dispatch', async () => {
    let calls = 0;
    const dispatch = async () => {
      calls++;
      return { content: [{ type: 'text', text: 'ok' }] };
    };
    const accepted = await runSamlBearerToolCall(
      idp,
      jwtWith({ email: 'jane@example.com', email_verified: true }),
      'req-ok',
      undefined,
      buildPerUserAdtConfig,
      dispatch,
    );
    expect(accepted).toMatchObject({ content: [{ text: 'ok' }] });
    const rejected = await runSamlBearerToolCall(
      idp,
      jwtWith({ email: 'admin@example.com', email_verified: false }),
      'req-denied',
      undefined,
      buildPerUserAdtConfig,
      dispatch,
    );
    expect(rejected).toMatchObject({ isError: true });
    expect(calls).toBe(1);
  });

  it('attempts logoff after both successful and failed handlers have returned', async () => {
    const logoff = vi.spyOn(AdtHttpClient.prototype, 'logoffSamlSecuritySessions').mockResolvedValue();
    const success = { content: [{ type: 'text', text: 'ok' }] };
    const token = jwtWith({ email: 'jane@example.com', email_verified: true });
    let dispatchReturned = false;
    try {
      await expect(
        runSamlBearerToolCall(idp, token, 'req-success', undefined, buildPerUserAdtConfig, async () => {
          expect(logoff).not.toHaveBeenCalled();
          dispatchReturned = true;
          return success;
        }),
      ).resolves.toBe(success);
      expect(dispatchReturned).toBe(true);
      expect(logoff).toHaveBeenCalledTimes(1);

      const handlerError = new Error('handler failed');
      await expect(
        runSamlBearerToolCall(idp, token, 'req-error', undefined, buildPerUserAdtConfig, async () => {
          throw handlerError;
        }),
      ).rejects.toBe(handlerError);
      expect(logoff).toHaveBeenCalledTimes(2);
    } finally {
      logoff.mockRestore();
    }
  });

  it('preserves the tool result when logoff fails', async () => {
    const logoff = vi
      .spyOn(AdtHttpClient.prototype, 'logoffSamlSecuritySessions')
      .mockRejectedValue(new Error('logoff failed'));
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const expected = { content: [{ type: 'text', text: 'ok' }] };
    try {
      await expect(
        runSamlBearerToolCall(
          idp,
          jwtWith({ email: 'jane@example.com', email_verified: true }),
          'req-logoff-error',
          undefined,
          buildPerUserAdtConfig,
          async () => expected,
        ),
      ).resolves.toBe(expected);
      expect(warn).toHaveBeenCalledWith('Failed to end local SAML security session.');
    } finally {
      logoff.mockRestore();
      warn.mockRestore();
    }
  });
});
