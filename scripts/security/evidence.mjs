#!/usr/bin/env node
// Lockfile evidence only. Never installs dependencies or reads CF credentials.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { formatSummary } from './summary.mjs';

const scopes = [
  { id: 'root', path: '.' },
  { id: 'approuter', path: 'btp/approuter' },
];

class EvidenceInputError extends Error {}

export function runCommand(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
}

export function hashFile(path) {
  if (!lstatSync(path).isFile()) throw new EvidenceInputError('Evidence inputs must be regular files, not symlinks.');
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  const fd = openSync(path, 'r');
  try {
    let count;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
    return `sha256:${hash.digest('hex')}`;
  } finally {
    closeSync(fd);
  }
}

function inputHashes(root) {
  const paths = [
    'package.json',
    'package-lock.json',
    'btp/approuter/package.json',
    'btp/approuter/package-lock.json',
    'btp/approuter/.npmrc',
    'mta.yaml',
  ];
  const collect = (path) => {
    if (!existsSync(join(root, path))) return;
    if (lstatSync(join(root, path)).isDirectory()) {
      for (const entry of readdirSync(join(root, path)).sort()) collect(`${path}/${entry}`);
    } else paths.push(path);
  };
  // Local AppRouter bridges are build inputs even though their code is not in a registry.
  collect('btp/approuter/vendor');
  return Object.fromEntries(paths.sort().map((path) => [path, hashFile(join(root, path))]));
}

function readSource(root, run, generatedFiles = []) {
  const commit = run('git', ['rev-parse', 'HEAD'], root);
  // Exclude only files this run created, never the whole output directory: other
  // changes must still make --require-clean fail, including unexpected output files.
  const status = run(
    'git',
    [
      'status',
      '--porcelain',
      '--untracked-files=all',
      '--',
      '.',
      ...generatedFiles.map((path) => `:(exclude,literal)${path}`),
    ],
    root,
  );
  if (commit.status !== 0 || status.status !== 0 || !/^[a-f0-9]{40,64}$/.test(commit.stdout.trim())) {
    throw new EvidenceInputError('Cannot identify the Git source revision and working-tree state.');
  }
  return { commit: commit.stdout.trim(), dirty: status.stdout.trim().length > 0 };
}

function parseResult(result, valid) {
  if (result.error || result.signal || ![0, 1].includes(result.status))
    throw new Error('Command unavailable or failed.');
  let data;
  try {
    data = JSON.parse(result.stdout);
  } catch {
    throw new Error('Command did not return valid JSON.');
  }
  if (!valid(data, result.status)) throw new Error('Command returned incomplete or mismatched evidence.');
  return data;
}

export function validateAudit(data, status) {
  const counts = data?.metadata?.vulnerabilities;
  return (
    data?.auditReportVersion === 2 &&
    !data.error &&
    data.vulnerabilities &&
    typeof data.vulnerabilities === 'object' &&
    !Array.isArray(data.vulnerabilities) &&
    ['info', 'low', 'moderate', 'high', 'critical', 'total'].every(
      (key) => Number.isInteger(counts?.[key]) && counts[key] >= 0,
    ) &&
    counts.total === counts.info + counts.low + counts.moderate + counts.high + counts.critical &&
    (status === 0 || counts.high + counts.critical > 0)
  );
}

export function validateSbom(bom, status, manifest) {
  // npm can use the checkout directory as the display name (e.g. "approuter").
  // Its package URL carries the manifest identity; do not rewrite the generated BOM.
  return (
    status === 0 &&
    bom?.bomFormat === 'CycloneDX' &&
    bom.specVersion === '1.5' &&
    bom.metadata?.component?.purl === `pkg:npm/${manifest.name}@${manifest.version}` &&
    bom.metadata?.component?.version === manifest.version &&
    Array.isArray(bom.components) &&
    bom.components.length > 0 &&
    Array.isArray(bom.dependencies) &&
    bom.dependencies.length > 0
  );
}

/**
 * @param {{root?: string, out?: string, mtar?: string, requireClean?: boolean,
 * run?: (command: string, args: string[], cwd: string) => {status: number | null, stdout: string, error?: unknown, signal?: string | null}}} options
 */
