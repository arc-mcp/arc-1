import { EventEmitter } from 'node:events';
import type { XsuaaCredentials } from '@arc-mcp/xsuaa-auth';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEvent, ClientIpRejectedEvent } from '../../../src/server/audit.js';
import { parseAllowedClientIps } from '../../../src/server/client-ip-allowlist.js';
import { canonicalDestinationUrl, opaqueDestinationValue } from '../../../src/server/destination-discovery.js';
import { DestinationRegistry } from '../../../src/server/destination-registry.js';
import { applySecurityMiddleware, startHttpServer } from '../../../src/server/http.js';
import { logger } from '../../../src/server/logger.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

vi.mock('@arc-mcp/xsuaa-auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('@arc-mcp/xsuaa-auth')>();
  const { InvalidTokenError } = await import('@modelcontextprotocol/sdk/server/auth/errors.js');
  return {
    ...original,
    createXsuaaTokenVerifier: vi.fn(() => async (token: string) => {
      throw new InvalidTokenError(`Not an XSUAA token: ${token.length}`);
    }),
  };
});

const HEADER = 'x-cf-true-client-ip';
const ALLOWED = '198.51.100.7';
const DENIED = '203.0.113.9';

let emitSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  emitSpy = vi.spyOn(logger, 'emitAudit').mockImplementation(() => {});
});
afterEach(() => {
  emitSpy.mockRestore();
});

function rejections(): ClientIpRejectedEvent[] {
  return emitSpy.mock.calls
    .map((call: unknown[]) => call[0] as AuditEvent)
    .filter((event: AuditEvent): event is ClientIpRejectedEvent => event.event === 'client_ip_rejected');
}

