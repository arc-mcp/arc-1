import { expect, it, vi } from 'vitest';
import { AdtResponseLimitError } from '../../../src/adt/errors.js';
import { unifiedDiff } from '../../../src/adt/source-diff.js';
import { ReviewBudget } from '../../../src/adt/transport-review-budget.js';
import { requestContext } from '../../../src/server/context.js';

it('stops diff work without inventing zero change statistics', () => {
  expect(() =>
    unifiedDiff('before\n', 'after\n', 'before', 'after', 3, true, { timeout: 100, maxEditLength: 0 }),
  ).toThrow(/work budget/);
});

it('stops after an oversized response even when the HTTP reservation was released', async () => {
  const budget = new ReviewBudget();
  await expect(
    budget.read(async () => {
      throw new AdtResponseLimitError(1024 * 1024, 1024 * 1024 + 1, 'test');
    }),
  ).rejects.toThrow();
  const next = vi.fn();
  await expect(budget.read(next)).rejects.toThrow(/exhausted/);
  expect(next).not.toHaveBeenCalled();
  expect(budget.metrics()).toMatchObject({ exhausted: true, responseBytes: 1024 * 1024 + 1 });
});
it('bounds a large sequence of source reads by cumulative bytes', async () => {
  const budget = new ReviewBudget();
  const read = vi.fn(async (request) => {
    const r = request.responseBudget.createReservation();
    r.add(1024 * 1024);
    r.commit();
  });
  for (let i = 0; i < 8; i++) await budget.read(read);
  await expect(budget.read(read)).rejects.toThrow(/exhausted/);
  expect(read).toHaveBeenCalledTimes(8);
});
it('does not enqueue further reads after inherited cancellation', async () => {
  const budget = new ReviewBudget();
  const read = vi.fn();
  await requestContext.run({ requestId: 'test', signal: AbortSignal.abort() }, async () => {
    await expect(budget.read(read)).rejects.toThrow();
  });
  expect(read).not.toHaveBeenCalled();
});

it('propagates the 30-second deadline and refuses the next read at its boundary', async () => {
  let now = 1000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  try {
    const budget = new ReviewBudget();
    await budget.read(async (request) => expect(request.deadline).toBe(31000));
    now = 31000;
    const next = vi.fn();
    await expect(budget.read(next)).rejects.toThrow(/deadline/);
    expect(next).not.toHaveBeenCalled();
    expect(budget.exhausted).toBe(true);
  } finally {
    clock.mockRestore();
  }
});
