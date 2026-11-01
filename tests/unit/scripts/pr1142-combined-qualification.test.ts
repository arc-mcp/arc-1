import { expect, it, vi } from 'vitest';
import { runDeletionScenario } from '../../../scripts/qualification/pr1142/deletion-regression.mjs';
import { qualify } from '../../../scripts/qualification/pr1142/qualification.mjs';

const formatter = vi.hoisted(() => vi.fn());
vi.mock('../../../scripts/qualification/pr1142/formatter-qualification.mjs', () => ({ qualify: formatter }));

it('runs both writers and all include checks through the real combined live-plan wrapper', async () => {
  const result = await runDeletionScenario('includes-success', {
    qualifier: qualify,
    configureFormatter: (implementation: typeof formatter) => formatter.mockImplementation(implementation),
    quiet: true,
  });
  expect(formatter).toHaveBeenCalledOnce();
  expect(result).toMatchObject({ passed: true, includeMutations: 32, remainingObjects: 0 });
}, 30_000);
