/**
 * Unit tests for src/adt/class-structure.ts — pure splice + diff helpers for
 * class-section surgery (issue #303).
 *
 * Fixtures: we hand-construct small classes here. The parseClassStructure-side
 * fixtures (objectstructure XML) live in tests/fixtures/xml/.
 */

import { describe, expect, it } from 'vitest';
import {
  diffMethodSets,
  extractMethodNameFromClause,
  findSectionAnchor,
  insertBeforeLine,
  insertMethodPair,
  moveMethodDefinition,
  parseDefinitionBlockDeclarations,
  removeMethodPair,
  spliceClassDefinition,
  spliceLines,
  spliceMethodSignature,
} from '../../../src/adt/class-structure.js';
import type { ClassStructure, MethodStructure } from '../../../src/adt/types.js';

// ─── Test fixtures (in-memory classes + structures) ────────────────────

const PROBE_SOURCE = `CLASS zcl_arc1_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS hello
      IMPORTING name TYPE string
      RETURNING VALUE(result) TYPE string.
    METHODS goodbye
      RETURNING VALUE(result) TYPE string.
  PRIVATE SECTION.
    DATA mv_counter TYPE i.
ENDCLASS.

CLASS zcl_arc1_probe IMPLEMENTATION.

  METHOD hello.
    result = |Hello, { name }!|.
  ENDMETHOD.

  METHOD goodbye.
    result = 'Goodbye!'.
  ENDMETHOD.

ENDCLASS.
`.replace(/\n/g, '\r\n');

const PROBE_STRUCTURE: ClassStructure = {
  className: 'ZCL_ARC1_PROBE',
  classDefinitionBlock: { sr: 1, sc: 0, er: 10, ec: 8 },
  classImplementationBlock: { sr: 12, sc: 0, er: 22, ec: 8 },
  methods: [
    {
      name: 'HELLO',
      visibility: 'public',
      level: 'instance',
      abstract: false,
      constructor: false,
      definition: { sr: 3, sc: 4, er: 5, ec: 41 },
      implementation: { sr: 14, sc: 2, er: 16, ec: 11 },
    },
    {
      name: 'GOODBYE',
      visibility: 'public',
      level: 'instance',
      abstract: false,
      constructor: false,
      definition: { sr: 6, sc: 4, er: 7, ec: 41 },
      implementation: { sr: 18, sc: 2, er: 20, ec: 11 },
    },
  ],
  attributes: [],
};

describe('spliceLines (whole-line replacement)', () => {
  it('replaces a range INCLUSIVE of the end row', () => {
    const out = spliceLines('a\nb\nc\nd\n', 2, 3, 'X');
    expect(out).toBe('a\nX\nd\n');
  });

  it('preserves CRLF line endings', () => {
    const out = spliceLines('a\r\nb\r\nc\r\n', 2, 2, 'X');
    expect(out).toBe('a\r\nX\r\nc\r\n');
  });

  it('throws on invalid range', () => {
    expect(() => spliceLines('a\nb\n', 5, 6, 'X')).toThrow(RangeError);
    expect(() => spliceLines('a\nb\n', 2, 1, 'X')).toThrow(RangeError);
  });
});

describe('insertBeforeLine', () => {
  it('inserts before the given 1-indexed line number', () => {
    expect(insertBeforeLine('a\nb\nc\n', 2, 'X')).toBe('a\nX\nb\nc\n');
  });

  it('appends when lineNo === lines.length + 1 (off-by-one tolerance)', () => {
    expect(insertBeforeLine('a\nb\n', 3, 'X')).toBe('a\nb\nX\n');
  });

  it('preserves CRLF when source has CRLF', () => {
    expect(insertBeforeLine('a\r\nb\r\n', 2, 'X')).toBe('a\r\nX\r\nb\r\n');
  });
});

