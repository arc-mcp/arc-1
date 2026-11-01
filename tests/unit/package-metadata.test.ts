import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type PackageJson = {
  name: string;
  bin?: Record<string, string>;
  scripts?: Record<string, string>;
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as PackageJson;

describe('package metadata', () => {
  it('exposes a bin matching the package name for npx package execution', () => {
    expect(packageJson.name).toBe('arc-1');
    expect(packageJson.bin?.[packageJson.name]).toBe('./bin/arc1.js');
  });

  it('keeps the explicit CLI binary aliases', () => {
    expect(packageJson.bin?.arc1).toBe('./bin/arc1.js');
    expect(packageJson.bin?.['arc1-cli']).toBe('./bin/arc1-cli.js');
  });

  it.each([
    ['test:relations:smoke', 'npm run build && tsx scripts/smoke-live-relations.ts'],
    ['bench:context-parsing', 'tsx scripts/bench-context-parsing.ts'],
  ])('exposes the maintained validation command %s with lint coverage', (name, command) => {
    expect(packageJson.scripts?.[name]).toBe(command);
    const biome = JSON.parse(readFileSync(resolve(repoRoot, 'biome.json'), 'utf8'));
    expect(biome.files.includes).toContain(command.split(' ').at(-1));
  });
});
