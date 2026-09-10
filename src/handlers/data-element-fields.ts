import { DTEL_MAX_LABEL_LENGTHS } from '../adt/ddic-xml.js';

export const DATA_ELEMENT_TOOL_PROPERTIES = {
  shortLength: {
    type: 'integer',
    minimum: 0,
    maximum: DTEL_MAX_LABEL_LENGTHS.short,
  },
  mediumLength: {
    type: 'integer',
    minimum: 0,
    maximum: DTEL_MAX_LABEL_LENGTHS.medium,
  },
  longLength: {
    type: 'integer',
    minimum: 0,
    maximum: DTEL_MAX_LABEL_LENGTHS.long,
  },
  headingLength: {
    type: 'integer',
    minimum: 0,
    maximum: DTEL_MAX_LABEL_LENGTHS.heading,
  },
  deactivateInputHistory: {
    type: 'boolean',
    description: 'DTEL: true disables SAP GUI input history for fields using this data element',
  },
} as const;

export const DATA_ELEMENT_BATCH_TOOL_PROPERTIES = {
  shortLength: { type: 'integer', minimum: 0, maximum: DTEL_MAX_LABEL_LENGTHS.short },
  mediumLength: { type: 'integer', minimum: 0, maximum: DTEL_MAX_LABEL_LENGTHS.medium },
  longLength: { type: 'integer', minimum: 0, maximum: DTEL_MAX_LABEL_LENGTHS.long },
  headingLength: { type: 'integer', minimum: 0, maximum: DTEL_MAX_LABEL_LENGTHS.heading },
  deactivateInputHistory: { type: 'boolean' },
} as const;
