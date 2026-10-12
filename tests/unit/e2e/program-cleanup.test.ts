import { describe, expect, it, vi } from 'vitest';
import { deleteProgramFixture } from '../../helpers/program-cleanup.js';

const ok = { content: [{ text: 'ok' }] };
const inactive = {
  isError: true,
  content: [{ text: 'PROG ZARC_TEST was not deleted because its text pool is inactive.' }],
};
describe('disposable program cleanup', () => {
  it('does not change source when delete succeeds or fails for an unrelated reason', async () => {
    for (const result of [ok, { isError: true, content: [{ text: 'Permission denied' }] }]) {
      const call = vi.fn().mockResolvedValue(result);
      expect(await deleteProgramFixture(call, 'ZARC_TEST')).toBe(result);
      expect(call).toHaveBeenCalledTimes(1);
    }
  });
  it('explicitly repairs only the inactive-pool refusal then propagates the final delete result', async () => {
    const failedDelete = { isError: true, content: [{ text: 'locked by another session' }] };
    const call = vi
      .fn()
      .mockResolvedValueOnce(inactive)
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce(failedDelete);
    expect(await deleteProgramFixture(call, 'ZARC_TEST')).toBe(failedDelete);
    expect(call.mock.calls).toEqual([
      ['SAPWrite', { action: 'delete', type: 'PROG', name: 'ZARC_TEST' }],
      ['SAPWrite', { action: 'update', type: 'PROG', name: 'ZARC_TEST', source: 'REPORT ZARC_TEST.' }],
      ['SAPActivate', { type: 'PROG', name: 'ZARC_TEST' }],
      ['SAPWrite', { action: 'delete', type: 'PROG', name: 'ZARC_TEST' }],
    ]);
  });
  it.each([1, 2])('stops and reports recovery failure at step %s', async (step) => {
    const call = vi.fn().mockResolvedValueOnce(inactive);
    if (step === 2) call.mockResolvedValueOnce(ok);
    call.mockResolvedValueOnce({ isError: true, content: [{ text: 'recovery failed' }] });
    await expect(deleteProgramFixture(call, 'ZARC_TEST')).rejects.toThrow(/Cleanup of ZARC_TEST: recovery failed/);
    expect(call).toHaveBeenCalledTimes(step + 1);
  });
});
