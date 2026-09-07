import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'vitest';
import { inputs, packageCf } from '../../scripts/graph/package-cf.mjs';

test('CF artifact is allowlisted and refuses symlink escapes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'graph-cf-test-'));
  try {
    const src = join(dir, 'source'),
      out = join(dir, 'out');
    const paths = inputs.map((p) =>
      p === 'dist' ? 'dist/graph/server.js' : p.endsWith('migrations') ? `${p}/001_graph.sql` : p,
    );
    for (const p of [...paths, '.secrets/private.json', '.env', 'docs/source-report.json']) {
      mkdirSync(dirname(join(src, p)), { recursive: true });
      writeFileSync(join(src, p), '{}');
    }
    packageCf(src, out);
    assert.equal(existsSync(join(out, 'dist/graph/server.js')), true);
    for (const name of ['.env', '.secrets', 'docs']) assert.equal(existsSync(join(out, name)), false);
    symlinkSync(join(src, '.secrets'), join(src, 'dist/escape'));
    assert.throws(() => packageCf(src, out), /symlinks/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
