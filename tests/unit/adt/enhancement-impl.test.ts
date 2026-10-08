import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildBadiImplementationXml,
  getBadiEnhancementImplementation,
  getEnhancementSpotBadis,
  mergeBadiImplementationDefinition,
  parseBadiImplementationDefinition,
  resolveBadiFilters,
} from '../../../src/adt/enhancement-impl.js';
import { parseEnhancementMetadata } from '../../../src/adt/enhancements.js';
import { buildFilterTreeXml, normalizeFilterCondition, parseFilterCondition } from '../../../src/adt/enho-filter.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { parseEnhancementImplementation } from '../../../src/adt/xml-parser.js';
import { objectUrlForType } from '../../../src/handlers/object-types.js';

const XHB = readFileSync(new URL('../../fixtures/xml/enhancement-implementation.xml', import.meta.url), 'utf8');
const SPOT = readFileSync(new URL('../../fixtures/xml/enhancement-spot.xml', import.meta.url), 'utf8');
const FILTERED = readFileSync(
  new URL('../../fixtures/xml/enhancement-implementation-filter.xml', import.meta.url),
  'utf8',
);

const xmlParams = (definition: Parameters<typeof buildBadiImplementationXml>[0]['definition']) => ({
  name: 'ZMY_ENH_APPROVAL_REASON',
  description: 'Approval Reason BAdI',
  package: 'ZMY_APPROVAL',
  definition,
  masterLanguage: 'EN',
  responsibleAttr: ' adtcore:responsible="DEVELOPER"',
});

describe('parseBadiImplementationDefinition', () => {
  it('accepts SAPRead output unchanged and takes the spot from the entries', () => {
    const read = parseEnhancementImplementation(XHB);
    const def = parseBadiImplementationDefinition(JSON.stringify(read));
    expect(def.enhancementSpot).toBe('BCF_REMOTE_TCD');
    expect(def.badiImplementations).toEqual([
      {
        name: 'SFW_TCD',
        badiDefinition: 'BCF_TCD_REMOTE_BADI',
        implementingClass: 'CL_SFW_TCD',
        shortText: 'Implementierung: BCF: BADI für TCD Remote Service',
        active: true,
        default: false,
      },
      {
        name: 'SFW_TCD_B',
        badiDefinition: 'BCF_TCD_REMOTE_BADI',
        implementingClass: 'CL_SFW_TCD_B',
        shortText: 'Second impl',
        active: false,
        default: true,
      },
    ]);
  });

  it('upper-cases names and accepts string booleans', () => {
    const def = parseBadiImplementationDefinition(
      JSON.stringify({
        enhancementSpot: 'es_x',
        badiImplementations: [{ name: 'zi', badiDefinition: 'b', implementingClass: 'zcl_i', active: 'false' }],
      }),
    );
    expect(def).toEqual({
      enhancementSpot: 'ES_X',
      badiImplementations: [{ name: 'ZI', badiDefinition: 'B', implementingClass: 'ZCL_I', active: false }],
    });
  });

  it.each([
    ['not json', 'expected a JSON object'],
    ['[]', 'expected a JSON object'],
    ['{"spot":"ES_X"}', 'unknown key(s) "spot"'],
    ['{"badiImplementations":{}}', 'must be an array'],
    ['{"badiImplementations":[{"name":"ZI","badiDefinition":"B","implementingClass":"ZC","filters":1}]}', '"filters"'],
    ['{"badiImplementations":[{"name":"ZI","badiDefinition":"B","implementingClass":"ZC","active":"yes"}]}', 'active'],
    ['{"badiImplementations":[{"name":"Z I","badiDefinition":"B","implementingClass":"ZC"}]}', 'not a valid ABAP name'],
    [
      '{"badiImplementations":[{"name":"ZI","badiDefinition":"B","implementingClass":"ZC"},{"name":"zi","badiDefinition":"B","implementingClass":"ZC"}]}',
      'listed twice',
    ],
    [
      '{"enhancementSpot":"ES_A","badiImplementations":[{"name":"ZI","badiDefinition":"B","implementingClass":"ZC","enhancementSpot":"ES_B"}]}',
      'one enhancement spot',
    ],
    ['{"technology":"HOOK_IMPL"}', 'only BAdI implementations'],
  ])('rejects %s', (source, message) => {
    expect(() => parseBadiImplementationDefinition(source)).toThrow(message);
  });
});

