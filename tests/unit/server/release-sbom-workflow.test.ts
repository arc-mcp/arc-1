import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface WorkflowStep {
  id?: string;
  name?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  run?: string;
}

interface WorkflowJob {
  needs?: string | string[];
  if?: string;
  'continue-on-error'?: boolean;
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  steps: WorkflowStep[];
}

interface ReleaseWorkflow {
  jobs: Record<string, WorkflowJob>;
}

const githubExpression = (expression: string): string => `\${{ ${expression} }}`;

describe('release npm SBOM workflow', () => {
  it('publishes best-effort from the immutable release tag after npm with least privilege', async () => {
    const workflow = parse(await readFile('.github/workflows/release.yml', 'utf8')) as ReleaseWorkflow;
    const releaseJob = workflow.jobs['release-please'];
    const sbomJob = workflow.jobs['publish-npm-sbom'];

    expect(releaseJob.outputs?.version).toBe(githubExpression('steps.release.outputs.version'));
    expect(sbomJob.needs).toEqual(['release-please', 'publish-npm']);
    expect(sbomJob.if).toBe(githubExpression('needs.release-please.outputs.release_created'));
    expect(sbomJob['continue-on-error']).toBe(true);
    expect(sbomJob.permissions).toEqual({ contents: 'write' });

    const checkout = sbomJob.steps.find((step) => step.uses === 'actions/checkout@v7');
    expect(checkout?.with?.ref).toBe(githubExpression('needs.release-please.outputs.tag_name'));
    expect(checkout?.with?.['persist-credentials']).toBe(false);
  });

  it('uses the tested production-only npm command and validates release metadata', async () => {
    const workflow = parse(await readFile('.github/workflows/release.yml', 'utf8')) as ReleaseWorkflow;
    const steps = workflow.jobs['publish-npm-sbom'].steps;
    const npmInstall = steps.find((step) => step.name === 'Install the release npm version');
    const generate = steps.find((step) => step.id === 'sbom');

    expect(npmInstall?.run).toBe('npm install --global npm@11.11.1');
    expect(generate?.env?.RELEASE_VERSION).toBe(githubExpression('needs.release-please.outputs.version'));
    expect(generate?.run).toContain('--package-lock-only');
    expect(generate?.run).toContain('--omit=dev');
    expect(generate?.run).toContain('--sbom-format=cyclonedx');
    expect(generate?.run).toContain('--sbom-type=application');
    expect(generate?.run).toContain('PACKAGE_VERSION');
    expect(generate?.run).toContain('LOCK_VERSION');
    expect(generate?.run).toContain('.metadata.component.name == "arc-1"');
    expect(generate?.run).toContain('.metadata.component.version == $version');
    expect(generate?.run).not.toContain('--sbom-set-version');
  });

  it('uploads idempotently by digest without destructive replacement', async () => {
    const workflow = parse(await readFile('.github/workflows/release.yml', 'utf8')) as ReleaseWorkflow;
    const steps = workflow.jobs['publish-npm-sbom'].steps;
    const generateIndex = steps.findIndex((step) => step.id === 'sbom');
    const uploadIndex = steps.findIndex((step) => step.name === 'Attach npm SBOM to GitHub Release');
    const upload = steps[uploadIndex];

    expect(generateIndex).toBeGreaterThanOrEqual(0);
    expect(uploadIndex).toBeGreaterThan(generateIndex);
    expect(upload.env?.GH_TOKEN).toBe(githubExpression('secrets.GITHUB_TOKEN'));
    expect(upload.run).toContain('.digest // empty');
    expect(upload.run).toContain('LOCAL_DIGEST');
    expect(upload.run).toContain('for attempt in 1 2 3');
    expect(upload.run).not.toContain('--clobber');
  });
});
