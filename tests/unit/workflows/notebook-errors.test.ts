import { expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { DataSourcePolicyError } from '../../../src/adt/data-source-policy.js';
import { AdtResponseLimitError } from '../../../src/adt/errors.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { handleToolCall } from '../../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { runNotebook } from '../../../src/workflows/sql-notebook.js';

it.each([false, true])('classifies actual dispatcher limit and policy replies, minimal=%s', async (minimalErrors) => {
  const client = new AdtClient({ safety: { ...defaultSafetyConfig(), allowFreeSQL: true } });
  const query = vi.spyOn(client, 'runQueryBatch');
  for (const [error, status] of [
    [new AdtResponseLimitError(2 * 1024 * 1024, 3 * 1024 * 1024, 'data-preview'), 'incomplete'],
    [new DataSourcePolicyError('DATA_SOURCE_BLOCKED', 'ZTABLE', [], 'Test policy'), 'blocked'],
  ] as const) {
    query.mockRejectedValueOnce(error);
    const run = await runNotebook(
      {
        schemaVersion: 1,
        title: 'Real errors',
        cells: [{ id: 'one', kind: 'sql', value: 'SELECT id FROM ztable', target: 'dev', maxRows: 2 }],
      },
      {
        dev: {
          identity: 'test',
          client: '001',
          call: (tool, args) =>
            handleToolCall(client, { ...DEFAULT_CONFIG, allowFreeSQL: true, minimalErrors }, tool, args),
        },
      },
    );
    expect(run.cells[0]?.status).toBe(status);
  }
  expect(query).toHaveBeenCalledTimes(2);
});
