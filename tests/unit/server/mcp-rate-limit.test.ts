import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { describe, expect, it } from 'vitest';
import { createMcpRateLimiter, resolveRateLimitUserKey } from '../../../src/server/mcp-rate-limit.js';

/** Minimal AuthInfo factory — every field is optional in the SDK type. */
function authInfo(extra: Record<string, unknown>, clientId?: string): AuthInfo {
  return { token: 'tok', scopes: ['read'], clientId: clientId ?? 'cli', extra } as AuthInfo;
}

/**
 * Task 4 (Layer 2): Per-user MCP tool-call rate limiter.
 *
 * Pure unit tests of the limiter wrapper. The handler-integration tests
 * (handleToolCall returns MCP tool error on denial) live in
 * tests/unit/handlers/dispatch-rate-limit.test.ts.
 */
describe('createMcpRateLimiter (Layer 2)', () => {
  it('allows requests under the per-minute cap', async () => {
    const limiter = createMcpRateLimiter(5);
    const decisions = await Promise.all(Array.from({ length: 5 }, () => limiter.consume('userA', 'SAPRead')));
    expect(decisions.every((d) => d.allowed === true)).toBe(true);
  });

  it('denies the (N+1)-th request with retryAfterMs > 0 and the configured limit', async () => {
    const limiter = createMcpRateLimiter(3);
    await limiter.consume('userA', 'SAPRead');
    await limiter.consume('userA', 'SAPRead');
    await limiter.consume('userA', 'SAPRead');
    const denied = await limiter.consume('userA', 'SAPRead');
    expect(denied.allowed).toBe(false);
    if (denied.allowed) throw new Error('type guard'); // narrow for TS
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(60_000);
    expect(denied.limitPerMinute).toBe(3);
  });

  it('tracks two distinct user keys independently', async () => {
    const limiter = createMcpRateLimiter(2);
    // User A: 2 succeed
    expect((await limiter.consume('userA', 'SAPRead')).allowed).toBe(true);
    expect((await limiter.consume('userA', 'SAPRead')).allowed).toBe(true);
    // User A's 3rd should fail
    expect((await limiter.consume('userA', 'SAPRead')).allowed).toBe(false);
    // User B starts fresh — first two should succeed
    expect((await limiter.consume('userB', 'SAPRead')).allowed).toBe(true);
    expect((await limiter.consume('userB', 'SAPRead')).allowed).toBe(true);
  });

  it('perMinute=0 returns a no-op stub that always allows', async () => {
    const limiter = createMcpRateLimiter(0);
    const decisions = await Promise.all(Array.from({ length: 1000 }, () => limiter.consume('userA', 'SAPRead')));
    expect(decisions.every((d) => d.allowed === true)).toBe(true);
  });

  it('tool parameter does not affect the bucket — it is only an audit label', async () => {
    const limiter = createMcpRateLimiter(2);
    // Both calls (different tools, same user) consume from the same bucket
    expect((await limiter.consume('userA', 'SAPRead')).allowed).toBe(true);
    expect((await limiter.consume('userA', 'SAPWrite')).allowed).toBe(true);
    // The third hits the limit
    expect((await limiter.consume('userA', 'SAPSearch')).allowed).toBe(false);
  });
});

/**
 * Per-user key derivation. Critical for OIDC mode where `clientId = azp` (the
 * OAuth app id) is shared by every user of that app — falling back to clientId
 * would collapse them all into one bucket. The resolver walks the most-specific
 * identity claim first.
 */
describe('resolveRateLimitUserKey', () => {
  it('XSUAA shape: prefers extra.userName (SAP logon name)', () => {
    expect(resolveRateLimitUserKey(authInfo({ userName: 'MARIAN', email: 'm@example.com' }))).toBe('MARIAN');
  });

  it('OIDC shape: uses extra.sub when userName is absent (the bug Codex flagged)', () => {
    // OIDC tokens populate {sub, iss} but NOT userName. clientId is the azp claim,
    // shared by every user of the app. Without sub-aware resolution, all of them
    // would collapse into one bucket keyed on clientId.
    const oidc = authInfo({ sub: 'user-uuid-alice', iss: 'https://idp.example' }, 'app-abc');
    expect(resolveRateLimitUserKey(oidc)).toBe('user-uuid-alice');
  });

  it('OIDC shape: two distinct users on the same OIDC app get distinct keys', () => {
    const alice = authInfo({ sub: 'user-uuid-alice', iss: 'https://idp.example' }, 'app-abc');
    const bob = authInfo({ sub: 'user-uuid-bob', iss: 'https://idp.example' }, 'app-abc'); // same clientId!
    expect(resolveRateLimitUserKey(alice)).not.toBe(resolveRateLimitUserKey(bob));
  });

  it('prefers extra.email over extra.sub when both are present', () => {
    expect(resolveRateLimitUserKey(authInfo({ email: 'a@b.com', sub: 'sub-id' }))).toBe('a@b.com');
  });

  it('falls back to preferred_username when userName/email/sub are absent', () => {
    expect(resolveRateLimitUserKey(authInfo({ preferred_username: 'someUser' }))).toBe('someUser');
  });

  it('falls back to clientId only when no identity claim is usable', () => {
    expect(resolveRateLimitUserKey(authInfo({}, 'api-key:viewer'))).toBe('api-key:viewer');
  });

  it("returns '__anon__' when authInfo is undefined", () => {
    expect(resolveRateLimitUserKey(undefined)).toBe('__anon__');
  });

  it("returns '__anon__' when every candidate is empty or wrong-typed", () => {
    const trash = {
      token: 'tok',
      scopes: ['read'],
      clientId: '',
      extra: { userName: '', email: null, sub: 42, preferred_username: undefined },
    } as unknown as AuthInfo;
    expect(resolveRateLimitUserKey(trash)).toBe('__anon__');
  });

  it('skips empty-string identity values and tries the next candidate', () => {
    // userName empty → falls through to email
    expect(resolveRateLimitUserKey(authInfo({ userName: '', email: 'a@b.com' }))).toBe('a@b.com');
  });
});
