import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

type FetchCall = { method: string; url: string; body?: string };

function mockEditContentFlow(opts: { objectPath: string; activeSource: string }): FetchCall[] {
  const calls: FetchCall[] = [];
  mockFetch.mockReset();
  mockFetch.mockImplementation((url: string | URL, request?: { method?: string; body?: string | Buffer | null }) => {
    const method = request?.method ?? 'GET';
    const urlString = String(url);
    const parsed = new URL(urlString);
    calls.push({ method, url: urlString, body: typeof request?.body === 'string' ? request.body : undefined });

    if (method === 'GET' && parsed.pathname === '/sap/bc/adt/activation/inactiveobjects') {
      return Promise.resolve(
        mockResponse(
          200,
          '<?xml version="1.0"?><ioc:inactiveObjects xmlns:ioc="http://www.sap.com/adt/inactiveObjects"/>',
          { 'x-csrf-token': 'TOKEN' },
        ),
      );
    }
    if (method === 'GET' && parsed.pathname === opts.objectPath) {
      return Promise.resolve(
        mockResponse(
          200,
          '<abap:object xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="$TMP"/></abap:object>',
          { 'x-csrf-token': 'TOKEN' },
        ),
      );
    }
    if (method === 'GET' && parsed.pathname === `${opts.objectPath}/source/main`) {
      return Promise.resolve(mockResponse(200, opts.activeSource, { 'x-csrf-token': 'TOKEN' }));
    }
    if (method === 'POST' && parsed.pathname === opts.objectPath && parsed.searchParams.get('_action') === 'LOCK') {
      return Promise.resolve(
        mockResponse(
          200,
          '<asx:abap><asx:values><DATA><LOCK_HANDLE>LH1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>',
          { 'x-csrf-token': 'TOKEN' },
        ),
      );
    }
    if (method === 'PUT' && parsed.pathname === `${opts.objectPath}/source/main`) {
      return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'TOKEN' }));
    }
    if (method === 'POST' && parsed.pathname === opts.objectPath && parsed.searchParams.get('_action') === 'UNLOCK') {
      return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'TOKEN' }));
    }
    return Promise.resolve(mockResponse(404, `Unexpected ${method} ${urlString}`, { 'x-csrf-token': 'TOKEN' }));
  });
  return calls;
}

