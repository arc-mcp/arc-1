import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { CachingLayer } = await import('../../../src/cache/caching-layer.js');
const { MemoryCache } = await import('../../../src/cache/memory.js');
const { enhancementIncludeName, isEnhancementIncludeName } = await import('../../../src/adt/enhancement-include.js');

const name = 'ZD0120_FUELLEN';
const include = enhancementIncludeName(name);
const encodedInclude = encodeURIComponent(include);
const includeBase = `/sap/bc/adt/programs/includes/${encodedInclude}`;
const source = 'ENHANCEMENT 1  .\n  IF BKNA1-INDTYP NE NODATA.\n    CLEAR FT.\n  ENDIF.\nENDENHANCEMENT.';
const contentPath = (revision: string) => `${includeBase}/source/main/versions/19700101091123/${revision}/content`;

/** Active version 00000 listed after a historical entry, as SAP orders a feed with history. */
const feed = `<?xml version="1.0" encoding="utf-8"?><atom:feed xmlns:atom="http://www.w3.org/2005/Atom" xmlns:adtcore="http://www.sap.com/adt/core"><atom:title>Version List of ${include} (REPS)</atom:title><atom:updated>1970-01-01T09:11:23Z</atom:updated><atom:entry><atom:author><atom:name>DEVELOPER</atom:name></atom:author><atom:content type="text/plain" src="${contentPath('00001')}"/><atom:id>00001</atom:id><atom:updated>2026-03-01T10:00:00Z</atom:updated></atom:entry><atom:entry><atom:author><atom:name>DEVELOPER</atom:name></atom:author><atom:content type="text/plain" src="${contentPath('00000')}"/><atom:id>00000</atom:id><atom:link adtcore:name="A4HK900123" href="/sap/bc/adt/cts/transportrequests/A4HK900123" rel="http://www.sap.com/adt/relations/transport/request" type="application/vnd.sap.adt.transportrequests.v1+xml" title="Customer master fields"/><atom:title>Customer master fields</atom:title><atom:updated>2026-03-24T16:30:58Z</atom:updated></atom:entry></atom:feed>`;
const emptyFeed = `<?xml version="1.0" encoding="utf-8"?><atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:title>Version List of ${include} (REPS)</atom:title><atom:updated>1970-01-01T09:11:23Z</atom:updated></atom:feed>`;

const searchHit = (type: string, collection: string) =>
  `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:name="${name}" adtcore:type="${type}" adtcore:uri="/sap/bc/adt/enhancements/${collection}/${name.toLowerCase()}" adtcore:packageName="ZLES"/></adtcore:objectReferences>`;

