/** ABAP Unit result semantics and the public async/JUnit API. */

import { AdtApiError, AdtNetworkError } from './errors.js';
import type { AdtHttpClient, AdtRequestOptions } from './http.js';
import { assertCanonicalHostRelativeAdtPath } from './path-safety.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import type { CoverageSummary } from './types.js';
import { decodeXmlEntities, escapeXmlAttr, findDeepNodes, getNestedArray, parseXml } from './xml-parser.js';

export type AunitOutcome = 'passed' | 'failed' | 'no_tests' | 'incomplete';
export type AunitTestStatus = 'passed' | 'failed' | 'error' | 'skipped';
export type AunitAlertScope = 'run' | 'program' | 'class' | 'method';

export interface AunitStackEntry {
  uri?: string;
  type?: string;
  name?: string;
  description?: string;
}

export interface AunitAlert {
  scope: AunitAlertScope;
  program?: string;
  testClass?: string;
  testMethod?: string;
  kind: string;
  severity: string;
  title: string;
  details: string[];
  message: string;
  stack: AunitStackEntry[];
}

export interface AunitTestCase {
  program: string;
  testClass: string;
  testMethod: string;
  status: AunitTestStatus;
  durationMs?: number;
  riskLevel?: string;
  durationCategory?: string;
  alerts: AunitAlert[];
}

export interface AunitSummary {
  tests: number;
  passed: number;
  failures: number;
  errors: number;
  skipped: number;
  warnings: number;
}

export interface AunitRunResult {
  outcome: AunitOutcome;
  summary: AunitSummary;
  selection: {
    maxRisk: 'harmless';
    durations: Array<'short' | 'medium' | 'long'>;
  };
  tests: AunitTestCase[];
  alerts: AunitAlert[];
  coverage?: CoverageSummary;
  coverageEvidence?: 'available' | 'unavailable' | 'not_requested';
  coverageUnavailableReason?: 'measurement_not_reported' | 'request_failed' | 'no_valid_metrics';
  sourceSelectionEvidence?: AunitSourceSelectionEvidence;
}

export type AunitDeclaredRiskLevel = 'harmless' | 'dangerous' | 'critical';

export interface AunitSourceTestClass {
  program?: string;
  testClass: string;
  riskLevel: AunitDeclaredRiskLevel;
  explicitRiskLevel: boolean;
}

export interface AunitSourceSelectionEvidence {
  status: 'verified' | 'unavailable';
  declaredTestClasses: AunitSourceTestClass[];
  omittedTestClasses: AunitSourceTestClass[];
  omittedNonHarmlessTestClasses: AunitSourceTestClass[];
  reason?: string;
}

export interface AunitSourceAuditOptions {
  complete?: boolean;
  incompleteReason?: string;
}

export interface AunitProgramSource {
  program: string;
  source: string;
}

export interface NativeJunitSummary {
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  outcome: AunitOutcome;
}

export interface PublicAunitResult {
  protocol: 'public-api';
  runPath: string;
  resultPath: string;
  status: string;
  junit: string;
  summary: NativeJunitSummary;
  elapsedMs: number;
  polls: number;
}

export class AunitIncompleteError extends Error {
  constructor(
    message: string,
    readonly evidence: { elapsedMs: number; polls: number; status: string },
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AunitIncompleteError';
  }
}

interface PublicAunitOptions {
  timeoutMs?: number;
  deadline?: number;
  signal?: AbortSignal;
  includeSubpackages?: boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_PUBLIC_AUNIT_TIMEOUT_MS = 300_000;

const PUBLIC_RUNS = '/sap/bc/adt/api/abapunit/runs/';
const PUBLIC_RESULTS = '/sap/bc/adt/api/abapunit/results/';
const ZERO_RUN_ID = '00000000000000000000000000000000';
const RUN_STATUS_ACCEPT = 'application/vnd.sap.adt.api.abapunit.run-status.v1+xml';
const RUN_CONTENT_TYPE = 'application/vnd.sap.adt.api.abapunit.run.v2+xml';
const JUNIT_ACCEPT = 'application/vnd.sap.adt.api.junit.run-result.v1+xml';

function nodeArray(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== 'object') return [];
  return (Array.isArray(value) ? value : [value]).filter(
    (entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry),
  );
}

function nodeText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return String((value as Record<string, unknown>)['#text'] ?? '');
  }
  return String(value);
}

function collectDetails(node: Record<string, unknown>): string[] {
  const result: string[] = [];
  for (const detail of getNestedArray(node, 'details', 'detail')) {
    const text = String(detail['@_text'] ?? '').trim();
    if (text) result.push(decodeXmlEntities(text));
    result.push(...collectDetails(detail));
  }
  return result;
}

function parseAlert(
  node: Record<string, unknown>,
  scope: AunitAlertScope,
  context: { program?: string; testClass?: string; testMethod?: string },
): AunitAlert {
  const title = decodeXmlEntities(nodeText(node.title)).trim();
  const details = collectDetails(node);
  const message = [title, ...details].filter(Boolean).join(' — ');
  const stack = getNestedArray(node, 'stack', 'stackEntry').map((entry) => ({
    ...(entry['@_uri'] ? { uri: String(entry['@_uri']) } : {}),
    ...(entry['@_type'] ? { type: String(entry['@_type']) } : {}),
    ...(entry['@_name'] ? { name: String(entry['@_name']) } : {}),
    ...(entry['@_description'] ? { description: decodeXmlEntities(String(entry['@_description'])) } : {}),
  }));
  return {
    scope,
    ...context,
    kind: String(node['@_kind'] ?? ''),
    severity: String(node['@_severity'] ?? ''),
    title,
    details,
    message,
    stack,
  };
}

function isRiskRefusal(alert: AunitAlert): boolean {
  return /risk level.+exceeds|upper limit.+risk|no execution.+risk/i.test(alert.message);
}

function isWarning(alert: AunitAlert): boolean {
  return alert.kind.toLowerCase() === 'warning' || alert.severity.toLowerCase() === 'tolerable';
}

