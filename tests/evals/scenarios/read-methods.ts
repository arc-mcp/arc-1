/** Synthetic model-routing/trajectory evals backed by the real read handler; no SAP connection. */
import type { EvalScenario, ExpectedToolCall } from '../types.js';

const SOURCE = `CLASS zcl_token_eval DEFINITION PUBLIC.
PUBLIC SECTION.
METHODS execute IMPORTING iv_text TYPE string RETURNING VALUE(rv_length) TYPE i.
ENDCLASS.
CLASS zcl_token_eval IMPLEMENTATION.
METHOD execute.
  rv_length = strlen( iv_text ).
ENDMETHOD.
ENDCLASS.`;

const LOCAL_SOURCE = `CLASS lcl_worker DEFINITION.
PUBLIC SECTION.
METHODS execute RETURNING VALUE(result) TYPE i.
ENDCLASS.
CLASS lcl_worker IMPLEMENTATION.
METHOD execute.
  result = 42.
ENDMETHOD.
ENDCLASS.`;

export async function readMethodFixtureExecutor(tool: string, args: Record<string, unknown>): Promise<string> {
  const allowed = new Set(['type', 'name', 'method', 'methodView', 'format', 'version', 'include']);
  if (
    tool !== 'SAPRead' ||
    args.type !== 'CLAS' ||
    String(args.name).toUpperCase() !== 'ZCL_TOKEN_EVAL' ||
    Object.keys(args).some((key) => !allowed.has(key)) ||
    (args.include !== undefined && args.include !== 'main' && args.include !== 'implementations') ||
    (args.format === 'structured' && !args.method)
  ) {
    return 'Error: This isolated fixture supports only CLAS source and method reads for ZCL_TOKEN_EVAL.';
  }
  const { AdtClient } = await import('../../../src/adt/client.js');
  const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
  const { DEFAULT_CONFIG } = await import('../../../src/server/types.js');
  const client = new AdtClient({ baseUrl: 'https://fixture.invalid' });
  client.getClass = async () => ({ source: SOURCE, notModified: false, statusCode: 200 });
  client.getClassInclude = async () => ({ source: LOCAL_SOURCE, notModified: false, statusCode: 200 });
  client.getInactiveObjects = async () => [];
  const result = await handleToolCall(client, DEFAULT_CONFIG, tool, args);
  return `${result.isError ? 'Error: ' : ''}${result.content.map((part) => part.text ?? '').join('\n')}`;
}

function read(method: string, signature = false): ExpectedToolCall {
  return {
    tool: 'SAPRead',
    requiredArgs: { type: 'CLAS', name: 'ZCL_TOKEN_EVAL', method, ...(signature ? { methodView: 'signature' } : {}) },
    ...(!signature ? { absentArgPaths: [['methodView']] } : {}),
    argumentPatterns: { format: { forbidden: [/^structured$/i] } },
  };
}

export const SCENARIOS: EvalScenario[] = [
  {
    id: 'read-method-own-signature',
    category: 'read',
    description: 'Choose the compact own declaration for a parameter question.',
    prompt:
      'What are the import and return parameters of execute in class ZCL_TOKEN_EVAL? Read only its declaration and name the parameter types.',
    optimal: [read('execute', true)],
    expectedTrace: [[read('execute', true)]],
    finalAnswer: { required: [/iv_text/i, /string/i, /rv_length/i, /\bi\b|integer/i], requireNonEmpty: true },
  },
  {
    id: 'read-method-implementation',
    category: 'read',
    description: 'Keep implementation reads on the existing method-body path.',
    prompt: 'Show the implementation of method execute in class ZCL_TOKEN_EVAL and explain what it does.',
    optimal: [read('execute')],
    expectedTrace: [[read('execute')]],
    finalAnswer: { required: [/strlen|length/i, /iv_text/i], requireNonEmpty: true },
  },
  {
    id: 'read-method-inventory',
    category: 'read',
    description: 'Use the explicit method inventory for a minimal method list.',
    prompt: 'List the methods in class ZCL_TOKEN_EVAL. Keep the read response small; I do not need source code.',
    optimal: [read('*')],
    expectedTrace: [[read('*')]],
    finalAnswer: { required: [/execute/i], requireNonEmpty: true },
  },
  {
    id: 'read-method-local-qualified',
    category: 'read',
    description: 'Select the local implementation with an explicit owner, not the same-named global method.',
    prompt:
      'Show the implementation of execute in local class lcl_worker inside global class ZCL_TOKEN_EVAL. What value does it return?',
    optimal: [read('lcl_worker~execute')],
    expectedTrace: [[read('lcl_worker~execute')]],
    finalAnswer: { required: [/42/], forbidden: [/strlen/], requireNonEmpty: true },
  },
  {
    id: 'read-method-typo-recovery',
    category: 'read',
    description: 'Recover a misspelling using the bounded suggestion without a full-source/list detour.',
    prompt:
      'Show the implementation of method excute in class ZCL_TOKEN_EVAL. If that spelling is wrong, use the server suggestion and retry the method read.',
    optimal: [read('excute')],
    expectedTrace: [[read('excute')], [read('execute')]],
    finalAnswer: { required: [/execute/i, /strlen|length/i], requireNonEmpty: true },
  },
].map((scenario) => ({
  ...scenario,
  tags: ['read-methods', 'token-efficiency'],
  mockOnly: true,
  requireFullParameters: true,
  maxToolCalls: 3,
  mockToolExecutor: readMethodFixtureExecutor,
  forbidden: ['SAPWrite', 'SAPActivate', 'SAPManage', 'SAPQuery'],
}));
