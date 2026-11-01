import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import type { ResolvedFeatures } from '../../../src/adt/types.js';
import { handleToolCall } from '../../../src/handlers/dispatch.js';
import { resetCachedFeatures, setCachedFeatures } from '../../../src/handlers/feature-cache.js';
import { requestContext } from '../../../src/server/context.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

const xml = readFileSync(new URL('../../fixtures/xml/publish-failure/active.xml', import.meta.url), 'utf8');
const failure = readFileSync(new URL('../../fixtures/xml/publish-failure/error.xml', import.meta.url), 'utf8');
const ok =
  '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY></DATA></asx:values></asx:abap>';
interface Send {
  method: string;
  path: string;
  identity: string;
  contentType?: string;
}
type Mode =
  | 'published'
  | 'unpublished'
  | 'negotiation'
  | 'csrf'
  | 'blocked-read'
  | 'pending-read'
  | 'read-retry'
  | { status: number | 'disconnect' };
async function withSap(mode: Mode, check: (clients: AdtClient[], sends: Send[]) => Promise<void>) {
  const sends: Send[] = [];
  const jobs = new Map<string, number>();
  const committed = new Set<string>();
  let stateReads = 0;
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) {
      /* Drain the request before responding. */
    }
    const identity = req.headers.authorization ?? '';
    const path = req.url ?? '';
    sends.push({ method: req.method ?? '', path, identity, contentType: req.headers['content-type'] });
    res.setHeader('content-type', 'application/xml');
    res.setHeader('x-csrf-token', 'T');
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    if (path.includes('/publishjobs')) {
      const n = jobs.get(identity) ?? 0;
      jobs.set(identity, n + 1);
      if (typeof mode === 'object') {
        committed.add(identity); // Commit succeeds; the response is replaced or lost.
        if (mode.status === 'disconnect') {
          res.destroy();
          return;
        }
        res.statusCode = mode.status;
        res.setHeader('retry-after', '0');
        res.end('<error>database connection is not open</error>');
        return;
      }
      if (mode === 'negotiation' && !req.headers['content-type']?.includes('dataname=')) {
        res.statusCode = 415;
        res.end('<error>Accepted content types: application/vnd.sap.as+xml</error>');
        return;
      }
      if (mode === 'csrf' && n === 0) {
        res.statusCode = 403;
        res.end('<error>Forbidden</error>');
        return;
      }
      if (['published', 'read-retry', 'negotiation', 'csrf'].includes(mode)) committed.add(identity);
      res.end(mode === 'negotiation' || mode === 'csrf' ? ok : failure);
      return;
    }
    if (path.includes('version=active')) {
      stateReads++;
      if (mode === 'pending-read') return;
      if (mode === 'blocked-read') {
        res.statusCode = 403;
        res.end('<error>denied</error>');
        return;
      }
      if (mode === 'read-retry' && stateReads === 1) {
        res.statusCode = 503;
        res.setHeader('retry-after', '0');
        res.end('<error>busy</error>');
        return;
      }
    }
    res.end(committed.has(identity) ? xml.replace('published="false"', 'published="true"') : xml);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Need TCP address');
  const clients = ['A', 'B'].map(
    (username) =>
      new AdtClient({
        baseUrl: `http://127.0.0.1:${address.port}`,
        username,
        password: 'test-only',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['ZARC1_TEST'] },
      }),
  );
  try {
    await check(clients, sends);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
const call = (client: AdtClient, minimalErrors = false) =>
  handleToolCall(client, { ...DEFAULT_CONFIG, minimalErrors }, 'SAPActivate', {
    action: 'publish_srvb',
    name: 'ZARC1_PUBLISH',
    service_type: 'odatav4',
  });
beforeEach(() => {
  resetCachedFeatures();
  setCachedFeatures({ systemType: 'btp' } as ResolvedFeatures);
});
afterEach(() => {
  vi.restoreAllMocks();
  resetCachedFeatures();
});

describe('publication over the real HTTP transport', () => {
  it.each(['published', 'unpublished'] as const)(
    'inspects %s state once per concurrent caller without republishing',
    async (mode) => {
      await withSap(mode, async (clients, sends) => {
        const results = await Promise.all(clients.map((client) => call(client)));
        expect(results.every((r) => !!r.isError === (mode === 'unpublished'))).toBe(true);
        for (const user of ['A', 'B']) {
          const own = sends.filter(
            (s) => s.identity === `Basic ${Buffer.from(`${user}:test-only`).toString('base64')}`,
          );
          expect(own.filter((s) => s.path.includes('/publishjobs'))).toHaveLength(1);
          expect(own.filter((s) => s.path.includes('version=active'))).toHaveLength(1);
        }
      });
    },
  );
  it.each([429, 500, 502, 503, 504, 'disconnect'] as const)(
    'does not replay an ambiguously completed publish after %s',
    async (status) => {
      for (const minimalErrors of [false, true]) {
        await withSap({ status }, async ([client], sends) => {
          const r = await call(client!, minimalErrors);
          const text = r.content[0]?.text ?? '';
          expect(r.isError).toBe(true);
          expect(text).toContain('completion is unconfirmed');
          expect(text).toContain('SAPRead');
          if (minimalErrors) {
            expect(text).toContain('request ID');
            expect(text).not.toContain('database connection');
            if (status !== 'disconnect') expect(text).toContain(`status ${status}`);
          }
          expect(sends.filter((s) => s.path.includes('/publishjobs'))).toHaveLength(1);
          const state = await client!.http.get('/sap/bc/adt/businessservices/bindings/ZARC1_PUBLISH?version=active');
          expect(state.body).toContain('published="true"');
        });
      }
    },
  );
  it('preserves MIME negotiation while disabling transient replay on both representations', async () => {
    await withSap('negotiation', async ([client], sends) => {
      const post = vi.spyOn(client!.http, 'post');
      expect((await call(client!)).isError).toBeUndefined();
      expect(sends.filter((s) => s.path.includes('/publishjobs'))).toHaveLength(3);
      expect(post).toHaveBeenCalledTimes(2); // Generic MIME fallback is inside the first call.
      expect(post.mock.calls.every((args) => args[4]?.retryTransientErrors === false)).toBe(true);
    });
  });
  it('retains the existing one-time 403 token-refresh replay', async () => {
    await withSap('csrf', async ([client], sends) => {
      expect((await call(client!)).isError).toBeUndefined();
      expect(sends.filter((s) => s.path.includes('/publishjobs'))).toHaveLength(2);
    });
  });
  it('still retries safe metadata reads on 503 without another publication', async () => {
    await withSap('read-retry', async ([client], sends) => {
      expect((await call(client!)).isError).toBeUndefined();
      expect(sends.filter((s) => s.path.includes('/publishjobs'))).toHaveLength(1);
      expect(sends.filter((s) => s.path.includes('version=active'))).toHaveLength(2);
    });
  });
  it('preserves denied state evidence without another publish', async () => {
    await withSap('blocked-read', async ([client], sends) => {
      const r = await call(client!);
      expect(r.isError).toBe(true);
      expect(r.content[0]?.text).toContain('SAP HTTP 403');
      expect(sends.filter((s) => s.path.includes('/publishjobs'))).toHaveLength(1);
    });
  });
  it('cancels a pending state read promptly without republishing', async () => {
    await withSap('pending-read', async ([client], sends) => {
      const controller = new AbortController();
      const get = client!.http.get.bind(client!.http);
      vi.spyOn(client!.http, 'get').mockImplementation((...args) => {
        if (args[0].includes('version=active')) setTimeout(() => controller.abort(), 20);
        return get(...args);
      });
      const r = await requestContext.run({ requestId: 'cancel-state-read', signal: controller.signal }, () =>
        call(client!),
      );
      expect(r.isError).toBe(true);
      expect(r.content[0]?.text).toContain('cancelled');
      expect(sends.filter((s) => s.path.includes('/publishjobs'))).toHaveLength(1);
    });
  });
});
