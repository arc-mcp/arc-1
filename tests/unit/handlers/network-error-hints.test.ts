import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

beforeEach(() => vi.resetAllMocks());

describe('network error guidance', () => {
  it.each([
    ['TimeoutError', 'exceeded its client time limit'],
    ['AbortError', 'was cancelled'],
  ])('does not label %s as a connectivity failure', async (name, expected) => {
    mockFetch.mockRejectedValue(new DOMException('stopped', name));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'PROG', name: 'ZTEST' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(expected);
    expect(result.content[0]?.text).not.toMatch(/Cannot reach|connectivity probe/i);
  });

  it.each(['TimeoutError', 'AbortError'])('retains activation recovery guidance for %s', async (name) => {
    for (const minimalErrors of [false, true]) {
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'token' }));
      mockFetch.mockRejectedValueOnce(new DOMException('private-sentinel', name));
      const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, minimalErrors }, 'SAPActivate', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('If activation was submitted');
      expect(result.content[0]?.text).toContain('completion is unconfirmed');
      expect(result.content[0]?.text).toContain('INACTIVE_OBJECTS');
      expect(result.content[0]?.text).toContain('force_refresh=true');
      expect(result.content[0]?.text).not.toMatch(/Cannot reach|Successfully activated/);
      if (minimalErrors) expect(result.content[0]?.text).not.toContain('private-sentinel');
    }
  });

  it.each([429, 500, 503])(
    'requires inspection after activation HTTP %i, including minimal-error mode',
    async (status) => {
      for (const minimalErrors of [false, true]) {
        mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'token' }));
        mockFetch.mockResolvedValueOnce(mockResponse(status, 'private-sentinel'));
        const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, minimalErrors }, 'SAPActivate', {
          type: 'PROG',
          name: 'ZTEST',
        });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toContain('completion is unconfirmed');
        expect(result.content[0]?.text).toContain('INACTIVE_OBJECTS');
        expect(result.content[0]?.text).not.toMatch(/wait 10-30 seconds and retry|Cannot reach/);
        if (minimalErrors) expect(result.content[0]?.text).not.toContain('private-sentinel');
      }
    },
  );

  it.each([
    [
      'dependent syntax error',
      '<html><head><title>Application Server Error</title></head><body><span id="msgText">Syntax error in program ZBP_R_TRAVEL==================BD .</span></body></html>',
      'The program "ZBP_R_TRAVEL" has syntax errors',
    ],
    [
      'structured SAP diagnostics',
      '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><message>Activation terminated</message><localizedMessage>Activation terminated</localizedMessage><properties><entry key="T100KEY-ID">EU</entry><entry key="T100KEY-NO">510</entry><entry key="LINE">42</entry></properties></exc:exception>',
      '[EU/510] Line 42: Activation terminated',
    ],
  ])('preserves %s after activation HTTP 500 without generic replay guidance', async (_label, body, expected) => {
    for (const minimalErrors of [false, true]) {
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'token' }));
      mockFetch.mockResolvedValueOnce(mockResponse(500, body));
      const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, minimalErrors }, 'SAPActivate', {
        type: 'PROG',
        name: 'ZTEST',
      });
      const text = result.content[0]?.text;
      expect(result.isError).toBe(true);
      expect(text).toContain('completion is unconfirmed');
      expect(text).toContain('INACTIVE_OBJECTS');
      expect(text).not.toContain('wait 10-30 seconds and retry');
      if (minimalErrors) {
        expect(text).not.toMatch(/ZBP_R_TRAVEL|EU\/510|Line 42|Activation terminated/);
      } else {
        expect(text).toContain(expected);
      }
    }
  });

  it('retains connectivity guidance for connection errors containing timeout text', async () => {
    mockFetch.mockRejectedValue(new Error('connect ETIMEDOUT: connection timeout'));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'PROG', name: 'ZTEST' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Cannot reach the SAP system');
    expect(result.content[0]?.text).not.toContain('client time limit');
  });
});