describe('SAPRead ENHO: source plug-ins via the enhancement include (SAP_BASIS 750)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCachedFeatures();
  });

  function setup(
    opts: {
      subtype?: string;
      genericStatus?: number;
      genericBody?: string;
      feedStatus?: number;
      feedBody?: string;
      contentStatus?: number;
      contentBody?: string;
    } = {},
  ) {
    const calls: string[] = [];
    const collection = opts.subtype === 'ENHO/XHH' ? 'enhoxhh' : 'enhoxh';
    mockFetch.mockImplementation(async (url: string, init: { method?: string; headers?: Record<string, string> }) => {
      if (String(url).includes('/discovery')) return mockResponse(200, '', { 'x-csrf-token': 'T' });
      expect(init.method ?? 'GET').toBe('GET');
      const path = new URL(String(url)).pathname;
      calls.push(path);
      if (path.includes('informationsystem/search'))
        return mockResponse(200, searchHit(opts.subtype ?? 'ENHO/XH', collection));
      if (path.includes('/enhoxhb/')) return mockResponse(404, 'not a BAdI implementation');
      if (path.includes(`/${collection}/`))
        return mockResponse(
          opts.genericStatus ?? 500,
          opts.genericBody ?? '<exception><type id="ExceptionResourceReadFailure"/></exception>',
        );
      if (path === `${includeBase}/source/main/versions`) {
        expect(init.headers?.Accept).toBe('application/atom+xml;type=feed');
        return mockResponse(opts.feedStatus ?? 200, opts.feedBody ?? feed);
      }
      if (path === contentPath('00000')) {
        expect(init.headers?.Accept).toBe('text/plain');
        return mockResponse(opts.contentStatus ?? 200, opts.contentStatus ? 'denied' : (opts.contentBody ?? source));
      }
      throw new Error(`unexpected request ${path}`);
    });
    return calls;
  }

  const read = () => handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'ENHO', name });

  it.each([
    [
      '750',
      '<exception><type id="ExceptionInternalServerError"/><message>Enhancement technology CLASENH is not supported yet.</message></exception>',
    ],
    ['758', '<span id="msgText">Dereferencing of the NULL reference </span>'],
  ])('passes the probed %s release to the qualified public ENHO fallback', async (release, genericBody) => {
    const calls = setup({ genericBody });
    setCachedFeatures({ abapRelease: release });
    expect((await read()).isError).toBeUndefined();
    expect(calls.at(-1)).toBe(contentPath('00000'));
    setup({ genericBody });
    setCachedFeatures({ abapRelease: '920' });
    expect((await read()).isError).toBe(true);
  });

  it('reads the active revision of the enhancement include after the generic route fails', async () => {
    const calls = setup();
    const result = await read();
    expect(result.isError, result.content[0]?.text).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(data).toMatchObject({
      name,
      technology: '',
      source,
      badiImplementations: [],
      enhancementInclude: {
        name: include,
        revision: { id: '00000', author: 'DEVELOPER', timestamp: '2026-03-24T16:30:58Z', transport: 'A4HK900123' },
      },
    });
    expect(data.note).toContain('enhancement include');
    expect(data).not.toHaveProperty('switchSupported');
    expect(data.note).not.toContain('this SAP release');
    expect(calls).toEqual([
      `/sap/bc/adt/enhancements/enhoxhb/${name}`,
      '/sap/bc/adt/repository/informationsystem/search',
      `/sap/bc/adt/enhancements/enhoxh/${name}`,
      `${includeBase}/source/main/versions`,
      contentPath('00000'),
    ]);
  });

  it('leaves the technology empty because the include does not identify it', async () => {
    setup({ contentBody: '* generated, no ENHANCEMENT block' });
    const result = await read();
    expect(result.isError, result.content[0]?.text).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(data.technology).toBe('');
    expect(data.note).toContain('class enhancement');
    expect(data.source).toContain('no ENHANCEMENT block');
  });

  it.each([
    { feedStatus: 404, label: 'no revision feed' },
    { feedBody: emptyFeed, label: 'an empty revision feed' },
    { feedBody: '<html>not a feed</html>', label: 'an invalid revision feed' },
  ])('keeps the SAP failure and names every attempted route for $label', async (opts) => {
    setup(opts);
    const result = await read();
    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('500');
    expect(text).toContain('enhoxhb, enhoxh');
    expect(text).toContain(`programs/includes/${include}/source/main/versions`);
    expect(text).toContain('SE80');
  });

  it('propagates a denied revision content read instead of guessing further', async () => {
    const calls = setup({ contentStatus: 403 });
    const result = await read();
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('403');
    expect(result.content[0]?.text).not.toContain('SE80');
    expect(calls.at(-1)).toBe(contentPath('00000'));
  });

  it('does not try the include route after a hook-implementation (XHH) failure', async () => {
    const calls = setup({ subtype: 'ENHO/XHH', genericStatus: 500 });
    const result = await read();
    expect(result.isError).toBe(true);
    expect(calls.some((path) => path.includes('/versions'))).toBe(false);
  });
});

describe('enhancement include names', () => {
  it('pads the implementation name to 30 characters with = and appends E', () => {
    expect(enhancementIncludeName('zd0120_fuellen')).toBe('ZD0120_FUELLEN================E');
    expect(enhancementIncludeName('/SAPMP/ORDCOMB_PP_SAPLKOBS')).toBe('/SAPMP/ORDCOMB_PP_SAPLKOBS====E');
    expect(enhancementIncludeName('Z_THIRTY_CHARACTER_NAME_000000')).toBe('Z_THIRTY_CHARACTER_NAME_000000E');
    expect(enhancementIncludeName('ZD0120_FUELLEN')).toHaveLength(31);
  });

  it('recognizes only padded enhancement include names', () => {
    expect(isEnhancementIncludeName('ZD0120_FUELLEN================E')).toBe(true);
    expect(isEnhancementIncludeName('/sapmp/ordcomb_pp_saplkobs====e')).toBe(true);
    expect(isEnhancementIncludeName('ZCO_COMP')).toBe(false);
    expect(isEnhancementIncludeName('ZCO_COMP======================')).toBe(false);
    expect(isEnhancementIncludeName('Z_THIRTY_CHARACTER_NAME_000000E')).toBe(false);
    expect(isEnhancementIncludeName('LZCO_COMPTOP')).toBe(false);
  });
});

