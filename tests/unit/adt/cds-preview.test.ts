import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CDS_PREVIEW_PATH, parseCdsPreviewRows } from '../../../src/adt/cds-preview.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { handleToolCall } from '../../../src/handlers/dispatch.js';
import { requestContext } from '../../../src/server/context.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

const fetch = vi.hoisted(() => vi.fn());
vi.mock('undici', async (importOriginal) => ({ ...(await importOriginal<typeof import('undici')>()), fetch }));
const { AdtClient } = await import('../../../src/adt/client.js');
const ddl = 'Z_DDL';
const entity = 'Z_ENTITY';
const ddlXml = `<ddlSource name="${ddl}" type="DDLS/DF" version="active" source_type="view"/>`;
const metaXml = `<tableData><name>Z_SQL_VIEW</name><cdsEntityName>${entity}</cdsEntityName><columns><metadata name="CARRID"/><dataSet/></columns></tableData>`;
const rowsXml =
  '<tableData><totalRows>0</totalRows><columns><metadata name="CARRID"/><dataSet><data>LH</data><data>AA</data></dataSet></columns></tableData>';
let ddlBody: string, metaBody: string, dataBody: string;
let metadataStatus: number;
beforeEach(() => {
  fetch.mockReset();
  ddlBody = ddlXml;
  metaBody = metaXml;
  dataBody = rowsXml;
  metadataStatus = 200;
  fetch.mockImplementation(async (url: string, init: RequestInit) => {
    const parsed = new URL(url);
    if (init.method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'TEST' });
    if (parsed.pathname === '/sap/bc/adt/discovery')
      return mockResponse(
        200,
        `<service xmlns="http://www.w3.org/2007/app"><workspace><collection href="${CDS_PREVIEW_PATH}"/></workspace></service>`,
      );
    if (parsed.pathname.startsWith('/sap/bc/adt/ddic/ddl/sources/')) return mockResponse(200, ddlBody);
    if (parsed.pathname.endsWith('/metadata')) return mockResponse(metadataStatus, metaBody);
    if (init.method === 'POST' && parsed.pathname === CDS_PREVIEW_PATH) return mockResponse(200, dataBody);
    throw new Error(`Unexpected request ${init.method} ${parsed.pathname}`);
  });
});
function client(overrides: ConstructorParameters<typeof AdtClient>[0] = { baseUrl: 'http://sap.invalid' }) {
  const c = new AdtClient({
    baseUrl: 'http://sap.invalid',
    safety: { ...defaultSafetyConfig(), allowDataPreview: true },
    ...overrides,
  });
  c.http.setDiscoveryMap(new Map([[CDS_PREVIEW_PATH, []]]));
  return c;
}
const posts = () => fetch.mock.calls.filter(([, init]) => init.method === 'POST');