describe('spliceClassDefinition', () => {
  it('replaces the class-level DEFINITION lines, leaves IMPLEMENTATION untouched', () => {
    const newDef = `CLASS zcl_arc1_probe DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS hello
      IMPORTING name TYPE string
      RETURNING VALUE(result) TYPE string.
    METHODS goodbye
      RETURNING VALUE(result) TYPE string.
  PRIVATE SECTION.
    DATA mv_counter TYPE i.
ENDCLASS.`;
    const out = spliceClassDefinition(PROBE_SOURCE, PROBE_STRUCTURE, newDef);
    // FINAL keyword is now removed; IMPLEMENTATION block still intact.
    expect(out).toContain('DEFINITION PUBLIC CREATE PUBLIC');
    expect(out).not.toContain('FINAL CREATE');
    expect(out).toContain("result = 'Goodbye!'.");
  });

  it('preserves CRLF line endings on splice', () => {
    const newDef = `CLASS zcl_arc1_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS hello
      RETURNING VALUE(result) TYPE string.
  PRIVATE SECTION.
ENDCLASS.`;
    const out = spliceClassDefinition(PROBE_SOURCE, PROBE_STRUCTURE, newDef);
    expect(out.includes('\r\n')).toBe(true);
  });
});

describe('spliceMethodSignature', () => {
  it('replaces ONE method signature range, body unchanged', () => {
    const newSig = `    METHODS hello
      IMPORTING name TYPE string
                greeting TYPE string DEFAULT 'Hi'
      RETURNING VALUE(result) TYPE string.`;
    const out = spliceMethodSignature(PROBE_SOURCE, PROBE_STRUCTURE.methods[0]!, newSig);
    expect(out).toContain("greeting TYPE string DEFAULT 'Hi'");
    // The other method's signature should remain unchanged.
    expect(out).toContain('METHODS goodbye');
  });
});

describe('insertMethodPair', () => {
  it('inserts METHODS clause AND METHOD stub atomically (happy path)', () => {
    const out = insertMethodPair(PROBE_SOURCE, PROBE_STRUCTURE, {
      decl: '    METHODS greet RETURNING VALUE(r) TYPE string.',
      visibility: 'public',
      methodName: 'GREET',
    });
    expect(out).toContain('METHODS greet');
    expect(out).toContain('METHOD greet.');
    expect(out).toContain('ENDMETHOD.');
  });

  it('with isAbstract=true inserts only DEFINITION; no METHOD/ENDMETHOD stub', () => {
    const out = insertMethodPair(PROBE_SOURCE, PROBE_STRUCTURE, {
      decl: '    METHODS to_impl ABSTRACT.',
      visibility: 'public',
      methodName: 'TO_IMPL',
      isAbstract: true,
    });
    expect(out).toContain('METHODS to_impl ABSTRACT.');
    expect(out).not.toMatch(/METHOD\s+to_impl\s*\./i);
  });

  it('falls back to PRIVATE SECTION header anchor when no private methods exist', () => {
    const out = insertMethodPair(PROBE_SOURCE, PROBE_STRUCTURE, {
      decl: '    METHODS _init.',
      visibility: 'private',
      methodName: '_INIT',
    });
    // _init METHODS goes inside PRIVATE SECTION (after the section header).
    const idx = out.indexOf('PRIVATE SECTION');
    const declIdx = out.indexOf('METHODS _init');
    expect(declIdx).toBeGreaterThan(idx);
    expect(out).toContain('METHOD _init.');
  });

  it('throws when target visibility section header is missing', () => {
    // Probe class has no PROTECTED SECTION. Insertion must throw so caller can
    // surface a clean refuse-with-hint to the user.
    expect(() =>
      insertMethodPair(PROBE_SOURCE, PROBE_STRUCTURE, {
        decl: '    METHODS helper.',
        visibility: 'protected',
        methodName: 'HELPER',
      }),
    ).toThrow(/PROTECTED SECTION/);
  });

  it('places the IMPL stub INSIDE the IMPLEMENTATION block even when decl has a trailing newline (off-by-one regression)', () => {
    // Regression: a trailing "\n" on decl used to over-count inserted lines by
    // one, pushing the stub past the IMPLEMENTATION ENDCLASS → invalid ABAP.
    const out = insertMethodPair(PROBE_SOURCE, PROBE_STRUCTURE, {
      decl: '    METHODS greet RETURNING VALUE(r) TYPE string.\n',
      visibility: 'public',
      methodName: 'GREET',
    });
    // The stub must appear BEFORE the final ENDCLASS of the IMPLEMENTATION block,
    // i.e. there must be content (ENDMETHOD.) between "METHOD greet." and the last ENDCLASS.
    const stubIdx = out.search(/METHOD greet\./i);
    const lastEndclassIdx = out.lastIndexOf('ENDCLASS.');
    expect(stubIdx).toBeGreaterThan(-1);
    expect(stubIdx).toBeLessThan(lastEndclassIdx);
    // And there should be exactly one trailing ENDCLASS after the stub's ENDMETHOD.
    const afterStub = out.slice(stubIdx);
    expect(afterStub).toMatch(/ENDMETHOD\.[\s\S]*ENDCLASS\./);
  });
});

