import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildBadiImplementationXml,
  mergeBadiImplementationDefinition,
  parseBadiImplementationDefinition,
} from '../../../src/adt/enhancement-impl.js';
import { parseEnhancementMetadata } from '../../../src/adt/enhancements.js';
import { parseEnhancementImplementation } from '../../../src/adt/xml-parser.js';
import { objectUrlForType } from '../../../src/handlers/object-types.js';

const XHB = readFileSync(new URL('../../fixtures/xml/enhancement-implementation.xml', import.meta.url), 'utf8');
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

  it('rejects a filter on a new implementation', () => {
    expect(() =>
      buildBadiImplementationXml(
        xmlParams({
          enhancementSpot: 'ES_X',
          badiImplementations: [{ name: 'ZI', badiDefinition: 'B', implementingClass: 'ZC', filter: "COUNTRY = 'DE'" }],
        }),
      ),
    ).toThrow('filter values cannot be written through ARC-1 yet');
  });
});

describe('ENHO object URL', () => {
  it('routes activation, transport and lock calls to the XHB collection', () => {
    expect(objectUrlForType('ENHO', 'ZMY_ENH_APPROVAL_REASON')).toBe(
      '/sap/bc/adt/enhancements/enhoxhb/ZMY_ENH_APPROVAL_REASON',
    );
  });
});
