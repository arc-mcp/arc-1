import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

const resultXml = (description = '') =>
  `<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences" resultDescription="${description}">
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
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPNavigate', {
      action: 'references',
      uri: '/sap/bc/adt/oo/classes/ztest#start=3,12',
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.total).toBe(1);
    expect(parsed.warning).toContain('did not report the searched symbol');
    const requests = mockFetch.mock.calls.filter(([url]) => String(url).includes('usageReferences'));
    expect(requests).toHaveLength(2);
    for (const [url] of requests) {
      expect(new URL(String(url)).searchParams.get('uri')).toBe('/sap/bc/adt/oo/classes/ztest#start=3,12');
    }
  });
});
