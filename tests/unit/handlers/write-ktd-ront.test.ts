import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

describe('KTD creation for SAP object type parents', () => {
  beforeEach(() => mockFetch.mockReset());

  // Same refObject Eclipse ADT sends for "New Knowledge Transfer Document" on a SAP object type.
  it('SKTD create routes RONT/ROT parents to /businessobjects/rontrot', async () => {
    mockFetch.mockResolvedValue(mockResponse(201, '<sktd:docu/>', { 'x-csrf-token': 'T' }));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'KTD',
      name: 'ZX_SOT',
      package: '$TMP',
      refObjectType: 'RONT/ROT',
    });

    expect(result.isError, result.content[0]?.text).toBeUndefined();
    const post = mockFetch.mock.calls.find(
      ([url, opts]) => String(url).includes('/documentation/ktd/documents') && opts?.method === 'POST',
    );
    expect(String(post?.[1]?.body)).toContain(
      '<sktd:refObject adtcore:name="ZX_SOT" adtcore:type="RONT/ROT" adtcore:uri="/sap/bc/adt/businessobjects/rontrot/zx_sot"/>',
    );
  });

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
