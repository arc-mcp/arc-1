/** Pure CI result evaluation and report formatting for direct CLI commands. */

import type { AunitOutcome, AunitSourceSelectionEvidence, AunitSummary } from './adt/aunit.js';
import type { AtcRunResult } from './adt/devtools.js';
import type { CoverageMetric, CoverageSummary } from './adt/types.js';
import { escapeXmlAttr } from './adt/xml-parser.js';
import type { LintResult } from './lint/lint.js';

export type CiExitCode = 0 | 1 | 3;
export type LintFailureThreshold = 'error' | 'warning' | 'info' | 'none';

export interface AunitCiResult {
  outcome: AunitOutcome;
  summary: AunitSummary;
  coverage?: CoverageSummary;
  coverageEvidence?: 'available' | 'unavailable' | 'not_requested';
  coverageUnavailableReason?: string;
  sourceSelectionEvidence?: AunitSourceSelectionEvidence;
  junit?: string;
  [key: string]: unknown;
}

export interface CoverageGates {
  statement?: number;
  branch?: number;
  procedure?: number;
}

export interface AunitPolicy {
  allowEmpty?: boolean;
  failOnSkipped?: boolean;
  requireCoverage?: boolean;
  coverage?: CoverageGates;
}

export interface StructuredDiffResult {
  type: string;
  name: string;
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  identical: boolean;
  hasDifferences: boolean;
  added: number;
  removed: number;
  diff: string;
}

function severityRank(severity: LintResult['severity']): number {
  if (severity === 'error') return 0;
  if (severity === 'warning') return 1;
  return 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasSoundCoverageMetric(metric: unknown): metric is CoverageMetric {
  if (!isRecord(metric)) return false;
  const { executed, total, percent } = metric;
  if (!isNonNegativeInteger(executed) || !isNonNegativeInteger(total) || executed > total) return false;
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) return false;
  if (total === 0) return percent === 0;
  return Math.abs(percent - (executed / total) * 100) < 0.01;
}

function metricGate(metric: CoverageMetric | undefined, minimum: number | undefined): CiExitCode {
  if (minimum === undefined) return 0;
  if (!hasSoundCoverageMetric(metric) || metric.total <= 0) return 3;
  return metric.percent < minimum ? 1 : 0;
}

function hasSoundAunitSourceSelectionEvidence(result: Record<string, unknown>): boolean {
  const evidence = result.sourceSelectionEvidence;
  if (evidence === undefined) return result.outcome === 'failed' || result.outcome === 'incomplete';
  if (!isRecord(evidence) || !['verified', 'unavailable'].includes(String(evidence.status))) return false;
  if (
    !Array.isArray(evidence.declaredTestClasses) ||
    !Array.isArray(evidence.omittedTestClasses) ||
    !Array.isArray(evidence.omittedNonHarmlessTestClasses)
  ) {
    return false;
  }
  const isTestClass = (value: unknown): boolean =>
    isRecord(value) &&
    (value.program === undefined || isNonEmptyString(value.program)) &&
    isNonEmptyString(value.testClass) &&
    ['harmless', 'dangerous', 'critical'].includes(String(value.riskLevel)) &&
    typeof value.explicitRiskLevel === 'boolean';
  if (
    !evidence.declaredTestClasses.every(isTestClass) ||
    !evidence.omittedTestClasses.every(isTestClass) ||
    !evidence.omittedNonHarmlessTestClasses.every(isTestClass)
  ) {
    return false;
  }
  const declared = new Map<string, string>();
  let declaredNonHarmless = false;
  for (const testClass of evidence.declaredTestClasses) {
    const row = testClass as Record<string, unknown>;
    const key = `${row.program === undefined ? '' : String(row.program).toUpperCase()}\u0000${String(row.testClass).toUpperCase()}`;
    if (declared.has(key)) return false;
    declared.set(key, `${row.riskLevel}:${row.explicitRiskLevel}`);
    if (row.riskLevel !== 'harmless') declaredNonHarmless = true;
  }
  const omitted = new Set<string>();
  for (const testClass of evidence.omittedTestClasses) {
    const row = testClass as Record<string, unknown>;
    const key = `${row.program === undefined ? '' : String(row.program).toUpperCase()}\u0000${String(row.testClass).toUpperCase()}`;
    if (omitted.has(key)) return false;
    omitted.add(key);
    if (declared.get(key) !== `${row.riskLevel}:${row.explicitRiskLevel}`) return false;
  }
  const omittedNonHarmless = new Set<string>();
  for (const testClass of evidence.omittedNonHarmlessTestClasses) {
    const row = testClass as Record<string, unknown>;
    const key = `${row.program === undefined ? '' : String(row.program).toUpperCase()}\u0000${String(row.testClass).toUpperCase()}`;
    if (omittedNonHarmless.has(key) || row.riskLevel === 'harmless' || !omitted.has(key)) return false;
    omittedNonHarmless.add(key);
    if (declared.get(key) !== `${row.riskLevel}:${row.explicitRiskLevel}`) return false;
  }
  for (const key of omitted) {
    // The omitted sets must be exact: every omitted declaration agrees with the
    // source audit, and omittedNonHarmless is precisely its non-harmless subset.
    const isNonHarmless = !(declared.get(key) ?? '').startsWith('harmless:');
    if (isNonHarmless !== omittedNonHarmless.has(key)) return false;
  }
  if (evidence.status === 'unavailable' && !isNonEmptyString(evidence.reason)) return false;
  if (evidence.status === 'verified' && evidence.reason !== undefined) return false;
  if (result.outcome === 'passed' || result.outcome === 'no_tests') {
    return (
      evidence.status === 'verified' &&
      omitted.size === 0 &&
      !declaredNonHarmless &&
      (result.outcome !== 'no_tests' || declared.size === 0)
    );
  }
  return true;
}

