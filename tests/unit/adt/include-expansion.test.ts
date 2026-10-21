import { type ABAPObject, Expressions, MemoryFile, Registry, Statements } from '@abaplint/core';
import { describe, expect, it } from 'vitest';
import type { AdtClient } from '../../../src/adt/client.js';
import { AdtApiError, AdtNetworkError, AdtSafetyError } from '../../../src/adt/errors.js';
import { ABAPLINT_MAX_RELEASE, mapSapReleaseToAbaplintVersion } from '../../../src/adt/features.js';
import {
  EXPANSION_TEXT_LIMITS,
  expandIncludes,
  expansionNotes,
  findIncludeStatements,
  type IncludeExpansionRoot,
  includeOwner,
  readProgramExpanded,
} from '../../../src/adt/include-expansion.js';
import { getDefaultAbaplintConfig } from '../../../src/lint/abaplint-config-cache.js';
import { requestContext } from '../../../src/server/context.js';

const names = (source: string) =>
  findIncludeStatements(source).map((s) => `${s.name}@${s.line}${s.ifFound ? '?' : ''}`);

/** abaplint over the whole source, without the INCLUDE pre-filter and parse blocks: the reference. */
function fullParse(source: string): string[] {
  const registry = new Registry(getDefaultAbaplintConfig(mapSapReleaseToAbaplintVersion(String(ABAPLINT_MAX_RELEASE))));
  registry.addFile(new MemoryFile('zfull.prog.abap', source));
  registry.parse();
  const found: string[] = [];
  for (const object of registry.getObjects()) {
    for (const statement of (object as unknown as ABAPObject).getMainABAPFile()?.getStatements() ?? []) {
      if (!(statement.get() instanceof Statements.Include)) continue;
      const name = statement.findFirstExpression(Expressions.IncludeName);
      if (!name) continue;
      const words = statement.getTokens().map((token) => token.getStr().toUpperCase());
      const ifFound = words.some((word, index) => word === 'IF' && words[index + 1] === 'FOUND');
      found.push(`${name.concatTokens()}@${name.getFirstToken().getRow()}${ifFound ? '?' : ''}`);
    }
  }
  return found;
}

