import { describe, expect, it } from 'vitest';
import {
  assertClassEditBoundary,
  assertClassEndInsertionBoundary,
  assertMethodDeclarationBoundary,
  assertMethodDeclarationReplacement,
  assertMethodImplementationBoundary,
  assertSectionHeaderBoundary,
} from '../../../src/adt/class-edit-boundaries.js';
import { insertMethodPair, spliceMethodSignature } from '../../../src/adt/class-structure.js';
import type { ClassStructure, MethodStructure } from '../../../src/adt/types.js';

const range = (sr: number, er = sr) => ({ sr, er, sc: 0, ec: 0 });
const method: MethodStructure = {
  name: 'SELECTED',
  visibility: 'public',
  level: 'instance',
  abstract: false,
  constructor: false,
  definition: range(3),
  implementation: range(7, 8),
};
const source =
  'CLASS zboundary DEFINITION.\n  PUBLIC SECTION.\n    METHODS selected.\n  PRIVATE SECTION.\nENDCLASS.\nCLASS zboundary IMPLEMENTATION.\n  METHOD selected.\n  ENDMETHOD.\nENDCLASS.';
const structure: ClassStructure = {
  className: 'ZBOUNDARY',
  classDefinitionBlock: range(1, 5),
  classImplementationBlock: range(6, 9),
  methods: [method],
  attributes: [],
};

describe('whole-line class surgery boundaries', () => {
  it.each([
    'METHODS selected. METHODS neighbor.',
    'PUBLIC SECTION. METHODS selected.',
    'METHODS selected. PRIVATE SECTION.',
    'METHODS neighbor.',
    'METHODS: selected, neighbor.',
    'METHODS selected',
  ])('refuses a declaration slice with unowned content: %s', (line) => {
    expect(() => assertMethodDeclarationBoundary(line, range(1), 'SELECTED')).toThrow('safely isolate');
  });
  it.each([
    'CLASS zboundary IMPLEMENTATION. METHOD selected.\nENDMETHOD.',
    'METHOD selected.\nENDMETHOD. METHOD neighbor.',
    'METHOD selected.\nENDMETHOD. ENDCLASS.',
    'METHOD neighbor.\nENDMETHOD.',
    'METHOD selected.\nENDMETHOD.\nMETHOD neighbor.\nENDMETHOD.',
  ])('refuses an implementation slice with unowned content: %s', (text) => {
    expect(() => assertMethodImplementationBoundary(text, range(1, text.split('\n').length), 'SELECTED')).toThrow(
      'safely isolate',
    );
  });
  it.each([range(0), range(3, 2), range(1, 99), range(1.5)])('rejects invalid line ranges %j', (r) => {
    expect(() => assertMethodDeclarationBoundary(source, r, 'SELECTED')).toThrow('safely isolate');
  });
  it('keeps multiline declarations, comments and CRLF neighbors intact', () => {
    const text = source
      .replace('    METHODS selected.', '    METHODS selected\n      IMPORTING value TYPE string. " signature')
      .replaceAll('\n', '\r\n');
    const next = spliceMethodSignature(
      text,
      { ...method, definition: range(3, 4) },
      'METHODS selected IMPORTING value TYPE i.',
    );
    expect(next).toBe(
      text.replace(
        '    METHODS selected\r\n      IMPORTING value TYPE string. " signature',
        'METHODS selected IMPORTING value TYPE i.',
      ),
    );
  });
  it('does not mistake comments and string literals for method boundaries', () => {
    const text = 'METHOD selected. " ENDMETHOD.\n DATA(message) = `ENDMETHOD. METHOD neighbor.`.\nENDMETHOD.';
    expect(() => assertMethodImplementationBoundary(text, range(1, 3), 'SELECTED')).not.toThrow();
  });
  it('allows insertion after the final member of a chain, with the existing chain preserved', () => {
    const text = source.replace('    METHODS selected.', '    METHODS: first,\n             selected.');
    const s = {
      ...structure,
      classDefinitionBlock: range(1, 6),
      classImplementationBlock: range(7, 10),
      methods: [
        { ...method, name: 'FIRST', definition: range(3) },
        { ...method, definition: range(3, 4) },
      ],
    };
    const next = insertMethodPair(text, s, {
      decl: 'METHODS added.',
      methodName: 'ADDED',
      visibility: 'public',
      isAbstract: false,
    });
    expect(next).toContain('    METHODS: first,\n             selected.\nMETHODS added.\n  PRIVATE SECTION.');
    expect(next).toContain('  ENDMETHOD.\n\n  METHOD added.\n  ENDMETHOD.\nENDCLASS.');
  });
  it.each(['PUBLIC SECTION. PRIVATE SECTION.', 'PUBLIC SECTION. METHODS selected.'])(
    'refuses a shared section-header line %s',
    (line) => {
      expect(() => assertSectionHeaderBoundary(line, 1, 'public')).toThrow('safely isolate');
    },
  );
  it('accepts a section header with a trailing comment', () => {
    expect(() => assertSectionHeaderBoundary(' PUBLIC SECTION. " comment', 1, 'public')).not.toThrow();
  });
  it('refuses an insertion before ENDCLASS shared with another statement', () => {
    expect(() => assertClassEndInsertionBoundary('ENDMETHOD. ENDCLASS.', 1)).toThrow('safely isolate');
    const text = source.replace('  ENDMETHOD.\nENDCLASS.', '  ENDMETHOD. ENDCLASS.');
    expect(() =>
      insertMethodPair(
        text,
        { ...structure, classImplementationBlock: range(6, 8) },
        { decl: 'METHODS added.', methodName: 'ADDED', visibility: 'public', isAbstract: false },
      ),
    ).toThrow('safely isolate');
  });
  it('refuses another owner or a neighboring class inside the class slice', () => {
    expect(() => assertClassEditBoundary(source, range(1, 5), 'OTHER', 'definition')).toThrow('safely isolate');
    expect(() => assertClassEditBoundary(source, range(1, 9), 'ZBOUNDARY', 'definition')).toThrow('safely isolate');
  });
});

it.each([
  'METHODS zif_service~/ns/run. METHODS other.',
  'METHODS zif_service~/ns/run. ENDCLASS.',
  'METHODS zif_service~/ns/run INVALID TAIL.',
  'METHODS: zif_service~/ns/run REDEFINITION.',
])('does not bypass declaration boundaries for a namespaced method: %s', (text) => {
  expect(() => assertMethodDeclarationReplacement(text, 'ZIF_SERVICE~/NS/RUN')).toThrow('Replacement must contain');
});
