import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Job = {
  needs?: string | string[];
  if?: string;
  uses?: string;
  with?: Record<string, unknown>;
  permissions?: Record<string, string>;
  strategy?: { 'fail-fast'?: boolean; matrix?: { include?: Array<{ target: string; runner: string }> } };
  steps?: Array<{ name?: string; run?: string }>;
};
type Workflow = { permissions?: Record<string, string>; jobs: Record<string, Job> };

async function load(file: string): Promise<Workflow> {
  return parse(await readFile(`.github/workflows/${file}`, 'utf8')) as Workflow;
}

describe('executables workflow', () => {
  it('builds natively on every supported OS/arch and smoke-tests each executable', async () => {
    const build = (await load('executables.yml')).jobs.build;
    const targets = (build.strategy?.matrix?.include ?? []).map((entry) => entry.target).sort();

    expect(targets).toEqual(['linux-arm64', 'linux-x64', 'macos-arm64', 'macos-x64', 'windows-x64']);
    expect(build.strategy?.['fail-fast']).toBe(false);
    const runs = (build.steps ?? []).map((step) => step.run ?? '');
    expect(runs.some((run) => run.includes('scripts/build-sea.mjs'))).toBe(true);
    expect(runs.some((run) => run.includes('scripts/ci/smoke-sea.mjs'))).toBe(true);
  });

  it('only attaches to a release when a tag is passed, with write access limited to that job', async () => {
    const workflow = await load('executables.yml');
    const attach = workflow.jobs['attach-to-release'];

    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(attach.needs).toBe('build');
    expect(attach.if).toContain("inputs.tag != ''");
    expect(attach.permissions).toEqual({ contents: 'write' });
  });

  it('is invoked from the release workflow for the release tag', async () => {
    const job = (await load('release.yml')).jobs['build-executables'];

    expect(job.uses).toBe('./.github/workflows/executables.yml');
    expect(job.needs).toBe('release-please');
    expect(job.with).toEqual({ tag: '$' + '{{ needs.release-please.outputs.tag_name }}' });
    expect(job.permissions).toEqual({ contents: 'write' });
  });
});
