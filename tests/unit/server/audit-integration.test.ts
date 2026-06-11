/**
 * Integration tests for the audit logging system.
 *
 * Tests the full flow: tool call → audit events → sinks.
 * Uses mocked fetch (no real SAP connection) but exercises
 * the real Logger, StderrSink, FileSink, and requestContext.
 */

import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import type { AuditEvent } from '../../../src/server/audit.js';
import { FileSink } from '../../../src/server/sinks/file.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

// Mock undici's fetch (used by AdtHttpClient.doFetch)
const mockFetch = vi.fn();
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: mockFetch };
});

const { AdtClient } = await import('../../../src/adt/client.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

function createClient(): AdtClient {
  return new AdtClient({
    baseUrl: 'http://sap:8000',
    username: 'admin',
    password: 'secret',
    safety: unrestrictedSafetyConfig(),
  });
}

describe('Audit Logging Integration', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  const tmpFile = join(tmpdir(), `arc1-audit-integ-${Date.now()}.jsonl`);

  beforeEach(() => {
    vi.resetAllMocks();
    mockFetch.mockResolvedValue(mockResponse(200, "REPORT zhello.\nWRITE: / 'Hello'."));
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    if (existsSync(tmpFile)) {
      unlinkSync(tmpFile);
    }
  });

  it('emits tool_call_start and tool_call_end for successful calls', async () => {
    const events: AuditEvent[] = [];
    const captureSink = { write: (e: AuditEvent) => events.push(e) };

    // Replace the global logger temporarily
    const { logger } = await import('../../../src/server/logger.js');
    logger.addSink(captureSink);

    await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'PROG',
      name: 'ZHELLO',
    });

    const starts = events.filter((e) => e.event === 'tool_call_start');
    const ends = events.filter((e) => e.event === 'tool_call_end');

    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);

    const start = starts[0]!;
    const end = ends[0]!;

    // Both should share the same requestId
    expect(start.requestId).toBe(end.requestId);
    expect(start.requestId).toMatch(/^REQ-/);

    // Start event has tool and sanitized args
    expect((start as any).tool).toBe('SAPRead');
    expect((start as any).args).toEqual({ type: 'PROG', name: 'ZHELLO' });

    // End event has status and duration
    expect((end as any).status).toBe('success');
    expect((end as any).durationMs).toBeGreaterThanOrEqual(0);
    expect((end as any).resultSize).toBeGreaterThan(0);
  });

  it('emits auth_scope_denied for insufficient scopes', async () => {
    const events: AuditEvent[] = [];
    const captureSink = { write: (e: AuditEvent) => events.push(e) };
    const { logger } = await import('../../../src/server/logger.js');
    logger.addSink(captureSink);

    const authInfo = {
      token: 'test-token',
      clientId: 'test-client',
      scopes: ['read'],
      extra: {},
    };

    await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {}, authInfo);

    const denied = events.filter((e) => e.event === 'auth_scope_denied');
    expect(denied).toHaveLength(1);
    expect((denied[0] as any).requiredScope).toBe('write');
    expect((denied[0] as any).availableScopes).toEqual(['read']);
  });

  it('sanitizes sensitive args in tool_call_start events', async () => {
    const events: AuditEvent[] = [];
    const captureSink = { write: (e: AuditEvent) => events.push(e) };
    const { logger } = await import('../../../src/server/logger.js');
    logger.addSink(captureSink);

    await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'PROG',
      name: 'ZHELLO',
      password: 'should-be-redacted',
    });

    const starts = events.filter((e) => e.event === 'tool_call_start');
    expect(starts).toHaveLength(1);
    expect((starts[0] as any).args.password).toBe('[REDACTED]');
    expect((starts[0] as any).args.name).toBe('ZHELLO');
  });

  it('writes events to file sink', async () => {
    const { logger } = await import('../../../src/server/logger.js');
    const fileSink = new FileSink(tmpFile);
    logger.addSink(fileSink);

    await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'PROG',
      name: 'ZHELLO',
    });

    await fileSink.flush();

    expect(existsSync(tmpFile)).toBe(true);
    const content = readFileSync(tmpFile, 'utf-8');
    const lines = content
      .trim()
      .split('\n')
      .filter((l) => l.length > 0);

    // Should have at least tool_call_start + tool_call_end + http_request events
    expect(lines.length).toBeGreaterThanOrEqual(2);

    // All lines should be valid JSON
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }

    // Find the tool_call events in the file
    const fileEvents = lines.map((l) => JSON.parse(l));
    const toolStart = fileEvents.find((e: any) => e.event === 'tool_call_start');
    const toolEnd = fileEvents.find((e: any) => e.event === 'tool_call_end');

    expect(toolStart).toBeDefined();
    expect(toolEnd).toBeDefined();
    expect(toolStart.tool).toBe('SAPRead');
    expect(toolEnd.status).toBe('success');
  });

  it('sanitizes SAPDiagnose dump detail resultPreview in audit events', async () => {
    const events: AuditEvent[] = [];
    const captureSink = { write: (e: AuditEvent) => events.push(e) };
    const { logger } = await import('../../../src/server/logger.js');
    logger.addSink(captureSink);

    mockFetch.mockReset();
    const dumpXml = `<?xml version="1.0"?>
<dump:dump xmlns:dump="http://www.sap.com/adt/categories/dump" error="ERR" author="USR" exception="CX" terminatedProgram="ZPROG" datetime="2026-01-01T00:00:00Z">
  <dump:chapters>
    <dump:chapter name="kap0" title="Short Text" category="ABAP Developer View" line="1" chapterOrder="1" categoryOrder="1"/>
  </dump:chapters>
</dump:dump>`;
    mockFetch.mockImplementation((url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('/runtime/dump/DUMP_ID/formatted')) {
        return Promise.resolve(
          mockResponse(200, 'SECRET_DUMP_CONTENT_SHOULD_NOT_APPEAR_IN_AUDIT_PREVIEW', { 'x-csrf-token': 'T' }),
        );
      }
      if (urlStr.includes('/runtime/dump/DUMP_ID')) {
        return Promise.resolve(mockResponse(200, dumpXml, { 'x-csrf-token': 'T' }));
      }
      return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
    });

    await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
      action: 'dumps',
      id: 'DUMP_ID',
      includeFullText: true,
    });

    const end = events.find((e) => e.event === 'tool_call_end' && (e as any).status === 'success') as
      | Record<string, unknown>
      | undefined;
    const preview = String(end?.resultPreview ?? '');
    expect(preview).toContain('[omitted');
    expect(preview).not.toContain('SECRET_DUMP_CONTENT_SHOULD_NOT_APPEAR_IN_AUDIT_PREVIEW');
  });
});