function isInfrastructureError(alert: AunitAlert): boolean {
  const kind = alert.kind.toLowerCase();
  if (kind === 'failedassertion') return alert.scope !== 'method';
  if (['exception', 'error', 'fatal', 'generationerror'].includes(kind)) return true;
  return alert.severity.toLowerCase() === 'critical' && !isWarning(alert);
}

function methodStatus(alerts: AunitAlert[]): AunitTestStatus {
  if (alerts.some((alert) => alert.kind.toLowerCase() === 'failedassertion')) return 'failed';
  if (alerts.some((alert) => isRiskRefusal(alert) || /skip|abortion|not executed/i.test(alert.kind))) return 'skipped';
  if (alerts.some((alert) => isInfrastructureError(alert))) return 'error';
  return 'passed';
}

function durationMs(method: Record<string, unknown>): number | undefined {
  const raw = Number(method['@_executionTime']);
  if (!Number.isFinite(raw) || raw < 0) return undefined;
  const unit = String(method['@_unit'] ?? 's').toLowerCase();
  if (unit === 'ms' || unit === 'millisecond' || unit === 'milliseconds') return raw;
  if (unit === 'us' || unit === 'µs') return raw / 1000;
  return raw * 1000;
}

interface AbapStatementScan {
  statements: string[][];
  complete: boolean;
  reason?: string;
}

function skipAbapQuotedLiteral(source: string, start: number, delimiter: "'" | '`'): number | undefined {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === delimiter) {
      if (source[index + 1] === delimiter) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return undefined;
}

/** Skip an ABAP pragma (`##NAME` or `##NAME[...]`) without exposing its payload as code tokens. */
function skipAbapPragma(source: string, start: number): number | undefined {
  let index = start + 2;
  const nameStart = index;
  while (index < source.length && /[A-Za-z0-9_/$%-]/.test(source[index]!)) index += 1;
  if (index === nameStart) return undefined;

  // ABAP permits any number of adjacent parameter groups: ##PRAGMA[one][two].
  while (source[index] === '[') {
    let depth = 1;
    index += 1;
    while (index < source.length && depth > 0) {
      const char = source[index]!;
      if (char === "'" || char === '`') {
        const afterLiteral = skipAbapQuotedLiteral(source, index, char);
        if (afterLiteral === undefined) return undefined;
        index = afterLiteral;
      } else if (char === '[') {
        depth += 1;
        index += 1;
      } else if (char === ']') {
        depth -= 1;
        index += 1;
      } else {
        index += 1;
      }
    }
    if (depth > 0) return undefined;
  }
  return index;
}

/** Skip one ABAP string template, including nested templates/literals in `{ ... }` expressions. */
function skipAbapTemplate(source: string, start: number): number | undefined {
  let index = start + 1;
  let expressionDepth = 0;
  while (index < source.length) {
    const char = source[index]!;
    if (expressionDepth === 0) {
      if (char === '\\') {
        index += 2;
      } else if (char === '{') {
        expressionDepth = 1;
        index += 1;
      } else if (char === '|') {
        return index + 1;
      } else {
        index += 1;
      }
      continue;
    }

    const atColumnZero = index === 0 || source[index - 1] === '\n' || source[index - 1] === '\r';
    if (atColumnZero && char === '*') {
      while (index < source.length && source[index] !== '\n') index += 1;
    } else if (char === '#' && source[index + 1] === '#') {
      const afterPragma = skipAbapPragma(source, index);
      if (afterPragma === undefined) return undefined;
      index = afterPragma;
    } else if (char === "'" || char === '`') {
      const afterLiteral = skipAbapQuotedLiteral(source, index, char);
      if (afterLiteral === undefined) return undefined;
      index = afterLiteral;
    } else if (char === '|') {
      const afterTemplate = skipAbapTemplate(source, index);
      if (afterTemplate === undefined) return undefined;
      index = afterTemplate;
    } else if (char === '"') {
      while (index < source.length && source[index] !== '\n') index += 1;
    } else if (char === '{') {
      expressionDepth += 1;
      index += 1;
    } else if (char === '}') {
      expressionDepth -= 1;
      index += 1;
    } else {
      index += 1;
    }
  }
  return undefined;
}

/**
 * Tokenize complete ABAP statements while discarding comments and literals. This implements only
 * the lexical boundary needed by the source audit; malformed/unterminated source is reported so it
 * cannot silently become verified evidence.
 */
function abapStatements(source: string): AbapStatementScan {
  const statements: string[][] = [];
  let tokens: string[] = [];
  let index = 0;
  let atColumnZero = true;

  const finishStatement = (): void => {
    if (tokens.length > 0) statements.push(tokens);
    tokens = [];
  };

  while (index < source.length) {
    const char = source[index]!;
    if (char === '\r' || char === '\n') {
      atColumnZero = true;
      index += 1;
      continue;
    }
    if (/\s/.test(char)) {
      atColumnZero = false;
      index += 1;
      continue;
    }
    if (atColumnZero && char === '*') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    atColumnZero = false;
    if (char === '"') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === "'" || char === '`') {
      const afterLiteral = skipAbapQuotedLiteral(source, index, char);
      if (afterLiteral === undefined) {
        return { statements, complete: false, reason: 'The inspected ABAP source ended inside a text literal.' };
      }
      index = afterLiteral;
      continue;
    }
    if (char === '|') {
      const afterTemplate = skipAbapTemplate(source, index);
      if (afterTemplate === undefined) {
        return { statements, complete: false, reason: 'The inspected ABAP source ended inside a string template.' };
      }
      index = afterTemplate;
      continue;
    }
    if (char === '#' && source[index + 1] === '#') {
      const afterPragma = skipAbapPragma(source, index);
      if (afterPragma === undefined) {
        return { statements, complete: false, reason: 'The inspected ABAP source contained a malformed pragma.' };
      }
      index = afterPragma;
      continue;
    }
    if (char === '.') {
      finishStatement();
      index += 1;
      continue;
    }
    if (/[A-Za-z_/$%]/.test(char)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_/$%-]/.test(source[index]!)) index += 1;
      tokens.push(source.slice(start, index));
      continue;
    }
    if (char === '(' || char === ')' || char === ':' || char === ',') {
      tokens.push(char);
      index += 1;
      continue;
    }
    index += 1;
  }
  if (tokens.length > 0) {
    return { statements, complete: false, reason: 'The inspected ABAP source ended inside a statement.' };
  }
  return { statements, complete: true };
}