describe('removeMethodPair', () => {
  it('removes both definition and implementation ranges atomically', () => {
    const out = removeMethodPair(PROBE_SOURCE, PROBE_STRUCTURE.methods[0]!);
    expect(out).not.toContain('METHODS hello');
    // METHOD hello implementation also gone.
    expect(out).not.toMatch(/METHOD\s+hello\s*\./i);
    // Other method survives.
    expect(out).toContain('METHODS goodbye');
  });

  it('ABSTRACT method (no impl range) — removes only DEFINITION', () => {
    const abstractMethod: MethodStructure = {
      name: 'TO_IMPL',
      visibility: 'public',
      level: 'instance',
      abstract: true,
      constructor: false,
      definition: { sr: 2, sc: 4, er: 2, ec: 30 },
    };
    // Lines (1-indexed): 1="L1", 2="    METHODS to_impl ABSTRACT.", 3="L3"
    const src = 'L1\n    METHODS to_impl ABSTRACT.\nL3\n';
    const out = removeMethodPair(src, abstractMethod);
    expect(out).not.toContain('METHODS to_impl');
  });

  it('removes exactly the spliced lines with no extra blank-line per range (blank-line regression)', () => {
    // Regression: spliceLines('') used to insert one empty line per deleted range,
    // so a 6-line removal (3 def + 3 impl) dropped the line count by only 4.
    // The precise signal is the line-count delta — it must equal the lines removed.
    const out = removeMethodPair(PROBE_SOURCE, PROBE_STRUCTURE.methods[0]!);
    const before = PROBE_SOURCE.split(/\r?\n/).length;
    const after = out.split(/\r?\n/).length;
    expect(before - after).toBe(6); // HELLO: def 3-5 (3 lines) + impl 14-16 (3 lines)
  });
});

describe('findSectionAnchor', () => {
  it('returns afterLine = last method def end row when methods exist', () => {
    const anchor = findSectionAnchor(PROBE_SOURCE, PROBE_STRUCTURE, 'public');
    expect(anchor).toEqual({ afterLine: 7 }); // GOODBYE.definition.er
  });

  it('falls back to SECTION header line when section is empty', () => {
    const anchor = findSectionAnchor(PROBE_SOURCE, PROBE_STRUCTURE, 'private');
    // Line 8 holds `  PRIVATE SECTION.` (1-indexed).
    expect(anchor).toEqual({ afterLine: 8 });
  });

  it('returns null when section header is missing', () => {
    const anchor = findSectionAnchor(PROBE_SOURCE, PROBE_STRUCTURE, 'protected');
    expect(anchor).toBeNull();
  });

  it('matches a SECTION header that carries a trailing line comment (regression)', () => {
    // Regression: the $-anchored regex used to reject "PRIVATE SECTION. \" note".
    const src = `CLASS zcl_x DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS hello.
  PRIVATE SECTION. " internal helpers only
ENDCLASS.

CLASS zcl_x IMPLEMENTATION.
  METHOD hello.
  ENDMETHOD.
ENDCLASS.`.replace(/\n/g, '\r\n');
    const struct: ClassStructure = {
      className: 'ZCL_X',
      classDefinitionBlock: { sr: 1, sc: 0, er: 5, ec: 8 },
      classImplementationBlock: { sr: 7, sc: 0, er: 10, ec: 8 },
      methods: [
        {
          name: 'HELLO',
          visibility: 'public',
          level: 'instance',
          abstract: false,
          constructor: false,
          definition: { sr: 3, sc: 4, er: 3, ec: 18 },
          implementation: { sr: 8, sc: 2, er: 9, ec: 11 },
        },
      ],
      attributes: [],
    };
    // PRIVATE SECTION is empty + has a trailing comment → must still anchor on line 4.
    const anchor = findSectionAnchor(src, struct, 'private');
    expect(anchor).toEqual({ afterLine: 4 });
  });
});

