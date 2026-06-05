import { describe, expect, it } from 'vitest';
import { OAuthStateCodec } from '../../../src/server/oauth-state.js';

const SECRET = 'test-signing-secret-at-least-16-bytes-long';
const T0 = 1_700_000_000_000; // fixed epoch ms for deterministic expiry tests
const TEST_CLIENT_ID = 'arc1-test-client';

describe('OAuthStateCodec', () => {
  it('rejects an empty signing secret', () => {
    expect(() => new OAuthStateCodec('')).toThrow(/non-empty/);
  });

  it('round-trips a state containing literal "+" (the issue #214 trigger)', () => {
    const codec = new OAuthStateCodec(SECRET);
    const clientState = '6QadZ5GFXGvZ649+OuQi+Q==';
    const token = codec.encode({
      clientState,
      clientRedirectUri: 'http://127.0.0.1:33418/',
      clientId: TEST_CLIENT_ID,
      now: T0,
    });
    const decoded = codec.decode(token, T0 + 1000);
    expect(decoded).toEqual({
      kind: 'ok',
      clientState,
      clientRedirectUri: 'http://127.0.0.1:33418/',
      clientId: TEST_CLIENT_ID,
    });
  });

  it('produces a URL-safe token (no +, /, or = that XSUAA / Express would mangle)', () => {
    const codec = new OAuthStateCodec(SECRET);
    // Use a client state full of the dangerous characters; the token itself
    // must still be URL-safe because the payload is base64url-encoded.
    const token = codec.encode({
      clientState: 'a+b/c+d==',
      clientRedirectUri: 'http://localhost:9999/cb',
      clientId: TEST_CLIENT_ID,
      now: T0,
    });
    expect(token).toMatch(/^[A-Za-z0-9_.-]+$/);
    expect(token).not.toContain('+');
    expect(token).not.toContain('/');
    expect(token).not.toContain('=');
  });

  it('round-trips when clientState is absent (state is optional in OAuth)', () => {
    const codec = new OAuthStateCodec(SECRET);
    const token = codec.encode({
      clientRedirectUri: 'https://claude.ai/api/mcp/auth_callback',
      clientId: TEST_CLIENT_ID,
      now: T0,
    });
    const decoded = codec.decode(token, T0 + 1000);
    expect(decoded).toEqual({
      kind: 'ok',
      clientState: undefined,
      clientRedirectUri: 'https://claude.ai/api/mcp/auth_callback',
      clientId: TEST_CLIENT_ID,
    });
  });

  it('preserves additional base64 specials (/, multiple +, padding)', () => {
    const codec = new OAuthStateCodec(SECRET);
    for (const clientState of ['a+b+c+d==', 'aaa/bbb==', '+leading==', 'trailing+==', 'mix+/+/==']) {
      const token = codec.encode({
        clientState,
        clientRedirectUri: 'http://localhost:1/cb',
        clientId: TEST_CLIENT_ID,
        now: T0,
      });
      const decoded = codec.decode(token, T0 + 1000);
      expect(decoded.kind).toBe('ok');
      if (decoded.kind === 'ok') expect(decoded.clientState).toBe(clientState);
    }
  });

  it('rejects a tampered payload (bad_signature)', () => {
    const codec = new OAuthStateCodec(SECRET);
    const token = codec.encode({
      clientState: 'abc',
      clientRedirectUri: 'http://localhost:1/cb',
      clientId: TEST_CLIENT_ID,
      now: T0,
    });
    const [payloadB64, sig] = token.split('.');
    // Flip a char in the payload — signature no longer matches.
    const tamperedChar = payloadB64[0] === 'A' ? 'B' : 'A';
    const tampered = `${tamperedChar}${payloadB64.slice(1)}.${sig}`;
    expect(codec.decode(tampered, T0 + 1000)).toEqual({ kind: 'error', reason: 'bad_signature' });
  });

  it('rejects a tampered signature (bad_signature)', () => {
    const codec = new OAuthStateCodec(SECRET);
    const token = codec.encode({
      clientState: 'abc',
      clientRedirectUri: 'http://localhost:1/cb',
      clientId: TEST_CLIENT_ID,
      now: T0,
    });
    const [payloadB64] = token.split('.');
    expect(codec.decode(`${payloadB64}.AAAAAAAAAAAAAAAAAAAAAA`, T0 + 1000)).toEqual({
      kind: 'error',
      reason: 'bad_signature',
    });
  });

  it('rejects a token signed with a different key (bad_signature)', () => {
    const a = new OAuthStateCodec(SECRET);
    const b = new OAuthStateCodec('a-completely-different-signing-secret');
    const token = a.encode({
      clientState: 'abc',
      clientRedirectUri: 'http://localhost:1/cb',
      clientId: TEST_CLIENT_ID,
      now: T0,
    });
    expect(b.decode(token, T0 + 1000)).toEqual({ kind: 'error', reason: 'bad_signature' });
  });

  it('rejects an expired token (expired)', () => {
    const codec = new OAuthStateCodec(SECRET, { ttlSeconds: 60 });
    const token = codec.encode({
      clientState: 'abc',
      clientRedirectUri: 'http://localhost:1/cb',
      clientId: TEST_CLIENT_ID,
      now: T0,
    });
    // 61s later → past the 60s TTL.
    expect(codec.decode(token, T0 + 61_000)).toEqual({ kind: 'error', reason: 'expired' });
    // Still valid at 59s.
    expect(codec.decode(token, T0 + 59_000).kind).toBe('ok');
  });

  it('rejects malformed tokens (malformed)', () => {
    const codec = new OAuthStateCodec(SECRET);
    expect(codec.decode('', T0).reason).toBe('malformed');
    expect(codec.decode('no-dot-here', T0).reason).toBe('malformed');
    expect(codec.decode('.sigonly', T0).reason).toBe('malformed');
    expect(codec.decode('payloadonly.', T0).reason).toBe('malformed');
  });

  it("a fresh codec with the same secret can verify another instance's token (stateless / multi-instance)", () => {
    const writer = new OAuthStateCodec(SECRET);
    const reader = new OAuthStateCodec(SECRET); // simulates a different CF instance
    const token = writer.encode({
      clientState: 'x+y==',
      clientRedirectUri: 'http://localhost:1/cb',
      clientId: TEST_CLIENT_ID,
      now: T0,
    });
    const decoded = reader.decode(token, T0 + 1000);
    expect(decoded.kind).toBe('ok');
    if (decoded.kind === 'ok') expect(decoded.clientState).toBe('x+y==');
  });

  it('embeds and recovers the client_id in the signed state token', () => {
    const codec = new OAuthStateCodec(SECRET);
    const token = codec.encode({
      clientState: 'abc',
      clientRedirectUri: 'http://localhost:1/cb',
      clientId: 'arc1-my-client',
      now: T0,
    });
    const decoded = codec.decode(token, T0 + 1000);
    expect(decoded).toEqual({
      kind: 'ok',
      clientState: 'abc',
      clientRedirectUri: 'http://localhost:1/cb',
      clientId: 'arc1-my-client',
    });
  });
});
