import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { SAPWriteSchema } = await import('../../../src/handlers/schemas.js');
const identity = { type: 'FUNC', name: 'Z_TYPE_TEST', group: 'Z_GROUP' };

beforeEach(() => mockFetch.mockReset());

describe('FUNC parameter type validation', () => {
  it.each(['importing', 'exporting', 'changing', 'tables'])(
    'rejects a missing or blank %s type before SAP',
    async (kind) => {
      for (const type of [undefined, '', '   ']) {
        const entry = { ...identity, parameters: [{ kind, name: 'P', type }] };
        for (const args of [
          { action: 'create', ...entry },
          { action: 'update', ...entry },
          { action: 'batch_create', objects: [entry] },
        ]) {
          const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', args);
          expect(result.isError).toBe(true);
          expect(result.content[0]?.text).toContain('A non-empty type is required');
          expect(mockFetch).not.toHaveBeenCalled();
        }
      }
    },
  );

  it.each(['exceptions', 'raising'])('does not require type for %s', (kind) => {
    expect(
      SAPWriteSchema.safeParse({ action: 'create', ...identity, parameters: [{ kind, name: 'FAILURE' }] }).success,
    ).toBe(true);
  });
});
