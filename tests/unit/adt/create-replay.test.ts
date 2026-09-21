import { once } from 'node:events';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { createObject, initClassInclude } from '../../../src/adt/crud.js';
import { addTileToGroup, createCatalog, createGroup, createTile } from '../../../src/adt/flp.js';
import { AdtHttpClient } from '../../../src/adt/http.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { createServerDrivenObject } from '../../../src/adt/server-driven.js';
import { createTransport, createTransportWithTarget } from '../../../src/adt/transport.js';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { handleToolCall } from '../../../src/handlers/dispatch.js';
import { resetCachedFeatures } from '../../../src/handlers/feature-cache.js';
import { logger } from '../../../src/server/logger.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

const safety = unrestrictedSafetyConfig();
const operations = [
  {
    name: 'repository object',
    run: (http: AdtHttpClient) => createObject(http, safety, '/sap/bc/adt/ddic/srvd/sources', '<srvd/>'),
  },
  {
    name: 'server-driven object',
    run: (http: AdtHttpClient) =>
      createServerDrivenObject(http, safety, 'DSFD', 'ZTEST', { package: '$TMP', description: 'test' }),
  },
  {
    name: 'class include',
    run: (http: AdtHttpClient) =>
      initClassInclude(http, safety, '/sap/bc/adt/oo/classes/ztest/includes/testclasses', 'LOCK'),
  },
  { name: 'FLP catalog', run: (http: AdtHttpClient) => createCatalog(http, safety, 'ZTEST', 'Test') },
  { name: 'FLP group', run: (http: AdtHttpClient) => createGroup(http, safety, 'ZTEST', 'Test') },
  {
    name: 'FLP catalog tile',
    run: (http: AdtHttpClient) =>
      createTile(http, safety, 'ZTEST', {
        id: 'test',
        title: 'Test',
        semanticObject: 'Test',
        semanticAction: 'display',
      }),
  },
  { name: 'FLP group tile', run: (http: AdtHttpClient) => addTileToGroup(http, safety, 'ZGROUP', 'ZTEST', '1') },
  { name: 'transport', run: (http: AdtHttpClient) => createTransport(http, safety, 'test') },
  {
    name: 'transport with target',
    run: (http: AdtHttpClient) => createTransportWithTarget(http, safety, 'test', 'LOCAL'),
  },
];

