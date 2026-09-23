import { EventEmitter } from 'node:events';
import type { XsuaaCredentials } from '@arc-mcp/xsuaa-auth';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
      const scopes =
        token === 'admin-token'
          ? ['read', 'admin']
          : token === 'read-token'
            ? ['read']
            : token === 'data-token'
              ? ['data']
              : undefined;
      if (!scopes) throw new InvalidTokenError('Not an XSUAA token');
      return {
        token,
        clientId: 'http-multi-target-test',
        scopes,
        expiresAt: Math.floor(Date.now() / 1000) + 3_600,
        extra: { userName: 'HTTP_TEST_USER' },
      };
    }),
  };
});

const XSUAA: XsuaaCredentials = {
  url: 'https://tenant.authentication.example.test',
  clientid: 'arc1-test-client',
  clientsecret: 'test-client-secret-with-enough-entropy',
  xsappname: 'arc1-test!t1',
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
        {
          name: 'ARC1_A4H_2025_100_PP',
          type: 'HTTP',
          urlState: 'valid',
          urlFingerprint: opaqueDestinationValue(`${url}/2025`),
          authentication: 'PrincipalPropagation',
          proxyType: 'OnPremise',
          sapSysId: 'A4H',
          sapClient: '100',
          description: 'A4H 2025',
          hasCloudConnectorLocationId: false,
          arcProperties: { 'arc1.enabled': 'true', 'arc1.target_alias': 'A4H-2025' },
        },
        {
          name: 'ARC1_INVALID_PP',
          type: 'HTTP',
          urlState: 'valid',
          urlFingerprint: opaqueDestinationValue(`${url}/invalid`),
          authentication: 'PrincipalPropagation',
          proxyType: 'OnPremise',
          sapSysId: 'bad',
          sapClient: '100',
          description: 'Invalid target',
          hasCloudConnectorLocationId: false,
          arcProperties: { 'arc1.enabled': 'true' },
        },
      ],
      instanceNames: [],
      scannedCount: 3,
      unrelatedCount: 0,
      arcAdjacentWithoutMarkerCount: 0,
    },
    DEFAULT_CONFIG,
  );
}

