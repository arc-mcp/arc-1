import { describe, expect, it, vi } from 'vitest';
import { ddicExtensionAdapter } from '../../../src/adt/ddic-extension-adapter.js';
import type { DdicExtensionClient } from '../../../src/adt/ddic-extensions.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import { ExtensionDiscoverySession, renderExtensionDiscovery } from '../../../src/adt/extension-discovery.js';
import type { AdtRequestOptions } from '../../../src/adt/http-deadline.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { buildStructureHierarchy } from '../../../src/adt/structure-hierarchy.js';

function setup(sources: Record<string, string>, appends: Record<string, string[]> = {}) {
  const root = { type: 'TABL', name: 'ZROOT', version: 'active' };
  const request = { root, scope: 'root source' };
  const session = new ExtensionDiscoverySession('sources', request, defaultSafetyConfig());
  const get = vi.fn(async (path: string, _headers?: unknown, options?: AdtRequestOptions) => {
    options?.attemptBudget?.consume();
    const name = new URL(path, 'https://local').pathname.split('/')[6]!.toUpperCase();
    if (path.endsWith('/enhancements'))
      return {
        body: `<elementInfo name="${name}" type="TABL/DS">${(appends[name] ?? []).map((append) => `<elementInfo name="${append}" type="TABL/DS" uri="/sap/bc/adt/ddic/structures/${append}/source/main"/>`).join('')}</elementInfo>`,
      };
    return {
      body: `<blueSource name="${name}" type="TABL/DS" version="active"><link rel="http://www.sap.com/adt/relations/enhancements" href="./${name}/enhancements"/></blueSource>`,
    };
  });
  const getSource = vi.fn(async (name: string, options?: AdtRequestOptions) => {
    options?.attemptBudget?.consume();
    if (sources[name] === undefined) throw new AdtApiError('Source unavailable', 404, '/source');
    return { source: sources[name]!, notModified: false, statusCode: 200 };
  });
  const client = {
    safety: defaultSafetyConfig(),
    http: { get },
    getTabl: getSource,
    getStructure: getSource,
    resolveTablObjectUrl: vi.fn(async (name: string) => `/sap/bc/adt/ddic/structures/${name}`),
  } as unknown as DdicExtensionClient;
  return { client, session, request, get, getSource };
}

