import { expect, it, vi } from 'vitest';
import { scaleConfig, scaleFailureCode, seedHanaScale } from './hana-scale.js';

const env = { ARC_GRAPH_SCALE_CONFIRM: 'synthetic-metadata-only', ARC_GRAPH_SCALE_SYSTEM_KEY: 'SCALE-TEST' };
function session(nodes = 1000, fail = '') {
  const batchSizes: number[] = [];
  const statement = {
    execBatch: (rows: unknown[][], callback: (error?: Error) => void) => {
      batchSizes.push(rows.length);
      callback(fail === 'batch' ? Object.assign(new Error('private-canary'), { code: 129 }) : undefined);
    },
    drop: vi.fn((callback: () => void) => callback()),
  };
  const exec = vi.fn(async (sql: string) => {
    if (sql.startsWith('SELECT COUNT')) return [{ N: fail === 'populated' ? 1 : 0 }];
    if (sql.startsWith('SELECT ID'))
      return Array.from({ length: nodes }, (_, n) => ({
        ID: n + 1,
        OBJECT_NAME: `ZSCALE_${String(n + 1).padStart(7, '0')}`,
      }));
    return [];
  });
  const connection = {
    setAutoCommit: vi.fn(),
    prepare: vi.fn((_sql: string, callback: (error: Error | null, result?: typeof statement) => void) => {
      callback(fail === 'prepare' ? new Error('private-canary') : null, statement);
    }),
  };
  return { value: { exec, connection } as never, exec, connection, statement, batchSizes };
}

it('requires explicit synthetic scope and bounds before generating SQL', () => {
  expect(() => scaleConfig({})).toThrow();
  expect(() => scaleConfig({ ...env, ARC_GRAPH_HANA_BOOTSTRAP: 'true' })).toThrow('Bootstrap');
  for (const change of [
    { ARC_GRAPH_SCALE_SYSTEM_KEY: "SCALE-X';DROP" },
    { ARC_GRAPH_SCALE_NODES: '100001' },
    { ARC_GRAPH_SCALE_NODES: '1000;DELETE' },
    { ARC_GRAPH_SCALE_FANOUT: '11' },
  ])
    expect(() => scaleConfig({ ...env, ...change })).toThrow();
  expect(scaleConfig(env)).toMatchObject({ nodes: 1000, fanout: 10 });
  expect(scaleConfig({ ...env, ARC_GRAPH_SCALE_NODES: '7919' }).stride).toBe(1);
});

it('holds the writer lock, binds the scope and does not replace existing data', async () => {
  const s = session();
  await seedHanaScale(s.value, env);
  expect(s.exec.mock.calls[1]![0]).toContain('UPDATE COLLECTOR_LOCK');
  expect(s.exec.mock.calls[3]![0]).toContain('SERIES_GENERATE_INTEGER(1, 1, 1001)');
  expect(s.connection.prepare.mock.calls[0]![0]).toContain("VALUES (?, ?, 'references'");
  expect(s.exec.mock.calls.at(-1)![0]).toBe('COMMIT');
  expect(s.exec.mock.calls.some(([sql]) => /DROP|DELETE|TRUNCATE/.test(sql))).toBe(false);
  expect(s.statement.drop).toHaveBeenCalledOnce();
});

it('refuses a populated key and rolls back before inserting', async () => {
  const s = session(1000, 'populated');
  await expect(seedHanaScale(s.value, env)).rejects.toThrow('already populated');
  expect(s.exec.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
  expect(s.exec.mock.calls.at(-1)![0]).toBe('ROLLBACK');
});

it.each(['batch', 'prepare'])('rolls back %s errors without exposing native error text', async (fail) => {
  const s = session(1000, fail);
  await expect(seedHanaScale(s.value, env)).rejects.toThrow(/^HANA operation failed(?: \(129\))?$/);
  expect(s.exec.mock.calls.at(-1)![0]).toBe('ROLLBACK');
  if (fail === 'batch') expect(s.statement.drop).toHaveBeenCalledOnce();
});

it('bounds one million observations to 5,000-row batches and commits once', async () => {
  const s = session(100000);
  const progress = vi.fn();
  await seedHanaScale(s.value, { ...env, ARC_GRAPH_SCALE_NODES: '100000' }, progress);
  expect(s.batchSizes).toHaveLength(200);
  expect(s.batchSizes.every((n) => n === 5000)).toBe(true);
  expect(s.exec.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO NODES'))).toHaveLength(1);
  expect(s.exec.mock.calls.filter(([sql]) => sql === 'COMMIT')).toHaveLength(1);
  expect(progress).toHaveBeenLastCalledWith(100000);
});

it('reports only allowlisted diagnostic codes, never arbitrary SQL or credential text', () => {
  expect(scaleFailureCode(new Error('HANA operation failed (129)'))).toBe('hana-129');
  expect(scaleFailureCode(new Error('HANA operation deadline exceeded'))).toBe('deadline');
  expect(scaleFailureCode(new Error('HANA operation failed (129): private-canary'))).toBe('operation');
});
