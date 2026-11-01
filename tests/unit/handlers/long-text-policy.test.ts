import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { escapeXmlAttr } from '../../../src/adt/xml-parser.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { createLongTextFixture } from '../../helpers/long-text-fixture.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { logger } = await import('../../../src/server/logger.js');

const sources = ['TTXOB', 'TTXID', 'T002', 'STXH', 'STXL'];
const config = {
  ...DEFAULT_CONFIG,
  systemType: 'onprem' as const,
  allowDataPreview: true,
  allowWrites: false,
  allowFreeSQL: false,
};
const auth = { token: 'test', clientId: 'test', scopes: ['data'], expiresAt: 9_999_999_999 };

function tableXml(row: Record<string, string>): string {
  return (
    '<dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview">' +
    Object.entries(row)
      .map(
        ([name, value]) =>
          `<dataPreview:columns><dataPreview:metadata dataPreview:name="${escapeXmlAttr(name)}"/>` +
          `<dataPreview:dataSet><dataPreview:data>${escapeXmlAttr(value)}</dataPreview:data>` +
          '</dataPreview:dataSet></dataPreview:columns>',
      )
      .join('') +
    '</dataPreview:tableData>'
  );
}

function setup(blockedDataSources = ['USR02'], replacement = '', catalogStatus = 200) {
  const fixture = createLongTextFixture();
  const client = new AdtClient({
    baseUrl: 'https://sap.invalid',
    client: '001',
    safety: { ...defaultSafetyConfig(), allowDataPreview: true, blockedDataSources },
  });
  const catalogReads: string[] = [];
  const dataReads: string[] = [];
  mockFetch.mockImplementation(async (url: string, options: RequestInit) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/repository/informationsystem/search')) {
      const name = parsed.searchParams.get('query')!;
      return mockResponse(
        200,
        '<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">' +
          `<adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/tables/${name}" ` +
          `adtcore:type="TABL/DT" adtcore:name="${name}"/></adtcore:objectReferences>`,
      );
    }
    if (options.method !== 'POST') return mockResponse(200, '', { 'x-csrf-token': 'TOKEN' });
    expect(parsed.pathname).toBe('/sap/bc/adt/datapreview/freestyle');
    const sql = String(options.body);
    if (sql.includes('FROM DD02L AS d')) {
      const name = /d~TABNAME = '([A-Z0-9_]+)'/u.exec(sql)![1];
      catalogReads.push(name);
      return mockResponse(
        catalogStatus,
        tableXml({
          TABNAME: name,
          TABCLASS: name === 'STXL' && replacement ? 'CLUSTER' : 'TRANSP',
          VIEWREF: '',
          VIEWREF_ERR: '',
          SQLTAB: name === 'STXL' ? replacement : '',
          DDLNAME: '',
        }),
      );
    }
    const name = / FROM ([A-Z0-9_]+) /u.exec(sql)![1];
    expect(sources).toContain(name);
    dataReads.push(name);
    // The request reads one exact fixture key; the first row in each table is its data.
    return mockResponse(200, tableXml(fixture.tables[name][0]));
  });
  const args = { action: 'long_text', longText: { mode: 'read', keys: [fixture.keys.invoice] } };
  return { client, args, key: fixture.keys.invoice, catalogReads, dataReads };
}

beforeEach(() => {
  vi.resetAllMocks();
  resetCachedFeatures();
});
afterEach(() => {
  vi.restoreAllMocks();
  resetCachedFeatures();
});

describe('long_text through real table queries and data-source lineage', () => {
  it('reads and decodes permitted stored text while an unrelated source is blocked', async () => {
    const { client, args, key, catalogReads, dataReads } = setup();
    const audit = vi.spyOn(logger, 'emitAudit');
    const result = await handleToolCall(client, { ...config, blockedDataSources: ['USR02'] }, 'SAPQuery', args, auth);

    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      mode: 'read',
      items: [{ status: 'ok', key, lines: [{ format: '*', text: 'Payment within 30 days.' }] }],
    });
    expect(new Set(dataReads)).toEqual(new Set(sources));
    expect(catalogReads).toEqual(dataReads);
    const searches = mockFetch.mock.calls
      .map(([url]) => new URL(String(url)))
      .filter((url) => url.pathname.endsWith('/repository/informationsystem/search'));
    expect(searches.map((url) => url.searchParams.get('query'))).toEqual(dataReads);
    expect(audit.mock.calls.filter(([event]) => event.event === 'data_source_policy_decision')).toEqual(
      dataReads.map(() => [expect.objectContaining({ decision: 'allow' })]),
    );
  });

  it.each([false, true])('explains a denied storage container with minimalErrors=%s', async (minimalErrors) => {
    const privateContainer = 'Z_PRIVATE_TEXT_STORE';
    const { client, args, dataReads } = setup([privateContainer], privateContainer);
    const result = await handleToolCall(
      client,
      { ...config, blockedDataSources: [privateContainer], minimalErrors },
      'SAPQuery',
      args,
      auth,
    );

    expect(result.isError).toBe(true);
    const message = result.content[0]!.text;
    expect(message).toContain('DATA_SOURCE_BLOCKED');
    expect(message).toContain('executed=false');
    expect(message).toContain('Affected: SAPQuery(action="long_text")');
    expect(message).toContain('application-specific released API');
    expect(message).toContain('do not bypass the policy with RFC, helpers, or free SQL');
    expect(dataReads).not.toContain('STXL');
    if (minimalErrors) {
      expect(message).not.toContain(privateContainer);
      expect(message).not.toContain('Source path:');
      expect(message).not.toContain('SAP_BLOCKED_DATA_SOURCES');
    } else {
      expect(message).toContain(`STXL -> ${privateContainer}`);
    }
  });

  it('keeps stored-text guidance when required policy metadata is unavailable', async () => {
    const { client, args, dataReads } = setup(['USR02'], '', 404);
    const result = await handleToolCall(
      client,
      { ...config, blockedDataSources: ['USR02'], minimalErrors: true },
      'SAPQuery',
      args,
      auth,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('DATA_POLICY_UNAVAILABLE');
    expect(result.content[0]!.text).toContain('Affected: SAPQuery(action="long_text")');
    expect(result.content[0]!.text).not.toContain('SAP_BLOCKED_DATA_SOURCES');
    expect(dataReads).toEqual([]);
  });
});
