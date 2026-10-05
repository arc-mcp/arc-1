import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  findDefinition,
  findInterfaceImplementersViaSeoMetaRel,
  findReferences,
  findWhereUsed,
  findWhereUsedWithScope,
  getCompletion,
  getWhereUsedScope,
} from '../../../src/adt/codeintel.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';

const fixturesDir = join(import.meta.dirname, '../../fixtures/xml');

function mockHttp(responseBody = ''): AdtHttpClient {
  return {
    get: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: responseBody }),
    post: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: responseBody }),
    put: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
    delete: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
    fetchCsrfToken: vi.fn(),
    withStatefulSession: vi.fn(),
  } as unknown as AdtHttpClient;
}

describe('Code Intelligence', () => {
  // ─── findDefinition ────────────────────────────────────────────────

  describe('findDefinition', () => {
    it('reads the target from the ADT objectReference answer', async () => {
      // Shape returned by SAP_BASIS 757 and 816 for a method call on a class.
      const xml =
        '<?xml version="1.0" encoding="utf-8"?><adtcore:objectReference adtcore:uri="/sap/bc/adt/oo/classes/cl_identity_factory/source/main#start=129,16" xmlns:adtcore="http://www.sap.com/adt/core"/>';
      const http = mockHttp(xml);
      const result = await findDefinition(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/functions/groups/su_user/fmodules/bapi_user_get_detail/source/main',
        202,
        42,
        'FUNCTION bapi_user_get_detail.',
      );
      expect(result?.uri).toBe('/sap/bc/adt/oo/classes/cl_identity_factory/source/main#start=129,16');
      expect(result?.line).toBe(129);
      expect(result?.column).toBe(16);
    });

    it('returns null for an objectReference without a uri', async () => {
      const http = mockHttp('<adtcore:objectReference xmlns:adtcore="http://www.sap.com/adt/core"/>');
      const result = await findDefinition(http, unrestrictedSafetyConfig(), '/source', 1, 1, 'DATA: lv_x.');
      expect(result).toBeNull();
    });

    it('returns definition location from a navigation element', async () => {
      const xml =
        '<navigation uri="/sap/bc/adt/oo/classes/CL_ABAP_REGEX/source/main" type="CLAS/OC" name="CL_ABAP_REGEX"/>';
      const http = mockHttp(xml);
      const result = await findDefinition(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/programs/programs/ZTEST/source/main',
        10,
        5,
        'DATA: lo_regex TYPE REF TO cl_abap_regex.',
      );
      expect(result).not.toBeNull();
      expect(result?.uri).toContain('CL_ABAP_REGEX');
      expect(result?.type).toBe('CLAS/OC');
      expect(result?.name).toBe('CL_ABAP_REGEX');
    });

    it('returns null when no definition found', async () => {
      const http = mockHttp('<navigation/>');
      const result = await findDefinition(http, unrestrictedSafetyConfig(), '/source', 1, 1, 'DATA: lv_x.');
      expect(result).toBeNull();
    });

    it('sends source as POST body', async () => {
      const http = mockHttp('<navigation/>');
      const source = 'REPORT ztest.\nDATA: lv_x TYPE string.';
      await findDefinition(http, unrestrictedSafetyConfig(), '/source', 2, 7, source);
      expect(http.post).toHaveBeenCalledWith(
        expect.stringContaining('/sap/bc/adt/navigation/target'),
        source,
        'text/plain',
        expect.objectContaining({ Accept: 'application/xml' }),
      );
    });

    it('sends the position as a #start fragment of the uri, not as line/column parameters', async () => {
      const http = mockHttp('<navigation/>');
      await findDefinition(http, unrestrictedSafetyConfig(), '/source', 42, 15, 'x');
      const url = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(url).toContain(`uri=${encodeURIComponent('/source#start=42,15')}`);
      expect(url).toContain('filter=definition');
      expect(url).not.toContain('line=');
      expect(url).not.toContain('column=');
    });

    it('keeps an already escaped namespace in the source uri', async () => {
      const http = mockHttp('<navigation/>');
      await findDefinition(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/functions/groups/%2fscwm%2fl03b/fmodules/%2fscwm%2fto_confirm/source/main',
        34,
        16,
        'x',
      );
      const url = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      const uri = new URLSearchParams(url.split('?')[1]).get('uri');
      expect(uri).toBe(
        '/sap/bc/adt/functions/groups/%2fscwm%2fl03b/fmodules/%2fscwm%2fto_confirm/source/main#start=34,16',
      );
    });

    it('replaces a previous cursor while preserving the source query', async () => {
      const http = mockHttp('<navigation/>');
      await findDefinition(http, unrestrictedSafetyConfig(), '/source?version=active#start=1,1;end=1,9', 8, 12, 'x');
      const url = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(new URLSearchParams(url.split('?')[1]).get('uri')).toBe('/source?version=active#start=8,12');
    });
  });

  // ─── findReferences ────────────────────────────────────────────────

  describe('findReferences', () => {
    it('returns reference list', async () => {
      const xml = `<usageReferences>
        <objectReference uri="/sap/bc/adt/programs/programs/ZPROG1" type="PROG/P" name="ZPROG1"/>
        <objectReference uri="/sap/bc/adt/oo/classes/ZCL_USER" type="CLAS/OC" name="ZCL_USER"/>
      </usageReferences>`;
      const http = mockHttp(xml);
      const results = await findReferences(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_HELPER');
      expect(results).toHaveLength(2);
      expect(results[0]?.name).toBe('ZPROG1');
      expect(results[1]?.name).toBe('ZCL_USER');
    });

    it('returns empty array when no references found', async () => {
      const http = mockHttp('<usageReferences/>');
      const results = await findReferences(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_ORPHAN');
      expect(results).toEqual([]);
    });

    it('calls usageReferences endpoint with correct Accept header', async () => {
      const http = mockHttp('<usageReferences/>');
      await findReferences(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_TEST');
      expect(http.get).toHaveBeenCalledWith(
        expect.stringContaining('/sap/bc/adt/repository/informationsystem/usageReferences'),
        expect.objectContaining({ Accept: 'application/xml' }),
      );
    });
  });

  // ─── getWhereUsedScope ─────────────────────────────────────────────

  describe('getWhereUsedScope', () => {
    it('returns scope entries from XML fixture', async () => {
      const xml = readFileSync(join(fixturesDir, 'where-used-scope.xml'), 'utf-8');
      const http = mockHttp(xml);
      const scope = await getWhereUsedScope(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_TEST');
      expect(scope.entries).toHaveLength(3);
      expect(scope.entries[0]).toEqual({
        objectType: 'PROG/P',
        objectTypeDescription: 'Program',
        count: 3,
      });
      expect(scope.entries[1]).toEqual({
        objectType: 'CLAS/OC',
        objectTypeDescription: 'Class',
        count: 2,
      });
      expect(scope.entries[2]).toEqual({
        // FUGR/FF is what live ADT actually emits for function modules — see
        // PR #223 (issue #218 audit). The fixture was previously FUNC/FM
        // which is invented; updated to reflect real ADT output.
        objectType: 'FUGR/FF',
        objectTypeDescription: 'Function Module',
        count: 1,
      });
    });

    it('returns empty entries when scope response has no object types', async () => {
      const xml =
        '<?xml version="1.0" encoding="UTF-8"?><usageReferences:scopeResponse xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences"/>';
      const http = mockHttp(xml);
      const scope = await getWhereUsedScope(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_EMPTY');
      expect(scope.entries).toEqual([]);
    });

    it('POSTs to the scope endpoint with correct content type', async () => {
      const http = mockHttp('<scopeResponse/>');
      await getWhereUsedScope(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_TEST');
      expect(http.post).toHaveBeenCalledWith(
        '/sap/bc/adt/repository/informationsystem/usageReferences/scope',
        expect.stringContaining('/sap/bc/adt/oo/classes/ZCL_TEST'),
        'application/xml',
        expect.objectContaining({ Accept: 'application/xml' }),
      );
    });
  });

  // ─── findWhereUsed ────────────────────────────────────────────────

  describe('findWhereUsed', () => {
    it('returns detailed results from XML fixture', async () => {
      const xml = readFileSync(join(fixturesDir, 'where-used-results.xml'), 'utf-8');
      const http = mockHttp(xml);
      const results = await findWhereUsed(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_TEST');
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        uri: '/sap/bc/adt/programs/programs/ZPROG1/source/main',
        type: 'PROG/P',
        name: 'ZPROG1',
        line: 0,
        column: 0,
        packageName: '$TMP',
        snippet: '',
        objectDescription: 'Test Program 1',
        parentUri: '/sap/bc/adt/packages/%24tmp',
        isResult: true,
        canHaveChildren: false,
        usageInformation: {
          direct: true,
          productive: true,
          raw: 'gradeDirect,includeProductive',
        },
      });
      expect(results[1]).toEqual({
        uri: '/sap/bc/adt/oo/classes/ZCL_CALLER/source/main',
        type: 'CLAS/OC',
        name: 'ZCL_CALLER',
        line: 0,
        column: 0,
        packageName: 'ZPACKAGE',
        snippet: '',
        objectDescription: 'Caller Class',
        parentUri: '/sap/bc/adt/packages/zpackage',
        isResult: true,
        canHaveChildren: true,
        usageInformation: {
          direct: true,
          productive: true,
          raw: 'gradeDirect,includeProductive',
        },
      });
    });

    it('parses parentUri from referencedObject attributes', async () => {
      const xml = readFileSync(join(fixturesDir, 'where-used-results.xml'), 'utf-8');
      const http = mockHttp(xml);
      const results = await findWhereUsed(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_TEST');
      expect(results[0]?.parentUri).toBe('/sap/bc/adt/packages/%24tmp');
      expect(results[1]?.parentUri).toBe('/sap/bc/adt/packages/zpackage');
    });

    it('parses isResult true and false values', async () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
    <usageReferences:referencedObject uri="/u1" isResult="true" canHaveChildren="false">
      <usageReferences:adtObject adtcore:name="A" adtcore:type="PROG/P" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
    <usageReferences:referencedObject uri="/u2" isResult="false" canHaveChildren="true">
      <usageReferences:adtObject adtcore:name="B" adtcore:type="DEVC/K" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usageReferences:referencedObject>
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;
      const http = mockHttp(xml);
      const results = await findWhereUsed(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_TEST');
      expect(results[0]?.isResult).toBe(true);
      expect(results[1]?.isResult).toBe(false);
    });

    it('parses usageInformation tokens into structured flags', async () => {
      const xml = readFileSync(join(fixturesDir, 'where-used-results.xml'), 'utf-8');
      const http = mockHttp(xml);
      const results = await findWhereUsed(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_TEST');
      expect(results[0]?.usageInformation).toEqual({
        direct: true,
        productive: true,
        raw: 'gradeDirect,includeProductive',
      });
    });

    it('returns empty array when no references found', async () => {
      const xml =
        '<?xml version="1.0" encoding="utf-8"?><usageReferences:usageReferenceResult numberOfResults="0" xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences"><usageReferences:referencedObjects/></usageReferences:usageReferenceResult>';
      const http = mockHttp(xml);
      const results = await findWhereUsed(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_ORPHAN');
      expect(results).toEqual([]);
    });

    it('sends objectType filter when provided', async () => {
      const http = mockHttp('<usageReferenceResult><referencedObjects/></usageReferenceResult>');
      await findWhereUsed(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_TEST', 'PROG/P');
      const body = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(body).toContain('objectTypeFilter value="PROG/P"');
    });

    it('does not include objectType filter when not provided', async () => {
      const http = mockHttp('<usageReferenceResult><referencedObjects/></usageReferenceResult>');
      await findWhereUsed(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_TEST');
      const body = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(body).not.toContain('objectTypeFilter');
    });

    it('POSTs to usageReferences with uri query param and SAP content types', async () => {
      const http = mockHttp('<usageReferenceResult><referencedObjects/></usageReferenceResult>');
      await findWhereUsed(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_TEST');
      expect(http.post).toHaveBeenCalledWith(
        expect.stringContaining('/sap/bc/adt/repository/informationsystem/usageReferences?uri='),
        expect.any(String),
        'application/vnd.sap.adt.repository.usagereferences.request.v1+xml',
        expect.objectContaining({
          Accept: 'application/vnd.sap.adt.repository.usagereferences.result.v1+xml',
        }),
      );
    });
  });

  describe('findWhereUsedWithScope', () => {
    const result = (resultDescription: string, scope = '') => `<?xml version="1.0" encoding="utf-8"?>
<usagereferences:usageReferenceResult numberOfResults="1" resultDescription="${resultDescription}" referencedObjectIdentifier="" xmlns:usagereferences="http://www.sap.com/adt/ris/usageReferences">${scope}
  <usagereferences:referencedObjects>
    <usagereferences:referencedObject uri="/u1" isResult="true" canHaveChildren="false" usageInformation="gradeDirect,includeProductive">
      <usagereferences:adtObject adtcore:name="A" adtcore:type="PROG/P" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </usagereferences:referencedObject>
  </usagereferences:referencedObjects>
</usagereferences:usageReferenceResult>`;

    it('reports SAP_BASIS 816 result descriptions verbatim', async () => {
      // 816 also sends a scope element; the description is read from the result root on every release.
      const http = mockHttp(
        result(
          '[A4H] Where-Used List: /DMO/BOOKING_DATA (Structure)',
          '<usagereferences:scope><usagereferences:objectIdentifier displayName="/DMO/BOOKING_DATA (Structure)" globalType="TABL/DS"/></usagereferences:scope>',
        ),
      );
      const lookup = await findWhereUsedWithScope(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/ddic/structures/%2fdmo%2fbooking_data',
      );
      expect(lookup.searchedFor).toBe('[A4H] Where-Used List: /DMO/BOOKING_DATA (Structure)');
      expect(lookup.results).toHaveLength(1);
      expect(lookup.results[0]?.name).toBe('A');
    });

    it('reports SAP_BASIS 757 result descriptions verbatim (no scope element)', async () => {
      const http = mockHttp(result('References for: /SCWM/CL_TM - CLEANUP (Method) [SID]'));
      const lookup = await findWhereUsedWithScope(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/oo/classes/%2fscwm%2fcl_tm#start=30,16',
      );
      expect(lookup.searchedFor).toBe('References for: /SCWM/CL_TM - CLEANUP (Method) [SID]');
    });

    it('omits searchedFor when SAP sends no description', async () => {
      const xml = result('').replace(' resultDescription=""', '');
      const lookup = await findWhereUsedWithScope(
        mockHttp(xml),
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/oo/classes/X',
      );
      expect(lookup).not.toHaveProperty('searchedFor');
      expect(lookup.results).toHaveLength(1);
    });

    it('reads the description of the recorded fixture', async () => {
      const xml = readFileSync(join(fixturesDir, 'where-used-results.xml'), 'utf-8');
      const lookup = await findWhereUsedWithScope(
        mockHttp(xml),
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/oo/classes/X',
      );
      expect(lookup.searchedFor).toBe('[A4H] Where-Used List: ZCL_TEST (Class)');
    });

    it('sends a cursor fragment unchanged in the query and the body', async () => {
      const http = mockHttp(result('References for: ZCL_TEST - RUN (Method) [SID]'));
      const uri = '/sap/bc/adt/oo/classes/zcl_test#start=12,10';
      await findWhereUsedWithScope(http, unrestrictedSafetyConfig(), uri);
      const [url, body] = (http.post as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
      expect(new URL(url, 'http://sap').searchParams.get('uri')).toBe(uri);
      expect(body).toContain(`uri="${uri}"`);
    });
  });

  // ─── findInterfaceImplementersViaSeoMetaRel ───────────────────────

  describe('findInterfaceImplementersViaSeoMetaRel', () => {
    it('returns implementing classes mapped to WhereUsedResult shape', async () => {
      const runQuery = vi.fn().mockResolvedValue({
        columns: ['CLSNAME'],
        rows: [{ CLSNAME: 'ZCL_FOO_IMPL' }, { CLSNAME: 'ZCL_BAR_IMPL' }],
      });
      const result = await findInterfaceImplementersViaSeoMetaRel(runQuery, 'ZIF_FOO');
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        uri: '/sap/bc/adt/oo/classes/zcl_foo_impl',
        type: 'CLAS/OC',
        name: 'ZCL_FOO_IMPL',
        objectDescription: 'implements ZIF_FOO',
        isResult: true,
      });
      expect(result[1]?.name).toBe('ZCL_BAR_IMPL');
    });

    it('queries SEOMETAREL with REFCLSNAME and RELTYPE=1 (interface implementation)', async () => {
      const runQuery = vi.fn().mockResolvedValue({ columns: ['CLSNAME'], rows: [] });
      await findInterfaceImplementersViaSeoMetaRel(runQuery, 'zif_lower_case');
      expect(runQuery).toHaveBeenCalledWith(expect.stringContaining("REFCLSNAME = 'ZIF_LOWER_CASE'"), 100);
      const sql = (runQuery as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain("RELTYPE = '1'");
      expect(sql).toContain('FROM SEOMETAREL');
    });

    it('returns empty array when SEOMETAREL has no rows', async () => {
      const runQuery = vi.fn().mockResolvedValue({ columns: ['CLSNAME'], rows: [] });
      const result = await findInterfaceImplementersViaSeoMetaRel(runQuery, 'ZIF_NO_IMPL');
      expect(result).toEqual([]);
    });

    it('sanitizes interface name to prevent SQL injection', async () => {
      const runQuery = vi.fn().mockResolvedValue({ columns: ['CLSNAME'], rows: [] });
      await findInterfaceImplementersViaSeoMetaRel(runQuery, "ZIF'; DROP TABLE TADIR; --");
      const sql = (runQuery as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      // Sanitization strips everything outside [A-Z0-9_/] (no spaces, no quotes, no semicolons)
      expect(sql).toContain("REFCLSNAME = 'ZIFDROPTABLETADIR'");
      // The injected quote / semicolon must never reach the query
      expect(sql.match(/'/g)?.length).toBe(4); // exactly 4 quotes: 2 around REFCLSNAME, 2 around RELTYPE
    });

    it('returns empty array when interface name sanitizes to empty', async () => {
      const runQuery = vi.fn();
      const result = await findInterfaceImplementersViaSeoMetaRel(runQuery, '!!!');
      expect(result).toEqual([]);
      expect(runQuery).not.toHaveBeenCalled();
    });
  });

  // ─── getCompletion ─────────────────────────────────────────────────

  describe('getCompletion', () => {
    it('returns completion proposals', async () => {
      const xml = `<proposals>
        <proposal text="WRITE" description="WRITE statement" type="keyword"/>
        <proposal text="WHILE" description="WHILE loop" type="keyword"/>
      </proposals>`;
      const http = mockHttp(xml);
      const results = await getCompletion(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/programs/programs/ZTEST/source/main',
        5,
        3,
        'WR',
      );
      expect(results).toHaveLength(2);
      expect(results[0]?.text).toBe('WRITE');
      expect(results[0]?.type).toBe('keyword');
    });

    it('returns empty for no completions', async () => {
      const http = mockHttp('<proposals/>');
      const results = await getCompletion(http, unrestrictedSafetyConfig(), '/source', 1, 1, '');
      expect(results).toEqual([]);
    });

    it('sends source as POST body to codecompletion endpoint', async () => {
      const http = mockHttp('<proposals/>');
      const source = 'REPORT ztest.';
      await getCompletion(http, unrestrictedSafetyConfig(), '/source', 1, 14, source);
      expect(http.post).toHaveBeenCalledWith(
        expect.stringContaining('/sap/bc/adt/abapsource/codecompletion/proposals'),
        source,
        'text/plain',
        expect.objectContaining({ Accept: 'application/xml' }),
      );
    });
  });
});
