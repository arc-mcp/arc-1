/** Public JSON Schema fragment for per-node KTD short texts. */
export const KTD_SHORT_TEXTS_TOOL_SCHEMA = {
  type: 'array',
  description: 'SKTD/KTD create/update: exact SAPRead node ID; text max 60; empty clears; source optional.',
  items: {
    type: 'object',
    properties: {
      node: { type: 'string', minLength: 1 },
      text: { type: 'string', maxLength: 60 },
    },
    required: ['node', 'text'],
  },
} as const;
