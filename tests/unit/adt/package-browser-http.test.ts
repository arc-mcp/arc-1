import { createServer, type RequestListener, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdtHttpClient } from '../../../src/adt/http.js';
import { getDirectPackageContents } from '../../../src/adt/package-browser.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { requestContext } from '../../../src/server/context.js';

const root =
  '<abap><values><DATA><TREE_CONTENT/><OBJECT_TYPES><SEU_ADT_OBJECT_TYPE_INFO><OBJECT_TYPE>CLAS/OC</OBJECT_TYPE><NODE_ID>000123</NODE_ID></SEU_ADT_OBJECT_TYPE_INFO></OBJECT_TYPES></DATA></values></abap>';
const expanded =
  '<abap><values><DATA><TREE_CONTENT><SEU_ADT_REPOSITORY_OBJ_NODE><OBJECT_TYPE>CLAS/OC</OBJECT_TYPE><OBJECT_NAME>ZCL_ONE</OBJECT_NAME><OBJECT_URI>/sap/bc/adt/oo/classes/zcl_one</OBJECT_URI></SEU_ADT_REPOSITORY_OBJ_NODE></TREE_CONTENT></DATA></values></abap>';
const servers: Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
async function setup(proxy: boolean, listener: RequestListener) {
  const server = createServer(listener);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a local TCP listener');
  const http = new AdtHttpClient({
    baseUrl: proxy ? 'http://sap.invalid:8000' : `http://127.0.0.1:${address.port}`,
    ...(proxy
      ? {
          btpProxy: {
            protocol: 'http' as const,
            host: '127.0.0.1',
            port: address.port,
            getProxyToken: async () => 'test',
          },
        }
      : {}),
  });
  return { http, post: vi.spyOn(http, 'post') };
}

describe.each([false, true])('direct package transport, Connectivity proxy=%s', (proxy) => {
  it('lists a package on a cold session when core discovery has no token (#1193)', async () => {
    const sends: string[] = [];
    const credentials: { cookie: string | undefined; token: string | string[] | undefined }[] = [];
    let reads = 0;
    const { http, post } = await setup(proxy, (req, res) => {
      const path = new URL(req.url!, 'http://sap.test').pathname;
      sends.push(`${req.method} ${path}`);
      credentials.push({ cookie: req.headers.cookie, token: req.headers['x-csrf-token'] });
      if (path === '/sap/bc/adt/core/discovery') {
        res.setHeader('content-type', 'text/html');
        res.setHeader('set-cookie', 'SAP_SESSIONID=first; Path=/; Secure; HttpOnly');
        res.end();
      } else if (path === '/sap/bc/adt/discovery') {
        res.setHeader('x-csrf-token', 'TOKEN');
        res.setHeader('set-cookie', 'SAP_EXTRA=second; Path=/; Secure; HttpOnly');
        res.end('<service/>');
      } else {
        res.end(++reads === 1 ? root : expanded);
      }
    });
    const result = await getDirectPackageContents(http, defaultSafetyConfig(), 'ZPACKAGE');
    expect(result.objects.map((object) => object.name)).toEqual(['ZCL_ONE']);
    expect(sends).toEqual([
      'HEAD /sap/bc/adt/core/discovery',
      'GET /sap/bc/adt/core/discovery',
      'GET /sap/bc/adt/discovery',
      'POST /sap/bc/adt/repository/nodestructure',
      'POST /sap/bc/adt/repository/nodestructure',
    ]);
    expect(credentials[2]!.cookie).toContain('SAP_SESSIONID=first');
    for (const headers of credentials.slice(3)) {
      expect(headers.cookie).toContain('SAP_SESSIONID=first');
      expect(headers.cookie).toContain('SAP_EXTRA=second');
      expect(headers.token).toBe('TOKEN');
    }
    const options = post.mock.calls[0]![4]!;
    expect(post.mock.calls[1]![4]).toBe(options);
    expect(options.attemptBudget).toMatchObject({ used: 5, limit: 8 });
    expect(options.responseBudget!.consumedBytes).toBe(Buffer.byteLength(root + expanded));
  });

  it('counts CSRF and both native reads in the same real-send allowance', async () => {
    const methods: string[] = [];
    let reads = 0;
    const { http, post } = await setup(proxy, (req, res) => {
      methods.push(req.method!);
      if (req.method === 'HEAD') {
        res.setHeader('x-csrf-token', 'test');
        res.end();
      } else res.end(++reads === 1 ? root : expanded);
    });
    const result = await getDirectPackageContents(http, defaultSafetyConfig(), 'ZPACKAGE');
    expect(result.objects[0]!.name).toBe('ZCL_ONE');
    expect(methods).toEqual(['HEAD', 'POST', 'POST']);
    const options = post.mock.calls[0]![4]!;
    expect(post.mock.calls[1]![4]).toBe(options);
    expect(options.attemptBudget!.used).toBe(methods.length);
    expect(options.attemptBudget!.limit).toBe(8);
  });

  it('limits cumulative streamed bytes before XML parsing, without Content-Length', async () => {
    let reads = 0;
    const { http } = await setup(proxy, (req, res) => {
      if (req.method === 'HEAD') {
        res.setHeader('x-csrf-token', 'test');
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.write(' '.repeat(1024 * 1024));
      res.end(++reads === 1 ? root : expanded);
    });
    await expect(getDirectPackageContents(http, defaultSafetyConfig(), 'ZPACKAGE')).rejects.toMatchObject({
      name: 'AdtResponseLimitError',
      endpointFamily: 'package-browser',
      limitBytes: 2 * 1024 * 1024,
    });
    expect(reads).toBe(2);
  });

  it('cancels a streaming expansion instead of returning the root prefix', async () => {
    const controller = new AbortController();
    let reads = 0;
    const { http } = await setup(proxy, (req, res) => {
      if (req.method === 'HEAD') {
        res.setHeader('x-csrf-token', 'test');
        res.end();
        return;
      }
      if (++reads === 1) res.end(root);
      else {
        res.write('<abap>');
        controller.abort();
      }
    });
    await expect(
      requestContext.run({ requestId: 'cancel-browser', signal: controller.signal }, () =>
        getDirectPackageContents(http, defaultSafetyConfig(), 'ZPACKAGE'),
      ),
    ).rejects.toThrow();
    expect(reads).toBe(2);
  });
});
