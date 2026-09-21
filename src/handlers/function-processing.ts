/** ADT values used when a function module is created. */
export const FUNCTION_PROCESSING_TYPES = ['normal', 'rfc', 'update'] as const;
export const FUNCTION_UPDATE_TASK_KINDS = ['startImmediate', 'immediateStartNoRestart', 'startDelayed'] as const;

export type FunctionProcessingType = (typeof FUNCTION_PROCESSING_TYPES)[number];
export type FunctionUpdateTaskKind = (typeof FUNCTION_UPDATE_TASK_KINDS)[number];

export function isFunctionProcessingType(value: unknown): value is FunctionProcessingType {
  return FUNCTION_PROCESSING_TYPES.includes(value as FunctionProcessingType);
}

export function isFunctionUpdateTaskKind(value: unknown): value is FunctionUpdateTaskKind {
  return FUNCTION_UPDATE_TASK_KINDS.includes(value as FunctionUpdateTaskKind);
}

export const FUNCTION_PROCESSING_TOOL_PROPERTIES = {
  processingType: {
    type: 'string',
    enum: FUNCTION_PROCESSING_TYPES,
    description: 'FUNC create: normal, Remote-Enabled (`rfc`), or update-task module.',
  },
  updateTaskKind: {
    type: 'string',
    enum: FUNCTION_UPDATE_TASK_KINDS,
    description: 'FUNC create: required when processingType=`update`.',
  },
};

export const FUNCTION_MODULE_BATCH_TOOL_PROPERTIES = {
  group: { type: 'string' },
  processingType: { type: 'string', enum: FUNCTION_PROCESSING_TYPES },
  updateTaskKind: { type: 'string', enum: FUNCTION_UPDATE_TASK_KINDS },
  parameters: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['importing', 'exporting', 'changing', 'tables', 'exceptions', 'raising'],
        },
        name: { type: 'string' },
        type: { type: 'string' },
        byValue: { type: 'boolean' },
        default: { type: 'string' },
        optional: { type: 'boolean' },
      },
      required: ['kind', 'name'],
    },
  },
};