describe('findIncludeStatements', () => {
  it('finds INCLUDE statements with the line of the include name', () => {
    expect(names('REPORT zr.\nINCLUDE zr_top.\n\nINCLUDE zr_f01.')).toEqual(['zr_top@2', 'zr_f01@4']);
  });

  it('splits chains, also across lines with comments in between', () => {
    const source = [
      'INCLUDE: zr_top,   " globals.',
      '* zr_old,',
      '         zr_f01,',
      '         zr_f02.',
      'INCLUDE',
      '  : zr_f03.',
    ].join('\n');
    expect(names(source)).toEqual(['zr_top@1', 'zr_f01@3', 'zr_f02@4', 'zr_f03@6']);
  });

  it('marks IF FOUND per statement, in any case', () => {
    expect(names('INCLUDE zopt IF FOUND.\ninclude zopt2 if found.\nINCLUDE: za IF FOUND, zb.')).toEqual([
      'zopt@1?',
      'zopt2@2?',
      'za@3?',
      'zb@3',
    ]);
  });

  it('ignores type includes, comments and literals', () => {
    const source = [
      'TYPES BEGIN OF ty.',
      '  INCLUDE TYPE zs_type AS sub RENAMING WITH SUFFIX _x.',
      'TYPES END OF ty.',
      'DATA BEGIN OF gs.',
      '  INCLUDE STRUCTURE mara.',
      'DATA END OF gs.',
      '* INCLUDE zcommented.',
      '" INCLUDE zcommented2.',
      "WRITE 'INCLUDE zliteral.'. \" INCLUDE zcomment3.",
      'DATA lv TYPE string VALUE `INCLUDE zbackquote.`.',
      'lv = |INCLUDE ztemplate. { lv }|.',
    ].join('\n');
    expect(names(source)).toEqual([]);
  });

  it('keeps statement boundaries around literals that contain periods', () => {
    const source = [
      "CALL FUNCTION 'Z_X'",
      "  EXPORTING include = 'a.b'",
      "            other = 'c'.",
      "WRITE: / 'a',",
      "  'b'. INCLUDE zafter.",
      'INCLUDE zlast.',
    ].join('\n');
    expect(names(source)).toEqual(['zafter@5', 'zlast@6']);
  });

  it('reads system includes, namespaces and CRLF sources', () => {
    expect(names('INCLUDE <icon>.\r\nINCLUDE /abc/forms.\r\nINCLUDE zr_top.\r\n')).toEqual([
      '<icon>@1',
      '/abc/forms@2',
      'zr_top@3',
    ]);
  });

  it('returns nothing for sources without the keyword', () => {
    expect(findIncludeStatements("REPORT zr.\nWRITE 'x'.")).toEqual([]);
  });

  it('stays linear on large sources (abaplint sees only INCLUDE statements)', () => {
    const body = Array.from({ length: 5_000 }, (_, i) =>
      [
        `FORM f${i} USING pv TYPE i.`,
        `  IF pv > ${i}. WRITE: / 'x', pv. ENDIF.`,
        '  LOOP AT gt ASSIGNING FIELD-SYMBOL(<ls>). <ls>-a = <ls>-b + 1. ENDLOOP.',
        'ENDFORM.',
      ].join('\n'),
    ).join('\n');
    const started = performance.now();
    // ~20,000 lines; a full abaplint parse of this file takes seconds (structure pass).
    expect(names(`REPORT zr.\nINCLUDE zr_top.\n${body}\nINCLUDE zr_end.`)).toEqual(['zr_top@2', 'zr_end@20003']);
    expect(performance.now() - started).toBeLessThan(3_000);
  });

  it('stays linear on sources made of INCLUDE statements and keeps their lines across parse blocks', () => {
    const source = Array.from({ length: 40_000 }, (_, i) => `INCLUDE zinc${i}.`).join('\n');
    const started = performance.now();
    // One parse of these 40,000 statements took 3.4 s on abaplint 2.120.71.
    const found = findIncludeStatements(source);
    expect(performance.now() - started).toBeLessThan(3_000);
    expect(found).toHaveLength(40_000);
    expect(found[2_000]).toEqual({ name: 'zinc2000', line: 2_001, ifFound: false });
    expect(found[39_999]).toEqual({ name: 'zinc39999', line: 40_000, ifFound: false });
  });

  it('finds what a full parse finds when chains and shared lines meet a parse block boundary', () => {
    const lines: string[] = [];
    for (let i = 0; i < 4_100; i++) {
      if (i % 997 === 0) lines.push(`INCLUDE: za${i},`, `         zb${i}. WRITE / 'x'.`);
      else if (i % 499 === 0) lines.push(`INCLUDE zc${i}. INCLUDE zd${i} IF FOUND.`);
      else lines.push(`INCLUDE ze${i}.`);
    }
    const source = lines.join('\n');
    const found = names(source);
    expect(found).toHaveLength(4_100 + 5 + 8);
    expect(found).toEqual(fullParse(source));
  });

  // The pre-filter must never change what abaplint finds: each case against a parse of the whole source.
  it.each([
    ['a string template with a period after its line break', 'DATA(s) = |a {\n  v }. b|.\nINCLUDE zinc1.', ['zinc1@3']],
    [
      'an include on the closing line of a multiline template',
      'DATA(s) = |a {\n  v }. b|. INCLUDE zsame.',
      ['zsame@2'],
    ],
    [
      'an include after multiline template text without a period',
      'REPORT zr.\nDATA(t) = |a{ b\n }c|. INCLUDE zsame.',
      ['zsame@3'],
    ],
    [
      'an include after a quote in multiline template text',
      'REPORT zr.\nDATA(t) = |a{ b\n }c"x|. INCLUDE zsame.',
      ['zsame@3'],
    ],
    [
      'an include chain on the closing line of a multiline template',
      'REPORT zr.\nDATA(t) = |a{ b\n }|. INCLUDE: za, zb IF FOUND.',
      ['za@3', 'zb@3?'],
    ],
    [
      'an include after a three-line template expression',
      "REPORT zr.\nDATA(t) = |a{ cond #(\n when x = 1 then 'y'\n else 'z' ) }.|. INCLUDE zsame.",
      ['zsame@4'],
    ],
    [
      'an include after nested multiline templates with escaped delimiters',
      'DATA(t) = |a { |b {\n v } \\| \\{ INCLUDE zfake. | } c|. INCLUDE zsame.',
      ['zsame@2'],
    ],
    [
      'an include starting on a template closing line and continuing on the next',
      'DATA(t) = |a {\n v } b|. INCLUDE\n zsame.',
      ['zsame@3'],
    ],
    [
      'a string template with an apostrophe after its line break',
      "DATA(s) = |it {\n  v }'s|.\nINCLUDE zinc2.",
      ['zinc2@3'],
    ],
    ['nested string templates', 'DATA(s) = |a { |b { v }. c| } d|. INCLUDE zinc3.', ['zinc3@1']],
    ['nested string templates across lines', 'DATA(s) = |a { |b {\n  v }. c| } d|.\nINCLUDE zinc4.', ['zinc4@3']],
    [
      'INCLUDE text in a template after its line break',
      'DATA(s) = |x {\n  v } INCLUDE zfake. |.\nINCLUDE zinc5.',
      ['zinc5@3'],
    ],
    ['escaped | and { in a template', 'DATA(s) = |a\\|b. \\{ INCLUDE zfake. |.\nINCLUDE zinc6.', ['zinc6@2']],
    [
      'EXEC SQL with periods',
      "EXEC SQL.\n  SELECT a.b INTO :lv FROM t WHERE c = 'x.y'\nENDEXEC.\nINCLUDE zinc7.",
      ['zinc7@4'],
    ],
    [
      'EXEC SQL with a column named include',
      'EXEC SQL.\n  SELECT include INTO :lv FROM t\nENDEXEC.\nINCLUDE zinc8.',
      ['zinc8@4'],
    ],
    [
      'INCLUDE inside DEFINE (abaplint parses macro bodies)',
      'DEFINE m.\n  INCLUDE zinc9.\nEND-OF-DEFINITION.\nINCLUDE zinc10.',
      ['zinc9@2', 'zinc10@4'],
    ],
    ['names with # and %', 'INCLUDE z#inc11.\nINCLUDE z%inc12.', ['z#inc11@1', 'z%inc12@2']],
    ['a missing final period', 'INCLUDE zinc13.\nINCLUDE zinc14', ['zinc13@1']],
    ['a period in a quote comment', "WRITE 'a'. \" note. INCLUDE zfake.\nINCLUDE zinc15.", ['zinc15@2']],
    [
      'a period in a star comment inside a chain',
      'INCLUDE: zinc16,\n* old. INCLUDE zfake.\n         zinc17.',
      ['zinc16@1', 'zinc17@3'],
    ],
    [
      'a char literal with a period and an escaped quote',
      "WRITE 'it''s. INCLUDE zfake.'.\nINCLUDE zinc18.",
      ['zinc18@2'],
    ],
    ['a backquote literal', 'DATA(s) = `x. INCLUDE zfake`.\nINCLUDE zinc19.', ['zinc19@2']],
  ])('agrees with a full abaplint parse: %s', (_label, source, expected) => {
    expect(fullParse(source)).toEqual(expected);
    expect(names(source)).toEqual(expected);
  });
});

