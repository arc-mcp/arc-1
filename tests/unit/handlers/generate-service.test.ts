import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getActionPolicy } from '../../../src/authz/policy.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

// Response shapes captured from SAP_BASIS 758 (object names replaced).
const FEED = `<?xml version="1.0" encoding="utf-8"?><atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:entry><atom:id>smbc</atom:id></atom:entry><atom:entry><atom:id>uiservice</atom:id></atom:entry><atom:entry><atom:id>webapiservice</atom:id></atom:entry></atom:feed>`;
const status = (severity: string, text = '') =>
  `<?xml version="1.0" encoding="utf-8"?><asx:abap version="1.0" xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>${severity}</SEVERITY><SHORT_TEXT>${text}</SHORT_TEXT><LONG_TEXT/></DATA></asx:values></asx:abap>`;
const PREVIEW = `<?xml version="1.0" encoding="utf-8"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/zr_demo" adtcore:type="DDLS/DF" adtcore:name="ZR_DEMO" adtcore:description="CREATE"/><adtcore:objectReference adtcore:uri="/sap/bc/adt/businessservices/bindings/zui_demo_o4" adtcore:type="SRVB/SVB" adtcore:name="ZUI_DEMO_O4" adtcore:description="CREATE"/></adtcore:objectReferences>`;
const GENERATED = `<?xml version="1.0" encoding="utf-8"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="/sap/bc/adt/businessservices/bindings/zui_demo_o4" adtcore:type="SRVB/SVB" adtcore:name="ZUI_DEMO_O4"/></adtcore:objectReferences>`;
const SEARCH_TABLE = `<?xml version="1.0" encoding="utf-8"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/tables/zdemo_t" adtcore:type="TABL/DT" adtcore:name="ZDEMO_T" adtcore:packageName="$TMP"/></adtcore:objectReferences>`;
const SEARCH_STRUCTURE = SEARCH_TABLE.replace('TABL/DT', 'TABL/DS').replace('ddic/tables', 'ddic/structures');
const searchHit = (name: string, type: string, pkg = '$TMP') =>
  `<?xml version="1.0" encoding="utf-8"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="/sap/bc/adt/x/${name.toLowerCase()}" adtcore:type="${type}" adtcore:name="${name}" adtcore:packageName="${pkg}"/></adtcore:objectReferences>`;
const EMPTY_SEARCH = `<?xml version="1.0" encoding="utf-8"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"/>`;
const SOURCE = JSON.stringify({ businessService: { serviceBinding: { name: 'ZUI_DEMO_O4' } } });

interface Scenario {
  validation?: string;
  preview?: string;
  generate?: () => Response | Promise<Response>;
  search?: Record<string, string>;
  table?: string;
}

function respond(scenario: Scenario = {}): void {
  mockFetch.mockImplementation((url: string, init?: { method?: string }) => {
    const { pathname, searchParams } = new URL(url);
    const method = init?.method ?? 'GET';
    if (pathname.endsWith('/core/discovery')) return Promise.resolve(mockResponse(200, '', { 'x-csrf-token': 't' }));
    if (pathname.endsWith('/repository/informationsystem/search')) {
      const query = searchParams.get('query') ?? '';
      if (query === 'ZDEMO_T') return Promise.resolve(mockResponse(200, scenario.table ?? SEARCH_TABLE));
      const hit = (scenario.search ?? { ZR_DEMO: 'DDLS/DF', ZUI_DEMO_O4: 'SRVB/SVB' })[query];
      return Promise.resolve(mockResponse(200, hit ? searchHit(query, hit) : EMPTY_SEARCH));
    }
    if (pathname.endsWith('/activation/inactiveobjects')) return Promise.resolve(mockResponse(200, '<a/>'));
    if (pathname.endsWith('/repository/generators')) return Promise.resolve(mockResponse(200, FEED));
    if (pathname.endsWith('/content')) return Promise.resolve(mockResponse(200, '{"general":{"description":"X"}}'));
    if (pathname.endsWith('/schema')) return Promise.resolve(mockResponse(200, '{"title":"RAP Layers"}'));
    if (pathname.endsWith('/validation')) {
      return Promise.resolve(mockResponse(200, scenario.validation ?? status('OK')));
    }
    if (pathname.endsWith('/preview')) return Promise.resolve(mockResponse(200, scenario.preview ?? PREVIEW));
    if (method === 'POST' && /\/generators\/(uiservice|webapiservice)$/.test(pathname)) {
      return Promise.resolve(scenario.generate ? scenario.generate() : mockResponse(200, GENERATED));
    }
    return Promise.resolve(mockResponse(404, 'Not found'));
  });
}