describe('bounded DDIC source graph', () => {
  it('uses the structure occurrence tree without exposing a disconnected metadata graph', async () => {
    const sources = {
      ZROOT: 'define structure zroot {}',
      ZAPPEND: 'extend type zroot with zappend {\n include zinc;\n}',
      ZINC: 'define structure zinc {}',
      ZCHILD: 'extend type zinc with zchild {}',
    };
    const { client } = setup(sources, { ZROOT: ['ZAPPEND'], ZINC: ['ZCHILD'] });
    const result = await buildStructureHierarchy(client, 'ZROOT');
    expect(result.tree.children[0]).toMatchObject({
      structure: 'ZAPPEND',
      kind: 'append',
      children: [{ structure: 'ZINC', kind: 'include', children: [{ structure: 'ZCHILD', kind: 'append' }] }],
    });
    expect(result.extensionDiscovery).not.toHaveProperty('edges');
    expect(result.extensionDiscovery?.nodes.map((node) => node.name)).toEqual(['ZAPPEND', 'ZCHILD']);
  });
  it('joins append descendants to the discovered identity and qualifies each edge observation', async () => {
    const sources = {
      ZROOT: 'define structure zroot {}',
      ZAPPEND: 'extend type zroot with zappend {\n include zinc;\n}',
      ZINC: 'define structure zinc {}',
    };
    const { client, session, request } = setup(sources, { ZROOT: ['ZAPPEND'] });
    await ddicExtensionAdapter(client, sources.ZROOT)(session, request);
    const identities = new Set(
      [request.root, ...session.result.nodes].map((node) => `${node.type}:${node.name}:${node.version}`),
    );
    for (const edge of session.result.edges) {
      expect(identities.has(edge.from), edge.from).toBe(true);
      expect(identities.has(edge.to), edge.to).toBe(true);
    }
    expect(session.result.edges).toContainEqual(
      expect.objectContaining({
        from: 'TABL:ZAPPEND:provider_current',
        to: 'TABL:ZINC:active',
        observationVersion: 'active',
      }),
    );
  });
  it('honors a hidden TABL denial before the mandatory explicit-context root read', async () => {
    const { client, getSource } = setup({ ZROOT: 'define structure zroot {}' });
    client.safety.denyActions = ['SAPRead.TABL'];
    await expect(buildStructureHierarchy(client, 'ZROOT')).rejects.toThrow('SAPRead.TABL denied');
    expect(getSource).not.toHaveBeenCalled();
  });
  it('labels an unreadable include as incomplete source coverage in explicit structure context', async () => {
    const { client } = setup({ ZROOT: 'define structure zroot {\n include zmissing;\n}' });
    const result = await buildStructureHierarchy(client, 'ZROOT');
    expect(result.summary.unresolved).toBe(1);
    expect(result.extensionDiscovery?.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'structure_source',
          status: 'incomplete',
          scope: 'ZMISSING',
          reason: 'source_unavailable',
        }),
      ]),
    );
    expect(result.extensionDiscovery?.omissions.sources).toBe(1);
  });
  it('retains key/attribute/suffix occurrences and cycles, fetches each source once and labels bodies', async () => {
    const sources = {
      ZROOT:
        'define structure zroot {\n key include zinc with suffix a;\n other : include zinc with suffix b;\n include zinc;\n}',
      ZINC: 'define structure zinc {\n include zroot;\n}',
      ZAPPEND: 'extend type zroot with zappend {\n extend field : with value help shlp;\n}',
    };
    const { client, session, request, getSource } = setup(sources, { ZROOT: ['ZAPPEND'] });
    await ddicExtensionAdapter(client, sources.ZROOT)(session, request);
    expect(session.result.edges.filter((edge) => edge.kind === 'include')).toMatchObject([
      { suffix: 'a', attribute: null },
      { suffix: 'b', attribute: 'other' },
      { attribute: null },
      { to: 'TABL:ZROOT:active' },
    ]);
    expect(getSource.mock.calls.map(([name]) => name).sort()).toEqual(['ZAPPEND', 'ZINC']);
    expect(session.result.sources.find((entry) => entry.identity.name === 'ZAPPEND')?.source).toBe(sources.ZAPPEND);
    const blocks = renderExtensionDiscovery(session.finish());
    expect(blocks.some((block) => block.text.includes('representation=authored_source'))).toBe(true);
    expect(blocks[0]!.text).not.toContain('summary truncated');
  });
  it('reports omitted sources after terminal child authorization and never probes another route', async () => {
    const { client, session, request, getSource } = setup(
      { ZROOT: 'define structure zroot {}' },
      { ZROOT: ['ZDENIED', 'ZNEXT'] },
    );
    getSource.mockRejectedValue(new AdtApiError('Private', 403, '/source'));
    await ddicExtensionAdapter(client, '')(session, request);
    expect(getSource).toHaveBeenCalledTimes(1);
    expect(session.stopped).toBe(true);
    expect(session.result.omissions.sources).toBe(2);
    expect(session.result.providers).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'denied' })]));
  });
  it('caps real source traversal at depth five and twenty actual sends', async () => {
    const sources = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [
        i === 0 ? 'ZROOT' : `ZINC${i}`,
        `define structure z {\n include zinc${i + 1};\n}`,
      ]),
    );
    const { client, session, request, getSource } = setup(sources);
    await ddicExtensionAdapter(client, sources.ZROOT!)(session, request);
    expect(session.options.attemptBudget!.used).toBeLessThanOrEqual(20);
    expect(getSource).toHaveBeenCalledTimes(5);
    expect(session.result.omissions.depth).toBeGreaterThan(0);
  });
  it('dedicated append context preserves repeated include shape and never uses the index on a valid empty provider', async () => {
    const sources = {
      ZROOT: 'define structure zroot {\n key include zinc with suffix a;\n include zinc with suffix b;\n}',
      ZINC: 'define structure zinc {}',
      ZAPPEND: 'extend type zroot with zappend {}',
    };
    const { client } = setup(sources, { ZROOT: ['ZAPPEND'] });
    const post = vi.fn();
    Object.assign(client.http, { post });
    const result = await buildStructureHierarchy(client, 'ZROOT');
    expect(result.tree.children).toMatchObject([
      { structure: 'ZINC', suffix: 'a' },
      { structure: 'ZINC', suffix: 'b' },
      { structure: 'ZAPPEND', kind: 'append' },
    ]);
    expect(post).not.toHaveBeenCalled();
    expect(result.summary).toMatchObject({ includes: 2, appends: 1 });
    expect(
      result.extensionDiscovery?.providers.some(
        (provider) => provider.id === 'ddic_appends' && provider.status === 'returned',
      ),
    ).toBe(true);
  });
});