function adjacentTokens(tokens: string[], first: string, second: string, start = 0): number {
  for (let index = start; index < tokens.length - 1; index += 1) {
    if (tokens[index] === first && tokens[index + 1] === second) return index;
  }
  return -1;
}

interface AunitClassCandidate extends AunitSourceTestClass {
  abstract: boolean;
  baseClass?: string;
  globalTestClass: boolean;
  ownTestMethods: string[];
}

interface AunitSourceDeclarationScan {
  testClasses: AunitSourceTestClass[];
  complete: boolean;
  reason?: string;
}

const GLOBAL_AUNIT_NON_TEST_METHODS = new Set([
  'CLASS_CONSTRUCTOR',
  'CLASS_SETUP',
  'CLASS_TEARDOWN',
  'CONSTRUCTOR',
  'SETUP',
  'TEARDOWN',
]);

function testMethodsInDefinition(statements: string[][], globalTestClass: boolean): string[] {
  const methods = new Set<string>();
  for (const statement of statements) {
    const upper = statement.map((token) => token.toUpperCase());
    if (upper[0] !== 'METHODS' && upper[0] !== 'CLASS-METHODS') continue;
    const segments: string[][] = [[]];
    for (const token of statement.slice(1)) {
      if (token === ',') segments.push([]);
      else if (token !== ':') segments.at(-1)!.push(token);
    }
    for (const segment of segments) {
      const segmentUpper = segment.map((token) => token.toUpperCase());
      const method = segmentUpper[0];
      if (!method) continue;
      const explicitLocalTest = adjacentTokens(segmentUpper, 'FOR', 'TESTING') >= 0;
      const implicitGlobalTest =
        globalTestClass && upper[0] === 'METHODS' && !GLOBAL_AUNIT_NON_TEST_METHODS.has(method);
      if (explicitLocalTest || implicitGlobalTest) methods.add(method);
    }
  }
  return [...methods];
}

function inspectSourceDeclaredAunitClasses(source: string): AunitSourceDeclarationScan {
  const scan = abapStatements(source);
  const macroNames = new Set(
    scan.statements
      .filter((statement) => statement[0]?.toUpperCase() === 'DEFINE' && statement[1])
      .map((statement) => statement[1]!.toUpperCase()),
  );
  const candidates = new Map<string, AunitClassCandidate>();
  let complete = scan.complete;
  let reason = scan.reason;

  for (let index = 0; index < scan.statements.length; index += 1) {
    const statement = scan.statements[index]!;
    const upper = statement.map((token) => token.toUpperCase());
    if (upper[0] !== 'CLASS' || !statement[1] || upper[2] !== 'DEFINITION' || upper.includes('DEFERRED')) {
      continue;
    }
    if (adjacentTokens(upper, 'FOR', 'TESTING', 3) < 0) continue;

    let end = index + 1;
    while (end < scan.statements.length && scan.statements[end]?.[0]?.toUpperCase() !== 'ENDCLASS') end += 1;
    if (end >= scan.statements.length) {
      complete = false;
      reason = `The FOR TESTING definition of ${statement[1].toUpperCase()} had no matching ENDCLASS.`;
      break;
    }

    const risk = adjacentTokens(upper, 'RISK', 'LEVEL', 3);
    const declaredRisk = risk >= 0 ? upper[risk + 2] : undefined;
    // SAP Learning's "Implementing Code Tests with ABAP Unit" documents CRITICAL as the
    // default when RISK LEVEL is omitted.
    const riskLevel: AunitDeclaredRiskLevel =
      declaredRisk === 'HARMLESS' || declaredRisk === 'DANGEROUS'
        ? (declaredRisk.toLowerCase() as AunitDeclaredRiskLevel)
        : 'critical';
    const inheritance = adjacentTokens(upper, 'INHERITING', 'FROM', 3);
    const testClass = statement[1].toUpperCase();
    // `PUBLIC` immediately after DEFINITION identifies a global test class. Its instance methods
    // are implicit ABAP Unit methods even without a method-level FOR TESTING addition.
    const globalTestClass = upper[3] === 'PUBLIC';
    const definitionStatements = scan.statements.slice(index + 1, end);
    const macroInvocation = definitionStatements.find((tokens) => macroNames.has(tokens[0]?.toUpperCase() ?? ''));
    if (macroInvocation) {
      complete = false;
      reason ??= `The FOR TESTING definition of ${testClass} invokes ABAP macro ${macroInvocation[0]!.toUpperCase()}; expanded test methods could not be verified.`;
    }
    candidates.set(testClass, {
      testClass,
      riskLevel,
      explicitRiskLevel: declaredRisk === 'HARMLESS' || declaredRisk === 'DANGEROUS' || declaredRisk === 'CRITICAL',
      abstract: upper.includes('ABSTRACT'),
      ...(inheritance >= 0 && upper[inheritance + 2] ? { baseClass: upper[inheritance + 2] } : {}),
      globalTestClass,
      ownTestMethods: testMethodsInDefinition(definitionStatements, globalTestClass),
    });
    index = end;
  }

  const riskRank: Record<AunitDeclaredRiskLevel, number> = { harmless: 0, dangerous: 1, critical: 2 };
  const resolve = (
    candidate: AunitClassCandidate,
    seen = new Set<string>(),
  ): { hasTests: boolean; riskLevel: AunitDeclaredRiskLevel; unknownBase?: string } => {
    if (seen.has(candidate.testClass)) {
      return { hasTests: false, riskLevel: candidate.riskLevel, unknownBase: candidate.testClass };
    }
    seen.add(candidate.testClass);
    const base = candidate.baseClass ? candidates.get(candidate.baseClass) : undefined;
    const inherited = base ? resolve(base, seen) : undefined;
    return {
      hasTests: candidate.ownTestMethods.length > 0 || inherited?.hasTests === true,
      riskLevel:
        inherited && riskRank[inherited.riskLevel] > riskRank[candidate.riskLevel]
          ? inherited.riskLevel
          : candidate.riskLevel,
      ...(candidate.baseClass && !base
        ? { unknownBase: candidate.baseClass }
        : inherited?.unknownBase
          ? { unknownBase: inherited.unknownBase }
          : {}),
    };
  };

  const testClasses: AunitSourceTestClass[] = [];
  for (const candidate of candidates.values()) {
    const resolved = resolve(candidate);
    if (!candidate.abstract && !resolved.hasTests && resolved.unknownBase) {
      complete = false;
      reason ??= `The concrete FOR TESTING class ${candidate.testClass} inherits from source-external ${resolved.unknownBase}; inherited ABAP Unit methods could not be verified.`;
      continue;
    }
    // FOR TESTING is also valid for test doubles/helpers. Only concrete classes with a direct or
    // source-visible inherited test method declaration are executable test classes. A global test
    // class's ordinary instance methods are implicit ABAP Unit methods.
    if (!candidate.abstract && resolved.hasTests) {
      testClasses.push({
        testClass: candidate.testClass,
        riskLevel: resolved.riskLevel,
        explicitRiskLevel: candidate.explicitRiskLevel,
      });
    }
  }
  return { testClasses, complete, ...(reason ? { reason } : {}) };
}

