import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const WORKFLOW_DIR = join(import.meta.dirname, '../../../.github/workflows');
const WORKFLOW = readFileSync(join(WORKFLOW_DIR, 'test.yml'), 'utf8');
const WORKFLOW_FILES = readdirSync(WORKFLOW_DIR)
  .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
  .sort();
const UNTRUSTED_GITHUB_CONTEXTS = [
  'github.event.pull_request.title',
  'github.event.pull_request.body',
  'github.event.pull_request.head.ref',
  'github.event.pull_request.head.label',
  'github.event.issue.title',
  'github.event.issue.body',
  'github.event.comment.body',
  'github.event.discussion.title',
  'github.event.discussion.body',
  'github.event.head_commit.message',
  'github.head_ref',
] as const;

type WorkflowStep = {
  env?: Record<string, unknown>;
  run?: unknown;
};

type WorkflowJob = {
  steps?: WorkflowStep[];
};

type Workflow = {
  jobs?: Record<string, WorkflowJob>;
};

const PARSED_WORKFLOW = parse(WORKFLOW) as Workflow;

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

function allWorkflowRunScripts(): Array<{ file: string; jobName: string; stepIndex: number; script: string }> {
  return WORKFLOW_FILES.flatMap((file) => {
    const source = readFileSync(join(WORKFLOW_DIR, file), 'utf8');
    const parsed = parse(source) as Workflow;

    return Object.entries(parsed.jobs ?? {}).flatMap(([jobName, job]) => {
      if (!Array.isArray(job.steps)) return [];
      return job.steps.flatMap((step, stepIndex) => {
        if (typeof step.run !== 'string') return [];
        return [{ file, jobName, stepIndex, script: step.run }];
      });
    });
  });
}

describe('test workflow gate behavior', () => {
  it('runs cheap test job outside the SAP title gate', () => {
    const testJob = jobBlock('test');

    expect(testJob).not.toContain('needs: gate');
    expect(testJob).toContain('npm audit --audit-level=high --omit=optional');
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
    expect(sapRunGuardJob).toContain('gh api "repos/$' + '{REPOSITORY}/pulls/$' + '{PR_NUMBER}"');

    expect(integrationJob).toContain('needs: [test, gate, sap-run-guard]');
    expect(integrationJob).toContain("needs.gate.result == 'success'");
    expect(integrationJob).toContain("needs.test.result == 'success'");
    expect(integrationJob).toContain("needs.sap-run-guard.outputs.current == 'true'");

    expect(e2eJob).toContain('needs: [test, gate, sap-run-guard, integration]');
    expect(e2eJob).toContain("needs.gate.result == 'success'");
    expect(e2eJob).toContain("needs.test.result == 'success'");
    expect(e2eJob).toContain("needs.sap-run-guard.outputs.current == 'true'");
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

  it('does not interpolate untrusted GitHub event contexts directly into workflow shell scripts', () => {
    const violations = allWorkflowRunScripts().flatMap(({ file, jobName, stepIndex, script }) =>
      UNTRUSTED_GITHUB_CONTEXTS.filter((context) => script.includes(context)).map(
        (context) => `${file}:${jobName}:steps[${stepIndex}]: ${context}`,
      ),
    );

    expect(violations).toEqual([]);
  });

  it('serializes only SAP-heavy jobs repository-wide without cancellation', () => {
    const preJobs = WORKFLOW.split('\njobs:')[0];
    const integrationJob = jobBlock('integration');
    const e2eJob = jobBlock('e2e');
    const sapConcurrencyGroup = 'group: $' + '{{ github.repository }}-sap-live-a4h';

    expect(preJobs).not.toContain('\nconcurrency:');
    for (const job of [integrationJob, e2eJob]) {
      expect(job).toContain('concurrency:');
      expect(job).toContain(sapConcurrencyGroup);
      expect(job).toContain('cancel-in-progress: false');
    }
  });

  it('does not claim e2e runs on push to main', () => {
    expect(WORKFLOW).not.toContain('Run on push (main)');
    expect(WORKFLOW).toContain('Run on internal PRs and manual dispatch');
  });
});
