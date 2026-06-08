#!/usr/bin/env node

/**
 * Parses Vitest JSON and JUnit result artifacts and produces a Markdown runtime
 * summary for CI step summaries.
 *
 * Usage:
 *   node scripts/ci/test-runtime-summary.mjs \
 *     --results-dir test-results \
 *     --junit-dir downloaded-junit
 *
 * Always exits 0 - runtime telemetry must never block builds.
 */

import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { XMLParser } from 'fast-xml-parser';

const DEFAULT_TOP_LIMIT = 15;
const VITEST_STATUS_SKIPPED = new Set(['pending', 'skipped', 'todo']);

function parseArgs(argv) {
  const args = argv.slice(2);
  let resultsDir = 'test-results';
  const junitDirs = [];
  let topLimit = DEFAULT_TOP_LIMIT;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--results-dir' && args[i + 1]) {
      resultsDir = args[++i];
    } else if (arg === '--junit-dir' && args[i + 1]) {
      junitDirs.push(args[++i]);
    } else if (arg === '--top' && args[i + 1]) {
      const parsed = Number.parseInt(args[++i], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        topLimit = parsed;
      }
    }
  }

  return {
    junitDirs: junitDirs.map((dir) => resolve(dir)),
    resultsDir: resolve(resultsDir),
    topLimit,
  };
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function escapeMarkdownCell(value) {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ');
}

export function normalizeResultPath(value) {
  const normalized = String(value ?? '').replaceAll('\\', '/');
  const testsIndex = normalized.lastIndexOf('/tests/');
  if (testsIndex >= 0) return normalized.slice(testsIndex + 1);
  if (normalized.startsWith('tests/')) return normalized;
  return normalized || 'unknown';
}

function durationFromValue(value) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function fileDurationMs(file, assertionResults) {
  const startTime = Number(file.startTime);
  const endTime = Number(file.endTime);
  if (Number.isFinite(startTime) && Number.isFinite(endTime) && endTime > startTime) {
    return endTime - startTime;
  }
  return assertionResults.reduce((sum, test) => sum + durationFromValue(test.duration), 0);
}

function testDisplayName(test) {
  if (typeof test.fullName === 'string' && test.fullName.length > 0) {
    return test.fullName;
  }
  const ancestors = Array.isArray(test.ancestorTitles) ? test.ancestorTitles : [];
  const title = typeof test.title === 'string' ? test.title : 'unknown test';
  return [...ancestors, title].filter(Boolean).join(' > ');
}

function suiteNameFromFile(filePath) {
  const name = basename(filePath, '.json');
  return name || 'unknown';
}

export function parseVitestRuntime(data, suiteName = 'unknown') {
  const files = [];
  const cases = [];

  if (!data || !Array.isArray(data.testResults)) {
    return { cases, files };
  }

  for (const file of data.testResults) {
    const assertionResults = Array.isArray(file.assertionResults) ? file.assertionResults : [];
    const durationMs = fileDurationMs(file, assertionResults);
    const skipped = assertionResults.filter((test) => VITEST_STATUS_SKIPPED.has(test.status)).length;
    const failed = assertionResults.filter((test) => test.status === 'failed').length;
    const filePath = normalizeResultPath(file.name);

    if (durationMs > 0) {
      files.push({
        durationMs,
        failed,
        file: filePath,
        skipped,
        suite: suiteName,
        tests: assertionResults.length,
      });
    }

    for (const test of assertionResults) {
      const testDurationMs = durationFromValue(test.duration);
      if (testDurationMs === 0) continue;
      cases.push({
        durationMs: testDurationMs,
        file: filePath,
        status: test.status || 'unknown',
        suite: suiteName,
        test: testDisplayName(test),
      });
    }
  }

  return { cases, files };
}

function collectFiles(dir, predicate) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir)) {
    const filePath = join(dir, entry);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      files.push(...collectFiles(filePath, predicate));
    } else if (predicate(filePath)) {
      files.push(filePath);
    }
  }
  return files;
}

function collectVitestResults(resultsDir) {
  const files = collectFiles(resultsDir, (filePath) => filePath.endsWith('.json'));
  return files.flatMap((filePath) => {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      const suite = suiteNameFromFile(filePath);
      const parsed = parseVitestRuntime(data, suite);
      return [{ filePath, ...parsed }];
    } catch {
      return [];
    }
  });
}

function collectTestSuites(node) {
  const suites = [];
  for (const suite of asArray(node)) {
    suites.push(suite);
    for (const nested of collectTestSuites(suite.testsuite)) {
      suites.push(nested);
    }
  }
  return suites;
}