describe('includeOwner', () => {
  it.each([
    ['<icon>', 'system'],
    ['ZREPORT_TOP', 'customer'],
    ['yreport', 'customer'],
    ['LZDEMOTOP', 'customer'],
    ['MZTESTO01', 'customer'],
    ['SAPMZTEST', 'customer'],
    ['SAPLZDEMO', 'customer'],
    ['LSVIMTDT', 'sap'],
    ['MV45ATOP', 'sap'],
    ['RSDBC1XX', 'sap'],
    ['/abc/forms', '/ABC/'],
  ])('%s is %s', (name, owner) => {
    expect(includeOwner(name)).toBe(owner);
  });
});

function reader(sources: Record<string, string | Error>) {
  const reads: string[] = [];
  const read = async (name: string) => {
    reads.push(name);
    const source = sources[name.toUpperCase()];
    if (source === undefined) throw new AdtApiError('Not found', 404, `/includes/${name}`);
    if (source instanceof Error) throw source;
    return source;
  };
  return { read, reads };
}

const prog = (source: string, name = 'ZR'): IncludeExpansionRoot => ({
  label: `PROG ${name}`,
  ref: name,
  owner: name,
  source,
});

describe('expandIncludes', () => {
  it('reads breadth-first and keeps the include names as written', async () => {
    const { read, reads } = reader({
      ZR_TOP: 'INCLUDE zr_types.',
      ZR_F01: 'FORM a. ENDFORM.',
      ZR_TYPES: 'TYPES t TYPE i.',
    });
    const result = await expandIncludes(prog('INCLUDE zr_top.\nINCLUDE zr_f01.'), read);
    expect(result.blocks.map((b) => b.name)).toEqual(['PROG ZR', 'zr_top', 'zr_f01', 'zr_types']);
    expect(reads).toEqual(['zr_top', 'zr_f01', 'zr_types']);
    expect(result.issues).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(expansionNotes(result, false)).toBeUndefined();
  });

  it('lists SAP, system and other-namespace includes under a customer program without reading them', async () => {
    const { read, reads } = reader({ ZR_TOP: 'INCLUDE lsvimtdt.' });
    const result = await expandIncludes(prog('INCLUDE <icon>.\nINCLUDE zr_top.\nINCLUDE /abc/forms.'), read);
    expect(reads).toEqual(['zr_top']);
    expect(result.issues).toEqual([
      { kind: 'skipped', reason: 'system', include: '<icon>', parent: 'ZR', line: 1 },
      { kind: 'skipped', reason: 'namespace', include: '/abc/forms', parent: 'ZR', line: 3 },
      { kind: 'skipped', reason: 'sap', include: 'lsvimtdt', parent: 'zr_top', line: 1 },
    ]);
    const notes = expansionNotes(result, false)!;
    // A foreign namespace may be the customer's own, so it is named before SAP and system includes.
    const order = [
      'Not expanded (other namespace; may be customer code): /abc/forms (ZR line 3).',
      'Not expanded (SAP include): lsvimtdt (zr_top line 1).',
      'Not expanded (system include): <icon> (ZR line 1).',
    ].map((line) => notes.indexOf(line));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(result.truncated).toBe(false);
  });

  it('expands SAP includes and customer exits under an SAP program, and same-namespace includes', async () => {
    const sap = reader({ LXM06TOP: 'x = 1.', ZXM06U01: 'y = 2.' });
    const sapResult = await expandIncludes(
      prog('INCLUDE lxm06top.\nINCLUDE zxm06u01.\nINCLUDE <list>.', 'SAPLXM06'),
      sap.read,
    );
    // Customer code first: the exit include is read before the SAP include named above it.
    expect(sap.reads).toEqual(['zxm06u01', 'lxm06top']);
    expect(sapResult.issues.map((i) => i.reason)).toEqual(['system']);

    const ns = reader({ '/ABC/FORMS': 'x = 1.', ZCOMMON: 'y = 2.' });
    await expandIncludes(prog('INCLUDE /abc/forms.\nINCLUDE zcommon.\nINCLUDE rsdbc1xx.', '/ABC/REPORT'), ns.read);
    // A namespace is not recognized as customer code by its name, so Z code goes first here too.
    expect(ns.reads).toEqual(['zcommon', '/abc/forms']);
  });

  it('reads customer includes first under an SAP program and names where each block is included', async () => {
    const { read, reads } = reader({ MDEMOTOP: 'DATA x.', MDEMOF01: 'FORM f. ENDFORM.', ZDEMO_INSERT: 'y = 1.' });
    const result = await expandIncludes(
      prog('INCLUDE mdemotop.\nINCLUDE mdemof01.\nINCLUDE zdemo_insert.', 'SAPMDEMO'),
      read,
    );
    expect(reads).toEqual(['zdemo_insert', 'mdemotop', 'mdemof01']);
    expect(result.blocks.map((b) => [b.name, b.includedAt])).toEqual([
      ['PROG SAPMDEMO', undefined],
      ['zdemo_insert', { parent: 'SAPMDEMO', line: 3 }],
      ['mdemotop', { parent: 'SAPMDEMO', line: 1 }],
      ['mdemof01', { parent: 'SAPMDEMO', line: 2 }],
    ]);
  });

  it('moves a customer include found inside an SAP include ahead of the SAP includes still waiting', async () => {
    const { read, reads } = reader({
      MDEMOA: 'INCLUDE zdemo_exit.',
      MDEMOB: 'x = 1.',
      MDEMOC: 'INCLUDE mdemod.',
      MDEMOD: 'y = 2.',
      ZDEMO_EXIT: 'INCLUDE zdemo_exit2.',
      ZDEMO_EXIT2: 'z = 3.',
    });
    const result = await expandIncludes(prog('INCLUDE mdemoa.\nINCLUDE mdemob.\nINCLUDE mdemoc.', 'SAPMDEMO'), read);
    expect(reads).toEqual(['mdemoa', 'zdemo_exit', 'zdemo_exit2', 'mdemob', 'mdemoc', 'mdemod']);
    expect(result.blocks.find((b) => b.name === 'zdemo_exit2')?.includedAt).toEqual({ parent: 'zdemo_exit', line: 1 });
    expect(result.issues).toEqual([]);
  });

  it('spends the limits on customer code first under an SAP program and lists the rest completely', async () => {
    const { read, reads } = reader({ MDEMOA: 'INCLUDE zdemo_late.', MDEMOB: 'x.', ZDEMO1: 'y.', ZDEMO2: 'z.' });
    const root = prog('INCLUDE mdemoa.\nINCLUDE mdemob.\nINCLUDE zdemo1.\nINCLUDE zdemo2.', 'SAPMDEMO');
    const result = await expandIncludes(root, read, { limits: { maxBlocks: 3 } });
    expect(reads).toEqual(['zdemo1', 'zdemo2']);
    expect(result.issues.map((i) => `${i.include}:${i.reason}`)).toEqual(['mdemoa:blocks', 'mdemob:blocks']);
    expect(expansionNotes(result, true)).toContain(
      'Limit reached (80 sources). Not searched: mdemoa (SAPMDEMO line 1), mdemob (SAPMDEMO line 2);'.replace(
        '80',
        '3',
      ),
    );

    // The depth limit still holds for customer code found late: zdemo_late sits below mdemoa.
    const deep = reader({ MDEMOA: 'INCLUDE zdemo_late.', ZDEMO_LATE: 'x.' });
    const shallow = await expandIncludes(prog('INCLUDE mdemoa.', 'SAPMDEMO'), deep.read, { limits: { maxDepth: 1 } });
    expect(deep.reads).toEqual(['mdemoa']);
    expect(shallow.issues).toEqual([
      { kind: 'skipped', reason: 'depth', include: 'zdemo_late', parent: 'mdemoa', line: 1 },
    ]);
  });

  it('walks in the same order on every run, however long each read takes', async () => {
    const sources = {
      MDEMOA: 'INCLUDE zdemo_x.\nINCLUDE mdemoc.',
      MDEMOB: 'INCLUDE zdemo_y.',
      MDEMOC: 'x.',
      ZDEMO_X: 'INCLUDE <icon>.',
      ZDEMO_Y: 'INCLUDE zdemo_x.',
      ZDEMO_Z: 'y.',
    };
    const root = prog('INCLUDE mdemoa.\nINCLUDE mdemob.\nINCLUDE zdemo_z.', 'SAPMDEMO');
    const run = async (delays: number[]) => {
      let call = 0;
      const { read, reads } = reader(sources);
      const slow = async (name: string) => {
        await new Promise((resolve) => setTimeout(resolve, delays[call++ % delays.length]));
        return read(name);
      };
      const result = await expandIncludes(root, slow);
      return JSON.stringify({ reads, result });
    };
    const first = await run([5, 0, 3]);
    expect(await run([0, 4, 1, 2])).toBe(first);
    // zdemo_y, found in mdemob, goes ahead of mdemoc, which waits since mdemoa was read.
    expect(JSON.parse(first).reads).toEqual(['zdemo_z', 'mdemoa', 'zdemo_x', 'mdemob', 'zdemo_y', 'mdemoc']);
  });

  it('reports an absent IF FOUND include and keeps placeholders for failed reads', async () => {
    const { read } = reader({ ZR_BROKEN: new AdtApiError('Server error', 500, '/includes/zr_broken') });
    const result = await expandIncludes(prog('INCLUDE zr_opt IF FOUND.\nINCLUDE zr_gone.\nINCLUDE zr_broken.'), read);
    expect(result.blocks.slice(1)).toEqual([
      {
        name: 'zr_gone',
        source: '[Could not read include "zr_gone"]',
        includedAt: { parent: 'ZR', line: 2 },
        unreadable: true,
      },
      {
        name: 'zr_broken',
        source: '[Could not read include "zr_broken"]',
        includedAt: { parent: 'ZR', line: 3 },
        unreadable: true,
      },
    ]);
    expect(result.issues).toEqual([
      { kind: 'absent', include: 'zr_opt', parent: 'ZR', line: 1 },
      { kind: 'unreadable', detail: 'HTTP 404', include: 'zr_gone', parent: 'ZR', line: 2 },
      { kind: 'unreadable', detail: 'HTTP 500', include: 'zr_broken', parent: 'ZR', line: 3 },
    ]);
    const notes = expansionNotes(result, false)!;
    expect(notes).toContain('Not present (INCLUDE ... IF FOUND): zr_opt (ZR line 1).');
    // The status says why (e.g. a missing authorization under principal propagation); SAP's text stays out.
    expect(notes).toContain('Could not be read: zr_gone (ZR line 2, HTTP 404), zr_broken (ZR line 3, HTTP 500).');
    expect(notes).not.toContain('Server error');
    expect(result.truncated).toBe(false);
  });

  it('counts IF FOUND includes that do not exist against the source limit', async () => {
    const { read, reads } = reader({});
    const root = prog(Array.from({ length: 10 }, (_, i) => `INCLUDE zmiss${i} IF FOUND.`).join('\n'));
    const result = await expandIncludes(root, read, { limits: { maxBlocks: 4 } });
    // The root and three reads that found nothing use up the four; the other seven are not requested.
    expect(reads).toEqual(['zmiss0', 'zmiss1', 'zmiss2']);
    expect(result.issues.filter((i) => i.kind === 'absent')).toHaveLength(3);
    expect(result.issues.filter((i) => i.reason === 'blocks')).toHaveLength(7);
    expect(expansionNotes(result, false)).toContain('Limit reached (4 sources).');
  });

  it('passes IF FOUND to the reader so an expected 404 stays quiet', async () => {
    const optional: boolean[] = [];
    await expandIncludes(prog('INCLUDE zr_opt IF FOUND.\nINCLUDE zr_top.'), async (_name, isOptional) => {
      optional.push(isOptional);
      return '';
    });
    expect(optional).toEqual([true, false]);
  });

  it('does not turn a safety refusal into a placeholder', async () => {
    const { read } = reader({ ZR_TOP: new AdtSafetyError('blocked') });
    await expect(expandIncludes(prog('INCLUDE zr_top.'), read)).rejects.toThrow(AdtSafetyError);
  });

  it('reports a cycle once and reads every include only once', async () => {
    const { read, reads } = reader({
      ZR_A: 'INCLUDE zr_b.\nINCLUDE zr_c.',
      ZR_B: 'INCLUDE zr_a.\nINCLUDE zr_c.\nINCLUDE ZR_A.',
      ZR_C: 'INCLUDE zr.',
    });
    const result = await expandIncludes(prog('INCLUDE zr_a.'), read);
    expect(reads).toEqual(['zr_a', 'zr_b', 'zr_c']);
    expect(result.issues).toEqual([
      { kind: 'cycle', include: 'zr_a', parent: 'zr_b', line: 1 },
      { kind: 'cycle', include: 'zr', parent: 'zr_c', line: 1 },
    ]);
    expect(expansionNotes(result, false)).toContain(
      'Cycle (includes an enclosing include again; read once): zr_a (zr_b line 1), zr (zr_c line 1).',
    );
  });

  it('stops at the depth limit and names the includes it did not read', async () => {
    const { read, reads } = reader({ Z1: 'INCLUDE z2.', Z2: 'INCLUDE z3.', Z3: 'INCLUDE z4.' });
    const result = await expandIncludes(prog('INCLUDE z1.'), read, { limits: { maxDepth: 2 } });
    expect(reads).toEqual(['z1', 'z2']);
    expect(result.truncated).toBe(true);
    expect(result.issues).toEqual([{ kind: 'skipped', reason: 'depth', include: 'z3', parent: 'z2', line: 1 }]);
    expect(expansionNotes(result, true)).toContain(
      'Limit reached (2 levels). Not searched: z3 (z2 line 1); includes inside them are not listed.',
    );
  });

  it('stops at the block limit', async () => {
    const { read, reads } = reader({ Z1: '', Z2: '', Z3: '' });
    const result = await expandIncludes(prog('INCLUDE z1.\nINCLUDE z2.\nINCLUDE z3.'), read, {
      limits: { maxBlocks: 2 },
    });
    expect(reads).toEqual(['z1']);
    expect(result.issues.map((i) => `${i.include}:${i.reason}`)).toEqual(['z2:blocks', 'z3:blocks']);
  });

  it('shortens the block that crosses the character limit at a line boundary and lists the rest', async () => {
    const big = Array.from({ length: 10 }, (_, i) => `WRITE ${i}.`).join('\n');
    const { read, reads } = reader({ Z1: big, Z2: 'x = 1.', Z3: 'INCLUDE z4.' });
    const root = prog('INCLUDE z1.\nINCLUDE z2.');
    const result = await expandIncludes(root, read, { limits: { maxChars: root.source.length + 30 }, shorten: true });
    expect(reads).toEqual(['z1']);
    expect(result.blocks[1]).toEqual({
      name: 'z1',
      source: 'WRITE 0.\nWRITE 1.\nWRITE 2.\n[... lines 4-10 not shown (character limit)]',
      includedAt: { parent: 'ZR', line: 1 },
    });
    expect(result.issues).toEqual([
      { kind: 'shortened', include: 'z1', parent: 'ZR', line: 1, shownLines: 3, totalLines: 10 },
      { kind: 'skipped', reason: 'size', include: 'z2', parent: 'ZR', line: 2 },
    ]);
    const notes = expansionNotes(result, false)!;
    expect(notes).toContain(`Limit reached (${root.source.length + 30} characters). z1 shows lines 1-3 of 10.`);
    expect(notes).toContain('Not expanded: z2 (ZR line 2)');
    expect(notes).toContain('lineStart/lineEnd read the rest of a shortened one.');
  });

  it('lists an include whose first line does not fit instead of showing an empty block', async () => {
    const { read } = reader({ Z1: 'DATA lv_long_name TYPE i.\nINCLUDE z3.', Z2: 'x = 1.' });
    const root = prog('INCLUDE z1.\nINCLUDE z2.');
    const result = await expandIncludes(root, read, { limits: { maxChars: root.source.length + 5 }, shorten: true });
    expect(result.blocks.map((b) => b.name)).toEqual(['PROG ZR']);
    expect(result.issues).toEqual([
      { kind: 'skipped', reason: 'size', include: 'z1', parent: 'ZR', line: 1 },
      { kind: 'skipped', reason: 'size', include: 'z2', parent: 'ZR', line: 2 },
    ]);
    const notes = expansionNotes(result, false)!;
    expect(notes).toContain('Not expanded: z1 (ZR line 1), z2 (ZR line 2); includes inside them are not listed.');
    expect(notes).not.toContain('lines 1-0');
  });

  it('keeps the crossing block whole for grep but reads nothing after it', async () => {
    const { read, reads } = reader({ Z1: 'WRITE 1.\nWRITE 2.', Z2: 'x = 1.' });
    const result = await expandIncludes(prog('INCLUDE z1.\nINCLUDE z2.'), read, { limits: { maxChars: 30 } });
    expect(reads).toEqual(['z1']);
    expect(result.blocks[1]!.source).toBe('WRITE 1.\nWRITE 2.');
    expect(result.issues.map((i) => `${i.include}:${i.reason}`)).toEqual(['z2:size']);
  });

  it('shortens an oversized root and reads no include', async () => {
    const { read, reads } = reader({ Z1: '' });
    const result = await expandIncludes(prog('INCLUDE z1.\nWRITE 1.\nWRITE 2.'), read, {
      limits: { maxChars: 12 },
      shorten: true,
    });
    expect(reads).toEqual([]);
    expect(result.blocks[0]!.source).toBe('INCLUDE z1.\n[... lines 2-3 not shown (character limit)]');
    expect(result.issues.map((i) => `${i.kind}:${i.include}`)).toEqual(['shortened:PROG ZR', 'skipped:z1']);
  });

  it('does not call a source shortened when only its trailing blank lines pass the limit', async () => {
    const { read } = reader({ Z1: 'WRITE 1.\n\n', Z2: 'x = 1.' });
    const root = prog('INCLUDE z1.\nINCLUDE z2.');
    const result = await expandIncludes(root, read, { limits: { maxChars: root.source.length + 9 }, shorten: true });
    expect(result.blocks[1]).toEqual({ name: 'z1', source: 'WRITE 1.\n\n', includedAt: { parent: 'ZR', line: 1 } });
    expect(result.issues).toEqual([{ kind: 'skipped', reason: 'size', include: 'z2', parent: 'ZR', line: 2 }]);
    // Nothing was shortened, so the closing line does not point at lineStart/lineEnd.
    expect(expansionNotes(result, false)).toMatch(/Read one include with SAPRead\(type="INCL", name="\.\.\."\)\.$/);
  });

  it('reads SAP module includes whose names carry a field name with a hyphen', async () => {
    const { read, reads } = reader({ 'MV45AO0R_RV45A-KEDATU_AUSGABE': 'MODULE rv45a-kedatu_ausgabe OUTPUT.' });
    const result = await expandIncludes(prog('INCLUDE MV45AO0R_RV45A-KEDATU_AUSGABE.', 'MV45AO0R'), read);
    expect(reads).toEqual(['MV45AO0R_RV45A-KEDATU_AUSGABE']);
    expect(result.issues).toEqual([]);
  });

  it('refuses include names it cannot address and caps long lists', async () => {
    const tooLong = `z${'x'.repeat(40)}`;
    const many = Array.from({ length: 25 }, (_, i) => `INCLUDE lsvim${i}.`).join('\n');
    const result = await expandIncludes(prog(`INCLUDE ${tooLong}.\n${many}`), reader({}).read);
    expect(result.issues[0]).toEqual({ kind: 'skipped', reason: 'name', include: tooLong, parent: 'ZR', line: 1 });
    const notes = expansionNotes(result, false)!;
    expect(notes).toContain(`Not expanded (unsupported include name): ${tooLong} (ZR line 1).`);
    expect(notes).toContain('lsvim19 (ZR line 21), 5 more.');
  });

  it('names customer includes first when a limit leaves includes unread', async () => {
    const { read } = reader({});
    const result = await expandIncludes(
      prog('INCLUDE mv45afza.\nINCLUDE mv45afzb.\nINCLUDE zmv45a_check.', 'SAPMV45A'),
      read,
      { limits: { maxBlocks: 1 } },
    );
    expect(expansionNotes(result, false)).toContain(
      'Not expanded: zmv45a_check (SAPMV45A line 3), mv45afza (SAPMV45A line 1), mv45afzb (SAPMV45A line 2);',
    );
  });

  it('reads nothing once the deadline has passed and lists the rest under the time limit', async () => {
    const { read, reads } = reader({ Z1: '' });
    const result = await expandIncludes(prog('INCLUDE z1.\nINCLUDE <icon>.'), read, { deadline: Date.now() - 1 });
    expect(reads).toEqual([]);
    expect(result.truncated).toBe(true);
    // <icon> is refused when it is found, z1 when its turn to be read comes.
    expect(result.issues.map((i) => `${i.include}:${i.reason}`)).toEqual(['<icon>:system', 'z1:time']);
    expect(expansionNotes(result, false)).toContain('Limit reached (20 s). Not expanded: z1 (ZR line 1);');
  });

  it('turns a read that outlives the deadline into a partial result', async () => {
    const reads: string[] = [];
    const slow = async (name: string) => {
      reads.push(name);
      await new Promise((resolve) => setTimeout(resolve, 40));
      const cause = new DOMException('The ADT request deadline was exceeded.', 'TimeoutError');
      throw new AdtNetworkError(cause.message, cause);
    };
    const result = await expandIncludes(prog('INCLUDE z1.\nINCLUDE z2.'), slow, { deadline: Date.now() + 10 });
    expect(reads).toEqual(['z1']);
    expect(result.blocks.map((b) => b.name)).toEqual(['PROG ZR']);
    expect(result.issues.map((i) => `${i.include}:${i.reason}`)).toEqual(['z1:time', 'z2:time']);
  });

  it('judges a failed read by its cause, not by the clock', async () => {
    const late = async (name: string) => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      throw name === 'z1' ? new AdtApiError('Not found', 404, '/z1') : new AdtNetworkError('socket hang up');
    };
    const result = await expandIncludes(prog('INCLUDE z1 IF FOUND.\nINCLUDE z2.'), late, { deadline: Date.now() + 10 });
    // z1 answered 404 after the deadline: absent, not "time"; z2 is not read any more.
    expect(result.issues.map((i) => `${i.kind}:${i.include}:${i.reason ?? ''}`)).toEqual([
      'absent:z1:',
      'skipped:z2:time',
    ]);
  });

  it('passes the deadline and cancel signal to every read and stops when the request is cancelled', async () => {
    const controller = new AbortController();
    const requests: unknown[] = [];
    const read = async (_name: string, _optional: boolean, request: unknown) => {
      requests.push(request);
      controller.abort();
      throw new AdtNetworkError('aborted');
    };
    const walk = expandIncludes(prog('INCLUDE z1.'), read, { deadline: 1e15, signal: controller.signal });
    await expect(walk).rejects.toThrow(AdtNetworkError);
    expect(requests).toEqual([{ deadline: 1e15, signal: controller.signal }]);
  });

  it('uses 80 sources, five levels, 40,000 characters and 20 s for text output', () => {
    expect(EXPANSION_TEXT_LIMITS).toEqual({ maxBlocks: 80, maxDepth: 5, maxChars: 40_000, maxMs: 20_000 });
  });
});

