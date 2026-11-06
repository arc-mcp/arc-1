import { expect, it } from 'vitest';
import { validateBeforeWrite } from '../../../src/lint/lint.js';

const options = { systemType: 'onprem' as const, abapRelease: '758' };
const program = (statement: string) => `REPORT zspacing.\nDATA lt_names TYPE string_table.\n${statement}\n`;

// #954: SAP accepts the first form and rejects the second; lint warns on both and activation decides.
it.each(["DATA(lv) = VALUE string( lt_names[ 1 ] DEFAULT '').", "IF ('bar' = 'bar' ). ENDIF."])(
  'warns without blocking: %s',
  (statement) => {
    const result = validateBeforeWrite(program(statement), 'zspacing.prog.abap', options);
    expect(result.pass).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ rule: 'parser_missing_space', severity: 'warning' }),
    );
  },
);

it('lets an administrator restore blocking', () => {
  const result = validateBeforeWrite(
    program("DATA(lv) = VALUE string( lt_names[ 1 ] DEFAULT '')."),
    'zspacing.prog.abap',
    { ...options, ruleOverrides: { parser_missing_space: { severity: 'Error' } } },
  );
  expect(result.pass).toBe(false);
  expect(result.errors).toContainEqual(expect.objectContaining({ rule: 'parser_missing_space' }));
});
