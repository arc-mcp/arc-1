import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createTraceRequest,
  decodeHtmlEntities,
  deleteTraceRequest,
  getCdsCreateStatements,
  getDump,
  getGatewayErrorDetail,
  getObjectState,
  getSqlTraceDirectory,
  getSqlTraceState,
  getTraceDbAccesses,
  getTraceHitlist,
  getTraceStatements,
  listDumps,
  listGatewayErrors,
  listSystemMessages,
  listTraceRequests,
  listTraces,
  parseCdsCreateStatements,
  parseDumpDetail,
  parseDumpList,
  parseGatewayErrorDetail,
  parseGatewayErrors,
  parseSapStatistics,
  parseSqlTraceDirectory,
  parseSqlTraceState,
  parseSystemMessages,
  parseTraceDbAccesses,
  parseTraceHitlist,
  parseTraceList,
  parseTraceRequestFeed,
  parseTraceStatements,
  probeODataPerformance,
  setSqlTraceState,
  stripHtmlTags,
  verdictFromStatistics,
} from '../../../src/adt/diagnostics.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';

const FIXTURES_DIR = join(__dirname, '../../fixtures/xml');

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

function mockHttpMulti(responses: Record<string, string>): AdtHttpClient {
  return {
    get: vi.fn().mockImplementation((url: string) => {
      for (const [pattern, body] of Object.entries(responses)) {
        if (url.includes(pattern)) {
          return Promise.resolve({ statusCode: 200, headers: {}, body });
        }
      }
      return Promise.resolve({ statusCode: 200, headers: {}, body: '' });
    }),
    post: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
    put: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
    delete: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
    fetchCsrfToken: vi.fn(),
    withStatefulSession: vi.fn(),
  } as unknown as AdtHttpClient;
}

function mockHttpSequence(
  responses: Array<{ statusCode?: number; headers?: Record<string, string>; body: string } | Error>,
): AdtHttpClient {
  const queue = [...responses];
  return {
    get: vi.fn().mockImplementation(() => {
      const next = queue.shift();
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve({
        statusCode: next?.statusCode ?? 200,
        headers: next?.headers ?? {},
        body: next?.body ?? '',
      });
    }),
    post: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
    put: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
    delete: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
    fetchCsrfToken: vi.fn(),
    withStatefulSession: vi.fn(),
  } as unknown as AdtHttpClient;
}