describe('readProgramExpanded', () => {
  it('passes the cancel signal of the MCP request to the root and every include read', async () => {
    const controller = new AbortController();
    const signals: unknown[] = [];
    const client = {
      getProgram: async (_name: string, opts: { signal?: AbortSignal }) => {
        signals.push(opts.signal);
        return { source: 'INCLUDE zr_top.\nINCLUDE zr_f01.' };
      },
      getInclude: async (_name: string, opts: { signal?: AbortSignal }) => {
        signals.push(opts.signal);
        return { source: 'DATA x TYPE i.' };
      },
    } as unknown as AdtClient;
    await requestContext.run({ requestId: 'REQ-T', signal: controller.signal }, () =>
      readProgramExpanded(client, 'PROG', 'ZR', { root: 'active' }),
    );
    expect(signals).toEqual([controller.signal, controller.signal, controller.signal]);
  });

  it('reads the root and its includes in their versions within one deadline', async () => {
    const calls: Array<{ kind: string; name: string; opts: Record<string, unknown> }> = [];
    const client = {
      getProgram: async (name: string, opts: Record<string, unknown>) => {
        calls.push({ kind: 'PROG', name, opts });
        return { source: 'INCLUDE zr_top.\nINCLUDE zr_opt IF FOUND.' };
      },
      getInclude: async (name: string, opts: Record<string, unknown>) => {
        calls.push({ kind: 'INCL', name, opts });
        if (name === 'zr_opt') throw new AdtApiError('Not found', 404, '/includes/zr_opt');
        return { source: 'DATA x TYPE i.' };
      },
    } as unknown as AdtClient;
    const started = Date.now();
    const result = await readProgramExpanded(client, 'PROG', 'ZR', {
      root: 'active',
      include: (include) => ({ version: 'inactive', draft: include === 'zr_top' }),
    });

    expect(result.blocks.map((b) => `${b.name}${b.draft ? ' [draft]' : ''}`)).toEqual(['PROG ZR', 'zr_top [draft]']);
    expect(result.issues).toEqual([{ kind: 'absent', include: 'zr_opt', parent: 'ZR', line: 2 }]);
    expect(calls.map((c) => [c.kind, c.name, c.opts.version, c.opts.suppressNotFoundLog])).toEqual([
      ['PROG', 'ZR', 'active', undefined],
      ['INCL', 'zr_top', 'inactive', false],
      ['INCL', 'zr_opt', 'inactive', true],
    ]);
    const deadlines = new Set(calls.map((c) => c.opts.deadline));
    expect(deadlines.size).toBe(1);
    expect([...deadlines][0]).toBeGreaterThanOrEqual(started + 20_000);
  });
});
