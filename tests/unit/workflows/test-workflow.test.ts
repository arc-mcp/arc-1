import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

const WORKFLOW = readFileSync(join(import.meta.dirname, '../../../.github/workflows/test.yml'), 'utf8');

type WorkflowStep = {
  name?: string;
  id?: string;
  if?: string;
  with?: { script?: string };
  env?: Record<string, unknown>;
  run?: unknown;
};

type WorkflowJob = {
  concurrency?: Record<string, unknown>;
  if?: string;
  outputs?: Record<string, string>;
  steps?: WorkflowStep[];
};

type Workflow = {
  jobs?: Record<string, WorkflowJob>;
};

const PARSED_WORKFLOW = parse(WORKFLOW) as Workflow;
const SLOW_WORKFLOW = parse(
  readFileSync(join(import.meta.dirname, '../../../.github/workflows/sap-slow-tests.yml'), 'utf8'),
) as Workflow;

function currentStep(job: string): WorkflowStep {
  const step = PARSED_WORKFLOW.jobs?.[job]?.steps?.find((step) => step.id === 'current');
  expect(step, `${job} must check PR freshness`).toBeDefined();
  return step!;
}

function credentialStep() {
  const step = PARSED_WORKFLOW.jobs?.['sap-run-guard']?.steps?.find((step) => step.id === 'credentials');
  expect(step).toBeDefined();
  return step!;
}

function guardFixture(eventName: string, state: string, head: string) {
  const get = vi.fn().mockResolvedValue({ data: { state, head: { sha: head } } });
  const core = { setOutput: vi.fn(), info: vi.fn(), notice: vi.fn() };
  const script = currentStep('sap-run-guard').with?.script;
  expect(script).toBeTypeOf('string');
  const run = () =>
    runInNewContext(`(async () => { ${script} })()`, {
      github: { rest: { pulls: { get } } },
      context: {
        eventName,
        repo: { owner: 'arc-mcp', repo: 'arc-1' },
        payload: eventName === 'pull_request' ? { pull_request: { number: 123, head: { sha: 'event-head' } } } : {},
      },
      core,
    });
  return { get, core, run };
}

function jobBlock(jobName: string): string {
  const match = WORKFLOW.match(new RegExp(`\\n  ${jobName}:\\n([\\s\\S]*?)(?=\\n  [a-zA-Z0-9_-]+:\\n|\\n$)`));
  if (!match) throw new Error(`Job ${jobName} not found`);
  return match[1];
}

function runScripts(): string[] {
  return Object.values(PARSED_WORKFLOW.jobs ?? {}).flatMap((job) => {
    if (!Array.isArray(job.steps)) return [];
    return job.steps.map((step) => step.run).filter((run): run is string => typeof run === 'string');
  });
}

