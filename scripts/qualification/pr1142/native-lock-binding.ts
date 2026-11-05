/** Exact source binding and a fixed one-time experiment claim, before native credentials are loaded. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPersistentStateParent, assertWorkspaceRoot } from './run-manifest.mjs';
import { assertSafeDiagnosticEnvironment } from './safe-io.mjs';

export const PASSIVE_LOCK_EXPERIMENT = 'pr1142-passive-function-lock-v1';
export const fileHash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
export function privateDirectory(path: string) {
  const stat = lstatSync(path);
  const uid = process.getuid?.();
  if (uid === undefined || !stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid || stat.mode & 0o077)
    throw new Error('An owner-only regular directory is required.');
}
export function durableRecord(path: string, value: unknown) {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) throw new Error('A durable JSON value is required.');
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(fd, `${serialized}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const directory = openSync(dirname(path), 'r');
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}
export function claimDirectory(path: string) {
  mkdirSync(path, { mode: 0o700 });
  privateDirectory(path);
  const parent = openSync(dirname(path), 'r');
  try {
    fsyncSync(parent);
  } finally {
    closeSync(parent);
  }
}
export function journal(directory: string) {
  claimDirectory(directory); // Also claims this phase once, independently of process lifetime.
  let sequence = 0;
  return (value: unknown) =>
    durableRecord(join(directory, `${String(++sequence).padStart(5, '0')}.json`), {
      time: new Date().toISOString(),
      value,
    });
}
export async function nativeLockBinding(
  revision: string,
  entry: URL,
  // Injectable so tests never create the operator's private state directory.
  state: { parent: string; assertParent: (parent: string) => Promise<void> } = {
    parent: join(homedir(), '.local/state/arc1-qualification'),
    assertParent: assertPersistentStateParent,
  },
  options: { readOnly?: boolean } = {},
) {
  assertSafeDiagnosticEnvironment();
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('A full reviewed revision is required.');
  const entryPath = realpathSync(fileURLToPath(entry));
  const repo = realpathSync(fileURLToPath(new URL('../../../', entry)));
  await assertWorkspaceRoot(repo);
  const entryRelative = relative(repo, entryPath);
  const experiments: Record<string, string> = {
    'scripts/qualification/pr1142/native-lock-workflow.ts': PASSIVE_LOCK_EXPERIMENT,
    'scripts/qualification/pr1142/native-function-contract.ts': 'pr1142-active-function-delete-v1',
    'scripts/qualification/pr1142/native-procedural.ts': 'pr1142-native-procedural-text-v1',
    'scripts/qualification/pr1142/native-procedural-retained.ts': 'pr1142-native-procedural-retained-v1',
    'scripts/qualification/pr1142/native-procedural-tail.ts': 'pr1142-native-procedural-tail-v1',
    'scripts/qualification/pr1142/native-procedural-group-cleanup.ts': 'pr1142-native-procedural-group-cleanup-v1',
    'scripts/qualification/pr1142/native-declarative-v2.ts': 'pr1142-native-declarative-v2',
    'scripts/qualification/pr1142/native-declarative-v3.ts': 'pr1142-native-declarative-v3',
    'scripts/qualification/pr1142/native-ddic-collections.ts': 'pr1142-native-ddic-collections-v1',
    'scripts/qualification/pr1142/native-ddic-collections-v2.ts': 'pr1142-native-ddic-collections-v2',
    'scripts/qualification/pr1142/native-ddic-collections-retained.ts': 'pr1142-native-ddic-collections-retained-v1',
    'scripts/qualification/pr1142/native-ddic-collections-removal.ts': 'pr1142-native-ddic-collections-removal-v1',
    'scripts/qualification/pr1142/native-ddic-table-graph.ts': 'pr1142-native-ddic-table-graph-v1',
    'scripts/qualification/pr1142/native-ddic-table-retained.ts': 'pr1142-native-ddic-table-retained-v1',
    'scripts/qualification/pr1142/native-ddic-table-settings.ts': 'pr1142-native-ddic-table-settings-tail-v1',
    'scripts/qualification/pr1142/native-ddic-table-index.ts': 'pr1142-native-ddic-table-index-tail-v1',

    'scripts/qualification/pr1142/native-rap-publication.ts': 'pr1142-native-rap-publication-v1',
    'scripts/qualification/pr1142/native-rap-retained-entry.ts': 'pr1142-native-rap-documents-retained-v1',
    'scripts/qualification/pr1142/native-rap-retained-v2-entry.ts': 'pr1142-native-rap-documents-retained-v2',
    'scripts/qualification/pr1142/native-rap-retained-v3-entry.ts': 'pr1142-native-rap-documents-retained-v3',
    'scripts/qualification/pr1142/native-rap-retained-v4-entry.ts': 'pr1142-native-rap-documents-retained-v4',
    'scripts/qualification/pr1142/native-rap-documents-entry.ts': 'pr1142-native-rap-documents-v1',
    'scripts/qualification/pr1142/native-enho-retained-entry.ts': 'pr1142-native-enhancement-owned-retained-v1',
    'scripts/qualification/pr1142/native-enho-entry.ts': 'pr1142-native-enhancement-owned-stub-v1',
    'scripts/qualification/pr1142/native-ddic-structure-cleanup.ts': 'pr1142-native-ddic-structure-cleanup-v1',
    'scripts/qualification/pr1142/native-ddic-foundation.ts': 'pr1142-native-ddic-foundation-v1',
    'scripts/qualification/pr1142/native-cts.ts': 'pr1142-native-cts-workflows-v1',
    'scripts/qualification/pr1142/native-cts-retained.ts': 'pr1142-native-cts-retained-v1',
    'scripts/qualification/pr1142/native-package-api-retained.ts': 'pr1142-native-package-api-retained-v1',
    'scripts/qualification/pr1142/native-package-api-moved.ts': 'pr1142-native-package-api-moved-v1',
    'scripts/qualification/pr1142/native-package-api.ts': 'pr1142-native-package-api-v1',
    'scripts/qualification/pr1142/native-cts-retained-v2.ts': 'pr1142-native-cts-retained-v2',
    'scripts/qualification/pr1142/native-cts-retained-v3.ts': 'pr1142-native-cts-retained-v3',
    'scripts/qualification/pr1142/native-cts-retained-v6.ts': 'pr1142-native-cts-retained-v6',
    'scripts/qualification/pr1142/native-cts-retained-v5.ts': 'pr1142-native-cts-retained-v5',
    'scripts/qualification/pr1142/native-cts-retained-v4.ts': 'pr1142-native-cts-retained-v4',
    'scripts/qualification/pr1142/native-package.ts': 'pr1142-native-local-package-v1',
    'scripts/qualification/pr1142/native-package-recovery.ts': 'pr1142-native-local-package-recovery-v1',
    'scripts/qualification/pr1142/native-declarative-v4.ts': 'pr1142-native-declarative-v4',
    'scripts/qualification/pr1142/native-flp-cust.ts': 'pr1142-native-flp-cust-v1',
    'scripts/qualification/pr1142/native-runtime-slice.ts': 'pr1142-native-runtime-flp-v1',
    'scripts/qualification/pr1142/native-runtime-retained.ts': 'pr1142-native-runtime-flp-retained-v1',
    'scripts/qualification/pr1142/native-runtime-retained-v2.ts': 'pr1142-native-runtime-flp-retained-v2',
    'scripts/qualification/pr1142/native-runtime-st05.ts': 'pr1142-native-st05-retained-v1',

    'scripts/qualification/pr1142/native-declarative-v5.ts': 'pr1142-native-declarative-v5',
    'scripts/qualification/pr1142/native-v5-retained.ts': 'pr1142-native-declarative-v5-retained-v2',
    'scripts/qualification/pr1142/native-declarative-v4-recovery.ts': 'pr1142-native-declarative-v4-recovery-v1',
    'scripts/qualification/pr1142/native-declarative-v3-recovery.ts': 'pr1142-native-declarative-v3-recovery-v1',
    'scripts/qualification/pr1142/native-declarative-contract.ts': 'pr1142-native-declarative-v1',
    'scripts/qualification/pr1142/native-declarative-preflight.ts': 'pr1142-native-declarative-absence-preflight',
    'scripts/qualification/pr1142/native-declarative-recovery.ts': 'pr1142-native-declarative-recovery-v1',
  };
  const experiment = experiments[entryRelative];
  if (!experiment) throw new Error('The actual loaded entry must be a tracked native qualification entry.');
  const git = (args: string[]) =>
    execFileSync('git', options.readOnly ? ['--no-optional-locks', ...args] : args, {
      cwd: repo,
      encoding: 'utf8',
      timeout: 10_000,
    }).trim();
  const entryHash = fileHash(entryPath);
  const packageLockHash = fileHash(join(repo, 'package-lock.json'));
  const sourceFiles = git(['ls-files', 'src', 'scripts/qualification/pr1142'])
    .split('\n')
    .filter((path) => /\.(?:ts|mts|mjs)$/.test(path));
  const verifySource = () => {
    if (
      git(['rev-parse', 'HEAD']) !== revision ||
      git(['status', '--porcelain']) ||
      git(['status', '--porcelain', '--ignored=matching', '--', 'src', 'scripts/qualification/pr1142']) ||
      git(['ls-files', '-v'])
        .split('\n')
        .some((row) => !row.startsWith('H ')) ||
      fileHash(entryPath) !== entryHash ||
      fileHash(join(repo, 'package-lock.json')) !== packageLockHash
    )
      throw new Error('The reviewed source and package lock must remain unchanged in the clean checkout.');
    const committed = execFileSync('git', ['show', `${revision}:${entryRelative}`], { cwd: repo, timeout: 10_000 });
    if (createHash('sha256').update(committed).digest('hex') !== entryHash)
      throw new Error('The loaded entry does not match the reviewed commit.');
    for (const path of sourceFiles)
      if (
        existsSync(
          join(
            repo,
            path.replace(/\.(ts|mts|mjs)$/, (_, ext) => (ext === 'mts' ? '.mjs' : ext === 'mjs' ? '.mts' : '.js')),
          ),
        )
      )
        throw new Error('A JavaScript sibling could shadow reviewed TypeScript source.');
  };
  verifySource();
  if (!options.readOnly) mkdirSync(state.parent, { recursive: true, mode: 0o700 });
  privateDirectory(state.parent);
  await state.assertParent(state.parent);
  return {
    repo,
    root: join(state.parent, experiment),
    verifySource,
    evidence: {
      revision,
      entryHash,
      packageLockHash,
      node: process.version,
      repo,
      dependencyLimit: 'Package lock recorded; installed third-party dependency bytes are not attested.',
    },
  };
}
