import { TABLE_TYPE_DIMENSION_MAX } from '../adt/ddic-xml.js';

export const TABLE_TYPE_BATCH_TOOL_PROPERTIES = {
  rowType: { type: 'string' },
  rowTypeKind: { type: 'string', enum: ['builtin', 'structure'] },
} as const;

export const TABLE_TYPE_DIMENSION_TOOL_PROPERTIES = {
  rowTypeLength: { type: 'integer', minimum: 0, maximum: TABLE_TYPE_DIMENSION_MAX },
  rowTypeDecimals: { type: 'integer', minimum: 0, maximum: TABLE_TYPE_DIMENSION_MAX },
} as const;

export const TABLE_TYPE_TOOL_PROPERTIES = {
  ...TABLE_TYPE_BATCH_TOOL_PROPERTIES,
  rowType: {
    type: 'string',
    description:
      'TTYP row; required on create. rowTypeLength/rowTypeDecimals: built-ins only. Updates preserve omitted values for unchanged rows.',
  },
  rowTypeKind: {
    type: 'string',
    enum: ['builtin', 'structure'],
    description: 'TTYP: use builtin for CHAR/DEC; otherwise inferred.',
  },
} as const;
