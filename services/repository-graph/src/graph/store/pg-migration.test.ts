import type { Pool } from 'pg';
import { expect, it, vi } from 'vitest';
import { PgGraphStore } from './pg.js';

it('repairs schema-version write permissions even on an already migrated experimental database', async () => {
  const query = vi.fn(async (sql: string) => ({
    rows: sql.includes('MAX(version)') ? [{ version: 1 }] : [{ exists: 1 }],
    rowCount: 1,
  }));
  const release = vi.fn();
  const pool = { connect: async () => ({ query, release }) } as unknown as Pool;
  expect(await new PgGraphStore(pool).migrate()).toBe(1);
  expect(
    query.mock.calls.some(([sql]) => sql.includes('REVOKE INSERT, UPDATE, DELETE ON arc_graph.schema_migrations')),
  ).toBe(true);
  expect(release).toHaveBeenCalledOnce();
});
