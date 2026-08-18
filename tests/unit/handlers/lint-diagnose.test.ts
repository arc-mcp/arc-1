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
const { parseAunitRunResult, parseNativeJunitSummary } = await import('../../../src/adt/aunit.js');
const { toLegacyAunitResults } = await import('../../../src/handlers/diagnose.js');

const WRITE_CONFIG = { ...DEFAULT_CONFIG, allowWrites: true };
const AUNIT_TESTRUN_WITH_COVERAGE = readFileSync(
  new URL('../../fixtures/xml/aunit-testrun-with-coverage.xml', import.meta.url),
  'utf-8',
);
const AUNIT_CAPTURED_MIXED = readFileSync(
  new URL('../../fixtures/xml/aunit-testrun-mixed-alerts.xml', import.meta.url),
  'utf-8',
);
const AUNIT_CAPTURED_NW750 = readFileSync(
  new URL('../../fixtures/xml/aunit-testrun-nw750.xml', import.meta.url),
  'utf-8',
);
const AUNIT_CAPTURED_PROGRAM_ALERT = readFileSync(
  new URL('../../fixtures/xml/aunit-testrun-program-alert.xml', import.meta.url),
  'utf-8',
);
const AUNIT_MIXED_RISK = `
  <aunit:runResult xmlns:aunit="http://www.sap.com/adt/aunit">
    <program name="ZCL_MIXED"><testClasses>
      <testClass name="LTCL_HARMLESS" riskLevel="harmless"><testMethods><testMethod name="PASSES" executionTime="0.1"/></testMethods></testClass>
      <testClass name="LTCL_CRITICAL" riskLevel="critical"><alerts><alert kind="warning" severity="tolerable"><title>No execution, risk level of test class exceeds upper limit</title></alert></alerts></testClass>
    </testClasses></program>
  </aunit:runResult>`;
const AUNIT_HARMLESS_ONLY = `
  <aunit:runResult xmlns:aunit="http://www.sap.com/adt/aunit">
    <program name="ZARC1_MIXED"><testClasses>
      <testClass name="LTCL_HARMLESS" riskLevel="harmless"><testMethods><testMethod name="PASSES" executionTime="0.1"/></testMethods></testClass>
    </testClasses></program>
  </aunit:runResult>`;
const AUNIT_LTCL_TEST_SOURCE = `
  CLASS ltcl_test DEFINITION FOR TESTING RISK LEVEL HARMLESS.
    METHODS adler32 FOR TESTING.
  ENDCLASS.`;
const AUNIT_SILENT_MIXED_SOURCE = `
  REPORT zarc1_mixed.
  CLASS lcl_production_helper DEFINITION.
  ENDCLASS.
  CLASS ltd_mock DEFINITION FOR TESTING.
    METHODS configure.
  ENDCLASS.
  CLASS ltcl_harmless DEFINITION FOR TESTING RISK LEVEL HARMLESS.
    METHODS passes FOR TESTING.
  ENDCLASS.
  CLASS ltcl_dangerous DEFINITION FOR TESTING RISK LEVEL DANGEROUS.
    METHODS mutates FOR TESTING.
  ENDCLASS.`;

