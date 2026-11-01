import { expect, it } from 'vitest';
import { extractMethod, listMethods, spliceMethod } from '../../../src/context/method-surgery.js';

const block = (owner: string, header: string, body: string) =>
  `CLASS ${owner} IMPLEMENTATION.${header}\n${body}\nENDCLASS.`;
it.each([
  ['', 'METHOD lif_x~run.\nENDMETHOD. " pretty printer'],
  ['', 'METHOD lif_x~run.\nENDMETHOD .'],
  [' " class note', 'METHOD lif_x~run.\nENDMETHOD.'],
  ['', 'METHOD lif_x~run. ENDMETHOD.'],
])('retains every formatted interface body in cross-class ambiguity checks (%s, %s)', (header, body) => {
  const source = `${block('lcl_worker', header, body)}\n${block('lcl_neighbor', '', 'METHOD lif_x~run.\nENDMETHOD.')}`;
  const listing = listMethods(source, 'ZCL_OWNER');
  expect(listing.success).toBe(true);
  expect(listing.methods.map((method) => [method.name, method.containingClass])).toEqual([
    ['lif_x~run', 'lcl_worker'],
    ['lif_x~run', 'lcl_neighbor'],
  ]);
  expect(extractMethod(source, 'ZCL_OWNER', 'lif_x~run').error).toContain('Ambiguous');
  const selected = spliceMethod(source, 'ZCL_OWNER', 'lcl_worker~lif_x~run', '  RETURN.');
  expect(selected.success, selected.error).toBe(true);
  expect(selected.newSource).toContain(block('lcl_neighbor', '', 'METHOD lif_x~run.\nENDMETHOD.'));
});
it('retains duplicate exact bodies in an otherwise normal single-class structure', () => {
  const source =
    'CLASS zcl_owner DEFINITION.\nPUBLIC SECTION.\nMETHODS run.\nENDCLASS.\nCLASS zcl_owner IMPLEMENTATION.\nMETHOD run.\nENDMETHOD.\nMETHOD run.\nENDMETHOD.\nENDCLASS.';
  expect(listMethods(source, 'ZCL_OWNER').methods).toHaveLength(2);
  expect(extractMethod(source, 'ZCL_OWNER', 'run').error).toContain('Ambiguous');
  expect(extractMethod(source, 'ZCL_OWNER', 'zcl_owner~run').success).toBe(false);
});
it.each([
  'ENDCLASS.\nCLASS lcl_foreign IMPLEMENTATION.',
  'INTERFACE lif_foreign.\nENDINTERFACE.',
  'FORM foreign.\nENDFORM.',
  'MODULE foreign OUTPUT.\nENDMODULE.',
  'FUNCTION foreign.\nENDFUNCTION.',
  'REPORT foreign.',
  'DATA(x) = 1. " comment\rENDCLASS.',
])('refuses replacement boundaries outside the selected method (%s)', (replacement) => {
  const source = block('lcl_worker', '', 'METHOD run.\nENDMETHOD.');
  for (const text of [replacement, `METHOD run.\n${replacement}\nENDMETHOD.`]) {
    const result = spliceMethod(source, 'ZCL_OWNER', 'lcl_worker~run', text);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Replacement must contain only');
  }
});

it('reads chained method declarations without phantom comma names or lost visibility', () => {
  const source = `CLASS lcl_owner DEFINITION.
PRIVATE SECTION.
METHODS: foo, bar.
ENDCLASS.
${block('lcl_owner', '', 'METHOD foo. ENDMETHOD.\nMETHOD bar. ENDMETHOD.')}`;
  const result = listMethods(source, 'ZCL_OWNER');
  expect(result.success, result.error).toBe(true);
  expect(result.methods.map((m) => [m.name, m.visibility])).toEqual([
    ['bar', 'private'],
    ['foo', 'private'],
  ]);
  expect(result.methods.every((m) => !m.signature.endsWith(','))).toBe(true);
});
it('reads exact namespaced method headers and still edits a neighboring method', () => {
  const source = block('lcl_owner', '', 'METHOD zif_service~/ns/run.\nRETURN.\nENDMETHOD.\nMETHOD other.\nENDMETHOD.');
  expect(listMethods(source, 'ZCL_OWNER').success).toBe(true);
  expect(extractMethod(source, 'ZCL_OWNER', 'zif_service~/ns/run').methodSource).toContain('RETURN.');
  const edited = spliceMethod(source, 'ZCL_OWNER', 'other', 'RETURN.');
  expect(edited.success, edited.error).toBe(true);
  expect(edited.newSource).toContain('METHOD zif_service~/ns/run.\nRETURN.\nENDMETHOD.');
  expect(spliceMethod(source, 'ZCL_OWNER', 'zif_service~/ns/run', 'RETURN.').success).toBe(true);
});
it('selects actual bodies before declaration-only exact and fuzzy candidates', () => {
  const abstractBase = 'CLASS lcl_base DEFINITION ABSTRACT.\nPUBLIC SECTION.\nMETHODS run ABSTRACT.\nENDCLASS.';
  expect(
    extractMethod(`${abstractBase}\n${block('lcl_child', '', 'METHOD run. ENDMETHOD.')}`, 'ZCL_OWNER', 'run').success,
  ).toBe(true);
  const declared = 'CLASS lcl_owner DEFINITION.\nPUBLIC SECTION.\nMETHODS value.\nENDCLASS.';
  const source = `${declared}\n${block('lcl_owner', '', 'METHOD zif_example~value. ENDMETHOD.')}`;
  expect(extractMethod(source, 'ZCL_OWNER', 'value').methodName).toBe('zif_example~value');
  expect(spliceMethod(source, 'ZCL_OWNER', 'value', 'RETURN.').success).toBe(true);
});
it.each([
  ['ENDCLASS.', 'ENDCLASS has no matching CLASS'],
  ['METHOD run. ENDMETHOD.', 'Unowned or nested METHOD'],
  [block('lcl_owner', '', 'ENDMETHOD.'), 'ENDMETHOD has no matching METHOD'],
  [block('lcl_owner', '', 'METHOD run.'), 'Method has no ENDMETHOD'],
  ['CLASS lcl_owner IMPLEMENTATION.\nMETHOD run. ENDMETHOD.', 'Incomplete class/method'],
  [block('lcl_owner', '', 'METHOD zif_service~/ns/run extra. ENDMETHOD.'), 'Read the complete source with SAPRead'],
])('refuses malformed inventory boundaries with useful read guidance: %s', (source, message) => {
  const result = listMethods(source, 'ZCL_OWNER');
  expect(result.success).toBe(false);
  expect(result.error).toContain(message);
});
