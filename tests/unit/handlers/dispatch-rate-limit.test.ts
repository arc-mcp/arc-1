import { describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { handleToolCall } from '../../../src/handlers/dispatch.js';
import type { AuditEvent } from '../../../src/server/audit.js';
import { logger } from '../../../src/server/logger.js';
import type { McpRateLimiter } from '../../../src/server/mcp-rate-limit.js';
import type { ServerConfig } from '../../../src/server/types.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

/**
 * Task 4 (Layer 2): handleToolCall integration with the per-user rate limiter.
 *
 * The limiter is consulted at the TOP of handleToolCall, immediately after the
 * tool_call_start audit event and before any other work. On denial, the handler
 * returns an MCP tool error (NOT HTTP 429) with `{error:'rate_limited', retryAfter, message}`.
 *
 * Stdio mode (no authInfo) bypasses the limiter — there's no user identity to key on.
 */

function captureAuditEvents(): AuditEvent[] {
  const events: AuditEvent[] = [];
  logger.addSink({ write: (e: AuditEvent) => events.push(e) });
  return events;
}

function makeConfig(): ServerConfig {
  return { ...DEFAULT_CONFIG, url: 'http://test.invalid' };
}

function makeClient(): AdtClient {
  // Constructed but never used in these tests — the limit check runs before any
  // ADT call. The client must exist because handleToolCall's signature requires it.
  return new AdtClient({ baseUrl: 'http://test.invalid' });
}

describe('handleToolCall — Layer 2 rate limiting', () => {
  it('returns MCP tool error when limiter denies the call', async () => {
    const stubLimiter: McpRateLimiter = {
      consume: vi.fn().mockResolvedValue({
        allowed: false,
        retryAfterMs: 12_345,
        limitPerMinute: 60,
      }),
    };

    const result = await handleToolCall(
      makeClient(),
      makeConfig(),
      'SAPRead',
      { type: 'PROG', name: 'ZHELLO' },
      { token: 'tok', scopes: ['read'], clientId: 'cli', extra: { userName: 'marian@example.com' } },
      undefined,
      undefined,
      false,
      stubLimiter,
    );

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    const text = result.content[0]?.text;
    expect(typeof text).toBe('string');
    const payload = JSON.parse(text as string);
    expect(payload.error).toBe('rate_limited');
    // retryAfter is in seconds, rounded up from milliseconds
    expect(payload.retryAfter).toBe(13);
    expect(payload.message).toContain('60/min per user');
    expect(payload.message).toContain('13 seconds');
    // Limiter was consulted with the userKey derived from extra.userName
    expect(stubLimiter.consume).toHaveBeenCalledWith('marian@example.com', 'SAPRead');
  });

  it('falls back to clientId when no extra identity claim is set', async () => {
    const stubLimiter: McpRateLimiter = {
      consume: vi.fn().mockResolvedValue({ allowed: false, retryAfterMs: 5000, limitPerMinute: 60 }),
    };

    await handleToolCall(
      makeClient(),
      makeConfig(),
      'SAPRead',
      { type: 'PROG', name: 'ZHELLO' },
      { token: 'tok', scopes: ['read'], clientId: 'copilot-studio' },
      undefined,
      undefined,
      false,
      stubLimiter,
    );

    expect(stubLimiter.consume).toHaveBeenCalledWith('copilot-studio', 'SAPRead');
  });

  it('OIDC: keys by extra.sub when userName is absent (no clientId collapse)', async () => {
    // OIDC verifier shape: extra={sub, iss}, clientId=azp (shared app id).
    // Two distinct OIDC users on the same app must NOT share a rate-limit bucket.
    const stubLimiter: McpRateLimiter = {
      consume: vi.fn().mockResolvedValue({ allowed: true }),
    };

    await handleToolCall(
      makeClient(),
      makeConfig(),
      'SAPRead',
      { type: 'PROG', name: 'ZHELLO' },
      {
        token: 'tok',
        scopes: ['read'],
        clientId: 'shared-azp-app-id',
        extra: { sub: 'user-uuid-alice', iss: 'https://idp.example' },
      },
      undefined,
      undefined,
      false,
      stubLimiter,
    );
    await handleToolCall(
      makeClient(),
      makeConfig(),
      'SAPRead',
      { type: 'PROG', name: 'ZHELLO' },
      {
        token: 'tok',
        scopes: ['read'],
        clientId: 'shared-azp-app-id',
        extra: { sub: 'user-uuid-bob', iss: 'https://idp.example' },
      },
      undefined,
      undefined,
      false,
      stubLimiter,
    );

    expect(stubLimiter.consume).toHaveBeenNthCalledWith(1, 'user-uuid-alice', 'SAPRead');
    expect(stubLimiter.consume).toHaveBeenNthCalledWith(2, 'user-uuid-bob', 'SAPRead');
    // Critical assertion: the two calls used DIFFERENT keys despite same clientId.
    expect(stubLimiter.consume).not.toHaveBeenCalledWith('shared-azp-app-id', 'SAPRead');
  });

  it('emits mcp_rate_limited audit event on denial', async () => {
    const events = captureAuditEvents();
    const stubLimiter: McpRateLimiter = {
      consume: vi.fn().mockResolvedValue({ allowed: false, retryAfterMs: 8000, limitPerMinute: 30 }),
    };

    await handleToolCall(
      makeClient(),
      makeConfig(),
      'SAPSearch',
      { searchType: 'objects', query: 'Z*' },
      { token: 'tok', scopes: ['read'], clientId: 'cli', extra: { userName: 'alice' } },
      undefined,
      undefined,
      false,
      stubLimiter,
    );

    const denial = events.find((e) => e.event === 'mcp_rate_limited');
    expect(denial).toBeDefined();
    if (denial?.event !== 'mcp_rate_limited') throw new Error('type guard');
    expect(denial.user).toBe('alice');
    expect(denial.tool).toBe('SAPSearch');
    expect(denial.limitPerMinute).toBe(30);
    expect(denial.retryAfterMs).toBe(8000);
    expect(denial.level).toBe('warn');
  });

  it('stdio mode (no authInfo) skips the limiter entirely', async () => {
    const stubLimiter: McpRateLimiter = {
      consume: vi.fn().mockResolvedValue({ allowed: false, retryAfterMs: 5000, limitPerMinute: 1 }),
    };

    await handleToolCall(
      makeClient(),
      makeConfig(),
      'SAPRead',
      { type: 'PROG', name: 'ZHELLO' },
      undefined, // no authInfo
      undefined,
      undefined,
      false,
      stubLimiter,
    );

    // The limiter must NOT have been consulted — there's no user to key on.
    expect(stubLimiter.consume).not.toHaveBeenCalled();
  });

  it('no limiter argument means no rate limiting (backward compat for tests)', async () => {
    // Call without the rate-limiter arg — the rate-limit branch must be skipped cleanly.
    // We expect this call to pass the rate-limit gate; whatever happens next (scope check,
    // schema validation, actual SAP call) is out of scope for this test.
    const result = await handleToolCall(
      makeClient(),
      makeConfig(),
      'SAPRead',
      { type: 'PROG', name: 'ZHELLO' },
      { token: 'tok', scopes: ['read'], clientId: 'cli', extra: { userName: 'bob' } },
      undefined,
      undefined,
      false,
      // no mcpRateLimiter
    );
    // We don't assert on result content — only that the call did not short-circuit
    // with a rate-limit response (whatever happens downstream — network error,
    // validation error — is fine; just verify the rate-limit branch wasn't taken).
    const text = result.content[0]?.text as string;
    expect(typeof text).toBe('string');
    expect(text).not.toMatch(/"error"\s*:\s*"rate_limited"/);
  });
});
