import { EventEmitter } from 'node:events';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHttpServer } from '../../../src/server/http.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

const ISSUER = 'https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0';

/**
 * Boot the real HTTP server without binding a port (listen is stubbed) and hand
 * the Express app to supertest — same harness as http-multi-target-routes.test.ts.
 */
async function boot(overrides: Partial<typeof DEFAULT_CONFIG>, publicUrl?: string): Promise<express.Express> {
  if (publicUrl) process.env.ARC1_PUBLIC_URL = publicUrl;
  else process.env.ARC1_PUBLIC_URL = undefined as unknown as string;
  let app!: express.Express;
  const listenSpy = vi.spyOn(express.application, 'listen').mockImplementation(function (this: express.Express) {
    app = this;
    return new EventEmitter() as never;
  });
  try {
    await startHttpServer(
      (() => ({ connect: vi.fn() })) as never,
      {
        ...DEFAULT_CONFIG,
        transport: 'http-streamable',
        httpAddr: '127.0.0.1:0',
        authRateLimit: 0,
        mcpHttpRateLimit: 0,
        ...overrides,
      },
      undefined,
      undefined,
      undefined,
    );
  } finally {
    listenSpy.mockRestore();
  }
  return app;
}

const OIDC = { oidcIssuer: ISSUER, oidcAudience: 'api://arc1-demo' } as const;

describe('OIDC protected-resource metadata (RFC 9728)', () => {
  const originalPublicUrl = process.env.ARC1_PUBLIC_URL;

  beforeEach(() => {
    process.env.ARC1_PUBLIC_URL = undefined as unknown as string;
  });
  afterEach(() => {
    if (originalPublicUrl === undefined) delete process.env.ARC1_PUBLIC_URL;
    else process.env.ARC1_PUBLIC_URL = originalPublicUrl;
  });

  it('serves the document at the RFC 9728 path-insertion URL and at the root fallback', async () => {
    const app = await boot(OIDC, 'https://arc1.example.com');

    for (const path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(200);
      expect(res.body).toEqual({
        resource: 'https://arc1.example.com/mcp',
        authorization_servers: [ISSUER],
        bearer_methods_supported: ['header'],
        resource_name: 'ARC-1 SAP MCP Server',
      });
    }
  });

  it('points the 401 WWW-Authenticate challenge at the metadata URL', async () => {
    const app = await boot(OIDC, 'https://arc1.example.com');

    const missing = await request(app).post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(missing.status).toBe(401);
    expect(missing.headers['www-authenticate']).toContain(
      'resource_metadata="https://arc1.example.com/.well-known/oauth-protected-resource/mcp"',
    );

    const bogus = await request(app).post('/mcp').set('Authorization', 'Bearer a.b.c').send({});
    expect(bogus.status).toBe(401);
    expect(bogus.headers['www-authenticate']).toContain('resource_metadata=');
  });

  it('advertises scopes_supported only when SAP_OIDC_SCOPES is configured', async () => {
    const app = await boot({ ...OIDC, oidcScopes: ['api://arc1-demo/access_as_user'] }, 'https://arc1.example.com');

    const res = await request(app).get('/.well-known/oauth-protected-resource/mcp');
    expect(res.body.scopes_supported).toEqual(['api://arc1-demo/access_as_user']);
  });

  it('emits prefix-aware URLs and also serves the prefixed path when ARC1_PUBLIC_URL has a base path', async () => {
    const app = await boot(OIDC, 'https://gateway.example.com/arc1');

    const root = await request(app).get('/.well-known/oauth-protected-resource/mcp');
    expect(root.body.resource).toBe('https://gateway.example.com/arc1/mcp');

    // A proxy that does NOT strip its base path still finds the document.
    const prefixed = await request(app).get('/.well-known/oauth-protected-resource/arc1/mcp');
    expect(prefixed.status).toBe(200);
    expect(prefixed.body.resource).toBe('https://gateway.example.com/arc1/mcp');

    const unauth = await request(app).post('/mcp').send({});
    expect(unauth.headers['www-authenticate']).toContain(
      'resource_metadata="https://gateway.example.com/arc1/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it('ignores a spoofed Host header — metadata URLs come from config only', async () => {
    const app = await boot(OIDC, 'https://arc1.example.com');

    const res = await request(app).get('/.well-known/oauth-protected-resource/mcp').set('Host', 'evil.example.net');
    expect(res.body.resource).toBe('https://arc1.example.com/mcp');
    expect(res.body.authorization_servers).toEqual([ISSUER]);
  });

  it('serves nothing when the admin opts out with SAP_OIDC_DISCOVERY=false', async () => {
    const app = await boot({ ...OIDC, oidcDiscovery: false }, 'https://arc1.example.com');

    expect((await request(app).get('/.well-known/oauth-protected-resource/mcp')).status).toBe(404);
    expect((await request(app).get('/.well-known/oauth-protected-resource')).status).toBe(404);
    // No pointer either: without a document, MCP clients skip the RFC 8707
    // `resource` parameter — the reason the opt-out exists (Entra AADSTS9010010).
    const unauth = await request(app).post('/mcp').send({});
    expect(unauth.status).toBe(401);
    expect(unauth.headers['www-authenticate']).not.toContain('resource_metadata');
  });

  it('serves nothing in api-key-only mode — there is no authorization server to advertise', async () => {
    const app = await boot({ apiKeys: [{ key: 'viewer-key', profile: 'viewer' }] }, 'https://arc1.example.com');

    expect((await request(app).get('/.well-known/oauth-protected-resource/mcp')).status).toBe(404);
    const unauth = await request(app).post('/mcp').send({});
    expect(unauth.status).toBe(401);
    expect(unauth.headers['www-authenticate']).not.toContain('resource_metadata');
  });
});
