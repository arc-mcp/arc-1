import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AdtApiError, AdtSafetyError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import {
  buildGeneratorInput,
  type GeneratorInfo,
  generatorEndpoint,
  generatorValidationPassed,
  getGeneratorDefaults,
  hasGeneratorErrors,
  isSupportedGenerator,
  listGenerators,
  mergeGeneratorInput,
  parseGeneratorFeed,
  parseGeneratorPreview,
  parseGeneratorRunResult,
  parseGeneratorValidation,
  previewGenerator,
  runGenerator,
  summarizeGeneratorSchema,
  validateGeneratorInput,
} from '../../../src/adt/object-generators.js';
import { type SafetyConfig, unrestrictedSafetyConfig } from '../../../src/adt/safety.js';

// Captured from ADT 3.60 (SAP_BASIS 816 and 920), object names anonymized.
const fixture = (name: string): string =>
  readFileSync(new URL(`../../fixtures/generators/${name}`, import.meta.url), 'utf8');

const REF = '/sap/bc/adt/ddic/tables/ztx_dmo_dcode';
const readOnlySafety = (): SafetyConfig => ({ ...unrestrictedSafetyConfig(), allowWrites: false });

function smbc(): GeneratorInfo {
  const found = parseGeneratorFeed(fixture('generators-tabl-816.xml')).find((g) => g.id === 'smbc');
  if (!found) throw new Error('fixture lost smbc');
  return found;
}

function mockHttp(bodies: Record<string, string>): {
  http: AdtHttpClient;
  calls: Array<{ method: string; path: string; body?: string; contentType?: string; headers?: Record<string, string> }>;
} {
  const calls: Array<{
    method: string;
    path: string;
    body?: string;
    contentType?: string;
    headers?: Record<string, string>;
    options?: unknown;
  }> = [];
  const respond = (path: string) => {
    const key = Object.keys(bodies).find((k) => path.split('?')[0]?.endsWith(k));
    if (key === undefined) throw new AdtApiError('not found', 404, path);
    return { statusCode: 200, headers: {}, body: bodies[key] as string };
  };
  const http = {
    get: vi.fn(async (path: string, headers?: Record<string, string>) => {
      calls.push({ method: 'GET', path, headers });
      return respond(path);
    }),
    post: vi.fn(
      async (
        path: string,
        body?: string,
        contentType?: string,
        headers?: Record<string, string>,
        options?: unknown,
      ) => {
        calls.push({ method: 'POST', path, body, contentType, headers, options });
        return respond(path);
      },
    ),
  } as unknown as AdtHttpClient;
  return { http, calls };
}

describe('generator feed', () => {
  it('lists every generator of the BTP 920 system with description and support flag', () => {
    const generators = parseGeneratorFeed(fixture('generators-all-920.xml'));
    expect(generators).toHaveLength(19);
    const smbcEntry = generators.find((g) => g.id === 'smbc');
    expect(smbcEntry).toMatchObject({
      title: 'Business Configuration Maintenance Object',
      category: 'Business Configuration Management',
      referencedObjectTypes: ['TABL'],
      supported: true,
    });
    expect(smbcEntry?.description).toContain('Table Maintenance app');
    expect(smbcEntry?.description).not.toContain('<');
    expect(smbcEntry?.links).toMatchObject({
      generator: '/sap/bc/adt/bct/generators/ui/smbc',
      preview: '/sap/bc/adt/bct/generators/ui/smbc/preview',
      schema: '/sap/bc/adt/bct/generators/ui/smbc/schema',
      content: '/sap/bc/adt/bct/generators/ui/smbc/content',
    });
    expect(generators.find((g) => g.id === 'ui-service')).toMatchObject({
      referencedObjectTypes: ['TABL', 'BDEF', 'DDLS'],
      supported: true,
    });
    expect(generators.find((g) => g.id === 'x-ui-service')).toMatchObject({ supported: false });
    expect(generators.find((g) => g.id === 'x-ui-service')?.referencedObjectTypes).toEqual([]);
  });

  it('requests the full list or the list for one referenced object', async () => {
    const { http, calls } = mockHttp({ '/repository/generators': fixture('generators-tabl-816.xml') });
    const listed = await listGenerators(http, readOnlySafety(), REF);
    expect(listed.map((g) => g.id)).toEqual(['smbc', 'ui-service', 'webapi-service']);
    await listGenerators(http, readOnlySafety());
    expect(calls.map((c) => c.path)).toEqual([
      '/sap/bc/adt/repository/generators?referencedObject=%2Fsap%2Fbc%2Fadt%2Fddic%2Ftables%2Fztx_dmo_dcode',
      '/sap/bc/adt/repository/generators?fetchAllGenerators=true',
    ]);
    expect(calls[0]?.headers?.Accept).toBe('application/atom+xml;type=feed');
  });
});

