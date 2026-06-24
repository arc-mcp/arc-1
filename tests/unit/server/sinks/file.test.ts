import { chmodSync, existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuditEvent } from '../../../../src/server/audit.js';
import { FileSink } from '../../../../src/server/sinks/file.js';

describe('FileSink', () => {
  const tmpFile = join(tmpdir(), `arc1-test-${Date.now()}.jsonl`);

  afterEach(() => {
    if (existsSync(tmpFile)) {
      unlinkSync(tmpFile);
    }
  });

  const makeEvent = (overrides: Partial<AuditEvent> = {}): AuditEvent =>
    ({
      timestamp: '2026-03-30T10:00:00.000Z',
      level: 'info',
      event: 'tool_call_start',
      requestId: 'REQ-1',
      tool: 'SAPRead',
      args: { type: 'PROG' },
      ...overrides,
    }) as AuditEvent;

  const fileMode = () => statSync(tmpFile).mode & 0o777;

  it('writes JSON lines to file', async () => {
    const sink = new FileSink(tmpFile);
    sink.write(makeEvent());
    sink.write(makeEvent({ requestId: 'REQ-2' }));
    await sink.flush();

    const content = readFileSync(tmpFile, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]!);
    expect(first.event).toBe('tool_call_start');
    expect(first.requestId).toBe('REQ-1');

    const second = JSON.parse(lines[1]!);
    expect(second.requestId).toBe('REQ-2');
  });

  it('creates the audit log with private file permissions', async () => {
    const sink = new FileSink(tmpFile);
    sink.write(makeEvent());
    await sink.flush();

    expect(fileMode()).toBe(0o600);
  });

  it('repairs permissive permissions on an existing audit log', async () => {
    writeFileSync(tmpFile, '', { mode: 0o666 });
    chmodSync(tmpFile, 0o666);

    const sink = new FileSink(tmpFile);
    sink.write(makeEvent());
    await sink.flush();

    expect(fileMode()).toBe(0o600);
  });

  it('writes all event types', async () => {
    const sink = new FileSink(tmpFile);

    sink.write(makeEvent({ event: 'tool_call_start' } as Partial<AuditEvent>));
    sink.write({
      timestamp: '',
      level: 'info',
      event: 'tool_call_end',
      tool: 'SAPRead',
      durationMs: 100,
      status: 'success',
    } as AuditEvent);
    sink.write({
      timestamp: '',
      level: 'debug',
      event: 'http_request',
      method: 'GET',
      path: '/test',
      statusCode: 200,
      durationMs: 50,
    } as AuditEvent);

    await sink.flush();

    const content = readFileSync(tmpFile, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(3);
  });

  it('handles error events', async () => {
    const sink = new FileSink(tmpFile);
    sink.write({
      timestamp: '2026-03-30T10:00:00.000Z',
      level: 'error',
      event: 'tool_call_end',
      requestId: 'REQ-ERR',
      tool: 'SAPRead',
      durationMs: 50,
      status: 'error',
      errorClass: 'AdtApiError',
      errorMessage: 'Not found',
    } as AuditEvent);
    await sink.flush();

    const content = readFileSync(tmpFile, 'utf-8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.status).toBe('error');
    expect(parsed.errorClass).toBe('AdtApiError');
  });

  it('appends to existing file', async () => {
    const sink1 = new FileSink(tmpFile);
    sink1.write(makeEvent({ requestId: 'BATCH-1' }));
    await sink1.flush();

    const sink2 = new FileSink(tmpFile);
    sink2.write(makeEvent({ requestId: 'BATCH-2' }));
    await sink2.flush();

    const content = readFileSync(tmpFile, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
  });
});
