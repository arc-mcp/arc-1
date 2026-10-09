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
      'TTYP: row type; required for create. Built-in dimensions: rowTypeLength/rowTypeDecimals. Updates preserve omitted dimensions only for an unchanged built-in row.',
  },
  rowTypeKind: {
    type: 'string',
    enum: ['builtin', 'structure'],
    description: 'TTYP: inferred if omitted; use builtin for CHAR/DEC. SAP validates dimensions.',
  },
} as const;