async function generate(args: Record<string, unknown> = {}) {
  return handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
    action: 'generate_service',
    type: 'TABL',
    name: 'ZDEMO_T',
    generator: 'uiservice',
    source: SOURCE,
    ...args,
  });
}

function posts(suffix: string): Array<{ url: URL; body: Record<string, any> }> {
  return mockFetch.mock.calls
    .filter(([url, init]) => init?.method === 'POST' && new URL(String(url)).pathname.endsWith(suffix))
    .map(([url, init]) => ({ url: new URL(String(url)), body: JSON.parse(String(init.body)) }));
}

const generationCalls = () => posts('/generators/uiservice');

beforeEach(() => vi.resetAllMocks());

describe('SAPWrite generate_service', () => {
  it('returns SAP schema and default content without source, and sends no POST', async () => {
    respond();
    const result = await generate({ source: undefined });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      defaultContent: { general: { description: 'X' } },
      schema: { title: 'RAP Layers' },
    });
    expect(
      mockFetch.mock.calls.some(([url, init]) => init?.method === 'POST' && String(url).includes('generators')),
    ).toBe(false);
  });

  it('dryRun validates and previews without generating', async () => {
    respond();
    const result = await generate({ dryRun: true });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      generator: 'uiservice',
      table: 'ZDEMO_T',
      package: '$TMP',
      dryRun: true,
      validation: 'OK',
      objects: [
        { type: 'DDLS/DF', name: 'ZR_DEMO' },
        { type: 'SRVB/SVB', name: 'ZUI_DEMO_O4' },
      ],
    });
    expect(posts('/validation')).toHaveLength(1);
    expect(generationCalls()).toHaveLength(0);
  });

  it('generates after validation and reads every previewed object back', async () => {
    respond();
    const result = await generate();

    expect(result.isError).toBeFalsy();
    const output = JSON.parse(result.content[0]!.text);
    expect(output.objects).toEqual([
      { type: 'DDLS/DF', name: 'ZR_DEMO', state: 'found' },
      { type: 'SRVB/SVB', name: 'ZUI_DEMO_O4', state: 'found' },
    ]);
    expect(output.inactive).toEqual([]);
    expect(output.note).toContain('publish_srvb');
  });

  it('sends the package, language and table of the call, whatever the content omits', async () => {
    respond();
    await generate();

    const [call] = generationCalls();
    expect(call?.body.metadata).toEqual({ package: '$TMP', masterLanguage: 'EN' });
    expect(call?.body.general.referenceObjectName).toBe('ZDEMO_T');
    expect(call?.body.businessService.serviceBinding.name).toBe('ZUI_DEMO_O4');
    expect(call?.url.pathname).toBe('/sap/bc/adt/businessservices/generators/uiservice');
    expect(call?.url.searchParams.get('referencedObject')).toBe('/sap/bc/adt/ddic/tables/zdemo_t');
  });

  it('sends the sections in the order SAP requires, whatever order the content uses', async () => {
    respond();
    await generate({
      source: JSON.stringify({ businessService: {}, serviceProjection: {}, businessObject: {}, general: {} }),
    });

    expect(Object.keys(generationCalls()[0]!.body)).toEqual([
      'metadata',
      'general',
      'businessObject',
      'serviceProjection',
      'businessService',
    ]);
  });

  it('keeps the field order SAP requires inside metadata and general', async () => {
    respond();
    await generate({
      source: JSON.stringify({
        metadata: { masterLanguage: 'XX', package: '$TMP' },
        general: { description: 'D', referenceObjectName: 'ZDEMO_T' },
      }),
    });

    const [call] = generationCalls();
    expect(Object.entries(call!.body.metadata)).toEqual([
      ['package', '$TMP'],
      ['masterLanguage', 'EN'],
    ]);
    expect(Object.keys(call!.body.general)).toEqual(['referenceObjectName', 'description']);
  });

  it('explains the field order when SAP cannot parse the content', async () => {
    respond();
    const implementation = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation((url: string, init?: { method?: string }) =>
      new URL(url).pathname.endsWith('/validation')
        ? Promise.resolve(mockResponse(400, 'End of element object expected'))
        : implementation(url, init),
    );

    const result = await generate();

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('in the order of defaultContent');
    expect(generationCalls()).toHaveLength(0);
  });

  it('uses the selected generator', async () => {
    respond();
    await generate({ generator: 'webapiservice' });
    expect(posts('/generators/webapiservice')).toHaveLength(1);
  });

  it('never generates when SAP validation reports a collision, although the preview would say CREATE', async () => {
    respond({ validation: status('ERROR', 'ZR_DEMO of type DDLS already exists.') });
    const result = await generate();

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('already exists');
    expect(result.content[0]!.text).toContain('nothing was generated');
    expect(generationCalls()).toHaveLength(0);
    expect(posts('/preview')).toHaveLength(0);
  });

  it.each([
    ['a severity other than OK', status('WARNING', 'Careful')],
    ['an unknown status document', '<?xml version="1.0"?><other/>'],
  ])('fails closed on %s', async (_label, validation) => {
    respond({ validation });
    expect((await generate()).isError).toBe(true);
    expect(generationCalls()).toHaveLength(0);
  });

  it.each([
    ['another package', { package: 'ZFOO', transport: 'A4HK900001' }],
    ['a package without transport', { package: 'ZFOO' }],
    ['a transport in $TMP', { package: '$TMP', transport: 'A4HK900001' }],
  ])('refuses %s before any generator POST', async (_label, args) => {
    respond();
    const result = await generate(args);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('$TMP only');
    expect(posts('/validation')).toHaveLength(0);
    expect(generationCalls()).toHaveLength(0);
  });

  it.each([
    ['a package inside the content', { metadata: { package: 'ZFOO' } }, 'metadata.package'],
    ['another table inside the content', { general: { referenceObjectName: 'ZOTHER' } }, 'referenceObjectName'],
  ])('refuses %s, because SAP validation does not check it', async (_label, content, message) => {
    respond();
    const result = await generate({ source: JSON.stringify(content) });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain(message);
    expect(posts('/validation')).toHaveLength(0);
  });

  it.each([
    ['invalid JSON', '{not json'],
    ['a JSON array', '[]'],
  ])('refuses %s as source', async (_label, source) => {
    respond();
    expect((await generate({ source })).isError).toBe(true);
    expect(posts('/validation')).toHaveLength(0);
  });

  it('refuses a structure as reference', async () => {
    respond({ table: SEARCH_STRUCTURE });
    const result = await generate();

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('not a structure');
    expect(posts('/validation')).toHaveLength(0);
  });

  it('honours the package allowlist even for $TMP', async () => {
    respond();
    const client = new AdtClient({
      baseUrl: 'http://sap:8000',
      username: 'u',
      password: 'p',
      safety: { ...createClient().safety, allowedPackages: ['ZONLY'] },
    });
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
      action: 'generate_service',
      type: 'TABL',
      name: 'ZDEMO_T',
      generator: 'uiservice',
      source: SOURCE,
    });

    expect(result.isError).toBe(true);
    expect(generationCalls()).toHaveLength(0);
  });

  it('fails when SAP does not offer the generator for the table', async () => {
    respond();
    const implementation = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation((url: string, init?: { method?: string }) =>
      new URL(url).pathname.endsWith('/repository/generators')
        ? Promise.resolve(mockResponse(200, '<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"/>'))
        : implementation(url, init),
    );

    const result = await generate();

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('does not offer');
    expect(generationCalls()).toHaveLength(0);
  });

  it('fails when an object SAP promised cannot be confirmed, because the response names only the binding', async () => {
    respond({ search: { ZUI_DEMO_O4: 'SRVB/SVB' } });
    const result = await generate();

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('not every object was confirmed');
    expect(result.content[0]!.text).toContain('"state":"missing"');
  });

  it('reports what exists after a failed generation, without replaying it', async () => {
    respond({
      generate: () => mockResponse(500, 'boom'),
      search: { ZR_DEMO: 'DDLS/DF' },
    });
    const result = await generate();

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('SAP generation failed');
    expect(result.content[0]!.text).toContain('"state":"found"');
    expect(result.content[0]!.text).toContain('"state":"missing"');
    expect(generationCalls()).toHaveLength(1);
  });

  it('requires a known generator', async () => {
    respond();
    expect((await generate({ generator: undefined })).isError).toBe(true);
    expect((await generate({ generator: 'smbc' })).isError).toBe(true);
    expect(generationCalls()).toHaveLength(0);
  });

  it('has its own policy entry, so admins can deny it alone', () => {
    expect(getActionPolicy('SAPWrite', 'generate_service')).toMatchObject({ scope: 'write', featureGate: 'rap' });
  });

  it('is denied through SAP_DENY_ACTIONS before any request', async () => {
    respond();
    const result = await handleToolCall(
      createClient(),
      { ...DEFAULT_CONFIG, denyActions: ['SAPWrite.generate_service'] },
      'SAPWrite',
      { action: 'generate_service', type: 'TABL', name: 'ZDEMO_T', generator: 'uiservice', source: SOURCE },
    );

    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
