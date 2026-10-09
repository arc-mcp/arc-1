import { describe, expect, it } from 'vitest';
import { insertMethodPair, removeMethodPair } from '../../../src/adt/class-structure.js';
import type { ClassStructure } from '../../../src/adt/types.js';
import { spliceMethod } from '../../../src/context/method-surgery.js';

const source = `class zcl_demo definition public final create public.
  public section.
    methods first.
    "! Second method
    "! More documentation
    methods second.
    methods third.
endclass.

class zcl_demo implementation.
  method first.
  endmethod.

  method second.
  endmethod.

  method third.
  endmethod.
endclass.
`;
const structure: ClassStructure = {
  className: 'ZCL_DEMO',
  classDefinitionBlock: { sr: 1, sc: 0, er: 8, ec: 9 },
  classImplementationBlock: { sr: 10, sc: 0, er: 19, ec: 9 },
  methods: [
    {
      name: 'SECOND',
      visibility: 'public',
      level: 'instance',
      abstract: false,
      constructor: false,
      definition: { sr: 6, sc: 4, er: 6, ec: 19 },
      implementation: { sr: 14, sc: 2, er: 15, ec: 12 },
    },
    {
      name: 'THIRD',
      visibility: 'public',
      level: 'instance',
      abstract: false,
      constructor: false,
      definition: { sr: 7, sc: 4, er: 7, ec: 18 },
      implementation: { sr: 17, sc: 2, er: 18, ec: 12 },
    },
  ],
  attributes: [],
};

describe.each(['\n', '\r\n'])('method formatting with %j', (eol) => {
  it('deletes attached docs and joins spacing only at the cut', () => {
    const expected = source
      .replace('    "! Second method\n    "! More documentation\n    methods second.\n', '')
      .replace('  method second.\n  endmethod.\n\n', '');
    expect(removeMethodPair(source.replaceAll('\n', eol), structure.methods[0]!)).toBe(expected.replaceAll('\n', eol));
  });

  it('inserts a separated stub without changing existing source', () => {
    const expected = source
      .replace('    methods third.', '    methods third.\n    methods fourth.')
      .replace(
        '  method third.\n  endmethod.\nendclass.',
        '  method third.\n  endmethod.\n\n  METHOD fourth.\n  ENDMETHOD.\nendclass.',
      );
    expect(
      insertMethodPair(source.replaceAll('\n', eol), structure, {
        decl: '    methods fourth.',
        visibility: 'public',
        methodName: 'FOURTH',
      }),
    ).toBe(expected.replaceAll('\n', eol));
  });

  it('preserves body-edit boundaries and the rest of the class', () => {
    const original = source.replace(
      '  method first.\n  endmethod.',
      '    method first. " keep header\n    endmethod. " keep footer',
    );
    const result = spliceMethod(original.replaceAll('\n', eol), 'ZCL_DEMO', 'first', '      RETURN.');
    expect(result.success).toBe(true);
    expect(result.newSource).toBe(
      original
        .replace('    endmethod. " keep footer', '      RETURN.\n    endmethod. " keep footer')
        .replaceAll('\n', eol),
    );
  });
});

it.each(['    " ordinary comment', '', '    "! Unrelated\n'])('keeps a documentation boundary %j', (boundary) => {
  const original = `    "! Keep\n${boundary}\n    methods second.\n    methods third.\n`;
  const row = original.split('\n').findIndex((line) => line.includes('methods second')) + 1;
  const method = {
    ...structure.methods[0]!,
    implementation: undefined,
    definition: { sr: row, er: row, sc: 4, ec: 19 },
  };
  expect(removeMethodPair(original, method)).toContain('    "! Keep');
  expect(removeMethodPair(original, method)).toContain('    methods third.');
});

it('preserves a multiline AMDP header and boundary comments', () => {
  const original = source.replace(
    '  method first.\n  endmethod.',
    '  method first " comment with a dot.\n    BY DATABASE PROCEDURE FOR HDB LANGUAGE SQLSCRIPT\n    OPTIONS READ-ONLY. " keep\n    select * from dummy;\n  endmethod. " footer',
  );
  const result = spliceMethod(original, 'ZCL_DEMO', 'first', '    select 1 from dummy;');
  expect(result.success).toBe(true);
  expect(result.newSource).toBe(original.replace('    select * from dummy;', '    select 1 from dummy;'));
});

it('replaces an inline method body without retaining the old body', () => {
  const original = source.replace('  method first.\n  endmethod.', '  method first. RETURN. endmethod. " keep');
  const result = spliceMethod(original, 'ZCL_DEMO', 'first', '    CHECK abap_true = abap_true.');
  expect(result.success).toBe(true);
  expect(result.newSource).toBe(
    original.replace(
      '  method first. RETURN. endmethod. " keep',
      '  method first.\n    CHECK abap_true = abap_true.\n  endmethod. " keep',
    ),
  );
});

it('refuses a body-only edit whose line range includes another method', () => {
  const original = source.replace(
    '  method first.\n  endmethod.',
    '  method first. endmethod. method extra. endmethod.',
  );
  const result = spliceMethod(original, 'ZCL_DEMO', 'first', '    RETURN.');
  expect(result.success).toBe(false);
  expect(result.error).toContain('complete METHOD');
});

it('preserves a split closing statement', () => {
  const original = source.replace('  method first.\n  endmethod.', '  method first.\n  endmethod\n    . " footer');
  const result = spliceMethod(original, 'ZCL_DEMO', 'first', '    RETURN.');
  expect(result.success).toBe(true);
  expect(result.newSource).toBe(original.replace('  endmethod\n', '    RETURN.\n  endmethod\n'));
});

it('keeps unrelated blank runs when deleting an abstract method and its docs', () => {
  const original =
    'class zcl_demo definition abstract.\n\n\n  public section.\n\n    "! Delete\n    methods second abstract.\n\n\n    methods third.\nendclass.\n';
  const method = {
    ...structure.methods[0]!,
    abstract: true,
    implementation: undefined,
    definition: { sr: 7, sc: 4, er: 7, ec: 28 },
  };
  expect(removeMethodPair(original, method)).toBe(
    'class zcl_demo definition abstract.\n\n\n  public section.\n\n    methods third.\nendclass.\n',
  );
});

it('does not add to existing blank space before the implementation end', () => {
  const original = source.replace(
    '  method third.\n  endmethod.\nendclass.',
    '  method third.\n  endmethod.\n\n\nendclass.',
  );
  const withSpace = { ...structure, classImplementationBlock: { ...structure.classImplementationBlock!, er: 21 } };
  const result = insertMethodPair(original, withSpace, {
    decl: '    methods fourth.',
    visibility: 'public',
    methodName: 'FOURTH',
  });
  expect(result).toContain('  endmethod.\n\n\n  METHOD fourth.');
  expect(result).not.toContain('  endmethod.\n\n\n\n  METHOD fourth.');
});

it.each(['method', 'endmethod'])('accepts a body statement starting with the identifier %s', (identifier) => {
  const body = `    DATA ${identifier} TYPE i.\n    ${identifier} = 1.`;
  const original = source.replace('  method first.\n  endmethod.', `  method first.\n${body}\n  endmethod.`);
  const result = spliceMethod(original, 'ZCL_DEMO', 'first', `    DATA ${identifier} TYPE i.\n    ${identifier} = 2.`);
  expect(result.success).toBe(true);
  expect(result.newSource).toBe(original.replace(`${identifier} = 1.`, `${identifier} = 2.`));
});
