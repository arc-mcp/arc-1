import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtSafetyError } from '../../../src/adt/errors.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

const mockFetch = vi.fn();
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: mockFetch };
});

const { AdtClient } = await import('../../../src/adt/client.js');
const { buildPreviewXml, buildExecuteXml, parsePreviewResponse, changePackage } = await import(
  '../../../src/adt/refactoring.js'
);

type ChangePackageParams = import('../../../src/adt/refactoring.js').ChangePackageParams;

const BASE_PARAMS: ChangePackageParams = {
  objectUri: '/sap/bc/adt/ddic/ddl/sources/zarc1_test',
  objectType: 'DDLS/DF',
  objectName: 'ZARC1_TEST',
  oldPackage: '$TMP',
  newPackage: 'Z_TARGET_PKG',
};

describe('refactoring — change package', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: return CSRF token on first call, then success for subsequent calls
    mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));
  });

  describe('buildPreviewXml', () => {
    it('generates wrapped XML with changePackageRefactoring root element', () => {
      const xml = buildPreviewXml(BASE_PARAMS);
      expect(xml).toContain('<changepackage:changePackageRefactoring');
      expect(xml).toContain('xmlns:changepackage="http://www.sap.com/adt/refactoring/changepackagerefactoring"');
      expect(xml).toContain('xmlns:generic="http://www.sap.com/adt/refactoring/genericrefactoring"');
      expect(xml).toContain('xmlns:adtcore="http://www.sap.com/adt/core"');
      expect(xml).toContain('</changepackage:changePackageRefactoring>');
    });

    it('includes oldPackage, newPackage, objectUri, objectType, objectName', () => {
      const xml = buildPreviewXml(BASE_PARAMS);
      expect(xml).toContain('<changepackage:oldPackage>$TMP</changepackage:oldPackage>');
      expect(xml).toContain('<changepackage:newPackage>Z_TARGET_PKG</changepackage:newPackage>');
      expect(xml).toContain('<generic:adtObjectUri>/sap/bc/adt/ddic/ddl/sources/zarc1_test</generic:adtObjectUri>');
      expect(xml).toContain('adtcore:type="DDLS/DF"');
      expect(xml).toContain('adtcore:name="ZARC1_TEST"');
      expect(xml).toContain('<generic:newPackage>Z_TARGET_PKG</generic:newPackage>');
    });

    it('includes transport when provided', () => {
      const xml = buildPreviewXml({ ...BASE_PARAMS, transport: 'A4HK900123' });
      expect(xml).toContain('<generic:transport>A4HK900123</generic:transport>');
    });

    it('has empty transport element when no transport', () => {
      const xml = buildPreviewXml(BASE_PARAMS);
      expect(xml).toContain('<generic:transport></generic:transport>');
    });

    it('includes inner genericRefactoring element', () => {
      const xml = buildPreviewXml(BASE_PARAMS);
      expect(xml).toContain('<generic:genericRefactoring>');
      expect(xml).toContain('<generic:title>Change Package</generic:title>');
      expect(xml).toContain('</generic:genericRefactoring>');
    });

    it('escapes all five XML entities incl. apostrophes in the description (shared escapeXmlAttr)', () => {
      const xml = buildPreviewXml({ ...BASE_PARAMS, description: `O'Brien & <Co> "x"` });
      expect(xml).toContain('adtcore:description="O&apos;Brien &amp; &lt;Co&gt; &quot;x&quot;"');
      // No raw apostrophe survives in the description attribute (the former local escaper omitted it).
      expect(xml).not.toContain("O'Brien");
    });
  });

  describe('buildExecuteXml', () => {
    it('generates unwrapped XML with genericRefactoring root element', () => {
      const xml = buildExecuteXml(BASE_PARAMS);
      expect(xml).toContain('<generic:genericRefactoring');
      expect(xml).toContain('xmlns:generic="http://www.sap.com/adt/refactoring/genericrefactoring"');
      expect(xml).toContain('xmlns:adtcore="http://www.sap.com/adt/core"');
      // Must NOT contain changePackageRefactoring wrapper
      expect(xml).not.toContain('changePackageRefactoring');
      expect(xml).not.toContain('changepackage:');
    });

    it('includes transport when provided', () => {
      const xml = buildExecuteXml({ ...BASE_PARAMS, transport: 'A4HK900456' });
      expect(xml).toContain('<generic:transport>A4HK900456</generic:transport>');
    });

    it('includes affected object with changePackageDelta', () => {
      const xml = buildExecuteXml(BASE_PARAMS);
      expect(xml).toContain('<generic:affectedObject');
      expect(xml).toContain('adtcore:packageName="$TMP"');
      expect(xml).toContain('<generic:changePackageDelta>');
      expect(xml).toContain('<generic:newPackage>Z_TARGET_PKG</generic:newPackage>');
    });
  });

  describe('parsePreviewResponse', () => {
    it('extracts transport from response XML', () => {
      const xml = `<generic:genericRefactoring xmlns:generic="http://www.sap.com/adt/refactoring/genericrefactoring">
        <generic:transport>A4HK900789</generic:transport>
      </generic:genericRefactoring>`;
      expect(parsePreviewResponse(xml)).toEqual({ transport: 'A4HK900789' });
    });

    it('returns undefined transport when element is empty', () => {
      const xml = `<generic:genericRefactoring xmlns:generic="http://www.sap.com/adt/refactoring/genericrefactoring">
        <generic:transport/>
      </generic:genericRefactoring>`;
      expect(parsePreviewResponse(xml)).toEqual({ transport: undefined });
    });

    it('returns undefined transport when element has empty text', () => {
      const xml = `<generic:genericRefactoring xmlns:generic="http://www.sap.com/adt/refactoring/genericrefactoring">
        <generic:transport></generic:transport>
      </generic:genericRefactoring>`;
      expect(parsePreviewResponse(xml)).toEqual({ transport: undefined });
    });
  });

  describe('changePackage', () => {
    function createClient(safety = unrestrictedSafetyConfig()) {
      return new AdtClient({ baseUrl: 'http://sap:8000', username: 'admin', password: 'secret', safety });
    }

    it('calls preview then execute with correct URLs', async () => {
      const calls: Array<{ method: string; url: string }> = [];
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string }) => {
        calls.push({ method: opts?.method ?? 'GET', url: String(url) });
        return Promise.resolve(
          mockResponse(200, '<generic:genericRefactoring><generic:transport/></generic:genericRefactoring>', {
            'x-csrf-token': 'T',
          }),
        );
      });

      await changePackage(createClient().http, unrestrictedSafetyConfig(), BASE_PARAMS);

      const previewCall = calls.find((c) => c.method === 'POST' && c.url.includes('step=preview'));
      expect(previewCall).toBeDefined();
      // rel param gets URL-encoded by the HTTP client
      expect(previewCall?.url).toContain('step=preview');
      expect(previewCall?.url).toContain('rel=');

      const executeCall = calls.find((c) => c.method === 'POST' && c.url.includes('step=execute'));
      expect(executeCall).toBeDefined();
      expect(executeCall?.url).not.toContain('rel=');
    });

    it('uses server-assigned transport from preview when no explicit transport', async () => {
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string }) => {
        calls.push({ method: opts?.method ?? 'GET', url: String(url), body: opts?.body });
        if (String(url).includes('step=preview')) {
          return Promise.resolve(
            mockResponse(
              200,
              '<generic:genericRefactoring><generic:transport>A4HK900999</generic:transport></generic:genericRefactoring>',
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await changePackage(createClient().http, unrestrictedSafetyConfig(), BASE_PARAMS);
      expect(result.transport).toBe('A4HK900999');

      const executeCall = calls.find((c) => c.method === 'POST' && c.url.includes('step=execute'));
      expect(executeCall?.body).toContain('<generic:transport>A4HK900999</generic:transport>');
    });

    it('uses explicit transport even when preview returns different one', async () => {
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      mockFetch.mockReset();
      mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: string }) => {
        calls.push({ method: opts?.method ?? 'GET', url: String(url), body: opts?.body });
        if (String(url).includes('step=preview')) {
          return Promise.resolve(
            mockResponse(
              200,
              '<generic:genericRefactoring><generic:transport>SERVER_TR</generic:transport></generic:genericRefactoring>',
              { 'x-csrf-token': 'T' },
            ),
          );
        }
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'T' }));
      });

      const result = await changePackage(createClient().http, unrestrictedSafetyConfig(), {
        ...BASE_PARAMS,
        transport: 'EXPLICIT_TR',
      });
      expect(result.transport).toBe('EXPLICIT_TR');

      const executeCall = calls.find((c) => c.method === 'POST' && c.url.includes('step=execute'));
      expect(executeCall?.body).toContain('<generic:transport>EXPLICIT_TR</generic:transport>');
    });

    it('throws AdtSafetyError when Update operation is blocked', async () => {
      const readOnlySafety = { ...unrestrictedSafetyConfig(), allowWrites: false };
      await expect(changePackage(createClient(readOnlySafety).http, readOnlySafety, BASE_PARAMS)).rejects.toThrow(
        AdtSafetyError,
      );
    });
  });
});
