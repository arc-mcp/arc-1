/**
 * SAP_XSUAA_AUTH=true must fail closed. A missing or unreadable XSUAA binding used to be logged and
 * skipped, leaving /mcp on the no-auth route ("auth: NONE (open)", unauthenticated tools/list → 200).
 * Boots the real createAndStartServer → startHttpServer chain with `listen` stubbed (no port bound).
 */
import { EventEmitter } from 'node:events';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startHttpServer } from '../../../src/server/http.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';

vi.mock('../../../src/server/shutdown.js', () => ({ registerShutdownHandlers: vi.fn(), closeHttpServer: vi.fn() }));
const { createAndStartServer } = await import('../../../src/server/server.js');

const XSUAA_BINDING = JSON.stringify({
  xsuaa: [
    {
      name: 'arc1-xsuaa',
      label: 'xsuaa',
      tags: ['xsuaa'],
      credentials: {
        url: 'https://tenant.authentication.eu10.hana.ondemand.com',
        clientid: 'sb-arc1!t1',
        clientsecret: 'test-secret',
        xsappname: 'arc1!t1',
        uaadomain: 'authentication.eu10.hana.ondemand.com',
      },
    },
  ],
});
const TOOLS_LIST = { jsonrpc: '2.0', id: 1, method: 'tools/list' };

/** Start ARC-1 over HTTP; resolves to the Express app that would have listened. */
async function start(overrides: Partial<ServerConfig>, vcapServices?: string): Promise<express.Express | undefined> {
  vi.stubEnv('VCAP_SERVICES', vcapServices);
  let app: express.Express | undefined;
  vi.spyOn(express.application, 'listen').mockImplementation(function (this: express.Express) {
    app = this;
    return new EventEmitter() as never;
  });
  await createAndStartServer({
    ...DEFAULT_CONFIG,
    transport: 'http-streamable',
    httpAddr: '127.0.0.1:0',
    cacheMode: 'none',
    authRateLimit: 0,
    mcpHttpRateLimit: 0,
    ...overrides,
  });
  return app;
}

const postMcp = (app: express.Express) =>
  request(app).post('/mcp').set('Accept', 'application/json, text/event-stream').send(TOOLS_LIST);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('SAP_XSUAA_AUTH startup', () => {
  it.each([
    ['no binding', undefined],
    ['malformed VCAP_SERVICES', '{not json'],
    ['binding without credentials', JSON.stringify({ xsuaa: [{ name: 'arc1-xsuaa', tags: ['xsuaa'] }] })],
  ])('refuses to start with %s, even when API keys or the no-auth escape hatch are set', async (_, vcap) => {
    for (const extra of [{}, { apiKeys: [{ key: 'k', profile: 'viewer' as const }] }, { allowHttpNoAuth: true }]) {
      await expect(start({ xsuaaAuth: true, ...extra }, vcap)).rejects.toThrow(
        'SAP_XSUAA_AUTH=true requires a valid bound XSUAA service',
      );
      expect(express.application.listen).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    }
  });

  it('serves /mcp behind the XSUAA bearer check when the binding is valid', async () => {
    const app = await start(
      { xsuaaAuth: true, dcrSigningSecret: 'test-dcr-signing-secret-with-enough-entropy' },
      XSUAA_BINDING,
    );
    expect((await postMcp(app!)).status).toBe(401);
  });

  it('still refuses at the HTTP layer when called without XSUAA credentials', async () => {
    const listen = vi.spyOn(express.application, 'listen').mockImplementation(() => new EventEmitter() as never);
    await expect(
      startHttpServer(undefined, { ...DEFAULT_CONFIG, transport: 'http-streamable', xsuaaAuth: true }),
    ).rejects.toThrow('refusing to start an unauthenticated /mcp');
    expect(listen).not.toHaveBeenCalled();
  });
});

describe('configurations without SAP_XSUAA_AUTH are unaffected', () => {
  it.each([
    ['API keys', { apiKeys: [{ key: 'k', profile: 'viewer' as const }] }],
    ['OIDC', { oidcIssuer: 'https://idp.example.com', oidcAudience: 'arc-1', oidcDiscovery: false }],
  ])('%s: starts without an XSUAA binding and rejects an unauthenticated /mcp', async (_, auth) => {
    const app = await start(auth);
    expect((await postMcp(app!)).status).toBe(401);
  });

  it('ARC1_ALLOW_HTTP_NO_AUTH=true still serves an open /mcp', async () => {
    const app = await start({ allowHttpNoAuth: true });
    expect((await postMcp(app!)).status).toBe(200);
  });
});
