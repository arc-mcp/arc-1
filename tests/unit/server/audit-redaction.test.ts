import { describe, expect, it, vi } from 'vitest';
import type { AuditEvent, HttpRequestEvent, ToolCallEndEvent } from '../../../src/server/audit.js';
import { redactAuditEvent } from '../../../src/server/audit.js';
import { requestContext } from '../../../src/server/context.js';
import { Logger } from '../../../src/server/logger.js';
import type { LogSink } from '../../../src/server/sinks/types.js';

class CaptureSink implements LogSink {
  events: AuditEvent[] = [];

  write(event: AuditEvent): void {
    this.events.push(event);
  }
}

describe('audit redaction', () => {
  it('redacts sensitive keys and SAP payload bodies recursively', () => {
    const redacted = redactAuditEvent({
      timestamp: '2026-06-24T00:00:00.000Z',
      level: 'error',
      event: 'http_request',
      method: 'POST',
      path: '/sap/bc/adt/object',
      statusCode: 500,
      durationMs: 12,
      errorBody: '<error>contains SAP source and stack details</error>',
      requestBody: 'REPORT zsecret.',
      responseBody: 'full SAP response',
      requestHeaders: {
        authorization: 'Bearer secret-token',
        'x-csrf-token': 'csrf-token',
      },
      responseHeaders: {
        'set-cookie': 'SAP_SESSIONID=abc',
      },
    } satisfies HttpRequestEvent) as HttpRequestEvent;

    expect(redacted.errorBody).toBe('[REDACTED 52 chars]');
    expect(redacted.requestBody).toBe('[REDACTED 15 chars]');
    expect(redacted.responseBody).toBe('[REDACTED 17 chars]');
    expect(redacted.requestHeaders?.authorization).toBe('[REDACTED]');
    expect(redacted.requestHeaders?.['x-csrf-token']).toBe('[REDACTED]');
    expect(redacted.responseHeaders?.['set-cookie']).toBe('[REDACTED]');
  });

  it('redacts before dispatching to every sink', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const logger = new Logger('json', true);
      const sink = new CaptureSink();
      logger.addSink(sink);

      logger.emitAudit({
        timestamp: '2026-06-24T00:00:00.000Z',
        level: 'error',
        event: 'tool_call_end',
        tool: 'SAPRead',
        durationMs: 1,
        status: 'error',
        errorClass: 'result-path',
        errorMessage: 'Object is locked by SECRETUSER',
        resultSize: 21,
        resultPreview: 'REPORT zsecret.\nWRITE x.',
      });

      expect(sink.events).toHaveLength(1);
      const captured = sink.events[0] as ToolCallEndEvent;
      expect(captured).toMatchObject({
        event: 'tool_call_end',
        errorMessage: '[REDACTED 30 chars]',
        resultPreview: '[REDACTED 24 chars]',
      });
      expect(JSON.stringify(captured)).not.toContain('REPORT zsecret');
      expect(JSON.stringify(captured)).not.toContain('SECRETUSER');
    } finally {
      stderr.mockRestore();
    }
  });

  it('attaches request context before redacting the event', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const logger = new Logger('json', true);
      const sink = new CaptureSink();
      logger.addSink(sink);

      const original: ToolCallEndEvent = {
        timestamp: '2026-06-24T00:00:00.000Z',
        level: 'info',
        event: 'tool_call_end',
        tool: 'SAPRead',
        durationMs: 1,
        status: 'success',
        resultPreview: 'REPORT zsecret.',
      };

      await requestContext.run({ requestId: 'REQ-CTX', user: 'alice' }, async () => {
        logger.emitAudit(original);
      });

      expect(sink.events[0]).toMatchObject({
        requestId: 'REQ-CTX',
        user: 'alice',
        resultPreview: '[REDACTED 15 chars]',
      });
      expect(original.requestId).toBeUndefined();
    } finally {
      stderr.mockRestore();
    }
  });
});
