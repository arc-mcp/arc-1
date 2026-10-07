import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Step = {
  name?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  'working-directory'?: string;
  'continue-on-error'?: boolean;
};
type Job = {
  steps: Step[];
  env?: Record<string, string>;
  'continue-on-error'?: boolean;
  strategy?: { 'fail-fast'?: boolean; matrix?: { directory?: string[] } };
};
type Workflow = {
  env?: Record<string, string>;
  on: { schedule?: { cron: string }[]; workflow_dispatch?: unknown };
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
};

function workflow(name: string): Workflow {
  return parse(readFileSync(`.github/workflows/${name}.yml`, 'utf8')) as Workflow;
}

function step(job: Job, name: string): Step {
  const found = job.steps.find((candidate) => candidate.name === name);
  expect(found, name).toBeDefined();
  return found!;
}

const AUDIT = 'npm audit --package-lock-only --audit-level=high';
const SMOKE = 'node scripts/ci/check-dependency-runtime.mjs';
const githubExpression = (expression: string): string => `\${{ ${expression} }}`;

function blockingAudit(job: Job, name: string, command = AUDIT): Step {
  const audit = step(job, name);
  expect(job['continue-on-error']).not.toBe(true);
  expect(audit.run).toBe(command);
  expect(audit['continue-on-error']).not.toBe(true);
  expect(audit.if).toBeUndefined();
  return audit;
}

describe('dependency lifecycle and audit gates', () => {
  it.each(['test', 'release'])('%s suppresses hooks without dropping optional install binaries', (name) => {
    const config = workflow(name);
    expect(config.env?.NPM_CONFIG_IGNORE_SCRIPTS).toBe('true');
    for (const job of Object.values(config.jobs)) {
      expect(job.env?.NPM_CONFIG_IGNORE_SCRIPTS).not.toBe('false');
      for (const current of job.steps) {
        expect(current.env?.NPM_CONFIG_IGNORE_SCRIPTS).not.toBe('false');
        expect(current.run ?? '').not.toMatch(/--ignore-scripts[= ]false|--no-ignore-scripts/);
        if (/\bnpm ci\b/.test(current.run ?? '')) {
          expect(current.run).not.toMatch(/--omit[= ]optional|--no-optional/);
        }
      }
    }
  });

  it('audits both full lockfiles before PR dependency installation', () => {
    const job = workflow('test').jobs.test;
    const root = blockingAudit(job, 'Security audit (npm audit)');
    const approuter = blockingAudit(
      job,
      'Security audit (BTP AppRouter)',
      'npm audit --prefix btp/approuter --package-lock-only --audit-level=high',
    );
    const install = step(job, 'Install dependencies');
    expect(install.run).toBe('npm ci');
    expect(job.steps.indexOf(root)).toBeLessThan(job.steps.indexOf(install));
    expect(job.steps.indexOf(approuter)).toBeLessThan(job.steps.indexOf(install));
    expect(step(job, 'Dependency runtime smoke test').run).toBe(SMOKE);
  });

  it('gates publication before install and after the explicit build', () => {
    const job = workflow('release').jobs['publish-npm'];
    const beforeInstall = blockingAudit(job, 'Security audit before installation');
    const beforePublish = blockingAudit(job, 'Security audit before publication');
    const install = step(job, 'Install dependencies');
    const build = step(job, 'Build');
    const publish = step(job, 'Publish to npm');
    expect(job.steps.indexOf(beforeInstall)).toBeLessThan(job.steps.indexOf(install));
    expect(job.steps.indexOf(step(job, 'Run tests'))).toBeLessThan(job.steps.indexOf(build));
    expect(build.run).toBe('npm run build');
    expect(job.steps.indexOf(build)).toBeLessThan(job.steps.indexOf(beforePublish));
    expect(job.steps.indexOf(beforePublish) + 1).toBe(job.steps.indexOf(publish));
    expect(publish.run).toBe('npm publish --provenance --access public');
    expect(step(job, 'Dependency runtime smoke test').run).toBe(SMOKE);
  });

  it('checks both lockfiles daily without installing or hiding failures', () => {
    const config = workflow('dependency-audit');
    expect(config.on.schedule).toEqual([{ cron: '37 6 * * *' }]);
    expect(config.on).toHaveProperty('workflow_dispatch');
    expect(config.permissions).toEqual({ contents: 'read' });
    const job = config.jobs.audit;
    expect(job.strategy).toEqual({ 'fail-fast': false, matrix: { directory: ['.', 'btp/approuter'] } });
    const audit = blockingAudit(job, 'Audit locked dependencies');
    expect(audit['working-directory']).toBe(githubExpression('matrix.directory'));
    expect(job.steps.flatMap((current) => (current.run ? [current.run] : []))).toEqual([AUDIT]);
    expect(job.steps[0].with?.['persist-credentials']).toBe(false);
  });

  it('loads the native SQLite addon and esbuild platform executable', () => {
    const output = execFileSync(process.execPath, ['scripts/ci/check-dependency-runtime.mjs'], {
      encoding: 'utf8',
      timeout: 15_000,
      env: { ...process.env, NPM_CONFIG_IGNORE_SCRIPTS: 'true' },
    });
    expect(output).toContain('Dependency runtime smoke passed');
  });

  it('uses a verified real MTA binary and rejects a false-green validator', () => {
    const job = workflow('test').jobs['mta-validate'];
    const install = step(job, 'Install verified MTA validator');
    expect(install.env?.MBT_VERSION).toBe('1.2.49');
    expect(install.env?.MBT_SHA256).toBe('9f1ed652317dedcad5a0c8dc3239ca088d18fddb4d6422cf5eaa5a05d007a059');
    expect(install.run).toContain('sha256sum --check --strict');
    expect(install.run?.indexOf('sha256sum')).toBeLessThan(install.run!.indexOf('tar -xzf'));
    const control = step(job, 'Reject invalid MTA descriptor (validator control)');
    expect(control.run).toContain('if mbt validate --source tests/fixtures/ci/invalid-mta; then');
    expect(control.run).toContain('exit 1');
    const validate = step(job, 'Validate mta.yaml + mta-overrides.mtaext.example');
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
    // Keep the same six profiles as local validation, without the npm wrapper.
    expect(validate.run?.trim().split('\n')).toEqual(
      scripts['btp:validate'].split(' && ').map((command: string) => command.replace(/^npx /, '')),
    );
    expect(job.steps.indexOf(control)).toBeLessThan(job.steps.indexOf(validate));
    expect(readFileSync('tests/fixtures/ci/invalid-mta/mta.yaml', 'utf8')).not.toMatch(/^ID:/m);
  });
});
