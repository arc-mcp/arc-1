import { describe, expect, it } from 'vitest';
import { moveMethodDefinition, removeMethodPair, spliceMethodSignature } from '../../../src/adt/class-structure.js';
import type { MethodStructure } from '../../../src/adt/types.js';

// Native A4H objectstructure starts each chained method range at the shared keyword,
// then extends it through that method. The second range includes the first declaration.
const source = `CLASS zchain DEFINITION.
  PUBLIC SECTION.
    CLASS-METHODS:
      first,
      second.
  PRIVATE SECTION.
ENDCLASS.
CLASS zchain IMPLEMENTATION.
  METHOD first.
  ENDMETHOD.
  METHOD second.
  ENDMETHOD.
ENDCLASS.`;
const method: MethodStructure = {
  name: 'SECOND',
  visibility: 'public',
  level: 'static',
  abstract: false,
  constructor: false,
  definition: { sr: 3, sc: 4, er: 5, ec: 13 },
  implementation: { sr: 11, sc: 2, er: 12, ec: 12 },
};
const edits = {
  signature: (value: string, target = method) => spliceMethodSignature(value, target, 'CLASS-METHODS second.'),
  delete: (value: string, target = method) => removeMethodPair(value, target),
  visibility: (value: string, target = method) => moveMethodDefinition(value, target, 6),
};

describe('individual edits of native chained method declarations', () => {
  for (const [action, edit] of Object.entries(edits)) {
    it.each(['CLASS-METHODS', 'METHODS'])(
      `${action} refuses a %s chain instead of removing its neighbor`,
      (keyword) => {
        expect(() => edit(source.replace('CLASS-METHODS', keyword))).toThrow('Chained METHODS declarations');
      },
    );

    it(`${action} also refuses the first member, whose native range leaves the chain unfinished`, () => {
      expect(() =>
        edit(source, {
          ...method,
          name: 'FIRST',
          definition: { sr: 3, sc: 4, er: 4, ec: 12 },
          implementation: { sr: 9, sc: 2, er: 10, ec: 12 },
        }),
      ).toThrow('Chained METHODS declarations');
    });

    it(`${action} recognizes a chain with comments and CRLF before its colon`, () => {
      const commented = source
        .replace('CLASS-METHODS:', 'CLASS-METHODS " shared declaration\n      :')
        .replace(/\n/g, '\r\n');
      expect(() => edit(commented, { ...method, definition: { ...method.definition, er: 6 } })).toThrow(
        'Chained METHODS declarations',
      );
    });

    it(`${action} uses the native start column when a chain shares a line with another statement`, () => {
      const shared = source.replace('PUBLIC SECTION.\n    CLASS-METHODS:', 'PUBLIC SECTION. CLASS-METHODS:');
      expect(() =>
        edit(shared, {
          ...method,
          definition: { sr: 2, sc: shared.split('\n')[1]!.indexOf('CLASS-METHODS'), er: 4, ec: 13 },
          implementation: { sr: 10, sc: 2, er: 11, ec: 12 },
        }),
      ).toThrow('Chained METHODS declarations');
    });
  }

  it('allows an ordinary declaration containing a colon in its default string', () => {
    const ordinary = source.replace(
      'CLASS-METHODS:\n      first,\n      second.',
      "CLASS-METHODS first.\n    CLASS-METHODS second\n      IMPORTING value TYPE string DEFAULT ':'.",
    );
    const selected = { ...method, definition: { sr: 4, sc: 4, er: 5, ec: 45 } };
    const output = spliceMethodSignature(ordinary, selected, 'CLASS-METHODS second.');
    expect(output).toContain('CLASS-METHODS first.');
    expect(output).toContain('METHOD first.');
    expect(output).toContain('METHOD second.');
  });
});
