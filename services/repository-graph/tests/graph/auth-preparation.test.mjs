import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { prepareGraphAuth } from '../../scripts/graph/prepare-graph-auth.mjs';

test('generates matching private auth/connection without replacing an existing installation', () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'graph-auth-test-'));
  const output = join(root, 'credentials');
  const settings = {
    url: 'https://graph.example.test',
    systemKey: 'TEST-001',
    audience: 'test',
    sharing: 'shared-repository-metadata',
  };
  try {
    prepareGraphAuth(settings, output);
    const read = (name) => JSON.parse(readFileSync(join(output, name), 'utf8'));
    assert.equal(read('api-auth.json').apiKey, read('connection.json').apiKey);
    assert.match(read('api-auth.json').apiKey, /^[a-f0-9]{64}$/);
    if (process.platform !== 'win32') assert.equal(statSync(join(output, 'connection.json')).mode & 0o777, 0o600);
    assert.throws(() => prepareGraphAuth(settings, output));
    assert.throws(() => prepareGraphAuth({ ...settings, sharing: '' }, join(root, 'other')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
