import { describe, expect, it } from 'vitest';
import { methodNotFoundMessage } from '../../../src/context/method-suggestions.js';
import { extractMethod, type MethodInfo, spliceMethod } from '../../../src/context/method-surgery.js';

const method = (name: string, containingClass = 'zcl_demo'): MethodInfo => ({
  name,
  containingClass,
  visibility: 'public',
  signature: `METHODS ${name}.`,
  startLine: 1,
  endLine: 2,
  isRedefinition: false,
  isInterfaceMethod: name.includes('~'),
});

describe('bounded method-not-found suggestions', () => {
  it('keeps the close method even at the end of a large inventory', () => {
    const methods = Array.from({ length: 500 }, (_, i) => method(`helper_${i}`));
    methods.push(method('refresh_table_display'));
    const message = methodNotFoundMessage('ZCL_DEMO', 'refresh_table_displa', methods);
    expect(message).toContain('Suggestions in selected source: refresh_table_display');
    expect(message).toContain('SAPRead with method="*" and the same class/include');
    expect(message).not.toContain('helper_0');
    expect(message.length).toBeLessThan(400);
  });

  it('returns at most five suggestions and preserves local/interface qualification', () => {
    const methods = Array.from({ length: 8 }, (_, i) => method('execute', `lcl_helper${i}`));
    const message = methodNotFoundMessage('ZCL_DEMO', 'execut', methods);
    expect(message).toContain('lcl_helper0~execute');
    expect(message.match(/lcl_helper\d~execute/g)).toHaveLength(5);
    expect(methodNotFoundMessage('ZCL_DEMO', 'sen', [method('if_http_client~send')])).toContain('if_http_client~send');
  });

  it('ranks qualified typos against qualified selectors', () => {
    expect(methodNotFoundMessage('ZCL_DEMO', 'lcl_helper~execut', [method('execute', 'lcl_helper')])).toContain(
      'Suggestions in selected source: lcl_helper~execute',
    );
  });

  it('caps hostile query echo/ranking and skips oversized candidates without truncating selectors', () => {
    const message = methodNotFoundMessage('Z'.repeat(10000), 'x'.repeat(10000), [method('x'.repeat(10000))]);
    expect(message.length).toBeLessThan(500);
    expect(message).not.toContain('Suggestions');
  });

  it('bounds candidate inspection and keeps duplicate hints unique', () => {
    const methods = Array.from({ length: 2000 }, () => method('execute'));
    methods.push(
      Object.defineProperty(method('ignored'), 'containingClass', {
        get: () => {
          throw new Error('Ranking exceeded its candidate budget');
        },
      }),
    );
    const message = methodNotFoundMessage('ZCL_DEMO', 'execut', methods);
    expect(message).toContain('Suggestions in selected source: execute.');
    expect(message).not.toContain('execute, execute');
  });

  it('never suggests declaration-only or incomplete implementation entries', () => {
    const methods = [
      { ...method('execute'), startLine: 0, endLine: 0 },
      { ...method('executing'), endLine: 0 },
      method('executor'),
    ];
    const message = methodNotFoundMessage('ZCL_DEMO', 'execut', methods);
    expect(message).toContain('Suggestions in selected source: executor.');
    expect(message).not.toContain('execute,');
    expect(message).not.toContain('executing');
    expect(message).toContain('Use SAPRead');
  });

  it.each(['ABSTRACT', ''])('explains a declaration without a body (%s) and offers its own signature', (addition) => {
    const source = `CLASS zcl_demo DEFINITION PUBLIC ABSTRACT.
PUBLIC SECTION.
METHODS execute ${addition} IMPORTING value TYPE string.
ENDCLASS.
CLASS zcl_demo IMPLEMENTATION.
ENDCLASS.`;
    const result = extractMethod(source, 'ZCL_DEMO', 'execute');
    expect(result.success).toBe(false);
    expect(result.error).toContain('declared without an implementation');
    expect(result.error).toContain('SAPRead with method="execute" and methodView="signature"');
    expect(result.error).not.toContain('Suggestions');
    expect(extractMethod(source, 'ZCL_DEMO', 'execut').error).not.toContain('Suggestions');
    expect(spliceMethod(source, 'ZCL_DEMO', 'execute', 'RETURN.').error).toBe(result.error);
  });

  it('does not offer the global signature selector for a local declaration-only include', () => {
    const source = `CLASS lcl_demo DEFINITION.
PUBLIC SECTION.
METHODS execute.
ENDCLASS.`;
    const declaration = { ...method('execute', 'lcl_demo'), startLine: 0, endLine: 0 };
    const message = methodNotFoundMessage('ZCL_DEMO', 'lcl_demo~execute', [declaration], declaration);
    expect(message).toContain('declared without an implementation');
    expect(message).toContain('Use SAPRead');
    expect(message).not.toContain('methodView');
    expect(extractMethod(source, 'ZCL_DEMO', 'execut').error).not.toContain('Suggestions');
  });

  it('reports no guesses for unrelated or empty inventories', () => {
    for (const methods of [[], [method('get_name')]]) {
      expect(methodNotFoundMessage('ZCL_DEMO', 'refresh_table_display', methods)).not.toContain('Suggestions');
    }
  });

  it('uses bounded suggestions in real extraction while preserving ambiguity refusal', () => {
    const source =
      'CLASS lcl_a IMPLEMENTATION.\nMETHOD execute.\nENDMETHOD.\nENDCLASS.\nCLASS lcl_b IMPLEMENTATION.\nMETHOD execute.\nENDMETHOD.\nENDCLASS.';
    expect(extractMethod(source, 'ZCL_DEMO', 'execut').error).toContain('lcl_a~execute');
    expect(extractMethod(source, 'ZCL_DEMO', 'execute').error).toContain('Ambiguous');
  });
});
