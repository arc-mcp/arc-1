import { createOAuthCallbackHandler, OAuthStateCodec } from '@arc-mcp/xsuaa-auth';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  buildXsuaaSessionRefreshUrl,
  createOAuthLoggedOutHandler,
  OAUTH_LOGGED_OUT_PATH,
  withInvalidScopeSessionRecovery,
} from '../../../src/server/oauth-session-recovery.js';

const SECRET = 'session-recovery-test-signing-secret-1234567890';
const REFRESH_URL =
  'https://tenant.authentication.example.com/logout.do?client_id=sb-arc1%21t1&redirect=https%3A%2F%2Farc1.example.com%2Foauth%2Flogged-out';

function buildApp(codec: OAuthStateCodec): express.Express {
  const app = express();
  app.get(OAUTH_LOGGED_OUT_PATH, createOAuthLoggedOutHandler());
  app.get('/oauth/callback', withInvalidScopeSessionRecovery(createOAuthCallbackHandler(codec), REFRESH_URL));
  return app;
}

describe('XSUAA browser-session recovery', () => {
  it('builds a fixed logout URL from trusted XSUAA and ARC-1 configuration', () => {
    const result = buildXsuaaSessionRefreshUrl(
      {
        url: 'https://tenant.authentication.example.com/oauth/token',
        clientid: 'sb-arc1!t1',
      },
      'https://arc1.example.com/base/oauth/logged-out',
    );
    const url = new URL(result);

    expect(url.origin).toBe('https://tenant.authentication.example.com');
    expect(url.pathname).toBe('/logout.do');
    expect(url.searchParams.get('client_id')).toBe('sb-arc1!t1');
    expect(url.searchParams.get('redirect')).toBe('https://arc1.example.com/base/oauth/logged-out');
  });

  it('adds the refresh action to a validated loopback invalid_scope page', async () => {
    const codec = new OAuthStateCodec(SECRET);
    const state = codec.encode({ clientRedirectUri: 'http://127.0.0.1:5/cb', clientId: 'arc1-test' });
    const res = await request(buildApp(codec)).get('/oauth/callback').query({
      error: 'invalid_scope',
      error_description: 'no assigned scopes',
      state,
    });

    expect(res.status).toBe(400);
    expect(res.text).toContain('Role assigned? Refresh access');
    expect(res.text).toContain('https://tenant.authentication.example.com/logout.do?');
    expect(res.text).toContain('client_id=sb-arc1%21t1&amp;redirect=');
  });

  it('does not add the action to another loopback OAuth error', async () => {
    const codec = new OAuthStateCodec(SECRET);
    const state = codec.encode({ clientRedirectUri: 'http://localhost:5/cb', clientId: 'arc1-test' });
    const res = await request(buildApp(codec))
      .get('/oauth/callback')
      .query({ error: 'access_denied', error_description: 'cancelled', state });

    expect(res.status).toBe(400);
    expect(res.text).not.toContain('Refresh access');
  });

  it('does not decorate a forged state even when the query says invalid_scope', async () => {
    const codec = new OAuthStateCodec(SECRET);
    const res = await request(buildApp(codec))
      .get('/oauth/callback')
      .query({ error: 'invalid_scope', state: 'forged.AAAAAAAAAAAAAAAAAAAAAA' });

    expect(res.status).toBe(400);
    expect(res.text).toContain('Authentication failed');
    expect(res.text).not.toContain('Refresh access');
  });

  it('preserves the package redirect for hosted callbacks', async () => {
    const codec = new OAuthStateCodec(SECRET);
    const state = codec.encode({
      clientRedirectUri: 'https://claude.ai/api/mcp/auth_callback',
      clientId: 'arc1-test',
    });
    const res = await request(buildApp(codec))
      .get('/oauth/callback')
      .query({ error: 'invalid_scope', error_description: 'no scopes', state });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('https://claude.ai/api/mcp/auth_callback');
    expect(res.text).not.toContain('Refresh access');
  });

  it('serves a fixed no-store landing page after logout', async () => {
    const codec = new OAuthStateCodec(SECRET);
    const res = await request(buildApp(codec)).get(OAUTH_LOGGED_OUT_PATH);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain('Access refreshed');
    expect(res.text).toContain('Return to your MCP client');
  });
});
