import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { discoverClassExtensions } from '../../../src/adt/class-extensions.js';
import type { AdtClient } from '../../../src/adt/client.js';
import { ExtensionDiscoverySession } from '../../../src/adt/extension-discovery.js';
import type { AdtRequestOptions } from '../../../src/adt/http-deadline.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { relationObject, relationXml } from '../../helpers/relation-fixtures.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/extensions/source/${name}`, import.meta.url), 'utf8');
const name = 'CL_SEEF_ADT_TEST_AUNIT_1';
const root = relationObject(name);
const request = { root: { type: 'CLAS', name, version: 'active' }, scope: 'class source' };
function setup(mode: 'summary' | 'sources', section: 'main' | 'definitions' = 'main', nativeGraph = false) {
  const safety = defaultSafetyConfig();
  const session = new ExtensionDiscoverySession(mode, request, safety);
  const get = vi.fn(async (path: string, _headers: unknown, options: AdtRequestOptions) => {
    expect(options).toBe(session.options);
    options.attemptBudget!.consume();
    if (path.endsWith('?version=active')) return { body: fixture('class-metadata-758.xml') };
    if (path.endsWith('/enhancements/implementations')) return { body: fixture('class-identities-758.xml') };
    if (path.includes('/includes/definitions/')) return { body: '<enhancements/>' };
    if (path.includes('/source/main/enhancements/elements')) return { body: fixture('class-758.xml') };
    throw new Error('Unexpected source unit');
  });
  const post = vi.fn(async (_p: string, _b: string, _m: string, _h: unknown, options: AdtRequestOptions) => {
    expect(options).toBe(session.options);
    options.attemptBudget!.consume();
    return {
      body: nativeGraph
        ? readFileSync(new URL('../../fixtures/class-extensions/class-hook-native.xml', import.meta.url), 'utf8')
        : relationXml(root, [], 'EXTED_OBJ'),
    };
  });
  const client = { safety, http: { get, post } } as unknown as AdtClient;
  const run = async () => {
    await discoverClassExtensions(
      client,
      session,
      request,
      { unit: { type: 'CLAS', name, section }, source: '' },
      '758',
    );
    return session.finish();
  };
  return { run, get, session };
}
describe('combined class providers', () => {
  it('keeps cheap HOOK_IMPL coverage at two outer identities', async () => {
    const s = setup('summary');
    const result = await s.run();
    expect(result.providers.map((p) => p.id)).toEqual(['class_exted_obj', 'source_plugins']);
    expect(result.providers[1]).toMatchObject({ coverage: 'direct_identities', nested: 'not_expanded' });
    expect(result.nodes).toHaveLength(2);
    expect(result.sources).toEqual([]);
    expect(result.providers[1]?.reason).toContain('class_section=main');
  });
  it('retains seven implementations and all three replacement edges in main sources mode', async () => {
    const result = await setup('sources').run();
    expect(result.nodes).toHaveLength(7);
    expect(result.edges.filter((edge) => edge.kind === 'replacement')).toHaveLength(3);
    expect(result.sources).toHaveLength(8);
    expect(result.sources.every((source) => source.representation === 'rendered_plugin_source')).toBe(true);
  });
  it('keeps a local definitions selection separate from main hook scope', async () => {
    const s = setup('sources', 'definitions');
    const result = await s.run();
    expect(result.nodes).toEqual([]);
    expect(result.providers[1]?.reason).toContain('class_section=definitions');
    expect(s.get.mock.calls.some(([path]) => path.includes('/source/main/enhancements'))).toBe(false);
    expect(s.get.mock.calls.some(([path]) => path.includes('/includes/definitions/enhancements'))).toBe(true);
  });
  it('retains native nested direction and merges sources with the separate replacement graph', async () => {
    const result = await setup('sources', 'main', true).run();
    expect(result.nodes).toHaveLength(7);
    expect(result.edges.filter((edge) => edge.kind === 'extends')).toHaveLength(7);
    expect(result.edges).toContainEqual(
      expect.objectContaining({
        from: 'ENHO/XHH:SEEF_ADT_TEST_ENHO_CLASS_111_R:active',
        to: 'ENHO/XHH:SEEF_ADT_TEST_ENHO_CLASS_111:active',
        kind: 'extends',
      }),
    );
    expect(result.edges.filter((edge) => edge.kind === 'replacement')).toHaveLength(3);
    expect(result.sources).toHaveLength(8);
  });
  it('reports unqualified source coverage for a hypothetical exact interface context', async () => {
    const iface = relationObject('IF_FUTURE', 'INTF/OI');
    const enho = { ...iface, name: 'ZFUTURE', type: 'ENHO/XH', uri: '/sap/bc/adt/enhancements/enhoxh/zfuture' };
    const req = {
      root: { type: 'INTF', name: iface.name, version: 'active' },
      scope: 'synthetic interface qualification boundary',
    };
    const safety = defaultSafetyConfig();
    const session = new ExtensionDiscoverySession('sources', req, safety);
    const get = vi.fn(async () => ({ body: '<abapInterface name="IF_FUTURE" type="INTF/OI" version="active"/>' }));
    const client = {
      safety,
      http: { get, post: vi.fn(async () => ({ body: relationXml(iface, [enho], 'EXTED_OBJ') })) },
    } as unknown as AdtClient;
    await discoverClassExtensions(client, session, req, { unit: { type: 'CLAS', name: iface.name } });
    expect(session.result.providers[0]?.id).toBe('interface_exted_obj');
    expect(session.result.providers[1]).toMatchObject({
      status: 'unsupported',
      reason: 'interface_source_provider_unqualified',
    });
    expect(session.result.sources).toEqual([]);
    expect(session.result.omissions.sources).toBe(1);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
