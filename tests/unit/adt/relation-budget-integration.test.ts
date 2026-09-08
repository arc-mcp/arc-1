/** Real direct/Connectivity HTTP boundaries, with synthetic metadata and no SAP credentials. */
import { createServer, type RequestListener, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import type { AdtRequestOptions } from '../../../src/adt/http-deadline.js';
import { NativeRelationProvider, RELATIONS_MIME, RELATIONS_PATH } from '../../../src/adt/repository-relations.js';
import { RequestAttemptBudget } from '../../../src/adt/request-attempt-budget.js';
import { Semaphore } from '../../../src/adt/semaphore.js';
import { walkRelations } from '../../../src/context/relation-walk.js';
import { handleToolCall } from '../../../src/handlers/dispatch.js';
import { resetCachedFeatures } from '../../../src/handlers/feature-cache.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { relationMetadata, relationObject, relationXml } from '../../helpers/relation-fixtures.js';

const root = relationObject('/ACME/CL_ROOT');
const children = Array.from({ length: 7 }, (_, i) => relationObject(`/ACME/IF_CHILD${i}`, 'INTF/OI'));
const discoveryXml = `<service><workspace><collection href="${RELATIONS_PATH}"><accept>${RELATIONS_MIME}</accept></collection></workspace></service>`;
const servers: Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  resetCachedFeatures();
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }),
  );
});

async function setup(proxy: boolean, listener: RequestListener) {
  const server = createServer(listener);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected loopback listener');
  const semaphore = new Semaphore(1);
  const client = new AdtClient({
    baseUrl: proxy ? 'http://sap.invalid:8000' : `http://127.0.0.1:${address.port}`,
    adtSemaphore: semaphore,
    ...(proxy
      ? {
          btpProxy: {
            protocol: 'http' as const,
            host: '127.0.0.1',
            port: address.port,
            getProxyToken: async () => 'synthetic-proxy-token',
          },
        }
      : {}),
  });
  return { client, semaphore };
}

describe.each([false, true])('relation budgets over real HTTP, proxy=%s', (proxy) => {
  it.each([false, true])('completes eight cold expansions, CSRF GET fallback=%s', async (fallback) => {
    resetCachedFeatures();
    let sends = 0,
      lookups = 0,
      bytes = 0;
    const { client, semaphore } = await setup(proxy, (req, res) => {
      sends++;
      const path = new URL(req.url!, 'http://loopback.invalid').pathname;
      if (path === '/sap/bc/adt/core/discovery') {
        if (req.method === 'GET' || !fallback) res.setHeader('x-csrf-token', 'TEST');
        res.end();
        return;
      }
      const body =
        req.method === 'POST'
          ? ++lookups === 1
            ? relationXml(root, children)
            : relationXml(children[lookups - 2]!, [])
          : path === '/sap/bc/adt/discovery'
            ? discoveryXml
            : relationMetadata(root);
      bytes += Buffer.byteLength(body);
      res.end(body);
    });
    const response = await handleToolCall(client, { ...DEFAULT_CONFIG, liveRelations: true }, 'SAPNavigate', {
      action: 'relations',
      type: 'CLAS',
      name: root.name,
      depth: 2,
    });
    expect(response.isError).toBeUndefined();
    const result = JSON.parse(response.content[0]!.text);
    expect(result.expanded).toHaveLength(8);
    expect(result.truncated).toBe(false);
    expect(result.metrics).toMatchObject({ httpAttempts: fallback ? 12 : 11, successfulMetadataBytes: bytes });
    expect(result.metrics.httpAttempts).toBe(sends);
    expect(lookups).toBe(8);
    expect(semaphore.inflight).toBe(0);
  });

  describe.each([401, 403])('after recovered HTTP %s', (status) => {
    it.each(['requests', 'bytes', 'deadline'] as const)('allows later %s truncation', async (reason) => {
      let posts = 0;
      const { client, semaphore } = await setup(proxy, (req, res) => {
        if (req.method === 'HEAD') {
          res.setHeader('x-csrf-token', 'TEST');
          res.end();
        } else if (req.method === 'GET') res.end(relationMetadata(root));
        else if (++posts === 1) {
          res.writeHead(status);
          res.end('synthetic auth recovery');
        } else if (posts === 2) res.end(relationXml(root, [children[0]!]));
        else res.end('x'.repeat(8193));
      });
      const options: AdtRequestOptions = {
        attemptBudget: new RequestAttemptBudget(reason === 'requests' ? 5 : 12),
        responseBudget: new DataResponseBudget(8192),
        deadline: Date.now() + 15000,
      };
      const provider = new NativeRelationProvider(client, options);
      const validated = await provider.validateRoot('CLAS', root.name);
      if (reason === 'deadline') {
        const lookup = provider.lookup.bind(provider);
        vi.spyOn(provider, 'lookup').mockImplementation(async (...args) => {
          const result = await lookup(...args);
          options.deadline = Date.now() - 1;
          return result;
        });
      }
      const result = await walkRelations(validated, provider, { direction: 'outgoing', depth: 2, maxResults: 50 });
      expect(result.truncationReasons).toEqual([reason]);
      expect(result.expanded).toEqual([root.uri]);
      expect(result.pending).toEqual([children[0]!.uri]);
      expect(options.attemptBudget!.authorizationFailureObserved).toBe(false);
      expect(semaphore.inflight).toBe(0);
      expect(options.responseBudget!.reservedBytes).toBe(0);
    });

    it('does not reinterpret denied child then retry-404 as a missing node', async () => {
      let posts = 0;
      const { client } = await setup(proxy, (req, res) => {
        if (req.method === 'HEAD') {
          res.setHeader('x-csrf-token', 'TEST');
          res.end();
        } else if (req.method === 'GET') res.end(relationMetadata(root));
        else if (++posts === 1) res.end(relationXml(root, [children[0]!]));
        else {
          res.writeHead(posts === 2 ? status : 404);
          res.end('synthetic denied or missing');
        }
      });
      const options = { attemptBudget: new RequestAttemptBudget(12), responseBudget: new DataResponseBudget(8192) };
      const provider = new NativeRelationProvider(client, options);
      const validated = await provider.validateRoot('CLAS', root.name);
      await expect(
        walkRelations(validated, provider, { direction: 'outgoing', depth: 2, maxResults: 50 }),
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(options.attemptBudget.authorizationFailureObserved).toBe(true);
    });
  });
});
