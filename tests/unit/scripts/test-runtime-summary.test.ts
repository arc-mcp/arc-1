import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectRuntimeData,
  formatDuration,
  generateRuntimeSummary,
  normalizeResultPath,
  parseJunitRuntime,
  parseVitestRuntime,
} from '../../../scripts/ci/test-runtime-summary.mjs';

describe('test-runtime-summary', () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('normalizes absolute result paths to repository test paths', () => {
    expect(normalizeResultPath('/home/runner/work/arc-1/arc-1/tests/e2e/read.e2e.test.ts')).toBe(
      'tests/e2e/read.e2e.test.ts',
    );
    expect(normalizeResultPath('tests/unit/server/http.test.ts')).toBe('tests/unit/server/http.test.ts');
  });

  it('parses Vitest file and case runtimes', () => {
    const data = {
      testResults: [
        {
          assertionResults: [
            {
              ancestorTitles: ['SAPRead'],
              duration: 1200,
              status: 'passed',
              title: 'reads program source',
            },
            {
              ancestorTitles: ['SAPRead'],
              duration: 300,
              status: 'failed',
              title: 'reports missing class',
            },
          ],
          endTime: 5000,
          name: '/home/runner/work/arc-1/arc-1/tests/e2e/read.e2e.test.ts',
          startTime: 3000,
        },
        {
          assertionResults: [
            {
              ancestorTitles: ['Skipped'],
              status: 'pending',
              title: 'backend feature unavailable',
            },
          ],
          name: 'tests/e2e/skipped.e2e.test.ts',
        },
      ],
    };

    const parsed = parseVitestRuntime(data, 'e2e');

    expect(parsed.files).toEqual([
      {
        durationMs: 2000,
        failed: 1,
        file: 'tests/e2e/read.e2e.test.ts',
        skipped: 0,
        suite: 'e2e',
        tests: 2,
      },
    ]);
    expect(parsed.cases).toMatchObject([
      {
        durationMs: 1200,
        file: 'tests/e2e/read.e2e.test.ts',
        status: 'passed',
        suite: 'e2e',
        test: 'SAPRead > reads program source',
      },
      {
        durationMs: 300,
        status: 'failed',
        test: 'SAPRead > reports missing class',
      },
    ]);
  });

  it('parses JUnit testcase runtimes in seconds', () => {
    const cases = parseJunitRuntime(
      `<?xml version="1.0" encoding="UTF-8"?>
      <testsuites>
        <testsuite name="e2e">
          <testcase classname="SAPSearch" name="where-used" time="2.345" />
          <testcase classname="SAPRead" name="program" time="0.500" />
        </testsuite>
      </testsuites>`,
      'junit-results.xml',
    );

    expect(cases).toEqual([
      {
        durationMs: 2345,
        source: 'junit-results.xml',
        suite: 'e2e',
        test: 'SAPSearch > where-used',
      },
      {
        durationMs: 500,
        source: 'junit-results.xml',
        suite: 'e2e',
        test: 'SAPRead > program',
      },
    ]);
  });

  it('generates Markdown with slowest files and test cases', () => {
    const summary = generateRuntimeSummary(
      {
        junitCases: [{ durationMs: 2500, source: 'junit.xml', suite: 'e2e', test: 'SAPRead > source' }],
        vitestCases: [
          {
            durationMs: 1200,
            file: 'tests/e2e/read.e2e.test.ts',
            status: 'passed',
            suite: 'e2e',
            test: 'SAPRead > source',
          },
        ],
        vitestFiles: [
          {
            durationMs: 2000,
            failed: 0,
            file: 'tests/e2e/read.e2e.test.ts',
            skipped: 0,
            suite: 'e2e',
            tests: 3,
          },
        ],
      },
      { topLimit: 5 },
    );

    expect(summary).toContain('## Test Runtime Summary');
    expect(summary).toContain('### Slowest Test Files');
    expect(summary).toContain('| e2e | tests/e2e/read.e2e.test.ts | 2.0s | 3 | 0 | 0 |');
    expect(summary).toContain('### Slowest Vitest Test Cases');
    expect(summary).toContain('### Slowest JUnit Test Cases');
  });

  it('reports no runtime data when artifacts have no durations', () => {
    const summary = generateRuntimeSummary({ junitCases: [], vitestCases: [], vitestFiles: [] });
    expect(summary).toBe('## Test Runtime Summary\n\nNo runtime data found.');
  });

  it('formats durations compactly', () => {
    expect(formatDuration(250)).toBe('250ms');
    expect(formatDuration(1250)).toBe('1.3s');
    expect(formatDuration(65_500)).toBe('1m 5.5s');
  });

  it('collects runtime data from result directories and writes a step summary', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'arc1-runtime-'));
    const resultsDir = join(tempDir, 'test-results');
    const junitDir = join(tempDir, 'junit');
    const stepSummary = join(tempDir, 'summary.md');
    writeFileSync(stepSummary, '');
    rmSync(resultsDir, { recursive: true, force: true });
    rmSync(junitDir, { recursive: true, force: true });
    writeFileSync(join(tempDir, '.keep'), '');
    mkdirSync(resultsDir, { recursive: true });
    mkdirSync(junitDir, { recursive: true });

    writeFileSync(
      join(resultsDir, 'e2e.json'),
      JSON.stringify({
        testResults: [
          {
            assertionResults: [
              { ancestorTitles: ['SAPRead'], duration: 1400, status: 'passed', title: 'reads source' },
            ],
            name: 'tests/e2e/read.e2e.test.ts',
          },
        ],
      }),
    );
    writeFileSync(
      join(junitDir, 'junit-results.xml'),
      '<testsuite name="e2e"><testcase classname="SAPRead" name="reads source" time="1.4"/></testsuite>',
    );

    const runtimeData = collectRuntimeData({ junitDirs: [junitDir], resultsDir });
    expect(runtimeData.vitestFiles[0]).toMatchObject({ durationMs: 1400, suite: 'e2e' });
    expect(runtimeData.junitCases[0]).toMatchObject({ durationMs: 1400, test: 'SAPRead > reads source' });

    execFileSync(
      'node',
      [
        join(import.meta.dirname, '../../../scripts/ci/test-runtime-summary.mjs'),
        '--results-dir',
        resultsDir,
        '--junit-dir',
        junitDir,
      ],
      {
        env: { ...process.env, GITHUB_STEP_SUMMARY: stepSummary },
        encoding: 'utf-8',
      },
    );

    const content = readFileSync(stepSummary, 'utf-8');
    expect(content).toContain('## Test Runtime Summary');
    expect(content).toContain('SAPRead > reads source');
  });
});
