import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateEvidence, hashFile, validateAudit, validateSbom } from '../../../scripts/security/evidence.mjs';

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function audit(high = 0) {
  return {
    auditReportVersion: 2,
    vulnerabilities: high ? { example: { severity: 'high' } } : {},
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high, critical: 0, total: high } },
  };
}

function bom(name: string) {
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    metadata: { component: { name: 'checkout-directory', version: '1.2.0', purl: `pkg:npm/${name}@1.2.0` } },
    components: [{ name: 'example', version: '1.0.0' }],
    dependencies: [{ ref: 'example@1.0.0' }],
  };
}

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'arc1-evidence-')));
  temporary.push(root);
  mkdirSync(join(root, 'btp/approuter/vendor/bridge'), { recursive: true });
  for (const [path, name] of [
    ['.', 'arc-1'],
    ['btp/approuter', 'arc1-ui-approuter'],
  ]) {
    writeFileSync(join(root, path, 'package.json'), JSON.stringify({ name, version: '1.2.0' }));
    writeFileSync(
      join(root, path, 'package-lock.json'),
      JSON.stringify({ lockfileVersion: 3, packages: { '': { name, version: '1.2.0' } } }),
    );
  }
  writeFileSync(join(root, 'btp/approuter/.npmrc'), 'install-links=true\n');
  writeFileSync(join(root, 'btp/approuter/vendor/bridge/index.cjs'), 'module.exports = {};\n');
  writeFileSync(join(root, 'mta.yaml'), 'ID: example\n');
  const run = vi.fn((command: string, args: string[], cwd: string): { status: number | null; stdout: string } => {
    if (command === 'git') return { status: 0, stdout: args[0] === 'rev-parse' ? 'a'.repeat(40) : '' };
    if (args[0] === '--version') return { status: 0, stdout: '11.11.1' };
    return {
      status: 0,
      stdout: JSON.stringify(
        args[0] === 'audit' ? audit() : bom(cwd.endsWith('approuter') ? 'arc1-ui-approuter' : 'arc-1'),
      ),
    };
  });
  return { root, out: join(root, 'evidence'), run };
}

