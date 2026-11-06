import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SAPWriteSchema, SAPWriteSchemaBtp } from '../../../src/handlers/schemas.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

const domain = { type: 'DOMA', name: 'ZDOMAIN', package: '$TMP', dataType: 'CHAR', length: 30 };

function input(action: string, fixedValues: Record<string, string>[]) {
  return action === 'batch_create'
    ? {
        action,
        objects: [
          { ...domain, name: 'ZVALID' },
          { ...domain, fixedValues },
        ],
      }
    : { action, ...domain, fixedValues };
}

describe('domain fixed-value storage limits (#943)', () => {
  beforeEach(() => vi.clearAllMocks());

  for (const [variant, schema] of [
    ['onprem', SAPWriteSchema],
    ['btp', SAPWriteSchemaBtp],
  ] as const) {
    for (const action of ['create', 'update', 'batch_create']) {
      it(`${variant} ${action} preserves exact limits, omitted fields, and empty values`, () => {
        for (const fixedValues of [
          [{ low: 'A'.repeat(10), high: 'Z'.repeat(10), description: 'D'.repeat(60) }],
          [{ low: '' }],
          [{ low: '', high: '', description: '' }],
          [],
        ]) {
          const value = input(action, fixedValues);
          expect(schema.parse(value)).toMatchObject(value);
        }
      });

      it.each([
        ['low', 10],
        ['high', 10],
        ['description', 60],
      ] as const)(`${variant} ${action} rejects oversized %s`, (field, limit) => {
        const result = schema.safeParse(input(action, [{ low: 'A', [field]: 'X'.repeat(limit + 1) }]));
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                path: [...(action === 'batch_create' ? ['objects', 1] : []), 'fixedValues', 0, field],
              }),
            ]),
          );
        }
      });
    }
  }

  for (const action of ['create', 'update', 'batch_create']) {
    it.each([
      ['low', 10],
      ['high', 10],
      ['description', 60],
    ] as const)(`${action} refuses oversized %s before any HTTP call`, async (field, limit) => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPWrite',
        input(action, [{ low: 'A', [field]: 'X'.repeat(limit + 1) }]),
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain(field);
      expect(result.content[0]?.text).toContain(String(limit));
      expect(mockFetch).not.toHaveBeenCalled();
    });
  }
});
