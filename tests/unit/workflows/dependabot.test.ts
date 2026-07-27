import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type DependabotUpdate = {
  'package-ecosystem'?: string;
  directory?: string;
};

type DependabotConfig = {
  updates?: DependabotUpdate[];
};

describe('Dependabot configuration', () => {
  it('monitors both independent npm lockfiles', () => {
    const source = readFileSync(join(import.meta.dirname, '../../../.github/dependabot.yml'), 'utf8');
    const config = parse(source) as DependabotConfig;
    const npmDirectories = (config.updates ?? [])
      .filter((update) => update['package-ecosystem'] === 'npm')
      .map((update) => update.directory);

    expect(npmDirectories).toEqual(expect.arrayContaining(['/', '/btp/approuter']));
  });
});
