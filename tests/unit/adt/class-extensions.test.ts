import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { discoverClassIdentities, discoverClassSources } from '../../../src/adt/class-extensions.js';
import type { AdtClient } from '../../../src/adt/client.js';
import { enhancementSourceUnavailable, readActiveClassEnhancementSource } from '../../../src/adt/enhancements.js';
import { AdtApiError, AdtNetworkError } from '../../../src/adt/errors.js';
import { ExtensionDiscoverySession, renderExtensionDiscovery } from '../../../src/adt/extension-discovery.js';
import type { AdtRequestOptions } from '../../../src/adt/http-deadline.js';
import { parseRevisionFeed } from '../../../src/adt/revision-feed.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/class-extensions/${name}`, import.meta.url), 'utf8');
const name = 'CL_OO_ADT_ENHANCED_CLASS';
const enhancement = `${name}1`;
const parent = `${enhancement}=====E`;
const child = `${parent}M001`;
const rootUri = `/sap/bc/adt/oo/classes/${name.toLowerCase()}`;
const unsupported =
  '<exception><type id="ExceptionInternalServerError"/><message>Enhancement technology CLASENH is not supported yet.</message></exception>';
function setup(
  options: {
    mode?: 'summary' | 'sources';
    network?: string;
    deny?: string[];
    version?: string;
    sourceError?: unknown;
    feed?: string;
    source?: string;
    rootType?: string;
  } = {},
) {
  const safety = { ...defaultSafetyConfig(), denyActions: options.deny ?? [] };
  const request = {
    root: { type: options.rootType ?? 'CLAS', name, version: options.version ?? 'active' },
    scope: 'owning_object',
  };
  const session = new ExtensionDiscoverySession(options.mode ?? 'sources', request, safety);
  const received: AdtRequestOptions[] = [];
  const get = vi.fn(async (path: string, _headers: unknown, opts: AdtRequestOptions) => {
    received.push(opts);
    if (path === `${rootUri}?version=active`)
      return { body: `<abapClass name="${name}" type="CLAS/OC" version="active"/>` };
    if (path.includes('/enhancements/enhoxh/'))
      throw options.sourceError ?? new AdtApiError('unavailable', 500, path, unsupported);
    throw new Error(`Unexpected read ${path}`);
  });
  const post = vi.fn(
    async (_path: string, body: string, _mime: unknown, _headers: unknown, opts: AdtRequestOptions) => {
      received.push(opts);
      expect(body).toContain('<or:preferredContext>EXTED_OBJ</or:preferredContext>');
      return { body: options.network ?? fixture('class-exted.xml') };
    },
  );
  const getRevisions = vi.fn(async (_type: string, include: string, _opts: unknown, opts: AdtRequestOptions) => {
    received.push(opts);
    return parseRevisionFeed(options.feed ?? fixture(include === parent ? 'class-feed.xml' : 'method-feed.xml'));
  });
  const getRevisionSource = vi.fn(async (uri: string, opts: AdtRequestOptions) => {
    received.push(opts);
    return uri.toLowerCase().includes('em001/')
      ? '  METHOD enh_method.\n  ENDMETHOD.'
      : (options.source ?? fixture('class-generated.abap'));
  });
  const client = { safety, http: { get, post }, getRevisions, getRevisionSource } as unknown as AdtClient;
  const run = async () => {
    const nodes = await discoverClassIdentities(client, session, request);
    await discoverClassSources(client, session, nodes, '750');
    return session.finish();
  };
  return { run, client, request, session, get, post, getRevisions, getRevisionSource, received };
}
describe('class-bound enhancements', () => {
  it('accepts the observed nested-owner source representation without following the parent URI', async () => {
    const s = setup();
    s.get
      .mockResolvedValueOnce({ body: fixture('nested-owner-source-reference.xml') })
      .mockResolvedValueOnce({ body: 'exact active child source' });
    const name = 'SEEF_ADT_TEST_ENHO_CLASS_11';
    const source = await readActiveClassEnhancementSource(
      s.client,
      { name, type: 'ENHO/XHH' },
      s.session.options,
      [
        {
          name: 'SEEF_ADT_TEST_ENHO_CLASS_1',
          type: 'ENHO/XHH',
          uri: '/sap/bc/adt/enhancements/enhoxhh/seef_adt_test_enho_class_1',
        },
      ],
      '758',
    );
    expect(source.source).toBe('exact active child source');
    expect(s.get.mock.calls[1]?.[0]).toBe(
      `/sap/bc/adt/enhancements/enhoxhh/${name.toLowerCase()}/source/main?version=active`,
    );
    expect(s.getRevisions).not.toHaveBeenCalled();
  });
  it('discovers the structural identity independently of hooks; summaries never read sources', async () => {
    const s = setup({ mode: 'summary' });
    const result = await s.run();
    expect(result.nodes).toMatchObject([{ name: enhancement, type: 'ENHO/XH', family: 'class_bound_enhancement' }]);
    expect(result.edges).toMatchObject([
      { from: `ENHO/XH:${enhancement}:active`, to: `CLAS:${name}:active`, kind: 'extends' },
    ]);
    expect(s.getRevisions).not.toHaveBeenCalled();
    expect(result.sources).toEqual([]);
    expect(s.get).toHaveBeenCalledTimes(1);
  });
  it('returns labelled raw generated parent and the actual discovered EM001 child with shared budgets', async () => {
    const s = setup();
    const result = await s.run();
    expect(result.sources.map((s) => s.identity.name)).toEqual([parent, child]);
    expect(result.sources[0]).toMatchObject({
      representation: 'generated_include_revision',
      source: fixture('class-generated.abap'),
    });
    expect(result.providers[1]?.reason).toContain('active_revision=00000');
    expect(result.edges).toHaveLength(3);
    for (const opts of s.received) {
      expect(opts.attemptBudget).toBe(s.session.options.attemptBudget);
      expect(opts.responseBudget).toBe(s.session.options.responseBudget);
      expect(opts.deadline).toBe(s.session.options.deadline);
      expect(opts.retryTransientErrors).toBe(false);
    }
    expect(
      renderExtensionDiscovery(result)
        .map((s) => s.text)
        .join('\n'),
    ).toContain(`INCL ${parent} version=active representation=generated_include_revision`);
  });
  it('does not guess EM001 when it is absent from returned generated source', async () => {
    const s = setup({ source: 'ENHANCEMENT 1 .\nENDENHANCEMENT.' });
    await s.run();
    expect(s.getRevisions).toHaveBeenCalledTimes(1);
  });
  it('counts an actual EIMP reference as unqualified without fetching it', async () => {
    const s = setup({
      source: `* INCLUDE ${parent}M002.\nINCLUDE ${parent}IMP.\nINCLUDE ZOTHER.\nINCLUDE OTHER=========================EM001.`,
    });
    const result = await s.run();
    expect(result.sources).toHaveLength(1);
    expect(result.omissions.sources).toBe(3);
    expect(result.providers.at(-1)).toMatchObject({ status: 'incomplete' });
    expect(result.providers.at(-1)?.reason).toContain('unqualified_generated_include_references');
    expect(s.getRevisions).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['ENV', fixture('class-exted.xml').replaceAll('EXTED_OBJ', 'ENV')],
    ['WUL', fixture('class-exted.xml').replaceAll('EXTED_OBJ', 'WUL')],
  ])('rejects %s fallback without exposing dependency nodes', async (_label, network) => {
    const s = setup({ network });
    const r = await s.run();
    expect(r.providers[0]).toMatchObject({ status: 'unsupported', reason: 'unsupported_context' });
    expect(r.nodes).toEqual([]);
    expect(s.getRevisions).not.toHaveBeenCalled();
  });
  it.each([
    fixture('class-exted.xml').replaceAll('CL_OO_ADT_ENHANCED_CLASS"', 'ANOTHER_CLASS"'),
    fixture('class-exted.xml').replaceAll('enhoxh/cl_oo_adt_enhanced_class1', 'enhoxh/other'),
    fixture('class-exted.xml').replace('oro:state="A"', 'oro:state="I"'),
    '<networkResponse>',
  ])('stops on malformed or mismatched native evidence %#', async (network) => {
    const s = setup({ network });
    const r = await s.run();
    expect(r.providers[0]).toMatchObject({ status: 'incomplete', reason: 'invalid_provider_response' });
    expect(s.session.stopped).toBe(true);
    expect(s.getRevisions).not.toHaveBeenCalled();
  });
  it.each(['SAPRead.ENHO', 'SAPRead.CLAS', 'SAPRead.INCL'])('obeys hidden-read denial %s', async (deny) => {
    const s = setup({ deny: [deny] });
    const r = await s.run();
    expect(r.providers.some((p) => p.status === 'denied')).toBe(true);
    expect(s.getRevisions).not.toHaveBeenCalled();
    expect(s.session.stopped).toBe(true);
  });
  it.each([401, 403, 429, 500])('does not fall back after an unrelated HTTP %s source failure', async (status) => {
    const s = setup({ sourceError: new AdtApiError('unrelated', status, '/enho', 'unrelated failure') });
    const r = await s.run();
    expect(s.getRevisions).not.toHaveBeenCalled();
    expect(r.providers[1]?.status).not.toBe('returned');
    if (status !== 500) expect(s.session.stopped).toBe(true);
  });
  it('preserves source omission on a network failure or missing active revision', async () => {
    const s = setup({ sourceError: new AdtNetworkError('network failure') });
    const r = await s.run();
    expect(r.sources).toEqual([]);
    expect(s.getRevisions).not.toHaveBeenCalled();
    const missing = setup({ feed: fixture('class-feed.xml').replaceAll('00000', '00001') });
    expect((await missing.run()).sources).toEqual([]);
    expect(missing.getRevisionSource).not.toHaveBeenCalled();
  });
  it('refuses inactive automatic discovery before any hidden read', async () => {
    const s = setup({ version: 'inactive' });
    const r = await s.run();
    expect(r.providers[0]).toMatchObject({ status: 'unsupported', reason: 'unsupported_version' });
    expect(s.get).not.toHaveBeenCalled();
    expect(s.post).not.toHaveBeenCalled();
  });
  it('does not turn unresolved authorization followed by unsupported context into another provider read', async () => {
    const s = setup({ network: fixture('class-exted.xml').replaceAll('EXTED_OBJ', 'ENV') });
    s.post.mockImplementationOnce(async () => {
      s.session.options.attemptBudget!.authorizationFailureObserved = true;
      return { body: fixture('class-exted.xml').replaceAll('EXTED_OBJ', 'ENV') };
    });
    const result = await s.run();
    expect(s.session.stopped).toBe(true);
    expect(result.providers[0]?.status).toBe('incomplete');
    expect(s.getRevisions).not.toHaveBeenCalled();
  });
  it('does not use a qualified source fallback after unresolved authorization', async () => {
    const s = setup();
    const nodes = await discoverClassIdentities(s.client, s.session, s.request);
    s.get.mockImplementationOnce(async () => {
      s.session.options.attemptBudget!.authorizationFailureObserved = true;
      throw new AdtNetworkError('authorization retry lost its connection');
    });
    await discoverClassSources(s.client, s.session, nodes, '750');
    expect(s.session.stopped).toBe(true);
    expect(s.getRevisions).not.toHaveBeenCalled();
  });
  it('keeps ENHO technology unknown and qualifies only the observed release-specific failures', () => {
    const err = new AdtApiError('unsupported', 500, '/enho', unsupported);
    expect(enhancementSourceUnavailable(err, '750')).toBe(true);
    expect(enhancementSourceUnavailable(err, '816')).toBe(false);
    expect(enhancementSourceUnavailable(new AdtApiError('unrelated', 500, '/enho'), '750')).toBe(false);
  });
  it.each([false, true, 'source'] as const)(
    'binds authored nested source to its discovered parent; owner URI=%s',
    async (mismatch) => {
      const s = setup();
      const parentNode = {
        type: 'ENHO/XHH',
        name: 'ZPARENT',
        version: 'active',
        uri: '/sap/bc/adt/enhancements/enhoxhh/zparent',
        provider: 'class_exted_obj',
        family: 'class_bound_enhancement',
      };
      const childNode = { ...parentNode, name: 'ZCHILD', uri: '/sap/bc/adt/enhancements/enhoxhh/zchild' };
      s.session.addNode(parentNode);
      s.session.addNode(childNode);
      s.session.result.edges.push({ from: 'ENHO/XHH:ZCHILD:active', to: 'ENHO/XHH:ZPARENT:active', kind: 'extends' });
      s.get.mockImplementation(async (path) => ({
        body: path.includes('/source/main')
          ? 'unchanged authored source'
          : `<enhancement name="ZCHILD"><contentSpecific><hookTechnology><enhancedObject name="ZPARENT" type="ENHO/XHH" uri="${parentNode.uri}${mismatch === true ? '_other' : mismatch === 'source' ? '/source/main' : ''}"/></hookTechnology></contentSpecific></enhancement>`,
      }));
      await discoverClassSources(s.client, s.session, [childNode], '758');
      if (mismatch === true) {
        expect(s.session.stopped).toBe(true);
        expect(s.session.result.sources).toEqual([]);
        expect(s.get).toHaveBeenCalledTimes(1);
      } else
        expect(s.session.result.sources[0]).toMatchObject({
          source: 'unchanged authored source',
          representation: 'authored_source',
        });
    },
  );
  it('rejects inactive ENHO metadata before source or revision reads', async () => {
    const s = setup();
    const node = {
      type: 'ENHO/XHH',
      name: enhancement,
      version: 'active',
      uri: '',
      provider: 'class_exted_obj',
      family: 'class_bound_enhancement',
    };
    s.get.mockResolvedValue({ body: `<enhancement name="${enhancement}" version="inactive"/>` });
    await discoverClassSources(s.client, s.session, [node], '758');
    expect(s.session.stopped).toBe(true);
    expect(s.get).toHaveBeenCalledTimes(1);
    expect(s.getRevisions).not.toHaveBeenCalled();
    expect(s.session.result.sources).toEqual([]);
  });
  it('applies the same depth cap to generated representations and discovered method children', async () => {
    const s = setup();
    const nodes = await discoverClassIdentities(s.client, s.session, s.request);
    s.session.result.edges.length = 0;
    for (let depth = 0; depth < 4; depth++)
      s.session.result.edges.push({
        from: depth === 0 ? `ENHO/XH:${enhancement}:active` : `ENHO/XHH:ZPARENT${depth}:active`,
        to: `ENHO/XHH:ZPARENT${depth + 1}:active`,
        kind: 'extends',
      });
    s.session.result.edges.push({ from: 'ENHO/XHH:ZPARENT4:active', to: `CLAS:${name}:active`, kind: 'extends' });
    await discoverClassSources(s.client, s.session, nodes, '750');
    expect(s.session.result.sources.map((source) => source.identity.name)).toEqual([parent]);
    expect(s.getRevisions).toHaveBeenCalledTimes(1);
    expect(s.session.result.omissions.depth).toBe(1);
    expect(s.session.result.omissions.sources).toBe(1);
  });
  it('counts a missing active method child once while retaining its parent body', async () => {
    const s = setup();
    const nodes = await discoverClassIdentities(s.client, s.session, s.request);
    s.getRevisions
      .mockResolvedValueOnce(parseRevisionFeed(fixture('class-feed.xml')))
      .mockResolvedValueOnce(parseRevisionFeed(fixture('method-feed.xml').replaceAll('00000', '00001')));
    await discoverClassSources(s.client, s.session, nodes, '750');
    expect(s.session.result.sources.map((source) => source.identity.name)).toEqual([parent]);
    expect(s.session.result.omissions.sources).toBe(1);
  });
  it('counts known native sources left unread after a terminal failure', async () => {
    const s = setup({ sourceError: new AdtApiError('denied', 401, '/enho') });
    const nodes = await discoverClassIdentities(s.client, s.session, s.request);
    const other = { ...nodes[0]!, name: 'ZUNREAD', uri: '/sap/bc/adt/enhancements/enhoxh/zunread' };
    s.session.addNode(other);
    nodes.push(other);
    await discoverClassSources(s.client, s.session, nodes, '750');
    expect(s.session.result.omissions.sources).toBe(2);
    expect(s.get.mock.calls.filter(([path]) => path.includes('/enhancements/'))).toHaveLength(1);
  });
  it('reports an unsupported native subtype without attempting an authored or generated source', async () => {
    const s = setup();
    const nodes = await discoverClassIdentities(s.client, s.session, s.request);
    await discoverClassSources(s.client, s.session, [{ ...nodes[0]!, type: 'ENHO/XHB' }]);
    expect(s.session.result.providers.at(-1)).toMatchObject({
      status: 'unsupported',
      reason: 'unsupported_source_provider',
    });
    expect(s.session.result.omissions.sources).toBe(1);
    expect(s.get).toHaveBeenCalledTimes(1);
    expect(s.getRevisions).not.toHaveBeenCalled();
  });
  it('reports valid native metadata with no source as unavailable rather than absence', async () => {
    const s = setup();
    const nodes = await discoverClassIdentities(s.client, s.session, s.request);
    s.get.mockResolvedValue({
      body: `<enhancement name="${enhancement}"><contentSpecific><hookTechnology><enhancedObject name="${name}" type="CLAS/OC" uri="${rootUri}"/></hookTechnology></contentSpecific></enhancement>`,
    });
    await discoverClassSources(s.client, s.session, nodes);
    expect(s.session.result.providers.at(-1)).toMatchObject({ status: 'unsupported', reason: 'source_unavailable' });
    expect(s.session.result.omissions.sources).toBe(1);
    expect(s.session.result.nodes).toHaveLength(1);
    expect(s.getRevisions).not.toHaveBeenCalled();
  });
  it('refuses sources at an exhausted native depth before making source requests', async () => {
    const s = setup();
    const nodes = await discoverClassIdentities(s.client, s.session, s.request);
    s.session.result.edges.length = 0;
    for (let depth = 0; depth < 5; depth++)
      s.session.result.edges.push({
        from: depth === 0 ? `ENHO/XH:${enhancement}:active` : `ENHO/XHH:ZPARENT${depth}:active`,
        to: `ENHO/XHH:ZPARENT${depth + 1}:active`,
        kind: 'extends',
      });
    s.session.result.edges.push({ from: 'ENHO/XHH:ZPARENT5:active', to: `CLAS:${name}:active`, kind: 'extends' });
    await discoverClassSources(s.client, s.session, nodes);
    expect(s.session.result.providers.at(-1)).toMatchObject({ reason: 'source_depth_limit' });
    expect(s.session.result.omissions).toMatchObject({ depth: 1, sources: 1 });
    expect(s.get).toHaveBeenCalledTimes(1);
    expect(s.getRevisions).not.toHaveBeenCalled();
  });
  it('omits a generated body when its representation cannot fit the shared node cap', async () => {
    const s = setup();
    const nodes = await discoverClassIdentities(s.client, s.session, s.request);
    for (let index = 1; index < s.session.limits.nodes; index++)
      s.session.addNode({ ...nodes[0]!, name: `ZFILL${index}` });
    await discoverClassSources(s.client, s.session, nodes, '750');
    expect(s.session.result.sources).toEqual([]);
    expect(s.session.result.omissions).toMatchObject({ nodes: 1, sources: 1 });
    expect(s.getRevisions).toHaveBeenCalledTimes(1);
  });
});
