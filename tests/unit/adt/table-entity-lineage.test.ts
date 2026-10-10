import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSourceBlocklistGuard, parseCdsDependencyGraph } from '../../../src/adt/data-source-policy.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from '../handlers/setup-undici-mock.js';

const fixture = (name: string) => readFileSync(new URL(`../../fixtures/xml/${name}.xml`, import.meta.url), 'utf8');
const captured = fixture('cds-dependency-graph-btp-table-entity');
const metadata =
  '<ddl:ddlSource xmlns:ddl="http://www.sap.com/adt/ddic/ddlsources" xmlns:adtcore="http://www.sap.com/adt/core" ddl:source_type="table entity" adtcore:name="ZTABLE_ENTITY" adtcore:type="DDLS/DF" adtcore:version="active"/>';
const unsupported = () =>
  new AdtApiError(
    'unsupported',
    400,
    '/graphdata',
    '<exception><type id="NoDependencyGraphDataCalculationPossible"/></exception>',
  );
const search = (name: string) => [
  {
    objectName: name,
    objectType: 'STOB/DO',
    uri: `/sap/bc/adt/ddic/ddl/sources/${name.toLowerCase()}/source/main#name=${name.toLowerCase()}`,
  },
];
function backend() {
  return {
    searchObject: vi.fn(async (name: string) => search(name)),
    readTableReplacement: vi.fn(async () => undefined),
    dependencyGraphAccept: () => undefined,
    readDependencyGraph: vi.fn(async (path: string) => {
      if (path.includes('ddlsourceName=ZTABLE_ENTITY')) throw unsupported();
      return captured;
    }),
    readActiveDdlMetadata: vi.fn(async (_name: string) => metadata),
  };
}
describe('active table-entity proof', () => {
  it('never accepts the captured empty TYPE without independent proof', () =>
    expect(() => parseCdsDependencyGraph(captured)).toThrow(/missing TYPE/));
  it.each(['ZTABLE_ENTITY', 'ZVIEW_ENTITY'])(
    'proves direct/transitive physical source %s without DD02L',
    async (name) => {
      const b = backend();
      await new DataSourceBlocklistGuard(['USR02'], b).enforceSources([name]);
      expect(b.readActiveDdlMetadata).toHaveBeenCalledWith('ZTABLE_ENTITY');
      expect(b.readTableReplacement).not.toHaveBeenCalled();
    },
  );
  it('proves both native FROM and INNER_JOIN terminal shapes', async () => {
    const b = backend();
    b.readDependencyGraph.mockResolvedValue(fixture('cds-dependency-graph-btp-table-entity-join'));
    await new DataSourceBlocklistGuard(['USR02'], b).enforceSources(['ZVIEW_ENTITY']);
    expect(b.readActiveDdlMetadata).toHaveBeenCalledWith('ZTABLE_ENTITY');
  });
  it('bounds additional native identity proofs at 64', async () => {
    const b = backend();
    const leaf = captured.slice(
      captured.indexOf('<abapsource:elementInfo>'),
      captured.lastIndexOf('</abapsource:elementInfo>'),
    );
    const xml =
      captured.slice(0, captured.indexOf('<abapsource:elementInfo>')) +
      Array.from({ length: 65 }, (_, i) => leaf.replaceAll('ZTABLE_ENTITY', `ZTABLE_${i}`)).join('') +
      '</abapsource:elementInfo>';
    b.readDependencyGraph.mockResolvedValue(xml);
    b.readActiveDdlMetadata.mockImplementation(async (name) => metadata.replace('ZTABLE_ENTITY', name));
    await expect(new DataSourceBlocklistGuard(['USR02'], b).enforceSources(['ZVIEW_ENTITY'])).rejects.toMatchObject({
      code: 'DATA_LINEAGE_UNRESOLVED',
      reason: 'table-entity proof limit exceeded',
    });
    expect(b.readActiveDdlMetadata).not.toHaveBeenCalled();
  });
  it('requires fresh active proof on a following decision', async () => {
    const b = backend();
    await new DataSourceBlocklistGuard(['USR02'], b).enforceSources(['ZVIEW_ENTITY']);
    b.readActiveDdlMetadata.mockResolvedValue(metadata.replace('table entity', 'view entity'));
    await expect(new DataSourceBlocklistGuard(['USR02'], b).enforceSources(['ZVIEW_ENTITY'])).rejects.toMatchObject({
      code: 'DATA_LINEAGE_UNRESOLVED',
    });
    expect(b.readActiveDdlMetadata).toHaveBeenCalledTimes(2);
  });
  it.each(['ZTABLE_ENTITY', 'ZVIEW_ENTITY'])('denies blocked table through %s', async (name) => {
    const b = backend();
    await expect(new DataSourceBlocklistGuard(['ZTABLE_ENTITY'], b).enforceSources([name])).rejects.toMatchObject({
      code: 'DATA_SOURCE_BLOCKED',
    });
    if (name === 'ZTABLE_ENTITY') expect(b.searchObject).not.toHaveBeenCalled();
  });
  it.each([
    metadata.replace('table entity', 'view entity'),
    metadata.replace('active', 'inactive'),
    metadata.replace('ZTABLE_ENTITY', 'OTHER'),
    metadata.replace('DDLS/DF', 'STOB/DO'),
    '<missing/>',
  ])('refuses incomplete or contradictory active metadata %s', async (xml) => {
    const b = backend();
    b.readActiveDdlMetadata.mockResolvedValue(xml);
    await expect(new DataSourceBlocklistGuard(['USR02'], b).enforceSources(['ZVIEW_ENTITY'])).rejects.toMatchObject({
      code: 'DATA_LINEAGE_UNRESOLVED',
    });
  });
  it.each([400, 403, 404, 500])('does not recover arbitrary graph HTTP%s with metadata', async (status) => {
    const b = backend();
    b.readDependencyGraph.mockRejectedValue(new AdtApiError('other', status, '<error/>'));
    await expect(new DataSourceBlocklistGuard(['USR02'], b).enforceSources(['ZTABLE_ENTITY'])).rejects.toMatchObject({
      code: 'DATA_LINEAGE_UNRESOLVED',
    });
    expect(b.readActiveDdlMetadata).not.toHaveBeenCalled();
  });
  it.each([403, 404])('refuses active metadata HTTP%s', async (status) => {
    const b = backend();
    b.readActiveDdlMetadata.mockRejectedValue(new AdtApiError('private', status, ''));
    await expect(new DataSourceBlocklistGuard(['USR02'], b).enforceSources(['ZTABLE_ENTITY'])).rejects.toMatchObject({
      code: 'DATA_LINEAGE_UNRESOLVED',
    });
  });
  it('refuses ambiguous search or different source names', async () => {
    for (const ambiguous of [true, false]) {
      const b = backend();
      b.searchObject.mockImplementation(async (name) =>
        name === 'ZTABLE_ENTITY'
          ? ambiguous
            ? [...search(name), ...search(name).map((x) => ({ ...x, uri: '/sap/bc/adt/ddic/ddl/sources/other' }))]
            : search(name).map((x) => ({ ...x, uri: '/sap/bc/adt/ddic/ddl/sources/other' }))
          : search(name),
      );
      await expect(new DataSourceBlocklistGuard(['USR02'], b).enforceSources(['ZVIEW_ENTITY'])).rejects.toMatchObject({
        code: 'DATA_LINEAGE_UNRESOLVED',
      });
      expect(b.readActiveDdlMetadata).not.toHaveBeenCalled();
    }
  });
  it.each([
    captured.replace('key="TYPE"/>', 'key="TYPE">ALIEN</abapsource:entry>'),
    captured.replace('key="TYPE"/>', 'key="TYPE">TABLE_ENTITY</abapsource:entry>'),
    captured.replace('key="TYPE"/>', 'key="OTHER"/>'),
    captured.replace('key="NODE_NAME">ZTABLE_ENTITY', 'key="NODE_NAME">OTHER'),
    captured.replace('key="RELATION">FROM', 'key="RELATION">ASSOCIATION'),
    captured.replace('key="AC_STATE">NA', 'key="DB_EXISTS">'),
    captured.replace(
      '</abapsource:elementInfo></abapsource:elementInfo>',
      '<abapsource:elementInfo/></abapsource:elementInfo></abapsource:elementInfo>',
    ),
  ])('refuses malformed/unverified graph shape', async (xml) => {
    const b = backend();
    b.readDependencyGraph.mockResolvedValue(xml);
    await expect(new DataSourceBlocklistGuard(['USR02'], b).enforceSources(['ZVIEW_ENTITY'])).rejects.toMatchObject({
      code: 'DATA_LINEAGE_UNRESOLVED',
    });
    expect(b.readActiveDdlMetadata).not.toHaveBeenCalled();
  });
});

