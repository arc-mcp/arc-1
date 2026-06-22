import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { createUiApiRouter, mountUiStaticRoutes, type UiServerDeps } from '../../../src/server/ui.js';
import { UiLogBufferSink } from '../../../src/server/ui-log-buffer.js';

function buildApp(deps: Partial<UiServerDeps> = {}) {
  const app = express();
  const defaultDeps: UiServerDeps = {
    config: { ...DEFAULT_CONFIG },
    sources: {},
    version: '0.0.0-test',
    startedAt: '2026-01-01T00:00:00.000Z',
    getFeatures: () => undefined,
    ...deps,
  };
  app.use('/ui/api', createUiApiRouter(defaultDeps));
  return app;
}

describe('UI API', () => {
  it('redirects /ui exactly but serves /ui/', async () => {
    const app = express();
    mountUiStaticRoutes(app);

    const redirect = await request(app).get('/ui');
    const index = await request(app).get('/ui/');

    expect(redirect.status).toBe(302);
    expect(redirect.headers.location).toBe('/ui/');
    expect(index.status).toBe(200);
    expect(index.text).toContain('ARC-1 Console');
  });

  it('returns overview runtime state', async () => {
    const res = await request(buildApp()).get('/ui/api/overview');

    expect(res.status).toBe(200);
    expect(res.body.app.name).toBe('ARC-1');
    expect(res.body.app.version).toBe('0.0.0-test');
    expect(res.body.transport.uiMode).toBe('off');
  });

  it('sanitizes config secrets', async () => {
    const res = await request(
      buildApp({
        config: {
          ...DEFAULT_CONFIG,
          url: 'https://user:pass@example.com/sap?secret=1',
          username: 'DEVELOPER',
          password: 'secret',
          cookieString: 'MYSAPSSO2=secret',
          apiKeys: [{ key: 'api-secret', profile: 'viewer' }],
          btpServiceKey: '{"clientsecret":"secret"}',
          dcrSigningSecret: 'secret',
        },
      }),
    ).get('/ui/api/config');

    expect(res.status).toBe(200);
    expect(res.body.config.password).toEqual({ configured: true });
    expect(res.body.config.cookieString).toEqual({ configured: true });
    expect(res.body.config.auth.apiKeys).toEqual({ count: 1, profiles: ['viewer'] });
    expect(res.body.config.auth.xsuaa.dcrSigningSecret).toEqual({ configured: true });
    expect(JSON.stringify(res.body)).not.toContain('api-secret');
    expect(JSON.stringify(res.body)).not.toContain('MYSAPSSO2');
    expect(JSON.stringify(res.body)).not.toContain('clientsecret');
  });

  it('returns feature state without serializing discovery maps directly', async () => {
    const res = await request(
      buildApp({
        getFeatures: () => ({
          abapRelease: '758',
          discoveryMap: new Map([['/sap/bc/adt', 'application/xml']]),
        }),
      }),
    ).get('/ui/api/features');

    expect(res.status).toBe(200);
    expect(res.body.discovery).toEqual({ endpointCount: 1 });
    expect(res.body.discoveryMap).toBeUndefined();
  });

  it('lists cache source metadata without source bodies', async () => {
    const cache = new MemoryCache();
    cache.putSource('CLAS', 'ZCL_ALPHA', 'CLASS zcl_alpha DEFINITION.', { etag: 'abc' });
    const cachingLayer = new CachingLayer(cache);

    const res = await request(buildApp({ cachingLayer })).get('/ui/api/cache/sources').query({ objectType: 'CLAS' });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({
      objectType: 'CLAS',
      objectName: 'ZCL_ALPHA',
      etagPresent: true,
      sourceLength: 'CLASS zcl_alpha DEFINITION.'.length,
    });
    expect(res.body.items[0]).not.toHaveProperty('source');
  });

  it('blocks cache source inventory when principal propagation is enabled', async () => {
    const cache = new MemoryCache();
    cache.putSource('CLAS', 'ZCL_ALPHA', 'source');
    const cachingLayer = new CachingLayer(cache);

    const res = await request(
      buildApp({
        config: { ...DEFAULT_CONFIG, ppEnabled: true },
        cachingLayer,
      }),
    ).get('/ui/api/cache/sources');

    expect(res.status).toBe(403);
    expect(res.body.reason).toMatch(/principal propagation/);
  });

  it('returns sanitized audit logs', async () => {
    const logBuffer = new UiLogBufferSink();
    logBuffer.write({
      timestamp: '2026-01-01T00:00:00.000Z',
      level: 'info',
      event: 'tool_call_end',
      tool: 'SAPRead',
      durationMs: 12,
      status: 'success',
      resultPreview: 'source body',
    });

    const res = await request(buildApp({ logBuffer })).get('/ui/api/logs');

    expect(res.status).toBe(200);
    expect(res.body.items[0].event).toBe('tool_call_end');
    expect(res.body.items[0]).not.toHaveProperty('resultPreview');
  });

  it('filters audit logs by event and level', async () => {
    const logBuffer = new UiLogBufferSink();
    logBuffer.write({
      timestamp: '2026-01-01T00:00:00.000Z',
      level: 'debug',
      event: 'http_request',
      method: 'GET',
      path: '/sap/bc/adt/discovery',
      statusCode: 200,
      durationMs: 1,
    });
    logBuffer.write({
      timestamp: '2026-01-01T00:00:01.000Z',
      level: 'info',
      event: 'tool_call_end',
      tool: 'SAPSearch',
      durationMs: 12,
      status: 'success',
      resultSize: 42,
    });

    const res = await request(buildApp({ logBuffer })).get('/ui/api/logs').query({
      event: 'tool_call_end',
      level: 'info',
    });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ event: 'tool_call_end', level: 'info', tool: 'SAPSearch' });
  });

  it('uses real default values for UI filter inputs', async () => {
    const appJs = await readFile(resolve('public/ui/app.js'), 'utf8');

    expect(appJs).toContain("labeledInput('log-event', 'Event', 'tool_call_end')");
    expect(appJs).toContain('input.value = defaultValue;');
  });

  it('rejects non-GET methods', async () => {
    const res = await request(buildApp()).post('/ui/api/config').send({});

    expect(res.status).toBe(405);
  });
});
