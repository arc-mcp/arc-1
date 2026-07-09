/**
 * SAPSearch / SAPQuery / SAPGit / SAPNavigate handler unit tests — split from the former intent.test.ts monolith.
 * The undici mock + AdtClient + createClient live in ./setup-undici-mock.ts — import that helper
 * and keep all other src-module imports dynamic (see its header for the ordering rules).
 */
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { featuresOff } from './handler-test-config.js';
import { AdtClient, createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { transliterateQuery, looksLikeFieldName } = await import('../../../src/handlers/search.js');

function dataPreviewXml(column: string, values: string[]): string {
  return `<abap><values><COLUMNS><COLUMN><METADATA name="${column}"/><DATASET>${values
    .map((value) => `<DATA>${value}</DATA>`)
    .join('')}</DATASET></COLUMN></COLUMNS></values></abap>`;
}

function dataPreviewXmlWithMetrics(column: string, values: string[]): string {
  return `<dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview"><dataPreview:totalRows>${values.length * 10}</dataPreview:totalRows><dataPreview:executedQueryString>SELECT ${column} FROM TADIR</dataPreview:executedQueryString><dataPreview:queryExecutionTime>7.5</dataPreview:queryExecutionTime><dataPreview:columns><dataPreview:metadata dataPreview:name="${column}"/><dataPreview:dataSet>${values
    .map((value) => `<dataPreview:data>${value}</dataPreview:data>`)
    .join('')}</dataPreview:dataSet></dataPreview:columns></dataPreview:tableData>`;
}

function freestylePostCalls(): Array<[unknown, Record<string, unknown>]> {
  return mockFetch.mock.calls.filter(
    (call) => String(call[0]).includes('/sap/bc/adt/datapreview/freestyle') && call[1]?.method === 'POST',
  ) as Array<[unknown, Record<string, unknown>]>;
}

describe('SAPSearch / SAPQuery / SAPGit / SAPNavigate handlers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: return ABAP source with CSRF token for any request
    mockFetch.mockResolvedValue(
      mockResponse(200, "REPORT zhello.\nWRITE: / 'Hello'.", { 'x-csrf-token': 'mock-csrf-token' }),
    );
  });

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

    it('runs exact TADIR lookup from names array', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/tables/zdm_project_d" adtcore:type="TABL/DT" adtcore:name="ZDM_PROJECT_D" adtcore:packageName="ZDEMO_MIG_RAP" adtcore:description="Draft table"/>
  <adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/tables/zdm_project_extra" adtcore:type="TABL/DT" adtcore:name="ZDM_PROJECT_EXTRA" adtcore:packageName="ZDEMO_MIG_RAP" adtcore:description="Substring hit"/>
</adtcore:objectReferences>`,
        ),
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPSearch', {
        searchType: 'tadir_lookup',
        names: ['zdm_project_d'],
      });

      expect(result.isError).toBeUndefined();
      const url = String(mockFetch.mock.calls[0]?.[0] ?? '');
      expect(url).toContain('/sap/bc/adt/repository/informationsystem/search');
      expect(url).toContain('operation=quickSearch');
      expect(url).toContain('query=ZDM_PROJECT_D');
      const payload = JSON.parse(result.content[0]?.text ?? '{}');
      expect(payload.count).toBe(1);
      expect(payload.lookups[0]).toMatchObject({
        name: 'ZDM_PROJECT_D',
        found: true,
      });
      expect(payload.lookups[0].matches[0]).toMatchObject({
        objectType: 'TABL/DT',
        objectName: 'ZDM_PROJECT_D',
        packageName: 'ZDEMO_MIG_RAP',
      });
      expect(payload.missing).toEqual([]);
    });

    it('runs exact TADIR lookup from query and reports missing names', async () => {
      mockFetch.mockReset();
      mockFetch
        .mockResolvedValueOnce(
          mockResponse(
            200,
            `<objectReferences><objectReference uri="/sap/bc/adt/bo/behaviordefinitions/zr_dm_project" type="BDEF/BDO" name="ZR_DM_PROJECT" packageName="ZDEMO_MIG_RAP" description="Behavior"/></objectReferences>`,
          ),
        )
        .mockResolvedValueOnce(mockResponse(200, '<objectReferences/>'));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPSearch', {
        searchType: 'tadir_lookup',
        query: 'ZR_DM_PROJECT, ZDOES_NOT_EXIST',
      });

      expect(result.isError).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const payload = JSON.parse(result.content[0]?.text ?? '{}');
      expect(payload.count).toBe(1);
      expect(payload.missing).toEqual(['ZDOES_NOT_EXIST']);
    });

    it('warns when exact TADIR lookup names contain wildcards', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '<objectReferences/>'));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPSearch', {
        searchType: 'tadir_lookup',
        names: ['ZDM_PROJECT*'],
      });

      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0]?.text ?? '{}');
      expect(payload.missing).toEqual(['ZDM_PROJECT*']);
      expect(payload.warnings[0]).toContain('exact-name lookup');
      expect(payload.warnings[0]).toContain('ZDM_PROJECT*');
    });

    it('passes objectTypes as typed TADIR lookup filters', async () => {
      mockFetch.mockReset();
      mockFetch
        .mockResolvedValueOnce(
          mockResponse(
            200,
            `<objectReferences><objectReference uri="/sap/bc/adt/ddic/tables/zdm_project_d" type="TABL/DT" name="ZDM_PROJECT_D" packageName="ZDEMO_MIG_RAP" description="Draft table"/></objectReferences>`,
          ),
        )
        .mockResolvedValueOnce(mockResponse(200, '<objectReferences/>'));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPSearch', {
        searchType: 'tadir_lookup',
        names: ['ZDM_PROJECT_D'],
        objectTypes: ['TABL', 'BDEF'],
      });

      expect(result.isError).toBeUndefined();
      const urls = mockFetch.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes('objectType=TABL'))).toBe(true);
      expect(urls.some((url) => url.includes('objectType=BDEF'))).toBe(true);
      const payload = JSON.parse(result.content[0]?.text ?? '{}');
      expect(payload.count).toBe(1);
    });

    // ─── source: 'adt' | 'db' | 'both' ──────────────────────────────

    describe('tadir_lookup with source parameter', () => {
      /** Build a freestyle SQL response over the four TADIR columns. */
      function tadirSqlResponse(
        rows: Array<{ pgmid: string; object: string; obj_name: string; devclass: string }>,
      ): string {
        const datasetCol = (data: string[]) =>
          data.length > 0 ? `<DATASET>${data.map((d) => `<DATA>${d}</DATA>`).join('')}</DATASET>` : '<DATASET/>';
        return `<?xml version="1.0" encoding="utf-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
    <COLUMNS>
      <COLUMN><METADATA name="PGMID" type="CHAR" description="" length="4" keyAttribute="false"/>${datasetCol(rows.map((r) => r.pgmid))}</COLUMN>
      <COLUMN><METADATA name="OBJECT" type="CHAR" description="" length="4" keyAttribute="false"/>${datasetCol(rows.map((r) => r.object))}</COLUMN>
      <COLUMN><METADATA name="OBJ_NAME" type="CHAR" description="" length="40" keyAttribute="false"/>${datasetCol(rows.map((r) => r.obj_name))}</COLUMN>
      <COLUMN><METADATA name="DEVCLASS" type="CHAR" description="" length="30" keyAttribute="false"/>${datasetCol(rows.map((r) => r.devclass))}</COLUMN>
    </COLUMNS>
  </asx:values>
</asx:abap>`;
      }

      it("source='adt' default calls only the ADT info-system endpoint", async () => {
        mockFetch.mockReset();
        mockFetch.mockResolvedValueOnce(
          mockResponse(
            200,
            `<objectReferences><objectReference uri="/sap/bc/adt/ddic/ddl/sources/za" type="DDLS/DF" name="ZA" packageName="ZPKG" description="d"/></objectReferences>`,
          ),
        );

        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPSearch', {
          searchType: 'tadir_lookup',
          names: ['ZA'],
        });

        expect(result.isError).toBeUndefined();
        // No POST to /sap/bc/adt/datapreview/freestyle should have happened.
        const freestyleCalls = mockFetch.mock.calls.filter((c) => String(c[0]).includes('/datapreview/freestyle'));
        expect(freestyleCalls).toHaveLength(0);
        const payload = JSON.parse(result.content[0]?.text ?? '{}');
        expect(payload.lookups[0].matches[0]._origin).toBe('adt');
      });

      it("source='db' calls only the freestyle SQL endpoint and tags matches as db", async () => {
        mockFetch.mockReset();
        // CSRF HEAD then SQL POST
        mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        mockFetch.mockResolvedValueOnce(
          mockResponse(200, tadirSqlResponse([{ pgmid: 'R3TR', object: 'DDLS', obj_name: 'ZA', devclass: 'ZPKG' }])),
        );

        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPSearch', {
          searchType: 'tadir_lookup',
          names: ['ZA'],
          source: 'db',
        });

        expect(result.isError).toBeUndefined();
        // No ADT info-system GET should have happened.
        const infoCalls = mockFetch.mock.calls.filter((c) =>
          String(c[0]).includes('/repository/informationsystem/search'),
        );
        expect(infoCalls).toHaveLength(0);
        const payload = JSON.parse(result.content[0]?.text ?? '{}');
        expect(payload.count).toBe(1);
        expect(payload.lookups[0].matches[0]._origin).toBe('db');
        expect(payload.lookups[0].matches[0].objectType).toBe('DDLS');
      });

      it("source='both' runs both endpoints and merges results without splitBrain when consistent", async () => {
        mockFetch.mockReset();
        // Order isn't guaranteed because the handler uses Promise.all; mock both calls regardless of order.
        mockFetch.mockImplementation((url: any) => {
          const u = String(url);
          if (u.includes('/repository/informationsystem/search')) {
            return Promise.resolve(
              mockResponse(
                200,
                `<objectReferences><objectReference uri="/sap/bc/adt/ddic/ddl/sources/za" type="DDLS/DF" name="ZA" packageName="ZPKG" description="d"/></objectReferences>`,
              ),
            );
          }
          if (u.includes('/datapreview/freestyle')) {
            return Promise.resolve(
              mockResponse(
                200,
                tadirSqlResponse([{ pgmid: 'R3TR', object: 'DDLS', obj_name: 'ZA', devclass: 'ZPKG' }]),
              ),
            );
          }
          // CSRF HEAD pre-flight
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        });

        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPSearch', {
          searchType: 'tadir_lookup',
          names: ['ZA'],
          source: 'both',
        });

        expect(result.isError).toBeUndefined();
        const payload = JSON.parse(result.content[0]?.text ?? '{}');
        // ADT + DB dedupe by base type (DDLS): one merged match.
        expect(payload.lookups[0].matches).toHaveLength(1);
        // No splitBrain or warnings when both sources agree.
        expect(payload.splitBrain).toBeUndefined();
        // Warnings array may still be absent (no wildcards, no divergence).
        expect(payload.warnings).toBeUndefined();
      });

      it("source='both' surfaces splitBrain + warning when DB has a ghost ADT can't resolve", async () => {
        mockFetch.mockReset();
        mockFetch.mockImplementation((url: any) => {
          const u = String(url);
          if (u.includes('/repository/informationsystem/search')) {
            // ADT cannot resolve the ghost
            return Promise.resolve(mockResponse(200, '<objectReferences/>'));
          }
          if (u.includes('/datapreview/freestyle')) {
            // DB sees the orphan TADIR row
            return Promise.resolve(
              mockResponse(
                200,
                tadirSqlResponse([{ pgmid: 'R3TR', object: 'DDLS', obj_name: 'ZGHOST', devclass: 'ZPKG' }]),
              ),
            );
          }
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        });

        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPSearch', {
          searchType: 'tadir_lookup',
          names: ['ZGHOST'],
          source: 'both',
        });

        expect(result.isError).toBeUndefined();
        const payload = JSON.parse(result.content[0]?.text ?? '{}');
        expect(payload.lookups[0].found).toBe(true);
        expect(payload.lookups[0].matches[0]._origin).toBe('db');
        expect(payload.splitBrain).toEqual(['ZGHOST']);
        expect(payload.warnings).toBeDefined();
        expect(payload.warnings[0]).toContain('ZGHOST');
        expect(payload.warnings[0]).toMatch(/TADIR ghost|aborted create\/delete/);
      });

      it("source='both' reports no splitBrain when both sources return zero matches", async () => {
        mockFetch.mockReset();
        mockFetch.mockImplementation((url: any) => {
          const u = String(url);
          if (u.includes('/repository/informationsystem/search')) {
            return Promise.resolve(mockResponse(200, '<objectReferences/>'));
          }
          if (u.includes('/datapreview/freestyle')) {
            return Promise.resolve(mockResponse(200, tadirSqlResponse([])));
          }
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        });

        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPSearch', {
          searchType: 'tadir_lookup',
          names: ['ZNOPE'],
          source: 'both',
        });

        expect(result.isError).toBeUndefined();
        const payload = JSON.parse(result.content[0]?.text ?? '{}');
        expect(payload.missing).toEqual(['ZNOPE']);
        expect(payload.splitBrain).toBeUndefined();
        expect(payload.warnings).toBeUndefined();
      });
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
        ...featuresOff({ hana: true, rap: true, transport: true }),
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
        ...featuresOff({ hana: true, rap: true, transport: true }),
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
        ...featuresOff({ hana: true, rap: true, transport: true }),
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

    it('surfaces datapreview metrics (totalRows, queryExecutionTimeMs, executedQueryString, rowsReturned)', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?><dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview"><dataPreview:totalRows>511927</dataPreview:totalRows><dataPreview:executedQueryString>SELECT MANDT FROM T000 UP TO 2 ROWS .</dataPreview:executedQueryString><dataPreview:queryExecutionTime>12.5</dataPreview:queryExecutionTime><dataPreview:columns><dataPreview:metadata dataPreview:name="MANDT" dataPreview:type="C"/><dataPreview:dataSet><dataPreview:data>000</dataPreview:data><dataPreview:data>001</dataPreview:data></dataPreview:dataSet></dataPreview:columns></dataPreview:tableData>`,
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPQuery', {
        sql: 'SELECT mandt FROM t000',
      });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]?.text);
      expect(parsed.totalRows).toBe(511927);
      expect(parsed.queryExecutionTimeMs).toBeCloseTo(12.5);
      expect(parsed.executedQueryString).toBe('SELECT MANDT FROM T000 UP TO 2 ROWS .');
      expect(parsed.rowsReturned).toBe(2);
      expect(parsed.columns).toEqual(['MANDT']);
      expect(parsed.rows).toHaveLength(2);
    });

    it('flags dot-notation (alias.field) as the cause of "only one SELECT" — the real fix is a tilde', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
      // The exact SAP message for native-SQL dot field access (live-verified on 758).
      mockFetch.mockResolvedValueOnce(mockResponse(400, 'Only one SELECT statement is allowed.'));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPQuery', {
        sql: 'SELECT b.trkorr, t.text FROM tmsbufreq AS b INNER JOIN tmsbuftxt AS t ON t.trkorr = b.trkorr ORDER BY b.trkorr',
      });
      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('b~trkorr'); // suggests the tilde form of the first offending token
      expect(text).toContain('tilde');
      expect(text).toContain('JOINs, WHERE, and ORDER BY all work');
      // JOINs are fine — must NOT resurrect the old, wrong "split into single-table queries" advice.
      expect(text).not.toContain('SAP Note 3605050');
      expect(text).not.toContain('single-table');
    });

    it('does not false-flag tilde JOIN with an INTO clause as dot-notation; gives the target-clause hint', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
      mockFetch.mockResolvedValueOnce(mockResponse(400, '"INTO" is invalid at this position'));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPQuery', {
        sql: 'SELECT a~field1, b~field2 FROM ztable1 AS a INNER JOIN ztable2 AS b ON a~id = b~id INTO TABLE @DATA(lt_result)',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Remove ABAP target clauses');
      expect(result.content[0]?.text).toContain('maxRows parameter');
      expect(result.content[0]?.text).not.toContain('tilde'); // no dot present → no tilde hint
      expect(result.content[0]?.text).not.toContain('3605050');
      expect(result.content[0]?.text).not.toContain('single-table');
    });

    it.each(['ASC', 'DESC'])('explains ORDER BY … %s rejection with the ABAP sort keywords', async (direction) => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
      mockFetch.mockResolvedValueOnce(mockResponse(400, `"${direction}" is not allowed here. "." is expected.`));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPQuery', {
        sql: `SELECT b~tabname FROM dd02l AS b ORDER BY b~tabname ${direction}`,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('ASCENDING');
      expect(result.content[0]?.text).toContain('DESCENDING');
      expect(result.content[0]?.text).not.toContain('ascending-only');
    });

    it('does not mistake ASC text inside a string literal for an ORDER BY direction', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
      mockFetch.mockResolvedValueOnce(mockResponse(400, 'Invalid query string. Only one SELECT statement is allowed'));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPQuery', {
        sql: "SELECT descr FROM zt WHERE descr = 'ASC TEST'",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('ADT freestyle SQL parser rejected this query');
      expect(result.content[0]?.text).not.toContain('ASCENDING');
      expect(result.content[0]?.text).not.toContain('DESCENDING');
    });

    it('hints to split a long IN-list on the backend "longer than 255 characters" mis-parse', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
      // SA1-style message: a long IN-list mis-read as one literal running into the INTO TABLE wrapper.
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          400,
          'The text literal "\'0000000000 INTO TABL..." is longer than 255 characters. Check whether it ends correctly.',
        ),
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPQuery', {
        sql: "SELECT matnr, spras, maktx FROM makt WHERE spras IN ('D','E') AND matnr IN ('000000000000069575','000000000000101882','000000000000102927','000000000000125368','000000000000145057','000000000000198979','000000000000227271','000000000000246645','000000000000380774','000000000000380808') ORDER BY matnr, spras",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Split the largest IN-list');
      expect(result.content[0]?.text).toContain('multiple IN-clauses');
      expect(result.content[0]?.text).toContain('ORDER BY');
      expect(result.content[0]?.text).toContain('preserve semantics');
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
      expect(result.content[0]?.text).toContain('exactly one SELECT');
      expect(result.content[0]?.text).toContain('without a trailing semicolon');
      expect(result.content[0]?.text).not.toContain('SAP Note 3605050');
    });

    it('chunks simple long literal IN lists and merges the rows', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          dataPreviewXmlWithMetrics('OBJ_NAME', ['Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z07', 'Z08']),
        ),
      );
      mockFetch.mockResolvedValueOnce(mockResponse(200, dataPreviewXmlWithMetrics('OBJ_NAME', ['Z09', 'Z10'])));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPQuery', {
        sql: "SELECT object_name FROM tadir WHERE object_name IN ('Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z07', 'Z08', 'Z09', 'Z10')",
        maxRows: 100,
      });

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]?.text);
      expect(data.columns).toEqual(['OBJ_NAME']);
      expect(data.rows.map((row: Record<string, string>) => row.OBJ_NAME)).toEqual([
        'Z01',
        'Z02',
        'Z03',
        'Z04',
        'Z05',
        'Z06',
        'Z07',
        'Z08',
        'Z09',
        'Z10',
      ]);
      expect(data.totalRows).toBeUndefined();
      expect(data.queryExecutionTimeMs).toBeUndefined();
      expect(data.executedQueryString).toBeUndefined();

      const postCalls = freestylePostCalls();
      expect(postCalls).toHaveLength(2);
      const firstBody = String(postCalls[0]?.[1].body);
      const secondBody = String(postCalls[1]?.[1].body);
      expect([firstBody, secondBody]).toEqual([
        "SELECT object_name FROM tadir WHERE object_name IN ('Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z07', 'Z08')",
        "SELECT object_name FROM tadir WHERE object_name IN ('Z09', 'Z10')",
      ]);
    });

    it('chunks the longest literal IN-list while keeping other IN filters unchanged', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, dataPreviewXml('MATNR', ['M01', 'M02'])));
      mockFetch.mockResolvedValueOnce(mockResponse(200, dataPreviewXml('MATNR', ['M09', 'M10'])));
      const sql =
        "SELECT matnr FROM makt WHERE spras IN ('D', 'E') AND matnr IN ('M01', 'M02', 'M03', 'M04', 'M05', 'M06', 'M07', 'M08', 'M09', 'M10')";

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPQuery', { sql });

      expect(result.isError).toBeUndefined();
      const bodies = freestylePostCalls().map((call) => String(call[1].body));
      expect(bodies).toHaveLength(2);
      expect(bodies.every((body) => body.includes("spras IN ('D', 'E')"))).toBe(true);
      expect(bodies[0]).toContain("matnr IN ('M01', 'M02', 'M03', 'M04', 'M05', 'M06', 'M07', 'M08')");
      expect(bodies[0]).not.toContain("'M09'");
      expect(bodies[1]).toContain("matnr IN ('M09', 'M10')");
    });

    it('selects the longer of two chunkable literal IN-lists', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, dataPreviewXml('OBJ_NAME', ['Z01'])));
      mockFetch.mockResolvedValueOnce(mockResponse(200, dataPreviewXml('OBJ_NAME', ['Z10'])));
      const sql =
        "SELECT object_name FROM tadir WHERE object_type IN ('A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09') AND object_name IN ('Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z07', 'Z08', 'Z09', 'Z10')";

      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPQuery', { sql });

      const bodies = freestylePostCalls().map((call) => String(call[1].body));
      expect(bodies).toHaveLength(2);
      expect(
        bodies.every((body) =>
          body.includes("object_type IN ('A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09')"),
        ),
      ).toBe(true);
      expect(bodies[0]).toContain("object_name IN ('Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z07', 'Z08')");
      expect(bodies[1]).toContain("object_name IN ('Z09', 'Z10')");
    });

    it.each([
      "SELECT object_name FROM tadir WHERE object_name IN ('Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z07', 'Z08', 'Z09') ORDER BY object_name",
      "SELECT object_type, COUNT(*) FROM tadir WHERE object_name IN ('Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z07', 'Z08', 'Z09') GROUP BY object_type",
      "SELECT SINGLE object_name FROM tadir WHERE object_name IN ('Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z07', 'Z08', 'Z09')",
      "SELECT object_name FROM tadir WHERE object_name IN ('Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z07', 'Z08', 'Z09') UP TO 1 ROWS",
      "SELECT STRING_AGG( object_name, ',' ) FROM tadir WHERE object_name IN ('Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z07', 'Z08', 'Z09')",
    ])('does not chunk queries whose per-chunk results cannot be merged safely', async (sql) => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, dataPreviewXml('RESULT', ['1'])));

      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPQuery', { sql });

      const postCalls = freestylePostCalls();
      expect(postCalls).toHaveLength(1);
      expect(String(postCalls[0]?.[1].body)).toBe(sql);
    });

    it('deduplicates IN-list literals before splitting across chunks', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, dataPreviewXml('OBJ_NAME', ['Z01'])));
      mockFetch.mockResolvedValueOnce(mockResponse(200, dataPreviewXml('OBJ_NAME', ['Z09', 'Z10'])));
      const sql =
        "SELECT object_name FROM tadir WHERE object_name IN ('Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z07', 'Z08', 'Z01', 'Z09', 'Z10')";

      await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPQuery', { sql });

      const bodies = freestylePostCalls().map((call) => String(call[1].body));
      expect(bodies).toHaveLength(2);
      expect(bodies.join(' ').match(/'Z01'/g) ?? []).toHaveLength(1);
      expect(bodies[0]).toContain("'Z08'");
      expect(bodies[1]).toContain("'Z09', 'Z10'");
    });

    it('stops chunked IN-list execution once maxRows is filled', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, dataPreviewXml('OBJ_NAME', ['Z01', 'Z02', 'Z03', 'Z04'])));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPQuery', {
        sql: "SELECT object_name FROM tadir WHERE object_name IN ('Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z07', 'Z08', 'Z09')",
        maxRows: 3,
      });

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]?.text);
      expect(data.rows.map((row: Record<string, string>) => row.OBJ_NAME)).toEqual(['Z01', 'Z02', 'Z03']);
      const postCalls = freestylePostCalls();
      expect(postCalls).toHaveLength(1);
      expect(String(postCalls[0]?.[0])).toContain('rowNumber=3');
    });

    it('does not rewrite short IN lists', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, dataPreviewXml('OBJ_NAME', ['Z01', 'Z02'])));
      const sql = "SELECT object_name FROM tadir WHERE object_name IN ('Z01', 'Z02')";

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPQuery', { sql });

      expect(result.isError).toBeUndefined();
      const postCalls = freestylePostCalls();
      expect(postCalls).toHaveLength(1);
      expect(String(postCalls[0]?.[1].body)).toBe(sql);
    });

    it('does not rewrite IN subqueries', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, dataPreviewXml('OBJ_NAME', ['Z01'])));
      const sql = 'SELECT object_name FROM tadir WHERE object_name IN ( SELECT obj_name FROM zallowed_objects )';

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPQuery', { sql });

      expect(result.isError).toBeUndefined();
      const postCalls = freestylePostCalls();
      expect(postCalls).toHaveLength(1);
      expect(String(postCalls[0]?.[1].body)).toBe(sql);
    });

    it('does not rewrite NOT IN lists', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, dataPreviewXml('OBJ_NAME', ['Z99'])));
      const sql =
        "SELECT object_name FROM tadir WHERE object_name NOT IN ('Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z07', 'Z08', 'Z09')";

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPQuery', { sql });

      expect(result.isError).toBeUndefined();
      const postCalls = freestylePostCalls();
      expect(postCalls).toHaveLength(1);
      expect(String(postCalls[0]?.[1].body)).toBe(sql);
    });

    it('mentions automatic IN-list chunking when a chunk still hits the ADT parser error', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'mock-csrf-token' }));
      mockFetch.mockResolvedValueOnce(mockResponse(400, 'Invalid query string. Only one SELECT statement is allowed'));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPQuery', {
        sql: "SELECT object_name FROM tadir WHERE object_name IN ('Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z07', 'Z08', 'Z09')",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('ADT freestyle SQL parser rejected this query');
      expect(result.content[0]?.text).toContain('already split the longest literal IN-list');
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
      setCachedFeatures(featuresOff({ gcts: true, abapGit: true }));
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, gctsReposJson));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPGit', { action: 'list_repos' });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.backend).toBe('gcts');
      expect(parsed.result[0].rid).toBe('ZARC1');
    });

    it('honors explicit backend override to abapgit', async () => {
      setCachedFeatures(featuresOff({ gcts: true, abapGit: true }));
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
      setCachedFeatures(featuresOff());
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPGit', { action: 'list_repos' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Neither gCTS nor abapGit is available');
    });

    it('blocks write actions for read-only scoped users (requires git scope in v0.7)', async () => {
      setCachedFeatures(featuresOff({ gcts: true }));
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
      setCachedFeatures(featuresOff({ abapGit: true }));
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPGit', {
        action: 'whoami',
        backend: 'abapgit',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('only supported by gCTS');
    });

    it('dispatches stage action to abapGit backend and returns JSON payload', async () => {
      setCachedFeatures(featuresOff({ abapGit: true }));
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
      setCachedFeatures(featuresOff({ gcts: true }));
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
      setCachedFeatures(featuresOff({ gcts: true }));
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

  describe('SAPNavigate references — INTF augmentation via SEOMETAREL', () => {
    /** dataPreview XML with a single CLSNAME column from SEOMETAREL */
    function clsnameXml(names: string[]): string {
      const data = names.map((n) => `<DATA>${n}</DATA>`).join('');
      return `<dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview">
        <dataPreview:totalRows>${names.length}</dataPreview:totalRows>
        <dataPreview:columns><dataPreview:metadata dataPreview:name="CLSNAME"/><dataPreview:dataSet>${data}</dataPreview:dataSet></dataPreview:columns>
      </dataPreview:tableData>`;
    }

    /** usageReferences result with a single Interface Section entry — no implementer surfaced */
    function intfWhereUsedXmlSparse(): string {
      return `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult numberOfResults="1" xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
    <usageReferences:referencedObject uri="/sap/bc/adt/oo/interfaces/zif_foo" parentUri="/sap/bc/adt/packages/%24tmp" isResult="false" canHaveChildren="false">
      <usageReferences:adtObject adtcore:name="ZIF_FOO" adtcore:type="INTF/OI" xmlns:adtcore="http://www.sap.com/adt/core">
        <adtcore:packageRef adtcore:name="$TMP"/>
      </usageReferences:adtObject>
    </usageReferences:referencedObject>
    <usageReferences:referencedObject uri="/sap/bc/adt/oo/interfaces/zif_foo/source/main#start=1,0" isResult="false" canHaveChildren="true">
      <usageReferences:adtObject adtcore:name="Interface Section" xmlns:adtcore="http://www.sap.com/adt/core">
        <adtcore:packageRef adtcore:name="$TMP"/>
      </usageReferences:adtObject>
    </usageReferences:referencedObject>
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;
    }

    it('augments INTF references with implementing classes from SEOMETAREL when SAP omits them', async () => {
      mockFetch.mockReset();
      // 1) CSRF probe (cached for the rest of the session)
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      // 2) usageReferences POST — SAP returns only the interface + section, no implementer
      mockFetch.mockResolvedValueOnce(mockResponse(200, intfWhereUsedXmlSparse()));
      // 3) SEOMETAREL freestyle SQL response — CSRF cached, no fresh token needed
      mockFetch.mockResolvedValueOnce(mockResponse(200, clsnameXml(['ZCL_IMPL1', 'ZCL_IMPL2'])));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPNavigate', {
        action: 'references',
        type: 'INTF',
        name: 'ZIF_FOO',
      });
      expect(result.isError).toBeUndefined();
      const refs = JSON.parse(result.content[0]?.text);
      // Original 2 entries + 2 augmented implementers
      expect(refs).toHaveLength(4);
      const impl1 = refs.find((r: { name: string }) => r.name === 'ZCL_IMPL1');
      expect(impl1).toBeDefined();
      expect(impl1.type).toBe('CLAS/OC');
      expect(impl1.uri).toBe('/sap/bc/adt/oo/classes/zcl_impl1');
      expect(impl1.objectDescription).toBe('implements ZIF_FOO');
      expect(impl1.isResult).toBe(true);
    });

    it('dedupes — does not re-add an implementer SAP already returned', async () => {
      mockFetch.mockReset();
      // SAP's where-used DOES include ZCL_IMPL1 this time (e.g. on a system with a healthier index)
      const xmlWithImpl = `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult numberOfResults="1" xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
    <usageReferences:referencedObject uri="/sap/bc/adt/oo/classes/zcl_impl1" isResult="true">
      <usageReferences:adtObject adtcore:name="ZCL_IMPL1" adtcore:type="CLAS/OC" xmlns:adtcore="http://www.sap.com/adt/core">
        <adtcore:packageRef adtcore:name="$TMP"/>
      </usageReferences:adtObject>
    </usageReferences:referencedObject>
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`;
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, xmlWithImpl));
      mockFetch.mockResolvedValueOnce(mockResponse(200, clsnameXml(['ZCL_IMPL1', 'ZCL_IMPL2'])));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPNavigate', {
        action: 'references',
        type: 'INTF',
        name: 'ZIF_FOO',
      });
      const refs = JSON.parse(result.content[0]?.text);
      // SAP entry (1) + 1 newly added (ZCL_IMPL2) — dedupe drops the duplicate
      expect(refs).toHaveLength(2);
      expect(refs.filter((r: { name: string }) => r.name === 'ZCL_IMPL1')).toHaveLength(1);
      expect(refs.find((r: { name: string }) => r.name === 'ZCL_IMPL2')).toBeDefined();
    });

    it('skips augmentation silently when SQL/data scope is not allowed', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, intfWhereUsedXmlSparse()));
      // No SEOMETAREL fetch should happen — no further mockFetch responses needed

      const noSqlClient = new AdtClient({
        baseUrl: 'http://sap:8000',
        username: 'admin',
        password: 'secret',
        safety: { ...unrestrictedSafetyConfig(), allowFreeSQL: false, allowDataPreview: false },
      });
      const result = await handleToolCall(noSqlClient, DEFAULT_CONFIG, 'SAPNavigate', {
        action: 'references',
        type: 'INTF',
        name: 'ZIF_FOO',
      });
      const refs = JSON.parse(result.content[0]?.text);
      // Only the 2 entries SAP returned — no augmentation
      expect(refs).toHaveLength(2);
      expect(refs.find((r: { name: string; type: string }) => r.type === 'CLAS/OC')).toBeUndefined();
    });

    it('skips augmentation when objectType filter excludes CLAS', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      mockFetch.mockResolvedValueOnce(mockResponse(200, intfWhereUsedXmlSparse()));
      // No SEOMETAREL fetch — caller asked only for PROG/P references

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPNavigate', {
        action: 'references',
        type: 'INTF',
        name: 'ZIF_FOO',
        objectType: 'PROG/P',
      });
      const refs = JSON.parse(result.content[0]?.text);
      // Only the 2 SAP entries
      expect(refs).toHaveLength(2);
    });

    it('does not augment for CLAS references (only INTF)', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          200,
          `<?xml version="1.0" encoding="utf-8"?>
<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">
  <usageReferences:referencedObjects>
    <usageReferences:referencedObject uri="/sap/bc/adt/oo/classes/zcl_caller" isResult="true">
      <usageReferences:adtObject adtcore:name="ZCL_CALLER" adtcore:type="CLAS/OC" xmlns:adtcore="http://www.sap.com/adt/core">
        <adtcore:packageRef adtcore:name="$TMP"/>
      </usageReferences:adtObject>
    </usageReferences:referencedObject>
  </usageReferences:referencedObjects>
</usageReferences:usageReferenceResult>`,
        ),
      );
      // No SEOMETAREL fetch should happen — input is a class, not an interface

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPNavigate', {
        action: 'references',
        type: 'CLAS',
        name: 'ZCL_TARGET',
      });
      const refs = JSON.parse(result.content[0]?.text);
      expect(refs).toHaveLength(1);
      expect(refs[0].name).toBe('ZCL_CALLER');
    });
  });

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
});