describe('generator endpoints from the feed', () => {
  it('drops the query SAP put on the validation link', () => {
    expect(generatorEndpoint(smbc(), 'validation')).toBe('/sap/bc/adt/bct/generators/ui/smbc/validation');
  });

  it.each([
    '/sap/bc/adt/rap/generators/ui/ui-service/preview',
    '/sap/bc/adt/bct/generators/ui/smbcx/preview',
    '/sap/bc/adt/bct/generators/ui/smbc/../../../../cts/transportrequests',
    'https://evil.example/sap/bc/adt/bct/generators/ui/smbc/preview',
  ])('refuses an advertised href outside the registry path: %s', (href) => {
    const generator = { ...smbc(), links: { ...smbc().links, preview: href } };
    expect(() => generatorEndpoint(generator, 'preview')).toThrow(AdtSafetyError);
  });

  it('refuses generators outside the registry', () => {
    const generator = { ...smbc(), id: 'x-ui-service', supported: false };
    expect(() => generatorEndpoint(generator, 'preview')).toThrow(/not supported/);
  });
});

describe('generator calls', () => {
  const input = JSON.parse(fixture('generator-smbc-input.json')) as Record<string, unknown>;

  it('fetches schema and proposal for the referenced object and package', async () => {
    const { http, calls } = mockHttp({
      '/smbc/schema': fixture('generator-smbc-schema.json'),
      '/smbc/content': fixture('generator-smbc-content.json'),
    });
    const defaults = await getGeneratorDefaults(http, readOnlySafety(), smbc(), REF, 'ZARC1_DEMO');
    expect(defaults.content).toMatchObject({ businessConfManagement: { maintenanceObjectId: expect.any(String) } });
    expect(calls.map((c) => c.path)).toEqual([
      '/sap/bc/adt/bct/generators/ui/smbc/schema?referencedObject=%2Fsap%2Fbc%2Fadt%2Fddic%2Ftables%2Fztx_dmo_dcode&package=ZARC1_DEMO',
      '/sap/bc/adt/bct/generators/ui/smbc/content?referencedObject=%2Fsap%2Fbc%2Fadt%2Fddic%2Ftables%2Fztx_dmo_dcode&package=ZARC1_DEMO',
    ]);
  });

  it('validates and previews without write permission', async () => {
    const { http, calls } = mockHttp({
      '/smbc/validation': fixture('generator-validation-ok.xml'),
      '/smbc/preview': fixture('generator-smbc-preview.xml'),
    });
    const messages = await validateGeneratorInput(http, readOnlySafety(), smbc(), REF, input);
    expect(hasGeneratorErrors(messages)).toBe(false);
    const planned = await previewGenerator(http, readOnlySafety(), smbc(), REF, input);
    expect(planned).toHaveLength(24);
    for (const call of calls) {
      expect(call.contentType).toBe('application/vnd.sap.adt.serverdriven.content.v1+json; framework=generators.v1');
      expect(JSON.parse(call.body ?? '')).toEqual(input);
    }
  });

  it('runs with the transport, without transient replays and with a long timeout', async () => {
    const { http, calls } = mockHttp({ '/generators/ui/smbc': fixture('generator-smbc-run.xml') });
    const created = await runGenerator(http, unrestrictedSafetyConfig(), smbc(), REF, input, 'A4HK900123');
    expect(created).toEqual([{ type: 'SMBC/TYP', name: 'ZARC1_CODES', uri: '/sap/bc/adt/bct/smbctyp/zarc1_codes' }]);
    expect(calls[0]?.path).toBe(
      '/sap/bc/adt/bct/generators/ui/smbc?referencedObject=%2Fsap%2Fbc%2Fadt%2Fddic%2Ftables%2Fztx_dmo_dcode&corrNr=A4HK900123',
    );
    expect((calls[0] as { options?: unknown }).options).toMatchObject({
      retryTransientErrors: false,
      noReplay: true,
      fetchTimeoutMs: 300_000,
    });
  });

  it('refuses to run when writes are off', async () => {
    const { http, calls } = mockHttp({});
    await expect(runGenerator(http, readOnlySafety(), smbc(), REF, input)).rejects.toThrow(AdtSafetyError);
    expect(calls).toEqual([]);
  });
});

