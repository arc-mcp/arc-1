import { afterEach, expect, it, vi } from 'vitest';
import type { PgGraphStore } from './store/pg.js';

vi.mock('./store/hana-connection.js', () => ({ withHanaSession: vi.fn() }));

import { hanaStorage, pgStorage } from './storage.js';
import { withHanaSession } from './store/hana-connection.js';

afterEach(() => vi.resetAllMocks());

it('counts base-table totals once and reports unavailable WAL separately', async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ name: 'nodes', table_bytes: '100', index_bytes: '50', total_bytes: '150' }] })
    .mockResolvedValueOnce({ rows: [{ bytes: '1000' }] })
    .mockRejectedValueOnce(new Error('monitoring privilege denied'));
  const result = await pgStorage({ pool: { query } } as unknown as PgGraphStore);
  expect(result).toMatchObject({ totalBytes: 150, databaseBytes: 1000, walPosition: null });
  expect(query.mock.calls[0]![0]).toContain("c.relkind='r'");
});

it('does not mistake absent PG graph tables for an empty physical footprint', async () => {
  await expect(pgStorage({ pool: { query: async () => ({ rows: [] }) } } as unknown as PgGraphStore)).rejects.toThrow(
    'No visible',
  );
});

it('marks privilege-filtered HANA disk and memory measurements unavailable', async () => {
  const exec = vi
    .fn()
    .mockResolvedValueOnce(Array.from({ length: 6 }, (_, i) => ({ TABLE_NAME: `T${i}` })))
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([]);
  vi.mocked(withHanaSession).mockImplementation(async (operation) => operation({ exec } as never));
  const result = await hanaStorage({});
  expect(result).toMatchObject({ diskStatus: 'filtered_or_not_persisted', diskBytes: null, columnMemoryBytes: null });
});

it('separates persisted table size from column memory and the row-store lock', async () => {
  const tables = Array.from({ length: 6 }, (_, i) => ({ TABLE_NAME: i ? `T${i}` : 'COLLECTOR_LOCK' }));
  const exec = vi
    .fn()
    .mockResolvedValueOnce(tables)
    .mockResolvedValueOnce(tables.map((t) => ({ ...t, DISK_BYTES: 100 })))
    .mockResolvedValueOnce(tables.slice(1).map((t) => ({ ...t, MEMORY_BYTES: 200 })));
  vi.mocked(withHanaSession).mockImplementation(async (operation) => operation({ exec } as never));
  expect(await hanaStorage({})).toMatchObject({ diskStatus: 'available', diskBytes: 600, columnMemoryBytes: 1000 });
});
