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

const PKG = 'ZARC1_DEMO';
const REQUEST = 'A4HK900123';
const EMPTY_SEARCH =
  '<?xml version="1.0" encoding="utf-8"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"/>';
const searchHits = (name: string, hits: Array<{ type: string; pkg: string }>) =>
  `<?xml version="1.0" encoding="utf-8"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">${hits
    .map(
      (h) =>
        `<adtcore:objectReference adtcore:uri="/sap/bc/adt/x/${name.toLowerCase()}" adtcore:type="${h.type}" adtcore:name="${name}" adtcore:packageName="${h.pkg}"/>`,
    )
    .join('')}</adtcore:objectReferences>`;
const abapObject = (type: string, name: string) =>
  `<tm:abap_object tm:pgmid="R3TR" tm:type="${type}" tm:name="${name}"/>`;
const requestXml = (objects: string, status = 'D') =>
  `<?xml version="1.0" encoding="utf-8"?><tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="${REQUEST}" tm:owner="DEV" tm:desc="Test" tm:status="${status}" tm:type="K"><tm:task tm:number="A4HK900124" tm:owner="DEV" tm:status="${status}">${objects}</tm:task></tm:request></tm:root>`;
const transportInfo = (recording: string, unit: string) =>
  `<?xml version="1.0" encoding="utf-8"?><asx:abap version="1.0" xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><DLVUNIT>${unit}</DLVUNIT><RECORDING>${recording}</RECORDING></DATA></asx:values></asx:abap>`;

/** The smbc preview's objects as SAP stores them: TOBJ carries a trailing T in TADIR (816). */
const SMBC_OBJECTS = [
  ...fixture('generator-smbc-preview.xml').matchAll(/adtcore:type="([^"]+)" adtcore:name="([^"]+)"/g),
].map(([, type, name]) => ({ type: String(type), name: type?.startsWith('TOBJ') ? `${name}T` : String(name) }));
const SMBC_IN_REQUEST =
  SMBC_OBJECTS.map((o) => abapObject(o.type.split('/')[0] ?? '', o.name)).join('') +
  abapObject('G4BA', 'ZUI_DMO_ARC1DEMO_O4');

interface Scenario {
  /** Search hits by object name; default: every smbc object in PKG. */
  search?: Record<string, Array<{ type: string; pkg: string }>>;
  /** Request content after the run; default: every smbc object plus a G4BA entry. */
  requestAfter?: string;
  requestStatus?: string;
}

