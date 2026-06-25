import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  activate,
  activateBatch,
  applyFixProposal,
  extractCoverageMeasurementUri,
  getCdsTestCases,
  getFixProposals,
  getPrettyPrinterSettings,
  parseActivationOutcome,
  parseActivationResult,
  parseCoverageMeasurement,
  prettyPrint,
  publishServiceBinding,
  runAtcCheck,
  runUnitTests,
  setPrettyPrinterSettings,
  supportsCdsTestCases,
  syntaxCheck,
  unpublishServiceBinding,
} from '../../../src/adt/devtools.js';
import { AdtApiError, AdtSafetyError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { defaultSafetyConfig, unrestrictedSafetyConfig } from '../../../src/adt/safety.js';

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

function mockHttpSequence(...responses: string[]): AdtHttpClient {
  const post = vi.fn();
  for (const body of responses) {
    post.mockResolvedValueOnce({ statusCode: 200, headers: {}, body });
  }
  return {
    get: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
    post,
    put: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
    delete: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
    fetchCsrfToken: vi.fn(),
    withStatefulSession: vi.fn(),
  } as unknown as AdtHttpClient;
}

function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('DevTools', () => {
  // ─── syntaxCheck ───────────────────────────────────────────────────

  describe('syntaxCheck', () => {
    it('returns no errors for clean code', async () => {
      const http = mockHttp('<checkMessages/>');
      const result = await syntaxCheck(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
      expect(result.hasErrors).toBe(false);
      expect(result.messages).toEqual([]);
    });

    it('detects syntax errors', async () => {
      const xml = '<checkMessages><msg type="E" line="5" col="1" shortText="Syntax error"/></checkMessages>';
      const http = mockHttp(xml);
      const result = await syntaxCheck(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
      expect(result.hasErrors).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]?.severity).toBe('error');
      expect(result.messages[0]?.line).toBe(5);
      expect(result.messages[0]?.column).toBe(1);
    });

    it('distinguishes warnings from errors (Issue #33: EditSource treats warnings as errors)', async () => {
      // This test ensures we correctly classify severity — critical for Issue #33
      // where syntax warnings like "Redundant conversion" blocked saves
      const xml = `<checkMessages>
        <msg type="W" line="10" col="5" shortText="Redundant conversion for type STRING"/>
        <msg type="I" line="15" col="1" shortText="Informational message"/>
      </checkMessages>`;
      const http = mockHttp(xml);
      const result = await syntaxCheck(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
      expect(result.hasErrors).toBe(false); // Only warnings + info, no errors
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]?.severity).toBe('warning');
      expect(result.messages[1]?.severity).toBe('info');
    });

    it('handles mixed errors and warnings', async () => {
      const xml = `<checkMessages>
        <msg type="E" line="5" col="1" shortText="Unknown type"/>
        <msg type="W" line="10" col="3" shortText="Unused variable"/>
      </checkMessages>`;
      const http = mockHttp(xml);
      const result = await syntaxCheck(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
      expect(result.hasErrors).toBe(true);
      expect(result.messages).toHaveLength(2);
    });

    it('sends correct XML payload and headers', async () => {
      const http = mockHttp('<checkMessages/>');
      await syntaxCheck(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
      expect(http.post).toHaveBeenCalledWith(
        '/sap/bc/adt/checkruns',
        expect.stringContaining('checkObjectList'),
        'application/vnd.sap.adt.checkobjects+xml',
        expect.objectContaining({ Accept: 'application/vnd.sap.adt.checkmessages+xml' }),
      );
    });

    it('uses active version by default in check payload', async () => {
      const http = mockHttp('<checkMessages/>');
      await syntaxCheck(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
      const payload = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(payload).toContain('chkrun:version="active"');
    });

    it('uses inactive version when requested', async () => {
      const http = mockHttp('<checkMessages/>');
      await syntaxCheck(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST', {
        version: 'inactive',
      });
      const payload = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(payload).toContain('chkrun:version="inactive"');
    });

    it('parses response identically for active and inactive versions', async () => {
      const xml = '<checkMessages><msg type="E" line="7" col="2" shortText="Syntax error"/></checkMessages>';
      const activeHttp = mockHttp(xml);
      const inactiveHttp = mockHttp(xml);
      const activeResult = await syntaxCheck(
        activeHttp,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/programs/programs/Z1',
      );
      const inactiveResult = await syntaxCheck(
        inactiveHttp,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/programs/programs/Z1',
        { version: 'inactive' },
      );
      expect(inactiveResult).toEqual(activeResult);
    });

    it('handles reversed attribute order (Issue #3)', async () => {
      const xml = '<checkMessages><msg line="5" col="1" type="E" shortText="Error found"/></checkMessages>';
      const http = mockHttp(xml);
      const result = await syntaxCheck(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
      expect(result.hasErrors).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toEqual({ severity: 'error', text: 'Error found', line: 5, column: 1 });
    });

    describe('NW 7.50 <chkrun:checkMessage> shape (line/col in uri#start fragment)', () => {
      it('extracts line/column from uri="...#start=LINE,COL"', async () => {
        const { readFileSync } = await import('node:fs');
        const { join, dirname } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const here = dirname(fileURLToPath(import.meta.url));
        const xml = readFileSync(join(here, '..', '..', 'fixtures', 'xml', 'syntax-check-nw750.xml'), 'utf-8');
        const http = mockHttp(xml);
        const result = await syntaxCheck(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
        expect(result.hasErrors).toBe(true);
        expect(result.messages).toHaveLength(3);
        // First error: "Result type cannot be converted..." at line 42, col 5
        const firstError = result.messages.find((m) => m.text.includes('Result type'));
        expect(firstError).toBeDefined();
        expect(firstError?.line).toBe(42);
        expect(firstError?.column).toBe(5);
        expect(firstError?.severity).toBe('error');
        // Warning at line 10, col 12
        const warning = result.messages.find((m) => m.severity === 'warning');
        expect(warning?.line).toBe(10);
        expect(warning?.column).toBe(12);
      });

      it('handles mixed <msg> and <chkrun:checkMessage> in same body', async () => {
        const xml = `<checkRunReports>
          <msg type="E" line="5" col="1" shortText="Old shape error"/>
          <chkrun:checkMessage chkrun:type="E" chkrun:shortText="New shape error" chkrun:uri="/sap/bc/adt/programs/programs/ZTEST/source/main#start=22,7" xmlns:chkrun="http://www.sap.com/adt/checkrun"/>
        </checkRunReports>`;
        const http = mockHttp(xml);
        const result = await syntaxCheck(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
        expect(result.messages).toHaveLength(2);
        expect(result.messages.find((m) => m.text === 'Old shape error')?.line).toBe(5);
        expect(result.messages.find((m) => m.text === 'New shape error')?.line).toBe(22);
      });
    });
  });

  // ─── prettyPrint ──────────────────────────────────────────────────

  describe('prettyPrint', () => {
    it('returns formatted source on success', async () => {
      const formatted = 'REPORT ztest.\nDATA lv TYPE string.\n';
      const http = mockHttp(formatted);
      const result = await prettyPrint(http, unrestrictedSafetyConfig(), 'report ztest.\ndata lv type string.\n');
      expect(result).toBe(formatted);
    });

    it('passes text/plain content type and accept header', async () => {
      const http = mockHttp('REPORT ztest.\n');
      await prettyPrint(http, unrestrictedSafetyConfig(), 'report ztest.\n');
      expect(http.post).toHaveBeenCalledWith(
        '/sap/bc/adt/abapsource/prettyprinter',
        'report ztest.\n',
        'text/plain; charset=utf-8',
        { Accept: 'text/plain' },
      );
    });

    it('hits the PrettyPrinter endpoint path', async () => {
      const http = mockHttp('REPORT ztest.\n');
      await prettyPrint(http, unrestrictedSafetyConfig(), 'report ztest.\n');
      const path = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(path).toBe('/sap/bc/adt/abapsource/prettyprinter');
    });

    it('is allowed in read-only mode (intelligence operation)', async () => {
      const http = mockHttp('REPORT ztest.\n');
      await expect(prettyPrint(http, defaultSafetyConfig(), 'report ztest.\n')).resolves.toBe('REPORT ztest.\n');
    });
  });

  // ─── PrettyPrinter settings ───────────────────────────────────────

  describe('getPrettyPrinterSettings', () => {
    it('parses formatter settings from XML response', async () => {
      const xml =
        '<abapformatter:PrettyPrinterSettings abapformatter:indentation="true" abapformatter:style="keywordUpper" xmlns:abapformatter="http://www.sap.com/adt/prettyprintersettings"/>';
      const http = mockHttp(xml);
      const settings = await getPrettyPrinterSettings(http, unrestrictedSafetyConfig());
      expect(settings).toEqual({ indentation: true, style: 'keywordUpper' });
    });

    it('parses false indentation and lowercase keyword style', async () => {
      const xml =
        '<abapformatter:PrettyPrinterSettings abapformatter:indentation="false" abapformatter:style="keywordLower" xmlns:abapformatter="http://www.sap.com/adt/prettyprintersettings"/>';
      const http = mockHttp(xml);
      const settings = await getPrettyPrinterSettings(http, unrestrictedSafetyConfig());
      expect(settings).toEqual({ indentation: false, style: 'keywordLower' });
    });

    it('falls back to defaults when attributes are missing', async () => {
      const xml =
        '<abapformatter:PrettyPrinterSettings xmlns:abapformatter="http://www.sap.com/adt/prettyprintersettings"/>';
      const http = mockHttp(xml);
      const settings = await getPrettyPrinterSettings(http, unrestrictedSafetyConfig());
      expect(settings).toEqual({ indentation: true, style: 'keywordUpper' });
    });
  });

  describe('setPrettyPrinterSettings', () => {
    it('sends expected XML body with formatter attributes', async () => {
      const http = mockHttp('');
      await setPrettyPrinterSettings(http, unrestrictedSafetyConfig(), { indentation: false, style: 'keywordLower' });
      const body = (http.put as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(body).toContain('abapformatter:indentation="false"');
      expect(body).toContain('abapformatter:style="keywordLower"');
    });

    it('uses ppsettings v2 content type', async () => {
      const http = mockHttp('');
      await setPrettyPrinterSettings(http, unrestrictedSafetyConfig(), { indentation: true, style: 'keywordUpper' });
      expect(http.put).toHaveBeenCalledWith(
        '/sap/bc/adt/abapsource/prettyprinter/settings',
        expect.any(String),
        'application/vnd.sap.adt.ppsettings.v2+xml',
      );
    });

    it('is blocked in read-only mode', async () => {
      const http = mockHttp('');
      await expect(
        setPrettyPrinterSettings(http, defaultSafetyConfig(), { indentation: true, style: 'keywordUpper' }),
      ).rejects.toThrow(AdtSafetyError);
    });
  });

  // ─── activate ──────────────────────────────────────────────────────

  describe('activate', () => {
    it('returns success when no errors', async () => {
      const http = mockHttp('<activation/>');
      const result = await activate(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
      expect(result.success).toBe(true);
    });

    it('is blocked in read-only mode', async () => {
      const http = mockHttp();
      const safety = { ...unrestrictedSafetyConfig(), allowWrites: false };
      await expect(activate(http, safety, '/sap/bc/adt/programs/programs/ZTEST')).rejects.toThrow(AdtSafetyError);
    });

    it('detects activation errors from severity="error"', async () => {
      const xml = '<messages><msg severity="error" shortText="Cannot activate"/></messages>';
      const http = mockHttp(xml);
      const result = await activate(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
      expect(result.success).toBe(false);
      expect(result.messages).toContain('Cannot activate');
    });

    it('detects activation errors from type="E"', async () => {
      const xml = '<messages><msg type="E" shortText="Syntax error in object"/></messages>';
      const http = mockHttp(xml);
      const result = await activate(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
      expect(result.success).toBe(false);
    });

    it('does not false-positive on adtcore:type="ENHO/E" in URIs (Issue #11)', async () => {
      const xml = `<messages>
        <msg severity="info" shortText="Object activated" adtcore:type="ENHO/E" adtcore:uri="/sap/bc/adt/enhancements/ZENHO_TEST"/>
      </messages>`;
      const http = mockHttp(xml);
      const result = await activate(http, unrestrictedSafetyConfig(), '/sap/bc/adt/enhancements/ZENHO_TEST');
      expect(result.success).toBe(true);
    });

    it('detects severity="fatal" and type="A" as errors', async () => {
      const xml = `<messages>
        <msg severity="fatal" shortText="Fatal activation error"/>
        <msg type="A" shortText="Abend during activation"/>
      </messages>`;
      const http = mockHttp(xml);
      const result = await activate(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
      expect(result.success).toBe(false);
      expect(result.messages).toContain('Fatal activation error');
      expect(result.messages).toContain('Abend during activation');
    });

    it('detects type="A" alone as error without severity attribute', async () => {
      const xml = `<messages>
        <msg type="A" shortText="Abend during activation"/>
      </messages>`;
      const http = mockHttp(xml);
      const result = await activate(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
      expect(result.success).toBe(false);
      expect(result.messages).toContain('Abend during activation');
    });

    it('extracts multiple messages', async () => {
      const xml = '<messages><msg shortText="Warning 1"/><msg shortText="Warning 2"/></messages>';
      const http = mockHttp(xml);
      const result = await activate(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
      expect(result.messages).toHaveLength(2);
    });

    it('returns success for empty response body', async () => {
      const http = mockHttp('');
      const result = await activate(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
      expect(result.success).toBe(true);
      expect(result.messages).toEqual([]);
    });

    it('returns success for whitespace-only response body', () => {
      const result = parseActivationResult('   ');
      expect(result.success).toBe(true);
      expect(result.messages).toEqual([]);
    });

    it('parses shortText from child <txt> elements (DDIC activation format)', () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
        <chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist">
          <chkl:properties checkExecuted="true" activationExecuted="true" generationExecuted="false"/>
          <msg type="E" line="0">
            <shortText><txt>Activation was cancelled.</txt><txt>"DTEL X was not activated" (D0 408)</txt></shortText>
          </msg>
          <msg type="E" line="1">
            <shortText><txt>No domain or data type was defined</txt></shortText>
          </msg>
        </chkl:messages>`;
      const result = parseActivationResult(xml);
      expect(result.success).toBe(false);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]).toContain('Activation was cancelled');
      expect(result.messages[0]).toContain('DTEL X was not activated');
      expect(result.messages[1]).toBe('No domain or data type was defined');
    });

    it('parses shortText from attribute (classic format)', () => {
      const xml = `<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist">
        <msg type="E" shortText="Some error"/>
      </chkl:messages>`;
      const result = parseActivationResult(xml);
      expect(result.success).toBe(false);
      expect(result.messages).toEqual(['Some error']);
    });

    it('sends activation request to correct endpoint with method param', async () => {
      const http = mockHttp('<activation/>');
      await activate(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
      expect(http.post).toHaveBeenCalledWith(
        '/sap/bc/adt/activation?method=activate&preauditRequested=true',
        expect.stringContaining('objectReference'),
        'application/*',
        expect.objectContaining({ Accept: 'application/xml' }),
      );
    });

    it('sends preauditRequested=false when preaudit option is false', async () => {
      const http = mockHttp('<activation/>');
      await activate(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST', { preaudit: false });
      expect(http.post).toHaveBeenCalledWith(
        '/sap/bc/adt/activation?method=activate&preauditRequested=false',
        expect.stringContaining('objectReference'),
        'application/*',
        expect.objectContaining({ Accept: 'application/xml' }),
      );
    });

    it('defaults preauditRequested=true when preaudit option is omitted', async () => {
      const http = mockHttp('<activation/>');
      await activate(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
      expect(http.post).toHaveBeenCalledWith(
        expect.stringContaining('preauditRequested=true'),
        expect.any(String),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('returns structured details with severity, uri, and line', async () => {
      const xml = `<messages>
        <msg type="E" severity="error" shortText="Type ZI_TRAVEL is not active" uri="/sap/bc/adt/ddic/ddl/sources/zi_travel" line="42"/>
        <msg type="W" severity="warning" shortText="Consider CDS view entity" uri="/sap/bc/adt/ddic/ddl/sources/zi_travel"/>
      </messages>`;
      const http = mockHttp(xml);
      const result = await activate(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
      expect(result.details).toHaveLength(2);
      expect(result.details[0]).toEqual({
        severity: 'error',
        text: 'Type ZI_TRAVEL is not active',
        uri: '/sap/bc/adt/ddic/ddl/sources/zi_travel',
        line: 42,
      });
      expect(result.details[1]).toEqual({
        severity: 'warning',
        text: 'Consider CDS view entity',
        uri: '/sap/bc/adt/ddic/ddl/sources/zi_travel',
      });
    });

    it('returns empty details array for empty response', () => {
      const result = parseActivationResult('');
      expect(result.details).toEqual([]);
    });

    it('warnings do not set success to false', () => {
      const xml = `<messages>
        <msg type="W" severity="warning" shortText="Warning only"/>
        <msg type="I" severity="info" shortText="Info message"/>
      </messages>`;
      const result = parseActivationResult(xml);
      expect(result.success).toBe(true);
      expect(result.details).toHaveLength(2);
      expect(result.details[0]!.severity).toBe('warning');
      expect(result.details[1]!.severity).toBe('info');
    });

    it('parses line numbers as numbers, ignores line=0', () => {
      const xml = `<messages>
        <msg type="E" shortText="Error at line 10" line="10"/>
        <msg type="E" shortText="Error no line" line="0"/>
      </messages>`;
      const result = parseActivationResult(xml);
      expect(result.details[0]!.line).toBe(10);
      expect(result.details[1]!.line).toBeUndefined();
    });

    it('mixed errors and warnings parse correctly with backward-compat messages', () => {
      const xml = `<messages>
        <msg type="E" severity="error" shortText="Cannot activate" uri="/sap/bc/adt/programs/programs/ZTEST" line="5"/>
        <msg type="W" severity="warning" shortText="Deprecation warning"/>
      </messages>`;
      const result = parseActivationResult(xml);
      expect(result.success).toBe(false);
      expect(result.messages).toEqual(['Cannot activate', 'Deprecation warning']);
      expect(result.details).toHaveLength(2);
      expect(result.details[0]!.severity).toBe('error');
      expect(result.details[0]!.line).toBe(5);
      expect(result.details[1]!.severity).toBe('warning');
      expect(result.details[1]!.line).toBeUndefined();
    });
  });

  // ─── activateBatch ────────────────────────────────────────────────

  describe('activateBatch', () => {
    it('returns success when no errors', async () => {
      const http = mockHttp(
        '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties checkExecuted="false" activationExecuted="true" generationExecuted="true"/></chkl:messages>',
      );
      const result = await activateBatch(http, unrestrictedSafetyConfig(), [
        { url: '/sap/bc/adt/ddic/ddl/sources/ZI_TRAVEL', name: 'ZI_TRAVEL' },
        { url: '/sap/bc/adt/bo/behaviordefinitions/ZI_TRAVEL', name: 'ZI_TRAVEL' },
      ]);
      expect(result.success).toBe(true);
    });

    it('includes all objects in activation XML payload', async () => {
      const http = mockHttp('<activation/>');
      await activateBatch(http, unrestrictedSafetyConfig(), [
        { url: '/sap/bc/adt/ddic/ddl/sources/ZI_TRAVEL', name: 'ZI_TRAVEL' },
        { url: '/sap/bc/adt/bo/behaviordefinitions/ZI_TRAVEL', name: 'ZI_TRAVEL' },
        { url: '/sap/bc/adt/ddic/srvd/sources/ZSD_TRAVEL', name: 'ZSD_TRAVEL' },
      ]);

      const callArgs = (http.post as any).mock.calls[0];
      const body = callArgs[1] as string;
      expect(body).toContain('adtcore:uri="/sap/bc/adt/ddic/ddl/sources/ZI_TRAVEL"');
      expect(body).toContain('adtcore:uri="/sap/bc/adt/bo/behaviordefinitions/ZI_TRAVEL"');
      expect(body).toContain('adtcore:uri="/sap/bc/adt/ddic/srvd/sources/ZSD_TRAVEL"');
      expect(body).toContain('adtcore:name="ZI_TRAVEL"');
      expect(body).toContain('adtcore:name="ZSD_TRAVEL"');
    });

    it('sends to activation endpoint with method param', async () => {
      const http = mockHttp('<activation/>');
      await activateBatch(http, unrestrictedSafetyConfig(), [
        { url: '/sap/bc/adt/programs/programs/ZTEST', name: 'ZTEST' },
      ]);
      expect(http.post).toHaveBeenCalledWith(
        '/sap/bc/adt/activation?method=activate&preauditRequested=true',
        expect.any(String),
        'application/*',
        expect.objectContaining({ Accept: 'application/xml' }),
      );
    });

    it('passes preaudit=false to endpoint URL', async () => {
      const http = mockHttp('<activation/>');
      await activateBatch(
        http,
        unrestrictedSafetyConfig(),
        [{ url: '/sap/bc/adt/programs/programs/ZTEST', name: 'ZTEST' }],
        { preaudit: false },
      );
      expect(http.post).toHaveBeenCalledWith(
        '/sap/bc/adt/activation?method=activate&preauditRequested=false',
        expect.any(String),
        'application/*',
        expect.objectContaining({ Accept: 'application/xml' }),
      );
    });

    it('detects errors in batch activation response', async () => {
      const xml = '<messages><msg severity="error" shortText="Activation failed for ZI_TRAVEL"/></messages>';
      const http = mockHttp(xml);
      const result = await activateBatch(http, unrestrictedSafetyConfig(), [
        { url: '/sap/bc/adt/ddic/ddl/sources/ZI_TRAVEL', name: 'ZI_TRAVEL' },
      ]);
      expect(result.success).toBe(false);
      expect(result.messages).toContain('Activation failed for ZI_TRAVEL');
    });

    it('retries pure ED064 batch activation failures individually', async () => {
      const ed064 =
        '<messages><msg type="E" shortText="ZDM_PROJECT_D (ED064) no next/previous object found"/></messages>';
      const http = mockHttpSequence(ed064, '', '');
      const result = await activateBatch(http, unrestrictedSafetyConfig(), [
        { url: '/sap/bc/adt/ddic/tables/zdm_project_d', name: 'ZDM_PROJECT_D' },
        { url: '/sap/bc/adt/ddic/tables/zdm_task_d', name: 'ZDM_TASK_D' },
      ]);

      expect(result.success).toBe(true);
      expect(result.messages.join(' ')).toContain('retried 2 objects individually');
      expect(result.details[0]?.severity).toBe('warning');
      expect(http.post).toHaveBeenCalledTimes(3);
      expect((http.post as any).mock.calls[1][1]).toContain('adtcore:name="ZDM_PROJECT_D"');
      expect((http.post as any).mock.calls[2][1]).toContain('adtcore:name="ZDM_TASK_D"');
    });

    it('runs individual ED064 retries sequentially', async () => {
      const ed064 = '<messages><msg type="E" shortText="ED064 no next/previous object found"/></messages>';
      const firstRetry = defer<{ statusCode: number; headers: Record<string, string>; body: string }>();
      const post = vi
        .fn()
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: ed064 })
        .mockReturnValueOnce(firstRetry.promise)
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: '' });
      const http = {
        get: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
        post,
        put: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
        delete: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
        fetchCsrfToken: vi.fn(),
        withStatefulSession: vi.fn(),
      } as unknown as AdtHttpClient;

      const resultPromise = activateBatch(http, unrestrictedSafetyConfig(), [
        { url: '/sap/bc/adt/ddic/tables/zdm_project_d', name: 'ZDM_PROJECT_D' },
        { url: '/sap/bc/adt/ddic/tables/zdm_task_d', name: 'ZDM_TASK_D' },
      ]);
      await Promise.resolve();
      await Promise.resolve();

      expect(post).toHaveBeenCalledTimes(2);
      expect(post.mock.calls[1][1]).toContain('adtcore:name="ZDM_PROJECT_D"');

      firstRetry.resolve({ statusCode: 200, headers: {}, body: '' });
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(post).toHaveBeenCalledTimes(3);
      expect(post.mock.calls[2][1]).toContain('adtcore:name="ZDM_TASK_D"');
    });

    it('does not retry ED064 when the batch response contains a real activation error', async () => {
      const mixed = `<messages>
        <msg type="E" shortText="ZDM_PROJECT_D (ED064) no next/previous object found"/>
        <msg type="E" shortText="Unknown type ZFOO"/>
      </messages>`;
      const http = mockHttpSequence(mixed);
      const result = await activateBatch(http, unrestrictedSafetyConfig(), [
        { url: '/sap/bc/adt/ddic/tables/zdm_project_d', name: 'ZDM_PROJECT_D' },
      ]);

      expect(result.success).toBe(false);
      expect(result.messages).toContain('Unknown type ZFOO');
      expect(http.post).toHaveBeenCalledTimes(1);
    });

    it('preserves ED064 details and retry errors when individual fallback fails', async () => {
      const ed064 =
        '<messages><msg type="E" shortText="ZDM_PROJECT_D (ED064) no next/previous object found"/></messages>';
      const retryError = '<messages><msg type="E" shortText="Field PROJECTID is missing"/></messages>';
      const http = mockHttpSequence(ed064, retryError);
      const result = await activateBatch(http, unrestrictedSafetyConfig(), [
        { url: '/sap/bc/adt/ddic/tables/zdm_project_d', name: 'ZDM_PROJECT_D' },
      ]);

      expect(result.success).toBe(false);
      expect(result.messages).toContain('ZDM_PROJECT_D (ED064) no next/previous object found');
      expect(result.messages).toContain('ZDM_PROJECT_D: Field PROJECTID is missing');
      expect(result.details.some((d) => d.text.includes('Field PROJECTID is missing'))).toBe(true);
      expect(http.post).toHaveBeenCalledTimes(2);
    });

    it('propagates preaudit=false to individual ED064 retries', async () => {
      const ed064 = '<messages><msg type="E" shortText="ED064 no next/previous object found"/></messages>';
      const http = mockHttpSequence(ed064, '');
      const result = await activateBatch(
        http,
        unrestrictedSafetyConfig(),
        [{ url: '/sap/bc/adt/programs/programs/ZTEST', name: 'ZTEST' }],
        { preaudit: false },
      );

      expect(result.success).toBe(true);
      expect(http.post).toHaveBeenCalledTimes(2);
      expect((http.post as any).mock.calls[0][0]).toContain('preauditRequested=false');
      expect((http.post as any).mock.calls[1][0]).toContain('preauditRequested=false');
    });

    it('is blocked in read-only mode', async () => {
      const http = mockHttp();
      const safety = { ...unrestrictedSafetyConfig(), allowWrites: false };
      await expect(
        activateBatch(http, safety, [{ url: '/sap/bc/adt/programs/programs/ZTEST', name: 'ZTEST' }]),
      ).rejects.toThrow(AdtSafetyError);
    });
  });

  // ─── preaudit handshake ────────────────────────────────────────────

  describe('preaudit handshake', () => {
    // Real NW 7.50 response shape — SAP returns inactive objects with transport info
    const preauditXml = `<?xml version="1.0" encoding="utf-8"?>
<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects">
  <ioc:entry>
    <ioc:object/>
    <ioc:transport ioc:user="TESTUSER" ioc:linked="false">
      <ioc:ref adtcore:uri="/sap/bc/adt/vit/wb/object_type/%20%20%20%20rq/object_name/TRKORR001"
        adtcore:type="/RQ" adtcore:name="TRKORR001" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </ioc:transport>
  </ioc:entry>
  <ioc:entry>
    <ioc:object ioc:user="" ioc:deleted="false">
      <ioc:ref adtcore:uri="/sap/bc/adt/oo/classes/zcl_test"
        adtcore:type="CLAS/OC" adtcore:name="ZCL_TEST" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </ioc:object>
    <ioc:transport/>
  </ioc:entry>
  <ioc:entry>
    <ioc:object ioc:user="" ioc:deleted="false">
      <ioc:ref adtcore:uri="/sap/bc/adt/oo/classes/zcl_test/source/main#type=CLAS%2FOM;name=SOME_METHOD"
        adtcore:type="CLAS/OM/public" adtcore:name="ZCL_TEST         SOME_METHOD"
        adtcore:parentUri="/sap/bc/adt/oo/classes/zcl_test" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </ioc:object>
    <ioc:transport ioc:user="TESTUSER" ioc:linked="true">
      <ioc:ref adtcore:uri="/sap/bc/adt/vit/wb/object_type/%20%20%20%20rq/object_name/TRKORR002"
        adtcore:type="/RQ" adtcore:name="TRKORR002" xmlns:adtcore="http://www.sap.com/adt/core"/>
    </ioc:transport>
  </ioc:entry>
</ioc:inactiveObjects>`;

    describe('parseActivationOutcome', () => {
      it('returns success for empty body', () => {
        const outcome = parseActivationOutcome('');
        expect(outcome.kind).toBe('success');
      });

      it('returns error for <msg> with severity=error', () => {
        const xml = '<messages><msg severity="error" shortText="Type error"/></messages>';
        const outcome = parseActivationOutcome(xml);
        expect(outcome.kind).toBe('error');
        expect(outcome.messages).toContain('Type error');
      });

      it('returns preaudit for <ioc:inactiveObjects> with no <msg> errors', () => {
        const outcome = parseActivationOutcome(preauditXml);
        expect(outcome.kind).toBe('preaudit');
        if (outcome.kind !== 'preaudit') return;
        expect(outcome.refs).toHaveLength(2);
        expect(outcome.refs[0]!.name).toBe('ZCL_TEST');
        expect(outcome.refs[0]!.uri).toBe('/sap/bc/adt/oo/classes/zcl_test');
        expect(outcome.refs[1]!.name).toBe('ZCL_TEST         SOME_METHOD');
        expect(outcome.refs[1]!.uri).toContain('SOME_METHOD');
      });

      it('skips transport-only entries (empty <ioc:object/>) in preaudit refs', () => {
        const outcome = parseActivationOutcome(preauditXml);
        if (outcome.kind !== 'preaudit') return;
        const uris = outcome.refs.map((r) => r.uri);
        expect(uris.every((u) => !u.includes('object_type'))).toBe(true);
      });

      it('returns error (not preaudit) when <msg> errors AND <ioc:inactiveObjects> both present', () => {
        const xml = `<root>
          <msg type="E" shortText="Compile error"/>
          <ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects">
            <ioc:entry><ioc:object ioc:user="">
              <ioc:ref adtcore:uri="/sap/bc/adt/oo/classes/zcl_test" adtcore:name="ZCL_TEST"
                xmlns:adtcore="http://www.sap.com/adt/core"/>
            </ioc:object><ioc:transport/></ioc:entry>
          </ioc:inactiveObjects>
        </root>`;
        const outcome = parseActivationOutcome(xml);
        expect(outcome.kind).toBe('error');
      });
    });

    describe('parseActivationResult backward compat', () => {
      it('treats preaudit as failure with "still inactive" messages', () => {
        const result = parseActivationResult(preauditXml);
        expect(result.success).toBe(false);
        expect(result.messages.some((m) => m.includes('still inactive'))).toBe(true);
      });
    });

    describe('activate() two-step handshake', () => {
      it('completes activation when preaudit returns inactive objects then second call succeeds', async () => {
        const http = mockHttpSequence(preauditXml, '');
        const result = await activate(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_TEST', {
          name: 'ZCL_TEST',
        });

        expect(result.success).toBe(true);
        expect(http.post).toHaveBeenCalledTimes(2);

        // First call: preauditRequested=true
        const firstCall = (http.post as any).mock.calls[0];
        expect(firstCall[0]).toContain('preauditRequested=true');

        // Second call: preauditRequested=false with both refs
        const secondCall = (http.post as any).mock.calls[1];
        expect(secondCall[0]).toBe('/sap/bc/adt/activation?method=activate&preauditRequested=false');
        const secondBody = secondCall[1] as string;
        expect(secondBody).toContain('adtcore:uri="/sap/bc/adt/oo/classes/zcl_test"');
        expect(secondBody).toContain('SOME_METHOD');
        expect(secondBody).toContain('adtcore:name="ZCL_TEST"');
      });

      it('returns error directly when first call has <msg> errors (no second call)', async () => {
        const errorXml = '<messages><msg type="E" shortText="Syntax error line 5"/></messages>';
        const http = mockHttpSequence(errorXml);
        const result = await activate(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_TEST');

        expect(result.success).toBe(false);
        expect(result.messages).toContain('Syntax error line 5');
        expect(http.post).toHaveBeenCalledTimes(1);
      });

      it('returns success directly when first call returns empty body (no preaudit needed)', async () => {
        const http = mockHttpSequence('');
        const result = await activate(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_TEST');

        expect(result.success).toBe(true);
        expect(http.post).toHaveBeenCalledTimes(1);
      });

      it('returns error when second call also returns preaudit (avoids infinite loop)', async () => {
        const http = mockHttpSequence(preauditXml, preauditXml);
        const result = await activate(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_TEST');

        expect(result.success).toBe(false);
        expect(http.post).toHaveBeenCalledTimes(2);
        expect(result.messages.some((m) => m.includes('still inactive'))).toBe(true);
      });

      it('returns error when second call returns <msg> errors', async () => {
        const errorXml = '<messages><msg type="E" shortText="Activation dependency unresolved"/></messages>';
        const http = mockHttpSequence(preauditXml, errorXml);
        const result = await activate(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_TEST');

        expect(result.success).toBe(false);
        expect(result.messages).toContain('Activation dependency unresolved');
        expect(http.post).toHaveBeenCalledTimes(2);
      });

      it('skips handshake when preaudit=false (single call)', async () => {
        const http = mockHttpSequence(preauditXml);
        const result = await activate(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_TEST', {
          preaudit: false,
        });

        expect(result.success).toBe(false);
        expect(http.post).toHaveBeenCalledTimes(1);
      });

      it('includes adtcore:name in request body when name option provided', async () => {
        const http = mockHttpSequence('');
        await activate(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_TEST', { name: 'ZCL_TEST' });

        const body = (http.post as any).mock.calls[0][1] as string;
        expect(body).toContain('adtcore:name="ZCL_TEST"');
      });
    });

    describe('activateBatch() two-step handshake', () => {
      it('completes activation when preaudit returns inactive objects then second call succeeds', async () => {
        const http = mockHttpSequence(preauditXml, '');
        const result = await activateBatch(http, unrestrictedSafetyConfig(), [
          { url: '/sap/bc/adt/oo/classes/ZCL_TEST', name: 'ZCL_TEST' },
        ]);

        expect(result.success).toBe(true);
        expect(http.post).toHaveBeenCalledTimes(2);
        const secondCall = (http.post as any).mock.calls[1];
        expect(secondCall[0]).toContain('preauditRequested=false');
      });

      it('returns error directly when first call has <msg> errors (no second call)', async () => {
        const errorXml = '<messages><msg type="E" shortText="Batch error"/></messages>';
        const http = mockHttpSequence(errorXml);
        const result = await activateBatch(http, unrestrictedSafetyConfig(), [
          { url: '/sap/bc/adt/ddic/ddl/sources/ZI_TRAVEL', name: 'ZI_TRAVEL' },
        ]);

        expect(result.success).toBe(false);
        expect(http.post).toHaveBeenCalledTimes(1);
      });

      it('retries individually when phase 2 returns pure ED064 for a batch activation', async () => {
        const ed064 = '<messages><msg type="E" shortText="ED064 no next/previous object found"/></messages>';
        const http = mockHttpSequence(preauditXml, ed064, '');
        const result = await activateBatch(http, unrestrictedSafetyConfig(), [
          { url: '/sap/bc/adt/oo/classes/ZCL_TEST', name: 'ZCL_TEST' },
        ]);

        expect(result.success).toBe(true);
        expect(result.messages.join(' ')).toContain('retried 1 object individually');
        expect(http.post).toHaveBeenCalledTimes(3);
        expect((http.post as any).mock.calls[1][0]).toContain('preauditRequested=false');
        expect((http.post as any).mock.calls[2][0]).toContain('preauditRequested=true');
        expect((http.post as any).mock.calls[2][1]).toContain('adtcore:name="ZCL_TEST"');
      });
    });

    describe('rethrowOrLockHint (NW 7.50 lock-conflict on activation)', () => {
      function mockHttpThatRejects(status: number, body: string): AdtHttpClient {
        const post = vi.fn().mockRejectedValue(new AdtApiError('reject', status, '/url', body));
        return {
          get: vi.fn(),
          post,
          put: vi.fn(),
          delete: vi.fn(),
          fetchCsrfToken: vi.fn(),
          withStatefulSession: vi.fn(),
        } as unknown as AdtHttpClient;
      }

      const html = '<html><body>Logon Error Message — please log on again.</body></html>';

      it('returns lock-conflict ActivationResult on 403 + "Logon Error Message" body', async () => {
        const http = mockHttpThatRejects(403, html);
        const result = await activate(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST', {
          name: 'ZTEST',
        });
        expect(result.success).toBe(false);
        expect(result.messages.join(' ')).toMatch(/locked by another session/i);
      });

      it('returns lock-conflict ActivationResult on 400 + "Logon Error Message" body', async () => {
        const http = mockHttpThatRejects(400, html);
        const result = await activate(http, unrestrictedSafetyConfig(), '/url');
        expect(result.success).toBe(false);
        expect(result.messages.join(' ')).toMatch(/locked by another session/i);
      });

      it('rethrows unchanged when 403 body has no "Logon Error Message" marker (S/4 structured XML)', async () => {
        const xml =
          '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><type id="ExceptionResourceNoAccess"/><message lang="EN">User MARIAN is currently editing ZTEST</message></exc:exception>';
        const http = mockHttpThatRejects(403, xml);
        await expect(activate(http, unrestrictedSafetyConfig(), '/url')).rejects.toMatchObject({ statusCode: 403 });
      });
    });

    describe('activation_preaudit_completed audit emission', () => {
      it('emits audit event after successful handshake (success outcome)', async () => {
        const { logger } = await import('../../../src/server/logger.js');
        const emitSpy = vi.spyOn(logger, 'emitAudit').mockImplementation(() => {});
        try {
          const http = mockHttpSequence(preauditXml, '');
          await activate(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_TEST', { name: 'ZCL_TEST' });

          const auditCalls = emitSpy.mock.calls.filter((c) => c[0].event === 'activation_preaudit_completed');
          expect(auditCalls).toHaveLength(1);
          const event = auditCalls[0]![0] as unknown as Record<string, unknown>;
          expect(event.objectLabel).toBe('ZCL_TEST');
          expect(event.refCount).toBe(2);
          expect(event.outcome).toBe('success');
          expect(typeof event.phase1DurationMs).toBe('number');
          expect(typeof event.phase2DurationMs).toBe('number');
        } finally {
          emitSpy.mockRestore();
        }
      });

      it('emits audit event with outcome=error when phase 2 returns errors', async () => {
        const { logger } = await import('../../../src/server/logger.js');
        const emitSpy = vi.spyOn(logger, 'emitAudit').mockImplementation(() => {});
        try {
          const errorXml = '<messages><msg type="E" shortText="Activation dependency unresolved"/></messages>';
          const http = mockHttpSequence(preauditXml, errorXml);
          await activate(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_TEST');

          const auditCalls = emitSpy.mock.calls.filter((c) => c[0].event === 'activation_preaudit_completed');
          expect(auditCalls).toHaveLength(1);
          expect((auditCalls[0]![0] as unknown as Record<string, unknown>).outcome).toBe('error');
        } finally {
          emitSpy.mockRestore();
        }
      });

      it('does NOT emit audit event when first POST succeeds without preaudit', async () => {
        const { logger } = await import('../../../src/server/logger.js');
        const emitSpy = vi.spyOn(logger, 'emitAudit').mockImplementation(() => {});
        try {
          const http = mockHttpSequence('');
          await activate(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_TEST');

          const auditCalls = emitSpy.mock.calls.filter((c) => c[0].event === 'activation_preaudit_completed');
          expect(auditCalls).toHaveLength(0);
        } finally {
          emitSpy.mockRestore();
        }
      });

      it('uses comma-joined object names as objectLabel for activateBatch', async () => {
        const { logger } = await import('../../../src/server/logger.js');
        const emitSpy = vi.spyOn(logger, 'emitAudit').mockImplementation(() => {});
        try {
          const http = mockHttpSequence(preauditXml, '');
          await activateBatch(http, unrestrictedSafetyConfig(), [
            { url: '/sap/bc/adt/oo/classes/ZA', name: 'ZA' },
            { url: '/sap/bc/adt/oo/classes/ZB', name: 'ZB' },
          ]);

          const auditCalls = emitSpy.mock.calls.filter((c) => c[0].event === 'activation_preaudit_completed');
          expect(auditCalls).toHaveLength(1);
          expect((auditCalls[0]![0] as unknown as Record<string, unknown>).objectLabel).toBe('ZA, ZB');
        } finally {
          emitSpy.mockRestore();
        }
      });
    });
  });

  // ─── publishServiceBinding ─────────────────────────────────────────

  describe('publishServiceBinding', () => {
    const okResponse =
      '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY><SHORT_TEXT>published locally</SHORT_TEXT><LONG_TEXT/></DATA></asx:values></asx:abap>';

    it('sends POST to publishjobs endpoint with objectReferences body', async () => {
      const http = mockHttp(okResponse);
      const result = await publishServiceBinding(http, unrestrictedSafetyConfig(), 'ZSB_BOOKING_V4');
      expect(http.post).toHaveBeenCalledWith(
        '/sap/bc/adt/businessservices/odatav2/publishjobs?servicename=ZSB_BOOKING_V4&serviceversion=0001',
        expect.stringContaining('adtcore:objectReference adtcore:name="ZSB_BOOKING_V4"'),
        'application/xml',
        expect.objectContaining({ Accept: 'application/vnd.sap.as+xml, application/*;q=0.8' }),
      );
      expect(result.severity).toBe('OK');
      expect(result.shortText).toBe('published locally');
    });

    it('encodes the service binding name in the URL', async () => {
      const http = mockHttp(okResponse);
      await publishServiceBinding(http, unrestrictedSafetyConfig(), '/DMO/UI_FLIGHT_R_V2');
      expect(http.post).toHaveBeenCalledWith(
        '/sap/bc/adt/businessservices/odatav2/publishjobs?servicename=%2FDMO%2FUI_FLIGHT_R_V2&serviceversion=0001',
        expect.any(String),
        'application/xml',
        expect.any(Object),
      );
    });

    it('passes custom service version', async () => {
      const http = mockHttp(okResponse);
      await publishServiceBinding(http, unrestrictedSafetyConfig(), 'ZSB_TEST', '0002');
      expect(http.post).toHaveBeenCalledWith(
        expect.stringContaining('serviceversion=0002'),
        expect.any(String),
        'application/xml',
        expect.any(Object),
      );
    });

    it('parses error responses', async () => {
      const errorXml =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>ERROR</SEVERITY><SHORT_TEXT>Activating failed</SHORT_TEXT><LONG_TEXT>TADIR check failed</LONG_TEXT></DATA></asx:values></asx:abap>';
      const http = mockHttp(errorXml);
      const result = await publishServiceBinding(http, unrestrictedSafetyConfig(), 'ZSB_TEST');
      expect(result.severity).toBe('ERROR');
      expect(result.shortText).toBe('Activating failed');
      expect(result.longText).toBe('TADIR check failed');
    });

    it('is blocked in read-only mode', async () => {
      const http = mockHttp();
      const safety = { ...unrestrictedSafetyConfig(), allowWrites: false };
      await expect(publishServiceBinding(http, safety, 'ZSB_TEST')).rejects.toThrow(AdtSafetyError);
    });
  });

  // ─── unpublishServiceBinding ──────────────────────────────────────

  describe('unpublishServiceBinding', () => {
    const okResponse =
      '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY><SHORT_TEXT>un-published locally</SHORT_TEXT><LONG_TEXT/></DATA></asx:values></asx:abap>';

    it('sends POST to unpublishjobs endpoint with objectReferences body', async () => {
      const http = mockHttp(okResponse);
      const result = await unpublishServiceBinding(http, unrestrictedSafetyConfig(), 'ZSB_BOOKING_V4');
      expect(http.post).toHaveBeenCalledWith(
        '/sap/bc/adt/businessservices/odatav2/unpublishjobs?servicename=ZSB_BOOKING_V4&serviceversion=0001',
        expect.stringContaining('adtcore:objectReference adtcore:name="ZSB_BOOKING_V4"'),
        'application/xml',
        expect.objectContaining({ Accept: 'application/vnd.sap.as+xml, application/*;q=0.8' }),
      );
      expect(result.severity).toBe('OK');
      expect(result.shortText).toBe('un-published locally');
    });

    it('encodes the service binding name in the URL', async () => {
      const http = mockHttp(okResponse);
      await unpublishServiceBinding(http, unrestrictedSafetyConfig(), '/DMO/UI_FLIGHT_R_V2');
      expect(http.post).toHaveBeenCalledWith(
        '/sap/bc/adt/businessservices/odatav2/unpublishjobs?servicename=%2FDMO%2FUI_FLIGHT_R_V2&serviceversion=0001',
        expect.any(String),
        'application/xml',
        expect.any(Object),
      );
    });

    it('is blocked in read-only mode', async () => {
      const http = mockHttp();
      const safety = { ...unrestrictedSafetyConfig(), allowWrites: false };
      await expect(unpublishServiceBinding(http, safety, 'ZSB_TEST')).rejects.toThrow(AdtSafetyError);
    });
  });

  // ─── publish/unpublish as+xml content negotiation fallback (issue: 406 on SAP_BASIS 758) ──

  describe('publish/unpublish as+xml 406 fallback', () => {
    const okResponse =
      '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY><SHORT_TEXT>ZSSI_UI_S_ORD_O4 published locally</SHORT_TEXT><LONG_TEXT/></DATA></asx:values></asx:abap>';
    // Verbatim 406 body from S/4HANA 2023 (SAP_BASIS 758) when Accept does not cover
    // application/vnd.sap.as+xml (T100 SADT_RESOURCE 044).
    const notAcceptableBody =
      '<?xml version="1.0" encoding="utf-8"?><exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceNotAcceptable"/><message lang="EN">The message content is not acceptable. Accepted content types: application/vnd.sap.as+xml</message><localizedMessage lang="EN">The message content is not acceptable. Accepted content types: application/vnd.sap.as+xml</localizedMessage><properties><entry key="T100KEY-ID">SADT_RESOURCE</entry><entry key="T100KEY-NO">044</entry><entry key="T100KEY-V1">application/vnd.sap.as+xml</entry></properties></exc:exception>';

    function http406ThenOk(path: string): AdtHttpClient {
      const post = vi
        .fn()
        .mockRejectedValueOnce(new AdtApiError(notAcceptableBody, 406, path, notAcceptableBody))
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: okResponse });
      return {
        get: vi.fn(),
        post,
        put: vi.fn(),
        delete: vi.fn(),
        fetchCsrfToken: vi.fn(),
        withStatefulSession: vi.fn(),
      } as unknown as AdtHttpClient;
    }

    it('publish retries a 406 naming application/vnd.sap.as+xml with the dataname-qualified as+xml type (odatav4)', async () => {
      const path = '/sap/bc/adt/businessservices/odatav4/publishjobs?servicename=ZSSI_UI_S_ORD_O4&serviceversion=0001';
      const http = http406ThenOk(path);
      const result = await publishServiceBinding(
        http,
        unrestrictedSafetyConfig(),
        'ZSSI_UI_S_ORD_O4',
        '0001',
        'odatav4',
      );

      expect(http.post).toHaveBeenCalledTimes(2);
      expect(http.post).toHaveBeenNthCalledWith(
        1,
        path,
        expect.stringContaining('adtcore:objectReference adtcore:name="ZSSI_UI_S_ORD_O4"'),
        'application/xml',
        { Accept: 'application/vnd.sap.as+xml, application/*;q=0.8' },
      );
      const asXmlType =
        'application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.businessservices.odatav4.publishjob';
      expect(http.post).toHaveBeenNthCalledWith(
        2,
        path,
        expect.stringContaining('adtcore:objectReference adtcore:name="ZSSI_UI_S_ORD_O4"'),
        asXmlType,
        { Accept: asXmlType },
      );
      expect(result.severity).toBe('OK');
      expect(result.shortText).toBe('ZSSI_UI_S_ORD_O4 published locally');
    });

    it('unpublish retries with the unpublishjob dataname (odatav4)', async () => {
      const path =
        '/sap/bc/adt/businessservices/odatav4/unpublishjobs?servicename=ZSSI_UI_S_ORD_O4&serviceversion=0001';
      const http = http406ThenOk(path);
      const result = await unpublishServiceBinding(
        http,
        unrestrictedSafetyConfig(),
        'ZSSI_UI_S_ORD_O4',
        '0001',
        'odatav4',
      );

      const asXmlType =
        'application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.businessservices.odatav4.unpublishjob';
      expect(http.post).toHaveBeenCalledTimes(2);
      expect(http.post).toHaveBeenNthCalledWith(2, path, expect.any(String), asXmlType, { Accept: asXmlType });
      expect(result.severity).toBe('OK');
    });

    it('publish retry uses the odatav2 dataname for odatav2 bindings', async () => {
      const path = '/sap/bc/adt/businessservices/odatav2/publishjobs?servicename=ZSB_FLIGHT&serviceversion=0001';
      const http = http406ThenOk(path);
      await publishServiceBinding(http, unrestrictedSafetyConfig(), 'ZSB_FLIGHT');

      const asXmlType =
        'application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.businessservices.odatav2.publishjob';
      expect(http.post).toHaveBeenNthCalledWith(2, path, expect.any(String), asXmlType, { Accept: asXmlType });
    });

    it('does not retry a 406 that does not name application/vnd.sap.as+xml', async () => {
      const err = new AdtApiError('Not acceptable', 406, '/sap/bc/adt/businessservices/odatav4/publishjobs');
      const post = vi.fn().mockRejectedValue(err);
      const http = { post } as unknown as AdtHttpClient;

      await expect(
        publishServiceBinding(http, unrestrictedSafetyConfig(), 'ZSB_TEST', '0001', 'odatav4'),
      ).rejects.toThrow(AdtApiError);
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('does not retry non-negotiation errors', async () => {
      const err = new AdtApiError('Internal server error', 500, '/sap/bc/adt/businessservices/odatav4/publishjobs');
      const post = vi.fn().mockRejectedValue(err);
      const http = { post } as unknown as AdtHttpClient;

      await expect(
        publishServiceBinding(http, unrestrictedSafetyConfig(), 'ZSB_TEST', '0001', 'odatav4'),
      ).rejects.toThrow('Internal server error');
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('surfaces the error when the as+xml retry also fails (no retry loop)', async () => {
      const err = new AdtApiError(notAcceptableBody, 406, '/x', notAcceptableBody);
      const post = vi.fn().mockRejectedValue(err);
      const http = { post } as unknown as AdtHttpClient;

      await expect(
        publishServiceBinding(http, unrestrictedSafetyConfig(), 'ZSB_TEST', '0001', 'odatav4'),
      ).rejects.toThrow(AdtApiError);
      expect(post).toHaveBeenCalledTimes(2);
    });
  });

  // ─── runUnitTests ──────────────────────────────────────────────────

  describe('runUnitTests', () => {
    it('parses passing tests with class info', async () => {
      const xml = `<testResult>
        <testClass name="LTCL_TEST" uri="/sap/bc/adt/oo/classes/ZCL_TEST/includes/testclasses">
          <testMethod name="test_success"></testMethod>
        </testClass>
      </testResult>`;
      const http = mockHttp(xml);
      const { tests: results } = await runUnitTests(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/oo/classes/ZCL_TEST',
      );
      expect(results).toHaveLength(1);
      expect(results[0]?.testMethod).toBe('test_success');
      expect(results[0]?.status).toBe('passed');
      expect(results[0]?.testClass).toBe('LTCL_TEST');
      expect(results[0]?.program).toBe('ZCL_TEST');
    });

    it('detects failing tests (with alerts)', async () => {
      const xml = `<testResult>
        <testClass name="LTCL_TEST" uri="/sap/bc/adt/oo/classes/ZCL_TEST/includes/testclasses">
          <testMethod name="test_fail"><alert kind="failedAssertion"><title>Expected X got Y</title></alert></testMethod>
        </testClass>
      </testResult>`;
      const http = mockHttp(xml);
      const { tests: results } = await runUnitTests(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/oo/classes/ZCL_TEST',
      );
      expect(results).toHaveLength(1);
      expect(results[0]?.status).toBe('failed');
    });

    it('handles empty results (no test methods)', async () => {
      const http = mockHttp('<testResult/>');
      const { tests: results } = await runUnitTests(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/oo/classes/ZCL_TEST',
      );
      expect(results).toEqual([]);
    });

    it('handles multiple test methods', async () => {
      const xml = `<testResult>
        <testClass name="LTCL_TEST" uri="/sap/bc/adt/oo/classes/ZCL_TEST/includes/testclasses">
          <testMethod name="test_a"></testMethod>
          <testMethod name="test_b"><alert kind="failedAssertion"><title>Assertion failed</title></alert></testMethod>
          <testMethod name="test_c"></testMethod>
        </testClass>
      </testResult>`;
      const http = mockHttp(xml);
      const { tests: results } = await runUnitTests(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/oo/classes/ZCL_TEST',
      );
      expect(results).toHaveLength(3);
      expect(results[0]?.status).toBe('passed');
      expect(results[1]?.status).toBe('failed');
      expect(results[2]?.status).toBe('passed');
    });

    it('extracts alert message from title element', async () => {
      const xml = `<testResult>
        <testClass name="LTCL_TEST" uri="/sap/bc/adt/oo/classes/ZCL_TEST/includes/testclasses">
          <testMethod name="test_fail">
            <alert kind="failedAssertion"><title>Expected 42 got 0</title></alert>
          </testMethod>
        </testClass>
      </testResult>`;
      const http = mockHttp(xml);
      const { tests: results } = await runUnitTests(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/oo/classes/ZCL_TEST',
      );
      expect(results).toHaveLength(1);
      expect(results[0]?.message).toBe('Expected 42 got 0');
    });

    it('parses multiple test classes in one response', async () => {
      const xml = `<testResult>
        <testClass name="LTCL_FIRST" uri="/sap/bc/adt/oo/classes/ZCL_TEST/includes/testclasses">
          <testMethod name="test_one"></testMethod>
        </testClass>
        <testClass name="LTCL_SECOND" uri="/sap/bc/adt/oo/classes/ZCL_TEST/includes/testclasses">
          <testMethod name="test_two"></testMethod>
        </testClass>
      </testResult>`;
      const http = mockHttp(xml);
      const { tests: results } = await runUnitTests(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/oo/classes/ZCL_TEST',
      );
      expect(results).toHaveLength(2);
      expect(results[0]?.testClass).toBe('LTCL_FIRST');
      expect(results[0]?.testMethod).toBe('test_one');
      expect(results[1]?.testClass).toBe('LTCL_SECOND');
      expect(results[1]?.testMethod).toBe('test_two');
    });

    it('extracts program name from URI', async () => {
      const xml = `<testResult>
        <testClass name="LTCL_TEST" uri="/sap/bc/adt/oo/classes/ZCL_MY_CLASS/includes/testclasses">
          <testMethod name="test_it"></testMethod>
        </testClass>
      </testResult>`;
      const http = mockHttp(xml);
      const { tests: results } = await runUnitTests(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/oo/classes/ZCL_MY_CLASS',
      );
      expect(results[0]?.program).toBe('ZCL_MY_CLASS');
    });

    it('extracts duration from executionTime attribute', async () => {
      const xml = `<testResult>
        <testClass name="LTCL_TEST" uri="/sap/bc/adt/oo/classes/ZCL_TEST/includes/testclasses">
          <testMethod name="test_fast" executionTime="0.015"></testMethod>
        </testClass>
      </testResult>`;
      const http = mockHttp(xml);
      const { tests: results } = await runUnitTests(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/oo/classes/ZCL_TEST',
      );
      expect(results[0]?.duration).toBe(0.015);
    });
  });

  describe('AUnit coverage (FEAT-41)', () => {
    const fixturesDir = join(import.meta.dirname, '../../fixtures/xml');
    const testrunWithCoverage = readFileSync(join(fixturesDir, 'aunit-testrun-with-coverage.xml'), 'utf-8');
    const coverageMeasurement = readFileSync(join(fixturesDir, 'aunit-coverage-measurement.xml'), 'utf-8');

    it('extractCoverageMeasurementUri finds the measurement URI (real fixture); null when absent', () => {
      expect(extractCoverageMeasurementUri(testrunWithCoverage)).toMatch(/\/coverage\/measurements\/[A-F0-9]+$/);
      expect(extractCoverageMeasurementUri('<testResult/>')).toBeNull();
    });

    it('parseCoverageMeasurement returns the statement/branch/procedure aggregate (real fixture)', () => {
      const cov = parseCoverageMeasurement(coverageMeasurement);
      expect(cov.statement).toEqual({ executed: 30, total: 49, percent: 61.22 });
      expect(cov.branch).toEqual({ executed: 5, total: 14, percent: 35.71 });
      expect(cov.procedure).toEqual({ executed: 3, total: 8, percent: 37.5 });
    });

    it('parseCoverageMeasurement surfaces methods below full statement coverage, worst-first (real fixture)', () => {
      const cov = parseCoverageMeasurement(coverageMeasurement);
      const below = cov.methodsBelowFull ?? [];
      const names = below.map((m) => m.method);
      // 7 of the 8 ZCL_ABAPGIT_HASH methods are < 100% statement coverage; SHA1 (11/11) is excluded.
      expect(below).toHaveLength(7);
      expect(names).not.toContain('SHA1');
      // Worst-first by percent, then larger gap (total) first → SHA1_STRING (0/7) leads.
      expect(below[0]).toEqual({
        method: 'SHA1_STRING',
        statement: { executed: 0, total: 7, percent: 0 },
        branch: { executed: 0, total: 2, percent: 0 },
        procedure: { executed: 0, total: 1, percent: 0 },
      });
      // A fully-untested 0/2 method is present; the partial 87.5% method ranks last.
      expect(names).toContain('SHA1_BLOB');
      expect(below.at(-1)?.method).toBe('ADLER32');
      // Monotonic non-decreasing statement percent.
      const pcts = below.map((m) => m.statement?.percent ?? 0);
      expect(pcts).toEqual([...pcts].sort((a, b) => a - b));
    });

    it('parseCoverageMeasurement reads per-method coverage on NW 7.50 (CLAS/OM/<visibility> type)', () => {
      // 7.50 tags method nodes `CLAS/OM/public` (vs `CLAS/OM` on 758/816) — live-verified 2026-06-25.
      const nw750 = `<?xml version="1.0"?>
<cov:result name="ADT_ROOT_NODE" xmlns:cov="http://www.sap.com/adt/cov" xmlns:adtcore="http://www.sap.com/adt/core">
  <nodes><node>
    <adtcore:objectReference adtcore:name="ZCL_ARC1_COV==========CP" adtcore:type="CLAS/OCI"/>
    <coverages><coverage type="statement" total="4" executed="3"/></coverages>
    <nodes><node>
      <adtcore:objectReference adtcore:type="CLAS/OM/public" adtcore:name="ADD"/>
      <coverages><coverage type="statement" total="4" executed="3"/></coverages>
    </node></nodes>
  </node></nodes>
</cov:result>`;
      const cov = parseCoverageMeasurement(nw750);
      expect(cov.statement).toEqual({ executed: 3, total: 4, percent: 75 });
      expect(cov.methodsBelowFull).toEqual([{ method: 'ADD', statement: { executed: 3, total: 4, percent: 75 } }]);
    });

    it('parseCoverageMeasurement omits methodsBelowFull when every method is fully covered', () => {
      const fullyCovered = `<?xml version="1.0"?>
<cov:result name="ADT_ROOT_NODE" xmlns:cov="http://www.sap.com/adt/cov" xmlns:adtcore="http://www.sap.com/adt/core">
  <nodes><node>
    <adtcore:objectReference adtcore:name="ZCL_X==========CP" adtcore:type="CLAS/OCI"/>
    <coverages><coverage type="statement" total="5" executed="5"/></coverages>
    <nodes><node>
      <adtcore:objectReference adtcore:name="ONLY_METHOD" adtcore:type="CLAS/OM"/>
      <coverages><coverage type="statement" total="5" executed="5"/></coverages>
    </node></nodes>
  </node></nodes>
</cov:result>`;
      const cov = parseCoverageMeasurement(fullyCovered);
      expect(cov.statement).toEqual({ executed: 5, total: 5, percent: 100 });
      expect(cov.methodsBelowFull).toBeUndefined();
    });

    it('parseCoverageMeasurement returns {} when there is no coverage node', () => {
      expect(parseCoverageMeasurement('<result name="ADT_ROOT_NODE"/>')).toEqual({});
      expect(parseCoverageMeasurement('')).toEqual({});
    });

    it('parseCoverageMeasurement reads the root program aggregate, not nested method coverage', () => {
      const cov = parseCoverageMeasurement(`<?xml version="1.0"?>
<cov:result name="ADT_ROOT_NODE" xmlns:cov="http://www.sap.com/adt/cov" xmlns:adtcore="http://www.sap.com/adt/core">
  <nodes>
    <node>
      <adtcore:objectReference adtcore:name="ZCL_AGGREGATE==========CP" adtcore:type="CLAS/OCI"/>
      <nodes>
        <node>
          <adtcore:objectReference adtcore:name="METHOD_ONE" adtcore:type="CLAS/OM"/>
          <coverages>
            <coverage type="statement" total="1" executed="1"/>
          </coverages>
        </node>
      </nodes>
      <coverages>
        <coverage type="statement" total="80" executed="40"/>
      </coverages>
    </node>
  </nodes>
</cov:result>`);
      expect(cov.statement).toEqual({ executed: 40, total: 80, percent: 50 });
    });

    it('parseCoverageMeasurement skips malformed numeric metrics and keeps zero totals finite', () => {
      const cov = parseCoverageMeasurement(`<?xml version="1.0"?>
<cov:result name="ADT_ROOT_NODE" xmlns:cov="http://www.sap.com/adt/cov">
  <nodes>
    <node>
      <coverages>
        <coverage type="statement" total="0" executed="0"/>
        <coverage type="branch" total="not-a-number" executed="1"/>
      </coverages>
    </node>
  </nodes>
</cov:result>`);
      expect(cov.statement).toEqual({ executed: 0, total: 0, percent: 0 });
      expect(cov.branch).toBeUndefined();
      expect(Number.isNaN(cov.statement?.percent)).toBe(false);
    });

    it('runUnitTests({coverage:true}) runs the 2-step flow and returns tests + aggregate', async () => {
      const http = mockHttpSequence(testrunWithCoverage, coverageMeasurement);
      const result = await runUnitTests(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_ABAPGIT_HASH', {
        coverage: true,
      });
      expect(result.tests.length).toBeGreaterThan(0);
      expect(result.coverage?.statement?.percent).toBe(61.22);
    });

    it('runUnitTests degrades gracefully when the coverage measurement POST fails', async () => {
      const post = vi
        .fn()
        .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: testrunWithCoverage })
        .mockRejectedValueOnce(new AdtApiError('method not supported', 405, '/cov'));
      const http = {
        get: vi.fn(),
        post,
        put: vi.fn(),
        delete: vi.fn(),
        fetchCsrfToken: vi.fn(),
      } as unknown as AdtHttpClient;
      const result = await runUnitTests(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_ABAPGIT_HASH', {
        coverage: true,
      });
      expect(result.tests.length).toBeGreaterThan(0);
      expect(result.coverage).toBeUndefined();
    });

    it('runUnitTests degrades gracefully when coverage XML contains no valid aggregate', async () => {
      const invalidCoverage = `<?xml version="1.0"?>
<cov:result name="ADT_ROOT_NODE" xmlns:cov="http://www.sap.com/adt/cov">
  <nodes>
    <node>
      <coverages>
        <coverage type="statement" total="bad" executed="1"/>
      </coverages>
    </node>
  </nodes>
</cov:result>`;
      const http = mockHttpSequence(testrunWithCoverage, invalidCoverage);
      const result = await runUnitTests(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_ABAPGIT_HASH', {
        coverage: true,
      });
      expect(result.tests.length).toBeGreaterThan(0);
      expect(result.coverage).toBeUndefined();
    });

    it('runUnitTests without coverage makes only the one testruns call', async () => {
      const http = mockHttp(testrunWithCoverage);
      const result = await runUnitTests(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_ABAPGIT_HASH');
      expect(result.coverage).toBeUndefined();
      expect(http.post).toHaveBeenCalledTimes(1);
    });
  });

  // ─── getFixProposals / applyFixProposal ───────────────────────────

  describe('quickfix APIs', () => {
    it('getFixProposals parses quickfix proposals', async () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<qf:evaluationResults xmlns:qf="http://www.sap.com/adt/quickfixes" xmlns:adtcore="http://www.sap.com/adt/core">
  <qf:evaluationResult>
    <adtcore:objectReference adtcore:uri="/sap/bc/adt/quickfixes/1" adtcore:type="quickfix/proposal" adtcore:name="Declare variable" adtcore:description="Adds DATA declaration"/>
    <qf:userContent>opaque-1</qf:userContent>
  </qf:evaluationResult>
  <qf:evaluationResult>
    <adtcore:objectReference adtcore:uri="/sap/bc/adt/quickfixes/2" adtcore:type="quickfix/proposal" adtcore:name="Inline DATA" adtcore:description="Converts to inline declaration"/>
    <qf:userContent>opaque-2</qf:userContent>
  </qf:evaluationResult>
</qf:evaluationResults>`;
      const http = mockHttp(xml);

      const proposals = await getFixProposals(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/oo/classes/ZCL_TEST/source/main',
        'CLASS zcl_test IMPLEMENTATION. ENDCLASS.',
        12,
        7,
      );

      expect(proposals).toHaveLength(2);
      expect(proposals[0]).toEqual({
        uri: '/sap/bc/adt/quickfixes/1',
        type: 'quickfix/proposal',
        name: 'Declare variable',
        description: 'Adds DATA declaration',
        userContent: 'opaque-1',
      });
      expect(proposals[1]?.name).toBe('Inline DATA');
    });

    it('getFixProposals preserves affected object units from evaluation response', async () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<qf:evaluationResults xmlns:qf="http://www.sap.com/adt/quickfixes" xmlns:adtcore="http://www.sap.com/adt/core">
  <qf:evaluationResult>
    <adtcore:objectReference adtcore:uri="/sap/bc/adt/quickfixes/1" adtcore:type="quickfix/proposal" adtcore:name="Apply multi-object fix" adtcore:description="Updates helper include"/>
    <qf:affectedObjects>
      <qf:unit>
        <qf:content>CLASS helper DEFINITION. ENDCLASS.</qf:content>
        <adtcore:objectReference adtcore:uri="/sap/bc/adt/oo/classes/ZCL_TEST/source/main#start=1,0;end=1,5" adtcore:type="CLAS/OC" adtcore:name="ZCL_TEST" adtcore:description="Main class"/>
      </qf:unit>
    </qf:affectedObjects>
    <qf:userContent></qf:userContent>
  </qf:evaluationResult>
</qf:evaluationResults>`;
      const http = mockHttp(xml);

      const proposals = await getFixProposals(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/oo/classes/ZCL_TEST/source/main',
        'CLASS zcl_test IMPLEMENTATION. ENDCLASS.',
        1,
        0,
      );

      expect(proposals[0]?.userContent).toBe('');
      expect(proposals[0]?.affectedObjects).toEqual([
        {
          uri: '/sap/bc/adt/oo/classes/ZCL_TEST/source/main#start=1,0;end=1,5',
          type: 'CLAS/OC',
          name: 'ZCL_TEST',
          description: 'Main class',
          content: 'CLASS helper DEFINITION. ENDCLASS.',
        },
      ]);
    });

    it('getFixProposals returns empty array for empty evaluation response', async () => {
      const http = mockHttp('<qf:evaluationResults xmlns:qf="http://www.sap.com/adt/quickfixes"/>');
      const proposals = await getFixProposals(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/programs/programs/ZTEST/source/main',
        'REPORT ztest.',
        1,
        0,
      );
      expect(proposals).toEqual([]);
    });

    it('getFixProposals returns empty array on 404 endpoint missing', async () => {
      const http = mockHttp();
      (http.post as ReturnType<typeof vi.fn>).mockRejectedValue(
        new AdtApiError('Not found', 404, '/sap/bc/adt/quickfixes/evaluation'),
      );

      const proposals = await getFixProposals(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/programs/programs/ZTEST/source/main',
        'REPORT ztest.',
        1,
        0,
      );
      expect(proposals).toEqual([]);
    });

    it('getFixProposals returns empty array on 406 not acceptable', async () => {
      const http = mockHttp();
      (http.post as ReturnType<typeof vi.fn>).mockRejectedValue(
        new AdtApiError('Not acceptable', 406, '/sap/bc/adt/quickfixes/evaluation'),
      );

      const proposals = await getFixProposals(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/programs/programs/ZTEST/source/main',
        'REPORT ztest.',
        1,
        0,
      );
      expect(proposals).toEqual([]);
    });

    it('getFixProposals encodes #start fragment in URI query parameter', async () => {
      const http = mockHttp('<qf:evaluationResults xmlns:qf="http://www.sap.com/adt/quickfixes"/>');
      await getFixProposals(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/oo/classes/ZCL_TEST/source/main',
        'CLASS zcl_test IMPLEMENTATION. ENDCLASS.',
        42,
        3,
      );

      const path = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(path).toContain('/sap/bc/adt/quickfixes/evaluation?uri=');
      expect(path).toContain('%23start%3D42%2C3');
    });

    it('getFixProposals sends source as request body', async () => {
      const source = 'CLASS zcl_test IMPLEMENTATION.\nENDCLASS.';
      const http = mockHttp('<qf:evaluationResults xmlns:qf="http://www.sap.com/adt/quickfixes"/>');
      await getFixProposals(
        http,
        unrestrictedSafetyConfig(),
        '/sap/bc/adt/oo/classes/ZCL_TEST/source/main',
        source,
        1,
        0,
      );

      const body = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(body).toBe(source);
    });

    it('applyFixProposal parses deltas', async () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<quickfixes:applicationResult xmlns:quickfixes="http://www.sap.com/adt/quickfixes">
  <quickfixes:delta uri="/sap/bc/adt/oo/classes/ZCL_TEST/source/main" startLine="7" startColumn="3" endLine="7" endColumn="8">
    <content>DATA(lv_count)</content>
  </quickfixes:delta>
</quickfixes:applicationResult>`;
      const http = mockHttp(xml);

      const deltas = await applyFixProposal(
        http,
        unrestrictedSafetyConfig(),
        {
          uri: '/sap/bc/adt/quickfixes/1',
          type: 'quickfix/proposal',
          name: 'Declare variable',
          description: 'Adds DATA declaration',
          userContent: 'opaque-1',
        },
        '/sap/bc/adt/oo/classes/ZCL_TEST/source/main',
        'CLASS zcl_test IMPLEMENTATION. ENDCLASS.',
        7,
        3,
      );

      expect(deltas).toEqual([
        {
          uri: '/sap/bc/adt/oo/classes/ZCL_TEST/source/main',
          range: { start: { line: 7, column: 3 }, end: { line: 7, column: 8 } },
          content: 'DATA(lv_count)',
        },
      ]);
    });

    it('applyFixProposal parses ADT proposalResult unit deltas', async () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<quickfixes:proposalResult xmlns:quickfixes="http://www.sap.com/adt/quickfixes" xmlns:adtcore="http://www.sap.com/adt/core">
  <deltas>
    <unit>
      <content>METHODS approve_project FOR MODIFY.</content>
      <adtcore:objectReference adtcore:uri="/sap/bc/adt/oo/classes/ZBP_DM_PROJECT/includes/definitions#start=4,2;end=4,2"/>
    </unit>
  </deltas>
</quickfixes:proposalResult>`;
      const http = mockHttp(xml);

      const deltas = await applyFixProposal(
        http,
        unrestrictedSafetyConfig(),
        {
          uri: '/sap/bc/adt/quickfixes/1',
          type: 'quickfix/proposal',
          name: 'Create implementation',
          description: 'Creates handler methods',
          userContent: '',
        },
        '/sap/bc/adt/oo/classes/ZBP_DM_PROJECT/includes/definitions',
        'CLASS lhc_project DEFINITION. ENDCLASS.',
        4,
        2,
      );

      expect(deltas).toEqual([
        {
          uri: '/sap/bc/adt/oo/classes/ZBP_DM_PROJECT/includes/definitions#start=4,2;end=4,2',
          range: { start: { line: 4, column: 2 }, end: { line: 4, column: 2 } },
          content: 'METHODS approve_project FOR MODIFY.',
        },
      ]);
    });

    it('applyFixProposal posts to proposal URI', async () => {
      const http = mockHttp('<quickfixes:applicationResult xmlns:quickfixes="http://www.sap.com/adt/quickfixes"/>');
      await applyFixProposal(
        http,
        unrestrictedSafetyConfig(),
        {
          uri: '/sap/bc/adt/quickfixes/123',
          type: 'quickfix/proposal',
          name: 'Fix',
          description: 'Fix',
          userContent: 'opaque',
        },
        '/sap/bc/adt/programs/programs/ZTEST/source/main',
        'REPORT ztest.',
        1,
        0,
      );

      const target = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(target).toBe('/sap/bc/adt/quickfixes/123');
      expect((http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[2]).toBe('application/xml');
      expect((http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[3]).toEqual({ Accept: 'application/xml' });
    });

    it('applyFixProposal requires write safety before posting', async () => {
      const http = mockHttp('<quickfixes:applicationResult xmlns:quickfixes="http://www.sap.com/adt/quickfixes"/>');
      await expect(
        applyFixProposal(
          http,
          defaultSafetyConfig(),
          {
            uri: '/sap/bc/adt/quickfixes/123',
            type: 'quickfix/proposal',
            name: 'Fix',
            description: 'Fix',
            userContent: 'opaque',
          },
          '/sap/bc/adt/programs/programs/ZTEST/source/main',
          'REPORT ztest.',
          1,
          0,
        ),
      ).rejects.toThrow(AdtSafetyError);
      expect(http.post).not.toHaveBeenCalled();
    });

    it('applyFixProposal rejects caller-controlled non-quickfix ADT URIs', async () => {
      const http = mockHttp('<quickfixes:applicationResult xmlns:quickfixes="http://www.sap.com/adt/quickfixes"/>');
      await expect(
        applyFixProposal(
          http,
          unrestrictedSafetyConfig(),
          {
            uri: '/sap/bc/adt/oo/classes/ZCL_TARGET/source/main',
            type: 'quickfix/proposal',
            name: 'Fix',
            description: 'Fix',
            userContent: 'opaque',
          },
          '/sap/bc/adt/programs/programs/ZTEST/source/main',
          'REPORT ztest.',
          1,
          0,
        ),
      ).rejects.toThrow(/non-quickfix proposal URI/);
      expect(http.post).not.toHaveBeenCalled();
    });

    it('applyFixProposal rejects absolute quickfix URIs', async () => {
      const http = mockHttp('<quickfixes:applicationResult xmlns:quickfixes="http://www.sap.com/adt/quickfixes"/>');
      await expect(
        applyFixProposal(
          http,
          unrestrictedSafetyConfig(),
          {
            uri: 'https://sap.example.test/sap/bc/adt/quickfixes/123',
            type: 'quickfix/proposal',
            name: 'Fix',
            description: 'Fix',
            userContent: 'opaque',
          },
          '/sap/bc/adt/programs/programs/ZTEST/source/main',
          'REPORT ztest.',
          1,
          0,
        ),
      ).rejects.toThrow(/non-quickfix proposal URI/);
      expect(http.post).not.toHaveBeenCalled();
    });

    it('applyFixProposal rejects protocol-relative quickfix URIs', async () => {
      const http = mockHttp('<quickfixes:applicationResult xmlns:quickfixes="http://www.sap.com/adt/quickfixes"/>');
      await expect(
        applyFixProposal(
          http,
          unrestrictedSafetyConfig(),
          {
            uri: '//arc1.invalid/sap/bc/adt/quickfixes/123',
            type: 'quickfix/proposal',
            name: 'Fix',
            description: 'Fix',
            userContent: 'opaque',
          },
          '/sap/bc/adt/programs/programs/ZTEST/source/main',
          'REPORT ztest.',
          1,
          0,
        ),
      ).rejects.toThrow(/non-quickfix proposal URI/);
      expect(http.post).not.toHaveBeenCalled();
    });

    it('applyFixProposal includes userContent in request XML', async () => {
      const http = mockHttp('<quickfixes:applicationResult xmlns:quickfixes="http://www.sap.com/adt/quickfixes"/>');
      await applyFixProposal(
        http,
        unrestrictedSafetyConfig(),
        {
          uri: '/sap/bc/adt/quickfixes/123',
          type: 'quickfix/proposal',
          name: 'Fix',
          description: 'Fix',
          userContent: 'opaque-state',
        },
        '/sap/bc/adt/programs/programs/ZTEST/source/main',
        'REPORT ztest.',
        1,
        0,
      );

      const body = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(body).toContain('<userContent>opaque-state</userContent>');
    });

    it('applyFixProposal preserves empty userContent in request XML', async () => {
      const http = mockHttp('<quickfixes:proposalResult xmlns:quickfixes="http://www.sap.com/adt/quickfixes"/>');
      await applyFixProposal(
        http,
        unrestrictedSafetyConfig(),
        {
          uri: '/sap/bc/adt/quickfixes/123',
          type: 'quickfix/proposal',
          name: 'Fix',
          description: 'Fix',
          userContent: '',
        },
        '/sap/bc/adt/programs/programs/ZTEST/source/main',
        'REPORT ztest.',
        1,
        0,
      );

      const body = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(body).toContain('<userContent></userContent>');
    });

    it('applyFixProposal serializes affected object units with content', async () => {
      const http = mockHttp('<quickfixes:proposalResult xmlns:quickfixes="http://www.sap.com/adt/quickfixes"/>');
      await applyFixProposal(
        http,
        unrestrictedSafetyConfig(),
        {
          uri: '/sap/bc/adt/quickfixes/123',
          type: 'quickfix/proposal',
          name: 'Fix',
          description: 'Fix',
          userContent: 'opaque-state',
          affectedObjects: [
            {
              uri: '/sap/bc/adt/oo/classes/ZCL_HELPER/source/main',
              type: 'CLAS/OC',
              name: 'ZCL_HELPER',
              description: 'Helper class',
              content: 'CLASS zcl_helper DEFINITION. ENDCLASS.',
            },
          ],
        },
        '/sap/bc/adt/programs/programs/ZTEST/source/main',
        'REPORT ztest.',
        1,
        0,
      );

      const body = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(body).toContain('<affectedObjects>');
      expect(body).toContain('<unit>');
      expect(body).toContain('<content>CLASS zcl_helper DEFINITION. ENDCLASS.</content>');
      expect(body).toContain('adtcore:uri="/sap/bc/adt/oo/classes/ZCL_HELPER/source/main"');
      expect(body).toContain('adtcore:type="CLAS/OC"');
      expect(body).toContain('adtcore:name="ZCL_HELPER"');
    });

    it('applyFixProposal XML-escapes source and userContent', async () => {
      const http = mockHttp('<quickfixes:applicationResult xmlns:quickfixes="http://www.sap.com/adt/quickfixes"/>');
      await applyFixProposal(
        http,
        unrestrictedSafetyConfig(),
        {
          uri: '/sap/bc/adt/quickfixes/123',
          type: 'quickfix/proposal',
          name: 'Fix',
          description: 'Fix',
          userContent: 'use <tag> & "quote"',
        },
        '/sap/bc/adt/programs/programs/ZTEST/source/main',
        `REPORT ztest.\nWRITE '<A&B>'.`,
        1,
        0,
      );

      const body = (http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as string;
      expect(body).toContain('&lt;A&amp;B&gt;');
      expect(body).toContain('use &lt;tag&gt; &amp; &quot;quote&quot;');
    });
  });

  // ─── XML attribute escaping ────────────────────────────────────────

  describe('XML attribute escaping', () => {
    it('syntaxCheck escapes special chars in object URL', async () => {
      const http = mockHttp('<checkMessages/>');
      await syntaxCheck(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/CL_TEST&FOO');

      const callArgs = (http.post as any).mock.calls[0];
      const body = callArgs[1] as string;
      expect(body).toContain('&amp;');
      expect(body).not.toContain('CL_TEST&FOO');
    });

    it('activate escapes special chars in object URL', async () => {
      const http = mockHttp('<activation/>');
      await activate(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/CL_TEST&FOO');

      const callArgs = (http.post as any).mock.calls[0];
      const body = callArgs[1] as string;
      expect(body).toContain('&amp;');
      expect(body).not.toContain('CL_TEST&FOO');
    });

    it('activateBatch escapes special chars in name and URL', async () => {
      const http = mockHttp('<activation/>');
      await activateBatch(http, unrestrictedSafetyConfig(), [
        { url: '/sap/bc/adt/oo/classes/CL_TEST', name: 'ZCL_"TEST"' },
      ]);

      const callArgs = (http.post as any).mock.calls[0];
      const body = callArgs[1] as string;
      expect(body).toContain('&quot;');
      expect(body).not.toContain('ZCL_"TEST"');
    });

    it('publishServiceBinding escapes name in XML body', async () => {
      const http = mockHttp('');
      await publishServiceBinding(http, unrestrictedSafetyConfig(), 'ZSRV<TEST');

      const callArgs = (http.post as any).mock.calls[0];
      const body = callArgs[1] as string;
      expect(body).toContain('&lt;');
      expect(body).not.toContain('ZSRV<TEST');
    });
  });

  // ─── runAtcCheck ───────────────────────────────────────────────────

  describe('runAtcCheck', () => {
    it('parses ATC findings', async () => {
      const createResp = '<atc:run xmlns:atc="http://www.sap.com/adt/atc" id="42" worklistId="42"/>';
      const resultResp = `<worklist>
        <finding priority="1" checkTitle="Extended Check" messageTitle="Unused variable" uri="/sap/bc/adt/oo/classes/ZCL_TEST/source/main#start=42,1"/>
        <finding priority="2" checkTitle="Naming" messageTitle="Non-standard naming" uri="/sap/bc/adt/oo/classes/ZCL_TEST/source/main#start=10,5"/>
      </worklist>`;
      const http = {
        ...mockHttp(createResp),
        get: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: resultResp }),
      } as unknown as AdtHttpClient;

      const result = await runAtcCheck(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_TEST');
      expect(result.findings).toHaveLength(2);
      expect(result.findings[0]?.priority).toBe(1);
      expect(result.findings[0]?.checkTitle).toBe('Extended Check');
      expect(result.findings[0]?.uri).toContain('/sap/bc/adt/oo/classes/ZCL_TEST');
      expect(result.findings[0]?.line).toBe(42);
      expect(result.findings[1]?.priority).toBe(2);
      expect(result.findings[1]?.line).toBe(10);
    });

    it('handles empty ATC results', async () => {
      const createResp = '<atc:run xmlns:atc="http://www.sap.com/adt/atc" id="42" worklistId="42"/>';
      const resultResp = '<worklist/>';
      const http = {
        ...mockHttp(createResp),
        get: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: resultResp }),
      } as unknown as AdtHttpClient;

      const result = await runAtcCheck(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_TEST');
      expect(result.findings).toEqual([]);
    });

    it('runs the three-step worklist flow: create worklist → run → fetch findings', async () => {
      // The worklist-create POST returns the worklist id as a plain-text body; the run POST
      // executes the checks into it; the GET reads the populated worklist.
      const resultResp = '<worklist/>';
      const http = {
        ...mockHttp('WL789'),
        get: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: resultResp }),
      } as unknown as AdtHttpClient;

      await runAtcCheck(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_TEST');

      // 1) create a worklist (no variant → no checkVariant param)
      expect(http.post).toHaveBeenCalledWith(
        '/sap/bc/adt/atc/worklists',
        '',
        'application/xml',
        expect.objectContaining({ Accept: 'text/plain' }),
      );
      // 2) run the checks into the returned worklist id
      expect(http.post).toHaveBeenCalledWith(
        expect.stringContaining('/sap/bc/adt/atc/runs?worklistId=WL789'),
        expect.stringContaining('objectReference'),
        'application/xml',
        expect.objectContaining({ Accept: 'application/xml' }),
      );
      // 3) fetch the worklist that was actually created (not the hardcoded id=1)
      expect(http.get).toHaveBeenCalledWith(
        '/sap/bc/adt/atc/worklists/WL789',
        expect.objectContaining({ Accept: expect.stringContaining('atc.worklist') }),
      );
    });

    it('binds the worklist to the named check variant when one is given', async () => {
      const http = {
        ...mockHttp('WL42'),
        get: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '<worklist/>' }),
      } as unknown as AdtHttpClient;

      await runAtcCheck(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_TEST', 'S4HANA_READINESS_2023');

      expect(http.post).toHaveBeenCalledWith(
        '/sap/bc/adt/atc/worklists?checkVariant=S4HANA_READINESS_2023',
        '',
        'application/xml',
        expect.objectContaining({ Accept: 'text/plain' }),
      );
    });

    it('throws a clear error when worklist creation returns no id', async () => {
      const http = {
        ...mockHttp('   '),
        get: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '<worklist/>' }),
      } as unknown as AdtHttpClient;

      await expect(runAtcCheck(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_TEST')).rejects.toThrow(
        /worklist creation returned no worklist id/i,
      );
    });

    it('parses the real SAP worklist response format (captured fixture)', async () => {
      const { readFileSync } = await import('node:fs');
      const fixture = readFileSync(new URL('../../fixtures/xml/atc-worklist-findings.xml', import.meta.url), 'utf-8');
      const http = {
        ...mockHttp('1E814DFAAE5E1FE197E6112F5FDC38A2'),
        get: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: fixture }),
      } as unknown as AdtHttpClient;

      const result = await runAtcCheck(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/Z_TEST');
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]?.priority).toBe(2);
      expect(result.findings[0]?.checkTitle).toBe('Search DB Operations');
      expect(result.findings[0]?.messageTitle).toContain('DB Operation INSERT');
      expect(result.findings[0]?.line).toBe(86);
      expect(result.findings[0]?.quickfixInfo).toContain('atc:');
      expect(result.findings[0]?.hasQuickfix).toBe(false);
    });

    it('extracts URI and line from #start= fragment', async () => {
      const createResp = '<atc:run xmlns:atc="http://www.sap.com/adt/atc" id="42" worklistId="42"/>';
      const resultResp = `<worklist>
        <finding priority="1" checkTitle="Check" messageTitle="Issue" uri="/sap/bc/adt/oo/classes/ZCL_X/source/main#start=42,1"/>
      </worklist>`;
      const http = {
        ...mockHttp(createResp),
        get: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: resultResp }),
      } as unknown as AdtHttpClient;

      const result = await runAtcCheck(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_X');
      expect(result.findings[0]?.uri).toBe('/sap/bc/adt/oo/classes/ZCL_X/source/main#start=42,1');
      expect(result.findings[0]?.line).toBe(42);
    });

    it('returns empty uri and line 0 for finding without URI', async () => {
      const createResp = '<atc:run xmlns:atc="http://www.sap.com/adt/atc" id="42" worklistId="42"/>';
      const resultResp = `<worklist>
        <finding priority="3" checkTitle="Check" messageTitle="General issue"/>
      </worklist>`;
      const http = {
        ...mockHttp(createResp),
        get: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: resultResp }),
      } as unknown as AdtHttpClient;

      const result = await runAtcCheck(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/ZCL_X');
      expect(result.findings[0]?.uri).toBe('');
      expect(result.findings[0]?.line).toBe(0);
    });

    it('parses correctly regardless of attribute order', async () => {
      const createResp = '<atc:run xmlns:atc="http://www.sap.com/adt/atc" id="42" worklistId="42"/>';
      const resultResp = `<worklist>
        <finding messageTitle="Wrong order" priority="2" uri="/sap/bc/adt/programs/programs/ZTEST#start=7,3" checkTitle="Order Check"/>
      </worklist>`;
      const http = {
        ...mockHttp(createResp),
        get: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: resultResp }),
      } as unknown as AdtHttpClient;

      const result = await runAtcCheck(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
      expect(result.findings[0]?.priority).toBe(2);
      expect(result.findings[0]?.checkTitle).toBe('Order Check');
      expect(result.findings[0]?.messageTitle).toBe('Wrong order');
      expect(result.findings[0]?.line).toBe(7);
    });

    it('extracts quickfixInfo and hasQuickfix=true from ATC finding metadata', async () => {
      const createResp = '<atc:run xmlns:atc="http://www.sap.com/adt/atc" id="42" worklistId="42"/>';
      const resultResp = `<worklist>
        <finding priority="1" checkTitle="Check" messageTitle="Issue" quickfixInfo="available" uri="/sap/bc/adt/programs/programs/ZTEST#start=2,1">
          <quickfixes manual="false" automatic="true" pseudo="false"/>
        </finding>
      </worklist>`;
      const http = {
        ...mockHttp(createResp),
        get: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: resultResp }),
      } as unknown as AdtHttpClient;

      const result = await runAtcCheck(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
      expect(result.findings[0]?.quickfixInfo).toBe('available');
      expect(result.findings[0]?.hasQuickfix).toBe(true);
    });

    it('sets hasQuickfix=false when all ATC quickfix flags are false', async () => {
      const createResp = '<atc:run xmlns:atc="http://www.sap.com/adt/atc" id="42" worklistId="42"/>';
      const resultResp = `<worklist>
        <finding priority="1" checkTitle="Check" messageTitle="Issue" uri="/sap/bc/adt/programs/programs/ZTEST#start=2,1">
          <quickfixes manual="false" automatic="false" pseudo="false"/>
        </finding>
      </worklist>`;
      const http = {
        ...mockHttp(createResp),
        get: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: resultResp }),
      } as unknown as AdtHttpClient;

      const result = await runAtcCheck(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
      expect(result.findings[0]?.hasQuickfix).toBe(false);
    });

    it('defaults hasQuickfix to false when quickfix metadata is missing', async () => {
      const createResp = '<atc:run xmlns:atc="http://www.sap.com/adt/atc" id="42" worklistId="42"/>';
      const resultResp = `<worklist>
        <finding priority="1" checkTitle="Check" messageTitle="Issue" uri="/sap/bc/adt/programs/programs/ZTEST#start=2,1"/>
      </worklist>`;
      const http = {
        ...mockHttp(createResp),
        get: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: resultResp }),
      } as unknown as AdtHttpClient;

      const result = await runAtcCheck(http, unrestrictedSafetyConfig(), '/sap/bc/adt/programs/programs/ZTEST');
      expect(result.findings[0]?.hasQuickfix).toBe(false);
    });
  });

  // ─── getCdsTestCases (CDS Test Double Framework, SAP_BASIS 8.16+) ────

  describe('getCdsTestCases', () => {
    it('parses the rich I_CURRENCY fixture (CALCULATION + CAST, calculatedField)', async () => {
      const { readFileSync } = await import('node:fs');
      const fixture = readFileSync(
        new URL('../../fixtures/xml/cds-testcases-i_currency.xml', import.meta.url),
        'utf-8',
      );
      const result = await getCdsTestCases(mockHttp(fixture), unrestrictedSafetyConfig(), 'I_CURRENCY');

      expect(result.cds).toBe('I_CURRENCY');
      expect(result.testCaseCount).toBe(8);
      expect(result.testCases).toHaveLength(8);
      expect(result.testCases[0]).toMatchObject({
        title: 'Calculate ALTERNATIVECURRENCYKEY field',
        testMethod: 'calculate_altcurrkey',
        semanticType: 'CALCULATION',
        calculatedField: 'ALTERNATIVECURRENCYKEY',
      });
      expect(result.testCases[0]?.description).toContain('ALTERNATIVECURRENCYKEY');
      // The live response mixes semantic types — CALCULATION (×3), CAST (×2), JOIN (×3).
      const semanticTypes = new Set(result.testCases.map((tc) => tc.semanticType));
      expect(semanticTypes).toEqual(new Set(['CALCULATION', 'CAST', 'JOIN']));
      // JOIN cases carry an optional conditionScenario (POSITIVE/NEGATIVE) — regression guard
      // for that defensively-parsed field (confirmed live on a4h-2025 / SAP_BASIS 816).
      const joinScenarios = result.testCases
        .filter((tc) => tc.semanticType === 'JOIN')
        .map((tc) => tc.conditionScenario);
      expect(joinScenarios).toContain('POSITIVE');
      expect(joinScenarios).toContain('NEGATIVE');
    });

    it('parses the minimal I_LANGUAGE fixture (single NONE case, no calculatedField)', async () => {
      const { readFileSync } = await import('node:fs');
      const fixture = readFileSync(
        new URL('../../fixtures/xml/cds-testcases-i_language.xml', import.meta.url),
        'utf-8',
      );
      const result = await getCdsTestCases(mockHttp(fixture), unrestrictedSafetyConfig(), 'I_LANGUAGE');

      expect(result.cds).toBe('I_LANGUAGE');
      expect(result.testCaseCount).toBe(1);
      expect(result.testCases[0]).toEqual({
        title: 'Test I_LANGUAGE.',
        testMethod: 'test_cds_view',
        description: 'Test CDS View as a whole.',
        semanticType: 'NONE',
      });
      expect(result.testCases[0]?.calculatedField).toBeUndefined();
    });

    it('GETs the dbtestdoubles endpoint with ddlsourceName + the v1+xml Accept (and url-encodes the name)', async () => {
      const empty =
        '<cdstestcases:root xmlns:cdstestcases="http://www.sap.com/adt/dbtestdoubles/cds/testcases"><cdstestcases:cds>X</cdstestcases:cds><cdstestcases:testCases/></cdstestcases:root>';
      const http = mockHttp(empty);
      await getCdsTestCases(http, unrestrictedSafetyConfig(), '/DMO/I_FLIGHT');
      expect(http.get).toHaveBeenCalledWith(
        '/sap/bc/adt/aunit/dbtestdoubles/cds/testcases?ddlsourceName=%2FDMO%2FI_FLIGHT',
        expect.objectContaining({
          Accept: 'application/vnd.sap.adt.aunit.dbtestdoubles.cds.testcases.v1+xml',
        }),
      );
    });

    it('returns an empty list for a view with no testCases', async () => {
      const empty =
        '<cdstestcases:root xmlns:cdstestcases="http://www.sap.com/adt/dbtestdoubles/cds/testcases"><cdstestcases:cds>I_EMPTY</cdstestcases:cds><cdstestcases:testCases/></cdstestcases:root>';
      const result = await getCdsTestCases(mockHttp(empty), unrestrictedSafetyConfig(), 'I_EMPTY');
      expect(result).toEqual({ cds: 'I_EMPTY', testCaseCount: 0, testCases: [] });
    });
  });

  describe('supportsCdsTestCases', () => {
    it('returns undefined when ADT discovery has not been loaded', () => {
      const http = {
        hasDiscoveryData: () => false,
        discoveryAcceptFor: () => undefined,
      } as unknown as AdtHttpClient;
      expect(supportsCdsTestCases(http)).toBeUndefined();
    });

    it('returns true when discovery advertises the testcases collection (816)', () => {
      const http = {
        hasDiscoveryData: () => true,
        discoveryAcceptFor: (p: string) =>
          p === '/sap/bc/adt/aunit/dbtestdoubles/cds/testcases'
            ? 'application/vnd.sap.adt.aunit.dbtestdoubles.cds.testcases.v1+xml'
            : undefined,
      } as unknown as AdtHttpClient;
      expect(supportsCdsTestCases(http)).toBe(true);
    });

    it('returns false when discovery lacks the testcases collection (758)', () => {
      const http = {
        hasDiscoveryData: () => true,
        discoveryAcceptFor: () => undefined,
      } as unknown as AdtHttpClient;
      expect(supportsCdsTestCases(http)).toBe(false);
    });
  });
});