function hasSoundAunitSummary(result: unknown): result is AunitCiResult {
  if (!isRecord(result) || !['passed', 'failed', 'no_tests', 'incomplete'].includes(String(result.outcome))) {
    return false;
  }
  if (!isRecord(result.summary)) return false;
  const summary = result.summary;
  const counts = [summary.tests, summary.passed, summary.failures, summary.errors, summary.skipped, summary.warnings];
  if (counts.some((count) => !isNonNegativeInteger(count))) return false;

  const tests = summary.tests as number;
  const passed = summary.passed as number;
  const failures = summary.failures as number;
  const errors = summary.errors as number;
  const skipped = summary.skipped as number;
  // Class/setup errors are not method test cases, so `errors` may exceed the number of
  // unclassified methods. It must, however, account for every method not represented by
  // passed/failure/skipped and those three method counters can never exceed the test count.
  const classifiedMethods = passed + failures + skipped;
  if (classifiedMethods > tests || errors < tests - classifiedMethods) return false;
  if (!hasSoundAunitSourceSelectionEvidence(result)) return false;
  if (result.outcome === 'passed') {
    return tests > 0 && failures === 0 && errors === 0 && skipped < tests;
  }
  if (result.outcome === 'no_tests')
    return tests === 0 && passed === 0 && failures === 0 && errors === 0 && skipped === 0;
  return true;
}

/** Domain-aware ABAP Unit exit policy. Incomplete evidence never becomes green. */
export function evaluateAunit(result: AunitCiResult, policy: AunitPolicy = {}): CiExitCode {
  if (!hasSoundAunitSummary(result)) return 3;
  if (result.outcome === 'failed') return 1;
  if (result.outcome === 'incomplete') return 3;
  if (result.outcome === 'no_tests' && !policy.allowEmpty) return 3;
  if (policy.failOnSkipped && result.summary.skipped > 0) return 1;

  if (policy.requireCoverage) {
    const metrics = [result.coverage?.statement, result.coverage?.branch, result.coverage?.procedure];
    if (
      result.coverageEvidence !== 'available' ||
      metrics.some((metric) => !hasSoundCoverageMetric(metric) || metric.total <= 0)
    ) {
      return 3;
    }
  }

  const gates = policy.coverage ?? {};
  const gateResults = [
    metricGate(result.coverage?.statement, gates.statement),
    metricGate(result.coverage?.branch, gates.branch),
    metricGate(result.coverage?.procedure, gates.procedure),
  ];
  if (gateResults.includes(3)) return 3;
  if (gateResults.includes(1)) return 1;
  return 0;
}