/** Find executable, non-deferred ABAP Unit class definitions without matching comments/literals. */
export function findSourceDeclaredAunitClasses(source: string): AunitSourceTestClass[] {
  return inspectSourceDeclaredAunitClasses(source).testClasses;
}

/** Static INCLUDE names used to expand program source before auditing test declarations. */
export function findStaticAbapIncludes(source: string): string[] {
  const names = new Set<string>();
  for (const statement of abapStatements(source).statements) {
    if (statement[0]?.toUpperCase() !== 'INCLUDE' || !statement[1] || statement[2] === ')') continue;
    const name = statement[1].toUpperCase();
    if (name === '(' || name === 'TYPE' || name === 'STRUCTURE') continue;
    const trailing = statement.slice(2).map((token) => token.toUpperCase());
    if (trailing.length > 0 && !(trailing.length === 2 && trailing[0] === 'IF' && trailing[1] === 'FOUND')) continue;
    if (/^(?:[A-Z0-9_$%]+|\/[A-Z0-9_$%]+\/[A-Z0-9_$%]+)$/.test(name)) names.add(name);
  }
  return [...names];
}

function sourceClassKey(program: string | undefined, testClass: string, qualifyProgram: boolean): string {
  return `${qualifyProgram ? (program ?? '').toUpperCase() : ''}\u0000${testClass.toUpperCase()}`;
}

function reconcileAunitDeclaredClasses(
  result: AunitRunResult,
  declaredTestClasses: AunitSourceTestClass[],
  sourceWasComplete: boolean,
  sourceIncompleteReason: string | undefined,
  qualifyProgram: boolean,
): AunitRunResult {
  const observedRows = [
    ...result.tests.map((test) => ({ program: test.program, testClass: test.testClass })),
    ...result.alerts
      .filter((alert) => alert.testClass)
      .map((alert) => ({ program: alert.program ?? '', testClass: alert.testClass ?? '' })),
  ];
  const observedClasses = new Map(
    observedRows.map((row) => [sourceClassKey(row.program, row.testClass, qualifyProgram), row]),
  );
  const omittedTestClasses = declaredTestClasses.filter(
    (testClass) => !observedClasses.has(sourceClassKey(testClass.program, testClass.testClass, qualifyProgram)),
  );
  const omittedNonHarmlessTestClasses = omittedTestClasses.filter((testClass) => testClass.riskLevel !== 'harmless');
  const declaredNames = new Set(
    declaredTestClasses.map((testClass) => sourceClassKey(testClass.program, testClass.testClass, qualifyProgram)),
  );
  const unverifiedObservedClasses = [...observedClasses.entries()]
    .filter(([key]) => !declaredNames.has(key))
    .map(([, row]) => `${qualifyProgram ? `${row.program}:` : ''}${row.testClass}`);
  const resultNeedsDeclarations = result.summary.tests > 0 && unverifiedObservedClasses.length > 0;
  const status: AunitSourceSelectionEvidence['status'] =
    sourceWasComplete && !resultNeedsDeclarations ? 'verified' : 'unavailable';
  const reason = !sourceWasComplete
    ? (sourceIncompleteReason ?? 'One or more ABAP source blocks could not be inspected.')
    : resultNeedsDeclarations
      ? `SAP reported class evidence that could not be matched to an executable source declaration: ${unverifiedObservedClasses.join(', ')}.`
      : undefined;
  const sourceSelectionEvidence: AunitSourceSelectionEvidence = {
    status,
    declaredTestClasses,
    omittedTestClasses,
    omittedNonHarmlessTestClasses,
    ...(reason ? { reason } : {}),
  };

  const additions: AunitAlert[] = omittedNonHarmlessTestClasses.map((testClass) => ({
    scope: 'class',
    ...(testClass.program ? { program: testClass.program } : {}),
    testClass: testClass.testClass,
    kind: 'sourceRiskSelection',
    severity: 'tolerable',
    title: 'Source-declared non-harmless test class was omitted from SAP results',
    details: [`Declared risk level: ${testClass.riskLevel}`],
    message: `Source declares ${testClass.testClass} FOR TESTING RISK LEVEL ${testClass.riskLevel.toUpperCase()}, but SAP's harmless-only result contained no class or method evidence for it.`,
    stack: [],
  }));
  for (const testClass of omittedTestClasses) {
    if (testClass.riskLevel !== 'harmless') continue;
    additions.push({
      scope: 'class',
      ...(testClass.program ? { program: testClass.program } : {}),
      testClass: testClass.testClass,
      kind: 'sourceTestOmission',
      severity: 'tolerable',
      title: 'Source-declared harmless test class was omitted from SAP results',
      details: ['Declared risk level: harmless'],
      message: `Source declares executable harmless test class ${testClass.testClass}, but SAP returned no class or method evidence for it.`,
      stack: [],
    });
  }
  for (const testClass of declaredTestClasses) {
    if (
      testClass.riskLevel === 'harmless' ||
      !observedClasses.has(sourceClassKey(testClass.program, testClass.testClass, qualifyProgram))
    )
      continue;
    additions.push({
      scope: 'class',
      ...(testClass.program ? { program: testClass.program } : {}),
      testClass: testClass.testClass,
      kind: 'sourceRiskOutsideSelection',
      severity: 'tolerable',
      title: 'Non-harmless source declaration is outside the requested test selection',
      details: [`Declared risk level: ${testClass.riskLevel}`],
      message: `Source declares ${testClass.testClass} with risk level ${testClass.riskLevel}, so a harmless-only run cannot certify the complete suite even though SAP returned class evidence.`,
      stack: [],
    });
  }
  if (status === 'unavailable') {
    additions.push({
      scope: 'run',
      kind: 'sourceAuditUnavailable',
      severity: 'tolerable',
      title: 'ABAP Unit source-selection audit was incomplete',
      details: reason ? [reason] : [],
      message: reason ?? 'ARC-1 could not inspect the complete ABAP source used by this test run.',
      stack: [],
    });
  }

  if (additions.length === 0) return { ...result, sourceSelectionEvidence };
  return {
    ...result,
    outcome: result.outcome === 'failed' ? 'failed' : 'incomplete',
    summary: { ...result.summary, warnings: result.summary.warnings + additions.filter(isWarning).length },
    alerts: [...result.alerts, ...additions],
    sourceSelectionEvidence,
  };
}

