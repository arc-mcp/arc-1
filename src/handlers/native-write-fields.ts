/** Pure shared field declarations; importing schemas must not initialize native HTTP or configuration. */
import { z } from 'zod';
import type { ServerConfig } from '../server/types.js';
import { CLASS_WRITE_INCLUDES } from './object-types.js';

export const CLASS_INCLUDE_FIELD = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.enum(CLASS_WRITE_INCLUDES).optional(),
);
export const NATIVE_METADATA_FIELDS = {
  expectedMetadataHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
};
export const MANAGE_OWNER_FIELDS = {
  type: z.string().optional(),
  group: z.string().optional(),
  expectedCurrentState: z
    .string()
    .regex(/^[A-Z_]{1,40}$/)
    .optional(),
};
export const SOURCE_HASH_TOOL_FIELDS = {
  expectedSourceHash: {
    type: 'string',
    description:
      'SHA-256 from SAPRead(format=editable). Refuses changed source under the lock. Text-source update and class/procedural surgery only; whole addressed source/include, not just the edited unit. Omitted/blank: no cross-call protection.',
  },
};
export function pinnedNativeToolFields(config: ServerConfig, kind: 'metadata' | 'owner') {
  if (!config.multiTargetWrite?.enabled) return {};
  return kind === 'metadata'
    ? {
        expectedMetadataHash: {
          type: 'string',
          pattern: '^[a-f0-9]{64}$',
          description:
            'Pinned native metadata SHA-256 from SAPRead(format="editable") for the exact selected native view. Required by document/SRVB updates and publication; optional for partial DDIC metadata merges. Never a source hash.',
        },
      }
    : {
        type: {
          type: 'string',
          enum: ['CLAS', 'INTF', 'DDLS', 'DCLS', 'BDEF', 'SRVD', 'FUNC'],
          description: 'Exact repository owner type for pinned set_api_state.',
        },
        group: { type: 'string', description: 'Containing function group for pinned FUNC API release.' },
        expectedCurrentState: {
          type: 'string',
          description: 'Exact native current API state for the selected contract; required for pinned set_api_state.',
        },
      };
}
