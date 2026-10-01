import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { parseEnhancementImplementation } = await import('../../../src/adt/xml-parser.js');
const { parseEnhancementMetadata } = await import('../../../src/adt/enhancements.js');
const hook = readFileSync(new URL('../../fixtures/xml/enhancement-hook.xml', import.meta.url), 'utf8');
const badi = readFileSync(new URL('../../fixtures/xml/enhancement-implementation.xml', import.meta.url), 'utf8');
const name = '/MFND/CORE_UPD_BDS_CONNECTION';
const source = "ENHANCEMENT 1.\nWRITE 'sentinel &amp;'.\nENDENHANCEMENT.";
const base = '/sap/bc/adt/enhancements/';

describe('SAPRead ENHO subtype routing', () => {
  beforeEach(() => vi.resetAllMocks());

  function setup(
    opts: {
      firstStatus?: number;
      type?: string;
      metadata?: string;
      sourceStatus?: number;
      matchedName?: string;
      lookupStatus?: number;
      fallbackStatus?: number;
      uri?: string;
      duplicateType?: string;
    } = {},
  ) {
    const calls: string[] = [];
    mockFetch.mockImplementation(async (url: string, init: { method?: string; headers?: Record<string, string> }) => {
      if (String(url).includes('/discovery')) return mockResponse(200, '', { 'x-csrf-token': 'T' });
      expect(init.method ?? 'GET').toBe('GET');
      const path = new URL(String(url)).pathname;
      calls.push(path);
      if (path.includes('informationsystem/search'))
        return mockResponse(
          opts.lookupStatus ?? 200,
          `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:name="${opts.matchedName ?? name}" adtcore:type="${opts.type ?? 'ENHO/XHH'}" adtcore:uri="${opts.uri ?? 'https://other.invalid/never-follow'}"/>${opts.duplicateType ? `<adtcore:objectReference adtcore:name="${name}" adtcore:type="${opts.duplicateType}"/>` : ''}</adtcore:objectReferences>`,
        );
      if (path.includes('/enhoxhb/')) return mockResponse(opts.firstStatus ?? 400, 'wrong transformation');
      if (path.endsWith('/source/main')) {
        expect(init.headers?.Accept).toBe('text/plain');
        return mockResponse(opts.sourceStatus ?? 200, opts.sourceStatus ? 'source denied' : source);
      }
      if (path.includes('/enhoxhh/')) expect(init.headers?.Accept).toBe('application/vnd.sap.adt.enh.enhoxhh.v3+xml');
      if (path.includes('/enhoxh/')) expect(init.headers?.Accept).toBe('application/vnd.sap.adt.enh.enho.v1+xml');
      return mockResponse(opts.fallbackStatus ?? 200, opts.metadata ?? hook);
    });
    return calls;
  }

  async function read(minimalErrors = false) {
    return handleToolCall(createClient(), { ...DEFAULT_CONFIG, minimalErrors }, 'SAPRead', { type: 'ENHO', name });
  }

  it.each([undefined, 'auto'])('keeps BAdI metadata and the single GET unchanged (version=%s)', async (version) => {
    mockFetch.mockResolvedValue(mockResponse(200, badi));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'ENHO',
      name: 'SFW_BCF_TCD',
      version,
    });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text)).toEqual(parseEnhancementImplementation(badi));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each([400, 404, 500])(
    'resolves XHH after HTTP %s and includes its source and hook positions',
    async (firstStatus) => {
      const calls = setup({ firstStatus });
      const result = await read();
      expect(result.isError, result.content[0]?.text).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text);
      expect(data).toMatchObject({
        name,
        technology: 'HOOK_IMPL',
        source,
        enhancedObject: { name: 'BDS_CONNECTIONS', type: 'FUGR/F' },
        hookImplementations: [
          {
            id: '1',
            programName: 'SAPLBDS_CONNECTIONS',
            overwrite: false,
            fullName: '\\FU:BDS_CONNECTION_CREATE\\SE:END\\EI',
            uri: expect.stringContaining('#start=134,0'),
          },
        ],
      });
      expect(calls).toEqual([
        `${base}enhoxhb/${encodeURIComponent(name)}`,
        '/sap/bc/adt/repository/informationsystem/search',
        `${base}enhoxhh/${encodeURIComponent(name)}`,
        `${base}enhoxhh/${encodeURIComponent(name)}/source/main`,
      ]);
    },
  );

  it('reads legacy XH BAdI metadata without inventing a source endpoint', async () => {
    const calls = setup({
      firstStatus: 404,
      type: 'ENHO/XH',
      matchedName: `${name} (Enhancement Implementation)`,
      uri: `${base}enhoxh/${encodeURIComponent(name).toLowerCase()}`,
      metadata: badi.replaceAll('enho:active=', 'enho:isActive=').replaceAll('enho:default=', 'enho:isDefault='),
    });
    const result = await read();
    expect(result.isError, result.content[0]?.text).toBeUndefined();
    const data = JSON.parse(result.content[0]!.text);
    expect(data.badiImplementations[0]).toMatchObject({ active: true, default: false });
    expect(data.badiImplementations[1]).toMatchObject({ active: false, default: true });
    expect(calls).toHaveLength(3);
    expect(calls[2]).toContain('/enhoxh/');
  });

  it.each([false, true])('preserves SAP failures and actionable guidance (minimal=%s)', async (minimal) => {
    setup({ type: 'ENHO/XH', fallbackStatus: 500, metadata: 'private diagnostic' });
    const result = await read(minimal);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('500');
    expect(result.content[0]?.text).toContain('enhoxhb');
    expect(result.content[0]?.text).toContain('enhoxh');
    expect(result.content[0]?.text).toContain('SE80');
    if (minimal) expect(result.content[0]?.text).not.toContain('private diagnostic');
  });

  it('does not turn a failed source read into successful metadata-only output', async () => {
    const calls = setup({ sourceStatus: 403 });
    const result = await read();
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('403');
    expect(calls.at(-1)).toContain('/source/main');
  });

  it.each([401, 403, 429, 503])(
    'does not reroute authentication, authorization or transient HTTP %s',
    async (firstStatus) => {
      const calls = setup({ firstStatus });
      const result = await read();
      expect(result.isError).toBe(true);
      // HTTP transport may retry, but no subtype lookup or alternate collection is allowed.
      expect(calls.every((path) => path.includes('/enhoxhb/'))).toBe(true);
    },
  );

  it.each([
    { type: 'ENHO/UNKNOWN' },
    { type: 'ENHO/XHB' },
    { type: 'PROG/P' },
    { matchedName: 'OTHER' },
    { duplicateType: 'ENHO/XH' },
    { matchedName: `${name} (Enhancement Implementation)`, uri: `${base}enhoxhh/OTHER` },
    {
      matchedName: `${name} (Enhancement Implementation)`,
      uri: `https://other.invalid${base}enhoxhh/${encodeURIComponent(name)}`,
    },
  ])('does not guess a fallback for %j', async (opts) => {
    const calls = setup(opts);
    expect((await read()).isError).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('propagates a denied repository lookup', async () => {
    const calls = setup({ lookupStatus: 403 });
    const result = await read();
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('403');
    expect(calls).toHaveLength(2);
  });

  it.each(['active', 'inactive'])('refuses unsupported explicit version=%s before reading', async (version) => {
    mockFetch.mockResolvedValue(mockResponse(200, badi));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'ENHO', name, version });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('ENHO does not support explicit version selection');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not confuse a wrong response with metadata', async () => {
    const calls = setup({ metadata: '<html>not an enhancement</html>' });
    expect((await read()).isError).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it('constructs the hook source URL instead of following sourceUri', async () => {
    const calls = setup({
      metadata: hook.replace(/abapsource:sourceUri="[^"]+"/, 'abapsource:sourceUri="https://other.invalid/source"'),
    });
    expect((await read()).isError).toBeUndefined();
    expect(calls.at(-1)).toBe(`${base}enhoxhh/${encodeURIComponent(name)}/source/main`);
  });

  it('keeps empty, single and repeated hook entries and decodes their attributes once', () => {
    const node = hook.match(/<enho:hookImplementation[\s\S]*?<\/enho:hookImplementation>/)![0];
    const extra = node
      .replace('enho:id="1"', 'enho:id="2"')
      .replace('enho:overwrite=""', 'enho:overwrite="true"')
      .replace('enho:spotname=""', 'enho:spotname="R&amp;amp;D"');
    expect(parseEnhancementMetadata(hook.replace(node, '')).hookImplementations).toEqual([]);
    expect(parseEnhancementMetadata(hook.replace(node, node + extra)).hookImplementations).toMatchObject([
      { id: '1', overwrite: false },
      { id: '2', overwrite: true, spotName: 'R&amp;D' },
    ]);
    expect(
      parseEnhancementMetadata(hook.replace('enho:overwrite=""', 'enho:overwrite="X"')).hookImplementations?.[0]
        ?.overwrite,
    ).toBe(true);
  });
});
