import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { transformSync } from 'esbuild';

// Requiring better-sqlite3 alone does not load its native addon.
const db = new Database(':memory:');
try {
  assert.deepEqual(db.prepare('SELECT 1 AS ok').get(), { ok: 1 });
} finally {
  db.close();
}

// With install hooks disabled, esbuild must find its optional platform package.
const result = transformSync('const value: number = 1;', { loader: 'ts' });
assert.match(result.code, /const value = 1/);
console.log('Dependency runtime smoke passed: SQLite native addon and esbuild platform binary.');
