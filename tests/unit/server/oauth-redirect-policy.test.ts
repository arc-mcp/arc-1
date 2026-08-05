import { readFileSync } from 'node:fs';
import { createOAuthCallbackHandler, createXsuaaOAuthProvider, type XsuaaCredentials } from '@arc-mcp/xsuaa-auth';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ARC1_MANUAL_CLIENT_REDIRECT_URI_PATTERNS } from '../../../src/server/oauth-redirect-policy.js';

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
    redirectUriPatterns: ARC1_MANUAL_CLIENT_REDIRECT_URI_PATTERNS,
  });
}

describe('ARC-1 manual-client redirect policy', () => {
  it('is wired into the production XSUAA provider', () => {
    const source = readFileSync('src/server/http.ts', 'utf8');

    expect(source).toContain('redirectUriPatterns: ARC1_MANUAL_CLIENT_REDIRECT_URI_PATTERNS');
  });

  it.each([
    'https://attacker.cfapps.eu10.hana.ondemand.com/callback',
    'https://port8080-workspaces-ws-attacker.eu10.applicationstudio.cloud.sap/callback',
  ])('rejects shared-platform callback %s for the pre-registered client', async (redirectUri) => {
    const { clientStore, stateCodec } = buildProvider();

    clientStore.ensureRedirectUri(CREDENTIALS.clientid, redirectUri);

    expect(await clientStore.checkRedirectUri(CREDENTIALS.clientid, redirectUri)).toBe('unregistered');
    expect((await clientStore.getClient(CREDENTIALS.clientid))?.redirect_uris).not.toContain(redirectUri);

    const app = express();
    app.get('/oauth/callback', createOAuthCallbackHandler(stateCodec, clientStore));
    const state = stateCodec.encode({ clientId: CREDENTIALS.clientid, clientRedirectUri: redirectUri });
    const response = await request(app).get('/oauth/callback').query({ code: 'MUST_NOT_LEAK', state });

    expect(response.status).toBe(400);
    expect(response.headers.location).toBeUndefined();
    expect(response.text).not.toContain('MUST_NOT_LEAK');
  });

  it.each([
    'http://localhost:6274/oauth/callback',
    'https://claude.ai/api/mcp/auth_callback',
    'https://callback.mistral.ai/v1/integrations_auth/oauth2_callback',
    'cursor://anysphere.cursor-retrieval/oauth/callback',
    'cursor://anysphere.cursor-mcp/oauth/callback',
    'vscode://vscode.microsoft-authentication/callback',
    'https://global.consent.azure-apim.net/redirect/connection-id',
  ])('accepts supported manual callback %s', async (redirectUri) => {
    const { clientStore } = buildProvider();

    clientStore.ensureRedirectUri(CREDENTIALS.clientid, redirectUri);

    expect(await clientStore.checkRedirectUri(CREDENTIALS.clientid, redirectUri)).toBe('ok');
  });

  it('keeps DCR callbacks exact-bound without requiring a shared host wildcard', async () => {
    const { clientStore } = buildProvider();
    const exactWorkspaceUri = 'https://port8080-workspaces-ws-exact.eu10.applicationstudio.cloud.sap/oauth/callback';
    const registered = await clientStore.registerClient({
      redirect_uris: [exactWorkspaceUri],
      token_endpoint_auth_method: 'none',
    });

    expect(await clientStore.checkRedirectUri(registered.client_id, exactWorkspaceUri)).toBe('ok');
    expect(
      await clientStore.checkRedirectUri(
        registered.client_id,
        'https://port8080-workspaces-ws-other.eu10.applicationstudio.cloud.sap/oauth/callback',
      ),
    ).toBe('unregistered');
  });
});
