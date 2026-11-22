import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { parse } from 'yaml';

const UPSTREAM_ONLY = '$' + "{{ github.repository == 'arc-mcp/arc-1' }}";
const STATUS_CHECK = /\b(?:always|cancelled|failure|success)\s*\(/i;

it.each([
  ['release', 'release-please'],
  ['docker', 'build'],
])('runs every %s job only upstream, including manual dispatch', (workflow, root) => {
  const { jobs } = parse(
    readFileSync(join(import.meta.dirname, `../../../.github/workflows/${workflow}.yml`), 'utf8'),
  ) as {
    jobs: Record<string, { if?: string; needs?: string | string[] }>;
  };

  function isUpstreamOnly(name: string, path: string[] = []): boolean {
    expect(path, `cyclic workflow dependency at ${name}`).not.toContain(name);
    const job = jobs[name];
    expect(job, `missing workflow job ${name}`).toBeDefined();
    if (job.if === UPSTREAM_ONLY) return true;
    // Without an explicit status check, GitHub requires all dependencies to succeed.
    if (!job.needs || STATUS_CHECK.test(job.if ?? '')) return false;
    const needs = typeof job.needs === 'string' ? [job.needs] : job.needs;
    return needs.some((dependency) => isUpstreamOnly(dependency, [...path, name]));
  }

  expect(jobs[root].if).toBe(UPSTREAM_ONLY);
  for (const name of Object.keys(jobs)) {
    expect(isUpstreamOnly(name), `${name} must require the upstream repository`).toBe(true);
  }
});
