import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateSummary, parseSuiteResults } from '../../../scripts/ci/collect-test-reliability.mjs';

const FIXTURES_DIR = join(import.meta.dirname, '../../fixtures/test-results');

function loadFixture(name: string) {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf-8'));
}

describe('collect-test-reliability', () => {
  describe('parseSuiteResults', () => {
    it('parses healthy unit results correctly', () => {
      const data = loadFixture('unit-healthy.json');
      const { counts, skipReasons } = parseSuiteResults(data);
      expect(counts.total).toBe(10);
      expect(counts.passed).toBe(10);
      expect(counts.failed).toBe(0);
      expect(counts.skipped).toBe(0);
      expect(skipReasons).toHaveLength(0);
    });

    it('parses mixed integration results with skip reasons', () => {
      const data = loadFixture('integration-mixed.json');
      const { counts, skipReasons } = parseSuiteResults(data);
      expect(counts.passed).toBe(4);
      expect(counts.failed).toBe(2);
      expect(counts.skipped).toBe(5);
      expect(counts.total).toBe(11);
      expect(skipReasons).toContain('SAP system not configured');
      expect(skipReasons).toContain('requires BTP environment');
    });

    it('handles all-skipped suite', () => {
      const data = loadFixture('e2e-all-skipped.json');
      const { counts, skipReasons } = parseSuiteResults(data);
      expect(counts.passed).toBe(0);
      expect(counts.failed).toBe(0);
      expect(counts.skipped).toBe(20);
      expect(counts.total).toBe(20);
      expect(skipReasons).toHaveLength(20);
    });

    it('handles null/undefined data gracefully', () => {
      const { counts } = parseSuiteResults(null);
      expect(counts.total).toBe(0);
      expect(counts.passed).toBe(0);
    });

    it('handles data without testResults array', () => {
      const { counts } = parseSuiteResults({ foo: 'bar' });
      expect(counts.total).toBe(0);
    });
  });

  describe('generateSummary', () => {
    it('generates valid Markdown table format', () => {
      const suiteData = [{ name: 'unit', counts: { total: 100, passed: 100, failed: 0, skipped: 0 }, skipReasons: [] }];
      const summary = generateSummary(suiteData);
      expect(summary).toContain('## Test Reliability Summary');
      expect(summary).toContain('| Suite | Total | Passed | Failed | Skipped | Skip % |');
      expect(summary).toContain('| unit | 100 | 100 | 0 | 0 | 0.0% |');
    });

    it('generates skip reason summary with correct counts', () => {
      const suiteData = [
        {
          name: 'integration',
          counts: { total: 11, passed: 4, failed: 2, skipped: 5 },
          skipReasons: [
            'SAP system not configured',
            'SAP system not configured',
            'SAP system not configured',
            'requires BTP environment',
            'requires BTP environment',
          ],
        },
      ];
      const summary = generateSummary(suiteData);
      expect(summary).toContain('### Top Skipped Tests');
      expect(summary).toContain('| SAP system not configured | 3 |');
      expect(summary).toContain('| requires BTP environment | 2 |');
    });

    it('returns "No test results found." for empty data', () => {
      const summary = generateSummary([]);
      expect(summary).toBe('No test results found.');
    });
  });

  describe('GITHUB_STEP_SUMMARY integration', () => {
    let tempFile: string | undefined;

    afterEach(() => {
      if (tempFile) {
        try {
          unlinkSync(tempFile);
        } catch {
          /* ignore */
        }
        tempFile = undefined;
      }
    });

    it('writes to GITHUB_STEP_SUMMARY file when env var is set', async () => {
      tempFile = join(tmpdir(), `test-step-summary-${Date.now()}.md`);
      writeFileSync(tempFile, '');

      const { execFileSync } = await import('node:child_process');
      execFileSync(
        'node',
        [join(import.meta.dirname, '../../../scripts/ci/collect-test-reliability.mjs'), '--results-dir', FIXTURES_DIR],
        {
          env: { ...process.env, GITHUB_STEP_SUMMARY: tempFile },
          encoding: 'utf-8',
        },
      );

      const content = readFileSync(tempFile, 'utf-8');
      expect(content).toContain('## Test Reliability Summary');
      expect(content).toContain('| unit |');
    });
  });
});