describe('generator responses', () => {
  it('reports SAP validation errors', () => {
    const messages = parseGeneratorValidation(fixture('generator-validation-error.xml'));
    expect(messages).toEqual([{ severity: 'ERROR', text: expect.stringContaining('CONFIGDEPRECATIONCODE') }]);
    expect(hasGeneratorErrors(messages)).toBe(true);
    expect(parseGeneratorValidation(fixture('generator-validation-ok.xml'))).toEqual([{ severity: 'OK', text: '' }]);
  });

  it('flattens the preview groups into planned objects', () => {
    const planned = parseGeneratorPreview(fixture('generator-smbc-preview.xml'));
    expect(planned[0]).toEqual({
      group: 'BC Management',
      operation: 'CREATE',
      type: 'SMBC/TYP',
      name: 'ZARC1_CODES',
      uri: '/sap/bc/adt/bct/smbctyp/zarc1_codes',
    });
    const counts: Record<string, number> = {};
    for (const object of planned) counts[object.type] = (counts[object.type] ?? 0) + 1;
    expect(counts).toEqual({
      'SMBC/TYP': 1,
      'TOBJ/TOB': 1,
      'SRVB/SVB': 1,
      'SRVD/SRV': 1,
      'BDEF/BDO': 2,
      'CLAS/OC': 2,
      'DDLS/DF': 7,
      'DDLX/EX': 2,
      'DCLS/DL': 4,
      'TABL/DT': 3,
    });
    expect(new Set(planned.map((o) => o.group))).toEqual(
      new Set(['BC Management', 'Business Service', 'Business Object', 'Data Model']),
    );
  });

  it('reads the run result although SAP labels it JSON', () => {
    expect(parseGeneratorRunResult(fixture('generator-smbc-run.xml'))).toHaveLength(1);
  });
});

describe('generator input', () => {
  const proposal = JSON.parse(fixture('generator-smbc-content.json')) as Record<string, unknown>;

  it('merges objects by key and arrays by position', () => {
    expect(
      mergeGeneratorInput(
        { a: { b: 1, c: 2 }, list: [{ x: 1, y: 1 }, { x: 2 }], keep: true },
        { a: { c: 3 }, list: [{ y: 9 }] },
      ),
    ).toEqual({ a: { b: 1, c: 3 }, list: [{ x: 1, y: 9 }, { x: 2 }], keep: true });
  });

  it('sets package and master language and keeps the proposal elsewhere', () => {
    const input = buildGeneratorInput(
      'smbc',
      proposal,
      { options: { addCopyAction: true } },
      'ZARC1_DEMO',
      'EN',
      'ZTX_DMO_DCODE',
    );
    expect(input.metadata).toEqual({ package: 'ZARC1_DEMO', masterLanguage: 'EN' });
    expect(input.options).toMatchObject({ addCopyAction: true, overwriteExistingObjects: false });
    expect(input.businessObject).toEqual(proposal.businessObject);
  });

  it('refuses metadata overrides and overwriting existing objects', () => {
    expect(() =>
      buildGeneratorInput('smbc', proposal, { metadata: { package: 'ZOTHER' } }, 'ZARC1_DEMO', 'EN', 'ZTX_DMO_DCODE'),
    ).toThrow(AdtSafetyError);
    expect(() =>
      buildGeneratorInput(
        'smbc',
        proposal,
        { options: { overwriteExistingObjects: true } },
        'ZARC1_DEMO',
        'EN',
        'ZTX_DMO_DCODE',
      ),
    ).toThrow(/overwriteExistingObjects/);
  });

  it('pins overwriteExistingObjects even when the proposal enables it', () => {
    const risky = { ...proposal, options: { ...(proposal.options as object), overwriteExistingObjects: true } };
    expect(buildGeneratorInput('smbc', risky, undefined, 'ZARC1_DEMO', 'EN', 'ZTX_DMO_DCODE').options).toMatchObject({
      overwriteExistingObjects: false,
    });
  });

  it('summarizes the schema fields without ARC-1-owned metadata', () => {
    const fields = summarizeGeneratorSchema(JSON.parse(fixture('generator-smbc-schema.json')));
    expect(fields.some((f) => f.path.startsWith('metadata'))).toBe(false);
    expect(fields).toContainEqual({
      path: 'options.transportSelectionType',
      type: 'string',
      title: 'Transport Selection',
      enum: ['manual', 'manualWithPreselection', 'noTransport'],
    });
    expect(fields.find((f) => f.path === 'options.description')).toMatchObject({ maxLength: 50 });
    expect(fields.some((f) => f.path.startsWith('businessObject.dataModel.tables[].'))).toBe(true);
  });
});

