import { describe, expect, it } from 'vitest';
import { UiLogBufferSink } from '../../../src/server/ui-log-buffer.js';

describe('UiLogBufferSink', () => {
  it('stores recent audit events in reverse chronological order', () => {
    const sink = new UiLogBufferSink(2);
    sink.write({
      timestamp: '2026-01-01T00:00:00.000Z',
      level: 'info',
      event: 'server_start',
      version: '1',
      transport: 'stdio',
      allowWrites: false,
      url: '',
    });
    sink.write({
      timestamp: '2026-01-01T00:00:01.000Z',
      level: 'warn',
      event: 'cors_rejected',
      origin: 'x',
      method: 'POST',
      path: '/mcp',
    });
    sink.write({
      timestamp: '2026-01-01T00:00:02.000Z',
      level: 'error',
      event: 'safety_blocked',
      operation: 'Write',
      reason: 'blocked',
    });

    const result = sink.list();

    expect(result.total).toBe(2);
    expect(result.items.map((entry) => entry.event)).toEqual(['safety_blocked', 'cors_rejected']);
  });

  it('omits request bodies, response bodies, headers, previews, and OAuth client IDs', () => {
    const sink = new UiLogBufferSink();
    sink.write({
      timestamp: '2026-01-01T00:00:00.000Z',
      level: 'info',
      event: 'http_request',
      method: 'PUT',
      path: '/sap/bc/adt',
      statusCode: 200,
      durationMs: 1,
      requestBody: 'source',
      responseBody: 'body',
      requestHeaders: { authorization: 'Bearer secret' },
      responseHeaders: { cookie: 'secret' },
      errorBody: 'error',
    });

    const entry = sink.list().items[0];

    expect(entry).not.toHaveProperty('requestBody');
    expect(entry).not.toHaveProperty('responseBody');
    expect(entry).not.toHaveProperty('requestHeaders');
    expect(entry).not.toHaveProperty('responseHeaders');
    expect(entry).not.toHaveProperty('errorBody');
  });
});