export function parseJunitRuntime(raw, source = 'junit') {
  const parser = new XMLParser({
    attributeNamePrefix: '',
    ignoreAttributes: false,
  });
  const parsed = parser.parse(raw);
  const roots = [
    ...collectTestSuites(parsed?.testsuites?.testsuite),
    ...collectTestSuites(parsed?.testsuite),
  ];
  const cases = [];

  for (const suite of roots) {
    const suiteName = suite.name || source;
    for (const testCase of asArray(suite.testcase)) {
      const durationMs = durationFromValue(testCase.time) * 1000;
      if (durationMs === 0) continue;
      const testName = [testCase.classname, testCase.name].filter(Boolean).join(' > ') || 'unknown test';
      cases.push({
        durationMs,
        source,
        suite: suiteName,
        test: testName,
      });
    }
  }

  return cases;
}

function collectJunitResults(junitDirs) {
  return junitDirs.flatMap((dir) => {
    const files = collectFiles(dir, (filePath) => filePath.endsWith('.xml'));
    return files.flatMap((filePath) => {
      try {
        const raw = readFileSync(filePath, 'utf-8');
        return parseJunitRuntime(raw, normalizeResultPath(relative(dir, filePath) || basename(filePath)));
      } catch {
        return [];
      }
    });
  });
}

function sortByDurationDesc(items) {
  return [...items].sort((a, b) => b.durationMs - a.durationMs);
}

export function collectRuntimeData({ junitDirs = [], resultsDir = 'test-results' } = {}) {
  const vitestResults = collectVitestResults(resolve(resultsDir));
  return {
    junitCases: sortByDurationDesc(collectJunitResults(junitDirs.map((dir) => resolve(dir)))),
    vitestCases: sortByDurationDesc(vitestResults.flatMap((result) => result.cases)),
    vitestFiles: sortByDurationDesc(vitestResults.flatMap((result) => result.files)),
  };
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;

  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}m ${seconds.toFixed(1)}s`;
}

export function generateRuntimeSummary(runtimeData, { topLimit = DEFAULT_TOP_LIMIT } = {}) {
  const vitestFiles = runtimeData?.vitestFiles ?? [];
  const vitestCases = runtimeData?.vitestCases ?? [];
  const junitCases = runtimeData?.junitCases ?? [];

  const lines = ['## Test Runtime Summary'];
  if (vitestFiles.length === 0 && vitestCases.length === 0 && junitCases.length === 0) {
    lines.push('', 'No runtime data found.');
    return lines.join('\n');
  }

  if (vitestFiles.length > 0) {
    lines.push('', '### Slowest Test Files', '');
    lines.push('| Suite | File | Runtime | Tests | Failed | Skipped |');
    lines.push('|-------|------|---------|-------|--------|---------|');
    for (const file of vitestFiles.slice(0, topLimit)) {
      lines.push(
        `| ${escapeMarkdownCell(file.suite)} | ${escapeMarkdownCell(file.file)} | ${formatDuration(file.durationMs)} | ${file.tests} | ${file.failed} | ${file.skipped} |`,
      );
    }
  }

  if (vitestCases.length > 0) {
    lines.push('', '### Slowest Vitest Test Cases', '');
    lines.push('| Suite | Test | File | Runtime | Status |');
    lines.push('|-------|------|------|---------|--------|');
    for (const testCase of vitestCases.slice(0, topLimit)) {
      lines.push(
        `| ${escapeMarkdownCell(testCase.suite)} | ${escapeMarkdownCell(testCase.test)} | ${escapeMarkdownCell(testCase.file)} | ${formatDuration(testCase.durationMs)} | ${escapeMarkdownCell(testCase.status)} |`,
      );
    }
  }

  if (junitCases.length > 0) {
    lines.push('', '### Slowest JUnit Test Cases', '');
    lines.push('| Source | Test | Runtime |');
    lines.push('|--------|------|---------|');
    for (const testCase of junitCases.slice(0, topLimit)) {
      lines.push(
        `| ${escapeMarkdownCell(testCase.source)} | ${escapeMarkdownCell(testCase.test)} | ${formatDuration(testCase.durationMs)} |`,
      );
    }
  }

  return lines.join('\n');
}

function main() {
  try {
    const { junitDirs, resultsDir, topLimit } = parseArgs(process.argv);
    const runtimeData = collectRuntimeData({ junitDirs, resultsDir });
    const summary = generateRuntimeSummary(runtimeData, { topLimit });
    console.log(summary);

    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
    }
  } catch (err) {
    console.warn(`Runtime summary skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
