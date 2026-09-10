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
  {
    type: 'CLAS',
    native: 'CLAS/OC',
    path: 'oo/classes',
    metadataRoot: 'abapClass',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'INTF',
    native: 'INTF/OI',
    path: 'oo/interfaces',
    metadataRoot: 'abapInterface',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'DDLS',
    native: 'DDLS/DF',
    path: 'ddic/ddl/sources',
    metadataRoot: 'ddlSource',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'DCLS',
    native: 'DCLS/DL',
    path: 'acm/dcl/sources',
    metadataRoot: 'dclSource',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'BDEF',
    native: 'BDEF/BDO',
    path: 'bo/behaviordefinitions',
    metadataRoot: 'blueSource',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'SRVD',
    native: 'SRVD/SRV',
    path: 'ddic/srvd/sources',
    metadataRoot: 'srvdSource',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'TABL',
    native: 'TABL/DT',
    path: 'ddic/tables',
    metadataRoot: 'blueSource',
    resolve: 'quickSearch',
    nameCase: 'lower',
  },
  {
    type: 'TABL',
    native: 'TABL/DS',
    path: 'ddic/structures',
    metadataRoot: 'blueSource',
    resolve: 'quickSearch',
    nameCase: 'lower',
  },
  {
    type: 'TTYP',
    native: 'TTYP/DA',
    path: 'ddic/tabletypes',
    metadataRoot: 'tableType',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'DTEL',
    native: 'DTEL/DE',
    path: 'ddic/dataelements',
    metadataRoot: 'wbobj',
    resolve: 'path',
    nameCase: 'lower',
  },
  { type: 'DOMA', native: 'DOMA/DD', path: 'ddic/domains', metadataRoot: 'domain', resolve: 'path', nameCase: 'lower' },
  {
    type: 'PROG',
    native: 'PROG/P',
    path: 'programs/programs',
    metadataRoot: 'abapProgram',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'INCL',
    native: 'PROG/I',
    path: 'programs/includes',
    metadataRoot: 'abapInclude',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'FUGR',
    native: 'FUGR/F',
    path: 'functions/groups',
    metadataRoot: 'abapFunctionGroup',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'FUNC',
    native: 'FUGR/FF',
    path: 'functions/groups',
    metadataRoot: 'abapFunctionModule',
    resolve: 'quickSearch',
    nameCase: 'lower',
  },
  {
    type: 'VIEW',
    native: 'VIEW/DV',
    path: 'vit/wb/object_type/viewdv/object_name',
    metadataRoot: 'mainObject',
    resolve: 'quickSearch',
    nameCase: 'upper',
  },
  {
    type: 'ENHO',
    native: 'ENHO/XHB',
    path: 'enhancements/enhoxhb',
    metadataRoot: 'objectData',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'MSAG',
    native: 'MSAG/N',
    path: 'messageclass',
    metadataRoot: 'messageClass',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'TRAN',
    native: 'TRAN/T',
    path: 'vit/wb/object_type/trant/object_name',
    metadataRoot: 'mainObject',
    resolve: 'quickSearch',
    nameCase: 'upper',
  },
  {
    type: 'SOBJ',
    native: 'SOBJ/MO',
    path: 'vit/wb/object_type/sobjmo/object_name',
    metadataRoot: 'mainObject',
    resolve: 'quickSearch',
    nameCase: 'upper',
  },
  {
    type: 'SHLP',
    native: 'SHLP/DH',
    path: 'vit/wb/object_type/shlpdh/object_name',
    metadataRoot: 'mainObject',
    resolve: 'quickSearch',
    nameCase: 'upper',
  },
  {
    type: 'SKTD',
    native: 'SKTD/TYP',
    path: 'documentation/ktd/documents',
    metadataRoot: 'docu',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'ENHS',
    native: 'ENHS/XSB',
    path: 'enhancements/enhsxsb',
    metadataRoot: 'objectData',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'ENQU',
    native: 'ENQU/DL',
    path: 'ddic/lockobjects/sources',
    metadataRoot: 'lockobject',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'TYPE',
    native: 'TYPE/DG',
    path: 'ddic/typegroups',
    metadataRoot: 'abapTypeGroup',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'EVTB',
    native: 'EVTB/EVB',
    path: 'businessservices/evtbevb',
    metadataRoot: 'blueSource',
    resolve: 'path',
    nameCase: 'lower',
  },
  {
    type: 'DSFD',
    native: 'DSFD/SCF',
    path: 'ddic/dsfd/sources',
    metadataRoot: 'blueSource',
    resolve: 'path',
    nameCase: 'lower',
  },
] as const;

