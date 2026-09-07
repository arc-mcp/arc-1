import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflow = (name: string) => parse(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));

describe('enterprise security workflow boundaries', () => {
  it('selects only dependency security and high/critical CodeQL findings, disabled until rollout', () => {
    const ruleset = JSON.parse(readFileSync('.github/security-ruleset.json', 'utf8'));
    const dependencies = workflow('dependency-review');
    const required = ruleset.rules.find((rule: { type: string }) => rule.type === 'required_status_checks');
    const scanning = ruleset.rules.find((rule: { type: string }) => rule.type === 'code_scanning');
    expect(required.parameters.required_status_checks).toEqual([
      { context: dependencies.jobs['dependency-review'].name, integration_id: 15368 },
    ]);
    expect(scanning.parameters.code_scanning_tools).toEqual([
      { tool: 'CodeQL', alerts_threshold: 'none', security_alerts_threshold: 'high_or_higher' },
    ]);
    expect(ruleset.enforcement).toBe('disabled');
    expect(ruleset.bypass_actors).toEqual([]);
    expect(ruleset.conditions.ref_name.include).toEqual(['~DEFAULT_BRANCH']);
  });

  it('reviews all dependency scopes without license gating, installation or write permissions', () => {
    const data = workflow('dependency-review');
    expect(data.on).toEqual({ pull_request: { branches: ['main'] } });
    expect(data.permissions).toEqual({ contents: 'read' });
    const security = data.jobs['dependency-review'];
    expect(security.if).toBeUndefined();
    expect(security['continue-on-error']).toBeUndefined();
    const review = security.steps.find((step: { uses: string }) =>
      step.uses?.startsWith('actions/dependency-review-action@'),
    );
    expect(review.with).toMatchObject({
      'fail-on-severity': 'high',
      'fail-on-scopes': 'runtime, development, unknown',
      'vulnerability-check': true,
      'license-check': false,
      'comment-summary-in-pr': 'never',
    });
    expect(review.with['warn-only']).not.toBe(true);
    expect(review.with['allow-ghsas']).toBeUndefined();
    for (const job of Object.values(data.jobs) as {
      steps: { uses: string; run?: string; if?: string; with?: Record<string, unknown> }[];
    }[]) {
      for (const step of job.steps) {
        expect(step.run).toBeUndefined();
        expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
        expect(step.if).toBeUndefined();
        if (step.uses.startsWith('actions/checkout@')) expect(step.with?.['persist-credentials']).toBe(false);
      }
    }
    const license = data.jobs['dependency-licenses'].steps.at(-1);
    expect(license.with['vulnerability-check']).toBe(false);
    expect(license.with['deny-licenses']).toContain('AGPL-3.0');
    expect(license.with['allow-dependencies-licenses']).toBe('pkg:npm/node-forge@1.4.0');
  });

  it('preserves built-in release authentication and the existing publication gate', () => {
    const data = workflow('release');
    expect(data.on.pull_request).toBeUndefined();
    expect(data.on.pull_request_target).toBeUndefined();
    const job = data.jobs['release-please'];
    expect(job.permissions).toEqual({ contents: 'write', 'pull-requests': 'write' });
    expect(job.steps).toHaveLength(1);
    expect(job.steps[0].uses).toMatch(/^googleapis\/release-please-action@[a-f0-9]{40}$/);
    expect(job.steps[0].with?.token).toBeUndefined();
    expect(
      job.steps.some((step: { uses?: string; run?: string }) => step.uses?.startsWith('actions/checkout@') || step.run),
    ).toBe(false);
    expect(data.jobs['publish-npm'].permissions).toEqual({ contents: 'read', 'id-token': 'write' });
    const publication = data.jobs['publish-npm'].steps as { run?: string }[];
    const tests = publication.findIndex((step) => step.run?.startsWith('npm test'));
    const publish = publication.findIndex((step) => step.run?.startsWith('npm publish'));
    expect(tests).toBeGreaterThanOrEqual(0);
    expect(publish).toBeGreaterThan(tests);
    expect(publication[publish].run).toContain('--provenance');
  });

  it('keeps whole-tree evidence on a separate read-only maintenance workflow with retained failures', () => {
    const data = workflow('dependency-evidence');
    expect(Object.keys(data.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    expect(data.permissions).toEqual({ contents: 'read' });
    const steps = data.jobs.evidence.steps;
    const collect = steps.find((step: { run?: string }) => step.run?.startsWith('npm run security:evidence'));
    expect(collect.run).toContain('--require-clean --fail-on-high');
    expect(collect['continue-on-error']).toBeUndefined();
    expect(JSON.stringify(data)).not.toMatch(/npm ci|secrets\.|id-token|pull_request_target/);
    const upload = steps.find((step: { uses?: string }) => step.uses?.startsWith('actions/upload-artifact@'));
    expect(upload.if).toBe('always()');
    expect(upload.with['if-no-files-found']).toBe('error');
    expect(upload.with['retention-days']).toBe(30);
    for (const step of steps.filter((step: { uses?: string }) => step.uses))
      expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
  });

  it('leaves all Socket manifests and PRs eligible without claiming a dashboard policy', () => {
    const socket = parse(readFileSync('socket.yml', 'utf8'));
    expect(socket).toEqual({ version: 2, triggerPaths: ['*'] });
  });
});
