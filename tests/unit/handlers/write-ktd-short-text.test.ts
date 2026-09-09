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
      type: 'KTD',
      name: ROOT_ID,
      shortTexts: [{ node: FIELD_ID, text: 'Payment value date' }],
    });

    expect(result.isError).toBeUndefined();
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.body).toContain(`sktd:text="${b64('Payment value date')}"`);
    expect(put?.body).toContain(`<sktd:text>${b64('field body')}</sktd:text>`);
    expect(calls.some((call) => call.url.includes('_action=UNLOCK'))).toBe(true);
    expect(result.content[0]?.text).toContain(
      'Changed 1 node(s); 1 node(s) kept their current text:\n  PaymentValueDate',
    );
  });

  it('validates the short-text limit after whitespace normalization through the real schema path', async () => {
    const calls = recordKtdCalls(envelope());
    const first = '🚀'.repeat(10);
    const second = `${'🚀'.repeat(19)}x`;
    const normalized = `${first} ${second}`;
    const raw = `  ${first}\n${second}  `;
    expect(raw.length).toBeGreaterThan(60);
    expect(normalized.length).toBe(60);

    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      type: 'SKTD',
      name: ROOT_ID,
      shortTexts: [{ node: FIELD_ID, text: raw }],
    });

    expect(result.isError).toBeUndefined();
    expect(calls.find((call) => call.method === 'PUT')?.body).toContain(`sktd:text="${b64(normalized)}"`);
  });

  it('surfaces the Eclipse limit after normalization before locking', async () => {
    const calls = recordKtdCalls(envelope());
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      type: 'SKTD',
      name: ROOT_ID,
      shortTexts: [{ node: FIELD_ID, text: `  ${'x'.repeat(61)}  ` }],
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/Eclipse ADT allows 60/);
    expect(calls.some((call) => call.url.includes('_action=LOCK'))).toBe(false);
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
    expect(result.content[0]?.text).toContain('correct or remove invalid shortTexts input');
    expect(result.content[0]?.text).toContain('do not retry create');
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
    // Labelled with the node name, which is exactly what shortTexts[].node accepts back.
    expect(text).toContain('PaymentValueDate [optional]: Payment value date');
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

describe('SAPWrite SKTD dryRun', () => {
  it('validates and reports which nodes would change without issuing a PUT', async () => {
    mockFetch.mockReset();
    const calls: Array<{ method: string; url: string }> = [];
    const b64 = (text: string) => Buffer.from(text, 'utf-8').toString('base64');
    const base = '/sap/bc/adt/bo/behaviordefinitions/zbdef/source/main';
    const action = `${base}#type=BDEF/BAC;name=ZBDEF.SetPhoto`;
    const envelope =
      '<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" adtcore:name="ZBDEF">' +
      `<sktd:element><sktd:id>ZBDEF</sktd:id><sktd:text>${b64('root v1')}</sktd:text></sktd:element>` +
      `<sktd:element><sktd:id>${action}</sktd:id><sktd:text>${b64('photo v1')}</sktd:text></sktd:element>` +
      '</sktd:docu>';
    mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
      calls.push({ method: opts?.method ?? 'GET', url: String(url) });
      return Promise.resolve(mockResponse(200, envelope, { 'x-csrf-token': 'T' }));
    });

    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      type: 'SKTD',
      name: 'ZBDEF',
      dryRun: true,
      source: '## ZBDEF\n\nroot v1\n\n## ZBDEF.SetPhoto\n\nphoto v2',
    });

    const text = result.content[0]?.text ?? '';
    expect(result.isError).toBeFalsy();
    expect(text).toContain('nothing was written');
    // Only the node whose text actually differs is reported; the untouched root is counted.
    expect(text).toContain('Would change 1 node(s); 1 node(s) would keep their current text:');
    // Reported by the same spelling the read prints, not the full id.
    expect(text).toContain('  ZBDEF.SetPhoto');
    expect(text).not.toContain(action);
    expect(calls.some((c) => c.method === 'PUT' || c.url.includes('_action=LOCK'))).toBe(false);
  });
});

