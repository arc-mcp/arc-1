import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { AdtHttpClient } from '../../../src/adt/http.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { listTransports } from '../../../src/adt/transport.js';
import { handleToolCall } from '../../../src/handlers/dispatch.js';
import { runStartupAuthPreflightWithClient } from '../../../src/server/server.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

const CORE = '/sap/bc/adt/core/discovery';
const LEGACY = '/sap/bc/adt/discovery';
const requests: Array<{ method: string; path: string; headers: IncomingMessage['headers'] }> = [];
let server: ReturnType<typeof createServer> | undefined;

async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  server = createServer((req, res) => {
    requests.push({ method: req.method!, path: new URL(req.url!, 'http://localhost').pathname, headers: req.headers });
    handler(req, res);
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP test address');
  return `http://127.0.0.1:${address.port}`;
}

function respond(res: ServerResponse, status = 200, token?: string) {
  res.writeHead(status, { 'content-type': 'text/html', ...(token ? { 'x-csrf-token': token } : {}) });
  res.end();
}

function client(baseUrl: string) {
  return new AdtHttpClient({
    baseUrl,
    username: 'test-user',
    password: 'test-password',
    client: '800',
    language: 'EN',
  });
}

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server!.close((error) => (error ? reject(error) : resolve())));
    server = undefined;
  }
  requests.length = 0;
});

