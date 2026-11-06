import { describe, expect, it } from 'vitest';
import { moveMethodDefinition } from '../../../src/adt/class-structure.js';
import type { MethodStructure } from '../../../src/adt/types.js';

const docs = '    "! Documentation for run\n    "! @parameter iv_a | Input';
const declaration = '    METHODS run\n      IMPORTING iv_a TYPE i.';
const block = `${docs}\n${declaration}`;
const implementation = `
CLASS zcl_demo IMPLEMENTATION.
  METHOD run.
    DATA(value) = iv_a.
  ENDMETHOD.
  METHOD sibling.
  ENDMETHOD.
  METHOD other.
  ENDMETHOD.
ENDCLASS.
`;

function methodRange(source: string): MethodStructure {
  const sr = source.split(/\r?\n/).indexOf('    METHODS run') + 1;
  return {
    name: 'RUN',
    visibility: 'public',
    level: 'instance',
    abstract: false,
    constructor: false,
    definition: { sr, sc: 4, er: sr + 1, ec: 29 },
  };
}

function anchor(source: string): number {
  return source.split(/\r?\n/).indexOf('    METHODS other.') + 1;
}

describe.each(['downward', 'upward'])('moving a documented method %s (#1048)', (direction) => {
  const original =
    direction === 'downward'
      ? `CLASS zcl_demo DEFINITION.\n  PUBLIC SECTION.\n${block}\n    METHODS sibling.\n  PRIVATE SECTION.\n    METHODS other.\nENDCLASS.\n${implementation}`
      : `CLASS zcl_demo DEFINITION.\n  PUBLIC SECTION.\n    METHODS other.\n  PRIVATE SECTION.\n${block}\n    METHODS sibling.\nENDCLASS.\n${implementation}`;

  it.each(['\n', '\r\n'])('moves only attached docs and declaration with %j', (eol) => {
    const source = original.replaceAll('\n', eol);
    const expected = original.replace(`${block}\n`, '').replace('    METHODS other.', `    METHODS other.\n${block}`);
    expect(moveMethodDefinition(source, methodRange(source), anchor(source))).toBe(expected.replaceAll('\n', eol));
  });

  it.each(['', '    " ordinary comment', '* ordinary comment'])(
    'keeps unrelated documentation across boundary %j',
    (boundary) => {
      const source = original.replace(docs, `    "! Unrelated\n${boundary}\n${docs}`);
      const expected = source.replace(`${block}\n`, '').replace('    METHODS other.', `    METHODS other.\n${block}`);
      expect(moveMethodDefinition(source, methodRange(source), anchor(source))).toBe(expected);
    },
  );

  it.each(['', '    " ordinary comment', '* ordinary comment'])(
    'does not move detached documentation across boundary %j',
    (boundary) => {
      const source = original.replace(block, `${docs}\n${boundary}\n${declaration}`);
      const expected = source
        .replace(`${declaration}\n`, '')
        .replace('    METHODS other.', `    METHODS other.\n${declaration}`);
      expect(moveMethodDefinition(source, methodRange(source), anchor(source))).toBe(expected);
    },
  );

  it('rejects an insertion anchor inside the attached documentation', () => {
    const method = methodRange(original);
    expect(() => moveMethodDefinition(original, method, method.definition.sr - 1)).toThrow(RangeError);
  });
});
