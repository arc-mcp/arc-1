import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { createUiApiRouter, mountUiRoutes, mountUiStaticRoutes, type UiServerDeps } from '../../../src/server/ui.js';
import { UiLogBufferSink } from '../../../src/server/ui-log-buffer.js';

function defaultUiDeps(deps: Partial<UiServerDeps> = {}): UiServerDeps {
  return {
    config: { ...DEFAULT_CONFIG },
    sources: {},
    version: '0.0.0-test',
    startedAt: '2026-01-01T00:00:00.000Z',
    getFeatures: () => undefined,
    ...deps,
  };
}

function buildApp(deps: Partial<UiServerDeps> = {}) {
  const app = express();
  app.use('/ui/api', createUiApiRouter(defaultUiDeps(deps)));
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

  it('protects static assets and API routes when auth middleware is mounted', async () => {
    const app = express();
    mountUiRoutes(app, defaultUiDeps(), (req, res, next) => {
      if (req.header('authorization') !== 'Bearer admin-token') {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      next();
    });

    expect((await request(app).get('/ui/')).status).toBe(401);
    expect((await request(app).get('/ui/cache')).status).toBe(401);
    expect((await request(app).get('/ui/api/overview')).status).toBe(401);

    const index = await request(app).get('/ui/').set('Authorization', 'Bearer admin-token');
    const fallback = await request(app).get('/ui/cache').set('Authorization', 'Bearer admin-token');
    const api = await request(app).get('/ui/api/overview').set('Authorization', 'Bearer admin-token');

    expect(index.status).toBe(200);
    expect(index.text).toContain('ARC-1 Console');
    expect(fallback.status).toBe(200);
    expect(fallback.text).toContain('ARC-1 Console');
    expect(api.status).toBe(200);
    expect(api.body.app.name).toBe('ARC-1');
  });

  it('returns overview runtime state', async () => {
    const res = await request(buildApp()).get('/ui/api/overview');

    expect(res.status).toBe(200);
    expect(res.body.app.name).toBe('ARC-1');
    expect(res.body.app.version).toBe('0.0.0-test');
    expect(res.body.transport.uiMode).toBe('off');
  });

  it('does not report a cache file for auto mode', async () => {
    const config = {
      ...DEFAULT_CONFIG,
      cacheMode: 'auto' as const,
      cacheFile: '/tmp/arc1-cache.db',
    };

    const overview = await request(buildApp({ config })).get('/ui/api/overview');
    const sanitized = await request(buildApp({ config })).get('/ui/api/config');

    expect(overview.status).toBe(200);
    expect(overview.body.cache.mode).toBe('auto');
    expect(overview.body.cache).not.toHaveProperty('file');
    expect(overview.body.cache).not.toHaveProperty('warmup');
    expect(overview.body.cache).not.toHaveProperty('warmupPackages');
    expect(sanitized.status).toBe(200);
    expect(sanitized.body.config.cache.mode).toBe('auto');
    expect(sanitized.body.config.cache).not.toHaveProperty('file');
    expect(sanitized.body.config.cache).not.toHaveProperty('warmup');
    expect(sanitized.body.config.cache).not.toHaveProperty('warmupPackages');
  });

  it('reports a cache file only for explicit SQLite mode', async () => {
    const config = {
      ...DEFAULT_CONFIG,
      cacheMode: 'sqlite' as const,
      cacheFile: '/tmp/arc1-cache.db',
    };

    const overview = await request(buildApp({ config })).get('/ui/api/overview');
    const sanitized = await request(buildApp({ config })).get('/ui/api/config');

    expect(overview.status).toBe(200);
    expect(overview.body.cache.file).toBe('/tmp/arc1-cache.db');
    expect(sanitized.status).toBe(200);
    expect(sanitized.body.config.cache.file).toBe('/tmp/arc1-cache.db');
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
          hana: {
            id: 'hana',
            available: true,
            mode: 'auto',
            message: 'available',
            secretProbeToken: 'should-not-leak',
          },
          discoveryMap: new Map([['/sap/bc/adt', 'application/xml']]),
          internalSecret: 'should-not-leak',
        }),
      }),
    ).get('/ui/api/features');

    expect(res.status).toBe(200);
    expect(res.body.hana).toEqual({ id: 'hana', available: true, mode: 'auto', message: 'available' });
    expect(res.body.abapRelease).toBe('758');
    expect(res.body.discovery).toEqual({ endpointCount: 1 });
    expect(res.body.discoveryMap).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('should-not-leak');
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

  it('returns cache backend, source summary, and recent activity', async () => {
    const cachingLayer = new CachingLayer(new MemoryCache());
    await cachingLayer.getSource('CLAS', 'ZCL_ALPHA', async () => ({
      source: 'CLASS zcl_alpha DEFINITION.',
      etag: 'abc',
      notModified: false,
      statusCode: 200,
    }));
    cachingLayer.invalidate('CLAS', 'ZCL_ALPHA');

    const res = await request(buildApp({ cachingLayer })).get('/ui/api/cache/stats');

    expect(res.status).toBe(200);
    expect(res.body.backend).toMatchObject({ effective: 'memory', persistent: false, ephemeral: true });
    expect(res.body).not.toHaveProperty('warmup');
    expect(res.body).not.toHaveProperty('warmupAvailable');
    expect(res.body.stats).not.toHaveProperty('nodeCount');
    expect(res.body.stats).not.toHaveProperty('edgeCount');
    expect(res.body.sources).toMatchObject({
      total: 0,
      byType: {},
      byVersion: {},
    });
    expect(res.body.activity.counts).toMatchObject({ source_miss: 1, source_store: 1, source_invalidate: 1 });
    expect(res.body.activity.items[0]).toMatchObject({
      event: 'source_invalidate',
      objectType: 'CLAS',
      objectName: 'ZCL_ALPHA',
      removed: 1,
    });
    expect(res.body.activity.items[1]).toMatchObject({
      event: 'source_store',
      objectType: 'CLAS',
      objectName: 'ZCL_ALPHA',
      sourceLength: 'CLASS zcl_alpha DEFINITION.'.length,
      detail: 'loaded from SAP',
    });
    expect(res.body.activity.items[2]).toMatchObject({
      event: 'source_miss',
      objectType: 'CLAS',
      objectName: 'ZCL_ALPHA',
      detail: 'no cached source entry',
    });
    expect(JSON.stringify(res.body)).not.toContain('CLASS zcl_alpha');
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

  it('redacts cache activity object details when principal propagation is enabled', async () => {
    const cachingLayer = new CachingLayer(new MemoryCache());
    await cachingLayer.getSource('CLAS', 'ZCL_SECRET', async () => ({
      source: 'CLASS zcl_secret DEFINITION.',
      etag: 'abc',
      notModified: false,
      statusCode: 200,
    }));
    cachingLayer.invalidate('CLAS', 'ZCL_SECRET');

    const res = await request(
      buildApp({
        config: { ...DEFAULT_CONFIG, ppEnabled: true },
        cachingLayer,
      }),
    ).get('/ui/api/cache/stats');

    expect(res.status).toBe(200);
    expect(res.body.activity.counts).toMatchObject({ source_miss: 1, source_store: 1, source_invalidate: 1 });
    expect(res.body.activity.items[0]).toMatchObject({ event: 'source_invalidate', removed: 1 });
    expect(res.body.activity.items[1]).toMatchObject({ event: 'source_store', detail: 'loaded from SAP' });
    expect(res.body.activity.items[2]).toMatchObject({ event: 'source_miss', detail: 'no cached source entry' });
    expect(res.body.activity.items[0]).not.toHaveProperty('objectName');
    expect(res.body.activity.items[0]).not.toHaveProperty('hash');
    expect(res.body.activity.items[1]).not.toHaveProperty('objectName');
    expect(res.body.activity.items[1]).not.toHaveProperty('hash');
    expect(res.body.activity.items[2]).not.toHaveProperty('objectName');
    expect(JSON.stringify(res.body)).not.toContain('ZCL_SECRET');
    expect(JSON.stringify(res.body)).not.toContain('CLASS zcl_secret');
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

  it('links documentation to the published docs site, not GitHub source files', async () => {
    const res = await request(buildApp()).get('/ui/api/docs');

    expect(res.status).toBe(200);
    expect(res.body.links).toEqual(
      expect.arrayContaining([
        {
          label: 'Configuration reference',
          href: 'https://docs.arc-1-mcp.com/configuration-reference/',
        },
        {
          label: 'BTP Cloud Foundry deployment',
          href: 'https://docs.arc-1-mcp.com/btp-cloud-foundry-deployment/',
        },
      ]),
    );
    const hrefs = res.body.links.map((link: { href: string }) => link.href).join(' ');
    expect(hrefs).not.toContain('github.com');
    expect(hrefs).not.toContain('docs_page');
    expect(hrefs).not.toContain('.md');
  });

  it('uses real default values for UI filter inputs', async () => {
    const appJs = await readFile(resolve('public/ui/app.js'), 'utf8');
    const styles = await readFile(resolve('public/ui/styles.css'), 'utf8');

    expect(appJs).toContain("labeledInput('log-event', 'Event', 'tool_call_end')");
    expect(appJs).toContain('input.value = defaultValue;');
    expect(appJs).toContain('window.setInterval(refreshActiveTab, 5000)');
    expect(appJs).toContain('preserveScroll');
    expect(appJs).toContain('Safety Posture');
    expect(appJs).toContain('Authentication');
    expect(appJs).toContain('Configuration Summary');
    expect(appJs).toContain('Feature Availability');
    expect(appJs).toContain('Log Overview');
    expect(appJs).toContain('HTTP Status Codes');
    expect(appJs).toContain('SAP loads');
    expect(appJs).toContain('source_store');
    expect(appJs).toContain('barChart');
    expect(appJs).toContain('detailChips');
    expect(styles).toContain('.chart-grid');
    expect(styles).toContain('.status-grid');
    expect(styles).toContain('.metric.ok');
    expect(styles).toContain('.detail-chip');
    expect(styles).toContain('overflow-wrap: anywhere');
  });

  it('rejects non-GET methods', async () => {
    const res = await request(buildApp()).post('/ui/api/config').send({});

    expect(res.status).toBe(405);
  });
});
