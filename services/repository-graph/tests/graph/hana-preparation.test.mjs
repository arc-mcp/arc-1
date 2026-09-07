import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { prepareHanaFree } from '../../scripts/graph/prepare-hana-free.mjs';

it('prepares only a fixed free-size, CF-only configuration with private non-overwriting credentials', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hana-free-')));
  try {
    const directory = join(root, 'private');
    const path = prepareHanaFree(directory);
    const data = JSON.parse(readFileSync(path, 'utf8')).data;
    expect(data.memory).toBe(16);
    expect(data.whitelistIPs).toEqual([]);
    expect(data.systempassword.length).toBeGreaterThan(32);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(() => prepareHanaFree(directory)).toThrow();
    symlinkSync(directory, join(root, 'link'));
    expect(() => prepareHanaFree(join(root, 'link', 'child'))).toThrow('symlink');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
