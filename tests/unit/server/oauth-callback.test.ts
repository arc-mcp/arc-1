import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createOAuthCallbackHandler } from '../../../src/server/http.js';
import { OAuthStateCodec } from '../../../src/server/oauth-state.js';
import { StatelessDcrClientStore } from '../../../src/server/stateless-client-store.js';

const SECRET = 'callback-test-signing-secret-1234567890';
const TEST_CLIENT_ID = 'arc1-test-client';

function buildApp(codec: OAuthStateCodec): express.Express {
  const app = express();
  app.get('/oauth/callback', createOAuthCallbackHandler(codec));
  return app;
}

function buildAppWithStore(codec: OAuthStateCodec, store: StatelessDcrClientStore): express.Express {
  const app = express();
  app.get('/oauth/callback', createOAuthCallbackHandler(codec, store));
  return app;
}

/** Parse a Location header's `state` the way an OAuth client (VS Code) does:
 *  WHATWG URL search params, where `+` decodes to space and `%2B` to `+`. */
function clientParsedState(location: string): string | null {
  return new URL(location).searchParams.get('state');
}

describe('createOAuthCallbackHandler — issue #214 round-trip', () => {
  it('redirects to the client with the ORIGINAL "+" state recoverable (the fix)', async () => {
    const codec = new OAuthStateCodec(SECRET);
    const clientState = '6QadZ5GFXGvZ649+OuQi+Q==';
    const token = codec.encode({ clientState, clientRedirectUri: 'http://127.0.0.1:33418/', clientId: TEST_CLIENT_ID });

    const res = await request(buildApp(codec)).get('/oauth/callback').query({ code: 'AUTHCODE123', state: token });

    expect(res.status).toBe(302);
    const loc = res.headers.location as string;
    // The redirect target is the client's own loopback.
    expect(loc.startsWith('http://127.0.0.1:33418/')).toBe(true);
    // The code is forwarded.
    expect(new URL(loc).searchParams.get('code')).toBe('AUTHCODE123');
    // KEY ASSERTION: the state is encoded such that a standard URL parser
    // recovers the EXACT original (the `+` survived as `%2B` on the wire).
    expect(loc).toContain('state=6QadZ5GFXGvZ649%2BOuQi%2BQ%3D%3D');
    expect(clientParsedState(loc)).toBe(clientState);
  });

  it('emits %2B (not literal +) in the Location header', async () => {
    const codec = new OAuthStateCodec(SECRET);
    const token = codec.encode({
      clientState: 'a+b+c==',
      clientRedirectUri: 'http://localhost:1/cb',
      clientId: TEST_CLIENT_ID,
    });
    const res = await request(buildApp(codec)).get('/oauth/callback').query({ code: 'x', state: token });
    const loc = res.headers.location as string;
    // The state segment must not contain a raw '+'.
    const stateSegment = loc.split('state=')[1] ?? '';
    expect(stateSegment).not.toContain('+');
    expect(stateSegment).toContain('%2B');
  });

  it('renders a self-hosted error page (no 302 to a possibly-dead loopback) on OAuth error', async () => {
    const codec = new OAuthStateCodec(SECRET);
    const token = codec.encode({
      clientState: 'st+ate==',
      clientRedirectUri: 'http://127.0.0.1:5/cb',
      clientId: TEST_CLIENT_ID,
    });
    const res = await request(buildApp(codec))
      .get('/oauth/callback')
      .query({ error: 'access_denied', error_description: 'user cancelled', state: token });
    // The flow failed -> surface the reason to the human instead of redirecting
    // to the client's loopback (whose listener is usually already gone).
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
    expect(res.text).toContain('access_denied');
    expect(res.text).toContain('user cancelled');
    // Best-effort link back to the client, carrying the error + original state.
    expect(res.text).toContain('http://127.0.0.1:5/cb');
    expect(res.text).toContain('error=access_denied');
  });

  it('redirects the error (not a terminal page) for a hosted HTTPS callback', async () => {
    const codec = new OAuthStateCodec(SECRET);
    const token = codec.encode({
      clientState: 'st+ate==',
      clientRedirectUri: 'https://claude.ai/api/mcp/auth_callback',
      clientId: TEST_CLIENT_ID,
    });
    const res = await request(buildApp(codec))
      .get('/oauth/callback')
      .query({ error: 'invalid_scope', error_description: 'no scopes', state: token });
    // A hosted callback is alive and expects the spec-compliant error redirect.
    expect(res.status).toBe(302);
    const u = new URL(res.headers.location as string);
    expect(u.origin + u.pathname).toBe('https://claude.ai/api/mcp/auth_callback');
    expect(u.searchParams.get('error')).toBe('invalid_scope');
    expect(u.searchParams.get('error_description')).toBe('no scopes');
    expect(u.searchParams.get('state')).toBe('st+ate==');
    expect(u.searchParams.get('code')).toBeNull();
  });

  it('adds an actionable role-collection hint for invalid_scope', async () => {
    const codec = new OAuthStateCodec(SECRET);
    const token = codec.encode({ clientRedirectUri: 'http://127.0.0.1:5/cb', clientId: TEST_CLIENT_ID });
    const res = await request(buildApp(codec)).get('/oauth/callback').query({
      error: 'invalid_scope',
      error_description: 'is invalid. not allowed any of the requested scopes',
      state: token,
    });
    expect(res.status).toBe(400);
    expect(res.text).toContain('role collection');
  });

  it('HTML-escapes a malicious error_description (no XSS)', async () => {
    const codec = new OAuthStateCodec(SECRET);
    const token = codec.encode({ clientRedirectUri: 'http://127.0.0.1:5/cb', clientId: TEST_CLIENT_ID });
    const res = await request(buildApp(codec))
      .get('/oauth/callback')
      .query({ error: 'invalid_request', error_description: '<script>alert(1)</script>', state: token });
    expect(res.status).toBe(400);
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;');
  });

  it('round-trips a state with no "+" unchanged', async () => {
    const codec = new OAuthStateCodec(SECRET);
    const token = codec.encode({
      clientState: 'mElKiL3xesnEy0LnXDyKvA==',
      clientRedirectUri: 'http://localhost:1/cb',
      clientId: TEST_CLIENT_ID,
    });
    const res = await request(buildApp(codec)).get('/oauth/callback').query({ code: 'c', state: token });
    expect(clientParsedState(res.headers.location as string)).toBe('mElKiL3xesnEy0LnXDyKvA==');
  });

  it('omits state when the client did not send one', async () => {
    const codec = new OAuthStateCodec(SECRET);
    const token = codec.encode({ clientRedirectUri: 'http://localhost:1/cb', clientId: TEST_CLIENT_ID });
    const res = await request(buildApp(codec)).get('/oauth/callback').query({ code: 'c', state: token });
    expect(new URL(res.headers.location as string).searchParams.has('state')).toBe(false);
  });

  it('returns 400 (no open redirect) for an invalid/forged state token', async () => {
    const codec = new OAuthStateCodec(SECRET);
    const res = await request(buildApp(codec))
      .get('/oauth/callback')
      .query({ code: 'c', state: 'forged.AAAAAAAAAAAAAAAAAAAAAA' });
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
    expect(res.text).toContain('Authentication failed');
  });

  it('returns 400 for an expired state token', async () => {
    const codec = new OAuthStateCodec(SECRET, { ttlSeconds: 1 });
    // Encode with a clock far in the past so it is already expired at decode (now).
    const token = codec.encode({
      clientState: 'x',
      clientRedirectUri: 'http://localhost:1/cb',
      clientId: TEST_CLIENT_ID,
      now: 1_000_000_000_000,
    });
    const res = await request(buildApp(codec)).get('/oauth/callback').query({ code: 'c', state: token });
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  it('returns 400 when no state is provided at all', async () => {
    const codec = new OAuthStateCodec(SECRET);
    const res = await request(buildApp(codec)).get('/oauth/callback').query({ code: 'c' });
    expect(res.status).toBe(400);
  });
});

describe('createOAuthCallbackHandler — client-binding validation (auth-code interception defense)', () => {
  // A DCR client_id carries its registered redirect_uris immutably inside its
  // HMAC-signed payload, so getClient() returns them deterministically. The
  // callback must only forward the code/error to a redirect_uri registered for
  // the client_id bound into the signed state — defeating the attack where a
  // valid signed state's redirect_uri is swapped for an attacker-controlled one.
  const buildStore = () => new StatelessDcrClientStore('xsuaa-client', 'xsuaa-secret', SECRET);

  it('forwards the code when redirect_uri IS registered for the state client_id', async () => {
    const codec = new OAuthStateCodec(SECRET);
    const store = buildStore();
    const registered = await store.registerClient({ redirect_uris: ['https://app.example.com/cb'] });
    const token = codec.encode({
      clientState: 'abc',
      clientRedirectUri: 'https://app.example.com/cb',
      clientId: registered.client_id,
    });
    const res = await request(buildAppWithStore(codec, store))
      .get('/oauth/callback')
      .query({ code: 'CODE1', state: token });
    expect(res.status).toBe(302);
    const u = new URL(res.headers.location as string);
    expect(u.origin + u.pathname).toBe('https://app.example.com/cb');
    expect(u.searchParams.get('code')).toBe('CODE1');
  });

  it('returns 400 (code NOT leaked) when redirect_uri is NOT registered for the client_id', async () => {
    const codec = new OAuthStateCodec(SECRET);
    const store = buildStore();
    const registered = await store.registerClient({ redirect_uris: ['https://app.example.com/cb'] });
    // The attacker reuses a victim client_id but substitutes their own redirect_uri.
    const token = codec.encode({
      clientState: 'abc',
      clientRedirectUri: 'https://attacker.example/cb',
      clientId: registered.client_id,
    });
    const res = await request(buildAppWithStore(codec, store))
      .get('/oauth/callback')
      .query({ code: 'STOLEN', state: token });
    expect(res.status).toBe(400);
    // No redirect at all → the authorization code is never delivered anywhere.
    expect(res.headers.location).toBeUndefined();
    expect(res.text).toContain('Authentication failed');
    expect(res.text).not.toContain('STOLEN');
  });

  it('returns 400 when the state references an unknown/forged client_id', async () => {
    const codec = new OAuthStateCodec(SECRET);
    const store = buildStore();
    const token = codec.encode({
      clientState: 'abc',
      clientRedirectUri: 'https://app.example.com/cb',
      clientId: 'arc1-bogus.AAAAAAAAAAAAAAAAAAAAAA',
    });
    const res = await request(buildAppWithStore(codec, store))
      .get('/oauth/callback')
      .query({ code: 'CODE1', state: token });
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  it('blocks the error-forwarding path too when redirect_uri is unregistered', async () => {
    const codec = new OAuthStateCodec(SECRET);
    const store = buildStore();
    const registered = await store.registerClient({ redirect_uris: ['https://app.example.com/cb'] });
    const token = codec.encode({
      clientState: 'abc',
      clientRedirectUri: 'https://attacker.example/cb',
      clientId: registered.client_id,
    });
    const res = await request(buildAppWithStore(codec, store))
      .get('/oauth/callback')
      .query({ error: 'access_denied', error_description: 'denied', state: token });
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  // ── Shared pre-registered XSUAA default client (Manual-mode clients) ──
  // The default client's redirect target is validated against the static
  // allowlist (xs-security.json mirror), not the mutable in-memory list — so an
  // attacker who steers a victim's code to their own URI via the SHARED client
  // is blocked statelessly, while a legit allowlisted URI (e.g. Copilot Studio)
  // still works. The store's default client_id is its first constructor arg.
  const DEFAULT_CLIENT_ID = 'xsuaa-client';

  it('forwards the code for the default client when redirect_uri is allowlisted', async () => {
    const codec = new OAuthStateCodec(SECRET);
    const store = buildStore();
    const token = codec.encode({
      clientState: 'abc',
      clientRedirectUri: 'https://global.consent.azure-apim.net/redirect/contoso',
      clientId: DEFAULT_CLIENT_ID,
    });
    const res = await request(buildAppWithStore(codec, store))
      .get('/oauth/callback')
      .query({ code: 'CODE1', state: token });
    expect(res.status).toBe(302);
    expect((res.headers.location as string).startsWith('https://global.consent.azure-apim.net/redirect/contoso')).toBe(
      true,
    );
    expect(new URL(res.headers.location as string).searchParams.get('code')).toBe('CODE1');
  });

  it('returns 400 (code NOT leaked) for the default client when redirect_uri is not allowlisted', async () => {
    const codec = new OAuthStateCodec(SECRET);
    const store = buildStore();
    // This is the residual the fix closes: an attacker redirect_uri on the shared
    // default client must not receive the victim's code, even though ensureRedirectUri
    // would once have auto-trusted it.
    const token = codec.encode({
      clientState: 'abc',
      clientRedirectUri: 'https://attacker.example/cb',
      clientId: DEFAULT_CLIENT_ID,
    });
    const res = await request(buildAppWithStore(codec, store))
      .get('/oauth/callback')
      .query({ code: 'STOLEN', state: token });
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
    expect(res.text).not.toContain('STOLEN');
  });

  it('returns 400 (code NOT leaked) for a userinfo-smuggled localhost redirect on the default client', async () => {
    // SECURITY regression (PR #355 review): `http://localhost:x@evil.com/cb` matches the
    // `http://localhost:*/**` glob as a STRING, but parses to host `evil.com`. The callback
    // must refuse it so the victim's code is never 302'd to the attacker's host.
    const codec = new OAuthStateCodec(SECRET);
    const store = buildStore();
    const token = codec.encode({
      clientState: 'abc',
      clientRedirectUri: 'http://localhost:x@evil.com/cb',
      clientId: DEFAULT_CLIENT_ID,
    });
    const res = await request(buildAppWithStore(codec, store))
      .get('/oauth/callback')
      .query({ code: 'STOLEN', state: token });
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
    expect(res.text).not.toContain('STOLEN');
  });
});
