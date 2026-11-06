import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { logger } from '../../../src/server/logger.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

const mockFetch = vi.fn();
vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<typeof import('undici')>()),
  fetch: mockFetch,
}));
const { AdtClient } = await import('../../../src/adt/client.js');
const fixture = (name: string) => readFileSync(new URL(`../../fixtures/xml/${name}.xml`, import.meta.url), 'utf8');
const data = fixture('table-contents');
const catalog = fixture('replacement-catalog-scarr');
const replacement = fixture('replacement-catalog-demo_sumdist');
const graph = fixture('cds-dependency-graph-750');
const calls = [
  ['SAPQuery', (c: InstanceType<typeof AdtClient>) => c.runQuery('SELECT * FROM SCARR')],
  ['TABLE_QUERY', (c: InstanceType<typeof AdtClient>) => c.runTableQuery('SCARR')],
  ['TABLE_CONTENTS', (c: InstanceType<typeof AdtClient>) => c.getTableContents('SCARR')],
] as const;
const posts = () => mockFetch.mock.calls.filter(([, opts]) => opts.method === 'POST');
const appPosts = () => posts().filter(([, opts]) => !String(opts.body).includes('FROM DD02L AS d'));
function client(blockedDataSources = ['USR02'], maxDataPreviewResponseBytes = 2 * 1024 * 1024) {
  const c = new AdtClient({
    baseUrl: 'http://sap:8000',
    safety: { ...unrestrictedSafetyConfig(), blockedDataSources },
    maxDataPreviewResponseBytes,
  });
  // 750 discovery has structures but lacks the canonical table source collection.
  c.http.setDiscoveryMap(new Map([['/sap/bc/adt/ddic/structures', ['text/plain']]]));
  return c;
}

let catalogBody: string;
let catalogStatus: number;
beforeEach(() => {
  catalogBody = catalog;
  catalogStatus = 200;
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string, opts: RequestInit) => {
    const path = String(url);
    if (path.includes('/repository/informationsystem/search')) {
      const name = new URL(path).searchParams.get('query') ?? 'SCARR';
      return mockResponse(
        200,
        `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/tables/${name}" adtcore:type="TABL/DT" adtcore:name="${name} (Database Table)"/></adtcore:objectReferences>`,
      );
    }
    if (path.includes('/graphdata')) return mockResponse(200, graph);
    if (opts.method === 'POST')
      return mockResponse(
        String(opts.body).includes('FROM DD02L AS d') ? catalogStatus : 200,
        String(opts.body).includes('FROM DD02L AS d') ? catalogBody : data,
      );
    return mockResponse(200, '', { 'x-csrf-token': 'TOKEN' });
  });
});

