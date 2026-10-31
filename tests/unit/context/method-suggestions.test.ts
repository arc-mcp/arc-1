import { describe, expect, it } from 'vitest';
import { methodNotFoundMessage } from '../../../src/context/method-suggestions.js';
import { extractMethod, type MethodInfo } from '../../../src/context/method-surgery.js';

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
    expect(message).toContain('method="*" with the same include');
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