describe('SAPWrite edit_content', () => {
  beforeEach(() => vi.resetAllMocks());

  it('validates oldContent, newContent, and supported object type before I/O', async () => {
    for (const args of [
      { action: 'edit_content', type: 'PROG', name: 'ZTEST', newContent: "WRITE 'new'." },
      { action: 'edit_content', type: 'PROG', name: 'ZTEST', oldContent: "WRITE 'old'." },
      {
        action: 'edit_content',
        type: 'CLAS',
        name: 'ZCL_TEST',
        oldContent: "WRITE 'old'.",
        newContent: "WRITE 'new'.",
      },
    ]) {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', args);
      expect(result.isError).toBe(true);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('requires lineStart and lineEnd together', async () => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'edit_content',
      type: 'PROG',
      name: 'ZTEST',
      oldContent: "WRITE 'old'.",
      newContent: "WRITE 'new'.",
      lineStart: 2,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/lineStart and lineEnd are required together/);
  });

  it('splices one occurrence and writes the full source under lock', async () => {
    const name = 'ZARC1_CONTENT';
    const objectPath = `/sap/bc/adt/programs/programs/${name}`;
    const calls = mockEditContentFlow({
      objectPath,
      activeSource: "REPORT zarc1_content.\nWRITE 'old value'.\nWRITE 'kept line'.",
    });

    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'edit_content',
      type: 'PROG',
      name,
      oldContent: "WRITE 'old value'.",
      newContent: "WRITE 'new value'.",
      lintBeforeWrite: false,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain(`Successfully updated PROG ${name}`);
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.url).toContain(`${objectPath}/source/main`);
    expect(put?.body).toContain("WRITE 'new value'.");
    expect(put?.body).not.toContain("WRITE 'old value'.");
  });

  it('returns an idempotent no-op success when the edit was already applied', async () => {
    const name = 'ZARC1_NOOP';
    const objectPath = `/sap/bc/adt/programs/programs/${name}`;
    const calls = mockEditContentFlow({
      objectPath,
      activeSource: "REPORT zarc1_noop.\nWRITE 'new value'.\nWRITE 'kept line'.",
    });

    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'edit_content',
      type: 'PROG',
      name,
      oldContent: "WRITE 'old value'.",
      newContent: "WRITE 'new value'.",
      lintBeforeWrite: false,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('No change made');
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
  });

  it('errors when oldContent is not found and cannot be confirmed already-applied', async () => {
    const name = 'ZARC1_MISSING';
    const objectPath = `/sap/bc/adt/programs/programs/${name}`;
    mockEditContentFlow({
      objectPath,
      activeSource: "REPORT zarc1_missing.\nWRITE 'kept line'.",
    });

    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'edit_content',
      type: 'PROG',
      name,
      oldContent: "WRITE 'missing line'.",
      newContent: "WRITE 'new value'.",
      lintBeforeWrite: false,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not found/i);
  });

  it('errors when oldContent is ambiguous', async () => {
    const name = 'ZARC1_AMBIG';
    const objectPath = `/sap/bc/adt/programs/programs/${name}`;
    mockEditContentFlow({
      objectPath,
      activeSource: "WRITE 'dup'.\nWRITE 'other'.\nWRITE 'dup'.",
    });

    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'edit_content',
      type: 'PROG',
      name,
      oldContent: "WRITE 'dup'.",
      newContent: "WRITE 'changed'.",
      lintBeforeWrite: false,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/ambiguous/i);
  });

  it('scopes the anchor search with lineStart/lineEnd', async () => {
    const name = 'ZARC1_SCOPED';
    const objectPath = `/sap/bc/adt/programs/programs/${name}`;
    const calls = mockEditContentFlow({
      objectPath,
      activeSource: "WRITE 'dup'.\nWRITE 'other'.\nWRITE 'dup'.\nWRITE 'tail'.",
    });

    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'edit_content',
      type: 'PROG',
      name,
      oldContent: "WRITE 'dup'.",
      newContent: "WRITE 'changed'.",
      lineStart: 3,
      lineEnd: 4,
      lintBeforeWrite: false,
    });
    expect(result.isError).toBeUndefined();
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.body).toBe("WRITE 'dup'.\nWRITE 'other'.\nWRITE 'changed'.\nWRITE 'tail'.");
  });

  it('supports edit_content in a function-group structural INCL', async () => {
    const name = 'LZARC1TOP';
    const group = 'ZARC1';
    const objectPath = `/sap/bc/adt/functions/groups/${group.toLowerCase()}/includes/${name.toLowerCase()}`;
    const calls = mockEditContentFlow({
      objectPath,
      activeSource: "DATA: gv_flag TYPE abap_bool VALUE 'X'.",
    });

    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'edit_content',
      type: 'INCL',
      group,
      name,
      oldContent: "VALUE 'X'.",
      newContent: "VALUE ' '.",
      lintBeforeWrite: false,
    });
    expect(result.isError).toBeUndefined();
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.url).toContain(objectPath);
    expect(put?.body).toContain("VALUE ' '.");
  });

  it('auto-resolves the function group for a FUGR structural INCL when group is omitted', async () => {
    const name = 'LZARC1TOP';
    const group = 'ZARC1';
    const objectPath = `/sap/bc/adt/functions/groups/${group.toLowerCase()}/includes/${name.toLowerCase()}`;
    const calls = mockEditContentFlow({
      objectPath,
      activeSource: "DATA: gv_flag TYPE abap_bool VALUE 'X'.",
    });
    mockFetch.mockImplementation((url: string | URL, request?: { method?: string; body?: string | Buffer | null }) => {
      const method = request?.method ?? 'GET';
      const urlString = String(url);
      const parsed = new URL(urlString);
      calls.push({ method, url: urlString, body: typeof request?.body === 'string' ? request.body : undefined });

      if (method === 'GET' && parsed.pathname === '/sap/bc/adt/repository/informationsystem/search') {
        return Promise.resolve(
          mockResponse(
            200,
            `<?xml version="1.0"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">` +
              `<adtcore:objectReference adtcore:type="PROG/I" adtcore:name="${name}" adtcore:packageName="ZARC1" ` +
              `adtcore:uri="${objectPath}"/></adtcore:objectReferences>`,
            { 'x-csrf-token': 'TOKEN' },
          ),
        );
      }
      if (method === 'GET' && parsed.pathname === '/sap/bc/adt/activation/inactiveobjects') {
        return Promise.resolve(
          mockResponse(
            200,
            '<?xml version="1.0"?><ioc:inactiveObjects xmlns:ioc="http://www.sap.com/adt/inactiveObjects"/>',
            { 'x-csrf-token': 'TOKEN' },
          ),
        );
      }
      if (method === 'GET' && parsed.pathname === objectPath) {
        return Promise.resolve(
          mockResponse(
            200,
            '<abap:object xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="$TMP"/></abap:object>',
            { 'x-csrf-token': 'TOKEN' },
          ),
        );
      }
      if (method === 'GET' && parsed.pathname === `${objectPath}/source/main`) {
        return Promise.resolve(
          mockResponse(200, "DATA: gv_flag TYPE abap_bool VALUE 'X'.", { 'x-csrf-token': 'TOKEN' }),
        );
      }
      if (method === 'POST' && parsed.pathname === objectPath && parsed.searchParams.get('_action') === 'LOCK') {
        return Promise.resolve(
          mockResponse(
            200,
            '<asx:abap><asx:values><DATA><LOCK_HANDLE>LH1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>',
            { 'x-csrf-token': 'TOKEN' },
          ),
        );
      }
      if (method === 'PUT' && parsed.pathname === `${objectPath}/source/main`) {
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'TOKEN' }));
      }
      if (method === 'POST' && parsed.pathname === objectPath && parsed.searchParams.get('_action') === 'UNLOCK') {
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'TOKEN' }));
      }
      return Promise.resolve(mockResponse(404, `Unexpected ${method} ${urlString}`, { 'x-csrf-token': 'TOKEN' }));
    });

    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'edit_content',
      type: 'INCL',
      name,
      oldContent: "VALUE 'X'.",
      newContent: "VALUE ' '.",
      lintBeforeWrite: false,
    });
    expect(result.isError).toBeUndefined();
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.url).toContain(objectPath);
    expect(put?.body).toContain("VALUE ' '.");
  });

  it('auto-resolves via the caching-layer resolver actually used in production (ARC1_CACHE=auto)', async () => {
    // Distinct from the previous test: with no cachingLayer passed, the write path falls back to
    // client.resolveFunctionGroup (which has a name-equality guard). A deployed server normally has
    // a CachingLayer wired in, which takes cachingLayer.resolveFuncGroup instead — a different
    // implementation (see src/cache/caching-layer.ts) that does NOT check name equality. This test
    // exercises THAT resolver so the happy path through the actually-shipping code is covered too.
    const name = 'LZARC1TOP';
    const group = 'ZARC1';
    const objectPath = `/sap/bc/adt/functions/groups/${group.toLowerCase()}/includes/${name.toLowerCase()}`;
    const calls = mockEditContentFlow({
      objectPath,
      activeSource: "DATA: gv_flag TYPE abap_bool VALUE 'X'.",
    });
    mockFetch.mockImplementation((url: string | URL, request?: { method?: string; body?: string | Buffer | null }) => {
      const method = request?.method ?? 'GET';
      const urlString = String(url);
      const parsed = new URL(urlString);
      calls.push({ method, url: urlString, body: typeof request?.body === 'string' ? request.body : undefined });

      if (method === 'GET' && parsed.pathname === '/sap/bc/adt/repository/informationsystem/search') {
        return Promise.resolve(
          mockResponse(
            200,
            `<?xml version="1.0"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">` +
              `<adtcore:objectReference adtcore:type="PROG/I" adtcore:name="${name}" adtcore:packageName="ZARC1" ` +
              `adtcore:uri="${objectPath}"/></adtcore:objectReferences>`,
            { 'x-csrf-token': 'TOKEN' },
          ),
        );
      }
      if (method === 'GET' && parsed.pathname === '/sap/bc/adt/activation/inactiveobjects') {
        return Promise.resolve(
          mockResponse(
            200,
            '<?xml version="1.0"?><ioc:inactiveObjects xmlns:ioc="http://www.sap.com/adt/inactiveObjects"/>',
            { 'x-csrf-token': 'TOKEN' },
          ),
        );
      }
      if (method === 'GET' && parsed.pathname === objectPath) {
        return Promise.resolve(
          mockResponse(
            200,
            '<abap:object xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="$TMP"/></abap:object>',
            { 'x-csrf-token': 'TOKEN' },
          ),
        );
      }
      if (method === 'GET' && parsed.pathname === `${objectPath}/source/main`) {
        return Promise.resolve(
          mockResponse(200, "DATA: gv_flag TYPE abap_bool VALUE 'X'.", { 'x-csrf-token': 'TOKEN' }),
        );
      }
      if (method === 'POST' && parsed.pathname === objectPath && parsed.searchParams.get('_action') === 'LOCK') {
        return Promise.resolve(
          mockResponse(
            200,
            '<asx:abap><asx:values><DATA><LOCK_HANDLE>LH1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>',
            { 'x-csrf-token': 'TOKEN' },
          ),
        );
      }
      if (method === 'PUT' && parsed.pathname === `${objectPath}/source/main`) {
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'TOKEN' }));
      }
      if (method === 'POST' && parsed.pathname === objectPath && parsed.searchParams.get('_action') === 'UNLOCK') {
        return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'TOKEN' }));
      }
      return Promise.resolve(mockResponse(404, `Unexpected ${method} ${urlString}`, { 'x-csrf-token': 'TOKEN' }));
    });

    const layer = new CachingLayer(new MemoryCache());
    const result = await handleToolCall(
      createClient(),
      DEFAULT_CONFIG,
      'SAPWrite',
      {
        action: 'edit_content',
        type: 'INCL',
        name,
        oldContent: "VALUE 'X'.",
        newContent: "VALUE ' '.",
        lintBeforeWrite: false,
      },
      undefined,
      undefined,
      layer,
    );
    expect(result.isError).toBeUndefined();
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.url).toContain(objectPath);
    expect(put?.body).toContain("VALUE ' '.");
  });

  it('does not 304 off a flat-endpoint cache entry when writing a group-scoped FUGR structural INCL (A4)', async () => {
    // Regression for issue A4: the source cache is keyed by (type, name, version), blind to which
    // endpoint populated it. A prior plain SAPRead(type="INCL") (flat /programs/includes/ path)
    // must NOT let its cached ETag be sent as If-None-Match against the group-scoped
    // /functions/groups/{g}/includes/{name} endpoint edit_content actually writes to here — a
    // cross-endpoint 304 would hand the transform stale, wrong-endpoint bytes.
    const name = 'LZARC1TOP';
    const group = 'ZARC1';
    const objectPath = `/sap/bc/adt/functions/groups/${group.toLowerCase()}/includes/${name.toLowerCase()}`;
    const staleFlatEtag = 'FLAT-ETAG-FROM-EARLIER-SAPREAD';
    const staleFlatSource = "DATA: gv_flag TYPE abap_bool VALUE 'STALE'.";
    const realCurrentSource = "DATA: gv_flag TYPE abap_bool VALUE 'X'.";

    const layer = new CachingLayer(new MemoryCache());
    // Simulate an earlier plain SAPRead(type="INCL") (no group) populating the cache via the flat
    // endpoint — exactly what src/handlers/read.ts's INCL case always uses.
    layer.cache.putSource('INCL', name, staleFlatSource, { version: 'active', etag: staleFlatEtag });

    const calls: FetchCall[] = [];
    mockFetch.mockReset();
    mockFetch.mockImplementation(
      (
        url: string | URL,
        request?: { method?: string; body?: string | Buffer | null; headers?: Record<string, string> },
      ) => {
        const method = request?.method ?? 'GET';
        const urlString = String(url);
        const parsed = new URL(urlString);
        calls.push({ method, url: urlString, body: typeof request?.body === 'string' ? request.body : undefined });

        if (method === 'GET' && parsed.pathname === '/sap/bc/adt/activation/inactiveobjects') {
          return Promise.resolve(
            mockResponse(
              200,
              '<?xml version="1.0"?><ioc:inactiveObjects xmlns:ioc="http://www.sap.com/adt/inactiveObjects"/>',
              { 'x-csrf-token': 'TOKEN' },
            ),
          );
        }
        if (method === 'GET' && parsed.pathname === objectPath) {
          return Promise.resolve(
            mockResponse(
              200,
              '<abap:object xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="$TMP"/></abap:object>',
              { 'x-csrf-token': 'TOKEN' },
            ),
          );
        }
        if (method === 'GET' && parsed.pathname === `${objectPath}/source/main`) {
          // A buggy implementation forwards the flat-cache ETag as If-None-Match against this
          // group-scoped endpoint; SAP would legitimately 304 (same underlying object version),
          // handing stale flat-endpoint bytes to transform. The fix must never send that header
          // here, so this always returns the real current bytes.
          if (request?.headers?.['If-None-Match'] === staleFlatEtag) {
            return Promise.resolve(mockResponse(304, '', { 'x-csrf-token': 'TOKEN' }));
          }
          return Promise.resolve(mockResponse(200, realCurrentSource, { 'x-csrf-token': 'TOKEN' }));
        }
        if (method === 'POST' && parsed.pathname === objectPath && parsed.searchParams.get('_action') === 'LOCK') {
          return Promise.resolve(
            mockResponse(
              200,
              '<asx:abap><asx:values><DATA><LOCK_HANDLE>LH1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>',
              { 'x-csrf-token': 'TOKEN' },
            ),
          );
        }
        if (method === 'PUT' && parsed.pathname === `${objectPath}/source/main`) {
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'TOKEN' }));
        }
        if (method === 'POST' && parsed.pathname === objectPath && parsed.searchParams.get('_action') === 'UNLOCK') {
          return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 'TOKEN' }));
        }
        return Promise.resolve(mockResponse(404, `Unexpected ${method} ${urlString}`, { 'x-csrf-token': 'TOKEN' }));
      },
    );

    const result = await handleToolCall(
      createClient(),
      DEFAULT_CONFIG,
      'SAPWrite',
      {
        action: 'edit_content',
        type: 'INCL',
        group,
        name,
        oldContent: "VALUE 'X'.",
        newContent: "VALUE ' '.",
        lintBeforeWrite: false,
      },
      undefined,
      undefined,
      layer,
    );

    expect(result.isError).toBeUndefined();
    const sourceGet = calls.find((call) => call.method === 'GET' && call.url.includes(`${objectPath}/source/main`));
    expect(sourceGet).toBeDefined();
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.body).toBe("DATA: gv_flag TYPE abap_bool VALUE ' '.");
  });

  it('falls back to the standalone INCL path when search finds no owning function group', async () => {
    const name = 'ZSTANDALONE_INCL';
    const objectPath = `/sap/bc/adt/programs/includes/${name}`;
    const calls = mockEditContentFlow({
      objectPath,
      activeSource: "WRITE 'old value'.",
    });
    const originalImpl = mockFetch.getMockImplementation();
    mockFetch.mockImplementation((url: string | URL, request?: { method?: string; body?: string | Buffer | null }) => {
      const parsed = new URL(String(url));
      if (
        (request?.method ?? 'GET') === 'GET' &&
        parsed.pathname === '/sap/bc/adt/repository/informationsystem/search'
      ) {
        return Promise.resolve(
          mockResponse(
            200,
            '<?xml version="1.0"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"/>',
            {
              'x-csrf-token': 'TOKEN',
            },
          ),
        );
      }
      return originalImpl!(url, request);
    });

    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'edit_content',
      type: 'INCL',
      name,
      oldContent: "WRITE 'old value'.",
      newContent: "WRITE 'new value'.",
      lintBeforeWrite: false,
    });
    expect(result.isError).toBeUndefined();
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.url).toContain(objectPath);
    expect(put?.body).toContain("WRITE 'new value'.");
  });
});
