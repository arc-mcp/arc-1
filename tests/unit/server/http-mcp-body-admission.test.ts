import { once } from 'node:events';
import type { Server as HttpServer } from 'node:http';
import { type AddressInfo, connect } from 'node:net';
import type { XsuaaCredentials } from '@arc-mcp/xsuaa-auth';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalDestinationUrl, opaqueDestinationValue } from '../../../src/server/destination-discovery.js';
import { DestinationRegistry } from '../../../src/server/destination-registry.js';
import { startHttpServer } from '../../../src/server/http.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

vi.mock('@arc-mcp/xsuaa-auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@arc-mcp/xsuaa-auth')>();
  const { InvalidTokenError } = await import('@modelcontextprotocol/sdk/server/auth/errors.js');
  return {
    ...original,
    createXsuaaTokenVerifier: vi.fn(() => async (token: string) => {
      if (!['read-token', 'zero-token'].includes(token)) throw new InvalidTokenError('Invalid test token');
      return {
        token,
        clientId: 'admission-test',
        scopes: ['read'],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        extra: {
          userName: 'TEST_USER',
          xsuaaUserAttributes: { arc1_targets: token === 'read-token' ? ['A4H/100'] : [] },
          xsuaaUserAttributeStatus: { arc1_targets: 'valid' },
        },
      };
    }),
  };
});

const XSUAA: XsuaaCredentials = {
  url: 'https://tenant.authentication.example.test',
  clientid: 'test-client',
  clientsecret: 'test-only-client-secret',
  xsappname: 'test!t1',
  uaadomain: 'authentication.example.test',
};
type Fixture = { server: HttpServer; factory: ReturnType<typeof vi.fn<() => Server>>; token?: string };
const fixtures: Fixture[] = [];

async function start(mode: 'api' | 'anonymous' | 'standard' | 'scoped', limit = 1024): Promise<Fixture> {
  const multi = mode === 'standard' || mode === 'scoped';
  const config = {
    ...DEFAULT_CONFIG,
    httpAddr: '127.0.0.1:0',
    maxHttpRequestBytes: limit,
    apiKeys: mode === 'api' ? [{ key: 'local-admission-key', profile: 'viewer' }] : undefined,
    allowHttpNoAuth: mode === 'anonymous',
    xsuaaAuth: multi,
    multiTargetEndpoints: multi,
    multiTargetAuthorization: mode === 'scoped' ? 'xsuaa-attribute' : 'standard',
    cacheMode: 'none',
    authRateLimit: 0,
    mcpHttpRateLimit: 0,
  } as const;
  const factory = vi.fn(() => new Server({ name: 'body-admission-test', version: '1' }, { capabilities: {} }));
  const url = canonicalDestinationUrl('https://sap.example.test') as string;
  const registry = DestinationRegistry.fromDiscovery(
    {
      subaccount: [
        {
          name: 'TEST_PP',
          type: 'HTTP',
          urlState: 'valid',
          urlFingerprint: opaqueDestinationValue(url),
          authentication: 'PrincipalPropagation',
          proxyType: 'OnPremise',
          sapSysId: 'A4H',
          sapClient: '100',
          description: 'Test target',
          hasCloudConnectorLocationId: false,
          arcProperties: { 'arc1.enabled': 'true' },
        },
      ],
      instanceNames: [],
      scannedCount: 1,
      unrelatedCount: 0,
      arcAdjacentWithoutMarkerCount: 0,
    },
    config,
    { authorizationMode: config.multiTargetAuthorization },
  );
  const server = await startHttpServer(
    multi ? undefined : factory,
    config,
    multi ? XSUAA : undefined,
    undefined,
    multi
      ? {
          registry,
          authorizationMode: config.multiTargetAuthorization,
          aggregateFactory: factory,
          createPinnedServer: factory,
        }
      : undefined,
  );
  if (!server.listening) await once(server, 'listening');
  const fixture = { server, factory, token: multi ? 'read-token' : mode === 'api' ? 'local-admission-key' : undefined };
  fixtures.push(fixture);
  return fixture;
}

