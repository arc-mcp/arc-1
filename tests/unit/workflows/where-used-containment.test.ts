import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import unit from '../../../vitest.config.js';
import integration from '../../../vitest.integration.config.js';
import slow from '../../../vitest.integration.slow.config.js';
import diagnostic from '../../../vitest.where-used-diagnostic.config.js';
import { PERSISTENT_OBJECTS, readFixture } from '../../e2e/fixtures.js';

const root = join(import.meta.dirname, '../../..');
const workflow = parse(readFileSync(join(root, '.github/workflows/test.yml'), 'utf8'));
const job = workflow.jobs.integration;
const steps = job.steps as Array<Record<string, any>>;
const fresh = steps.find((step) => step.id === 'where_used_diagnostic')!;
const summary = steps.find((step) => step.id === 'where_used_summary')!;

function selected(config: typeof integration) {
  return Array.from(globSync(config.test!.include!, { cwd: root, exclude: config.test!.exclude as string[] }));
}

describe('where-used CI containment', () => {
  it('pins the qualified fixture source and registry entries before any CI job can touch SAP', () => {
    const fixtures = PERSISTENT_OBJECTS.filter((entry) => ['ZIF_ARC1_TEST', 'ZCL_ARC1_TEST'].includes(entry.name)).map(
      (entry) => ({ entry, source: readFixture(entry.fixture).replace(/\r\n/g, '\n').trimEnd() }),
    );
    const digest = createHash('sha256').update(JSON.stringify(fixtures)).digest('hex');
    expect(
      digest,
      'Qualified where-used fixtures changed. Coordinate fixture cutover and SAP requalification before updating this pin.',
    ).toBe('4c7a5a81d81ad7de3cb26c4bbaecf27435c0d27333978b519abb995ae50c89f2');
  });

  it('keeps the stable contract required and runs the original fresh test only in its diagnostic profile', () => {
    const freshPath = 'tests/integration/where-used-fresh-activation.diagnostic.test.ts';
    const stablePath = 'tests/integration/where-used-details.integration.test.ts';
    expect(selected(integration)).toContain(stablePath);
    expect(selected(integration)).not.toContain(freshPath);
    expect(selected(diagnostic)).toEqual([freshPath]);
    expect(selected(slow)).not.toContain(freshPath);
    expect(selected(unit)).not.toContain(freshPath);
  });

  it('preserves required test/skip results and the original cleanup budgets', () => {
    expect(diagnostic.test!.globalSetup ?? []).toEqual([]);
    expect(diagnostic.test!.hookTimeout).toBe(integration.test!.hookTimeout);
    expect(diagnostic.test!.testTimeout).toBe(integration.test!.testTimeout);
    expect(diagnostic.test!.fileParallelism).toBe(false);
    expect(diagnostic.test!.reporters).toContainEqual([
      'json',
      { outputFile: 'test-results/where-used-fresh-activation.json' },
    ]);
    expect(integration.test!.reporters).toContainEqual(['json', { outputFile: 'test-results/integration.json' }]);
  });

  it('keeps required integration gating and limits the new tolerated steps to diagnostic/reporting', () => {
    expect(job['continue-on-error']).toBeUndefined();
    const required = steps.find((step) => step.run === 'npm run test:integration')!;
    expect(required).toBeDefined();
    expect(required['continue-on-error']).toBeUndefined();
    expect(steps.filter((step) => step['continue-on-error']).map((step) => step.id ?? step.name)).toEqual([
      'where_used_diagnostic',
      'where_used_summary',
      'Integration reliability summary',
    ]);
    expect(steps.indexOf(required)).toBeLessThan(steps.indexOf(fresh));
    expect(steps.indexOf(fresh)).toBeLessThan(steps.indexOf(summary));
  });

  it('runs the diagnostic after a required failure, under the same SAP serialization/auth gates', () => {
    expect(fresh.if).toBe('$' + "{{ !cancelled() && steps.sap_auth.outputs.auth_ok == 'true' }}");
    expect(summary.if).toBe(fresh.if);
    expect(fresh.env).toEqual(steps.find((step) => step.run === 'npm run test:integration')!.env);
    expect(job.concurrency.group).toContain('sap-live-a4h');
    expect(fresh['timeout-minutes']).toBe(5);
    // Explicit bash enables pipefail: tee must not turn a failing Vitest run into success.
    expect(fresh.shell).toBe('bash');
    expect(fresh.run).toContain('npm run test:integration:where-used-diagnostic 2>&1 | tee');
  });

  it('reports the actual failed outcome and uploads diagnostic evidence after execution', () => {
    expect(summary.env.DIAGNOSTIC_OUTCOME).toBe('$' + '{{ steps.where_used_diagnostic.outcome }}');
    const upload = steps.find((step) => step.name === 'Upload integration test results')!;
    expect(steps.indexOf(upload)).toBeGreaterThan(steps.indexOf(summary));
    for (const file of [
      'integration.json',
      'integration-skips.ndjson',
      'where-used-diagnostics.json',
      'where-used-fresh-activation.json',
      'where-used-fresh-activation.log',
    ]) {
      expect(upload.with.path).toContain(`test-results/${file}`);
    }
  });
});

import { createHash } from 'node:crypto';
