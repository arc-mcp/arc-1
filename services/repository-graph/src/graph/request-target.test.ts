import { once } from 'node:events';
import { createServer, type IncomingMessage, request, type ServerResponse } from 'node:http';
import { expect, it, vi } from 'vitest';
import { createGraphApi } from './api.js';
import type { GraphStore } from './store/store.js';

const api = () =>
  createGraphApi({} as GraphStore, ['test-only-request-target-key-0123456789'], {
    systemKey: 'REQUEST-001',
    audience: 'test',
  });

it('contains malformed request-target errors before authorization without rejecting the listener', async () => {
  const response = { setHeader: vi.fn(), end: vi.fn(), statusCode: 0 };
  await expect(
    api()({ url: '//[', method: 'GET', headers: {} } as IncomingMessage, response as unknown as ServerResponse),
  ).resolves.toBeUndefined();
  expect(response.statusCode).toBe(400);
  expect(response.end).toHaveBeenCalledWith(JSON.stringify({ error: 'invalid_request_target' }));
});

it('rejects malformed targets over HTTP and still serves the following health check', async () => {
  const server = createServer(api());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  try {
    for (const path of ['//[', 'http://[']) {
      const result = await new Promise<{ status?: number; body: string }>((resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port: address.port, path }, (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => (body += chunk));
          response.once('error', reject);
          response.once('end', () => resolve({ status: response.statusCode, body }));
        });
        req.once('error', reject);
        req.end();
      });
      expect(result).toEqual({ status: 400, body: JSON.stringify({ error: 'invalid_request_target' }) });
    }
    const healthy = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    expect(healthy.status).toBe(200);
    expect(await healthy.json()).toEqual({ status: 'ok' });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