function mockPublicAunitReconciliation(junit: string, legacy: string, testSource = AUNIT_LTCL_TEST_SOURCE): void {
  mockFetch.mockReset();
  mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
    const method = opts?.method ?? 'GET';
    const path = new URL(String(url)).pathname;
    if (method === 'HEAD' && path === '/sap/bc/adt/core/discovery') {
      return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
    }
    if (method === 'GET' && path.endsWith('/api/abapunit/runs/00000000000000000000000000000000')) {
      return Promise.resolve(mockResponse(200, '<runStatus/>'));
    }
    if (method === 'POST' && path === '/sap/bc/adt/api/abapunit/runs') {
      return Promise.resolve(
        mockResponse(201, '', {
          location: '/sap/bc/adt/api/abapunit/runs/R1',
          'x-csrf-token': 'T',
        }),
      );
    }
    if (method === 'GET' && path === '/sap/bc/adt/api/abapunit/runs/R1') {
      return Promise.resolve(
        mockResponse(
          200,
          '<runStatus><progress status="Completed"/><link rel="run-result" type="application/vnd.sap.adt.api.junit.run-result.v1+xml" href="/sap/bc/adt/api/abapunit/results/R1"/></runStatus>',
        ),
      );
    }
    if (method === 'GET' && path === '/sap/bc/adt/api/abapunit/results/R1') {
      return Promise.resolve(mockResponse(200, junit));
    }
    if (method === 'GET' && path.endsWith('/source/main')) {
      return Promise.resolve(mockResponse(200, 'CLASS zcl_test DEFINITION PUBLIC. ENDCLASS.'));
    }
    if (method === 'GET' && path.endsWith('/includes/testclasses')) {
      return Promise.resolve(mockResponse(200, testSource));
    }
    if (method === 'POST' && path === '/sap/bc/adt/abapunit/testruns') {
      return Promise.resolve(mockResponse(200, legacy));
    }
    return Promise.resolve(mockResponse(404, 'unexpected'));
  });
}

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

  describe('SAPDiagnose syntax', () => {
    it('never reports clean when the object does not exist (SAP checked nothing)', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        if (String(url).includes('/checkruns')) {
          return Promise.resolve(
            mockResponse(
              200,
              `<?xml version="1.0" encoding="utf-8"?><chkrun:checkRunReports xmlns:chkrun="http://www.sap.com/adt/checkrun"><chkrun:checkReport chkrun:reporter="abapCheckRun" chkrun:status="notProcessed" chkrun:statusText="Resource CLASS ZCL_DOES_NOT_EXIST does not exist."/></chkrun:checkRunReports>`,
            ),
          );
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 't' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'syntax',
        type: 'CLAS',
        name: 'ZCL_DOES_NOT_EXIST',
        source: 'CLASS zcl_x DEFINITION.\nENDCLASS.\nCLASS zcl_x IMPLEMENTATION.\nrv = 42 +.\nENDCLASS.',
      });

      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0]?.text);
      expect(payload.checked).toBe(false);
      expect(payload.hasErrors).toBe(true);
      expect(payload.messages[0].text).toContain('does not exist');
      expect(payload.messages[0].text).toContain('Not checked');
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

  describe('SAPDiagnose legacy AUnit compatibility', () => {
    it.each([
      { label: '8.16', xml: AUNIT_CAPTURED_MIXED, durations: [0.63, 0] },
      { label: '7.50', xml: AUNIT_CAPTURED_NW750, durations: [0.05, 0] },
    ])('preserves every captured $label legacy row and second-based duration', ({ xml, durations }) => {
      const rows = toLegacyAunitResults(parseAunitRunResult(xml));

      expect(
        rows.map(({ testClass, testMethod, status, duration }) => ({ testClass, testMethod, status, duration })),
      ).toEqual([
        { testClass: 'LTCL_OK', testMethod: 'FAILS', status: 'failed', duration: durations[0] },
        { testClass: 'LTCL_OK', testMethod: 'PASSES', status: 'passed', duration: durations[1] },
        { testClass: 'LTCL_RISKY', testMethod: '(class-level alert)', status: 'skipped', duration: undefined },
        { testClass: 'LTCL_SETUP_FAIL', testMethod: '(class-level alert)', status: 'failed', duration: undefined },
      ]);
      expect(rows.every((row) => row.program === 'ZCL_ARC1_AUNIT_PROBE')).toBe(true);
      expect(rows[0]?.message).toContain('Expected [2] Actual [1]');
      expect(rows[2]?.message).toContain('risk level of test class exceeds upper limit');
      expect(rows[3]?.message).toContain('CX_SY_ITAB_LINE_NOT_FOUND');
    });

    it('preserves captured program alerts and the historical empty-class row', () => {
      expect(toLegacyAunitResults(parseAunitRunResult(AUNIT_CAPTURED_PROGRAM_ALERT))).toEqual([
        expect.objectContaining({
          program: 'ZCL_ARC1_AUNIT_PROBE',
          testClass: '(program)',
          testMethod: '(alert)',
          status: 'failed',
          message: expect.stringContaining('"ZCL_ARC1_AUNIT_HELPER" is unknown'),
        }),
      ]);
      expect(
        toLegacyAunitResults(
          parseAunitRunResult(
            '<runResult><program name="ZCL_X"><testClasses><testClass name="LTCL_EMPTY"/></testClasses></program></runResult>',
          ),
        ),
      ).toEqual([
        {
          program: 'ZCL_X',
          testClass: 'LTCL_EMPTY',
          testMethod: '(class-level alert)',
          status: 'skipped',
          message: 'test class reported no test methods and no alert',
        },
      ]);
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
        if (method === 'GET' && urlStr.includes('/includes/testclasses')) {
          return Promise.resolve(mockResponse(200, AUNIT_LTCL_TEST_SOURCE, { 'x-csrf-token': 'T' }));
        }
        if (method === 'GET' && urlStr.includes('/source/main')) {
          return Promise.resolve(
            mockResponse(200, 'CLASS zcl_abapgit_hash DEFINITION PUBLIC. ENDCLASS.', {
              'x-csrf-token': 'T',
            }),
          );
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
      expect(calls.filter((call) => call.method === 'GET' && call.url.includes('/source/main'))).toHaveLength(2);
      expect(calls.filter((call) => call.method === 'GET' && call.url.includes('/includes/testclasses'))).toHaveLength(
        2,
      );
    });

    it.each([
      { label: 'default legacy', coverage: false },
      { label: 'legacy coverage', coverage: true },
    ])('returns a tool error with structured evidence for a silently incomplete $label run', async ({ coverage }) => {
      let sourceReads = 0;
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const path = new URL(String(url)).pathname;
        if (method === 'GET' && path === '/sap/bc/adt/programs/programs/ZARC1_MIXED/source/main') {
          sourceReads += 1;
          return Promise.resolve(mockResponse(200, AUNIT_SILENT_MIXED_SOURCE, { etag: '"stable"' }));
        }
        if (method === 'HEAD' && path === '/sap/bc/adt/core/discovery') {
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        }
        if (method === 'POST' && path === '/sap/bc/adt/abapunit/testruns') {
          return Promise.resolve(mockResponse(200, AUNIT_HARMLESS_ONLY));
        }
        return Promise.resolve(mockResponse(404, 'unexpected'));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'unittest',
        type: 'PROG',
        name: 'ZARC1_MIXED',
        ...(coverage ? { coverage: true } : {}),
      });

      expect(result.isError).toBe(true);
      const payload = JSON.parse(result.content[0]?.text ?? '{}');
      expect(payload).toMatchObject({
        outcome: 'incomplete',
        summary: { tests: 1, passed: 1 },
        sourceSelectionEvidence: {
          status: 'verified',
          omittedNonHarmlessTestClasses: [{ testClass: 'LTCL_DANGEROUS', riskLevel: 'dangerous' }],
        },
      });
      expect(payload.alerts).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'sourceRiskSelection', testClass: 'LTCL_DANGEROUS' })]),
      );
      expect(sourceReads).toBe(2);
    });

    it('returns a tool error when active source changes during a default legacy run', async () => {
      let sourceReads = 0;
      const harmlessSource = `REPORT zarc1_race_legacy.
        CLASS ltcl_harmless DEFINITION FOR TESTING RISK LEVEL HARMLESS.
          METHODS passes FOR TESTING.
        ENDCLASS.`;
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const path = new URL(String(url)).pathname;
        if (method === 'GET' && path === '/sap/bc/adt/programs/programs/ZARC1_RACE_LEGACY/source/main') {
          sourceReads += 1;
          return Promise.resolve(
            mockResponse(200, sourceReads === 1 ? harmlessSource : `${harmlessSource}\n" activated change`, {
              etag: sourceReads === 1 ? '"before"' : '"after"',
            }),
          );
        }
        if (method === 'HEAD' && path === '/sap/bc/adt/core/discovery') {
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        }
        if (method === 'POST' && path === '/sap/bc/adt/abapunit/testruns') {
          return Promise.resolve(mockResponse(200, AUNIT_HARMLESS_ONLY));
        }
        return Promise.resolve(mockResponse(404, 'unexpected'));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'unittest',
        type: 'PROG',
        name: 'ZARC1_RACE_LEGACY',
      });

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({
        outcome: 'incomplete',
        sourceSelectionEvidence: {
          status: 'unavailable',
          reason: expect.stringContaining('changed while ABAP Unit evidence was being collected'),
        },
      });
      expect(sourceReads).toBe(2);
    });

    it.each([
      { label: 'legacy', args: {}, expectToolError: true },
      { label: 'structured', args: { resultFormat: 'structured' }, expectToolError: false },
      { label: 'generated JUnit', args: { resultFormat: 'junit', coverage: true }, expectToolError: false },
    ])(
      'never reports an omitted executable harmless class as sound no_tests in $label output',
      async ({ args, expectToolError }) => {
        const harmlessSource = `REPORT zarc1_missing_harmless.
        CLASS ltcl_harmless DEFINITION FOR TESTING RISK LEVEL HARMLESS.
          METHODS passes FOR TESTING.
        ENDCLASS.`;
        mockFetch.mockReset();
        mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
          const method = opts?.method ?? 'GET';
          const path = new URL(String(url)).pathname;
          if (method === 'GET' && path === '/sap/bc/adt/programs/programs/ZARC1_MISSING_HARMLESS/source/main') {
            return Promise.resolve(mockResponse(200, harmlessSource, { etag: '"stable"' }));
          }
          if (method === 'HEAD' && path === '/sap/bc/adt/core/discovery') {
            return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
          }
          if (method === 'POST' && path === '/sap/bc/adt/abapunit/testruns') {
            return Promise.resolve(mockResponse(200, '<aunit:runResult xmlns:aunit="http://www.sap.com/adt/aunit"/>'));
          }
          return Promise.resolve(mockResponse(404, 'unexpected'));
        });

        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
          action: 'unittest',
          type: 'PROG',
          name: 'ZARC1_MISSING_HARMLESS',
          ...args,
        });

        expect(result.isError === true).toBe(expectToolError);
        const payload = JSON.parse(result.content[0]?.text ?? '{}');
        expect(payload).toMatchObject({
          outcome: 'incomplete',
          summary: { tests: 0 },
          sourceSelectionEvidence: {
            status: 'verified',
            omittedTestClasses: [{ testClass: 'LTCL_HARMLESS', riskLevel: 'harmless' }],
            omittedNonHarmlessTestClasses: [],
          },
        });
        if ('resultFormat' in args && args.resultFormat === 'junit') {
          expect(parseNativeJunitSummary(payload.junit)).toMatchObject({ tests: 1, errors: 1 });
        }
      },
    );

    it('structured format returns CI-safe method and outcome evidence through the dispatcher', async () => {
      mockAunitCoverageFlow(200, '<unused/>');
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'unittest',
        type: 'CLAS',
        name: 'ZCL_ABAPGIT_HASH',
        resultFormat: 'structured',
      });

      expect(result.isError).toBeUndefined();
      const out = JSON.parse(result.content[0]?.text ?? '{}');
      expect(out).toMatchObject({
        outcome: 'passed',
        selection: { maxRisk: 'harmless' },
        summary: { tests: 4, passed: 4, failures: 0, errors: 0, skipped: 0 },
        coverageEvidence: 'not_requested',
      });
      expect(out.tests).toHaveLength(4);
      expect(out.alerts).toEqual([]);
    });

    it.each([
      { includeSubpackages: false, selectedPrograms: ['ZCL_ROOT'] },
      { includeSubpackages: true, selectedPrograms: ['ZCL_ROOT', 'ZCL_SUB'] },
    ])(
      'runs a stable DEVC package scope with includeSubpackages=$includeSubpackages',
      async ({ includeSubpackages, selectedPrograms }) => {
        const packageSearch = `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
          <adtcore:objectReference adtcore:type="CLAS/OC" adtcore:name="ZCL_ROOT" adtcore:packageName="ZPKG" adtcore:uri="/sap/bc/adt/oo/classes/zcl_root"/>
          <adtcore:objectReference adtcore:type="CLAS/OC" adtcore:name="ZCL_SUB" adtcore:packageName="ZPKG_SUB" adtcore:uri="/sap/bc/adt/oo/classes/zcl_sub"/>
        </adtcore:objectReferences>`;
        const legacyResult = `<aunit:runResult xmlns:aunit="http://www.sap.com/adt/aunit">
          ${selectedPrograms
            .map(
              (program) =>
                `<program name="${program}"><testClasses><testClass name="LTCL_TEST" riskLevel="harmless"><testMethods><testMethod name="PASSES"/></testMethods></testClass></testClasses></program>`,
            )
            .join('')}
        </aunit:runResult>`;
        const postedBodies: string[] = [];
        mockFetch.mockReset();
        mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: unknown }) => {
          const method = opts?.method ?? 'GET';
          const parsed = new URL(String(url));
          if (method === 'GET' && parsed.pathname === '/sap/bc/adt/packages/ZPKG') {
            return Promise.resolve(mockResponse(200, '<package/>'));
          }
          if (method === 'GET' && parsed.pathname === '/sap/bc/adt/repository/informationsystem/search') {
            return Promise.resolve(mockResponse(200, packageSearch));
          }
          if (method === 'GET' && parsed.pathname.endsWith('/source/main')) {
            const program = parsed.pathname.includes('zcl_sub') ? 'ZCL_SUB' : 'ZCL_ROOT';
            return Promise.resolve(
              mockResponse(200, `CLASS ${program.toLowerCase()} DEFINITION PUBLIC. ENDCLASS.`, {
                etag: `"${program}"`,
              }),
            );
          }
          if (method === 'GET' && parsed.pathname.endsWith('/includes/testclasses')) {
            return Promise.resolve(
              mockResponse(
                200,
                'CLASS ltcl_test DEFINITION FOR TESTING RISK LEVEL HARMLESS. METHODS passes FOR TESTING. ENDCLASS.',
                { etag: '"tests"' },
              ),
            );
          }
          if (method === 'HEAD' && parsed.pathname === '/sap/bc/adt/core/discovery') {
            return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
          }
          if (method === 'POST' && parsed.pathname === '/sap/bc/adt/abapunit/testruns') {
            postedBodies.push(String(opts?.body ?? ''));
            return Promise.resolve(mockResponse(200, legacyResult));
          }
          return Promise.resolve(mockResponse(404, 'unexpected'));
        });

        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
          action: 'unittest',
          type: 'DEVC',
          name: 'ZPKG',
          includeSubpackages,
          resultFormat: 'structured',
        });

        expect(result.isError).toBeUndefined();
        const payload = JSON.parse(result.content[0]?.text ?? '{}');
        expect(payload).toMatchObject({
          outcome: 'passed',
          summary: { tests: selectedPrograms.length, passed: selectedPrograms.length },
          sourceSelectionEvidence: {
            status: 'verified',
            declaredTestClasses: selectedPrograms.map((program) => ({ program, testClass: 'LTCL_TEST' })),
          },
        });
        expect(postedBodies).toHaveLength(1);
        expect(postedBodies[0]).toContain('adtcore:uri="/sap/bc/adt/oo/classes/zcl_root"');
        expect(postedBodies[0]?.includes('adtcore:uri="/sap/bc/adt/oo/classes/zcl_sub"')).toBe(includeSubpackages);
        const packageSearches = mockFetch.mock.calls.filter((call) =>
          String(call[0]).includes('/repository/informationsystem/search'),
        );
        expect(packageSearches).toHaveLength(2);
      },
    );

    it('marks a package run incomplete when package membership changes during evidence collection', async () => {
      let searches = 0;
      const searchXml = (
        includeSecond: boolean,
      ) => `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
        <adtcore:objectReference adtcore:type="CLAS/OC" adtcore:name="ZCL_ROOT" adtcore:packageName="ZPKG" adtcore:uri="/sap/bc/adt/oo/classes/zcl_root"/>
        ${includeSecond ? '<adtcore:objectReference adtcore:type="CLAS/OC" adtcore:name="ZCL_ADDED" adtcore:packageName="ZPKG" adtcore:uri="/sap/bc/adt/oo/classes/zcl_added"/>' : ''}
      </adtcore:objectReferences>`;
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const path = new URL(String(url)).pathname;
        if (method === 'GET' && path === '/sap/bc/adt/packages/ZPKG') {
          return Promise.resolve(mockResponse(200, '<package/>'));
        }
        if (method === 'GET' && path === '/sap/bc/adt/repository/informationsystem/search') {
          searches += 1;
          return Promise.resolve(mockResponse(200, searchXml(searches > 1)));
        }
        if (method === 'GET' && path.endsWith('/source/main')) {
          return Promise.resolve(mockResponse(200, 'CLASS zcl_root DEFINITION PUBLIC. ENDCLASS.', { etag: '"main"' }));
        }
        if (method === 'GET' && path.endsWith('/includes/testclasses')) {
          return Promise.resolve(
            mockResponse(
              200,
              'CLASS ltcl_test DEFINITION FOR TESTING RISK LEVEL HARMLESS. METHODS passes FOR TESTING. ENDCLASS.',
              { etag: '"tests"' },
            ),
          );
        }
        if (method === 'HEAD' && path === '/sap/bc/adt/core/discovery') {
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        }
        if (method === 'POST' && path === '/sap/bc/adt/abapunit/testruns') {
          return Promise.resolve(
            mockResponse(
              200,
              '<aunit:runResult xmlns:aunit="http://www.sap.com/adt/aunit"><program name="ZCL_ROOT"><testClasses><testClass name="LTCL_TEST" riskLevel="harmless"><testMethods><testMethod name="PASSES"/></testMethods></testClass></testClasses></program></aunit:runResult>',
            ),
          );
        }
        return Promise.resolve(mockResponse(404, 'unexpected'));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'unittest',
        type: 'DEVC',
        name: 'ZPKG',
        resultFormat: 'structured',
      });

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({
        outcome: 'incomplete',
        sourceSelectionEvidence: {
          status: 'unavailable',
          reason: expect.stringContaining('Package membership or active ABAP source changed'),
        },
      });
    });

    it('refuses an over-budget package before expanding source or executing tests', async () => {
      const packageSearch = `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
        ${Array.from(
          { length: 300 },
          (_, index) =>
            `<adtcore:objectReference adtcore:type="CLAS/OC" adtcore:name="ZCL_BUDGET_${index}" adtcore:packageName="ZPKG" adtcore:uri="/sap/bc/adt/oo/classes/zcl_budget_${index}"/>`,
        ).join('')}
      </adtcore:objectReferences>`;
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const path = new URL(String(url)).pathname;
        if (method === 'GET' && path === '/sap/bc/adt/packages/ZPKG') {
          return Promise.resolve(mockResponse(200, '<package/>'));
        }
        if (method === 'GET' && path === '/sap/bc/adt/repository/informationsystem/search') {
          return Promise.resolve(mockResponse(200, packageSearch));
        }
        return Promise.resolve(mockResponse(500, 'unexpected request'));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'unittest',
        type: 'DEVC',
        name: 'ZPKG',
        resultFormat: 'structured',
      });

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({
        outcome: 'incomplete',
        sourceSelectionEvidence: {
          status: 'unavailable',
          reason: expect.stringMatching(/exceeding the 500-request limit/i),
        },
      });
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls.every((call) => (call[1]?.method ?? 'GET') === 'GET')).toBe(true);
    });

    it('marks the live 7.58 PROG shape incomplete when source declares a silently omitted dangerous class', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const path = new URL(String(url)).pathname;
        if (method === 'GET' && path === '/sap/bc/adt/programs/programs/ZARC1_MIXED/source/main') {
          return Promise.resolve(mockResponse(200, AUNIT_SILENT_MIXED_SOURCE));
        }
        if (method === 'HEAD' && path === '/sap/bc/adt/core/discovery') {
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        }
        if (method === 'POST' && path === '/sap/bc/adt/abapunit/testruns') {
          return Promise.resolve(mockResponse(200, AUNIT_HARMLESS_ONLY));
        }
        return Promise.resolve(mockResponse(404, 'unexpected'));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'unittest',
        type: 'PROG',
        name: 'ZARC1_MIXED',
        resultFormat: 'structured',
      });

      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0]?.text ?? '{}');
      expect(payload).toMatchObject({
        outcome: 'incomplete',
        summary: { tests: 1, passed: 1 },
        sourceSelectionEvidence: {
          status: 'verified',
          omittedNonHarmlessTestClasses: [{ testClass: 'LTCL_DANGEROUS', riskLevel: 'dangerous' }],
        },
      });
      expect(payload.alerts).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'sourceRiskSelection', testClass: 'LTCL_DANGEROUS' })]),
      );
    });

    it('audits a FUGR main program and static test include before and after the run', async () => {
      const main = 'FUNCTION-POOL zarc1_fg.\nINCLUDE lzarc1_fgt99.';
      const tests = `CLASS ltcl_harmless DEFINITION FOR TESTING RISK LEVEL HARMLESS.
        METHODS passes FOR TESTING.
      ENDCLASS.`;
      const reads = { main: 0, include: 0 };
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const path = new URL(String(url)).pathname;
        if (method === 'GET' && path === '/sap/bc/adt/functions/groups/ZARC1_FG/source/main') {
          reads.main += 1;
          return Promise.resolve(mockResponse(200, main, { etag: '"main"' }));
        }
        if (method === 'GET' && path === '/sap/bc/adt/programs/includes/LZARC1_FGT99/source/main') {
          reads.include += 1;
          return Promise.resolve(mockResponse(200, tests, { etag: '"tests"' }));
        }
        if (method === 'HEAD' && path === '/sap/bc/adt/core/discovery') {
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        }
        if (method === 'POST' && path === '/sap/bc/adt/abapunit/testruns') {
          return Promise.resolve(mockResponse(200, AUNIT_HARMLESS_ONLY));
        }
        return Promise.resolve(mockResponse(404, 'unexpected'));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'unittest',
        type: 'FUGR',
        name: 'ZARC1_FG',
        resultFormat: 'structured',
      });

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({
        outcome: 'passed',
        sourceSelectionEvidence: { status: 'verified' },
      });
      expect(reads).toEqual({ main: 2, include: 2 });
    });

    it('audits pragma-suffixed static PROG includes before and after the test run', async () => {
      const mainSource = `REPORT zarc1_include.
        INCLUDE zarc1_tests ##NEEDED.
        CLASS ltcl_harmless DEFINITION FOR TESTING RISK LEVEL HARMLESS.
          METHODS passes FOR TESTING.
        ENDCLASS.`;
      const includeSource = `CLASS ltcl_dangerous DEFINITION FOR TESTING RISK LEVEL DANGEROUS.
        METHODS mutates FOR TESTING.
        ENDCLASS.`;
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const parsed = new URL(String(url));
        if (method === 'GET' && parsed.pathname.endsWith('/programs/programs/ZARC1_INCLUDE/source/main')) {
          return Promise.resolve(mockResponse(200, mainSource, { etag: '"main-1"' }));
        }
        if (method === 'GET' && parsed.pathname.endsWith('/programs/includes/ZARC1_TESTS/source/main')) {
          return Promise.resolve(mockResponse(200, includeSource, { etag: '"include-1"' }));
        }
        if (method === 'HEAD' && parsed.pathname === '/sap/bc/adt/core/discovery') {
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        }
        if (method === 'POST' && parsed.pathname === '/sap/bc/adt/abapunit/testruns') {
          return Promise.resolve(mockResponse(200, AUNIT_HARMLESS_ONLY));
        }
        return Promise.resolve(mockResponse(404, 'unexpected'));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'unittest',
        type: 'PROG',
        name: 'ZARC1_INCLUDE',
        resultFormat: 'structured',
      });

      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0]?.text ?? '{}');
      expect(payload).toMatchObject({
        outcome: 'incomplete',
        sourceSelectionEvidence: {
          status: 'verified',
          omittedNonHarmlessTestClasses: [{ testClass: 'LTCL_DANGEROUS', riskLevel: 'dangerous' }],
        },
      });
      const includeReads = mockFetch.mock.calls
        .map((call) => new URL(String(call[0])))
        .filter((url) => url.pathname.endsWith('/programs/includes/ZARC1_TESTS/source/main'));
      expect(includeReads).toHaveLength(2);
      expect(includeReads.every((url) => url.searchParams.get('version') === 'active')).toBe(true);
    });

    it('fails closed when a CLAS macros include declares an omitted test method', async () => {
      const testclasses = `CLASS ltcl_harmless DEFINITION FOR TESTING RISK LEVEL HARMLESS.
          METHODS passes FOR TESTING.
        ENDCLASS.
        CLASS ltcl_critical DEFINITION FOR TESTING RISK LEVEL CRITICAL.
          test_method hidden.
        ENDCLASS.`;
      const macros = `DEFINE test_method.
          METHODS &1 FOR TESTING.
        END-OF-DEFINITION.`;
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const path = new URL(String(url)).pathname;
        if (method === 'GET' && path.endsWith('/classes/ZARC1_MIXED/source/main')) {
          return Promise.resolve(mockResponse(200, 'CLASS zarc1_mixed DEFINITION PUBLIC. ENDCLASS.'));
        }
        if (method === 'GET' && path.endsWith('/classes/ZARC1_MIXED/includes/testclasses')) {
          return Promise.resolve(mockResponse(200, testclasses));
        }
        if (method === 'GET' && path.endsWith('/classes/ZARC1_MIXED/includes/macros')) {
          return Promise.resolve(mockResponse(200, macros));
        }
        if (method === 'HEAD' && path === '/sap/bc/adt/core/discovery') {
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        }
        if (method === 'POST' && path === '/sap/bc/adt/abapunit/testruns') {
          return Promise.resolve(mockResponse(200, AUNIT_HARMLESS_ONLY));
        }
        return Promise.resolve(mockResponse(404, 'unexpected'));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'unittest',
        type: 'CLAS',
        name: 'ZARC1_MIXED',
        resultFormat: 'structured',
      });

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({
        outcome: 'incomplete',
        sourceSelectionEvidence: {
          status: 'unavailable',
          reason: expect.stringMatching(/LTCL_CRITICAL.*macro TEST_METHOD/i),
        },
      });
      expect(
        mockFetch.mock.calls.filter((call) =>
          new URL(String(call[0])).pathname.endsWith('/classes/ZARC1_MIXED/includes/macros'),
        ),
      ).toHaveLength(2);
    });

    it('verifies a global CLAS test while rechecking an absent optional testclasses include', async () => {
      const globalSource = `CLASS zcl_global_test DEFINITION PUBLIC FINAL FOR TESTING RISK LEVEL HARMLESS.
        PUBLIC SECTION.
          METHODS global_test.
        ENDCLASS.`;
      const globalResult = `<aunit:runResult xmlns:aunit="http://www.sap.com/adt/aunit">
        <program name="ZCL_GLOBAL_TEST"><testClasses><testClass name="ZCL_GLOBAL_TEST" riskLevel="harmless">
          <testMethods><testMethod name="GLOBAL_TEST" executionTime="0.1"/></testMethods>
        </testClass></testClasses></program>
      </aunit:runResult>`;
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const parsed = new URL(String(url));
        if (method === 'GET' && parsed.pathname.endsWith('/classes/ZCL_GLOBAL_TEST/source/main')) {
          return Promise.resolve(mockResponse(200, globalSource, { etag: '"global-1"' }));
        }
        if (method === 'GET' && parsed.pathname.endsWith('/classes/ZCL_GLOBAL_TEST/includes/testclasses')) {
          return Promise.resolve(mockResponse(404, 'absent'));
        }
        if (method === 'HEAD' && parsed.pathname === '/sap/bc/adt/core/discovery') {
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        }
        if (method === 'POST' && parsed.pathname === '/sap/bc/adt/abapunit/testruns') {
          return Promise.resolve(mockResponse(200, globalResult));
        }
        return Promise.resolve(mockResponse(404, 'unexpected'));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'unittest',
        type: 'CLAS',
        name: 'ZCL_GLOBAL_TEST',
        resultFormat: 'structured',
      });

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({
        outcome: 'passed',
        sourceSelectionEvidence: {
          status: 'verified',
          declaredTestClasses: [{ testClass: 'ZCL_GLOBAL_TEST', riskLevel: 'harmless' }],
        },
      });
      const testIncludeReads = mockFetch.mock.calls.filter((call) =>
        String(call[0]).includes('/classes/ZCL_GLOBAL_TEST/includes/testclasses'),
      );
      expect(testIncludeReads).toHaveLength(2);
    });

    it('fails closed when the active source snapshot changes during a structured test run', async () => {
      let sourceReads = 0;
      const harmlessSource = `REPORT zarc1_race.
        CLASS ltcl_harmless DEFINITION FOR TESTING RISK LEVEL HARMLESS.
          METHODS passes FOR TESTING.
        ENDCLASS.`;
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const parsed = new URL(String(url));
        if (method === 'GET' && parsed.pathname.endsWith('/programs/programs/ZARC1_RACE/source/main')) {
          sourceReads += 1;
          return Promise.resolve(
            mockResponse(200, sourceReads === 1 ? harmlessSource : `${harmlessSource}\n" activated change`, {
              etag: sourceReads === 1 ? '"before"' : '"after"',
            }),
          );
        }
        if (method === 'HEAD' && parsed.pathname === '/sap/bc/adt/core/discovery') {
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        }
        if (method === 'POST' && parsed.pathname === '/sap/bc/adt/abapunit/testruns') {
          return Promise.resolve(mockResponse(200, AUNIT_HARMLESS_ONLY));
        }
        return Promise.resolve(mockResponse(404, 'unexpected'));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'unittest',
        type: 'PROG',
        name: 'ZARC1_RACE',
        resultFormat: 'structured',
      });

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({
        outcome: 'incomplete',
        sourceSelectionEvidence: {
          status: 'unavailable',
          reason: expect.stringContaining('changed while ABAP Unit evidence was being collected'),
        },
      });
      expect(sourceReads).toBe(2);
    });

    it('junit format returns SAP-native JUnit from the public API through the dispatcher', async () => {
      const junit = '<testsuites tests="4" failures="0" errors="0" skipped="0"/>';
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const path = new URL(String(url)).pathname;
        if (method === 'HEAD' && path === '/sap/bc/adt/core/discovery') {
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        }
        if (method === 'GET' && path.endsWith('/api/abapunit/runs/00000000000000000000000000000000')) {
          return Promise.resolve(mockResponse(200, '<runStatus/>'));
        }
        if (method === 'POST' && path === '/sap/bc/adt/api/abapunit/runs') {
          return Promise.resolve(
            mockResponse(201, '', {
              location: '/sap/bc/adt/api/abapunit/runs/R1',
              'x-csrf-token': 'T',
            }),
          );
        }
        if (method === 'GET' && path === '/sap/bc/adt/api/abapunit/runs/R1') {
          return Promise.resolve(
            mockResponse(
              200,
              '<runStatus><progress status="Completed"/><link rel="run-result" type="application/vnd.sap.adt.api.junit.run-result.v1+xml" href="/sap/bc/adt/api/abapunit/results/R1"/></runStatus>',
            ),
          );
        }
        if (method === 'GET' && path === '/sap/bc/adt/api/abapunit/results/R1') {
          return Promise.resolve(mockResponse(200, junit));
        }
        if (method === 'GET' && path.endsWith('/source/main')) {
          return Promise.resolve(mockResponse(200, 'CLASS zcl_abapgit_hash DEFINITION PUBLIC. ENDCLASS.'));
        }
        if (method === 'GET' && path.endsWith('/includes/testclasses')) {
          return Promise.resolve(mockResponse(200, AUNIT_LTCL_TEST_SOURCE));
        }
        if (method === 'POST' && path === '/sap/bc/adt/abapunit/testruns') {
          return Promise.resolve(mockResponse(200, AUNIT_TESTRUN_WITH_COVERAGE));
        }
        return Promise.resolve(mockResponse(404, 'unexpected'));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'unittest',
        type: 'CLAS',
        name: 'ZCL_ABAPGIT_HASH',
        resultFormat: 'junit',
      });

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({
        protocol: 'public-api',
        outcome: 'passed',
        summary: { tests: 4, failures: 0, errors: 0, skipped: 0 },
        junit,
        selectionEvidence: { outcome: 'passed', summary: { tests: 4 } },
      });
    });

    it('keeps a mixed harmless/critical suite incomplete even when native JUnit passes harmless tests', async () => {
      const junit =
        '<testsuites tests="1" failures="0" errors="0" skipped="0"><testsuite name="SAP native" tests="1" failures="0" errors="0" skipped="0"><testcase classname="LTCL_HARMLESS" name="PASSES"/></testsuite></testsuites>';
      mockPublicAunitReconciliation(
        junit,
        AUNIT_MIXED_RISK,
        AUNIT_SILENT_MIXED_SOURCE.replaceAll('dangerous', 'critical'),
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'unittest',
        type: 'CLAS',
        name: 'ZCL_MIXED',
        resultFormat: 'junit',
      });

      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0]?.text ?? '{}');
      expect(payload).toMatchObject({
        outcome: 'incomplete',
        incompleteReason: 'harmless_selection_incomplete',
        summary: { tests: 1, passed: 1 },
        selectionEvidence: { outcome: 'incomplete', summary: { tests: 1 } },
      });
      expect(payload.junit).toContain('<testcase classname="LTCL_HARMLESS" name="PASSES"/>');
      expect(payload.junit).toContain('<error type="ARC1IncompleteEvidence"');
      expect(parseNativeJunitSummary(payload.junit)).toMatchObject({ tests: 2, failures: 0, errors: 1, skipped: 0 });
    });

    it('adds a red native-JUnit diagnostic for the 7.58 silent mixed-risk omission', async () => {
      const junit =
        '<testsuites tests="1" failures="0" errors="0" skipped="0"><testsuite name="SAP native" tests="1" failures="0" errors="0" skipped="0"><testcase classname="LTCL_HARMLESS" name="PASSES"/></testsuite></testsuites>';
      mockPublicAunitReconciliation(junit, AUNIT_HARMLESS_ONLY, AUNIT_SILENT_MIXED_SOURCE);

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'unittest',
        type: 'CLAS',
        name: 'ZARC1_MIXED',
        resultFormat: 'junit',
      });

      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0]?.text ?? '{}');
      expect(payload).toMatchObject({
        outcome: 'incomplete',
        incompleteReason: 'source_declared_non_harmless_omitted',
        sourceSelectionEvidence: {
          status: 'verified',
          omittedNonHarmlessTestClasses: [{ testClass: 'LTCL_DANGEROUS', riskLevel: 'dangerous' }],
        },
      });
      expect(payload.junit).toContain('<testcase classname="LTCL_HARMLESS" name="PASSES"/>');
      expect(payload.junit).toContain('<error type="ARC1IncompleteEvidence"');
      expect(parseNativeJunitSummary(payload.junit)).toMatchObject({ tests: 2, errors: 1 });
    });

    it('adds a failing JUnit diagnostic when legacy evidence fails but native JUnit passes', async () => {
      const junit =
        '<testsuites tests="1" failures="0" errors="0" skipped="0"><testsuite name="SAP native" tests="1" failures="0" errors="0" skipped="0"><testcase classname="LTCL_FAIL" name="FAILS"/></testsuite></testsuites>';
      const legacyFailure = `
        <aunit:runResult xmlns:aunit="http://www.sap.com/adt/aunit">
          <program name="ZCL_FAIL"><testClasses><testClass name="LTCL_FAIL" riskLevel="harmless"><testMethods>
            <testMethod name="FAILS"><alerts><alert kind="failedAssertion" severity="critical"><title>Assertion failed</title></alert></alerts></testMethod>
          </testMethods></testClass></testClasses></program>
        </aunit:runResult>`;
      mockPublicAunitReconciliation(
        junit,
        legacyFailure,
        'CLASS ltcl_fail DEFINITION FOR TESTING RISK LEVEL HARMLESS. METHODS fails FOR TESTING. ENDCLASS.',
      );

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'unittest',
        type: 'CLAS',
        name: 'ZCL_FAIL',
        resultFormat: 'junit',
      });

      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0]?.text ?? '{}');
      expect(payload).toMatchObject({ outcome: 'failed', summary: { tests: 1, passed: 1, failures: 0, errors: 0 } });
      expect(payload.junit).toContain('<testcase classname="LTCL_FAIL" name="FAILS"/>');
      expect(payload.junit).toContain('<failure type="ARC1ReconciledFailure"');
      expect(parseNativeJunitSummary(payload.junit)).toMatchObject({ tests: 2, failures: 1, errors: 0, skipped: 0 });
    });

    it('returns public AUnit deadline exhaustion as incomplete evidence instead of a tool failure', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const path = new URL(String(url)).pathname;
        if (method === 'HEAD' && path === '/sap/bc/adt/core/discovery') {
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        }
        if (method === 'GET' && path.endsWith('/api/abapunit/runs/00000000000000000000000000000000')) {
          return Promise.resolve(mockResponse(200, '<runStatus/>'));
        }
        if (method === 'POST' && path === '/sap/bc/adt/api/abapunit/runs') {
          return Promise.resolve(
            mockResponse(201, '', {
              location: '/sap/bc/adt/api/abapunit/runs/R1',
              'x-csrf-token': 'T',
            }),
          );
        }
        if (method === 'GET' && path === '/sap/bc/adt/api/abapunit/runs/R1') {
          return Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
        }
        return Promise.resolve(mockResponse(404, 'unexpected'));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'unittest',
        type: 'CLAS',
        name: 'ZCL_ABAPGIT_HASH',
        resultFormat: 'junit',
      });

      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0]?.text ?? '{}');
      expect(payload).toMatchObject({
        protocol: 'public-api',
        outcome: 'incomplete',
        incompleteReason: 'timeout',
        summary: { tests: 0, failures: 0, errors: 0, skipped: 0 },
      });
      expect(payload.junit).toContain('<testsuites');
      expect(payload.junit).toContain('<error type="ARC1IncompleteEvidence"');
      expect(parseNativeJunitSummary(payload.junit)).toMatchObject({ tests: 1, failures: 0, errors: 1, skipped: 0 });
    });

    it('returns public AUnit probe deadline exhaustion as incomplete evidence', async () => {
      mockFetch.mockReset();
      mockFetch.mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'unittest',
        type: 'CLAS',
        name: 'ZCL_ABAPGIT_HASH',
        resultFormat: 'junit',
      });

      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0]?.text ?? '{}');
      expect(payload).toMatchObject({
        protocol: 'public-api',
        outcome: 'incomplete',
        incompleteReason: 'timeout',
        polls: 0,
      });
      expect(payload.junit).toContain('<error type="ARC1IncompleteEvidence"');
    });

    it('treats contradictory native zero-tests and executed legacy tests as incomplete', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        const method = opts?.method ?? 'GET';
        const path = new URL(String(url)).pathname;
        if (method === 'HEAD' && path === '/sap/bc/adt/core/discovery') {
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
        }
        if (method === 'GET' && path.endsWith('/api/abapunit/runs/00000000000000000000000000000000')) {
          return Promise.resolve(mockResponse(200, '<runStatus/>'));
        }
        if (method === 'POST' && path === '/sap/bc/adt/api/abapunit/runs') {
          return Promise.resolve(
            mockResponse(201, '', {
              location: '/sap/bc/adt/api/abapunit/runs/R1',
              'x-csrf-token': 'T',
            }),
          );
        }
        if (method === 'GET' && path === '/sap/bc/adt/api/abapunit/runs/R1') {
          return Promise.resolve(
            mockResponse(
              200,
              '<runStatus><progress status="Completed"/><link rel="run-result" type="application/vnd.sap.adt.api.junit.run-result.v1+xml" href="/sap/bc/adt/api/abapunit/results/R1"/></runStatus>',
            ),
          );
        }
        if (method === 'GET' && path === '/sap/bc/adt/api/abapunit/results/R1') {
          return Promise.resolve(mockResponse(200, '<testsuites tests="0" failures="0" errors="0" skipped="0"/>'));
        }
        if (method === 'POST' && path === '/sap/bc/adt/abapunit/testruns') {
          return Promise.resolve(mockResponse(200, AUNIT_TESTRUN_WITH_COVERAGE));
        }
        return Promise.resolve(mockResponse(404, 'unexpected'));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'unittest',
        type: 'CLAS',
        name: 'ZCL_ABAPGIT_HASH',
        resultFormat: 'junit',
      });

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({
        outcome: 'incomplete',
        incompleteReason: 'native_legacy_result_mismatch',
        summary: { tests: 0 },
      });
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
    it('returns decoded authorization trace entries and wires filters', async () => {
      const client = createClient();
      const runTableQuery = vi
        .spyOn(client, 'runTableQuery')
        .mockResolvedValueOnce({
          columns: [],
          rows: [
            {
              USERNAME: 'AUTH_TEST',
              NAME: '',
              TYPE: 'TR',
              OBJECT: 'S_TCODE',
              RC: '12',
              FIELD1: 'SU01',
              ABAPPROG: 'LSUSEU11',
              ABAPLINE: '53',
              FIRSTCALL: '20260709211048',
            },
          ],
        })
        .mockResolvedValueOnce({ columns: [], rows: [{ OBJCT: 'S_TCODE', FIEL1: 'TCD' }] });

      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'authorization_trace',
        user: 'AUTH_TEST',
        authObject: 'S_TCODE',
        onlyFailures: true,
        maxResults: 5,
      });

      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0]!.text);
      expect(payload.entries[0]).toMatchObject({
        user: 'AUTH_TEST',
        authObject: 'S_TCODE',
        rc: 12,
        fields: { TCD: 'SU01' },
      });
      expect(payload.traceState).toMatchObject({
        status: 'unknown',
        parameter: 'auth/auth_user_trace',
      });
      expect(payload.traceState.verify).toContain('RZ11');
      expect(payload.traceState.activation).toBeUndefined();
      expect(runTableQuery).toHaveBeenNthCalledWith(
        1,
        'SUAUTHVALTRC',
        expect.objectContaining({
          where: [
            { field: 'USERNAME', op: '=', value: 'AUTH_TEST' },
            { field: 'OBJECT', op: '=', value: 'S_TCODE' },
            { field: 'RC', op: '<>', value: '0' },
          ],
        }),
      );
    });

    it('returns a focused not-available hint when SUAUTHVALTRC is absent', async () => {
      const client = createClient();
      vi.spyOn(client, 'runTableQuery').mockRejectedValue(
        new AdtApiError("Cannot find 'SUAUTHVALTRC'", 400, '/sap/bc/adt/datapreview/freestyle'),
      );

      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'authorization_trace',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Authorization trace not available on this system');
      expect(result.content[0]?.text).toContain('Display Authorization Trace');
      expect(result.content[0]?.text).toContain('SAP_ALLOW_DATA_PREVIEW');
    });

    it('does not mask SAP authorization failures as backend unavailability', async () => {
      const client = createClient();
      vi.spyOn(client, 'runTableQuery').mockRejectedValue(
        new AdtApiError('Forbidden', 403, '/sap/bc/adt/datapreview/freestyle'),
      );

      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'authorization_trace',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('status 403');
      expect(result.content[0]?.text).not.toContain('Authorization trace not available on this system');
    });

    it('returns the trace-state hint when no authorization rows match', async () => {
      const client = createClient();
      vi.spyOn(client, 'runTableQuery').mockResolvedValue({ columns: [], rows: [] });

      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'authorization_trace',
        onlyFailures: true,
      });

      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0]!.text);
      expect(payload.count).toBe(0);
      expect(payload.note).toContain('activation guidance');
      expect(payload.note).toContain('widen the filters');
      expect(payload.traceState.status).toBe('unknown');
      expect(payload.traceState.warnings).toHaveLength(2);
      expect(payload.traceState.activation.filteredSetup).toContain('STUSERTRACE');
    });

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

  describe('SAPDiagnose ATC completeness', () => {
    it('returns an error with structured evidence when legacy output would hide an incomplete worklist', async () => {
      const client = createClient();
      vi.spyOn(client.http, 'post')
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: 'WL-INCOMPLETE' })
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: '' });
      vi.spyOn(client.http, 'get').mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: '<worklist id="WL-INCOMPLETE" objectSetIsComplete="true"><objects><object>malformed</object></objects></worklist>',
      });

      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'atc',
        type: 'PROG',
        name: 'ZTEST',
      });

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0]?.text)).toMatchObject({
        complete: false,
        processedObjectCount: 0,
        incompleteReasons: expect.arrayContaining([expect.stringMatching(/malformed processed ATC object/i)]),
        hint: expect.stringMatching(/object, package, and selected check variant/i),
      });
    });
  });

  describe('SAPDiagnose action=atc_variants (FEAT-68)', () => {
    const VARIANTS = `<?xml version="1.0" encoding="utf-8"?><nameditem:namedItemList xmlns:nameditem="http://www.sap.com/adt/nameditem"><nameditem:totalItemCount>2</nameditem:totalItemCount><nameditem:namedItem><nameditem:name>ABAP_CLOUD_DEVELOPMENT_DEFAULT</nameditem:name><nameditem:description>Cloud default</nameditem:description><nameditem:data/></nameditem:namedItem><nameditem:namedItem><nameditem:name>ZABAP_CLOUD_DEVELOPMENT</nameditem:name><nameditem:description/><nameditem:data/></nameditem:namedItem></nameditem:namedItemList>`;
    const CUSTOMIZING = `<?xml version="1.0" encoding="utf-8"?><atc:customizing xmlns:atc="http://www.sap.com/adt/atc"><properties><property name="systemCheckVariant" value="ZABAP_CLOUD_DEVELOPMENT"/></properties></atc:customizing>`;

    it('returns the system default + the filtered variant list', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        const u = String(url);
        if (u.includes('/atc/customizing')) return Promise.resolve(mockResponse(200, CUSTOMIZING));
        if (u.includes('/atc/variants')) return Promise.resolve(mockResponse(200, VARIANTS));
        return Promise.resolve(mockResponse(404, 'not found'));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', {
        action: 'atc_variants',
        variant: 'ABAP_CLOUD*',
      });

      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0]?.text);
      expect(payload.systemDefault).toBe('ZABAP_CLOUD_DEVELOPMENT');
      expect(payload.filter).toBe('ABAP_CLOUD*');
      expect(payload.count).toBe(2);
      expect(payload.variants.map((v: { name: string }) => v.name)).toContain('ABAP_CLOUD_DEVELOPMENT_DEFAULT');

      const urls = mockFetch.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('/atc/variants?name=ABAP_CLOUD*'))).toBe(true);
      expect(urls.some((u) => u.includes('/atc/customizing'))).toBe(true);
    });

    it('defaults the filter to all variants when none is given', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        const u = String(url);
        if (u.includes('/atc/customizing')) return Promise.resolve(mockResponse(200, CUSTOMIZING));
        return Promise.resolve(mockResponse(200, VARIANTS));
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', { action: 'atc_variants' });
      const payload = JSON.parse(result.content[0]?.text);
      expect(payload.filter).toBe('*');
      const urls = mockFetch.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('/atc/variants?name=*'))).toBe(true);
    });

    it('degrades to null default when /atc/customizing is absent (404) — list survives', async () => {
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL) => {
        const u = String(url);
        if (u.includes('/atc/customizing')) return Promise.resolve(mockResponse(404, 'not found'));
        return Promise.resolve(mockResponse(200, VARIANTS));
      });
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', { action: 'atc_variants' });
      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0]?.text);
      expect(payload.systemDefault).toBeNull();
      expect(payload.count).toBe(2);
    });

    it('does NOT silently succeed when /atc/customizing fails with 403/500 — the error surfaces', async () => {
      for (const status of [403, 500]) {
        mockFetch.mockReset();
        mockFetch.mockImplementation((url: string | URL) => {
          const u = String(url);
          if (u.includes('/atc/customizing')) return Promise.resolve(mockResponse(status, 'boom'));
          return Promise.resolve(mockResponse(200, VARIANTS));
        });
        const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPDiagnose', { action: 'atc_variants' });
        // A real customizing failure (auth/5xx) must NOT masquerade as a successful null-default listing.
        expect(result.isError).toBe(true);
      }
    });
  });
});
