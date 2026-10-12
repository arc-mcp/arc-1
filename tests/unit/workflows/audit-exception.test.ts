import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AuditCiConfig, npmAudit } from 'audit-ci';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ROOT = join(import.meta.dirname, '../../..');
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'audit-ci.json'), 'utf8')) as AuditCiConfig;
const FORGE = 'GHSA-86w9-cpqp-85rv';
const OTHER = 'GHSA-jqcg-44mw-7w3h';

function advisory(id: string, name = 'node-forge', severity = 'high') {
  return { source: id === FORGE ? 1 : 2, name, severity, url: `https://github.com/advisories/${id}` };
}

function report(via = [advisory(FORGE)]) {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      'node-forge': {
        name: 'node-forge',
        severity: 'high',
        isDirect: false,
        via,
        effects: ['jks-js'],
        nodes: ['node_modules/node-forge'],
      },
      'jks-js': {
        name: 'jks-js',
        severity: 'high',
        isDirect: true,
        via: ['node-forge'],
        effects: [],
        nodes: ['node_modules/jks-js'],
      },
    },
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0, total: 2 } },
  };
}

describe('temporary dependency audit exception', () => {
  let directory: string;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T12:00:00+02:00'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    directory = mkdtempSync(join(tmpdir(), 'arc1-audit-'));
    vi.stubEnv('PATH', `${directory}:${process.env.PATH}`);
    // Exercise the real audit-ci parser, graph handling and exit policy offline.
    // npm audit returns valid JSON with exit 1 when advisories are present.
    writeFileSync(
      join(directory, 'npm'),
      `#!${process.execPath}\nprocess.stdout.write(require('node:fs').readFileSync(${JSON.stringify(join(directory, 'report.json'))}));\nprocess.exitCode = 1;\n`,
      { mode: 0o700 },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  function audit(output: unknown) {
    writeFileSync(join(directory, 'report.json'), JSON.stringify(output));
    return npmAudit({ ...CONFIG, directory });
  }

  it('accepts the specified advisory and its transitive findings during the exception', async () => {
    const result = await audit(report());
    expect(result.advisoriesFound).toEqual([]);
    expect(result.allowlistedAdvisoriesFound).toEqual([FORGE]);
  });

  it.each(['2026-10-21T00:00:00+02:00', '2026-10-22T00:00:00+02:00'])(
    'blocks the advisory at and after expiry (%s)',
    async (now) => {
      vi.setSystemTime(new Date(now));
      await expect(audit(report())).rejects.toThrow('Failed security audit');
    },
  );

  it('does not suppress another advisory in node-forge', async () => {
    await expect(audit(report([advisory(FORGE), advisory(OTHER)]))).rejects.toThrow('Failed security audit');
  });

  it('keeps critical findings blocking', async () => {
    await expect(audit(report([advisory(OTHER, 'node-forge', 'critical')]))).rejects.toThrow('Failed security audit');
  });

  it('fails when npm reports that the registry could not audit', async () => {
    await expect(audit({ error: { code: 'ENOAUDIT', summary: 'Registry unavailable' } })).rejects.toThrow('ENOAUDIT');
  });
});
