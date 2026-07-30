import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEvent } from '../../../src/server/audit.js';
import { requestContext } from '../../../src/server/context.js';
import { Logger } from '../../../src/server/logger.js';
import type { LogSink } from '../../../src/server/sinks/types.js';

describe('Logger', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('writes to stderr, not stdout', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = new Logger('text', true);
    logger.info('test message');
    expect(stderrSpy).toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
    stdoutSpy.mockRestore();
  });

  it('outputs text format with timestamp and level', () => {
    const logger = new Logger('text', true);
    logger.info('hello world');
    const output = stderrSpy.mock.calls[0]?.[0] as string;
    expect(output).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
    expect(output).toContain('INFO');
    expect(output).toContain('hello world');
  });

  it('outputs JSON format with structured fields', () => {
    const logger = new Logger('json', true);
    logger.info('test', { tool: 'SAPRead' });
    const output = stderrSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('test');
    expect(parsed.tool).toBe('SAPRead');
    expect(parsed.timestamp).toBeDefined();
  });

  it('respects log level (non-verbose suppresses debug)', () => {
    const logger = new Logger('text', false);
    logger.debug('should not appear');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('shows debug messages when verbose', () => {
    const logger = new Logger('text', true);
    logger.debug('debug message');
    expect(stderrSpy).toHaveBeenCalled();
  });

  it('redacts sensitive fields in context', () => {
    const logger = new Logger('json', true);
    logger.info('auth', { password: 'secret123', token: 'abc', username: 'admin' });
    const output = stderrSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.password).toBe('[REDACTED]');
    expect(parsed.token).toBe('[REDACTED]');
    expect(parsed.username).toBe('admin'); // Not sensitive
  });

  it('suppresses SAP 401/403 response details in messages and nested debug context', () => {
    const logger = new Logger('json', true);
    const sentinel = 'SENTINEL_TECHNICAL_USER_AND_SECURITY_DETAIL';
    logger.debug(`Read failed: ADT API error: status 401 at /sap/bc/adt/discovery: ${sentinel}`, {
      error: `ADT API error: status 403 at /sap/bc/adt/repository/informationsystem: ${sentinel}`,
      nested: { errors: [`ADT API error: status 403 at /sap/bc/adt/oo/classes: ${sentinel}`] },
    });

    const output = stderrSpy.mock.calls[0]?.[0] as string;
    expect(output).not.toContain(sentinel);
    const parsed = JSON.parse(output);
    expect(parsed.message).toBe(
      'Read failed: ADT API error: status 401 at /sap/bc/adt/discovery: [response details suppressed]',
    );
    expect(parsed.error).toBe(
      'ADT API error: status 403 at /sap/bc/adt/repository/informationsystem: [response details suppressed]',
    );
    expect(parsed.nested.errors[0]).toBe(
      'ADT API error: status 403 at /sap/bc/adt/oo/classes: [response details suppressed]',
    );
  });

  it('keeps non-authentication ADT error details for diagnostics', () => {
    const logger = new Logger('json', true);
    logger.debug('request failed', { error: 'ADT API error: status 500 at /sap/bc/adt/test: useful detail' });

    const output = stderrSpy.mock.calls[0]?.[0] as string;
    expect(JSON.parse(output).error).toContain('useful detail');
  });

  describe('Sink Architecture', () => {
    it('starts with stderr sink by default', () => {
      const logger = new Logger('text', false);
      expect(logger.getSinks()).toHaveLength(1);
    });

    it('addSink adds a sink', () => {
      const logger = new Logger('text', false);
      const mockSink: LogSink = { write: vi.fn() };
      logger.addSink(mockSink);
      expect(logger.getSinks()).toHaveLength(2);
    });

    it('emitAudit dispatches to all sinks', () => {
      const logger = new Logger('text', false);
      const mockSink: LogSink = { write: vi.fn() };
      logger.addSink(mockSink);

      const event: AuditEvent = {
        timestamp: '2026-03-30T10:00:00.000Z',
        level: 'info',
        event: 'server_start',
        version: '3.0.0',
        transport: 'stdio',
        allowWrites: true,
        url: 'http://test',
      };
      logger.emitAudit(event);

      expect(mockSink.write).toHaveBeenCalledWith(event);
    });

    it('emitAudit does not crash if a sink throws', () => {
      const logger = new Logger('text', false);
      const throwingSink: LogSink = {
        write: () => {
          throw new Error('boom');
        },
      };
      const goodSink: LogSink = { write: vi.fn() };
      logger.addSink(throwingSink);
      logger.addSink(goodSink);

      const event: AuditEvent = {
        timestamp: '',
        level: 'info',
        event: 'server_start',
        version: '',
        transport: '',
        allowWrites: true,
        url: '',
      };

      // Should not throw
      expect(() => logger.emitAudit(event)).not.toThrow();
      // Good sink should still receive the event
      expect(goodSink.write).toHaveBeenCalled();
    });

    it('emitAudit attaches clientAgent and traceparent from the request context', () => {
      const logger = new Logger('text', false);
      const mockSink: LogSink = { write: vi.fn() };
      logger.addSink(mockSink);
      const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

      requestContext.run({ requestId: 'REQ-9', clientAgent: 'claude-code/1.2.3', traceparent }, () => {
        logger.emitAudit({
          timestamp: '',
          level: 'info',
          event: 'tool_call_start',
          tool: 'SAPRead',
          args: {},
        });
      });

      const written = (mockSink.write as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(written.clientAgent).toBe('claude-code/1.2.3');
      expect(written.traceparent).toBe(traceparent);
      expect(written.requestId).toBe('REQ-9');
    });

    it('emitAudit lets an explicit clientAgent win over the context', () => {
      const logger = new Logger('text', false);
      const mockSink: LogSink = { write: vi.fn() };
      logger.addSink(mockSink);

      requestContext.run({ requestId: 'REQ-9', clientAgent: 'from-context' }, () => {
        logger.emitAudit({
          timestamp: '',
          level: 'info',
          event: 'tool_call_start',
          tool: 'SAPRead',
          clientAgent: 'from-event',
          args: {},
        });
      });

      const written = (mockSink.write as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(written.clientAgent).toBe('from-event');
    });

    it('does not redact clientAgent or traceparent — neither carries a secret', () => {
      const logger = new Logger('text', false);
      const mockSink: LogSink = { write: vi.fn() };
      logger.addSink(mockSink);
      const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

      logger.emitAudit({
        timestamp: '',
        level: 'info',
        event: 'tool_call_end',
        tool: 'SAPRead',
        durationMs: 1,
        status: 'success',
        clientAgent: 'vscode/1.107.0',
        traceparent,
      });

      const written = (mockSink.write as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(written.clientAgent).toBe('vscode/1.107.0');
      expect(written.traceparent).toBe(traceparent);
    });

    it('flush calls flush on all sinks', async () => {
      const logger = new Logger('text', false);
      const mockSink: LogSink = { write: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) };
      logger.addSink(mockSink);

      await logger.flush();
      expect(mockSink.flush).toHaveBeenCalled();
    });
  });
});
