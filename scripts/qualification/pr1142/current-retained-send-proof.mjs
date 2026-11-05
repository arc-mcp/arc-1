import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { retainedProfileForRoot } from './current-retained-profiles.mjs';
import { requireEvidence, sha } from './current-workflow-contract.mjs';
import { verifierEntry } from './run-manifest.mjs';

const directory = fileURLToPath(new URL('./', import.meta.url));
const workspace = fileURLToPath(new URL('../../../', import.meta.url));
const json = (path) => {
  const info = lstatSync(path);
  requireEvidence(
    info.isFile() &&
      !info.isSymbolicLink() &&
      info.uid === process.getuid() &&
      (info.mode & 0o077) === 0 &&
      info.size <= 1024 * 1024,
    'RETAINED_PRIVATE_INPUT_CHANGED',
  );
  return JSON.parse(readFileSync(path, 'utf8'));
};
const hashes = (path, recursive, pattern) =>
  Object.fromEntries(
    readdirSync(path, { recursive })
      .filter((name) => pattern.test(name))
      .sort()
      .map((name) => [name, sha(readFileSync(resolve(path, name)))]),
  );

/** Synchronous final-dispatch proof. The caller checks stop/deadline/freshness AFTER this work. */
export function verifyRetainedSend({ root, run, manifest, baseline, config }) {
  const profile = retainedProfileForRoot(root);
  requireEvidence(profile, 'RETAINED_FIXED_ROOT_REQUIRED');
  const current = json(`${root}/run-manifest.json`);
  requireEvidence(
    ['runId', 'sourceRevision', 'harnessSha256'].every((key) => current[key] === run[key]),
    'RETAINED_RUN_CHANGED',
  );
  const git = (args) => execFileSync('git', args, { cwd: workspace, encoding: 'utf8', timeout: 10000 }).trim();
  requireEvidence(
    realpathSync(git(['rev-parse', '--show-toplevel'])) === realpathSync(workspace) &&
      git(['rev-parse', 'HEAD']) === run.sourceRevision,
    'RETAINED_SOURCE_CHANGED',
  );
  execFileSync(
    'git',
    ['diff', '--quiet', 'HEAD', '--', 'src', 'tests/integration/helpers.ts', 'scripts/qualification/pr1142'],
    { cwd: workspace, stdio: 'ignore', timeout: 10000 },
  );
  requireEvidence(
    sha(hashes(directory, false, /\.(mjs|mts)$/)) === run.harnessSha256 &&
      sha(hashes(dirname(verifierEntry), true, /\.js$/)) === run.authModulesSha256 &&
      sha(readFileSync(resolve(workspace, 'package-lock.json'))) === run.packageLockSha256 &&
      sha(json(`${root}/fixture-manifest.json`)) === sha(manifest) &&
      sha(json(`${root}/deployment-receipt.json`)) === manifest.bindings.deployment.receiptSha256 &&
      sha(json(`${root}/current-baseline.json`)) === baseline.sha256,
    'RETAINED_SOURCE_OR_INPUT_CHANGED',
  );
  for (const row of baseline.receipt.images) {
    requireEvidence(
      ['sm12-suffix.jpg', 'sm12-writerA.jpg', 'sm12-writerB.jpg'].includes(row.file),
      'RETAINED_CONTROL_PATH_REFUSED',
    );
    const path = `${root}/${row.file}`,
      info = lstatSync(path);
    requireEvidence(
      info.isFile() &&
        !info.isSymbolicLink() &&
        info.uid === process.getuid() &&
        (info.mode & 0o077) === 0 &&
        info.size >= 4 &&
        info.size <= 4 * 1024 * 1024 &&
        sha(readFileSync(path)) === row.sha256,
      'RETAINED_CONTROL_CHANGED',
    );
  }
  profile.assertContext(profile.readHistory(), current, manifest, config);
}
