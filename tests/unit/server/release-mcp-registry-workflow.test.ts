import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface WorkflowStep {
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
});