/**
 * The RAP service generators on SAP_BASIS 758 (#1202): other ids and paths, the
 * repository.generator media types, an asx:abap StatusMessage for validation and a flat
 * objectReferences preview. Shapes follow docs/research/2026-11-06-rap-service-generators.md.
 */
const FEED_758 = `<?xml version="1.0" encoding="utf-8"?><atom:feed xmlns:atom="http://www.w3.org/2005/Atom"><atom:entry referencedObjectTypes="TABL"><atom:id>uiservice</atom:id><atom:title>OData UI Service</atom:title>${[
  ['content', 'content', 'application/vnd.sap.adt.repository.generator.content.v1+json'],
  ['schema', 'schema', 'application/vnd.sap.adt.repository.generator.schema.v1+json'],
  ['validation', 'validation', 'application/vnd.sap.as+xml;charset=utf-8;dataname=com.sap.adt.StatusMessage'],
  ['preview', 'preview', 'application/vnd.sap.adt.repository.generator.preview.v1+xml'],
]
  .map(
    ([rel, path, type]) =>
      `<atom:link href="/sap/bc/adt/businessservices/generators/uiservice/${path}" rel="http://www.sap.com/adt/repository/generator/${rel}" type="${type}"/>`,
  )
  .join(
    '',
  )}<atom:link href="/sap/bc/adt/businessservices/generators/uiservice" rel="http://www.sap.com/adt/repository/generator" type="application/vnd.sap.adt.repository.generator.v1+json"/></atom:entry></atom:feed>`;
const STATUS = (severity: string, text: string) =>
  `<?xml version="1.0" encoding="utf-8"?><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DATA><SEVERITY>${severity}</SEVERITY><SHORT_TEXT>${text}</SHORT_TEXT></DATA></asx:values></asx:abap>`;
const PREVIEW_758 = `<?xml version="1.0" encoding="utf-8"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="/sap/bc/adt/ddic/ddl/sources/zr_travel" adtcore:type="DDLS/DF" adtcore:name="ZR_TRAVEL"/><adtcore:objectReference adtcore:uri="/sap/bc/adt/businessservices/bindings/zui_travel_o4" adtcore:type="SRVB/SVB" adtcore:name="ZUI_TRAVEL_O4"/></adtcore:objectReferences>`;