describe('mergeBadiImplementationDefinition', () => {
  const existing = parseEnhancementImplementation(XHB);

  it('keeps everything when the definition is empty', () => {
    const merged = mergeBadiImplementationDefinition(existing, {});
    expect(merged.enhancementSpot).toBe('BCF_REMOTE_TCD');
    expect(merged.badiImplementations?.map((impl) => [impl.name, impl.active, impl.default])).toEqual([
      ['SFW_TCD', true, false],
      ['SFW_TCD_B', false, true],
    ]);
  });

  it('replaces the list and fills omitted flags of known entries from the stored ones', () => {
    const merged = mergeBadiImplementationDefinition(existing, {
      badiImplementations: [
        { name: 'SFW_TCD_B', badiDefinition: 'BCF_TCD_REMOTE_BADI', implementingClass: 'CL_SFW_TCD_B', active: true },
        { name: 'ZNEW', badiDefinition: 'BCF_TCD_REMOTE_BADI', implementingClass: 'ZCL_NEW' },
      ],
    });
    expect(merged.badiImplementations).toEqual([
      {
        name: 'SFW_TCD_B',
        badiDefinition: 'BCF_TCD_REMOTE_BADI',
        implementingClass: 'CL_SFW_TCD_B',
        shortText: 'Second impl',
        active: true,
        default: true,
      },
      {
        name: 'ZNEW',
        badiDefinition: 'BCF_TCD_REMOTE_BADI',
        implementingClass: 'ZCL_NEW',
        shortText: undefined,
        active: undefined,
        default: undefined,
      },
    ]);
  });

  it('refuses a different spot', () => {
    expect(() => mergeBadiImplementationDefinition(existing, { enhancementSpot: 'ES_OTHER' })).toThrow(
      'enhancement spot cannot change',
    );
  });
});

describe('buildBadiImplementationXml', () => {
  it('builds a document that SAP-shaped parsing reads back to the same definition', () => {
    const xml = buildBadiImplementationXml(
      xmlParams({
        enhancementSpot: 'ES_SD_SLS_EXTEND',
        badiImplementations: [
          {
            name: 'ZMY_BADI_APPROVAL_REASON',
            badiDefinition: 'SD_APM_SET_APPROVAL_REASON',
            implementingClass: 'ZCL_MY_APPROVAL_REASON',
          },
          {
            name: 'ZMY_BADI_2',
            badiDefinition: 'SD_APM_SET_APPROVAL_REASON',
            implementingClass: 'ZCL_2',
            active: false,
            default: true,
          },
        ],
      }),
    );
    expect(xml).toContain('adtcore:responsible="DEVELOPER"');
    expect(xml).toContain('<adtcore:packageRef adtcore:name="ZMY_APPROVAL"/>');
    expect(xml).toContain('adtcore:uri="/sap/bc/adt/enhancements/enhsxsb/es_sd_sls_extend"');
    expect(xml).toContain('adtcore:uri="/sap/bc/adt/oo/classes/zcl_my_approval_reason"');
    expect(parseEnhancementImplementation(xml)).toEqual({
      name: 'ZMY_ENH_APPROVAL_REASON',
      description: 'Approval Reason BAdI',
      package: 'ZMY_APPROVAL',
      technology: 'BADI_IMPL',
      switchSupported: false,
      badiImplementations: [
        {
          name: 'ZMY_BADI_APPROVAL_REASON',
          shortText: '',
          implementingClass: 'ZCL_MY_APPROVAL_REASON',
          badiDefinition: 'SD_APM_SET_APPROVAL_REASON',
          enhancementSpot: 'ES_SD_SLS_EXTEND',
          active: true,
          default: false,
        },
        {
          name: 'ZMY_BADI_2',
          shortText: '',
          implementingClass: 'ZCL_2',
          badiDefinition: 'SD_APM_SET_APPROVAL_REASON',
          enhancementSpot: 'ES_SD_SLS_EXTEND',
          active: false,
          default: true,
        },
      ],
    });
  });

  it('escapes descriptions and short texts', () => {
    const xml = buildBadiImplementationXml({
      ...xmlParams({
        enhancementSpot: 'ES_X',
        badiImplementations: [{ name: 'ZI', badiDefinition: 'B', implementingClass: 'ZC', shortText: 'a "b" <c> & d' }],
      }),
      description: 'R&D <test> "quoted"',
    });
    expect(xml).toContain('adtcore:description="R&amp;D &lt;test&gt; &quot;quoted&quot;"');
    expect(xml).toContain('enho:shortText="a &quot;b&quot; &lt;c&gt; &amp; d"');
    expect(parseEnhancementImplementation(xml).badiImplementations[0].shortText).toBe('a "b" <c> & d');
  });

  it('URL-encodes namespaced names in references', () => {
    const xml = buildBadiImplementationXml(
      xmlParams({
        enhancementSpot: '/ABC/ES_X',
        badiImplementations: [{ name: '/ABC/I', badiDefinition: '/ABC/B', implementingClass: '/ABC/CL_I' }],
      }),
    );
    expect(xml).toContain('/sap/bc/adt/enhancements/enhsxsb/%2Fabc%2Fes_x');
    expect(xml).toContain('/sap/bc/adt/oo/classes/%2Fabc%2Fcl_i');
  });

  it('requires the enhancement spot', () => {
    expect(() => buildBadiImplementationXml(xmlParams({ badiImplementations: [] }))).toThrow(
      'enhancementSpot is required',
    );
  });
});

