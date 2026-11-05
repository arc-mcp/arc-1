import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEvent } from '../../../src/server/audit.js';
import { logger } from '../../../src/server/logger.js';
import type { McpRateLimiter } from '../../../src/server/mcp-rate-limit.js';
import type { ServerConfig } from '../../../src/server/types.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const programSource = 'REPORT zhello.\n';
const sourcePath = '/sap/bc/adt/programs/programs/ZHELLO/source/main';
const metadataPath = '/sap/bc/adt/programs/programs/zhello';
const programMetadata =
  '<p:abapProgram xmlns:p="http://www.sap.com/adt/programs/programs" xmlns:c="http://www.sap.com/adt/core" c:name="ZHELLO" c:type="PROG/P" c:version="active" p:programType="executableProgram"><c:packageRef c:name="$TMP"/></p:abapProgram>';
beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string, init: RequestInit = {}) => {
    const request = new URL(String(url));
    expect(init.method ?? 'GET').toBe('GET');
    expect(request.origin).toBe('http://test.invalid');
    expect([sourcePath, metadataPath]).toContain(request.pathname);
    if (request.pathname === metadataPath)
      return mockResponse(200, programMetadata, { 'content-type': 'application/xml' });
    return mockResponse(200, programSource, { 'content-type': 'text/plain' });
  });
});

afterEach(() => {
  // Keep unexpected requests observable even if dispatch catches a mock assertion.
  for (const [url, init] of mockFetch.mock.calls) {
    expect(init?.method ?? 'GET').toBe('GET');
    expect(new URL(String(url)).origin).toBe('http://test.invalid');
    expect([sourcePath, metadataPath]).toContain(new URL(String(url)).pathname);
  }
});

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

function makeClient(): InstanceType<typeof AdtClient> {
  // Denials stop before ADT; allowed and bypassed calls use the exact mocked read.
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
    expect(mockFetch).not.toHaveBeenCalled();
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
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('OIDC: keys by extra.sub when userName is absent (no clientId collapse)', async () => {
    // OIDC verifier shape: extra={sub, iss}, clientId=azp (shared app id).
    // Two distinct OIDC users on the same app must NOT share a rate-limit bucket.
    const stubLimiter: McpRateLimiter = {
      consume: vi.fn().mockResolvedValue({ allowed: true }),
    };

    const aliceResult = await handleToolCall(
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
    const bobResult = await handleToolCall(
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
    expect(mockFetch).toHaveBeenCalledTimes(4);
    for (const result of [aliceResult, bobResult]) {
      expect(result.isError).not.toBe(true);
      expect(result.content[0]?.text).toContain(programSource.trim());
    }
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
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('stdio mode (no authInfo) skips the limiter entirely', async () => {
    const stubLimiter: McpRateLimiter = {
      consume: vi.fn().mockResolvedValue({ allowed: false, retryAfterMs: 5000, limitPerMinute: 1 }),
    };

    const result = await handleToolCall(
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
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.isError).not.toBe(true);
    expect(result.content[0]?.text).toContain(programSource.trim());
  });

  it('no limiter argument means no rate limiting (backward compat for tests)', async () => {
    // Call without the rate-limiter arg — the rate-limit branch must be skipped cleanly.
    // The real dispatch/read path completes against the deterministic ADT fixture.
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
    expect(result.isError).not.toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const text = result.content[0]?.text as string;
    expect(typeof text).toBe('string');
    expect(text).not.toMatch(/"error"\s*:\s*"rate_limited"/);
    expect(text).toContain(programSource.trim());
  });
});
