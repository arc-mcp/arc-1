/** Public SAPRead regression: original blocks, selected-scope semantics and optional failures. */
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { BDEF_COLLECTION, bdefRelationRoot } from '../../../src/adt/bdef-extension-candidates.js';
import { AdtClient } from '../../../src/adt/client.js';
import { RELATIONS_MIME, RELATIONS_PATH } from '../../../src/adt/repository-relations.js';
import { handleToolCall } from '../../../src/handlers/dispatch.js';
import { resetCachedFeatures, setCachedDiscovery, setCachedFeatures } from '../../../src/handlers/feature-cache.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { relationObject, relationXml } from '../../helpers/relation-fixtures.js';

const root = bdefRelationRoot('ZBASE');
const child = relationObject('ZEXTENSION', 'BDEF/BDO');
const baseSource = '// Original base: ü\r\ndefine behavior for ENTITY { create; }\r\n';
const extensionSource = 'extend behavior for ENTITY { }';
const servers: Server[] = [];
afterEach(async () => {
  resetCachedFeatures();
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }),
  );
});

async function setup(opts: { status?: number; wrongContext?: boolean; release?: string; source?: string } = {}) {
  const paths: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://loopback.invalid');
    const path = url.pathname.toLowerCase();
    paths.push(path);
    if (path.includes('/core/discovery')) {
      res.setHeader('x-csrf-token', 'TEST');
      res.end();
    } else if (path === `${root.uri}/source/main`) res.end(opts.source ?? baseSource);
    else if (path === '/sap/bc/adt/activation/inactiveobjects') res.end('<inactiveObjects/>');
    else if (path === RELATIONS_PATH) {
      if (opts.status) res.writeHead(opts.status).end('synthetic optional failure');
      else res.end(relationXml(root, [child], opts.wrongContext ? 'ENV' : 'WUL'));
    } else if (path === `${child.uri}/source/main`) res.end(extensionSource);
    else res.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected listener');
  const client = new AdtClient({ baseUrl: `http://127.0.0.1:${address.port}` });
  const discovery = new Map([
    [BDEF_COLLECTION, []],
    [RELATIONS_PATH, [RELATIONS_MIME]],
  ]);
  setCachedFeatures({
    abapRelease: opts.release ?? '758',
    rap: { id: 'rap', available: true, mode: 'auto' },
    discoveryMap: discovery,
  });
  setCachedDiscovery(discovery);
  return {
    paths,
    read: (args: Record<string, unknown> = {}) =>
      handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', { type: 'BDEF', name: 'ZBASE', ...args }),
  };
}

const summary = (result: Awaited<ReturnType<typeof handleToolCall>>) => {
  const block = result.content.find((entry) => entry.text.startsWith('[extensions] '));
  return JSON.parse(block!.text.slice('[extensions] '.length));
};

describe('BDEF extensions in SAPRead', () => {
  it('none returns the legacy whole result and makes no optional requests', async () => {
    const s = await setup();
    expect(await s.read({ extensions: 'none' })).toEqual({ content: [{ type: 'text', text: baseSource }] });
    expect(s.paths).toEqual([`${root.uri}/source/main`]);
  });

  it('full root reads default to summary while preserving the original first block exactly', async () => {
    const s = await setup();
    const legacy = await s.read({ extensions: 'none' });
    const result = await s.read();
    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toEqual(legacy.content[0]);
    expect(summary(result).identities[0]).toMatchObject({ name: 'ZEXTENSION', type: 'BDEF', version: 'active' });
    expect(summary(result).providers[0].coverage).toBe('candidate_index');
    expect(result.content).toHaveLength(2);
  });

  it('sources appends a separate labelled active authored source', async () => {
    const s = await setup();
    const result = await s.read({ extensions: 'sources' });
    expect(result.content[0]!.text).toBe(baseSource);
    expect(
      result.content.some(
        (block) => block.text.includes('representation=authored_source') && block.text.endsWith(extensionSource),
      ),
    ).toBe(true);
  });

  it('partial reads default to none and explicit coverage verifies the whole owning source', async () => {
    const s = await setup();
    const partial = await s.read({ lineStart: 1, lineEnd: 1 });
    expect(partial.content).toHaveLength(1);
    expect(s.paths).toEqual([`${root.uri}/source/main`]);
    const explicit = await s.read({ lineStart: 1, lineEnd: 1, extensions: 'summary' });
    expect(explicit.content[0]).toEqual(partial.content[0]);
    expect(summary(explicit).scope).toContain('owning');
    expect(summary(explicit).identities).toHaveLength(1);
  });

  it.each([401, 403, 429])('keeps the successful base after optional HTTP %s', async (status) => {
    const s = await setup({ status });
    const result = await s.read({ extensions: 'sources' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toBe(baseSource);
    expect(summary(result).providers[0].status).toBe(status === 429 ? 'incomplete' : 'denied');
    expect(s.paths).not.toContain(`${child.uri}/source/main`);
  });

  it('wrong-context native data preserves the base and reports incomplete coverage', async () => {
    const s = await setup({ wrongContext: true });
    const result = await s.read();
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toBe(baseSource);
    expect(summary(result).issues).toContain('invalid_provider_response');
  });

  it('explicit inactive reads never substitute active extension sources', async () => {
    const s = await setup();
    const result = await s.read({ version: 'inactive', extensions: 'sources' });
    expect(result.isError).toBeUndefined();
    expect(summary(result).root.version).toBe('inactive');
    expect(summary(result).providers[0].reason).toContain('unsupported_version');
    expect(s.paths).not.toContain(RELATIONS_PATH);
  });

  it('does not qualify release 750 from rap.available alone', async () => {
    const s = await setup({ release: '750' });
    const result = await s.read();
    expect(summary(result).providers[0].status).toBe('unsupported');
    expect(s.paths).not.toContain(RELATIONS_PATH);
  });
});
