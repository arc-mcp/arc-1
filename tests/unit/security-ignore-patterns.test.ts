import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function ignoredPatterns(fileName: string): string[] {
  return readFileSync(resolve(repoRoot, fileName), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

describe('security ignore patterns', () => {
  it('excludes service-key JSON files from git, docker, and Cloud Foundry packages', () => {
    for (const fileName of ['.gitignore', '.dockerignore', '.cfignore']) {
      expect(ignoredPatterns(fileName)).toContain('*service-key*.json');
    }

    expect(ignoredPatterns('.dockerignore')).toContain('**/*service-key*.json');
  });
});
