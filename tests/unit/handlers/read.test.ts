/**
 * SAPRead handler unit tests — split from the former intent.test.ts monolith.
 * The undici mock + AdtClient + createClient live in ./setup-undici-mock.ts — import that helper
 * and keep all other src-module imports dynamic (see its header for the ordering rules).
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { logger } from '../../../src/server/logger.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { featuresOff } from './handler-test-config.js';
import { AdtClient, createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');

describe('SAPRead handler', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: return ABAP source with CSRF token for any request
    mockFetch.mockResolvedValue(
      mockResponse(200, "REPORT zhello.\nWRITE: / 'Hello'.", { 'x-csrf-token': 'mock-csrf-token' }),
    );
  });

  describe('SAPRead', () => {
    it('reads a program (PROG)', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZHELLO',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('REPORT zhello');
    });

    it('reads a class (CLAS)', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'CLAS',
        name: 'ZCL_TEST',
      });
      expect(result.isError).toBeUndefined();
    });

    it('reads a class with include parameter', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'CLAS',
        name: 'ZCL_TEST',
        include: 'testclasses',
      });
      expect(result.isError).toBeUndefined();
    });

    describe('grep', () => {
      const PROG_SRC =
        'REPORT zfoo.\nDATA lv TYPE i.\nlv = 1.\nlv = 2.\nlv = 3.\nSELECT * FROM mara INTO TABLE @lt.\nWRITE lv.';

      it('PROG grep returns only matching lines + context, not the whole source', async () => {
        mockFetch.mockReset();
        mockFetch.mockResolvedValue(mockResponse(200, PROG_SRC, { 'x-csrf-token': 't' }));
        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
          type: 'PROG',
          name: 'ZFOO',
          grep: 'SELECT',
        });
        expect(result.isError).toBeUndefined();
        expect(result.content[0]?.text).toContain('match(es) for /SELECT/i');
        expect(result.content[0]?.text).toContain('SELECT * FROM mara');
        // line 1 (REPORT) is outside the ±3 context window of the match on line 6
        expect(result.content[0]?.text).not.toContain('REPORT zfoo');
      });

      it('grep with no match returns a friendly message', async () => {
        mockFetch.mockReset();
        mockFetch.mockResolvedValue(mockResponse(200, PROG_SRC, { 'x-csrf-token': 't' }));
        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
          type: 'PROG',
          name: 'ZFOO',
          grep: 'ZZZ_NO_SUCH_TOKEN',
        });
        expect(result.isError).toBeUndefined();
        expect(result.content[0]?.text).toContain('No matches found');
      });

      it('grep with an unusable pattern (no literal match either) returns an error', async () => {
        mockFetch.mockReset();
        mockFetch.mockResolvedValue(mockResponse(200, PROG_SRC, { 'x-csrf-token': 't' }));
        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
          type: 'PROG',
          name: 'ZFOO',
          grep: 'nope(',
        });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toContain('Invalid regex pattern');
      });

      it('grep works on a non-CLAS source type (BDEF)', async () => {
        mockFetch.mockReset();
        mockFetch.mockResolvedValue(
          mockResponse(200, 'define behavior for ZI_Foo\n{\n  create;\n  update;\n  delete;\n}', {
            'x-csrf-token': 't',
          }),
        );
        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
          type: 'BDEF',
          name: 'ZI_FOO',
          grep: 'create',
        });
        expect(result.isError).toBeUndefined();
        expect(result.content[0]?.text).toContain('match(es)');
        expect(result.content[0]?.text).toContain('create');
      });

      it('CLAS grep annotates matches with the owning class/method', async () => {
        const clasSrc = [
          'CLASS zcl_test DEFINITION PUBLIC.',
          '  PUBLIC SECTION.',
          '    METHODS read.',
          'ENDCLASS.',
          'CLASS zcl_test IMPLEMENTATION.',
          '  METHOD read.',
          '    SELECT * FROM mara INTO TABLE @lt.',
          '  ENDMETHOD.',
          'ENDCLASS.',
        ].join('\n');
        mockFetch.mockReset();
        mockFetch.mockResolvedValue(mockResponse(200, clasSrc, { 'x-csrf-token': 't' }));
        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
          type: 'CLAS',
          name: 'ZCL_TEST',
          grep: 'SELECT',
        });
        expect(result.isError).toBeUndefined();
        expect(result.content[0]?.text).toContain('section=main');
        expect(result.content[0]?.text).toContain('SELECT * FROM mara');
        // method annotation: a [class=>method] label is present
        expect(result.content[0]?.text).toMatch(/=>\s*read/i);
      });

      it('CLAS grep + method returns a combine error', async () => {
        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
          type: 'CLAS',
          name: 'ZCL_TEST',
          grep: 'x',
          method: 'read',
        });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toContain('Do not combine grep with method');
      });

      it('CLAS grep + include searches the raw section', async () => {
        const testSrc = [
          'CLASS ltcl_test DEFINITION FOR TESTING.',
          '  PRIVATE SECTION.',
          '    METHODS first_test FOR TESTING.',
          'ENDCLASS.',
          'CLASS ltcl_test IMPLEMENTATION.',
          '  METHOD first_test.',
          '    cl_abap_unit_assert=>assert_true( abap_true ).',
          '  ENDMETHOD.',
          'ENDCLASS.',
        ].join('\n');
        mockFetch.mockReset();
        mockFetch.mockResolvedValue(mockResponse(200, testSrc, { 'x-csrf-token': 't' }));
        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
          type: 'CLAS',
          name: 'ZCL_TEST',
          grep: 'assert_true',
          include: 'testclasses',
        });
        expect(result.isError).toBeUndefined();
        expect(result.content[0]?.text).toContain('section=testclasses');
        expect(result.content[0]?.text).toContain('assert_true');
        // raw include endpoint was used (no '=== inc ===' wrapper path)
        const inclCall = mockFetch.mock.calls.find((c: any[]) => String(c[0]).includes('/includes/testclasses'));
        expect(inclCall).toBeDefined();
      });

      it('CLAS grep + include="main" reads /source/main, never /includes/main', async () => {
        const clasSrc = [
          'CLASS zcl_test IMPLEMENTATION.',
          '  METHOD m.',
          '    SELECT * FROM mara INTO TABLE @lt.',
          '  ENDMETHOD.',
          'ENDCLASS.',
        ].join('\n');
        mockFetch.mockReset();
        mockFetch.mockResolvedValue(mockResponse(200, clasSrc, { 'x-csrf-token': 't' }));
        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
          type: 'CLAS',
          name: 'ZCL_TEST',
          grep: 'SELECT',
          include: 'main',
        });
        expect(result.isError).toBeUndefined();
        expect(result.content[0]?.text).toContain('section=main');
        expect(result.content[0]?.text).toContain('SELECT * FROM mara');
        const urls = mockFetch.mock.calls.map((c: any[]) => String(c[0]));
        // 'main' must resolve to /source/main, not the non-existent /includes/main endpoint
        expect(urls.some((u) => u.includes('/includes/main'))).toBe(false);
        expect(urls.some((u) => u.includes('/source/main'))).toBe(true);
      });

      it('CLAS grep + a missing include returns a friendly message, not a raw 404', async () => {
        mockFetch.mockReset();
        mockFetch.mockResolvedValue(mockResponse(404, 'Not Found', { 'x-csrf-token': 't' }));
        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
          type: 'CLAS',
          name: 'ZCL_TEST',
          grep: 'x',
          include: 'testclasses',
        });
        expect(result.isError).toBeUndefined();
        expect(result.content[0]?.text).toContain('not available');
      });

      it('grep works on a DDIC source type (TABL)', async () => {
        mockFetch.mockReset();
        mockFetch.mockResolvedValue(
          mockResponse(200, 'define structure zfoo {\n  field1 : abap.int4;\n  matnr : matnr;\n}', {
            'x-csrf-token': 't',
          }),
        );
        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
          type: 'TABL',
          name: 'ZFOO',
          grep: 'matnr',
        });
        expect(result.isError).toBeUndefined();
        expect(result.content[0]?.text).toContain('match(es)');
        expect(result.content[0]?.text).toContain('matnr');
      });
    });

    it('reads active version with draft warning when inactive list contains the object', async () => {
      mockFetch.mockReset();
      mockFetch
        .mockResolvedValueOnce(
          mockResponse(
            200,
            `<?xml version="1.0"?><ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="http://www.sap.com/adt/core"><ioc:entry><ioc:object ioc:user="admin" ioc:deleted="false"><ioc:ref adtcore:uri="/sap/bc/adt/oo/classes/zcl_test" adtcore:type="CLAS/OC" adtcore:name="ZCL_TEST"/></ioc:object><ioc:transport ioc:linked="true"><ioc:ref adtcore:name="A4HK900001"/></ioc:transport></ioc:entry></ioc:inactiveObjects>`,
          ),
        )
        .mockResolvedValueOnce(mockResponse(200, 'CLASS zcl_test DEFINITION. ENDCLASS.', { etag: 'e1' }));
      const layer = new CachingLayer(new MemoryCache());

      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPRead',
        { type: 'CLAS', name: 'ZCL_TEST' },
        undefined,
        undefined,
        layer,
      );

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('unactivated draft');
      expect(result.content[0]?.text).toContain('LAST ACTIVATED');
      expect(result.content[0]?.text).toContain('CLASS zcl_test');
    });

    it('suppresses the draft note for a just-activated object (single-identity client)', async () => {
      mockFetch.mockReset();
      mockFetch
        .mockResolvedValueOnce(
          mockResponse(
            200,
            `<?xml version="1.0"?><ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="http://www.sap.com/adt/core"><ioc:entry><ioc:object ioc:user="admin" ioc:deleted="false"><ioc:ref adtcore:uri="/sap/bc/adt/oo/classes/zcl_test" adtcore:type="CLAS/OC" adtcore:name="ZCL_TEST"/></ioc:object></ioc:entry></ioc:inactiveObjects>`,
          ),
        )
        .mockResolvedValueOnce(mockResponse(200, 'CLASS zcl_test DEFINITION. ENDCLASS.', { etag: 'e1' }));
      const layer = new CachingLayer(new MemoryCache());
      // Simulate a successful activation moments ago; the inactive worklist is still lagging.
      layer.markActivated('CLAS', 'ZCL_TEST');

      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPRead',
        { type: 'CLAS', name: 'ZCL_TEST' },
        undefined,
        undefined,
        layer,
        false, // isPerUserClient — single-identity client
      );

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).not.toContain('unactivated draft');
      expect(result.content[0]?.text).toContain('CLASS zcl_test');
    });

    it('does NOT suppress another user draft note under principal propagation', async () => {
      mockFetch.mockReset();
      mockFetch
        .mockResolvedValueOnce(
          mockResponse(
            200,
            `<?xml version="1.0"?><ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="http://www.sap.com/adt/core"><ioc:entry><ioc:object ioc:user="admin" ioc:deleted="false"><ioc:ref adtcore:uri="/sap/bc/adt/oo/classes/zcl_test" adtcore:type="CLAS/OC" adtcore:name="ZCL_TEST"/></ioc:object></ioc:entry></ioc:inactiveObjects>`,
          ),
        )
        .mockResolvedValueOnce(mockResponse(200, 'CLASS zcl_test DEFINITION. ENDCLASS.', { etag: 'e1' }));
      const layer = new CachingLayer(new MemoryCache());
      // Another identity activated ZCL_TEST; the object-keyed flag must NOT hide THIS user's draft.
      layer.markActivated('CLAS', 'ZCL_TEST');

      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPRead',
        { type: 'CLAS', name: 'ZCL_TEST' },
        undefined,
        undefined,
        layer,
        true, // isPerUserClient — per-user (principal propagation) client
      );

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('unactivated draft');
    });

    it('continues active source reads when inactive object listing is unavailable', async () => {
      mockFetch.mockReset();
      mockFetch
        .mockResolvedValueOnce(mockResponse(404, 'Not Found'))
        .mockResolvedValueOnce(mockResponse(200, 'CLASS zcl_test DEFINITION. ENDCLASS.', { etag: 'e1' }));
      const layer = new CachingLayer(new MemoryCache());

      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPRead',
        { type: 'CLAS', name: 'ZCL_TEST' },
        undefined,
        undefined,
        layer,
      );

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toBe('CLASS zcl_test DEFINITION. ENDCLASS.');
      const sourceCall = mockFetch.mock.calls.find((call: any[]) => String(call[0]).includes('/source/main'));
      expect(String(sourceCall?.[0])).toContain('/sap/bc/adt/oo/classes/ZCL_TEST/source/main');
    });

    it("resolves version='auto' to inactive when draft exists", async () => {
      mockFetch.mockReset();
      mockFetch
        .mockResolvedValueOnce(
          mockResponse(
            200,
            `<?xml version="1.0"?><ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="http://www.sap.com/adt/core"><ioc:entry><ioc:object ioc:user="admin" ioc:deleted="false"><ioc:ref adtcore:uri="/sap/bc/adt/oo/classes/zcl_test" adtcore:type="CLAS/OC" adtcore:name="ZCL_TEST"/></ioc:object></ioc:entry></ioc:inactiveObjects>`,
          ),
        )
        .mockResolvedValueOnce(mockResponse(200, 'inactive source', { etag: 'e1' }));
      const layer = new CachingLayer(new MemoryCache());

      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPRead',
        { type: 'CLAS', name: 'ZCL_TEST', version: 'auto' },
        undefined,
        undefined,
        layer,
      );

      const sourceCall = mockFetch.mock.calls.find((call: any[]) => String(call[0]).includes('/source/main'));
      expect(String(sourceCall?.[0])).toContain('version=inactive');
      expect(result.content[0]?.text).toBe('inactive source');
    });

    it("version='inactive' without draft prepends active fallback note", async () => {
      mockFetch.mockReset();
      mockFetch
        .mockResolvedValueOnce(
          mockResponse(
            200,
            `<?xml version="1.0"?><ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects"/>`,
          ),
        )
        .mockResolvedValueOnce(mockResponse(200, 'active source', { etag: 'e1' }));
      const layer = new CachingLayer(new MemoryCache());

      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPRead',
        { type: 'CLAS', name: 'ZCL_TEST', version: 'inactive' },
        undefined,
        undefined,
        layer,
      );

      expect(result.content[0]?.text).toContain('No inactive draft exists');
      expect(result.content[0]?.text).toContain('active source');
    });

    it('reads an interface (INTF)', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'INTF',
        name: 'ZIF_TEST',
      });
      expect(result.isError).toBeUndefined();
    });

    it('reads a function module (FUNC) with group', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'FUNC',
        name: 'Z_MY_FUNC',
        group: 'ZGROUP',
      });
      expect(result.isError).toBeUndefined();
    });

    it('reads a function group (FUGR)', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'FUGR',
        name: 'ZGROUP',
      });
      expect(result.isError).toBeUndefined();
    });

    it('reads an include (INCL)', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'INCL',
        name: 'ZINCLUDE',
      });
      expect(result.isError).toBeUndefined();
    });

    it('reads CDS view (DDLS)', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'DDLS',
        name: 'Z_CDS_VIEW',
      });
      expect(result.isError).toBeUndefined();
    });

    it('reads CDS access control (DCLS)', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'DCLS',
        name: 'ZTEST_DCL',
      });
      expect(result.isError).toBeUndefined();
      const calledUrl = String(mockFetch.mock.calls[0]?.[0] ?? '');
      expect(calledUrl).toContain('/sap/bc/adt/acm/dcl/sources/ZTEST_DCL/source/main');
    });

    it('reads behavior definition (BDEF)', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'BDEF',
        name: 'Z_BDEF',
      });
      expect(result.isError).toBeUndefined();
    });

    it('reads service definition (SRVD)', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'SRVD',
        name: 'Z_SRVD',
      });
      expect(result.isError).toBeUndefined();
    });

    it('reads metadata extension (DDLX)', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'DDLX',
        name: 'ZC_TRAVEL',
      });
      expect(result.isError).toBeUndefined();
    });

    it('returns soft informational message when DDLX is not found (404)', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(404, 'Not Found', { 'x-csrf-token': 'mock-csrf-token' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'DDLX',
        name: 'ZC_TRAVEL',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('No metadata extension (DDLX) found for "ZC_TRAVEL"');
      expect(result.content[0]?.text).toContain('inline annotations');
      expect(result.content[0]?.text).toContain('manifest.json');
    });

    it('reads Knowledge Transfer Document (SKTD), decodes base64 text from the <sktd:docu> envelope, and lowercases the name in the URL', async () => {
      mockFetch.mockReset();
      const calls: string[] = [];
      const markdown = '# Title\n\nMarkdown doc content.';
      const base64 = Buffer.from(markdown, 'utf-8').toString('base64');
      const envelope = `<?xml version="1.0" encoding="UTF-8"?><sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZTR_C_PAYMENT_VALUE_DATE" adtcore:type="SKTD/TYP"><sktd:element><sktd:text>${base64}</sktd:text></sktd:element></sktd:docu>`;
      mockFetch.mockImplementation((url: string | URL) => {
        calls.push(String(url));
        return Promise.resolve(mockResponse(200, envelope, { 'x-csrf-token': 'T' }));
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'SKTD',
        name: 'ZTR_C_PAYMENT_VALUE_DATE',
      });
      expect(result.isError).toBeUndefined();
      // The decoded Markdown should be returned — not the raw XML envelope, not base64.
      expect(result.content[0]?.text).toBe(markdown);
      expect(result.content[0]?.text).not.toContain('<sktd:docu');
      expect(result.content[0]?.text).not.toContain(base64);
      const getUrl = calls.find((u) => u.includes('/documentation/ktd/'));
      expect(getUrl).toContain('/sap/bc/adt/documentation/ktd/documents/ztr_c_payment_value_date');
      expect(getUrl).not.toContain('version=workingArea');
    });

    it('accepts KTD as a friendly alias for SKTD reads', async () => {
      mockFetch.mockReset();
      const calls: string[] = [];
      const markdown = '# Friendly alias';
      const base64 = Buffer.from(markdown, 'utf-8').toString('base64');
      const envelope = `<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd"><sktd:element><sktd:text>${base64}</sktd:text></sktd:element></sktd:docu>`;
      mockFetch.mockImplementation((url: string | URL) => {
        calls.push(String(url));
        return Promise.resolve(mockResponse(200, envelope, { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'KTD',
        name: 'ZCL_ALIAS_DOC',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toBe(markdown);
      expect(calls.some((u) => u.includes('/sap/bc/adt/documentation/ktd/documents/zcl_alias_doc'))).toBe(true);
    });

    it('greps decoded KTD Markdown instead of the XML envelope', async () => {
      mockFetch.mockReset();
      const markdown = '# KTD\n\nPayment term behavior.\n\nImplementation notes.';
      const base64 = Buffer.from(markdown, 'utf-8').toString('base64');
      const envelope = `<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd"><sktd:element><sktd:text>${base64}</sktd:text></sktd:element></sktd:docu>`;
      mockFetch.mockResolvedValueOnce(mockResponse(200, envelope, { 'x-csrf-token': 'T' }));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'KTD',
        name: 'ZCL_ALIAS_DOC',
        grep: 'payment',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Payment term behavior.');
      expect(result.content[0]?.text).not.toContain('<sktd:docu');
      expect(result.content[0]?.text).not.toContain(base64);
    });

    it('returns soft informational message when SKTD is not found (404)', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(404, 'Not Found', { 'x-csrf-token': 'mock-csrf-token' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'SKTD',
        name: 'ZDOES_NOT_EXIST',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('No Knowledge Transfer Document (SKTD) found for "ZDOES_NOT_EXIST"');
    });

    it('reads service binding (SRVB) and returns parsed JSON', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<?xml version="1.0"?><srvb:serviceBinding srvb:contract="C1" srvb:published="true" srvb:bindingCreated="true"
          adtcore:name="ZUI_TRAVEL_O4" adtcore:type="SRVB/SVB" adtcore:description="Travel UI"
          adtcore:language="EN" xmlns:srvb="http://www.sap.com/adt/ddic/ServiceBindings"
          xmlns:adtcore="http://www.sap.com/adt/core">
          <adtcore:packageRef adtcore:name="ZTRAVEL"/>
          <srvb:services srvb:name="ZUI_TRAVEL">
            <srvb:content srvb:version="0001" srvb:releaseState="NOT_RELEASED">
              <srvb:serviceDefinition adtcore:name="ZSD_TRAVEL"/>
            </srvb:content>
          </srvb:services>
          <srvb:binding srvb:type="ODATA" srvb:version="V4" srvb:category="0">
            <srvb:implementation adtcore:name="ZUI_TRAVEL_O4"/>
          </srvb:binding>
        </srvb:serviceBinding>`,
        ),
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'SRVB',
        name: 'ZUI_TRAVEL_O4',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.name).toBe('ZUI_TRAVEL_O4');
      expect(parsed.odataVersion).toBe('V4');
    });

    it('reads table definition (TABL)', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'TABL',
        name: 'ZTABLE',
      });
      expect(result.isError).toBeUndefined();
    });

    it('reads view definition (VIEW)', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'VIEW',
        name: 'ZVIEW',
      });
      expect(result.isError).toBeUndefined();
    });

    it('reads system info (SYSTEM)', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'SYSTEM',
      });
      expect(result.isError).toBeUndefined();
    });

    it('reads package contents (DEVC) via the search endpoint', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/programs/programs/zhello" adtcore:type="PROG/P" adtcore:name="ZHELLO" adtcore:packageName="ZPKG" adtcore:description="Hello"/>
</adtcore:objectReferences>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'DEVC',
        name: 'ZPKG',
      });
      expect(result.isError).toBeUndefined();
      const url = String(mockFetch.mock.calls[0]?.[0] ?? '');
      expect(url).toContain('/sap/bc/adt/repository/informationsystem/search');
      expect(url).toContain('packageName=ZPKG');
      expect(url).not.toContain('/nodestructure');
    });

    it('forwards maxResults from SAPRead args to getPackageContents URL', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"/>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'DEVC',
        name: 'ZPKG',
        maxResults: 750,
      });
      expect(result.isError).toBeUndefined();
      const url = String(mockFetch.mock.calls[0]?.[0] ?? '');
      expect(url).toContain('maxResults=750');
    });

    it('accepts a float maxResults end-to-end and clamps it at the sink (advertised contract)', async () => {
      // An LLM following the published schema (`type: number`, "clamped to [1, 1000]") may send
      // 50.5 — which previously returned a Zod "expected int" error. It must now succeed and floor
      // to 50. See docs/research/2026-06-12-maxresults-contract-asymmetry.md.
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"/>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'DEVC',
        name: 'ZPKG',
        maxResults: 50.5,
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text ?? '').not.toContain('Invalid arguments');
      const url = String(mockFetch.mock.calls[0]?.[0] ?? '');
      expect(url).toContain('maxResults=50');
      // 'maxResults=50' is a substring of the un-floored 'maxResults=50.5' — pin the floor too.
      expect(url).not.toContain('maxResults=50.5');
    });

    it('accepts an out-of-range maxResults end-to-end and clamps to 1000 (the promised clamping)', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"/>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'DEVC',
        name: 'ZPKG',
        maxResults: 1001,
      });
      expect(result.isError).toBeUndefined();
      expect(String(mockFetch.mock.calls[0]?.[0] ?? '')).toContain('maxResults=1000');
    });

    it('reads installed components (COMPONENTS)', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'COMPONENTS',
      });
      expect(result.isError).toBeUndefined();
    });

    it('reads message classes (MSAG)', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'MSAG',
        name: 'ZMSGCLASS',
      });
      expect(result.isError).toBeUndefined();
    });

    it('reads messages (MESSAGES deprecated alias) — same handler + deprecation warning', async () => {
      // MSAG is the canonical TADIR R3TR type; 'MESSAGES' was the original ARC-1 name.
      // Per docs/research/abap-types/types/msag.md it is now a deprecated alias kept for
      // one minor release.
      const warnSpy = vi.spyOn(logger, 'warn');
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'MESSAGES',
        name: 'ZMSGCLASS',
      });
      expect(result.isError).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('MESSAGES'),
        expect.objectContaining({ replacement: 'MSAG' }),
      );
      warnSpy.mockRestore();
    });

    it('reads text elements (TEXT_ELEMENTS)', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'TEXT_ELEMENTS',
        name: 'ZPROG',
      });
      expect(result.isError).toBeUndefined();
    });

    it('reads class text symbols (CLAS include=text_symbols) via the textelements service', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, '@MaxLength:10\r\n001=Hello', { 'x-csrf-token': 't' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'CLAS',
        name: 'ZCL_FOO',
        include: 'text_symbols',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text ?? '').toContain('001=Hello');
      expect(
        mockFetch.mock.calls.some(([u]) => String(u).includes('/textelements/classes/ZCL_FOO/source/symbols')),
      ).toBe(true);
    });

    it('rejects an unknown CLAS include (selection_texts — classes have no selection screen)', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'CLAS',
        name: 'ZCL_FOO',
        include: 'selection_texts',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text ?? '').toContain('Invalid include value');
    });

    it('regression: CLAS read with no include still returns full class source', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(200, 'CLASS zcl_foo DEFINITION PUBLIC.\nENDCLASS.', { 'x-csrf-token': 't' }),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'CLAS', name: 'ZCL_FOO' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text ?? '').toContain('CLASS zcl_foo');
      expect(mockFetch.mock.calls.some(([u]) => String(u).includes('/textelements/'))).toBe(false);
    });

    it('reads variants (VARIANTS)', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'VARIANTS',
        name: 'ZPROG',
      });
      expect(result.isError).toBeUndefined();
    });

    it('lists BSP apps when no name provided', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><title>/UI5/APP1</title><summary>Booking App</summary></entry>
  <entry><title>/UI5/APP2</title><summary>Travel App</summary></entry>
</feed>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'BSP',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].name).toBe('/UI5/APP1');
    });

    it('browses BSP app root structure when name provided without include', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>ZAPP_BOOKING/webapp</title>
    <category term="folder"/>
    <content/>
  </entry>
  <entry>
    <title>ZAPP_BOOKING/manifest.json</title>
    <category term="file"/>
    <content afr:etag="abc123" xmlns:afr="http://www.sap.com/adt/filestore"/>
  </entry>
</feed>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'BSP',
        name: 'ZAPP_BOOKING',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].type).toBe('folder');
      expect(parsed[1].type).toBe('file');
    });

    it('browses BSP subfolder when include has no dot', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>ZAPP_BOOKING/webapp/i18n/i18n.properties</title>
    <category term="file"/>
    <content afr:etag="def456" xmlns:afr="http://www.sap.com/adt/filestore"/>
  </entry>
</feed>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'BSP',
        name: 'ZAPP_BOOKING',
        include: 'webapp/i18n',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed).toHaveLength(1);
    });

    it('reads BSP file content when include contains a dot', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '{"sap.app": {"id": "zapp.booking"}}'));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'BSP',
        name: 'ZAPP_BOOKING',
        include: 'manifest.json',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toContain('sap.app');
    });

    it('reads BSP file content for nested path with dot', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'sap.ui.define([], function() { return {}; });'));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'BSP',
        name: 'ZAPP_BOOKING',
        include: 'webapp/Component.js',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toContain('sap.ui.define');
    });

    it('returns error when ui5 feature is unavailable', async () => {
      setCachedFeatures(featuresOff());
      try {
        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
          type: 'BSP',
        });
        expect(result.isError).toBe(true);
        // Pin the ui5 gate's own message — 'not available' alone also matches the ui5repo gate.
        expect(result.content[0]!.text).toContain('UI5/Fiori BSP Filestore is not available');
      } finally {
        resetCachedFeatures();
      }
    });

    it('reads BSP_DEPLOY metadata for a deployed app', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          JSON.stringify({
            d: { Name: 'ZAPP_BOOKING', Package: '$TMP', Description: 'Booking App', Info: 'deployed' },
          }),
          { 'x-csrf-token': 'odata-token' },
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'BSP_DEPLOY',
        name: 'ZAPP_BOOKING',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.name).toBe('ZAPP_BOOKING');
      expect(parsed.package).toBe('$TMP');
      expect(parsed.description).toBe('Booking App');
    });

    it('returns "not found" for BSP_DEPLOY when app does not exist', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(404, 'Not Found'));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'BSP_DEPLOY',
        name: 'ZNONEXISTENT',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toContain('not found');
    });

    it('returns error for BSP_DEPLOY when name is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'BSP_DEPLOY',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('requires a name');
    });

    it('returns error for BSP_DEPLOY when ui5repo feature is unavailable', async () => {
      setCachedFeatures(featuresOff());
      try {
        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
          type: 'BSP_DEPLOY',
          name: 'ZAPP_BOOKING',
        });
        expect(result.isError).toBe(true);
        // Pin the ui5repo gate's own message — 'not available' alone also matches the ui5 gate.
        expect(result.content[0]!.text).toContain('ABAP Repository OData Service is not available');
      } finally {
        resetCachedFeatures();
      }
    });

    it('reads a DDIC structure via TABL with /tables/→/structures/ fallback', async () => {
      // Model B: structures and transparent tables both use type='TABL'.
      // Internal getTabl() tries /tables/ first, falls back to /structures/ on 404.
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(404, '<?xml version="1.0"?><error/>'));
      mockFetch.mockResolvedValueOnce(
        mockResponse(200, '@EndUserText.label : "Return Parameter"\ndefine type bapiret2 { ... }'),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'TABL',
        name: 'BAPIRET2',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('bapiret2');
      // Verify both URLs were attempted in order.
      expect(mockFetch.mock.calls[0]?.[0]).toContain('/sap/bc/adt/ddic/tables/BAPIRET2/source/main');
      expect(mockFetch.mock.calls[1]?.[0]).toContain('/sap/bc/adt/ddic/structures/BAPIRET2/source/main');
    });

    it('reads a transparent table via TABL without fallback', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(200, '@AbapCatalog.tableCategory : #TRANSPARENT\ndefine table t000 { ... }'),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'TABL',
        name: 'T000',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('TRANSPARENT');
      // Only /tables/ was hit — no fallback needed.
      expect(mockFetch.mock.calls).toHaveLength(1);
      expect(mockFetch.mock.calls[0]?.[0]).toContain('/sap/bc/adt/ddic/tables/T000/source/main');
    });

    it('rejects type=STRU at the schema layer with a hint to use TABL', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'STRU',
        name: 'BAPIRET2',
      });
      expect(result.isError).toBe(true);
      // Zod validation lists valid enum members, which now includes TABL but excludes STRU.
      expect(result.content[0]?.text).toContain('Invalid arguments for SAPRead');
      expect(result.content[0]?.text).toContain('TABL');
      expect(result.content[0]?.text).not.toMatch(/'STRU'/);
    });

    it('returns error when TABL name resolves to neither tables nor structures', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(404, '<?xml version="1.0"?><error/>'));
      mockFetch.mockResolvedValueOnce(mockResponse(404, '<?xml version="1.0"?><error/>'));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'TABL',
        name: 'NONEXISTENT',
      });
      expect(result.isError).toBe(true);
      expect(mockFetch.mock.calls).toHaveLength(2);
    });

    it('reads a domain (DOMA)', async () => {
      // Mock domain XML response
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<doma:domain adtcore:name="BUKRS" adtcore:description="Company code" xmlns:doma="http://www.sap.com/dictionary/domain" xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:packageRef adtcore:name="BF"/>
  <doma:content>
    <doma:typeInformation><doma:datatype>CHAR</doma:datatype><doma:length>000004</doma:length><doma:decimals>000000</doma:decimals></doma:typeInformation>
    <doma:outputInformation><doma:length>000004</doma:length><doma:conversionExit/><doma:signExists>false</doma:signExists><doma:lowercase>false</doma:lowercase></doma:outputInformation>
    <doma:valueInformation><doma:valueTableRef adtcore:name="T001"/><doma:fixValues/></doma:valueInformation>
  </doma:content>
</doma:domain>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'DOMA',
        name: 'BUKRS',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.name).toBe('BUKRS');
      expect(parsed.dataType).toBe('CHAR');
      expect(parsed.valueTable).toBe('T001');
    });

    it('reads a data element (DTEL)', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<blue:wbobj adtcore:name="BUKRS" adtcore:description="Company code" xmlns:blue="http://www.sap.com/wbobj/dictionary/dtel" xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:packageRef adtcore:name="BF"/>
  <dtel:dataElement xmlns:dtel="http://www.sap.com/adt/dictionary/dataelements">
    <dtel:typeKind>domain</dtel:typeKind><dtel:typeName>BUKRS</dtel:typeName>
    <dtel:dataType>CHAR</dtel:dataType><dtel:dataTypeLength>000004</dtel:dataTypeLength>
    <dtel:mediumFieldLabel>Company Code</dtel:mediumFieldLabel>
    <dtel:searchHelp>C_T001</dtel:searchHelp>
  </dtel:dataElement>
</blue:wbobj>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'DTEL',
        name: 'BUKRS',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.name).toBe('BUKRS');
      expect(parsed.typeName).toBe('BUKRS');
      expect(parsed.searchHelp).toBe('C_T001');
    });

    it('reads an authorization field (AUTH)', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<auth:auth xmlns:auth="http://www.sap.com/iam/auth" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="BUKRS" adtcore:description="Company code" adtcore:masterLanguage="EN">
  <adtcore:packageRef adtcore:name="SF"/>
  <auth:content>
    <auth:fieldName>BUKRS</auth:fieldName>
    <auth:rollName>BUKRS</auth:rollName>
    <auth:checkTable>T001</auth:checkTable>
    <auth:domname>BUKRS</auth:domname>
    <auth:outputlen>4</auth:outputlen>
    <auth:orglvlinfo>true</auth:orglvlinfo>
  </auth:content>
</auth:auth>`,
        ),
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'AUTH',
        name: 'BUKRS',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.name).toBe('BUKRS');
      expect(parsed.checkTable).toBe('T001');
      expect(parsed.orgLevelInfo).toEqual(['true']);
    });

    it('reads feature toggle states (FEATURE_TOGGLE)', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          JSON.stringify({
            STATES: {
              NAME: 'ABC_TOGGLE',
              CLIENT_STATE: 'on',
              USER_STATE: 'undefined',
              CLIENT_STATES: [{ CLIENT: '001', DESCRIPTION: 'Dev', STATE: 'on' }],
              USER_STATES: [],
            },
          }),
        ),
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'FEATURE_TOGGLE',
        name: 'ABC_TOGGLE',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.name).toBe('ABC_TOGGLE');
      expect(parsed.clientState).toBe('on');
      expect(parsed.states).toEqual([{ client: '001', state: 'on', description: 'Dev' }]);
    });

    it('reads feature toggle states (FTG2 deprecated alias) — same result + deprecation warning', async () => {
      // FTG2 is an ARC-1-private invented identifier (docs/research/abap-types/types/ftg2.md).
      // Renamed to FEATURE_TOGGLE in the audit-symmetry plan; FTG2 stays as a deprecated
      // alias for one minor release with a stderr warning.
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          JSON.stringify({
            STATES: {
              NAME: 'ABC_TOGGLE',
              CLIENT_STATE: 'on',
              USER_STATE: 'undefined',
              CLIENT_STATES: [{ CLIENT: '001', DESCRIPTION: 'Dev', STATE: 'on' }],
              USER_STATES: [],
            },
          }),
        ),
      );
      const warnSpy = vi.spyOn(logger, 'warn');

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'FTG2',
        name: 'ABC_TOGGLE',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.name).toBe('ABC_TOGGLE');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('FTG2'),
        expect.objectContaining({ replacement: 'FEATURE_TOGGLE' }),
      );
      warnSpy.mockRestore();
    });

    it('reads enhancement implementation metadata (ENHO)', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<enho:objectData xmlns:enho="http://www.sap.com/adt/enhancements/enho" xmlns:enhcore="http://www.sap.com/abapsource/enhancementscore" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZMY_BADI_IMPL" adtcore:description="Test impl">
  <adtcore:packageRef adtcore:name="ZPKG"/>
  <enho:contentCommon enho:toolType="BADI_IMPL" enho:switchSupported="false"/>
  <enho:contentSpecific>
    <enho:badiTechnology>
      <enho:badiImplementations>
        <enho:badiImplementation enho:name="ZMY_BADI_IMPL_A" enho:shortText="First" enho:active="true" enho:default="false">
          <enho:enhancementSpot adtcore:name="ENH_SPOT_EXAMPLE"/>
          <enho:badiDefinition adtcore:name="BADI_DEF_A"/>
          <enho:implementingClass adtcore:name="ZCL_BADI_IMPL_A"/>
        </enho:badiImplementation>
      </enho:badiImplementations>
    </enho:badiTechnology>
  </enho:contentSpecific>
</enho:objectData>`,
        ),
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'ENHO',
        name: 'ZMY_BADI_IMPL',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.name).toBe('ZMY_BADI_IMPL');
      expect(parsed.technology).toBe('BADI_IMPL');
      expect(parsed.badiImplementations).toHaveLength(1);
      expect(parsed.badiImplementations[0].implementingClass).toBe('ZCL_BADI_IMPL_A');
      expect(parsed.badiImplementations[0].badiDefinition).toBe('BADI_DEF_A');
      expect(parsed.badiImplementations[0].enhancementSpot).toBe('ENH_SPOT_EXAMPLE');
    });

    it('reads VERSIONS for a program and returns revision JSON', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
  <atom:title>Version List of ZARC1_TEST_REPORT (REPS)</atom:title>
  <atom:entry>
    <atom:author><atom:name>DEVELOPER</atom:name></atom:author>
    <atom:content src="/sap/bc/adt/programs/programs/ZARC1_TEST_REPORT/source/main/versions/1/00000/content"/>
    <atom:id>00000</atom:id>
    <atom:updated>2026-04-10T18:58:51Z</atom:updated>
  </atom:entry>
</atom:feed>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'VERSIONS',
        name: 'ZARC1_TEST_REPORT',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.object.name).toBe('ZARC1_TEST_REPORT');
      expect(parsed.revisions).toHaveLength(1);
      const calledUrl = String(mockFetch.mock.calls[0]?.[0] ?? '');
      expect(calledUrl).toContain('/programs/programs/ZARC1_TEST_REPORT/source/main/versions');
    });

    it('passes CLAS include through for VERSIONS', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?><atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:title>Version List of ZCL_ARC1_TEST (CINC)</atom:title></atom:feed>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'VERSIONS',
        name: 'ZCL_ARC1_TEST',
        include: 'definitions',
      });
      expect(result.isError).toBeUndefined();
      const calledUrl = String(mockFetch.mock.calls[0]?.[0] ?? '');
      expect(calledUrl).toContain('/oo/classes/ZCL_ARC1_TEST/includes/definitions/versions');
    });

    it('auto-resolves FUNC group for VERSIONS when group is omitted', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<objectReferences><objectReference type="FUGR/FF" name="Z_MY_FUNC" uri="/sap/bc/adt/functions/groups/zgroup/fmodules/z_my_func" packageName="ZTEST" description="Test FM"/></objectReferences>`,
        ),
      );
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?><atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:title>Version List of Z_MY_FUNC (FUNC)</atom:title></atom:feed>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'VERSIONS',
        objectType: 'FUNC',
        name: 'Z_MY_FUNC',
      });
      expect(result.isError).toBeUndefined();
      const urls = mockFetch.mock.calls.map((call: any[]) => String(call[0]));
      expect(urls.some((u) => u.includes('operation=quickSearch&query=Z_MY_FUNC'))).toBe(true);
      expect(urls.some((u) => u.includes('/functions/groups/ZGROUP/fmodules/Z_MY_FUNC/source/main/versions'))).toBe(
        true,
      );
    });

    it('returns an error result when VERSION_SOURCE is called without versionUri', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'VERSION_SOURCE',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('VERSION_SOURCE requires versionUri');
    });

    it('returns raw revision source for VERSION_SOURCE', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, "REPORT zarc1_test_report.\nWRITE: / 'revision'."));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'VERSION_SOURCE',
        versionUri: '/sap/bc/adt/programs/programs/ZARC1_TEST_REPORT/source/main/versions/1/00000/content',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('REPORT zarc1_test_report');
    });

    it('reads a transaction (TRAN)', async () => {
      mockFetch.mockReset();
      // First call: transaction metadata
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<adtcore:mainObject adtcore:name="SE38" adtcore:description="ABAP Editor" xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:packageRef adtcore:name="SEDT"/>
</adtcore:mainObject>`,
        ),
      );
      // Second call: SQL query for program name (CSRF fetch first, then actual query)
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'token123' }));
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values>
<COLUMNS><COLUMN><METADATA name="TCODE"/><DATASET><DATA>SE38</DATA></DATASET></COLUMN>
<COLUMN><METADATA name="PGMNA"/><DATASET><DATA>RSABAPPROGRAM</DATA></DATASET></COLUMN></COLUMNS>
</asx:values></asx:abap>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'TRAN',
        name: 'SE38',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.code).toBe('SE38');
      expect(parsed.description).toBe('ABAP Editor');
      expect(parsed.package).toBe('SEDT');
    });

    it('reads API release state (API_STATE) with explicit objectType', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<apirelease:apiReleaseInfos xmlns:apirelease="http://www.sap.com/adt/apirelease" xmlns:adtcore="http://www.sap.com/adt/core">
  <apirelease:releasableObject adtcore:uri="/sap/bc/adt/oo/classes/cl_salv_table" adtcore:type="CLAS/OC" adtcore:name="CL_SALV_TABLE"/>
  <apirelease:c1Release apirelease:contract="C1" apirelease:useInKeyUserApps="true" apirelease:useInSAPCloudPlatform="true">
    <apirelease:status apirelease:state="RELEASED" apirelease:stateDescription="Released"/>
  </apirelease:c1Release>
  <apirelease:apiCatalogData apirelease:isAnyAssignmentPossible="true" apirelease:isAnyContractReleased="true"/>
</apirelease:apiReleaseInfos>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'API_STATE',
        name: 'CL_SALV_TABLE',
        objectType: 'CLAS',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.objectName).toBe('CL_SALV_TABLE');
      expect(parsed.contracts).toHaveLength(1);
      expect(parsed.contracts[0].state).toBe('RELEASED');
      expect(parsed.isAnyContractReleased).toBe(true);
    });

    it('reads API release state (API_STATE) with inferred CLAS type', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<apirelease:apiReleaseInfos xmlns:apirelease="http://www.sap.com/adt/apirelease" xmlns:adtcore="http://www.sap.com/adt/core">
  <apirelease:releasableObject adtcore:uri="/sap/bc/adt/oo/classes/cl_salv_table" adtcore:type="CLAS/OC" adtcore:name="CL_SALV_TABLE"/>
  <apirelease:c1Release apirelease:contract="C1" apirelease:useInKeyUserApps="false" apirelease:useInSAPCloudPlatform="false">
    <apirelease:status apirelease:state="NOT_RELEASED" apirelease:stateDescription="Not Released"/>
  </apirelease:c1Release>
  <apirelease:apiCatalogData apirelease:isAnyAssignmentPossible="false" apirelease:isAnyContractReleased="false"/>
</apirelease:apiReleaseInfos>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'API_STATE',
        name: 'CL_SALV_TABLE',
      });
      expect(result.isError).toBeUndefined();
      // Verify the URL was built with the class path (inferred from CL_ prefix)
      const calledUrl = String(mockFetch.mock.calls[0]?.[0] ?? '');
      expect(calledUrl).toContain('/sap/bc/adt/apireleases/');
      expect(calledUrl).toContain('classes');
    });

    it('reads API release state (API_STATE) with inferred INTF type from IF_ prefix', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<apirelease:apiReleaseInfos xmlns:apirelease="http://www.sap.com/adt/apirelease" xmlns:adtcore="http://www.sap.com/adt/core">
  <apirelease:releasableObject adtcore:uri="/sap/bc/adt/oo/interfaces/if_http_client" adtcore:type="INTF/OI" adtcore:name="IF_HTTP_CLIENT"/>
  <apirelease:apiCatalogData apirelease:isAnyAssignmentPossible="false" apirelease:isAnyContractReleased="false"/>
</apirelease:apiReleaseInfos>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'API_STATE',
        name: 'IF_HTTP_CLIENT',
      });
      expect(result.isError).toBeUndefined();
      const calledUrl = String(mockFetch.mock.calls[0]?.[0] ?? '');
      expect(calledUrl).toContain('interfaces');
    });

    it('returns error for API_STATE when type cannot be inferred', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'API_STATE',
        name: 'MARA',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Cannot infer object type');
      expect(result.content[0]?.text).toContain('objectType');
    });

    it('API_STATE uses raw URI to avoid double encoding for namespaced objects', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<apirelease:apiReleaseInfos xmlns:apirelease="http://www.sap.com/adt/apirelease" xmlns:adtcore="http://www.sap.com/adt/core">
  <apirelease:releasableObject adtcore:uri="/sap/bc/adt/oo/classes/%2fBOBF%2fCL_LIB" adtcore:type="CLAS/OC" adtcore:name="/BOBF/CL_LIB"/>
  <apirelease:apiCatalogData apirelease:isAnyAssignmentPossible="false" apirelease:isAnyContractReleased="false"/>
</apirelease:apiReleaseInfos>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'API_STATE',
        name: '/BOBF/CL_LIB',
        objectType: 'CLAS',
      });
      expect(result.isError).toBeUndefined();
      // The URL should encode the entire URI once — namespace slashes become %2F, not %252F
      const calledUrl = String(mockFetch.mock.calls[0]?.[0] ?? '');
      expect(calledUrl).toContain('%2FBOBF%2FCL_LIB');
      expect(calledUrl).not.toContain('%252F');
    });

    it('returns error for unknown type with supported types via Zod validation', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'UNKNOWN',
        name: 'TEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Invalid arguments for SAPRead');
      // Should list supported types from Zod enum validation
      expect(result.content[0]?.text).toContain('PROG');
      expect(result.content[0]?.text).toContain('CLAS');
      expect(result.content[0]?.text).toContain('TABL');
      expect(result.content[0]?.text).toContain('DOMA');
      expect(result.content[0]?.text).toContain('DTEL');
      expect(result.content[0]?.text).toContain('TRAN');
    });

    it('returns validation error for empty/missing type', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: '',
        name: 'TEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Invalid arguments for SAPRead');
    });

    it('handles missing type parameter', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        name: 'TEST',
      });
      expect(result.isError).toBe(true);
    });

    it('handles missing name parameter', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
      });
      // Should still attempt with empty name (SAP will return error)
      expect(result.isError).toBeUndefined();
    });

    it('reads INACTIVE_OBJECTS and returns structured list', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          `<?xml version="1.0"?>
          <ioc:inactiveObjects xmlns:ioc="http://www.sap.com/adt/inactiveObjects" xmlns:adtcore="http://www.sap.com/adt/core">
            <ioc:entry><ioc:object>
              <adtcore:objectReference adtcore:uri="/sap/bc/adt/oo/classes/zcl_test" adtcore:type="CLAS/OC" adtcore:name="ZCL_TEST" adtcore:description="Test class"/>
            </ioc:object></ioc:entry>
          </ioc:inactiveObjects>`,
          { 'x-csrf-token': 'T' },
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'INACTIVE_OBJECTS',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text ?? '');
      expect(parsed.count).toBe(1);
      expect(parsed.objects[0].name).toBe('ZCL_TEST');
      expect(parsed.objects[0].type).toBe('CLAS/OC');
    });

    it('reads class with format="structured" returns JSON with metadata and source fields', async () => {
      const classMetadataXml = `<?xml version="1.0" encoding="utf-8"?>
<class:abapClass class:final="true" class:visibility="public" class:category="00" class:fixPointArithmetic="true"
    adtcore:name="ZCL_TEST" adtcore:type="CLAS/OC" adtcore:description="Test class" adtcore:language="EN"
    adtcore:masterLanguage="EN"
    xmlns:class="http://www.sap.com/adt/oo/classes" xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:packageRef adtcore:name="$TMP"/>
</class:abapClass>`;
      mockFetch.mockReset();
      mockFetch.mockImplementation(async (url: string) => {
        const urlStr = String(url);
        if (urlStr.includes('/oo/classes/ZCL_TEST') && !urlStr.includes('/source/') && !urlStr.includes('/includes/')) {
          return mockResponse(200, classMetadataXml, { 'x-csrf-token': 'T' });
        }
        if (urlStr.includes('/source/main')) {
          return mockResponse(200, 'CLASS zcl_test DEFINITION.\nENDCLASS.\nCLASS zcl_test IMPLEMENTATION.\nENDCLASS.', {
            'x-csrf-token': 'T',
          });
        }
        if (urlStr.includes('/includes/')) {
          return mockResponse(404, 'Not Found', { 'x-csrf-token': 'T' });
        }
        return mockResponse(200, '', { 'x-csrf-token': 'T' });
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'CLAS',
        name: 'ZCL_TEST',
        format: 'structured',
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text ?? '');
      expect(parsed.metadata).toBeDefined();
      expect(parsed.metadata.name).toBe('ZCL_TEST');
      expect(parsed.metadata.description).toBe('Test class');
      expect(parsed.main).toContain('CLASS zcl_test');
      expect(parsed.testclasses).toBeNull();
      expect(parsed.definitions).toBeNull();
      expect(parsed.implementations).toBeNull();
      expect(parsed.macros).toBeNull();
    });

    it('reads class with format="text" returns plain source (default behavior)', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'CLAS',
        name: 'ZCL_TEST',
        format: 'text',
      });
      expect(result.isError).toBeUndefined();
      // Plain text, not JSON
      expect(() => JSON.parse(result.content[0]?.text ?? '')).toThrow();
    });

    it('reads class without format returns plain source (backwards compatible)', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'CLAS',
        name: 'ZCL_TEST',
      });
      expect(result.isError).toBeUndefined();
      // Plain text, not JSON — backwards compatible
      expect(result.content[0]?.text).toContain('REPORT');
    });

    it('returns error when format="structured" used with non-CLAS type', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZTEST',
        format: 'structured',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('structured');
      expect(result.content[0]?.text).toContain('CLAS');
    });

    it('reads class with format="structured" and method param — format takes precedence', async () => {
      const classMetadataXml = `<?xml version="1.0" encoding="utf-8"?>
<class:abapClass class:category="00" class:fixPointArithmetic="true"
    adtcore:name="ZCL_TEST" adtcore:description="Test class" adtcore:language="EN"
    adtcore:masterLanguage="EN"
    xmlns:class="http://www.sap.com/adt/oo/classes" xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:packageRef adtcore:name="$TMP"/>
</class:abapClass>`;
      mockFetch.mockReset();
      mockFetch.mockImplementation(async (url: string) => {
        const urlStr = String(url);
        if (urlStr.includes('/oo/classes/ZCL_TEST') && !urlStr.includes('/source/') && !urlStr.includes('/includes/')) {
          return mockResponse(200, classMetadataXml, { 'x-csrf-token': 'T' });
        }
        if (urlStr.includes('/source/main')) {
          return mockResponse(200, 'CLASS zcl_test DEFINITION.\nENDCLASS.\nCLASS zcl_test IMPLEMENTATION.\nENDCLASS.', {
            'x-csrf-token': 'T',
          });
        }
        if (urlStr.includes('/includes/')) {
          return mockResponse(404, 'Not Found', { 'x-csrf-token': 'T' });
        }
        return mockResponse(200, '', { 'x-csrf-token': 'T' });
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'CLAS',
        name: 'ZCL_TEST',
        format: 'structured',
        method: 'get_name',
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text ?? '');
      expect(parsed.metadata).toBeDefined();
      expect(parsed.main).toBeDefined();
    });

    it('structured response is valid JSON with expected keys', async () => {
      const classMetadataXml = `<?xml version="1.0" encoding="utf-8"?>
<class:abapClass class:category="00" class:fixPointArithmetic="true"
    adtcore:name="ZCL_TEST" adtcore:description="Structured test" adtcore:language="EN"
    adtcore:masterLanguage="EN"
    xmlns:class="http://www.sap.com/adt/oo/classes" xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:packageRef adtcore:name="ZDEV"/>
</class:abapClass>`;
      mockFetch.mockReset();
      mockFetch.mockImplementation(async (url: string) => {
        const urlStr = String(url);
        if (urlStr.includes('/oo/classes/ZCL_TEST') && !urlStr.includes('/source/') && !urlStr.includes('/includes/')) {
          return mockResponse(200, classMetadataXml, { 'x-csrf-token': 'T' });
        }
        if (urlStr.includes('/source/main')) {
          return mockResponse(200, 'CLASS zcl_test DEFINITION.\nENDCLASS.', { 'x-csrf-token': 'T' });
        }
        if (urlStr.includes('/includes/testclasses')) {
          return mockResponse(200, 'CLASS ltcl_test DEFINITION.\nENDCLASS.', { 'x-csrf-token': 'T' });
        }
        if (urlStr.includes('/includes/')) {
          return mockResponse(404, 'Not Found', { 'x-csrf-token': 'T' });
        }
        return mockResponse(200, '', { 'x-csrf-token': 'T' });
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'CLAS',
        name: 'ZCL_TEST',
        format: 'structured',
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text ?? '');
      expect(Object.keys(parsed)).toEqual(
        expect.arrayContaining(['metadata', 'main', 'testclasses', 'definitions', 'implementations', 'macros']),
      );
      expect(parsed.metadata.package).toBe('ZDEV');
      expect(parsed.testclasses).toContain('ltcl_test');
    });

    it('returns sqlFilter remediation hint for TABLE_CONTENTS parser errors', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          'Invalid query string. Only SELECT statement is allowed',
          400,
          '/sap/bc/adt/datapreview/ddic',
          'Invalid query string. Only SELECT statement is allowed',
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'TABLE_CONTENTS',
        name: 'MARA',
        sqlFilter: "MANDT = '100'",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('condition expression only');
      expect(result.content[0]?.text).toContain('no WHERE, no SELECT');
      expect(result.content[0]?.text).toContain(`MANDT = '100'`);
    });

    it('returns data-safety hint when TABLE_CONTENTS is blocked by safety config', async () => {
      const blockedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowDataPreview: false },
      });
      const result = await handleToolCall(blockedClient, DEFAULT_CONFIG, 'SAPRead', {
        type: 'TABLE_CONTENTS',
        name: 'MARA',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('TABLE_CONTENTS is blocked by safety configuration or missing data');
      expect(result.content[0]?.text).toContain('SAP_ALLOW_DATA_PREVIEW=true');
    });
  });

  describe('SAPRead server-driven objects (816)', () => {
    const DESD_META = readFileSync(new URL('../../fixtures/sdo/sdo-desd-metadata.xml', import.meta.url), 'utf-8');
    const DESD_SRC = readFileSync(new URL('../../fixtures/sdo/sdo-desd-source.json', import.meta.url), 'utf-8');

    it('reads a DESD as JSON metadata + AFF JSON source', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        const u = String(url);
        if (u.includes('/ddic/desd/') && u.includes('/source/main'))
          return Promise.resolve(mockResponse(200, DESD_SRC));
        if (u.includes('/ddic/desd/')) return Promise.resolve(mockResponse(200, DESD_META));
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 't' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'DESD',
        name: 'DEMO_CDS_LOGICL_EXTERNL_SCHEMA',
      });
      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0]?.text);
      expect(payload.type).toBe('DESD/TYP');
      expect(payload.package).toBe('SABAP_DEMOS_ABAP_CDS_CLOUD');
      expect(payload.source.formatVersion).toBe('1');
      expect(payload.source.header.description).toContain('Demo CDS');
    });

    it('requires name', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 't' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'EVTB' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"name"');
    });

    it('returns a "needs 8.16+" error when discovery shows the type absent (758)', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 't' }));
      const client = createClient();
      vi.spyOn(client.http, 'hasDiscoveryData').mockReturnValue(true);
      vi.spyOn(client.http, 'discoveryAcceptFor').mockReturnValue(undefined);
      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', { type: 'DESD', name: 'X' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('SAP_BASIS 8.16+');
      expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('/ddic/desd/'))).toBe(false);
    });
  });

  describe('SAPRead DDLS include="elements"', () => {
    it('returns raw DDL source when no include param', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'DDLS',
        name: 'ZI_ORDER',
      });
      expect(result.isError).toBeUndefined();
      // Mock returns generic text — just verify no error
    });

    it('returns structured elements when include="elements"', async () => {
      // Override mock to return CDS DDL source
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `define view entity ZI_ORDER as select from zsalesorder {
  key order_id as OrderId,
  customer as Customer,
  gross_amount - discount as NetAmount,
  _Items
}`,
        ),
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'DDLS',
        name: 'ZI_ORDER',
        include: 'elements',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('=== ZI_ORDER elements ===');
      expect(result.content[0]?.text).toContain('OrderId');
      expect(result.content[0]?.text).toContain('Customer');
      expect(result.content[0]?.text).toContain('NetAmount');
    });
  });

  describe('SAPRead cache hit indicator', () => {
    it('shows [cached:revalidated] prefix on second read when SAP returns 304', async () => {
      const { CachingLayer } = await import('../../../src/cache/caching-layer.js');
      const { MemoryCache } = await import('../../../src/cache/memory.js');
      const layer = new CachingLayer(new MemoryCache());
      mockFetch.mockReset();
      mockFetch
        .mockResolvedValueOnce(
          mockResponse(
            200,
            `<?xml version="1.0"?><ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects"/>`,
          ),
        )
        .mockResolvedValueOnce(mockResponse(200, "REPORT zhello.\nWRITE: / 'Hello'.", { etag: 'e1' }))
        .mockResolvedValueOnce(mockResponse(304, '', { etag: 'e1' }));

      // First read — no [cached] prefix
      const result1 = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPRead',
        { type: 'PROG', name: 'ZHELLO' },
        undefined,
        undefined,
        layer,
      );
      expect(result1.isError).toBeUndefined();
      expect(result1.content[0]?.text).not.toMatch(/^\[cached\]/);

      // Second read — should have [cached:revalidated] prefix
      const result2 = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPRead',
        { type: 'PROG', name: 'ZHELLO' },
        undefined,
        undefined,
        layer,
      );
      expect(result2.isError).toBeUndefined();
      expect(result2.content[0]?.text).toMatch(/^\[cached:revalidated\]/);
    });

    it('does NOT show [cached] when no cachingLayer is provided', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'PROG', name: 'ZHELLO' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).not.toMatch(/^\[cached\]/);
    });

    it('does NOT show [cached] for types that bypass cachedGet (DOMA)', async () => {
      const { CachingLayer } = await import('../../../src/cache/caching-layer.js');
      const { MemoryCache } = await import('../../../src/cache/memory.js');
      const layer = new CachingLayer(new MemoryCache());

      // DOMA uses client.getDomain() directly, not cachedGet
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          `<dom:domain xmlns:dom="http://www.sap.com/adt/ddic/domains" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZTEST_DOMAIN"><dom:typeInformation dom:datatype="CHAR" dom:length="10"/></dom:domain>`,
          { 'x-csrf-token': 'T' },
        ),
      );
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPRead',
        { type: 'DOMA', name: 'ZTEST_DOMAIN' },
        undefined,
        undefined,
        layer,
      );
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).not.toMatch(/^\[cached\]/);
    });

    it('shows [cached:revalidated] for INTF on second read', async () => {
      const { CachingLayer } = await import('../../../src/cache/caching-layer.js');
      const { MemoryCache } = await import('../../../src/cache/memory.js');
      const layer = new CachingLayer(new MemoryCache());
      mockFetch.mockReset();
      mockFetch
        .mockResolvedValueOnce(
          mockResponse(
            200,
            `<?xml version="1.0"?><ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects"/>`,
          ),
        )
        .mockResolvedValueOnce(mockResponse(200, 'INTERFACE zif_test. ENDINTERFACE.', { etag: 'e1' }))
        .mockResolvedValueOnce(mockResponse(304, '', { etag: 'e1' }));

      // First read
      await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPRead',
        { type: 'INTF', name: 'ZIF_TEST' },
        undefined,
        undefined,
        layer,
      );
      // Second read
      const result2 = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPRead',
        { type: 'INTF', name: 'ZIF_TEST' },
        undefined,
        undefined,
        layer,
      );
      expect(result2.isError).toBeUndefined();
      expect(result2.content[0]?.text).toMatch(/^\[cached:revalidated\]/);
    });
  });

  describe('SAPRead SOBJ', () => {
    it('lists BOR methods when no method specified', async () => {
      mockFetch.mockReset();
      // CSRF HEAD request (POST triggers CSRF fetch)
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'TOKEN123' }));
      // runQuery POST returns SWOTLV data
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<abap><values><COLUMNS>
          <COLUMN><METADATA name="VERB"/><DATASET><DATA>CREATE</DATA><DATA>DISPLAY</DATA></DATASET></COLUMN>
          <COLUMN><METADATA name="PROGNAME"/><DATASET><DATA>ZPROG1</DATA><DATA>ZPROG2</DATA></DATASET></COLUMN>
          <COLUMN><METADATA name="FORMNAME"/><DATASET><DATA>CREATE_OBJ</DATA><DATA>DISPLAY_OBJ</DATA></DATASET></COLUMN>
          <COLUMN><METADATA name="DESCRIPT"/><DATASET><DATA>Create</DATA><DATA>Display</DATA></DATASET></COLUMN>
        </COLUMNS></values></abap>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'SOBJ',
        name: 'ZBUS_OBJ',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text);
      expect(parsed.columns).toContain('VERB');
      expect(parsed.rows).toHaveLength(2);
    });

    it('reads specific BOR method implementation', async () => {
      mockFetch.mockReset();
      // CSRF HEAD request
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'TOKEN123' }));
      // SWOTLV query POST returns program+form
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<abap><values><COLUMNS>
          <COLUMN><METADATA name="PROGNAME"/><DATASET><DATA>ZPROG1</DATA></DATASET></COLUMN>
          <COLUMN><METADATA name="FORMNAME"/><DATASET><DATA>CREATE_OBJ</DATA></DATASET></COLUMN>
        </COLUMNS></values></abap>`,
        ),
      );
      // Read program source (GET - no CSRF needed)
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'REPORT zprog1.\nFORM create_obj.\nENDFORM.'));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'SOBJ',
        name: 'ZBUS_OBJ',
        method: 'CREATE',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('BOR ZBUS_OBJ.CREATE');
      expect(result.content[0]?.text).toContain('REPORT zprog1');
    });
  });

  describe('method-level SAPRead', () => {
    it('lists methods with method="*"', async () => {
      // Mock response: a class with methods
      const classSource = `CLASS zcl_test DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS get_name RETURNING VALUE(rv) TYPE string.
    METHODS run.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD get_name.
    rv = 'test'.
  ENDMETHOD.
  METHOD run.
    " run logic
  ENDMETHOD.
ENDCLASS.`;

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, classSource));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'CLAS',
        name: 'ZCL_TEST',
        method: '*',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('ZCL_TEST');
      expect(result.content[0]?.text).toContain('get_name');
      expect(result.content[0]?.text).toContain('run');
      expect(result.content[0]?.text).toContain('methods');
    });

    it('extracts single method with method="get_name"', async () => {
      const classSource = `CLASS zcl_test DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS get_name RETURNING VALUE(rv) TYPE string.
    METHODS run.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD get_name.
    rv = 'test'.
  ENDMETHOD.
  METHOD run.
    " run logic
  ENDMETHOD.
ENDCLASS.`;

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, classSource));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'CLAS',
        name: 'ZCL_TEST',
        method: 'get_name',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('METHOD get_name');
      expect(result.content[0]?.text).toContain('ENDMETHOD');
      // Should NOT contain the other method
      expect(result.content[0]?.text).not.toContain('METHOD run');
    });

    it('returns error for nonexistent method', async () => {
      const classSource = `CLASS zcl_test DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS get_name RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD get_name.
    rv = 'test'.
  ENDMETHOD.
ENDCLASS.`;

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, classSource));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'CLAS',
        name: 'ZCL_TEST',
        method: 'nonexistent',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not found');
    });
  });

  describe('FUNC auto-resolve group', () => {
    it('reads FUNC without group by auto-resolving via search', async () => {
      mockFetch.mockReset();
      // First call: search for FM → returns result with URI containing group
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<objectReferences><objectReference type="FUGR/FF" name="Z_MY_FUNC" uri="/sap/bc/adt/functions/groups/zgroup/fmodules/z_my_func" packageName="ZTEST" description="Test FM"/></objectReferences>`,
        ),
      );
      // Second call: read the FM source
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'FUNCTION z_my_func.\nENDFUNCTION.'));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'FUNC',
        name: 'Z_MY_FUNC',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('FUNCTION z_my_func');
    });

    it('returns error when FUNC group cannot be resolved', async () => {
      mockFetch.mockReset();
      // Search returns empty results
      mockFetch.mockResolvedValueOnce(mockResponse(200, '<objectReferences/>'));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'FUNC',
        name: 'Z_NONEXIST_FM',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Cannot resolve function group');
    });
  });

  describe('FUGR include expansion', () => {
    it('reads FUGR with expand_includes=true', async () => {
      mockFetch.mockReset();
      // First call: read FUGR main source
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'INCLUDE LZ_TESTTOP.\nINCLUDE LZ_TESTI01.'));
      // Second call: read first include
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'DATA: gv_test TYPE string.'));
      // Third call: read second include
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'MODULE user_command_0100 INPUT.\nENDMODULE.'));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'FUGR',
        name: 'Z_TEST',
        expand_includes: true,
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('=== FUGR Z_TEST (main) ===');
      expect(result.content[0]?.text).toContain('=== LZ_TESTTOP ===');
      expect(result.content[0]?.text).toContain('DATA: gv_test');
      expect(result.content[0]?.text).toContain('=== LZ_TESTI01 ===');
    });

    it('handles failed includes gracefully', async () => {
      mockFetch.mockReset();
      // Main source
      mockFetch.mockResolvedValueOnce(mockResponse(200, 'INCLUDE LZ_BADINCL.'));
      // Include read fails
      mockFetch.mockRejectedValueOnce(
        new AdtApiError('Not found', 404, '/sap/bc/adt/programs/includes/LZ_BADINCL/source/main'),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'FUGR',
        name: 'Z_TEST',
        expand_includes: true,
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Could not read include');
    });
  });

  describe('action="diff" (version diff)', () => {
    const ACTIVE_SRC = 'CLASS zcl_x DEFINITION.\n  METHOD a.\n  ENDMETHOD.\nENDCLASS.\n';
    const INACTIVE_SRC = 'CLASS zcl_x DEFINITION.\n  METHOD a.\n  ENDMETHOD.\n  METHOD b.\n  ENDMETHOD.\nENDCLASS.\n';
    const FEED_XML = `<?xml version="1.0" encoding="utf-8"?>
<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
  <atom:entry>
    <atom:author><atom:name>MARIAN</atom:name></atom:author>
    <atom:content src="/sap/bc/adt/oo/classes/ZCL_X/includes/main/versions/1/00001/content"/>
    <atom:id>00001</atom:id>
    <atom:updated>2026-06-10T18:36:35Z</atom:updated>
  </atom:entry>
</atom:feed>`;

    it('diffs active vs inactive and returns only the unified diff', async () => {
      // URL-aware so the result is independent of concurrent fetch ordering.
      mockFetch.mockImplementation((url: unknown) =>
        Promise.resolve(mockResponse(200, String(url).includes('version=inactive') ? INACTIVE_SRC : ACTIVE_SRC)),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'CLAS',
        name: 'ZCL_X',
        action: 'diff',
      });
      expect(result.isError).toBeUndefined();
      const text = result.content[0]!.text;
      expect(text).toContain('Diff CLAS ZCL_X: active → inactive');
      expect(text).toContain('(+2 -0)'); // METHOD b. added (2 lines)
      expect(text).toContain('@@');
      expect(text).toContain('+  METHOD b.');
      // only the changed method shows as a hunk; the unchanged METHOD a is context, not duplicated
      expect((text.match(/METHOD a\./g) ?? []).length).toBe(1);
    });

    it('uses custom display labels in the diff summary and patch headers', async () => {
      mockFetch.mockImplementation((url: unknown) =>
        Promise.resolve(mockResponse(200, String(url).includes('version=inactive') ? INACTIVE_SRC : ACTIVE_SRC)),
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'CLAS',
        name: 'ZCL_X',
        action: 'diff',
        from: 'active',
        to: 'inactive',
        fromLabel: 'DNT-6-6 (DS7K900123)',
        toLabel: 'inactive draft',
      });

      expect(result.isError).toBeUndefined();
      const text = result.content[0]!.text;
      expect(text).toContain('Diff CLAS ZCL_X: DNT-6-6 (DS7K900123) → inactive draft');
      expect(text).toContain('--- ZCL_X (DNT-6-6 (DS7K900123))');
      expect(text).toContain('+++ ZCL_X (inactive draft)');
      expect(text).not.toContain('Diff CLAS ZCL_X: active → inactive');
    });

    it('reports "No differences" when both sides are identical (e.g. no draft)', async () => {
      mockFetch.mockImplementation(() => Promise.resolve(mockResponse(200, ACTIVE_SRC)));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'CLAS',
        name: 'ZCL_X',
        action: 'diff',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toBe('No differences between active and inactive for CLAS ZCL_X.');
    });

    it('uses custom display labels in the no-difference message', async () => {
      mockFetch.mockImplementation(() => Promise.resolve(mockResponse(200, ACTIVE_SRC)));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'CLAS',
        name: 'ZCL_X',
        action: 'diff',
        from: 'active',
        to: 'inactive',
        fromLabel: 'released transport',
        toLabel: 'current active',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toBe(
        'No differences between released transport and current active for CLAS ZCL_X.',
      );
    });

    it('resolves a bare revision id via the VERSIONS feed', async () => {
      mockFetch.mockImplementation((url: unknown) => {
        const u = String(url);
        if (u.includes('/content')) return Promise.resolve(mockResponse(200, INACTIVE_SRC));
        if (u.includes('/versions')) return Promise.resolve(mockResponse(200, FEED_XML));
        return Promise.resolve(mockResponse(200, ACTIVE_SRC));
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'CLAS',
        name: 'ZCL_X',
        action: 'diff',
        from: 'active',
        to: '00001',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Diff CLAS ZCL_X: active → 00001');
      expect(result.content[0]?.text).toContain('+  METHOD b.');
    });

    it('errors clearly when a revision id is not found', async () => {
      mockFetch.mockImplementation((url: unknown) => {
        const u = String(url);
        if (u.includes('/versions')) return Promise.resolve(mockResponse(200, FEED_XML));
        return Promise.resolve(mockResponse(200, ACTIVE_SRC));
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'CLAS',
        name: 'ZCL_X',
        action: 'diff',
        from: 'active',
        to: '99999',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not found');
      expect(result.content[0]?.text).toContain('00001'); // lists available ids
    });

    it('rejects diff for an unsupported (non-source) type', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'DOMA',
        name: 'ZMY_DOMAIN',
        action: 'diff',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not supported');
    });

    it('requires a name (schema validation)', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'CLAS',
        action: 'diff',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text.toLowerCase()).toContain('name');
    });

    it('diffs a CLAS include with RAW source on both sides (no "=== include ===" false diff)', async () => {
      // Both sides return identical raw include source. With the bug, the active side would carry a
      // "=== definitions ===" marker (from getClass) while the revision side stays raw → false diff.
      const RAW_INCLUDE = 'INTERFACE zif_x.\n  METHODS m.\nENDINTERFACE.\n';
      mockFetch.mockImplementation(() => Promise.resolve(mockResponse(200, RAW_INCLUDE)));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'CLAS',
        name: 'ZCL_X',
        action: 'diff',
        include: 'definitions',
        from: 'active',
        to: '/sap/bc/adt/oo/classes/ZCL_X/includes/definitions/versions/1/00001/content',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toContain('No differences');
      expect(result.content[0]!.text).not.toContain('==='); // marker must not leak into the diff
    });

    it('auto-resolves the FUNC group for a bare-revision-id diff', async () => {
      const FEED = `<?xml version="1.0" encoding="utf-8"?>
<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
  <atom:entry>
    <atom:author><atom:name>MARIAN</atom:name></atom:author>
    <atom:content src="/sap/bc/adt/functions/groups/zgroup/fmodules/z_my_func/source/main/versions/1/00001/content"/>
    <atom:id>00001</atom:id>
    <atom:updated>2026-06-10T18:36:35Z</atom:updated>
  </atom:entry>
</atom:feed>`;
      mockFetch.mockImplementation((url: unknown) => {
        const u = String(url);
        // group resolution via quickSearch (no group passed) — must succeed before the feed is fetched
        if (u.includes('informationsystem/search'))
          return Promise.resolve(
            mockResponse(
              200,
              '<objectReferences><objectReference type="FUGR/FF" name="Z_MY_FUNC" uri="/sap/bc/adt/functions/groups/zgroup/fmodules/z_my_func" packageName="ZT" description="x"/></objectReferences>',
            ),
          );
        if (u.includes('/content'))
          return Promise.resolve(mockResponse(200, 'FUNCTION z_my_func.\n* old\nENDFUNCTION.\n'));
        if (u.includes('/versions')) return Promise.resolve(mockResponse(200, FEED));
        return Promise.resolve(mockResponse(200, 'FUNCTION z_my_func.\n* new\nENDFUNCTION.\n')); // active fmodule
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'FUNC',
        name: 'Z_MY_FUNC',
        action: 'diff',
        from: '00001',
        to: 'active',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Diff FUNC Z_MY_FUNC: 00001 → active');
    });

    it('gives a clear error for a bare revision id on a type with no revision feed (FUGR)', async () => {
      mockFetch.mockImplementation(() => Promise.resolve(mockResponse(200, 'FUNCTION-POOL zx.')));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'FUGR',
        name: 'ZX',
        action: 'diff',
        from: '00001',
        to: 'active',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Revision-id diff is not available for type FUGR');
    });

    it('diffs a TABL via its DDL source', async () => {
      const V1 = "@EndUserText.label : 'x'\ndefine table ztab {\n  key id : abap.int4;\n}\n";
      const V2 = "@EndUserText.label : 'x'\ndefine table ztab {\n  key id : abap.int4;\n  name : abap.char(20);\n}\n";
      mockFetch.mockImplementation((url: unknown) =>
        Promise.resolve(mockResponse(200, String(url).includes('version=inactive') ? V2 : V1)),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'TABL',
        name: 'ZTAB',
        action: 'diff',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toContain('Diff TABL ZTAB: active → inactive');
      expect(result.content[0]!.text).toContain('+  name : abap.char(20);');
    });
  });

  describe('INACTIVE_OBJECTS', () => {
    it('surfaces backend 404 through the normal error formatter', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(404, 'Not Found', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'INACTIVE_OBJECTS',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('ADT API error');
    });

    it('still returns structured list on success', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          `<?xml version="1.0"?>
          <ioc:inactiveObjects xmlns:ioc="http://www.sap.com/adt/inactiveObjects" xmlns:adtcore="http://www.sap.com/adt/core">
            <ioc:entry><ioc:object>
              <adtcore:objectReference adtcore:uri="/sap/bc/adt/oo/classes/zcl_test" adtcore:type="CLAS/OC" adtcore:name="ZCL_TEST" adtcore:description="Test class"/>
            </ioc:object></ioc:entry>
          </ioc:inactiveObjects>`,
          { 'x-csrf-token': 'T' },
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'INACTIVE_OBJECTS',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text ?? '');
      expect(parsed.count).toBe(1);
    });
  });

  describe('DDLS empty source warning', () => {
    it('returns warning when DDLS source is empty', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'DDLS',
        name: 'ZEMPTY_VIEW',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('has no source code stored');
      expect(result.content[0]?.text).toContain('ZEMPTY_VIEW');
    });

    it('returns warning when DDLS source is whitespace-only', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, '   \n  ', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'DDLS',
        name: 'ZEMPTY_VIEW',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('has no source code stored');
    });

    it('returns normal source when DDLS has content', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(200, 'define view ZI_TEST as select from spfli { carrid }', { 'x-csrf-token': 'T' }),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'DDLS',
        name: 'ZI_TEST',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('define view');
      expect(result.content[0]?.text).not.toContain('has no source code stored');
    });
  });
});
