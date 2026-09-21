import { EventEmitter } from 'node:events';
import { createXsuaaOAuthProvider, type XsuaaCredentials } from '@arc-mcp/xsuaa-auth';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startHttpServer } from '../../../src/server/http.js';
import { ARC1_MANUAL_CLIENT_REDIRECT_URI_PATTERNS } from '../../../src/server/oauth-redirect-policy.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

const CREDENTIALS: XsuaaCredentials = {
  url: 'https://tenant.authentication.example',
  clientid: 'sb-arc1!t1',
  clientsecret: 'test-client-secret-with-enough-entropy',
  xsappname: 'arc1!t1',
  uaadomain: 'authentication.example',
};

function buildProvider() {
  return createXsuaaOAuthProvider(CREDENTIALS, 'https://arc1.example', {
    dcrSigningSecret: 'test-dcr-signing-secret-with-enough-entropy',
    clientIdPrefix: 'arc1-',
    dcrKdfLabel: 'arc1-dcr/v1',
    stateKdfLabel: 'arc1-oauth-state/v1',
    redirectUriPatterns: ARC1_MANUAL_CLIENT_REDIRECT_URI_PATTERNS,
  });
}

async function boot(publicUrl = 'https://arc1.example') {
  vi.stubEnv('ARC1_PUBLIC_URL', publicUrl);
  let app!: express.Express;
  const listen = vi.spyOn(express.application, 'listen').mockImplementation(function (this: express.Express) {
    app = this;
    return new EventEmitter() as never;
  });
  try {
    await startHttpServer(
      (() => ({ connect: vi.fn() })) as never,
      {
        ...DEFAULT_CONFIG,
        transport: 'http-streamable',
        httpAddr: '127.0.0.1:0',
        xsuaaAuth: true,
        authRateLimit: 0,
        mcpHttpRateLimit: 0,
        dcrSigningSecret: 'test-dcr-signing-secret-with-enough-entropy',
      },
      CREDENTIALS,
    );
  } finally {
    listen.mockRestore();
  }
  return app;
}

function authorization(redirectUri: string, clientId = CREDENTIALS.clientid) {
  return {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    code_challenge: 'a'.repeat(43),
    code_challenge_method: 'S256',
    state: 'original+client/state=',
  };
}

describe('production OAuth redirect flow', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    'https://attacker.cfapps.eu10.hana.ondemand.com/callback',
    'https://port8080-workspaces-ws-attacker.eu10.applicationstudio.cloud.sap/callback',
    'https://claude.ai.attacker.example/api/mcp/auth_callback',
    'https://claude.ai@attacker.example/api/mcp/auth_callback',
    'https://attacker.example\\@tenant.hana.ondemand.com/cb',
    'https://attacker.example?@tenant.hana.ondemand.com/cb',
    'https://attacker.example#@tenant.hana.ondemand.com/cb',
    'http://localhost:1234@attacker.example/callback',
  ])('rejects %s before contacting XSUAA on GET and POST', async (redirectUri) => {
    const app = await boot();
    for (const response of [
      await request(app).get('/authorize').query(authorization(redirectUri)),
      await request(app).post('/authorize').type('form').send(authorization(redirectUri)),
    ]) {
      expect(response.status).toBe(400);
      expect(response.headers.location).toBeUndefined();
    }
  });

  it.each([
    'http://localhost:6274/oauth/callback',
    'https://claude.ai/api/mcp/auth_callback',
    'https://callback.mistral.ai/v1/integrations_auth/oauth2_callback',
    'cursor://anysphere.cursor-retrieval/oauth/callback',
    'cursor://anysphere.cursor-mcp/oauth/callback',
    'vscode://vscode.microsoft-authentication/callback',
    'https://global.consent.azure-apim.net/redirect/connection-id',
  ])('round trips a supported manual callback: %s', async (redirectUri) => {
    const app = await boot();
    const response = await request(app).get('/authorize').query(authorization(redirectUri));
    expect(response.status).toBe(302);
    const upstream = new URL(response.headers.location);
    expect(upstream.origin).toBe(CREDENTIALS.url);
    expect(upstream.searchParams.get('redirect_uri')).toBe('https://arc1.example/oauth/callback');
    const callback = await request(app)
      .get('/oauth/callback')
      .query({
        state: upstream.searchParams.get('state'),
        code: 'test-code',
      });
    expect(callback.status).toBe(302);
    const target = new URL(callback.headers.location);
    expect(target.searchParams.get('code')).toBe('test-code');
    expect(target.searchParams.get('state')).toBe('original+client/state=');
    target.search = '';
    expect(target.href).toBe(redirectUri);
  });

  it.each([{ code: 'MUST_NOT_LEAK' }, { error: 'access_denied', error_description: 'MUST_NOT_LEAK' }])(
    'rejects an old signed state targeting a foreign platform host: %j',
    async (payload) => {
      const app = await boot();
      const { stateCodec } = buildProvider();
      const state = stateCodec.encode({
        clientId: CREDENTIALS.clientid,
        clientRedirectUri: 'https://attacker.cfapps.eu10.hana.ondemand.com/callback',
      });
      const response = await request(app)
        .get('/oauth/callback')
        .query({ state, ...payload });
      expect(response.status).toBe(400);
      expect(response.headers.location).toBeUndefined();
      expect(response.text).not.toContain('MUST_NOT_LEAK');
    },
  );

  it.each([
    'https://port8080-workspaces-ws-exact.eu10.applicationstudio.cloud.sap/oauth/callback',
    'http://127.0.0.1:6274/oauth/callback',
    'http://[::1]:6274/oauth/callback',
  ])('preserves DCR exact binding and public URL prefixes: %s', async (redirectUri) => {
    const app = await boot('https://gateway.example/arc1');
    const registered = await request(app)
      .post('/register')
      .send({
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'none',
      });
    expect(registered.status).toBe(201);
    const clientId = registered.body.client_id;
    const response = await request(app).get('/authorize').query(authorization(redirectUri, clientId));
    expect(response.status).toBe(302);
    const upstream = new URL(response.headers.location);
    expect(upstream.searchParams.get('redirect_uri')).toBe('https://gateway.example/arc1/oauth/callback');
    const callback = await request(app)
      .get('/oauth/callback')
      .query({
        state: upstream.searchParams.get('state'),
        code: 'test-code',
      });
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toContain(redirectUri);
    const wrong = await request(app)
      .get('/authorize')
      .query(authorization(`${redirectUri}/other`, clientId));
    expect(wrong.status).toBe(400);
    expect(wrong.headers.location).toBeUndefined();
  });
});
