/**
 * SAPRead type=GENERATORS and SAPWrite action=generate (issue #1121) against the captured
 * ADT 3.60 traffic (tests/fixtures/generators, object names anonymized).
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type SafetyConfig, unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

const fixture = (name: string): string =>
  readFileSync(new URL(`../../fixtures/generators/${name}`, import.meta.url), 'utf8');

const TABLE = 'ZTX_DMO_DCODE';
const SEARCH_XML = `<?xml version="1.0" encoding="utf-8"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/tables/ztx_dmo_dcode" adtcore:type="TABL/DT" adtcore:name="${TABLE}" adtcore:packageName="ZARC1_DEMO"/></adtcore:objectReferences>`;
const INACTIVE_XML = `<?xml version="1.0"?><ioc:inactiveObjects xmlns:ioc="http://www.sap.com/adt/inactiveObjects" xmlns:adtcore="http://www.sap.com/adt/core"><ioc:entry><ioc:object><adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/srvd/sources/zui_dmo_arc1demo" adtcore:type="SRVD/SRV" adtcore:name="ZUI_DMO_ARC1DEMO"/></ioc:object></ioc:entry><ioc:entry><ioc:object><adtcore:objectReference adtcore:uri="/sap/bc/adt/oo/classes/zcl_other" adtcore:type="CLAS/OC" adtcore:name="ZCL_OTHER"/></ioc:object></ioc:entry></ioc:inactiveObjects>`;

interface Call {
  method: string;
  path: string;
  body?: string;
}

function route(overrides: Record<string, string | number> = {}): Call[] {
  const calls: Call[] = [];
  const bodies: Array<[RegExp, string | number]> = [
    [/\/repository\/informationsystem\/search/, SEARCH_XML],
    [/\/repository\/generators\?fetchAllGenerators/, fixture('generators-all-920.xml')],
    [/\/repository\/generators\?referencedObject/, fixture('generators-tabl-816.xml')],
    [/\/smbc\/schema\?/, fixture('generator-smbc-schema.json')],
    [/\/smbc\/content\?/, fixture('generator-smbc-content.json')],
    [/\/smbc\/validation\?/, fixture('generator-validation-ok.xml')],
    [/\/smbc\/preview\?/, fixture('generator-smbc-preview.xml')],
    [/\/generators\/ui\/smbc\?/, fixture('generator-smbc-run.xml')],
    [/\/activation\/inactiveobjects/, INACTIVE_XML],
  ];
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    const parsed = new URL(String(url));
    const path = `${parsed.pathname}${parsed.search}`;
    const method = init?.method ?? 'GET';
    if (method !== 'HEAD' && !path.includes('/core/discovery')) calls.push({ method, path, body: init?.body });
    const override = Object.entries(overrides).find(([pattern]) => path.includes(pattern));
    const match = override ?? bodies.find(([pattern]) => pattern.test(path));
    if (!match) return mockResponse(200, '', { 'x-csrf-token': 'T' });
    const value = match[1];
    if (typeof value === 'number') return mockResponse(value, 'Not Found', { 'x-csrf-token': 'T' });
    return mockResponse(200, value, { 'x-csrf-token': 'T' });
  });
  return calls;
}

function clientWith(safety: Partial<SafetyConfig>): InstanceType<typeof AdtClient> {
  return new AdtClient({
    baseUrl: 'http://sap:8000',
    username: 'admin',
    password: 'secret',
    safety: { ...unrestrictedSafetyConfig(), ...safety },
  });
}

const generateArgs = (extra: Record<string, unknown> = {}) => ({
  action: 'generate',
  generator: 'smbc',
  type: 'TABL',
  name: TABLE,
  package: 'ZARC1_DEMO',
  ...extra,
});

const generatorCalls = (calls: Call[]) => calls.filter((c) => c.path.includes('/generators'));

describe('SAPRead type=GENERATORS', () => {
  beforeEach(() => vi.resetAllMocks());

  it('lists every generator with its support flag and without endpoint links', async () => {
    route();
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'GENERATORS' });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.count).toBe(19);
    expect(parsed.generators.find((g: { id: string }) => g.id === 'smbc')).toMatchObject({ supported: true });
    expect(parsed.generators.find((g: { id: string }) => g.id === 'ui-service')).toMatchObject({ supported: false });
    expect(parsed.generators[0]).not.toHaveProperty('links');
  });

  it('filters by referenced object', async () => {
    const calls = route();
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'GENERATORS',
      name: TABLE,
      objectType: 'TABL',
    });
    expect(JSON.parse(result.content[0]?.text ?? '').count).toBe(3);
    expect(calls[0]?.path).toMatch(
      /^\/sap\/bc\/adt\/repository\/generators\?referencedObject=%2Fsap%2Fbc%2Fadt%2Fddic%2Ftables%2Fztx_dmo_dcode(&|$)/,
    );
  });

  it('needs objectType together with name', async () => {
    const calls = route();
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'GENERATORS', name: TABLE });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('objectType');
    expect(calls).toEqual([]);
  });

  it('explains a system without the generator framework', async () => {
    route({ '/repository/generators': 404 });
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { type: 'GENERATORS' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not available on this SAP system');
  });
});

describe('SAPWrite action=generate', () => {
  beforeEach(() => vi.resetAllMocks());

  it('dryRun validates and previews without running the generator', async () => {
    const calls = route();
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', generateArgs({ dryRun: true }));
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed).toMatchObject({ generator: 'smbc', valid: true, dryRun: true, package: 'ZARC1_DEMO' });
    expect(parsed.plannedObjects).toHaveLength(24);
    expect(parsed.input.metadata).toEqual({ package: 'ZARC1_DEMO', masterLanguage: 'EN' });
    expect(parsed.fields.length).toBeGreaterThan(10);
    expect(generatorCalls(calls).map((c) => `${c.method} ${c.path.split('?')[0]}`)).toEqual([
      'GET /sap/bc/adt/repository/generators',
      'GET /sap/bc/adt/bct/generators/ui/smbc/schema',
      'GET /sap/bc/adt/bct/generators/ui/smbc/content',
      'POST /sap/bc/adt/bct/generators/ui/smbc/validation',
      'POST /sap/bc/adt/bct/generators/ui/smbc/preview',
    ]);
  });

  it('runs the generator with the transport and reports objects left inactive', async () => {
    const calls = route();
    const result = await handleToolCall(
      createClient(),
      DEFAULT_CONFIG,
      'SAPWrite',
      generateArgs({ transport: 'A4HK900123', source: '{"options":{"addCopyAction":false}}' }),
    );
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.created).toEqual([
      { type: 'SMBC/TYP', name: 'ZARC1_CODES', uri: '/sap/bc/adt/bct/smbctyp/zarc1_codes' },
    ]);
    expect(parsed.transport).toBe('A4HK900123');
    expect(parsed.inactiveObjects).toEqual([{ type: 'SRVD/SRV', name: 'ZUI_DMO_ARC1DEMO' }]);
    const run = calls.find((c) => c.method === 'POST' && c.path.startsWith('/sap/bc/adt/bct/generators/ui/smbc?'));
    expect(run?.path).toContain('&corrNr=A4HK900123');
    const sent = JSON.parse(String(run?.body));
    expect(sent.options).toMatchObject({ addCopyAction: false, overwriteExistingObjects: false });
    expect(sent.metadata.package).toBe('ZARC1_DEMO');
  });

  it('stops on SAP validation errors before preview and run', async () => {
    const calls = route({ '/smbc/validation': fixture('generator-validation-error.xml') });
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', generateArgs());
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('CONFIGDEPRECATIONCODE');
    expect(calls.some((c) => c.path.includes('/smbc/preview'))).toBe(false);
    expect(calls.some((c) => c.path.startsWith('/sap/bc/adt/bct/generators/ui/smbc?'))).toBe(false);
  });

  it('refuses to run when the preview plans more than new objects', async () => {
    const preview = fixture('generator-smbc-preview.xml').replace(
      '<massOperation:property massOperation:key="Operation">CREATE</massOperation:property>',
      '<massOperation:property massOperation:key="Operation">UPDATE</massOperation:property>',
    );
    const calls = route({ '/smbc/preview': preview });
    const result = await handleToolCall(
      createClient(),
      DEFAULT_CONFIG,
      'SAPWrite',
      generateArgs({ transport: 'A4HK900123' }),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('UPDATE SMBC/TYP ZARC1_CODES');
    expect(calls.some((c) => c.path.startsWith('/sap/bc/adt/bct/generators/ui/smbc?'))).toBe(false);
  });

  it('refuses a package outside the allowlist before calling any generator endpoint', async () => {
    const calls = route();
    const result = await handleToolCall(
      clientWith({ allowedPackages: ['$TMP'] }),
      DEFAULT_CONFIG,
      'SAPWrite',
      generateArgs(),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('ZARC1_DEMO');
    expect(generatorCalls(calls)).toEqual([]);
  });

  it('refuses to run without write permission', async () => {
    const calls = route();
    const result = await handleToolCall(clientWith({ allowWrites: false }), DEFAULT_CONFIG, 'SAPWrite', generateArgs());
    expect(result.isError).toBe(true);
    expect(calls.some((c) => c.path.startsWith('/sap/bc/adt/bct/generators/ui/smbc?'))).toBe(false);
  });

  it.each([
    ['not supported by ARC-1', { generator: 'ui-service' }],
    ['"generator" is required', { generator: undefined }],
    ['starts from TABL', { type: 'DDLS', name: 'ZI_DEMO' }],
    ['"package" is required', { package: undefined }],
    ['JSON object text', { source: '{not json' }],
    ['JSON object', { source: '[1]' }],
  ])('rejects with "%s"', async (message, extra) => {
    route();
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', generateArgs(extra));
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(message);
  });

  it('refuses to let the caller change the package or overwrite existing objects', async () => {
    for (const source of ['{"metadata":{"package":"ZOTHER"}}', '{"options":{"overwriteExistingObjects":true}}']) {
      const calls = route();
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', generateArgs({ source }));
      expect(result.isError).toBe(true);
      expect(calls.some((c) => c.method === 'POST' && c.path.includes('/smbc'))).toBe(false);
    }
  });

  it('accepts generator inputs only with action=generate', async () => {
    route();
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'create',
      type: 'PROG',
      name: 'ZTEST',
      generator: 'smbc',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('action="generate"');
  });
});