describe('SAPWrite SKTD source routing at the handler boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it.each(['create', 'update'])('reports actual changed nodes and prose headings after %s', async (action) => {
    const calls = recordKtdCalls(envelope().replaceAll('PaymentValueDate', 'Description'));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action,
      type: 'SKTD',
      name: ROOT_ID,
      ...(action === 'create' ? { package: '$TMP', refObjectType: 'DDLS/DF' } : {}),
      source: `## ${ROOT_ID}\n\nroot body\n\n## Description\n\nNew explanation.\n\n## Details\n\nMore prose.`,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('Changed 1 node(s); 1 node(s) kept their current text:\n  Description');
    expect(result.content[0]?.text).toContain('Headings kept as prose inside their node (not node routes): Details');
    expect(calls.find((call) => call.method === 'PUT')?.body).toContain(
      b64('New explanation.\n\n## Details\n\nMore prose.'),
    );
  });

  it('reports zero changed nodes for a successful no-op update', async () => {
    recordKtdCalls(envelope('existing label'));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      type: 'SKTD',
      name: ROOT_ID,
      shortTexts: [{ node: 'PaymentValueDate', text: 'existing label' }],
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('Changed 0 node(s); 2 node(s) kept their current text.');
  });

  it.each([undefined, 'body'])(
    'reads duplicate IDs with grep=%s while refusing writes before locking',
    async (grep) => {
      const calls = recordKtdCalls(envelope('field label').replace(FIELD_ID, ROOT_ID));
      const read = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'SKTD',
        name: ROOT_ID,
        ...(grep ? { grep } : {}),
      });
      expect(read.isError).toBeUndefined();
      expect(read.content[0]?.text).toContain('root body');
      expect(read.content[0]?.text).toContain('field body');
      for (const content of [
        { source: `## ${ROOT_ID}\n\nreplacement` },
        { shortTexts: [{ node: ROOT_ID, text: 'new' }] },
      ]) {
        const write = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
          action: 'update',
          type: 'SKTD',
          name: ROOT_ID,
          ...content,
        });
        expect(write.isError).toBe(true);
        expect(write.content[0]?.text).toMatch(/duplicate.*id/i);
      }
      expect(calls.some((call) => call.method === 'PUT' || call.url.includes('_action=LOCK'))).toBe(false);
    },
  );

  it.each([`${FIELD_ID}x`, `${FIELD_ID.toUpperCase()}X`])(
    'aborts before the lock for an unknown route: %s',
    async (ref) => {
      const calls = recordKtdCalls(envelope());
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'SKTD',
        name: ROOT_ID,
        source: `## ${ROOT_ID}\n\nroot v2\n\n## ${ref}\n\ntypo in a full id`,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/does not exist[\s\S]*Known node ids/);
      expect(calls.some((call) => call.url.includes('_action=LOCK') || call.method === 'PUT')).toBe(false);
    },
  );

  it('writes a by-name section and reports a bare heading it had to keep as prose', async () => {
    // DDLS field names carry no qualifier, so a typo in one is indistinguishable from a prose heading;
    // the write succeeds and names the heading it kept as prose so the caller can catch the misroute.
    const calls = recordKtdCalls(envelope());
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      type: 'SKTD',
      name: ROOT_ID,
      source: `## ${ROOT_ID}\n\nroot v2\n\n## PaymentValueDate\n\nfield v2\n\n## PaymentValueDates\n\nstray`,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain(
      'Headings kept as prose inside their node (not node routes): PaymentValueDates',
    );
    // The stray heading belongs to the node whose section it appeared in — the field, not the root.
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.body).toContain(`<sktd:text>${b64('root v2')}</sktd:text>`);
    expect(put?.body).toContain(`<sktd:text>${b64('field v2\n\n## PaymentValueDates\n\nstray')}</sktd:text>`);
  });

  it('dryRun covers shortTexts too and reports nothing to change without a dangling list', async () => {
    const calls = recordKtdCalls(envelope('Payment value date'));
    const unchanged = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      type: 'SKTD',
      name: ROOT_ID,
      dryRun: true,
      shortTexts: [{ node: 'PaymentValueDate', text: 'Payment value date' }],
    });
    expect(unchanged.content[0]?.text).toContain('Would change 0 node(s); 2 node(s) would keep their current text.');

    const changed = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      type: 'SKTD',
      name: ROOT_ID,
      dryRun: true,
      shortTexts: [{ node: 'PaymentValueDate', text: 'New label' }],
    });
    expect(changed.content[0]?.text).toContain(
      'Would change 1 node(s); 1 node(s) would keep their current text:\n  PaymentValueDate',
    );
    expect(calls.some((call) => call.method === 'PUT' || call.url.includes('_action=LOCK'))).toBe(false);
  });
});
