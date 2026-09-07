import { describe, expect, it, vi } from 'vitest';
import { HanaGraphStore } from './hana.js';
import type { HanaSession } from './hana-connection.js';

describe('HANA SQL boundary', () => {
  it('binds search input and escapes LIKE wildcards', async () => {
    const exec = vi.fn().mockResolvedValue([]);
    const store = new HanaGraphStore({}, { exec } as unknown as HanaSession);
    await store.search('TEST', "x%'_", 2);
    const [sql, params] = exec.mock.calls[0]!;
    expect(sql).not.toContain("x%'");
    expect(params).toEqual(['TEST', "%X\\%'\\_%", "%X\\%'\\_%", "%X\\%'\\_%", "X%'_", 2]);
    await expect(store.search('TEST', 'Z', 102)).rejects.toThrow();
  });
  it('does not resolve an ambiguous type family', async () => {
    const exec = vi.fn().mockResolvedValue([{ OBJECT_TYPE: 'TABL/DT' }, { OBJECT_TYPE: 'TABL/DS' }]);
    const store = new HanaGraphStore({}, { exec } as unknown as HanaSession);
    expect(await store.resolve('TEST', 'TABL', 'ZTAB')).toEqual({ status: 'ambiguous' });
  });
  it('excludes package membership from coupling like PostgreSQL', async () => {
    const exec = vi.fn().mockResolvedValue([]);
    await new HanaGraphStore({}, { exec } as unknown as HanaSession).packageCoupling('TEST');
    expect(exec.mock.calls[0]![0]).toContain("E.RELATION_KIND <> 'belongs_to'");
  });
});
