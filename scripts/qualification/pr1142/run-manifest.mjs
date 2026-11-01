import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { durable } from './durable-journal.mjs';
import { sourceFor } from './fixture-contract.mjs';
import { configuration, validateConfiguration } from './qualification-config.mjs';
import { assertSafeDiagnosticEnvironment, HarnessError, outsideRepository, privateJson } from './safe-io.mjs';

const directory = fileURLToPath(new URL('./', import.meta.url));
const workspace = fileURLToPath(new URL('../../../', import.meta.url));
const digest = (value) => createHash('sha256').update(value).digest('hex');
export const verifierEntry = fileURLToPath(import.meta.resolve('@arc-mcp/xsuaa-auth'));
async function verifierFiles() {
  const directory = dirname(verifierEntry),
    files = {};
  for (const name of (await readdir(directory, { recursive: true })).filter((n) => n.endsWith('.js')).sort())
    files[name] = digest(await readFile(resolve(directory, name)));
  return files;
}
async function harnessFiles() {
  const files = {};
  for (const name of (await readdir(directory)).filter((n) => /\.(mjs|mts)$/.test(n)).sort())
    files[name] = digest(await readFile(resolve(directory, name)));
  return files;
}
export async function verifyRunManifest(root) {
  const run = await privateJson(`${root}/run-manifest.json`),
    files = await harnessFiles();
  if (run.harnessSha256 !== digest(JSON.stringify(files)) || JSON.stringify(run.harnessFiles) !== JSON.stringify(files))
    throw new HarnessError('HARNESS_CHANGED_SINCE_RUN_PREPARATION');
  const currentRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim();
  if (
    currentRevision !== run.sourceRevision ||
    digest(JSON.stringify(await verifierFiles())) !== run.authModulesSha256 ||
    digest(await readFile(resolve(workspace, 'package-lock.json'))) !== run.packageLockSha256
  )
    throw new HarnessError('SOURCE_OR_VERIFIER_CHANGED_SINCE_RUN_PREPARATION');
  try {
    execFileSync(
      'git',
      ['diff', '--quiet', 'HEAD', '--', 'src', 'tests/integration/helpers.ts', 'scripts/qualification/pr1142'],
      { cwd: workspace, stdio: 'ignore' },
    );
  } catch {
    throw new HarnessError('QUALIFICATION_SOURCE_MODIFIED');
  }
  return run;
}
export async function prepareRun() {
  assertSafeDiagnosticEnvironment();
  validateConfiguration(configuration);
  const { root, actors, target } = configuration;
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: workspace, encoding: 'utf8' });
  if (status.trim()) throw new HarnessError('COMMITTED_CLEAN_WORKTREE_REQUIRED');
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim();
  const files = await harnessFiles(),
    authModules = await verifierFiles();
  await mkdir(dirname(root), { recursive: true, mode: 0o700 });
  const parent = await realpath(dirname(root)),
    temporary = await realpath(tmpdir());
  if (!outsideRepository(parent) || parent === temporary || parent.startsWith(temporary + sep))
    throw new HarnessError('PERSISTENT_PRIVATE_STATE_REQUIRED');
  await mkdir(root, { mode: 0o700 }); // Exclusive run directory: never silently reuse a baseline.
  const stats = await lstat(root);
  if (stats.uid !== process.getuid() || (stats.mode & 0o077) !== 0 || !stats.isDirectory())
    throw new HarnessError('PRIVATE_RUN_DIRECTORY_REQUIRED');
  const run = {
    runId: randomUUID(),
    sourceRevision,
    harnessSha256: digest(JSON.stringify(files)),
    harnessFiles: files,
    preparedAt: new Date().toISOString(),
    authModules,
    authModulesSha256: digest(JSON.stringify(authModules)),
    packageLockSha256: digest(await readFile(resolve(workspace, 'package-lock.json'))),
    bindingLimit:
      'Source tree and local harness checks; deployed droplet/artifact must also be recorded out of band. The installed xsuaa-auth JavaScript closure is hashed; other third-party dependency bytes are not attested.',
  };
  await durable(`${root}/run-manifest.json`, run, true);
  const marker = randomBytes(16).toString('hex').toUpperCase();
  const fixtures = actors
    .filter((a) => a.write)
    .flatMap((a) =>
      ['CLAS', 'INTF'].map((type) => ({
        actor: a.label,
        type,
        name: `ZARC1_DPP_${a.letter}${type === 'CLAS' ? 'C' : 'I'}_${randomBytes(4).toString('hex').toUpperCase()}`,
      })),
    );
  for (const fixture of fixtures)
    for (const value of [1, 2, 3]) fixture[`source${value}`] = sourceFor(fixture, marker, value);
  await durable(
    `${root}/fixture-manifest.json`,
    { target, nativeUrl: 'https://a4h.marianzeis.de', client: '001', marker, fixtures },
    true,
  );
  console.log(
    JSON.stringify({
      runId: run.runId,
      sourceRevision,
      harnessSha256: run.harnessSha256,
      fixtures: fixtures.length,
      root,
    }),
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  prepareRun().catch((error) => {
    console.error(error instanceof HarnessError ? error.code : 'RUN_PREPARATION_FAILED');
    process.exitCode = 1;
  });
