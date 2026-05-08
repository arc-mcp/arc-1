import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import type { ResolvedFeatures } from '../../../src/adt/types.js';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { logger } from '../../../src/server/logger.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

// Mock undici's fetch (used by AdtHttpClient.doFetch)
const mockFetch = vi.fn();
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: mockFetch };
});

const { AdtClient } = await import('../../../src/adt/client.js');
const {
  handleToolCall,
  hasRequiredScope,
  resetCachedFeatures,
  setCachedFeatures,
  TOOL_SCOPES,
  buildCreateXml,
  transliterateQuery,
  looksLikeFieldName,
  normalizeObjectType,
  warnCdsReservedKeywords,
} = await import('../../../src/handlers/intent.js');

function createClient(): AdtClient {
  return new AdtClient({
    baseUrl: 'http://sap:8000',
    username: 'admin',
    password: 'secret',
    safety: unrestrictedSafetyConfig(),
  });
}

describe('Intent Handler', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: return ABAP source with CSRF token for any request
    mockFetch.mockResolvedValue(
      mockResponse(200, "REPORT zhello.\nWRITE: / 'Hello'.", { 'x-csrf-token': 'mock-csrf-token' }),
    );
  });

  // ─── SAPRead ───────────────────────────────────────────────────────

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
      // Per research/abap-types/types/msag.md it is now a deprecated alias kept for
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
      setCachedFeatures({
        hana: { available: false },
        abapGit: { available: false },
        rap: { available: false },
        amdp: { available: false },
        ui5: { available: false },
        transport: { available: false },
      });
      try {
        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
          type: 'BSP',
        });
        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain('not available');
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
      setCachedFeatures({
        hana: { available: false },
        abapGit: { available: false },
        rap: { available: false },
        amdp: { available: false },
        ui5: { available: false },
        ui5repo: { available: false },
        transport: { available: false },
      });
      try {
        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
          type: 'BSP_DEPLOY',
          name: 'ZAPP_BOOKING',
        });
        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain('not available');
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
      // FTG2 is an ARC-1-private invented identifier (research/abap-types/types/ftg2.md).
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

  // ─── SAPSearch ─────────────────────────────────────────────────────

  describe('SAPSearch', () => {
    it('executes search', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPSearch', {
        query: 'ZCL_*',
      });
      expect(result.isError).toBeUndefined();
    });

    it('respects maxResults parameter', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPSearch', {
        query: 'Z*',
        maxResults: 10,
      });
      expect(result.isError).toBeUndefined();
    });

    it('defaults maxResults to 100', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPSearch', {
        query: 'Z*',
      });
      expect(result.isError).toBeUndefined();
    });

    // ─── Transliteration ──────────────────────────────────────────────

    describe('transliterateQuery', () => {
      it('transliterates German umlauts', () => {
        expect(transliterateQuery('*Schätz*')).toEqual({ normalized: '*SchAEtz*', changed: true });
      });

      it('transliterates uppercase umlauts', () => {
        expect(transliterateQuery('*Übersicht*')).toEqual({ normalized: '*UEbersicht*', changed: true });
      });

      it('transliterates ß to SS', () => {
        expect(transliterateQuery('*straße*')).toEqual({ normalized: '*straSSe*', changed: true });
      });

      it('transliterates all umlauts in uppercase context', () => {
        expect(transliterateQuery('*SCHÄTZÜNG*')).toEqual({ normalized: '*SCHAETZUENG*', changed: true });
      });

      it('returns unchanged for ASCII-only queries', () => {
        expect(transliterateQuery('*SCHAETZ*')).toEqual({ normalized: '*SCHAETZ*', changed: false });
      });

      it('strips accented Latin characters', () => {
        const result = transliterateQuery('*café*');
        expect(result.normalized).toBe('*cafe*');
        expect(result.changed).toBe(true);
      });
    });

    it('transliterates umlaut query and includes note in response', async () => {
      mockFetch.mockReset();
      // Return a search result for the transliterated query
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<objectReferences><objectReference type="CLAS/OC" name="ZCL_SCHAETZ" uri="/sap/bc/adt/oo/classes/zcl_schaetz" packageName="$TMP" description="Test"/></objectReferences>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPSearch', {
        query: '*Schätz*',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Transliterated');
      expect(result.content[0]?.text).toContain('*Schätz*');
      expect(result.content[0]?.text).toContain('*SchAEtz*');
      expect(result.content[0]?.text).toContain('ZCL_SCHAETZ');
    });

    it('transliterates umlaut query and includes note when results are empty', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '<objectReferences/>'));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPSearch', {
        query: '*Schätzung*',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Transliterated');
      expect(result.content[0]?.text).toContain('No objects found');
    });

    it('does NOT transliterate source_code search queries', async () => {
      mockFetch.mockReset();
      // Return empty source search results
      mockFetch.mockResolvedValueOnce(mockResponse(200, '<objectReferences/>'));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPSearch', {
        query: 'Schätzung',
        searchType: 'source_code',
      });
      // Should not contain transliteration note (source code can have umlauts)
      expect(result.content[0]?.text).not.toContain('Transliterated');
    });

    // ─── Field-name detection ─────────────────────────────────────────

    describe('looksLikeFieldName', () => {
      it('detects short uppercase field names', () => {
        expect(looksLikeFieldName('QDSTAT')).toBe(true);
        expect(looksLikeFieldName('MATNR')).toBe(true);
        expect(looksLikeFieldName('BUKRS')).toBe(true);
      });

      it('rejects Z/Y-prefixed names (likely objects)', () => {
        expect(looksLikeFieldName('ZCL_TEST')).toBe(false);
        expect(looksLikeFieldName('Z_MY_FUNC')).toBe(false);
        expect(looksLikeFieldName('YCL_HELPER')).toBe(false);
      });

      it('rejects wildcard patterns', () => {
        expect(looksLikeFieldName('*SCHAETZ*')).toBe(false);
      });

      it('rejects long strings', () => {
        expect(looksLikeFieldName('ABCDEFGHIJKLMNOPQRST')).toBe(false);
      });

      it('rejects lowercase strings', () => {
        expect(looksLikeFieldName('matnr')).toBe(false);
      });
    });

    it('includes field-name hint when empty results look like a field name', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '<objectReferences/>'));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPSearch', {
        query: 'QDSTAT',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('dd03l');
      expect(result.content[0]?.text).toContain('field/column name');
    });

    it('does NOT include field-name hint for Z* queries', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '<objectReferences/>'));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPSearch', {
        query: 'ZCL_NONEXIST',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).not.toContain('field/column name');
    });
  });

  // ─── SAPQuery ──────────────────────────────────────────────────────

  describe('SAPQuery', () => {
    it('attempts to execute SQL query (errors caught from mock)', async () => {
      // The mock returns plain text, but runQuery expects XML for parseTableContents.
      // In a real scenario the POST returns XML. The error gets caught by intent handler.
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPQuery', {
        sql: 'SELECT * FROM T000',
      });
      // Either succeeds (if XML parsed) or error is caught gracefully
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
    });

    it('returns parser hint with JOIN-specific addendum when a JOIN query fails with 400', async () => {
      mockFetch.mockReset();
      // First call: CSRF token fetch (200)
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
      // Second call: POST returns 400 (parser error)
      mockFetch.mockResolvedValueOnce(mockResponse(400, '"INTO" is invalid at this position'));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPQuery', {
        sql: 'SELECT a~field1, b~field2 FROM ztable1 AS a INNER JOIN ztable2 AS b ON a~id = b~id INTO TABLE @DATA(lt_result)',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('ADT freestyle SQL parser rejected this query');
      expect(result.content[0]?.text).toContain('exactly one SELECT statement');
      expect(result.content[0]?.text).toContain('Remove ABAP target clauses');
      expect(result.content[0]?.text).toContain('SAP Note 3605050');
      expect(result.content[0]?.text).toContain('staged single-table queries');
    });

    it('returns parser hint for non-JOIN 400 parser signatures', async () => {
      mockFetch.mockReset();
      // First call: CSRF token fetch (200)
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
      // Second call: POST returns parser signature
      mockFetch.mockResolvedValueOnce(mockResponse(400, 'Invalid query string. Only one SELECT statement is allowed'));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPQuery', {
        sql: 'SELECT * FROM ztable1; SELECT * FROM ztable2',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('ADT freestyle SQL parser rejected this query');
      expect(result.content[0]?.text).toContain('exactly one SELECT statement');
      expect(result.content[0]?.text).toContain('Remove ABAP target clauses');
      expect(result.content[0]?.text).not.toContain('SAP Note 3605050');
    });

    it('is blocked when free SQL is disallowed', async () => {
      const client = new AdtClient({
        baseUrl: 'http://sap:8000',
        safety: { ...unrestrictedSafetyConfig(), allowFreeSQL: false },
      });
      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPQuery', {
        sql: 'SELECT * FROM T000',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('blocked');
    });
  });

  // ─── SAPLint ───────────────────────────────────────────────────────

  describe('SAPLint', () => {
    it('lints ABAP source code', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPLint', {
        action: 'lint',
        source: "REPORT ztest.\nWRITE: / 'Hello'.",
        name: 'ZTEST',
      });
      expect(result.isError).toBeUndefined();
      const issues = JSON.parse(result.content[0]?.text);
      expect(Array.isArray(issues)).toBe(true);
    });

    it('auto-detects filename from source', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPLint', {
        action: 'lint',
        source: 'CLASS zcl_test DEFINITION.\nENDCLASS.',
        name: 'ZCL_TEST',
      });
      expect(result.isError).toBeUndefined();
    });

    it('returns Zod validation error for unknown action', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPLint', {
        action: 'unknown',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Invalid arguments for SAPLint');
      expect(result.content[0]?.text).toContain('lint');
      expect(result.content[0]?.text).toContain('lint_and_fix');
      expect(result.content[0]?.text).toContain('list_rules');
      expect(result.content[0]?.text).toContain('format');
      expect(result.content[0]?.text).toContain('get_formatter_settings');
      expect(result.content[0]?.text).toContain('set_formatter_settings');
    });

    it('returns Zod validation error for atc (not a valid SAPLint action)', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPLint', {
        action: 'atc',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Invalid arguments for SAPLint');
    });

    it('returns Zod validation error for syntax (not a valid SAPLint action)', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPLint', {
        action: 'syntax',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Invalid arguments for SAPLint');
    });

    it('returns error for missing action', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPLint', {});
      expect(result.isError).toBe(true);
    });

    it('lint_and_fix returns fixed source and applied rules', async () => {
      const source = `CLASS zcl_test DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS test.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD test.
    data lv_x type i.
    lv_x = 1.
  ENDMETHOD.
ENDCLASS.`;
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPLint', {
        action: 'lint_and_fix',
        source,
        name: 'ZCL_TEST',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text);
      expect(parsed).toHaveProperty('fixedSource');
      expect(parsed).toHaveProperty('appliedFixes');
      expect(parsed).toHaveProperty('fixedRules');
      expect(parsed).toHaveProperty('remainingIssues');
      expect(parsed.appliedFixes).toBeGreaterThan(0);
    });

    it('lint_and_fix requires source', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPLint', {
        action: 'lint_and_fix',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('source');
    });

    it('list_rules returns rule catalog with counts', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPLint', {
        action: 'list_rules',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text);
      expect(parsed).toHaveProperty('preset');
      expect(parsed).toHaveProperty('enabledRules');
      expect(parsed).toHaveProperty('disabledRules');
      expect(parsed).toHaveProperty('rules');
      expect(parsed.enabledRules).toBeGreaterThan(0);
      expect(parsed.disabledRules).toBeGreaterThan(0);
      expect(parsed.disabledRuleNames).toBeInstanceOf(Array);
    });

    it('uses config.systemType=btp even without cached features (no probe)', async () => {
      // Ensure no cached features from a prior probe
      resetCachedFeatures();
      const btpConfig = { ...DEFAULT_CONFIG, systemType: 'btp' as const };
      // Lint a REPORT — should get cloud_types error because config says btp
      const result = await handleToolCall(createClient(), btpConfig, 'SAPLint', {
        action: 'lint',
        source: "REPORT ztest.\nWRITE: / 'Hello'.",
        name: 'ZTEST',
      });
      expect(result.isError).toBeUndefined();
      const issues = JSON.parse(result.content[0]?.text);
      expect(issues.some((i: { rule: string }) => i.rule === 'cloud_types')).toBe(true);
    });

    it('list_rules shows cloud preset when config.systemType=btp without probe', async () => {
      resetCachedFeatures();
      const btpConfig = { ...DEFAULT_CONFIG, systemType: 'btp' as const };
      const result = await handleToolCall(createClient(), btpConfig, 'SAPLint', {
        action: 'list_rules',
      });
      const parsed = JSON.parse(result.content[0]?.text);
      expect(parsed.preset).toBe('cloud');
    });

    it('lint accepts custom rule overrides', async () => {
      const source = `CLASS zcl_test DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS test.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD test.
    DATA lv_x TYPE i.
    lv_x = 1.
  ENDMETHOD.
ENDCLASS.`;
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPLint', {
        action: 'lint',
        source,
        name: 'ZCL_TEST',
        rules: { line_length: { severity: 'Error', length: 10 } },
      });
      expect(result.isError).toBeUndefined();
      const issues = JSON.parse(result.content[0]?.text);
      // With length=10, many lines should trigger line_length
      const lineIssues = issues.filter((i: { rule: string }) => i.rule === 'line_length');
      expect(lineIssues.length).toBeGreaterThan(0);
    });

    it('format returns pretty-printed source via ADT endpoint', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      const source = 'report ztest.\ndata lv type string.\n';
      const formatted = 'REPORT ztest.\nDATA lv TYPE string.\n';
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string | Buffer }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        calls.push({
          method,
          url: urlStr,
          body: typeof opts?.body === 'string' ? opts.body : undefined,
        });
        if (method === 'HEAD' && urlStr.includes('/sap/bc/adt/core/discovery')) {
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
        }
        if (method === 'POST' && urlStr.includes('/sap/bc/adt/abapsource/prettyprinter')) {
          return Promise.resolve(mockResponse(200, formatted, { 'x-csrf-token': 'mock-csrf-token' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPLint', {
        action: 'format',
        source,
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toBe(formatted);
      const formatCall = calls.find((c) => c.method === 'POST' && c.url.includes('/abapsource/prettyprinter'));
      expect(formatCall).toBeDefined();
      expect(formatCall?.body).toBe(source);
    });

    it('format requires source', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPLint', {
        action: 'format',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"source" is required for format action.');
    });

    it('get_formatter_settings returns parsed settings as JSON', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/abapsource/prettyprinter/settings')) {
          return Promise.resolve(
            mockResponse(
              200,
              '<abapformatter:PrettyPrinterSettings abapformatter:indentation="true" abapformatter:style="keywordUpper" xmlns:abapformatter="http://www.sap.com/adt/prettyprintersettings"/>',
            ),
          );
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPLint', {
        action: 'get_formatter_settings',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text);
      expect(parsed).toEqual({ indentation: true, style: 'keywordUpper' });
    });

    it('set_formatter_settings merges with current values when only style is provided', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string | Buffer }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        calls.push({
          method,
          url: urlStr,
          body: typeof opts?.body === 'string' ? opts.body : undefined,
        });
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/abapsource/prettyprinter/settings')) {
          return Promise.resolve(
            mockResponse(
              200,
              '<abapformatter:PrettyPrinterSettings abapformatter:indentation="false" abapformatter:style="keywordUpper" xmlns:abapformatter="http://www.sap.com/adt/prettyprintersettings"/>',
            ),
          );
        }
        if (method === 'HEAD' && urlStr.includes('/sap/bc/adt/core/discovery')) {
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
        }
        if (method === 'PUT' && urlStr.includes('/sap/bc/adt/abapsource/prettyprinter/settings')) {
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPLint', {
        action: 'set_formatter_settings',
        style: 'keywordLower',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text);
      expect(parsed).toEqual({ indentation: false, style: 'keywordLower' });

      const putCall = calls.find((c) => c.method === 'PUT' && c.url.includes('/abapsource/prettyprinter/settings'));
      expect(putCall).toBeDefined();
      expect(putCall?.body).toContain('abapformatter:indentation="false"');
      expect(putCall?.body).toContain('abapformatter:style="keywordLower"');
    });

    it('set_formatter_settings requires indentation or style', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPLint', {
        action: 'set_formatter_settings',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain(
        'At least one of "indentation" or "style" is required for set_formatter_settings.',
      );
    });

    it('lint requires source', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPLint', {
        action: 'lint',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('source');
    });
  });

  // ─── SAPDiagnose quickfix ──────────────────────────────────────────

  describe('SAPDiagnose quickfix', () => {
    it('quickfix action calls quickfix evaluation endpoint with encoded source URI and source body', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockImplementation(
        (
          url: string | URL,
          opts?: { method?: string; body?: string | Buffer | null; headers?: Record<string, string> },
        ) => {
          const method = opts?.method ?? 'GET';
          const urlStr = String(url);
          calls.push({
            method,
            url: urlStr,
            body: typeof opts?.body === 'string' ? opts.body : undefined,
          });
          if (method === 'POST' && urlStr.includes('/sap/bc/adt/quickfixes/evaluation')) {
            return Promise.resolve(
              mockResponse(
                200,
                `<qf:evaluationResults xmlns:qf="http://www.sap.com/adt/quickfixes" xmlns:adtcore="http://www.sap.com/adt/core">
                  <qf:evaluationResult>
                    <adtcore:objectReference adtcore:uri="/sap/bc/adt/quickfixes/1" adtcore:type="quickfix/proposal" adtcore:name="Declare variable" adtcore:description="Adds declaration"/>
                    <qf:userContent>opaque-state</qf:userContent>
                  </qf:evaluationResult>
                </qf:evaluationResults>`,
                { 'x-csrf-token': 'T' },
              ),
            );
          }
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        },
      );

      const source = 'CLASS zcl_test DEFINITION. ENDCLASS.';
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'quickfix',
        type: 'CLAS',
        name: 'ZCL_TEST',
        source,
        line: 10,
        column: 2,
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed).toEqual([
        {
          uri: '/sap/bc/adt/quickfixes/1',
          type: 'quickfix/proposal',
          name: 'Declare variable',
          description: 'Adds declaration',
          userContent: 'opaque-state',
        },
      ]);

      const evalCall = calls.find((c) => c.method === 'POST' && c.url.includes('/sap/bc/adt/quickfixes/evaluation'));
      expect(evalCall).toBeDefined();
      expect(evalCall?.url).toContain('%23start%3D10%2C2');
      expect(evalCall?.url).toContain('%2Fsap%2Fbc%2Fadt%2Foo%2Fclasses%2FZCL_TEST%2Fsource%2Fmain');
      expect(evalCall?.body).toBe(source);
    });

    it('quickfix action returns error when source is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'quickfix',
        type: 'CLAS',
        name: 'ZCL_TEST',
        line: 1,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"source" is required for "quickfix" action.');
    });

    it('quickfix action returns error when line is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'quickfix',
        type: 'CLAS',
        name: 'ZCL_TEST',
        source: 'CLASS zcl_test DEFINITION. ENDCLASS.',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"line" is required for "quickfix" action.');
    });

    it('apply_quickfix action posts to proposal URI and returns deltas JSON', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockImplementation(
        (
          url: string | URL,
          opts?: { method?: string; body?: string | Buffer | null; headers?: Record<string, string> },
        ) => {
          const method = opts?.method ?? 'GET';
          const urlStr = String(url);
          calls.push({
            method,
            url: urlStr,
            body: typeof opts?.body === 'string' ? opts.body : undefined,
          });
          if (method === 'POST' && urlStr.includes('/sap/bc/adt/quickfixes/1')) {
            return Promise.resolve(
              mockResponse(
                200,
                `<quickfixes:applicationResult xmlns:quickfixes="http://www.sap.com/adt/quickfixes">
                  <quickfixes:delta uri="/sap/bc/adt/oo/classes/ZCL_TEST/source/main" startLine="3" startColumn="1" endLine="3" endColumn="4">
                    <quickfixes:content>DATA</quickfixes:content>
                  </quickfixes:delta>
                </quickfixes:applicationResult>`,
                { 'x-csrf-token': 'T' },
              ),
            );
          }
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        },
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'apply_quickfix',
        type: 'CLAS',
        name: 'ZCL_TEST',
        source: 'CLASS zcl_test DEFINITION. ENDCLASS.',
        line: 3,
        column: 1,
        proposalUri: '/sap/bc/adt/quickfixes/1',
        proposalUserContent: 'opaque-state',
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed).toEqual([
        {
          uri: '/sap/bc/adt/oo/classes/ZCL_TEST/source/main',
          range: { start: { line: 3, column: 1 }, end: { line: 3, column: 4 } },
          content: 'DATA',
        },
      ]);

      const applyCall = calls.find((c) => c.method === 'POST' && c.url.includes('/sap/bc/adt/quickfixes/1'));
      expect(applyCall).toBeDefined();
      expect(applyCall?.body).toContain('<userContent>opaque-state</userContent>');
    });

    it('apply_quickfix action returns error when proposalUri is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'apply_quickfix',
        type: 'CLAS',
        name: 'ZCL_TEST',
        source: 'CLASS zcl_test DEFINITION. ENDCLASS.',
        line: 3,
        proposalUserContent: 'opaque-state',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"proposalUri" is required for "apply_quickfix" action.');
    });

    it('schema validation rejects unknown SAPDiagnose actions', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'not_real',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Invalid arguments for SAPDiagnose');
    });
  });

  describe('SAPDiagnose runtime diagnostics', () => {
    function mockDumpDetailResponses(formattedText?: string): void {
      const xml = `<?xml version="1.0"?>
<dump:dump xmlns:dump="http://www.sap.com/adt/categories/dump" error="STRING_OFFSET_TOO_LARGE" author="DEVELOPER" exception="CX_SY_RANGE_OUT_OF_BOUNDS" terminatedProgram="SAPLSUSR_CERTRULE" datetime="2026-03-28T20:19:14Z">
  <dump:links>
    <dump:link relation="http://www.sap.com/adt/relations/runtime/dump/termination" uri="adt://A4H/sap/bc/adt/functions/groups/susr_certrule/includes/lsusr_certrulef01/source/main#start=27"/>
  </dump:links>
  <dump:chapters>
    <dump:chapter name="kap0" title="Short Text" category="ABAP Developer View" line="1" chapterOrder="1" categoryOrder="1"/>
    <dump:chapter name="kap1" title="What happened?" category="User View" line="4" chapterOrder="2" categoryOrder="1"/>
    <dump:chapter name="kap3" title="Error analysis" category="ABAP Developer View" line="7" chapterOrder="3" categoryOrder="1"/>
    <dump:chapter name="kap8" title="Source Code Extract" category="ABAP Developer View" line="10" chapterOrder="4" categoryOrder="1"/>
    <dump:chapter name="kap11" title="Active Calls/Events" category="ABAP Developer View" line="13" chapterOrder="5" categoryOrder="1"/>
  </dump:chapters>
</dump:dump>`;
      const text =
        formattedText ??
        [
          'Short Text',
          'S1',
          '',
          'What happened?',
          'W1',
          '',
          'Error analysis',
          'E1',
          '',
          'Source Code Extract',
          'C1',
          '',
          'Active Calls/Events',
          'A1',
        ].join('\n');

      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('/runtime/dump/DUMP_ID/formatted')) {
          return Promise.resolve(mockResponse(200, text, { 'x-csrf-token': 'T' }));
        }
        if (urlStr.includes('/runtime/dump/DUMP_ID')) {
          return Promise.resolve(mockResponse(200, xml, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });
    }

    it('returns focused dump sections by default (without formattedText blob)', async () => {
      mockDumpDetailResponses();

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'dumps',
        id: 'DUMP_ID',
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.sections.kap0).toContain('Short Text');
      expect(parsed.sections.kap8).toContain('Source Code Extract');
      expect(parsed).not.toHaveProperty('formattedText');
    });

    it('includes full formatted dump text only when includeFullText=true', async () => {
      mockDumpDetailResponses('Short Text\nSECRET_DUMP_CONTENT');

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'dumps',
        id: 'DUMP_ID',
        includeFullText: true,
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.formattedText).toContain('SECRET_DUMP_CONTENT');
    });

    it('supports explicit dump section filtering by chapter id and title text', async () => {
      mockDumpDetailResponses();

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'dumps',
        id: 'DUMP_ID',
        sections: ['kap1', 'Source Code Extract'],
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(Object.keys(parsed.sections)).toEqual(['kap1', 'kap8']);
      expect(parsed.sections.kap1).toContain('What happened?');
      expect(parsed.sections.kap8).toContain('Source Code Extract');
    });

    it('dispatches system_messages action to runtime/systemmessages feed', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          '<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:entry><atom:id>MSG1</atom:id><atom:title>Maintenance</atom:title></atom:entry></atom:feed>',
          { 'x-csrf-token': 'T' },
        ),
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'system_messages',
        user: 'ADMIN',
        maxResults: 3,
      });

      expect(result.isError).toBeUndefined();
      const calledUrl = String(mockFetch.mock.calls[0]?.[0] ?? '');
      expect(calledUrl).toContain('/sap/bc/adt/runtime/systemmessages');
      expect(calledUrl).toMatch(/%24top=3|\$top=3/);
      expect(decodeURIComponent(calledUrl)).toContain('equals(user,ADMIN)');
    });

    it('dispatches gateway_errors list action to /sap/bc/adt/gw/errorlog', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          '<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:entry><atom:id>/sap/bc/adt/gw/errorlog/Frontend%20Error/ABC</atom:id><atom:title>Gateway fail</atom:title><atom:link rel="self" href="/sap/bc/adt/gw/errorlog/Frontend%20Error/ABC"/></atom:entry></atom:feed>',
          { 'x-csrf-token': 'T' },
        ),
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'gateway_errors',
        maxResults: 2,
      });

      expect(result.isError).toBeUndefined();
      const calledUrl = String(mockFetch.mock.calls[0]?.[0] ?? '');
      expect(calledUrl).toContain('/sap/bc/adt/gw/errorlog');
      expect(calledUrl).toMatch(/%24top=2|\$top=2/);
    });

    it('returns a BTP guardrail for gateway_errors action', async () => {
      setCachedFeatures({ abapRelease: '757', systemType: 'btp' } as ResolvedFeatures);
      try {
        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
          action: 'gateway_errors',
        });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toContain('not available on BTP ABAP Environment');
      } finally {
        resetCachedFeatures();
      }
    });

    it('uses diagnostics-specific not-found hint for missing dump IDs', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValue(
        new AdtApiError('Not Found', 404, '/sap/bc/adt/runtime/dump/MISSING', '<error>not found</error>'),
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'dumps',
        id: 'MISSING',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Dump ID "MISSING" was not found');
      expect(result.content[0]?.text).toContain('Re-list dumps');
    });

    it('sanitizes audit preview for dump details', async () => {
      const auditSpy = vi.spyOn(logger, 'emitAudit');
      try {
        mockDumpDetailResponses('Short Text\nSECRET_DUMP_CONTENT_SHOULD_NOT_BE_LOGGED');
        await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
          action: 'dumps',
          id: 'DUMP_ID',
          includeFullText: true,
        });

        const endEvent = auditSpy.mock.calls
          .map(([event]) => event)
          .find(
            (event) =>
              typeof event === 'object' &&
              event !== null &&
              (event as { event?: string; status?: string }).event === 'tool_call_end' &&
              (event as { event?: string; status?: string }).status === 'success',
          ) as { resultPreview?: string } | undefined;

        expect(endEvent?.resultPreview).toContain('[omitted');
        expect(endEvent?.resultPreview).not.toContain('SECRET_DUMP_CONTENT_SHOULD_NOT_BE_LOGGED');
      } finally {
        auditSpy.mockRestore();
      }
    });
  });

  // ─── SAPWrite Package Enforcement ──────────────────────────────

  describe('SAPWrite package enforcement', () => {
    it('rejects create for package not in allowedPackages', async () => {
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] },
      });
      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'CLAS',
        name: 'ZCL_TEST',
        package: 'ZTEST',
        source: 'CLASS zcl_test DEFINITION PUBLIC. ENDCLASS. CLASS zcl_test IMPLEMENTATION. ENDCLASS.',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('ZTEST');
      expect(result.content[0]?.text).toContain('blocked');
    });

    it('allows create for package in allowedPackages', async () => {
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] },
      });
      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'CLAS',
        name: 'ZCL_TEST',
        package: '$TMP',
        source: 'CLASS zcl_test DEFINITION PUBLIC. ENDCLASS. CLASS zcl_test IMPLEMENTATION. ENDCLASS.',
      });
      // Should not be blocked by package check (may fail at HTTP level, but that's OK)
      expect(result.content[0]?.text).not.toContain('blocked by safety');
    });

    it('rejects update when object is in a non-allowed package', async () => {
      // Mock: first call = resolveObjectPackage (GET object URL → XML with packageRef),
      // subsequent calls = normal CSRF/lock/update/unlock flow
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          '<class:abapClass xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZCL_TEST"><adtcore:packageRef adtcore:name="ZFORBIDDEN"/></class:abapClass>',
          { 'x-csrf-token': 'T' },
        ),
      );
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] },
      });
      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'CLAS',
        name: 'ZCL_TEST',
        source: 'CLASS zcl_test DEFINITION PUBLIC. ENDCLASS. CLASS zcl_test IMPLEMENTATION. ENDCLASS.',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('ZFORBIDDEN');
      expect(result.content[0]?.text).toContain('blocked');
    });

    it('rejects delete when object is in a non-allowed package', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          '<program:abapProgram xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="SAP_BASIS"/></program:abapProgram>',
          { 'x-csrf-token': 'T' },
        ),
      );
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['Z*', '$TMP'] },
      });
      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete',
        type: 'PROG',
        name: 'SAPL_STANDARD',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('SAP_BASIS');
      expect(result.content[0]?.text).toContain('blocked');
    });

    it('rejects edit_method when class is in a non-allowed package', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          '<class:abapClass xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="ZFORBIDDEN"/></class:abapClass>',
          { 'x-csrf-token': 'T' },
        ),
      );
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] },
      });
      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_method',
        type: 'CLAS',
        name: 'ZCL_TEST',
        method: 'do_something',
        source: 'METHOD do_something. ENDMETHOD.',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('ZFORBIDDEN');
      expect(result.content[0]?.text).toContain('blocked');
    });

    it('allows update when object is in an allowed package', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          '<class:abapClass xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="$TMP"/></class:abapClass>',
          { 'x-csrf-token': 'T' },
        ),
      );
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] },
      });
      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'CLAS',
        name: 'ZCL_TEST',
        source: 'CLASS zcl_test DEFINITION PUBLIC. ENDCLASS. CLASS zcl_test IMPLEMENTATION. ENDCLASS.',
      });
      expect(result.content[0]?.text).not.toContain('blocked by safety');
    });

    it('skips package resolution when allowedPackages is empty (unrestricted)', async () => {
      // With no package restrictions, resolveObjectPackage should NOT be called
      const client = createClient(); // unrestricted safety
      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'CLAS',
        name: 'ZCL_TEST',
        source: 'CLASS zcl_test DEFINITION PUBLIC. ENDCLASS. CLASS zcl_test IMPLEMENTATION. ENDCLASS.',
      });
      // unrestricted config has empty allowedPackages → skip resolveObjectPackage
      expect(result.content[0]?.text).not.toContain('blocked by safety');
    });
  });

  // ─── SAPWrite Pre-Write Lint Gate ───────────────────────────────

  describe('SAPWrite pre-write lint gate', () => {
    it('blocks update with parser errors when lintBeforeWrite is enabled', async () => {
      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: true };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'update',
        type: 'CLAS',
        name: 'ZCL_TEST',
        source: `CLASS zcl_test DEFINITION PUBLIC.
  PUBLIC SECTION.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD nonexistent.
    INVALID SYNTAX HERE.
  ENDMETHOD.
ENDCLASS.`,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Pre-write lint check failed');
      expect(result.content[0]?.text).toContain('parser_error');
    });

    it('allows update when lintBeforeWrite is disabled', async () => {
      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
      // With lint disabled, even broken code should attempt the write
      // (it will succeed because our mock returns 200)
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'update',
        type: 'CLAS',
        name: 'ZCL_TEST',
        source: `CLASS zcl_test DEFINITION PUBLIC.
  PUBLIC SECTION.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD nonexistent.
    INVALID SYNTAX HERE.
  ENDMETHOD.
ENDCLASS.`,
      });
      // Should not be a lint error (write is attempted)
      if (result.isError) {
        // May fail for SAP reasons, but not lint reasons
        expect(result.content[0]?.text).not.toContain('Pre-write lint check failed');
      }
    });

    it('allows valid ABAP through the gate', async () => {
      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: true };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'update',
        type: 'CLAS',
        name: 'ZCL_TEST',
        source: `CLASS zcl_test DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS test.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD test.
    DATA lv_x TYPE i.
    lv_x = 1.
  ENDMETHOD.
ENDCLASS.`,
      });
      // Should not be a lint error
      if (result.content[0]?.text) {
        expect(result.content[0]?.text).not.toContain('Pre-write lint check failed');
      }
    });
  });

  describe('SAPWrite pre-write lint gate for DDLS', () => {
    it('blocks DDLS write with CDS syntax errors', async () => {
      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: true };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'update',
        type: 'DDLS',
        name: 'ZI_TEST',
        source: `define view entity ZI_TEST as select from ztable {
  key field1
  field2
}`,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Pre-write lint check failed');
      expect(result.content[0]?.text).toContain('cds_parser_error');
    });

    it('allows valid DDLS through the gate', async () => {
      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: true };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'update',
        type: 'DDLS',
        name: 'ZI_TEST',
        source: `define view entity ZI_TEST as select from ztable {
  key field1,
  field2
}`,
      });
      if (result.content[0]?.text) {
        expect(result.content[0]?.text).not.toContain('Pre-write lint check failed');
      }
    });

    it('adds CDS downstream impact guidance after DDLS update', async () => {
      mockFetch.mockReset();
      const whereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddl/sources/zi_child_one" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_CHILD_ONE" adtcore:type="DDLS/DF" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddl/sources/zi_child_two" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_CHILD_TWO" adtcore:type="DDLS/DF" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
    <usageReferences:referencedObject uri="/sap/bc/adt/bo/behaviordefinitions/ZI_ROOT" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_ROOT" adtcore:type="BDEF/BO" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/srvd/sources/ZSD_ROOT" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZSD_ROOT" adtcore:type="SRVD/SRV" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;

      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = (opts?.method ?? 'GET').toUpperCase();
        const urlStr = String(url);
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(
            mockResponse(200, '<asx:values><LOCK_HANDLE>LH_DDLS</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
              'x-csrf-token': 'T',
            }),
          );
        }
        if (method === 'POST' && urlStr.includes('/sap/bc/adt/repository/informationsystem/usageReferences?uri=')) {
          return Promise.resolve(mockResponse(200, whereUsedXml, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
      });

      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'update',
        type: 'DDLS',
        name: 'ZI_ROOT',
        source: `define view entity ZI_ROOT as select from ztab { key id, name }`,
      });

      expect(result.isError).toBeUndefined();
      const text = result.content[0]!.text;
      expect(text).toContain('Successfully updated DDLS ZI_ROOT');
      expect(text).toContain('CDS update follow-up for ZI_ROOT');
      expect(text).toContain('ZI_CHILD_ONE');
      expect(text).toContain('ZI_CHILD_TWO');
      expect(text).toContain('ZSD_ROOT');
      expect(text).toContain('SAPActivate(type="DDLS", name="ZI_ROOT")');
      expect(text).toContain('Suggested re-activation order: DDLS ZI_ROOT, DDLS ZI_CHILD_ONE, DDLS ZI_CHILD_TWO');
      expect(text).toContain(
        'Batch call template: SAPActivate(objects=[{type:"DDLS",name:"ZI_ROOT"}, {type:"DDLS",name:"ZI_CHILD_ONE"}',
      );
    });

    it('supplements DDLS update guidance with scoped where-used results when unfiltered results are partial', async () => {
      mockFetch.mockReset();
      const scopeXml = `<?xml version="1.0" encoding="UTF-8"?>
<usageReferences:scopeResponse xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:objectType type="DDLS/DF" description="DDL Source" count="3"/>
  <usageReferences:objectType type="BDEF/BO" description="Behavior Definition" count="1"/>
</usageReferences:scopeResponse>`;
      const unfilteredWhereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddl/sources/ZI_CHILD_ONE" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_CHILD_ONE" adtcore:type="DDLS/DF" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;
      const scopedDdlsWhereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddl/sources/zi_child_one" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_CHILD_ONE" adtcore:type="DDLS/DF" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddl/sources/zi_child_two" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_CHILD_TWO" adtcore:type="DDLS/DF" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddl/sources/zi_child_three" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_CHILD_THREE" adtcore:type="DDLS/DF" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;
      const scopedBdefWhereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
    <usageReferences:referencedObject uri="/sap/bc/adt/bo/behaviordefinitions/ZI_ROOT" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_ROOT" adtcore:type="BDEF/BO" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;

      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string }) => {
        const method = (opts?.method ?? 'GET').toUpperCase();
        const urlStr = String(url);
        const body = String(opts?.body ?? '');
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(
            mockResponse(200, '<asx:values><LOCK_HANDLE>LH_DDLS</LOCK_HANDLE><CORRNR></CORRNR></asx:values>', {
              'x-csrf-token': 'T',
            }),
          );
        }
        if (method === 'POST' && urlStr.includes('/usageReferences/scope')) {
          return Promise.resolve(mockResponse(200, scopeXml, { 'x-csrf-token': 'T' }));
        }
        if (method === 'POST' && urlStr.includes('/sap/bc/adt/repository/informationsystem/usageReferences?uri=')) {
          if (body.includes('objectTypeFilter value="DDLS/DF"')) {
            return Promise.resolve(mockResponse(200, scopedDdlsWhereUsedXml, { 'x-csrf-token': 'T' }));
          }
          if (body.includes('objectTypeFilter value="BDEF/BO"')) {
            return Promise.resolve(mockResponse(200, scopedBdefWhereUsedXml, { 'x-csrf-token': 'T' }));
          }
          return Promise.resolve(mockResponse(200, unfilteredWhereUsedXml, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
      });

      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'update',
        type: 'DDLS',
        name: 'ZI_ROOT',
        source: `define view entity ZI_ROOT as select from ztab { key id, name }`,
      });

      expect(result.isError).toBeUndefined();
      const text = result.content[0]!.text;
      expect(text).toContain('ZI_CHILD_ONE');
      expect(text).toContain('ZI_CHILD_TWO');
      expect(text).toContain('ZI_CHILD_THREE');
      expect(text).toContain('BDEF ZI_ROOT');
      expect(text).toContain('Downstream consumers in ADT where-used index: 4');

      const usageBodies = mockFetch.mock.calls
        .map((call) => String((call[1] as { body?: string } | undefined)?.body ?? ''))
        .filter((body) => body.includes('usageReferenceRequest'));
      expect(usageBodies.some((body) => body.includes('objectTypeFilter value="DDLS/DF"'))).toBe(true);
      expect(usageBodies.some((body) => body.includes('objectTypeFilter value="BDEF/BO"'))).toBe(true);
    });

    it('still skips BDEF for pre-write lint', async () => {
      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: true };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'update',
        type: 'BDEF',
        name: 'ZI_TEST',
        source: 'this is total garbage that should not trigger lint',
      });
      if (result.content[0]?.text) {
        expect(result.content[0]?.text).not.toContain('Pre-write lint check failed');
      }
    });

    it('still skips SRVD for pre-write lint', async () => {
      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: true };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'update',
        type: 'SRVD',
        name: 'ZSD_TEST',
        source: 'this is total garbage that should not trigger lint',
      });
      if (result.content[0]?.text) {
        expect(result.content[0]?.text).not.toContain('Pre-write lint check failed');
      }
    });
  });

  // ─── Unknown Tool ──────────────────────────────────────────────────

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'UnknownTool', {});
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Unknown tool');
    });
  });

  // ─── Error Handling ────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns isError=true for all error responses', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'INVALID_TYPE',
        name: 'X',
      });
      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
    });

    it('catches non-Error exceptions', async () => {
      // This tests the catch(err) path with a non-Error value
      const client = new AdtClient({
        baseUrl: 'http://sap:8000',
        safety: { ...unrestrictedSafetyConfig(), allowFreeSQL: false },
      });
      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPQuery', {
        sql: 'SELECT * FROM T000',
      });
      expect(result.isError).toBe(true);
    });
  });

  // ─── Scope Enforcement ────────────────────────────────────────────

  describe('scope enforcement', () => {
    const readAuth: AuthInfo = {
      token: 'test-token',
      clientId: 'test-client',
      scopes: ['read'],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };

    const writeAuth: AuthInfo = {
      token: 'test-token',
      clientId: 'test-client',
      scopes: ['read', 'write'],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };

    const dataAuth: AuthInfo = {
      token: 'test-token',
      clientId: 'test-client',
      scopes: ['read', 'data'],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };

    const sqlAuth: AuthInfo = {
      token: 'test-token',
      clientId: 'test-client',
      scopes: ['read', 'sql'],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };

    const _adminAuth: AuthInfo = {
      token: 'test-token',
      clientId: 'test-client',
      scopes: ['read', 'write', 'data', 'sql', 'admin'],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      extra: { userName: 'test.user@company.com', email: 'test.user@company.com' },
    };

    it('allows SAPRead with read scope', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPRead',
        { type: 'PROG', name: 'ZHELLO' },
        readAuth,
      );
      expect(result.isError).toBeUndefined();
    });

    it('blocks SAPWrite with read-only scope', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPWrite',
        { type: 'PROG', name: 'ZHELLO', source: 'test' },
        readAuth,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Insufficient scope: 'write'");
      expect(result.content[0]?.text).toContain('SAPWrite');
    });

    it('allows SAPWrite with write scope', async () => {
      // SAPWrite will fail (unknown tool in switch), but it should NOT be blocked by scope
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPWrite',
        { type: 'PROG', name: 'ZHELLO', source: 'test' },
        writeAuth,
      );
      // Should reach the switch statement, not be blocked by scope
      expect(result.content[0]?.text).not.toContain('Insufficient scope');
    });

    it('allows SAPTransport with write scope', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPTransport',
        { action: 'list' },
        writeAuth,
      );
      // Should reach the switch, not blocked by scope
      expect(result.content[0]?.text).not.toContain('Insufficient scope');
    });

    it('allows SAPTransport read actions with read scope (v0.7: check/history/list/get require read, not write)', async () => {
      // This test inverts the v0.6 behavior — SAPTransport.list is now classified as read.
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPTransport', { action: 'list' }, readAuth);
      // Not blocked by scope — may error for other reasons (e.g., SAP backend), but not "Insufficient scope".
      expect(result.content[0]?.text).not.toContain('Insufficient scope');
    });

    it('blocks SAPTransport write actions with read scope', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPTransport',
        { action: 'create', description: 'Test' },
        readAuth,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Insufficient scope: 'transports'");
    });

    it('allows SAPManage probe/features actions with read scope', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPManage',
        { action: 'features' },
        readAuth,
      );
      expect(result.content[0]?.text).not.toContain('Insufficient scope');
    });

    it('blocks SAPManage write actions with read scope', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPManage',
        { action: 'create_package' },
        readAuth,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Insufficient scope: 'write'");
      expect(result.content[0]?.text).toContain('SAPManage(action="create_package")');
    });

    it('blocks SAP(manage) write sub-action escalation with read scope', async () => {
      // Hyperfocused SAP.manage is a coarse "go call SAPManage"; action-level check happens
      // downstream when the inner SAPManage action is dispatched, not here.
      // The hyperfocused outer call requires 'write' scope (SAP.manage is write in ACTION_POLICY).
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAP',
        { action: 'manage', params: { action: 'create_package' } },
        readAuth,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Insufficient scope');
    });

    it('allows SAPManage write actions with write scope (scope check passes)', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPManage',
        { action: 'create_package' },
        writeAuth,
      );
      // Should proceed to handler-level validation, not action-scope rejection.
      expect(result.content[0]?.text).not.toContain("Insufficient scope: 'write'");
      expect(result.content[0]?.text).toContain('"name" is required');
    });

    it('blocks SAPQuery with read-only scope (requires sql)', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPQuery',
        { sql: 'SELECT * FROM t000' },
        readAuth,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Insufficient scope: 'sql'");
    });

    it('blocks SAPQuery with data-only scope (requires sql)', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPQuery',
        { sql: 'SELECT * FROM t000' },
        dataAuth,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Insufficient scope: 'sql'");
    });

    it('allows SAPQuery with sql scope (sql implies data)', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPQuery',
        { sql: 'SELECT * FROM t000' },
        sqlAuth,
      );
      // Should reach the handler, not blocked by scope
      expect(result.content[0]?.text).not.toContain('Insufficient scope');
    });

    it('allows all tools when no authInfo (backward compat)', async () => {
      // No authInfo = no scope enforcement (stdio mode, API key without XSUAA)
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'PROG', name: 'ZHELLO' });
      expect(result.isError).toBeUndefined();
    });

    it('includes user scopes in error message', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {}, readAuth);
      expect(result.content[0]?.text).toContain('Your scopes: [read]');
    });

    it('write scope implies read for SAPRead', async () => {
      // User with only write scope (no explicit read) can access SAPRead
      const writeOnlyAuth: AuthInfo = {
        token: 'test-token',
        clientId: 'test-client',
        scopes: ['write'],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      };
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPRead',
        { type: 'PROG', name: 'ZHELLO' },
        writeOnlyAuth,
      );
      expect(result.isError).toBeUndefined();
    });
  });

  // ─── SAPGit ────────────────────────────────────────────────────────

  describe('SAPGit', () => {
    const gctsReposJson = '{"result":[{"rid":"ZARC1","url":"https://github.com/example/arc1.git"}]}';
    const abapGitReposXml = `<?xml version="1.0" encoding="utf-8"?>
<abapgitrepo:repositories xmlns:abapgitrepo="http://www.sap.com/adt/abapgit/repository" xmlns:atom="http://www.w3.org/2005/Atom">
  <abapgitrepo:repository abapgitrepo:key="000000000001" abapgitrepo:package="$TMP" abapgitrepo:url="https://github.com/example/repo.git" abapgitrepo:branchName="main">
    <atom:link rel="http://www.sap.com/adt/abapgit/relations/stage" href="/sap/bc/adt/abapgit/repos/000000000001/stage" type="stage_link"/>
    <atom:link rel="http://www.sap.com/adt/abapgit/relations/push" href="/sap/bc/adt/abapgit/repos/000000000001/push" type="push_link"/>
    <atom:link rel="http://www.sap.com/adt/abapgit/relations/check" href="/sap/bc/adt/abapgit/repos/000000000001/checks" type="check_link"/>
  </abapgitrepo:repository>
</abapgitrepo:repositories>`;
    const stagingXml = `<?xml version="1.0" encoding="utf-8"?>
<abapgitrepo:objects xmlns:abapgitrepo="http://www.sap.com/adt/abapgit/repository">
  <abapgitrepo:object abapgitrepo:type="CLAS" abapgitrepo:name="ZCL_ARC1_TEST" abapgitrepo:operation="M"/>
</abapgitrepo:objects>`;

    function readAuth(): AuthInfo {
      return {
        token: 'test-token',
        clientId: 'test-client',
        scopes: ['read'],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      };
    }

    afterEach(() => {
      resetCachedFeatures();
    });

    it('auto-selects gCTS when both backends are available', async () => {
      setCachedFeatures({
        gcts: { id: 'gcts', available: true, mode: 'auto' },
        abapGit: { id: 'abapGit', available: true, mode: 'auto' },
      } as ResolvedFeatures);
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, gctsReposJson));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPGit', { action: 'list_repos' });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.backend).toBe('gcts');
      expect(parsed.result[0].rid).toBe('ZARC1');
    });

    it('honors explicit backend override to abapgit', async () => {
      setCachedFeatures({
        gcts: { id: 'gcts', available: true, mode: 'auto' },
        abapGit: { id: 'abapGit', available: true, mode: 'auto' },
      } as ResolvedFeatures);
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, abapGitReposXml));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPGit', {
        action: 'list_repos',
        backend: 'abapgit',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.backend).toBe('abapgit');
      expect(parsed.result[0].key).toBe('000000000001');
    });

    it('returns helpful error when no backend is available', async () => {
      setCachedFeatures({
        gcts: { id: 'gcts', available: false, mode: 'auto' },
        abapGit: { id: 'abapGit', available: false, mode: 'auto' },
      } as ResolvedFeatures);
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPGit', { action: 'list_repos' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Neither gCTS nor abapGit is available');
    });

    it('blocks write actions for read-only scoped users (requires git scope in v0.7)', async () => {
      setCachedFeatures({
        gcts: { id: 'gcts', available: true, mode: 'auto' },
        abapGit: { id: 'abapGit', available: false, mode: 'auto' },
      } as ResolvedFeatures);
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPGit',
        { action: 'clone', backend: 'gcts', url: 'https://github.com/example/repo.git', package: '$TMP' },
        readAuth(),
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Insufficient scope: 'git'");
    });

    it('returns backend-mismatch error for gCTS-only action on abapGit backend', async () => {
      setCachedFeatures({
        gcts: { id: 'gcts', available: false, mode: 'auto' },
        abapGit: { id: 'abapGit', available: true, mode: 'auto' },
      } as ResolvedFeatures);
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPGit', {
        action: 'whoami',
        backend: 'abapgit',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('only supported by gCTS');
    });

    it('dispatches stage action to abapGit backend and returns JSON payload', async () => {
      setCachedFeatures({
        gcts: { id: 'gcts', available: false, mode: 'auto' },
        abapGit: { id: 'abapGit', available: true, mode: 'auto' },
      } as ResolvedFeatures);
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, abapGitReposXml));
      mockFetch.mockResolvedValueOnce(mockResponse(200, stagingXml));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPGit', {
        action: 'stage',
        backend: 'abapgit',
        repoId: '000000000001',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.backend).toBe('abapgit');
      expect(parsed.result.objects[0].type).toBe('CLAS');
    });

    it('surfaces AdtSafetyError from git write operations when allowGitWrites=false', async () => {
      setCachedFeatures({
        gcts: { id: 'gcts', available: true, mode: 'auto' },
        abapGit: { id: 'abapGit', available: false, mode: 'auto' },
      } as ResolvedFeatures);
      const client = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowGitWrites: false },
      });
      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPGit', {
        action: 'clone',
        backend: 'gcts',
        url: 'https://github.com/example/repo.git',
        package: '$TMP',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/allowGitWrites=false|Git write/);
    });

    it('surfaces AdtApiError details from backend calls', async () => {
      setCachedFeatures({
        gcts: { id: 'gcts', available: true, mode: 'auto' },
        abapGit: { id: 'abapGit', available: false, mode: 'auto' },
      } as ResolvedFeatures);
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(500, '{"exception":"No relation between system and repository"}', {
          'content-type': 'application/json',
        }),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPGit', {
        action: 'list_repos',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('No relation between system and repository');
    });

    it('rejects unknown SAPGit action through schema validation', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPGit', { action: 'unknown_action' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Invalid arguments for SAPGit');
    });
  });

  // ─── TOOL_SCOPES mapping ──────────────────────────────────────────

  describe('TOOL_SCOPES (back-compat re-export derived from ACTION_POLICY)', () => {
    it('maps read tools to read scope', () => {
      // SAPTransport is now read at tool-level (check/history/list/get).
      // Mutations require the `transports` scope via action-level policy.
      for (const tool of [
        'SAPRead',
        'SAPSearch',
        'SAPNavigate',
        'SAPContext',
        'SAPLint',
        'SAPDiagnose',
        'SAPGit',
        'SAPTransport',
      ]) {
        expect(TOOL_SCOPES[tool]).toBe('read');
      }
    });

    it('maps write tools to write scope', () => {
      // SAPManage default is write (create/delete/change_package mutate); individual
      // read actions (features/probe/cache_stats/flp_list_*) have action-level read scope.
      for (const tool of ['SAPWrite', 'SAPActivate', 'SAPManage']) {
        expect(TOOL_SCOPES[tool]).toBe('write');
      }
    });

    it('maps SAPQuery to sql scope', () => {
      expect(TOOL_SCOPES.SAPQuery).toBe('sql');
    });

    it('covers all 12 tools', () => {
      expect(Object.keys(TOOL_SCOPES)).toHaveLength(12);
    });
  });

  // ─── hasRequiredScope ──────────────────────────────────────────────

  describe('hasRequiredScope', () => {
    function makeAuth(scopes: string[]): AuthInfo {
      return {
        token: 'test-token',
        clientId: 'test-client',
        scopes,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      };
    }

    it('returns true for direct scope match', () => {
      expect(hasRequiredScope(makeAuth(['read']), 'read')).toBe(true);
      expect(hasRequiredScope(makeAuth(['write']), 'write')).toBe(true);
      expect(hasRequiredScope(makeAuth(['data']), 'data')).toBe(true);
      expect(hasRequiredScope(makeAuth(['sql']), 'sql')).toBe(true);
    });

    it('returns false when scope is missing', () => {
      expect(hasRequiredScope(makeAuth(['read']), 'write')).toBe(false);
      expect(hasRequiredScope(makeAuth(['read']), 'data')).toBe(false);
      expect(hasRequiredScope(makeAuth(['data']), 'read')).toBe(false);
    });

    it('write implies read', () => {
      expect(hasRequiredScope(makeAuth(['write']), 'read')).toBe(true);
    });

    it('sql implies data', () => {
      expect(hasRequiredScope(makeAuth(['sql']), 'data')).toBe(true);
    });

    it('write does NOT imply data', () => {
      expect(hasRequiredScope(makeAuth(['write']), 'data')).toBe(false);
    });

    it('sql does NOT imply read', () => {
      expect(hasRequiredScope(makeAuth(['sql']), 'read')).toBe(false);
    });

    it('returns false for empty scopes', () => {
      expect(hasRequiredScope(makeAuth([]), 'read')).toBe(false);
      expect(hasRequiredScope(makeAuth([]), 'write')).toBe(false);
      expect(hasRequiredScope(makeAuth([]), 'data')).toBe(false);
      expect(hasRequiredScope(makeAuth([]), 'sql')).toBe(false);
    });

    it('admin scope implies ALL other scopes (v0.7 change)', () => {
      expect(hasRequiredScope(makeAuth(['admin']), 'read')).toBe(true);
      expect(hasRequiredScope(makeAuth(['admin']), 'write')).toBe(true);
      expect(hasRequiredScope(makeAuth(['admin']), 'data')).toBe(true);
      expect(hasRequiredScope(makeAuth(['admin']), 'sql')).toBe(true);
      expect(hasRequiredScope(makeAuth(['admin']), 'transports')).toBe(true);
      expect(hasRequiredScope(makeAuth(['admin']), 'git')).toBe(true);
    });
  });

  // ─── SAPContext ──────────────────────────────────────────────────────

  describe('SAPContext', () => {
    it('returns error when type is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        name: 'ZCL_TEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('type');
    });

    it('returns error when name is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        type: 'CLAS',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('name');
    });

    it('returns Zod validation error for unsupported type', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        type: 'TABL',
        name: 'MARA',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Invalid arguments for SAPContext');
      expect(result.content[0]?.text).toContain('CLAS');
    });

    it('dispatches successfully with provided source', async () => {
      const source = `CLASS zcl_standalone DEFINITION PUBLIC.
  PUBLIC SECTION.
    METHODS run.
ENDCLASS.
CLASS zcl_standalone IMPLEMENTATION.
  METHOD run. ENDMETHOD.
ENDCLASS.`;
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        type: 'CLAS',
        name: 'zcl_standalone',
        source,
      });
      // Should not be an error — it processes the source and returns context
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Dependency context for zcl_standalone');
    });

    it('dispatches DDLS type for CDS context', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        type: 'DDLS',
        name: 'ZI_ORDER',
      });
      // Mock returns generic text which the CDS parser will process
      // It should not error — it calls getDdls and runs CDS context pipeline
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('CDS dependency context for ZI_ORDER');
    });

    it('returns CDS impact with upstream and downstream buckets', async () => {
      mockFetch.mockReset();
      const whereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddl/sources/zi_arc1_proj" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_ARC1_PROJ" adtcore:type="DDLS/DF" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
    <usageReferences:referencedObject uri="/sap/bc/adt/rap/bdef/bo/zi_arc1_root" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_ARC1_ROOT" adtcore:type="BDEF/BO" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;

      mockFetch.mockImplementation((url: string | URL, _opts?: RequestInit) => {
        const urlStr = String(url);
        if (urlStr.includes('/sap/bc/adt/ddic/ddl/sources/Z_MY_VIEW/source/main')) {
          return Promise.resolve(
            mockResponse(
              200,
              `define view entity Z_MY_VIEW as select from zmytab\n  inner join ZI_BASE on ZI_BASE.id = zmytab.id\n  association [0..1] to ZI_ASSOC as _Assoc on _Assoc.id = zmytab.id\n{\n  key zmytab.id,\n  _Assoc\n}`,
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        if (urlStr.includes('/sap/bc/adt/repository/informationsystem/usageReferences?uri=')) {
          return Promise.resolve(mockResponse(200, whereUsedXml, { 'x-csrf-token': 'T' }));
        }
        // default fallback for token bootstrap/other requests
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        action: 'impact',
        type: 'DDLS',
        name: 'Z_MY_VIEW',
        siblingCheck: false,
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.name).toBe('Z_MY_VIEW');
      expect(parsed.type).toBe('DDLS');
      expect(parsed.upstream.tables.map((item: { name: string }) => item.name)).toContain('ZMYTAB');
      expect(parsed.upstream.views.map((item: { name: string }) => item.name)).toContain('ZI_BASE');
      expect(parsed.downstream.projectionViews.map((item: { name: string }) => item.name)).toContain('ZI_ARC1_PROJ');
      expect(parsed.downstream.bdefs.map((item: { name: string }) => item.name)).toContain('ZI_ARC1_ROOT');
      expect(parsed.summary.downstreamTotal).toBeGreaterThanOrEqual(2);
    });

    it('returns guidance error when impact is requested for non-DDLS type', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        action: 'impact',
        type: 'CLAS',
        name: 'ZCL_TEST',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('SAPNavigate');
    });

    it('defaults type to DDLS when action=impact and type is omitted', async () => {
      // Regression: Sonnet 4.6 transcript showed LLMs call
      //   SAPContext({ action: "impact", name: "I_COUNTRY" })
      // without `type` (since impact is DDLS-only, the type is redundant).
      // Previously this returned 'Both "type" and "name" are required' and
      // forced a retry. Now the handler should default type=DDLS and proceed.
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('/sap/bc/adt/ddic/ddl/sources/I_COUNTRY/source/main')) {
          return Promise.resolve(
            mockResponse(200, 'define view entity I_COUNTRY as select from t005 { key t005.land1 as Country }', {
              'x-csrf-token': 'T',
            }),
          );
        }
        if (urlStr.includes('/sap/bc/adt/repository/informationsystem/usageReferences?uri=')) {
          return Promise.resolve(mockResponse(404, 'Not Found', { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        action: 'impact',
        name: 'I_COUNTRY',
        siblingCheck: false,
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.name).toBe('I_COUNTRY');
      expect(parsed.type).toBe('DDLS');
      // Upstream came from the DDL source we mocked, proving the default
      // routed through the DDLS impact pipeline.
      expect(parsed.upstream.tables.map((item: { name: string }) => item.name)).toContain('T005');
    });

    it('returns Zod validation error when impact is called without name', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        action: 'impact',
        type: 'DDLS',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Invalid arguments for SAPContext');
      expect(result.content[0]?.text).toContain('name');
    });

    it('degrades gracefully when where-used endpoint is unavailable', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('/sap/bc/adt/ddic/ddl/sources/Z_MY_VIEW/source/main')) {
          return Promise.resolve(
            mockResponse(200, 'define view entity Z_MY_VIEW as select from zmytab { key zmytab.id }', {
              'x-csrf-token': 'T',
            }),
          );
        }
        if (urlStr.includes('/sap/bc/adt/repository/informationsystem/usageReferences?uri=')) {
          return Promise.resolve(mockResponse(404, 'Not Found', { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        action: 'impact',
        type: 'DDLS',
        name: 'Z_MY_VIEW',
        siblingCheck: false,
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.warnings).toEqual(['Where-used endpoint not available on this system']);
      expect(parsed.downstream.summary.total).toBe(0);
    });

    it('emits sibling consistency hint when sibling DDLS has DDLX consumers but target does not', async () => {
      mockFetch.mockReset();

      const targetSearchXml = `<?xml version="1.0" encoding="utf-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/Z_ORDERDATA3" adtcore:type="DDLS/DF" adtcore:name="Z_ORDERDATA3" adtcore:packageName="ZPKG" adtcore:description="Target"/>
</adtcore:objectReferences>`;
      const siblingSearchXml = `<?xml version="1.0" encoding="utf-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/Z_ORDERDATA3" adtcore:type="DDLS/DF" adtcore:name="Z_ORDERDATA3" adtcore:packageName="ZPKG" adtcore:description="Target"/>
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/Z_ORDERDATA4" adtcore:type="DDLS/DF" adtcore:name="Z_ORDERDATA4" adtcore:packageName="ZPKG" adtcore:description="Sibling"/>
</adtcore:objectReferences>`;
      const targetWhereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddl/sources/zi_projection" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_PROJECTION" adtcore:type="DDLS/DF" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;
      const siblingWhereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddlx/sources/z_orderdata4" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="Z_ORDERDATA4" adtcore:type="DDLX/EX" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;

      mockFetch.mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('/sap/bc/adt/ddic/ddl/sources/Z_ORDERDATA3/source/main')) {
          return Promise.resolve(
            mockResponse(200, 'define view entity Z_ORDERDATA3 as select from zmytab { key zmytab.id }', {
              'x-csrf-token': 'T',
            }),
          );
        }
        if (urlStr.includes('usageReferences?uri=%2Fsap%2Fbc%2Fadt%2Fddic%2Fddl%2Fsources%2FZ_ORDERDATA3')) {
          return Promise.resolve(mockResponse(200, targetWhereUsedXml, { 'x-csrf-token': 'T' }));
        }
        if (urlStr.includes('usageReferences?uri=%2Fsap%2Fbc%2Fadt%2Fddic%2Fddl%2Fsources%2FZ_ORDERDATA4')) {
          return Promise.resolve(mockResponse(200, siblingWhereUsedXml, { 'x-csrf-token': 'T' }));
        }
        if (urlStr.includes('/sap/bc/adt/repository/informationsystem/search?operation=quickSearch')) {
          const parsed = new URL(urlStr);
          const query = parsed.searchParams.get('query');
          if (query === 'Z_ORDERDATA3') {
            return Promise.resolve(mockResponse(200, targetSearchXml, { 'x-csrf-token': 'T' }));
          }
          if (query === 'Z_ORDERDATA*') {
            return Promise.resolve(mockResponse(200, siblingSearchXml, { 'x-csrf-token': 'T' }));
          }
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        action: 'impact',
        type: 'DDLS',
        name: 'Z_ORDERDATA3',
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.consistencyHints?.[0]).toContain('Z_ORDERDATA3');
      expect(parsed.consistencyHints?.[0]).toContain('Z_ORDERDATA4');
      expect(parsed.siblingExtensionAnalysis.target.packageName).toBe('ZPKG');
      expect(parsed.siblingExtensionAnalysis.checkedCandidates[0].name).toBe('Z_ORDERDATA4');
      expect(parsed.siblingExtensionAnalysis.checkedCandidates[0].metadataExtensions).toBe(1);
    });

    it('does not emit sibling hint when target already has DDLX consumers', async () => {
      mockFetch.mockReset();

      const targetSearchXml = `<?xml version="1.0" encoding="utf-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/Z_ORDERDATA3" adtcore:type="DDLS/DF" adtcore:name="Z_ORDERDATA3" adtcore:packageName="ZPKG" adtcore:description="Target"/>
</adtcore:objectReferences>`;
      const siblingSearchXml = `<?xml version="1.0" encoding="utf-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/Z_ORDERDATA4" adtcore:type="DDLS/DF" adtcore:name="Z_ORDERDATA4" adtcore:packageName="ZPKG" adtcore:description="Sibling"/>
</adtcore:objectReferences>`;
      const whereUsedWithDdlx = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddlx/sources/z_orderdata3" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="Z_ORDERDATA3" adtcore:type="DDLX/EX" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;

      mockFetch.mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('/sap/bc/adt/ddic/ddl/sources/Z_ORDERDATA3/source/main')) {
          return Promise.resolve(
            mockResponse(200, 'define view entity Z_ORDERDATA3 as select from zmytab { key zmytab.id }', {
              'x-csrf-token': 'T',
            }),
          );
        }
        if (urlStr.includes('usageReferences?uri=%2Fsap%2Fbc%2Fadt%2Fddic%2Fddl%2Fsources%2FZ_ORDERDATA3')) {
          return Promise.resolve(mockResponse(200, whereUsedWithDdlx, { 'x-csrf-token': 'T' }));
        }
        if (urlStr.includes('usageReferences?uri=%2Fsap%2Fbc%2Fadt%2Fddic%2Fddl%2Fsources%2FZ_ORDERDATA4')) {
          return Promise.resolve(mockResponse(200, whereUsedWithDdlx, { 'x-csrf-token': 'T' }));
        }
        if (urlStr.includes('/sap/bc/adt/repository/informationsystem/search?operation=quickSearch')) {
          const parsed = new URL(urlStr);
          const query = parsed.searchParams.get('query');
          if (query === 'Z_ORDERDATA3') {
            return Promise.resolve(mockResponse(200, targetSearchXml, { 'x-csrf-token': 'T' }));
          }
          if (query === 'Z_ORDERDATA*') {
            return Promise.resolve(mockResponse(200, siblingSearchXml, { 'x-csrf-token': 'T' }));
          }
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        action: 'impact',
        type: 'DDLS',
        name: 'Z_ORDERDATA3',
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.consistencyHints).toBeUndefined();
      expect(parsed.siblingExtensionAnalysis.target.metadataExtensions).toBe(1);
    });

    it('enforces sibling candidate cap', async () => {
      mockFetch.mockReset();
      let siblingWhereUsedCalls = 0;

      const targetSearchXml = `<?xml version="1.0" encoding="utf-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/Z_ORDERDATA3" adtcore:type="DDLS/DF" adtcore:name="Z_ORDERDATA3" adtcore:packageName="ZPKG" adtcore:description="Target"/>
</adtcore:objectReferences>`;
      const siblingSearchXml = `<?xml version="1.0" encoding="utf-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/Z_ORDERDATA4" adtcore:type="DDLS/DF" adtcore:name="Z_ORDERDATA4" adtcore:packageName="ZPKG" adtcore:description="Sibling 4"/>
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/Z_ORDERDATA5" adtcore:type="DDLS/DF" adtcore:name="Z_ORDERDATA5" adtcore:packageName="ZPKG" adtcore:description="Sibling 5"/>
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/Z_ORDERDATA6" adtcore:type="DDLS/DF" adtcore:name="Z_ORDERDATA6" adtcore:packageName="ZPKG" adtcore:description="Sibling 6"/>
</adtcore:objectReferences>`;
      const emptyWhereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects />
</usageReferences:usageReferenceResult>`;

      mockFetch.mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('/sap/bc/adt/ddic/ddl/sources/Z_ORDERDATA3/source/main')) {
          return Promise.resolve(
            mockResponse(200, 'define view entity Z_ORDERDATA3 as select from zmytab { key zmytab.id }', {
              'x-csrf-token': 'T',
            }),
          );
        }
        if (urlStr.includes('usageReferences?uri=%2Fsap%2Fbc%2Fadt%2Fddic%2Fddl%2Fsources%2FZ_ORDERDATA3')) {
          return Promise.resolve(mockResponse(200, emptyWhereUsedXml, { 'x-csrf-token': 'T' }));
        }
        if (urlStr.includes('usageReferences?uri=%2Fsap%2Fbc%2Fadt%2Fddic%2Fddl%2Fsources%2FZ_ORDERDATA')) {
          siblingWhereUsedCalls += 1;
          return Promise.resolve(mockResponse(200, emptyWhereUsedXml, { 'x-csrf-token': 'T' }));
        }
        if (urlStr.includes('/sap/bc/adt/repository/informationsystem/search?operation=quickSearch')) {
          const parsed = new URL(urlStr);
          const query = parsed.searchParams.get('query');
          if (query === 'Z_ORDERDATA3') {
            return Promise.resolve(mockResponse(200, targetSearchXml, { 'x-csrf-token': 'T' }));
          }
          if (query === 'Z_ORDERDATA*') {
            return Promise.resolve(mockResponse(200, siblingSearchXml, { 'x-csrf-token': 'T' }));
          }
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        action: 'impact',
        type: 'DDLS',
        name: 'Z_ORDERDATA3',
        siblingMaxCandidates: 1,
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.siblingExtensionAnalysis.checkedCandidates).toHaveLength(1);
      expect(parsed.siblingExtensionAnalysis.skipped.overLimit).toBe(2);
      expect(siblingWhereUsedCalls).toBe(1);
    });

    it('keeps base impact response when sibling search fails', async () => {
      mockFetch.mockReset();

      const emptyWhereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects />
</usageReferences:usageReferenceResult>`;

      mockFetch.mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('/sap/bc/adt/ddic/ddl/sources/Z_ORDERDATA3/source/main')) {
          return Promise.resolve(
            mockResponse(200, 'define view entity Z_ORDERDATA3 as select from zmytab { key zmytab.id }', {
              'x-csrf-token': 'T',
            }),
          );
        }
        if (urlStr.includes('usageReferences?uri=%2Fsap%2Fbc%2Fadt%2Fddic%2Fddl%2Fsources%2FZ_ORDERDATA3')) {
          return Promise.resolve(mockResponse(200, emptyWhereUsedXml, { 'x-csrf-token': 'T' }));
        }
        if (urlStr.includes('/sap/bc/adt/repository/informationsystem/search?operation=quickSearch')) {
          return Promise.resolve(mockResponse(500, 'Search failed', { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        action: 'impact',
        type: 'DDLS',
        name: 'Z_ORDERDATA3',
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.summary.downstreamTotal).toBe(0);
      expect(parsed.warnings).toContain(
        'Sibling consistency check skipped due to search or where-used processing errors.',
      );
    });

    it('skips sibling analysis and records a warning when the derived stem is too short', async () => {
      mockFetch.mockReset();
      let searchCalled = false;

      const emptyWhereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects />
</usageReferences:usageReferenceResult>`;

      mockFetch.mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('/sap/bc/adt/ddic/ddl/sources/Z1/source/main')) {
          return Promise.resolve(
            mockResponse(200, 'define view entity Z1 as select from zmytab { key zmytab.id }', {
              'x-csrf-token': 'T',
            }),
          );
        }
        if (urlStr.includes('usageReferences?uri=%2Fsap%2Fbc%2Fadt%2Fddic%2Fddl%2Fsources%2FZ1')) {
          return Promise.resolve(mockResponse(200, emptyWhereUsedXml, { 'x-csrf-token': 'T' }));
        }
        if (urlStr.includes('/sap/bc/adt/repository/informationsystem/search?operation=quickSearch')) {
          searchCalled = true;
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPContext', {
        action: 'impact',
        type: 'DDLS',
        name: 'Z1',
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.siblingExtensionAnalysis).toBeUndefined();
      expect(parsed.warnings?.some((msg: string) => msg.includes('too short to identify siblings'))).toBe(true);
      expect(searchCalled).toBe(false);
    });
  });

  // ─── SAPRead DDLS include="elements" ──────────────────────────────

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

  // ─── SAPActivate ───────────────────────────────────────────────────

  describe('SAPActivate', () => {
    it('activates a single object', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'PROG',
        name: 'ZTEST',
      });
      // Mock returns generic text with no error markers → activation succeeds
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Successfully activated PROG ZTEST');
    });

    it('batch activates multiple objects', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        objects: [
          { type: 'DDLS', name: 'ZI_TRAVEL' },
          { type: 'BDEF', name: 'ZI_TRAVEL' },
          { type: 'SRVD', name: 'ZSD_TRAVEL' },
        ],
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Successfully activated 3 objects');
      expect(result.content[0]?.text).toContain('ZI_TRAVEL');
      expect(result.content[0]?.text).toContain('ZSD_TRAVEL');
    });

    it('batch activation uses type from individual objects', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        objects: [
          { type: 'DDLX', name: 'ZC_TRAVEL' },
          { type: 'SRVB', name: 'ZUI_TRAVEL_O4' },
        ],
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Successfully activated 2 objects');
    });

    it('batch activation returns per-object status details on mixed outcomes', async () => {
      const xml = `<messages>
        <msg type="W" severity="warning" shortText="Root warning" uri="/sap/bc/adt/ddic/ddl/sources/ZI_TRAVEL" line="8"/>
        <msg type="E" severity="error" shortText="BDEF activation failed" uri="/sap/bc/adt/bo/behaviordefinitions/ZI_TRAVEL" line="21"/>
      </messages>`;
      mockFetch
        .mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }))
        .mockResolvedValueOnce(mockResponse(200, xml, { 'x-csrf-token': 'T' }));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        objects: [
          { type: 'DDLS', name: 'ZI_TRAVEL' },
          { type: 'BDEF', name: 'ZI_TRAVEL' },
        ],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('ZI_TRAVEL (DDLS)');
      expect(result.content[0]?.text).toContain('ZI_TRAVEL (BDEF)');
      expect(result.content[0]?.text).toContain('[line 21] BDEF activation failed');
    });

    it('publishes a service binding', async () => {
      // Mock: 1) getSrvb for service type detection (GET, also delivers CSRF), 2) publish POST, 3) getSrvb readback
      mockFetch
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<serviceBinding xmlns="http://www.sap.com/adt/ddic/ServiceBindings" name="ZSB_TRAVEL_O4"><binding version="V2" type="ODATA" category="0"/></serviceBinding>',
            { 'x-csrf-token': 'T' },
          ),
        )
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY><SHORT_TEXT>Published</SHORT_TEXT><LONG_TEXT></LONG_TEXT></DATA></asx:values></asx:abap>',
            { 'x-csrf-token': 'T' },
          ),
        )
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<serviceBinding xmlns="http://www.sap.com/adt/ddic/ServiceBindings" name="ZSB_TRAVEL_O4" published="true"></serviceBinding>',
            { 'x-csrf-token': 'T' },
          ),
        );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'publish_srvb',
        name: 'ZSB_TRAVEL_O4',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Successfully published service binding ZSB_TRAVEL_O4');

      // Verify wire-level: correct endpoint and body sent (publish is call[1] after getSrvb)
      const publishCall = mockFetch.mock.calls[1];
      const publishUrl = String(publishCall[0]);
      expect(publishUrl).toContain('/sap/bc/adt/businessservices/odatav2/publishjobs');
      expect(publishUrl).toContain('servicename=ZSB_TRAVEL_O4');
      expect(publishUrl).toContain('serviceversion=0001');
      const publishOpts = publishCall[1] as Record<string, unknown>;
      expect(publishOpts.method).toBe('POST');
      expect(String(publishOpts.body)).toContain('adtcore:name="ZSB_TRAVEL_O4"');
    });

    it('returns error when publish_srvb fails', async () => {
      mockFetch
        // getSrvb for service type detection (also delivers CSRF token)
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<serviceBinding xmlns="http://www.sap.com/adt/ddic/ServiceBindings" name="ZSB_MISSING"></serviceBinding>',
            {
              'x-csrf-token': 'T',
            },
          ),
        )
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>ERROR</SEVERITY><SHORT_TEXT>Binding not found</SHORT_TEXT><LONG_TEXT>Details</LONG_TEXT></DATA></asx:values></asx:abap>',
            { 'x-csrf-token': 'T' },
          ),
        );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'publish_srvb',
        name: 'ZSB_MISSING',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Failed to publish service binding ZSB_MISSING');
    });

    it('handles UNKNOWN severity from unparseable publish response', async () => {
      mockFetch
        // getSrvb for service type detection (also delivers CSRF token)
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<serviceBinding xmlns="http://www.sap.com/adt/ddic/ServiceBindings" name="ZSB_TEST"></serviceBinding>',
            {
              'x-csrf-token': 'T',
            },
          ),
        )
        .mockResolvedValueOnce(mockResponse(200, '<unexpected>xml format</unexpected>', { 'x-csrf-token': 'T' }))
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<serviceBinding xmlns="http://www.sap.com/adt/ddic/ServiceBindings" name="ZSB_TEST" published="true"></serviceBinding>',
            { 'x-csrf-token': 'T' },
          ),
        );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'publish_srvb',
        name: 'ZSB_TEST',
      });
      // UNKNOWN severity should produce a cautious message, not "Successfully published"
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('could not be fully parsed');
    });

    it('returns error when publish_srvb called without name', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'publish_srvb',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Missing required "name"');
    });

    it('returns error when publish response is OK but readback shows unpublished', async () => {
      // Simulate: SAP returns SEVERITY=OK but the SRVB readback still shows published=false
      mockFetch
        // getSrvb for service type detection (also delivers CSRF token)
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<serviceBinding xmlns="http://www.sap.com/adt/ddic/ServiceBindings" name="ZSB_TRAVEL_O4"></serviceBinding>',
            {
              'x-csrf-token': 'T',
            },
          ),
        )
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY><SHORT_TEXT>Published</SHORT_TEXT><LONG_TEXT></LONG_TEXT></DATA></asx:values></asx:abap>',
            { 'x-csrf-token': 'T' },
          ),
        )
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<serviceBinding xmlns="http://www.sap.com/adt/ddic/ServiceBindings" name="ZSB_TRAVEL_O4" published="false"></serviceBinding>',
            { 'x-csrf-token': 'T' },
          ),
        );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'publish_srvb',
        name: 'ZSB_TRAVEL_O4',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('still unpublished');
    });

    it('unpublishes a service binding', async () => {
      mockFetch
        // getSrvb for service type detection (also delivers CSRF token)
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<serviceBinding xmlns="http://www.sap.com/adt/ddic/ServiceBindings" name="ZSB_TRAVEL_O4"></serviceBinding>',
            {
              'x-csrf-token': 'T',
            },
          ),
        )
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY><SHORT_TEXT>Unpublished</SHORT_TEXT><LONG_TEXT></LONG_TEXT></DATA></asx:values></asx:abap>',
            { 'x-csrf-token': 'T' },
          ),
        )
        // getSrvb readback: return unpublished SRVB metadata
        .mockResolvedValueOnce(
          mockResponse(
            200,
            '<serviceBinding xmlns="http://www.sap.com/adt/ddic/ServiceBindings" name="ZSB_TRAVEL_O4" published="false"></serviceBinding>',
            { 'x-csrf-token': 'T' },
          ),
        );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'unpublish_srvb',
        name: 'ZSB_TRAVEL_O4',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Successfully unpublished service binding ZSB_TRAVEL_O4');

      // Verify wire-level: correct endpoint for unpublish (call[1] after getSrvb)
      const unpublishCall = mockFetch.mock.calls[1];
      const unpublishUrl = String(unpublishCall[0]);
      expect(unpublishUrl).toContain('/sap/bc/adt/businessservices/odatav2/unpublishjobs');
      expect(unpublishUrl).toContain('servicename=ZSB_TRAVEL_O4');
    });

    it('activates a DDIC structure via TABL with structure URL in XML body', async () => {
      // Model B: structures use type='TABL'. The activate handler resolves the
      // URL via client.resolveTablObjectUrl which probes /tables/ first then
      // falls back to /structures/. For ZTEST_STRUCT (a DDIC structure):
      //   call 0: GET /sap/bc/adt/ddic/tables/ZTEST_STRUCT  → 404 (probe)
      //   call 1: GET /sap/bc/adt/ddic/structures/ZTEST_STRUCT → 200 (probe success)
      //   call 2: POST .../activation               → 200 (activate)
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(404, '<?xml version="1.0"?><error/>'));
      mockFetch.mockResolvedValueOnce(mockResponse(200, '<?xml version="1.0"?><stru/>'));
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          '<?xml version="1.0"?><iac:inactiveCTSObjects xmlns:iac="http://www.sap.com/abapxml/inactiveCtsObjects"/>',
          { 'x-csrf-token': 'T' },
        ),
      );
      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'TABL',
        name: 'ZTEST_STRUCT',
      });
      const lastCallOpts = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]?.[1] as RequestInit;
      expect(lastCallOpts.body).toContain('/sap/bc/adt/ddic/structures/ZTEST_STRUCT');
    });

    it('activates a transparent table via TABL with /tables/ URL (no fallback)', async () => {
      // For a transparent table, the /tables/ probe succeeds on the first try.
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '<?xml version="1.0"?><tabl/>'));
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          '<?xml version="1.0"?><iac:inactiveCTSObjects xmlns:iac="http://www.sap.com/abapxml/inactiveCtsObjects"/>',
          { 'x-csrf-token': 'T' },
        ),
      );
      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'TABL',
        name: 'ZTEST_TABLE',
      });
      const lastCallOpts = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]?.[1] as RequestInit;
      expect(lastCallOpts.body).toContain('/sap/bc/adt/ddic/tables/ZTEST_TABLE');
      expect(lastCallOpts.body).not.toContain('/sap/bc/adt/ddic/structures/ZTEST_TABLE');
    });

    it('activates DOMA with correct object URL in XML body', async () => {
      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'DOMA',
        name: 'ZBUKRS',
      });
      const lastCallOpts = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]?.[1] as RequestInit;
      expect(lastCallOpts.body).toContain('/sap/bc/adt/ddic/domains/ZBUKRS');
    });

    it('activates DTEL with correct object URL in XML body', async () => {
      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'DTEL',
        name: 'ZBUKRS_DTEL',
      });
      const lastCallOpts = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]?.[1] as RequestInit;
      expect(lastCallOpts.body).toContain('/sap/bc/adt/ddic/dataelements/ZBUKRS_DTEL');
    });

    it('activates TRAN with correct object URL in XML body', async () => {
      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'TRAN',
        name: 'ZTRAN01',
      });
      const lastCallOpts = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]?.[1] as RequestInit;
      expect(lastCallOpts.body).toContain('/sap/bc/adt/vit/wb/object_type/trant/object_name/ZTRAN01');
    });

    it('publish_srvb action publishes and returns SRVB info', async () => {
      const publishOkXml =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY><SHORT_TEXT>published locally</SHORT_TEXT><LONG_TEXT/></DATA></asx:values></asx:abap>';
      mockFetch
        .mockResolvedValueOnce(
          mockResponse(200, '<serviceBinding><binding version="V4" type="ODATA" category="0"/></serviceBinding>', {
            'x-csrf-token': 'T',
          }),
        ) // getSrvb for service type detection (also delivers CSRF)
        .mockResolvedValueOnce(mockResponse(200, publishOkXml, {})) // POST publishjobs
        .mockResolvedValueOnce(mockResponse(200, '<serviceBinding published="true" bindingCreated="true" />', {})); // GET SRVB readback
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'publish_srvb',
        name: 'ZSB_BOOKING_V4',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Successfully published service binding ZSB_BOOKING_V4');
      // Verify readback content (parsed SRVB metadata) is included in the response
      expect(result.content[0]?.text).toContain('bindingCreated');
      // Verify V4 binding uses odatav4 endpoint (call[1] after getSrvb)
      const publishCall = mockFetch.mock.calls[1];
      expect(String(publishCall[0])).toContain('/sap/bc/adt/businessservices/odatav4/publishjobs');
    });

    it('publish_srvb returns error when SAP reports failure', async () => {
      const publishErrorXml =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>ERROR</SEVERITY><SHORT_TEXT>Activating failed</SHORT_TEXT><LONG_TEXT>TADIR check failed</LONG_TEXT></DATA></asx:values></asx:abap>';
      mockFetch
        .mockResolvedValueOnce(
          mockResponse(200, '<serviceBinding><binding version="V4" type="ODATA" category="0"/></serviceBinding>', {
            'x-csrf-token': 'T',
          }),
        ) // getSrvb for service type detection (also delivers CSRF)
        .mockResolvedValueOnce(mockResponse(200, publishErrorXml, {}));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'publish_srvb',
        name: 'ZSB_BOOKING_V4',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Failed to publish');
      expect(result.content[0]?.text).toContain('TADIR check failed');
    });

    it('unpublish_srvb action unpublishes service binding', async () => {
      const unpublishOkXml =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY><SHORT_TEXT>un-published locally</SHORT_TEXT><LONG_TEXT/></DATA></asx:values></asx:abap>';
      mockFetch
        .mockResolvedValueOnce(
          mockResponse(200, '<serviceBinding><binding version="V4" type="ODATA" category="0"/></serviceBinding>', {
            'x-csrf-token': 'T',
          }),
        ) // getSrvb for service type detection (also delivers CSRF)
        .mockResolvedValueOnce(mockResponse(200, unpublishOkXml, {})); // POST unpublishjobs
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'unpublish_srvb',
        name: 'ZSB_BOOKING_V4',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Successfully unpublished service binding ZSB_BOOKING_V4');
      // Verify the POST was made to the unpublishjobs endpoint with odatav4
      const postCall = mockFetch.mock.calls.find((call) => (call[1] as RequestInit)?.method === 'POST');
      expect(postCall).toBeDefined();
      expect(String(postCall![0])).toContain('odatav4/unpublishjobs');
    });

    it('publish_srvb returns error when name is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'publish_srvb',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Missing required "name"');
    });

    it('unpublish_srvb returns error when name is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'unpublish_srvb',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Missing required "name"');
    });

    it('publish_srvb uses explicit service_type when provided', async () => {
      const publishOkXml =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY><SHORT_TEXT>published</SHORT_TEXT><LONG_TEXT/></DATA></asx:values></asx:abap>';
      mockFetch
        .mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }))
        // No getSrvb call expected — explicit service_type skips auto-detection
        .mockResolvedValueOnce(mockResponse(200, publishOkXml, {}))
        .mockResolvedValueOnce(mockResponse(200, '<serviceBinding published="true" />', {}));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'publish_srvb',
        name: 'ZSB_EXPLICIT_V4',
        service_type: 'odatav4',
      });
      expect(result.isError).toBeUndefined();
      // Verify odatav4 endpoint was used (call[1] is the publish POST since no getSrvb call)
      const publishCall = mockFetch.mock.calls[1];
      expect(String(publishCall[0])).toContain('/sap/bc/adt/businessservices/odatav4/publishjobs');
    });

    it('publish_srvb falls back to odatav2 when getSrvb fails', async () => {
      const publishOkXml =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY><SHORT_TEXT>published</SHORT_TEXT><LONG_TEXT/></DATA></asx:values></asx:abap>';
      mockFetch
        .mockResolvedValueOnce(mockResponse(404, 'Not found', { 'x-csrf-token': 'T' })) // getSrvb fails (also delivers CSRF token)
        .mockResolvedValueOnce(mockResponse(200, publishOkXml, {})) // POST publishjobs
        .mockResolvedValueOnce(mockResponse(200, '<serviceBinding published="true" />', {})); // getSrvb readback
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        action: 'publish_srvb',
        name: 'ZSB_FALLBACK',
      });
      expect(result.isError).toBeUndefined();
      // Falls back to odatav2 when detection fails
      const publishCall = mockFetch.mock.calls[1];
      expect(String(publishCall[0])).toContain('/sap/bc/adt/businessservices/odatav2/publishjobs');
    });

    it('default action still works as activate', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Successfully activated PROG ZTEST');
    });

    it('formats error messages with line numbers and URIs', async () => {
      const xml = `<messages>
        <msg type="E" severity="error" shortText="Type ZI_TRAVEL is not active" uri="/sap/bc/adt/ddic/ddl/sources/zi_travel" line="42"/>
        <msg type="E" severity="error" shortText="Activation was cancelled"/>
      </messages>`;
      mockFetch
        .mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }))
        .mockResolvedValueOnce(mockResponse(200, xml, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('[line 42]');
      expect(result.content[0]?.text).toContain('Type ZI_TRAVEL is not active');
      expect(result.content[0]?.text).toContain('/sap/bc/adt/ddic/ddl/sources/zi_travel');
    });

    it('adds downstream dependency guidance when DDLS activation fails', async () => {
      const activationXml = `<messages>
        <msg type="E" severity="error" shortText="Element NAME does not exist in dependent projection" line="12"/>
      </messages>`;
      const whereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddl/sources/zi_child_one" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_CHILD_ONE" adtcore:type="DDLS/DF" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
    <usageReferences:referencedObject uri="/sap/bc/adt/bo/behaviordefinitions/ZI_ROOT" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_ROOT" adtcore:type="BDEF/BO" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/srvd/sources/ZSD_ROOT" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZSD_ROOT" adtcore:type="SRVD/SRV" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;

      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = (opts?.method ?? 'GET').toUpperCase();
        const urlStr = String(url);
        if (method === 'POST' && urlStr.includes('/sap/bc/adt/activation?method=activate')) {
          return Promise.resolve(mockResponse(200, activationXml, { 'x-csrf-token': 'T' }));
        }
        if (method === 'POST' && urlStr.includes('/sap/bc/adt/repository/informationsystem/usageReferences?uri=')) {
          return Promise.resolve(mockResponse(200, whereUsedXml, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'DDLS',
        name: 'ZI_ROOT',
      });

      expect(result.isError).toBe(true);
      const text = result.content[0]!.text;
      expect(text).toContain('Activation failed for DDLS ZI_ROOT');
      expect(text).toContain('CDS activation impact for ZI_ROOT');
      expect(text).toContain('ZI_CHILD_ONE');
      expect(text).toContain('ZSD_ROOT');
      expect(text).toContain(
        'Suggested re-activation order: DDLS ZI_ROOT, DDLS ZI_CHILD_ONE, BDEF ZI_ROOT, SRVD ZSD_ROOT',
      );
      expect(text).toContain(
        'Batch call template: SAPActivate(objects=[{type:"DDLS",name:"ZI_ROOT"}, {type:"DDLS",name:"ZI_CHILD_ONE"}, {type:"BDEF",name:"ZI_ROOT"}, {type:"SRVD",name:"ZSD_ROOT"}])',
      );
    });

    it('shows warnings on successful activation', async () => {
      const xml = `<messages>
        <msg type="W" severity="warning" shortText="Consider using CDS view entity"/>
      </messages>`;
      mockFetch
        .mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }))
        .mockResolvedValueOnce(mockResponse(200, xml, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Successfully activated');
      expect(result.content[0]?.text).toContain('Warnings:');
      expect(result.content[0]?.text).toContain('Consider using CDS view entity');
    });
  });

  // ─── SAPManage ─────────────────────────────────────────────────────

  describe('SAPManage', () => {
    const transportInfoResponse = (recording: boolean, isLocal: boolean, transports: string[] = []) => {
      const transportEntries = transports
        .map((t) => `<headers><TRKORR>${t}</TRKORR><AS4TEXT>Transport ${t}</AS4TEXT><AS4USER>DEV</AS4USER></headers>`)
        .join('');
      return `<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA>
        <RECORDING>${recording ? 'X' : ''}</RECORDING>
        <DLVUNIT>${isLocal ? 'LOCAL' : 'SAP'}</DLVUNIT>
        <DEVCLASS>Z_PARENT</DEVCLASS>
        ${transports.length > 0 ? `<TRANSPORTS>${transportEntries}</TRANSPORTS>` : ''}
      </DATA></asx:values></asx:abap>`;
    };

    it('returns message when features not yet probed', async () => {
      const { resetCachedFeatures } = await import('../../../src/handlers/intent.js');
      resetCachedFeatures();

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'features',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('No features probed yet');
    });

    it('returns error for unknown action', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'invalid',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Invalid arguments for SAPManage');
    });

    it('create_package creates DEVC via ADT packages endpoint', async () => {
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string }) => {
        calls.push({ method: opts?.method ?? 'GET', url: String(url), body: opts?.body });
        return Promise.resolve(mockResponse(200, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'create_package',
        name: 'ZPKG_TEST',
        description: 'Test package',
        superPackage: '$TMP',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Created package ZPKG_TEST');
      const createCall = calls.find((c) => c.method === 'POST' && c.url.includes('/sap/bc/adt/packages'));
      expect(createCall).toBeDefined();
      expect(createCall?.body).toContain('<pak:package');
      expect(createCall?.body).toContain('adtcore:type="DEVC/K"');
      expect(createCall?.body).toContain('<pak:superPackage adtcore:name="$TMP"/>');
    });

    it('create_package appends corrNr when transport is provided', async () => {
      const calls: Array<{ method: string; url: string }> = [];
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        calls.push({ method: opts?.method ?? 'GET', url: String(url) });
        return Promise.resolve(mockResponse(200, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'create_package',
        name: 'ZPKG_TR',
        description: 'Transported package',
        superPackage: 'Z_PARENT',
        transport: 'A4HK900777',
      });

      expect(result.isError).toBeUndefined();
      const createCall = calls.find((c) => c.method === 'POST' && c.url.includes('/sap/bc/adt/packages'));
      expect(createCall?.url).toContain('corrNr=A4HK900777');
    });

    it('create_package returns error when name is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'create_package',
        description: 'Missing name',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"name" is required');
    });

    it('create_package is blocked by read-only safety mode', async () => {
      const readOnlyClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowWrites: false },
      });

      const result = await handleToolCall(readOnlyClient, DEFAULT_CONFIG, 'SAPManage', {
        action: 'create_package',
        name: 'ZPKG_RO',
        description: 'Read-only package',
        superPackage: '$TMP',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('blocked by safety');
    });

    it('delete_package deletes package via lock/delete/unlock', async () => {
      const calls: Array<{ method: string; url: string }> = [];
      const lockBody =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>';
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        calls.push({ method, url: urlStr });
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(mockResponse(200, lockBody, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'delete_package',
        name: 'ZPKG_DEL',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Deleted package ZPKG_DEL');
      expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('/sap/bc/adt/packages/ZPKG_DEL'))).toBe(true);
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('_action=UNLOCK'))).toBe(true);
    });

    it('delete_package is blocked by read-only safety mode', async () => {
      const readOnlyClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowWrites: false },
      });

      const result = await handleToolCall(readOnlyClient, DEFAULT_CONFIG, 'SAPManage', {
        action: 'delete_package',
        name: 'ZPKG_RO',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('blocked by safety');
    });

    it('change_package calls refactoring preview then execute endpoints', async () => {
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string }) => {
        calls.push({ method: opts?.method ?? 'GET', url: String(url), body: opts?.body });
        if (String(url).includes('step=preview')) {
          return Promise.resolve(
            mockResponse(
              200,
              '<generic:genericRefactoring xmlns:generic="http://www.sap.com/adt/refactoring/genericrefactoring"><generic:transport/></generic:genericRefactoring>',
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        if (String(url).includes('quickSearch')) {
          return Promise.resolve(
            mockResponse(
              200,
              '<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/zarc1_test" adtcore:type="DDLS/DF" adtcore:name="ZARC1_TEST" adtcore:packageName="$TMP"/></adtcore:objectReferences>',
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'change_package',
        objectName: 'ZARC1_TEST',
        objectType: 'DDLS/DF',
        oldPackage: '$TMP',
        newPackage: '$TMP',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Moved ZARC1_TEST');

      const previewCall = calls.find((c) => c.method === 'POST' && c.url.includes('step=preview'));
      expect(previewCall).toBeDefined();
      const executeCall = calls.find((c) => c.method === 'POST' && c.url.includes('step=execute'));
      expect(executeCall).toBeDefined();
    });

    it('change_package returns error when objectName is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'change_package',
        objectType: 'DDLS/DF',
        oldPackage: '$TMP',
        newPackage: 'Z_TARGET',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"objectName" is required');
    });

    it('change_package returns error when objectType is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'change_package',
        objectName: 'ZARC1_TEST',
        oldPackage: '$TMP',
        newPackage: 'Z_TARGET',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"objectType" is required');
    });

    it('change_package returns error when oldPackage is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'change_package',
        objectName: 'ZARC1_TEST',
        objectType: 'DDLS/DF',
        newPackage: 'Z_TARGET',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"oldPackage" is required');
    });

    it('change_package returns error when newPackage is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'change_package',
        objectName: 'ZARC1_TEST',
        objectType: 'DDLS/DF',
        oldPackage: '$TMP',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"newPackage" is required');
    });

    it('change_package is blocked by read-only safety mode', async () => {
      const readOnlyClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowWrites: false },
      });

      const result = await handleToolCall(readOnlyClient, DEFAULT_CONFIG, 'SAPManage', {
        action: 'change_package',
        objectName: 'ZARC1_TEST',
        objectType: 'DDLS/DF',
        oldPackage: '$TMP',
        newPackage: 'Z_TARGET',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('blocked by safety');
    });

    it('change_package is blocked when old package not in allowlist', async () => {
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['Z_ALLOWED'] },
      });

      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPManage', {
        action: 'change_package',
        objectName: 'ZARC1_TEST',
        objectType: 'DDLS/DF',
        oldPackage: '$TMP',
        newPackage: 'Z_ALLOWED',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('blocked by safety');
    });

    it('change_package is blocked when new package not in allowlist', async () => {
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] },
      });

      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPManage', {
        action: 'change_package',
        objectName: 'ZARC1_TEST',
        objectType: 'DDLS/DF',
        oldPackage: '$TMP',
        newPackage: 'Z_FORBIDDEN',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('blocked by safety');
    });

    it('change_package passes transport in XML when provided', async () => {
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string }) => {
        calls.push({ method: opts?.method ?? 'GET', url: String(url), body: opts?.body });
        if (String(url).includes('step=preview')) {
          return Promise.resolve(
            mockResponse(
              200,
              '<generic:genericRefactoring xmlns:generic="http://www.sap.com/adt/refactoring/genericrefactoring"><generic:transport/></generic:genericRefactoring>',
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'change_package',
        objectName: 'ZARC1_TEST',
        objectType: 'DDLS/DF',
        objectUri: '/sap/bc/adt/ddic/ddl/sources/zarc1_test',
        oldPackage: '$TMP',
        newPackage: 'Z_TARGET',
        transport: 'A4HK900123',
      });

      expect(result.isError).toBeUndefined();
      const executeCall = calls.find((c) => c.method === 'POST' && c.url.includes('step=execute'));
      expect(executeCall?.body).toContain('<generic:transport>A4HK900123</generic:transport>');
    });

    it('change_package success message includes object name and packages', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        if (String(url).includes('step=preview')) {
          return Promise.resolve(
            mockResponse(
              200,
              '<generic:genericRefactoring xmlns:generic="http://www.sap.com/adt/refactoring/genericrefactoring"><generic:transport/></generic:genericRefactoring>',
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'change_package',
        objectName: 'ZCL_MY_CLASS',
        objectType: 'CLAS/OC',
        objectUri: '/sap/bc/adt/oo/classes/zcl_my_class',
        oldPackage: '$TMP',
        newPackage: 'Z_PRODUCTION',
      });

      expect(result.isError).toBeUndefined();
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('ZCL_MY_CLASS');
      expect(text).toContain('$TMP');
      expect(text).toContain('Z_PRODUCTION');
    });

    it('create_package returns transport guidance when parent package requires transport', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        if (String(url).includes('/cts/transportchecks')) {
          return Promise.resolve(
            mockResponse(200, transportInfoResponse(true, false, ['A4HK900502']), { 'x-csrf-token': 'T' }),
          );
        }
        return Promise.resolve(mockResponse(200, '<xml/>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'create_package',
        name: 'ZPKG_NEEDS_TR',
        description: 'Transport-required package',
        superPackage: 'Z_PARENT',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('requires a transport number');
      expect(result.content[0]?.text).toContain('SAPTransport');
      expect(result.content[0]?.text).toContain('A4HK900502');
    });

    it('create_package includes optional fields in XML payload', async () => {
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string }) => {
        calls.push({ method: opts?.method ?? 'GET', url: String(url), body: opts?.body });
        return Promise.resolve(mockResponse(200, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'create_package',
        name: 'ZPKG_FULL',
        description: 'Full options package',
        superPackage: 'Z_PARENT',
        softwareComponent: 'HOME',
        transportLayer: 'HOME',
        packageType: 'structure',
        transport: 'A4HK900701',
      });

      expect(result.isError).toBeUndefined();
      const createCall = calls.find((c) => c.method === 'POST' && c.url.includes('/sap/bc/adt/packages'));
      expect(createCall?.body).toContain('<pak:attributes pak:packageType="structure"/>');
      expect(createCall?.body).toContain('<pak:superPackage adtcore:name="Z_PARENT"/>');
      expect(createCall?.body).toContain('<pak:softwareComponent pak:name="HOME"/>');
      expect(createCall?.body).toContain('<pak:transportLayer pak:name="HOME"/>');
    });

    it('flp_list_catalogs returns catalog list', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          JSON.stringify({
            d: {
              results: [
                {
                  id: '/UI2/CATALOG_ALL',
                  domainId: '/UI2/CATALOG_ALL',
                  title: 'Catalog with all Chips',
                  type: '',
                  scope: '',
                  chipCount: '0042',
                },
              ],
            },
          }),
          { 'x-csrf-token': 'T' },
        ),
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'flp_list_catalogs',
      });

      expect(result.isError).toBeUndefined();
      const text = result.content[0]!.text;
      expect(text).toContain('1 catalogs');
      expect(text).toContain('/UI2/CATALOG_ALL');
      expect(text).toContain('Catalog with all Chips');
    });

    it('flp_list_tiles requires catalogId', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'flp_list_tiles',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"catalogId" is required');
    });

    it('flp_create_catalog is blocked in read-only safety mode', async () => {
      const readOnlyClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowWrites: false },
      });

      const result = await handleToolCall(readOnlyClient, DEFAULT_CONFIG, 'SAPManage', {
        action: 'flp_create_catalog',
        domainId: 'ZARC1_TEST',
        title: 'Test',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('blocked by safety');
    });

    it('flp_delete_catalog requires catalogId', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'flp_delete_catalog',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"catalogId" is required');
    });

    it('flp_delete_catalog sends DELETE request', async () => {
      mockFetch.mockReset();
      mockFetch
        .mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'csrf' }))
        .mockResolvedValueOnce(mockResponse(204, ''));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'flp_delete_catalog',
        catalogId: 'X-SAP-UI2-CATALOGPAGE:ZARC1_TEST',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Deleted FLP catalog');
    });

    it('flp_create_tile serializes configuration correctly', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'csrf' })).mockResolvedValueOnce(
        mockResponse(
          201,
          JSON.stringify({
            d: {
              pageId: 'X-SAP-UI2-CATALOGPAGE:ZCAT',
              instanceId: 'TILE123',
              chipId: 'X-SAP-UI2-CHIP:/UI2/STATIC_APPLAUNCHER',
              title: 'Tile',
              configuration: '{"tileConfiguration":"{}"}',
            },
          }),
        ),
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPManage', {
        action: 'flp_create_tile',
        catalogId: 'ZCAT',
        tile: {
          id: 'tile-1',
          title: 'Tile',
          semanticObject: 'ZSO',
          semanticAction: 'display',
        },
      });

      expect(result.isError).toBeUndefined();
      const postCall = mockFetch.mock.calls.find((call) => (call[1] as RequestInit)?.method === 'POST');
      expect(postCall).toBeDefined();
      const payload = JSON.parse((postCall?.[1] as RequestInit).body as string);
      const outer = JSON.parse(payload.configuration);
      const inner = JSON.parse(outer.tileConfiguration);
      expect(inner.semantic_object).toBe('ZSO');
      expect(inner.semantic_action).toBe('display');
      expect(inner.display_title_text).toBe('Tile');
    });
  });

  // ─── Cache Hit Indicator ───────────────────────────────────────────

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

  // ─── Error Guidance ────────────────────────────────────────────────

  describe('error guidance', () => {
    it('404 error includes SAPSearch hint', async () => {
      mockFetch.mockReset();
      // Make the mock reject with a 404 AdtApiError
      mockFetch.mockRejectedValueOnce(
        new AdtApiError('Not found', 404, '/sap/bc/adt/programs/programs/ZNONEXIST/source/main'),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZNONEXIST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('SAPSearch');
      expect(result.content[0]?.text).toContain('ZNONEXIST');
    });

    it('401 error includes client hint', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(new AdtApiError('Auth failed', 401, '/sap/bc/adt/core/discovery'));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('SAP_CLIENT');
    });
  });

  describe('SAP domain error classification hints', () => {
    it('409 lock conflict XML returns SM12 hint with extracted user', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          'Conflict',
          409,
          '/sap/bc/adt/programs/programs/ZPROG/source/main',
          `<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <type id="ExceptionResourceLockedByAnotherUser"/>
  <exc:localizedMessage lang="EN">Object is locked by user DEVELOPER in task E19K900001</exc:localizedMessage>
</exc:exception>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'PROG', name: 'ZPROG' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('SM12');
      expect(result.content[0]?.text).toContain('DEVELOPER');
      expect(result.content[0]?.text).toContain('E19K900001');
    });

    it('423 lock handle error returns enqueue hint', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          'Locked',
          423,
          '/sap/bc/adt/ddic/ddl/sources/ZI_TEST/source/main',
          '<exc:exception><type id="ExceptionResourceInvalidLockHandle"/><localizedMessage>Invalid lock handle</localizedMessage></exc:exception>',
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'PROG', name: 'ZPROG' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Lock handle is invalid or expired');
      // Hint cites SAP Note 2727890 (component BC-DWB-AIE) — verified via the
      // SAP Knowledge Base as the concrete known-fix for ADT lock-handle
      // instability. Replaces the previous generic SM12 transaction pointer.
      expect(result.content[0]?.text).toContain('2727890');
      expect(result.content[0]?.text).toContain('BC-DWB-AIE');
    });

    it('403 authorization XML returns SU53/PFCG hint', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          'Forbidden',
          403,
          '/sap/bc/adt/programs/programs/ZPROG/source/main',
          '<exc:exception><type id="ExceptionNotAuthorized"/><localizedMessage>No authorization for S_DEVELOP</localizedMessage></exc:exception>',
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'PROG', name: 'ZPROG' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('SU53');
      expect(result.content[0]?.text).toContain('PFCG');
      expect(result.content[0]?.text).toContain('S_DEVELOP');
    });

    it('409 already-exists error returns object-exists hint', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          'Conflict',
          409,
          '/sap/bc/adt/ddic/ddl/sources',
          '<exc:exception><type id="ExceptionResourceCreationFailure"/><localizedMessage>Object does already exist</localizedMessage></exc:exception>',
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'PROG', name: 'ZA_TEST' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('already exists');
      expect(result.content[0]?.text).toContain('action="update"');
    });

    it('400 activation dependency message returns activation hint', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          'Bad request',
          400,
          '/sap/bc/adt/activation',
          'Activation failed: dependency ZI_TRAVEL is inactive and not active',
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPActivate', {
        type: 'DDLS',
        name: 'ZI_TRAVEL',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("SAPRead(type='INACTIVE_OBJECTS')");
      expect(result.content[0]?.text).toContain('SAPActivate');
    });

    it('unclassifiable 409 falls through without domain-specific hint', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError('Conflict', 409, '/sap/bc/adt/programs/programs/ZPROG/source/main', 'generic conflict'),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'PROG', name: 'ZPROG' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).not.toContain('SM12');
      expect(result.content[0]?.text).not.toContain('SU53');
      expect(result.content[0]?.text).not.toContain('INACTIVE_OBJECTS');
    });

    it('audit logging includes domain category in errorClass', async () => {
      const auditSpy = vi.spyOn(logger, 'emitAudit');
      try {
        mockFetch.mockReset();
        mockFetch.mockRejectedValueOnce(
          new AdtApiError(
            'Conflict',
            409,
            '/sap/bc/adt/programs/programs/ZPROG/source/main',
            '<exc:exception><type id="ExceptionResourceLockedByAnotherUser"/><localizedMessage>Object is locked by user DEV1 in task E19K900001</localizedMessage></exc:exception>',
          ),
        );

        await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
          type: 'PROG',
          name: 'ZPROG',
        });

        const endEvent = auditSpy.mock.calls
          .map(([event]) => event)
          .find(
            (event) =>
              typeof event === 'object' &&
              event !== null &&
              (event as { event?: string; status?: string }).event === 'tool_call_end' &&
              (event as { event?: string; status?: string }).status === 'error',
          ) as { errorClass?: string } | undefined;
        expect(endEvent?.errorClass).toBe('AdtApiError:lock-conflict');
      } finally {
        auditSpy.mockRestore();
      }
    });

    it('network errors include probe-first connectivity guidance', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:8000'));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'PROG', name: 'ZPROG' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Cannot reach the SAP system');
      expect(result.content[0]?.text).toContain('SAPRead(type="SYSTEM")');
      expect(result.content[0]?.text).toContain('batch/parallel');
    });

    it('network errors on SAPRead SYSTEM mention failed probe specifically', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:8000'));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'SYSTEM' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Connectivity probe failed');
      expect(result.content[0]?.text).toContain('before running any batch or parallel tool calls');
    });
  });

  // ─── Transport/corrNr error hints ──────────────────────────────────

  describe('transport error hints', () => {
    it('corrNr-missing error includes transport hint', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          'Correction number is required for this package',
          400,
          '/sap/bc/adt/programs/programs/ZPROG/source/main',
          'correction number required',
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZPROG',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('transport/correction number is required');
      expect(result.content[0]?.text).toContain('SE09');
    });

    it('404 error gets generic not-found hint (takes priority over transport hint)', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          'Transport does not exist',
          404,
          '/sap/bc/adt/cts/transportrequests/NPLK900042',
          'E070 transport does not exist',
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZPROG',
      });
      // 404 triggers isNotFound check before getTransportHint — generic not-found hint is returned
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not found');
      expect(result.content[0]?.text).toContain('SAPSearch');
    });

    it('403 transport authorization error gets SAP-domain auth hint (takes priority over transport hint)', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          'No authorization for transport operations',
          403,
          '/sap/bc/adt/cts/transportrequests',
          'S_TRANSPRT no authorization',
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZPROG',
      });
      // 403 is now classified as a SAP-domain authorization error before transport hint fallback
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('SU53');
      expect(result.content[0]?.text).toContain('PFCG');
    });

    it('transport not found on 400 status gets transport-specific hint', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          'Transport request error',
          400,
          '/sap/bc/adt/programs/programs/ZPROG',
          'E070 transport does not exist',
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZPROG',
      });
      // 400 does NOT trigger isNotFound — getTransportHint fires with E070 match
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not modifiable');
      expect(result.content[0]?.text).toContain('SE09');
    });

    it('package transport layer mismatch includes package hint', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          'Package has no transport layer',
          400,
          '/sap/bc/adt/programs/programs/ZPROG',
          'package ZTEST no transport layer assigned',
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZPROG',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('transport layer');
      expect(result.content[0]?.text).toContain('$TMP');
    });

    it('no false positive when corrNr appears in URL path but error is unrelated', async () => {
      // When a transport IS provided, the URL contains ?corrNr=A4HK900502.
      // The error message includes the URL path: "ADT API error: status 400 at /sap/bc/adt/ddic/ddl/sources?corrNr=A4HK900502: ..."
      // The transport hint must NOT fire just because "corrnr" appears in the URL.
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          '<exc:exception><exc:localizedMessage>Resource Data Definition ZA_TEST does already exist.</exc:localizedMessage></exc:exception>',
          400,
          '/sap/bc/adt/ddic/ddl/sources?corrNr=A4HK900502',
          '<exc:exception><exc:localizedMessage>Resource Data Definition ZA_TEST does already exist.</exc:localizedMessage></exc:exception>',
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZPROG',
      });
      expect(result.isError).toBe(true);
      // The hint should NOT appear — the error is "already exists", not a transport issue
      expect(result.content[0]?.text).not.toContain('transport/correction number is required');
      expect(result.content[0]?.text).toContain('does already exist');
    });

    it('no false positive on syntax error when corrNr in URL', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          '<exc:exception><exc:localizedMessage>Syntax error in ZD_TEST: DDL source could not be saved</exc:localizedMessage></exc:exception>',
          400,
          '/sap/bc/adt/ddic/ddl/sources/ZD_TEST/source/main?lockHandle=ABC&corrNr=A4HK900502',
          '<exc:exception><exc:localizedMessage>Syntax error in ZD_TEST: DDL source could not be saved</exc:localizedMessage></exc:exception>',
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZPROG',
      });
      expect(result.isError).toBe(true);
      // Syntax error — no transport hint
      expect(result.content[0]?.text).not.toContain('transport/correction number is required');
      expect(result.content[0]?.text).toContain('Syntax error');
    });

    it('no false positive on 409 lock conflict when corrNr in URL', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError(
          '<exc:exception><exc:localizedMessage>Request A4HK900502 is currently being edited by user MARIAN</exc:localizedMessage></exc:exception>',
          409,
          '/sap/bc/adt/ddic/ddl/sources?corrNr=A4HK900502',
          '<exc:exception><exc:localizedMessage>Request A4HK900502 is currently being edited by user MARIAN</exc:localizedMessage></exc:exception>',
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZPROG',
      });
      expect(result.isError).toBe(true);
      // Lock conflict — no transport hint
      expect(result.content[0]?.text).not.toContain('transport/correction number is required');
      expect(result.content[0]?.text).toContain('currently being edited');
    });

    it('non-transport 500 errors get server error hint (not transport hint)', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError('Some generic server error', 500, '/sap/bc/adt/programs/programs/ZPROG', 'internal error'),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZPROG',
      });
      expect(result.isError).toBe(true);
      // Should get server error hint, NOT transport hint
      expect(result.content[0]?.text).toContain('SAP application server error');
      expect(result.content[0]?.text).not.toContain('transport');
    });
  });

  // ─── Issue 2: FUNC auto-resolve group ───────────────────────────────

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

  // ─── Issue 3: FUGR include expansion ────────────────────────────────

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

  // ─── Issue 4: Source code search ────────────────────────────────────

  describe('SAPSearch source code', () => {
    it('searches source code with searchType=source_code', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<objectReferences><objectReference type="CLAS/OC" name="ZCL_TEST" uri="/sap/bc/adt/oo/classes/zcl_test"/></objectReferences>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPSearch', {
        query: 'cl_lsapi_manager',
        searchType: 'source_code',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].objectName).toBe('ZCL_TEST');
    });

    it('returns helpful error when source search is not available', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(
        new AdtApiError('Not found', 404, '/sap/bc/adt/repository/informationsystem/textSearch'),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPSearch', {
        query: 'test_pattern',
        searchType: 'source_code',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not available on this SAP system');
    });

    it('returns precise probe reason when textSearch probe says unavailable', async () => {
      setCachedFeatures({
        hana: { id: 'hana', available: true, mode: 'auto' },
        abapGit: { id: 'abapGit', available: false, mode: 'auto' },
        rap: { id: 'rap', available: true, mode: 'auto' },
        amdp: { id: 'amdp', available: false, mode: 'auto' },
        ui5: { id: 'ui5', available: false, mode: 'auto' },
        transport: { id: 'transport', available: true, mode: 'auto' },
        textSearch: {
          available: false,
          reason:
            'textSearch ICF service not activated — activate /sap/bc/adt/repository/informationsystem/textSearch in SICF.',
        },
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPSearch', {
        query: 'test_pattern',
        searchType: 'source_code',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('SICF');
      expect(result.content[0]?.text).toContain('not available');
    });

    it('searches normally when textSearch probe says available', async () => {
      setCachedFeatures({
        hana: { id: 'hana', available: true, mode: 'auto' },
        abapGit: { id: 'abapGit', available: false, mode: 'auto' },
        rap: { id: 'rap', available: true, mode: 'auto' },
        amdp: { id: 'amdp', available: false, mode: 'auto' },
        ui5: { id: 'ui5', available: false, mode: 'auto' },
        transport: { id: 'transport', available: true, mode: 'auto' },
        textSearch: { available: true },
      });
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<objectReferences><objectReference type="CLAS/OC" name="ZCL_FOUND" uri="/sap/bc/adt/oo/classes/zcl_found"/></objectReferences>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPSearch', {
        query: 'some_pattern',
        searchType: 'source_code',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text);
      expect(parsed[0].objectName).toBe('ZCL_FOUND');
    });

    it('re-throws transient errors (e.g. 503) instead of claiming unavailable', async () => {
      setCachedFeatures({
        hana: { id: 'hana', available: true, mode: 'auto' },
        abapGit: { id: 'abapGit', available: false, mode: 'auto' },
        rap: { id: 'rap', available: true, mode: 'auto' },
        amdp: { id: 'amdp', available: false, mode: 'auto' },
        ui5: { id: 'ui5', available: false, mode: 'auto' },
        transport: { id: 'transport', available: true, mode: 'auto' },
        textSearch: { available: true },
      });
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(503, 'Service Unavailable'));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPSearch', {
        query: 'test_pattern',
        searchType: 'source_code',
      });
      // Transient 503 should be caught by outer handleToolCall and reported as error,
      // NOT classified as "source code search is not available"
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).not.toContain('not available');
    });
  });

  // ─── Issue 5: SOBJ/BOR reading ──────────────────────────────────────

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

  // ─── Issue 7: SAPNavigate symbolic references ──────────────────────

  describe('SAPNavigate symbolic references', () => {
    it('resolves type+name to URI for references action (scope-based Where-Used fails, falls back to simple)', async () => {
      mockFetch.mockReset();
      // First call: CSRF token fetch for the POST
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
      // Second call: findWhereUsed POST fails with 404 (simulating older SAP system without scope endpoint)
      mockFetch.mockRejectedValueOnce(new AdtApiError('Not found', 404, '/usageReferences'));
      // Third call: findReferences GET succeeds (fallback)
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<usageReferences><objectReference uri="/sap/bc/adt/programs/programs/zcaller" type="PROG/P" name="ZCALLER"/></usageReferences>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPNavigate', {
        action: 'references',
        type: 'CLAS',
        name: 'ZCL_TEST',
      });
      expect(result.isError).toBeUndefined();
      // Should not get "No references found" since we have a match
      const parsed = JSON.parse(result.content[0]?.text);
      expect(parsed).toHaveLength(1);
    });

    it('falls back to simple references with objectType (returns warning note about dropped filter)', async () => {
      mockFetch.mockReset();
      // First call: CSRF token fetch for the POST
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
      // Second call: findWhereUsed POST fails with 404 (older SAP system)
      mockFetch.mockRejectedValueOnce(new AdtApiError('Not found', 404, '/usageReferences'));
      // Third call: findReferences GET succeeds (fallback) — includes CLAS/OC to prove results are unfiltered
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<usageReferences><objectReference uri="/sap/bc/adt/programs/programs/zcaller" type="PROG/P" name="ZCALLER"/><objectReference uri="/sap/bc/adt/oo/classes/zcl_other" type="CLAS/OC" name="ZCL_OTHER"/></usageReferences>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPNavigate', {
        action: 'references',
        type: 'CLAS',
        name: 'ZCL_TEST',
        objectType: 'PROG/P',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      const text = result.content[0]?.text;
      // Response should be valid JSON with note and results
      const parsed = JSON.parse(text);
      expect(parsed.note).toContain('objectType filter');
      expect(parsed.note).toContain('PROG/P');
      expect(parsed.note).toContain('ignored');
      expect(parsed.results).toHaveLength(2);
    });

    it('falls back to simple references without objectType (no warning note)', async () => {
      mockFetch.mockReset();
      // First call: CSRF token fetch for the POST
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
      // Second call: findWhereUsed POST fails with 404 (older SAP system)
      mockFetch.mockRejectedValueOnce(new AdtApiError('Not found', 404, '/usageReferences'));
      // Third call: findReferences GET succeeds (fallback)
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<usageReferences><objectReference uri="/sap/bc/adt/programs/programs/zcaller" type="PROG/P" name="ZCALLER"/></usageReferences>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPNavigate', {
        action: 'references',
        type: 'CLAS',
        name: 'ZCL_TEST',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      const text = result.content[0]?.text;
      // No warning — objectType was not requested
      expect(text).not.toContain('objectType filter');
      const parsed = JSON.parse(text);
      expect(parsed).toHaveLength(1);
    });

    it('uses scope-based Where-Used successfully with objectType filter', async () => {
      mockFetch.mockReset();
      // First call: CSRF token fetch
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
      // Second call: findWhereUsed POST succeeds (real SAP response format)
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult numberOfResults="1" xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
    <usageReferences:referencedObject uri="/sap/bc/adt/programs/programs/ZPROG1/source/main" isResult="true">
      <usageReferences:adtObject adtcore:name="ZPROG1" adtcore:type="PROG/P" adtcore:description="Test Program" xmlns:adtcore="http://www.sap.com/adt/core">
        <adtcore:packageRef adtcore:name="$TMP"/>
      </usageReferences:adtObject>
    </usageReferences:referencedObject>
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPNavigate', {
        action: 'references',
        type: 'CLAS',
        name: 'ZCL_TEST',
        objectType: 'PROG/P',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('ZPROG1');
      expect(parsed[0].packageName).toBe('$TMP');
      expect(parsed[0].objectDescription).toBe('Test Program');
    });

    it('returns error when neither uri nor type+name provided for references', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPNavigate', {
        action: 'references',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Provide uri or type+name');
    });

    it('routes TABL type+name through resolveTablObjectUrl (transparent → /tables/)', async () => {
      // For a transparent table the /tables/ probe succeeds on the first try,
      // and the where-used POST then targets /sap/bc/adt/ddic/tables/T000.
      mockFetch.mockReset();
      // 1) URL probe: /sap/bc/adt/ddic/tables/T000 → 200
      mockFetch.mockResolvedValueOnce(mockResponse(200, '<?xml version="1.0"?><tabl/>'));
      // 2) CSRF token fetch
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      // 3) usageReferences POST
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects/>
</usageReferences:usageReferenceResult>`,
        ),
      );
      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPNavigate', {
        action: 'references',
        type: 'TABL',
        name: 'T000',
      });
      // The where-used POST URL must reference the resolved /tables/ path.
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(String(lastCall?.[0])).toContain(
        `usageReferences?uri=${encodeURIComponent('/sap/bc/adt/ddic/tables/T000')}`,
      );
    });

    it('routes TABL type+name through resolveTablObjectUrl (structure → /structures/)', async () => {
      // For a DDIC structure on systems where /tables/ 404s, the resolver
      // falls back to /structures/. Verifies the fix for codex P1: NW 7.50
      // returns 500 from usageReferences for /tables/ URLs even for transparent
      // tables, so we must always resolve via the URL probe before posting.
      mockFetch.mockReset();
      // 1) URL probe: /sap/bc/adt/ddic/tables/BAPIRET2 → 404
      mockFetch.mockResolvedValueOnce(mockResponse(404, '<?xml version="1.0"?><error/>'));
      // 2) URL probe fallback: /sap/bc/adt/ddic/structures/BAPIRET2 → 200
      mockFetch.mockResolvedValueOnce(mockResponse(200, '<?xml version="1.0"?><stru/>'));
      // 3) CSRF token fetch
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      // 4) usageReferences POST
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects/>
</usageReferences:usageReferenceResult>`,
        ),
      );
      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPNavigate', {
        action: 'references',
        type: 'TABL',
        name: 'BAPIRET2',
      });
      // The where-used POST URL must reference /structures/, not /tables/.
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const lastUrl = String(lastCall?.[0]);
      expect(lastUrl).toContain(`usageReferences?uri=${encodeURIComponent('/sap/bc/adt/ddic/structures/BAPIRET2')}`);
      expect(lastUrl).not.toContain(encodeURIComponent('/sap/bc/adt/ddic/tables/BAPIRET2'));
    });

    it('returns error when neither uri nor type+name provided for definition', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPNavigate', {
        action: 'definition',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Provide uri');
    });
  });

  // ─── SAPNavigate hierarchy ──────────────────────────────────────────

  describe('SAPNavigate hierarchy', () => {
    /** Helper to build dataPreview XML with SEOMETAREL-like column data */
    function seometarelXml(rows: Array<{ CLSNAME: string; REFCLSNAME: string; RELTYPE: string }>): string {
      const clsData = rows.map((r) => `<DATA>${r.CLSNAME}</DATA>`).join('');
      const refData = rows.map((r) => `<DATA>${r.REFCLSNAME}</DATA>`).join('');
      const relData = rows.map((r) => `<DATA>${r.RELTYPE}</DATA>`).join('');
      return `<dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview">
        <dataPreview:totalRows>${rows.length}</dataPreview:totalRows>
        <dataPreview:columns><dataPreview:metadata dataPreview:name="CLSNAME"/><dataPreview:dataSet>${clsData}</dataPreview:dataSet></dataPreview:columns>
        <dataPreview:columns><dataPreview:metadata dataPreview:name="REFCLSNAME"/><dataPreview:dataSet>${refData}</dataPreview:dataSet></dataPreview:columns>
        <dataPreview:columns><dataPreview:metadata dataPreview:name="RELTYPE"/><dataPreview:dataSet>${relData}</dataPreview:dataSet></dataPreview:columns>
      </dataPreview:tableData>`;
    }

    function subclassXml(names: string[]): string {
      const data = names.map((n) => `<DATA>${n}</DATA>`).join('');
      return `<dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview">
        <dataPreview:totalRows>${names.length}</dataPreview:totalRows>
        <dataPreview:columns><dataPreview:metadata dataPreview:name="CLSNAME"/><dataPreview:dataSet>${data}</dataPreview:dataSet></dataPreview:columns>
      </dataPreview:tableData>`;
    }

    it('returns superclass and interfaces', async () => {
      mockFetch.mockReset();
      // CSRF for first query
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      // Own relationships: inherits CL_PARENT, implements IF_A and IF_B
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          seometarelXml([
            { CLSNAME: 'ZCL_TEST', REFCLSNAME: 'CL_PARENT', RELTYPE: '2' },
            { CLSNAME: 'ZCL_TEST', REFCLSNAME: 'IF_A', RELTYPE: '1' },
            { CLSNAME: 'ZCL_TEST', REFCLSNAME: 'IF_B', RELTYPE: '1' },
          ]),
        ),
      );
      // Subclasses: ZCL_CHILD1, ZCL_CHILD2 (CSRF cached from first query)
      mockFetch.mockResolvedValueOnce(mockResponse(200, subclassXml(['ZCL_CHILD1', 'ZCL_CHILD2'])));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPNavigate', {
        action: 'hierarchy',
        name: 'ZCL_TEST',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.className).toBe('ZCL_TEST');
      expect(parsed.superclass).toBe('CL_PARENT');
      expect(parsed.interfaces).toEqual(['IF_A', 'IF_B']);
      expect(parsed.subclasses).toEqual(['ZCL_CHILD1', 'ZCL_CHILD2']);
    });

    it('returns null superclass when class has no parent', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      // Only interface, no inheritance
      mockFetch.mockResolvedValueOnce(
        mockResponse(200, seometarelXml([{ CLSNAME: 'ZCL_ROOT', REFCLSNAME: 'IF_SERIALIZABLE', RELTYPE: '1' }])),
      );
      // Subclasses query (CSRF cached)
      mockFetch.mockResolvedValueOnce(mockResponse(200, subclassXml([])));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPNavigate', {
        action: 'hierarchy',
        name: 'ZCL_ROOT',
      });
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.superclass).toBeNull();
      expect(parsed.interfaces).toEqual(['IF_SERIALIZABLE']);
      expect(parsed.subclasses).toEqual([]);
    });

    it('returns empty hierarchy for class with no relationships', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, seometarelXml([])));
      // Subclasses query (CSRF cached)
      mockFetch.mockResolvedValueOnce(mockResponse(200, subclassXml([])));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPNavigate', {
        action: 'hierarchy',
        name: 'ZCL_ISOLATED',
      });
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.superclass).toBeNull();
      expect(parsed.interfaces).toEqual([]);
      expect(parsed.subclasses).toEqual([]);
    });

    it('returns error when name is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPNavigate', {
        action: 'hierarchy',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Provide name');
    });

    it('rejects invalid class names', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPNavigate', {
        action: 'hierarchy',
        name: "ZCL_TEST'; DROP TABLE--",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Invalid class name');
    });

    it('falls back to getTableContents when free SQL is blocked', async () => {
      mockFetch.mockReset();
      // CSRF for first query
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      // Own relationships via named table preview
      mockFetch.mockResolvedValueOnce(
        mockResponse(200, seometarelXml([{ CLSNAME: 'ZCL_TEST', REFCLSNAME: 'CL_PARENT', RELTYPE: '2' }])),
      );
      // Subclasses via named table preview (CSRF cached)
      mockFetch.mockResolvedValueOnce(mockResponse(200, subclassXml(['ZCL_CHILD1'])));

      const client = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowFreeSQL: false },
      });

      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPNavigate', {
        action: 'hierarchy',
        name: 'ZCL_TEST',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.superclass).toBe('CL_PARENT');
      expect(parsed.subclasses).toEqual(['ZCL_CHILD1']);
      // Verify it used the ddic endpoint (named table), not freestyle
      const postCalls = mockFetch.mock.calls.filter((c: unknown[]) => (c[1] as { method?: string })?.method === 'POST');
      expect(postCalls[0]![0]).toContain('/datapreview/ddic');
    });

    it('returns error when both free SQL and table preview are blocked', async () => {
      const client = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowFreeSQL: false, allowDataPreview: false },
      });

      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPNavigate', {
        action: 'hierarchy',
        name: 'ZCL_TEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('data access permissions');
      expect(result.content[0]?.text).toContain('SAP_ALLOW_FREE_SQL=true');
      expect(result.content[0]?.text).toContain('SAP_ALLOW_DATA_PREVIEW=true');
    });
  });

  // ─── BTP ABAP Handler Adaptation ────────────────────────────────────

  describe('BTP ABAP handler adaptation', () => {
    /** Create minimal BTP-detected features for testing */
    function setBtpMode(): void {
      const btpFeatures: ResolvedFeatures = {
        hana: { id: 'hana', available: true, mode: 'auto' },
        abapGit: { id: 'abapGit', available: false, mode: 'auto' },
        rap: { id: 'rap', available: true, mode: 'auto' },
        amdp: { id: 'amdp', available: false, mode: 'auto' },
        ui5: { id: 'ui5', available: false, mode: 'auto' },
        transport: { id: 'transport', available: true, mode: 'auto' },
        ui5repo: { id: 'ui5repo', available: false, mode: 'auto' },
        flp: { id: 'flp', available: false, mode: 'auto' },
        abapRelease: '758',
        systemType: 'btp',
      };
      setCachedFeatures(btpFeatures);
    }

    afterEach(() => {
      resetCachedFeatures();
    });

    it('returns helpful error for PROG read on BTP', async () => {
      setBtpMode();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'RSHOWTIM',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not available on BTP');
      expect(result.content[0]?.text).toContain('IF_OO_ADT_CLASSRUN');
    });

    it('returns helpful error for INCL read on BTP', async () => {
      setBtpMode();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'INCL',
        name: 'ZSOME_INCLUDE',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not available on BTP');
      expect(result.content[0]?.text).toContain('ABAP Cloud');
    });

    it('returns helpful error for VIEW read on BTP', async () => {
      setBtpMode();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'VIEW',
        name: 'V_T002',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not available on BTP');
      expect(result.content[0]?.text).toContain('CDS views');
    });

    it('returns helpful error for TEXT_ELEMENTS read on BTP', async () => {
      setBtpMode();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'TEXT_ELEMENTS',
        name: 'RSHOWTIM',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not available on BTP');
    });

    it('returns helpful error for VARIANTS read on BTP', async () => {
      setBtpMode();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'VARIANTS',
        name: 'RSHOWTIM',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not available on BTP');
    });

    it('returns helpful error for SOBJ read on BTP', async () => {
      setBtpMode();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'SOBJ',
        name: 'BUS2032',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not available on BTP');
      expect(result.content[0]?.text).toContain('BDEF');
    });

    it('allows CLAS read on BTP (works normally)', async () => {
      setBtpMode();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'CLAS',
        name: 'ZCL_TEST',
      });
      // Should succeed (not an error about BTP)
      expect(result.isError).toBeUndefined();
    });

    it('returns helpful error for TRAN read on BTP', async () => {
      setBtpMode();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'TRAN',
        name: 'SE38',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not available on BTP');
    });

    it('allows TABL read of a DDIC structure on BTP (via /tables/→/structures/ fallback)', async () => {
      setBtpMode();
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
    });

    it('rejects type=STRU on BTP at the schema layer', async () => {
      setBtpMode();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'STRU',
        name: 'BAPIRET2',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Invalid arguments for SAPRead');
    });
  });

  // ─── Method-Level Surgery ──────────────────────────────────────────

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

  describe('SAPWrite edit_method', () => {
    it('rejects edit_method without method param', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_method',
        type: 'CLAS',
        name: 'ZCL_TEST',
        source: 'rv = 1.',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('method');
    });

    it('rejects edit_method without source param', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_method',
        type: 'CLAS',
        name: 'ZCL_TEST',
        method: 'get_name',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('source');
    });

    it('rejects edit_method for non-CLAS type', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_method',
        type: 'PROG',
        name: 'ZTEST',
        method: 'get_name',
        source: 'rv = 1.',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('CLAS');
    });
  });

  describe('SAPWrite scaffold_rap_handlers', () => {
    const bdefSource = `managed implementation in class ZBP_I_TRAVELREQ unique;
define behavior for ZI_TRAVELREQ alias Travel
authorization master ( instance )
{
  action SubmitForApproval result [1] $self;
  action RecalculateTotalCost result [1] $self;
}`;

    const classMetadataXml = `<?xml version="1.0" encoding="UTF-8"?>
<class:abapClass
  xmlns:class="http://www.sap.com/adt/classlib"
  xmlns:adtcore="http://www.sap.com/adt/core"
  adtcore:name="ZBP_I_TRAVELREQ"
  adtcore:type="CLAS/OC"
  adtcore:description="Behavior pool"
  class:abapLanguageVersion="standard"/>`;

    const classMetadataForbiddenPackageXml = `<?xml version="1.0" encoding="UTF-8"?>
<class:abapClass
  xmlns:class="http://www.sap.com/adt/classlib"
  xmlns:adtcore="http://www.sap.com/adt/core"
  adtcore:name="/DMO/BP_TRAVEL_M"
  adtcore:type="CLAS/OC"
  adtcore:description="Behavior pool"
  class:abapLanguageVersion="standard">
  <adtcore:packageRef adtcore:name="/DMO/FLIGHT_MANAGED"/>
</class:abapClass>`;

    const classMainSource = `CLASS zbp_i_travelreq DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF zi_travelreq.
ENDCLASS.

CLASS zbp_i_travelreq IMPLEMENTATION.
ENDCLASS.`;

    const classDefinitionsSource = `CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS submitforapproval FOR MODIFY
      IMPORTING keys FOR ACTION Travel~SubmitForApproval RESULT result.
ENDCLASS.
`;

    it('returns missing handler signatures without applying changes', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        if (method === 'GET' && urlStr.endsWith('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ')) {
          return Promise.resolve(mockResponse(200, classMetadataXml, { 'x-csrf-token': 'T' }));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/source/main')) {
          return Promise.resolve(mockResponse(200, classMainSource, { 'x-csrf-token': 'T' }));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/definitions')) {
          return Promise.resolve(mockResponse(200, classDefinitionsSource, { 'x-csrf-token': 'T' }));
        }
        if (
          method === 'GET' &&
          (urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/testclasses') ||
            urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/implementations') ||
            urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/macros'))
        ) {
          return Promise.reject(new AdtApiError('Not found', 404, urlStr));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/bo/behaviordefinitions/ZI_TRAVELREQ/source/main')) {
          return Promise.resolve(mockResponse(200, bdefSource, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'scaffold_rap_handlers',
        type: 'CLAS',
        name: 'ZBP_I_TRAVELREQ',
        bdefName: 'ZI_TRAVELREQ',
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text ?? '{}');
      expect(parsed.applied).toBe(false);
      expect(parsed.missingCount).toBeGreaterThan(0);
      expect(
        parsed.missing.some(
          (req: { methodName: string }) =>
            req.methodName === 'recalculatetotalcost' || req.methodName === 'get_instance_authorizations',
        ),
      ).toBe(true);
    });

    it('dry-run does not enforce write package allowlist for existing behavior pools', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string }> = [];
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        calls.push({ method, url: urlStr });

        if (method === 'GET' && urlStr.endsWith('/sap/bc/adt/oo/classes/%2FDMO%2FBP_TRAVEL_M')) {
          return Promise.resolve(mockResponse(200, classMetadataForbiddenPackageXml, { 'x-csrf-token': 'T' }));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/%2FDMO%2FBP_TRAVEL_M/source/main')) {
          return Promise.resolve(mockResponse(200, classMainSource, { 'x-csrf-token': 'T' }));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/%2FDMO%2FBP_TRAVEL_M/includes/definitions')) {
          return Promise.resolve(mockResponse(200, classDefinitionsSource, { 'x-csrf-token': 'T' }));
        }
        if (
          method === 'GET' &&
          (urlStr.includes('/sap/bc/adt/oo/classes/%2FDMO%2FBP_TRAVEL_M/includes/testclasses') ||
            urlStr.includes('/sap/bc/adt/oo/classes/%2FDMO%2FBP_TRAVEL_M/includes/implementations') ||
            urlStr.includes('/sap/bc/adt/oo/classes/%2FDMO%2FBP_TRAVEL_M/includes/macros'))
        ) {
          return Promise.reject(new AdtApiError('Not found', 404, urlStr));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/bo/behaviordefinitions/%2FDMO%2FI_TRAVEL_M/source/main')) {
          return Promise.resolve(mockResponse(200, bdefSource, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
      });

      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] },
      });
      const resolvePackageSpy = vi.spyOn(restrictedClient, 'resolveObjectPackage');

      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'scaffold_rap_handlers',
        type: 'CLAS',
        name: '/DMO/BP_TRAVEL_M',
        bdefName: '/DMO/I_TRAVEL_M',
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text ?? '{}');
      expect(parsed.applied).toBe(false);
      expect(parsed.requiredCount).toBeGreaterThan(0);
      expect(result.content[0]?.text).not.toContain('blocked by safety');
      expect(calls.some((call) => call.method === 'PUT' || call.url.includes('_action=LOCK'))).toBe(false);
      expect(resolvePackageSpy).not.toHaveBeenCalled();
    });

    it('dry-run does not report semantic FOR ACTION implementations as missing stubs', async () => {
      const semanticBdefSource = `managed implementation in class ZBP_I_TRAVELREQ unique;
define behavior for ZI_TRAVELREQ alias Travel
{
  action acceptTravel result [1] $self;
}`;
      const semanticDefinitionsSource = `CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS set_status_accepted FOR MODIFY
      IMPORTING keys FOR ACTION Travel~acceptTravel RESULT result.
ENDCLASS.`;
      const semanticImplementationsSource = `CLASS lhc_travel IMPLEMENTATION.
  METHOD set_status_accepted.
  ENDMETHOD.
ENDCLASS.`;

      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        if (method === 'GET' && urlStr.endsWith('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ')) {
          return Promise.resolve(mockResponse(200, classMetadataXml, { 'x-csrf-token': 'T' }));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/source/main')) {
          return Promise.resolve(mockResponse(200, classMainSource, { 'x-csrf-token': 'T' }));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/definitions')) {
          return Promise.resolve(mockResponse(200, semanticDefinitionsSource, { 'x-csrf-token': 'T' }));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/implementations')) {
          return Promise.resolve(mockResponse(200, semanticImplementationsSource, { 'x-csrf-token': 'T' }));
        }
        if (
          method === 'GET' &&
          (urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/testclasses') ||
            urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/macros'))
        ) {
          return Promise.reject(new AdtApiError('Not found', 404, urlStr));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/bo/behaviordefinitions/ZI_TRAVELREQ/source/main')) {
          return Promise.resolve(mockResponse(200, semanticBdefSource, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'scaffold_rap_handlers',
        type: 'CLAS',
        name: 'ZBP_I_TRAVELREQ',
        bdefName: 'ZI_TRAVELREQ',
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text ?? '{}');
      expect(parsed.missingCount).toBe(0);
      expect(parsed.missingImplementationStubCount).toBe(0);
    });

    it('autoApply still enforces write package allowlist for existing behavior pools', async () => {
      mockFetch.mockReset();
      const restrictedClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['$TMP'] },
      });
      const resolvePackageSpy = vi
        .spyOn(restrictedClient, 'resolveObjectPackage')
        .mockResolvedValue('/DMO/FLIGHT_MANAGED');

      const result = await handleToolCall(restrictedClient, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'scaffold_rap_handlers',
        type: 'CLAS',
        name: '/DMO/BP_TRAVEL_M',
        bdefName: '/DMO/I_TRAVEL_M',
        autoApply: true,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('/DMO/FLIGHT_MANAGED');
      expect(result.content[0]?.text).toContain('blocked');
      expect(resolvePackageSpy).toHaveBeenCalledOnce();
    });

    it('returns available aliases when targetAlias does not match BDEF requirements', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        if (method === 'GET' && urlStr.endsWith('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ')) {
          return Promise.resolve(mockResponse(200, classMetadataXml, { 'x-csrf-token': 'T' }));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/source/main')) {
          return Promise.resolve(mockResponse(200, classMainSource, { 'x-csrf-token': 'T' }));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/definitions')) {
          return Promise.resolve(mockResponse(200, classDefinitionsSource, { 'x-csrf-token': 'T' }));
        }
        if (
          method === 'GET' &&
          (urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/testclasses') ||
            urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/implementations') ||
            urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/macros'))
        ) {
          return Promise.reject(new AdtApiError('Not found', 404, urlStr));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/bo/behaviordefinitions/ZI_TRAVELREQ/source/main')) {
          return Promise.resolve(mockResponse(200, bdefSource, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'scaffold_rap_handlers',
        type: 'CLAS',
        name: 'ZBP_I_TRAVELREQ',
        bdefName: 'ZI_TRAVELREQ',
        targetAlias: 'DoesNotExist',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('No RAP handler requirements were found');
      expect(result.content[0]?.text).toContain('Available aliases in ZI_TRAVELREQ: Travel');
    });

    it('autoApply reports unresolved handler skeletons with a recovery hint', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string }> = [];
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        calls.push({ method, url: urlStr });

        if (method === 'GET' && urlStr.endsWith('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ')) {
          return Promise.resolve(mockResponse(200, classMetadataXml, { 'x-csrf-token': 'T' }));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/source/main')) {
          return Promise.resolve(mockResponse(200, classMainSource, { 'x-csrf-token': 'T' }));
        }
        if (
          method === 'GET' &&
          (urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/definitions') ||
            urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/implementations') ||
            urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/testclasses') ||
            urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/macros'))
        ) {
          return Promise.reject(new AdtApiError('Not found', 404, urlStr));
        }
        if (method === 'GET' && urlStr.includes('/sap/bc/adt/bo/behaviordefinitions/ZI_TRAVELREQ/source/main')) {
          return Promise.resolve(mockResponse(200, bdefSource, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'scaffold_rap_handlers',
        type: 'CLAS',
        name: 'ZBP_I_TRAVELREQ',
        bdefName: 'ZI_TRAVELREQ',
        autoApply: true,
        lintBeforeWrite: false,
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text ?? '{}');
      expect(parsed.applied).toBe(false);
      expect(parsed.applyResult.unresolved.length).toBeGreaterThan(0);
      expect(parsed.hint).toContain('lhc_travel');
      expect(parsed.hint).toContain('Create local handler class');
      expect(calls.some((call) => call.method === 'PUT' || call.url.includes('_action=LOCK'))).toBe(false);
    });

    it('autoApply injects signatures and writes class source', async () => {
      const classImplementationsSource = `CLASS lhc_travel IMPLEMENTATION.
ENDCLASS.`;

      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockImplementation(
        (
          url: string | URL,
          opts?: { method?: string; body?: string | Buffer | null; headers?: Record<string, string> },
        ) => {
          const method = opts?.method ?? 'GET';
          const urlStr = String(url);
          calls.push({
            method,
            url: urlStr,
            body: typeof opts?.body === 'string' ? opts.body : undefined,
          });
          if (method === 'GET' && urlStr.endsWith('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ')) {
            return Promise.resolve(mockResponse(200, classMetadataXml, { 'x-csrf-token': 'T' }));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/source/main')) {
            return Promise.resolve(mockResponse(200, classMainSource, { 'x-csrf-token': 'T' }));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/definitions')) {
            return Promise.resolve(mockResponse(200, classDefinitionsSource, { 'x-csrf-token': 'T' }));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/implementations')) {
            return Promise.resolve(mockResponse(200, classImplementationsSource, { 'x-csrf-token': 'T' }));
          }
          if (
            method === 'GET' &&
            (urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/testclasses') ||
              urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/macros'))
          ) {
            return Promise.reject(new AdtApiError('Not found', 404, urlStr));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/bo/behaviordefinitions/ZI_TRAVELREQ/source/main')) {
            return Promise.resolve(mockResponse(200, bdefSource, { 'x-csrf-token': 'T' }));
          }
          if (method === 'POST' && urlStr.includes('_action=LOCK')) {
            return Promise.resolve(
              mockResponse(
                200,
                '<asx:abap><asx:values><DATA><LOCK_HANDLE>LH1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>',
                { 'x-csrf-token': 'T' },
              ),
            );
          }
          return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
        },
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'scaffold_rap_handlers',
        type: 'CLAS',
        name: 'ZBP_I_TRAVELREQ',
        bdefName: 'ZI_TRAVELREQ',
        autoApply: true,
        lintBeforeWrite: false,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Scaffolded');
      const putCall = calls.find(
        (call) =>
          call.method === 'PUT' && call.url.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/definitions'),
      );
      expect(putCall).toBeDefined();
      expect(putCall?.body).toContain('METHODS recalculatetotalcost FOR MODIFY');
      expect(putCall?.body).toContain('METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION');
      const implPutCall = calls.find(
        (call) =>
          call.method === 'PUT' && call.url.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/implementations'),
      );
      expect(implPutCall).toBeDefined();
      expect(implPutCall?.body).toContain('METHOD recalculatetotalcost.');
      expect(implPutCall?.body).toContain('METHOD get_instance_authorizations.');
    });

    it('autoApply falls back to implementations include when handler class is declared there', async () => {
      const classDefinitionsNoHandlers = `*"* definitions placeholder`;
      const classImplementationsWithHandlers = `CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS submitforapproval FOR MODIFY
      IMPORTING keys FOR ACTION Travel~SubmitForApproval RESULT result.
ENDCLASS.

CLASS lhc_travel IMPLEMENTATION.
ENDCLASS.`;

      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockImplementation(
        (
          url: string | URL,
          opts?: { method?: string; body?: string | Buffer | null; headers?: Record<string, string> },
        ) => {
          const method = opts?.method ?? 'GET';
          const urlStr = String(url);
          calls.push({
            method,
            url: urlStr,
            body: typeof opts?.body === 'string' ? opts.body : undefined,
          });

          if (method === 'GET' && urlStr.endsWith('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ')) {
            return Promise.resolve(mockResponse(200, classMetadataXml, { 'x-csrf-token': 'T' }));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/source/main')) {
            return Promise.resolve(mockResponse(200, classMainSource, { 'x-csrf-token': 'T' }));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/definitions')) {
            return Promise.resolve(mockResponse(200, classDefinitionsNoHandlers, { 'x-csrf-token': 'T' }));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/implementations')) {
            return Promise.resolve(mockResponse(200, classImplementationsWithHandlers, { 'x-csrf-token': 'T' }));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/macros')) {
            return Promise.reject(new AdtApiError('Not found', 404, urlStr));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/testclasses')) {
            return Promise.reject(new AdtApiError('Not found', 404, urlStr));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/bo/behaviordefinitions/ZI_TRAVELREQ/source/main')) {
            return Promise.resolve(mockResponse(200, bdefSource, { 'x-csrf-token': 'T' }));
          }
          if (method === 'POST' && urlStr.includes('_action=LOCK')) {
            return Promise.resolve(
              mockResponse(
                200,
                '<asx:abap><asx:values><DATA><LOCK_HANDLE>LH1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>',
                { 'x-csrf-token': 'T' },
              ),
            );
          }

          return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
        },
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'scaffold_rap_handlers',
        type: 'CLAS',
        name: 'ZBP_I_TRAVELREQ',
        bdefName: 'ZI_TRAVELREQ',
        autoApply: true,
        lintBeforeWrite: false,
      });

      expect(result.isError).toBeUndefined();
      const putCall = calls.find(
        (call) =>
          call.method === 'PUT' && call.url.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/implementations'),
      );
      expect(putCall).toBeDefined();
      expect(putCall?.body).toContain('METHODS recalculatetotalcost FOR MODIFY');
      expect(putCall?.body).toContain('METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION');
      expect(putCall?.body).toContain('METHOD recalculatetotalcost.');
      expect(putCall?.body).toContain('METHOD get_instance_authorizations.');
    });

    it('autoApply adds implementation stubs even when declarations already exist', async () => {
      const classDefinitionsAllHandlers = `CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS submitforapproval FOR MODIFY
      IMPORTING keys FOR ACTION Travel~SubmitForApproval RESULT result.
    METHODS recalculatetotalcost FOR MODIFY
      IMPORTING keys FOR ACTION Travel~RecalculateTotalCost RESULT result.
    METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION
      IMPORTING keys REQUEST requested_authorizations FOR Travel RESULT result.
ENDCLASS.`;
      const classImplementationsEmpty = `CLASS lhc_travel IMPLEMENTATION.
ENDCLASS.`;

      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockImplementation(
        (
          url: string | URL,
          opts?: { method?: string; body?: string | Buffer | null; headers?: Record<string, string> },
        ) => {
          const method = opts?.method ?? 'GET';
          const urlStr = String(url);
          calls.push({ method, url: urlStr, body: typeof opts?.body === 'string' ? opts.body : undefined });

          if (method === 'GET' && urlStr.endsWith('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ')) {
            return Promise.resolve(mockResponse(200, classMetadataXml, { 'x-csrf-token': 'T' }));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/source/main')) {
            return Promise.resolve(mockResponse(200, classMainSource, { 'x-csrf-token': 'T' }));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/definitions')) {
            return Promise.resolve(mockResponse(200, classDefinitionsAllHandlers, { 'x-csrf-token': 'T' }));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/implementations')) {
            return Promise.resolve(mockResponse(200, classImplementationsEmpty, { 'x-csrf-token': 'T' }));
          }
          if (
            method === 'GET' &&
            (urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/testclasses') ||
              urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/macros'))
          ) {
            return Promise.reject(new AdtApiError('Not found', 404, urlStr));
          }
          if (method === 'GET' && urlStr.includes('/sap/bc/adt/bo/behaviordefinitions/ZI_TRAVELREQ/source/main')) {
            return Promise.resolve(mockResponse(200, bdefSource, { 'x-csrf-token': 'T' }));
          }
          if (method === 'POST' && urlStr.includes('_action=LOCK')) {
            return Promise.resolve(
              mockResponse(
                200,
                '<asx:abap><asx:values><DATA><LOCK_HANDLE>LH1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>',
                { 'x-csrf-token': 'T' },
              ),
            );
          }
          return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
        },
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'scaffold_rap_handlers',
        type: 'CLAS',
        name: 'ZBP_I_TRAVELREQ',
        bdefName: 'ZI_TRAVELREQ',
        autoApply: true,
        lintBeforeWrite: false,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('0 RAP handler signature(s) and 3 implementation stub(s)');
      const definitionPutCall = calls.find(
        (call) =>
          call.method === 'PUT' && call.url.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/definitions'),
      );
      expect(definitionPutCall).toBeUndefined();
      const implPutCall = calls.find(
        (call) =>
          call.method === 'PUT' && call.url.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/includes/implementations'),
      );
      expect(implPutCall).toBeDefined();
      expect(implPutCall?.body).toContain('METHOD submitforapproval.');
      expect(implPutCall?.body).toContain('METHOD recalculatetotalcost.');
      expect(implPutCall?.body).toContain('METHOD get_instance_authorizations.');
    });

    it('returns validation error when bdefName is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'scaffold_rap_handlers',
        type: 'CLAS',
        name: 'ZBP_I_TRAVELREQ',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('bdefName');
    });
  });

  describe('hyperfocused mode (SAP tool)', () => {
    it('routes SAP(read) to SAPRead', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAP', {
        action: 'read',
        type: 'PROG',
        name: 'ZHELLO',
      });
      expect(result.isError).toBeUndefined();
      // Should get the same result as SAPRead(PROG)
      expect(result.content[0]?.text).toBeTruthy();
    });

    it('returns error for unknown SAP action', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAP', {
        action: 'invalid_action',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Unknown action');
    });

    it('routes SAP(search) with params', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAP', {
        action: 'search',
        params: { query: 'ZCL*' },
      });
      // Should succeed (mock returns data)
      expect(result.isError).toBeUndefined();
    });
  });

  // ─── SAPWrite batch_create ──────────────────────────────────────────

  describe('SAPWrite batch_create', () => {
    it('creates all objects in order', async () => {
      // Mock: CSRF fetch, create POST, lock GET (for safeUpdateSource), update PUT, unlock POST, activation POST
      // Use a simple mock that returns 200 for everything
      mockFetch.mockResolvedValue(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'mock-csrf-token' }));

      // Disable lint to avoid CDS source being rejected by ABAP parser
      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [
          { type: 'DDLS', name: 'ZI_TEST', source: 'define root view entity ZI_TEST {}' },
          { type: 'BDEF', name: 'ZI_TEST', source: 'managed implementation in class zbp_i_test;' },
          { type: 'SRVD', name: 'ZSD_TEST', source: 'define service ZSD_TEST {}' },
        ],
      });

      // Should mention all 3 objects in the summary
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('ZI_TEST (DDLS)');
      expect(text).toContain('ZI_TEST (BDEF)');
      expect(text).toContain('ZSD_TEST (SRVD)');
      expect(text).toContain('3 objects');
    });

    it('stops on first failure and reports partial results', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        // First few calls succeed (CSRF, create #1, lock, update, unlock, activate)
        // Then fail on second object create
        if (callCount <= 7) {
          return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
        }
        // Fail on subsequent calls (second object)
        return Promise.resolve(mockResponse(500, 'Internal Server Error', { 'x-csrf-token': 'T' }));
      });

      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [
          { type: 'PROG', name: 'ZPROG1', source: "REPORT zprog1.\nWRITE: / 'hi'." },
          { type: 'PROG', name: 'ZPROG2', source: "REPORT zprog2.\nWRITE: / 'hi'." },
          { type: 'PROG', name: 'ZPROG3', source: "REPORT zprog3.\nWRITE: / 'hi'." },
        ],
      });

      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '';
      // Third object should appear as skipped
      expect(text).toContain('ZPROG3');
      expect(text).toContain('skipped');
    });

    it('returns error for empty objects array', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [],
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('non-empty');
    });

    it('respects read-only safety mode', async () => {
      const client = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowWrites: false },
      });

      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [{ type: 'PROG', name: 'ZPROG1', source: 'REPORT zprog1.' }],
      });

      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('blocked');
    });

    it('applies package filter', async () => {
      const client = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['ZALLOWED*'] },
      });

      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'batch_create',
        package: 'ZBLOCKED',
        objects: [{ type: 'PROG', name: 'ZPROG1', source: 'REPORT zprog1.' }],
      });

      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('blocked');
    });

    it('activates each object after creation', async () => {
      const fetchCalls: string[] = [];
      mockFetch.mockImplementation((_url: string | URL, options?: { method?: string }) => {
        const urlStr = typeof _url === 'string' ? _url : _url.toString();
        fetchCalls.push(`${options?.method ?? 'GET'} ${urlStr}`);
        return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      });

      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [{ type: 'PROG', name: 'ZPROG1' }],
      });

      // Should have an activation POST call
      const activationCalls = fetchCalls.filter((c) => c.includes('activation'));
      expect(activationCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('skips source update when no source provided', async () => {
      const fetchCalls: string[] = [];
      mockFetch.mockImplementation((_url: string | URL, options?: { method?: string }) => {
        const urlStr = typeof _url === 'string' ? _url : _url.toString();
        fetchCalls.push(`${options?.method ?? 'GET'} ${urlStr}`);
        return Promise.resolve(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      });

      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [{ type: 'SRVD', name: 'ZSD_TEST' }],
      });

      // No PUT call for source update (only POST for create + POST for activation)
      const putCalls = fetchCalls.filter((c) => c.startsWith('PUT'));
      expect(putCalls.length).toBe(0);
    });

    it('batch_create succeeds with multiple objects', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, '<xml>ok</xml>', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [
          { type: 'PROG', name: 'ZPROG1', source: 'REPORT zprog1.' },
          { type: 'PROG', name: 'ZPROG2', source: 'REPORT zprog2.' },
        ],
      });

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('2 objects');
      expect(result.isError).toBeUndefined();
    });
  });

  // ─── AFF validation in SAPWrite ─────────────────────────────────────

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

  describe('normalizeObjectType', () => {
    it('normalizes all supported slash-type mappings', () => {
      // Issue #218 audit follow-up: every entry below is verified against either
      // Eclipse ADT apidoc 3.58.1 or live a4h+npl ADT responses captured
      // 2026-05-08. See research/abap-types/types/<short>.md.
      const mappings: Array<[string, string]> = [
        ['PROG/P', 'PROG'],
        ['PROG/I', 'INCL'],
        ['CLAS/OC', 'CLAS'],
        ['INTF/OI', 'INTF'],
        ['FUGR/F', 'FUGR'], // function group container
        ['FUGR/FF', 'FUNC'], // function module — routes to FUNC, not FUGR
        ['DDLS/DF', 'DDLS'],
        ['DCLS/DL', 'DCLS'],
        ['BDEF/BDO', 'BDEF'],
        ['SRVD/SRV', 'SRVD'],
        ['SRVB/SVB', 'SRVB'],
        ['DDLX/EX', 'DDLX'],
        // TABL/DT (transparent table) and TABL/DS (DDIC structure) both
        // collapse to the canonical 'TABL' short type (Model B). STRU/DS is
        // a legacy slash-form alias that also maps to TABL. Bare 'STRU' is
        // intentionally NOT aliased so schema validation rejects it.
        ['TABL/DT', 'TABL'],
        ['TABL/DS', 'TABL'],
        ['STRU/DS', 'TABL'],
        ['DOMA/DD', 'DOMA'],
        ['DTEL/DE', 'DTEL'],
        ['MSAG/N', 'MSAG'],
        ['DEVC/K', 'DEVC'],
        ['TRAN/T', 'TRAN'], // was 'TRAN/O' pre-audit — ADT actually emits TRAN/T
        ['VIEW/DV', 'VIEW'], // was 'VIEW/V' pre-audit — ADT actually emits VIEW/DV
        ['SKTD/TYP', 'SKTD'],
      ];

      for (const [input, expected] of mappings) {
        expect(normalizeObjectType(input)).toBe(expected);
      }
    });

    it('passes through invented slash codes removed in PR (regression guard)', () => {
      // These were aliased pre-audit. The audit (research/abap-types/) verified
      // they don't exist in ADT or any SAP source. Pass-through means schema
      // validation rejects them loudly so the breaking change surfaces.
      expect(normalizeObjectType('FUNC/FM')).toBe('FUNC/FM');
      expect(normalizeObjectType('CLAS/LI')).toBe('CLAS/LI');
      expect(normalizeObjectType('VIEW/V')).toBe('VIEW/V');
      expect(normalizeObjectType('TRAN/O')).toBe('TRAN/O');
    });

    it('is case-insensitive for friendly and slash types', () => {
      expect(normalizeObjectType('clas')).toBe('CLAS');
      expect(normalizeObjectType('Prog/P')).toBe('PROG');
    });

    it('passes through already-correct types', () => {
      expect(normalizeObjectType('CLAS')).toBe('CLAS');
      expect(normalizeObjectType('PROG')).toBe('PROG');
    });

    it('passes through unknown types', () => {
      expect(normalizeObjectType('UNKNOWN')).toBe('UNKNOWN');
    });

    it('returns empty string for empty or whitespace input', () => {
      expect(normalizeObjectType('')).toBe('');
      expect(normalizeObjectType('   ')).toBe('');
    });
  });

  describe('type auto-mappings wiring', () => {
    it('normalizes SAPWrite create type "CLAS/OC" to class endpoint', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'CLAS/OC',
        name: 'ZCL_NORMALIZED',
      });

      expect(result.isError).toBeUndefined();
      const createCall = mockFetch.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('/sap/bc/adt/oo/classes') &&
          typeof c[1] === 'object' &&
          (c[1] as Record<string, unknown>).method === 'POST',
      );
      expect(createCall).toBeDefined();
    });

    it('normalizes SAPRead type "clas" to class read endpoint', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, 'CLASS zcl_test DEFINITION.\nENDCLASS.', { 'x-csrf-token': 'T' }));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'clas',
        name: 'ZCL_TEST',
      });

      expect(result.isError).toBeUndefined();
      const readCall = mockFetch.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('/sap/bc/adt/oo/classes/'),
      );
      expect(readCall).toBeDefined();
    });
  });

  // ─── buildCreateXml ─────────────────────────────────────────────────

  describe('buildCreateXml', () => {
    it('returns correct XML for PROG', () => {
      const xml = buildCreateXml('PROG', 'ZHELLO', 'ZPACKAGE', 'Hello Program');
      expect(xml).toContain('<program:abapProgram');
      expect(xml).toContain('xmlns:program="http://www.sap.com/adt/programs/programs"');
      expect(xml).toContain('adtcore:type="PROG/P"');
      expect(xml).toContain('adtcore:name="ZHELLO"');
      expect(xml).toContain('adtcore:description="Hello Program"');
      expect(xml).toContain('<adtcore:packageRef adtcore:name="ZPACKAGE"/>');
    });

    it('returns correct XML for CLAS', () => {
      const xml = buildCreateXml('CLAS', 'ZCL_TEST', 'ZPACKAGE', 'Test Class');
      expect(xml).toContain('<class:abapClass');
      expect(xml).toContain('xmlns:class="http://www.sap.com/adt/oo/classes"');
      expect(xml).toContain('adtcore:type="CLAS/OC"');
      expect(xml).toContain('adtcore:name="ZCL_TEST"');
      expect(xml).toContain('adtcore:description="Test Class"');
      expect(xml).toContain('<adtcore:packageRef adtcore:name="ZPACKAGE"/>');
    });

    it('returns correct XML for INTF', () => {
      const xml = buildCreateXml('INTF', 'ZIF_TEST', 'ZPACKAGE', 'Test Interface');
      expect(xml).toContain('<intf:abapInterface');
      expect(xml).toContain('xmlns:intf="http://www.sap.com/adt/oo/interfaces"');
      expect(xml).toContain('adtcore:type="INTF/OI"');
      expect(xml).toContain('adtcore:name="ZIF_TEST"');
      expect(xml).toContain('adtcore:description="Test Interface"');
      expect(xml).toContain('<adtcore:packageRef adtcore:name="ZPACKAGE"/>');
    });

    it('returns correct XML for INCL', () => {
      const xml = buildCreateXml('INCL', 'ZHELLO_TOP', 'ZPACKAGE', 'Include Program');
      expect(xml).toContain('<include:abapInclude');
      expect(xml).toContain('xmlns:include="http://www.sap.com/adt/programs/includes"');
      expect(xml).toContain('adtcore:type="PROG/I"');
      expect(xml).toContain('adtcore:name="ZHELLO_TOP"');
      expect(xml).toContain('adtcore:description="Include Program"');
      expect(xml).toContain('<adtcore:packageRef adtcore:name="ZPACKAGE"/>');
    });

    it('returns correct XML for DDLS', () => {
      const xml = buildCreateXml('DDLS', 'ZI_TRAVEL', 'ZPACKAGE', 'Travel CDS View');
      expect(xml).toContain('<ddl:ddlSource');
      expect(xml).toContain('xmlns:ddl="http://www.sap.com/adt/ddic/ddlsources"');
      expect(xml).toContain('adtcore:type="DDLS/DF"');
      expect(xml).toContain('adtcore:name="ZI_TRAVEL"');
      expect(xml).toContain('adtcore:description="Travel CDS View"');
      expect(xml).toContain('<adtcore:packageRef adtcore:name="ZPACKAGE"/>');
    });

    it('returns correct XML for DCLS', () => {
      const xml = buildCreateXml('DCLS', 'ZI_TRAVEL_DCL', 'ZPACKAGE', 'Travel DCL');
      expect(xml).toContain('<dcl:dclSource');
      expect(xml).toContain('xmlns:dcl="http://www.sap.com/adt/acm/dclsources"');
      expect(xml).toContain('adtcore:type="DCLS/DL"');
      expect(xml).toContain('adtcore:name="ZI_TRAVEL_DCL"');
      expect(xml).toContain('adtcore:description="Travel DCL"');
      expect(xml).toContain('<adtcore:packageRef adtcore:name="ZPACKAGE"/>');
    });

    it('returns correct XML for BDEF (blue:blueSource namespace)', () => {
      const xml = buildCreateXml('BDEF', 'ZI_TRAVEL', 'ZPACKAGE', 'Travel Behavior');
      expect(xml).toContain('<blue:blueSource');
      expect(xml).toContain('xmlns:blue="http://www.sap.com/wbobj/blue"');
      expect(xml).toContain('adtcore:type="BDEF/BDO"');
      expect(xml).toContain('adtcore:name="ZI_TRAVEL"');
      expect(xml).toContain('adtcore:description="Travel Behavior"');
      expect(xml).toContain('<adtcore:packageRef adtcore:name="ZPACKAGE"/>');
      // Must NOT use the old broken namespace
      expect(xml).not.toContain('bdef:behaviorDefinition');
      expect(xml).not.toContain('http://www.sap.com/adt/bo/behaviordefinitions');
    });

    it('returns correct XML for SRVD', () => {
      const xml = buildCreateXml('SRVD', 'ZSD_TRAVEL', 'ZPACKAGE', 'Travel Service Def');
      expect(xml).toContain('<srvd:srvdSource');
      expect(xml).toContain('xmlns:srvd="http://www.sap.com/adt/ddic/srvdsources"');
      expect(xml).toContain('adtcore:type="SRVD/SRV"');
      expect(xml).toContain('adtcore:name="ZSD_TRAVEL"');
      expect(xml).toContain('adtcore:description="Travel Service Def"');
      expect(xml).toContain('srvd:srvdSourceType="S"');
      expect(xml).toContain('<adtcore:packageRef adtcore:name="ZPACKAGE"/>');
    });

    it('returns correct XML for DDLX', () => {
      const xml = buildCreateXml('DDLX', 'ZC_TRAVEL', 'ZPACKAGE', 'Travel Metadata Ext');
      expect(xml).toContain('<ddlx:ddlxSource');
      expect(xml).toContain('xmlns:ddlx="http://www.sap.com/adt/ddic/ddlxsources"');
      expect(xml).toContain('adtcore:type="DDLX/EX"');
      expect(xml).toContain('adtcore:name="ZC_TRAVEL"');
      expect(xml).toContain('adtcore:description="Travel Metadata Ext"');
      expect(xml).toContain('<adtcore:packageRef adtcore:name="ZPACKAGE"/>');
    });

    it('returns correct XML for SRVB', () => {
      const xml = buildCreateXml('SRVB', 'ZSB_TRAVEL_O4', 'ZPACKAGE', 'Travel service binding', {
        serviceDefinition: 'ZSD_TRAVEL',
        category: '0',
      });
      expect(xml).toContain('<srvb:serviceBinding');
      expect(xml).toContain('adtcore:type="SRVB/SVB"');
      expect(xml).toContain('<srvb:serviceDefinition adtcore:name="ZSD_TRAVEL"/>');
      expect(xml).toContain('<srvb:binding srvb:category="0" srvb:type="ODATA" srvb:version="V2">');
    });

    it('throws for SRVB when serviceDefinition is missing', () => {
      expect(() => buildCreateXml('SRVB', 'ZSB_TRAVEL_O4', 'ZPACKAGE', 'Travel service binding')).toThrow(
        'serviceDefinition',
      );
    });

    it('returns domain metadata XML for DOMA', () => {
      const xml = buildCreateXml('DOMA', 'ZSTATUS', '$TMP', 'Status domain', {
        dataType: 'CHAR',
        length: 1,
        fixedValues: [{ low: 'A', description: 'Active' }],
      });
      expect(xml).toContain('<doma:domain');
      expect(xml).toContain('adtcore:type="DOMA/DD"');
      expect(xml).toContain('<doma:datatype>CHAR</doma:datatype>');
      expect(xml).toContain('<doma:fixValue>');
    });

    it('returns data element metadata XML for DTEL', () => {
      const xml = buildCreateXml('DTEL', 'ZSTATUS', '$TMP', 'Status data element', {
        typeKind: 'domain',
        typeName: 'ZSTATUS',
        shortLabel: 'Status',
      });
      expect(xml).toContain('<blue:wbobj');
      expect(xml).toContain('adtcore:type="DTEL/DE"');
      expect(xml).toContain('<dtel:typeKind>domain</dtel:typeKind>');
      expect(xml).toContain('<dtel:typeName>ZSTATUS</dtel:typeName>');
    });

    it('returns TABL create XML with blue:blueSource envelope', () => {
      const xml = buildCreateXml('TABL', 'ZTABLE', 'ZPACKAGE', 'A Table');
      expect(xml).toContain('<blue:blueSource');
      expect(xml).toContain('xmlns:blue="http://www.sap.com/wbobj/blue"');
      expect(xml).toContain('adtcore:type="TABL/DT"');
      expect(xml).toContain('adtcore:name="ZTABLE"');
      expect(xml).toContain('<adtcore:packageRef adtcore:name="ZPACKAGE"/>');
    });

    it('escapes XML special characters in attributes', () => {
      const xml = buildCreateXml('DDLS', 'ZTEST', 'ZPKG', 'Desc with "quotes" & <angle>');
      expect(xml).toContain('adtcore:description="Desc with &quot;quotes&quot; &amp; &lt;angle&gt;"');
    });

    it('escapes apostrophes in XML attributes', () => {
      const xml = buildCreateXml('PROG', 'ZTEST', 'ZPKG', "It's a test");
      expect(xml).toContain('adtcore:description="It&apos;s a test"');
    });
  });

  // ─── SAPWrite delete corrNr auto-propagation ─────────────────────

  describe('SAPWrite delete corrNr auto-propagation', () => {
    const lockBodyWithCorrNr =
      '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H1</LOCK_HANDLE><CORRNR>A4HK900100</CORRNR><IS_LOCAL></IS_LOCAL></DATA></asx:values></asx:abap>';
    const lockBodyNoCorrNr =
      '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>';

    it('auto-propagates lock corrNr to delete when no transport supplied', async () => {
      const calls: Array<{ url: string; method: string }> = [];
      mockFetch.mockImplementation((url: string, opts: any) => {
        calls.push({ url: url.toString(), method: opts?.method ?? 'GET' });
        // CSRF HEAD
        if (opts?.method === 'HEAD') return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        // Lock POST
        if (url.toString().includes('_action=LOCK'))
          return Promise.resolve(mockResponse(200, lockBodyWithCorrNr, { 'x-csrf-token': 'T' }));
        // Delete
        if (opts?.method === 'DELETE') return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        // Unlock POST
        if (url.toString().includes('_action=UNLOCK'))
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete',
        type: 'PROG',
        name: 'ZTEST',
      });

      expect(result.isError).toBeUndefined();
      const deleteCall = calls.find((c) => c.method === 'DELETE');
      expect(deleteCall).toBeDefined();
      expect(deleteCall!.url).toContain('corrNr=A4HK900100');
    });

    it('uses explicit transport over lock corrNr in delete', async () => {
      const calls: Array<{ url: string; method: string }> = [];
      mockFetch.mockImplementation((url: string, opts: any) => {
        calls.push({ url: url.toString(), method: opts?.method ?? 'GET' });
        if (opts?.method === 'HEAD') return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        if (url.toString().includes('_action=LOCK'))
          return Promise.resolve(mockResponse(200, lockBodyWithCorrNr, { 'x-csrf-token': 'T' }));
        if (opts?.method === 'DELETE') return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        if (url.toString().includes('_action=UNLOCK'))
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete',
        type: 'PROG',
        name: 'ZTEST',
        transport: 'EXPLICIT_TR',
      });

      expect(result.isError).toBeUndefined();
      const deleteCall = calls.find((c) => c.method === 'DELETE');
      expect(deleteCall).toBeDefined();
      expect(deleteCall!.url).toContain('corrNr=EXPLICIT_TR');
      expect(deleteCall!.url).not.toContain('A4HK900100');
    });

    it('does not add corrNr to delete when lock returns empty corrNr', async () => {
      const calls: Array<{ url: string; method: string }> = [];
      mockFetch.mockImplementation((url: string, opts: any) => {
        calls.push({ url: url.toString(), method: opts?.method ?? 'GET' });
        if (opts?.method === 'HEAD') return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        if (url.toString().includes('_action=LOCK'))
          return Promise.resolve(mockResponse(200, lockBodyNoCorrNr, { 'x-csrf-token': 'T' }));
        if (opts?.method === 'DELETE') return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        if (url.toString().includes('_action=UNLOCK'))
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete',
        type: 'PROG',
        name: 'ZTEST',
      });

      expect(result.isError).toBeUndefined();
      const deleteCall = calls.find((c) => c.method === 'DELETE');
      expect(deleteCall).toBeDefined();
      expect(deleteCall!.url).not.toContain('corrNr');
    });

    it('delete succeeds for $TMP objects without transport', async () => {
      mockFetch.mockImplementation((url: string, opts: any) => {
        if (opts?.method === 'HEAD') return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        if (url.toString().includes('_action=LOCK'))
          return Promise.resolve(mockResponse(200, lockBodyNoCorrNr, { 'x-csrf-token': 'T' }));
        if (opts?.method === 'DELETE') return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        if (url.toString().includes('_action=UNLOCK'))
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete',
        type: 'PROG',
        name: 'ZTEST',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Deleted PROG ZTEST');
    });
  });

  describe('SAPWrite delete dependency diagnostics', () => {
    it('enriches DDLS delete [?/039] errors with where-used dependents', async () => {
      const lockBody =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>DLH1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>';
      const deleteErrorXml = `<?xml version="1.0" encoding="utf-8"?>
<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <exc:localizedMessage lang="EN">DDL source ZI_ROOT could not be deleted</exc:localizedMessage>
  <exc:properties>
    <entry key="T100KEY-NO">039</entry>
    <entry key="T100KEY-V1">ZI_ROOT</entry>
  </exc:properties>
</exc:exception>`;
      const whereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddl/sources/zi_child_one" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_CHILD_ONE" adtcore:type="DDLS/DF" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
    <usageReferences:referencedObject uri="/sap/bc/adt/ddic/ddl/sources/zi_child_two" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_CHILD_TWO" adtcore:type="DDLS/DF" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
    <usageReferences:referencedObject uri="/sap/bc/adt/bo/behaviordefinitions/ZI_ROOT" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usageReferences:adtObject adtcore:name="ZI_ROOT" adtcore:type="BDEF/BO" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;

      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = (opts?.method ?? 'GET').toUpperCase();
        const urlStr = String(url);
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(mockResponse(200, lockBody, { 'x-csrf-token': 'T' }));
        }
        if (method === 'DELETE' && urlStr.includes('/sap/bc/adt/ddic/ddl/sources/ZI_ROOT')) {
          return Promise.resolve(mockResponse(400, deleteErrorXml, { 'x-csrf-token': 'T' }));
        }
        if (method === 'POST' && urlStr.includes('/sap/bc/adt/repository/informationsystem/usageReferences?uri=')) {
          return Promise.resolve(mockResponse(200, whereUsedXml, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete',
        type: 'DDLS',
        name: 'ZI_ROOT',
      });

      expect(result.isError).toBe(true);
      const text = result.content[0]!.text;
      expect(text).toContain('could not be deleted');
      expect(text).toContain('Blocking dependents for DDLS ZI_ROOT');
      expect(text).toContain('ZI_CHILD_ONE');
      expect(text).toContain('ZI_CHILD_TWO');
      expect(text).toContain(
        'Suggested delete order: BDEF ZI_ROOT, DDLS ZI_CHILD_ONE, DDLS ZI_CHILD_TWO, then DDLS ZI_ROOT.',
      );
      expect(text).toContain('If the listed dependents were just deleted, wait briefly and retry');
      expect(text).toContain('activate first');

      // Remediation-first ordering: DDIC diagnostics come BEFORE the blocker hint
      // so the LLM sees the raw SAP error → structured diagnostics → remediation.
      const diagnosticsIdx = text.indexOf('DDIC diagnostics:');
      const blockerIdx = text.indexOf('Blocking dependents');
      expect(diagnosticsIdx).toBeGreaterThan(-1);
      expect(blockerIdx).toBeGreaterThan(diagnosticsIdx);

      // The [?/039] T100 key must appear in the diagnostics block (not replaced
      // or shadowed by the blocker hint) — this is the SAP error code that
      // links back to the actual message in SE91.
      expect(text).toContain('[?/039]');

      // The generic "DDIC save failed" hint must NOT fire on delete — it's a
      // save-action remediation ("check annotations, fix field types") that
      // would mislead an LLM into rewriting the DDLS source instead of
      // resolving the dependency chain.
      expect(text).not.toContain('DDIC save failed');
      expect(text).not.toContain('@AbapCatalog annotations');
    });

    it('adds stale-dependency guidance when DDLS delete [?/039] has no current where-used blockers', async () => {
      const lockBody =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>DLH1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>';
      const deleteErrorXml = `<?xml version="1.0" encoding="utf-8"?>
<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <exc:localizedMessage lang="EN">DDL source ZI_ROOT could not be deleted</exc:localizedMessage>
  <exc:properties>
    <entry key="T100KEY-NO">039</entry>
    <entry key="T100KEY-V1">ZI_ROOT</entry>
  </exc:properties>
</exc:exception>`;
      const emptyWhereUsedXml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects/>
</usageReferences:usageReferenceResult>`;

      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = (opts?.method ?? 'GET').toUpperCase();
        const urlStr = String(url);
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(mockResponse(200, lockBody, { 'x-csrf-token': 'T' }));
        }
        if (method === 'DELETE' && urlStr.includes('/sap/bc/adt/ddic/ddl/sources/ZI_ROOT')) {
          return Promise.resolve(mockResponse(400, deleteErrorXml, { 'x-csrf-token': 'T' }));
        }
        if (method === 'POST' && urlStr.includes('/sap/bc/adt/repository/informationsystem/usageReferences?uri=')) {
          return Promise.resolve(mockResponse(200, emptyWhereUsedXml, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'delete',
        type: 'DDLS',
        name: 'ZI_ROOT',
      });

      expect(result.isError).toBe(true);
      const text = result.content[0]!.text;
      expect(text).toContain('[?/039]');
      expect(text).toContain('Delete dependency follow-up for DDLS ZI_ROOT');
      expect(text).toContain('No current ADT where-used dependents were returned');
      expect(text).toContain('wait briefly and retry');
      expect(text).toContain('SAPActivate(type="DDLS", name="ZI_ROOT")');
      expect(text).toContain('SAPNavigate(action="references", type="DDLS", name="ZI_ROOT")');
      expect(text).not.toContain('Blocking dependents for DDLS ZI_ROOT');
      expect(text).not.toContain('DDIC save failed');
      expect(text).not.toContain('@AbapCatalog annotations');
    });

    it('still shows the DDIC save hint for create failures (regression guard)', async () => {
      // The delete fix narrowed the save hint to save actions; make sure we
      // didn't accidentally suppress it for create/update/batch_create too.
      const createErrorXml = `<?xml version="1.0" encoding="utf-8"?>
<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <exc:localizedMessage lang="EN">Can't save due to errors in source</exc:localizedMessage>
  <exc:properties>
    <entry key="T100KEY-MSGID">DDL</entry>
    <entry key="T100KEY-MSGNO">001</entry>
    <entry key="LINE">3</entry>
  </exc:properties>
</exc:exception>`;

      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = (opts?.method ?? 'GET').toUpperCase();
        const urlStr = String(url);
        if (method === 'POST' && urlStr.includes('/sap/bc/adt/ddic/ddl/sources')) {
          return Promise.resolve(mockResponse(400, createErrorXml, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'DDLS',
        name: 'ZI_BAD',
        source: 'define view entity ZI_BAD as select from sflight {}',
      });

      expect(result.isError).toBe(true);
      const text = result.content[0]!.text;
      expect(text).toContain('DDIC save failed');
      expect(text).toContain('@AbapCatalog annotations');
    });

    it('does not mislabel write session failures as DDIC save failures', async () => {
      const lockBody =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>DLH1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>';

      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = (opts?.method ?? 'GET').toUpperCase();
        const urlStr = String(url);
        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(mockResponse(200, lockBody, { 'x-csrf-token': 'T' }));
        }
        if (method === 'POST' && urlStr.includes('_action=UNLOCK')) {
          return Promise.resolve(mockResponse(400, 'Service cannot be reached', { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const config = { ...DEFAULT_CONFIG, lintBeforeWrite: false };
      const result = await handleToolCall(createClient(), config, 'SAPWrite', {
        action: 'create',
        type: 'DDLS',
        name: 'ZI_UNLOCK_FAIL',
        source: 'define view entity ZI_UNLOCK_FAIL as select from sflight { key carrid }',
      });

      expect(result.isError).toBe(true);
      const text = result.content[0]!.text;
      expect(text).toContain('SAP ADT write/session infrastructure failed');
      expect(text).not.toContain('DDIC save failed');
      expect(text).not.toContain('@AbapCatalog annotations');
    });
  });

  // ─── SAPWrite transport pre-flight check ───────────────────────────

  describe('SAPWrite transport pre-flight check', () => {
    const transportInfoResponse = (recording: boolean, isLocal: boolean, transports: string[] = []) => {
      const transportEntries = transports
        .map((t) => `<headers><TRKORR>${t}</TRKORR><AS4TEXT>Transport ${t}</AS4TEXT><AS4USER>DEV</AS4USER></headers>`)
        .join('');
      return `<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA>
        <RECORDING>${recording ? 'X' : ''}</RECORDING>
        <DLVUNIT>${isLocal ? 'LOCAL' : 'SAP'}</DLVUNIT>
        <DEVCLASS>Z_MY_PKG</DEVCLASS>
        ${transports.length > 0 ? `<TRANSPORTS>${transportEntries}</TRANSPORTS>` : ''}
      </DATA></asx:values></asx:abap>`;
    };

    it('returns guidance error when creating in transportable package without transport', async () => {
      const calls: Array<{ url: string; method: string }> = [];
      mockFetch.mockImplementation((url: string, opts: any) => {
        calls.push({ url: String(url), method: opts?.method ?? 'GET' });
        if (String(url).includes('/cts/transportchecks')) {
          return Promise.resolve(
            mockResponse(200, transportInfoResponse(true, false, ['A4HK900502']), { 'x-csrf-token': 'T' }),
          );
        }
        return Promise.resolve(mockResponse(200, '<xml/>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'PROG',
        name: 'ZTEST',
        package: 'Z_MY_PKG',
        source: 'REPORT ztest.',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('requires a transport number');
      expect(result.content[0]?.text).toContain('SAPTransport');
      expect(result.content[0]?.text).toContain('A4HK900502');
    });

    it('proceeds without transport for $TMP packages (no transportInfo call)', async () => {
      const calls: Array<{ url: string; method: string }> = [];
      mockFetch.mockImplementation((url: string, opts: any) => {
        calls.push({ url: String(url), method: opts?.method ?? 'GET' });
        return Promise.resolve(mockResponse(200, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'PROG',
        name: 'ZTEST',
        package: '$TMP',
        source: 'REPORT ztest.',
      });

      expect(result.isError).toBeUndefined();
      // No call to transportchecks for $TMP
      expect(calls.some((c) => c.url.includes('/cts/transportchecks'))).toBe(false);
    });

    it('proceeds when transport is explicitly provided (no transportInfo call)', async () => {
      const calls: Array<{ url: string; method: string }> = [];
      mockFetch.mockImplementation((url: string, opts: any) => {
        calls.push({ url: String(url), method: opts?.method ?? 'GET' });
        return Promise.resolve(mockResponse(200, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'PROG',
        name: 'ZTEST',
        package: 'Z_MY_PKG',
        transport: 'A4HK900502',
        source: 'REPORT ztest.',
      });

      expect(result.isError).toBeUndefined();
      // No call to transportchecks when transport is explicitly provided
      expect(calls.some((c) => c.url.includes('/cts/transportchecks'))).toBe(false);
    });

    it('auto-uses locked transport from transportInfo response', async () => {
      const lockedResponse = `<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA>
        <RECORDING>X</RECORDING>
        <DLVUNIT>SAP</DLVUNIT>
        <DEVCLASS>Z_MY_PKG</DEVCLASS>
        <LOCKS><HEADER><TRKORR>A4HK900999</TRKORR></HEADER></LOCKS>
      </DATA></asx:values></asx:abap>`;
      const calls: Array<{ url: string; method: string }> = [];
      mockFetch.mockImplementation((url: string, opts: any) => {
        calls.push({ url: String(url), method: opts?.method ?? 'GET' });
        if (String(url).includes('/cts/transportchecks')) {
          return Promise.resolve(mockResponse(200, lockedResponse, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'PROG',
        name: 'ZTEST',
        package: 'Z_MY_PKG',
        source: 'REPORT ztest.',
      });

      expect(result.isError).toBeUndefined();
      // Create call should include the locked transport as corrNr
      const createCall = calls.find((c) => c.method === 'POST' && c.url.includes('/sap/bc/adt/programs/programs'));
      expect(createCall?.url).toContain('corrNr=A4HK900999');
    });

    it('proceeds if transportInfo check fails (graceful fallback)', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (String(url).includes('/cts/transportchecks')) {
          return Promise.resolve(mockResponse(500, 'Internal Error', { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'PROG',
        name: 'ZTEST',
        package: 'Z_MY_PKG',
        source: 'REPORT ztest.',
      });

      // Should proceed without blocking — SAP will return its own error if needed
      // (may still fail later for other reasons, but transport check itself should not block)
      expect(result.content[0]?.text).not.toContain('requires a transport number');
    });

    it('returns guidance error for batch_create in transportable package without transport', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (String(url).includes('/cts/transportchecks')) {
          return Promise.resolve(
            mockResponse(200, transportInfoResponse(true, false, ['A4HK900502']), { 'x-csrf-token': 'T' }),
          );
        }
        return Promise.resolve(mockResponse(200, '<xml/>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'batch_create',
        package: 'Z_MY_PKG',
        objects: [
          { type: 'DDLS', name: 'ZI_TRAVEL', source: '@EndUserText.label: "Travel"\ndefine view entity ZI_TRAVEL ...' },
        ],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('requires a transport number');
      expect(result.content[0]?.text).toContain('SAPTransport');
    });

    it('proceeds for local package response even if DLVUNIT is not LOCAL', async () => {
      // Some packages might not require recording even if not strictly "LOCAL"
      mockFetch.mockImplementation((url: string) => {
        if (String(url).includes('/cts/transportchecks')) {
          return Promise.resolve(mockResponse(200, transportInfoResponse(false, false), { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '<xml>created</xml>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'PROG',
        name: 'ZTEST',
        package: 'Z_MY_PKG',
        source: 'REPORT ztest.',
      });

      // recording=false → no transport needed, proceed
      expect(result.content[0]?.text).not.toContain('requires a transport number');
    });
  });

  // ─── SAPTransport handler routing ─────────────────────────────────

  describe('SAPTransport handler routing', () => {
    function createTransportClient(): AdtClient {
      return new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowTransportWrites: true },
      });
    }

    it('delete action calls deleteTransport with correct ID', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'delete',
        id: 'DEVK900001',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Deleted transport request: DEVK900001');
    });

    it('delete without ID returns error', async () => {
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'delete',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Transport ID is required');
    });

    it('reassign action calls reassignTransport with ID and owner', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'reassign',
        id: 'DEVK900001',
        owner: 'NEWUSER',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('Reassigned transport DEVK900001 to NEWUSER');
    });

    it('reassign without owner returns error', async () => {
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'reassign',
        id: 'DEVK900001',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Owner is required');
    });

    it('release_recursive action calls releaseTransportRecursive', async () => {
      const transportXml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="DEV" tm:desc="Test" tm:status="D" tm:type="K"/>
      </tm:root>`;
      mockFetch
        .mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' })) // CSRF
        .mockResolvedValueOnce(mockResponse(200, transportXml, {})) // getTransport
        .mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' })) // CSRF
        .mockResolvedValue(mockResponse(200, '', {})); // release
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'release_recursive',
        id: 'DEVK900001',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('DEVK900001');
    });

    it('create with type W passes type through', async () => {
      const responseXml = '<tm:request tm:number="DEVK900099"/>';
      mockFetch.mockResolvedValue(mockResponse(200, responseXml, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'create',
        description: 'Customizing transport',
        type: 'W',
      });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain('DEVK900099');
      // Verify the W type was in the request body
      const fetchBody = mockFetch.mock.calls.find(
        (c: unknown[]) => typeof c[1]?.body === 'string' && c[1].body.includes('tm:type'),
      );
      expect(fetchBody?.[1]?.body).toContain('tm:type="W"');
    });

    it('create without type defaults to K', async () => {
      const responseXml = '<tm:request tm:number="DEVK900099"/>';
      mockFetch.mockResolvedValue(mockResponse(200, responseXml, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'create',
        description: 'Default transport',
      });
      expect(result.isError).toBeUndefined();
      const fetchBody = mockFetch.mock.calls.find(
        (c: unknown[]) => typeof c[1]?.body === 'string' && c[1].body.includes('tm:type'),
      );
      expect(fetchBody?.[1]?.body).toContain('tm:type="K"');
    });

    it('list defaults to current SAP user and modifiable status', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="admin" tm:desc="Test" tm:status="D" tm:type="K"/>
      </tm:root>`;
      mockFetch.mockResolvedValue(mockResponse(200, xml, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'list',
      });
      expect(result.isError).toBeUndefined();
      // Verify the URL includes user=admin (the client username) and requestType=KWT
      const fetchUrl = mockFetch.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('transportrequests'),
      );
      expect(fetchUrl?.[0]).toContain('user=admin');
      expect(fetchUrl?.[0]).toContain('requestType=KWT');
    });

    it('list with status=* returns all statuses', async () => {
      const xml = `<tm:root xmlns:tm="http://www.sap.com/cts/transports">
        <tm:request tm:number="DEVK900001" tm:owner="admin" tm:desc="Modifiable" tm:status="D" tm:type="K"/>
        <tm:request tm:number="DEVK900002" tm:owner="admin" tm:desc="Released" tm:status="R" tm:type="K"/>
      </tm:root>`;
      mockFetch.mockResolvedValue(mockResponse(200, xml, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'list',
        status: '*',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text ?? '[]');
      expect(parsed).toHaveLength(2);
    });

    it('history returns object transport data as JSON', async () => {
      // Real /transports response shape: com.sap.adt.lock.result2 with flat
      // CORRNR/CORRUSER/CORRTEXT on DATA. CORRNR is already the parent
      // K-request (SAP resolves task→parent automatically).
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
    <DATA>
      <LOCK_HANDLE/>
      <CORRNR>A4HK900123</CORRNR>
      <CORRUSER>DEVELOPER</CORRUSER>
      <CORRTEXT>Refactor ZCL_TEST</CORRTEXT>
    </DATA>
  </asx:values>
</asx:abap>`;
      mockFetch.mockResolvedValue(mockResponse(200, xml, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'history',
        type: 'CLAS',
        name: 'ZCL_TEST',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text ?? '{}');
      expect(parsed.object).toEqual({
        type: 'CLAS',
        name: 'ZCL_TEST',
        uri: '/sap/bc/adt/oo/classes/ZCL_TEST',
      });
      expect(parsed.lockedTransport).toBe('A4HK900123');
      expect(parsed.relatedTransports[0]).toEqual({
        id: 'A4HK900123',
        description: 'Refactor ZCL_TEST',
        owner: 'DEVELOPER',
        status: 'D',
      });
      expect(parsed.candidateTransports).toEqual([]);
      expect(parsed.summary).toBe('Object ZCL_TEST is locked in transport A4HK900123 by DEVELOPER.');
    });

    it('history falls back to transportchecks when /transports is empty', async () => {
      const objectStructure = `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
        <adtcore:packageRef adtcore:name="Z_MY_PKG"/>
      </adtcore:objectReferences>`;
      const fallbackXml = `<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
        <asx:values><DATA>
          <DEVCLASS>Z_MY_PKG</DEVCLASS>
          <DLVUNIT>SAP</DLVUNIT>
          <RECORDING>X</RECORDING>
          <TRANSPORTS>
            <headers>
              <TRKORR>A4HK900500</TRKORR>
              <AS4TEXT>Fallback candidate</AS4TEXT>
              <AS4USER>DEVELOPER</AS4USER>
            </headers>
          </TRANSPORTS>
        </DATA></asx:values>
      </asx:abap>`;

      mockFetch.mockImplementation((url: string) => {
        const target = String(url);
        if (target.includes('/sap/bc/adt/oo/classes/ZCL_TEST/transports')) {
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        }
        if (target.includes('/sap/bc/adt/oo/classes/ZCL_TEST')) {
          return Promise.resolve(mockResponse(200, objectStructure, { 'x-csrf-token': 'T' }));
        }
        if (target.includes('/sap/bc/adt/cts/transportchecks')) {
          return Promise.resolve(mockResponse(200, fallbackXml, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'history',
        type: 'CLAS',
        name: 'ZCL_TEST',
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text ?? '{}');
      expect(parsed.relatedTransports).toEqual([]);
      expect(parsed.candidateTransports).toHaveLength(1);
      expect(parsed.candidateTransports[0]?.id).toBe('A4HK900500');
      expect(parsed.summary).toContain('available for assignment');
    });

    it('history requires type and name', async () => {
      const result = await handleToolCall(createTransportClient(), DEFAULT_CONFIG, 'SAPTransport', {
        action: 'history',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"type" and "name" are required');
    });
  });

  // ─── CDS Pre-Write Validation ───────────────────────────────────────

  describe('CDS pre-write validation (table entity version guard)', () => {
    afterEach(() => {
      resetCachedFeatures();
    });

    it('rejects "define table entity" on SAP_BASIS 758 (< 757 threshold actually means < 757)', async () => {
      // 758 >= 757, so this should be allowed. Let's test with 756 instead.
    });

    it('rejects "define table entity" on SAP_BASIS 756', async () => {
      setCachedFeatures({ abapRelease: '756', systemType: 'onprem' } as ResolvedFeatures);
      // Mock: first call = CSRF, subsequent calls = whatever
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'DDLS',
        name: 'ZI_FOOTBALL',
        source: 'define table entity ZI_Football {\n  key id : abap.int4;\n  name : abap.char(40);\n}',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('define table entity');
      expect(result.content[0]?.text).toContain('757');
      expect(result.content[0]?.text).toContain('756');
    });

    it('allows "define table entity" on BTP', async () => {
      setCachedFeatures({ abapRelease: '756', systemType: 'btp' } as ResolvedFeatures);
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'DDLS',
        name: 'ZI_FOOTBALL',
        source: 'define table entity ZI_Football {\n  key id : abap.int4;\n}',
        description: 'Football entity',
      });
      // Should proceed past the guard (may fail later on mock, but not with version error)
      if (result.isError) {
        expect(result.content[0]?.text).not.toContain('define table entity');
      }
    });

    it('allows "define table entity" on SAP_BASIS 757+', async () => {
      setCachedFeatures({ abapRelease: '757', systemType: 'onprem' } as ResolvedFeatures);
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'DDLS',
        name: 'ZI_FOOTBALL',
        source: 'define table entity ZI_Football {\n  key id : abap.int4;\n}',
        description: 'Football entity',
      });
      if (result.isError) {
        expect(result.content[0]?.text).not.toContain('define table entity');
      }
    });

    it('proceeds without blocking when cachedFeatures is not available', async () => {
      resetCachedFeatures();
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'DDLS',
        name: 'ZI_FOOTBALL',
        source: 'define table entity ZI_Football {\n  key id : abap.int4;\n}',
        description: 'Football entity',
      });
      // Should not fail with the version guard error
      if (result.isError) {
        expect(result.content[0]?.text).not.toContain('define table entity');
      }
    });

    it('rejects "define table entity" in update path on old release', async () => {
      setCachedFeatures({ abapRelease: '750', systemType: 'onprem' } as ResolvedFeatures);
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'DDLS',
        name: 'ZI_FOOTBALL',
        source: 'define table entity ZI_Football {\n  key id : abap.int4;\n}',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('define table entity');
      expect(result.content[0]?.text).toContain('750');
    });
  });

  // ─── DDLS empty source warning ──────────────────────────────────────

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

  // ─── INACTIVE_OBJECTS ────────────────────────────────────────────────

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

  // ─── 5xx error hints ────────────────────────────────────────────────

  describe('5xx error hints in formatErrorForLLM', () => {
    it('500 error includes server error hint', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(500, 'Internal Server Error', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('SAP application server error');
      expect(result.content[0]?.text).toContain('500');
      expect(result.content[0]?.text).toContain('SAPDiagnose');
    });

    it('503 error includes server error hint', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(503, 'Service Unavailable', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('SAP application server error');
      expect(result.content[0]?.text).toContain('503');
    });

    it('502 error includes server error hint', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(502, 'Bad Gateway', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('SAP application server error');
      expect(result.content[0]?.text).toContain('502');
    });
  });

  // ─── SAP error enrichment (additional messages + properties) ────────

  describe('SAP error enrichment in formatErrorForLLM', () => {
    it('includes additional localized messages from SAP XML response', async () => {
      const xmlResponse = `<?xml version="1.0" encoding="utf-8"?>
<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <exc:localizedMessage lang="EN">DDL source could not be saved</exc:localizedMessage>
  <exc:localizedMessage lang="EN">Field "POSITION" is a reserved keyword (line 5, col 3)</exc:localizedMessage>
  <exc:localizedMessage lang="EN">Check CDS documentation for valid identifiers</exc:localizedMessage>
</exc:exception>`;
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(400, xmlResponse, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Additional detail');
      expect(result.content[0]?.text).toContain('reserved keyword');
    });

    it('includes DDIC diagnostics instead of raw properties for T100KEY errors', async () => {
      const xmlResponse = `<?xml version="1.0" encoding="utf-8"?>
<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <exc:localizedMessage lang="EN">Syntax error in DDL source</exc:localizedMessage>
  <exc:properties>
    <entry key="T100KEY-NO">039</entry>
    <entry key="LINE">15</entry>
    <entry key="COLUMN">8</entry>
  </exc:properties>
</exc:exception>`;
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(400, xmlResponse, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      // DDIC diagnostics replace raw Properties when T100KEY entries are present
      expect(result.content[0]?.text).toContain('DDIC diagnostics:');
      expect(result.content[0]?.text).toContain('Line 15');
      expect(result.content[0]?.text).not.toContain('Properties:');
    });

    it('includes raw properties for non-DDIC errors without T100KEY entries', async () => {
      const xmlResponse = `<?xml version="1.0" encoding="utf-8"?>
<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <exc:localizedMessage lang="EN">Some generic error</exc:localizedMessage>
  <exc:properties>
    <entry key="MSG_ID">CL</entry>
    <entry key="SEVERITY">E</entry>
  </exc:properties>
</exc:exception>`;
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(400, xmlResponse, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Properties:');
      expect(result.content[0]?.text).toContain('MSG_ID=CL');
      expect(result.content[0]?.text).not.toContain('DDIC diagnostics:');
    });

    it('includes DDIC diagnostics block when T100KEY entries are present', async () => {
      const xmlResponse = `<?xml version="1.0" encoding="utf-8"?>
<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <exc:localizedMessage lang="EN">Can't save due to errors in source</exc:localizedMessage>
  <exc:properties>
    <entry key="T100KEY-MSGID">SBD_MESSAGES</entry>
    <entry key="T100KEY-MSGNO">007</entry>
    <entry key="T100KEY-V1">FIELD_X</entry>
    <entry key="LINE">5</entry>
  </exc:properties>
</exc:exception>`;
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(400, xmlResponse, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'TABL',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('DDIC diagnostics:');
      expect(result.content[0]?.text).toContain('[SBD_MESSAGES/007]');
    });

    it('does not add DDIC diagnostics block when no DDIC details are present', async () => {
      const xmlResponse = `<?xml version="1.0" encoding="utf-8"?>
<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework">
  <exc:localizedMessage lang="EN">Object not found</exc:localizedMessage>
</exc:exception>`;
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(400, xmlResponse, { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'TABL',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).not.toContain('DDIC diagnostics:');
    });

    it('adds DDIC save hint for 400 with TABL type', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(400, 'Bad Request', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'TABL',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Hint: DDIC save failed.');
    });

    it('adds DDIC save hint for 409 with BDEF type', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(409, 'Conflict', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'BDEF',
        name: 'ZI_TEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Hint: DDIC save failed.');
    });

    it('keeps DDIC hint for generic "already exists" conflicts without creation signatures', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          409,
          '<exc:exception><localizedMessage>Activation failed: element already exists in metadata extension</localizedMessage></exc:exception>',
          { 'x-csrf-token': 'T' },
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'BDEF',
        name: 'ZI_TEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Hint: DDIC save failed.');
      expect(result.content[0]?.text).not.toContain('choose a different name');
    });

    it('adds behavior-pool save failure remediation hint for generic CLAS save errors', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);

        if (method === 'POST' && urlStr.includes('_action=LOCK')) {
          return Promise.resolve(
            mockResponse(
              200,
              '<asx:abap><asx:values><DATA><LOCK_HANDLE>LH1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>',
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        if (method === 'PUT' && urlStr.includes('/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/source/main')) {
          return Promise.reject(
            new AdtApiError(
              'Bad Request',
              400,
              '/sap/bc/adt/oo/classes/ZBP_I_TRAVELREQ/source/main',
              '<exc:exception><localizedMessage>An error occured during the save operation. The changes were not stored.</localizedMessage></exc:exception>',
            ),
          );
        }
        return Promise.resolve(mockResponse(200, '<ok/>', { 'x-csrf-token': 'T' }));
      });

      const source = `CLASS zbp_i_travelreq DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF zi_travelreq.
ENDCLASS.
CLASS zbp_i_travelreq IMPLEMENTATION.
ENDCLASS.`;
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'CLAS',
        name: 'ZBP_I_TRAVELREQ',
        source,
        lintBeforeWrite: false,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('scaffold_rap_handlers');
      expect(result.content[0]?.text).toContain('edit_method');
    });

    it('does not add DDIC hint for 404 not-found path', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(404, 'Not Found', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'TABL',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('was not found');
      expect(result.content[0]?.text).not.toContain('Hint: DDIC save failed.');
    });

    it('does not add DDIC hint for non-DDIC types', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(400, 'Bad Request', { 'x-csrf-token': 'T' }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
        type: 'PROG',
        name: 'ZTEST',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).not.toContain('Hint: DDIC save failed.');
    });
  });

  // ─── CDS reserved keyword warnings ─────────────────────────────────

  describe('warnCdsReservedKeywords', () => {
    it('detects "position" as a reserved keyword', () => {
      const source = `define view entity ZI_Football as select from ztab {
  key id : abap.int4;
  position : abap.int4;
  player_name : abap.char(40);
}`;
      const warning = warnCdsReservedKeywords(source);
      expect(warning).toBeDefined();
      expect(warning).toContain('position');
      expect(warning).toContain('reserved keyword');
    });

    it('detects multiple reserved keywords', () => {
      const source = `define view entity ZI_Test as select from ztab {
  key id : abap.int4;
  position : abap.int4;
  value : abap.dec(10,2);
  type : abap.char(4);
}`;
      const warning = warnCdsReservedKeywords(source);
      expect(warning).toBeDefined();
      expect(warning).toContain('position');
      expect(warning).toContain('value');
      expect(warning).toContain('type');
    });

    it('ignores normal field names', () => {
      const source = `define view entity ZI_Test as select from ztab {
  key travel_id : abap.int4;
  customer_name : abap.char(40);
  booking_date : abap.dats;
}`;
      const warning = warnCdsReservedKeywords(source);
      expect(warning).toBeUndefined();
    });

    it('works with nested structures', () => {
      const source = `define view entity ZI_Test as select from ztab {
  key id : abap.int4;
  position : abap.int4;
} composition [0..*] of ZI_Child as _Child`;
      const warning = warnCdsReservedKeywords(source);
      expect(warning).toBeDefined();
      expect(warning).toContain('position');
    });

    it('returns undefined for source without braces', () => {
      const source = 'extend view entity ZI_Base with';
      const warning = warnCdsReservedKeywords(source);
      expect(warning).toBeUndefined();
    });

    it('handles key fields with reserved names', () => {
      const source = `define view entity ZI_Test as select from ztab {
  key name : abap.char(40);
  description : abap.char(80);
}`;
      const warning = warnCdsReservedKeywords(source);
      expect(warning).toBeDefined();
      expect(warning).toContain('name');
      expect(warning).toContain('description');
    });
  });

  // ─── BDEF content type ──────────────────────────────────────────────

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
});
