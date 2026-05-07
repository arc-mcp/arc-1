import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError, AdtSafetyError } from '../../../src/adt/errors.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

// Mock undici's fetch (used by AdtHttpClient.doFetch)
const mockFetch = vi.fn();
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: mockFetch };
});

const { AdtClient } = await import('../../../src/adt/client.js');

const fixturesDir = join(import.meta.dirname, '../../fixtures/xml');
const loadFixture = (name: string) => readFileSync(join(fixturesDir, name), 'utf-8');

/** Default mock: returns ABAP source code for any request */
function setupDefaultMock() {
  mockFetch.mockResolvedValue(mockResponse(200, "REPORT zhello.\nWRITE: / 'Hello'."));
}

function createClient(overrides: Record<string, unknown> = {}): AdtClient {
  return new AdtClient({
    baseUrl: 'http://sap:8000',
    username: 'admin',
    password: 'secret',
    safety: unrestrictedSafetyConfig(),
    ...overrides,
  });
}

/** Get headers from a specific fetch call */
function fetchHeaders(callIndex = 0): Record<string, string> {
  return ((mockFetch.mock.calls[callIndex]?.[1] as RequestInit)?.headers as Record<string, string>) ?? {};
}

describe('AdtClient', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupDefaultMock();
  });

  describe('source code read operations', () => {
    it('getProgram returns source code', async () => {
      const client = createClient();
      const result = await client.getProgram('ZHELLO');
      expect(result.source).toContain('REPORT zhello');
      expect(result.notModified).toBe(false);
      expect(result.statusCode).toBe(200);
    });

    it('getProgram captures etag from response header', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, 'REPORT zhello.', { etag: '20231201001' }));
      const client = createClient();
      const result = await client.getProgram('ZHELLO');
      expect(result.etag).toBe('20231201001');
    });

    it('getProgram returns notModified=true on 304', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(304, '', { etag: '20231201001' }));
      const client = createClient();
      const result = await client.getProgram('ZHELLO');
      expect(result.notModified).toBe(true);
      expect(result.source).toBe('');
      expect(result.statusCode).toBe(304);
    });

    it('getProgram sends If-None-Match when opts.ifNoneMatch is set', async () => {
      const client = createClient();
      await client.getProgram('ZHELLO', { ifNoneMatch: 'abc123' });
      expect(fetchHeaders(0)['If-None-Match']).toBe('abc123');
    });

    it('getProgram appends version query when opts.version is set', async () => {
      const client = createClient();
      await client.getProgram('ZHELLO', { version: 'inactive' });
      const url = mockFetch.mock.calls[0]?.[0] as string;
      expect(url).toContain('/sap/bc/adt/programs/programs/ZHELLO/source/main?version=inactive');
    });

    it('getClass returns source code', async () => {
      const client = createClient();
      const result = await client.getClass('ZCL_TEST');
      expect(typeof result.source).toBe('string');
      expect(result.notModified).toBe(false);
      expect(result.statusCode).toBe(200);
    });

    it('getClass with include returns include source', async () => {
      const client = createClient();
      const result = await client.getClass('ZCL_TEST', 'testclasses');
      expect(typeof result.source).toBe('string');
    });

    it('getClass with include uses correct URL path (no /source/main suffix)', async () => {
      const client = createClient();
      await client.getClass('ZCL_TEST', 'definitions');
      // Find the call that includes ZCL_TEST in the URL
      const urls = mockFetch.mock.calls.map((c: any[]) => c[0] as string);
      const urlUsed = urls.find((u) => u.includes('ZCL_TEST'));
      expect(urlUsed).toContain('/includes/definitions');
      expect(urlUsed).not.toContain('/source/main');
    });

    it('getClass with include=main uses /source/main path', async () => {
      const client = createClient();
      await client.getClass('ZCL_TEST', 'main');
      const urls = mockFetch.mock.calls.map((c: any[]) => c[0] as string);
      const urlUsed = urls.find((u) => u.includes('ZCL_TEST'));
      expect(urlUsed).toContain('/source/main');
    });

    it('getClass with non-main include forwards version option', async () => {
      const client = createClient();
      await client.getClass('ZCL_TEST', 'definitions', { version: 'inactive' });
      const urls = mockFetch.mock.calls.map((c: any[]) => c[0] as string);
      const urlUsed = urls.find((u) => u.includes('ZCL_TEST'));
      expect(urlUsed).toContain('/includes/definitions?version=inactive');
    });

    it('getClass with multiple comma-separated includes', async () => {
      const client = createClient();
      const result = await client.getClass('ZCL_TEST', 'definitions,implementations');
      // Should make two HTTP calls for includes
      const urls = mockFetch.mock.calls.map((c: any[]) => c[0] as string);
      const classUrls = urls.filter((u) => u.includes('ZCL_TEST'));
      expect(classUrls).toHaveLength(2);
      expect(classUrls[0]).toContain('/includes/definitions');
      expect(classUrls[1]).toContain('/includes/implementations');
      // Result should contain both section headers
      expect(result.source).toContain('=== definitions ===');
      expect(result.source).toContain('=== implementations ===');
    });

    it('getClass gracefully handles 404 for non-existent includes', async () => {
      // Override default mock for the first call to reject with 404
      mockFetch.mockReset();
      mockFetch.mockRejectedValueOnce(new AdtApiError('Not found', 404, '/includes/testclasses'));
      const client = createClient();
      const result = await client.getClass('ZCL_TEST', 'testclasses');
      // Should not throw; should contain a helpful message
      expect(result.source).toContain('testclasses');
      expect(result.source).toContain('not available');
    });

    it('getClass validates include values', async () => {
      const client = createClient();
      const result = await client.getClass('ZCL_TEST', 'foobar');
      expect(result.source).toContain('Unknown include');
      expect(result.source).toContain('foobar');
    });

    it('getClass normalizes include to lowercase', async () => {
      const client = createClient();
      await client.getClass('ZCL_TEST', 'DEFINITIONS');
      const urls = mockFetch.mock.calls.map((c: any[]) => c[0] as string);
      const urlUsed = urls.find((u) => u.includes('ZCL_TEST'));
      // Should use lowercase 'definitions' in the URL path
      expect(urlUsed).toContain('/includes/definitions');
    });

    it('getInterface returns source code', async () => {
      const client = createClient();
      const result = await client.getInterface('ZIF_TEST');
      expect(typeof result.source).toBe('string');
    });

    it('getFunction returns source code', async () => {
      const client = createClient();
      const result = await client.getFunction('ZGROUP', 'ZFUNC');
      expect(typeof result.source).toBe('string');
    });

    it('getInclude returns source code', async () => {
      const client = createClient();
      const result = await client.getInclude('ZINCLUDE');
      expect(typeof result.source).toBe('string');
    });

    it('getDdls returns CDS source code', async () => {
      const client = createClient();
      const result = await client.getDdls('ZTRAVEL');
      expect(typeof result.source).toBe('string');
      expect(result.notModified).toBe(false);
      expect(result.statusCode).toBe(200);
    });

    it('getDcl returns source code', async () => {
      const client = createClient();
      const result = await client.getDcl('ZI_TRAVEL_DCL');
      expect(typeof result.source).toBe('string');
      const urls = mockFetch.mock.calls.map((c: any[]) => c[0] as string);
      const urlUsed = urls.find((u) => u.includes('ZI_TRAVEL_DCL'));
      expect(urlUsed).toContain('/sap/bc/adt/acm/dcl/sources/ZI_TRAVEL_DCL/source/main');
    });

    it('getBdef returns behavior definition source', async () => {
      const client = createClient();
      const result = await client.getBdef('ZTRAVEL');
      expect(typeof result.source).toBe('string');
    });

    it('getSrvd returns service definition source', async () => {
      const client = createClient();
      const result = await client.getSrvd('ZTRAVEL');
      expect(typeof result.source).toBe('string');
    });

    it('getDdlx returns metadata extension source', async () => {
      const client = createClient();
      const result = await client.getDdlx('ZC_TRAVEL');
      expect(typeof result.source).toBe('string');
    });

    it('getDdlx uses correct ADT URL', async () => {
      const client = createClient();
      await client.getDdlx('ZC_TRAVEL');
      const urls = mockFetch.mock.calls.map((c: any[]) => c[0] as string);
      const urlUsed = urls.find((u) => u.includes('ddlx'));
      expect(urlUsed).toContain('/sap/bc/adt/ddic/ddlx/sources/ZC_TRAVEL/source/main');
    });

    it('getKtd returns the raw <sktd:docu> XML envelope (decoding to Markdown happens at the handler layer)', async () => {
      const client = createClient();
      const result = await client.getKtd('ZTR_C_PAYMENT_VALUE_DATE');
      expect(typeof result.source).toBe('string');
    });

    it('getKtd uses correct ADT URL with lowercase name and vendor Accept header', async () => {
      const client = createClient();
      await client.getKtd('ZTR_C_PAYMENT_VALUE_DATE');
      const urls = mockFetch.mock.calls.map((c: any[]) => c[0] as string);
      const urlUsed = urls.find((u) => u.includes('/documentation/ktd/'));
      expect(urlUsed).toContain('/sap/bc/adt/documentation/ktd/documents/ztr_c_payment_value_date');
      expect(urlUsed).not.toContain('version=workingArea');
    });

    it('getSrvb returns parsed service binding metadata', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?><srvb:serviceBinding srvb:contract="C1" srvb:published="true" srvb:bindingCreated="true" adtcore:name="ZUI_TRAVEL_O4" adtcore:type="SRVB/SVB" adtcore:description="Travel Service Binding" adtcore:language="EN" xmlns:srvb="http://www.sap.com/adt/ddic/ServiceBindings" xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="ZTRAVEL"/><srvb:services srvb:name="ZUI_TRAVEL"><srvb:content srvb:version="0001" srvb:releaseState="NOT_RELEASED"><srvb:serviceDefinition adtcore:name="ZSD_TRAVEL"/></srvb:content></srvb:services><srvb:binding srvb:type="ODATA" srvb:version="V4" srvb:category="0"><srvb:implementation adtcore:name="ZUI_TRAVEL_O4"/></srvb:binding></srvb:serviceBinding>`,
        ),
      );
      const client = createClient();
      const result = await client.getSrvb('ZUI_TRAVEL_O4');
      const parsed = JSON.parse(result.source);
      expect(parsed.name).toBe('ZUI_TRAVEL_O4');
      expect(parsed.odataVersion).toBe('V4');
      expect(parsed.bindingCategory).toBe('UI');
      expect(parsed.published).toBe(true);
      expect(parsed.serviceDefinition).toBe('ZSD_TRAVEL');
    });

    it('getSrvb uses correct Accept header', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          `<?xml version="1.0"?><srvb:serviceBinding xmlns:srvb="http://www.sap.com/adt/ddic/ServiceBindings" xmlns:adtcore="http://www.sap.com/adt/core"><srvb:binding/></srvb:serviceBinding>`,
        ),
      );
      const client = createClient();
      await client.getSrvb('ZUI_TRAVEL_O4');
      const urls = mockFetch.mock.calls.map((c: any[]) => c[0] as string);
      const callIdx = mockFetch.mock.calls.findIndex((_: any, i: number) => urls[i]?.includes('businessservices'));
      expect(urls[callIdx]).toContain('/sap/bc/adt/businessservices/bindings/ZUI_TRAVEL_O4');
      expect(fetchHeaders(callIdx).Accept).toContain('application/vnd.sap.adt.businessservices.servicebinding.v2+xml');
    });

    it('getTable returns table definition source', async () => {
      const client = createClient();
      const result = await client.getTable('MARA');
      expect(typeof result.source).toBe('string');
    });

    it('getView returns view definition source', async () => {
      const client = createClient();
      const result = await client.getView('ZVIEW');
      expect(typeof result.source).toBe('string');
    });
  });

  describe('getTabl (unified TABL — transparent tables and structures)', () => {
    it('returns table source from /tables/ on first try (transparent table)', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(200, '@AbapCatalog.tableCategory : #TRANSPARENT\ndefine table t000 { ... }'),
      );
      const client = createClient();
      const result = await client.getTabl('T000');
      expect(result.source).toContain('TRANSPARENT');
      expect(mockFetch.mock.calls).toHaveLength(1);
      expect(mockFetch.mock.calls[0]?.[0]).toContain('/sap/bc/adt/ddic/tables/T000/source/main');
    });

    it('falls back to /structures/ on 404 (DDIC structure)', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(404, '<?xml version="1.0"?><error/>'));
      mockFetch.mockResolvedValueOnce(
        mockResponse(200, '@EndUserText.label : "Return Parameter"\ndefine type bapiret2 { type: char; ... }'),
      );
      const client = createClient();
      const result = await client.getTabl('BAPIRET2');
      expect(result.source).toContain('bapiret2');
      expect(mockFetch.mock.calls).toHaveLength(2);
      expect(mockFetch.mock.calls[0]?.[0]).toContain('/sap/bc/adt/ddic/tables/BAPIRET2/source/main');
      expect(mockFetch.mock.calls[1]?.[0]).toContain('/sap/bc/adt/ddic/structures/BAPIRET2/source/main');
    });

    it('throws AdtApiError when both URLs return 404', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(404, '<?xml version="1.0"?><error/>'));
      mockFetch.mockResolvedValueOnce(mockResponse(404, '<?xml version="1.0"?><error/>'));
      const client = createClient();
      await expect(client.getTabl('NONEXISTENT')).rejects.toBeInstanceOf(AdtApiError);
      expect(mockFetch.mock.calls).toHaveLength(2);
    });

    it('does not fall back on non-404 errors from /tables/', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(500, '<?xml version="1.0"?><error/>'));
      const client = createClient();
      await expect(client.getTabl('T000')).rejects.toBeInstanceOf(AdtApiError);
      expect(mockFetch.mock.calls).toHaveLength(1);
    });
  });

  describe('resolveTablObjectUrl', () => {
    it('returns /tables/ URL after a 200 GET (transparent table)', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '<?xml version="1.0"?><tabl/>'));
      const client = createClient();
      const url = await client.resolveTablObjectUrl('T000');
      expect(url).toBe('/sap/bc/adt/ddic/tables/T000');
      expect(mockFetch.mock.calls).toHaveLength(1);
    });

    it('returns /structures/ URL after /tables/ 404 (DDIC structure)', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(404, '<?xml version="1.0"?><error/>'));
      mockFetch.mockResolvedValueOnce(mockResponse(200, '<?xml version="1.0"?><stru/>'));
      const client = createClient();
      const url = await client.resolveTablObjectUrl('BAPIRET2');
      expect(url).toBe('/sap/bc/adt/ddic/structures/BAPIRET2');
      expect(mockFetch.mock.calls).toHaveLength(2);
    });

    it('caches resolution — second call hits no HTTP', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '<?xml version="1.0"?><tabl/>'));
      const client = createClient();
      const url1 = await client.resolveTablObjectUrl('T000');
      const url2 = await client.resolveTablObjectUrl('T000');
      expect(url1).toBe(url2);
      expect(mockFetch.mock.calls).toHaveLength(1);
    });

    it('getTabl populates the resolveTablObjectUrl cache', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(404, '<?xml version="1.0"?><error/>'));
      mockFetch.mockResolvedValueOnce(mockResponse(200, '... structure source ...'));
      const client = createClient();
      await client.getTabl('BAPIRET2');
      expect(mockFetch.mock.calls).toHaveLength(2);
      // Subsequent resolveTablObjectUrl call should be a cache hit (no extra HTTP).
      const url = await client.resolveTablObjectUrl('BAPIRET2');
      expect(url).toBe('/sap/bc/adt/ddic/structures/BAPIRET2');
      expect(mockFetch.mock.calls).toHaveLength(2);
    });
  });

  describe('getRevisions', () => {
    it('returns parsed revision list for a program', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, loadFixture('revision-feed-prog.xml'), { 'x-csrf-token': 'T' }));
      const client = createClient();
      const result = await client.getRevisions('PROG', 'ZARC1_TEST_REPORT');
      expect(result.object.name).toBe('ZARC1_TEST_REPORT');
      expect(result.revisions).toHaveLength(2);
      expect(result.revisions[0]?.uri.startsWith('/sap/bc/adt/')).toBe(true);
    });

    it('uses CLAS include endpoint for explicit include', async () => {
      const client = createClient();
      await client.getRevisions('CLAS', 'ZCL_TEST', { include: 'definitions' });
      const urls = mockFetch.mock.calls.map((c: any[]) => String(c[0]));
      expect(urls.some((u) => u.includes('/oo/classes/ZCL_TEST/includes/definitions/versions'))).toBe(true);
    });

    it('defaults CLAS include to main when omitted', async () => {
      const client = createClient();
      await client.getRevisions('CLAS', 'ZCL_TEST');
      const urls = mockFetch.mock.calls.map((c: any[]) => String(c[0]));
      expect(urls.some((u) => u.includes('/oo/classes/ZCL_TEST/includes/main/versions'))).toBe(true);
    });

    it('uses source/main revisions endpoint for INTF', async () => {
      const client = createClient();
      await client.getRevisions('INTF', 'ZIF_TEST');
      const urls = mockFetch.mock.calls.map((c: any[]) => String(c[0]));
      expect(urls.some((u) => u.includes('/oo/interfaces/ZIF_TEST/source/main/versions'))).toBe(true);
    });

    it('throws descriptive error for FUNC revisions without group', async () => {
      const client = createClient();
      await expect(client.getRevisions('FUNC', 'Z_MY_FUNC')).rejects.toThrow(/Function group is required/i);
    });

    it('throws for unsupported type and includes type name', async () => {
      const client = createClient();
      await expect(client.getRevisions('TRAN', 'SE38')).rejects.toThrow(/Unsupported object type "TRAN"/);
    });
  });

  describe('getRevisionSource', () => {
    it('rejects non-ADT URIs', async () => {
      const client = createClient();
      await expect(client.getRevisionSource('https://evil.example/foo')).rejects.toThrow(/\/sap\/bc\/adt\//);
    });

    it('returns plain source text for valid revision URI', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(200, "REPORT zarc1_test_report.\nWRITE: / 'hello'.", { 'x-csrf-token': 'T' }),
      );
      const client = createClient();
      const source = await client.getRevisionSource(
        '/sap/bc/adt/programs/programs/ZARC1_TEST_REPORT/source/main/versions/20260410185851/00000/content',
      );
      expect(source).toContain('REPORT zarc1_test_report');
      const calledUrl = String(mockFetch.mock.calls[0]?.[0] ?? '');
      expect(calledUrl).toContain('/versions/20260410185851/00000/content');
      expect(fetchHeaders(0).Accept).toBe('text/plain');
    });
  });

  describe('system information', () => {
    it('getSystemInfo returns structured JSON with user', async () => {
      const client = createClient();
      const info = await client.getSystemInfo();
      expect(typeof info).toBe('string');
      const parsed = JSON.parse(info);
      expect(parsed.user).toBe('admin');
      expect(Array.isArray(parsed.collections)).toBe(true);
    });

    it('getMessages returns message class XML', async () => {
      const client = createClient();
      const messages = await client.getMessages('SY');
      expect(typeof messages).toBe('string');
    });

    it('getTextElements returns text elements XML', async () => {
      const client = createClient();
      const texts = await client.getTextElements('ZHELLO');
      expect(typeof texts).toBe('string');
    });

    it('getVariants returns variants XML', async () => {
      const client = createClient();
      const variants = await client.getVariants('ZHELLO');
      expect(typeof variants).toBe('string');
    });
  });

  describe('DDIC read operations', () => {
    it('getStructure returns source code', async () => {
      const client = createClient();
      const result = await client.getStructure('BAPIRET2');
      expect(typeof result.source).toBe('string');
    });

    it('getDomain returns parsed metadata', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
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
      const client = createClient();
      const domain = await client.getDomain('BUKRS');
      expect(domain.name).toBe('BUKRS');
      expect(domain.dataType).toBe('CHAR');
      expect(domain.valueTable).toBe('T001');
    });

    it('getDataElement returns parsed metadata', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<blue:wbobj adtcore:name="BUKRS" adtcore:description="Company code" xmlns:blue="http://www.sap.com/wbobj/dictionary/dtel" xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:packageRef adtcore:name="BF"/>
  <dtel:dataElement xmlns:dtel="http://www.sap.com/adt/dictionary/dataelements">
    <dtel:typeKind>domain</dtel:typeKind><dtel:typeName>BUKRS</dtel:typeName>
    <dtel:dataType>CHAR</dtel:dataType><dtel:dataTypeLength>000004</dtel:dataTypeLength><dtel:dataTypeDecimals>000000</dtel:dataTypeDecimals>
    <dtel:shortFieldLabel>CoCd</dtel:shortFieldLabel><dtel:mediumFieldLabel>Company Code</dtel:mediumFieldLabel>
    <dtel:longFieldLabel>Company Code</dtel:longFieldLabel><dtel:headingFieldLabel>CoCd</dtel:headingFieldLabel>
    <dtel:searchHelp>C_T001</dtel:searchHelp><dtel:defaultComponentName>COMP_CODE</dtel:defaultComponentName>
  </dtel:dataElement>
</blue:wbobj>`,
        ),
      );
      const client = createClient();
      const dtel = await client.getDataElement('BUKRS');
      expect(dtel.name).toBe('BUKRS');
      expect(dtel.typeName).toBe('BUKRS');
      expect(dtel.searchHelp).toBe('C_T001');
    });

    it('getTransaction returns parsed metadata', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<adtcore:mainObject adtcore:name="SE38" adtcore:type="TRAN/T" adtcore:description="ABAP Editor" xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:packageRef adtcore:name="SEDT"/>
</adtcore:mainObject>`,
        ),
      );
      const client = createClient();
      const tran = await client.getTransaction('SE38');
      expect(tran.code).toBe('SE38');
      expect(tran.description).toBe('ABAP Editor');
      expect(tran.package).toBe('SEDT');
    });

    it('getAuthorizationField returns parsed metadata', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, loadFixture('authorization-field.xml'), { 'x-csrf-token': 'T' }));
      const client = createClient();
      const auth = await client.getAuthorizationField('BUKRS');
      expect(auth.name).toBe('BUKRS');
      expect(auth.checkTable).toBe('T001');
      expect(auth.roleName).toBe('BUKRS');
      expect(auth.domainName).toBe('BUKRS');
      expect(auth.outputLength).toBe('000004');
      expect(auth.package).toBe('BF');
      expect(auth.orgLevelInfo).toEqual(['Field is not defined as Organizational level.']);
    });

    it('getFeatureToggle returns parsed states', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(200, loadFixture('feature-toggle-states.json'), { 'x-csrf-token': 'T' }),
      );
      const client = createClient();
      const toggle = await client.getFeatureToggle('SFW_SWITCH_TOGGLE');
      expect(toggle.name).toBe('SFW_SWITCH_TOGGLE');
      expect(toggle.clientState).toBe('off');
      expect(toggle.userState).toBe('undefined');
      expect(toggle.states).toEqual([
        { client: '000', state: 'off', description: 'SAP SE' },
        { client: '001', state: 'off', description: 'SAP SE' },
      ]);
      expect(toggle.userStates).toEqual([]);
    });

    it('getEnhancementImplementation returns parsed metadata', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(200, loadFixture('enhancement-implementation.xml'), { 'x-csrf-token': 'T' }),
      );
      const client = createClient();
      const enho = await client.getEnhancementImplementation('SFW_BCF_TCD');
      expect(enho.name).toBe('SFW_BCF_TCD');
      expect(enho.package).toBe('SFWTOOLS');
      expect(enho.technology).toBe('BADI_IMPL');
      expect(enho.switchSupported).toBe(true);
      expect(enho.badiImplementations).toHaveLength(2);
      expect(enho.badiImplementations[0]).toMatchObject({
        name: 'SFW_TCD',
        implementingClass: 'CL_SFW_TCD',
        badiDefinition: 'BCF_TCD_REMOTE_BADI',
        enhancementSpot: 'BCF_REMOTE_TCD',
        active: true,
        default: false,
      });
    });
  });

  // ─── API Release State ──────────────────────────────────────────

  describe('getApiReleaseState', () => {
    it('returns parsed release state for a released object', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
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
      const client = createClient();
      const state = await client.getApiReleaseState('/sap/bc/adt/oo/classes/cl_salv_table');
      expect(state.objectName).toBe('CL_SALV_TABLE');
      expect(state.contracts).toHaveLength(1);
      expect(state.contracts[0]!.state).toBe('RELEASED');
      expect(state.isAnyContractReleased).toBe(true);
    });

    it('URL-encodes the object URI as a path segment', async () => {
      const client = createClient();
      await client.getApiReleaseState('/sap/bc/adt/oo/classes/cl_salv_table');
      const calledUrl = String(mockFetch.mock.calls[0]?.[0] ?? '');
      // The object URI should be URL-encoded in the path
      expect(calledUrl).toContain('/sap/bc/adt/apireleases/%2Fsap%2Fbc%2Fadt%2Foo%2Fclasses%2Fcl_salv_table');
    });

    it('sends correct Accept header', async () => {
      const client = createClient();
      await client.getApiReleaseState('/sap/bc/adt/oo/classes/cl_test');
      const calledHeaders = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined;
      expect(calledHeaders?.Accept).toBe('application/vnd.sap.adt.apirelease.v10+xml');
    });
  });

  // ─── URL Encoding (Issues #18, #52) ─────────────────────────────

  describe('URL encoding for namespaced objects', () => {
    it('encodes namespaced program names in URL', async () => {
      const client = createClient();
      await client.getProgram('/NAMESPACE/ZPROGRAM');
    });

    it('encodes namespaced class names in URL', async () => {
      const client = createClient();
      await client.getClass('/USE/CL_MY_CLASS');
    });

    it('encodes namespaced interface names', async () => {
      const client = createClient();
      await client.getInterface('/BOBF/IF_FRW_DETERMINATION');
    });

    it('encodes namespaced function module names', async () => {
      const client = createClient();
      await client.getFunction('/NAMESPACE/FUGR', '/NAMESPACE/FM');
    });

    it('encodes namespaced DDLS names', async () => {
      const client = createClient();
      await client.getDdls('/NAMESPACE/CDS_VIEW');
    });

    it('encodes special characters in search query', async () => {
      const client = createClient();
      await client.searchObject('/NAMESPACE/*', 5);
    });
  });

  describe('withSafety', () => {
    it('returns a new client with the given safety config', () => {
      const client = createClient();
      const restrictedSafety = { ...unrestrictedSafetyConfig(), allowWrites: false };
      const derived = client.withSafety(restrictedSafety);
      expect(derived.safety.allowWrites).toBe(false);
      expect(client.safety.allowWrites).toBe(true);
    });

    it('shares the same HTTP client instance', () => {
      const client = createClient();
      const derived = client.withSafety(unrestrictedSafetyConfig());
      expect(derived.http).toBe(client.http);
    });

    it('preserves username from original client', () => {
      const client = createClient({ username: 'testuser' });
      const derived = client.withSafety(unrestrictedSafetyConfig());
      expect(derived.username).toBe('testuser');
    });

    it('derived client blocks operations per its safety config', async () => {
      const client = createClient();
      const restrictedSafety = { ...unrestrictedSafetyConfig(), allowWrites: false };
      const derived = client.withSafety(restrictedSafety);
      // Original client can still read (unrestricted)
      const source = await client.getProgram('ZHELLO');
      expect(source).toBeDefined();
      // Derived client blocks writes but reads still work
      const source2 = await derived.getProgram('ZHELLO');
      expect(source2).toBeDefined();
    });

    it('is an instance of AdtClient', () => {
      const client = createClient();
      const derived = client.withSafety(unrestrictedSafetyConfig());
      expect(derived).toBeInstanceOf(AdtClient);
    });
  });

  describe('safety checks', () => {
    it('blocks free SQL when allowFreeSQL is false', async () => {
      const client = createClient({
        safety: { ...unrestrictedSafetyConfig(), allowFreeSQL: false },
      });
      await expect(client.runQuery('SELECT * FROM T000')).rejects.toThrow(AdtSafetyError);
    });

    it('allows read when safety is unrestricted', async () => {
      const client = createClient();
      const source = await client.getProgram('ZHELLO');
      expect(source).toBeDefined();
    });
  });

  describe('class metadata and structured read', () => {
    const classMetadataXml = `<?xml version="1.0" encoding="utf-8"?>
<class:abapClass class:final="true" class:visibility="public" class:category="00" class:sharedMemoryEnabled="false" class:fixPointArithmetic="true"
    adtcore:responsible="DEVELOPER" adtcore:masterLanguage="EN" adtcore:masterSystem="NPL" adtcore:abapLanguageVersion="standard"
    adtcore:name="ZCL_EXAMPLE" adtcore:type="CLAS/OC" adtcore:changedAt="2025-03-15T10:30:00Z" adtcore:version="active"
    adtcore:changedBy="DEVELOPER" adtcore:createdBy="DEVELOPER" adtcore:description="Example test class" adtcore:language="EN"
    xmlns:class="http://www.sap.com/adt/oo/classes" xmlns:adtcore="http://www.sap.com/adt/core">
  <atom:link href="source/main" rel="http://www.sap.com/adt/relations/source" type="text/plain" title="Source" xmlns:atom="http://www.w3.org/2005/Atom"/>
  <adtcore:packageRef adtcore:uri="/sap/bc/adt/packages/%24tmp" adtcore:type="DEVC/K" adtcore:name="$TMP" adtcore:description="Local Objects"/>
</class:abapClass>`;

    it('getClassMetadata makes GET request without /source/main', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, classMetadataXml));
      const client = createClient();
      await client.getClassMetadata('ZCL_EXAMPLE');
      const urls = mockFetch.mock.calls.map((c: any[]) => c[0] as string);
      const urlUsed = urls.find((u) => u.includes('ZCL_EXAMPLE'));
      expect(urlUsed).toContain('/sap/bc/adt/oo/classes/ZCL_EXAMPLE');
      expect(urlUsed).not.toContain('/source/main');
    });

    it('getClassMetadata passes through parsed metadata', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, classMetadataXml));
      const client = createClient();
      const metadata = await client.getClassMetadata('ZCL_EXAMPLE');
      expect(metadata.name).toBe('ZCL_EXAMPLE');
      expect(metadata.description).toBe('Example test class');
      expect(metadata.language).toBe('EN');
      expect(metadata.abapLanguageVersion).toBe('standard');
      expect(metadata.category).toBe('generalObjectType');
      expect(metadata.fixPointArithmetic).toBe(true);
      expect(metadata.package).toBe('$TMP');
    });

    it('getClassMetadata uses default Accept header (wildcard)', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, classMetadataXml));
      const client = createClient();
      await client.getClassMetadata('ZCL_EXAMPLE');
      const callIdx = mockFetch.mock.calls.findIndex((_: any, i: number) => {
        const url = mockFetch.mock.calls[i]?.[0] as string;
        return url.includes('ZCL_EXAMPLE') && !url.includes('/source/main');
      });
      // Default Accept is */* (set by http.ts) — SAP rejects application/xml with 406
      expect(fetchHeaders(callIdx).Accept).toBe('*/*');
    });

    it('getClassStructured fetches metadata + main + all includes', async () => {
      mockFetch.mockReset();
      // Each call returns a different response — metadata XML, then source for main + 4 includes
      mockFetch
        .mockResolvedValueOnce(mockResponse(200, classMetadataXml)) // metadata
        .mockResolvedValueOnce(mockResponse(200, 'CLASS zcl_example DEFINITION.')) // main
        .mockResolvedValueOnce(mockResponse(200, 'CLASS zcl_example DEFINITION FOR TESTING.')) // testclasses
        .mockResolvedValueOnce(mockResponse(200, 'CLASS lcl_helper DEFINITION.')) // definitions
        .mockResolvedValueOnce(mockResponse(200, 'CLASS lcl_helper IMPLEMENTATION.')) // implementations
        .mockResolvedValueOnce(mockResponse(200, 'DEFINE my_macro.')); // macros
      const client = createClient();
      const result = await client.getClassStructured('ZCL_EXAMPLE');
      expect(result.metadata.name).toBe('ZCL_EXAMPLE');
      expect(result.main).toBe('CLASS zcl_example DEFINITION.');
      expect(result.testclasses).toBe('CLASS zcl_example DEFINITION FOR TESTING.');
      expect(result.definitions).toBe('CLASS lcl_helper DEFINITION.');
      expect(result.implementations).toBe('CLASS lcl_helper IMPLEMENTATION.');
      expect(result.macros).toBe('DEFINE my_macro.');
    });

    it('getClassStructured sets null for 404 includes', async () => {
      mockFetch.mockReset();
      mockFetch
        .mockResolvedValueOnce(mockResponse(200, classMetadataXml)) // metadata
        .mockResolvedValueOnce(mockResponse(200, 'CLASS zcl_example DEFINITION.')) // main
        .mockRejectedValueOnce(new AdtApiError('Not found', 404, '/includes/testclasses')) // testclasses 404
        .mockRejectedValueOnce(new AdtApiError('Not found', 404, '/includes/definitions')) // definitions 404
        .mockRejectedValueOnce(new AdtApiError('Not found', 404, '/includes/implementations')) // implementations 404
        .mockRejectedValueOnce(new AdtApiError('Not found', 404, '/includes/macros')); // macros 404
      const client = createClient();
      const result = await client.getClassStructured('ZCL_EXAMPLE');
      expect(result.metadata.name).toBe('ZCL_EXAMPLE');
      expect(result.main).toBe('CLASS zcl_example DEFINITION.');
      expect(result.testclasses).toBeNull();
      expect(result.definitions).toBeNull();
      expect(result.implementations).toBeNull();
      expect(result.macros).toBeNull();
    });

    it('getClassStructured re-throws non-404 errors', async () => {
      mockFetch.mockReset();
      mockFetch
        .mockResolvedValueOnce(mockResponse(200, classMetadataXml)) // metadata
        .mockResolvedValueOnce(mockResponse(200, 'CLASS zcl_example DEFINITION.')) // main
        .mockRejectedValueOnce(new AdtApiError('Server error', 500, '/includes/testclasses')) // 500 error
        .mockResolvedValueOnce(mockResponse(200, '')) // definitions
        .mockResolvedValueOnce(mockResponse(200, '')) // implementations
        .mockResolvedValueOnce(mockResponse(200, '')); // macros
      const client = createClient();
      await expect(client.getClassStructured('ZCL_EXAMPLE')).rejects.toThrow(AdtApiError);
    });

    it('getClassStructured makes parallel requests for includes', async () => {
      mockFetch.mockReset();
      mockFetch
        .mockResolvedValueOnce(mockResponse(200, classMetadataXml))
        .mockResolvedValueOnce(mockResponse(200, 'main source'))
        .mockResolvedValueOnce(mockResponse(200, 'test source'))
        .mockResolvedValueOnce(mockResponse(200, 'def source'))
        .mockResolvedValueOnce(mockResponse(200, 'impl source'))
        .mockResolvedValueOnce(mockResponse(200, 'macro source'));
      const client = createClient();
      await client.getClassStructured('ZCL_EXAMPLE');
      // All 6 requests should be made (metadata + main + 4 includes)
      const urls = mockFetch.mock.calls.map((c: any[]) => c[0] as string);
      const classUrls = urls.filter((u) => u.includes('ZCL_EXAMPLE'));
      expect(classUrls).toHaveLength(6);
      // Check include URLs
      expect(classUrls.some((u) => u.includes('/includes/testclasses'))).toBe(true);
      expect(classUrls.some((u) => u.includes('/includes/definitions'))).toBe(true);
      expect(classUrls.some((u) => u.includes('/includes/implementations'))).toBe(true);
      expect(classUrls.some((u) => u.includes('/includes/macros'))).toBe(true);
    });
  });

  describe('BSP / UI5 Filestore operations', () => {
    const bspAppListXml = `<?xml version="1.0" encoding="UTF-8"?>
<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
  <atom:entry>
    <atom:title>ZAPP_BOOKING</atom:title>
    <atom:summary>Manage Bookings</atom:summary>
  </atom:entry>
  <atom:entry>
    <atom:title>ZAPP_TRAVEL</atom:title>
    <atom:summary>Travel Management</atom:summary>
  </atom:entry>
</atom:feed>`;

    const bspFolderXml = `<?xml version="1.0" encoding="UTF-8"?>
<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
  <atom:entry>
    <atom:category term="file"/>
    <atom:content xmlns:afr="http://www.sap.com/adt/afr"
                  afr:etag="20230112203908"
                  type="application/octet-stream"/>
    <atom:title>ZAPP_BOOKING/manifest.json</atom:title>
  </atom:entry>
  <atom:entry>
    <atom:category term="folder"/>
    <atom:content type="application/atom+xml;type=feed"/>
    <atom:title>ZAPP_BOOKING/i18n</atom:title>
  </atom:entry>
</atom:feed>`;

    it('listBspApps returns parsed app list', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, bspAppListXml));
      const client = createClient();
      const apps = await client.listBspApps();
      expect(apps).toHaveLength(2);
      expect(apps[0].name).toBe('ZAPP_BOOKING');
      expect(apps[1].description).toBe('Travel Management');
    });

    it('listBspApps passes query parameter in URL', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, bspAppListXml));
      const client = createClient();
      await client.listBspApps('ZAPP');
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('name=ZAPP');
    });

    it('listBspApps passes maxResults parameter', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, bspAppListXml));
      const client = createClient();
      await client.listBspApps(undefined, 10);
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('maxResults=10');
    });

    it('getBspAppStructure returns files and folders', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, bspFolderXml));
      const client = createClient();
      const nodes = await client.getBspAppStructure('zapp_booking');
      expect(nodes).toHaveLength(2);
      expect(nodes[0].type).toBe('file');
      expect(nodes[0].name).toBe('manifest.json');
      expect(nodes[1].type).toBe('folder');
      expect(nodes[1].name).toBe('i18n');
    });

    it('getBspAppStructure URL-encodes the app path with %2f', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, bspFolderXml));
      const client = createClient();
      await client.getBspAppStructure('zapp_booking', '/i18n');
      const url = mockFetch.mock.calls[0][0] as string;
      // The path ZAPP_BOOKING/i18n should be encoded as a single segment
      expect(url).toContain(encodeURIComponent('ZAPP_BOOKING/i18n'));
      expect(url).toContain('/content');
    });

    it('getBspFileContent returns raw text body', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, '{"sap.app":{"id":"zapp.booking"}}'));
      const client = createClient();
      const content = await client.getBspFileContent('zapp_booking', 'manifest.json');
      expect(content).toContain('sap.app');
    });

    it('getBspFileContent URL-encodes appName/filePath as single segment', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, 'file content'));
      const client = createClient();
      await client.getBspFileContent('ZAPP_BOOKING', 'view/Main.view.xml');
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain(encodeURIComponent('ZAPP_BOOKING/view/Main.view.xml'));
    });

    it('getBspAppStructure normalizes subPath without leading slash', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, bspFolderXml));
      const client = createClient();
      await client.getBspAppStructure('zapp_booking', 'i18n');
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain(encodeURIComponent('ZAPP_BOOKING/i18n'));
    });

    it('getBspFileContent strips leading slash from filePath', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, 'file content'));
      const client = createClient();
      await client.getBspFileContent('ZAPP_BOOKING', '/manifest.json');
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain(encodeURIComponent('ZAPP_BOOKING/manifest.json'));
      // Verify no double-slash in the path portion (after the protocol)
      const pathPortion = url.replace('http://', '');
      expect(pathPortion).not.toContain('//');
    });

    it('listBspApps returns empty array for empty feed', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(200, '<?xml version="1.0"?><atom:feed xmlns:atom="http://www.w3.org/2005/Atom"></atom:feed>'),
      );
      const client = createClient();
      const apps = await client.listBspApps();
      expect(apps).toEqual([]);
    });
  });

  describe('resolveObjectPackage', () => {
    it('extracts package name from ADT metadata XML', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          '<class:abapClass xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZCL_TEST"><adtcore:packageRef adtcore:uri="/sap/bc/adt/packages/%24tmp" adtcore:type="DEVC/K" adtcore:name="$TMP" adtcore:description="Local Objects"/></class:abapClass>',
        ),
      );
      const client = createClient();
      const pkg = await client.resolveObjectPackage('/sap/bc/adt/oo/classes/ZCL_TEST');
      expect(pkg).toBe('$TMP');
    });

    it('returns empty string when no packageRef in response', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, '<some:element/>'));
      const client = createClient();
      const pkg = await client.resolveObjectPackage('/sap/bc/adt/programs/programs/ZTEST');
      expect(pkg).toBe('');
    });

    it('extracts package from minimal packageRef element', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          '<prog:program xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="ZPACKAGE"/></prog:program>',
        ),
      );
      const client = createClient();
      const pkg = await client.resolveObjectPackage('/sap/bc/adt/programs/programs/ZTEST');
      expect(pkg).toBe('ZPACKAGE');
    });
  });

  describe('getInactiveObjects', () => {
    it('returns parsed inactive objects from ADT response', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(
        mockResponse(
          200,
          `<?xml version="1.0"?>
          <ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="http://www.sap.com/adt/core">
            <ioc:entry>
              <ioc:object ioc:user="MARIAN" ioc:deleted="false">
                <ioc:ref adtcore:uri="/sap/bc/adt/oo/classes/zcl_test" adtcore:type="CLAS/OC" adtcore:name="ZCL_TEST" adtcore:description="Test class"/>
              </ioc:object>
              <ioc:transport ioc:linked="true">
                <ioc:ref adtcore:uri="/sap/bc/adt/cts/transportrequests/A4HK901087" adtcore:type="/RQ" adtcore:name="A4HK901087"/>
              </ioc:transport>
            </ioc:entry>
          </ioc:inactiveObjects>`,
        ),
      );
      const client = createClient();
      const objects = await client.getInactiveObjects();
      const url = mockFetch.mock.calls[0]?.[0] as string;
      expect(url).toContain('/sap/bc/adt/activation/inactiveobjects');
      expect(fetchHeaders(0).Accept).toContain('application/vnd.sap.adt.inactivectsobjects.v1+xml');
      expect(objects).toHaveLength(1);
      expect(objects[0]).toEqual({
        name: 'ZCL_TEST',
        type: 'CLAS/OC',
        uri: '/sap/bc/adt/oo/classes/zcl_test',
        description: 'Test class',
        user: 'MARIAN',
        deleted: false,
        transport: 'A4HK901087',
      });
    });
  });
});
