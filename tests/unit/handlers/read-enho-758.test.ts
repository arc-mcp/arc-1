import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { enhancementIncludeName } = await import('../../../src/adt/enhancement-include.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');

const name = 'CL_OO_ADT_ENHANCED_CLASS1';
const include = enhancementIncludeName(name);
const base = `/sap/bc/adt/programs/includes/${encodeURIComponent(include)}/source/main/versions`;
const content = `${base}/19700101091123/00000/content`;
const search = '/sap/bc/adt/repository/informationsystem/search';
const components = '/sap/bc/adt/system/components';
const syntax = '/sap/bc/adt/abapsource/syntax/configurations';
const source = 'ENHANCEMENT 1.\nENDENHANCEMENT.';
const reference = (type = 'ENHO/XH', objectName = name) =>
  `<adtcore:objectReference adtcore:name="${objectName}" adtcore:type="${type}"/>`;
const feed = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Version List of ${include} (REPS)</title><entry><id>00000</id><content type="text/plain" src="${content}"/></entry></feed>`;
const badi = readFileSync(new URL('../../fixtures/xml/enhancement-implementation.xml', import.meta.url), 'utf8');
const hook = readFileSync(new URL('../../fixtures/xml/enhancement-hook.xml', import.meta.url), 'utf8');

describe('direct ENHO reads avoid unsafe metadata probes on 758', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCachedFeatures();
    setCachedFeatures({ abapRelease: '758' });
  });

  function setup(
    opts: {
      references?: string;
      detectedRelease?: string;
      syntaxRelease?: string;
      legacyBadi?: boolean;
      searchStatus?: number;
      feedBody?: string;
      feedStatus?: number;
      contentStatus?: number;
      networkFailure?: boolean;
      subtype?: 'ENHO/XHB' | 'ENHO/XHH';
    } = {},
  ) {
    const calls: string[] = [];
    mockFetch.mockImplementation(async (url: string) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/discovery')) return mockResponse(200, '', { 'x-csrf-token': 'T' });
      calls.push(path);
      if (path === components)
        return mockResponse(
          200,
          opts.detectedRelease
            ? `<feed><entry><id>SAP_BASIS</id><title>${opts.detectedRelease};SP02;2;Basis</title></entry></feed>`
            : '<feed/>',
        );
      if (path === syntax)
        return mockResponse(
          200,
          opts.syntaxRelease
            ? `<syntaxConfigurations><syntaxConfiguration><language><version>X</version><link etag="${opts.syntaxRelease}"/></language></syntaxConfiguration></syntaxConfigurations>`
            : '<syntaxConfigurations/>',
        );
      if (path === search)
        return mockResponse(
          opts.searchStatus ?? 200,
          `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">${opts.references ?? reference(opts.subtype)}</adtcore:objectReferences>`,
        );
      if (opts.legacyBadi && path.includes('/enhoxhb/')) return mockResponse(404, 'legacy route only');
      if (opts.legacyBadi && path.includes('/enhoxh/')) return mockResponse(200, badi);
      if (path === base) {
        if (opts.networkFailure) throw new TypeError('socket hang up');
        return mockResponse(opts.feedStatus ?? 200, opts.feedBody ?? feed);
      }
      if (path === content) return mockResponse(opts.contentStatus ?? 200, source);
      if (opts.subtype === 'ENHO/XHB' && path.includes('/enhoxhb/')) return mockResponse(200, badi);
      if (opts.subtype === 'ENHO/XHH' && path.includes('/enhoxhh/'))
        return mockResponse(200, path.endsWith('/source/main') ? source : hook);
      throw new Error(`Unsafe or unexpected metadata request: ${path}`);
    });
    return calls;
  }

  const read = (config = DEFAULT_CONFIG, denied: string[] = []) => {
    const client = createClient();
    client.safety.denyActions = denied;
    return handleToolCall(client, config, 'SAPRead', { type: 'ENHO', name });
  };

  it.each(['758', '7.58'])('reads only search and the active generated revision on %s', async (release) => {
    setCachedFeatures({ abapRelease: release });
    const calls = setup();
    const result = await read();
    expect(result.isError, result.content[0]?.text).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(data).toMatchObject({
      name,
      source,
      technology: '',
      enhancementInclude: { name: include, revision: { id: '00000' } },
    });
    expect(data).not.toHaveProperty('switchSupported');
    expect(data.note).toContain('metadata');
    expect(data.note).not.toContain('read failed');
    expect(calls).toEqual([search, base, content]);
  });

  it('uses the configured release until the probe completes', async () => {
    resetCachedFeatures();
    const calls = setup();
    expect((await read({ ...DEFAULT_CONFIG, abapRelease: '758' })).isError).toBeUndefined();
    expect(calls).toEqual([search, base, content]);
  });

  it.each([{ detectedRelease: '758' }, { syntaxRelease: '758' }])(
    'detects the release before routing a public client read: %j',
    async (opts) => {
      resetCachedFeatures();
      const calls = setup(opts);
      const result = await createClient().getEnhancementImplementation(name);
      expect(result.source).toBe(source);
      expect(calls).toEqual([components, ...(!opts.detectedRelease ? [syntax] : []), search, base, content]);
    },
  );

  it('preserves legacy BAdI reads when a public client detects 750', async () => {
    resetCachedFeatures();
    const calls = setup({ detectedRelease: '750', legacyBadi: true });
    const result = await createClient().getEnhancementImplementation(name);
    expect(result.technology).toBe('BADI_IMPL');
    expect(result.badiImplementations).toHaveLength(2);
    expect(calls).toEqual([
      components,
      `/sap/bc/adt/enhancements/enhoxhb/${name}`,
      search,
      `/sap/bc/adt/enhancements/enhoxh/${name}`,
    ]);
  });

  it('prefers the probed release over configuration', async () => {
    const calls = setup();
    expect((await read({ ...DEFAULT_CONFIG, abapRelease: '750' })).isError).toBeUndefined();
    expect(calls).toEqual([search, base, content]);
  });

  it('stops before metadata or source when XH release is unknown', async () => {
    resetCachedFeatures();
    const calls = setup();
    const result = await read();
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('release');
    expect(result.content[0]?.text).toContain('retry');
    expect(calls).toEqual([components, syntax, search]);
  });

  it.each(['ENHO/XHB', 'ENHO/XHH'] as const)(
    'reads the exact %s route with known or unknown release',
    async (subtype) => {
      for (const release of ['758', undefined]) {
        resetCachedFeatures();
        if (release) setCachedFeatures({ abapRelease: release });
        const calls = setup({ subtype });
        const result = await read();
        expect(result.isError, result.content[0]?.text).toBeUndefined();
        const data = JSON.parse(result.content[0]!.text);
        expect(data.technology).toBe(subtype === 'ENHO/XHB' ? 'BADI_IMPL' : 'HOOK_IMPL');
        expect(calls).toEqual([
          ...(!release ? [components, syntax] : []),
          search,
          `/sap/bc/adt/enhancements/${subtype === 'ENHO/XHB' ? 'enhoxhb' : 'enhoxhh'}/${name}`,
          ...(subtype === 'ENHO/XHH' ? [`/sap/bc/adt/enhancements/enhoxhh/${name}/source/main`] : []),
        ]);
      }
    },
  );

  it.each(['', reference('ENHO/XH', 'OTHER'), reference() + reference('ENHO/XHB'), reference('ENHO/UNKNOWN')])(
    'never probes metadata without one exact subtype (%s)',
    async (references) => {
      const calls = setup({ references });
      expect((await read()).isError).toBe(true);
      expect(calls).toEqual([search]);
    },
  );

  it.each([
    { feedStatus: 404 },
    { feedBody: '<html>not a feed</html>' },
    { feedBody: feed.replace(include, 'OTHER') },
    { feedBody: feed.replace('<id>00000</id>', '<id>00001</id>') },
    { feedBody: feed.replace(content, '/sap/bc/adt/oo/classes/other/source/main') },
  ])('does not retry unsafe metadata when active source is unavailable: %j', async (opts) => {
    const calls = setup(opts);
    const result = await read();
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('SE80');
    expect(calls).toEqual([search, base]);
  });

  it.each([
    { searchStatus: 403 },
    { feedStatus: 403 },
    { contentStatus: 403 },
    { feedStatus: 429 },
    { networkFailure: true },
  ])('propagates permission, throttle and network errors: %j', async (opts) => {
    const calls = setup(opts);
    const result = await read();
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      opts.networkFailure ? 'network' : String(opts.searchStatus ?? opts.feedStatus ?? opts.contentStatus),
    );
    expect(calls.every((path) => path === search || path.startsWith(base))).toBe(true);
  });

  it.each(['INCL', 'VERSIONS', 'VERSION_SOURCE'])('respects the SAPRead.%s deny rule', async (type) => {
    const calls = setup();
    const result = await read(DEFAULT_CONFIG, [`SAPRead.${type}`]);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('denied');
    expect(calls).toEqual([search]);
  });
});