describe('table entities at the data execution boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (url.includes('/repository/informationsystem/search')) {
        const name = new URL(url).searchParams.get('query')!;
        return mockResponse(
          200,
          `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:name="${name}" adtcore:type="STOB/DO" adtcore:uri="/sap/bc/adt/ddic/ddl/sources/${name.toLowerCase()}/source/main#name=${name.toLowerCase()}"/></adtcore:objectReferences>`,
        );
      }
      if (url.includes('/graphdata')) return mockResponse(200, captured);
      if (url.includes('/ddl/sources/')) return mockResponse(200, metadata);
      return mockResponse(200, opts?.method === 'POST' ? fixture('table-contents') : '', { 'x-csrf-token': 'T' });
    });
  });
  const reads = [
    ['SAPQuery', (c: ReturnType<typeof createClient>) => c.runQuery('SELECT * FROM ZVIEW_ENTITY')],
    ['TABLE_QUERY', (c: ReturnType<typeof createClient>) => c.runTableQuery('ZVIEW_ENTITY')],
    ['TABLE_CONTENTS', (c: ReturnType<typeof createClient>) => c.getTableContents('ZVIEW_ENTITY')],
  ] as const;
  it.each(reads)('proves metadata before one %s data POST', async (_, read) => {
    const c = createClient();
    await read(c.withSafety({ ...c.safety, blockedDataSources: ['USR02'] }));
    const posts = mockFetch.mock.calls.filter(([, o]) => o?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(mockFetch.mock.calls.find(([url]) => url.includes('/ddl/sources/'))?.[0]).toContain('?version=active');
  });
  it.each(reads)('withholds all %s data POSTs for blocked descendants', async (_, read) => {
    const c = createClient();
    await expect(read(c.withSafety({ ...c.safety, blockedDataSources: ['ZTABLE_ENTITY'] }))).rejects.toMatchObject({
      code: 'DATA_SOURCE_BLOCKED',
    });
    expect(mockFetch.mock.calls.filter(([, o]) => o?.method === 'POST')).toHaveLength(0);
  });
  it('preflights every batch root before executing any chunk', async () => {
    const c = createClient();
    await expect(
      c
        .withSafety({ ...c.safety, blockedDataSources: ['ZTABLE_ENTITY'] })
        .runQueryBatch(['SELECT * FROM ZVIEW_ENTITY', 'SELECT * FROM ZTABLE_ENTITY'], 1),
    ).rejects.toMatchObject({ code: 'DATA_SOURCE_BLOCKED' });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
