import { Version } from '@abaplint/core';
import { describe, expect, it } from 'vitest';
import { spliceMethod } from '../../../src/context/method-surgery.js';

const source = `CLASS zexample DEFINITION.
 PUBLIC SECTION.
 METHODS value RETURNING VALUE(result) TYPE i.
 METHODS other RETURNING VALUE(result) TYPE i.
ENDCLASS.
CLASS zexample IMPLEMENTATION.
 METHOD value.
  result = 1.
 ENDMETHOD.
 METHOD other.
  result = 99.
 ENDMETHOD.
ENDCLASS.`;

describe('method replacement boundaries', () => {
  it('leaves body syntax to lint while preserving the selected boundaries', () => {
    const result = spliceMethod(source, 'zexample', 'value', 'result = 2');
    expect(result.success).toBe(true);
    expect(result.newSource).toContain('result = 2\n ENDMETHOD.');
    expect(result.newSource).toContain('METHOD other.\n  result = 99.\n ENDMETHOD.');
  });

  it.each(['value', 'other'])('checks a complete AMDP replacement named %s', (name) => {
    const header = 'BY DATABASE PROCEDURE FOR HDB\n LANGUAGE SQLSCRIPT OPTIONS READ-ONLY.';
    const amdp = source.replace('METHOD value.\n  result = 1.', `METHOD value\n ${header}\n result = 1;`);
    const result = spliceMethod(
      amdp,
      'zexample',
      'value',
      `METHOD ${name}\n ${header}\n result = 2;\nENDMETHOD.`,
      Version.v758,
    );
    expect(result.success).toBe(name === 'value');
    if (name === 'value') {
      expect(result.newSource).toContain('result = 2;');
      expect(result.newSource).toContain('result = 99.');
    } else expect(result.newSource).toBe('');
  });
  it.each([
    'METHOD other. ENDMETHOD.',
    'METHOD value. ENDMETHOD. METHOD other. ENDMETHOD.',
    'ENDMETHOD. METHOD other.',
  ])('refuses a renamed or additional method: %s', (replacement) => {
    const result = spliceMethod(source, 'zexample', 'value', replacement);
    expect(result.success).toBe(false);
    expect(result.error).toContain('only the selected METHOD value');
    expect(result.newSource).toBe('');
  });

  it.each(['result = 2.', 'METHOD value. result = 2. ENDMETHOD.'])(
    'refuses whole-line replacement when a neighboring statement shares its boundary: %s',
    (replacement) => {
      for (const shared of [
        source.replace('IMPLEMENTATION.\n METHOD', 'IMPLEMENTATION. METHOD'),
        source.replace('ENDMETHOD.\n METHOD other.', 'ENDMETHOD. METHOD other.'),
      ]) {
        const result = spliceMethod(shared, 'zexample', 'value', replacement);
        expect(result.success).toBe(false);
        expect(result.newSource).toBe('');
      }
    },
  );

  it.each(['result = 2.', 'METHOD VALUE. result = 2. ENDMETHOD.'])(
    'accepts one selected block on a single line: %s',
    (replacement) => {
      const compact = source.replace(
        'METHOD value.\n  result = 1.\n ENDMETHOD.',
        'METHOD value. result = 1. ENDMETHOD.',
      );
      const result = spliceMethod(compact, 'zexample', 'value', replacement);
      expect(result.success).toBe(true);
      expect(result.newSource).toContain('result = 2.');
      expect(result.newSource).toContain('METHOD other.\n  result = 99.\n ENDMETHOD.');
    },
  );

  it('matches a fuzzy interface selection against its actual qualified method name', () => {
    const qualified = source
      .replace('METHODS value RETURNING VALUE(result) TYPE i.', 'INTERFACES zif_example.')
      .replace('METHOD value.', 'METHOD zif_example~value.');
    expect(spliceMethod(qualified, 'zexample', 'value', 'METHOD zif_example~value. ENDMETHOD.').success).toBe(true);
    expect(spliceMethod(qualified, 'zexample', 'value', 'METHOD value. ENDMETHOD.').success).toBe(false);
  });

  it('matches a local-class selector against the bare method in its block', () => {
    const local = source.replaceAll('zexample', 'lhc_example');
    expect(spliceMethod(local, 'zglobal', 'lhc_example~value', 'METHOD value. ENDMETHOD.').success).toBe(true);
  });

  it('preserves a multiline AMDP header and comments for a body-only edit', () => {
    const amdp = source.replace(
      'METHOD value.\n  result = 1.',
      'METHOD value\n BY DATABASE PROCEDURE FOR HDB\n LANGUAGE SQLSCRIPT OPTIONS READ-ONLY. " header\n result = 1;',
    );
    const result = spliceMethod(amdp, 'zexample', 'value', 'result = 2;', Version.v758);
    expect(result.success).toBe(true);
    expect(result.newSource).toContain('LANGUAGE SQLSCRIPT OPTIONS READ-ONLY. " header\nresult = 2;');
    expect(result.newSource).toContain('result = 99.');
  });
});
