import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const validationPath = '/sap/bc/adt/documentation/ktd/documents/validation';
const status = (severity: string, message = '') =>
  `<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>${severity}</SEVERITY><SHORT_TEXT>${message}</SHORT_TEXT></DATA></asx:values></asx:abap>`;
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

describe('KTD creation for SAP object type parents', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  // Same refObject Eclipse ADT sends for "New Knowledge Transfer Document" on a SAP object type.
  it('SKTD create routes RONT/ROT parents to /businessobjects/rontrot', async () => {
    mockFetch.mockImplementation(async (url) => {
      if (new URL(String(url)).pathname === validationPath) {
        const query = new URL(String(url)).searchParams;
        expect(Object.fromEntries(query)).toMatchObject({
          objname: 'ZX_SOT',
          package: '$TMP',
          refObjType: 'RONT/ROT',
          refObjName: 'ZX_SOT',
        });
        return mockResponse(200, status('OK'));
      }
      return mockResponse(201, '<sktd:docu/>', { 'x-csrf-token': 'T' });
    });
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'KTD',
      name: 'ZX_SOT',
      package: '$TMP',
      refObjectType: 'RONT/ROT',
    });

    expect(result.isError, result.content[0]?.text).toBeUndefined();
    const post = mockFetch.mock.calls.find(
      ([url, opts]) =>
        new URL(String(url)).pathname === '/sap/bc/adt/documentation/ktd/documents' && opts?.method === 'POST',
    );
    expect(String(post?.[1]?.body)).toContain(
      '<sktd:refObject adtcore:name="ZX_SOT" adtcore:type="RONT/ROT" adtcore:uri="/sap/bc/adt/businessobjects/rontrot/zx_sot"/>',
    );
  });

  it.each([status('ERROR', 'Knowledge Transfer Document not supported for SAP Object Type'), '<empty/>'])(
    'stops before the create POST when SAP does not confirm RONT documentation support',
    async (response) => {
      mockFetch.mockResolvedValue(mockResponse(200, response, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'KTD',
        name: 'ZX_SOT',
        package: '$TMP',
        refObjectType: 'RONT/ROT',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('SAP did not approve KTD creation for RONT/ROT');
      const writes = mockFetch.mock.calls.filter(([, opts]) => opts?.method === 'POST');
      expect(writes.map(([url]) => new URL(String(url)).pathname)).toEqual([validationPath]);
    },
  );

  it('keeps SAP object node types out of KTD parents', async () => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'KTD',
      name: 'ZX_SOT',
      package: '$TMP',
      refObjectType: 'NONT/NOT',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('will not attempt unverified refObjectType "NONT/NOT"');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
