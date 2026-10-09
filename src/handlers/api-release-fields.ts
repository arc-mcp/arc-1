import { API_RELEASE_VISIBILITIES } from '../adt/api-release.js';

export const API_RELEASE_FIELDS = {
  apiVisibility: {
    type: 'array',
    items: { type: 'string', enum: API_RELEASE_VISIBILITIES },
    maxItems: 2,
    uniqueItems: true,
    description:
      'set_api_state RELEASED: complete visibility selection; [] means none. Omit for SAP defaults. Read API_STATE first.',
  },
  apiState: {
    type: 'string',
    enum: ['RELEASED', 'NOT_RELEASED'],
    default: 'RELEASED',
  },
  contract: {
    type: 'string',
    enum: ['C0', 'C1', 'C2', 'C3', 'C4'],
    description:
      'set_api_state: contract (default C1); SRVD uses C0, classic VIEW uses C3. Unsupported choices report the supported contracts. SAP validates each contract and its visibility.',
  },
} as const;
