import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { DataSourcePolicyError } = await import('../../../src/adt/data-source-policy.js');

const resultXml = (description = '', identifier?: string) =>
  `<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences" resultDescription="${description}"${identifier === undefined ? '' : ` referencedObjectIdentifier="${identifier}"`}>
    <usageReferences:referencedObject uri="/sap/bc/adt/oo/classes/zcl_caller" isResult="true">
      <usageReferences:adtObject xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZCL_CALLER" adtcore:type="CLAS/OC"/>
    </usageReferences:referencedObject>
  </usageReferences:usageReferenceResult>`;

describe('SAPNavigate reference cursor scope', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
  });

  it.each([
    undefined,
    'ABAPFullName;\\TY:ZIF_TEST\\ME:RUN',
    'ABAPFullName;\\TY:ZIF_OTHER',
    'ABAPFullName;\\TY:ZIF_TEST',
  ])('keeps missing or nonempty scope identifiers native-only: %j', async (identifier) => {
    // A localized description naming an interface does not establish whole-object fallback.
    mockFetch.mockResolvedValueOnce(mockResponse(200, resultXml('ZIF_TEST (Interface)', identifier)));
    const client = createClient();
    const sql = vi.spyOn(client, 'runQuery');
    const table = vi.spyOn(client, 'runTableQuery');
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPNavigate', {
      action: 'references',
      uri: '/sap/bc/adt/oo/interfaces/zif_test/source/main#start=3,12',
    });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text).total).toBe(1);
    expect(sql).not.toHaveBeenCalled();
    expect(table).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'restores confirmed whole-interface fallback enrichment (free SQL: %s)',
    async (allowFreeSQL) => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, resultXml('ZIF_TEST (Interface)', '')));
      const original = createClient();
      const client = original.withSafety({ ...original.safety, allowFreeSQL, allowDataPreview: true });
      const data = { columns: ['CLSNAME'], rows: [{ CLSNAME: 'ZCL_IMPL' }] };
      const sql = vi.spyOn(client, 'runQuery').mockResolvedValue(data);
      const table = vi.spyOn(client, 'runTableQuery').mockResolvedValue(data);
      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPNavigate', {
        action: 'references',
        uri: '/sap/bc/adt/oo/interfaces/zif_test#start=3,0',
        objectType: 'CLAS/OC',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.total).toBe(2);
      expect(parsed.references.map((row: { name: string }) => row.name)).toEqual(['ZCL_CALLER', 'ZCL_IMPL']);
      expect(parsed.warning).toBeUndefined();
      expect(sql).toHaveBeenCalledTimes(allowFreeSQL ? 1 : 0);
      expect(table).toHaveBeenCalledTimes(allowFreeSQL ? 0 : 1);
    },
  );

  it('does not enable data access for a confirmed whole-object fallback', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, resultXml('ZIF_TEST (Interface)', '')));
    const original = createClient();
    const client = original.withSafety({ ...original.safety, allowFreeSQL: false, allowDataPreview: false });
    const sql = vi.spyOn(client, 'runQuery');
    const table = vi.spyOn(client, 'runTableQuery');
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPNavigate', {
      action: 'references',
      uri: '/sap/bc/adt/oo/interfaces/zif_test#start=3,0',
    });
    expect(JSON.parse(result.content[0].text).total).toBe(1);
    expect(sql).not.toHaveBeenCalled();
    expect(table).not.toHaveBeenCalled();
  });

  it.each(['ZIF_TEST (Interface)', ''])(
    'preserves enrichment-denial warnings with description %j',
    async (description) => {
      mockFetch.mockResolvedValueOnce(mockResponse(200, resultXml(description, '')));
      const client = createClient();
      vi.spyOn(client, 'runQuery').mockRejectedValue(
        new DataSourcePolicyError('DATA_SOURCE_BLOCKED', 'SEOMETAREL', ['SEOMETAREL'], 'blocked'),
      );
      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPNavigate', {
        action: 'references',
        uri: '/sap/bc/adt/oo/interfaces/zif_test#start=3,0',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.total).toBe(1);
      expect(parsed.warning).toContain('Incomplete result:');
      expect(parsed.warning).toContain('DATA_SOURCE_BLOCKED');
      if (!description) expect(parsed.warning).toContain('did not report the searched symbol');
    },
  );

  it.each([
    '/sap/bc/adt/oo/interfaces/zif_test#start=3,12',
    '/sap/bc/adt/oo/interfaces/zif_test/source/main#start=3,12',
    '/sap/bc/adt/oo/interfaces/zif_test/source/main#type=INTF%2fME;name=RUN;start=3,12',
  ])('does not broaden a member lookup with whole-interface implementers: %s', async (uri) => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, resultXml('References for: ZIF_TEST - RUN (Method)')));
    const client = createClient();
    const sql = vi
      .spyOn(client, 'runQuery')
      .mockResolvedValue({ columns: ['CLSNAME'], rows: [{ CLSNAME: 'ZCL_OTHER' }] });
    const table = vi.spyOn(client, 'runTableQuery');
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPNavigate', {
      action: 'references',
      uri,
      objectType: 'CLAS/OC',
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.total).toBe(1);
    expect(parsed.references.map((row: { name: string }) => row.name)).toEqual(['ZCL_CALLER']);
    expect(parsed.searchedFor).toBe('References for: ZIF_TEST - RUN (Method)');
    expect(parsed.warning).toBeUndefined();
    expect(sql).not.toHaveBeenCalled();
    expect(table).not.toHaveBeenCalled();
  });

  it.each(['FUNC', 'TABL'])('rejects an incomplete cursor before resolving %s', async (type) => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPNavigate', {
      action: 'references',
      type,
      name: 'ZTEST',
      line: 3,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('need both line and column');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('warns when SAP omits the description of a cursor search', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, resultXml()));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPNavigate', {
      action: 'references',
      type: 'CLAS',
      name: 'ZTEST',
      line: '3',
      column: '0',
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.total).toBe(1);
    expect(parsed.searchedFor).toBeUndefined();
    expect(parsed.warning).toContain('did not report the searched symbol');
    const request = mockFetch.mock.calls.find(([url]) => String(url).includes('usageReferences'));
    expect(new URL(String(request?.[0])).searchParams.get('uri')).toContain('#start=3,0');
  });

  it('forwards the cursor to legacy fallback and reports unconfirmed scope', async () => {
    mockFetch.mockRejectedValueOnce(new AdtApiError('Not found', 404, '/usageReferences'));
    mockFetch.mockResolvedValueOnce(
      mockResponse(
        200,
        '<usageReferences><objectReference uri="/caller" type="PROG/P" name="ZCALLER"/></usageReferences>',
      ),
    );
    const client = createClient();
    const sql = vi.spyOn(client, 'runQuery');
    const table = vi.spyOn(client, 'runTableQuery');
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPNavigate', {
      action: 'references',
      uri: '/sap/bc/adt/oo/interfaces/zif_test#start=3,12',
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.total).toBe(1);
    expect(parsed.warning).toContain('did not report the searched symbol');
    const requests = mockFetch.mock.calls.filter(([url]) => String(url).includes('usageReferences'));
    expect(requests).toHaveLength(2);
    for (const [url] of requests) {
      expect(new URL(String(url)).searchParams.get('uri')).toBe('/sap/bc/adt/oo/interfaces/zif_test#start=3,12');
    }
    expect(sql).not.toHaveBeenCalled();
    expect(table).not.toHaveBeenCalled();
  });
});
