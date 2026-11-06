import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

const uri = '/sap/bc/adt/programs/programs/rsparam/source/main';
const source = 'REPORT rsparam.\nDATA lv_counter TYPE i.\nlv_co';

describe.each(['completion', 'definition'])('SAPNavigate %s source cursor bounds', (action) => {
  beforeEach(() => {
    mockFetch.mockReset();
    const body =
      action === 'completion'
        ? '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA/></asx:values></asx:abap>'
        : `<adtcore:objectReference xmlns:adtcore="http://www.sap.com/adt/core" adtcore:uri="${uri}#start=2,5"/>`;
    mockFetch.mockResolvedValue(mockResponse(200, body, { 'x-csrf-token': 'T' }));
  });

  it.each([
    ['line beyond source', source, 99, 5],
    ['column beyond line', source, 3, 40],
    ['column on CRLF terminator', 'REPORT rsparam.\r\nlv_co', 1, 16],
    ['column beyond trailing empty line', `${source}\n`, 4, 1],
  ])('rejects %s without contacting SAP', async (_label, text, line, column) => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPNavigate', {
      action,
      uri,
      line,
      column,
      source: text,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('line, column and source');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['cursor at LF line end', source, 3, 5],
    ['cursor at CRLF line end', 'REPORT rsparam.\r\nlv_co', 2, 5],
    ['cursor before CRLF terminator', 'REPORT rsparam.\r\nlv_co', 1, 15],
    ['zero column on trailing LF line', `${source}\n`, 4, 0],
    ['zero column on trailing CRLF line', `${source.replaceAll('\n', '\r\n')}\r\n`, 4, 0],
  ])('accepts %s', async (_label, text, line, column) => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPNavigate', {
      action,
      uri,
      line,
      column,
      source: text,
    });
    expect(result.isError).toBeUndefined();
    const endpoint = action === 'completion' ? '/codecompletion/proposal' : '/navigation/target';
    const request = mockFetch.mock.calls.find((call) => String(call[0]).includes(endpoint));
    expect(request).toBeDefined();
    expect(new URL(String(request?.[0])).searchParams.get('uri')).toBe(`${uri}#start=${line},${column}`);
  });
});