/**
 * Reconcile SAP's harmless-only result with test classes declared in one inspected source tree.
 * SAP 7.58 can omit a dangerous/critical class from both result formats without an alert; source
 * evidence closes that false-green while ordinary and deferred helper classes remain ignored.
 */
export function reconcileAunitSourceDeclarations(
  result: AunitRunResult,
  source: string,
  options: AunitSourceAuditOptions = {},
): AunitRunResult {
  const declarationScan = inspectSourceDeclaredAunitClasses(source);
  const complete = options.complete !== false && declarationScan.complete;
  const reason =
    options.complete === false
      ? options.incompleteReason
      : declarationScan.complete
        ? undefined
        : declarationScan.reason;
  return reconcileAunitDeclaredClasses(result, declarationScan.testClasses, complete, reason, false);
}

/** Reconcile a multi-program package run without conflating common local names such as LTCL_TEST. */
export function reconcileAunitProgramSources(
  result: AunitRunResult,
  sources: AunitProgramSource[],
  options: AunitSourceAuditOptions = {},
): AunitRunResult {
  const declaredTestClasses: AunitSourceTestClass[] = [];
  let complete = options.complete !== false;
  let reason = options.incompleteReason;
  for (const source of sources) {
    const declarationScan = inspectSourceDeclaredAunitClasses(source.source);
    declaredTestClasses.push(
      ...declarationScan.testClasses.map((testClass) => ({
        ...testClass,
        program: source.program.toUpperCase(),
      })),
    );
    if (!declarationScan.complete) {
      complete = false;
      reason ??= declarationScan.reason ?? `The ABAP source declaration scan for ${source.program} was incomplete.`;
    }
  }
  return reconcileAunitDeclaredClasses(result, declaredTestClasses, complete, reason, true);
}

