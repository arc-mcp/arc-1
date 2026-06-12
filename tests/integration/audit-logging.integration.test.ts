/**
 * Integration tests for audit logging against a live SAP system.
 *
 * Tests that real ADT operations produce correctly structured audit events
 * including HTTP request logs with real status codes and durations.
 *
 * Missing credentials are treated as setup errors and fail the suite.
 */

import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import type { AuditEvent } from '../../src/server/audit.js';
import { logger } from '../../src/server/logger.js';
import { FileSink } from '../../src/server/sinks/file.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { getTestClient, requireSapCredentials } from './helpers.js';

describe('Audit Logging Integration', () => {
  let client: AdtClient;
  const events: AuditEvent[] = [];
  const captureSink = { write: (e: AuditEvent) => events.push(e) };
  const logFile = join(tmpdir(), `arc1-integ-audit-${Date.now()}.jsonl`);
  let fileSink: FileSink;

  beforeAll(() => {
    requireSapCredentials();
    client = getTestClient();
    logger.addSink(captureSink);
    fileSink = new FileSink(logFile);
    logger.addSink(fileSink);
  });

  afterAll(async () => {
    await fileSink.flush();
    if (existsSync(logFile)) {
      unlinkSync(logFile);
    }
  });

  it('produces tool_call_start and tool_call_end for a successful SAPRead', async () => {
    events.length = 0;

    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', {
      type: 'SYSTEM',
      name: '',
    });

    expect(result.isError).toBeUndefined();

    const starts = events.filter((e) => e.event === 'tool_call_start');
    const ends = events.filter((e) => e.event === 'tool_call_end');

    expect(starts.length).toBeGreaterThanOrEqual(1);
    expect(ends.length).toBeGreaterThanOrEqual(1);

    const start = starts[starts.length - 1]!;
    const end = ends[ends.length - 1]!;

    // Both share the same requestId
    expect(start.requestId).toBe(end.requestId);
    expect(start.requestId).toMatch(/^REQ-/);

    // Start has tool and args
    expect((start as any).tool).toBe('SAPRead');
    expect((start as any).args.type).toBe('SYSTEM');

    // End has success status and real duration
    expect((end as any).status).toBe('success');
    expect((end as any).durationMs).toBeGreaterThan(0);
    expect((end as any).resultSize).toBeGreaterThan(0);
  });

  it('produces http_request events with real status codes', async () => {
    events.length = 0;

    await handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', {
      type: 'SYSTEM',
      name: '',
    });

    const httpEvents = events.filter((e) => e.event === 'http_request');
    // Should have at least one HTTP request (GET /sap/bc/adt/core/discovery or similar)
    expect(httpEvents.length).toBeGreaterThanOrEqual(1);

    for (const httpEvent of httpEvents) {
      const he = httpEvent as any;
      expect(he.method).toBeTruthy();
      expect(he.path).toBeTruthy();
      expect(he.statusCode).toBeGreaterThanOrEqual(200);
      expect(he.statusCode).toBeLessThan(500);
      expect(he.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('correlates HTTP requests with their parent tool call via requestId', async () => {
    events.length = 0;

    await handleToolCall(client, DEFAULT_CONFIG, 'SAPSearch', {
      query: 'CL_ABAP_*',
      maxResults: 5,
    });

    const starts = events.filter((e) => e.event === 'tool_call_start');
    const httpEvents = events.filter((e) => e.event === 'http_request');

    expect(starts.length).toBeGreaterThanOrEqual(1);

    // All HTTP events during this tool call should have the same requestId
    const toolRequestId = starts[starts.length - 1]!.requestId;
    const correlatedHttp = httpEvents.filter((e) => e.requestId === toolRequestId);
    expect(correlatedHttp.length).toBeGreaterThanOrEqual(1);
  });

  it('produces error audit events for non-existent objects', async () => {
    events.length = 0;

    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', {
      type: 'PROG',
      name: 'ZNONEXISTENT_PROGRAM_XYZ_999',
    });

    expect(result.isError).toBe(true);

    const ends = events.filter((e) => e.event === 'tool_call_end');
    expect(ends.length).toBeGreaterThanOrEqual(1);

    const end = ends[ends.length - 1] as any;
    expect(end.status).toBe('error');
    expect(end.errorClass).toBeTruthy();
    expect(end.errorMessage).toBeTruthy();
    expect(end.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('logs HTTP errors with truncated error body', async () => {
    events.length = 0;

    // Request a non-existent program — SAP returns 404 with XML error body
    await handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', {
      type: 'PROG',
      name: 'ZNONEXISTENT_PROG_AUDIT_TEST',
    });

    const httpErrors = events.filter((e) => e.event === 'http_request' && (e as any).statusCode >= 400);

    // Should have at least one failed HTTP request
    expect(httpErrors.length).toBeGreaterThanOrEqual(1);

    const firstError = httpErrors[0] as any;
    expect(firstError.statusCode).toBeGreaterThanOrEqual(400);
    // Error body should be present but truncated
    if (firstError.errorBody) {
      expect(firstError.errorBody.length).toBeLessThanOrEqual(200);
    }
  });

  it('writes all events to file sink as valid JSON lines', async () => {
    // Flush the file sink to write buffered events
    await fileSink.flush();

    expect(existsSync(logFile)).toBe(true);
    const content = readFileSync(logFile, 'utf-8');
    const lines = content
      .trim()
      .split('\n')
      .filter((l) => l.length > 0);

    expect(lines.length).toBeGreaterThan(0);

    // Every line must be valid JSON
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed.timestamp).toBeTruthy();
      expect(parsed.level).toBeTruthy();
      expect(parsed.event).toBeTruthy();
    }
  });

  it('produces auth_scope_denied for blocked scope', async () => {
    events.length = 0;

    const authInfo = {
      token: 'test-token',
      clientId: 'integration-test-client',
      scopes: ['read'],
      extra: { userName: 'test-user' },
    };

    const result = await handleToolCall(
      client,
      DEFAULT_CONFIG,
      'SAPWrite',
      {
        type: 'PROG',
        name: 'ZHELLO',
        source: 'test',
      },
      authInfo,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Insufficient scope');

    const denied = events.filter((e) => e.event === 'auth_scope_denied');
    expect(denied.length).toBeGreaterThanOrEqual(1);

    const deniedEvent = denied[denied.length - 1] as any;
    expect(deniedEvent.tool).toBe('SAPWrite');
    expect(deniedEvent.requiredScope).toBe('write');
    expect(deniedEvent.availableScopes).toEqual(['read']);
    expect(deniedEvent.user).toBe('test-user');
  });
});
