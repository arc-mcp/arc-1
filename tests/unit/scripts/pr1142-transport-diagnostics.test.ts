import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { McpSession } from '../../../scripts/qualification/pr1142/mcp-checks.mjs';
import { boundedFetch, safeFailure } from '../../../scripts/qualification/pr1142/safe-io.mjs';

describe('PR1142 transport failure evidence', () => {
  it.each(['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'])(
    'distinguishes a fetch transport timer from the owned deadline: %s',
    async (code) => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new TypeError('secret'), { cause: { code } })));
      try {
        const failure = await boundedFetch(new URL('https://example.invalid')).catch(safeFailure);
        expect(failure).toMatchObject({ causeCode: code, failureKind: 'transport-timeout' });
        expect(JSON.stringify(failure)).not.toContain('secret');
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it('recognizes the owned abort when a response reader throws an ordinary error', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            pull() {
              controller.abort();
              throw new Error('secret-reader-error');
            },
          }),
        ),
      ),
    );
    try {
      const failure = await boundedFetch(new URL('https://example.invalid')).catch(safeFailure);
      expect(failure).toMatchObject({ code: 'HTTP_RESPONSE_FAILED', errorName: 'Error', failureKind: 'timeout' });
      expect(JSON.stringify(failure)).not.toContain('secret');
    } finally {
      timeout.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('recognizes a TimeoutError independently of the owned signal', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('secret', 'TimeoutError')));
    try {
      const failure = await boundedFetch(new URL('https://example.invalid')).catch(safeFailure);
      expect(controller.signal.aborted).toBe(false);
      expect(failure).toMatchObject({ code: 'HTTP_REQUEST_FAILED', errorName: 'TimeoutError', failureKind: 'timeout' });
    } finally {
      timeout.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it.each(['timeout', 'disconnect'] as const)(
    'retains diagnostics after an SSE body starts and then %s',
    async (mode) => {
      let headersSent = false;
      let disconnect: ReturnType<typeof setTimeout> | undefined;
      const server = createServer((_request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.flushHeaders();
        response.write('data: {"jsonrpc":"2.0","id":1,"result":{"secret":"do-not-record');
        headersSent = true;
        if (mode === 'disconnect') disconnect = setTimeout(() => response.destroy(), 75);
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const timeoutMs = mode === 'timeout' ? 150 : 2000;
      const before = Date.now();
      try {
        const failure = await boundedFetch(
          new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/do-not-record`),
          {},
          { timeoutMs, rpcResponseId: 1, rpcMethod: 'tools/call', rpcTool: 'SAPRead' },
        ).then(() => {
          throw new Error('Expected stream failure');
        }, safeFailure);
        const after = Date.now();
        expect(headersSent).toBe(true);
        expect(failure).toMatchObject({
          code: 'HTTP_RESPONSE_FAILED',
          httpStatus: 200,
          failureKind: mode === 'timeout' ? 'timeout' : 'unclassified',
          rpcMethod: 'tools/call',
          rpcTool: 'SAPRead',
          timeoutMs,
        });
        expect(Number.isFinite(Date.parse(failure.startedAt))).toBe(true);
        expect(Date.parse(failure.startedAt)).toBeGreaterThanOrEqual(before);
        expect(Date.parse(failure.startedAt)).toBeLessThanOrEqual(after);
        expect(failure.elapsedMs).toBeGreaterThanOrEqual(mode === 'timeout' ? timeoutMs - 15 : 60);
        expect(failure.monotonicElapsedMs).toBeGreaterThanOrEqual(mode === 'timeout' ? timeoutMs - 15 : 60);
        expect(failure.elapsedMs).toBeLessThanOrEqual(mode === 'timeout' ? timeoutMs + 1000 : timeoutMs);
        expect(Math.abs(failure.elapsedMs - failure.monotonicElapsedMs)).toBeLessThan(100);
        if (mode === 'disconnect') expect(failure.causeCode).toBe('UND_ERR_SOCKET');
        expect(JSON.stringify(failure)).not.toMatch(/do-not-record|127\.0\.0\.1/);
      } finally {
        clearTimeout(disconnect);
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );

  it.each([
    'ENETUNREACH',
    'EHOSTUNREACH',
    'ENETDOWN',
    'EADDRNOTAVAIL',
    'ECONNABORTED',
    'EPROTO',
    'UND_ERR_CLOSED',
    'UND_ERR_DESTROYED',
    'HPE_INVALID_HEADER_TOKEN',
    'ERR_SSL_WRONG_VERSION_NUMBER',
    'ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION',
  ])('retains the allowlisted cause %s', async (code) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new TypeError('secret'), { cause: { code } })));
    try {
      const failure = await boundedFetch(new URL('https://example.invalid')).catch(safeFailure);
      expect(failure).toMatchObject({ causeCode: code });
      expect(JSON.stringify(failure)).not.toContain('secret');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([undefined, 'HPE_secret-password', 'ERR_SSL_secret-password', 'secret-password', 42])(
    'distinguishes an absent cause from an unlisted value %s without copying it',
    async (code) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(Object.assign(new TypeError('secret-password'), { cause: { code } })),
      );
      try {
        const failure = await boundedFetch(new URL('https://example.invalid')).catch(safeFailure);
        expect(failure).toMatchObject({ causeCode: code === undefined ? null : 'OTHER' });
        expect(JSON.stringify(failure)).not.toContain('secret-password');
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it('keeps the original transport failure when persisting its failed receipt also rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new TypeError('secret'), { cause: { code: 'ECONNRESET' } })),
    );
    const observer = vi.fn().mockRejectedValue(new Error('secret-disk-failure'));
    try {
      const session = new McpSession(new URL('https://example.invalid'), 'secret', () => {}, 'fixture', true, observer);
      const failure = await session.request('tools/call', { name: 'SAPRead' }).catch(safeFailure);
      expect(observer).toHaveBeenCalledOnce();
      expect(failure).toMatchObject({ code: 'HTTP_REQUEST_FAILED', causeCode: 'ECONNRESET', receiptWriteFailed: true });
      expect(JSON.stringify(failure)).not.toContain('secret');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('still stops after a successful response when its receipt cannot be persisted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"jsonrpc":"2.0","id":1,"result":{}}', { status: 200 })),
    );
    const receiptFailure = new Error('receipt write failed');
    try {
      const session = new McpSession(
        new URL('https://example.invalid'),
        null,
        () => {},
        'fixture',
        true,
        vi.fn().mockRejectedValue(receiptFailure),
      );
      await expect(session.request('tools/call', { name: 'SAPWrite' })).rejects.toBe(receiptFailure);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
