import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface WorkflowStep {
  env?: Record<string, string>;
  name?: string;
  run?: string;
}

interface WorkflowJob {
  needs?: string[];
  steps: WorkflowStep[];
}

interface ReleaseWorkflow {
  jobs: Record<string, WorkflowJob>;
}

const readReleaseWorkflow = async (): Promise<ReleaseWorkflow> =>
  parse(await readFile('.github/workflows/release.yml', 'utf8')) as ReleaseWorkflow;

const githubExpression = (expression: string): string => `\${{ ${expression} }}`;
const shellVariable = (name: string): string => `\${${name}}`;

describe('release MCP Registry workflow', () => {
  it('waits for both package artifacts before publishing metadata', async () => {
    const workflow = await readReleaseWorkflow();

    expect(workflow.jobs['publish-mcp-registry'].needs).toEqual([
      'release-please',
      'publish-npm',
      'publish-docker-merge',
    ]);
  });

  it('retries while a newly published npm version propagates to the registry validator', async () => {
    const workflow = await readReleaseWorkflow();
    const publish = workflow.jobs['publish-mcp-registry'].steps.find((step) => step.name === 'Publish to MCP Registry');

    expect(publish?.run).toContain('MAX_ATTEMPTS=12');
    expect(publish?.run).toContain('RETRY_DELAY_SECONDS=10');
    expect(publish?.run).toContain('set -uo pipefail');
    expect(publish?.run).toContain('if ./mcp-publisher publish 2>&1 | tee "$PUBLISH_LOG"; then');
    expect(publish?.run).toContain('grep -Fq "A newly published release can take a moment"');
    expect(publish?.run).toContain('failed with a non-retryable error');
    expect(publish?.run).toContain('if (( attempt == MAX_ATTEMPTS )); then');
    expect(publish?.run).toContain('sleep "$RETRY_DELAY_SECONDS"');
    expect(publish?.run).toContain('exit 1');
  });

  it('waits for the exact npm version before obtaining the short-lived registry token', async () => {
    const workflow = await readReleaseWorkflow();
    const steps = workflow.jobs['publish-mcp-registry'].steps;
    const updateIndex = steps.findIndex((step) => step.name === 'Update version in server.json');
    const waitIndex = steps.findIndex((step) => step.name === 'Wait for npm package version');
    const validateIndex = steps.findIndex((step) => step.name === 'Validate server.json');
    const authenticateIndex = steps.findIndex((step) => step.name === 'Authenticate to MCP Registry (GitHub OIDC)');
    const publishIndex = steps.findIndex((step) => step.name === 'Publish to MCP Registry');
    const wait = steps[waitIndex];

    expect(updateIndex).toBeGreaterThanOrEqual(0);
    expect(waitIndex).toBeGreaterThan(updateIndex);
    expect(validateIndex).toBeGreaterThan(waitIndex);
    expect(authenticateIndex).toBeGreaterThan(validateIndex);
    expect(publishIndex).toBeGreaterThan(authenticateIndex);
    expect(wait.env?.RELEASE_VERSION).toBe(githubExpression('needs.release-please.outputs.version'));
    expect(wait.run).toContain('MAX_ATTEMPTS=30');
    expect(wait.run).toContain('RETRY_DELAY_SECONDS=20');
    expect(wait.run).toContain(`https://registry.npmjs.org/arc-1/${shellVariable('RELEASE_VERSION')}`);
    expect(wait.run).toContain(`"${shellVariable('NPM_VERSION_URL')}?attempt=${shellVariable('attempt')}"`);
    expect(wait.run).toContain('.version == $version and .mcpName == $mcp_name');
  });
});