describe('SAPRead INCL on an enhancement include', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCachedFeatures();
  });

  function setup(
    opts: { directStatus?: number; directBody?: string; name?: string; context?: boolean; contentBody?: string } = {},
  ) {
    const calls: string[] = [];
    const target = opts.name ?? include;
    const base = `/sap/bc/adt/programs/includes/${encodeURIComponent(target)}`;
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('/discovery')) return mockResponse(200, '', { 'x-csrf-token': 'T' });
      const path = new URL(String(url)).pathname;
      calls.push(path);
      if (path === `${base}/source/main`)
        return mockResponse(
          opts.directStatus ?? 500,
          opts.directBody ?? '<exception><type id="ExceptionResourceReadFailure"/></exception>',
        );
      if (path === `${base}/source/main/versions`) return mockResponse(200, feed);
      if (path === contentPath('00000')) return mockResponse(200, opts.contentBody ?? source);
      if (opts.context && path.toUpperCase() === base.toUpperCase())
        return mockResponse(
          200,
          `<include name="${include}" type="PROG/I" version="active"><link rel="http://www.sap.com/adt/relations/enhancements" href="source/main/enhancements/elements"/></include>`,
        );
      if (opts.context && path.endsWith('/enhancements/elements')) return mockResponse(200, '<enhancements/>');
      if (opts.context && path.toUpperCase() === '/SAP/BC/ADT/PROGRAMS/PROGRAMS/ZROOT')
        return mockResponse(200, '<program name="ZROOT" type="PROG/P" version="active"/>');
      throw new Error(`unexpected request ${path}`);
    });
    return calls;
  }

  it('keeps the active draft warning with revision provenance', async () => {
    setup();
    const client = createClient();
    vi.spyOn(client, 'getInactiveObjects').mockResolvedValue([{ name: include, type: 'PROG/I', uri: includeBase }]);
    const result = await handleToolCall(
      client,
      DEFAULT_CONFIG,
      'SAPRead',
      { type: 'INCL', name: include, extensions: 'none' },
      undefined,
      undefined,
      new CachingLayer(new MemoryCache()),
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('LAST ACTIVATED');
    expect(result.content[0]?.text).toContain('Source read from active revision 00000');
  });
  it('reuses fallback source for context-bound discovery without retrying its failed source route', async () => {
    const calls = setup({ context: true });
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'INCL',
      name: include,
      extensions: 'sources',
      enhancementContext: { type: 'PROG', name: 'ZROOT' },
    });
    expect(result.isError).toBeUndefined();
    expect(calls.filter((path) => path === `${includeBase}/source/main`)).toHaveLength(1);
    expect(result.content[1]?.text).not.toContain('provider_read_failed');
  });
  it('reports generated references in a context-bound fallback as unqualified without child reads', async () => {
    const calls = setup({ context: true, contentBody: `INCLUDE ${include}M001.` });
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'INCL',
      name: include,
      extensions: 'sources',
      enhancementContext: { type: 'PROG', name: 'ZROOT' },
    });
    expect(result.isError).toBeUndefined();
    const summary = JSON.parse(result.content[1]!.text.slice('[extensions] '.length));
    expect(summary.providers[0].status).toBe('incomplete');
    expect(summary.omissions.sources).toBe(1);
    expect(summary.issues).toContain('generated_include_references_unqualified');
    expect(calls.filter((path) => path === `${includeBase}/source/main`)).toHaveLength(1);
    expect(calls.some((path) => path.includes(`${encodedInclude}M001`))).toBe(false);
  });
  it('uses a matching probed release for a qualified direct include failure', async () => {
    const calls = setup({ directBody: '<span id="msgText">Dereferencing of the NULL reference </span>' });
    setCachedFeatures({ abapRelease: '758' });
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'INCL', name: include });
    expect(result.isError).toBeUndefined();
    expect(calls.at(-1)).toBe(contentPath('00000'));
  });

  it('returns the active revision with a provenance note when the direct read fails', async () => {
    const calls = setup();
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'INCL', name: include });
    expect(result.isError, result.content[0]?.text).toBeUndefined();
    expect(result.content[0]?.text).toContain('Source read from active revision 00000');
    expect(result.content[0]?.text).toContain('transport A4HK900123');
    expect(result.content[0]?.text).toContain(source);
    expect(calls).toEqual([`${includeBase}/source/main`, `${includeBase}/source/main/versions`, contentPath('00000')]);
  });

  it('greps the fallback source and keeps the note', async () => {
    setup();
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'INCL',
      name: include,
      grep: 'INDTYP',
    });
    expect(result.isError, result.content[0]?.text).toBeUndefined();
    expect(result.content[0]?.text).toContain('BKNA1-INDTYP');
    expect(result.content[0]?.text).toContain('Source read from active revision 00000');
  });

  it('leaves ordinary includes and inactive reads on the direct route', async () => {
    const ordinary = setup({ name: 'LZCO_COMPTOP' });
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'INCL',
      name: 'LZCO_COMPTOP',
    });
    expect(result.isError).toBe(true);
    expect(ordinary.some((path) => path.includes('/versions'))).toBe(false);

    const inactive = setup();
    const draft = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'INCL',
      name: include,
      version: 'inactive',
    });
    expect(draft.isError).toBe(true);
    expect(inactive.some((path) => path.includes('/versions'))).toBe(false);
  });
});