describe('catalog replacement policy through the real client', () => {
  it.each(calls)('authorizes %s without the 752 table-source resource', async (_, call) => {
    const audit = vi.spyOn(logger, 'emitAudit');
    await expect(call(client())).resolves.toMatchObject({ columns: ['MANDT', 'MTEXT', 'LOGSYS'] });
    expect(posts()).toHaveLength(2);
    expect(String(posts()[0]?.[0])).toContain('rowNumber=2');
    expect(posts()[0]?.[1].body).toContain("d~TABNAME = 'SCARR' AND d~AS4LOCAL = 'A'");
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/source/main'))).toBe(false);
    expect(audit.mock.calls.filter(([event]) => event.event === 'data_source_policy_decision')).toHaveLength(1);
    audit.mockRestore();
  });

  it('permits fixed catalog metadata under Query without granting FreeSQL', async () => {
    const c = new AdtClient({
      baseUrl: 'http://sap:8000',
      safety: { ...unrestrictedSafetyConfig(), allowFreeSQL: false, blockedDataSources: ['USR02'] },
    });
    await expect(c.runTableQuery('SCARR')).resolves.toBeDefined();
    await expect(c.runQuery('SELECT * FROM SCARR')).rejects.toThrow();
    expect(posts()).toHaveLength(2);
  });

  it.each([['SCARR'], ['DD02L'], ['DDLDEPENDENCY']])('does not read blocked catalog or root %s', async (blocked) => {
    await expect(client([blocked]).runTableQuery('SCARR')).rejects.toMatchObject({
      code: 'DATA_SOURCE_BLOCKED',
      matchedSource: blocked,
    });
    expect(posts()).toHaveLength(0);
    if (blocked === 'SCARR') expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    [403, 'DATA_LINEAGE_UNRESOLVED'],
    [404, 'DATA_POLICY_UNAVAILABLE'],
  ])('refuses catalog HTTP %s before the requested query', async (status, code) => {
    catalogStatus = Number(status);
    catalogBody = 'SECRET SAP diagnostic';
    const result = client().runTableQuery('SCARR');
    await expect(result).rejects.toMatchObject({ code });
    await expect(result).rejects.not.toThrow(/SECRET/);
    expect(appPosts()).toHaveLength(0);
  });

  it('follows the SQL-view -> DDLS mapping into the 750 dependency graph', async () => {
    catalogBody = replacement;
    await expect(client(['SPFLI']).runTableQuery('DEMO_SUMDIST')).rejects.toMatchObject({
      code: 'DATA_SOURCE_BLOCKED',
      matchedSource: 'SPFLI',
    });
    expect(mockFetch.mock.calls.find(([url]) => String(url).includes('/graphdata'))?.[0]).toContain(
      'ddlsourceName=DEMO_CDS_SUMDIST',
    );
    expect(appPosts()).toHaveLength(0);
  });

  it('selects the physical container in the one catalog query', async () => {
    await client().runTableQuery('SCARR');
    expect(posts()[0]?.[1].body).toContain('d~SQLTAB');
  });

  it('authorizes a cluster table through its unblocked container', async () => {
    catalogBody = fixture('replacement-catalog-bseg-cluster');
    await expect(client(['BSEC']).runTableQuery('BSEG')).resolves.toBeDefined();
    expect(posts()).toHaveLength(2);
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/graphdata'))).toBe(false);
  });

  it('denies a cluster table whose container is blocked before the application query', async () => {
    catalogBody = fixture('replacement-catalog-bseg-cluster');
    await expect(client(['RFBLG']).runTableQuery('BSEG')).rejects.toMatchObject({
      code: 'DATA_SOURCE_BLOCKED',
      matchedSource: 'RFBLG',
      sourcePath: ['BSEG', 'RFBLG'],
    });
    expect(appPosts()).toHaveLength(0);
  });

  it('counts catalog and application bytes in one cumulative budget', async () => {
    const limit = Math.max(Buffer.byteLength(catalog), Buffer.byteLength(data)) + 1;
    await expect(client(['USR02'], limit).runTableQuery('SCARR')).rejects.toThrow(/limit|budget|large/i);
    expect(posts()).toHaveLength(2);
  });

  it('fails closed on malformed catalog XML without running the application query', async () => {
    catalogBody = '<broken/>';
    await expect(client().runTableQuery('SCARR')).rejects.toMatchObject({ code: 'DATA_LINEAGE_UNRESOLVED' });
    expect(appPosts()).toHaveLength(0);
  });

  it.each([
    ['SAPQuery', (c: InstanceType<typeof AdtClient>) => c.runQuery('SELECT * FROM DEMO_ANALYTICAL_QUERY', 1)],
    ['TABLE_QUERY', (c: InstanceType<typeof AdtClient>) => c.runTableQuery('DEMO_ANALYTICAL_QUERY', { maxRows: 1 })],
    ['TABLE_CONTENTS', (c: InstanceType<typeof AdtClient>) => c.getTableContents('DEMO_ANALYTICAL_QUERY', 1)],
  ] as const)('denies a live empty DB_EXISTS before any %s data POST', async (_, call) => {
    const c = client();
    vi.spyOn(c, 'searchObject').mockResolvedValue([
      {
        objectName: 'DEMO_ANALYTICAL_QUERY',
        objectType: 'STOB/DO',
        uri: '/sap/bc/adt/ddic/ddl/sources/demo_analytical_query/source/main#name=DEMO_ANALYTICAL_QUERY',
        packageName: 'SABAP_DEMOS_SALES',
        description: '',
      },
    ]);
    const fallback = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation(async (url: string, opts: RequestInit) =>
      String(url).includes('/graphdata')
        ? mockResponse(200, fixture('cds-dependency-graph-758-analytical-query'))
        : fallback(url, opts),
    );
    await expect(call(c)).rejects.toMatchObject({
      code: 'DATA_LINEAGE_UNRESOLVED',
      reason: 'dependency DEMO_ANALYTICAL_QUERY is not active in the database',
    });
    expect(posts()).toHaveLength(0);
  });
});

