import { withHanaSession } from './store/hana-connection.js';
import type { PgGraphStore } from './store/pg.js';

/** Physical schema footprint, not logical JSON size or provisioned service capacity. */
export async function pgStorage(store: PgGraphStore) {
  const result = await store.pool.query(`SELECT c.relname AS name,
    pg_table_size(c.oid)::text AS table_bytes, pg_indexes_size(c.oid)::text AS index_bytes,
    pg_total_relation_size(c.oid)::text AS total_bytes
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='arc_graph' AND c.relkind='r' ORDER BY c.relname`);
  if (!result.rows.length) throw new Error('No visible PostgreSQL graph tables');
  const tables = result.rows.map((row) => ({
    name: String(row.name),
    tableBytes: Number(row.table_bytes),
    indexBytes: Number(row.index_bytes),
    totalBytes: Number(row.total_bytes),
  }));
  const database = await store.pool.query('SELECT pg_database_size(current_database())::text AS bytes');
  let walPosition: string | null = null;
  try {
    walPosition = (await store.pool.query('SELECT pg_current_wal_lsn()::text AS lsn')).rows[0].lsn;
  } catch {
    /* Optional monitoring privilege: unavailable is not zero. */
  }
  return {
    tables,
    totalBytes: tables.reduce((n, t) => n + t.totalBytes, 0),
    databaseBytes: Number(database.rows[0].bytes),
    walPosition,
  };
}

export function walBytesBetween(before: string | null, after: string | null): number | null {
  if (!before || !after || ![before, after].every((s) => /^[0-9A-F]+\/[0-9A-F]+$/i.test(s))) return null;
  const decode = (s: string) => {
    const [hi, lo] = s.split('/');
    return (BigInt(`0x${hi}`) << 32n) + BigInt(`0x${lo}`);
  };
  const difference = decode(after) - decode(before);
  return difference >= 0 && difference <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(difference) : null;
}

/** Restricted monitoring views may be filtered. Never report an empty result as zero usage. */
export async function hanaStorage(env = process.env) {
  return withHanaSession(
    async (s) => {
      const expected = await s.exec<Array<{ TABLE_NAME: string }>>(
        'SELECT TABLE_NAME FROM SYS.TABLES WHERE SCHEMA_NAME = CURRENT_SCHEMA',
      );
      const disk = await s.exec<Array<{ TABLE_NAME: string; DISK_BYTES: number }>>(
        'SELECT TABLE_NAME, SUM(DISK_SIZE) AS DISK_BYTES FROM SYS.M_TABLE_PERSISTENCE_STATISTICS WHERE SCHEMA_NAME = CURRENT_SCHEMA GROUP BY TABLE_NAME',
      );
      const memory = await s.exec<Array<{ TABLE_NAME: string; MEMORY_BYTES: number }>>(
        'SELECT TABLE_NAME, SUM(MEMORY_SIZE_IN_TOTAL) AS MEMORY_BYTES FROM SYS.M_CS_TABLES WHERE SCHEMA_NAME = CURRENT_SCHEMA GROUP BY TABLE_NAME',
      );
      const complete = expected.length >= 6 && expected.every((t) => disk.some((d) => d.TABLE_NAME === t.TABLE_NAME));
      const columns = expected.filter((t) => t.TABLE_NAME !== 'COLLECTOR_LOCK');
      const memoryComplete =
        columns.length >= 5 && columns.every((t) => memory.some((m) => m.TABLE_NAME === t.TABLE_NAME));
      return {
        diskStatus: complete ? 'available' : 'filtered_or_not_persisted',
        diskBytes: complete ? disk.reduce((n, t) => n + Number(t.DISK_BYTES), 0) : null,
        columnMemoryBytes: memoryComplete ? memory.reduce((n, t) => n + Number(t.MEMORY_BYTES), 0) : null,
        tables: expected.map((t) => ({
          name: t.TABLE_NAME,
          diskBytes: disk.find((d) => d.TABLE_NAME === t.TABLE_NAME)?.DISK_BYTES ?? null,
          columnMemoryBytes: memory.find((m) => m.TABLE_NAME === t.TABLE_NAME)?.MEMORY_BYTES ?? null,
        })),
      };
    },
    env,
    15000,
  );
}