describe('RAP service generators across releases', () => {
  const uiservice = (): GeneratorInfo => {
    const found = parseGeneratorFeed(FEED_758)[0];
    if (!found) throw new Error('feed lost uiservice');
    return found;
  };
  const rapInput = { metadata: { package: '$TMP', masterLanguage: 'EN' }, general: { referenceObjectName: 'ZTRAVEL' } };

  it('supports the 816 and the 758 ids, each under its own path', () => {
    expect(isSupportedGenerator('ui-service')).toBe(true);
    expect(isSupportedGenerator('webapi-service')).toBe(true);
    expect(isSupportedGenerator('uiservice')).toBe(true);
    expect(isSupportedGenerator('webapiservice')).toBe(true);
    expect(generatorEndpoint(uiservice(), 'preview')).toBe('/sap/bc/adt/businessservices/generators/uiservice/preview');
    const ui816 = parseGeneratorFeed(fixture('generators-tabl-816.xml')).find((g) => g.id === 'ui-service');
    expect(ui816 && generatorEndpoint(ui816, 'generator')).toBe('/sap/bc/adt/rap/generators/ui/ui-service');
    const crossed = {
      ...uiservice(),
      links: { ...uiservice().links, preview: '/sap/bc/adt/rap/generators/ui/ui-service/preview' },
    };
    expect(() => generatorEndpoint(crossed, 'preview')).toThrow(AdtSafetyError);
  });

  it('sends and accepts the media types SAP declares on the feed links', async () => {
    const { http, calls } = mockHttp({
      '/uiservice/validation': STATUS('OK', ''),
      '/uiservice/preview': PREVIEW_758,
      '/generators/uiservice': '<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"/>',
    });
    await validateGeneratorInput(http, unrestrictedSafetyConfig(), uiservice(), REF, rapInput);
    await previewGenerator(http, unrestrictedSafetyConfig(), uiservice(), REF, rapInput);
    await runGenerator(http, unrestrictedSafetyConfig(), uiservice(), REF, rapInput, 'A4HK900123');
    for (const call of calls) {
      expect(call.contentType).toBe('application/vnd.sap.adt.repository.generator.content.v1+json');
    }
    expect(calls.map((c) => c.headers?.Accept)).toEqual([
      'application/vnd.sap.as+xml;charset=utf-8;dataname=com.sap.adt.StatusMessage',
      'application/vnd.sap.adt.repository.generator.preview.v1+xml',
      'application/vnd.sap.adt.repository.generator.v1+json',
    ]);
  });

  it('reads the 758 StatusMessage and fails closed on answers it cannot read', () => {
    expect(parseGeneratorValidation(STATUS('OK', ''))).toEqual([{ severity: 'OK', text: '' }]);
    expect(generatorValidationPassed(parseGeneratorValidation(STATUS('OK', '')))).toBe(true);
    const error = parseGeneratorValidation(STATUS('ERROR', 'Object ZR_TRAVEL already exists'));
    expect(generatorValidationPassed(error)).toBe(false);
    expect(generatorValidationPassed(parseGeneratorValidation('<unexpected/>'))).toBe(false);
    expect(generatorValidationPassed([])).toBe(false);
    expect(generatorValidationPassed(parseGeneratorValidation(fixture('generator-validation-ok.xml')))).toBe(true);
  });

  it('reads the flat 758 preview and refuses an empty one', async () => {
    expect(parseGeneratorPreview(PREVIEW_758)).toEqual([
      { group: '', operation: '', type: 'DDLS/DF', name: 'ZR_TRAVEL', uri: '/sap/bc/adt/ddic/ddl/sources/zr_travel' },
      {
        group: '',
        operation: '',
        type: 'SRVB/SVB',
        name: 'ZUI_TRAVEL_O4',
        uri: '/sap/bc/adt/businessservices/bindings/zui_travel_o4',
      },
    ]);
    const { http } = mockHttp({
      '/uiservice/preview': '<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"/>',
    });
    await expect(previewGenerator(http, unrestrictedSafetyConfig(), uiservice(), REF, rapInput)).rejects.toThrow(
      /no objects/,
    );
  });

  it('pins the referenced table and puts metadata first, keeping SAP order elsewhere', () => {
    const proposal = {
      general: { referenceObjectName: 'ZTRAVEL', description: 'Travel' },
      metadata: { package: '' },
      businessObject: { name: 'ZR_TRAVEL' },
    };
    const input = buildGeneratorInput(
      'uiservice',
      proposal,
      { general: { description: 'Trips', referenceObjectName: 'ztravel' }, businessObject: { name: 'ZR_TRIP' } },
      'ZPKG',
      'EN',
      'ztravel',
    );
    expect(Object.keys(input)).toEqual(['metadata', 'general', 'businessObject']);
    expect(Object.keys(input.general as object)).toEqual(['referenceObjectName', 'description']);
    expect(input.general).toEqual({ referenceObjectName: 'ZTRAVEL', description: 'Trips' });
    expect(input.metadata).toEqual({ package: 'ZPKG', masterLanguage: 'EN' });
    expect(() =>
      buildGeneratorInput(
        'uiservice',
        proposal,
        { general: { referenceObjectName: 'ZOTHER' } },
        'ZPKG',
        'EN',
        'ZTRAVEL',
      ),
    ).toThrow(/referenced object/);
    // Not added where SAP's proposal has no such field.
    expect(buildGeneratorInput('ui-service', { metadata: {} }, undefined, 'ZPKG', 'EN', 'ZTRAVEL')).toEqual({
      metadata: { package: 'ZPKG', masterLanguage: 'EN' },
    });
  });
});
