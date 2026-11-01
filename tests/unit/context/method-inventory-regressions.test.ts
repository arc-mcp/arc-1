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