describe('filter-dependent BAdI implementations', () => {
  it('SAPRead shows each filter tree as a read-only condition', () => {
    expect(parseEnhancementMetadata(FILTERED).badiImplementations.map((impl) => impl.filter)).toEqual([
      "LGNUM = '1000' OR LGNUM = '2000'",
      "COUNTRY = 'BE'",
    ]);
    // Implementations without filters carry no key, so existing read output is unchanged.
    expect(parseEnhancementMetadata(XHB).badiImplementations[0]).not.toHaveProperty('filter');
  });

  it('refuses to build a filter that was not resolved against the spot', () => {
    expect(() =>
      buildBadiImplementationXml(
        xmlParams({
          enhancementSpot: 'ES_X',
          badiImplementations: [{ name: 'ZI', badiDefinition: 'B', implementingClass: 'ZC', filter: "COUNTRY = 'DE'" }],
        }),
      ),
    ).toThrow('the filter was not resolved against the spot');
  });
});

describe('filter conditions', () => {
  it.each([
    ["COUNTRY = 'BE'", "COUNTRY = 'BE'"],
    ['country = BE', "COUNTRY = 'BE'"],
    ["A = '1' OR B = '2' AND C = '3'", "A = '1' OR (B = '2' AND C = '3')"],
    ["(A = '1' OR B = '2') AND C <> '3'", "(A = '1' OR B = '2') AND C <> '3'"],
    ["A = '1' OR (B = '2' OR C = '3')", "A = '1' OR B = '2' OR C = '3'"],
    ["X cp 'AB*' and Y NP '*Z'", "X CP 'AB*' AND Y NP '*Z'"],
    ["T = 'it''s'", "T = 'it''s'"],
    ["N >= '10' AND N < '20'", "N >= '10' AND N < '20'"],
  ])('normalizes %s', (input, canonical) => {
    expect(normalizeFilterCondition(input)).toBe(canonical);
    expect(normalizeFilterCondition(canonical)).toBe(canonical);
  });

  it.each([
    ['', 'empty'],
    ["COUNTRY 'BE'", 'expected one of'],
    ['COUNTRY =', 'needs a value'],
    ["(A = '1'", 'closing parenthesis'],
    ["A = '1' B = '2'", 'combine conditions with AND or OR'],
    ["A = 'open", 'unterminated quote'],
  ])('rejects %j', (input, message) => {
    expect(() => parseFilterCondition(input)).toThrow(message);
  });

  it('builds the same filter tree SAP stores (816 shape)', async () => {
    const headers: unknown[] = [];
    const http = {
      get: async (_path: string, h?: unknown) => {
        headers.push(h);
        return { body: SPOT };
      },
    } as unknown as AdtHttpClient;
    const badis = await getEnhancementSpotBadis(http, unrestrictedSafetyConfig(), 'ES_MY_SPOT');
    expect(headers).toEqual([{ Accept: 'application/vnd.sap.adt.enh.enhs.v2+xml' }]);
    expect([...badis.keys()]).toEqual(['BADI_MY_FILTERED', 'BADI_MY_PLAIN']);
    expect([...(badis.get('BADI_MY_PLAIN')?.keys() ?? [])]).toEqual([]);
    const filters = badis.get('BADI_MY_FILTERED') ?? new Map();
    const stored = FILTERED.split('enho:name="ZMY_IMPL_COUNTRY"')[1]?.match(
      /<enho:filterTree>[\s\S]*?<\/enho:filterTree>/,
    )?.[0];
    const built = buildFilterTreeXml(
      parseFilterCondition("COUNTRY = 'BE'"),
      'ZMY_IMPL_COUNTRY',
      filters,
      'BADI_MY_FILTERED',
    );
    expect(built).toBe(stored);
    // A filter without a DDIC check gets a bare property; groups nest as SAP writes them.
    const group = buildFilterTreeXml(
      parseFilterCondition("(COUNTRY = 'DE' OR COUNTRY = 'AT') AND GENERIC_FILTER = 'X'"),
      'ZI',
      filters,
      'BADI_MY_FILTERED',
    );
    expect(group).toContain(
      '<enho:filterToken xsi:type="enho:And" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><enho:filterToken xsi:type="enho:Or">',
    );
    expect(group).toContain('<enho:filterProperty enho:filterName="GENERIC_FILTER" enho:filterType="S"/>');
    expect(group.match(/<enho:filterProperty enho:filterName="COUNTRY"/g)).toHaveLength(1);
    expect(() => buildFilterTreeXml(parseFilterCondition("REGION = 'X'"), 'ZI', filters, 'BADI_MY_FILTERED')).toThrow(
      'declares no filter REGION (declared: COUNTRY, LGNUM, GENERIC_FILTER)',
    );
  });
});