/** Fail when an ATC finding is at least as severe as the numeric priority threshold. */
export function evaluateAtc(result: AtcRunResult, maxPriority: number): CiExitCode {
  if (!isRecord(result)) return 3;
  const findings = result.findings;
  const findingsAreSound =
    Array.isArray(findings) &&
    findings.every(
      (finding) =>
        isRecord(finding) &&
        Number.isSafeInteger(finding.priority) &&
        (finding.priority as number) > 0 &&
        typeof finding.checkTitle === 'string' &&
        typeof finding.messageTitle === 'string' &&
        typeof finding.uri === 'string' &&
        isNonNegativeInteger(finding.line) &&
        (finding.quickfixInfo === undefined || typeof finding.quickfixInfo === 'string') &&
        (finding.hasQuickfix === undefined || typeof finding.hasQuickfix === 'boolean'),
    );
  const worklist = result.worklist;
  const worklistIsSound =
    isRecord(worklist) &&
    isNonEmptyString(worklist.id) &&
    worklist.id === result.worklistId &&
    (['timestamp', 'usedObjectSet', 'status'] as const).every(
      (field) => worklist[field] === undefined || typeof worklist[field] === 'string',
    );
  if (
    result.complete !== true ||
    result.truncated !== false ||
    result.objectSetIsComplete !== true ||
    !(result.variant === null || typeof result.variant === 'string') ||
    !isNonNegativeInteger(result.processedObjectCount) ||
    result.processedObjectCount === 0 ||
    !isNonNegativeInteger(result.findingCount) ||
    !findingsAreSound ||
    result.findingCount !== findings.length ||
    !isNonNegativeInteger(result.expectedFindingCount) ||
    result.findingCount !== result.expectedFindingCount ||
    !isNonNegativeInteger(result.maximumVerdicts) ||
    result.maximumVerdicts === 0 ||
    !isNonEmptyString(result.worklistId) ||
    !isNonNegativeInteger(result.runStatusCode) ||
    result.runStatusCode < 200 ||
    result.runStatusCode >= 300 ||
    !Array.isArray(result.incompleteReasons) ||
    result.incompleteReasons.length !== 0 ||
    !worklistIsSound ||
    !Array.isArray(result.infos) ||
    !result.infos.every((info) => typeof info === 'string')
  ) {
    return 3;
  }
  if (!Number.isSafeInteger(maxPriority) || maxPriority < 1 || maxPriority > 3) return 3;
  return findings.some((finding) => (finding.priority as number) <= maxPriority) ? 1 : 0;
}

function isSoundLintIssue(issue: unknown): issue is LintResult {
  if (!isRecord(issue)) return false;
  if (!isNonEmptyString(issue.rule) || typeof issue.message !== 'string') return false;
  if (!['error', 'warning', 'info'].includes(String(issue.severity))) return false;
  const { line, column, endLine, endColumn } = issue;
  if (![line, column, endLine, endColumn].every((coordinate) => isNonNegativeInteger(coordinate))) return false;
  if ((line as number) < 1 || (column as number) < 1 || (endLine as number) < (line as number)) return false;
  return (endLine as number) !== (line as number) || (endColumn as number) >= (column as number);
}

export function evaluateLint(issues: LintResult[], threshold: LintFailureThreshold): CiExitCode {
  if (
    !Array.isArray(issues) ||
    !['error', 'warning', 'info', 'none'].includes(String(threshold)) ||
    !issues.every(isSoundLintIssue)
  ) {
    return 3;
  }
  if (threshold === 'none') return 0;
  const thresholdRank = severityRank(threshold);
  return issues.some((issue) => severityRank(issue.severity) <= thresholdRank) ? 1 : 0;
}

export function evaluateDiff(result: StructuredDiffResult, check: boolean): CiExitCode {
  if (
    !isRecord(result) ||
    !isNonEmptyString(result.type) ||
    !isNonEmptyString(result.name) ||
    !isNonEmptyString(result.from) ||
    !isNonEmptyString(result.to) ||
    !isNonEmptyString(result.fromLabel) ||
    !isNonEmptyString(result.toLabel) ||
    typeof result.identical !== 'boolean' ||
    typeof result.hasDifferences !== 'boolean' ||
    result.identical === result.hasDifferences ||
    !isNonNegativeInteger(result.added) ||
    !isNonNegativeInteger(result.removed) ||
    typeof result.diff !== 'string' ||
    (result.identical && (result.added !== 0 || result.removed !== 0 || result.diff.length !== 0)) ||
    (result.hasDifferences && (result.added + result.removed === 0 || result.diff.length === 0))
  ) {
    return 3;
  }
  return check && result.hasDifferences ? 1 : 0;
}

function coverageLine(name: string, metric: CoverageMetric | undefined): string {
  if (!metric) return `${name}: unavailable`;
  if (metric.total <= 0) return `${name}: non-measurable (0 total)`;
  return `${name}: ${metric.percent.toFixed(2)}% (${metric.executed}/${metric.total})`;
}