/** Parse legacy `/abapunit/testruns` XML without turning non-method alerts into fake tests. */
export function parseAunitRunResult(xml: string): AunitRunResult {
  const parsed = parseXml(xml);
  const runResult = (parsed.runResult ?? {}) as Record<string, unknown>;
  const tests: AunitTestCase[] = [];
  const alerts: AunitAlert[] = [];

  for (const alert of getNestedArray(runResult, 'alerts', 'alert')) {
    alerts.push(parseAlert(alert, 'run', {}));
  }

  for (const program of nodeArray(runResult.program)) {
    const programName = String(program['@_name'] ?? '').trim();
    if (!programName) {
      alerts.push({
        scope: 'program',
        kind: 'malformedResult',
        severity: 'tolerable',
        title: 'ABAP Unit program result had no identity',
        details: [],
        message: 'SAP returned an ABAP Unit program node without a program name.',
        stack: [],
      });
    }
    for (const alert of getNestedArray(program, 'alerts', 'alert')) {
      alerts.push(parseAlert(alert, 'program', { program: programName }));
    }

    for (const testClass of getNestedArray(program, 'testClasses', 'testClass')) {
      const testClassName = String(testClass['@_name'] ?? '').trim();
      if (!testClassName) {
        alerts.push({
          scope: 'program',
          ...(programName ? { program: programName } : {}),
          kind: 'malformedResult',
          severity: 'tolerable',
          title: 'ABAP Unit class result had no identity',
          details: [],
          message: 'SAP returned an ABAP Unit test-class node without a class name.',
          stack: [],
        });
      }
      const riskLevel = String(testClass['@_riskLevel'] ?? '') || undefined;
      const durationCategory = String(testClass['@_durationCategory'] ?? '') || undefined;
      const classAlerts = getNestedArray(testClass, 'alerts', 'alert').map((alert) =>
        parseAlert(alert, 'class', { program: programName, testClass: testClassName }),
      );
      alerts.push(...classAlerts);

      const methods = getNestedArray(testClass, 'testMethods', 'testMethod');
      if (methods.length === 0 && !classAlerts.some(isInfrastructureError)) {
        const riskEvidence = riskLevel ? ` (reported risk level: ${riskLevel})` : '';
        alerts.push({
          scope: 'class',
          program: programName,
          testClass: testClassName,
          kind: 'emptyClass',
          severity: 'tolerable',
          title: 'Test class reported no executed test methods',
          details: riskLevel ? [`Reported risk level: ${riskLevel}`] : [],
          message: `Test class reported no executed test methods${riskEvidence}`,
          stack: [],
        });
      }

      for (const method of methods) {
        const methodName = String(method['@_name'] ?? '').trim();
        if (!programName || !testClassName || !methodName) {
          if (!methodName) {
            alerts.push({
              scope: 'class',
              ...(programName ? { program: programName } : {}),
              ...(testClassName ? { testClass: testClassName } : {}),
              kind: 'malformedResult',
              severity: 'tolerable',
              title: 'ABAP Unit method result had no identity',
              details: [],
              message: 'SAP returned an ABAP Unit test-method node without a method name.',
              stack: [],
            });
          }
          continue;
        }
        const methodAlerts = getNestedArray(method, 'alerts', 'alert').map((alert) =>
          parseAlert(alert, 'method', {
            program: programName,
            testClass: testClassName,
            testMethod: methodName,
          }),
        );
        alerts.push(...methodAlerts);
        tests.push({
          program: programName,
          testClass: testClassName,
          testMethod: methodName,
          status: methodStatus(methodAlerts),
          ...(durationMs(method) !== undefined ? { durationMs: durationMs(method) } : {}),
          ...(riskLevel ? { riskLevel } : {}),
          ...(durationCategory ? { durationCategory } : {}),
          alerts: methodAlerts,
        });
      }
    }
  }

  const elevatedExecutions = new Map<string, AunitTestCase>();
  for (const test of tests) {
    if (test.riskLevel && test.riskLevel.toLowerCase() !== 'harmless') {
      elevatedExecutions.set(`${test.program}:${test.testClass}`, test);
    }
  }
  for (const test of elevatedExecutions.values()) {
    alerts.push({
      scope: 'class',
      program: test.program,
      testClass: test.testClass,
      kind: 'riskSelectionViolation',
      severity: 'tolerable',
      title: 'SAP executed a test class above the requested harmless risk level',
      details: [`Reported risk level: ${test.riskLevel}`],
      message: `SAP reported executed methods for ${test.testClass} at risk level ${test.riskLevel}; a harmless-only run cannot be certified complete.`,
      stack: [],
    });
  }

  const summary: AunitSummary = {
    tests: tests.length,
    passed: tests.filter((test) => test.status === 'passed').length,
    failures: tests.filter((test) => test.status === 'failed').length,
    errors:
      tests.filter((test) => test.status === 'error').length +
      alerts.filter((alert) => alert.scope !== 'method' && isInfrastructureError(alert)).length,
    skipped: tests.filter((test) => test.status === 'skipped').length,
    warnings: alerts.filter(isWarning).length,
  };

  const hasIncompleteEvidence = alerts.some(
    (alert) =>
      isRiskRefusal(alert) ||
      alert.kind === 'emptyClass' ||
      alert.kind === 'malformedResult' ||
      alert.kind === 'riskSelectionViolation' ||
      /not executed|abortion|skip/i.test(alert.message),
  );
  let outcome: AunitOutcome;
  if (summary.failures > 0 || summary.errors > 0) outcome = 'failed';
  else if (summary.tests === 0) outcome = alerts.length === 0 ? 'no_tests' : 'incomplete';
  else if (summary.skipped === summary.tests || hasIncompleteEvidence) outcome = 'incomplete';
  else outcome = 'passed';

  return {
    outcome,
    summary,
    selection: { maxRisk: 'harmless', durations: ['short', 'medium', 'long'] },
    tests,
    alerts,
    coverageEvidence: 'not_requested',
  };
}

export function withAunitCoverage(
  result: AunitRunResult,
  coverage: CoverageSummary | undefined,
  unavailableReason?: AunitRunResult['coverageUnavailableReason'],
): AunitRunResult {
  return {
    ...result,
    ...(coverage ? { coverage } : {}),
    coverageEvidence: coverage ? 'available' : 'unavailable',
    ...(!coverage && unavailableReason ? { coverageUnavailableReason: unavailableReason } : {}),
  };
}

/** Generate JUnit from the corrected legacy model. Non-method alerts stay in system-err. */
export function aunitResultToJunit(result: AunitRunResult, suiteName = 'ABAP Unit'): string {
  const cases = result.tests
    .map((test) => {
      const attrs = `classname="${escapeXmlAttr(`${test.program}.${test.testClass}`)}" name="${escapeXmlAttr(test.testMethod)}" time="${((test.durationMs ?? 0) / 1000).toFixed(3)}"`;
      const message = test.alerts
        .map((alert) => alert.message)
        .filter(Boolean)
        .join('\n');
      if (test.status === 'failed') {
        return `<testcase ${attrs}><failure type="Assert Failure" message="${escapeXmlAttr(message)}">${escapeXmlAttr(message)}</failure></testcase>`;
      }
      if (test.status === 'error') {
        return `<testcase ${attrs}><error type="ABAP Unit Error" message="${escapeXmlAttr(message)}">${escapeXmlAttr(message)}</error></testcase>`;
      }
      if (test.status === 'skipped') {
        return `<testcase ${attrs}><skipped message="${escapeXmlAttr(message || 'Skipped by SAP')}"/></testcase>`;
      }
      return `<testcase ${attrs}/>`;
    })
    .join('');
  const nonMethodAlerts = result.alerts
    .filter((alert) => alert.scope !== 'method')
    .map((alert) => {
      const location = [alert.program, alert.testClass, alert.testMethod].filter(Boolean).join('.');
      return `[${alert.scope}/${alert.severity}/${alert.kind}${location ? ` ${location}` : ''}] ${alert.message}`;
    })
    .join('\n');
  const time = result.tests.reduce((sum, test) => sum + (test.durationMs ?? 0), 0) / 1000;
  const junit =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<testsuites name="${escapeXmlAttr(suiteName)}" tests="${result.summary.tests}" failures="${result.summary.failures}" errors="${result.summary.errors}" skipped="${result.summary.skipped}" time="${time.toFixed(3)}">` +
    `<testsuite name="${escapeXmlAttr(suiteName)}" tests="${result.summary.tests}" failures="${result.summary.failures}" errors="${result.summary.errors}" skipped="${result.summary.skipped}" time="${time.toFixed(3)}">` +
    cases +
    (nonMethodAlerts ? `<system-err>${escapeXmlAttr(nonMethodAlerts)}</system-err>` : '') +
    `</testsuite></testsuites>`;
  if (result.outcome !== 'incomplete') return junit;
  return appendAunitJunitDiagnostic(
    junit,
    {
      tests: result.summary.tests,
      failures: result.summary.failures,
      errors: result.summary.errors,
      skipped: result.summary.skipped,
      outcome: result.outcome,
    },
    'incomplete',
    'ARC-1 could not verify a complete harmless ABAP Unit run. See the preserved SAP alerts for details.',
  );
}

export function aunitIncompleteToJunit(message: string, suiteName = 'ABAP Unit'): string {
  const name = escapeXmlAttr(suiteName);
  const junit =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<testsuites name="${name}" tests="0" failures="0" errors="0" skipped="0">` +
    `<testsuite name="${name}" tests="0" failures="0" errors="0" skipped="0">` +
    `<system-err>${escapeXmlAttr(message)}</system-err></testsuite></testsuites>`;
  return appendAunitJunitDiagnostic(
    junit,
    { tests: 0, failures: 0, errors: 0, skipped: 0, outcome: 'incomplete' },
    'incomplete',
    message,
  );
}

