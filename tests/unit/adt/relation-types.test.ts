import { describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import {
  RELATION_OBJECTS,
  RELATION_ROOT_TYPES,
  relationObjectUri,
  relationReferenceName,
} from '../../../src/adt/relation-objects.js';
import { NativeRelationProvider, normalizeRelationNetwork } from '../../../src/adt/repository-relations.js';
import { RequestAttemptBudget } from '../../../src/adt/request-attempt-budget.js';
import { walkRelations } from '../../../src/context/relation-walk.js';
import { LiveRelationsInput } from '../../../src/handlers/relation-input.js';
import { relationObject, relationXml } from '../../helpers/relation-fixtures.js';

// Independent transcription of the observed 7.58 metadata envelopes and URI families.
const observed = [
  ['CLAS', 'CLAS/OC', 'oo/classes', 'abapClass'],
  ['INTF', 'INTF/OI', 'oo/interfaces', 'abapInterface'],
  ['DDLS', 'DDLS/DF', 'ddic/ddl/sources', 'ddlSource'],
  ['DCLS', 'DCLS/DL', 'acm/dcl/sources', 'dclSource'],
  ['BDEF', 'BDEF/BDO', 'bo/behaviordefinitions', 'blueSource'],
  ['SRVD', 'SRVD/SRV', 'ddic/srvd/sources', 'srvdSource'],
  ['TABL', 'TABL/DT', 'ddic/tables', 'blueSource'],
  ['TABL', 'TABL/DS', 'ddic/structures', 'blueSource'],
  ['TTYP', 'TTYP/DA', 'ddic/tabletypes', 'tableType'],
  ['DTEL', 'DTEL/DE', 'ddic/dataelements', 'wbobj'],
  ['DOMA', 'DOMA/DD', 'ddic/domains', 'domain'],
  ['PROG', 'PROG/P', 'programs/programs', 'abapProgram'],
  ['INCL', 'PROG/I', 'programs/includes', 'abapInclude'],
  ['FUGR', 'FUGR/F', 'functions/groups', 'abapFunctionGroup'],
  ['FUNC', 'FUGR/FF', 'functions/groups', 'abapFunctionModule'],
  ['VIEW', 'VIEW/DV', 'vit/wb/object_type/viewdv/object_name', 'mainObject'],
  ['ENHO', 'ENHO/XHB', 'enhancements/enhoxhb', 'objectData'],
  ['MSAG', 'MSAG/N', 'messageclass', 'messageClass'],
];

function setup(row: string[], name = '/ACME/ROOT') {
  const [type, native, path, tag] = row;
  const group = '/ACME/GROUP';
  const segment = encodeURIComponent(type === 'VIEW' ? name.toUpperCase() : name.toLowerCase());
  const uri = `/sap/bc/adt/${path}/${type === 'FUNC' ? `${encodeURIComponent(group.toLowerCase())}/fmodules/` : ''}${segment}`;
  const object = { ...relationObject('ZROOT'), name, type: native!, uri };
  const pkg =
    type === 'FUNC'
      ? `<containerRef name="${group}" type="FUGR/F" uri="/sap/bc/adt/functions/groups/%2Facme%2Fgroup" packageName="ZTEST"/>`
      : '<packageRef name="ZTEST"/>';
  const metadata = `<${tag} name="${name}" type="${native}" version="active">${pkg}</${tag}>`;
  const resolution = `<objectReferences><objectReference name="${name}" type="${native}" uri="${uri}"/></objectReferences>`;
  const client = new AdtClient({ baseUrl: 'http://not-contacted.invalid' });
  const options = { deadline: Date.now() + 15000, attemptBudget: new RequestAttemptBudget(12) };
  const get = vi.spyOn(client.http, 'get').mockImplementation(async (url) => ({
    statusCode: 200,
    headers: {},
    body: url.includes('informationsystem') ? resolution : metadata,
  }));
  const post = vi
    .spyOn(client.http, 'post')
    .mockResolvedValue({ statusCode: 200, headers: {}, body: relationXml(object, []) });
  return { client, provider: new NativeRelationProvider(client, options), object, metadata, resolution, get, post };
}

describe('qualified relation identities', () => {
  it('has evidence for every advertised type and no unqualified roots', () => {
    expect(RELATION_OBJECTS).toEqual(observed);
    expect(RELATION_ROOT_TYPES).toEqual([...new Set(observed.map(([type]) => type))]);
    for (const type of RELATION_ROOT_TYPES)
      expect(LiveRelationsInput.safeParse({ action: 'relations', type, name: 'ZROOT' }).success).toBe(true);
    for (const type of ['DEVC', 'DDLX', 'SRVB', 'STOB', 'ENHS'])
      expect(LiveRelationsInput.safeParse({ action: 'relations', type, name: 'ZROOT' }).success).toBe(false);
  });
  it.each(observed)('%s %s validates namespaced metadata, with no unbounded side requests', async (...row) => {
    const { provider, object, get, post } = setup(row);
    const root = await provider.validateRoot(row[0]!, object.name);
    expect(root).toEqual({ ...object, existence: 'metadata_validated' });
    expect(get).toHaveBeenCalledTimes(['TABL', 'FUNC', 'VIEW'].includes(row[0]!) ? 2 : 1);
    for (const call of get.mock.calls) expect(call[2]).toBe(provider.options);
    await provider.lookup(root, 'outgoing');
    expect(post.mock.calls[0]![4]).toBe(provider.options);
    expect(post.mock.calls[0]![1]).toContain(object.uri);
  });
  for (const invalid of ['wrong-name', 'wrong-type', 'inactive', 'new', 'wrong-envelope']) {
    it.each(observed)(`%s %s rejects ${invalid} metadata before network POST`, async (...row) => {
      const { provider, metadata, resolution, get, post } = setup(row);
      const bad =
        invalid === 'wrong-name'
          ? metadata.replace('name="/ACME/ROOT"', 'name="OTHER"')
          : invalid === 'wrong-type'
            ? metadata.replace(`type="${row[1]}"`, 'type="UNKNOWN/X"')
            : invalid === 'wrong-envelope'
              ? metadata.replaceAll(row[3]!, 'unrelatedEnvelope')
              : metadata.replace('version="active"', `version="${invalid}"`);
      get.mockImplementation(async (url) => ({
        statusCode: 200,
        headers: {},
        body: url.includes('informationsystem') ? resolution : bad,
      }));
      await expect(provider.validateRoot(row[0]!, '/ACME/ROOT')).rejects.toThrow();
      expect(post).not.toHaveBeenCalled();
    });
  }
  it.each(observed)('%s %s keeps absent/denied roots terminal', async (...row) => {
    for (const status of [401, 403, 404]) {
      const { provider, get, post } = setup(row);
      get.mockRejectedValue(new AdtApiError('No metadata', status, '/sap/bc/adt/'));
      await expect(provider.validateRoot(row[0]!, 'ZROOT')).rejects.toMatchObject({ statusCode: status });
      expect(post).not.toHaveBeenCalled();
    }
  });
  it.each(observed)(
    '%s %s expands mixed-type cycles in both directions without extra metadata reads',
    async (...row) => {
      for (const direction of ['incoming', 'outgoing'] as const) {
        const { provider, object, get, post } = setup(row);
        const child = relationObject('ZCHILD');
        const context = direction === 'outgoing' ? 'ENV' : 'WUL';
        post.mockImplementation(async (_url, body) => ({
          statusCode: 200,
          headers: {},
          body: String(body).includes(`uri="${object.uri}"`)
            ? relationXml(object, [child], context)
            : relationXml(child, [object], context),
        }));
        const root = await provider.validateRoot(row[0]!, object.name);
        const result = await walkRelations(root, provider, { direction, depth: 3, maxResults: 20 });
        expect(result.nodes).toHaveLength(2);
        expect(result.edges).toHaveLength(2);
        expect(result.expanded).toEqual([object.uri, child.uri]);
        expect(get).toHaveBeenCalledTimes(['TABL', 'FUNC', 'VIEW'].includes(row[0]!) ? 2 : 1);
        expect(result.coverage).toBe('unknown');
      }
    },
  );
  it('accepts only qualified native aliases without changing other tools normalization', () => {
    for (const [type, native] of observed)
      expect(LiveRelationsInput.parse({ action: 'relations', type: native, name: 'ZROOT' }).type).toBe(type);
    expect(LiveRelationsInput.safeParse({ action: 'relations', type: 'ENHO/UNVERIFIED', name: 'ZROOT' }).success).toBe(
      false,
    );
  });
  it('fills an omitted root package once and keeps cycles consistent', async () => {
    const { provider, object, metadata, get, post } = setup(observed.find(([type]) => type === 'BDEF')!);
    get.mockResolvedValue({ statusCode: 200, headers: {}, body: metadata.replace('<packageRef name="ZTEST"/>', '') });
    const child = relationObject('ZCHILD');
    post
      .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: relationXml(object, [child]) })
      .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: relationXml(child, [object]) });
    const root = await provider.validateRoot('BDEF', object.name);
    expect(root.package).toBe('');
    const result = await walkRelations(root, provider, { direction: 'outgoing', depth: 3, maxResults: 20 });
    expect(result.nodes[0]!.package).toBe('ZTEST');
    expect(root.package).toBe('');
    expect(result.qualification).toContain('RAP source dependencies');
  });
  it.each(['TABL', 'FUNC', 'VIEW'])('%s refuses ambiguous, unsafe or wrong-type resolution', async (type) => {
    const row = observed.find(([root]) => root === type)!;
    const mutations = [
      (s: string) =>
        s.replace(
          '</objectReferences>',
          `${s.slice(s.indexOf('<objectReference '), s.indexOf('</objectReferences>'))}</objectReferences>`,
        ),
      (s: string) => s.replace('/ACME/ROOT', 'OTHER'),
      (s: string) => s.replace(`type="${row[1]}"`, 'type="CLAS/OC"'),
      (s: string) => s.replace(/uri="[^"]+"/, 'uri="/sap/bc/adt/discovery"'),
      () => '<objectReferences/>',
    ];
    for (const change of mutations) {
      const { provider, resolution, get, post } = setup(row);
      get.mockResolvedValue({ statusCode: 200, headers: {}, body: change(resolution) });
      await expect(provider.validateRoot(type, '/ACME/ROOT')).rejects.toThrow();
      expect(get).toHaveBeenCalledTimes(1);
      expect(post).not.toHaveBeenCalled();
    }
  });
  it.each(['TABL', 'FUNC', 'VIEW'])('%s rejects invalid names before even resolving', async (type) => {
    const { provider, get } = setup(observed.find(([root]) => root === type)!);
    await expect(provider.validateRoot(type, 'Z*')).rejects.toThrow('invalid root name');
    expect(get).not.toHaveBeenCalled();
  });
  it.each(['TABL', 'FUNC', 'VIEW'])('%s explains a legitimate empty exact search as unresolved', async (type) => {
    const { provider, get, post } = setup(observed.find(([root]) => root === type)!);
    get.mockResolvedValue({ statusCode: 200, headers: {}, body: '<objectReferences/>' });
    await expect(provider.validateRoot(type, 'ZABSENT')).rejects.toThrow('root resolution is missing or ambiguous');
    // In particular, never accept VIT's synthetic "active" metadata for an absent VIEW.
    expect(get).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });
  it('normalizes only verified function/group/pool name forms', () => {
    for (const group of ['GROUP', '/ACME/GROUP']) {
      const uri = relationObjectUri('FUNC', 'ZFUNCTION', group);
      const pool = group === 'GROUP' ? 'SAPLGROUP' : '/ACME/SAPLGROUP';
      for (const prefix of [group, pool])
        expect(relationReferenceName(`${prefix.padEnd(40)}ZFUNCTION`, 'FUGR/FF', uri)).toBe('ZFUNCTION');
      expect(relationReferenceName('ZFUNCTION', 'FUGR/FF', uri)).toBe('ZFUNCTION');
      expect(() => relationReferenceName(`${'WRONG'.padEnd(40)}ZFUNCTION`, 'FUGR/FF', uri)).toThrow('mismatch');
    }
  });
  it('preserves a CDS entity source anchor as an unexpanded, distinct boundary', async () => {
    const root = { ...relationObject('ZROLE'), type: 'DCLS/DL', uri: relationObjectUri('DCLS', 'ZROLE') };
    const entity = {
      ...root,
      name: 'ZENTITY',
      type: 'STOB/DO',
      uri: '/sap/bc/adt/ddic/ddl/sources/zsource/source/main#name=zentity',
    };
    const network = normalizeRelationNetwork(relationXml(root, [entity]), 'ENV', root);
    const provider = { options: {}, lookup: vi.fn().mockResolvedValue(network) };
    const result = await walkRelations(root, provider, { direction: 'outgoing', depth: 3, maxResults: 20 });
    expect(result.scopeBoundaries).toEqual([{ uri: entity.uri, reason: 'type' }]);
    expect(provider.lookup).toHaveBeenCalledTimes(1);
    for (const bad of ['#name=zentity%0A', '#other=zentity', '#name=zentity&x=1', '#name=%252Fbad', '#name=../bad']) {
      expect(() =>
        normalizeRelationNetwork(
          relationXml(root, [{ ...entity, uri: entity.uri.replace('#name=zentity', bad) }]),
          'ENV',
          root,
        ),
      ).toThrow();
    }
  });
  it('retains refusal for same-URI, different-type SAP enhancement identities', () => {
    const root = relationObject('ZROOT');
    const spot = { ...root, name: 'ZSPOT', type: 'ENHS/XSB', uri: '/sap/bc/adt/enhancements/enhsxsb/zspot' };
    expect(() =>
      normalizeRelationNetwork(relationXml(root, [spot, { ...spot, type: 'ENHS/XB' }]), 'ENV', root),
    ).toThrow('conflicting native object identity');
  });
});