describe('resolveBadiFilters', () => {
  const definition = (filter?: string) => ({
    enhancementSpot: 'ES_MY_SPOT',
    badiImplementations: [
      { name: 'ZI', badiDefinition: 'BADI_MY_FILTERED', implementingClass: 'ZC', ...(filter ? { filter } : {}) },
    ],
  });
  const failingHttp = (status: number) =>
    ({
      get: async () => {
        throw new AdtApiError('spot read failed', status, '/sap/bc/adt/enhancements/enhsxsb/es_my_spot');
      },
    }) as unknown as AdtHttpClient;
  const safety = unrestrictedSafetyConfig();

  it('reports a missing spot', async () => {
    await expect(resolveBadiFilters(failingHttp(404), safety, definition())).rejects.toThrow(
      'enhancement spot ES_MY_SPOT does not exist',
    );
  });

  it('continues without the spot check when no filter has to be built', async () => {
    const result = await resolveBadiFilters(failingHttp(403), safety, definition());
    expect(result.badiImplementations?.[0].filterTreeXml).toBeUndefined();
  });

  it('fails when a filter has to be built but the spot cannot be read', async () => {
    await expect(resolveBadiFilters(failingHttp(403), safety, definition("COUNTRY = 'DE'"))).rejects.toThrow(
      'spot read failed',
    );
    const unparsable = { get: async () => ({ body: '<html/>' }) } as unknown as AdtHttpClient;
    await expect(resolveBadiFilters(unparsable, safety, definition("COUNTRY = 'DE'"))).rejects.toThrow(
      'could not read the BAdI filter declarations',
    );
  });

  it('builds the tree for a new filter and leaves kept filters alone', async () => {
    const http = { get: async () => ({ body: SPOT }) } as unknown as AdtHttpClient;
    const result = await resolveBadiFilters(http, safety, definition("COUNTRY = 'DE'"));
    expect(result.badiImplementations?.[0].filterTreeXml).toContain('enho:value="DE"');
    const kept = await resolveBadiFilters(http, safety, {
      ...definition("COUNTRY = 'BE'"),
      badiImplementations: [
        { ...definition().badiImplementations[0], filter: "COUNTRY = 'BE'", keepStoredFilter: true },
      ],
    });
    expect(kept.badiImplementations?.[0].filterTreeXml).toBeUndefined();
  });
});