function requiredCountAttr(node: Record<string, unknown>, name: string): number {
  const raw = node[`@_${name}`];
  const parsed = typeof raw === 'string' && raw.trim() === '' ? Number.NaN : Number(raw);
  if (raw == null || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`ABAP Unit public API returned an invalid JUnit ${name} count.`);
  }
  return parsed;
}

export function parseNativeJunitSummary(xml: string): NativeJunitSummary {
  const root = parseXml(xml).testsuites;
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error('ABAP Unit public API returned a non-JUnit result.');
  }
  const node = root as Record<string, unknown>;
  const tests = requiredCountAttr(node, 'tests');
  const failures = requiredCountAttr(node, 'failures');
  const errors = requiredCountAttr(node, 'errors');
  const skipped = requiredCountAttr(node, 'skipped');
  if (failures + errors + skipped > tests) {
    throw new Error('ABAP Unit public API returned inconsistent JUnit counters.');
  }
  const outcome: AunitOutcome =
    failures > 0 || errors > 0 ? 'failed' : tests === 0 || skipped === tests ? 'incomplete' : 'passed';
  return { tests, failures, errors, skipped, outcome };
}

function setJunitCountAttribute(openingTag: string, name: string, value: number): string {
  const attribute = new RegExp(`(\\s${name}\\s*=\\s*)(["'])([^"']*)\\2`, 'i');
  if (attribute.test(openingTag)) {
    return openingTag.replace(attribute, (_match, prefix: string, quote: string) => {
      return `${prefix}${quote}${value}${quote}`;
    });
  }
  const closing = openingTag.match(/\s*\/?\s*>$/)?.[0];
  if (!closing) throw new Error('ABAP Unit public API returned a malformed JUnit root element.');
  return `${openingTag.slice(0, -closing.length)} ${name}="${value}"${closing}`;
}

function escapedRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Preserve SAP-native suites and append one red reconciliation testcase with truthful root counters. */
export function appendAunitJunitDiagnostic(
  junit: string,
  summary: NativeJunitSummary,
  outcome: 'failed' | 'incomplete',
  message: string,
): string {
  const openingMatch = /<((?:[A-Za-z_][\w.-]*:)?testsuites)\b[^>]*?(?:\/\s*>|>)/i.exec(junit);
  if (!openingMatch || openingMatch.index === undefined) {
    throw new Error('ABAP Unit public API returned a non-JUnit result.');
  }
  const tagName = openingMatch[1]!;
  const originalOpening = openingMatch[0];
  const selfClosing = /\/\s*>$/.test(originalOpening);
  const failureIncrement = outcome === 'failed' ? 1 : 0;
  const errorIncrement = outcome === 'incomplete' ? 1 : 0;
  let opening = originalOpening;
  opening = setJunitCountAttribute(opening, 'tests', summary.tests + 1);
  opening = setJunitCountAttribute(opening, 'failures', summary.failures + failureIncrement);
  opening = setJunitCountAttribute(opening, 'errors', summary.errors + errorIncrement);
  opening = setJunitCountAttribute(opening, 'skipped', summary.skipped);

  const escapedMessage = escapeXmlAttr(message);
  const resultElement = outcome === 'failed' ? 'failure' : 'error';
  const resultType = outcome === 'failed' ? 'ARC1ReconciledFailure' : 'ARC1IncompleteEvidence';
  const diagnostic =
    `<testsuite name="ARC-1 ABAP Unit reconciliation" tests="1" failures="${failureIncrement}" errors="${errorIncrement}" skipped="0">` +
    `<testcase classname="ARC-1" name="Native and legacy ABAP Unit evidence">` +
    `<${resultElement} type="${resultType}" message="${escapedMessage}">${escapedMessage}</${resultElement}>` +
    `</testcase></testsuite>`;

  const beforeOpening = junit.slice(0, openingMatch.index);
  const afterOpening = junit.slice(openingMatch.index + originalOpening.length);
  if (selfClosing) {
    return `${beforeOpening}${opening.replace(/\/\s*>$/, '>')}${diagnostic}</${tagName}>${afterOpening}`;
  }

  const withUpdatedOpening = `${beforeOpening}${opening}${afterOpening}`;
  const closingPattern = new RegExp(`</${escapedRegExp(tagName)}\\s*>`, 'gi');
  let closingMatch: RegExpExecArray | null;
  let lastClosing: RegExpExecArray | undefined;
  while ((closingMatch = closingPattern.exec(withUpdatedOpening)) !== null) lastClosing = closingMatch;
  if (!lastClosing || lastClosing.index === undefined) {
    throw new Error('ABAP Unit public API returned JUnit without a closing testsuites element.');
  }
  return `${withUpdatedOpening.slice(0, lastClosing.index)}${diagnostic}${withUpdatedOpening.slice(lastClosing.index)}`;
}

function isDeadlineFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'TimeoutError' || /deadline was exceeded|timed out|\btimeout\b/i.test(error.message)) return true;
  return error instanceof AdtNetworkError && error.cause?.name === 'TimeoutError';
}

