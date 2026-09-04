/** Focused handler coverage for structured KTD short texts. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

const ROOT_ID = 'ZTR_C_PAYMENT_VALUE_DATE';
const FIELD_ID = '/sap/bc/adt/ddic/ddl/sources/ztr_c_payment_value_date/source/main#type=DDLS/DF;name=PaymentValueDate';
const b64 = (text: string) => Buffer.from(text, 'utf-8').toString('base64');
const LOCK_BODY =
  '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>KTDLOCK</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>';

function envelope(fieldShortText = '', fieldObligation = 'optional'): string {
  return (
    '<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" xmlns:adtcore="http://www.sap.com/adt/core" ' +
    `adtcore:name="${ROOT_ID}" adtcore:type="SKTD/TYP">` +
    '<adtcore:packageRef adtcore:name="$TMP"/>' +
    `<sktd:element><sktd:id>${ROOT_ID}</sktd:id><sktd:text>${b64('root body')}</sktd:text>` +
    '<adtcore:objectReference/><sktd:shortText sktd:text="" sktd:obligation="forbidden"/></sktd:element>' +
    `<sktd:element><sktd:id>${FIELD_ID}</sktd:id><sktd:text>${b64('field body')}</sktd:text>` +
    `<adtcore:objectReference/><sktd:shortText sktd:text="${b64(fieldShortText)}" ` +
    `sktd:obligation="${fieldObligation}"/></sktd:element></sktd:docu>`
  );
}

function recordKtdCalls(currentEnvelope: string) {
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string | Buffer }) => {
    const method = opts?.method ?? 'GET';
    const urlString = String(url);
    calls.push({ method, url: urlString, body: opts?.body ? String(opts.body) : undefined });
    if (method === 'GET' && urlString.includes('/activation/inactiveobjects')) {
      return Promise.resolve(
        mockResponse(
          200,
          '<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="http://www.sap.com/adt/core"/>',
        ),
      );
    }
    if (method === 'GET' && urlString.includes('/documentation/ktd/documents/')) {
      return Promise.resolve(mockResponse(200, currentEnvelope, { 'x-csrf-token': 'T', etag: 'e1' }));
    }
    if (method === 'POST' && urlString.includes('_action=LOCK')) {
      return Promise.resolve(mockResponse(200, LOCK_BODY, { 'x-csrf-token': 'T' }));
    }
    return Promise.resolve(mockResponse(method === 'POST' ? 201 : 200, '<sktd:docu/>', { 'x-csrf-token': 'T' }));
  });
  return calls;
}

describe('SAPWrite KTD short texts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('updates a short text without source through GET, lock, PUT, and unlock', async () => {
    const calls = recordKtdCalls(envelope());
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      type: 'SKTD',
      name: ROOT_ID,
      shortTexts: [{ node: FIELD_ID, text: 'Payment value date' }],
    });

    expect(result.isError).toBeUndefined();
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.body).toContain(`sktd:text="${b64('Payment value date')}"`);
    expect(put?.body).toContain(`<sktd:text>${b64('field body')}</sktd:text>`);
    expect(calls.some((call) => call.url.includes('_action=UNLOCK'))).toBe(true);
  });

  it('creates a KTD and writes an initial short text without a Markdown body', async () => {
    const calls = recordKtdCalls(envelope());
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'SKTD',
      name: ROOT_ID,
      package: '$TMP',
      refObjectType: 'DDLS/DF',
      shortTexts: [{ node: FIELD_ID, text: 'Payment value date' }],
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('wrote its documentation');
    expect(calls.find((call) => call.method === 'PUT')?.body).toContain(`sktd:text="${b64('Payment value date')}"`);
  });

  it('reports create as a partial success when SAP marks the short text forbidden', async () => {
    const calls = recordKtdCalls(envelope('', 'forbidden'));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'SKTD',
      name: ROOT_ID,
      package: '$TMP',
      refObjectType: 'DDLS/DF',
      shortTexts: [{ node: FIELD_ID, text: 'Payment value date' }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(`Created SKTD ${ROOT_ID}`);
    expect(result.content[0]?.text).toContain('shortTexts=[…]');
    expect(result.content[0]?.text).toContain('verify it with SAPRead');
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
  });

  it('rejects shortTexts on other object types and actions at the schema boundary', async () => {
    for (const args of [
      { action: 'update', type: 'CLAS', name: 'ZCL_X', shortTexts: [{ node: FIELD_ID, text: 'x' }] },
      { action: 'delete', type: 'SKTD', name: ROOT_ID, shortTexts: [{ node: FIELD_ID, text: 'x' }] },
    ]) {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', args);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('shortTexts');
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns populated short texts in the writer-ignored SAPRead context', async () => {
    recordKtdCalls(envelope('Payment value date'));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'SKTD',
      name: ROOT_ID,
      version: 'active',
    });

    const text = result.content[0]?.text ?? '';
    expect(text).toContain('<!-- arc1:ktd-meta');
    expect(text).toContain(`${FIELD_ID} [optional]: Payment value date`);
    expect(text.indexOf('<!-- arc1:ktd-meta')).toBeLessThan(text.indexOf('Short texts (read-only'));
  });

  it('refuses a KTD update with neither bodies nor short texts before locking', async () => {
    const calls = recordKtdCalls(envelope());
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      type: 'SKTD',
      name: ROOT_ID,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/nothing to write[\s\S]*source[\s\S]*shortTexts/);
    expect(calls.some((call) => call.url.includes('_action=LOCK'))).toBe(false);
  });
});