export function generateEvidence({ root = process.cwd(), out, mtar, requireClean = false, run = runCommand } = {}) {
  for (const [name, value] of Object.entries({ out, mtar })) {
    if (value !== undefined && !value.trim()) throw new EvidenceInputError(`--${name} requires a non-empty path.`);
  }
  root = realpathSync(root);
  const source = readSource(root, run);
  if (requireClean && source.dirty)
    throw new EvidenceInputError('A clean source checkout is required. Commit or remove local changes first.');
  const inputs = inputHashes(root);
  const npm = run('npm', ['--version'], root);
  if (npm.status !== 0 || !/^\d+\.\d+\.\d+$/.test(npm.stdout.trim()))
    throw new EvidenceInputError('Cannot identify the npm version.');
  const startedAt = new Date().toISOString();
  const directory = resolve(out ?? join(root, 'reports/security', startedAt.replaceAll(':', '-')));
  if (existsSync(directory))
    throw new EvidenceInputError(
      'Output directory already exists; choose a new directory to preserve earlier evidence.',
    );
  // Validate the optional artifact before creating output. Its build/source relationship is unverified.
  const artifact =
    mtar !== undefined
      ? {
          name: basename(mtar),
          sha256: hashFile(resolve(mtar)),
          size: lstatSync(resolve(mtar)).size,
          sourceRelationship: 'not-verified',
        }
      : null;
  mkdirSync(dirname(directory), { recursive: true });
  mkdirSync(directory);
  const evidence = {
    schemaVersion: 1,
    startedAt,
    source,
    tools: { node: process.version, npm: npm.stdout.trim() },
    inputs,
    mtar: artifact,
    coverage: 'source-lockfiles-only',
    staging: 'not-collected',
    auditDatabaseVersion: 'not-exposed-by-npm',
    complete: false,
    inputsUnchanged: false,
    finishedAt: '',
    highOrCritical: 0,
    checks:
      /** @type {Array<{scope: string, kind: string, status: string, file?: string, error?: string, components?: number, vulnerabilities?: Record<string, number>}>} */ ([]),
    files: /** @type {Record<string, string>} */ ({}),
  };
  const save = (name, data) => {
    const path = join(directory, name);
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
    evidence.files[name] = hashFile(path);
  };
  for (const scope of scopes) {
    const cwd = join(root, scope.path);
    const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    const lock = JSON.parse(readFileSync(join(cwd, 'package-lock.json'), 'utf8'));
    const declarationsMatch = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].every(
      (field) =>
        JSON.stringify(Object.entries(manifest[field] ?? {}).sort()) ===
        JSON.stringify(Object.entries(lock.packages?.['']?.[field] ?? {}).sort()),
    );
    const matches =
      lock.lockfileVersion >= 2 &&
      lock.packages?.['']?.name === manifest.name &&
      lock.packages?.['']?.version === manifest.version &&
      declarationsMatch;
    for (const kind of ['full', 'production', 'audit']) {
      const check = { scope: scope.id, kind, status: 'unavailable' };
      evidence.checks.push(check);
      try {
        if (!matches)
          throw new Error('Package and lockfile identity, version or dependency declarations do not match.');
        const common = ['--package-lock-only', '--ignore-scripts', '--include=optional', '--include=peer'];
        const args =
          kind === 'audit'
            ? ['audit', ...common, '--include=dev', '--audit-level=high', '--json']
            : [
                'sbom',
                ...common,
                kind === 'production' ? '--omit=dev' : '--include=dev',
                '--sbom-format=cyclonedx',
                '--sbom-type=application',
              ];
        const result = run('npm', args, cwd);
        const data = parseResult(
          result,
          kind === 'audit' ? validateAudit : (bom, status) => validateSbom(bom, status, manifest),
        );
        check.file = `${scope.id}-${kind}.${kind === 'audit' ? 'json' : 'cdx.json'}`;
        save(check.file, data);
        check.status = 'complete';
        if (kind === 'audit') {
          check.vulnerabilities = data.metadata.vulnerabilities;
          evidence.highOrCritical += check.vulnerabilities.high + check.vulnerabilities.critical;
        } else check.components = data.components.length;
      } catch (error) {
        // Only our fixed diagnostic messages, never command stderr (which may contain credentials).
        check.error =
          error instanceof Error && /^(Command |Package and lockfile)/.test(error.message)
            ? error.message
            : 'Evidence generation failed; inspect the input and tool locally.';
      }
    }
  }
  const finalSource = readSource(
    root,
    run,
    Object.keys(evidence.files).map((name) => join(realpathSync(directory), name)),
  );
  evidence.inputsUnchanged =
    JSON.stringify(inputs) === JSON.stringify(inputHashes(root)) && source.commit === finalSource.commit;
  evidence.source.dirty ||= finalSource.dirty;
  evidence.complete =
    evidence.inputsUnchanged &&
    evidence.checks.every((check) => check.status === 'complete') &&
    (!requireClean || !evidence.source.dirty);
  evidence.finishedAt = new Date().toISOString();
  writeFileSync(join(directory, 'summary.md'), formatSummary(evidence), { flag: 'wx' });
  evidence.files['summary.md'] = hashFile(join(directory, 'summary.md'));
  writeFileSync(join(directory, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
  return { evidence, directory };
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    const { values } = parseArgs({
      options: {
        out: { type: 'string' },
        mtar: { type: 'string' },
        'require-clean': { type: 'boolean' },
        'fail-on-high': { type: 'boolean' },
        help: { type: 'boolean' },
      },
    });
    if (values.help) {
      console.log(
        'Usage: npm run security:evidence -- [--out NEW_DIRECTORY] [--mtar FILE] [--require-clean] [--fail-on-high]',
      );
    } else {
      const { evidence, directory } = generateEvidence({
        out: values.out,
        mtar: values.mtar,
        requireClean: values['require-clean'],
      });
      console.log(`Evidence: ${join(directory, 'summary.md')}`);
      console.log(`Complete: ${evidence.complete}; high/critical findings across graphs: ${evidence.highOrCritical}`);
      process.exitCode = !evidence.complete ? 2 : values['fail-on-high'] && evidence.highOrCritical > 0 ? 1 : 0;
    }
  } catch (error) {
    console.error(
      error instanceof EvidenceInputError
        ? error.message
        : 'Could not generate evidence. Check Git state, input files, npm availability and that the output directory is new.',
    );
    process.exitCode = 2;
  }
}
