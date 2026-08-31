import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type WorkflowStep = {
  name?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
  if?: string;
  'continue-on-error'?: boolean;
};

type Workflow = {
  jobs: Record<
    string,
    {
      steps: WorkflowStep[];
      strategy?: {
        'fail-fast'?: boolean;
        matrix?: { include?: Array<Record<string, unknown>> };
      };
    }
  >;
};

async function readWorkflow(path: string): Promise<Workflow> {
  return parse(await readFile(path, 'utf8')) as Workflow;
}

const githubExpression = (expression: string): string => `\${{ ${expression} }}`;

function namedStep(workflow: Workflow, job: string, name: string): WorkflowStep {
  const step = workflow.jobs[job]?.steps.find((candidate) => candidate.name === name);
  expect(step, `${job} should contain ${name}`).toBeDefined();
  return step as WorkflowStep;
}

describe('container security workflows', () => {
  it('names the Docker runtime stage used for selective cache invalidation', async () => {
    const dockerfile = await readFile('Dockerfile', 'utf8');

    expect(dockerfile).toContain('FROM node:22-alpine AS runtime');
    expect(dockerfile).toContain('RUN apk upgrade --no-cache && apk add --no-cache tini ca-certificates');
  });

  it.each([
    ['.github/workflows/docker.yml', 'build', 'Build and push by digest'],
    ['.github/workflows/release.yml', 'publish-docker', 'Build and push by digest'],
    ['.github/workflows/security-scan.yml', 'trivy-release-gate-preview', 'Build image for scan'],
  ])('%s refreshes the base image and runtime package layer', async (path, job, stepName) => {
    const workflow = await readWorkflow(path);
    const build = namedStep(workflow, job, stepName);

    expect(build.with?.pull).toBe(true);
    expect(build.with?.['no-cache-filters']).toBe('runtime');
  });

  it('keeps release scans advisory and scheduled scans gating', async () => {
    const release = await readWorkflow('.github/workflows/release.yml');
    const scheduled = await readWorkflow('.github/workflows/security-scan.yml');
    const releaseScan = namedStep(release, 'publish-docker', 'Scan image with Trivy (advisory)');
    const releaseUpload = namedStep(release, 'publish-docker', 'Upload Trivy SARIF');
    const scheduledScan = namedStep(scheduled, 'trivy-release-gate-preview', 'Scan image with Trivy (scheduled gate)');

    expect(releaseScan.with).toMatchObject({
      severity: 'HIGH,CRITICAL',
      'limit-severities-for-sarif': true,
      'exit-code': '0',
    });
    expect(releaseScan['continue-on-error']).toBe(true);
    expect(releaseUpload['continue-on-error']).toBe(true);
    expect(scheduledScan.with).toMatchObject({
      severity: 'HIGH,CRITICAL',
      'limit-severities-for-sarif': true,
      'exit-code': '1',
    });
  });

  it('gates both published architectures in the scheduled scan', async () => {
    const scheduled = await readWorkflow('.github/workflows/security-scan.yml');
    const strategy = scheduled.jobs['trivy-release-gate-preview'].strategy;
    const build = namedStep(scheduled, 'trivy-release-gate-preview', 'Build image for scan');
    const scan = namedStep(scheduled, 'trivy-release-gate-preview', 'Scan image with Trivy (scheduled gate)');
    const upload = namedStep(scheduled, 'trivy-release-gate-preview', 'Upload Trivy SARIF');

    expect(strategy?.['fail-fast']).toBe(false);
    expect(strategy?.matrix?.include).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'linux/amd64',
          runner: 'ubuntu-latest',
          sarif_category: 'trivy-scheduled',
        }),
        expect.objectContaining({
          platform: 'linux/arm64',
          runner: 'ubuntu-24.04-arm',
          sarif_category: 'trivy-scheduled-linux-arm64',
        }),
      ]),
    );
    expect(build.with).toMatchObject({
      platforms: githubExpression('matrix.platform'),
      tags: githubExpression('matrix.image'),
    });
    expect(scan.env?.TRIVY_PLATFORM).toBe(githubExpression('matrix.platform'));
    expect(scan.with?.['image-ref']).toBe(githubExpression('matrix.image'));
    expect(upload.if).toBe("always() && steps.build.outcome == 'success'");
    expect(upload.with?.category).toBe(githubExpression('matrix.sarif_category'));

    const smoke = namedStep(scheduled, 'trivy-release-gate-preview', 'Verify runtime packages and native addon');
    expect(smoke.run).toContain('apk list --installed libcrypto3 libssl3');
    expect(smoke.run).toContain('require(\\"better-sqlite3\\")');
    expect(smoke.run).toContain(githubExpression('matrix.platform'));
  });
});