async function withinPublicAunitDeadline<T>(
  operation: () => Promise<T>,
  now: () => number,
  started: number,
  polls: () => number,
  status: () => string,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isDeadlineFailure(error)) throw error;
    throw new AunitIncompleteError(
      `ABAP Unit public run did not complete within its deadline (last status: ${status() || 'unknown'}).`,
      { elapsedMs: now() - started, polls: polls(), status: status() },
      { cause: error },
    );
  }
}

function runStatus(xml: string): { status: string; resultPath?: string } {
  const parsed = parseXml(xml);
  const progress = findDeepNodes(parsed, 'progress')[0];
  const status = String(progress?.['@_status'] ?? '').trim();
  const link = findDeepNodes(parsed, 'link').find((candidate) => {
    const rel = String(candidate['@_rel'] ?? '');
    const type = String(candidate['@_type'] ?? '');
    return rel.includes('run-result') || type.includes('junit.run-result');
  });
  return {
    status,
    ...(link?.['@_href']
      ? { resultPath: assertCanonicalHostRelativeAdtPath(String(link['@_href']), PUBLIC_RESULTS) }
      : {}),
  };
}

export async function probePublicAunit(
  http: AdtHttpClient,
  safety: SafetyConfig,
  options?: AdtRequestOptions,
): Promise<boolean> {
  checkOperation(safety, OperationType.Read, 'ProbePublicAunit');
  try {
    await http.get(`${PUBLIC_RUNS}${ZERO_RUN_ID}`, { Accept: RUN_STATUS_ACCEPT }, { ...options, probe: true });
    return true;
  } catch (error) {
    if (error instanceof AdtApiError && [404, 405, 406, 415].includes(error.statusCode)) return false;
    throw error;
  }
}

/** Run harmless-only AUnit through the public async endpoint and return SAP-native JUnit. */
export async function runPublicAunit(
  http: AdtHttpClient,
  safety: SafetyConfig,
  type: string,
  name: string,
  options: PublicAunitOptions = {},
): Promise<PublicAunitResult> {
  checkOperation(safety, OperationType.Test, 'RunPublicAunit');
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const started = now();
  const relativeDeadline = started + (options.timeoutMs ?? DEFAULT_PUBLIC_AUNIT_TIMEOUT_MS);
  const deadline = options.deadline === undefined ? relativeDeadline : Math.min(relativeDeadline, options.deadline);
  const requestOptions = (): AdtRequestOptions => ({ deadline, signal: options.signal });
  const normalizedType = type.toUpperCase();
  const normalizedName = name.toUpperCase();
  const objectSet =
    normalizedType === 'DEVC'
      ? `<osl:objectSet xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:osl="http://www.sap.com/api/osl" xsi:type="osl:packageSet">` +
        `<osl:package includeSubpackages="${options.includeSubpackages === true}" name="${escapeXmlAttr(normalizedName)}"/>` +
        `</osl:objectSet>`
      : `<osl:objectSet xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:osl="http://www.sap.com/api/osl" xsi:type="osl:flatObjectSet">` +
        `<osl:object name="${escapeXmlAttr(normalizedName)}" type="${escapeXmlAttr(normalizedType)}"/>` +
        `</osl:objectSet>`;
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<aunit:run xmlns:aunit="http://www.sap.com/adt/api/aunit" title="ARC-1 ABAP Unit" context="ARC-1 CLI">` +
    // Source reconciliation can prove only tests owned by the selected object. Keep the public
    // request aligned with the legacy same-program/assignedTests=false corroboration instead of
    // silently including foreign @testing relations that are outside the inspected source tree.
    `<aunit:options><aunit:measurements type="none"/><aunit:scope ownTests="true" foreignTests="false" addForeignTestsAsPreview="false"/>` +
    `<aunit:riskLevel harmless="true" dangerous="false" critical="false"/>` +
    `<aunit:duration short="true" medium="true" long="true"/></aunit:options>` +
    `${objectSet}</aunit:run>`;

  let polls = 0;
  let status = '';
  const created = await withinPublicAunitDeadline(
    () => http.post(PUBLIC_RUNS.slice(0, -1), body, RUN_CONTENT_TYPE, { Accept: RUN_STATUS_ACCEPT }, requestOptions()),
    now,
    started,
    () => polls,
    () => status,
  );
  const location = created.headers.location ?? created.headers.Location;
  if (!location) throw new Error('ABAP Unit public API created a run without a Location header.');
  const runPath = assertCanonicalHostRelativeAdtPath(location, PUBLIC_RUNS);

  let delayMs = 100;
  let resultPath: string | undefined;
  let terminal = false;
  while (now() < deadline) {
    const separator = runPath.includes('?') ? '&' : '?';
    const polled = await withinPublicAunitDeadline(
      () => http.get(`${runPath}${separator}withLongPolling=true`, { Accept: RUN_STATUS_ACCEPT }, requestOptions()),
      now,
      started,
      () => polls,
      () => status,
    );
    polls += 1;
    const state = runStatus(polled.body);
    status = state.status;
    resultPath = state.resultPath;
    terminal = /^(completed|finished)$/i.test(status);
    if (terminal && resultPath) break;
    if (!status || /not created|failed|cancelled/i.test(status)) {
      throw new Error(`ABAP Unit public run did not complete: ${status || 'empty status'}`);
    }
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(delayMs, remaining));
    delayMs = Math.min(delayMs * 2, 1_000);
  }
  if (!terminal || !resultPath) {
    throw new AunitIncompleteError(
      `ABAP Unit public run timed out after ${now() - started}ms (last status: ${status || 'unknown'}).`,
      { elapsedMs: now() - started, polls, status },
    );
  }

  const result = await withinPublicAunitDeadline(
    () => http.get(resultPath, { Accept: JUNIT_ACCEPT }, requestOptions()),
    now,
    started,
    () => polls,
    () => status,
  );
  const summary = parseNativeJunitSummary(result.body);
  return {
    protocol: 'public-api',
    runPath,
    resultPath,
    status,
    junit: result.body,
    summary,
    elapsedMs: now() - started,
    polls,
  };
}
