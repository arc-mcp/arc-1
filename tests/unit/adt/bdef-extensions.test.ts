/** Real transport boundaries: actual sends, streamed bytes, cancellation and optional failures. */
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { BDEF_COLLECTION, bdefRelationRoot } from '../../../src/adt/bdef-extension-candidates.js';
import { discoverBdefExtensions } from '../../../src/adt/bdef-extensions.js';
import { AdtClient } from '../../../src/adt/client.js';
import { ExtensionDiscoverySession, renderExtensionDiscovery } from '../../../src/adt/extension-discovery.js';
import { RELATIONS_MIME, RELATIONS_PATH } from '../../../src/adt/repository-relations.js';
import { relationObject, relationXml } from '../../helpers/relation-fixtures.js';

const root = bdefRelationRoot('BASE');
const baseSource = 'define behavior for ENTITY { create; }';
const extension = 'extension implementation in class BP_EXT unique; extend behavior for ENTITY { }';
const discovery = new Map([
  [BDEF_COLLECTION, []],
  [RELATIONS_PATH, [RELATIONS_MIME]],
]);
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }),
  );
});

async function setup(
  opts: {
    count?: number;
    mode?: 'summary' | 'sources';
    source?: string;
    baseSource?: string;
    failAt?: number;
    failAll?: boolean;
    failureBody?: string;
    status?: number;
    wrongContext?: boolean;
    delay?: number;
    deny?: boolean;
    version?: string;
    deadline?: number;
    signal?: AbortSignal;
    release?: string;
    coldDiscovery?: string;
  } = {},
) {
  const candidates = Array.from({ length: opts.count ?? 2 }, (_, i) => relationObject(`EXT${i}`, 'BDEF/BDO'));
  const paths: string[] = [];
  const server = createServer((req, res) => {
    paths.push(req.url!);
    const url = new URL(req.url!, 'http://loopback.invalid');
    if (url.pathname === '/sap/bc/adt/discovery' && opts.coldDiscovery !== undefined) {
      res.end(opts.coldDiscovery);
      return;
    }
    if (url.pathname.includes('/core/discovery')) {
      res.setHeader('x-csrf-token', 'TEST');
      res.end();
      return;
    }
    if (url.pathname === RELATIONS_PATH) {
      res.end(relationXml(root, candidates, opts.wrongContext ? 'ENV' : 'WUL'));
      return;
    }
    const match = /\/ext(\d+)\/source\/main$/.exec(url.pathname);
    if (!match || url.searchParams.get('version') !== 'active') {
      res.writeHead(404).end();
      return;
    }
    const index = Number(match[1]);
    if (opts.failAll || index === opts.failAt) {
      res.writeHead(opts.status ?? 404).end(opts.failureBody ?? 'synthetic source failure');
      return;
    }
    const send = () => {
      if (!res.destroyed) res.end(opts.source ?? extension);
    };
    if (opts.delay) setTimeout(send, opts.delay);
    else send();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected listener');
  const client = new AdtClient({ baseUrl: `http://127.0.0.1:${address.port}` });
  if (opts.deny) client.safety.denyActions = ['SAPRead.BDEF'];
  const request = {
    root: { type: 'BDEF', name: 'BASE', version: opts.version ?? 'active' },
    scope: 'BDEF BASE owning_object',
  };
  const session = new ExtensionDiscoverySession(opts.mode ?? 'sources', request, client.safety, {
    signal: opts.signal,
    deadline: opts.deadline,
  });
  const run = async () => {
    await discoverBdefExtensions(client, session, request, opts.baseSource ?? baseSource, {
      discovery: opts.coldDiscovery === undefined ? discovery : undefined,
      abapRelease: opts.release ?? '758',
    });
    return session.finish();
  };
  return { session, paths, run };
}

describe('bounded BDEF candidate verification', () => {
  it('checks at most two candidates in automatic summary and reports candidate omissions', async () => {
    const { run, paths } = await setup({ mode: 'summary', count: 4 });
    const result = await run();
    expect(result.nodes.map((node) => node.name)).toEqual(['EXT0', 'EXT1']);
    expect(result.omissions.candidates).toBe(2);
    expect(result.providers[0]).toMatchObject({
      coverage: 'candidate_index',
      status: 'incomplete',
      version: 'provider_current',
    });
    expect(result.sources).toEqual([]);
    expect(paths.filter((path) => path.includes('/source/main'))).toHaveLength(2);
    expect(result.consumed.sends).toBeLessThanOrEqual(6);
  });

  it('empty WUL remains an index observation, never an exhaustive absence statement', async () => {
    const { run } = await setup({ count: 0 });
    const result = await run();
    expect(result.nodes).toEqual([]);
    expect(result.providers[0]).toMatchObject({ status: 'returned', coverage: 'candidate_index' });
    expect(result.providers[0]!.reason).toContain('index completeness');
  });

  it('reports an unadvertised cold provider without treating the valid discovery response as malformed', async () => {
    const { run, paths } = await setup({ coldDiscovery: '<service/>' });
    const result = await run();
    expect(result.providers[0]!.status).toBe('not_advertised');
    expect(result.issues).toEqual([]);
    expect(paths).toHaveLength(1);
  });

  it('keeps cold capability discovery within the same summary byte cap', async () => {
    const { run, paths } = await setup({
      mode: 'summary',
      coldDiscovery: `<service>${' '.repeat(130 * 1024)}</service>`,
    });
    const result = await run();
    expect(result.omissions.wire_bytes).toBe(1);
    expect(paths).toHaveLength(1);
    expect(result.nodes).toEqual([]);
  });

  it('excludes a source that only mentions the entity in comments, strings or an ordinary declaration', async () => {
    const { run } = await setup({
      source: "// extend behavior for ENTITY {}\n'extend behavior for ENTITY {}'; define behavior for ENTITY {}",
    });
    expect((await run()).nodes).toEqual([]);
  });

  it('retains independent verified sources after a nonterminal candidate read failure', async () => {
    const { run } = await setup({ failAt: 0 });
    const result = await run();
    expect(result.nodes.map((node) => node.name)).toEqual(['EXT1']);
    expect(result.sources[0]).toMatchObject({ representation: 'authored_source', source: extension });
    expect(result.omissions).toMatchObject({ candidates: 1, sources: 1 });
    expect(result.providers[0]!.status).toBe('incomplete');
  });

  it('reports an unverifiable HTTP 200 source body as partial coverage', async () => {
    const { run } = await setup({ source: '<html>unexpected source response</html>' });
    const result = await run();
    expect(result.nodes).toEqual([]);
    expect(result.providers[0]!.status).toBe('incomplete');
    expect(result.omissions).toMatchObject({ candidates: 2, sources: 2 });
  });

  it.each([401, 403, 429])('stops subsequent candidates after terminal HTTP %s', async (status) => {
    const { run, paths, session } = await setup({ count: 3, failAt: 1, status });
    const result = await run();
    expect(session.stopped).toBe(true);
    expect(result.nodes.map((node) => node.name)).toEqual(['EXT0']);
    expect(paths.some((path) => path.includes('/ext2/'))).toBe(false);
    expect(result.omissions.candidates).toBe(2);
    expect(result.providers[0]!.status).toBe(status === 429 ? 'incomplete' : 'denied');
  });

  it('honors the single actual-send allowance across WUL, CSRF and candidate sources', async () => {
    const { run } = await setup({ count: 30 });
    const result = await run();
    expect(result.consumed.sends).toBe(20);
    expect(result.nodes.length).toBeLessThanOrEqual(20);
    expect(result.omissions.requests).toBe(1);
    expect(result.omissions.candidates).toBe(30 - result.nodes.length);
  });

  it('stops at streamed response bytes without fetching the next candidate', async () => {
    const { run, paths } = await setup({ source: `${extension}\n/*${'x'.repeat(260 * 1024)}*/` });
    const result = await run();
    expect(result.omissions.wire_bytes).toBe(1);
    expect(paths.some((path) => path.includes('/ext1/'))).toBe(false);
    expect(result.nodes).toEqual([]);
  });

  it('charges failed source bodies against one cumulative optional response allowance', async () => {
    const { run, paths } = await setup({
      mode: 'summary',
      count: 3,
      failAll: true,
      failureBody: 'x'.repeat(70 * 1024),
    });
    const result = await run();
    expect(result.omissions.wire_bytes).toBe(1);
    expect(result.consumed.responseBytes).toBeGreaterThanOrEqual(70 * 1024);
    expect(paths.some((path) => path.includes('/ext2/'))).toBe(false);
    expect(result.nodes).toEqual([]);
  });

  it('uses the shared deadline and stops without consuming the next source', async () => {
    const { run, paths } = await setup({ delay: 300, deadline: Date.now() + 80 });
    const result = await run();
    expect(result.omissions.deadline).toBe(1);
    expect(paths.some((path) => path.includes('/ext1/'))).toBe(false);
  });

  it('propagates caller cancellation', async () => {
    const controller = new AbortController();
    const { run } = await setup({ delay: 300, signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    await expect(run()).rejects.toThrow();
  });

  it('rejects a wrong native context before fetching any sources', async () => {
    const { run, paths } = await setup({ wrongContext: true });
    const result = await run();
    expect(result.providers[0]!.status).toBe('incomplete');
    expect(result.issues).toContain('invalid_provider_response');
    expect(paths.some((path) => path.includes('/source/main'))).toBe(false);
  });

  it.each([{ version: 'inactive' }, { release: '750' }, { deny: true }])(
    'does not make hidden reads for %j',
    async (opts) => {
      const { run, paths } = await setup(opts);
      const result = await run();
      expect(paths).toEqual([]);
      expect(result.nodes).toEqual([]);
      expect(result.providers[0]!.status).toBe(opts.deny ? 'denied' : 'unsupported');
    },
  );

  it('keeps authored source unchanged and renders a bounded, explicitly truncated block', async () => {
    const source = `${extension}\n/*${'x'.repeat(20 * 1024)}*/`;
    const { run } = await setup({ count: 1, source });
    const result = await run();
    expect(result.sources[0]!.source).toBe(source);
    const rendered = renderExtensionDiscovery(result);
    const sourceBlock = rendered.find((block) => block.text.startsWith('[extension source BDEF'));
    expect(sourceBlock!.text).toContain('representation=authored_source');
    expect(sourceBlock!.text).toContain('truncated');
    expect(rendered.reduce((sum, block) => sum + Buffer.byteLength(block.text), 0)).toBeLessThanOrEqual(16 * 1024);
  });

  it('bounds many verified entity attachments with explicit edge omissions', async () => {
    const names = Array.from({ length: 100 }, (_, i) => `ENTITY${i}`);
    const { run } = await setup({
      count: 1,
      baseSource: names.map((name) => `define behavior for ${name} { }`).join('\n'),
      source: names.map((name) => `extend behavior for ${name} { }`).join('\n'),
    });
    const result = await run();
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(80);
    expect(result.omissions.edges).toBe(20);
    expect(result.providers[0]!.status).toBe('incomplete');
  });
});