describe('Runtime Diagnostics', () => {
  // ─── getObjectState ────────────────────────────────────────────────

  describe('getObjectState', () => {
    it('reports matching active and inactive source versions', async () => {
      const http = mockHttpSequence([
        {
          body: 'CLASS zbp_demo DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF zr_demo.\nENDCLASS.',
          headers: { etag: 'a1' },
        },
        {
          body: 'CLASS zbp_demo DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF zr_demo.\nENDCLASS.',
          headers: { etag: 'i1' },
        },
      ]);

      const result = await getObjectState(http, unrestrictedSafetyConfig(), {
        type: 'CLAS',
        name: 'ZBP_DEMO',
        sections: [{ section: 'main', uri: '/sap/bc/adt/oo/classes/ZBP_DEMO/source/main' }],
      });

      expect(result.hasInactiveDivergence).toBe(false);
      expect(result.sections[0]?.active.available).toBe(true);
      expect(result.sections[0]?.active.byteLength).toBeGreaterThan(0);
      expect(result.sections[0]?.active.sha256).toBe(result.sections[0]?.inactive.sha256);
      expect(result.sections[0]?.active.etag).toBe('a1');
      expect(result.sections[0]?.inactive.etag).toBe('i1');
      expect(http.get).toHaveBeenCalledWith('/sap/bc/adt/oo/classes/ZBP_DEMO/source/main?version=active', {
        Accept: 'text/plain, */*;q=0.8',
      });
      expect(http.get).toHaveBeenCalledWith('/sap/bc/adt/oo/classes/ZBP_DEMO/source/main?version=inactive', {
        Accept: 'text/plain, */*;q=0.8',
      });
    });

    it('flags active and inactive source divergence by hash', async () => {
      const http = mockHttpSequence([{ body: 'active source' }, { body: 'inactive source' }]);

      const result = await getObjectState(http, unrestrictedSafetyConfig(), {
        type: 'PROG',
        name: 'ZDEMO',
        sections: [{ section: 'main', uri: '/sap/bc/adt/programs/programs/ZDEMO/source/main' }],
      });

      expect(result.hasInactiveDivergence).toBe(true);
      expect(result.sections[0]?.divergent).toBe(true);
      expect(result.sections[0]?.active.sha256).not.toBe(result.sections[0]?.inactive.sha256);
    });

    it('overwrites an existing version query parameter for each requested source version', async () => {
      const http = mockHttpSequence([{ body: 'active source' }, { body: 'inactive source' }]);

      await getObjectState(http, unrestrictedSafetyConfig(), {
        type: 'PROG',
        name: 'ZDEMO',
        sections: [{ section: 'main', uri: '/sap/bc/adt/programs/programs/ZDEMO/source/main?version=active&foo=bar' }],
      });

      expect(http.get).toHaveBeenCalledWith('/sap/bc/adt/programs/programs/ZDEMO/source/main?version=active&foo=bar', {
        Accept: 'text/plain, */*;q=0.8',
      });
      expect(http.get).toHaveBeenCalledWith(
        '/sap/bc/adt/programs/programs/ZDEMO/source/main?version=inactive&foo=bar',
        {
          Accept: 'text/plain, */*;q=0.8',
        },
      );
    });

    it('reports optional missing include endpoints as unavailable', async () => {
      const notFound = new AdtApiError('Not found', 404, '/sap/bc/adt/oo/classes/ZBP_DEMO/includes/macros');
      const http = mockHttpSequence([notFound, notFound]);

      const result = await getObjectState(http, unrestrictedSafetyConfig(), {
        type: 'CLAS',
        name: 'ZBP_DEMO',
        sections: [{ section: 'macros', uri: '/sap/bc/adt/oo/classes/ZBP_DEMO/includes/macros', optional: true }],
      });

      expect(result.hasInactiveDivergence).toBe(false);
      expect(result.sections[0]?.active).toEqual({ available: false, statusCode: 404 });
      expect(result.sections[0]?.inactive).toEqual({ available: false, statusCode: 404 });
    });

    it('flags divergence when only one optional source version exists', async () => {
      const notFound = new AdtApiError('Not found', 404, '/sap/bc/adt/oo/classes/ZBP_DEMO/includes/testclasses');
      const http = mockHttpSequence([notFound, { body: 'CLASS ltcl_test DEFINITION.' }]);

      const result = await getObjectState(http, unrestrictedSafetyConfig(), {
        type: 'CLAS',
        name: 'ZBP_DEMO',
        sections: [
          { section: 'testclasses', uri: '/sap/bc/adt/oo/classes/ZBP_DEMO/includes/testclasses', optional: true },
        ],
      });

      expect(result.hasInactiveDivergence).toBe(true);
      expect(result.sections[0]?.divergent).toBe(true);
      expect(result.sections[0]?.active.available).toBe(false);
      expect(result.sections[0]?.inactive.available).toBe(true);
    });

    it('rethrows non-404 errors for optional sections', async () => {
      const serverError = new AdtApiError('Server error', 500, '/sap/bc/adt/oo/classes/ZBP_DEMO/includes/definitions');
      const http = mockHttpSequence([serverError, { body: '' }]);

      await expect(
        getObjectState(http, unrestrictedSafetyConfig(), {
          type: 'CLAS',
          name: 'ZBP_DEMO',
          sections: [
            { section: 'definitions', uri: '/sap/bc/adt/oo/classes/ZBP_DEMO/includes/definitions', optional: true },
          ],
        }),
      ).rejects.toThrow(AdtApiError);
    });

    it('is allowed in read-only safety mode', async () => {
      const http = mockHttpSequence([{ body: 'active source' }, { body: 'active source' }]);
      const safety = { ...unrestrictedSafetyConfig(), allowWrites: false };

      await expect(
        getObjectState(http, safety, {
          type: 'PROG',
          name: 'ZDEMO',
          sections: [{ section: 'main', uri: '/sap/bc/adt/programs/programs/ZDEMO/source/main' }],
        }),
      ).resolves.toMatchObject({ hasInactiveDivergence: false });
    });
  });

  // ─── listDumps ──────────────────────────────────────────────────────

  describe('listDumps', () => {
    it('parses dump listing from Atom feed', async () => {
      const xml = readFileSync(join(FIXTURES_DIR, 'dumps-list.xml'), 'utf-8');
      const http = mockHttp(xml);
      const result = await listDumps(http, unrestrictedSafetyConfig());

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: '20260328201914vhcala4hci_A4H_00%20%20%20DEVELOPER%20001%2019',
        timestamp: '2026-03-28T20:19:14Z',
        user: 'DEVELOPER',
        error: 'STRING_OFFSET_TOO_LARGE',
        program: 'SAPLSUSR_CERTRULE',
      });
      expect(result[1]).toEqual({
        id: '20260327150000vhcala4hci_A4H_00%20%20%20ADMIN%20001%2005',
        timestamp: '2026-03-27T15:00:00Z',
        user: 'ADMIN',
        error: 'COMPUTE_INT_ZERODIVIDE',
        program: 'SAPMTEST',
      });
    });

    it('sends correct Accept header', async () => {
      const http = mockHttp('<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"></atom:feed>');
      await listDumps(http, unrestrictedSafetyConfig());
      expect(http.get).toHaveBeenCalledWith('/sap/bc/adt/runtime/dumps?$top=50', {
        Accept: 'application/atom+xml;type=feed',
      });
    });

    it('passes user filter as query parameter', async () => {
      const http = mockHttp('<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"></atom:feed>');
      await listDumps(http, unrestrictedSafetyConfig(), { user: 'DEVELOPER' });
      expect(http.get).toHaveBeenCalledWith(expect.stringContaining('$query='), expect.any(Object));
      const url = (http.get as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      // The comma is URL-encoded by encodeURIComponent
      expect(url).toContain('equals(user%2CDEVELOPER)');
    });

    it('passes maxResults as $top parameter', async () => {
      const http = mockHttp('<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"></atom:feed>');
      await listDumps(http, unrestrictedSafetyConfig(), { maxResults: 10 });
      const url = (http.get as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain('$top=10');
    });

    it('clamps maxResults to safe bounds', async () => {
      const http = mockHttp('<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"></atom:feed>');
      await listDumps(http, unrestrictedSafetyConfig(), { maxResults: 9999 });
      const highUrl = (http.get as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(highUrl).toContain('$top=200');

      await listDumps(http, unrestrictedSafetyConfig(), { maxResults: 0 });
      const lowUrl = (http.get as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
      expect(lowUrl).toContain('$top=1');
    });

    it('returns empty array for empty feed', async () => {
      const xml = '<?xml version="1.0"?><atom:feed xmlns:atom="http://www.w3.org/2005/Atom"></atom:feed>';
      const http = mockHttp(xml);
      const result = await listDumps(http, unrestrictedSafetyConfig());
      expect(result).toEqual([]);
    });

    it('is blocked in read-only mode (dumps are read operations, should work)', async () => {
      const http = mockHttp('<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"></atom:feed>');
      const safety = { ...unrestrictedSafetyConfig(), allowWrites: false };
      // Read operations should NOT be blocked in read-only mode
      await expect(listDumps(http, safety)).resolves.toBeDefined();
    });
  });

  // ─── getDump ────────────────────────────────────────────────────────

  describe('getDump', () => {
    it('fetches XML metadata and formatted text in parallel', async () => {
      const xmlDetail = readFileSync(join(FIXTURES_DIR, 'dump-detail.xml'), 'utf-8');
      const formattedText = readFileSync(join(FIXTURES_DIR, 'dump-formatted.txt'), 'utf-8');
      const http = mockHttpMulti({
        formatted: formattedText,
        'runtime/dump/TEST_ID': xmlDetail,
      });

      const result = await getDump(http, unrestrictedSafetyConfig(), 'TEST_ID');

      expect(result.error).toBe('STRING_OFFSET_TOO_LARGE');
      expect(result.exception).toBe('CX_SY_RANGE_OUT_OF_BOUNDS');
      expect(result.program).toBe('SAPLSUSR_CERTRULE');
      expect(result.user).toBe('DEVELOPER');
      expect(result.timestamp).toBe('2026-03-28T20:19:14Z');
      expect(result.formattedText).toContain('STRING_OFFSET_TOO_LARGE');
      expect(result.terminationUri).toContain('lsusr_certrulef01');
      expect(result.chapters.length).toBeGreaterThan(0);
    });

    it('parses chapters correctly', async () => {
      const xmlDetail = readFileSync(join(FIXTURES_DIR, 'dump-detail.xml'), 'utf-8');
      const http = mockHttpMulti({
        formatted: 'test content',
        'runtime/dump/TEST_ID': xmlDetail,
      });

      const result = await getDump(http, unrestrictedSafetyConfig(), 'TEST_ID');

      expect(result.chapters).toContainEqual({
        name: 'kap0',
        title: 'Short Text',
        category: 'ABAP Developer View',
        line: 11,
        chapterOrder: 1,
        categoryOrder: 3,
      });
      expect(result.chapters).toContainEqual({
        name: 'kap1',
        title: 'What happened?',
        category: 'User View',
        line: 16,
        chapterOrder: 2,
        categoryOrder: 2,
      });
    });

    it('makes two parallel GET requests with correct Accept headers', async () => {
      const http = mockHttp('');
      try {
        await getDump(http, unrestrictedSafetyConfig(), 'DUMP_123');
      } catch {
        // May fail on parsing empty response, that's ok
      }
      expect(http.get).toHaveBeenCalledTimes(2);
      const calls = (http.get as ReturnType<typeof vi.fn>).mock.calls;
      // XML metadata request
      expect(calls).toContainEqual([
        '/sap/bc/adt/runtime/dump/DUMP_123',
        { Accept: 'application/vnd.sap.adt.runtime.dump.v1+xml' },
      ]);
      // Formatted text request
      expect(calls).toContainEqual(['/sap/bc/adt/runtime/dump/DUMP_123/formatted', { Accept: 'text/plain' }]);
    });

    it('passes already-encoded dump IDs through unchanged', async () => {
      // The listing endpoint emits IDs of the form "{timestamp}{server}%20%20%20{user}%20{client}%20{seq}".
      // Re-encoding would double-encode the %20 to %2520 and break the lookup.
      const encodedId = '20260101120000app01_SYS_00%20%20%20DEVUSER%20100%2042';
      const http = mockHttp('');
      try {
        await getDump(http, unrestrictedSafetyConfig(), encodedId);
      } catch {
        // empty response → parse failure, irrelevant for this assertion
      }
      const urls = (http.get as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0] as string);
      expect(urls).toContain(`/sap/bc/adt/runtime/dump/${encodedId}`);
      expect(urls).toContain(`/sap/bc/adt/runtime/dump/${encodedId}/formatted`);
      // Defensive: nothing got double-encoded.
      expect(urls.some((url) => url.includes('%2520'))).toBe(false);
    });

    it('encodes raw dump IDs that contain literal whitespace', async () => {
      // Caller copy/pasted from ST22: literal spaces, no percent encoding yet.
      const rawId = '20260101120000app01_SYS_00   DEVUSER 100 42';
      const http = mockHttp('');
      try {
        await getDump(http, unrestrictedSafetyConfig(), rawId);
      } catch {
        // empty response → parse failure, irrelevant for this assertion
      }
      const urls = (http.get as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0] as string);
      // Spaces must be percent-encoded; underscores stay literal.
      const encoded = '20260101120000app01_SYS_00%20%20%20DEVUSER%20100%2042';
      expect(urls).toContain(`/sap/bc/adt/runtime/dump/${encoded}`);
      expect(urls).toContain(`/sap/bc/adt/runtime/dump/${encoded}/formatted`);
      // No literal space leaked into the path.
      expect(urls.some((url) => url.includes(' '))).toBe(false);
    });

    it('returns the original dump ID in the parsed detail (round-trip)', async () => {
      // Even when we re-encode for the HTTP path, the response payload should
      // surface the ID exactly as the caller passed it — otherwise downstream
      // round-trips (e.g. saving an ID for follow-up) break.
      const xmlDetail = readFileSync(join(FIXTURES_DIR, 'dump-detail.xml'), 'utf-8');
      const formattedText = readFileSync(join(FIXTURES_DIR, 'dump-formatted.txt'), 'utf-8');
      const http = mockHttpMulti({
        formatted: formattedText,
        'runtime/dump/': xmlDetail,
      });
      const rawId = 'literal id with spaces';
      const result = await getDump(http, unrestrictedSafetyConfig(), rawId);
      expect(result.id).toBe(rawId);
    });

    it('trims surrounding whitespace before encoding', async () => {
      const http = mockHttp('');
      try {
        await getDump(http, unrestrictedSafetyConfig(), '  DUMP_42  ');
      } catch {
        // ignore parse failure
      }
      const urls = (http.get as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0] as string);
      // Whitespace would otherwise become %20%20 prefix/suffix and cause a 404.
      expect(urls).toContain('/sap/bc/adt/runtime/dump/DUMP_42');
      expect(urls).toContain('/sap/bc/adt/runtime/dump/DUMP_42/formatted');
    });
  });

  // ─── parseDumpList ──────────────────────────────────────────────────

  describe('parseDumpList', () => {
    it('handles single entry feed', () => {
      const xml = `<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
        <atom:entry xml:lang="EN">
          <atom:author><atom:name>TESTUSER</atom:name></atom:author>
          <atom:category term="MESSAGE_TYPE_X" label="ABAP runtime error"/>
          <atom:category term="ZTEST_PROG" label="Terminated ABAP program"/>
          <atom:link href="adt://SYS/sap/bc/adt/runtime/dump/DUMP_001" rel="self" type="text/plain"/>
          <atom:published>2026-04-01T10:00:00Z</atom:published>
        </atom:entry>
      </atom:feed>`;

      const result = parseDumpList(xml);
      expect(result).toHaveLength(1);
      expect(result[0]!.user).toBe('TESTUSER');
      expect(result[0]!.error).toBe('MESSAGE_TYPE_X');
      expect(result[0]!.program).toBe('ZTEST_PROG');
      expect(result[0]!.id).toBe('DUMP_001');
    });

    it('extracts dump ID from atom:id when self link is missing', () => {
      const xml = `<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
        <atom:entry>
          <atom:author><atom:name>USER</atom:name></atom:author>
          <atom:category term="MESSAGE_TYPE_X" label="Laufzeitfehler"/>
          <atom:category term="ZTEST_PROG" label="Beendetes ABAP-Programm"/>
          <atom:id>/sap/bc/adt/vit/runtime/dumps/DUMP_FROM_ATOM_ID</atom:id>
          <atom:published>2026-04-01T10:00:00Z</atom:published>
        </atom:entry>
      </atom:feed>`;

      const result = parseDumpList(xml);
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('DUMP_FROM_ATOM_ID');
      // Localized labels should still map by category order fallback.
      expect(result[0]!.error).toBe('MESSAGE_TYPE_X');
      expect(result[0]!.program).toBe('ZTEST_PROG');
    });

    it('handles empty feed', () => {
      const xml = '<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"></atom:feed>';
      expect(parseDumpList(xml)).toEqual([]);
    });

    it('handles URL-encoded dump IDs', () => {
      const xml = `<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
        <atom:entry>
          <atom:author><atom:name>USER</atom:name></atom:author>
          <atom:category term="ERROR" label="ABAP runtime error"/>
          <atom:category term="PROG" label="Terminated ABAP program"/>
          <atom:link href="/sap/bc/adt/runtime/dump/20260328%20%20ID%20WITH%20SPACES" rel="self" type="text/plain"/>
          <atom:published>2026-03-28T00:00:00Z</atom:published>
        </atom:entry>
      </atom:feed>`;

      const result = parseDumpList(xml);
      expect(result[0]!.id).toBe('20260328%20%20ID%20WITH%20SPACES');
    });

    it('ignores entries without any extractable dump ID', () => {
      const xml = `<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
        <atom:entry>
          <atom:author><atom:name>USER</atom:name></atom:author>
          <atom:category term="ERROR" label="ABAP runtime error"/>
          <atom:category term="PROG" label="Terminated ABAP program"/>
          <atom:id>UNRELATED_ENTRY_ID</atom:id>
        </atom:entry>
      </atom:feed>`;
      expect(parseDumpList(xml)).toEqual([]);
    });
  });

  // ─── parseDumpDetail ────────────────────────────────────────────────

  describe('parseDumpDetail', () => {
    it('extracts all metadata from XML', () => {
      const xml = readFileSync(join(FIXTURES_DIR, 'dump-detail.xml'), 'utf-8');
      const result = parseDumpDetail(xml, 'formatted content', 'TEST_ID');

      expect(result.id).toBe('TEST_ID');
      expect(result.error).toBe('STRING_OFFSET_TOO_LARGE');
      expect(result.exception).toBe('CX_SY_RANGE_OUT_OF_BOUNDS');
      expect(result.program).toBe('SAPLSUSR_CERTRULE');
      expect(result.user).toBe('DEVELOPER');
      expect(result.formattedText).toBe('formatted content');
    });

    it('extracts termination URI', () => {
      const xml = readFileSync(join(FIXTURES_DIR, 'dump-detail.xml'), 'utf-8');
      const result = parseDumpDetail(xml, '', 'ID');
      expect(result.terminationUri).toContain('lsusr_certrulef01');
      expect(result.terminationUri).toContain('#start=27');
    });

    it('extracts chapters', () => {
      const xml = readFileSync(join(FIXTURES_DIR, 'dump-detail.xml'), 'utf-8');
      const result = parseDumpDetail(xml, '', 'ID');
      expect(result.chapters).toHaveLength(6);
      expect(result.chapters[0]).toEqual({
        name: 'kap0',
        title: 'Short Text',
        category: 'ABAP Developer View',
        line: 11,
        chapterOrder: 1,
        categoryOrder: 3,
      });
    });

    it('splits formatted dump text into chapter sections', () => {
      const xml = `<?xml version="1.0"?>
<dump:dump xmlns:dump="http://www.sap.com/adt/categories/dump" error="ERR" author="USR" exception="CX" terminatedProgram="ZPROG" datetime="2026-01-01T00:00:00Z">
  <dump:chapters>
    <dump:chapter name="kap0" title="Short Text" category="ABAP Developer View" line="1" chapterOrder="1" categoryOrder="1"/>
    <dump:chapter name="kap1" title="What happened?" category="User View" line="4" chapterOrder="2" categoryOrder="1"/>
    <dump:chapter name="kap3" title="Error analysis" category="ABAP Developer View" line="7" chapterOrder="3" categoryOrder="1"/>
  </dump:chapters>
</dump:dump>`;
      const formatted = ['Short Text', 'S1', '', 'What happened?', 'W1', '', 'Error analysis', 'E1'].join('\n');
      const result = parseDumpDetail(xml, formatted, 'ID');

      expect(result.sections.kap0).toContain('Short Text');
      expect(result.sections.kap1).toContain('What happened?');
      expect(result.sections.kap3).toContain('Error analysis');
    });

    it('normalizes wrapped backslash lines in source/code-stack sections', () => {
      const xml = `<?xml version="1.0"?>
<dump:dump xmlns:dump="http://www.sap.com/adt/categories/dump" error="ERR" author="USR" exception="CX" terminatedProgram="ZPROG" datetime="2026-01-01T00:00:00Z">
  <dump:chapters>
    <dump:chapter name="kap8" title="Source Code Extract" category="ABAP Developer View" line="1" chapterOrder="1" categoryOrder="1"/>
    <dump:chapter name="kap9" title="End" category="ABAP Developer View" line="4" chapterOrder="2" categoryOrder="1"/>
  </dump:chapters>
</dump:dump>`;
      const formatted = ['Line A with wrap\\', '  continued', 'Line B', 'END'].join('\n');
      const result = parseDumpDetail(xml, formatted, 'ID');

      expect(result.sections.kap8).toContain('Line A with wrapcontinued');
      expect(result.sections.kap8).not.toContain('wrap\\\n');
    });
  });

  // ─── System Messages ───────────────────────────────────────────────

  describe('listSystemMessages', () => {
    it('calls system messages endpoint with default limit', async () => {
      const http = mockHttp('<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"></atom:feed>');
      await listSystemMessages(http, unrestrictedSafetyConfig());
      expect(http.get).toHaveBeenCalledWith('/sap/bc/adt/runtime/systemmessages?$top=50', {
        Accept: 'application/atom+xml;type=feed',
      });
    });

    it('passes user filter and maxResults', async () => {
      const http = mockHttp('<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"></atom:feed>');
      await listSystemMessages(http, unrestrictedSafetyConfig(), { user: 'DEVELOPER', maxResults: 7 });
      const url = (http.get as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain('$top=7');
      expect(url).toContain('$query=');
      expect(url).toContain('equals(user%2CDEVELOPER)');
    });
  });

  describe('parseSystemMessages', () => {
    it('parses system message feed entries', () => {
      const xml = `<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
        <atom:entry validFrom="2026-04-01T10:00:00Z" validTo="2026-04-01T12:00:00Z">
          <atom:id>MSG_001</atom:id>
          <atom:title>Maintenance window</atom:title>
          <atom:updated>2026-04-01T10:00:00Z</atom:updated>
          <atom:author><atom:name>BASISADM</atom:name></atom:author>
          <atom:summary>System restart planned.</atom:summary>
          <atom:category term="WARN"/>
          <atom:link rel="self" href="/sap/bc/adt/runtime/systemmessages/MSG_001"/>
        </atom:entry>
      </atom:feed>`;

      const result = parseSystemMessages(xml);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'MSG_001',
        title: 'Maintenance window',
        text: 'System restart planned.',
        severity: 'WARN',
        validFrom: '2026-04-01T10:00:00Z',
        validTo: '2026-04-01T12:00:00Z',
        createdBy: 'BASISADM',
        timestamp: '2026-04-01T10:00:00Z',
        detailUrl: '/sap/bc/adt/runtime/systemmessages/MSG_001',
      });
    });
  });

  // ─── Gateway Error Log ─────────────────────────────────────────────

  describe('listGatewayErrors', () => {
    it('calls gateway error log endpoint with default limit', async () => {
      const http = mockHttp('<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"></atom:feed>');
      await listGatewayErrors(http, unrestrictedSafetyConfig());
      expect(http.get).toHaveBeenCalledWith('/sap/bc/adt/gw/errorlog?$top=50', {
        Accept: 'application/atom+xml;type=feed',
      });
    });

    it('uses username filter in query expression', async () => {
      const http = mockHttp('<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"></atom:feed>');
      await listGatewayErrors(http, unrestrictedSafetyConfig(), { user: 'ADMIN' });
      const url = (http.get as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain('equals(username%2CADMIN)');
    });
  });

  describe('getGatewayErrorDetail', () => {
    it('loads detail by explicit detail URL', async () => {
      const xml = `<errorlog:errorEntry xmlns:errorlog="http://www.sap.com/adt/gateway/errorlog"/>`;
      const http = mockHttp(xml);
      await getGatewayErrorDetail(http, unrestrictedSafetyConfig(), {
        detailUrl: '/sap/bc/adt/gw/errorlog/Frontend%20Error/ABC123',
      });
      expect(http.get).toHaveBeenCalledWith('/sap/bc/adt/gw/errorlog/Frontend%20Error/ABC123', {
        Accept: 'text/html, application/xhtml+xml, application/xml;q=0.5',
      });
    });

    it('builds detail URL from errorType + id (normalizes display form "Frontend Error" to URL form "FrontendError")', async () => {
      const xml = `<errorlog:errorEntry xmlns:errorlog="http://www.sap.com/adt/gateway/errorlog"/>`;
      const http = mockHttp(xml);
      await getGatewayErrorDetail(http, unrestrictedSafetyConfig(), { id: 'ABC123', errorType: 'Frontend Error' });
      // SAP URL paths require the compact "FrontendError" form, not "Frontend%20Error".
      expect(http.get).toHaveBeenCalledWith('/sap/bc/adt/gw/errorlog/FrontendError/ABC123', {
        Accept: 'text/html, application/xhtml+xml, application/xml;q=0.5',
      });
    });

    it('builds detail URL when errorType is already in compact form', async () => {
      const xml = `<errorlog:errorEntry xmlns:errorlog="http://www.sap.com/adt/gateway/errorlog"/>`;
      const http = mockHttp(xml);
      await getGatewayErrorDetail(http, unrestrictedSafetyConfig(), { id: 'ABC123', errorType: 'FrontendError' });
      expect(http.get).toHaveBeenCalledWith('/sap/bc/adt/gw/errorlog/FrontendError/ABC123', {
        Accept: 'text/html, application/xhtml+xml, application/xml;q=0.5',
      });
    });

    it('builds detail URL from bare atom:id form "FrontendError/TXID"', async () => {
      const xml = `<errorlog:errorEntry xmlns:errorlog="http://www.sap.com/adt/gateway/errorlog"/>`;
      const http = mockHttp(xml);
      await getGatewayErrorDetail(http, unrestrictedSafetyConfig(), {
        id: 'FrontendError/1E81ABCDEF0123456789',
      });
      expect(http.get).toHaveBeenCalledWith('/sap/bc/adt/gw/errorlog/FrontendError/1E81ABCDEF0123456789', {
        Accept: 'text/html, application/xhtml+xml, application/xml;q=0.5',
      });
    });

    it('does not double-encode percent-encoded atom:id segments', async () => {
      const xml = `<errorlog:errorEntry xmlns:errorlog="http://www.sap.com/adt/gateway/errorlog"/>`;
      const http = mockHttp(xml);
      await getGatewayErrorDetail(http, unrestrictedSafetyConfig(), {
        id: 'Frontend%20Error/1E81ABCDEF0123456789',
      });
      expect(http.get).toHaveBeenCalledWith('/sap/bc/adt/gw/errorlog/Frontend%20Error/1E81ABCDEF0123456789', {
        Accept: 'text/html, application/xhtml+xml, application/xml;q=0.5',
      });
    });
  });

  describe('parseGatewayErrors', () => {
    it('parses gateway feed entries', () => {
      const xml = `<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
        <atom:entry>
          <atom:id>/sap/bc/adt/gw/errorlog/Frontend%20Error/66BF65D1A9DD1FD18D97D52042DF3925</atom:id>
          <atom:title>Request failed</atom:title>
          <atom:updated>2026-04-01T10:00:00Z</atom:updated>
          <atom:author><atom:name>DEVELOPER</atom:name></atom:author>
          <atom:category term="Frontend Error"/>
          <atom:link rel="self" href="/sap/bc/adt/gw/errorlog/Frontend%20Error/66BF65D1A9DD1FD18D97D52042DF3925"/>
        </atom:entry>
      </atom:feed>`;

      const result = parseGatewayErrors(xml);
      expect(result).toHaveLength(1);
      expect(result[0]?.type).toBe('Frontend Error');
      expect(result[0]?.shortText).toBe('Request failed');
      expect(result[0]?.transactionId).toBe('66BF65D1A9DD1FD18D97D52042DF3925');
      expect(result[0]?.detailUrl).toContain('/sap/bc/adt/gw/errorlog/Frontend%20Error/');
    });

    it('parses real SAP feed with bare atom:id (no category/self link)', () => {
      // Real NetWeaver response: atom:id is bare "{ErrorType}/{TransactionId}",
      // no atom:category, no atom:link rel="self", title has "Type: text" format,
      // and summary is an HTML fragment with header cells.
      const xml = `<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
        <atom:entry>
          <atom:id>FrontendError/1E81ABCDEF0123456789</atom:id>
          <atom:title>Frontend Error: Communication failure</atom:title>
          <atom:updated>2026-04-10T08:45:12Z</atom:updated>
          <atom:author><atom:name>DEVELOPER</atom:name></atom:author>
          <atom:summary type="html">&lt;table&gt;&lt;tr&gt;&lt;td&gt;&lt;b&gt;Type&lt;/b&gt;&lt;/td&gt;&lt;td&gt;Frontend Error&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;</atom:summary>
        </atom:entry>
      </atom:feed>`;

      const result = parseGatewayErrors(xml);
      expect(result).toHaveLength(1);
      expect(result[0]?.type).toBe('Frontend Error');
      expect(result[0]?.shortText).toBe('Communication failure');
      expect(result[0]?.transactionId).toBe('1E81ABCDEF0123456789');
      expect(result[0]?.detailUrl).toBe('/sap/bc/adt/gw/errorlog/FrontendError/1E81ABCDEF0123456789');
      expect(result[0]?.username).toBe('DEVELOPER');
    });

    it('decodes encoded atom:id segments before deriving detail URL', () => {
      const xml = `<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
        <atom:entry>
          <atom:id>/sap/bc/adt/gw/errorlog/Frontend%20Error/1E81ABCDEF0123456789</atom:id>
          <atom:title>Frontend Error: Communication failure</atom:title>
          <atom:updated>2026-04-10T08:45:12Z</atom:updated>
          <atom:author><atom:name>DEVELOPER</atom:name></atom:author>
        </atom:entry>
      </atom:feed>`;

      const result = parseGatewayErrors(xml);
      expect(result).toHaveLength(1);
      expect(result[0]?.type).toBe('Frontend Error');
      expect(result[0]?.detailUrl).toBe('/sap/bc/adt/gw/errorlog/Frontend%20Error/1E81ABCDEF0123456789');
    });
  });

  describe('parseGatewayErrorDetail', () => {
    it('parses gateway error detail with source and call stack', () => {
      const xml = `<?xml version="1.0"?>
<errorlog:errorEntry xmlns:errorlog="http://www.sap.com/adt/gateway/errorlog" type="Frontend Error">
  <errorlog:shortText>Request failed</errorlog:shortText>
  <errorlog:transactionId>ABC123</errorlog:transactionId>
  <errorlog:dateTime>2026-04-01T10:00:00Z</errorlog:dateTime>
  <errorlog:username>DEVELOPER</errorlog:username>
  <errorlog:serviceInfo namespace="/SAP/" serviceName="Z_SRV" serviceVersion="0001"/>
  <errorlog:errorContext>
    <errorlog:errorInfo>Gateway runtime error</errorlog:errorInfo>
    <errorlog:exceptions>
      <errorlog:exception type="CX_ROOT" raiseLocation="ZCL_X=>RUN">Root exception</errorlog:exception>
    </errorlog:exceptions>
  </errorlog:errorContext>
  <errorlog:sourceCode errorLine="2">
    <errorlog:line number="1">line 1</errorlog:line>
    <errorlog:line number="2" isError="true">line 2</errorlog:line>
  </errorlog:sourceCode>
  <errorlog:callStack>
    <errorlog:entry number="1" event="METHOD" program="ZCL_X" name="RUN" line="2"/>
  </errorlog:callStack>
</errorlog:errorEntry>`;

      const result = parseGatewayErrorDetail(xml);
      expect(result.type).toBe('Frontend Error');
      expect(result.transactionId).toBe('ABC123');
      expect(result.serviceInfo.serviceName).toBe('Z_SRV');
      expect(result.errorContext.exceptions[0]).toEqual({
        type: 'CX_ROOT',
        text: 'Root exception',
        raiseLocation: 'ZCL_X=>RUN',
      });
      expect(result.sourceCode.errorLine).toBe(2);
      expect(result.sourceCode.lines[1]).toEqual({
        number: 2,
        content: 'line 2',
        isError: true,
      });
      expect(result.callStack[0]).toEqual({
        number: 1,
        event: 'METHOD',
        program: 'ZCL_X',
        name: 'RUN',
        line: 2,
      });
    });

    it('parses real SAP HTML fragment detail payload', () => {
      // Real NetWeaver /sap/bc/adt/gw/errorlog/{Type}/{Tx} returns HTML, not XML.
      // Mimics the real NetWeaver /sap/bc/adt/gw/errorlog/{Type}/{Tx} payload:
      // HTML fragment with <h4 id="HEADER|SERVICE|CONTEXT|SOURCE|STACK"> markers and
      // label/value rows where the label is wrapped in <b>...</b> inside a <td>.
      const html = `<h4 id="HEADER">Error Header</h4>
<table>
  <tr><td><b>Type</b></td><td>Frontend Error</td></tr>
  <tr><td><b>Short Text</b></td><td>Communication failure</td></tr>
  <tr><td><b>Transaction ID</b></td><td>1E81ABCDEF0123456789</td></tr>
  <tr><td><b>Date/Time</b></td><td>2026-04-10 08:45:12</td></tr>
  <tr><td><b>Username</b></td><td>DEVELOPER</td></tr>
  <tr><td><b>Client</b></td><td>100</td></tr>
</table>
<h4 id="SERVICE">Service</h4>
<table>
  <tr><td><b>Service Namespace</b></td><td>/SAP/</td></tr>
  <tr><td><b>Service Name</b></td><td>Z_SRV</td></tr>
  <tr><td><b>Service Version</b></td><td>0001</td></tr>
</table>
<h4 id="CONTEXT">Error Context</h4>
<table>
  <tr><td><b>ERROR_INFO</b></td><td>Gateway runtime failure detected</td></tr>
</table>
<h4 id="STACK">Call Stack</h4>`;

      const result = parseGatewayErrorDetail(html);
      expect(result.type).toBe('Frontend Error');
      expect(result.shortText).toBe('Communication failure');
      expect(result.transactionId).toBe('1E81ABCDEF0123456789');
      expect(result.username).toBe('DEVELOPER');
      expect(result.client).toBe('100');
      expect(result.serviceInfo.serviceName).toBe('Z_SRV');
      expect(result.serviceInfo.serviceVersion).toBe('0001');
      expect(result.serviceInfo.namespace).toBe('/SAP/');
      expect(result.errorContext.errorInfo).toContain('Gateway runtime failure detected');
    });
  });

  // ─── listTraces ─────────────────────────────────────────────────────

  describe('listTraces', () => {
    it('returns empty array for empty feed', async () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?><atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
        <atom:title>ABAP Traces in A4H</atom:title>
        <atom:updated>2026-04-01T20:31:12Z</atom:updated>
      </atom:feed>`;
      const http = mockHttp(xml);
      const result = await listTraces(http, unrestrictedSafetyConfig());
      expect(result).toEqual([]);
    });

    it('sends correct Accept header', async () => {
      const http = mockHttp('<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"></atom:feed>');
      await listTraces(http, unrestrictedSafetyConfig());
      expect(http.get).toHaveBeenCalledWith('/sap/bc/adt/runtime/traces/abaptraces', {
        Accept: 'application/atom+xml;type=feed',
      });
    });

    it('parses trace entries', async () => {
      const xml = `<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
        <atom:entry>
          <atom:title>Trace for ZTEST</atom:title>
          <atom:link href="/sap/bc/adt/runtime/traces/abaptraces/TRACE_001" rel="self"/>
          <atom:updated>2026-04-01T10:00:00Z</atom:updated>
        </atom:entry>
      </atom:feed>`;
      const http = mockHttp(xml);
      const result = await listTraces(http, unrestrictedSafetyConfig());
      expect(result).toHaveLength(1);
      expect(result[0]!.title).toBe('Trace for ZTEST');
      expect(result[0]!.id).toBe('TRACE_001');
    });
  });

  // ─── parseTraceList ─────────────────────────────────────────────────

  describe('parseTraceList', () => {
    it('handles empty feed', () => {
      const xml = '<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"></atom:feed>';
      expect(parseTraceList(xml)).toEqual([]);
    });

    it('parses trace entries with extended data', () => {
      const xml = `<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
        <atom:entry trc:state="completed" trc:objectName="ZTEST_PROG" trc:runtime="12345" xmlns:trc="http://www.sap.com/adt/runtime/traces/abaptraces">
          <atom:title>Trace run</atom:title>
          <atom:link href="/sap/bc/adt/runtime/traces/abaptraces/TR_001" rel="self"/>
          <atom:updated>2026-04-01T12:00:00Z</atom:updated>
        </atom:entry>
      </atom:feed>`;
      const result = parseTraceList(xml);
      expect(result).toHaveLength(1);
      expect(result[0]!.state).toBe('completed');
      expect(result[0]!.objectName).toBe('ZTEST_PROG');
      expect(result[0]!.runtime).toBe(12345);
    });
  });

  // ─── Trace analysis parsers ─────────────────────────────────────────

  describe('parseTraceHitlist', () => {
    it('parses hitlist entries', () => {
      const xml = `<hitList>
        <hitListEntry callingProgram="CL_TEST=>METHOD1" calledProgram="CL_HELPER=>DO_WORK" hitCount="42" grossTime="5000" traceEventNetTime="3000"/>
        <hitListEntry callingProgram="CL_HELPER=>DO_WORK" calledProgram="CL_DB=>SELECT" hitCount="10" grossTime="2000" traceEventNetTime="1500"/>
      </hitList>`;
      const result = parseTraceHitlist(xml);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        callingProgram: 'CL_TEST=>METHOD1',
        calledProgram: 'CL_HELPER=>DO_WORK',
        hitCount: 42,
        grossTime: 5000,
        netTime: 3000,
      });
    });

    it('returns empty for no entries', () => {
      expect(parseTraceHitlist('<hitList/>')).toEqual([]);
    });

    it('parses attributes in non-standard order', () => {
      const xml = `<hitList>
        <hitListEntry hitCount="7" calledProgram="CL_B=>RUN" grossTime="900" callingProgram="CL_A=>EXEC" traceEventNetTime="400"/>
      </hitList>`;
      const result = parseTraceHitlist(xml);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        callingProgram: 'CL_A=>EXEC',
        calledProgram: 'CL_B=>RUN',
        hitCount: 7,
        grossTime: 900,
        netTime: 400,
      });
    });
  });

  describe('parseTraceStatements', () => {
    it('parses statement entries', () => {
      const xml = `<statements>
        <traceStatement callLevel="0" hitCount="1" isProceduralUnit="true" grossTime="10000" description="CL_TEST=>MAIN"/>
        <traceStatement callLevel="1" hitCount="5" isProceduralUnit="false" grossTime="500" description="SELECT"/>
      </statements>`;
      const result = parseTraceStatements(xml);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        callLevel: 0,
        hitCount: 1,
        isProceduralUnit: true,
        grossTime: 10000,
        description: 'CL_TEST=>MAIN',
      });
      expect(result[1]!.isProceduralUnit).toBe(false);
    });

    it('returns empty for no entries', () => {
      expect(parseTraceStatements('<statements/>')).toEqual([]);
    });
  });

  describe('parseTraceDbAccesses', () => {
    it('parses DB access entries', () => {
      const xml = `<dbAccesses>
        <dbAccess tableName="MARA" statement="SELECT" type="OpenSQL" totalCount="100" bufferedCount="95" accessTime="2500"/>
        <dbAccess tableName="VBAK" statement="SELECT" type="OpenSQL" totalCount="50" bufferedCount="0" accessTime="8000"/>
      </dbAccesses>`;
      const result = parseTraceDbAccesses(xml);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        tableName: 'MARA',
        statement: 'SELECT',
        type: 'OpenSQL',
        totalCount: 100,
        bufferedCount: 95,
        accessTime: 2500,
      });
    });

    it('returns empty for no entries', () => {
      expect(parseTraceDbAccesses('<dbAccesses/>')).toEqual([]);
    });

    it('handles > inside attribute values (ABAP method names)', () => {
      const xml = `<dbAccesses>
        <dbAccess tableName="MARA" statement="SELECT" type="OpenSQL" description="CL_TEST=>MAIN" totalCount="10" bufferedCount="5" accessTime="100"/>
      </dbAccesses>`;
      const result = parseTraceDbAccesses(xml);
      expect(result).toHaveLength(1);
      expect(result[0]!.tableName).toBe('MARA');
      expect(result[0]!.totalCount).toBe(10);
    });
  });

  // ─── Trace analysis functions ────────────────────────────────────────

  describe('getTraceHitlist', () => {
    it('calls correct endpoint', async () => {
      const http = mockHttp('<hitList/>');
      await getTraceHitlist(http, unrestrictedSafetyConfig(), 'TRACE_001');
      expect(http.get).toHaveBeenCalledWith('/sap/bc/adt/runtime/traces/abaptraces/TRACE_001/hitlist', {
        Accept: 'application/xml',
      });
    });

    it('encodes raw trace IDs as one path segment', async () => {
      const http = mockHttp('<hitList/>');
      const rawId = 'TRACE 001/../../secret';
      await getTraceHitlist(http, unrestrictedSafetyConfig(), rawId);
      expect(http.get).toHaveBeenCalledWith(
        `/sap/bc/adt/runtime/traces/abaptraces/${encodeURIComponent(rawId)}/hitlist`,
        { Accept: 'application/xml' },
      );
    });

    it('passes already-encoded trace IDs through unchanged', async () => {
      const http = mockHttp('<hitList/>');
      const encodedId = 'TRACE%20001%2Fsegment';
      await getTraceHitlist(http, unrestrictedSafetyConfig(), encodedId);
      expect(http.get).toHaveBeenCalledWith(`/sap/bc/adt/runtime/traces/abaptraces/${encodedId}/hitlist`, {
        Accept: 'application/xml',
      });
      expect((http.get as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).not.toContain('%252F');
    });
  });

  describe('getTraceStatements', () => {
    it('calls correct endpoint', async () => {
      const http = mockHttp('<statements/>');
      await getTraceStatements(http, unrestrictedSafetyConfig(), 'TRACE_002');
      expect(http.get).toHaveBeenCalledWith('/sap/bc/adt/runtime/traces/abaptraces/TRACE_002/statements', {
        Accept: 'application/xml',
      });
    });

    it('encodes raw trace IDs as one path segment', async () => {
      const http = mockHttp('<statements/>');
      const rawId = 'TRACE 002/../../secret';
      await getTraceStatements(http, unrestrictedSafetyConfig(), rawId);
      expect(http.get).toHaveBeenCalledWith(
        `/sap/bc/adt/runtime/traces/abaptraces/${encodeURIComponent(rawId)}/statements`,
        { Accept: 'application/xml' },
      );
    });
  });

  describe('getTraceDbAccesses', () => {
    it('calls correct endpoint', async () => {
      const http = mockHttp('<dbAccesses/>');
      await getTraceDbAccesses(http, unrestrictedSafetyConfig(), 'TRACE_003');
      expect(http.get).toHaveBeenCalledWith('/sap/bc/adt/runtime/traces/abaptraces/TRACE_003/dbAccesses', {
        Accept: 'application/xml',
      });
    });

    it('encodes raw trace IDs as one path segment', async () => {
      const http = mockHttp('<dbAccesses/>');
      const rawId = 'TRACE 003/../../secret';
      await getTraceDbAccesses(http, unrestrictedSafetyConfig(), rawId);
      expect(http.get).toHaveBeenCalledWith(
        `/sap/bc/adt/runtime/traces/abaptraces/${encodeURIComponent(rawId)}/dbAccesses`,
        { Accept: 'application/xml' },
      );
    });
  });

  // Regression tests for CodeQL alerts #6, #7 — see
  // docs/plans/2026-05-08-codeql-alerts-html-hygiene.md
  describe('stripHtmlTags (CodeQL alert #6 — js/incomplete-multi-character-sanitization)', () => {
    it('strips simple tags', () => {
      expect(stripHtmlTags('<p>hello</p>')).toBe('hello');
    });

    it('strips nested tags', () => {
      expect(stripHtmlTags('<div><span>x</span></div>')).toBe('x');
    });

    it('handles adversarial nested input — output never contains `<script`', () => {
      // CodeQL flags the single-pass `<[^>]*>` regex pattern conservatively.
      // For THIS specific regex (greedy `[^>]*` matches across `<`), single-
      // pass already handles nesting — loop is defense-in-depth against a
      // future change to a more restrictive regex like `<\w+>`. Either way,
      // no `<script` substring survives the strip.
      expect(stripHtmlTags('<<script>script>alert(1)</script>')).toBe('script>alert(1)');
      expect(stripHtmlTags('<<script>script>alert(1)</script>')).not.toContain('<script');
      expect(stripHtmlTags('<scr<script>ipt>alert(1)</script>')).toBe('ipt>alert(1)');
      expect(stripHtmlTags('<scr<script>ipt>alert(1)</script>')).not.toContain('<script');
    });

    it('returns empty string for nullish input', () => {
      expect(stripHtmlTags(null as unknown as string)).toBe('');
      expect(stripHtmlTags(undefined as unknown as string)).toBe('');
      expect(stripHtmlTags('')).toBe('');
    });

    it('passes through plain text unchanged', () => {
      expect(stripHtmlTags('plain text without tags')).toBe('plain text without tags');
    });
  });

  describe('decodeHtmlEntities (CodeQL alert #7 — js/double-escaping)', () => {
    it('decodes named entities', () => {
      expect(decodeHtmlEntities('&lt;p&gt;')).toBe('<p>');
      expect(decodeHtmlEntities('&quot;hello&quot;')).toBe('"hello"');
      expect(decodeHtmlEntities('&nbsp;')).toBe(' ');
      expect(decodeHtmlEntities('&amp;')).toBe('&');
    });

    it('decodes chained entity without double-unescape', () => {
      // The CodeQL-flagged case: with `&amp;` decoded last, `&amp;lt;`
      // resolves to the literal `&lt;`, not `<`.
      expect(decodeHtmlEntities('&amp;lt;')).toBe('&lt;');
      expect(decodeHtmlEntities('&amp;amp;')).toBe('&amp;');
    });

    it('decodes mixed input with chained and direct entities', () => {
      // `&gt;` resolves first, `&amp;` resolves last, so `&amp;lt;p&gt;` →
      // `&lt;p>` (the `<` from `&lt;` stays escaped because `&amp;` produced
      // it on the very last pass).
      expect(decodeHtmlEntities('&amp;lt;p&gt;')).toBe('&lt;p>');
    });

    it('decodes numeric entities (decimal and hex)', () => {
      expect(decodeHtmlEntities('&#65;&#66;&#67;')).toBe('ABC');
      expect(decodeHtmlEntities('&#x41;&#x42;&#x43;')).toBe('ABC');
    });

    it('decodes typographic dashes', () => {
      expect(decodeHtmlEntities('a&ndash;b&mdash;c')).toBe('a–b—c');
    });

    it('returns empty string for nullish input', () => {
      expect(decodeHtmlEntities(null as unknown as string)).toBe('');
      expect(decodeHtmlEntities(undefined as unknown as string)).toBe('');
      expect(decodeHtmlEntities('')).toBe('');
    });
  });

  // ─── ABAP Trace Requests (arm/list/cancel) ──────────────────────────

  // Real feed captured live on a4h 758 (docs/research/2026-06-25-abap-trace-requests-and-sapquery-metrics.md).
  const CREATE_FEED = `<?xml version="1.0" encoding="utf-8"?><atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:title>ABAP Trace Requests A4H</atom:title><atom:entry xml:lang="EN"><atom:author trc:role="admin" xmlns:trc="http://www.sap.com/adt/runtime/traces/abaptraces"><atom:name>MARIAN</atom:name></atom:author><atom:author trc:role="trace" xmlns:trc="http://www.sap.com/adt/runtime/traces/abaptraces"><atom:name>MARIAN</atom:name></atom:author><atom:content type="application/atom+xml" src="/sap/bc/adt/runtime/traces/abaptraces/requests/vhcala4hci_A4H_00%2c1%2c20260625093701"/><atom:id>/sap/bc/adt/runtime/traces/abaptraces/requests/vhcala4hci_A4H_00%2c1%2c20260625093701</atom:id><atom:title>arc1 spike</atom:title><trc:extendedData xmlns:trc="http://www.sap.com/adt/runtime/traces/abaptraces"><trc:host>vhcala4hci</trc:host><trc:client trc:role="admin">001</trc:client><trc:client trc:role="trace">001</trc:client><trc:description>arc1 spike</trc:description><trc:isAggregated>true</trc:isAggregated><trc:expires>2026-06-26T23:59:59Z</trc:expires><trc:processType trc:processTypeId="/sap/bc/adt/runtime/traces/abaptraces/processtypes/http"/><trc:object trc:objectTypeId="/sap/bc/adt/runtime/traces/abaptraces/objecttypes/url"/><trc:executions trc:maximal="1" trc:completed="0"/></trc:extendedData></atom:entry></atom:feed>`;

  describe('parseTraceRequestFeed', () => {
    it('parses a real request entry (id, user, expires, types, executions)', () => {
      const [r] = parseTraceRequestFeed(CREATE_FEED);
      expect(r?.id).toBe('/sap/bc/adt/runtime/traces/abaptraces/requests/vhcala4hci_A4H_00%2c1%2c20260625093701');
      expect(r?.title).toBe('arc1 spike');
      expect(r?.user).toBe('MARIAN');
      expect(r?.client).toBe('001');
      expect(r?.expires).toBe('2026-06-26T23:59:59Z');
      expect(r?.processType).toContain('/processtypes/http');
      expect(r?.objectType).toContain('/objecttypes/url');
      expect(r?.maxExecutions).toBe(1);
      expect(r?.completedExecutions).toBe(0);
      expect(r?.host).toBe('vhcala4hci');
    });

    it('returns [] for an empty feed and empty input', () => {
      expect(
        parseTraceRequestFeed(
          '<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:title>x</atom:title></atom:feed>',
        ),
      ).toEqual([]);
      expect(parseTraceRequestFeed('')).toEqual([]);
    });
  });

  describe('createTraceRequest', () => {
    function mockTraceHttp(parametersId = '/sap/bc/adt/runtime/traces/abaptraces/parameters/ABC123') {
      const posts: Array<{ url: string; body: string }> = [];
      const http = {
        post: vi.fn().mockImplementation((url: string, body: string) => {
          posts.push({ url, body });
          if (url.includes('/parameters')) {
            return Promise.resolve({
              statusCode: 200,
              headers: parametersId ? { location: parametersId } : {},
              body: '',
            });
          }
          return Promise.resolve({ statusCode: 200, headers: {}, body: CREATE_FEED });
        }),
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        fetchCsrfToken: vi.fn(),
        withStatefulSession: vi.fn(),
      } as unknown as AdtHttpClient;
      return { http, posts };
    }

    it('posts parameters then requests with uppercased user + parametersId, returns parsed request', async () => {
      const { http, posts } = mockTraceHttp();
      const req = await createTraceRequest(http, unrestrictedSafetyConfig(), 'marian', '001', { processType: 'http' });
      expect(req.id).toContain('/requests/vhcala4hci_A4H_00');
      expect(req.processType).toContain('/processtypes/http');
      expect(req.maxExecutions).toBe(1);
      // 1) parameters first, sqlTrace + aggregate on by default
      expect(posts[0]?.url).toContain('/parameters');
      expect(posts[0]?.body).toContain('<trc:sqlTrace value="true"');
      expect(posts[0]?.body).toContain('<trc:aggregate value="true"');
      // allDbEvents must follow sqlTrace — without it dbAccesses comes back empty (live-verified).
      expect(posts[0]?.body).toContain('<trc:allDbEvents value="true"');
      // 2) then the request with the uppercased user + bounded executions + the parametersId
      expect(posts[1]?.url).toContain('/requests?');
      expect(posts[1]?.url).toContain('traceUser=MARIAN');
      expect(posts[1]?.url).toContain('maximalExecutions=1');
      expect(posts[1]?.url).toContain('parametersId=');
    });

    it('respects sqlTrace=false (and disables DB events with it)', async () => {
      const { http, posts } = mockTraceHttp();
      await createTraceRequest(http, unrestrictedSafetyConfig(), 'marian', '001', { sqlTrace: false });
      expect(posts[0]?.body).toContain('<trc:sqlTrace value="false"');
      expect(posts[0]?.body).toContain('<trc:allDbEvents value="false"');
    });

    it('rejects expiresHours=0 instead of silently defaulting it', async () => {
      const { http } = mockTraceHttp();
      await expect(
        createTraceRequest(http, unrestrictedSafetyConfig(), 'marian', '001', { expiresHours: 0 }),
      ).rejects.toThrow(/expiresHours/);
      expect(http.post).not.toHaveBeenCalled();
    });

    it('rejects an objectType invalid for the process type', async () => {
      const { http } = mockTraceHttp();
      await expect(
        createTraceRequest(http, unrestrictedSafetyConfig(), 'marian', '001', {
          processType: 'http',
          objectType: 'transaction',
        }),
      ).rejects.toThrow(/Invalid objectType/);
    });

    it('throws when the parameters POST returns no Location (parametersId)', async () => {
      const { http } = mockTraceHttp('');
      await expect(createTraceRequest(http, unrestrictedSafetyConfig(), 'marian', '001')).rejects.toThrow(/Location/);
    });

    it('is blocked when writes are disabled', async () => {
      const { http } = mockTraceHttp();
      const safety = { ...unrestrictedSafetyConfig(), allowWrites: false };
      await expect(createTraceRequest(http, safety, 'marian', '001')).rejects.toThrow(/allowWrites=false/);
      expect(http.post).not.toHaveBeenCalled();
    });
  });

  describe('listTraceRequests', () => {
    it('GETs requests for the uppercased user and parses the feed', async () => {
      const http = mockHttp(CREATE_FEED);
      const list = await listTraceRequests(http, unrestrictedSafetyConfig(), 'marian');
      expect(list).toHaveLength(1);
      expect(list[0]?.id).toContain('/requests/');
      expect(http.get).toHaveBeenCalledWith(expect.stringContaining('user=MARIAN'), expect.anything());
    });
  });

  describe('deleteTraceRequest', () => {
    it('DELETEs the request id path verbatim (keeps URL-encoded commas)', async () => {
      const http = mockHttp('');
      const id = '/sap/bc/adt/runtime/traces/abaptraces/requests/vhcala4hci_A4H_00%2c1%2c20260625093701';
      await deleteTraceRequest(http, unrestrictedSafetyConfig(), id);
      expect(http.delete).toHaveBeenCalledWith(id);
    });

    it('scopes a bare segment under the requests collection', async () => {
      const http = mockHttp('');
      await deleteTraceRequest(http, unrestrictedSafetyConfig(), 'abc%2c1');
      expect(http.delete).toHaveBeenCalledWith('/sap/bc/adt/runtime/traces/abaptraces/requests/abc%2c1');
    });

    it('accepts an absolute URL only when its path is a request id path', async () => {
      const http = mockHttp('');
      await deleteTraceRequest(
        http,
        unrestrictedSafetyConfig(),
        'https://a4h.example/sap/bc/adt/runtime/traces/abaptraces/requests/abc%2c1',
      );
      expect(http.delete).toHaveBeenCalledWith('/sap/bc/adt/runtime/traces/abaptraces/requests/abc%2c1');
    });

    it('refuses an arbitrary ADT path (no arbitrary DELETE primitive)', async () => {
      const http = mockHttp('');
      await expect(
        deleteTraceRequest(http, unrestrictedSafetyConfig(), '/sap/bc/adt/oo/classes/zcl_victim'),
      ).rejects.toThrow(/not an abaptraces trace-request id/);
      expect(http.delete).not.toHaveBeenCalled();
    });

    it('refuses a `..` traversal that escapes the requests collection after normalization', async () => {
      const http = mockHttp('');
      // startsWith() on the raw string would pass, but new URL() collapses the `..` to /sap/bc/adt/oo/...
      await expect(
        deleteTraceRequest(
          http,
          unrestrictedSafetyConfig(),
          '/sap/bc/adt/runtime/traces/abaptraces/requests/../../../oo/classes/sources/zcl_victim',
        ),
      ).rejects.toThrow(/not an abaptraces trace-request id/);
      expect(http.delete).not.toHaveBeenCalled();
    });

    it('refuses a traversal that normalizes to another request id', async () => {
      const http = mockHttp('');
      await expect(
        deleteTraceRequest(
          http,
          unrestrictedSafetyConfig(),
          '/sap/bc/adt/runtime/traces/abaptraces/requests/foo/../bar',
        ),
      ).rejects.toThrow(/not an abaptraces trace-request id/);
      expect(http.delete).not.toHaveBeenCalled();
    });

    it('refuses a percent-encoded (%2f / %2e) separator traversal', async () => {
      const http = mockHttp('');
      // %2f isn't decoded by new URL().pathname alone — validation must decode first (SAP ICM may too).
      await expect(
        deleteTraceRequest(
          http,
          unrestrictedSafetyConfig(),
          '/sap/bc/adt/runtime/traces/abaptraces/requests/%2f..%2f..%2f..%2foo%2fclasses%2fzcl_victim',
        ),
      ).rejects.toThrow(/not an abaptraces trace-request id/);
      expect(http.delete).not.toHaveBeenCalled();
    });

    it('refuses a double-encoded separator traversal', async () => {
      const http = mockHttp('');
      await expect(
        deleteTraceRequest(
          http,
          unrestrictedSafetyConfig(),
          '/sap/bc/adt/runtime/traces/abaptraces/requests/foo%252fbar',
        ),
      ).rejects.toThrow(/not an abaptraces trace-request id/);
      expect(http.delete).not.toHaveBeenCalled();
    });

    it('refuses backslashes and blank request ids', async () => {
      const http = mockHttp('');
      await expect(deleteTraceRequest(http, unrestrictedSafetyConfig(), 'foo\\bar')).rejects.toThrow(
        /malformed trace-request id/,
      );
      await expect(deleteTraceRequest(http, unrestrictedSafetyConfig(), '   ')).rejects.toThrow(
        /empty trace-request id/,
      );
      expect(http.delete).not.toHaveBeenCalled();
    });

    it('is blocked when writes are disabled', async () => {
      const http = mockHttp('');
      const safety = { ...unrestrictedSafetyConfig(), allowWrites: false };
      await expect(deleteTraceRequest(http, safety, 'abc%2c1')).rejects.toThrow(/allowWrites=false/);
      expect(http.delete).not.toHaveBeenCalled();
    });
  });
});

// ─── OData performance probe (#1) ───────────────────────────────────

describe('parseSapStatistics', () => {
  it('parses a real sap-statistics header into a numeric map', () => {
    expect(parseSapStatistics('gwtotal=173,gwfw=38,gwapp=131,gwappdb=100,icfauth=0')).toEqual({
      gwtotal: 173,
      gwfw: 38,
      gwapp: 131,
      gwappdb: 100,
      icfauth: 0,
    });
  });

  it('tolerates an empty or malformed header', () => {
    expect(parseSapStatistics('')).toEqual({});
    expect(parseSapStatistics('garbage;no;equals')).toEqual({});
  });
});

describe('verdictFromStatistics', () => {
  it('routes a gwappdb-dominant request to db', () => {
    expect(verdictFromStatistics({ gwtotal: 173, gwapp: 131, gwappdb: 100, gwfw: 38 }).bound).toBe('db');
  });

  it('routes an icfauth-dominant request to auth', () => {
    expect(verdictFromStatistics({ gwtotal: 100, icfauth: 80, gwapp: 5, gwappdb: 2, gwfw: 3 }).bound).toBe('auth');
  });

  it('routes a gwapp-dominant (gwappdb-absent) request to app, arming via trace_start (not "traces")', () => {
    // live GWSAMPLE_BASIC ?$expand: gwapp 439 of gwtotal 609, gwappdb absent → app-bound
    const v = verdictFromStatistics({ gwtotal: 609, gwapp: 439, gwfw: 167 });
    expect(v.bound).toBe('app');
    // regression: the note used to say arm via action="traces" (wrong) + "read its hitlist" (empty for HTTP)
    expect(v.note).toContain('trace_start');
    expect(v.note).toMatch(/dbAccesses|ST12|SAT/);
  });

  it('does not let an inconsistent gwapp/gwappdb split produce negative app time', () => {
    expect(verdictFromStatistics({ gwtotal: 100, gwapp: 20, gwappdb: 80, gwfw: 30 }).bound).toBe('db');
  });

  it('uses stable candidate order for ties', () => {
    expect(verdictFromStatistics({ gwtotal: 100, gwapp: 50, gwappdb: 50, gwfw: 50, icfauth: 50 }).bound).toBe('db');
  });

  it('returns unknown when there is no Gateway timing', () => {
    expect(verdictFromStatistics({}).bound).toBe('unknown');
  });

  it('treats gwhub (NW 7.50 form, no gwfw) as framework time', () => {
    // Live a4h 7.50: CATALOGSERVICE returned gwtotal=6788,gwhub=6788 with no gwfw/gwappdb.
    expect(verdictFromStatistics({ gwtotal: 6788, gwhub: 6788, gwapp: 0 }).bound).toBe('framework');
  });

  it('returns unknown (not db) when the total has no component breakdown', () => {
    expect(verdictFromStatistics({ gwtotal: 500, gwbe: 0 }).bound).toBe('unknown');
  });
});

describe('probeODataPerformance', () => {
  it('appends sap-statistics=true, times the call, and returns the parsed split + verdict', async () => {
    const http = mockHttpSequence([
      {
        headers: { 'sap-statistics': 'gwtotal=173,gwapp=131,gwappdb=100,gwfw=38', 'sap-perf-fesrec': '129509' },
        body: '{}',
      },
    ]);
    const result = await probeODataPerformance(http, unrestrictedSafetyConfig(), '/sap/opu/odata/sap/X/E?$top=1');
    expect(http.get).toHaveBeenCalledWith('/sap/opu/odata/sap/X/E?$top=1&sap-statistics=true');
    expect(result.statistics.gwappdb).toBe(100);
    expect(result.verdict.bound).toBe('db');
    expect(result.wallClockMs).toBeGreaterThanOrEqual(0);
    expect(result.fesrecMicros).toBe(129509);
  });

  it('rejects an absolute URL (SSRF boundary)', async () => {
    const http = mockHttp();
    await expect(probeODataPerformance(http, unrestrictedSafetyConfig(), 'http://evil.test/x')).rejects.toThrow(
      /host-relative/,
    );
    expect(http.get).not.toHaveBeenCalled();
  });

  it.each([
    ['protocol-relative URL', '//evil.test/x'],
    ['backslash path', '/\\evil.test/x'],
    ['encoded backslash path', '/sap/opu/odata/sap/X/%5cevil'],
    ['dot-segment path', '/sap/opu/foo/../odata/sap/X'],
    ['fragment path', '/sap/opu/odata/sap/X#fragment'],
    ['non-OData SAP path', '/sap/bc/adt/core/discovery'],
  ])('rejects %s before making an HTTP request', async (_label, url) => {
    const http = mockHttp();
    await expect(probeODataPerformance(http, unrestrictedSafetyConfig(), url)).rejects.toThrow(/OData path/);
    expect(http.get).not.toHaveBeenCalled();
  });
});

// ─── CDS Show-SQL (#2) ──────────────────────────────────────────────

describe('parseCdsCreateStatements', () => {
  const fixture = readFileSync(join(FIXTURES_DIR, 'createstatements-i-currency.xml'), 'utf-8');

  it('parses the native SQL CREATE VIEW from a captured createstatements response', () => {
    const result = parseCdsCreateStatements(fixture);
    expect(result.name).toBe('I_CURRENCY');
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0].sql).toContain('CREATE OR REPLACE VIEW');
    expect(result.statements[0].sql).toContain('LEFT OUTER JOIN');
    expect(result.statements[0].state).toBe('A');
  });

  it('returns no statements for an empty createStatements element', () => {
    const xml = '<ddl:source xmlns:ddl="http://www.sap.com/adt/ddl"><ddl:createStatements/></ddl:source>';
    expect(parseCdsCreateStatements(xml).statements).toEqual([]);
  });

  it('parses multiple createStatement entries and array-shaped statement text', () => {
    const xml =
      '<ddl:source xmlns:ddl="http://www.sap.com/adt/ddl" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZSQL">' +
      '<ddl:createStatements>' +
      '<ddl:createStatement adtcore:name="ZSQL" adtcore:type="1" state="A"><ddl:statement>CREATE VIEW "A"</ddl:statement></ddl:createStatement>' +
      '<ddl:createStatement adtcore:name="ZSQL_TEXT" adtcore:type="2" state="I"><ddl:statement>CREATE VIEW "B"</ddl:statement></ddl:createStatement>' +
      '</ddl:createStatements></ddl:source>';
    const result = parseCdsCreateStatements(xml);
    expect(result.name).toBe('ZSQL');
    expect(result.statements).toEqual([
      { name: 'ZSQL', type: '1', state: 'A', sql: 'CREATE VIEW "A"' },
      { name: 'ZSQL_TEXT', type: '2', state: 'I', sql: 'CREATE VIEW "B"' },
    ]);
  });

  it('does not throw on a malformed body', () => {
    expect(parseCdsCreateStatements('not xml at all').statements).toEqual([]);
  });
});

describe('getCdsCreateStatements', () => {
  it('POSTs to createstatements with CSRF-Accept and parses the SQL', async () => {
    const fixture = readFileSync(join(FIXTURES_DIR, 'createstatements-i-currency.xml'), 'utf-8');
    const http = mockHttp(fixture);
    const result = await getCdsCreateStatements(http, unrestrictedSafetyConfig(), 'I_CURRENCY');
    expect(result.statements[0].sql).toContain('CREATE OR REPLACE VIEW');
    expect(http.post).toHaveBeenCalledWith('/sap/bc/adt/ddic/ddl/createstatements/I_CURRENCY', '', undefined, {
      Accept: 'application/vnd.sap.adt.ddl.createStatements+xml',
    });
  });
});

// ─── ST05 SQL-trace state control (#4) ──────────────────────────────

describe('parseSqlTraceState', () => {
  const xml = readFileSync(join(FIXTURES_DIR, 'st05-trace-state.xml'), 'utf-8');

  it('parses the trace-state table (types + filter) from a captured response', () => {
    const states = parseSqlTraceState(xml);
    expect(states).toHaveLength(1);
    expect(states[0].instance).toBe('vhcala4hci_A4H_00');
    expect(states[0].host).toBe('vhcala4hci');
    expect(states[0].isLocal).toBe(true);
    expect(states[0].isSelected).toBe(false);
    expect(states[0].traceTypes).toEqual({
      sql: false,
      buf: false,
      enq: false,
      rfc: false,
      http: false,
      apc: false,
      amc: false,
      auth: false,
    });
    expect(states[0].filter).toEqual({
      user: undefined,
      transactionCode: undefined,
      program: undefined,
      rfcFunction: undefined,
      url: undefined,
      wpId: undefined,
    });
  });

  it('returns [] for an empty body', () => {
    expect(parseSqlTraceState('<x/>')).toEqual([]);
  });
});

describe('parseSqlTraceDirectory', () => {
  it('extracts SAP’s TMC SQL Trace Analysis deep-link', () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'st05-trace-directory.xml'), 'utf-8');
    const dir = parseSqlTraceDirectory(xml);
    expect(dir.recordViewerUrl).toContain('SQL_TRACE_ANALYSIS');
    expect(dir.note).toMatch(/Trace Analysis|deep-link/i);
  });

  it('handles a missing directory URL', () => {
    expect(parseSqlTraceDirectory('<td:traceDirectory xmlns:td="x"/>').recordViewerUrl).toBeUndefined();
  });
});

describe('getSqlTraceState / getSqlTraceDirectory', () => {
  it('GETs the state with the trace-state media type and parses it', async () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'st05-trace-state.xml'), 'utf-8');
    const http = mockHttp(xml);
    const states = await getSqlTraceState(http, unrestrictedSafetyConfig());
    expect(states[0].traceTypes.sql).toBe(false);
    expect(http.get).toHaveBeenCalledWith('/sap/bc/adt/st05/trace/state', {
      Accept: 'application/vnd.sap.adt.perf.trace.state.v1+xml',
    });
  });

  it('GETs the directory and returns SAP’s TMC deep-link', async () => {
    const xml = readFileSync(join(FIXTURES_DIR, 'st05-trace-directory.xml'), 'utf-8');
    const http = mockHttp(xml);
    const dir = await getSqlTraceDirectory(http, unrestrictedSafetyConfig());
    expect(dir.recordViewerUrl).toContain('SQL_TRACE_ANALYSIS');
    expect(http.get).toHaveBeenCalledWith('/sap/bc/adt/st05/trace/directory', { Accept: 'application/*' });
  });
});

describe('setSqlTraceState', () => {
  const stateXml = readFileSync(join(FIXTURES_DIR, 'st05-trace-state.xml'), 'utf-8');

  function mockGetPut(getBody: string) {
    const put = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: getBody });
    const http = {
      get: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: getBody }),
      put,
      fetchCsrfToken: vi.fn(),
      withStatefulSession: vi.fn(),
    } as unknown as AdtHttpClient;
    return { http, put };
  }

  it('arms the SQL trace and writes a user filter into the PUT body', async () => {
    const { http, put } = mockGetPut(stateXml); // fixture is sqlOn=false, traceUser empty
    await setSqlTraceState(http, unrestrictedSafetyConfig(), { sqlOn: true, traceUser: 'MARIAN' });
    const [path, body, contentType] = put.mock.calls[0];
    expect(path).toBe('/sap/bc/adt/st05/trace/state');
    expect(body).toContain('<ts:sqlOn>true</ts:sqlOn>');
    expect(body).toContain('<ts:traceUser>MARIAN</ts:traceUser>');
    expect(contentType).toBe('application/vnd.sap.adt.perf.trace.state.v1+xml');
  });

  it('writes dollar-containing user filters literally into the PUT body', async () => {
    const { http, put } = mockGetPut(stateXml);
    await setSqlTraceState(http, unrestrictedSafetyConfig(), { sqlOn: true, traceUser: "A$&B$`C$'D" });
    const body = put.mock.calls[0][1] as string;
    expect(body).toContain('<ts:traceUser>A$&amp;B$`C$&apos;D</ts:traceUser>');
  });

  it('disarms the SQL trace and clears the user filter', async () => {
    const armed = stateXml
      .replace('<ts:sqlOn>false</ts:sqlOn>', '<ts:sqlOn>true</ts:sqlOn>')
      .replace('<ts:traceUser/>', '<ts:traceUser>MARIAN</ts:traceUser>');
    const { http, put } = mockGetPut(armed);
    await setSqlTraceState(http, unrestrictedSafetyConfig(), { sqlOn: false, traceUser: '' });
    const body = put.mock.calls[0][1] as string;
    expect(body).toContain('<ts:sqlOn>false</ts:sqlOn>');
    expect(body).toContain('<ts:traceUser/>');
    // the filter user is cleared (modificationUser may still be MARIAN — that's a different element)
    expect(body).not.toContain('<ts:traceUser>MARIAN</ts:traceUser>');
  });
});