describe('native CDS preview', () => {
  it.each([
    [{ ...DEFAULT_CONFIG, allowDataPreview: true }, ['read'], 'Insufficient scope'],
    [{ ...DEFAULT_CONFIG, allowDataPreview: true, denyActions: ['SAPRead.CDS_PREVIEW'] }, ['read', 'data'], 'denied'],
  ] as const)('enforces MCP scopes and action denials before SAP', async (config, scopes, message) => {
    const result = await handleToolCall(
      client(),
      { ...config, denyActions: 'denyActions' in config ? [...config.denyActions] : [] },
      'SAPRead',
      { type: 'CDS_PREVIEW', name: ddl },
      { token: 'TEST', clientId: 'test', scopes: [...scopes] },
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain(message);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('queries the entity instead of the DDLS/SQL-view name and trims lookahead without inventing a total', async () => {
    const result = await client().runCdsPreview('z_ddl', {
      columns: ['CARRID'],
      where: [{ field: 'CARRID', op: '=', value: "L'H" }],
      maxRows: 1,
    });
    expect(result).toEqual({
      ddlSource: ddl,
      cdsEntityName: entity,
      columns: ['CARRID'],
      rows: [{ CARRID: 'LH' }],
      truncated: true,
    });
    expect(posts()).toHaveLength(1);
    expect(posts()[0]?.[1].body).toBe("SELECT CARRID FROM Z_ENTITY WHERE CARRID = 'L''H'");
    expect(new URL(posts()[0]![0]).searchParams.get('rowNumber')).toBe('2');
    expect(new URL(posts()[0]![0]).searchParams.get('ddlSourceName')).toBe(ddl);
  });
  it('allows a schema-only empty result', async () => {
    dataBody = metaXml;
    expect(await client().runCdsPreview(ddl)).toMatchObject({ rows: [], truncated: false });
  });
  it('requires data-preview opt-in before even metadata', async () => {
    await expect(
      client({ baseUrl: 'http://sap.invalid', safety: defaultSafetyConfig() }).runCdsPreview(ddl),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects an explicitly blocked DDLS before metadata', async () => {
    await expect(
      client({
        baseUrl: 'http://sap.invalid',
        safety: { ...defaultSafetyConfig(), allowDataPreview: true, blockedDataSources: [ddl] },
      }).runCdsPreview(ddl),
    ).rejects.toMatchObject({ code: 'DATA_SOURCE_BLOCKED' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects a blocked resolved entity before any data POST', async () => {
    await expect(
      client({
        baseUrl: 'http://sap.invalid',
        safety: { ...defaultSafetyConfig(), allowDataPreview: true, blockedDataSources: [entity] },
      }).runCdsPreview(ddl),
    ).rejects.toMatchObject({ code: 'DATA_SOURCE_BLOCKED' });
    expect(posts()).toHaveLength(0);
  });
  it('requires advertised discovery, loading it when unknown', async () => {
    const c = client();
    c.http.setDiscoveryMap(new Map());
    await c.runCdsPreview(ddl);
    expect(fetch.mock.calls.some(([url]) => new URL(url).pathname === '/sap/bc/adt/discovery')).toBe(true);
    fetch.mockClear();
    c.http.setDiscoveryMap(new Map([['/sap/bc/adt/other', []]]));
    await expect(c.runCdsPreview(ddl)).rejects.toThrow('discovery');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    ddlXml.replace('active', 'inactive'),
    ddlXml.replace(ddl, 'OTHER'),
    ddlXml.replace('DDLS/DF', 'TABL/DT'),
    ddlXml.replace('source_type="view"', 'source_type="table function"'),
  ])('rejects an unproved active view: %s', async (body) => {
    ddlBody = body;
    await expect(client().runCdsPreview(ddl)).rejects.toThrow();
    expect(posts()).toHaveLength(0);
  });
  it.each([
    '<html>login</html>',
    '<tableData/>',
    metaXml.replace(entity, 'Z_ENTITY;DROP'),
    metaXml.replace('<cdsEntityName>Z_ENTITY</cdsEntityName>', ''),
    metaXml.replace('</tableData>', '<parameters><paramName>P_DATE</paramName></parameters></tableData>'),
  ])('rejects unusable metadata: %s', async (body) => {
    metaBody = body;
    await expect(client().runCdsPreview(ddl)).rejects.toThrow();
    expect(posts()).toHaveLength(0);
  });
  it.each([401, 403, 404, 500])('propagates metadata failure %i without alternate data routes', async (status) => {
    metadataStatus = status;
    await expect(
      client({ baseUrl: 'http://sap.invalid', retryUnauthorized: false }).runCdsPreview(ddl),
    ).rejects.toThrow();
    expect(posts()).toHaveLength(0);
  });
  it.each(['<html>login</html>', '<tableData/>', '<tableData><columns>', '<!DOCTYPE x [<!ENTITY e "x">]><tableData/>'])(
    'rejects an invalid successful data body: %s',
    async (body) => {
      expect(() => parseCdsPreviewRows(body, 1)).toThrow();
    },
  );
  it('validates columns against native metadata without a second data-read fallback', async () => {
    await expect(client().runCdsPreview(ddl, { columns: ['OTHER'] })).rejects.toThrow('unknown column');
    expect(posts()).toHaveLength(0);
  });
  it.each(['Z_DDL;SELECT', '@(something)', 'ZＤＤL'])('rejects invalid input names before SAP: %s', async (name) => {
    await expect(client().runCdsPreview(name)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['view', 'view entity'])('allows an unblocked %s through the real lineage resolver', async (kind) => {
    ddlBody = ddlXml.replace('source_type="view"', `source_type="${kind}"`);
    const original = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      if (path.includes('/repository/informationsystem/search'))
        return mockResponse(
          200,
          `<objectReferences><objectReference name="${entity}" type="STOB/DF" uri="/sap/bc/adt/ddic/ddl/sources/${ddl}"/></objectReferences>`,
        );
      if (path.endsWith('/graphdata'))
        return mockResponse(
          200,
          `<elementInfo name="${ddl}"><properties><entry key="TYPE" value="${kind === 'view' ? 'CDS_VIEW' : 'CDS_VIEW_ENTITY'}"/><entry key="ENTITY_NAME" value="${entity}"/><entry key="NODE_NAME" value="${kind === 'view' ? 'Z_SQL_VIEW' : entity}"/></properties><elementInfo name="SCARR"><properties><entry key="TYPE" value="TABLE"/></properties></elementInfo></elementInfo>`,
        );
      if (path.endsWith('/freestyle'))
        return mockResponse(
          200,
          readFileSync(new URL('../../fixtures/xml/replacement-catalog-scarr.xml', import.meta.url), 'utf8'),
        );
      return original(url, init);
    });
    const c = client({
      baseUrl: 'http://sap.invalid',
      safety: { ...defaultSafetyConfig(), allowDataPreview: true, blockedDataSources: ['USR02'] },
    });
    await expect(c.runCdsPreview(ddl)).resolves.toMatchObject({ cdsEntityName: entity });
    expect(posts().filter(([url]) => new URL(url).pathname === CDS_PREVIEW_PATH)).toHaveLength(1);
  });
  it('encodes a namespaced DDLS in metadata paths and preserves the resolved entity', async () => {
    ddlBody = ddlXml.replace(ddl, '/NS/DDL');
    metaBody = metaXml.replace(entity, '/NS/ENTITY');
    await expect(client().runCdsPreview('/NS/DDL')).resolves.toMatchObject({
      ddlSource: '/NS/DDL',
      cdsEntityName: '/NS/ENTITY',
    });
    expect(fetch.mock.calls.some(([url]) => new URL(url).pathname.endsWith('/%2FNS%2FDDL/metadata'))).toBe(true);
    expect(posts()[0]?.[1].body).toBe('SELECT * FROM /NS/ENTITY');
  });
  it('wraps a long SQL statement while retaining its final restrictive condition', async () => {
    await client().runCdsPreview(ddl, {
      where: [
        ...Array.from({ length: 25 }, () => ({ field: 'CARRID', op: 'LIKE', value: '%' })),
        { field: 'CARRID', op: '=', value: 'ZZZ' },
      ],
    });
    const sql = String(posts()[0]?.[1].body);
    expect(sql.length).toBeGreaterThan(255);
    expect(Math.max(...sql.split(/\r?\n/).map((line) => line.length))).toBeLessThanOrEqual(255);
    expect(sql).toMatch(/CARRID = 'ZZZ'$/);
  });
  it('honors caller cancellation before metadata', async () => {
    await expect(
      requestContext.run({ requestId: 'CANCEL-CDS', signal: AbortSignal.abort() }, () => client().runCdsPreview(ddl)),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('shares the cumulative response ceiling across metadata and data', async () => {
    await expect(
      client({
        baseUrl: 'http://sap.invalid',
        maxDataPreviewResponseBytes: Buffer.byteLength(ddlXml + metaXml + rowsXml) - 1,
      }).runCdsPreview(ddl),
    ).rejects.toMatchObject({ code: 'DATA_RESPONSE_TOO_LARGE' });
    expect(posts()).toHaveLength(1);
  });
});