describe('multi-target HTTP route authentication', () => {
  let app: express.Express;
  let listenSpy: ReturnType<typeof vi.spyOn>;
  let aggregateFactory: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    listenSpy = vi.spyOn(express.application, 'listen').mockImplementation(function (this: express.Express) {
      app = this;
      return new EventEmitter() as never;
    });
    aggregateFactory = vi.fn(() => ({
      connect: vi.fn(async () => {
        throw new Error('sentinel: aggregate handler reached');
      }),
    }));
    const current = registry();
    await startHttpServer(
      undefined,
      {
        ...DEFAULT_CONFIG,
        transport: 'http-streamable',
        httpAddr: '127.0.0.1:0',
        xsuaaAuth: true,
        multiTargetEndpoints: true,
        apiKeys: [{ key: 'legacy-viewer-key', profile: 'viewer' }],
        authRateLimit: 0,
        mcpHttpRateLimit: 0,
      },
      XSUAA,
      undefined,
      {
        registry: current,
        aggregateFactory: aggregateFactory as never,
        createPinnedServer: vi.fn() as never,
      },
    );
  });

  afterEach(() => {
    listenSpy.mockRestore();
  });

  it('authenticates syntactically valid target routes before revealing route membership', async () => {
    const known = await request(app).post('/A4H/100/mcp');
    const knownAlias = await request(app).post('/A4H-2025/100/mcp');
    const unknown = await request(app).post('/ZZZ/999/mcp');
    const unknownAlias = await request(app).post('/ZZZ-2025/999/mcp');

    expect(known.status).toBe(401);
    expect(knownAlias.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknownAlias.status).toBe(401);
    expect(known.body).toEqual(unknown.body);
    expect(knownAlias.body).toEqual(unknownAlias.body);
    expect(known.headers['www-authenticate']).toContain('/.well-known/oauth-protected-resource/A4H/100/mcp');
    expect(knownAlias.headers['www-authenticate']).toContain('/.well-known/oauth-protected-resource/A4H-2025/100/mcp');
    expect(unknown.headers['www-authenticate']).toContain('/.well-known/oauth-protected-resource/ZZZ/999/mcp');
    expect(known.headers['www-authenticate']).not.toContain('scope=');

    const authenticatedWithoutRead = await request(app).post('/ZZZ/999/mcp').set('Authorization', 'Bearer data-token');
    expect(authenticatedWithoutRead.status).toBe(403);
    expect(authenticatedWithoutRead.headers['www-authenticate']).toContain('error="insufficient_scope"');
    expect(authenticatedWithoutRead.headers['www-authenticate']).toContain('scope="read"');

    const authenticatedUnknown = await request(app).post('/ZZZ/999/mcp').set('Authorization', 'Bearer read-token');
    expect(authenticatedUnknown.status).toBe(404);
    expect(authenticatedUnknown.body).toEqual({ error: 'Not found' });

    const authenticatedUnknownAlias = await request(app)
      .post('/ZZZ-2025/999/mcp')
      .set('Authorization', 'Bearer read-token');
    expect(authenticatedUnknownAlias.status).toBe(404);
    expect(authenticatedUnknownAlias.body).toEqual({ error: 'Not found' });

    const malformed = await request(app).post('/a4h/100/mcp');
    expect(malformed.status).toBe(404);
  });

  it('serves registry-independent protected-resource metadata for alias routes', async () => {
    const known = await request(app).get('/.well-known/oauth-protected-resource/A4H-2025/100/mcp');
    const unknown = await request(app).get('/.well-known/oauth-protected-resource/ZZZ-2025/999/mcp');

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body.resource).toBe('http://127.0.0.1:0/A4H-2025/100/mcp');
    expect(unknown.body.resource).toBe('http://127.0.0.1:0/ZZZ-2025/999/mcp');
    expect({ ...known.body, resource: undefined }).toEqual({ ...unknown.body, resource: undefined });
  });

  it('advertises all mutation-free scopes without forcing the initial grant to read only', async () => {
    const aggregateMetadata = await request(app).get('/.well-known/oauth-protected-resource/multi/mcp');
    expect(aggregateMetadata.status).toBe(200);
    expect(aggregateMetadata.body.scopes_supported).toEqual(['read', 'data', 'sql', 'admin']);

    const challenge = await request(app).post('/multi/mcp');
    expect(challenge.status).toBe(401);
    expect(challenge.headers['www-authenticate']).toContain('/.well-known/oauth-protected-resource/multi/mcp');
    expect(challenge.headers['www-authenticate']).not.toContain('scope=');
  });

  it('does not expose a separate HTTP target catalog', async () => {
    expect((await request(app).get('/targets')).status).toBe(404);
    expect((await request(app).get('/targets').set('Authorization', 'Bearer read-token')).status).toBe(404);
    expect((await request(app).get('/TARGETS').set('Authorization', 'Bearer admin-token')).status).toBe(404);
  });

  it('keeps the multi-only Copilot /authorize fallback XSUAA-only', async () => {
    const apiKey = await request(app)
      .post('/authorize')
      .set('Authorization', 'Bearer legacy-viewer-key')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(apiKey.status).toBe(401);
    expect(apiKey.headers['www-authenticate']).toContain('/.well-known/oauth-protected-resource/multi/mcp');
    expect(aggregateFactory).not.toHaveBeenCalled();

    const xsuaa = await request(app)
      .post('/authorize')
      .set('Authorization', 'Bearer read-token')
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(xsuaa.status).not.toBe(401);
    expect(aggregateFactory).toHaveBeenCalledTimes(1);
  });

  it('routes the side-by-side Copilot /authorize alias to the mutation-free aggregate server', async () => {
    const singleFactory = vi.fn(() => ({
      connect: vi.fn(async () => {
        throw new Error('sentinel: single-target handler reached');
      }),
    }));
    const current = registry();
    await startHttpServer(
      singleFactory as never,
      {
        ...DEFAULT_CONFIG,
        transport: 'http-streamable',
        httpAddr: '127.0.0.1:0',
        xsuaaAuth: true,
        multiTargetEndpoints: true,
        apiKeys: [{ key: 'legacy-viewer-key', profile: 'viewer' }],
        authRateLimit: 0,
        mcpHttpRateLimit: 0,
      },
      XSUAA,
      undefined,
      {
        registry: current,
        aggregateFactory: aggregateFactory as never,
        createPinnedServer: vi.fn() as never,
      },
    );

    const apiKey = await request(app)
      .post('/authorize')
      .set('Authorization', 'Bearer legacy-viewer-key')
      .send({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    expect(apiKey.status).toBe(401);
    expect(apiKey.headers['www-authenticate']).toContain('/.well-known/oauth-protected-resource/multi/mcp');
    expect(singleFactory).not.toHaveBeenCalled();
    expect(aggregateFactory).not.toHaveBeenCalled();

    const xsuaa = await request(app)
      .post('/authorize')
      .set('Authorization', 'Bearer read-token')
      .send({ jsonrpc: '2.0', id: 4, method: 'tools/list' });
    expect(xsuaa.status).not.toBe(401);
    expect(aggregateFactory).toHaveBeenCalledTimes(1);
    expect(singleFactory).not.toHaveBeenCalled();
  });
});