describe('ENHO object URL', () => {
  it('routes activation, transport and lock calls to the XHB collection', () => {
    expect(objectUrlForType('ENHO', 'ZMY_ENH_APPROVAL_REASON')).toBe(
      '/sap/bc/adt/enhancements/enhoxhb/ZMY_ENH_APPROVAL_REASON',
    );
  });
});

describe('stored content outside the JSON model', () => {
  const httpReturning = (body: string) => ({ get: async () => ({ body }) }) as unknown as AdtHttpClient;
  const keepAll = (stored: Awaited<ReturnType<typeof getBadiEnhancementImplementation>>) =>
    mergeBadiImplementationDefinition(stored, {
      badiImplementations: stored.badiImplementations.map(({ name, badiDefinition, implementingClass }) => ({
        name,
        badiDefinition,
        implementingClass,
      })),
    });

  it('decodes preserved attributes once, so the PUT does not escape them twice', async () => {
    const xml = FILTERED.replace('enho:customizingLock="X"', 'enho:customizingLock="A&amp;B"');
    const stored = await getBadiEnhancementImplementation(httpReturning(xml), unrestrictedSafetyConfig(), 'ZI');
    expect(stored.preserved?.get('ZMY_IMPL_WAREHOUSE')?.customizingLock).toBe('A&B');
    const body = buildBadiImplementationXml(xmlParams(keepAll(stored)));
    expect(body).toContain('enho:customizingLock="A&amp;B"');
    expect(body).not.toContain('&amp;amp;');
  });

  it('keeps a filter tree with an unknown token kind verbatim and does not misstate it as text', async () => {
    const xml = FILTERED.replace('xsi:type="enho:Or"', 'xsi:type="enho:Not"');
    const stored = await getBadiEnhancementImplementation(httpReturning(xml), unrestrictedSafetyConfig(), 'ZI');
    const warehouse = stored.badiImplementations.find((impl) => impl.name === 'ZMY_IMPL_WAREHOUSE');
    expect(warehouse).not.toHaveProperty('filter');
    const body = buildBadiImplementationXml(xmlParams(keepAll(stored)));
    expect(body).toContain('<enho:filterToken xsi:type="enho:Not"');
    expect(body.match(/<enho:filterTree>/g)).toHaveLength(2);
  });

  it('reads a self-closing BAdI definition without swallowing the next one', async () => {
    const spot = SPOT.replace(
      '<enhs:badiDefinitions>',
      '<enhs:badiDefinitions><enhs:badiDefinition enhs:name="BADI_EMPTY"/>',
    );
    const badis = await getEnhancementSpotBadis(httpReturning(spot), unrestrictedSafetyConfig(), 'ES_MY_SPOT');
    expect([...badis.keys()]).toEqual(['BADI_EMPTY', 'BADI_MY_FILTERED', 'BADI_MY_PLAIN']);
    expect([...(badis.get('BADI_MY_FILTERED')?.keys() ?? [])]).toEqual(['COUNTRY', 'LGNUM', 'GENERIC_FILTER']);
  });

  it('rejects a shortText that is not a text', () => {
    const source = JSON.stringify({
      enhancementSpot: 'ES_X',
      badiImplementations: [{ name: 'ZI', badiDefinition: 'B', implementingClass: 'ZC', shortText: { de: 'x' } }],
    });
    expect(() => parseBadiImplementationDefinition(source)).toThrow('badiImplementations[0].shortText must be a text');
  });
});
