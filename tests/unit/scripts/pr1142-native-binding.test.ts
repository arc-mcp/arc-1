import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { nativeLockBinding } from '../../../scripts/qualification/pr1142/native-lock-binding.js';

let root: string, revision: string, entry: URL, state: { parent: string; assertParent: () => Promise<void> };
const bound = (path: string) => pathToFileURL(join(root, 'scripts/qualification/pr1142', path));
function git(...args: string[]) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10_000 }).trim();
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'arc1-native-binding-'));
  state = { parent: mkdtempSync(join(tmpdir(), 'arc1-native-binding-state-')), assertParent: async () => {} };
  chmodSync(state.parent, 0o700);
  mkdirSync(join(root, 'scripts/qualification/pr1142'), { recursive: true });
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'package-lock.json'), '{}\n');
  writeFileSync(join(root, 'src/fixture.ts'), '// fixture\n');
  writeFileSync(join(root, 'scripts/qualification/pr1142/native-function-contract.ts'), '// bound fixture entry\n');
  writeFileSync(join(root, 'scripts/qualification/pr1142/native-declarative-v2.ts'), '// bound fixture entry\n');
  writeFileSync(join(root, 'scripts/qualification/pr1142/native-declarative-v3.ts'), '// bound fixture entry\n');
  writeFileSync(join(root, 'scripts/qualification/pr1142/native-declarative-v4.ts'), '// bound fixture entry\n');
  writeFileSync(join(root, 'scripts/qualification/pr1142/native-declarative-v5.ts'), '// bound fixture entry\n');
  writeFileSync(join(root, 'scripts/qualification/pr1142/native-package.ts'), '// bound fixture entry\n');
  writeFileSync(join(root, 'scripts/qualification/pr1142/native-v5-retained.ts'), '// bound fixture entry\n');
  writeFileSync(join(root, 'scripts/qualification/pr1142/native-rap-retained-v3-entry.ts'), '// bound fixture entry\n');
  writeFileSync(
    join(root, 'scripts/qualification/pr1142/native-rap-retained-v4-entry.ts'),
    readFileSync(new URL('../../../scripts/qualification/pr1142/native-rap-retained-v4-entry.ts', import.meta.url)),
  );
  writeFileSync(
    join(root, 'scripts/qualification/pr1142/native-declarative-v3-recovery.ts'),
    '// bound fixture entry\n',
  );
  writeFileSync(join(root, 'scripts/qualification/pr1142/native-declarative-contract.ts'), '// bound fixture entry\n');
  writeFileSync(join(root, 'scripts/qualification/pr1142/native-declarative-preflight.ts'), '// bound fixture entry\n');
  writeFileSync(join(root, 'scripts/qualification/pr1142/native-declarative-driver.ts'), '// not an entry\n');
  writeFileSync(join(root, 'scripts/qualification/pr1142/helper.mjs'), '// fixture helper\n');
  writeFileSync(join(root, '.gitignore'), 'src/*.js\nscripts/qualification/pr1142/*.mts\n');
  writeFileSync(
    join(root, 'scripts/qualification/pr1142/native-cts-retained-v4.ts'),
    readFileSync(new URL('../../../scripts/qualification/pr1142/native-cts-retained-v4.ts', import.meta.url)),
  );
  writeFileSync(
    join(root, 'scripts/qualification/pr1142/native-cts-retained-v3.ts'),
    readFileSync(new URL('../../../scripts/qualification/pr1142/native-cts-retained-v3.ts', import.meta.url)),
  );
  writeFileSync(
    join(root, 'scripts/qualification/pr1142/native-cts-retained-v5.ts'),
    readFileSync(new URL('../../../scripts/qualification/pr1142/native-cts-retained-v5.ts', import.meta.url)),
  );
  writeFileSync(
    join(root, 'scripts/qualification/pr1142/native-cts-retained-v6.ts'),
    readFileSync(new URL('../../../scripts/qualification/pr1142/native-cts-retained-v6.ts', import.meta.url)),
  );
  git('init', '--quiet');
  git('add', '.');
  git(
    '-c',
    'user.name=Native binding fixture',
    '-c',
    'user.email=fixture@example.test',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '--quiet',
    '-m',
    'test: fixture',
  );
  revision = git('rev-parse', 'HEAD');
  entry = pathToFileURL(join(root, 'scripts/qualification/pr1142/native-function-contract.ts'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(state.parent, { recursive: true, force: true });
});
it('accepts the committed actual entry and binds its hash, lockfile, runtime and fixed experiment', async () => {
  const binding = await nativeLockBinding(revision, entry, state);
  expect(binding.root).toBe(join(state.parent, 'pr1142-active-function-delete-v1'));
  expect(binding.evidence).toMatchObject({
    revision,
    node: process.version,
    entryHash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(() => binding.verifySource()).not.toThrow();
});
it.each([
  ['native-declarative-v2.ts', 'pr1142-native-declarative-v2'],
  ['native-declarative-v3.ts', 'pr1142-native-declarative-v3'],
  ['native-declarative-v4.ts', 'pr1142-native-declarative-v4'],
  ['native-declarative-v5.ts', 'pr1142-native-declarative-v5'],
  ['native-package.ts', 'pr1142-native-local-package-v1'],
  ['native-v5-retained.ts', 'pr1142-native-declarative-v5-retained-v2'],
  ['native-rap-retained-v3-entry.ts', 'pr1142-native-rap-documents-retained-v3'],
  ['native-rap-retained-v4-entry.ts', 'pr1142-native-rap-documents-retained-v4'],
  ['native-cts-retained-v3.ts', 'pr1142-native-cts-retained-v3'],
  ['native-cts-retained-v5.ts', 'pr1142-native-cts-retained-v5'],
  ['native-cts-retained-v6.ts', 'pr1142-native-cts-retained-v6'],
  ['native-cts-retained-v4.ts', 'pr1142-native-cts-retained-v4'],
  ['native-declarative-v3-recovery.ts', 'pr1142-native-declarative-v3-recovery-v1'],
  ['native-declarative-contract.ts', 'pr1142-native-declarative-v1'],
  ['native-declarative-preflight.ts', 'pr1142-native-declarative-absence-preflight'],
])('binds %s to its own fixed state, separate from every consumed claim', async (path, experiment) => {
  const binding = await nativeLockBinding(revision, bound(path), state);
  expect(binding.root).toBe(join(state.parent, experiment));
  expect(() => binding.verifySource()).not.toThrow();
  // The fixture repository mirrors a real tracked entry, not a test-only name.
  expect(existsSync(new URL(`../../../scripts/qualification/pr1142/${path}`, import.meta.url))).toBe(true);
});
it('refuses a tracked qualification helper as an entry', async () => {
  await expect(nativeLockBinding(revision, bound('native-declarative-driver.ts'), state)).rejects.toThrow(
    'tracked native qualification entry',
  );
});
it.each([
  'native-declarative-contract.ts',
  'native-declarative-preflight.ts',
  'native-declarative-v2.ts',
  'native-declarative-v3.ts',
  'native-declarative-v4.ts',
  'native-declarative-v5.ts',
  'native-v5-retained.ts',
  'native-rap-retained-v3-entry.ts',
  'native-rap-retained-v4-entry.ts',
  'native-cts-retained-v3.ts',
])('refuses %s when its committed bytes changed', async (path) => {
  const binding = await nativeLockBinding(revision, bound(path), state);
  writeFileSync(join(root, 'scripts/qualification/pr1142', path), '// changed\n');
  expect(() => binding.verifySource()).toThrow('reviewed source and package lock');
});
it('checks a persistent state parent through the injected control', async () => {
  const assertParent = async () => {
    throw new Error('PERSISTENT_PRIVATE_STATE_REQUIRED');
  };
  await expect(nativeLockBinding(revision, entry, { ...state, assertParent })).rejects.toThrow(
    'PERSISTENT_PRIVATE_STATE_REQUIRED',
  );
});
it('rejects the wrong revision for the intended reason in a real isolated repository', async () => {
  await expect(nativeLockBinding('0'.repeat(40), entry, state)).rejects.toThrow('reviewed source and package lock');
});
it.each(['package-lock.json', 'scripts/qualification/pr1142/native-function-contract.ts'])(
  'refuses %s changing after the initial binding',
  async (path) => {
    const binding = await nativeLockBinding(revision, entry, state);
    writeFileSync(join(root, path), `${readFileSync(join(root, path), 'utf8')}\n`);
    expect(() => binding.verifySource()).toThrow('reviewed source and package lock');
  },
);
it.each(['--assume-unchanged', '--skip-worktree'])('refuses hidden index flags %s', async (flag) => {
  git('update-index', flag, 'src/fixture.ts');
  await expect(nativeLockBinding(revision, entry, state)).rejects.toThrow('reviewed source and package lock');
});
it.each(['src/fixture.js', 'scripts/qualification/pr1142/helper.mts'])(
  'refuses an ignored executable shadow %s',
  async (path) => {
    writeFileSync(join(root, path), '// shadow\n');
    await expect(nativeLockBinding(revision, entry, state)).rejects.toThrow('reviewed source and package lock');
  },
);

it('offline binding refuses a missing state parent without creating it or a claim', async () => {
  const missing = join(state.parent, 'missing');
  await expect(
    nativeLockBinding(revision, bound('native-declarative-v3.ts'), { ...state, parent: missing }, { readOnly: true }),
  ).rejects.toThrow();
  expect(existsSync(missing)).toBe(false);
});
it('offline binding checks an existing parent without a protocol directory or index writes', async () => {
  const index = readFileSync(join(root, '.git/index'));
  const binding = await nativeLockBinding(revision, bound('native-declarative-v3.ts'), state, { readOnly: true });
  binding.verifySource();
  expect(existsSync(binding.root)).toBe(false);
  expect(readFileSync(join(root, '.git/index'))).toEqual(index);
});

it('binds the real RAP v3 entry without creating a protocol claim', async () => {
  const index = readFileSync(join(root, '.git/index'));
  const binding = await nativeLockBinding(revision, bound('native-rap-retained-v3-entry.ts'), state, {
    readOnly: true,
  });
  expect(binding.root).toBe(join(state.parent, 'pr1142-native-rap-documents-retained-v3'));
  binding.verifySource();
  expect(existsSync(binding.root)).toBe(false);
  expect(readFileSync(join(root, '.git/index'))).toEqual(index);
});

it('binds actual V4 entry bytes in a real temporary Git repository without root, claim or index writes', async () => {
  const index = readFileSync(join(root, '.git/index'));
  const source = readFileSync(
    new URL('../../../scripts/qualification/pr1142/native-rap-retained-v4-entry.ts', import.meta.url),
  );
  const binding = await nativeLockBinding(revision, bound('native-rap-retained-v4-entry.ts'), state, {
    readOnly: true,
  });
  expect(binding.root).toBe(join(state.parent, 'pr1142-native-rap-documents-retained-v4'));
  expect(binding.evidence.entryHash).toBe(createHash('sha256').update(source).digest('hex'));
  binding.verifySource();
  expect(existsSync(binding.root)).toBe(false);
  expect(readFileSync(join(root, '.git/index'))).toEqual(index);
});

it('binds actual CTS v3 bytes read-only without creating a root/claim or changing the index', async () => {
  const index = readFileSync(join(root, '.git/index'));
  const source = readFileSync(
    new URL('../../../scripts/qualification/pr1142/native-cts-retained-v3.ts', import.meta.url),
  );
  const binding = await nativeLockBinding(revision, bound('native-cts-retained-v3.ts'), state, { readOnly: true });
  expect(binding.root).toBe(join(state.parent, 'pr1142-native-cts-retained-v3'));
  expect(binding.evidence.entryHash).toBe(createHash('sha256').update(source).digest('hex'));
  binding.verifySource();
  expect(existsSync(binding.root)).toBe(false);
  expect(readFileSync(join(root, '.git/index'))).toEqual(index);
});

it('binds actual CTS v4 bytes read-only and refuses later entry drift without root/claim/index writes', async () => {
  const index = readFileSync(join(root, '.git/index'));
  const source = readFileSync(
    new URL('../../../scripts/qualification/pr1142/native-cts-retained-v4.ts', import.meta.url),
  );
  const binding = await nativeLockBinding(revision, bound('native-cts-retained-v4.ts'), state, { readOnly: true });
  expect(binding.root).toBe(join(state.parent, 'pr1142-native-cts-retained-v4'));
  expect(binding.evidence.entryHash).toBe(createHash('sha256').update(source).digest('hex'));
  binding.verifySource();
  expect(existsSync(binding.root)).toBe(false);
  expect(readFileSync(join(root, '.git/index'))).toEqual(index);
  writeFileSync(bound('native-cts-retained-v4.ts'), Buffer.concat([source, Buffer.from('\n// changed')]));
  expect(() => binding.verifySource()).toThrow();
  expect(existsSync(binding.root)).toBe(false);
});

it('binds actual v6 entry read-only, checks late drift and never creates its root', async () => {
  const index = readFileSync(join(root, '.git/index'));
  const b = await nativeLockBinding(revision, bound('native-cts-retained-v6.ts'), state, { readOnly: true });
  expect(b.root).toBe(join(state.parent, 'pr1142-native-cts-retained-v6'));
  b.verifySource();
  expect(existsSync(b.root)).toBe(false);
  expect(readFileSync(join(root, '.git/index'))).toEqual(index);
  writeFileSync(bound('native-cts-retained-v6.ts'), 'changed');
  expect(() => b.verifySource()).toThrow();
  expect(existsSync(b.root)).toBe(false);
});