function setup(row: (typeof observed)[number], name = '/ACME/ROOT') {
  const { type, native, path, metadataRoot: tag } = row;
  const group = '/ACME/GROUP';
  const segment = encodeURIComponent(row.nameCase === 'upper' ? name.toUpperCase() : name.toLowerCase());
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
  it('explains a missing root type without guessing from the references filter', () => {
    const result = LiveRelationsInput.safeParse({ action: 'relations', name: 'ZROOT', objectType: 'CLAS' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ['type'], message: expect.stringContaining('Retry with type and name') }),
          expect.objectContaining({ code: 'unrecognized_keys', keys: ['objectType'] }),
        ]),
      );
    }
  });
  it('has evidence for every advertised type and no unqualified roots', () => {
    expect(RELATION_OBJECTS).toEqual(observed);
    expect(RELATION_ROOT_TYPES).toEqual([...new Set(observed.map(({ type }) => type))]);
    for (const type of RELATION_ROOT_TYPES)
      expect(LiveRelationsInput.safeParse({ action: 'relations', type, name: 'ZROOT' }).success).toBe(true);
    for (const type of ['DEVC', 'DDLX', 'SRVB', 'STOB', 'AUTH', 'UIAD', 'DTDC'])
      expect(LiveRelationsInput.safeParse({ action: 'relations', type, name: 'ZROOT' }).success).toBe(false);
  });
  it.each(observed)('$type $native validates namespaced metadata, with no unbounded side requests', async (row) => {
    const { provider, object, get, post } = setup(row);
    const root = await provider.validateRoot(row.type, object.name);
    expect(root).toEqual({ ...object, existence: 'metadata_validated' });
    expect(get).toHaveBeenCalledTimes(row.resolve === 'quickSearch' ? 2 : 1);
    for (const call of get.mock.calls) expect(call[2]).toBe(provider.options);
    await provider.lookup(root, 'outgoing');
    expect(post.mock.calls[0]![4]).toBe(provider.options);
    expect(post.mock.calls[0]![1]).toContain(object.uri);
  });
  for (const invalid of ['wrong-name', 'wrong-type', 'inactive', 'new', 'wrong-envelope']) {
    it.each(observed)(`$type $native rejects ${invalid} metadata before network POST`, async (row) => {
      const { provider, metadata, resolution, get, post } = setup(row);
      const bad =
        invalid === 'wrong-name'
          ? metadata.replace('name="/ACME/ROOT"', 'name="OTHER"')
          : invalid === 'wrong-type'
            ? metadata.replace(`type="${row.native}"`, 'type="UNKNOWN/X"')
            : invalid === 'wrong-envelope'
              ? metadata.replaceAll(row.metadataRoot, 'unrelatedEnvelope')
              : metadata.replace('version="active"', `version="${invalid}"`);
      get.mockImplementation(async (url) => ({
        statusCode: 200,
        headers: {},
        body: url.includes('informationsystem') ? resolution : bad,
      }));
      await expect(provider.validateRoot(row.type, '/ACME/ROOT')).rejects.toThrow();
      expect(post).not.toHaveBeenCalled();
    });
  }
  it.each(observed)('$type $native keeps absent/denied roots terminal', async (row) => {
    for (const status of [401, 403, 404]) {
      const { provider, get, post } = setup(row);
      get.mockRejectedValue(new AdtApiError('No metadata', status, '/sap/bc/adt/'));
      await expect(provider.validateRoot(row.type, 'ZROOT')).rejects.toMatchObject({ statusCode: status });
      expect(post).not.toHaveBeenCalled();
    }
  });
  it.each(observed)(
    '$type $native expands mixed-type cycles in both directions without extra metadata reads',
    async (row) => {
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
        const root = await provider.validateRoot(row.type, object.name);
        const result = await walkRelations(root, provider, { direction, depth: 3, maxResults: 20 });
        expect(result.nodes).toHaveLength(2);
        expect(result.edges).toHaveLength(2);
        expect(result.expanded).toEqual([object.uri, child.uri]);
        expect(get).toHaveBeenCalledTimes(row.resolve === 'quickSearch' ? 2 : 1);
        expect(result.coverage).toBe('unknown');
      }
    },
  );
  it('accepts only qualified native aliases without changing other tools normalization', () => {
    for (const { type, native } of observed)
      expect(LiveRelationsInput.parse({ action: 'relations', type: native, name: 'ZROOT' }).type).toBe(type);
    expect(LiveRelationsInput.safeParse({ action: 'relations', type: 'ENHO/UNVERIFIED', name: 'ZROOT' }).success).toBe(
      false,
    );
  });
  it('fills an omitted root package once and keeps cycles consistent', async () => {
    const { provider, object, metadata, get, post } = setup(observed.find(({ type }) => type === 'BDEF')!);
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
  it.each(observed.filter(({ resolve }) => resolve === 'quickSearch'))(
    '$type refuses ambiguous, unsafe or wrong-type resolution',
    async (row) => {
      const { type } = row;
      const mutations = [
        (s: string) =>
          s.replace(
            '</objectReferences>',
            `${s.slice(s.indexOf('<objectReference '), s.indexOf('</objectReferences>'))}</objectReferences>`,
          ),
        (s: string) => s.replace('/ACME/ROOT', 'OTHER'),
        (s: string) => s.replace(`type="${row.native}"`, 'type="CLAS/OC"'),
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
    },
  );
  it.each(observed.filter(({ resolve }) => resolve === 'quickSearch'))(
    '$type rejects invalid names before even resolving',
    async (row) => {
      const { type } = row;
      const { provider, get } = setup(row);
      await expect(provider.validateRoot(type, 'Z*')).rejects.toThrow('invalid root name');
      expect(get).not.toHaveBeenCalled();
    },
  );
  it.each(observed.filter(({ resolve }) => resolve === 'quickSearch'))(
    '$type explains a legitimate empty exact search as unresolved',
    async (row) => {
      const { type } = row;
      const { provider, get, post } = setup(row);
      get.mockResolvedValue({ statusCode: 200, headers: {}, body: '<objectReferences/>' });
      await expect(provider.validateRoot(type, 'ZABSENT')).rejects.toThrow('root resolution is missing or ambiguous');
      // In particular, never accept VIT's synthetic "active" metadata for an absent VIEW.
      expect(get).toHaveBeenCalledTimes(1);
      expect(post).not.toHaveBeenCalled();
    },
  );
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