function route(overrides: Record<string, string | number> = {}, scenario: Scenario = {}): Call[] {
  const calls: Call[] = [];
  let generated = false;
  const search: Record<string, Array<{ type: string; pkg: string }>> = scenario.search ?? {};
  if (!scenario.search) {
    for (const o of SMBC_OBJECTS) (search[o.name] ??= []).push({ type: o.type, pkg: PKG });
  }
  const bodies: Array<[RegExp, string | number | (() => string)]> = [
    [/\/repository\/generators\?fetchAllGenerators/, fixture('generators-all-920.xml')],
    [/\/repository\/generators\?referencedObject/, fixture('generators-tabl-816.xml')],
    [/\/smbc\/schema\?/, fixture('generator-smbc-schema.json')],
    [/\/smbc\/content\?/, fixture('generator-smbc-content.json')],
    [/\/smbc\/validation\?/, fixture('generator-validation-ok.xml')],
    [/\/smbc\/preview\?/, fixture('generator-smbc-preview.xml')],
    [/\/generators\/ui\/smbc\?/, fixture('generator-smbc-run.xml')],
    [/\/activation\/inactiveobjects/, INACTIVE_XML],
    [/\/sap\/bc\/adt\/packages\//, '<pak:package/>'],
    [/\/cts\/transportchecks/, transportInfo('X', 'HOME')],
    [
      /\/cts\/transportrequests\//,
      () => requestXml(generated ? (scenario.requestAfter ?? SMBC_IN_REQUEST) : '', scenario.requestStatus),
    ],
  ];
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    const parsed = new URL(String(url));
    const path = `${parsed.pathname}${parsed.search}`;
    const method = init?.method ?? 'GET';
    if (method !== 'HEAD' && !path.includes('/core/discovery')) calls.push({ method, path, body: init?.body });
    const override = Object.entries(overrides).find(([pattern]) => path.includes(pattern));
    if (path.includes('/repository/informationsystem/search') && !override) {
      const query = parsed.searchParams.get('query') ?? '';
      if (query === TABLE) return mockResponse(200, SEARCH_XML);
      const hits = search[query];
      return mockResponse(200, hits ? searchHits(query, hits) : EMPTY_SEARCH);
    }
    const match = override ?? bodies.find(([pattern]) => pattern.test(path));
    if (method === 'POST' && /\/generators\/(ui\/)?[a-z-]+\?/.test(path)) generated = true;
    if (!match) return mockResponse(200, '', { 'x-csrf-token': 'T' });
    const value = typeof match[1] === 'function' ? match[1]() : match[1];
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
  package: PKG,
  transport: REQUEST,
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
    expect(parsed.generators.find((g: { id: string }) => g.id === 'ui-service')).toMatchObject({ supported: true });
    expect(parsed.generators.find((g: { id: string }) => g.id === 'x-ui-service')).toMatchObject({ supported: false });
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
    expect(parsed.generatedObjects).toHaveLength(24);
    expect(parsed.generatedObjects.every((o: { state: string }) => o.state === 'found')).toBe(true);
    expect(parsed.additionalRequestObjects).toEqual(['G4BA ZUI_DMO_ARC1DEMO_O4']);
    expect(parsed.next).toContain('publish_srvb');
    expect(
      calls.filter((c) => c.method === 'POST' && c.path.startsWith('/sap/bc/adt/bct/generators/ui/smbc?')),
    ).toHaveLength(1);
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
    ['not supported by ARC-1', { generator: 'x-ui-service' }],
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

describe('SAPWrite action=generate: package and transport', () => {
  beforeEach(() => vi.resetAllMocks());

  const runCalls = (calls: Call[]) =>
    calls.filter((c) => c.method === 'POST' && /\/generators\/ui\/[a-z-]+\?/.test(c.path));

  it('requires an explicit transport outside $TMP before calling any generator endpoint', async () => {
    const calls = route();
    const result = await handleToolCall(
      createClient(),
      DEFAULT_CONFIG,
      'SAPWrite',
      generateArgs({ transport: undefined }),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('"transport" is required for package ZARC1_DEMO');
    expect(generatorCalls(calls)).toEqual([]);
  });

  it('runs in $TMP without a transport and without request checks', async () => {
    const tmpSearch: Record<string, Array<{ type: string; pkg: string }>> = {};
    for (const o of SMBC_OBJECTS) (tmpSearch[o.name] ??= []).push({ type: o.type, pkg: '$TMP' });
    const calls = route({}, { search: tmpSearch });
    const result = await handleToolCall(
      createClient(),
      DEFAULT_CONFIG,
      'SAPWrite',
      generateArgs({ package: '$tmp', transport: undefined }),
    );
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.package).toBe('$TMP');
    expect(parsed).not.toHaveProperty('transport');
    expect(parsed).not.toHaveProperty('additionalRequestObjects');
    expect(calls.some((c) => /cts\/|\/packages\//.test(c.path))).toBe(false);
    expect(runCalls(calls)[0]?.path).not.toContain('corrNr');
  });

  it.each([
    ['takes no transport', { package: '$TMP' }],
    ['only local package', { package: '$ZLOCAL' }],
  ])('refuses local packages: "%s"', async (message, extra) => {
    const calls = route();
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', generateArgs(extra));
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(message);
    expect(runCalls(calls)).toEqual([]);
  });

  it.each([
    ['Package ZARC1_DEMO does not exist', { '/sap/bc/adt/packages/': 404 }, {}],
    ['does not record changes', { '/cts/transportchecks': transportInfo('', 'LOCAL') }, {}],
    ['Transport A4HK900123 does not exist', { '/cts/transportrequests/': 404 }, {}],
    [
      'not a transport request',
      { '/cts/transportrequests/': requestXml('').replace(`tm:number="${REQUEST}"`, 'tm:number="A4HK900999"') },
      {},
    ],
    ['not modifiable (status R)', {}, { requestStatus: 'R' }],
  ])('dryRun already refuses: "%s"', async (message, overrides, scenario) => {
    const calls = route(overrides as Record<string, string | number>, scenario as Scenario);
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', generateArgs({ dryRun: true }));
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(message);
    expect(runCalls(calls)).toEqual([]);
  });

  it('asks the transport check about a new object of the run, not the referenced table', async () => {
    const calls = route();
    await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', generateArgs({ dryRun: true }));
    const check = calls.find((c) => c.path.includes('/cts/transportchecks'));
    expect(check?.body).toContain('/sap/bc/adt/bct/smbctyp/zarc1_codes');
    expect(check?.body).not.toContain('ztx_dmo_dcode');
  });

  it('reads the objects back after a failed run, deletes nothing and does not replay', async () => {
    const calls = route({ '/generators/ui/smbc?': 500 });
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', generateArgs());
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('SAP generation failed');
    expect(result.content[0]?.text).toContain('deleted nothing');
    expect(result.content[0]?.text).toContain('"state":"found"');
    expect(runCalls(calls)).toHaveLength(1);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('reports objects that landed on another request or in another package', async () => {
    const search: Record<string, Array<{ type: string; pkg: string }>> = {};
    for (const o of SMBC_OBJECTS) (search[o.name] ??= []).push({ type: o.type, pkg: PKG });
    search.ZUI_DMO_ARC1DEMO = [{ type: 'SRVD/SRV', pkg: 'ZOTHER' }];
    const requestAfter = SMBC_IN_REQUEST.replace(abapObject('SMBC', 'ZARC1_CODES'), '');
    route({}, { search, requestAfter });
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', generateArgs());
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not every object was confirmed');
    const states = JSON.parse(
      result.content[0]?.text.slice(result.content[0].text.indexOf('{')) ?? '',
    ).generatedObjects;
    expect(states.find((o: { type: string }) => o.type === 'SMBC/TYP').state).toBe('other_transport');
    expect(states.find((o: { type: string }) => o.type === 'SRVD/SRV').state).toBe('other_package');
  });
});

describe('SAPWrite action=generate: SAP validation', () => {
  beforeEach(() => vi.resetAllMocks());

  it('fails closed on a validation answer it cannot read', async () => {
    const calls = route({ '/smbc/validation': '<unexpected/>' });
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', generateArgs());
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('no usable validation status');
    expect(calls.some((c) => c.path.includes('/smbc/preview'))).toBe(false);
  });

  it('explains that SAP parses the input in order when validation answers 400', async () => {
    route({ '/smbc/validation': 400 });
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', generateArgs());
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Keep the sections and fields in the order');
  });
});

/** RAP service generators: `ui-service` on 816 (captured feed), `uiservice` on 758 (#1202 contract). */
describe('SAPWrite action=generate: RAP service generators', () => {
  beforeEach(() => vi.resetAllMocks());

  // 816 names the field referencedObjectName, 758 referenceObjectName.
  const RAP_CONTENT = JSON.stringify({
    metadata: { package: '' },
    general: { referencedObjectName: TABLE, description: 'Codes' },
    businessService: { serviceBinding: { name: 'ZUI_CODES_O4' } },
  });
  const RAP_PREVIEW_816 = `<?xml version="1.0" encoding="utf-8"?><massOperation:group xmlns:massOperation="http://www.sap.com/adt/massoperation" xmlns:adtcore="http://www.sap.com/adt/core" massOperation:name="Root"><massOperation:object><massOperation:property massOperation:key="Operation">CREATE</massOperation:property><adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/zr_codes" adtcore:type="DDLS/DF" adtcore:name="ZR_CODES"/></massOperation:object><massOperation:object><massOperation:property massOperation:key="Operation">CREATE</massOperation:property><adtcore:objectReference adtcore:uri="/sap/bc/adt/businessservices/bindings/zui_codes_o4" adtcore:type="SRVB/SVB" adtcore:name="ZUI_CODES_O4"/></massOperation:object></massOperation:group>`;
  const RAP_PREVIEW_758 = `<?xml version="1.0" encoding="utf-8"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/zr_codes" adtcore:type="DDLS/DF" adtcore:name="ZR_CODES"/><adtcore:objectReference adtcore:uri="/sap/bc/adt/businessservices/bindings/zui_codes_o4" adtcore:type="SRVB/SVB" adtcore:name="ZUI_CODES_O4"/></adtcore:objectReferences>`;
  const STATUS_OK = `<?xml version="1.0" encoding="utf-8"?><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DATA><SEVERITY>OK</SEVERITY><SHORT_TEXT/></DATA></asx:values></asx:abap>`;
  const FEED_758 = `<?xml version="1.0" encoding="utf-8"?><atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:entry referencedObjectTypes="TABL"><atom:id>uiservice</atom:id><atom:title>OData UI Service</atom:title>${[
    'content',
    'schema',
    'validation',
    'preview',
  ]
    .map(
      (rel) =>
        `<atom:link href="/sap/bc/adt/businessservices/generators/uiservice/${rel}" rel="http://www.sap.com/adt/repository/generator/${rel}" type="application/vnd.sap.adt.repository.generator.${rel}.v1+json"/>`,
    )
    .join(
      '',
    )}<atom:link href="/sap/bc/adt/businessservices/generators/uiservice" rel="http://www.sap.com/adt/repository/generator" type="application/vnd.sap.adt.repository.generator.v1+json"/></atom:entry></atom:feed>`;
  const RAP_SEARCH = {
    ZR_CODES: [{ type: 'DDLS/DF', pkg: PKG }],
    ZUI_CODES_O4: [{ type: 'SRVB/SVB', pkg: PKG }],
  };
  const RAP_REQUEST =
    abapObject('DDLS', 'ZR_CODES') + abapObject('SRVB', 'ZUI_CODES_O4') + abapObject('SUSH', 'ABC123');

  it('runs ui-service on 816 with the referenced table pinned and metadata first', async () => {
    const calls = route(
      {
        '/ui-service/schema': '{}',
        '/ui-service/content': RAP_CONTENT,
        '/ui-service/validation': fixture('generator-validation-ok.xml'),
        '/ui-service/preview': RAP_PREVIEW_816,
        '/generators/ui/ui-service?': '<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"/>',
      },
      { search: RAP_SEARCH, requestAfter: RAP_REQUEST },
    );
    const result = await handleToolCall(
      createClient(),
      DEFAULT_CONFIG,
      'SAPWrite',
      generateArgs({
        generator: 'ui-service',
        source: JSON.stringify({ general: { description: 'Code list' } }),
      }),
    );
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.generatedObjects.map((o: { state: string }) => o.state)).toEqual(['found', 'found']);
    expect(parsed.additionalRequestObjects).toEqual(['SUSH ABC123']);
    expect(parsed.next).toContain('include="service_info"');
    const run = calls.find(
      (c) => c.method === 'POST' && c.path.startsWith('/sap/bc/adt/rap/generators/ui/ui-service?'),
    );
    expect(run?.path).toContain(`corrNr=${REQUEST}`);
    const sent = JSON.parse(String(run?.body));
    expect(Object.keys(sent)).toEqual(['metadata', 'general', 'businessService']);
    expect(sent.general).toEqual({ referencedObjectName: TABLE, description: 'Code list' });
  });

  it('refuses ui-service input that names another table', async () => {
    const calls = route({ '/ui-service/content': RAP_CONTENT, '/ui-service/schema': '{}' });
    const result = await handleToolCall(
      createClient(),
      DEFAULT_CONFIG,
      'SAPWrite',
      generateArgs({ generator: 'ui-service', source: '{"general":{"referencedObjectName":"ZOTHER"}}' }),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('referenced object');
    expect(calls.some((c) => c.method === 'POST' && c.path.includes('/ui-service'))).toBe(false);
  });

  it('runs uiservice on 758 with the media types and response shapes of that release', async () => {
    const calls = route(
      {
        '/repository/generators?referencedObject': FEED_758,
        '/uiservice/schema': '{}',
        '/uiservice/content': RAP_CONTENT,
        '/uiservice/validation': STATUS_OK,
        '/uiservice/preview': RAP_PREVIEW_758,
        '/generators/uiservice?': '<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"/>',
      },
      { search: RAP_SEARCH, requestAfter: RAP_REQUEST },
    );
    const result = await handleToolCall(
      createClient(),
      DEFAULT_CONFIG,
      'SAPWrite',
      generateArgs({ generator: 'uiservice' }),
    );
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.generatedObjects.map((o: { state: string }) => o.state)).toEqual(['found', 'found']);
    const posts = calls.filter((c) => c.method === 'POST' && c.path.includes('/businessservices/generators/uiservice'));
    expect(posts.map((c) => c.path.split('?')[0])).toEqual([
      '/sap/bc/adt/businessservices/generators/uiservice/validation',
      '/sap/bc/adt/businessservices/generators/uiservice/preview',
      '/sap/bc/adt/businessservices/generators/uiservice',
    ]);
  });
});
