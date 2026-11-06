import { describe, expect, it } from 'vitest';
import { spliceClassDefinition, spliceMethodSignature } from '../../../src/adt/class-structure.js';
import type { ClassStructure, MethodStructure } from '../../../src/adt/types.js';

const method: MethodStructure = {
  name: 'RUN',
  visibility: 'public',
  level: 'instance',
  abstract: false,
  constructor: false,
  definition: { sr: 1, sc: 0, er: 1, ec: 0 },
};

// SAP reports the declaration range, excluding its preceding ABAP Doc.
describe.each(['class', 'method'] as const)('%s replacement ABAP Doc (#1041)', (kind) => {
  const declaration =
    kind === 'class'
      ? 'CLASS zcl_demo DEFINITION.\n  PUBLIC SECTION.\n    "! Inner method doc\n    METHODS run.\nENDCLASS.'
      : '    METHODS run IMPORTING iv_a TYPE i.';
  const before =
    kind === 'class' ? '* File header\n' : 'CLASS zcl_demo DEFINITION.\n  PUBLIC SECTION.\n    METHODS sibling.\n';
  const after =
    kind === 'class'
      ? '\n\nCLASS zcl_demo IMPLEMENTATION.\n  METHOD run.\n  ENDMETHOD.\nENDCLASS.\n'
      : '\nENDCLASS.\n\nCLASS zcl_demo IMPLEMENTATION.\n  METHOD run.\n  ENDMETHOD.\nENDCLASS.\n';
  const oldDoc = '    "! Old documentation\n    "! @parameter iv_a | Old parameter text\n';
  const newDoc = '    "! New documentation\n    "! @parameter iv_a | New parameter text\n';

  function replace(original: string, replacement: string): string {
    const lines = original.split(/\r?\n/);
    const sr = lines.indexOf(declaration.split('\n')[0]!) + 1;
    const range = { sr, sc: 0, er: sr + declaration.split('\n').length - 1, ec: 0 };
    if (kind === 'method') return spliceMethodSignature(original, { ...method, definition: range }, replacement);
    const structure: ClassStructure = {
      className: 'ZCL_DEMO',
      classDefinitionBlock: range,
      methods: [method],
      attributes: [],
    };
    return spliceClassDefinition(original, structure, replacement);
  }

  it.each(['\n', '\r\n'])('replaces attached docs and preserves surrounding bytes with %j', (eol) => {
    const original = `${before}${oldDoc}${declaration}${after}`.replaceAll('\n', eol);
    const expected = `${before}${newDoc}${declaration}${after}`.replaceAll('\n', eol);
    expect(replace(original, `${newDoc}${declaration}`)).toBe(expected);
  });

  it('preserves existing docs when the replacement supplies none', () => {
    const original = `${before}${oldDoc}${declaration}${after}`;
    // The class replacement still contains its method's doc; that is not a new class doc.
    expect(replace(original, declaration)).toBe(original);
  });

  it('adds docs when the original declaration has none', () => {
    expect(replace(`${before}${declaration}${after}`, `${newDoc}${declaration}`)).toBe(
      `${before}${newDoc}${declaration}${after}`,
    );
  });

  it.each(['\n\t\n', '* New header\n', '  " New header\n'])('accepts leading whitespace or comments %j', (leading) => {
    expect(replace(`${before}${oldDoc}${declaration}${after}`, `${leading}${newDoc}${declaration}`)).toBe(
      `${before}${leading}${newDoc}${declaration}${after}`,
    );
  });

  it.each(['\n', '    " ordinary comment\n', '* ordinary comment\n'])('stops at an old doc boundary %j', (boundary) => {
    const preserved = `${before}"! Unrelated documentation\n${boundary}`;
    expect(replace(`${preserved}${oldDoc}${declaration}${after}`, `${newDoc}${declaration}`)).toBe(
      `${preserved}${newDoc}${declaration}${after}`,
    );
  });

  it.each(['\n', '    " ordinary comment\n', '* ordinary comment\n'])(
    'does not treat detached new docs as replacement docs %j',
    (boundary) => {
      const replacement = `${newDoc}${boundary}${declaration}`;
      expect(replace(`${before}${oldDoc}${declaration}${after}`, replacement)).toBe(
        `${before}${oldDoc}${replacement}${after}`,
      );
    },
  );

  it('treats an empty ABAP Doc line as part of its block', () => {
    const replacement = `\t"!\n${newDoc}${declaration}`;
    expect(replace(`${before}"!\n${oldDoc}${declaration}${after}`, replacement)).toBe(
      `${before}${replacement}${after}`,
    );
  });
});