export function formatAunitText(result: AunitCiResult): string {
  const lines = [
    `ABAP Unit: ${result.outcome}`,
    `Tests: ${result.summary.tests}, passed: ${result.summary.passed}, failures: ${result.summary.failures}, errors: ${result.summary.errors}, skipped: ${result.summary.skipped}, warnings: ${result.summary.warnings}`,
  ];
  if (result.coverage || result.coverageEvidence === 'unavailable') {
    lines.push(
      coverageLine('Statement coverage', result.coverage?.statement),
      coverageLine('Branch coverage', result.coverage?.branch),
      coverageLine('Procedure coverage', result.coverage?.procedure),
    );
    if (result.coverageUnavailableReason) lines.push(`Coverage evidence: ${result.coverageUnavailableReason}`);
  }
  const sourceEvidence = result.sourceSelectionEvidence;
  if (sourceEvidence) {
    lines.push(`Source-selection audit: ${sourceEvidence.status}`);
    if (sourceEvidence.omittedTestClasses.length > 0) {
      lines.push(
        `Omitted executable classes: ${sourceEvidence.omittedTestClasses
          .map((testClass) => `${testClass.testClass} (${testClass.riskLevel})`)
          .join(', ')}`,
      );
    }
    if (sourceEvidence.reason) lines.push(`Source-selection evidence: ${sourceEvidence.reason}`);
  }
  return lines.join('\n');
}

function atcSeverity(priority: number): 'error' | 'warning' | 'info' {
  if (priority <= 1) return 'error';
  if (priority === 2) return 'warning';
  return 'info';
}

function sourcePath(uri: string, fallback: string): string {
  const path = uri.split('#', 1)[0]?.trim();
  return path || fallback;
}

function checkstyleError(attributes: {
  line: number;
  column?: number;
  severity: string;
  message: string;
  source: string;
}): string {
  return `<error line="${Math.max(0, attributes.line)}" column="${Math.max(0, attributes.column ?? 0)}" severity="${escapeXmlAttr(attributes.severity)}" message="${escapeXmlAttr(attributes.message)}" source="${escapeXmlAttr(attributes.source)}"/>`;
}

function groupCheckstyle<T>(rows: T[], fileFor: (row: T) => string, errorFor: (row: T) => string): string {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const file = fileFor(row);
    groups.set(file, [...(groups.get(file) ?? []), row]);
  }
  const files = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([file, entries]) =>
        `<file name="${escapeXmlAttr(file)}">${entries.map((entry) => errorFor(entry)).join('')}</file>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><checkstyle version="10.0">${files}</checkstyle>`;
}

/** Priority mapping: 1=error, 2=warning, 3+=info. */
export function atcToCheckstyle(result: AtcRunResult): string {
  return groupCheckstyle(
    result.findings,
    (finding) => sourcePath(finding.uri, `atc:${result.worklistId}`),
    (finding) =>
      checkstyleError({
        line: finding.line,
        severity: atcSeverity(finding.priority),
        message: finding.messageTitle,
        source: finding.checkTitle || 'SAP.ATC',
      }),
  );
}

export function lintToCheckstyle(issues: LintResult[], filename: string): string {
  return groupCheckstyle(
    issues,
    () => filename,
    (issue) =>
      checkstyleError({
        line: issue.line,
        column: issue.column,
        severity: issue.severity,
        message: issue.message,
        source: `abaplint.${issue.rule}`,
      }),
  );
}

export function formatAtcText(result: AtcRunResult): string {
  const lines = [
    `ATC worklist ${result.worklistId}: ${result.findingCount} finding(s), ${result.processedObjectCount} object(s), complete=${result.complete}`,
  ];
  for (const finding of result.findings) {
    lines.push(
      `${finding.uri || '(no source)'}:${finding.line} [P${finding.priority}] ${finding.checkTitle}: ${finding.messageTitle}`,
    );
  }
  lines.push(...result.incompleteReasons.map((reason) => `Incomplete: ${reason}`));
  return lines.join('\n');
}

export function formatLintText(issues: LintResult[]): string {
  if (issues.length === 0) return 'No issues found.';
  return issues
    .map((issue) => `${issue.line}:${issue.column} [${issue.severity}] ${issue.rule}: ${issue.message}`)
    .join('\n');
}

export function assertPercent(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`${optionName} must be a number between 0 and 100.`);
  }
  return parsed;
}

export function assertAtcPriority(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3) {
    throw new Error('--max-priority must be an integer from 1 (error) to 3 (info).');
  }
  return parsed;
}
