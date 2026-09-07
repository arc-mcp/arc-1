import { once } from 'node:events';
import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { createGraphApi } from './api.js';
import { graphApiKeys } from './config.js';
import type { GraphStore } from './store/store.js';

const oldKey = 'test-only-old-key-01234567890123456789';
const newKey = 'test-only-new-key-01234567890123456789';
const binding = (apiKeys: unknown) => ({
  ARC_GRAPH_API_AUTH_BINDING: 'auth',
  VCAP_SERVICES: JSON.stringify({ 'user-provided': [{ name: 'auth', credentials: { apiKeys } }] }),
});

it('rotates through an overlap window and revokes the old credential over HTTP', async () => {
  const store = { ready: async () => ({ migrationVersion: 1 }) } as GraphStore;
  for (const keys of [[oldKey], [oldKey, newKey], [newKey]]) {
    const server = createServer(
      createGraphApi(store, graphApiKeys(binding(keys)), { systemKey: 'ROTATE-001', audience: 'test' }),
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port');
    try {
      for (const key of [oldKey, newKey, 'invalid']) {
        const response = await fetch(`http://127.0.0.1:${address.port}/readyz`, {
          headers: { authorization: `Bearer ${key}` },
        });
        expect(response.status).toBe(keys.includes(key) ? 200 : 401);
        expect(await response.text()).not.toContain(key);
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
});

it('fails closed on malformed, empty or unbounded key sets', () => {
  for (const keys of [[], [oldKey, 'bad'], [oldKey, newKey, oldKey], 'not-an-array', [undefined], ['x'.repeat(4097)]])
    expect(() => graphApiKeys(binding(keys))).toThrow();
  expect(() => graphApiKeys({ ARC_GRAPH_API_KEYS: `${oldKey},` })).toThrow();
});