describe('legacy ADT discovery against a real HTTP server', () => {
  it('recreates ECC empty-200 fallthrough and carries the legacy token/session into a POST', async () => {
    const baseUrl = await serve((req, res) => {
      const path = new URL(req.url!, 'http://localhost').pathname;
      if (path === CORE) {
        res.setHeader('set-cookie', 'SAP_SESSIONID=core-session; Path=/; Secure; HttpOnly');
        respond(res);
      } else if (path === LEGACY) {
        res.setHeader('set-cookie', 'SAP_SESSIONID=legacy-session; Path=/; Secure; HttpOnly');
        respond(res, 200, 'LEGACY-TOKEN');
      } else {
        respond(
          res,
          req.headers['x-csrf-token'] === 'LEGACY-TOKEN' && req.headers.cookie?.includes('legacy-session') ? 200 : 403,
        );
      }
    });
    await expect(client(baseUrl).post('/sap/bc/adt/checkruns', '<check/>')).resolves.toMatchObject({ statusCode: 200 });
    expect(requests.map(({ method, path }) => [method, path])).toEqual([
      ['HEAD', CORE],
      ['GET', CORE],
      ['GET', LEGACY],
      ['POST', '/sap/bc/adt/checkruns'],
    ]);
    expect(requests[2]?.headers.cookie).toContain('SAP_SESSIONID=core-session');
    for (const request of requests)
      expect(request.headers.authorization).toBe(`Basic ${Buffer.from('test-user:test-password').toString('base64')}`);
  });

  it.each([404, 405])('recovers when core HEAD returns %i', async (status) => {
    const baseUrl = await serve((req, res) => {
      const path = new URL(req.url!, 'http://localhost').pathname;
      respond(res, path === LEGACY ? 200 : status, path === LEGACY ? 'LEGACY-TOKEN' : undefined);
    });
    await expect(client(baseUrl).fetchCsrfToken()).resolves.toBe(LEGACY);
    expect(requests.filter((r) => r.path === LEGACY)).toHaveLength(1);
  });

  it.each([401, 403, 500])('never falls through a GET auth/server failure (%i)', async (status) => {
    const baseUrl = await serve((req, res) => respond(res, req.method === 'HEAD' ? 200 : status));
    await expect(client(baseUrl).fetchCsrfToken()).rejects.toMatchObject({ statusCode: status, path: CORE });
    expect(requests.map((r) => r.path)).toEqual([CORE, CORE]);
  });

  it('rejects a token supplied on an HTTP authentication failure', async () => {
    const baseUrl = await serve((_req, res) => respond(res, 401, 'NOT-A-SUCCESS'));
    await expect(client(baseUrl).fetchCsrfToken()).rejects.toMatchObject({ statusCode: 401 });
    expect(requests).toHaveLength(1);
  });

  it('bounds tokenless discovery and rejects Required markers case-insensitively', async () => {
    const baseUrl = await serve((_req, res) => respond(res, 200, 'required'));
    await expect(client(baseUrl).fetchCsrfToken()).rejects.toMatchObject({ path: LEGACY, statusCode: 200 });
    expect(requests).toHaveLength(3);
  });

  it('retries an HTTP 400 HEAD with GET even when SAP includes a token', async () => {
    const baseUrl = await serve((req, res) =>
      respond(res, req.method === 'HEAD' ? 400 : 200, req.method === 'HEAD' ? 'HEAD-TOKEN' : 'GET-TOKEN'),
    );
    await expect(client(baseUrl).fetchCsrfToken()).resolves.toBe(CORE);
    expect(requests.map(({ method, path }) => [method, path])).toEqual([
      ['HEAD', CORE],
      ['GET', CORE],
    ]);
  });

  it('keeps modern token bootstrap to one HEAD', async () => {
    const baseUrl = await serve((_req, res) => respond(res, 200, 'MODERN-TOKEN'));
    await expect(client(baseUrl).fetchCsrfToken()).resolves.toBe(CORE);
    expect(requests.map((r) => r.method)).toEqual(['HEAD']);
  });

  it.each([undefined, 'LEGACY-TOKEN'])('reports startup bootstrap according to the legacy token: %s', async (token) => {
    const baseUrl = await serve((req, res) => respond(res, 200, req.url?.startsWith(LEGACY) ? token : undefined));
    const config = {
      ...DEFAULT_CONFIG,
      url: baseUrl,
      ppEnabled: false,
      username: 'test-user',
      password: 'test-password',
    };
    const adt = new AdtClient({
      baseUrl,
      username: config.username,
      password: config.password,
      safety: defaultSafetyConfig(),
    });
    const result = await runStartupAuthPreflightWithClient(config, adt);
    expect(result).toMatchObject({ status: token ? 'ok' : 'inconclusive', blocking: false, endpoint: LEGACY });
    expect(requests).toHaveLength(3);
  });

  it('keeps an HTML login page a blocking authentication failure', async () => {
    const baseUrl = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/atomsvc+xml' });
      res.end('<html><body><form action="login">Log on</form></body></html>');
    });
    const config = { ...DEFAULT_CONFIG, url: baseUrl, ppEnabled: false };
    const adt = new AdtClient({ baseUrl, username: 'test-user', password: 'test-password' });
    expect(await runStartupAuthPreflightWithClient(config, adt)).toMatchObject({
      status: 'failed',
      blocking: true,
      statusCode: 401,
    });
    expect(requests.map((r) => r.path)).toEqual([CORE, CORE]);
  });

  it('retains per-user identity and session headers on the legacy probe', async () => {
    const baseUrl = await serve((req, res) => respond(res, 200, req.url?.startsWith(LEGACY) ? 'TOKEN' : undefined));
    const http = new AdtHttpClient({
      baseUrl,
      client: '800',
      sapConnectivityAuth: 'Bearer user-token',
      sessionType: 'stateful',
      disableSaml: true,
    });
    await expect(http.fetchCsrfToken()).resolves.toBe(LEGACY);
    for (const { headers } of requests) {
      expect(headers['sap-connectivity-authentication']).toBe('Bearer user-token');
      expect(headers['x-sap-adt-sessiontype']).toBe('stateful');
      expect(headers['x-sap-saml2']).toBe('disabled');
      expect(headers.authorization).toBeUndefined();
    }
  });

  it('aborts the legacy probe within the caller budget without submitting the POST', async () => {
    const controller = new AbortController();
    const baseUrl = await serve((req, res) => {
      if (req.url?.startsWith(LEGACY)) controller.abort();
      else respond(res);
    });
    await expect(
      client(baseUrl).post('/sap/bc/adt/checkruns', '<check/>', undefined, undefined, { signal: controller.signal }),
    ).rejects.toThrow();
    expect(requests.map((r) => r.method)).toEqual(['HEAD', 'GET', 'GET']);
  });

  it('rejects an empty HTTP 200 CTS body instead of reporting no transports', async () => {
    const baseUrl = await serve((_req, res) => respond(res));
    await expect(listTransports(client(baseUrl), defaultSafetyConfig())).rejects.toThrow(
      /transport API.*unavailable|unexpected CTS/i,
    );
  });

  it.each([
    ['list', true],
    ['get', true],
    ['list', false],
    ['get', false],
  ] as const)('explains invalid CTS %s responses with minimalErrors=%s', async (action, minimalErrors) => {
    const baseUrl = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end('<unexpected>PRIVATE_BACKEND_DETAIL</unexpected>');
    });
    const adt = new AdtClient({ baseUrl });
    const result = await handleToolCall(adt, { ...DEFAULT_CONFIG, minimalErrors }, 'SAPTransport', {
      action,
      ...(action === 'get' ? { id: 'PRIVATE_REQUEST_ID' } : { user: 'PRIVATE_USER' }),
    });
    expect(result.isError).toBe(true);
    const message = result.content[0]?.text ?? '';
    expect(message.match(/no transport organizer document was returned/g)).toHaveLength(1);
    expect(message).toContain('does not establish an empty list or a missing request');
    expect(message).not.toContain('PRIVATE_BACKEND_DETAIL');
    if (minimalErrors) {
      expect(message).not.toContain('PRIVATE_REQUEST_ID');
      expect(message).not.toContain('PRIVATE_USER');
      expect(message).not.toContain('/sap/bc/adt/');
    }
  });
});
