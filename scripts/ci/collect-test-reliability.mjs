#!/usr/bin/env node

/**
 * Parses Vitest JSON result files and produces a Markdown summary table
 * with executed/passed/skipped/failed counts and top skip reasons.
 *
 * Usage: node scripts/ci/collect-test-reliability.mjs [--results-dir <path>]
 * Always exits 0 — reliability reporting must never block builds.
 */

import { readFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SUITES = ['unit', 'integration', 'e2e'];

function parseArgs(argv) {
  const args = argv.slice(2);
  let resultsDir = 'test-results';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--results-dir' && args[i + 1]) {
      resultsDir = args[i + 1];
      i++;
    }
  }
  return { resultsDir: resolve(resultsDir) };
}

export function parseSuiteResults(data) {
  const counts = { total: 0, passed: 0, failed: 0, skipped: 0 };
  const skipReasons = [];

  if (!data || !Array.isArray(data.testResults)) {
    return { counts, skipReasons };
  }

  for (const file of data.testResults) {
    if (!Array.isArray(file.assertionResults)) continue;
    for (const test of file.assertionResults) {
      counts.total++;
      if (test.status === 'passed') {
        counts.passed++;
      } else if (test.status === 'failed') {
        counts.failed++;
      } else if (test.status === 'pending' || test.status === 'skipped') {
        counts.skipped++;
        const reason = test.title || 'unknown';
        skipReasons.push(reason);
      }
    }
  }

  return { counts, skipReasons };
}

export function generateSummary(suiteData) {
  const rows = [];
  const allSkipReasons = [];

  for (const { name, counts, skipReasons } of suiteData) {
    const skipPct = counts.total > 0
      ? ((counts.skipped / counts.total) * 100).toFixed(1)
      : '0.0';
    rows.push(`| ${name} | ${counts.total} | ${counts.passed} | ${counts.failed} | ${counts.skipped} | ${skipPct}% |`);
    for (const reason of skipReasons) {
      allSkipReasons.push({ suite: name, reason });
    }
  }

  if (rows.length === 0) {
    return 'No test results found.';
  }

  const lines = [
    '## Test Reliability Summary',
    '',
    '| Suite | Total | Passed | Failed | Skipped | Skip % |',
    '|-------|-------|--------|--------|---------|--------|',
    ...rows,
  ];

  if (allSkipReasons.length > 0) {
    const reasonCounts = new Map();
    for (const { reason } of allSkipReasons) {
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    }
    const sorted = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]);

    lines.push('', '### Top Skipped Tests', '');
    lines.push('| Reason | Count |');
    lines.push('|--------|-------|');
    for (const [reason, count] of sorted.slice(0, 20)) {
      lines.push(`| ${reason} | ${count} |`);
    }
  }

  return lines.join('\n');
}

function main() {
  const { resultsDir } = parseArgs(process.argv);
  const suiteData = [];

  for (const suite of SUITES) {
    const filePath = join(resultsDir, `${suite}.json`);
    let data;
    try {
      const raw = readFileSync(filePath, 'utf-8');
      data = JSON.parse(raw);
    } catch {
      suiteData.push({
        name: suite,
        counts: { total: 0, passed: 0, failed: 0, skipped: 0 },
        skipReasons: [],
        error: 'no results found',
      });
      continue;
    }

    const { counts, skipReasons } = parseSuiteResults(data);
    suiteData.push({ name: suite, counts, skipReasons });
  }

  const summary = generateSummary(suiteData);
  console.log(summary);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  }
}

// Only run when executed directly, not when imported
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
