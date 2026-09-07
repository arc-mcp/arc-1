import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  const root = mkdtempSync(join(tmpdir(), 'arc1-evidence-'));
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
  const run = vi.fn((command: string, args: string[], cwd: string) => {
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
