import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';

test('independently packaged v2 schema stays synchronized with the core contract', () => {
  const read = (path) =>
    readFileSync(new URL(path, import.meta.url), 'utf8')
      .replace(/^\s*\/\/.*$/gm, '')
      .trim();
  assert.equal(read('../../src/graph/contract-v2.ts'), read('../../../../src/repository-graph/contract.ts'));
});
