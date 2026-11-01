import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Job = { name: string; steps: { uses?: string; with?: Record<string, unknown> }[] };

const workflow = parse(
  readFileSync(join(import.meta.dirname, '../../../.github/workflows/dependency-review.yml'), 'utf8'),
) as { permissions: unknown; jobs: Record<string, Job> };

function reviewInputs(job: string) {
  const step = workflow.jobs[job].steps.find((s) => s.uses?.startsWith('actions/dependency-review-action@'));
  return step?.with ?? {};
}

describe('Dependency Review workflow', () => {
  it('stays read-only with immutable action references', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
    }
  });

  it('fails on high vulnerabilities in every dependency scope', () => {
    const inputs = reviewInputs('dependency-review');
    expect(workflow.jobs['dependency-review'].name).toBe('Dependency security');
    expect(inputs['fail-on-severity']).toBe('high');
    expect(inputs['fail-on-scopes']).toBe('runtime, development, unknown');
    // Either of these would quietly switch the check off.
    expect(inputs['warn-only']).toBeUndefined();
    expect(inputs['allow-ghsas']).toBeUndefined();
  });

  it('keeps license findings out of the vulnerability check', () => {
    expect(reviewInputs('dependency-review')['license-check']).toBe(false);
    const licenses = reviewInputs('dependency-licenses');
    expect(licenses['vulnerability-check']).toBe(false);
    expect(licenses['deny-licenses']).toContain('AGPL-3.0');
  });
});
