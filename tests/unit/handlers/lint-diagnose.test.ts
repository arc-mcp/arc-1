/**
 * SAPLint / SAPDiagnose handler unit tests — split from the former intent.test.ts monolith.
 * The undici mock + AdtClient + createClient live in ./setup-undici-mock.ts — import that helper
 * and keep all other src-module imports dynamic (see its header for the ordering rules).
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import { logger } from '../../../src/server/logger.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { featuresOff } from './handler-test-config.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');

const WRITE_CONFIG = { ...DEFAULT_CONFIG, allowWrites: true };
const AUNIT_TESTRUN_WITH_COVERAGE = readFileSync(
  new URL('../../fixtures/xml/aunit-testrun-with-coverage.xml', import.meta.url),
  'utf-8',
);

function fetchedPathWithVersion(urls: string[], pathname: string, version: 'active' | 'inactive'): boolean {
  return urls.some((rawUrl) => {
    const url = new URL(rawUrl);
    return url.pathname === pathname && url.searchParams.get('version') === version;
  });
}

describe('SAPLint / SAPDiagnose handlers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: return ABAP source with CSRF token for any request
    mockFetch.mockResolvedValue(
      mockResponse(200, "REPORT zhello.\nWRITE: / 'Hello'.", { 'x-csrf-token': 'mock-csrf-token' }),
    );
  });

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

    it('list_rules uses config.abapRelease when cached features are absent', async () => {
      resetCachedFeatures();
      const s4Config = { ...DEFAULT_CONFIG, systemType: 'onprem' as const, abapRelease: '758' };
      const result = await handleToolCall(createClient(), s4Config, 'SAPLint', {
        action: 'list_rules',
      });
      const parsed = JSON.parse(result.content[0]?.text);
      expect(parsed.preset).toBe('onprem');
      expect(parsed.abapVersion).toBe('758');
      expect(parsed.syntaxVersion).toBe('v758');
    });

    it('list_rules prefers cached feature release over config.abapRelease', async () => {
      setCachedFeatures({ ...featuresOff(), abapRelease: '750', systemType: 'onprem' });
      try {
        const s4Config = { ...DEFAULT_CONFIG, systemType: 'onprem' as const, abapRelease: '758' };
        const result = await handleToolCall(createClient(), s4Config, 'SAPLint', {
          action: 'list_rules',
        });
        const parsed = JSON.parse(result.content[0]?.text);
        expect(parsed.abapVersion).toBe('750');
        expect(parsed.syntaxVersion).toBe('v750');
      } finally {
        resetCachedFeatures();
      }
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

  describe('SAPDiagnose object_state', () => {
    it('compares CLAS main and include active/inactive versions', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('/includes/macros')) return Promise.resolve(mockResponse(404, 'Not found'));
        const body = urlStr.includes('version=inactive') ? 'inactive source' : 'active source';
        return Promise.resolve(mockResponse(200, body, { etag: urlStr.includes('version=inactive') ? 'i1' : 'a1' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'object_state',
        type: 'CLAS',
        name: 'ZBP_DM_PROJECT',
      });

      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0]?.text);
      expect(payload.type).toBe('CLAS');
      expect(payload.name).toBe('ZBP_DM_PROJECT');
      expect(payload.hasInactiveDivergence).toBe(true);
      expect(payload.sections.map((section: { section: string }) => section.section)).toEqual([
        'main',
        'definitions',
        'implementations',
        'macros',
        'testclasses',
      ]);

      const urls = mockFetch.mock.calls.map((call) => String(call[0]));
      expect(fetchedPathWithVersion(urls, '/sap/bc/adt/oo/classes/ZBP_DM_PROJECT/source/main', 'active')).toBe(true);
      expect(fetchedPathWithVersion(urls, '/sap/bc/adt/oo/classes/ZBP_DM_PROJECT/source/main', 'inactive')).toBe(true);
      expect(fetchedPathWithVersion(urls, '/sap/bc/adt/oo/classes/ZBP_DM_PROJECT/includes/definitions', 'active')).toBe(
        true,
      );
      expect(
        fetchedPathWithVersion(urls, '/sap/bc/adt/oo/classes/ZBP_DM_PROJECT/includes/implementations', 'inactive'),
      ).toBe(true);

      const macros = payload.sections.find((section: { section: string }) => section.section === 'macros');
      expect(macros.active).toEqual({ available: false, statusCode: 404 });
      expect(macros.inactive).toEqual({ available: false, statusCode: 404 });
    });

    it('compares only main source for non-class objects', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, 'REPORT zdemo.', { etag: 'e1' }));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'object_state',
        type: 'PROG',
        name: 'ZDEMO',
      });

      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0]?.text);
      expect(payload.sections.map((section: { section: string }) => section.section)).toEqual(['main']);
      const urls = mockFetch.mock.calls.map((call) => String(call[0]));
      expect(fetchedPathWithVersion(urls, '/sap/bc/adt/programs/programs/ZDEMO/source/main', 'active')).toBe(true);
      expect(fetchedPathWithVersion(urls, '/sap/bc/adt/programs/programs/ZDEMO/source/main', 'inactive')).toBe(true);
    });

    it('returns a focused error when name or type is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'object_state',
        type: 'CLAS',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"name" and "type" are required for "object_state" action.');
    });
  });

  describe('SAPDiagnose cds_testcases', () => {
    const I_CURRENCY_FIXTURE = readFileSync(
      new URL('../../fixtures/xml/cds-testcases-i_currency.xml', import.meta.url),
      'utf-8',
    );

    it('returns parsed CDS test cases + a scaffolding hint', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        if (String(url).includes('/aunit/dbtestdoubles/cds/testcases')) {
          return Promise.resolve(mockResponse(200, I_CURRENCY_FIXTURE));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 't' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'cds_testcases',
        name: 'I_CURRENCY',
      });

      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0]?.text);
      expect(payload.cds).toBe('I_CURRENCY');
      expect(payload.testCaseCount).toBe(8);
      expect(payload.testCases[0].testMethod).toBe('calculate_altcurrkey');
      expect(payload.hint).toContain('cl_cds_test_environment');

      // The CDS name is sent as the ?ddlsourceName= query param (not an object URL).
      const urls = mockFetch.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('/aunit/dbtestdoubles/cds/testcases?ddlsourceName=I_CURRENCY'))).toBe(true);
    });

    it('requires name (and makes no SAP call)', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 't' }));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'cds_testcases',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"name"');
      expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('dbtestdoubles'))).toBe(false);
    });

    it('returns a clear "needs 8.16+" error when discovery shows the endpoint absent (758)', async () => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 't' }));

      const client = createClient();
      vi.spyOn(client.http, 'hasDiscoveryData').mockReturnValue(true);
      vi.spyOn(client.http, 'discoveryAcceptFor').mockReturnValue(undefined);

      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'cds_testcases',
        name: 'I_CURRENCY',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('SAP_BASIS 8.16+');
      expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('dbtestdoubles'))).toBe(false);
    });

    it('surfaces the SAP 400 for a nonexistent CDS entity', async () => {
      const missingBody =
        '<?xml version="1.0" encoding="utf-8"?><exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt.testdoubles.cds"/><type id=""/><message lang="EN">CDS view ZZZ does not exist</message><localizedMessage lang="EN">CDS view ZZZ does not exist</localizedMessage></exc:exception>';
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        if (String(url).includes('/aunit/dbtestdoubles/cds/testcases')) {
          return Promise.resolve(mockResponse(400, missingBody));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 't' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'cds_testcases',
        name: 'ZZZ',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/does not exist/i);
    });
  });

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

    it('quickfix action uses sourceUri override for include targets', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockImplementation(
        (
          url: string | URL,
          opts?: { method?: string; body?: string | Buffer | null; headers?: Record<string, string> },
        ) => {
          const method = opts?.method ?? 'GET';
          calls.push({
            method,
            url: String(url),
            body: typeof opts?.body === 'string' ? opts.body : undefined,
          });
          if (method === 'POST' && String(url).includes('/sap/bc/adt/quickfixes/evaluation')) {
            return Promise.resolve(
              mockResponse(200, '<qf:evaluationResults xmlns:qf="http://www.sap.com/adt/quickfixes"/>', {
                'x-csrf-token': 'T',
              }),
            );
          }
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        },
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'quickfix',
        type: 'CLAS',
        name: 'ZCL_TEST',
        sourceUri: '/sap/bc/adt/oo/classes/ZCL_TEST/includes/definitions',
        source: 'CLASS lhc_test DEFINITION. ENDCLASS.',
        line: 1,
        column: 45,
      });

      expect(result.isError).toBeUndefined();
      const evalCall = calls.find((c) => c.method === 'POST' && c.url.includes('/sap/bc/adt/quickfixes/evaluation'));
      expect(evalCall?.url).toContain('%2Fsap%2Fbc%2Fadt%2Foo%2Fclasses%2FZCL_TEST%2Fincludes%2Fdefinitions');
      expect(evalCall?.url).toContain('%23start%3D1%2C45');
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
                    <content>DATA</content>
                  </quickfixes:delta>
                </quickfixes:applicationResult>`,
                { 'x-csrf-token': 'T' },
              ),
            );
          }
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        },
      );

      const result = await handleToolCall(createClient(), WRITE_CONFIG, 'SAPDiagnose', {
        action: 'apply_quickfix',
        type: 'CLAS',
        name: 'ZCL_TEST',
        sourceUri: '/sap/bc/adt/oo/classes/ZCL_TEST/includes/definitions',
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

    it('apply_quickfix action accepts empty userContent and forwards affected objects', async () => {
      mockFetch.mockReset();
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockImplementation(
        (
          url: string | URL,
          opts?: { method?: string; body?: string | Buffer | null; headers?: Record<string, string> },
        ) => {
          const method = opts?.method ?? 'GET';
          calls.push({
            method,
            url: String(url),
            body: typeof opts?.body === 'string' ? opts.body : undefined,
          });
          return Promise.resolve(
            mockResponse(200, '<quickfixes:proposalResult xmlns:quickfixes="http://www.sap.com/adt/quickfixes"/>', {
              'x-csrf-token': 'T',
            }),
          );
        },
      );

      const result = await handleToolCall(createClient(), WRITE_CONFIG, 'SAPDiagnose', {
        action: 'apply_quickfix',
        type: 'CLAS',
        name: 'ZCL_TEST',
        sourceUri: '/sap/bc/adt/oo/classes/ZCL_TEST/includes/definitions',
        source: 'CLASS zcl_test DEFINITION. ENDCLASS.',
        line: 3,
        column: 1,
        proposalUri: '/sap/bc/adt/quickfixes/1',
        proposalUserContent: '',
        proposalAffectedObjects: [
          {
            uri: '/sap/bc/adt/oo/classes/ZCL_HELPER/source/main',
            type: 'CLAS/OC',
            name: 'ZCL_HELPER',
            content: 'CLASS zcl_helper DEFINITION. ENDCLASS.',
          },
        ],
      });

      expect(result.isError).toBeUndefined();
      const applyCall = calls.find((c) => c.method === 'POST' && c.url.includes('/sap/bc/adt/quickfixes/1'));
      expect(applyCall?.body).toContain('<userContent></userContent>');
      expect(applyCall?.body).toContain('/sap/bc/adt/oo/classes/ZCL_TEST/includes/definitions#start=3,1');
      expect(applyCall?.body).toContain('<affectedObjects>');
      expect(applyCall?.body).toContain('adtcore:uri="/sap/bc/adt/oo/classes/ZCL_HELPER/source/main"');
      expect(applyCall?.body).toContain('<content>CLASS zcl_helper DEFINITION. ENDCLASS.</content>');
    });

    it('apply_quickfix action rejects non-quickfix proposal URIs before posting', async () => {
      const result = await handleToolCall(createClient(), WRITE_CONFIG, 'SAPDiagnose', {
        action: 'apply_quickfix',
        type: 'CLAS',
        name: 'ZCL_TEST',
        source: 'CLASS zcl_test DEFINITION. ENDCLASS.',
        line: 3,
        proposalUri: '/sap/bc/adt/oo/classes/ZCL_TARGET/source/main',
        proposalUserContent: 'opaque-state',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('refused non-quickfix proposal URI');
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/sap/bc/adt/oo/classes/ZCL_TARGET'),
        expect.anything(),
      );
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

    it('apply_quickfix action returns error when proposalUserContent is missing', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'apply_quickfix',
        type: 'CLAS',
        name: 'ZCL_TEST',
        source: 'CLASS zcl_test DEFINITION. ENDCLASS.',
        line: 3,
        proposalUri: '/sap/bc/adt/quickfixes/1',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('"proposalUserContent" is required for "apply_quickfix" action.');
    });

    it('schema validation rejects unknown SAPDiagnose actions', async () => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'not_real',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Invalid arguments for SAPDiagnose');
    });
  });

  describe('SAPDiagnose unittest coverage', () => {
    function mockAunitCoverageFlow(measurementStatus: number, measurementBody: string): void {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string | Buffer }) => {
        const method = opts?.method ?? 'GET';
        const urlStr = String(url);
        if (method === 'HEAD' && urlStr.includes('/sap/bc/adt/core/discovery')) {
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        }
        if (method === 'POST' && urlStr.includes('/sap/bc/adt/abapunit/testruns')) {
          return Promise.resolve(mockResponse(201, AUNIT_TESTRUN_WITH_COVERAGE, { 'x-csrf-token': 'T' }));
        }
        if (method === 'POST' && urlStr.includes('/sap/bc/adt/runtime/traces/coverage/measurements/')) {
          return Promise.resolve(mockResponse(measurementStatus, measurementBody, { 'x-csrf-token': 'T' }));
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });
    }

    it('coverage=false keeps the historical array output and does not fetch measurements', async () => {
      mockAunitCoverageFlow(200, '<unexpected/>');
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'unittest',
        type: 'CLAS',
        name: 'ZCL_ABAPGIT_HASH',
        coverage: 'false',
      });

      expect(result.isError).toBeUndefined();
      const out = JSON.parse(result.content[0]?.text ?? 'null');
      expect(Array.isArray(out)).toBe(true);
      expect(out.length).toBeGreaterThan(0);
      const calls = mockFetch.mock.calls.map((call) => ({
        url: String(call[0]),
        method: (call[1] as { method?: string } | undefined)?.method ?? 'GET',
        body: String((call[1] as { body?: unknown } | undefined)?.body ?? ''),
      }));
      expect(calls.some((call) => call.url.includes('/coverage/measurements/'))).toBe(false);
      expect(calls.find((call) => call.url.includes('/abapunit/testruns'))?.body).toContain(
        '<coverage active="false"/>',
      );
    });

    it('coverage=true keeps test results when the coverage measurement fetch returns 404', async () => {
      mockAunitCoverageFlow(404, 'Not Found');
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'unittest',
        type: 'CLAS',
        name: 'ZCL_ABAPGIT_HASH',
        coverage: true,
      });

      expect(result.isError).toBeUndefined();
      const out = JSON.parse(result.content[0]?.text ?? '{}');
      expect(out.tests.length).toBeGreaterThan(0);
      expect(out.coverage).toBeUndefined();
      expect(out.coverageNote).toContain('Coverage unavailable');
    });

    it('coverage=true keeps test results when the coverage measurement XML has no valid aggregate', async () => {
      mockAunitCoverageFlow(
        200,
        `<?xml version="1.0"?>
<cov:result name="ADT_ROOT_NODE" xmlns:cov="http://www.sap.com/adt/cov">
  <nodes>
    <node>
      <coverages>
        <coverage type="statement" total="bad" executed="1"/>
      </coverages>
    </node>
  </nodes>
</cov:result>`,
      );
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'unittest',
        type: 'CLAS',
        name: 'ZCL_ABAPGIT_HASH',
        coverage: true,
      });

      expect(result.isError).toBeUndefined();
      const out = JSON.parse(result.content[0]?.text ?? '{}');
      expect(out.tests.length).toBeGreaterThan(0);
      expect(out.coverage).toBeUndefined();
      expect(out.coverageNote).toContain('Coverage unavailable');
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
      setCachedFeatures({ ...featuresOff(), abapRelease: '757', systemType: 'btp' });
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
});
