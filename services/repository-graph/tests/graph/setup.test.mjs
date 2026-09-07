import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { setupLocal } from '../../scripts/graph/setup-local.mjs';

test('offline setup needs no SAP secret and preserves operator configuration/keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arc-graph-setup-'));
  try {
    const env = { ARC_GRAPH_SECRET_DIR: dir, ARC_GRAPH_HOST_PORT: '8092', ARC_GRAPH_API_SYSTEM_KEY: 'TRIAL-2023-001' };
    const result = setupLocal(env);
    const descriptor = readFileSync(result.descriptor, 'utf8');
    const key = readFileSync(join(dir, 'graph_api_key'), 'utf8');
    assert.equal(JSON.parse(descriptor).url, 'http://127.0.0.1:8092');
    assert.equal(key.length, 64);
    assert.equal(statSync(result.descriptor).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, 'graph_api_key')).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, 'docker-mounts')).mode & 0o777, 0o700);
    assert.equal(statSync(join(dir, 'docker-mounts', 'graph_api_key')).mode & 0o777, 0o444);
    assert.equal(readFileSync(join(dir, 'docker-mounts', 'graph_api_key'), 'utf8'), key);
    assert.equal(existsSync(join(dir, 'destination-service-key.json')), false);
    setupLocal(env);
    assert.throws(() => setupLocal({ ...env, ARC_GRAPH_HOST_PORT: '8093' }), /Existing descriptor differs/);
    assert.equal(readFileSync(result.descriptor, 'utf8'), descriptor);
    assert.equal(readFileSync(join(dir, 'graph_api_key'), 'utf8'), key);
    assert.equal(descriptor.includes(key), false);
    assert.throws(() => setupLocal({ ...env, ARC_GRAPH_API_SYSTEM_KEY: '../bad' }), /Invalid/);
    const defaults = setupLocal({ ARC_GRAPH_SECRET_DIR: join(dir, 'defaults') });
    assert.equal(JSON.parse(readFileSync(defaults.descriptor, 'utf8')).systemKey, 'TRIAL-2023-001');
    const copied = join(dir, 'docker-mounts', 'graph_api_key');
    chmodSync(copied, 0o600);
    writeFileSync(copied, 'different-key');
    assert.throws(() => setupLocal(env), /Existing Docker secret differs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
