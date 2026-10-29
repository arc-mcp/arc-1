/** Actual sends and streamed response accounting through both direct and Connectivity transports. */

import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverClassIdentities, discoverClassSources } from '../../../src/adt/class-extensions.js';
import { AdtClient } from '../../../src/adt/client.js';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import { ExtensionDiscoverySession } from '../../../src/adt/extension-discovery.js';
import { RequestAttemptBudget } from '../../../src/adt/request-attempt-budget.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/class-extensions/${name}`, import.meta.url), 'utf8');
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (s) => {
      s.closeAllConnections();
      await new Promise<void>((r) => s.close(() => r()));
    }),
  );
});
describe.each([false, true])('class extension budgets, Connectivity=%s', (proxy) => {
  it.each(['success', 'requests', 'bytes', 'deadline', 'auth', 'throttle'] as const)(
    'retains partial evidence at %s',
    async (scenario) => {
      let sends = 0,
        sources = 0;
      const server = createServer((req, res) => {
        sends++;
        if (req.method === 'HEAD') {
          res.setHeader('x-csrf-token', 'TEST');
          res.end();
          return;
        }
        if (req.method === 'POST') {
          res.end(fixture('class-exted.xml'));
          return;
        }
        const path = new URL(req.url!, 'http://local').pathname;
        if (path.includes('/oo/classes/')) {
          res.end('<abapClass name="CL_OO_ADT_ENHANCED_CLASS" type="CLAS/OC" version="active"/>');
          return;
        }
        if (path.includes('/enhoxh/')) {
          res.writeHead(scenario === 'auth' ? 401 : scenario === 'throttle' ? 429 : 404);
          res.end();
          return;
        }
        if (path.endsWith('/versions')) {
          expect(req.headers.accept).toBe('application/atom+xml;type=feed');
          res.end(fixture('class-feed.xml'));
          return;
        }
        sources++;
        res.end('x'.repeat(scenario === 'bytes' ? 8192 : 32));
      });
      servers.push(server);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No listener');
      const client = new AdtClient({
        baseUrl: proxy ? 'http://sap.invalid:8000' : `http://127.0.0.1:${address.port}`,
        retryUnauthorized: false,
        ...(proxy
          ? {
              btpProxy: {
                protocol: 'http',
                host: '127.0.0.1',
                port: address.port,
                getProxyToken: async () => 'synthetic',
              },
            }
          : {}),
      });
      const request = {
        root: { type: 'CLAS', name: 'CL_OO_ADT_ENHANCED_CLASS', version: 'active' },
        scope: 'owning_object',
      };
      const session = new ExtensionDiscoverySession('sources', request, client.safety);
      if (scenario === 'requests') session.options.attemptBudget = new RequestAttemptBudget(4);
      if (scenario === 'bytes') session.options.responseBudget = new DataResponseBudget(4096, 'class-test');
      const nodes = await discoverClassIdentities(client, session, request);
      expect(nodes).toHaveLength(1);
      if (scenario === 'deadline') session.options.deadline = Date.now() - 1;
      await discoverClassSources(client, session, nodes, '750');
      const result = session.finish();
      expect(result.consumed.sends).toBe(sends);
      expect(result.consumed.sends).toBeLessThanOrEqual(20);
      expect(result.consumed.responseBytes).toBeLessThanOrEqual(scenario === 'bytes' ? 4096 : 256 * 1024);
      expect(session.options.responseBudget!.reservedBytes).toBe(0);
      if (scenario === 'success') {
        expect(result.sources).toHaveLength(1);
        expect(sources).toBe(1);
      } else {
        expect(result.sources).toEqual([]);
        expect(session.stopped).toBe(true);
        expect(result.providers[1]?.status).toBe(scenario === 'auth' ? 'denied' : 'incomplete');
        if (scenario !== 'bytes') expect(sources).toBe(0);
        if (scenario === 'requests') expect(result.omissions.requests).toBe(1);
        if (scenario === 'bytes') expect(result.omissions.wire_bytes).toBe(1);
        if (scenario === 'deadline') expect(result.omissions.deadline).toBe(1);
      }
    },
  );
});
