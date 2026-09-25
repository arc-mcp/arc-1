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
});
