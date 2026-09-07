import type { Pool } from 'pg';
import { afterEach, expect, it, vi } from 'vitest';
import { PgGraphStore } from './pg.js';

afterEach(() => vi.useRealTimers());
it('destroys an expired snapshot once and returns before the HTTP deadline', async () => {
  vi.useFakeTimers();
  const release = vi.fn();
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const pool = { connect: vi.fn().mockResolvedValue({ query, release }) } as unknown as Pool;
  const work = new PgGraphStore(pool).withSnapshot(async () => new Promise<never>(() => undefined));
  const assertion = expect(work).rejects.toThrow('snapshot deadline');
  await vi.advanceTimersByTimeAsync(4500);
  await assertion;
  expect(release).toHaveBeenCalledExactlyOnceWith(true);
  expect(query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
});