describe('test workflow gate behavior', () => {
  it('runs cheap test job outside the SAP title gate', () => {
    const testJob = jobBlock('test');

    expect(testJob).not.toContain('needs: gate');
    expect(testJob).toContain('npm run audit:ci');
    expect(testJob).toContain('npm run audit:ci -- --directory btp/approuter');
    expect(testJob).toContain('npm run lint');
    expect(testJob).toContain('npm run typecheck');
    expect(testJob).toContain('npm test');
  });

  it('keeps SAP-heavy jobs behind the gate, unit job, and stale-head guard', () => {
    const sapRunGuardJob = jobBlock('sap-run-guard');
    const integrationJob = jobBlock('integration');
    const e2eJob = jobBlock('e2e');

    expect(sapRunGuardJob).toContain('needs: [test, gate]');
    expect(sapRunGuardJob).toContain("needs.gate.result == 'success'");
    expect(sapRunGuardJob).toContain("needs.test.result == 'success'");
    expect(sapRunGuardJob).toContain('actions/github-script@');

    expect(integrationJob).toContain('needs: [test, gate, sap-run-guard]');
    expect(integrationJob).toContain("needs.gate.result == 'success'");
    expect(integrationJob).toContain("needs.test.result == 'success'");
    expect(integrationJob).toContain("needs.sap-run-guard.outputs.current == 'true'");

    expect(e2eJob).toContain('needs: [test, gate, sap-run-guard, integration]');
    expect(e2eJob).toContain("needs.gate.result == 'success'");
    expect(e2eJob).toContain("needs.test.result == 'success'");
    expect(e2eJob).toContain("needs.sap-run-guard.outputs.current == 'true'");
    expect(e2eJob).toMatch(/if: >\s+always\(\) &&/);
    expect(e2eJob).not.toContain('needs.integration.result');
    for (const job of [sapRunGuardJob, integrationJob, e2eJob]) {
      expect(job).toContain('github.event.pull_request.head.repo.full_name == github.repository');
    }
  });

  it('requires credential eligibility before either event can start a live SAP job', () => {
    const { integration, e2e } = PARSED_WORKFLOW.jobs!;
    const eligible = "needs.sap-run-guard.outputs.credentials-eligible == 'true'";
    expect(integration.if).toContain(`${eligible} && (github.event_name == 'workflow_dispatch' ||`);
    expect(e2e.if).toContain(`${eligible} && (github.event_name == 'workflow_dispatch' ||`);

    const guard = PARSED_WORKFLOW.jobs?.['sap-run-guard'];
    const check = credentialStep();
    expect(guard?.outputs?.['credentials-eligible']).toBe('$' + '{{ steps.credentials.outputs.eligible }}');
    expect(check.if).toBe("steps.current.outputs.current == 'true'");
    expect(check.env).toEqual({
      SAP_SECRETS_PRESENT:
        '$' +
        "{{ secrets.TEST_SAP_URL != '' && secrets.TEST_SAP_USER != '' && secrets.TEST_SAP_PASSWORD != '' && secrets.TEST_SAP_CLIENT != '' }}",
    });
  });

  it.each([
    ['arc-mcp', 'arc-1', 'true', true],
    ['arc-mcp', 'arc-1', 'false', true],
    ['example', 'arc-1', 'true', true],
    ['example', 'arc-1', 'false', false],
    ['arc-mcp', 'arc-1-fork', 'false', false],
  ])('sets credential eligibility for %s/%s when secret presence is %s', (owner, repo, present, eligible) => {
    const script = credentialStep().with?.script;
    expect(script).toBeTypeOf('string');
    const core = { setOutput: vi.fn(), notice: vi.fn() };
    runInNewContext(script!, {
      context: { repo: { owner, repo } },
      process: { env: { SAP_SECRETS_PRESENT: present } },
      core,
    });
    expect(core.setOutput).toHaveBeenCalledExactlyOnceWith('eligible', String(eligible));
    if (eligible) expect(core.notice).not.toHaveBeenCalled();
    else expect(core.notice).toHaveBeenCalledExactlyOnceWith(expect.any(String), { title: 'SAP jobs skipped' });
  });

  it.each(['integration', 'e2e'])('%s preflight fails when the required secrets are missing', (job) => {
    const script = PARSED_WORKFLOW.jobs?.[job]?.steps?.find((step) => step.id === 'sap_auth')?.run;
    expect(script).toContain('for name in TEST_SAP_URL TEST_SAP_USER TEST_SAP_PASSWORD TEST_SAP_CLIENT');
    expect(script).toMatch(
      /if \[ "\$\{#missing\[@\]\}" -gt 0 \]; then\n\s+echo "::error.*Missing required.*\n\s+exit 1/,
    );
  });

  it('does not interpolate untrusted PR titles directly into shell scripts', () => {
    const scripts = runScripts();

    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      expect(script).not.toContain('github.event.pull_request.title');
    }

    const gateJob = jobBlock('gate');
    expect(gateJob).toContain('PR_TITLE: $' + '{{ github.event.pull_request.title }}');
    expect(gateJob).toContain('echo "pr_title=$' + '{PR_TITLE}"');
  });

  it('queues every live SAP job in one shared group without replacing pending jobs', () => {
    const preJobs = WORKFLOW.split('\njobs:')[0];

    expect(preJobs).not.toContain('\nconcurrency:');
    for (const job of [
      PARSED_WORKFLOW.jobs?.integration,
      PARSED_WORKFLOW.jobs?.e2e,
      SLOW_WORKFLOW.jobs?.['sap-slow'],
    ]) {
      expect(job?.concurrency).toEqual({
        group: '$' + '{{ github.repository }}-sap-live-a4h',
        'cancel-in-progress': false,
        queue: 'max',
      });
    }
  });

  it.each(['integration', 'e2e'])('%s rechecks freshness after waiting and gates all later steps', (job) => {
    const steps = PARSED_WORKFLOW.jobs?.[job]?.steps ?? [];
    expect(steps[0]).toEqual(currentStep('sap-run-guard'));
    const current = "steps.current.outputs.current == 'true'";
    for (const step of steps.slice(1)) {
      // auth_ok can only be set by the preflight, which itself requires the new freshness check.
      if (step.id === 'sap_auth') expect(step.if).toBe(current);
      else if (job === 'integration' && ['where_used_diagnostic', 'where_used_summary'].includes(step.id ?? ''))
        expect(step.if).toBe('$' + "{{ !cancelled() && steps.sap_auth.outputs.auth_ok == 'true' }}");
      else expect([current, `always() && ${current}`, "steps.sap_auth.outputs.auth_ok == 'true'"]).toContain(step.if);
      if (
        step.name?.startsWith('Upload ') ||
        step.name?.endsWith('reliability summary') ||
        step.name === 'Stop MCP server'
      ) {
        expect(step.if).toBe(`always() && ${current}`);
      }
    }
  });

  it.each([
    ['open', 'event-head', 'true'],
    ['open', 'new-head', 'false'],
    ['closed', 'event-head', 'false'],
  ])('permits only a current open PR (%s, %s)', async (state, head, expected) => {
    const { get, core, run } = guardFixture('pull_request', state, head);
    await run();
    expect(get).toHaveBeenCalledWith({ owner: 'arc-mcp', repo: 'arc-1', pull_number: 123 });
    expect(core.setOutput).toHaveBeenCalledWith('current', expected);
    if (expected === 'false') {
      expect(core.notice).toHaveBeenCalledWith(
        'SAP tests skipped: PR is closed or its head changed. This is not a passed SAP suite.',
      );
    } else expect(core.notice).not.toHaveBeenCalled();
  });

  it('allows an explicit manual dispatch without looking up a PR', async () => {
    const { get, core, run } = guardFixture('workflow_dispatch', 'closed', 'new-head');
    await run();
    expect(get).not.toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith('current', 'true');
  });

  it('fails closed when GitHub cannot confirm the PR head', async () => {
    const { get, core, run } = guardFixture('pull_request', 'open', 'event-head');
    get.mockRejectedValueOnce(new Error('GitHub API unavailable'));
    await expect(run()).rejects.toThrow('GitHub API unavailable');
    expect(core.setOutput).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledOnce();
  });

  it('does not claim e2e runs on push to main', () => {
    expect(WORKFLOW).not.toContain('Run on push (main)');
    expect(WORKFLOW).toContain('Run on internal PRs and manual dispatch');
  });

  it.each(['test', 'release'])('%s.yml never runs dependency install hooks', (name) => {
    const text = readFileSync(join(import.meta.dirname, `../../../.github/workflows/${name}.yml`), 'utf8');
    const workflow = parse(text) as { env?: Record<string, unknown> };
    expect(workflow.env?.NPM_CONFIG_IGNORE_SCRIPTS).toBe('true');
    // npm publish skips prepublishOnly under this setting, so the build must stay explicit.
    if (name === 'release') expect(text.indexOf('run: npm run build')).toBeLessThan(text.indexOf('run: npm publish'));
  });
});