type Failure = number | 'disconnect';
async function withSap(
  status: Failure,
  committed: boolean,
  check: (http: AdtHttpClient, state: { posts: number; exists: boolean }, baseUrl: string) => Promise<void>,
) {
  const state = { posts: 0, exists: false };
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) {
      /* Drain the request. */
    }
    if (req.method === 'HEAD') {
      res.setHeader('x-csrf-token', 'T');
      res.end();
      return;
    }
    state.posts++;
    if (state.exists) {
      res.writeHead(400);
      res.end('object already exists');
      return;
    }
    state.exists = committed;
    if (status === 'disconnect') {
      res.destroy();
      return;
    }
    res.writeHead(status, { 'retry-after': '0' });
    res.end('<error>database connection is not open</error>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Expected TCP address');
  try {
    await check(
      new AdtHttpClient({ baseUrl: `http://127.0.0.1:${address.port}` }),
      state,
      `http://127.0.0.1:${address.port}`,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

afterEach(() => {
  resetCachedFeatures();
  vi.restoreAllMocks();
});

describe('create replay over the real HTTP transport', () => {
  it.each(operations)('does not repeat a committed $name after a lost success response', async ({ run }) => {
    await withSap(503, true, async (http, state) => {
      await expect(run(http)).rejects.toMatchObject({ statusCode: 503, creationOutcome: 'unknown' });
      expect(state).toEqual({ posts: 1, exists: true });
    });
  });
  it.each<Failure>([429, 500, 502, 504, 'disconnect'])('preserves uncertain creation after %s', async (status) => {
    await withSap(status, true, async (http, state) => {
      await expect(operations[0]!.run(http)).rejects.toMatchObject({
        creationOutcome: 'unknown',
        ...(typeof status === 'number' ? { statusCode: status } : {}),
      });
      expect(state).toEqual({ posts: 1, exists: true });
    });
  });
  it('does not infer absence or replay when a 503 really precedes execution', async () => {
    await withSap(503, false, async (http, state) => {
      await expect(operations[0]!.run(http)).rejects.toMatchObject({ statusCode: 503, creationOutcome: 'unknown' });
      expect(state).toEqual({ posts: 1, exists: false });
    });
  });
});

const config = { ...DEFAULT_CONFIG, username: 'test', systemType: 'onprem' as const, lintBeforeWrite: false };
const createArgs = {
  action: 'create',
  type: 'PROG',
  name: 'ZTEST',
  package: '$TMP',
  source: "REPORT ztest. WRITE 'test'.",
};

describe('create failure guidance', () => {
  it.each<Failure>([500, 'disconnect'])(
    'reports unknown completion after %s without unsafe retry advice',
    async (status) => {
      for (const minimalErrors of [false, true]) {
        await withSap(status, true, async (_http, state, baseUrl) => {
          const client = new AdtClient({ baseUrl, safety });
          const result = await handleToolCall(client, { ...config, minimalErrors }, 'SAPWrite', createArgs);
          const text = result.content[0]?.text ?? '';
          expect(result.isError).toBe(true);
          expect(text).toContain('Create completion is unconfirmed');
          expect(text).toContain('inactive version');
          expect(text).not.toContain('wait 10-30');
          expect(text).not.toContain('rerun the same payload');
          if (minimalErrors) {
            expect(text).toContain('request ID');
            expect(text).not.toContain('database connection');
            if (typeof status === 'number') expect(text).toContain(`status ${status}`);
          }
          expect(state).toEqual({ posts: 1, exists: true });
        });
      }
    },
  );
  it('retains unknown creation in a batch manifest and stops before the next object', async () => {
    await withSap(503, true, async (_http, state, baseUrl) => {
      const client = new AdtClient({ baseUrl, safety });
      const result = await handleToolCall(client, config, 'SAPWrite', {
        action: 'batch_create',
        objects: [createArgs, { ...createArgs, name: 'ZSECOND' }],
      });
      expect(result.isError).toBe(true);
      const manifest = JSON.parse(result.content[1]?.text ?? '{}').batch;
      expect(manifest.creationUnknown).toBe(1);
      expect(manifest.results[0]).toMatchObject({ creation: 'unknown', failedPhase: 'create' });
      expect(manifest.results[1].status).toBe('skipped');
      expect(state).toEqual({ posts: 1, exists: true });
    });
  });
  it('does not send a create when writes are denied', async () => {
    await withSap(503, false, async (http, state) => {
      await expect(createObject(http, { ...safety, allowWrites: false }, '/objects', '<object/>')).rejects.toThrow(
        'allowWrites=false',
      );
      expect(state.posts).toBe(0);
    });
  });
});

describe('rejection and read controls', () => {
  it.each(['csrf', 'auth', 'dtel', 'read', 'read-post'] as const)('preserves %s recovery', async (mode) => {
    let requests = 0;
    let creations = 0;
    const server = createServer(async (req, res) => {
      for await (const _chunk of req) {
        /* Drain the request. */
      }
      res.setHeader('x-csrf-token', 'T');
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      requests++;
      const rejected = mode === 'dtel' ? !req.headers['content-type']?.includes('dataelements.v1+xml') : requests === 1;
      if (rejected) {
        res.writeHead(mode === 'csrf' ? 403 : mode === 'auth' ? 401 : mode === 'dtel' ? 415 : 503, {
          'retry-after': '0',
        });
        res.end('Rejected before execution');
        return;
      }
      if (mode !== 'read' && mode !== 'read-post') creations++;
      res.end('success');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('Expected TCP address');
    const http = new AdtHttpClient({ baseUrl: `http://127.0.0.1:${address.port}` });
    try {
      if (mode === 'read') expect((await http.get('/metadata')).body).toBe('success');
      else if (mode === 'read-post')
        expect((await http.post('/sap/bc/adt/repository/informationsystem/usageReferences', '<read/>')).body).toBe(
          'success',
        );
      else
        expect(
          await createObject(
            http,
            safety,
            '/sap/bc/adt/ddic/dataelements',
            '<dtel/>',
            'application/vnd.sap.adt.dataelements.v2+xml',
          ),
        ).toBe('success');
      expect(requests).toBe(mode === 'dtel' ? 3 : 2);
      expect(creations).toBe(mode === 'read' || mode === 'read-post' ? 0 : 1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

it.each(['PROG', 'PROG/P'])(
  'invalidates canonical source and inactive-list caches after uncertain %s creation',
  async (type) => {
    await withSap(503, true, async (_http, state, baseUrl) => {
      const client = new AdtClient({ baseUrl, username: 'test', safety });
      const cache = new CachingLayer(new MemoryCache());
      const invalidateSource = vi.spyOn(cache, 'invalidate');
      const inactive = vi.spyOn(client, 'getInactiveObjects').mockResolvedValue([]);
      await cache.inactiveLists.getOrFetch(client);
      inactive.mockRestore();
      expect(cache.inactiveLists.getCached('test')).toEqual([]);
      const result = await handleToolCall(
        client,
        config,
        'SAPWrite',
        { ...createArgs, type },
        undefined,
        undefined,
        cache,
      );
      expect(result.isError).toBe(true);
      expect(invalidateSource).toHaveBeenCalledWith('PROG', 'ZTEST', 'all');
      expect(cache.inactiveLists.getCached('test')).toBeNull();
      expect(state.posts).toBe(1);
    });
  },
);

it('keeps an ordinary rejected create distinct from unknown completion', async () => {
  await withSap(400, false, async (http, state) => {
    try {
      await operations[0]!.run(http);
      throw Error('Expected rejection');
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 400 });
      expect(error).not.toHaveProperty('creationOutcome', 'unknown');
    }
    expect(state).toEqual({ posts: 1, exists: false });
  });
});

it('directs uncertain transport creation to request inspection', async () => {
  await withSap(503, true, async (_http, state, baseUrl) => {
    const result = await handleToolCall(
      new AdtClient({ baseUrl, safety }),
      { ...config, minimalErrors: true },
      'SAPTransport',
      {
        action: 'create',
        description: 'Disposable test',
      },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('status 503');
    expect(result.content[0]?.text).toContain('Use SAPTransport to list requests');
    expect(state.posts).toBe(1);
  });
});

it('preserves uncertain-create guidance and the final audit when source-cache cleanup throws', async () => {
  await withSap(503, true, async (_http, state, baseUrl) => {
    const client = new AdtClient({ baseUrl, username: 'test', safety });
    const cache = new CachingLayer(new MemoryCache());
    vi.spyOn(cache, 'invalidate').mockImplementation(() => {
      throw new Error('SQLITE_BUSY: database is locked');
    });
    const inactive = vi.spyOn(client, 'getInactiveObjects').mockResolvedValue([]);
    await cache.inactiveLists.getOrFetch(client);
    inactive.mockRestore();
    const audit = vi.spyOn(logger, 'emitAudit');
    const result = await handleToolCall(client, config, 'SAPWrite', createArgs, undefined, undefined, cache);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Create completion is unconfirmed');
    expect(result.content[0]?.text).not.toContain('SQLITE_BUSY');
    expect(cache.inactiveLists.getCached('test')).toBeNull();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ event: 'tool_call_end', status: 'error' }));
    expect(state.posts).toBe(1);
  });
});

it('reports uncertain FLP creation with catalog and group inspection guidance', async () => {
  await withSap(503, true, async (_http, state, baseUrl) => {
    const result = await handleToolCall(
      new AdtClient({ baseUrl, safety }),
      { ...config, minimalErrors: true },
      'SAPManage',
      {
        action: 'flp_create_tile',
        catalogId: 'ZTEST',
        tile: { id: 'test', title: 'Test', semanticObject: 'Test', semanticAction: 'display' },
      },
    );
    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('Create completion is unconfirmed');
    expect(text).toContain('flp_list_tiles');
    expect(text).toContain('group membership');
    expect(text).not.toContain('SAPRead/SAPSearch');
    expect(text).not.toContain('overwrite');
    expect(text).toContain('status 503');
    expect(text).toContain('ARC1_MINIMAL_ERRORS=true');
    expect(text).not.toContain('database connection');
    expect(state.posts).toBe(1);
  });
});
