import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const START_SCRIPT = join(ROOT, 'bin/start-cf.sh');
const tempDirectories: string[] = [];

function fakeNodePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'arc1-cf-start-'));
  tempDirectories.push(directory);
  const node = join(directory, 'node');
  writeFileSync(node, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
  chmodSync(node, 0o755);
  return directory;
}

function run(env: Record<string, string | undefined>) {
  return spawnSync(START_SCRIPT, [], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { PATH: fakeNodePath(), ...env },
  });
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Cloud Foundry launcher', () => {
  it('computes the adaptive old-space flag and execs Node directly', () => {
    const result = run({ OPTIMIZE_MEMORY: 'true', MEMORY_AVAILABLE: '512' });

    expect(result.status).toBe(0);
    expect(result.stdout.trim().split('\n')).toEqual(['--max-old-space-size=384', 'dist/index.js']);
  });

  it('fails closed when optimized startup has no trustworthy memory value', () => {
    for (const value of [undefined, '', '0', '512M', '-1', '999999999999999999999999']) {
      const result = run({ OPTIMIZE_MEMORY: 'true', MEMORY_AVAILABLE: value });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('startup refused');
    }
  });

  it('execs Node without a heap override when optimization is disabled', () => {
    const result = run({ OPTIMIZE_MEMORY: 'false', MEMORY_AVAILABLE: undefined });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('dist/index.js');
  });
});
