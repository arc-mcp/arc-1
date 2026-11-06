import { EventEmitter } from 'node:events';
import { createXsuaaOAuthProvider, type XsuaaCredentials } from '@arc-mcp/xsuaa-auth';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startHttpServer } from '../../../src/server/http.js';
import { ARC1_MANUAL_CLIENT_REDIRECT_URI_PATTERNS } from '../../../src/server/oauth-redirect-policy.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';

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

async function boot(publicUrl = 'https://arc1.example', oauthDcrEnabled = true, overrides: Partial<ServerConfig> = {}) {
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
        oauthDcrEnabled,
        authRateLimit: 0,
        mcpHttpRateLimit: 0,
        dcrSigningSecret: 'test-dcr-signing-secret-with-enough-entropy',
        ...overrides,
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

function cookies(response: request.Response): string[] {
  const values = response.headers['set-cookie'] as unknown as string[] | undefined;
  return (values ?? [])
    .filter((value) => !value.includes('Expires=Thu, 01 Jan 1970'))
    .map((value) => value.split(';')[0]!);
}

async function approve(app: express.Express, page: request.Response) {
  expect(page.status).toBe(200);
  expect(page.headers.location).toBeUndefined();
  const decode = (value: string) =>
    value.replace(
      /&(amp|quot|lt|gt|#39);/g,
      (_, key: string) => ({ amp: '&', quot: '"', lt: '<', gt: '>', '#39': "'" })[key]!,
    );
  const fields = Object.fromEntries(
    [...page.text.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((match) => [
      match[1]!,
      decode(match[2]!),
    ]),
  );
  const action = new URL(decode(/<form method="post" action="([^"]+)"/.exec(page.text)![1]!));
  const response = await request(app)
    .post('/authorize')
    .set('Origin', action.origin)
    .set('Cookie', cookies(page))
    .type('form')
    .send({ ...fields, consent_action: 'approve' });
  expect(response.status).toBe(302);
  return response;
}

describe('production OAuth redirect flow', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(['', 'http://arc1.example'])(
    'explains the required public URL for a non-loopback HTTP deployment: %s',
    async (publicUrl) => {
      vi.stubEnv('VCAP_APPLICATION', '');
      await expect(boot(publicUrl, true, { httpAddr: '0.0.0.0:8080' })).rejects.toThrow(
        /Set ARC1_PUBLIC_URL to the canonical HTTPS URL/,
      );
    },
  );

  it.each(['http://localhost:8080', 'http://127.0.0.1:8080'])(
    'preserves ordinary loopback development sign-in at %s',
    async (publicUrl) => {
      const app = await boot(publicUrl);
      await approve(
        app,
        await request(app).get('/authorize').query(authorization('https://claude.ai/api/mcp/auth_callback')),
      );
    },
  );

  it('counts both ordinary consent requests against the existing authorization limit', async () => {
    const app = await boot('https://arc1.example', true, { authRateLimit: 2 });
    const params = authorization('https://claude.ai/api/mcp/auth_callback');
    await approve(app, await request(app).get('/authorize').query(params));
    const limited = await request(app).get('/authorize').query(params);
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it.each(['https://arc1.example', 'https://gateway.example/arc1'])(
    'disables DCR at %s without removing manual-client sign-in',
    async (publicUrl) => {
      const app = await boot(publicUrl, false);
      expect(
        (await request(app).get('/.well-known/oauth-authorization-server')).body.registration_endpoint,
      ).toBeUndefined();
      expect(
        (
          await request(app)
            .post('/register')
            .send({ redirect_uris: ['https://client.example/cb'] })
        ).status,
      ).toBe(404);
      const page = await request(app).get('/authorize').query(authorization('https://claude.ai/api/mcp/auth_callback'));
      await approve(app, page);
    },
  );

  it('requires approval after registering the attacker-controlled HTTPS callback', async () => {
    const app = await boot();
    const registered = await request(app)
      .post('/register')
      .send({
        redirect_uris: ['https://attacker.example/cb'],
        token_endpoint_auth_method: 'none',
      });
    expect(registered.status).toBe(201);
    const page = await request(app)
      .get('/authorize')
      .query(authorization('https://attacker.example/cb', registered.body.client_id));
    expect(page.status).toBe(200);
    expect(page.headers.location).toBeUndefined();
    expect(page.text).toContain('attacker.example');
    const approved = await approve(app, page);
    const callback = await request(app)
      .get('/oauth/callback')
      .query({
        state: new URL(approved.headers.location).searchParams.get('state'),
        code: 'VICTIM_CODE',
      });
    expect(callback.status).toBe(400);
    expect(callback.headers.location).toBeUndefined();
  });

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
    const approved = await approve(app, response);
    const upstream = new URL(approved.headers.location);
    expect(upstream.origin).toBe(CREDENTIALS.url);
    expect(upstream.searchParams.get('redirect_uri')).toBe('https://arc1.example/oauth/callback');
    const callback = await request(app)
      .get('/oauth/callback')
      .set('Cookie', cookies(approved))
      .query({
        state: upstream.searchParams.get('state'),
        code: 'test-code',
      });
    expect(callback.status).toBe(302);
    const target = new URL(callback.headers.location);
    expect(target.searchParams.get('code')).toMatch(/^mcp-code-/);
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
    const approved = await approve(app, response);
    const upstream = new URL(approved.headers.location);
    expect(upstream.searchParams.get('redirect_uri')).toBe('https://gateway.example/arc1/oauth/callback');
    const callback = await request(app)
      .get('/oauth/callback')
      .set('Cookie', cookies(approved))
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

describe('deployment-restricted OAuth clients', () => {
  afterEach(() => vi.unstubAllEnvs());
  const restricted: Partial<ServerConfig> = {
    oauthDcrRedirectUriPatterns: [
      'https://vscode.dev/redirect',
      'http://127.0.0.1:*/**',
      'https://port3000-workspaces-ws-x.eu10.applicationstudio.cloud.sap/callback',
    ],
  };
  const register = (app: express.Express, redirectUri: string) =>
    request(app)
      .post('/register')
      .send({ client_name: 'Visual Studio Code', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' });

  it('rejects a registration outside the allowlist before any authorization', async () => {
    const app = await boot('https://arc1.example', true, restricted);
    const rejected = await register(app, 'https://attacker.example/cb');
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toBe('invalid_client_metadata');
  });

  it.each([
    'http://127.0.0.1:33418/',
    'https://vscode.dev/redirect',
    'https://port3000-workspaces-ws-x.eu10.applicationstudio.cloud.sap/callback',
  ])('requires approval before forwarding an allowlisted client: %s', async (redirectUri) => {
    const app = await boot('https://arc1.example', true, restricted);
    const registered = await register(app, redirectUri);
    expect(registered.status).toBe(201);
    const page = await request(app).get('/authorize').query(authorization(redirectUri, registered.body.client_id));
    expect(page.status).toBe(200);
    expect(page.headers.location).toBeUndefined();
    expect(cookies(page).some((cookie) => cookie.includes('mcp-oauth-state-'))).toBe(false);
    const approved = await approve(app, page);
    expect(new URL(approved.headers.location).origin).toBe(CREDENTIALS.url);
    expect(cookies(approved).some((cookie) => cookie.includes('mcp-oauth-state-'))).toBe(true);
  });

  it('denies every dynamic redirect under an explicitly empty policy', async () => {
    const app = await boot('https://arc1.example', true, { oauthDcrRedirectUriPatterns: [] });
    const rejected = await register(app, 'https://vscode.dev/redirect');
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toBe('invalid_client_metadata');
  });

  it('applies a narrowed policy to previously registered clients across instances', async () => {
    const original = await boot();
    const registered = await request(original)
      .post('/register')
      .send({
        redirect_uris: ['https://vscode.dev/redirect', 'https://retired-client.example/callback'],
        token_endpoint_auth_method: 'none',
      });
    expect(registered.status).toBe(201);
    const narrowed = await boot('https://arc1.example', true, restricted);
    const allowed = await request(narrowed)
      .get('/authorize')
      .query(authorization('https://vscode.dev/redirect', registered.body.client_id));
    await approve(narrowed, allowed);
    const retired = await request(narrowed)
      .get('/authorize')
      .query(authorization('https://retired-client.example/callback', registered.body.client_id));
    expect(retired.status).toBe(400);
    expect(retired.headers.location).toBeUndefined();
  });
});