describe('parseAllowedClientIps', () => {
  it('accepts addresses and CIDR ranges of both families, trimming whitespace', () => {
    expect(parseAllowedClientIps('10.1.2.3')).toEqual(['10.1.2.3']);
    expect(parseAllowedClientIps('10.0.0.0/8')).toEqual(['10.0.0.0/8']);
    expect(parseAllowedClientIps('2001:db8::1')).toEqual(['2001:db8::1']);
    expect(parseAllowedClientIps('2001:db8::/32')).toEqual(['2001:db8::/32']);
    expect(parseAllowedClientIps(' 10.0.0.0/8 , 2001:db8::/32 ,192.0.2.7,0.0.0.0/0')).toEqual([
      '10.0.0.0/8',
      '2001:db8::/32',
      '192.0.2.7',
      '0.0.0.0/0',
    ]);
  });

  it('treats blank as off', () => {
    expect(parseAllowedClientIps('')).toEqual([]);
    expect(parseAllowedClientIps('   ')).toEqual([]);
  });

  it.each(['10.0.0.1,', ',10.0.0.1', '10.0.0.1,,10.0.0.2', ',', '10.0.0.1, ,10.0.0.2'])(
    'rejects an empty entry in %j',
    (raw) => {
      expect(() => parseAllowedClientIps(raw)).toThrow(/ARC1_ALLOWED_CLIENT_IPS entry #\d+ of \d+ is empty/);
    },
  );

  it.each([
    'not-an-ip',
    'example.com',
    'localhost',
    '10.0.0.1:443',
    '[::1]:443',
    '[::1]',
    'fe80::1%eth0',
    '10.0.0.0/33',
    '10.0.0.0/-1',
    '10.0.0.0/8.5',
    '10.0.0.0/',
    '10.0.0.0/08',
    '10.0.0.0/ 8',
    '2001:db8::/129',
    '10.0.0.0//8',
    '10.0.0.0/8/8',
    '010.0.0.1',
    '/8',
  ])('rejects %j and names the entry', (entry) => {
    expect(() => parseAllowedClientIps(`192.0.2.1,${entry}`)).toThrow(
      `ARC1_ALLOWED_CLIENT_IPS: invalid entry '${entry.trim()}'`,
    );
  });

  it('names the CLI flag when the value came from it', () => {
    expect(() => parseAllowedClientIps('nope', '--allowed-client-ips')).toThrow(
      "--allowed-client-ips: invalid entry 'nope'",
    );
  });
});

function buildApp(ips: string[], origins: string[] = []): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  applySecurityMiddleware(app, origins, ips);
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.all('/mcp', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('client IP allowlist middleware', () => {
  it('is inert when the list is empty', async () => {
    const app = buildApp([]);
    expect((await request(app).post('/mcp')).status).toBe(200);
    expect((await request(app).post('/mcp').set(HEADER, 'garbage')).status).toBe(200);
    expect(rejections()).toEqual([]);
  });

  it('passes an exact address and an address inside a range', async () => {
    expect(
      (
        await request(buildApp([ALLOWED]))
          .post('/mcp')
          .set(HEADER, ALLOWED)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(buildApp(['10.0.0.0/8']))
          .post('/mcp')
          .set(HEADER, '10.20.30.40')
      ).status,
    ).toBe(200);
    expect(rejections()).toEqual([]);
  });

  it('refuses an address outside the list with 403 and audits it', async () => {
    const res = await request(buildApp([ALLOWED, '10.0.0.0/8']))
      .post('/mcp')
      .set(HEADER, DENIED);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
    expect(res.text).not.toContain('198.51.100');
    expect(res.text).not.toContain('10.0.0.0');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(rejections()).toEqual([
      expect.objectContaining({
        level: 'warn',
        reason: 'not_allowed',
        clientIp: DENIED,
        method: 'POST',
        path: '/mcp',
      }),
    ]);
  });

  it('refuses a request without the header', async () => {
    const res = await request(buildApp([ALLOWED])).get('/mcp');
    expect(res.status).toBe(403);
    expect(rejections()).toHaveLength(1);
    expect(rejections()[0]).toMatchObject({ reason: 'missing_header', method: 'GET', path: '/mcp' });
    expect(rejections()[0]).not.toHaveProperty('clientIp');
  });

  it.each([
    ['empty', ''],
    ['comma list', `${ALLOWED}, 10.0.0.1`],
    ['address with port', `${ALLOWED}:443`],
    ['bracketed IPv6', '[2001:db8::1]'],
    ['garbage', 'not-an-ip'],
    ['zone id', 'fe80::1%eth0'],
  ])('refuses a malformed header (%s)', async (_label, value) => {
    const res = await request(buildApp([ALLOWED, 'fe80::/10']))
      .post('/mcp')
      .set(HEADER, value);
    expect(res.status).toBe(403);
    expect(rejections()).toEqual([expect.objectContaining({ reason: 'invalid_header', clientIp: value })]);
  });

  it('refuses a repeated header even when every copy is allowed', async () => {
    const res = await request(buildApp([ALLOWED]))
      .post('/mcp')
      .set(HEADER, [ALLOWED, ALLOWED]);
    expect(res.status).toBe(403);
    expect(rejections()).toEqual([
      expect.objectContaining({ reason: 'invalid_header', clientIp: `${ALLOWED}, ${ALLOWED}` }),
    ]);
  });

  it('caps an oversized header value in the audit event', async () => {
    const res = await request(buildApp([ALLOWED]))
      .post('/mcp')
      .set(HEADER, 'a'.repeat(4096));
    expect(res.status).toBe(403);
    expect(rejections()[0]).toMatchObject({ reason: 'invalid_header', clientIp: 'a'.repeat(64) });
  });

  it('matches IPv4-mapped IPv6 values against IPv4 rules', async () => {
    expect(
      (
        await request(buildApp(['10.0.0.0/8']))
          .post('/mcp')
          .set(HEADER, '::ffff:10.1.2.3')
      ).status,
    ).toBe(200);
    expect(
      (
        await request(buildApp(['10.0.0.0/8']))
          .post('/mcp')
          .set(HEADER, '::ffff:11.1.2.3')
      ).status,
    ).toBe(403);
  });

  it('matches IPv6 ranges, and an IPv4-only list refuses IPv6', async () => {
    expect(
      (
        await request(buildApp(['2001:db8::/32']))
          .post('/mcp')
          .set(HEADER, '2001:db8:1::5')
      ).status,
    ).toBe(200);
    expect(
      (
        await request(buildApp(['2001:db8::/32']))
          .post('/mcp')
          .set(HEADER, '2001:db9::1')
      ).status,
    ).toBe(403);
    expect(
      (
        await request(buildApp(['0.0.0.0/0']))
          .post('/mcp')
          .set(HEADER, '2001:db8::1')
      ).status,
    ).toBe(403);
    expect(rejections().map((event) => event.reason)).toEqual(['not_allowed', 'not_allowed']);
  });

  it('accepts a CIDR with host bits set as the whole network', async () => {
    expect(
      (
        await request(buildApp(['10.0.0.5/8']))
          .post('/mcp')
          .set(HEADER, '10.200.0.1')
      ).status,
    ).toBe(200);
  });

  it('never consults X-Forwarded-For', async () => {
    const app = buildApp([ALLOWED]);
    const absent = await request(app).post('/mcp').set('X-Forwarded-For', ALLOWED);
    const denied = await request(app).post('/mcp').set('X-Forwarded-For', ALLOWED).set(HEADER, DENIED);
    expect(absent.status).toBe(403);
    expect(denied.status).toBe(403);
    expect(rejections().map((event) => event.reason)).toEqual(['missing_header', 'not_allowed']);
  });

  it('exempts exactly /health', async () => {
    const app = buildApp([ALLOWED]);
    expect((await request(app).get('/health')).status).toBe(200);
    expect((await request(app).get('/health?probe=1').set(HEADER, DENIED)).status).toBe(200);
    expect(rejections()).toEqual([]);
    for (const path of ['/health/', '/healthz', '/health/x', '/HEALTH', '/%68ealth']) {
      expect((await request(app).get(path)).status, path).toBe(403);
    }
  });

  it('refuses a CORS preflight from a disallowed address before CORS answers it', async () => {
    const app = buildApp([ALLOWED], ['https://app.example.com']);
    const preflight = (address: string) =>
      request(app)
        .options('/mcp')
        .set(HEADER, address)
        .set('Origin', 'https://app.example.com')
        .set('Access-Control-Request-Method', 'POST');
    const denied = await preflight(DENIED);
    expect(denied.status).toBe(403);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    const allowed = await preflight(ALLOWED);
    expect(allowed.status).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example.com');
  });
});

const XSUAA: XsuaaCredentials = {
  url: 'https://tenant.authentication.example.test',
  clientid: 'arc1-allowlist-client',
  clientsecret: 'allowlist-client-secret-with-enough-entropy',
  xsappname: 'arc1-allowlist!t1',
  uaadomain: 'authentication.example.test',
};

function registry() {
  const url = canonicalDestinationUrl('http://a4h.internal:50000') as string;
  return DestinationRegistry.fromDiscovery(
    {
      subaccount: [
        {
          name: 'ARC1_A4H_100_PP',
          type: 'HTTP',
          urlState: 'valid',
          urlFingerprint: opaqueDestinationValue(url),
          authentication: 'PrincipalPropagation',
          proxyType: 'OnPremise',
          sapSysId: 'A4H',
          sapClient: '100',
          description: 'A4H development',
          hasCloudConnectorLocationId: false,
          arcProperties: { 'arc1.enabled': 'true' },
        },
      ],
      instanceNames: [],
      scannedCount: 1,
      unrelatedCount: 0,
      arcAdjacentWithoutMarkerCount: 0,
    },
    DEFAULT_CONFIG,
  );
}

describe('client IP allowlist in startHttpServer', () => {
  const KEY = 'allowlist-viewer-key';
  let app: express.Express;
  let listenSpy: ReturnType<typeof vi.spyOn>;
  let serverFactory: ReturnType<typeof vi.fn>;
  let aggregateFactory: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    listenSpy = vi.spyOn(express.application, 'listen').mockImplementation(function (this: express.Express) {
      app = this;
      return new EventEmitter() as never;
    });
    serverFactory = vi.fn(() => new Server({ name: 'allowlist-test', version: '1' }, { capabilities: {} }));
    aggregateFactory = vi.fn(() => {
      throw new Error('sentinel: aggregate handler reached');
    });
    await startHttpServer(
      serverFactory as never,
      {
        ...DEFAULT_CONFIG,
        transport: 'http-streamable',
        httpAddr: '127.0.0.1:0',
        xsuaaAuth: true,
        multiTargetEndpoints: true,
        apiKeys: [{ key: KEY, profile: 'viewer' }],
        allowedClientIps: [ALLOWED],
        authRateLimit: 0,
        mcpHttpRateLimit: 0,
      },
      XSUAA,
      undefined,
      {
        registry: registry(),
        authorizationMode: 'standard',
        aggregateFactory: aggregateFactory as never,
        createPinnedServer: vi.fn() as never,
      },
    );
  });

  afterEach(() => {
    listenSpy.mockRestore();
  });

  const initialize = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
  };

  it('refuses every MCP route from a disallowed address, even with a valid API key', async () => {
    const auth = `Bearer ${KEY}`;
    const responses = [
      await request(app).post('/mcp').set(HEADER, DENIED).set('Authorization', auth).send(initialize),
      await request(app).get('/mcp').set(HEADER, DENIED).set('Authorization', auth),
      await request(app).delete('/mcp').set(HEADER, DENIED).set('Authorization', auth),
      await request(app).post('/mcp').set('Authorization', auth).send(initialize),
      await request(app).post('/A4H/100/mcp').set(HEADER, DENIED).send(initialize),
      await request(app).post('/multi/mcp').set(HEADER, DENIED).send(initialize),
    ];
    expect(responses.map((res) => res.status)).toEqual([403, 403, 403, 403, 403, 403]);
    expect(serverFactory).not.toHaveBeenCalled();
    expect(aggregateFactory).not.toHaveBeenCalled();
  });

  it('refuses OAuth endpoints and metadata from a disallowed address', async () => {
    const responses = [
      await request(app).get('/.well-known/oauth-authorization-server').set(HEADER, DENIED),
      await request(app).get('/.well-known/oauth-protected-resource/mcp').set(HEADER, DENIED),
      await request(app).get('/.well-known/oauth-protected-resource/A4H/100/mcp').set(HEADER, DENIED),
      await request(app)
        .post('/register')
        .set(HEADER, DENIED)
        .send({ redirect_uris: ['http://localhost/cb'] }),
      await request(app).get('/authorize').set(HEADER, DENIED),
      await request(app).post('/token').set(HEADER, DENIED).type('form').send('grant_type=authorization_code'),
      await request(app).post('/revoke').set(HEADER, DENIED).type('form').send('token=x'),
      await request(app).get('/oauth/callback').set(HEADER, DENIED),
    ];
    expect(responses.map((res) => res.status)).toEqual([403, 403, 403, 403, 403, 403, 403, 403]);
  });

  it('refuses before body parsing', async () => {
    const res = await request(app)
      .post('/mcp')
      .set(HEADER, DENIED)
      .set('Content-Type', 'application/json')
      .send('{not json');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  it('leaves authentication in place for an allowed address', async () => {
    expect((await request(app).post('/mcp').set(HEADER, ALLOWED).send(initialize)).status).toBe(401);
    expect((await request(app).post('/multi/mcp').set(HEADER, ALLOWED).send(initialize)).status).toBe(401);
    expect((await request(app).get('/.well-known/oauth-authorization-server').set(HEADER, ALLOWED)).status).toBe(200);
    expect((await request(app).get('/health')).status).toBe(200);

    const ok = await request(app)
      .post('/mcp')
      .set(HEADER, ALLOWED)
      .set('Authorization', `Bearer ${KEY}`)
      .set('Accept', 'application/json, text/event-stream')
      .send(initialize);
    expect(ok.status).toBe(200);
    expect(serverFactory).toHaveBeenCalled();
  });
});
