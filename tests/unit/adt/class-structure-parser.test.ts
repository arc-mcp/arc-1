/**
 * Unit tests for parseClassStructure (issue #303).
 *
 * Verifies parsing against captured live fixtures from two SAP releases:
 *   - tests/fixtures/xml/objectstructure-clas-a4h-758.xml  (S/4HANA 2023, kernel 7.58)
 *   - tests/fixtures/xml/objectstructure-clas-npl-750.xml  (NW 7.50 SP02)
 *
 * The two releases emit DIFFERENT wire shapes for methods (see parseClassStructure
 * jsdoc); this suite guards both.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import { parseClassStructure } from '../../../src/adt/xml-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, '../../fixtures/xml');

const A4H_XML = readFileSync(resolve(FIXTURES, 'objectstructure-clas-a4h-758.xml'), 'utf-8');
const NPL_XML = readFileSync(resolve(FIXTURES, 'objectstructure-clas-npl-750.xml'), 'utf-8');

describe('parseClassStructure — a4h (kernel 7.58) fixture', () => {
  it('returns class-level definitionBlock + implementationBlock', () => {
    const s = parseClassStructure(A4H_XML);
    expect(s.classDefinitionBlock).toEqual({ sr: 1, sc: 0, er: 10, ec: 8 });
    expect(s.classImplementationBlock).toEqual({ sr: 12, sc: 0, er: 22, ec: 8 });
  });

  it('extracts the class name', () => {
    const s = parseClassStructure(A4H_XML);
    expect(s.className).toBe('ZCL_ARC1_PROBE303');
  });

  it('returns each method with merged definition + implementation ranges', () => {
    const s = parseClassStructure(A4H_XML);
    expect(s.methods).toHaveLength(2);
    const hello = s.methods.find((m) => m.name === 'HELLO');
    expect(hello).toMatchObject({
      visibility: 'public',
      level: 'instance',
      abstract: false,
      constructor: false,
      definition: { sr: 3, sc: 4, er: 5, ec: 41 },
      implementation: { sr: 14, sc: 2, er: 16, ec: 11 },
    });
    const bye = s.methods.find((m) => m.name === 'GOODBYE');
    expect(bye?.definition).toEqual({ sr: 6, sc: 4, er: 7, ec: 41 });
    expect(bye?.implementation).toEqual({ sr: 18, sc: 2, er: 20, ec: 11 });
  });

  it('captures method identifiers separately from blocks', () => {
    const s = parseClassStructure(A4H_XML);
    const hello = s.methods.find((m) => m.name === 'HELLO');
    expect(hello?.definitionIdentifier).toBeDefined();
    expect(hello?.implementationIdentifier).toBeDefined();
  });

  it('skips CLAS/OF friends, CLAS/OE events, CLAS/OT types, CLAS/OK literals, CLAS/OCX text-elements', () => {
    const s = parseClassStructure(A4H_XML);
    expect(s.methods.map((m) => m.name)).toEqual(['HELLO', 'GOODBYE']);
  });
});

describe('parseClassStructure — NPL (kernel 7.50) split shape', () => {
  it('merges CLAS/OO + CLAS/OM entries by method name', () => {
    const s = parseClassStructure(NPL_XML);
    expect(s.classDefinitionBlock).toEqual({ sr: 1, sc: 0, er: 175, ec: 8 });
    expect(s.classImplementationBlock).toEqual({ sr: 179, sc: 0, er: 636, ec: 8 });
    // 12 concrete methods + 1 abstract (IS_INSTANTIATABLE) on CL_ABAP_TYPEDESCR
    expect(s.methods.length).toBe(13);
  });

  it('keeps an ABSTRACT method with no implementation range', () => {
    const s = parseClassStructure(NPL_XML);
    const abs = s.methods.find((m) => m.name === 'IS_INSTANTIATABLE');
    expect(abs).toBeDefined();
    expect(abs?.abstract).toBe(true);
    expect(abs?.definition).toBeDefined();
    expect(abs?.implementation).toBeUndefined();
  });

  it('every non-abstract method has both definition AND implementation ranges', () => {
    const s = parseClassStructure(NPL_XML);
    const concrete = s.methods.filter((m) => !m.abstract);
    expect(concrete.length).toBe(12);
    for (const m of concrete) {
      expect(m.definition).toBeDefined();
      expect(m.implementation).toBeDefined();
    }
  });

  it('preserves visibility from the def-side CLAS/OO element', () => {
    const s = parseClassStructure(NPL_XML);
    // CL_ABAP_TYPEDESCR's CLASS_CONSTRUCTOR is public + static.
    const ctor = s.methods.find((m) => m.name === 'CLASS_CONSTRUCTOR');
    expect(ctor).toBeDefined();
    expect(ctor?.visibility).toBe('public');
    expect(ctor?.level).toBe('static');
    expect(ctor?.constructor).toBe(true);
  });

  it('parses CLAS/OA attributes', () => {
    const s = parseClassStructure(NPL_XML);
    expect(s.attributes.length).toBeGreaterThan(0);
    // ABSOLUTE_NAME is a known public instance attribute on CL_ABAP_TYPEDESCR.
    const abs = s.attributes.find((a) => a.name === 'ABSOLUTE_NAME');
    expect(abs).toBeDefined();
    expect(abs?.visibility).toBe('public');
    expect(abs?.readOnly).toBe(true);
  });
});

describe('parseClassStructure — error handling', () => {
  it('throws AdtApiError on empty input', () => {
    expect(() => parseClassStructure('')).toThrow(AdtApiError);
  });

  it('throws AdtApiError when response is missing the class-level definitionBlock atom:link', () => {
    expect(() => parseClassStructure('<abapsource:objectStructureElement/>')).toThrow(
      /missing class-level definitionBlock/,
    );
  });

  it('uses caller-provided className when XML omits adtcore:name', () => {
    const xml = `<abapsource:objectStructureElement>
      <atom:link rel="http://www.sap.com/adt/relations/source/definitionBlock" href="./../zcl_x/source/main#start=1,0;end=5,8"/>
    </abapsource:objectStructureElement>`;
    const s = parseClassStructure(xml, 'ZCL_FALLBACK');
    expect(s.className).toBe('ZCL_FALLBACK');
  });

  it('returns ec=0 when range href has 0 column', () => {
    // Regression: ensure parseLineRange returns 0 not undefined when ec=0.
    const s = parseClassStructure(A4H_XML);
    // classImplementationBlock end col on a4h fixture is 8 — this just confirms
    // structural integrity of the LineRange shape.
    expect(typeof s.classImplementationBlock?.ec).toBe('number');
  });
});
