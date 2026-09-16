import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import * as deadline from '../../../src/adt/http-deadline.js';
import { RequestAttemptBudget } from '../../../src/adt/request-attempt-budget.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import type { ResolvedFeatures } from '../../../src/adt/types.js';
import { handleToolCall } from '../../../src/handlers/dispatch.js';
import { resetCachedFeatures, setCachedFeatures } from '../../../src/handlers/feature-cache.js';
import { requestContext } from '../../../src/server/context.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

const xml = readFileSync(new URL('../../fixtures/xml/publish-recovery/active.xml', import.meta.url), 'utf8');
const failure = readFileSync(new URL('../../fixtures/xml/publish-recovery/error.xml', import.meta.url), 'utf8');
const ok =
  '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY></DATA></asx:values></asx:abap>';
const negotiation = '<error>Accepted content types: application/vnd.sap.as+xml</error>';
interface Send {
  method: string;
  path: string;
  identity: string;
  contentType?: string;
  body: string;
}
async function withSap(
  mode: 'success' | 'negotiation' | 'persistent' | 'blocked-read',
  check: (clients: AdtClient[], sends: Send[]) => Promise<void>,
) {
  const sends: Send[] = [];
  const jobs = new Map<string, number>();
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const identity = req.headers.authorization ?? '';
    const path = req.url ?? '';
    sends.push({ method: req.method ?? '', path, identity, contentType: req.headers['content-type'], body });
    res.setHeader('content-type', 'application/xml');
    res.setHeader('x-csrf-token', 'T');
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const n = jobs.get(identity) ?? 0;
    if (path.includes('/publishjobs')) {
      jobs.set(identity, n + 1);
      if (n === 0 || mode === 'persistent') {
        res.end(failure);
        return;
      }
      if (mode === 'negotiation' && !req.headers['content-type']?.includes('dataname=')) {
        res.statusCode = 415;
        res.end(negotiation);
        return;
      }
      res.end(ok);
      return;
    }
    if (mode === 'blocked-read' && path.includes('version=active')) {
      res.statusCode = 403;
      res.end('<error>denied</error>');
      return;
    }
    res.end(n > 1 && mode !== 'persistent' ? xml.replace('published="false"', 'published="true"') : xml);
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
const call = (client: AdtClient) =>
  handleToolCall(client, DEFAULT_CONFIG, 'SAPActivate', {
    action: 'publish_srvb',
    name: 'ZARC1_PUBLISH',
    service_type: 'odatav4',
  });
beforeEach(() => {
  resetCachedFeatures();
  setCachedFeatures({ systemType: 'btp' } as ResolvedFeatures);
  vi.spyOn(deadline, 'sleepWithinRequestBudget').mockResolvedValue();
});
afterEach(() => {
  vi.restoreAllMocks();
  resetCachedFeatures();
});
describe('publish recovery over the real HTTP transport', () => {
  it('keeps concurrent identities separate and never publishes more than twice per caller', async () => {
    await withSap('success', async (clients, sends) => {
      const results = await Promise.all(clients.map(call));
      expect(results.every((r) => !r.isError)).toBe(true);
      const posts = sends.filter((s) => s.path.includes('/publishjobs'));
      expect(posts).toHaveLength(4);
      for (const user of ['A', 'B'])
        expect(
          posts.filter((s) => s.identity === `Basic ${Buffer.from(`${user}:test-only`).toString('base64')}`),
        ).toHaveLength(2);
      expect(sends.filter((s) => s.path.includes('version=active')).every((s) => s.method === 'GET')).toBe(true);
    });
  });
  it('keeps the same deadline and physical send budget through MIME fallback', async () => {
    await withSap('negotiation', async ([client], sends) => {
      const consume = vi.spyOn(RequestAttemptBudget.prototype, 'consume');
      const options: deadline.AdtRequestOptions[] = [];
      const post = client!.http.post.bind(client!.http);
      vi.spyOn(client!.http, 'post').mockImplementation((path, body, type, headers, opts) => {
        if (opts) options.push(opts);
        return post(path, body, type, headers, opts);
      });
      const r = await call(client!);
      expect(r.isError).toBeUndefined();
      const posts = sends.filter((s) => s.path.includes('/publishjobs'));
      expect(posts).toHaveLength(4); // first SAP failure; retry + generic MIME fallback + AS-XML fallback
      expect(options).toHaveLength(2); // two low-level publisher calls share one logical recovery attempt
      expect(options[0]).toBe(options[1]);
      expect(options[0]?.attemptBudget?.used).toBe(consume.mock.calls.length);
      expect(consume.mock.calls.length).toBeGreaterThanOrEqual(7);
      expect(posts.at(-1)?.contentType).toContain('dataname=com.sap.adt.businessservices.odatav4.publishjob');
    });
  });
  it('stops on denied metadata without a second POST', async () => {
    await withSap('blocked-read', async ([client], sends) => {
      const r = await call(client!);
      expect(r.isError).toBe(true);
      expect(r.content[0]?.text).toContain('SAP HTTP 403');
      expect(sends.filter((s) => s.path.includes('/publishjobs'))).toHaveLength(1);
    });
  });
  it('cancels the actual timer promptly without sending another publish', async () => {
    vi.mocked(deadline.sleepWithinRequestBudget).mockRestore();
    await withSap('persistent', async ([client], sends) => {
      const controller = new AbortController();
      const get = client!.http.get.bind(client!.http);
      vi.spyOn(client!.http, 'get').mockImplementation(async (...args) => {
        const r = await get(...args);
        if (args[0].includes('version=active')) setTimeout(() => controller.abort(), 20);
        return r;
      });
      const r = await requestContext.run({ requestId: 'cancel-live-http', signal: controller.signal }, () =>
        call(client!),
      );
      expect(r.isError).toBe(true);
      expect(r.content[0]?.text).toContain('cancelled');
      expect(sends.filter((s) => s.path.includes('/publishjobs'))).toHaveLength(1);
    });
  });
});
