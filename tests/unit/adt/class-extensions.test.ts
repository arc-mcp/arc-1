import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { discoverClassIdentities, discoverClassSources } from '../../../src/adt/class-extensions.js';
import type { AdtClient } from '../../../src/adt/client.js';
import { enhancementSourceUnavailable } from '../../../src/adt/enhancements.js';
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
    s.session.options.attemptBudget!.authorizationFailureObserved = true;
    const result = await s.run();
    expect(s.session.stopped).toBe(true);
    expect(result.providers[0]?.status).toBe('incomplete');
    expect(s.getRevisions).not.toHaveBeenCalled();
  });
  it('does not use a qualified source fallback after unresolved authorization', async () => {
    const s = setup();
    const nodes = await discoverClassIdentities(s.client, s.session, s.request);
    s.session.options.attemptBudget!.authorizationFailureObserved = true;
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
});
