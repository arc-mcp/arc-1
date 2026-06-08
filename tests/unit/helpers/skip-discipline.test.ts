import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '../../..');
const SCAN_DIRS = ['tests/e2e', 'tests/integration', 'tests/helpers'];

function listTsFiles(dir: string): string[] {
  const fullDir = join(REPO_ROOT, dir);
  const entries = readdirSync(fullDir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(fullDir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...listTsFiles(relative(REPO_ROOT, fullPath)));
    } else if (entry.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

function matchingFiles(pattern: RegExp, excludedFiles: string[] = []): string[] {
  return SCAN_DIRS.flatMap(listTsFiles)
    .map((file) => relative(REPO_ROOT, file))
    .filter((file) => !excludedFiles.includes(file))
    .filter((file) => pattern.test(readFileSync(join(REPO_ROOT, file), 'utf8')))
    .sort();
}

describe('integration and e2e skip discipline', () => {
  it('does not use console [SKIP] pseudo-skip markers', () => {
    expect(matchingFiles(/\[SKIP\]/)).toEqual([]);
  });

  it('does not reintroduce the obsolete skipIf helper', () => {
    expect(matchingFiles(/\bskipIf\b/)).toEqual([]);
  });

  it('always passes explicit reason text to ctx.skip', () => {
    expect(matchingFiles(/\bctx\.skip\(\s*\)/, ['tests/helpers/skip-policy.ts'])).toEqual([]);
  });

  it('routes runtime skips through telemetry helpers', () => {
    expect(matchingFiles(/\bctx\.skip\(/, ['tests/helpers/skip-policy.ts'])).toEqual([]);
  });

  it('does not use permanent test-level it.skip declarations', () => {
    expect(matchingFiles(/\bit\.skip\s*\(/)).toEqual([]);
  });
});