describe.each([
  ['DEMO_CDS_SPFLI_ENTITY', 'SPFLI', 'cds-dependency-graph-758-view-entity', ['DEMO_CDS_SPFLI_ENTITY', 'SPFLI']],
  [
    'DEMO_MANAGED_ROOT_PROJ',
    'DEMO_TAB_ROOT_3',
    'cds-dependency-graph-758-projection',
    ['DEMO_MANAGED_ROOT_PROJ', 'DEMO_MANAGED_ROOT_WAS', 'DEMO_TAB_ROOT_3'],
  ],
] as const)('view-entity lineage through the real client: %s', (name, table, graphFixture, sourcePath) => {
  beforeEach(() => {
    const fallback = mockFetch.getMockImplementation()!;
    catalogBody = catalog.replaceAll('SCARR', table);
    mockFetch.mockImplementation(async (url: string, opts: RequestInit) => {
      if (String(url).includes('/repository/informationsystem/search')) {
        const uri = `/sap/bc/adt/ddic/ddl/sources/${name.toLowerCase()}`;
        return mockResponse(
          200,
          `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">` +
            `<adtcore:objectReference adtcore:uri="${uri}/source/main#name=${name.toLowerCase()}" adtcore:type="STOB/DO" adtcore:name="${name}"/>` +
            `<adtcore:objectReference adtcore:uri="${uri}" adtcore:type="DDLS/DF" adtcore:name="${name}"/>` +
            `<adtcore:objectReference adtcore:uri="/sap/bc/adt/acm/dcl/sources/${name.toLowerCase()}" adtcore:type="DCLS/DL" adtcore:name="${name}"/>` +
            `</adtcore:objectReferences>`,
        );
      }
      if (String(url).includes('/graphdata')) return mockResponse(200, fixture(graphFixture));
      return fallback(url, opts);
    });
  });

  it('authorizes one query after traversing the graph and checking its terminal table', async () => {
    const audit = vi.spyOn(logger, 'emitAudit');
    try {
      await expect(client().runQuery(`SELECT * FROM ${name}`, 1)).resolves.toBeDefined();
      expect(posts()).toHaveLength(2);
      expect(appPosts()).toHaveLength(1);
      expect(appPosts()[0]?.[1].body).toBe(`SELECT * FROM ${name}`);
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'data_source_policy_decision',
          decision: 'allow',
          metadataRequests: 3,
          graphNodes: sourcePath.length,
        }),
      );
      // No advertised graph MIME: the existing v3 probe still works unchanged.
      expect(mockFetch.mock.calls.find(([url]) => String(url).includes('/graphdata'))?.[0]).toContain(
        'addMetrics=false',
      );
    } finally {
      audit.mockRestore();
    }
  });

  it('denies a blocked descendant before any catalog or application POST', async () => {
    await expect(client([table]).runQuery(`SELECT * FROM ${name}`, 1)).rejects.toMatchObject({
      code: 'DATA_SOURCE_BLOCKED',
      matchedSource: table,
      sourcePath,
    });
    expect(posts()).toHaveLength(0);
  });
});
