import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/class-extensions/${name}`, import.meta.url), 'utf8');
const name = 'CL_OO_ADT_ENHANCED_CLASS';
const uri = `/sap/bc/adt/oo/classes/${name.toLowerCase()}`;
const source = `CLASS ${name} DEFINITION PUBLIC. PUBLIC SECTION. METHODS demo. ENDCLASS.\nCLASS ${name} IMPLEMENTATION. METHOD demo. WRITE 'unchanged'. ENDMETHOD. ENDCLASS.`;
const metadata = `<abapClass name="${name}" type="CLAS/OC" version="active"><include includeType="main" sourceUri="source/main"><link rel="http://www.sap.com/adt/relations/enhancements" href="source/main/enhancements/elements"/></include><include includeType="definitions" sourceUri="includes/definitions"><link rel="http://www.sap.com/adt/relations/enhancements" href="includes/definitions/enhancements/elements"/></include></abapClass>`;
const summary = (result: Awaited<ReturnType<typeof handleToolCall>>) =>
  JSON.parse(result.content[1]!.text.slice('[extensions] '.length));

function setup(nativeStatus = 200) {
  const calls: string[] = [];
  mockFetch.mockImplementation(async (raw: string, init: { method?: string; headers?: Record<string, string> }) => {
    const url = new URL(String(raw));
    const path = url.pathname.toLowerCase();
    calls.push(`${init.method ?? 'GET'} ${path}`);
    if (path.endsWith('/discovery')) return mockResponse(200, '', { 'x-csrf-token': 'TEST' });
    if (init.method === 'POST')
      return mockResponse(nativeStatus, nativeStatus === 200 ? fixture('class-exted.xml') : 'terminal');
    if (path === `${uri}/source/main`) return mockResponse(200, source);
    if (path === `${uri}/includes/definitions`) return mockResponse(200, '" unchanged definitions\n');
    if (path === uri) return mockResponse(200, metadata);
    if (path.endsWith('/enhancements/elements')) return mockResponse(200, '<enhancements/>');
    if (path.includes('/enhoxh/'))
      return mockResponse(500, '<span id="msgText">Dereferencing of the NULL reference </span>');
    if (path.endsWith('/versions')) {
      expect(init.headers?.Accept).toBe('application/atom+xml;type=feed');
      return mockResponse(200, fixture(path.includes('em001/') ? 'method-feed.xml' : 'class-feed.xml'));
    }
    if (path.endsWith('/00000/content'))
      return mockResponse(
        200,
        path.includes('em001/') ? '  METHOD enh_method.\n  ENDMETHOD.' : fixture('class-generated.abap'),
      );
    throw new Error('Unexpected class fixture read');
  });
  const client = createClient();
  const read = (args: Record<string, unknown> = {}) =>
    handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', { type: 'CLAS', name, ...args });
  return { calls, client, read };
}
beforeEach(() => {
  vi.resetAllMocks();
  resetCachedFeatures();
  setCachedFeatures({ abapRelease: '758' });
});
describe('SAPRead class extensions', () => {
  it.each(['definitions', 'DEFINITIONS'])('selects the actual hook section for include=%s', async (include) => {
    const s = setup();
    const result = await s.read({ include, extensions: 'summary' });
    expect(result.isError).toBeUndefined();
    expect(s.calls).toContain(`GET ${uri}/includes/definitions/enhancements/elements`);
    expect(summary(result).providers.find((p: { id: string }) => p.id === 'source_plugins')).toMatchObject({
      status: 'returned',
      reason: expect.stringContaining('class_section=definitions'),
    });
  });

  it.each([undefined, ''])('normalizes include=%j to the main hook scope', async (include) => {
    const s = setup();
    const result = await s.read({ include });
    expect(result.isError).toBeUndefined();
    expect(s.calls).toContain(`GET ${uri}/source/main/enhancements/elements`);
    expect(summary(result).providers.find((p: { id: string }) => p.id === 'source_plugins').reason).toContain(
      'class_section=main',
    );
  });
  it.each(['definitions,implementations', ' Definitions '])(
    'keeps the public schema rejection for include=%s',
    async (include) => {
      const s = setup();
      const result = await s.read({ include, extensions: 'summary' });
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Invalid include value');
      expect(s.calls).toEqual([]);
    },
  );
  it('keeps none-mode legacy result and defaults a full read to a separate summary', async () => {
    const s = setup();
    const legacy = await s.read({ extensions: 'none' });
    expect(legacy).toEqual({ content: [{ type: 'text', text: source }] });
    expect(s.calls).toEqual([`GET ${uri}/source/main`]);
    const result = await s.read();
    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toEqual(legacy.content[0]);
    expect(summary(result).identities).toContainEqual(
      expect.objectContaining({ name: `${name}1`, family: 'class_bound_enhancement' }),
    );
    expect(result.content.slice(1).reduce((n, b) => n + Buffer.byteLength(b.text), 0)).toBeLessThanOrEqual(2048);
    expect(s.calls.some((path) => path.includes('/versions'))).toBe(false);
  });
  it('returns the unchanged base and separate generated parent/actual child sources', async () => {
    const s = setup();
    const result = await s.read({ extensions: 'sources' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe(source);
    expect(
      result.content.filter((block) => block.text.includes('representation=generated_include_revision')),
    ).toHaveLength(2);
    expect(result.content.some((block) => block.text.endsWith(fixture('class-generated.abap')))).toBe(true);
    expect(result.content.slice(1).reduce((n, b) => n + Buffer.byteLength(b.text), 0)).toBeLessThanOrEqual(16384);
    expect(summary(result).consumed.sends).toBeLessThanOrEqual(20);
  });
  it('defaults grep, method and local-section reads to none; explicit coverage names the selected section', async () => {
    for (const args of [{ grep: 'WRITE' }, { method: 'demo' }, { include: 'definitions' }]) {
      const s = setup();
      const result = await s.read(args);
      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(s.calls.some((path) => path.includes('objectrelations'))).toBe(false);
    }
    const s = setup();
    const result = await s.read({ include: 'definitions', extensions: 'summary' });
    expect(result.content[0]?.text).toBe('=== definitions ===\n" unchanged definitions\n');
    expect(summary(result).scope).toContain('section=definitions');
    expect(summary(result).providers.find((p: { id: string }) => p.id === 'source_plugins').reason).toContain(
      'class_section=definitions',
    );
    expect(s.calls.some((path) => path.includes('/source/main/enhancements'))).toBe(false);
  });
  it.each([401, 403, 429])(
    'retains the base after terminal optional HTTP %s and stops source fallback',
    async (status) => {
      const s = setup(status);
      const result = await s.read({ extensions: 'sources' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toBe(source);
      expect(
        summary(result).providers.some((p: { status: string }) => p.status === 'denied' || p.status === 'incomplete'),
      ).toBe(true);
      expect(s.calls.some((path) => path.includes('/versions') || path.includes('/enhoxh/'))).toBe(false);
    },
  );
  it('keeps inactive coverage unsupported and hidden ENHO denials outside the base result', async () => {
    const s = setup();
    const inactive = await s.read({ version: 'inactive', extensions: 'sources' });
    expect(inactive.isError).toBeUndefined();
    expect(inactive.content[0]?.text).toContain(source);
    expect(
      summary(inactive).providers.every((p: { reason: string }) => p.reason?.includes('unsupported_version')),
    ).toBe(true);
    expect(s.calls.filter((path) => path.includes('/source/main'))).toHaveLength(1);
    expect(s.calls.some((path) => path.includes('objectrelations') || path.includes('/versions'))).toBe(false);
    const denied = setup();
    denied.client.safety.denyActions.push('SAPRead.ENHO');
    const result = await denied.read();
    expect(result.content[0]?.text).toBe(source);
    expect(summary(result).providers[0].status).toBe('denied');
    expect(denied.calls).toHaveLength(1);
  });
  it('reports interface ENV fallback as unsupported context without exposing dependencies', async () => {
    const s = setup();
    mockFetch.mockImplementation(async (raw: string, init: { method?: string }) => {
      const path = new URL(String(raw)).pathname;
      if (path.endsWith('/discovery')) return mockResponse(200, '', { 'x-csrf-token': 'TEST' });
      if (init.method === 'POST') return mockResponse(200, fixture('interface-env.xml'));
      if (path.endsWith('/source/main')) return mockResponse(200, 'INTERFACE if_dsh_enhanced_options. ENDINTERFACE.');
      return mockResponse(200, '<abapInterface name="IF_DSH_ENHANCED_OPTIONS" type="INTF/OI" version="active"/>');
    });
    const result = await s.read({ type: 'INTF', name: 'IF_DSH_ENHANCED_OPTIONS', extensions: 'sources' });
    expect(result.isError).toBeUndefined();
    expect(summary(result).identities).toEqual([]);
    expect(summary(result).providers[0]).toMatchObject({ status: 'unsupported', reason: 'unsupported_context' });
    expect(
      result.content
        .slice(1)
        .map((b) => b.text)
        .join(''),
    ).not.toContain('IF_BADI_INTERFACE');
  });
});