type Options = {
  path?: string;
  type?: string | string[];
  token?: string | null;
  method?: string;
  chunked?: boolean;
  omitLength?: boolean;
  accept?: string;
  headersOnly?: boolean;
  sendBody?: boolean;
};
function wire(fixture: Fixture, body: string | Buffer = '', options: Options = {}) {
  return new Promise<{ status: number; response: string }>((resolve, reject) => {
    const socket = connect((fixture.server.address() as AddressInfo).port, '127.0.0.1');
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
    let response = '';
    const finish = () => resolve({ status: Number(/^HTTP\/1\.1 (\d+)/.exec(response)?.[1]), response });
    socket.setTimeout(10_000, () => socket.destroy(new Error('Local HTTP response timed out')));
    socket.on('error', reject);
    socket.on('data', (data) => {
      response += data.toString('utf8');
      const headerEnd = response.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const headers = response.slice(0, headerEnd);
      const length = /^content-length: (\d+)/im.exec(headers);
      const complete = length
        ? Buffer.byteLength(response.slice(headerEnd + 4)) >= Number(length[1])
        : /transfer-encoding: chunked/i.test(headers) && response.endsWith('\r\n0\r\n\r\n');
      // The SDK can keep its socket alive after the complete HTTP message.
      if (options.headersOnly || complete) {
        finish();
        socket.destroy();
      }
    });
    socket.on('end', finish);
    socket.on('connect', () => {
      const token = options.token === null ? undefined : (options.token ?? fixture.token);
      const types =
        options.type === undefined ? ['application/json'] : Array.isArray(options.type) ? options.type : [options.type];
      const headers = [
        `${options.method ?? 'POST'} ${options.path ?? '/mcp'} HTTP/1.1`,
        'Host: 127.0.0.1',
        ...types.map((type) => `Content-Type: ${type}`),
        `Accept: ${options.accept ?? 'application/json, text/event-stream'}`,
        ...(token ? [`Authorization: Bearer ${token}`] : []),
        ...(options.chunked
          ? ['Transfer-Encoding: chunked']
          : options.omitLength
            ? []
            : [`Content-Length: ${bytes.length}`]),
        'Connection: close',
        '',
        '',
      ].join('\r\n');
      // HTTP field bytes are Latin-1. UTF-8 C2 A0 is a different, rejected media type.
      const framed = options.chunked
        ? Buffer.concat([Buffer.from(`${bytes.length.toString(16)}\r\n`), bytes, Buffer.from('\r\n0\r\n\r\n')])
        : bytes;
      socket.write(
        Buffer.concat([Buffer.from(headers, 'latin1'), options.sendBody === false ? Buffer.alloc(0) : framed]),
      );
    });
  });
}

function initialize(bytes = 512) {
  const message = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: '', version: '1' } },
  };
  message.params.clientInfo.name = 'x'.repeat(bytes - Buffer.byteLength(JSON.stringify(message)));
  return JSON.stringify(message);
}

