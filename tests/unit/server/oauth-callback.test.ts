import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createOAuthCallbackHandler } from '../../../src/server/http.js';
import { OAuthStateCodec } from '../../../src/server/oauth-state.js';

const SECRET = 'callback-test-signing-secret-1234567890';

function buildApp(codec: OAuthStateCodec): express.Express {
  const app = express();
  app.get('/oauth/callback', createOAuthCallbackHandler(codec));
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
    const token = codec.encode({ clientState, clientRedirectUri: 'http://127.0.0.1:33418/' });

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
    const token = codec.encode({ clientState: 'a+b+c==', clientRedirectUri: 'http://localhost:1/cb' });
    const res = await request(buildApp(codec)).get('/oauth/callback').query({ code: 'x', state: token });
    const loc = res.headers.location as string;
    // The state segment must not contain a raw '+'.
    const stateSegment = loc.split('state=')[1] ?? '';
    expect(stateSegment).not.toContain('+');
    expect(stateSegment).toContain('%2B');
  });

  it('forwards OAuth errors to the client with the original state', async () => {
    const codec = new OAuthStateCodec(SECRET);
    const token = codec.encode({ clientState: 'st+ate==', clientRedirectUri: 'http://127.0.0.1:5/cb' });
    const res = await request(buildApp(codec))
      .get('/oauth/callback')
      .query({ error: 'access_denied', error_description: 'user cancelled', state: token });
    expect(res.status).toBe(302);
    const loc = res.headers.location as string;
    const u = new URL(loc);
    expect(u.searchParams.get('error')).toBe('access_denied');
    expect(u.searchParams.get('error_description')).toBe('user cancelled');
    expect(u.searchParams.get('state')).toBe('st+ate==');
    expect(u.searchParams.get('code')).toBeNull();
  });

  it('round-trips a state with no "+" unchanged', async () => {
    const codec = new OAuthStateCodec(SECRET);
    const token = codec.encode({ clientState: 'mElKiL3xesnEy0LnXDyKvA==', clientRedirectUri: 'http://localhost:1/cb' });
    const res = await request(buildApp(codec)).get('/oauth/callback').query({ code: 'c', state: token });
    expect(clientParsedState(res.headers.location as string)).toBe('mElKiL3xesnEy0LnXDyKvA==');
  });

  it('omits state when the client did not send one', async () => {
    const codec = new OAuthStateCodec(SECRET);
    const token = codec.encode({ clientRedirectUri: 'http://localhost:1/cb' });
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
