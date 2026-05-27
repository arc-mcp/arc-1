import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW = readFileSync(join(import.meta.dirname, '../../../.github/workflows/test.yml'), 'utf8');

function jobBlock(jobName: string): string {
  const match = WORKFLOW.match(new RegExp(`\\n  ${jobName}:\\n([\\s\\S]*?)(?=\\n  [a-zA-Z0-9_-]+:\\n|\\n$)`));
  if (!match) throw new Error(`Job ${jobName} not found`);
  return match[1];
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

  it('keeps SAP-heavy jobs behind the gate and unit job', () => {
    const integrationJob = jobBlock('integration');
    const e2eJob = jobBlock('e2e');

    expect(integrationJob).toContain('needs: [test, gate]');
    expect(integrationJob).toContain("needs.gate.result == 'success'");
    expect(integrationJob).toContain("needs.test.result == 'success'");

    expect(e2eJob).toContain('needs: [test, gate, integration]');
    expect(e2eJob).toContain("needs.gate.result == 'success'");
    expect(e2eJob).toContain("needs.test.result == 'success'");
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