let api: Fixture, anonymous: Fixture, standard: Fixture, scoped: Fixture, large: Fixture;
beforeAll(async () => {
  api = await start('api');
  anonymous = await start('anonymous');
  standard = await start('standard');
  scoped = await start('scoped');
  large = await start('api', 5 * 1024 * 1024);
});
beforeEach(() => {
  for (const fixture of fixtures) fixture.factory.mockClear();
});
afterAll(async () => {
  for (const { server } of fixtures) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

const routes = [
  ['API key', () => api, '/mcp'],
  ['anonymous opt-in', () => anonymous, '/mcp'],
  ['standard pinned', () => standard, '/A4H/100/mcp'],
  ['standard aggregate', () => standard, '/multi/mcp'],
  ['scoped pinned', () => scoped, '/A4H/100/mcp'],
  ['scoped aggregate', () => scoped, '/multi/mcp'],
] as const;

describe.each(routes)('%s', (_label, get, path) => {
  it.each([
    'application/json\xa0',
    '\xa0application/json',
    'application/json\xa0; charset=utf-8',
    'application/json\xa0;',
  ])('rejects unparsed %s before creating an SDK server', async (type) => {
    const fixture = get();
    for (const chunked of [false, true]) {
      const response = await wire(fixture, initialize(2193), { path, type, chunked });
      expect(response.status).toBe(415);
      expect(response.response).toContain('POST requires an application/json body');
    }
    expect(fixture.factory).not.toHaveBeenCalled();
  });

  it.each(['application/json', 'Application/JSON', 'application/json ; charset=utf-8', 'application/json;'])(
    'keeps normal JSON admission for %s',
    async (type) => {
      const fixture = get();
      expect((await wire(fixture, initialize(), { path, type })).status).toBe(200);
      fixture.factory.mockClear();
      expect((await wire(fixture, initialize(2193), { path, type })).status).toBe(413);
      expect(fixture.factory).not.toHaveBeenCalled();
    },
  );

  it('keeps authentication before invalid MIME handling', async () => {
    const fixture = get();
    const response = await wire(fixture, initialize(2193), { path, type: 'application/json\xa0', token: null });
    expect(response.status).toBe(fixture === anonymous ? 415 : 401);
    expect(fixture.factory).not.toHaveBeenCalled();
  });
});

it('rejects the UTF-8 control and duplicate media types without constructing a server', async () => {
  for (const type of ['application/json\xc2\xa0', ['text/plain', 'application/json']]) {
    expect((await wire(api, initialize(), { type })).status).toBe(415);
  }
  expect(api.factory).not.toHaveBeenCalled();
});

it('preserves form media rejection even when a form body is already parsed', async () => {
  const body = `jsonrpc=2.0&id=1&method=ping&padding=${'x'.repeat(2048)}`;
  for (const type of ['application/x-www-form-urlencoded', ['application/x-www-form-urlencoded', 'application/json']]) {
    expect((await wire(api, body, { type })).status).toBe(415);
  }
});

it('keeps target grants before malformed-body errors', async () => {
  const response = await wire(scoped, initialize(), {
    path: '/A4H/100/mcp',
    type: 'application/json\xa0',
    token: 'zero-token',
  });
  expect(response.status).toBe(404);
  expect(scoped.factory).not.toHaveBeenCalled();
});

it('rejects an unparsed aggregate request from a zero-grant reader', async () => {
  const response = await wire(scoped, initialize(), {
    path: '/multi/mcp',
    type: 'application/json\xa0',
    token: 'zero-token',
  });
  expect(response.status).toBe(415);
  expect(scoped.factory).not.toHaveBeenCalled();
});

it('leaves legitimate large parsed JSON outside the SDK raw-reader cap', async () => {
  const body = initialize(4 * 1024 * 1024 + 1);
  expect((await wire(large, body)).status).toBe(200);
  large.factory.mockClear();
  // The rejection must arrive before even uploading an inadmissible body.
  expect((await wire(large, body, { type: 'application/json\xa0', sendBody: false })).status).toBe(415);
  expect(large.factory).not.toHaveBeenCalled();
});

it('preserves supported JSON charsets', async () => {
  const response = await wire(api, Buffer.from(initialize(), 'utf16le'), {
    type: 'application/json; charset=utf-16le',
  });
  expect(response.status).toBe(200);
});

it('keeps valid JSON Accept errors at the SDK', async () => {
  expect((await wire(api, initialize(), { accept: 'application/json' })).status).toBe(406);
  expect(api.factory).toHaveBeenCalledTimes(1);
});

it('keeps Copilot JSON routing and ordinary OAuth errors separate', async () => {
  expect((await wire(scoped, initialize(), { path: '/authorize' })).status).toBe(200);
  scoped.factory.mockClear();
  expect((await wire(scoped, initialize(), { path: '/authorize', type: 'application/json\xa0' })).status).toBe(400);
  expect(scoped.factory).not.toHaveBeenCalled();
});

it('keeps non-POST and exact-case HTTP method behavior', async () => {
  expect(
    (
      await wire(api, '', {
        method: 'GET',
        omitLength: true,
        type: 'application/json\xa0',
        accept: 'text/event-stream',
        headersOnly: true,
      })
    ).status,
  ).toBe(200);
  expect((await wire(api, initialize(), { method: 'PUT' })).status).toBe(405);
  expect((await wire(api, '', { method: 'DELETE' })).status).toBe(200);
  api.factory.mockClear();
  expect((await wire(api, initialize(), { method: 'post' })).status).toBe(400);
  expect(api.factory).not.toHaveBeenCalled();
});

it('refuses unparsed empty POSTs while leaving parsed empty JSON invalid', async () => {
  expect((await wire(api, '', { omitLength: true })).status).toBe(415);
  expect(api.factory).not.toHaveBeenCalled();
  expect((await wire(api, '')).status).toBe(400);
});