describe('diffMethodSets', () => {
  it('detects added concrete method (no IMPL → refuse-policy triggers)', () => {
    const newDef = `CLASS zcl_arc1_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS hello.
    METHODS goodbye.
    METHODS greet IMPORTING who TYPE string RETURNING VALUE(r) TYPE string.
ENDCLASS.`;
    const diff = diffMethodSets(PROBE_STRUCTURE, newDef);
    expect(diff.added.map((d) => d.name)).toContain('GREET');
    expect(diff.added.find((d) => d.name === 'GREET')?.isAbstract).toBe(false);
    expect(diff.removed.length).toBe(0);
  });

  it('tags ABSTRACT additions correctly', () => {
    const newDef = `CLASS zcl_arc1_probe DEFINITION PUBLIC ABSTRACT CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS hello.
    METHODS goodbye.
    METHODS to_impl ABSTRACT RETURNING VALUE(r) TYPE string.
ENDCLASS.`;
    const diff = diffMethodSets(PROBE_STRUCTURE, newDef);
    const toImpl = diff.added.find((d) => d.name === 'TO_IMPL');
    expect(toImpl?.isAbstract).toBe(true);
  });

  it('detects removed method', () => {
    const newDef = `CLASS zcl_arc1_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS hello IMPORTING name TYPE string RETURNING VALUE(result) TYPE string.
ENDCLASS.`;
    const diff = diffMethodSets(PROBE_STRUCTURE, newDef);
    expect(diff.removed.map((m) => m.name)).toEqual(['GOODBYE']);
  });

  it('tags EVENTS / INTERFACES / ALIASES with the exemption flags', () => {
    const newDef = `CLASS zcl_arc1_probe DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES zif_order.
    ALIASES my_alias FOR zif_order~create.
    EVENTS click_happened.
    METHODS hello.
    METHODS goodbye.
ENDCLASS.`;
    const diff = diffMethodSets(PROBE_STRUCTURE, newDef);
    expect(diff.added.find((d) => d.name === 'ZIF_ORDER')?.isInterface).toBe(true);
    expect(diff.added.find((d) => d.name === 'MY_ALIAS')?.isAlias).toBe(true);
    expect(diff.added.find((d) => d.name === 'CLICK_HAPPENED')?.isEvent).toBe(true);
  });
});

describe('parseDefinitionBlockDeclarations', () => {
  it('emits METHODS with multi-line clauses', () => {
    const def = `CLASS dummy DEFINITION.
  PUBLIC SECTION.
    METHODS foo
      IMPORTING bar TYPE string
      RETURNING VALUE(result) TYPE string.
ENDCLASS.`;
    const decls = parseDefinitionBlockDeclarations(def);
    expect(decls.find((d) => d.name === 'FOO')).toBeDefined();
  });

  it('ignores commented-out METHODS clauses', () => {
    const def = `CLASS dummy DEFINITION.
  PUBLIC SECTION.
    METHODS active_one.
*    METHODS commented_out.
    "METHODS also_commented.
ENDCLASS.`;
    const decls = parseDefinitionBlockDeclarations(def);
    expect(decls.map((d) => d.name)).toEqual(['ACTIVE_ONE']);
  });
});

describe('extractMethodNameFromClause', () => {
  it('extracts the name from a simple clause', () => {
    expect(extractMethodNameFromClause('METHODS hello.')).toBe('HELLO');
  });

  it('extracts from a multi-line clause', () => {
    expect(
      extractMethodNameFromClause(`METHODS hello
      IMPORTING name TYPE string
      RETURNING VALUE(result) TYPE string.`),
    ).toBe('HELLO');
  });

  it('handles CLASS-METHODS', () => {
    expect(extractMethodNameFromClause('CLASS-METHODS get_instance RETURNING VALUE(r) TYPE REF TO me.')).toBe(
      'GET_INSTANCE',
    );
  });

  it('returns null on non-METHODS first non-comment line', () => {
    expect(extractMethodNameFromClause('* a comment\nDATA foo TYPE i.')).toBeNull();
  });
});