describe('dependency evidence', () => {
  it.each([
    { high: 0, fail: false, invalid: false, exit: 0, entry: 'direct' },
    { high: 0, fail: false, invalid: false, exit: 0, entry: 'file-symlink' },
    { high: 0, fail: false, invalid: false, exit: 0, entry: 'directory-symlink' },
    { high: 1, fail: false, invalid: false, exit: 0, entry: 'direct' },
    { high: 1, fail: true, invalid: false, exit: 1, entry: 'direct' },
    { high: 0, fail: true, invalid: true, exit: 2, entry: 'direct' },
  ])(
    'uses the documented CLI exit status with real subprocesses: $exit ($entry)',
    ({ high, fail, invalid, exit, entry }) => {
      const options = fixture();
      const bin = join(options.root, 'fake-tools');
      mkdirSync(bin);
      const scripts = {
        git: `#!/usr/bin/env node\nif (process.argv[2] === 'rev-parse') console.log('${'a'.repeat(40)}'); else if (process.argv[2] !== 'status') process.exit(44);`,
        npm: `#!/usr/bin/env node\nconst fs = require('node:fs');
        const args = process.argv.slice(2);
        if (args[0] === '--version') { console.log('11.11.1'); process.exit(0); }
        if (!['sbom', 'audit'].includes(args[0]) || !args.includes('--ignore-scripts') || !args.includes('--package-lock-only')) process.exit(44);
        if (args[0] === 'audit') { console.log(${JSON.stringify(invalid ? 'invalid output' : JSON.stringify(audit(high)))}); process.exit(${high ? 1 : 0}); }
        const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        const bom = ${JSON.stringify(bom('placeholder'))};
        bom.metadata.component.purl = 'pkg:npm/' + manifest.name + '@' + manifest.version;
        console.log(JSON.stringify(bom));`,
      };
      for (const [name, content] of Object.entries(scripts)) {
        writeFileSync(join(bin, name), content);
        chmodSync(join(bin, name), 0o755);
      }
      let script = resolve('scripts/security/evidence.mjs');
      if (entry === 'file-symlink') {
        const link = join(options.root, 'evidence-cli.mjs');
        symlinkSync(script, link);
        script = link;
      } else if (entry === 'directory-symlink') {
        const link = join(options.root, 'linked-checkout');
        symlinkSync(resolve('.'), link, 'dir');
        script = join(link, 'scripts/security/evidence.mjs');
      }
      const args = [script, '--out', options.out, '--require-clean', ...(fail ? ['--fail-on-high'] : [])];
      const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` };
      const result = spawnSync(process.execPath, args, { cwd: options.root, env, encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(exit);
      const saved = JSON.parse(readFileSync(join(options.out, 'evidence.json'), 'utf8'));
      expect(saved.complete).toBe(!invalid);
      expect(existsSync(join(options.root, 'node_modules'))).toBe(false);
      const repeat = spawnSync(process.execPath, args, { cwd: options.root, env, encoding: 'utf8' });
      expect(repeat.status).toBe(2);
      expect(repeat.stderr).toContain('Output directory already exists');
    },
  );

  it.each(['out', 'mtar'])('refuses an explicitly empty --%s path at the CLI boundary', (option) => {
    const options = fixture();
    const result = spawnSync(process.execPath, [resolve('scripts/security/evidence.mjs'), `--${option}`, ''], {
      cwd: options.root,
      encoding: 'utf8',
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`--${option} requires a non-empty path`);
    expect(existsSync(options.out)).toBe(false);
  });

  it.each(['none', 'untracked', 'tracked', 'unexpected-output'])(
    'keeps custom output and MBT artifacts out of Git dirtiness without hiding changes: %s',
    (change) => {
      const options = fixture();
      options.out = join(options.root, 'custom evidence [1]');
      writeFileSync(join(options.root, '.gitignore'), readFileSync('.gitignore'));
      writeFileSync(join(options.root, 'README.md'), 'original source');
      const git = (args: string[]) => spawnSync('git', args, { cwd: options.root, encoding: 'utf8' });
      expect(git(['init', '-q']).status).toBe(0);
      expect(git(['add', '.']).status).toBe(0);
      const commit = git([
        '-c',
        'user.name=Evidence test',
        '-c',
        'user.email=evidence@example.invalid',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '-qm',
        'fixture',
        '--no-verify',
      ]);
      expect(commit.status, commit.stderr).toBe(0);
      writeFileSync(join(options.root, 'Makefile_20260907.mta'), 'generated MBT artifact');
      const normal = options.run.getMockImplementation();
      options.run.mockImplementation((command, args, cwd) => {
        if (command === 'git') return git(args);
        if (args[0] === 'audit') {
          if (change === 'tracked') writeFileSync(join(options.root, 'README.md'), 'changed source');
          if (change === 'untracked') writeFileSync(join(options.root, 'new-source.ts'), 'changed source');
          if (change === 'unexpected-output') writeFileSync(join(options.out, 'unexpected.ts'), 'changed source');
        }
        return normal!(command, args, cwd);
      });
      const { evidence } = generateEvidence({ ...options, requireClean: true });
      expect(evidence.complete).toBe(change === 'none');
      expect(evidence.source.dirty).toBe(change !== 'none');
      expect(git(['status', '--porcelain']).stdout).toContain('custom evidence');
    },
  );

  it('lets real npm reject override drift even though overrides are absent from the lockfile root', () => {
    const options = fixture();
    const manifest = { name: 'arc-1', version: '1.2.0', dependencies: { parent: '1.0.0' } };
    writeFileSync(join(options.root, 'package.json'), JSON.stringify({ ...manifest, overrides: { child: '1.0.0' } }));
    writeFileSync(
      join(options.root, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': manifest,
          'node_modules/parent': { version: '1.0.0', dependencies: { child: '1.0.0' } },
          'node_modules/child': { version: '1.0.0' },
        },
      }),
    );
    const baseline = spawnSync('npm', ['sbom', '--package-lock-only', '--ignore-scripts', '--sbom-format=cyclonedx'], {
      cwd: options.root,
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(baseline.status, baseline.stderr).toBe(0);
    writeFileSync(join(options.root, 'package.json'), JSON.stringify({ ...manifest, overrides: { child: '2.0.0' } }));
    const normal = options.run.getMockImplementation();
    options.run.mockImplementation((command, args, cwd) => {
      if (command === 'npm' && args[0] === 'sbom' && cwd === options.root) {
        return spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 10_000 });
      }
      return normal!(command, args, cwd);
    });
    const { evidence } = generateEvidence(options);
    expect(evidence.complete).toBe(false);
    expect(
      evidence.checks.filter((check) => check.scope === 'root' && check.kind !== 'audit').map((check) => check.status),
    ).toEqual(['unavailable', 'unavailable']);
    expect(existsSync(join(options.root, 'node_modules'))).toBe(false);
    expect(existsSync(join(options.out, 'root-full.cdx.json'))).toBe(false);
  });

  it('rejects dependency declaration drift even when package name and version match', () => {
    const options = fixture();
    const path = join(options.root, 'package.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...manifest, dependencies: { added: '1.0.0' } }));
    expect(generateEvidence(options).evidence.complete).toBe(false);
  });

  it('collects both graphs and scopes without installation, preserves earlier evidence and hashes local bridges', () => {
    const options = fixture();
    const { evidence, directory } = generateEvidence(options);
    expect(evidence.complete).toBe(true);
    expect(evidence.checks).toHaveLength(6);
    expect(evidence.staging).toBe('not-collected');
    expect(evidence.inputs['btp/approuter/vendor/bridge/index.cjs']).toBe(
      hashFile(join(options.root, 'btp/approuter/vendor/bridge/index.cjs')),
    );
    for (const [name, digest] of Object.entries(evidence.files)) expect(hashFile(join(directory, name))).toBe(digest);
    const commands = options.run.mock.calls.filter(([command, args]) => command === 'npm' && args[0] !== '--version');
    for (const [, args] of commands) {
      expect(['sbom', 'audit']).toContain(args[0]);
      expect(args).toEqual(expect.arrayContaining(['--ignore-scripts', '--package-lock-only', '--include=optional']));
    }
    expect(commands.filter(([, args]) => args.includes('--omit=dev'))).toHaveLength(2);
    expect(commands.filter(([, args]) => args.includes('--include=dev'))).toHaveLength(4);
    expect(() => generateEvidence(options)).toThrow('already exists');
  });

  it('accepts npm directory display names only when the package URL and version match', () => {
    const manifest = { name: 'arc1-ui-approuter', version: '1.2.0' };
    expect(validateSbom(bom(manifest.name), 0, manifest)).toBe(true);
    expect(validateSbom(bom('different-package'), 0, manifest)).toBe(false);
    expect(validateSbom(bom(manifest.name), 1, manifest)).toBe(false);
    expect(validateSbom({ ...bom(manifest.name), specVersion: '1.99' }, 0, manifest)).toBe(false);
  });

  it('records high findings as completed scans requiring review, not tool errors or a clean result', () => {
    const options = fixture();
    const normal = options.run.getMockImplementation();
    options.run.mockImplementation((command, args, cwd) =>
      args[0] === 'audit' ? { status: 1, stdout: JSON.stringify(audit(2)) } : normal!(command, args, cwd),
    );
    const { evidence, directory } = generateEvidence(options);
    expect(evidence.complete).toBe(true);
    expect(evidence.highOrCritical).toBe(4);
    expect(readFileSync(join(directory, 'summary.md'), 'utf8')).toContain('REVIEW REQUIRED');
  });

  it.each([
    { status: 1, stdout: JSON.stringify({ error: { code: 'E401', summary: 'secret-do-not-copy' } }) },
    { status: 0, stdout: 'not JSON secret-do-not-copy' },
    { status: 0, stdout: JSON.stringify({ metadata: { vulnerabilities: {} } }) },
    { status: 2, stdout: JSON.stringify(audit()) },
  ])('fails closed on unavailable or malformed audit output: $status', (failure) => {
    const options = fixture();
    const normal = options.run.getMockImplementation();
    options.run.mockImplementation((command, args, cwd) =>
      args[0] === 'audit' ? failure : normal!(command, args, cwd),
    );
    const { evidence, directory } = generateEvidence(options);
    expect(evidence.complete).toBe(false);
    expect(evidence.checks.filter((check: { status: string }) => check.status === 'unavailable')).toHaveLength(2);
    expect(existsSync(join(directory, 'root-audit.json'))).toBe(false);
    expect(JSON.stringify(evidence)).not.toContain('secret-do-not-copy');
    expect(readFileSync(join(directory, 'summary.md'), 'utf8')).toContain('INCOMPLETE');
  });

  it('rejects inconsistent audit counts and failed empty scans', () => {
    expect(validateAudit(audit(1), 1)).toBe(true);
    expect(validateAudit(audit(), 1)).toBe(false);
    const inconsistent = audit(1);
    inconsistent.metadata.vulnerabilities.total = 0;
    expect(validateAudit(inconsistent, 0)).toBe(false);
  });

  it('does not scan a package whose lockfile has a different identity', () => {
    const options = fixture();
    writeFileSync(join(options.root, 'package.json'), JSON.stringify({ name: 'other', version: '1.2.0' }));
    const { evidence } = generateEvidence(options);
    expect(evidence.complete).toBe(false);
    expect(
      evidence.checks
        .filter((check: { scope: string; status: string }) => check.scope === 'root')
        .every((check: { status: string }) => check.status === 'unavailable'),
    ).toBe(true);
    expect(
      options.run.mock.calls.filter(
        ([command, args, cwd]) => command === 'npm' && args[0] !== '--version' && cwd === options.root,
      ),
    ).toHaveLength(0);
  });

  it('detects inputs changed during collection and preserves that incomplete state', () => {
    const options = fixture();
    const normal = options.run.getMockImplementation();
    options.run.mockImplementation((command, args, cwd) => {
      if (args[0] === 'audit') writeFileSync(join(options.root, 'btp/approuter/vendor/bridge/index.cjs'), 'changed');
      return normal!(command, args, cwd);
    });
    const { evidence } = generateEvidence(options);
    expect(evidence.inputsUnchanged).toBe(false);
    expect(evidence.complete).toBe(false);
  });

  it('requires a clean checkout when requested and refuses missing inputs before collection', () => {
    const options = fixture();
    const normal = options.run.getMockImplementation();
    options.run.mockImplementation((command, args, cwd) =>
      args[0] === 'status' ? { status: 0, stdout: ' M package.json' } : normal!(command, args, cwd),
    );
    expect(() => generateEvidence({ ...options, requireClean: true })).toThrow('clean source');
    expect(existsSync(options.out)).toBe(false);
    rmSync(join(options.root, 'package-lock.json'));
    expect(() => generateEvidence(options)).toThrow();
  });

  it('records an MTAR hash without claiming its source relationship was verified', () => {
    const options = fixture();
    const mtar = join(options.root, 'sample.mtar');
    writeFileSync(mtar, 'artifact fixture');
    const { evidence } = generateEvidence({ ...options, mtar });
    expect(evidence.mtar).toEqual({
      name: 'sample.mtar',
      sha256: hashFile(mtar),
      size: 16,
      sourceRelationship: 'not-verified',
    });
  });
});
