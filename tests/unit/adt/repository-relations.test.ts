import { describe, expect, it, vi } from 'vitest';
import type { AdtClient } from '../../../src/adt/client.js';
import {
  NativeRelationProvider,
  normalizeRelationNetwork,
  parseRelationXml,
  RELATIONS_MIME,
  RELATIONS_PATH,
  RelationProtocolError,
  relationObjectUri,
  supportsRelations,
} from '../../../src/adt/repository-relations.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { relationMetadata, relationObject, relationXml } from '../../helpers/relation-fixtures.js';

const root = relationObject('ZCL_ROOT'),
  child = relationObject('ZCL_CHILD');
const valid = relationXml(root, [child]);
describe('native relation protocol', () => {
  it.each(['ENV', 'WUL'] as const)('normalizes %s direction and deduplicates', (context) => {
    const result = normalizeRelationNetwork(relationXml(root, [child, child], context), context, root);
    expect(result.objects).toHaveLength(2);
    expect(result.edges).toEqual([
      {
        from: context === 'ENV' ? root.uri : child.uri,
        to: context === 'ENV' ? child.uri : root.uri,
        kind: 'uses',
        context,
        evidence: 'sap_relation_explorer',
        direct: null,
      },
    ]);
  });
  it('keeps same-name different-type/URI objects', () => {
    const ddl = { ...child, name: 'ZSAME', type: 'DDLS/DF', uri: '/sap/bc/adt/ddic/ddl/sources/zsame' };
    const behavior = { ...ddl, type: 'BDEF/BDO', uri: '/sap/bc/adt/bo/behaviordefinitions/zsame' };
    expect(normalizeRelationNetwork(relationXml(root, [ddl, behavior]), 'ENV', root).objects).toHaveLength(3);
  });
  it.each([
    ['context fallback', valid.replace('ENV', 'OTHER')],
    ['missing root', relationXml(child, [])],
    ['wrong root type', valid.replace('CLAS/OC', 'INTF/OI')],
    ['wrong root name', valid.replace('ZCL_ROOT', 'ZCL_WRONG')],
    ['inactive', valid.replace('version="active"', 'version="inactive"')],
    ['absent', valid.replace('exists="true"', 'exists="false"')],
    ['unsupported edge', valid.replace('parentChild', 'call')],
    ['state', valid.replace('state="A"', 'state="I"')],
    ['unbound edge', valid.replace(`<object2>${child.uri}</object2>`, '<object2>/sap/bc/adt/unknown</object2>')],
    ['conflicting duplicate', relationXml(root, [{ ...root, name: 'ZOTHER' }])],
    ['malformed', valid.slice(0, -5)],
    ['DTD', `<!DOCTYPE root [<!ENTITY x "y">]>${valid}`],
    ['oversized name', valid.replace('ZCL_ROOT', 'A'.repeat(121))],
  ])('rejects %s', (_label, xml) =>
    expect(() => normalizeRelationNetwork(xml, 'ENV', root)).toThrow(RelationProtocolError),
  );
  it.each([
    'https://evil.test/x',
    '//evil.test/x',
    '/sap/bc/adt/../admin',
    '/sap/bc/adt/%2e%2e/admin',
    '/sap/bc/adt/%252e%252e/admin',
    '/sap/bc/adt/x?y',
    '/sap/bc/adt/x%23y',
    '/sap/bc/adt/x\\y',
  ])('rejects unsafe URI %s', (uri) => {
    expect(() => normalizeRelationNetwork(relationXml(root, [{ ...child, uri }]), 'ENV', root)).toThrow();
  });
  it('bounds nesting and records before parsing', () => {
    expect(() => parseRelationXml('<'.repeat(1000000))).toThrow('malformed XML');
    expect(() => parseRelationXml('<x>'.repeat(41) + '</x>'.repeat(41))).toThrow('nesting');
    expect(() => parseRelationXml(`<root>${'<x/>'.repeat(20001)}</root>`)).toThrow('records');
    expect(() =>
      normalizeRelationNetwork(
        relationXml(
          root,
          Array.from({ length: 2000 }, () => child),
        ),
        'ENV',
        root,
      ),
    ).toThrow('record limit');
  });
  it('builds a fixed URI for namespaced roots and rejects unsafe names/types', () => {
    expect(relationObjectUri('INTF', '/ACME/IF_TEST')).toBe('/sap/bc/adt/oo/interfaces/%2Facme%2Fif_test');
    for (const name of ['../test', 'X?y', 'A/B', '']) expect(() => relationObjectUri('CLAS', name)).toThrow();
    expect(() => relationObjectUri('DEVC', 'ZTEST')).toThrow();
  });
  it('requires exact collection/MIME, not a prefix or unrelated MIME', () => {
    expect(supportsRelations(new Map([[RELATIONS_PATH, [RELATIONS_MIME]]]))).toBe(true);
    for (const map of [
      undefined,
      new Map(),
      new Map([['/sap/bc/adt', [RELATIONS_MIME]]]),
      new Map([[RELATIONS_PATH, ['text/xml']]]),
    ])
      expect(supportsRelations(map)).toBe(false);
  });
});

describe('native provider', () => {
  const setup = () => {
    const get = vi.fn(),
      post = vi.fn();
    const client = { safety: defaultSafetyConfig(), http: { get, post } } as unknown as AdtClient;
    return { get, post, provider: new NativeRelationProvider(client, { deadline: Date.now() + 15000 }) };
  };
  it('reuses discovery without an extra request; known absence is terminal', async () => {
    const { provider, get } = setup();
    await provider.discover(new Map([[RELATIONS_PATH, [RELATIONS_MIME]]]));
    await expect(provider.discover(new Map())).rejects.toThrow('not advertised');
    expect(get).not.toHaveBeenCalled();
  });
  it.each(['CLAS', 'INTF'])('validates %s metadata before lookup', async (type) => {
    const { provider, get } = setup(),
      object = relationObject('ZROOT', type === 'CLAS' ? 'CLAS/OC' : 'INTF/OI');
    get.mockResolvedValue({ body: relationMetadata(object) });
    expect(await provider.validateRoot(type, 'ZROOT')).toMatchObject({ ...object, existence: 'metadata_validated' });
    get.mockResolvedValue({ body: relationMetadata(object).replace('ZROOT', 'ZWRONG') });
    await expect(provider.validateRoot(type, 'ZROOT')).rejects.toThrow('does not match');
  });
  it('uses the validated URI and explicit WUL; never follows returned arbitrary URLs', async () => {
    const { provider, post } = setup();
    post.mockResolvedValue({ body: relationXml(root, [child], 'WUL') });
    await provider.lookup(root, 'incoming');
    expect(post).toHaveBeenCalledWith(
      RELATIONS_PATH,
      expect.stringContaining('<or:preferredContext>WUL</or:preferredContext>'),
      RELATIONS_MIME,
      { Accept: '*/*' },
      provider.options,
    );
    await expect(provider.lookup({ ...root, uri: '/sap/bc/adt/other' }, 'incoming')).rejects.toThrow('mismatch');
    expect(post).toHaveBeenCalledTimes(1);
  });
});