describe('moveMethodDefinition (DEFINITION-only section move — body preserved)', () => {
  // PROBE_SOURCE line map: hello def 3-5, goodbye def 6-7, PRIVATE SECTION header 8.
  it('moves HELLO public→private (clause appears under PRIVATE SECTION, gone from PUBLIC)', () => {
    // PRIVATE SECTION has no methods → anchor is the section-header line (8).
    const out = moveMethodDefinition(PROBE_SOURCE, PROBE_STRUCTURE.methods[0]!, 8);
    const lines = out.split('\r\n');
    const privIdx = lines.findIndex((l) => /PRIVATE SECTION\./.test(l));
    const helloIdx = lines.findIndex((l) => /METHODS hello/.test(l));
    // hello now sits AFTER the PRIVATE SECTION header.
    expect(helloIdx).toBeGreaterThan(privIdx);
    // PUBLIC SECTION should no longer be immediately followed by METHODS hello;
    // goodbye should still be the public method.
    expect(out).toContain('METHODS goodbye');
  });

  it('leaves the IMPLEMENTATION block byte-identical (body preserved)', () => {
    const out = moveMethodDefinition(PROBE_SOURCE, PROBE_STRUCTURE.methods[0]!, 8);
    // The METHOD hello body must survive verbatim.
    expect(out).toContain('result = |Hello, { name }!|.');
    expect(out).toContain("result = 'Goodbye!'.");
    // IMPLEMENTATION block boundaries intact.
    expect(out).toContain('CLASS zcl_arc1_probe IMPLEMENTATION.');
  });

  it('preserves CRLF and original clause indentation', () => {
    const out = moveMethodDefinition(PROBE_SOURCE, PROBE_STRUCTURE.methods[0]!, 8);
    expect(out.includes('\r\n')).toBe(true);
    // The moved clause keeps its 4-space indent.
    expect(out).toMatch(/\r\n {4}METHODS hello\r\n/);
  });

  it('moves a method when the target section is BELOW its current position', () => {
    // goodbye (public, def 6-7) → private (header line 8, below it).
    const out = moveMethodDefinition(PROBE_SOURCE, PROBE_STRUCTURE.methods[1]!, 8);
    const lines = out.split('\r\n');
    const privIdx = lines.findIndex((l) => /PRIVATE SECTION\./.test(l));
    const goodbyeIdx = lines.findIndex((l) => /METHODS goodbye/.test(l));
    expect(goodbyeIdx).toBeGreaterThan(privIdx);
  });

  it('moves a method when the target section is ABOVE its current position', () => {
    // Inline fixture: a private method moving up to PUBLIC.
    const src = `CLASS x DEFINITION PUBLIC.
  PUBLIC SECTION.
  PRIVATE SECTION.
    METHODS helper.
ENDCLASS.
CLASS x IMPLEMENTATION.
  METHOD helper.
    DATA(keep) = 1.
  ENDMETHOD.
ENDCLASS.`.replace(/\n/g, '\r\n');
    const helper: MethodStructure = {
      name: 'HELPER',
      visibility: 'private',
      level: 'instance',
      abstract: false,
      constructor: false,
      definition: { sr: 4, sc: 4, er: 4, ec: 16 },
      implementation: { sr: 7, sc: 2, er: 9, ec: 11 },
    };
    // PUBLIC SECTION header is line 2 (above the method at line 4).
    const out = moveMethodDefinition(src, helper, 2);
    const lines = out.split('\r\n');
    const pubIdx = lines.findIndex((l) => /PUBLIC SECTION\./.test(l));
    const privIdx = lines.findIndex((l) => /PRIVATE SECTION\./.test(l));
    const helperIdx = lines.findIndex((l) => /METHODS helper/.test(l));
    // helper now between PUBLIC and PRIVATE.
    expect(helperIdx).toBeGreaterThan(pubIdx);
    expect(helperIdx).toBeLessThan(privIdx);
    // body preserved.
    expect(out).toContain('DATA(keep) = 1.');
  });

  it('throws if targetAfterLine falls inside the moved method range', () => {
    // hello def is 3-5; anchor 4 is inside → caller bug.
    expect(() => moveMethodDefinition(PROBE_SOURCE, PROBE_STRUCTURE.methods[0]!, 4)).toThrow(RangeError);
  });
});
