/**
 * SAPWrite DDIC-write unit tests — split from the former intent.test.ts monolith.
 * The undici mock + AdtClient + createClient live in ./setup-undici-mock.ts — import that helper
 * and keep all other src-module imports dynamic (see its header for the ordering rules).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { featuresOff } from './handler-test-config.js';
import { AdtClient, createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');

describe('SAPWrite handler — DDIC writes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: return ABAP source with CSRF token for any request
    mockFetch.mockResolvedValue(
      mockResponse(200, "REPORT zhello.\nWRITE: / 'Hello'.", { 'x-csrf-token': 'mock-csrf-token' }),
    );
  });

  describe('SAPWrite metadata writes (DOMA/DTEL/SRVB)', () => {
    it('creates DOMA with v2 content type and no source PUT', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; contentType?: string }> = [];
      mockFetch.mockImplementation(
        (url: string | URL, opts?: { method?: string; headers?: Record<string, string> }) => {
          const method = opts?.method ?? 'GET';
          const headers = (opts?.headers ?? {}) as Record<string, string>;
          calls.push({ method, url: String(url), contentType: headers['content-type'] ?? headers['Content-Type'] });
          return Promise.resolve(mockResponse(200, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
        },
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'DOMA',
        name: 'ZDOMAIN',
        package: '$TMP',
        description: 'Status domain',
        dataType: 'CHAR',
        length: 1,
        fixedValues: [{ low: 'A', description: 'Active' }],
      });

      expect(result.isError).toBeUndefined();
      const createCall = calls.find((c) => c.method === 'POST' && c.url.includes('/sap/bc/adt/ddic/domains'));
      expect(createCall?.contentType).toContain('application/vnd.sap.adt.domains.v2+xml');
      const putCalls = calls.filter((c) => c.method === 'PUT');
      expect(putCalls).toHaveLength(0);
    });

    it('creates DTEL with predefined type using v2 content type and follow-up PUT for labels', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; contentType?: string; body?: string }> = [];
      mockFetch.mockImplementation(
        (url: string | URL, opts?: { method?: string; headers?: Record<string, string>; body?: unknown }) => {
          const method = opts?.method ?? 'GET';
          const headers = (opts?.headers ?? {}) as Record<string, string>;
          const urlStr = String(url);
          calls.push({
            method,
            url: urlStr,
            contentType: headers['content-type'] ?? headers['Content-Type'],
            body: typeof opts?.body === 'string' ? opts.body : undefined,
          });
          if (method === 'POST' && urlStr.includes('_action=LOCK')) {
            return Promise.resolve(
              mockResponse(200, '<asx:values><LOCK_HANDLE>LH1</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
                'x-csrf-token': 'T',
              }),
            );
          }
          return Promise.resolve(mockResponse(200, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
        },
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'DTEL',
        name: 'ZTEXT20',
        package: '$TMP',
        typeKind: 'predefinedAbapType',
        dataType: 'CHAR',
        length: 20,
        shortLabel: 'Text',
      });

      expect(result.isError).toBeUndefined();
      const createCall = calls.find((c) => c.method === 'POST' && c.url.includes('/sap/bc/adt/ddic/dataelements'));
      expect(createCall?.contentType).toContain('application/vnd.sap.adt.dataelements.v2+xml');
      // SAP ignores labels on POST — follow-up PUT is required
      const putCall = calls.find((c) => c.method === 'PUT');
      expect(putCall?.url).toContain('/sap/bc/adt/ddic/dataelements/ZTEXT20');
      expect(putCall?.contentType).toContain('application/vnd.sap.adt.dataelements.v2+xml');
    });

    it('creates DTEL without labels skips follow-up PUT', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string }> = [];
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        calls.push({ method: opts?.method ?? 'GET', url: String(url) });
        return Promise.resolve(mockResponse(200, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'DTEL',
        name: 'ZTEXT_NOLABEL',
        package: '$TMP',
        typeKind: 'predefinedAbapType',
        dataType: 'CHAR',
        length: 10,
      });

      expect(result.isError).toBeUndefined();
      expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    });

    it('updates DOMA via lock/PUT/unlock to object URL', async () => {
      const calls: Array<{ method: string; url: string; contentType?: string }> = [];
      const lockBody =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>';
      mockFetch.mockReset();
      mockFetch.mockImplementation(
        (url: string | URL, opts?: { method?: string; headers?: Record<string, string> }) => {
          const method = opts?.method ?? 'GET';
          const headers = (opts?.headers ?? {}) as Record<string, string>;
          calls.push({ method, url: String(url), contentType: headers['content-type'] ?? headers['Content-Type'] });
          if (method === 'POST' && String(url).includes('_action=LOCK')) {
            return Promise.resolve(mockResponse(200, lockBody, { 'x-csrf-token': 'T' }));
          }
          return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
        },
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'DOMA',
        name: 'ZDOMAIN',
        package: '$TMP',
        dataType: 'CHAR',
        length: 1,
      });

      expect(result.isError).toBeUndefined();
      const putCall = calls.find((c) => c.method === 'PUT');
      expect(putCall).toBeDefined();
      expect(putCall!.url).toContain('/sap/bc/adt/ddic/domains/ZDOMAIN?lockHandle=');
      expect(putCall!.contentType).toContain('application/vnd.sap.adt.domains.v2+xml');
      const unlockCall = calls.find((c) => c.method === 'POST' && c.url.includes('_action=UNLOCK'));
      expect(unlockCall).toBeDefined();
    });

    it('updates SKTD via fetch-then-PUT with sktdv2+xml envelope and base64-encoded Markdown in <sktd:text>', async () => {
      const lockBody =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>KTDLOCK</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>';
      const oldMarkdown = 'old content';
      const oldBase64 = Buffer.from(oldMarkdown, 'utf-8').toString('base64');
      // Full envelope (mirrors the Eclipse capture): carries responsible/masterLanguage/packageRef/refObject
      // and MUST be preserved in the PUT body — only <sktd:text> changes.
      const envelope =
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" xmlns:adtcore="http://www.sap.com/adt/core" ' +
        'adtcore:name="ZTR_C_PAYMENT_VALUE_DATE" adtcore:type="SKTD/TYP" ' +
        'adtcore:responsible="LEMAIWO" adtcore:masterLanguage="EN" adtcore:masterSystem="KD1" ' +
        'adtcore:language="EN" adtcore:version="inactive">' +
        '<adtcore:packageRef adtcore:name="ZE_TR"/>' +
        '<sktd:refObject adtcore:name="ZTR_C_PAYMENT_VALUE_DATE" adtcore:type="DDLS/DF"/>' +
        '<sktd:element>' +
        `<sktd:text>${oldBase64}</sktd:text>` +
        '</sktd:element>' +
        '</sktd:docu>';
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; contentType?: string; body?: string }> = [];
      mockFetch.mockImplementation(
        (url: string | URL, opts?: { method?: string; headers?: Record<string, string>; body?: string | Buffer }) => {
          const method = opts?.method ?? 'GET';
          const headers = (opts?.headers ?? {}) as Record<string, string>;
          calls.push({
            method,
            url: String(url),
            contentType: headers['content-type'] ?? headers['Content-Type'],
            body: opts?.body ? String(opts.body) : undefined,
          });
          if (method === 'POST' && String(url).includes('_action=LOCK')) {
            return Promise.resolve(mockResponse(200, lockBody, { 'x-csrf-token': 'T' }));
          }
          if (method === 'GET' && String(url).includes('/documentation/ktd/documents/')) {
            return Promise.resolve(mockResponse(200, envelope, { 'x-csrf-token': 'T' }));
          }
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        },
      );

      const newMarkdown = '# Payment Value Date\n\nBusiness rule explanation.';
      const newBase64 = Buffer.from(newMarkdown, 'utf-8').toString('base64');
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'SKTD',
        name: 'ZTR_C_PAYMENT_VALUE_DATE',
        source: newMarkdown,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Successfully updated SKTD ZTR_C_PAYMENT_VALUE_DATE');

      // Fetched current envelope before PUT
      const getCall = calls.find(
        (c) => c.method === 'GET' && c.url.includes('/documentation/ktd/documents/ztr_c_payment_value_date'),
      );
      expect(getCall).toBeDefined();

      const lockCall = calls.find((c) => c.method === 'POST' && c.url.includes('_action=LOCK'));
      expect(lockCall?.url).toContain('/sap/bc/adt/documentation/ktd/documents/ztr_c_payment_value_date?_action=LOCK');

      const putCall = calls.find((c) => c.method === 'PUT');
      expect(putCall?.url).toContain(
        '/sap/bc/adt/documentation/ktd/documents/ztr_c_payment_value_date?lockHandle=KTDLOCK',
      );
      // Vendor content type from the Eclipse trace
      expect(putCall?.contentType).toContain('application/vnd.sap.adt.sktdv2+xml');
      // PUT body is the full envelope with <sktd:text> swapped to base64(newMarkdown)
      expect(putCall?.body).toContain('<sktd:docu');
      expect(putCall?.body).toContain('xmlns:sktd="http://www.sap.com/wbobj/texts/sktd"');
      expect(putCall?.body).toContain(`<sktd:text>${newBase64}</sktd:text>`);
      // Preserved metadata — carried over from the GET envelope
      expect(putCall?.body).toContain('adtcore:responsible="LEMAIWO"');
      expect(putCall?.body).toContain('<adtcore:packageRef adtcore:name="ZE_TR"/>');
      expect(putCall?.body).toContain('<sktd:refObject');
      // Old body must be gone
      expect(putCall?.body).not.toContain(oldBase64);
      // Raw Markdown must NOT appear — it must be encoded
      expect(putCall?.body).not.toContain(newMarkdown);

      const unlockCall = calls.find((c) => c.method === 'POST' && c.url.includes('_action=UNLOCK'));
      expect(unlockCall?.url).toContain(
        '/sap/bc/adt/documentation/ktd/documents/ztr_c_payment_value_date?_action=UNLOCK',
      );
    });

    it('activates SKTD using the lowercased ADT URL in the objectReference', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string | Buffer }) => {
        calls.push({
          method: opts?.method ?? 'GET',
          url: String(url),
          body: opts?.body ? String(opts.body) : undefined,
        });
        return Promise.resolve(
          mockResponse(200, '<?xml version="1.0"?><chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"/>', {
            'x-csrf-token': 'T',
          }),
        );
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'activate',
        type: 'SKTD',
        name: 'ZTR_C_PAYMENT_VALUE_DATE',
      });

      expect(result.isError).toBeUndefined();
      const activateCall = calls.find((c) => c.url.includes('/sap/bc/adt/activation'));
      expect(activateCall?.body).toContain('/sap/bc/adt/documentation/ktd/documents/ztr_c_payment_value_date');
    });

    it('creates SKTD via POST to the collection URL with sktd:docu XML body and vendor content-type', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; contentType?: string; body?: string }> = [];
      mockFetch.mockImplementation(
        (url: string | URL, opts?: { method?: string; headers?: Record<string, string>; body?: string | Buffer }) => {
          const method = opts?.method ?? 'GET';
          const headers = (opts?.headers ?? {}) as Record<string, string>;
          calls.push({
            method,
            url: String(url),
            contentType: headers['content-type'] ?? headers['Content-Type'],
            body: opts?.body ? String(opts.body) : undefined,
          });
          return Promise.resolve(mockResponse(201, '<sktd:docu/>', { 'x-csrf-token': 'T' }));
        },
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'SKTD',
        name: 'ZTR_C_PAYMENT_VALUE_DATE',
        package: '$TMP',
        refObjectType: 'DDLS/DF',
        refObjectName: 'ZTR_C_PAYMENT_VALUE_DATE',
        refObjectDescription: 'Treasury Payment Value Date',
      });

      expect(result.isError).toBeUndefined();
      const postCall = calls.find(
        (c) => c.method === 'POST' && c.url.includes('/sap/bc/adt/documentation/ktd/documents'),
      );
      expect(postCall).toBeDefined();
      expect(postCall!.url).not.toContain('/documents/');
      expect(postCall!.contentType).toContain('application/vnd.sap.adt.sktdv2+xml');
      expect(postCall!.body).toContain('<sktd:docu');
      expect(postCall!.body).toContain('xmlns:sktd="http://www.sap.com/wbobj/texts/sktd"');
      expect(postCall!.body).toContain('adtcore:name="ZTR_C_PAYMENT_VALUE_DATE"');
      expect(postCall!.body).toContain('adtcore:type="SKTD/TYP"');
      expect(postCall!.body).toContain('<adtcore:packageRef adtcore:name="$TMP"/>');
      expect(postCall!.body).toContain('<sktd:refObject');
      expect(postCall!.body).toContain('adtcore:type="DDLS/DF"');
      expect(postCall!.body).toContain('adtcore:uri="/sap/bc/adt/ddic/ddl/sources/ztr_c_payment_value_date"');
      expect(postCall!.body).toContain('adtcore:description="Treasury Payment Value Date"');
    });

    it('SKTD create rejects missing refObjectType with an actionable error', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'SKTD',
        name: 'ZTR_C_PAYMENT_VALUE_DATE',
        package: '$TMP',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('refObjectType');
      expect(result.content[0]?.text).toContain('DDLS/DF');
    });

    it('KTD create alias rejects missing refObjectType before generic object routing', async () => {
      mockFetch.mockReset();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'KTD',
        name: 'ZTR_C_PAYMENT_VALUE_DATE',
        package: '$TMP',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('refObjectType');
      expect(result.content[0]?.text).toContain('SKTD/KTD create');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('SKTD create rejects class parents before SAP dumps in CL_KTD_UTILITY', async () => {
      mockFetch.mockReset();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'SKTD',
        name: 'ZCL_KTD_DOC_TARGET',
        package: '$TMP',
        refObjectType: 'CLAS/OC',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('CLAS/OC');
      expect(result.content[0]?.text).toContain('CL_KTD_UTILITY=>GET_DOCU_STRUCTURE');
      expect(result.content[0]?.text).toContain('Use ABAP Doc');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('SKTD create rejects SAP-registered parents that ARC cannot route yet', async () => {
      mockFetch.mockReset();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'SKTD',
        name: 'Z_ANNOTATION_DOC_TARGET',
        package: '$TMP',
        refObjectType: 'DDLA/ADF',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('DDLA/ADF');
      expect(result.content[0]?.text).toContain('SAP-registered for KTD DOCUMENTATION scope');
      expect(result.content[0]?.text).toContain('does not yet have verified ADT parent URI routing');
      expect(result.content[0]?.text).toContain('WBOBJTYPES_SCOPE');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('SKTD create rejects unverified parent types without claiming SAP can never support them', async () => {
      mockFetch.mockReset();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'SKTD',
        name: 'Z_UNKNOWN_DOC_TARGET',
        package: '$TMP',
        refObjectType: 'ZZZZ/ABC',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('will not attempt unverified refObjectType "ZZZZ/ABC"');
      expect(result.content[0]?.text).toContain('requires both a SAP Workbench DOCUMENTATION scope handler');
      expect(result.content[0]?.text).toContain('exact ADT parent object URI');
      expect(result.content[0]?.text).not.toContain('does not support refObjectType');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('SKTD create rejects when name differs from refObjectName (KTD inherits parent name)', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'SKTD',
        name: 'ZTR_C_PAYMENT_VALUE_DATE_TEMP',
        package: '$TMP',
        refObjectType: 'DDLS/DF',
        refObjectName: 'ZTR_C_PAYMENT_VALUE_DATE',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('must match refObjectName');
      expect(result.content[0]?.text).toContain('one KTD per object');
      expect(result.content[0]?.text).toContain('name="ZTR_C_PAYMENT_VALUE_DATE"');
    });

    it('KTD create alias routes through the SKTD collection endpoint', async () => {
      const calls: Array<{ method: string; url: string; body?: string; contentType?: string }> = [];
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, init?: RequestInit) => {
        calls.push({
          method: init?.method ?? 'GET',
          url: String(url),
          body: init?.body?.toString(),
          contentType: init?.headers ? String((init.headers as Record<string, string>)['Content-Type'] ?? '') : '',
        });
        return Promise.resolve(
          mockResponse(201, '<sktd:docu/>', {
            location: '/sap/bc/adt/documentation/ktd/documents/ztr_c_payment_value_date',
            'x-csrf-token': 'T',
          }),
        );
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'KTD',
        name: 'ZTR_C_PAYMENT_VALUE_DATE',
        package: '$TMP',
        refObjectType: 'DDLS/DF',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Created SKTD ZTR_C_PAYMENT_VALUE_DATE');
      const postCall = calls.find(
        (c) => c.method === 'POST' && c.url.includes('/sap/bc/adt/documentation/ktd/documents'),
      );
      expect(postCall).toBeDefined();
      expect(postCall!.url).not.toContain('/programs/programs');
      expect(postCall!.body).toContain('adtcore:type="SKTD/TYP"');
      expect(postCall!.body).toContain('adtcore:type="DDLS/DF"');
    });

    it('SKTD create returns a capability error when the KTD collection endpoint is unavailable', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const urlStr = String(url);
        if (method === 'POST' && urlStr.includes('/sap/bc/adt/documentation/ktd/documents')) {
          return Promise.resolve(
            mockResponse(
              404,
              '<?xml version="1.0" encoding="utf-8"?><exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><exc:localizedMessage lang="EN">Resource  /sap/bc/adt/documentation/ktd/documents does not exist.</exc:localizedMessage></exc:exception>',
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        return Promise.resolve(mockResponse(200, '<xml/>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'KTD',
        name: 'ZTR_C_PAYMENT_VALUE_DATE',
        package: '$TMP',
        refObjectType: 'DDLS/DF',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('SKTD/KTD create endpoint is not available');
      expect(result.content[0]?.text).toContain('SAP_BASIS 7.55+');
      expect(result.content[0]?.text).not.toContain('Object "ZTR_C_PAYMENT_VALUE_DATE"');
    });

    it('creates SKTD and writes initial Markdown content when "source" is provided', async () => {
      const lockBody =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>KTDLOCK</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>';
      // After POST-create the server has an (empty) envelope we must fetch before PUTing the body.
      const postCreateEnvelope =
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" xmlns:adtcore="http://www.sap.com/adt/core" ' +
        'adtcore:name="ZTR_C_PAYMENT_VALUE_DATE" adtcore:type="SKTD/TYP">' +
        '<adtcore:packageRef adtcore:name="$TMP"/>' +
        '<sktd:element><sktd:text></sktd:text></sktd:element>' +
        '</sktd:docu>';
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; contentType?: string; body?: string }> = [];
      mockFetch.mockImplementation(
        (url: string | URL, opts?: { method?: string; headers?: Record<string, string>; body?: string | Buffer }) => {
          const method = opts?.method ?? 'GET';
          const headers = (opts?.headers ?? {}) as Record<string, string>;
          calls.push({
            method,
            url: String(url),
            contentType: headers['content-type'] ?? headers['Content-Type'],
            body: opts?.body ? String(opts.body) : undefined,
          });
          if (method === 'POST' && String(url).includes('_action=LOCK')) {
            return Promise.resolve(mockResponse(200, lockBody, { 'x-csrf-token': 'T' }));
          }
          if (method === 'GET' && String(url).includes('/documentation/ktd/documents/')) {
            return Promise.resolve(mockResponse(200, postCreateEnvelope, { 'x-csrf-token': 'T' }));
          }
          return Promise.resolve(mockResponse(201, '<sktd:docu/>', { 'x-csrf-token': 'T' }));
        },
      );

      const initialMarkdown = '# Initial docs';
      const initialBase64 = Buffer.from(initialMarkdown, 'utf-8').toString('base64');
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'SKTD',
        name: 'ZTR_C_PAYMENT_VALUE_DATE',
        package: '$TMP',
        refObjectType: 'DDLS/DF',
        source: initialMarkdown,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('wrote Markdown content');
      // Follow-up PUT uses the vendor content type and base64-encodes the Markdown in <sktd:text>
      const putCall = calls.find(
        (c) => c.method === 'PUT' && c.url.includes('/documentation/ktd/documents/ztr_c_payment_value_date'),
      );
      expect(putCall).toBeDefined();
      expect(putCall!.contentType).toContain('application/vnd.sap.adt.sktdv2+xml');
      expect(putCall!.body).toContain(`<sktd:text>${initialBase64}</sktd:text>`);
    });

    it('deletes SKTD via standard lock→DELETE→unlock pattern', async () => {
      const lockBody =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>KTDLOCK</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>';
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string }> = [];
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        calls.push({ method, url: String(url) });
        if (method === 'POST' && String(url).includes('_action=LOCK')) {
          return Promise.resolve(mockResponse(200, lockBody, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete',
        type: 'SKTD',
        name: 'ZTR_C_PAYMENT_VALUE_DATE',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Deleted SKTD ZTR_C_PAYMENT_VALUE_DATE');

      const lockCall = calls.find((c) => c.method === 'POST' && c.url.includes('_action=LOCK'));
      expect(lockCall?.url).toContain('/sap/bc/adt/documentation/ktd/documents/ztr_c_payment_value_date?_action=LOCK');

      const deleteCall = calls.find((c) => c.method === 'DELETE');
      expect(deleteCall?.url).toContain(
        '/sap/bc/adt/documentation/ktd/documents/ztr_c_payment_value_date?lockHandle=KTDLOCK',
      );

      const unlockCall = calls.find((c) => c.method === 'POST' && c.url.includes('_action=UNLOCK'));
      expect(unlockCall).toBeDefined();
    });

    it('updates DTEL via metadata PUT', async () => {
      const lockBody =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>';
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; contentType?: string }> = [];
      mockFetch.mockImplementation(
        (url: string | URL, opts?: { method?: string; headers?: Record<string, string> }) => {
          const method = opts?.method ?? 'GET';
          const headers = (opts?.headers ?? {}) as Record<string, string>;
          calls.push({ method, url: String(url), contentType: headers['content-type'] ?? headers['Content-Type'] });
          if (method === 'POST' && String(url).includes('_action=LOCK')) {
            return Promise.resolve(mockResponse(200, lockBody, { 'x-csrf-token': 'T' }));
          }
          return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
        },
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'DTEL',
        name: 'ZSTATUS',
        package: '$TMP',
        typeKind: 'domain',
        typeName: 'ZSTATUS',
      });

      expect(result.isError).toBeUndefined();
      const putCall = calls.find((c) => c.method === 'PUT');
      expect(putCall?.url).toContain('/sap/bc/adt/ddic/dataelements/ZSTATUS?lockHandle=');
      expect(putCall?.contentType).toContain('application/vnd.sap.adt.dataelements.v2+xml');
    });

    it('batch_create supports DOMA + DTEL with label update PUT', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string }> = [];
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const urlStr = String(url);
        // Lock needs a valid lock handle response
        if (urlStr.includes('_action=LOCK')) {
          calls.push({ method: opts?.method ?? 'GET', url: urlStr });
          return Promise.resolve(
            mockResponse(200, '<asx:values><LOCK_HANDLE>LH</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
              'x-csrf-token': 'T',
            }),
          );
        }
        calls.push({ method: opts?.method ?? 'GET', url: urlStr });
        return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [
          { type: 'DOMA', name: 'ZSTATUS_D', dataType: 'CHAR', length: 1, fixedValues: [{ low: 'A' }] },
          { type: 'DTEL', name: 'ZSTATUS', typeKind: 'domain', typeName: 'ZSTATUS_D', shortLabel: 'Status' },
        ],
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('2 objects');
      // DOMA: no PUT (fixed values work on POST). DTEL with labels: one PUT (SAP ignores labels on POST).
      const putCalls = calls.filter((c) => c.method === 'PUT');
      expect(putCalls.length).toBe(1);
      expect(putCalls[0].url).toContain('/sap/bc/adt/ddic/dataelements/ZSTATUS');
    });

    it('batch_create DTEL without labels skips follow-up PUT', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string }> = [];
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        calls.push({ method: opts?.method ?? 'GET', url: String(url) });
        return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [{ type: 'DTEL', name: 'ZSTATUS', typeKind: 'predefinedAbapType', dataType: 'CHAR', length: 10 }],
      });

      expect(result.isError).toBeUndefined();
      expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    });

    it('creates SRVB with service binding XML and publish hint', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; contentType?: string; body?: string }> = [];
      mockFetch.mockImplementation(
        (
          url: string | URL,
          opts?: { method?: string; headers?: Record<string, string>; body?: string | Buffer | null },
        ) => {
          const method = opts?.method ?? 'GET';
          const headers = (opts?.headers ?? {}) as Record<string, string>;
          calls.push({
            method,
            url: String(url),
            contentType: headers['content-type'] ?? headers['Content-Type'],
            body: typeof opts?.body === 'string' ? opts.body : undefined,
          });
          return Promise.resolve(mockResponse(200, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
        },
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'SRVB',
        name: 'ZSB_TRAVEL_O4',
        package: '$TMP',
        serviceDefinition: 'ZSD_TRAVEL',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Created SRVB ZSB_TRAVEL_O4');
      expect(result.content[0]?.text).toContain('SAPActivate(type="SRVB", name="ZSB_TRAVEL_O4")');
      expect(result.content[0]?.text).toContain('SAPActivate(action="publish_srvb", name="ZSB_TRAVEL_O4")');
      const createCall = calls.find(
        (c) => c.method === 'POST' && c.url.includes('/sap/bc/adt/businessservices/bindings'),
      );
      expect(createCall?.contentType).toContain('application/*');
      expect(createCall?.body).toContain('<srvb:serviceBinding');
      expect(createCall?.body).toContain('adtcore:type="SRVB/SVB"');
      expect(createCall?.body).toContain('<srvb:serviceDefinition adtcore:name="ZSD_TRAVEL"/>');
      expect(calls.some((c) => c.method === 'PUT' && c.url.includes('/source/main'))).toBe(false);
    });

    it('fails SRVB create when serviceDefinition is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'SRVB',
        name: 'ZSB_TRAVEL_O4',
        package: '$TMP',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('serviceDefinition');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('updates SRVB via metadata PUT with vendor content type (no source/main)', async () => {
      const lockBody =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>';
      const srvbReadXml = `<?xml version="1.0" encoding="utf-8"?>
<srvb:serviceBinding xmlns:srvb="http://www.sap.com/adt/ddic/ServiceBindings" xmlns:adtcore="http://www.sap.com/adt/core"
  adtcore:name="ZSB_TRAVEL_O4" adtcore:type="SRVB/SVB" adtcore:description="Travel binding" srvb:published="false" srvb:bindingCreated="true">
  <adtcore:packageRef adtcore:name="$TMP"/>
  <srvb:services srvb:name="ZSB_TRAVEL_O4">
    <srvb:content srvb:version="0001">
      <srvb:serviceDefinition adtcore:name="ZSD_TRAVEL"/>
    </srvb:content>
  </srvb:services>
  <srvb:binding srvb:type="ODATA" srvb:version="V4" srvb:category="0">
    <srvb:implementation adtcore:name="ZSB_TRAVEL_O4"/>
  </srvb:binding>
</srvb:serviceBinding>`;

      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; contentType?: string; body?: string }> = [];
      mockFetch.mockImplementation(
        (
          url: string | URL,
          opts?: { method?: string; headers?: Record<string, string>; body?: string | Buffer | null },
        ) => {
          const method = opts?.method ?? 'GET';
          const headers = (opts?.headers ?? {}) as Record<string, string>;
          const urlStr = String(url);
          calls.push({
            method,
            url: urlStr,
            contentType: headers['content-type'] ?? headers['Content-Type'],
            body: typeof opts?.body === 'string' ? opts.body : undefined,
          });
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/businessservices/bindings/ZSB_TRAVEL_O4')) {
            return Promise.resolve(mockResponse(200, srvbReadXml, { 'x-csrf-token': 'T' }));
          }
          if (method === 'POST' && urlStr.includes('_action=LOCK')) {
            return Promise.resolve(mockResponse(200, lockBody, { 'x-csrf-token': 'T' }));
          }
          return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
        },
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'SRVB',
        name: 'ZSB_TRAVEL_O4',
        package: '$TMP',
        bindingType: 'ODATA',
      });

      expect(result.isError).toBeUndefined();
      const putCall = calls.find((c) => c.method === 'PUT');
      expect(putCall?.url).toContain('/sap/bc/adt/businessservices/bindings/ZSB_TRAVEL_O4?lockHandle=');
      expect(putCall?.url).not.toContain('/source/main');
      expect(putCall?.contentType).toContain('application/vnd.sap.adt.businessservices.servicebinding.v2+xml');
      expect(putCall?.body).toContain('<srvb:serviceBinding');
    });

    it('deletes SRVB via lock/delete/unlock sequence', async () => {
      const lockBody =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>';
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string }> = [];
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        calls.push({ method, url: urlStr });
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(mockResponse(200, lockBody, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete',
        type: 'SRVB',
        name: 'ZSB_TRAVEL_O4',
      });

      expect(result.isError).toBeUndefined();
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('_action=LOCK'))).toBe(true);
      expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/sap/bc/adt/businessservices/bindings/'))).toBe(
        true,
      );
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('_action=UNLOCK'))).toBe(true);
    });

    it('batch_create supports SRVB as metadata object', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string }> = [];
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        calls.push({ method: opts?.method ?? 'GET', url: String(url) });
        return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      });

      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [
          { type: 'SRVD', name: 'ZSD_TRAVEL', source: 'define service ZSD_TRAVEL {}' },
          { type: 'SRVB', name: 'ZSB_TRAVEL_O4', serviceDefinition: 'ZSD_TRAVEL', category: '0' },
        ],
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('ZSD_TRAVEL (SRVD) ✓');
      expect(result.content[0]?.text).toContain('ZSB_TRAVEL_O4 (SRVB) ✓');
      expect(
        calls.some(
          (c) =>
            c.method === 'PUT' &&
            c.url.includes('/sap/bc/adt/businessservices/bindings/') &&
            c.url.includes('/source/main'),
        ),
      ).toBe(false);
    });

    it('respects package restrictions for DOMA create', async () => {
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] },
      });
      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'DOMA',
        name: 'ZDOMAIN',
        package: 'ZBLOCKED',
        dataType: 'CHAR',
        length: 1,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('blocked');
    });

    it('blocks DTEL create in read-only mode', async () => {
      const readOnlyClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowWrites: false },
      });
      const result = await handleToolCall(readOnlyClient, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'DTEL',
        name: 'ZTEXT',
        package: '$TMP',
        typeKind: 'predefinedAbapType',
        dataType: 'CHAR',
        length: 10,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('blocked');
    });

    it('blocks SRVB create in read-only mode', async () => {
      const readOnlyClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowWrites: false },
      });
      const result = await handleToolCall(readOnlyClient, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'SRVB',
        name: 'ZSB_TRAVEL_O4',
        package: '$TMP',
        serviceDefinition: 'ZSD_TRAVEL',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('blocked');
    });
  });

  describe('SAPWrite TABL source-based writes', () => {
    it('creates TABL using collection POST + source PUT', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; contentType?: string }> = [];
      mockFetch.mockImplementation(
        (url: string | URL, opts?: { method?: string; headers?: Record<string, string> }) => {
          const method = opts?.method ?? 'GET';
          const headers = (opts?.headers ?? {}) as Record<string, string>;
          const urlStr = String(url);
          calls.push({ method, url: urlStr, contentType: headers['content-type'] ?? headers['Content-Type'] });
          if (method === 'POST' && urlStr.includes('_action=LOCK')) {
            return Promise.resolve(
              mockResponse(200, '<asx:values><LOCK_HANDLE>LH1</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
                'x-csrf-token': 'T',
              }),
            );
          }
          return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
        },
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'TABL',
        name: 'ZTABL_CREATE',
        package: '$TMP',
        source:
          "@EndUserText.label : 'Create test'\ndefine table ztabl_create { key client : abap.clnt; key id : abap.numc(8); }",
      });

      expect(result.isError).toBeUndefined();

      const createCall = calls.find(
        (c) => c.method === 'POST' && c.url.includes('/sap/bc/adt/ddic/tables') && !c.url.includes('_action='),
      );
      expect(createCall).toBeDefined();
      if (createCall?.contentType) {
        expect(createCall.contentType).toContain('application/*');
      }

      const sourcePut = calls.find(
        (c) => c.method === 'PUT' && c.url.includes('/sap/bc/adt/ddic/tables/ZTABL_CREATE/source/main'),
      );
      expect(sourcePut).toBeDefined();

      const metadataPut = calls.find(
        (c) => c.method === 'PUT' && c.url.includes('/sap/bc/adt/ddic/tables/ZTABL_CREATE?'),
      );
      expect(metadataPut).toBeUndefined();
    });

    it('updates TABL via source/main path', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string }> = [];
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        calls.push({ method, url: urlStr });
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(
            mockResponse(200, '<asx:values><LOCK_HANDLE>LH2</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
              'x-csrf-token': 'T',
            }),
          );
        }
        return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'TABL',
        name: 'ZTABL_UPDATE',
        source:
          "@EndUserText.label : 'Update test'\ndefine table ztabl_update { key client : abap.clnt; key id : abap.numc(8); descr : abap.char(40); }",
      });

      expect(result.isError).toBeUndefined();
      expect(
        calls.some((c) => c.method === 'PUT' && c.url.includes('/sap/bc/adt/ddic/tables/ZTABL_UPDATE/source/main')),
      ).toBe(true);
      expect(calls.some((c) => c.method === 'PUT' && c.url.includes('/sap/bc/adt/ddic/tables/ZTABL_UPDATE?'))).toBe(
        false,
      );
    });

    it('deletes TABL via lock/delete/unlock flow', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string }> = [];
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        calls.push({ method, url: urlStr });
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(
            mockResponse(200, '<asx:values><LOCK_HANDLE>LH3</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
              'x-csrf-token': 'T',
            }),
          );
        }
        return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete',
        type: 'TABL',
        name: 'ZTABL_DELETE',
      });

      expect(result.isError).toBeUndefined();
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('_action=LOCK'))).toBe(true);
      expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/sap/bc/adt/ddic/tables/ZTABL_DELETE'))).toBe(
        true,
      );
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('_action=UNLOCK'))).toBe(true);
    });

    it('refuses TABL create when /sap/bc/adt/ddic/tables/ is missing from discovery (issue #285)', async () => {
      // Simulate NW 7.50: discovery feed only advertises /ddic/structures, not /ddic/tables.
      // Pre-fix this 404'd at the POST collection with a confusing error; post-fix we refuse
      // upfront with the SE11 hint.
      setCachedFeatures({
        ...featuresOff(),
        abapRelease: '750',
        systemType: 'onprem',
        discoveryMap: new Map<string, string[]>([['/sap/bc/adt/ddic/structures', ['application/*']]]),
      });
      try {
        mockFetch.mockReset();
        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
          action: 'create',
          type: 'TABL',
          name: 'ZTABL_750',
          package: '$TMP',
          source: "@EndUserText.label : 'NW 7.50 test'\ndefine table ztabl_750 { key client : abap.clnt; }",
        });
        expect(result.isError).toBe(true);
        const message = result.content[0]?.text ?? '';
        expect(message).toContain('Transparent table writes via ADT REST are not available');
        expect(message).toContain('NW 7.50/7.51');
        expect(message).toContain('SE11');
        expect(message).toContain('TABCLASS');
        // The handler must refuse BEFORE making any HTTP call to /tables/.
        expect(mockFetch.mock.calls).toHaveLength(0);
      } finally {
        resetCachedFeatures();
      }
    });

    it('refuses TABL update when search reports TABL/DT and /tables/ is missing (issue #285)', async () => {
      // Update path goes through resolveTablObjectUrlForWrite. On NW 7.50 the resolver
      // throws AdtSafetyError before any PUT can fire.
      setCachedFeatures({
        ...featuresOff(),
        abapRelease: '750',
        systemType: 'onprem',
        discoveryMap: new Map<string, string[]>([['/sap/bc/adt/ddic/structures', ['application/*']]]),
      });
      try {
        mockFetch.mockReset();
        mockFetch.mockResolvedValueOnce(
          mockResponse(
            200,
            `<?xml version="1.0" encoding="utf-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/vit/wb/object_type/tabldt/object_name/SCARR" adtcore:type="TABL/DT" adtcore:name="SCARR"/>
</adtcore:objectReferences>`,
          ),
        );
        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
          action: 'update',
          type: 'TABL',
          name: 'SCARR',
          source: "@EndUserText.label : 'Hijack'\ndefine table scarr { key mandt : abap.clnt; }",
        });
        expect(result.isError).toBe(true);
        const message = result.content[0]?.text ?? '';
        expect(message).toContain('Transparent table writes via ADT REST are not available');
        expect(message).toContain('SCARR');
        // Only the search HTTP call should have fired — no PUT, no lock, no /structures/ contact.
        const callUrls = mockFetch.mock.calls.map((c: unknown[]) => String(c[0]));
        expect(callUrls.some((u) => u.includes('/source/main'))).toBe(false);
        expect(callUrls.some((u) => u.includes('_action=LOCK'))).toBe(false);
        expect(callUrls.some((u) => u.includes('/sap/bc/adt/ddic/structures/SCARR'))).toBe(false);
      } finally {
        resetCachedFeatures();
      }
    });

    it('allows TABL update for TABL/DS structures on 7.50 (structures endpoint is available)', async () => {
      // Structures live at /ddic/structures/ on all releases — writes must still succeed.
      setCachedFeatures({
        ...featuresOff(),
        abapRelease: '750',
        systemType: 'onprem',
        discoveryMap: new Map<string, string[]>([['/sap/bc/adt/ddic/structures', ['application/*']]]),
      });
      try {
        mockFetch.mockReset();
        const calls: Array<{ method: string; url: string }> = [];
        mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
          const method = opts?.method ?? 'GET';
          const urlStr = String(url);
          calls.push({ method, url: urlStr });
          if (method === 'GET' && urlStr.includes('/informationsystem/search?')) {
            return Promise.resolve(
              mockResponse(
                200,
                `<?xml version="1.0" encoding="utf-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/structures/ZSTRU_750" adtcore:type="TABL/DS" adtcore:name="ZSTRU_750"/>
</adtcore:objectReferences>`,
              ),
            );
          }
          if (method === 'POST' && urlStr.includes('_action=LOCK')) {
            return Promise.resolve(
              mockResponse(200, '<asx:values><LOCK_HANDLE>LH7</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
                'x-csrf-token': 'T',
              }),
            );
          }
          return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
        });

        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
          action: 'update',
          type: 'TABL',
          name: 'ZSTRU_750',
          source: "@EndUserText.label : '7.50 struct'\ndefine type zstru_750 { mandt : abap.clnt; }",
        });
        expect(result.isError).toBeUndefined();
        expect(
          calls.some((c) => c.method === 'PUT' && c.url.includes('/sap/bc/adt/ddic/structures/ZSTRU_750/source/main')),
        ).toBe(true);
        // Must not have hit /tables/ — search returned TABL/DS, so the resolver picked /structures/.
        expect(calls.some((c) => c.url.includes('/sap/bc/adt/ddic/tables/ZSTRU_750'))).toBe(false);
      } finally {
        resetCachedFeatures();
      }
    });

    it('refuses TABL in batch_create when /tables/ is missing — other entries continue (issue #285)', async () => {
      setCachedFeatures({
        ...featuresOff(),
        abapRelease: '750',
        systemType: 'onprem',
        discoveryMap: new Map<string, string[]>([['/sap/bc/adt/ddic/structures', ['application/*']]]),
      });
      try {
        mockFetch.mockReset();
        mockFetch.mockResolvedValue(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
        const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
        const result = await handleToolCall(createClient(), config, 'SAPWrite', {
          action: 'batch_create',
          package: '$TMP',
          objects: [
            { type: 'DOMA', name: 'ZD_OK_750', dataType: 'CHAR', length: 1 },
            {
              type: 'TABL',
              name: 'ZTABL_750_BATCH',
              source: "@EndUserText.label : 'batch'\ndefine table ztabl_750_batch { key client : abap.clnt; }",
            },
          ],
        });
        const message = result.content[0]?.text ?? '';
        // TABL entry must be marked failed with the SE11 hint
        expect(message).toContain('ZTABL_750_BATCH');
        expect(message).toContain('Transparent table writes via ADT REST are not available');
      } finally {
        resetCachedFeatures();
      }
    });

    it('batch_create supports TABL source processing', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string }> = [];
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        calls.push({ method, url: urlStr });
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(
            mockResponse(200, '<asx:values><LOCK_HANDLE>LH4</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
              'x-csrf-token': 'T',
            }),
          );
        }
        return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      });

      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [
          {
            type: 'TABL',
            name: 'ZTABL_BATCH',
            source:
              "@EndUserText.label : 'Batch test'\ndefine table ztabl_batch { key client : abap.clnt; key id : abap.numc(8); }",
          },
        ],
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('ZTABL_BATCH (TABL)');
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('/sap/bc/adt/ddic/tables/'))).toBe(true);
      expect(
        calls.some((c) => c.method === 'PUT' && c.url.includes('/sap/bc/adt/ddic/tables/ZTABL_BATCH/source/main')),
      ).toBe(true);
    });
  });

  // TABL subtype routing on create (follow-up to issue #285)
  // Bug shape: SAPWrite(action='create', type='TABL/DS') always routed to
  // /sap/bc/adt/ddic/tables with adtcore:type="TABL/DT" because:
  //   1. normalizeObjectType('TABL/DS') collapsed to bare 'TABL' before validation
  //   2. objectBasePath('TABL') hardcoded /sap/bc/adt/ddic/tables/
  //   3. buildCreateXml('TABL') hardcoded adtcore:type="TABL/DT"
  // The fix preserves the slash form for SAPWrite, branches URL + envelope on
  // subtype, and scopes PR #286's discovery-gated refusal to bare TABL + TABL/DT.
  // ──────────────────────────────────────────────────────────────────────────
  describe('SAPWrite TABL/DS create routing (follow-up to issue #285)', () => {
    it('SAPWrite create type="TABL/DS" routes POST to /sap/bc/adt/ddic/structures and emits adtcore:type="TABL/DS"', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        calls.push({ method, url: urlStr, body: opts?.body });
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(
            mockResponse(200, '<asx:values><LOCK_HANDLE>LHDS</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
              'x-csrf-token': 'T',
            }),
          );
        }
        return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'TABL/DS',
        name: 'ZSTR_NEW',
        package: '$TMP',
        source: "@EndUserText.label : 'x'\ndefine structure zstr_new { mandt : abap.clnt; }",
      });

      expect(result.isError).toBeUndefined();

      // Must POST to /structures, not /tables
      const createCall = calls.find(
        (c) => c.method === 'POST' && !c.url.includes('_action=') && c.url.includes('/sap/bc/adt/ddic/structures'),
      );
      expect(createCall).toBeDefined();
      expect(createCall?.body).toContain('adtcore:type="TABL/DS"');

      // Source PUT must also land on /structures
      const sourcePut = calls.find(
        (c) => c.method === 'PUT' && c.url.includes('/sap/bc/adt/ddic/structures/ZSTR_NEW/source/main'),
      );
      expect(sourcePut).toBeDefined();

      // Must NOT have touched /tables for this object
      expect(calls.some((c) => c.url.includes('/sap/bc/adt/ddic/tables/ZSTR_NEW'))).toBe(false);
    });

    it('SAPWrite create type="TABL/DT" routes POST to /sap/bc/adt/ddic/tables and emits adtcore:type="TABL/DT"', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        calls.push({ method, url: urlStr, body: opts?.body });
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(
            mockResponse(200, '<asx:values><LOCK_HANDLE>LHDT</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
              'x-csrf-token': 'T',
            }),
          );
        }
        return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'TABL/DT',
        name: 'ZTBL_NEW',
        package: '$TMP',
        source: "@EndUserText.label : 'x'\ndefine table ztbl_new { key client : abap.clnt; key id : abap.numc(8); }",
      });

      expect(result.isError).toBeUndefined();
      const createCall = calls.find(
        (c) => c.method === 'POST' && !c.url.includes('_action=') && c.url.includes('/sap/bc/adt/ddic/tables'),
      );
      expect(createCall).toBeDefined();
      expect(createCall?.body).toContain('adtcore:type="TABL/DT"');
    });

    it('SAPWrite create with bare type="TABL" defaults to TABL/DT (backward compatibility)', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        calls.push({ method, url: urlStr, body: opts?.body });
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(
            mockResponse(200, '<asx:values><LOCK_HANDLE>LHBARE</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
              'x-csrf-token': 'T',
            }),
          );
        }
        return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'TABL',
        name: 'ZTBL_LEGACY',
        package: '$TMP',
        source: "@EndUserText.label : 'x'\ndefine table ztbl_legacy { key client : abap.clnt; key id : abap.numc(8); }",
      });

      expect(result.isError).toBeUndefined();
      const createCall = calls.find(
        (c) => c.method === 'POST' && !c.url.includes('_action=') && c.url.includes('/sap/bc/adt/ddic/tables'),
      );
      expect(createCall).toBeDefined();
      expect(createCall?.body).toContain('adtcore:type="TABL/DT"');
      // Must NOT route to /structures for bare TABL — backward-compat alias for TABL/DT
      expect(calls.some((c) => c.url.includes('/sap/bc/adt/ddic/structures/ZTBL_LEGACY'))).toBe(false);
    });

    it('PR #286 discovery gate allows TABL/DS create when discovery lacks /sap/bc/adt/ddic/tables (NW 7.50)', async () => {
      // The gate refuses bare TABL + TABL/DT when /tables/ is missing (PR #286 fix
      // for issue #285). TABL/DS must skip the gate because /structures/ exists on
      // every ADT release. This unlocks structure CRUD on NW 7.50 as a bonus.
      setCachedFeatures({
        ...featuresOff(),
        abapRelease: '750',
        systemType: 'onprem',
        discoveryMap: new Map<string, string[]>([['/sap/bc/adt/ddic/structures', ['application/*']]]),
      });
      try {
        mockFetch.mockReset();
        const calls: Array<{ method: string; url: string; body?: string }> = [];
        mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string }) => {
          const method = opts?.method ?? 'GET';
          const urlStr = String(url);
          calls.push({ method, url: urlStr, body: opts?.body });
          if (method === 'POST' && urlStr.includes('_action=LOCK')) {
            return Promise.resolve(
              mockResponse(200, '<asx:values><LOCK_HANDLE>LH750</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
                'x-csrf-token': 'T',
              }),
            );
          }
          return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
        });

        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
          action: 'create',
          type: 'TABL/DS',
          name: 'ZSTR_NW750_OK',
          package: '$TMP',
          source: 'define structure zstr_nw750_ok { mandt : abap.clnt; }',
        });

        expect(result.isError).toBeUndefined();
        // POST landed on /structures, NOT /tables
        expect(
          calls.some(
            (c) => c.method === 'POST' && !c.url.includes('_action=') && c.url.includes('/sap/bc/adt/ddic/structures'),
          ),
        ).toBe(true);
        expect(calls.some((c) => c.url.includes('/sap/bc/adt/ddic/tables'))).toBe(false);
      } finally {
        resetCachedFeatures();
      }
    });

    it('PR #286 discovery gate still refuses bare TABL create when /tables/ is missing', async () => {
      // Regression guard: PR #286's refusal must continue to fire for bare TABL.
      setCachedFeatures({
        ...featuresOff(),
        abapRelease: '750',
        systemType: 'onprem',
        discoveryMap: new Map<string, string[]>([['/sap/bc/adt/ddic/structures', ['application/*']]]),
      });
      try {
        mockFetch.mockReset();
        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
          action: 'create',
          type: 'TABL',
          name: 'ZTBL_NW750_FAIL',
          package: '$TMP',
          source: 'define table ztbl_nw750_fail { key client : abap.clnt; }',
        });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text ?? '').toContain('Transparent table writes via ADT REST are not available');
      } finally {
        resetCachedFeatures();
      }
    });

    it('PR #286 discovery gate also refuses explicit TABL/DT create when /tables/ is missing', async () => {
      // Explicit transparent-table form must hit the same refusal as bare TABL.
      setCachedFeatures({
        ...featuresOff(),
        abapRelease: '750',
        systemType: 'onprem',
        discoveryMap: new Map<string, string[]>([['/sap/bc/adt/ddic/structures', ['application/*']]]),
      });
      try {
        mockFetch.mockReset();
        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
          action: 'create',
          type: 'TABL/DT',
          name: 'ZTBL_DT_NW750_FAIL',
          package: '$TMP',
          source: 'define table ztbl_dt_nw750_fail { key client : abap.clnt; }',
        });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text ?? '').toContain('Transparent table writes via ADT REST are not available');
      } finally {
        resetCachedFeatures();
      }
    });

    it('SAPWrite batch_create: TABL/DS succeeds while TABL/DT is refused on NW 7.50 (mixed batch)', async () => {
      setCachedFeatures({
        ...featuresOff(),
        abapRelease: '750',
        systemType: 'onprem',
        discoveryMap: new Map<string, string[]>([['/sap/bc/adt/ddic/structures', ['application/*']]]),
      });
      try {
        mockFetch.mockReset();
        mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
          const method = opts?.method ?? 'GET';
          const urlStr = String(url);
          if (method === 'POST' && urlStr.includes('_action=LOCK')) {
            return Promise.resolve(
              mockResponse(200, '<asx:values><LOCK_HANDLE>LHB</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
                'x-csrf-token': 'T',
              }),
            );
          }
          return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
        });

        const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
        const result = await handleToolCall(createClient(), config, 'SAPWrite', {
          action: 'batch_create',
          package: '$TMP',
          objects: [
            {
              type: 'TABL/DS',
              name: 'ZSTR_MIX_BATCH',
              source: 'define structure zstr_mix_batch { mandt : abap.clnt; }',
            },
            {
              type: 'TABL/DT',
              name: 'ZTBL_MIX_BATCH',
              source: 'define table ztbl_mix_batch { key client : abap.clnt; }',
            },
          ],
        });
        const message = result.content[0]?.text ?? '';
        // TABL/DS entry succeeds; TABL/DT entry fails with the SE11 hint
        expect(message).toContain('ZSTR_MIX_BATCH');
        expect(message).toContain('ZTBL_MIX_BATCH');
        expect(message).toContain('Transparent table writes via ADT REST are not available');
      } finally {
        resetCachedFeatures();
      }
    });

    // ────────────────────────────────────────────────────────────────────────
    // Codex review follow-ups (addressed before merging the TABL/DS fix):
    //   Issue 1: explicit TABL/DT and TABL/DS on update/delete must go through
    //            resolveTablObjectUrlForWrite (PR #286 search-first resolver)
    //            so the NW 7.50 SE11-hint refusal still fires.
    //   Issue 2: legacy STRU/DS alias must remap to TABL/DS on SAPWrite create
    //            (not collapse to bare TABL via SLASH_TYPE_MAP).
    //   Issue 3: canonical-type Sets (DDIC hints, RAP preflight, cache) must
    //            see bare 'TABL' even when the routing layer used a slash form.
    // ────────────────────────────────────────────────────────────────────────

    it('SAPWrite update type="TABL/DS" routes through resolveTablObjectUrlForWrite (Codex issue 1)', async () => {
      // Search must be called (the resolver's first action) and the resolved
      // /structures/ URL must be used for the PUT — proving the PR #286
      // search-first contract applies to explicit slash forms too.
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string }> = [];
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        calls.push({ method, url: urlStr });
        if (method === 'GET' && urlStr.includes('/informationsystem/search?')) {
          return Promise.resolve(
            mockResponse(
              200,
              `<?xml version="1.0" encoding="utf-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/structures/BAPIRET2" adtcore:type="TABL/DS" adtcore:name="BAPIRET2"/>
</adtcore:objectReferences>`,
            ),
          );
        }
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(
            mockResponse(200, '<asx:values><LOCK_HANDLE>LH_DS_UPD</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
              'x-csrf-token': 'T',
            }),
          );
        }
        return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'TABL/DS',
        name: 'BAPIRET2',
        source: "@EndUserText.label : 'x'\ndefine structure bapiret2 { mandt : mandt; }",
      });

      expect(result.isError).toBeUndefined();
      // Search must have been called (signature of the search-first resolver)
      expect(calls.some((c) => c.url.includes('/informationsystem/search?'))).toBe(true);
      // PUT must land at /structures/ (resolver returned the canonical URL)
      expect(
        calls.some((c) => c.method === 'PUT' && c.url.includes('/sap/bc/adt/ddic/structures/BAPIRET2/source/main')),
      ).toBe(true);
    });

    it('SAPWrite update type="TABL/DT" on NW 7.50 refuses via the search-first resolver (Codex issue 1)', async () => {
      // The explicit TABL/DT slash form must hit the same SE11-hint refusal as
      // bare TABL when /sap/bc/adt/ddic/tables/ is missing from discovery.
      setCachedFeatures({
        ...featuresOff(),
        abapRelease: '750',
        systemType: 'onprem',
        discoveryMap: new Map<string, string[]>([['/sap/bc/adt/ddic/structures', ['application/*']]]),
      });
      try {
        mockFetch.mockReset();
        // First call: search returns TABL/DT — resolver decides this is a
        // transparent table and the discovery map says /tables/ is unavailable
        // → throws AdtSafetyError before any PUT.
        mockFetch.mockResolvedValueOnce(
          mockResponse(
            200,
            `<?xml version="1.0" encoding="utf-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/vit/wb/object_type/tabldt/object_name/SCARR" adtcore:type="TABL/DT" adtcore:name="SCARR"/>
</adtcore:objectReferences>`,
          ),
        );
        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
          action: 'update',
          type: 'TABL/DT',
          name: 'SCARR',
          source: "@EndUserText.label : 'hijack'\ndefine table scarr { key mandt : mandt; }",
        });
        expect(result.isError).toBe(true);
        const message = result.content[0]?.text ?? '';
        expect(message).toContain('Transparent table writes via ADT REST are not available');
        expect(message).toContain('SCARR');
        // No PUT / LOCK should have fired — refusal happens during URL resolution.
        const urls = mockFetch.mock.calls.map((c: unknown[]) => String(c[0]));
        expect(urls.some((u) => u.includes('/source/main'))).toBe(false);
        expect(urls.some((u) => u.includes('_action=LOCK'))).toBe(false);
      } finally {
        resetCachedFeatures();
      }
    });

    it('SAPWrite create type="STRU/DS" remaps to TABL/DS and routes to /structures/ (Codex issue 2)', async () => {
      // Legacy STRU/DS alias must reach the structures endpoint via the SAPWrite
      // normalizer's alias remap, NOT collapse to bare TABL through SLASH_TYPE_MAP.
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        calls.push({ method, url: urlStr, body: opts?.body });
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(
            mockResponse(200, '<asx:values><LOCK_HANDLE>LH_STRU_DS</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
              'x-csrf-token': 'T',
            }),
          );
        }
        return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'STRU/DS',
        name: 'ZSTR_FROM_STRU_DS',
        package: '$TMP',
        source: 'define structure zstr_from_stru_ds { mandt : mandt; }',
      });

      expect(result.isError).toBeUndefined();
      const createCall = calls.find(
        (c) => c.method === 'POST' && !c.url.includes('_action=') && c.url.includes('/sap/bc/adt/ddic/structures'),
      );
      expect(createCall).toBeDefined();
      expect(createCall?.body).toContain('adtcore:type="TABL/DS"');
      // Must NOT route to /tables/ — that's the bug the alias remap prevents.
      expect(calls.some((c) => c.url.includes('/sap/bc/adt/ddic/tables/ZSTR_FROM_STRU_DS'))).toBe(false);
    });

    it('SAPRead with type="TABL/DS" still collapses to bare TABL on the read path (regression guard)', async () => {
      // The SAPWrite-aware normalizer must NOT leak into SAPRead — the read
      // path still uses the global SLASH_TYPE_MAP collapse so getTabl()'s 404
      // fallback handles either endpoint.
      mockFetch.mockReset();
      // getTabl() probes /tables/ first, falls back to /structures/ on 404.
      mockFetch.mockResolvedValueOnce(mockResponse(404, '<?xml version="1.0"?><error/>'));
      mockFetch.mockResolvedValueOnce(
        mockResponse(200, "@EndUserText.label : 'BAPIRET2'\ndefine structure bapiret2 { mandt : mandt; }"),
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'TABL/DS',
        name: 'BAPIRET2',
      });
      expect(result.isError).toBeUndefined();
      const urls = mockFetch.mock.calls.map((c: unknown[]) => String(c[0]));
      // The 404 fallback chain proves we went through the read-path resolver,
      // not the SAPWrite-aware one (which would skip the probe).
      expect(urls.some((u) => u.includes('/sap/bc/adt/ddic/tables/BAPIRET2'))).toBe(true);
      expect(urls.some((u) => u.includes('/sap/bc/adt/ddic/structures/BAPIRET2'))).toBe(true);
    });

    it('SAPWrite batch_create with mixed TABL/DT + TABL/DS on a complete discovery map routes each to its own endpoint', async () => {
      // Full discovery map (both /tables and /structures advertised), so both
      // entries succeed. Asserts TABL/DT lands at /tables/, TABL/DS at /structures/,
      // and there's no cross-routing.
      setCachedFeatures({
        ...featuresOff(),
        abapRelease: '758',
        systemType: 'onprem',
        discoveryMap: new Map<string, string[]>([
          ['/sap/bc/adt/ddic/tables', ['application/*']],
          ['/sap/bc/adt/ddic/structures', ['application/*']],
        ]),
      });
      try {
        mockFetch.mockReset();
        const calls: Array<{ method: string; url: string }> = [];
        mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
          const method = opts?.method ?? 'GET';
          const urlStr = String(url);
          calls.push({ method, url: urlStr });
          if (method === 'POST' && urlStr.includes('_action=LOCK')) {
            return Promise.resolve(
              mockResponse(200, '<asx:values><LOCK_HANDLE>LH_BOTH</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
                'x-csrf-token': 'T',
              }),
            );
          }
          return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
        });

        const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
        const result = await handleToolCall(createClient(), config, 'SAPWrite', {
          action: 'batch_create',
          package: '$TMP',
          objects: [
            { type: 'TABL/DT', name: 'ZTBL_BOTH', source: 'define table ztbl_both { key client : abap.clnt; }' },
            { type: 'TABL/DS', name: 'ZSTR_BOTH', source: 'define structure zstr_both { mandt : mandt; }' },
          ],
        });

        expect(result.isError).toBeUndefined();
        const text = result.content[0]?.text ?? '';
        expect(text).toContain('ZTBL_BOTH');
        expect(text).toContain('ZSTR_BOTH');
        // Per-entry routing isolation: TABL/DT only touches /tables/ZTBL_BOTH,
        // TABL/DS only touches /structures/ZSTR_BOTH.
        expect(calls.some((c) => c.url.includes('/sap/bc/adt/ddic/tables/ZTBL_BOTH'))).toBe(true);
        expect(calls.some((c) => c.url.includes('/sap/bc/adt/ddic/structures/ZSTR_BOTH'))).toBe(true);
        expect(calls.some((c) => c.url.includes('/sap/bc/adt/ddic/structures/ZTBL_BOTH'))).toBe(false);
        expect(calls.some((c) => c.url.includes('/sap/bc/adt/ddic/tables/ZSTR_BOTH'))).toBe(false);
      } finally {
        resetCachedFeatures();
      }
    });
  });

  describe('SAPWrite DCLS source-based writes', () => {
    it('creates DCLS using collection POST + source PUT', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        calls.push({ method, url: urlStr, body: opts?.body });
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(
            mockResponse(200, '<asx:values><LOCK_HANDLE>LH_DCL_1</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
              'x-csrf-token': 'T',
            }),
          );
        }
        return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'DCLS',
        name: 'ZTEST_DCL',
        package: '$TMP',
        source: `@MappingRole: true
define role ZTEST_DCL {
  grant select on ZI_TEST_ENTITY
  where inheriting conditions from super;
}`,
      });

      expect(result.isError).toBeUndefined();
      const createCall = calls.find(
        (c) => c.method === 'POST' && c.url.includes('/sap/bc/adt/acm/dcl/sources') && !c.url.includes('_action='),
      );
      expect(createCall).toBeDefined();
      expect(createCall?.body).toContain('<dcl:dclSource');
      expect(createCall?.body).toContain('http://www.sap.com/adt/acm/dclsources');
      expect(createCall?.body).toContain('adtcore:type="DCLS/DL"');
      expect(
        calls.some((c) => c.method === 'PUT' && c.url.includes('/sap/bc/adt/acm/dcl/sources/ZTEST_DCL/source/main')),
      ).toBe(true);
    });

    it('updates DCLS via source/main path', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string }> = [];
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        calls.push({ method, url: urlStr });
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(
            mockResponse(200, '<asx:values><LOCK_HANDLE>LH_DCL_2</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
              'x-csrf-token': 'T',
            }),
          );
        }
        return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'DCLS',
        name: 'ZTEST_DCL',
        source: `@MappingRole: true
define role ZTEST_DCL {
  grant select on ZI_TEST_ENTITY;
}`,
      });

      expect(result.isError).toBeUndefined();
      expect(
        calls.some((c) => c.method === 'PUT' && c.url.includes('/sap/bc/adt/acm/dcl/sources/ZTEST_DCL/source/main')),
      ).toBe(true);
    });

    it('deletes DCLS via lock/delete/unlock flow', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string }> = [];
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        calls.push({ method, url: urlStr });
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(
            mockResponse(200, '<asx:values><LOCK_HANDLE>LH_DCL_3</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
              'x-csrf-token': 'T',
            }),
          );
        }
        return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete',
        type: 'DCLS',
        name: 'ZTEST_DCL',
      });

      expect(result.isError).toBeUndefined();
      expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/sap/bc/adt/acm/dcl/sources/ZTEST_DCL'))).toBe(
        true,
      );
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('_action=UNLOCK'))).toBe(true);
    });
  });

  describe('BDEF content type in SAPWrite create', () => {
    it('uses vendor-specific content type for BDEF create', async () => {
      mockFetch.mockReset();
      // Track all fetch calls
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'BDEF',
        name: 'ZI_TRAVEL',
        source: 'managed implementation in class ZBP_I_TRAVEL unique;\ndefine behavior for ZI_TRAVEL\n{}',
        description: 'Travel behavior',
      });
      // Find the POST call that creates the object (the one to the parent collection URL)
      const createCall = mockFetch.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('bo/behaviordefinitions') &&
          typeof c[1] === 'object' &&
          (c[1] as Record<string, unknown>).method === 'POST',
      );
      if (createCall) {
        const headers = (createCall[1] as Record<string, Record<string, string>>).headers;
        expect(headers?.['Content-Type'] ?? headers?.['content-type']).toContain(
          'application/vnd.sap.adt.blues.v1+xml',
        );
      }
    });

    it('passes _package query parameter for BDEF create', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));

      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'BDEF',
        name: 'ZI_TRAVEL',
        source: 'managed implementation in class ZBP_I_TRAVEL unique;\ndefine behavior for ZI_TRAVEL\n{}',
        package: 'ZRAP_TEST',
      });

      const createCall = mockFetch.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('/sap/bc/adt/bo/behaviordefinitions') &&
          c[0].includes('_package=ZRAP_TEST') &&
          typeof c[1] === 'object' &&
          (c[1] as Record<string, unknown>).method === 'POST',
      );
      expect(createCall).toBeDefined();
    });

    it('does not pass _package query parameter for DDLS create', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));

      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'DDLS',
        name: 'ZI_TRAVEL',
        source: 'define view entity ZI_TRAVEL as select from sflight { key carrid }',
        package: 'ZRAP_TEST',
      });

      const ddlsCreateCalls = mockFetch.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('/sap/bc/adt/ddic/ddl/sources') &&
          typeof c[1] === 'object' &&
          (c[1] as Record<string, unknown>).method === 'POST',
      );
      const callWithPackage = ddlsCreateCalls.find((c: unknown[]) => String(c[0]).includes('_package='));
      expect(callWithPackage).toBeUndefined();
    });

    it('passes _package query parameter for TABL in batch_create', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));

      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'batch_create',
        package: 'ZRAP_TEST',
        objects: [
          {
            type: 'TABL',
            name: 'ZTABL_TEST',
            source:
              "@EndUserText.label : 'T'\n@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE\n@AbapCatalog.tableCategory : #TRANSPARENT\n@AbapCatalog.deliveryClass : #A\n@AbapCatalog.dataMaintenance : #RESTRICTED\ndefine table ZTABL_TEST { key client : abap.clnt not null; }",
          },
        ],
      });

      const createCall = mockFetch.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('/sap/bc/adt/ddic/tables') &&
          c[0].includes('_package=ZRAP_TEST') &&
          typeof c[1] === 'object' &&
          (c[1] as Record<string, unknown>).method === 'POST',
      );
      expect(createCall).toBeDefined();
    });

    it('passes object-specific _package query parameter for TABL in batch_create', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));

      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'batch_create',
        objects: [
          {
            type: 'TABL',
            name: 'ZTABL_TEST',
            package: 'ZOBJPKG',
            transport: 'A4HK900123',
            source:
              "@EndUserText.label : 'T'\n@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE\n@AbapCatalog.tableCategory : #TRANSPARENT\n@AbapCatalog.deliveryClass : #A\n@AbapCatalog.dataMaintenance : #RESTRICTED\ndefine table ZTABL_TEST { key client : abap.clnt not null; }",
          },
        ],
      });

      const createCall = mockFetch.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('/sap/bc/adt/ddic/tables') &&
          c[0].includes('_package=ZOBJPKG') &&
          !c[0].includes('_package=%24TMP') &&
          typeof c[1] === 'object' &&
          (c[1] as Record<string, unknown>).method === 'POST',
      );
      expect(createCall).toBeDefined();
      expect((createCall?.[1] as Record<string, unknown> | undefined)?.body).toContain(
        '<adtcore:packageRef adtcore:name="ZOBJPKG"/>',
      );
    });

    it('passes _package query parameter for BDEF in batch_create', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));

      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'batch_create',
        package: 'ZRAP_TEST',
        objects: [
          {
            type: 'BDEF',
            name: 'ZI_TRAVEL',
            source: 'managed implementation in class ZBP_I_TRAVEL unique;\ndefine behavior for ZI_TRAVEL\n{}',
          },
        ],
      });

      const createCall = mockFetch.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('/sap/bc/adt/bo/behaviordefinitions') &&
          c[0].includes('_package=ZRAP_TEST') &&
          typeof c[1] === 'object' &&
          (c[1] as Record<string, unknown>).method === 'POST',
      );
      expect(createCall).toBeDefined();
    });

    it('appends inactive syntax-check detail to TABL create errors', async () => {
      const createErrorXml = `<?xml version="1.0" encoding="utf-8"?>
<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <exc:localizedMessage lang="EN">Can't save due to errors in source</exc:localizedMessage>
  <exc:properties>
    <entry key="T100KEY-MSGID">SBD_MESSAGES</entry>
    <entry key="T100KEY-MSGNO">007</entry>
  </exc:properties>
</exc:exception>`;
      const syntaxResultXml =
        '<checkMessages><msg type="E" line="5" col="1" shortText="Unknown annotation"/></checkMessages>';

      mockFetch.mockReset();
      mockFetch.mockImplementation(async (input: unknown, init?: { method?: string }) => {
        const url = typeof input === 'string' ? input : String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method === 'POST' && url.includes('/sap/bc/adt/checkruns')) {
          return mockResponse(200, syntaxResultXml, { 'x-csrf-token': 'T' });
        }
        if (method === 'POST' && url.includes('/sap/bc/adt/ddic/tables')) {
          return mockResponse(400, createErrorXml, { 'x-csrf-token': 'T' });
        }
        return mockResponse(200, '', { 'x-csrf-token': 'T' });
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'TABL',
        name: 'ZTABL_FAIL',
        source: 'define table ztabl_fail { key client : abap.clnt not null; }',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Server syntax check (inactive):');
      expect(result.content[0]?.text).toContain('[line 5] Unknown annotation');
    });
  });

  describe('SAPWrite create — master language wiring (issue #343)', () => {
    function dtelCreatePostBody(): string | undefined {
      const call = mockFetch.mock.calls.find(
        (c: any[]) => String(c[0]).includes('/sap/bc/adt/ddic/dataelements') && c[1]?.method === 'POST',
      );
      return call?.[1]?.body as string | undefined;
    }

    it('threads config.language into the DTEL create POST body', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(201, '<blue:wbobj/>', { 'x-csrf-token': 't' }));
      const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, language: 'DE' }, 'SAPWrite', {
        action: 'create',
        type: 'DTEL',
        name: 'ZARC1_LANG_UNIT',
        description: 'Sprachtest',
        package: '$TMP',
        typeKind: 'predefinedAbapType',
        dataType: 'CHAR',
        length: 10,
      });
      expect(result.isError).toBeFalsy();
      const body = dtelCreatePostBody();
      expect(body).toBeDefined();
      expect(body).toContain('adtcore:masterLanguage="DE"');
    });

    it('defaults the DTEL create POST body to EN when SAP_LANGUAGE is unset', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(201, '<blue:wbobj/>', { 'x-csrf-token': 't' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'DTEL',
        name: 'ZARC1_LANG_UNIT',
        description: 'Lang test',
        package: '$TMP',
        typeKind: 'predefinedAbapType',
        dataType: 'CHAR',
        length: 10,
      });
      expect(result.isError).toBeFalsy();
      expect(dtelCreatePostBody()).toContain('adtcore:masterLanguage="EN"');
    });
  });

  describe('create/update/batch — person responsible wiring (adtcore:responsible)', () => {
    function dtelCreatePostBody(): string | undefined {
      const call = mockFetch.mock.calls.find(
        (c: any[]) => String(c[0]).includes('/sap/bc/adt/ddic/dataelements') && c[1]?.method === 'POST',
      );
      return call?.[1]?.body as string | undefined;
    }

    function packageCreatePostBody(): string | undefined {
      const call = mockFetch.mock.calls.find(
        (c: any[]) => String(c[0]).includes('/sap/bc/adt/packages') && c[1]?.method === 'POST',
      );
      return call?.[1]?.body as string | undefined;
    }

    it('threads config.username into the create_package POST body', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, username: 'SRAHEMI' }, 'SAPManage', {
        action: 'create_package',
        name: 'ZARC1_RESP',
        description: 'Responsible wiring test',
      });
      expect(result.isError).toBeUndefined();
      expect(packageCreatePostBody()).toContain('adtcore:responsible="SRAHEMI"');
    });

    it('threads config.username into the DTEL create POST body', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(201, '<blue:wbobj/>', { 'x-csrf-token': 't' }));
      const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, username: 'SRAHEMI' }, 'SAPWrite', {
        action: 'create',
        type: 'DTEL',
        name: 'ZARC1_RESP_UNIT',
        description: 'Responsible test',
        package: '$TMP',
        typeKind: 'predefinedAbapType',
        dataType: 'CHAR',
        length: 10,
      });
      expect(result.isError).toBeFalsy();
      expect(dtelCreatePostBody()).toContain('adtcore:responsible="SRAHEMI"');
    });

    it('falls back to DEVELOPER in the create_package POST body when username is unset', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'create_package',
        name: 'ZARC1_RESP_DEF',
        description: 'Responsible default test',
      });
      expect(result.isError).toBeUndefined();
      expect(packageCreatePostBody()).toContain('adtcore:responsible="DEVELOPER"');
    });

    // The metadata-UPDATE call site is full-XML-replace via buildCreateXml, so it
    // threads config.username too (not just the create paths). ADT keeps the
    // create-time owner on update, but the body must still name a real user — the
    // legacy "DEVELOPER" would otherwise re-trip [?/049] on a no-DEVELOPER system.
    it('threads config.username into the DTEL update PUT body', async () => {
      const lockBody =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>';
      mockFetch.mockReset();
      let putBody: string | undefined;
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string }) => {
        const method = opts?.method ?? 'GET';
        if (method === 'POST' && String(url).includes('_action=LOCK')) {
          return Promise.resolve(mockResponse(200, lockBody, { 'x-csrf-token': 'T' }));
        }
        if (method === 'PUT') putBody = String(opts?.body ?? '');
        return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, username: 'SRAHEMI' }, 'SAPWrite', {
        action: 'update',
        type: 'DTEL',
        name: 'ZSTATUS',
        package: '$TMP',
        typeKind: 'domain',
        typeName: 'ZSTATUS',
      });

      expect(result.isError).toBeUndefined();
      expect(putBody).toContain('adtcore:responsible="SRAHEMI"');
    });

    it('threads config.username into the batch_create create POST body', async () => {
      mockFetch.mockReset();
      const posts: Array<{ url: string; body: string }> = [];
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string }) => {
        if (opts?.method === 'POST') posts.push({ url: String(url), body: String(opts?.body ?? '') });
        return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, username: 'SRAHEMI' }, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [{ type: 'DTEL', name: 'ZSTATUS', typeKind: 'predefinedAbapType', dataType: 'CHAR', length: 10 }],
      });

      expect(result.isError).toBeUndefined();
      const dtelPost = posts.find((p) => p.url.includes('/sap/bc/adt/ddic/dataelements'));
      expect(dtelPost?.body).toContain('adtcore:responsible="SRAHEMI"');
    });
  });

  describe('SAPWrite AFF validation', () => {
    it('create with valid metadata proceeds normally', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'create',
        type: 'CLAS',
        name: 'ZCL_TEST',
        package: '$TMP',
        description: 'Test class',
        source: 'CLASS zcl_test DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_test IMPLEMENTATION.\nENDCLASS.',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Created CLAS ZCL_TEST');
    });

    it('create with description > 60 chars fails AFF validation', async () => {
      const longDesc = 'A'.repeat(61);
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'CLAS',
        name: 'ZCL_TEST',
        package: '$TMP',
        description: longDesc,
      });
      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('AFF metadata validation failed');
      expect(text).toContain('CLAS ZCL_TEST');
    });

    it('create for type without AFF schema skips validation', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'create',
        type: 'INCL',
        name: 'Z_TEST_INCL',
        package: '$TMP',
        description: 'A'.repeat(100), // Long description, but no AFF schema for INCL
      });
      // Should not fail due to AFF validation (INCL has no schema)
      expect(result.isError).toBeUndefined();
    });

    it('batch_create stops on first AFF validation failure', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
      const longDesc = 'A'.repeat(61);
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [
          { type: 'PROG', name: 'ZPROG1', description: 'Valid desc', source: 'REPORT zprog1.' },
          { type: 'CLAS', name: 'ZCL_BAD', description: longDesc },
          { type: 'PROG', name: 'ZPROG2', source: 'REPORT zprog2.' },
        ],
      });
      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('ZPROG1');
      expect(text).toContain('ZCL_BAD');
      expect(text).toContain('AFF metadata validation failed');
      // Third object should appear as skipped
      expect(text).toContain('ZPROG2');
      expect(text).toContain('skipped');
    });

    it('AFF validation errors include field path and details', async () => {
      const longDesc = 'A'.repeat(71); // PROG maxLength is 70
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'PROG',
        name: 'ZPROG1',
        package: '$TMP',
        description: longDesc,
      });
      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '';
      // Should mention the field path and constraint
      expect(text).toContain('/header/description');
      expect(text).toContain('Fix the metadata and retry');
    });
  });

  // ── BDEF behavior extension create (tier-3 #10) ─────────────────────
  // An extension (`extend behavior for <Base>`) is the same BDEF/BDO endpoint as a definition, but
  // its create POST must carry an adtcore:adtTemplate(base_bdef) BEFORE packageRef, or SAP scaffolds
  // a plain definition (live-verified a4h 758 + 816 — full lifecycle in the integration suite).
  describe('SAPWrite BDEF behavior extension create (#10)', () => {
    function captureCreateFlow(readBackSource?: string) {
      const calls: { method: string; url: string; body?: string }[] = [];
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: unknown }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        calls.push({ method, url: urlStr, body: typeof opts?.body === 'string' ? opts.body : undefined });
        if (method === 'GET' && urlStr.includes('/bo/behaviordefinitions/') && urlStr.includes('/source/main')) {
          return Promise.resolve(mockResponse(200, readBackSource ?? '', { 'x-csrf-token': 'T' }));
        }
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(
            mockResponse(200, '<DATA><LOCK_HANDLE>LH</LOCK_HANDLE></DATA>', { 'x-csrf-token': 'T' }),
          );
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });
      return calls;
    }

    it('emits adtTemplate(base_bdef) before packageRef when the source is `extend behavior for X`', async () => {
      const calls = captureCreateFlow(
        'extension implementation in class zbp_base_x unique;\nextend behavior for ZR_BASE\n{\n}',
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'BDEF',
        name: 'ZR_BASE_X',
        package: '$TMP',
        source: 'extension implementation in class zbp_base_x unique;\nextend behavior for ZR_BASE\n{\n}',
      });
      expect(result.isError).toBeUndefined();
      const post = calls.find(
        (c) => c.method === 'POST' && c.url.includes('/bo/behaviordefinitions') && c.body?.includes('blueSource'),
      );
      expect(post?.body).toContain('<adtcore:adtProperty adtcore:key="base_bdef">ZR_BASE</adtcore:adtProperty>');
      // The template must precede packageRef — the blueSource elements are schema-ordered.
      expect(post!.body!.indexOf('adtTemplate')).toBeLessThan(post!.body!.indexOf('packageRef'));
    });

    it('emits adtTemplate(base_bdef) for BDEF extensions in batch_create', async () => {
      const calls = captureCreateFlow(
        'extension implementation in class zbp_base_x unique;\nextend behavior for ZR_BASE\n{\n}',
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [
          {
            type: 'BDEF',
            name: 'ZR_BASE_X',
            source: 'extension implementation in class zbp_base_x unique;\nextend behavior for ZR_BASE\n{\n}',
          },
        ],
      });
      expect(result.isError).toBeUndefined();
      const post = calls.find(
        (c) => c.method === 'POST' && c.url.includes('/bo/behaviordefinitions') && c.body?.includes('blueSource'),
      );
      expect(post?.body).toContain('<adtcore:adtProperty adtcore:key="base_bdef">ZR_BASE</adtcore:adtProperty>');
      expect(post!.body!.indexOf('adtTemplate')).toBeLessThan(post!.body!.indexOf('packageRef'));
    });

    it('supports namespaced base BDEF names in the extension template', async () => {
      const calls = captureCreateFlow(
        'extension implementation in class /dmo/bp_base_x unique;\nextend behavior for /DMO/I_BASE\n{\n}',
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'BDEF',
        name: '/DMO/I_BASE_X',
        package: '$TMP',
        source: 'extension implementation in class /dmo/bp_base_x unique;\nextend behavior for /DMO/I_BASE\n{\n}',
      });
      expect(result.isError).toBeUndefined();
      const post = calls.find(
        (c) => c.method === 'POST' && c.url.includes('/bo/behaviordefinitions') && c.body?.includes('blueSource'),
      );
      expect(post?.body).toContain('<adtcore:adtProperty adtcore:key="base_bdef">/DMO/I_BASE</adtcore:adtProperty>');
    });

    it('omits the template for a plain `define behavior for` definition', async () => {
      const calls = captureCreateFlow();
      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'BDEF',
        name: 'ZR_BASE',
        package: '$TMP',
        source: 'managed implementation in class zbp_base unique;\ndefine behavior for ZR_BASE\n{\n}',
      });
      const post = calls.find((c) => c.method === 'POST' && c.body?.includes('blueSource'));
      expect(post?.body).not.toContain('adtTemplate');
    });

    it('ignores `extend behavior for` inside comments when creating a plain definition', async () => {
      const calls = captureCreateFlow();
      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'BDEF',
        name: 'ZR_BASE',
        package: '$TMP',
        source:
          '" extend behavior for ZCOMMENT\n// extend behavior for ZCOMMENT2\nmanaged implementation in class zbp_base unique;\ndefine behavior for ZR_BASE\n{\n}',
      });
      const post = calls.find((c) => c.method === 'POST' && c.body?.includes('blueSource'));
      expect(post?.body).not.toContain('adtTemplate');
    });

    it('warns (non-blocking) when inactive read-back does not confirm the created BDEF is an extension', async () => {
      const calls = captureCreateFlow(
        'managed implementation in class zbp_base_x unique;\ndefine behavior for ZR_BASE_X\n{\n}',
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'BDEF',
        name: 'ZR_BASE_X',
        package: '$TMP',
        source: 'extension implementation in class zbp_base_x unique;\nextend behavior for ZR_BASE\n{\n}',
      });
      // Non-blocking: the object was created (success), but the warning is appended.
      expect(result.isError).toBeUndefined();
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('and wrote source code');
      expect(text).toContain('did not confirm');
      expect(text).toContain('extend behavior for ZR_BASE');
      expect(calls.some((c) => c.method === 'GET' && c.url.includes('version=inactive'))).toBe(true);
    });
  });
});
