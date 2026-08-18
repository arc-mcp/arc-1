/**
 * SAPDiagnose handler — runtime diagnostics: short dumps (ST22), traces, gateway errors, object
 * state, ATC, unit tests, CDS test cases.
 */

import type { AunitAlert, AunitProgramSource, AunitRunResult } from '../adt/aunit.js';
import {
  AunitIncompleteError,
  appendAunitJunitDiagnostic,
  aunitIncompleteToJunit,
  aunitResultToJunit,
  DEFAULT_PUBLIC_AUNIT_TIMEOUT_MS,
  findStaticAbapIncludes,
  probePublicAunit,
  reconcileAunitProgramSources,
  reconcileAunitSourceDeclarations,
  runPublicAunit,
} from '../adt/aunit.js';
import {
  type AunitPackageObject,
  type AunitPackageSelection,
  resolveAunitPackageSelection,
} from '../adt/aunit-package.js';
import type { AdtClient, SourceReadOptions, SourceReadResult } from '../adt/client.js';
import {
  applyFixProposal,
  getAtcSystemDefaultVariant,
  getCdsTestCases,
  getFixProposals,
  listAtcVariants,
  runAtcCheck,
  runUnitTests,
  supportsCdsTestCases,
  syntaxCheck,
} from '../adt/devtools.js';
import {
  createTraceRequest,
  deleteTraceRequest,
  getAuthorizationTrace,
  getCdsCreateStatements,
  getDump,
  getGatewayErrorDetail,
  getObjectState,
  getSqlTraceDirectory,
  getSqlTraceState,
  getTraceDbAccesses,
  getTraceHitlist,
  getTraceStatements,
  listDumps,
  listGatewayErrors,
  listSystemMessages,
  listTraceRequests,
  listTraces,
  probeODataPerformance,
  setSqlTraceState,
} from '../adt/diagnostics.js';
import { AdtApiError, AdtNetworkError } from '../adt/errors.js';
import type {
  DumpDetail,
  FixAffectedObject,
  TracedObjectType,
  TracedProcessType,
  TraceRequestCreateOptions,
  UnitTestResult,
} from '../adt/types.js';
import { isBtpSystem } from './feature-cache.js';
import { classIncludeUrl, normalizeObjectType, objectUrlForType, sourceUrlForType } from './object-types.js';
import { errorResult, type ToolResult, textResult, toolJson } from './shared.js';

const AUNIT_SOURCE_MAX_BLOCKS = 80;
const AUNIT_SOURCE_MAX_DEPTH = 5;
const AUNIT_PACKAGE_SOURCE_CONCURRENCY = 8;
const AUNIT_SOURCE_REQUEST_LIMIT = 500;

interface AunitEvidenceBudget {
  deadline: number;
  remainingSourceRequests: number;
}

class AunitSourceBudgetError extends Error {
  constructor() {
    super(`The ABAP Unit source audit exceeded its ${AUNIT_SOURCE_REQUEST_LIMIT}-request limit.`);
    this.name = 'AunitSourceBudgetError';
  }
}

function reserveAunitSourceRequests(budget: AunitEvidenceBudget, count = 1): SourceReadOptions {
  if (budget.remainingSourceRequests < count) throw new AunitSourceBudgetError();
  budget.remainingSourceRequests -= count;
  return { deadline: budget.deadline };
}

function isAunitDeadlineFailure(error: unknown): boolean {
  return (
    error instanceof AdtNetworkError &&
    (error.cause?.name === 'TimeoutError' || /deadline was exceeded|timed out|\btimeout\b/i.test(error.message))
  );
}

interface AunitSourceTree {
  source: string;
  complete: boolean;
  incompleteReason?: string;
  blocks: AunitSourceBlock[];
}

interface AunitSourceBlock {
  id: string;
  status: 'present' | 'absent';
  source: string;
  etag?: string;
}

interface AunitPackageSourceEntry extends AunitPackageObject {
  tree: AunitSourceTree;
}

interface AunitPackageSourceSnapshot {
  selection: AunitPackageSelection;
  entries: AunitPackageSourceEntry[];
  complete: boolean;
  incompleteReason?: string;
}

type AunitSelectionSnapshot =
  | { kind: 'object'; tree: AunitSourceTree }
  | { kind: 'package'; package: AunitPackageSourceSnapshot };

function presentAunitSourceBlock(id: string, result: SourceReadResult): AunitSourceBlock {
  return {
    id,
    status: 'present',
    source: result.source,
    ...(result.etag ? { etag: result.etag } : {}),
  };
}

async function readOptionalAunitClassInclude(
  client: AdtClient,
  name: string,
  include: 'macros' | 'testclasses',
  budget: AunitEvidenceBudget,
): Promise<AunitSourceBlock> {
  try {
    return presentAunitSourceBlock(
      `CLAS:${name.toUpperCase()}:${include}`,
      await client.getClassInclude(name, include, {
        ...reserveAunitSourceRequests(budget),
        version: 'active',
      }),
    );
  } catch (error) {
    if (!(error instanceof AdtApiError) || error.statusCode !== 404) throw error;
    return { id: `CLAS:${name.toUpperCase()}:${include}`, status: 'absent', source: '' };
  }
}

async function readAunitSourceTree(
  client: AdtClient,
  type: string,
  name: string,
  budget: AunitEvidenceBudget,
): Promise<AunitSourceTree> {
  let initialBlocks: AunitSourceBlock[];
  try {
    if (type === 'CLAS') {
      const main = await client.getClass(name, undefined, {
        ...reserveAunitSourceRequests(budget),
        version: 'active',
      });
      const testBlock = await readOptionalAunitClassInclude(client, name, 'testclasses', budget);
      const macrosBlock = await readOptionalAunitClassInclude(client, name, 'macros', budget);
      // Global test classes declare FOR TESTING in main. Production classes normally keep local
      // test declarations and macros in dedicated optional includes; a 404 is a verified absence.
      initialBlocks = [presentAunitSourceBlock(`CLAS:${name.toUpperCase()}:main`, main), testBlock, macrosBlock];
    } else if (type === 'PROG') {
      initialBlocks = [
        presentAunitSourceBlock(
          `PROG:${name.toUpperCase()}:main`,
          await client.getProgram(name, { ...reserveAunitSourceRequests(budget), version: 'active' }),
        ),
      ];
    } else if (type === 'FUGR') {
      initialBlocks = [
        presentAunitSourceBlock(
          `FUGR:${name.toUpperCase()}:main`,
          await client.getFunctionGroupSource(name, {
            ...reserveAunitSourceRequests(budget),
            version: 'active',
          }),
        ),
      ];
    } else {
      return {
        source: '',
        complete: false,
        incompleteReason: 'Source-selection verification is supported only for CLAS, PROG, and FUGR test runs.',
        blocks: [],
      };
    }
  } catch (error) {
    return {
      source: '',
      complete: false,
      incompleteReason:
        error instanceof AunitSourceBudgetError
          ? error.message
          : isAunitDeadlineFailure(error)
            ? 'The ABAP Unit evidence deadline expired while reading active source.'
            : 'The source containing ABAP Unit class declarations could not be read from SAP.',
      blocks: [],
    };
  }

  const blocks = [...initialBlocks];
  const seen = new Set<string>();
  let frontier: Array<{ source: string; depth: number }> = initialBlocks
    .filter((block) => block.status === 'present')
    .map((block) => ({ source: block.source, depth: 0 }));
  let complete = true;
  let incompleteReason: string | undefined;

  while (frontier.length > 0) {
    const pending: Array<{ name: string; depth: number }> = [];
    for (const block of frontier) {
      const includes = findStaticAbapIncludes(block.source);
      if (block.depth >= AUNIT_SOURCE_MAX_DEPTH && includes.some((include) => !seen.has(include))) {
        complete = false;
        incompleteReason = 'The ABAP INCLUDE graph exceeded the source-audit depth limit.';
        continue;
      }
      for (const include of includes) {
        if (seen.has(include)) continue;
        seen.add(include);
        if (blocks.length + pending.length >= AUNIT_SOURCE_MAX_BLOCKS) {
          complete = false;
          incompleteReason = 'The ABAP INCLUDE graph exceeded the source-audit block limit.';
          continue;
        }
        pending.push({ name: include, depth: block.depth + 1 });
      }
    }
    if (pending.length === 0) break;

    const fetched = await Promise.allSettled(
      pending.map(async ({ name: include }) =>
        client.getInclude(include, { ...reserveAunitSourceRequests(budget), version: 'active' }),
      ),
    );
    const next: Array<{ source: string; depth: number }> = [];
    for (let index = 0; index < fetched.length; index += 1) {
      const response = fetched[index]!;
      if (response.status === 'rejected') {
        complete = false;
        incompleteReason =
          response.reason instanceof AunitSourceBudgetError
            ? response.reason.message
            : isAunitDeadlineFailure(response.reason)
              ? 'The ABAP Unit evidence deadline expired while reading static INCLUDE source.'
              : 'One or more static ABAP INCLUDE sources could not be read from SAP.';
        continue;
      }
      blocks.push(presentAunitSourceBlock(`INCL:${pending[index]!.name}`, response.value));
      next.push({ source: response.value.source, depth: pending[index]!.depth });
    }
    frontier = next;
  }

  return {
    source: blocks
      .filter((block) => block.status === 'present')
      .map((block) => block.source)
      .join('\n'),
    complete,
    ...(incompleteReason ? { incompleteReason } : {}),
    blocks,
  };
}

async function readAunitPackageSourceSnapshot(
  client: AdtClient,
  packageName: string,
  includeSubpackages: boolean,
  budget: AunitEvidenceBudget,
  snapshotsRemaining: 1 | 2,
): Promise<AunitPackageSourceSnapshot> {
  let selection: AunitPackageSelection;
  try {
    selection = await resolveAunitPackageSelection(
      client.http,
      client.safety,
      packageName,
      includeSubpackages,
      reserveAunitSourceRequests(budget, 2),
    );
  } catch (error) {
    if (!(error instanceof AunitSourceBudgetError) && !isAunitDeadlineFailure(error)) throw error;
    const incompleteReason =
      error instanceof AunitSourceBudgetError
        ? error.message
        : 'The ABAP Unit evidence deadline expired while resolving package membership.';
    return {
      selection: {
        packageName: packageName.trim().toUpperCase(),
        includeSubpackages,
        objects: [],
        membership: [],
        complete: false,
        incompleteReason,
      },
      entries: [],
      complete: false,
      incompleteReason,
    };
  }
  const minimumSourceRequests = selection.objects.reduce(
    (total, object) => total + (object.type === 'CLAS' ? 3 : 1),
    0,
  );
  const futureSelectionRequests = snapshotsRemaining === 2 ? 2 : 0;
  const minimumRemainingRequests = minimumSourceRequests * snapshotsRemaining + futureSelectionRequests;
  if (!selection.complete || minimumRemainingRequests > budget.remainingSourceRequests) {
    const incompleteReason =
      selection.incompleteReason ??
      `The package requires at least ${minimumRemainingRequests} additional source-audit requests, exceeding the ${AUNIT_SOURCE_REQUEST_LIMIT}-request limit.`;
    return { selection, entries: [], complete: false, incompleteReason };
  }
  const entries: AunitPackageSourceEntry[] = [];
  for (let offset = 0; offset < selection.objects.length; offset += AUNIT_PACKAGE_SOURCE_CONCURRENCY) {
    const batch = selection.objects.slice(offset, offset + AUNIT_PACKAGE_SOURCE_CONCURRENCY);
    const trees = await Promise.all(
      batch.map((object) => readAunitSourceTree(client, object.type, object.name, budget)),
    );
    entries.push(...batch.map((object, index) => ({ ...object, tree: trees[index]! })));
  }
  const incompleteEntry = entries.find((entry) => !entry.tree.complete);
  const incompleteReason =
    selection.incompleteReason ??
    (incompleteEntry
      ? `${incompleteEntry.type} ${incompleteEntry.name}: ${incompleteEntry.tree.incompleteReason ?? 'active source was incomplete'}`
      : undefined);
  return {
    selection,
    entries,
    complete: selection.complete && incompleteEntry === undefined,
    ...(incompleteReason ? { incompleteReason } : {}),
  };
}

function aunitProgramName(object: AunitPackageObject): string {
  if (object.type !== 'FUGR') return object.name.toUpperCase();
  const separator = object.name.lastIndexOf('/');
  return separator > 0
    ? `${object.name.slice(0, separator + 1)}SAPL${object.name.slice(separator + 1)}`.toUpperCase()
    : `SAPL${object.name}`.toUpperCase();
}

function packageProgramSources(snapshot: AunitPackageSourceSnapshot): AunitProgramSource[] {
  return snapshot.entries.map((entry) => ({ program: aunitProgramName(entry), source: entry.tree.source }));
}

async function readAunitSelectionSnapshot(
  client: AdtClient,
  type: string,
  name: string,
  includeSubpackages: boolean,
  budget: AunitEvidenceBudget,
): Promise<AunitSelectionSnapshot> {
  return type === 'DEVC'
    ? {
        kind: 'package',
        package: await readAunitPackageSourceSnapshot(client, name, includeSubpackages, budget, 2),
      }
    : { kind: 'object', tree: await readAunitSourceTree(client, type, name, budget) };
}

function sameAunitSourceSnapshot(before: AunitSourceTree, after: AunitSourceTree): boolean {
  if (before.blocks.length !== after.blocks.length) return false;
  return before.blocks.every((block, index) => {
    const later = after.blocks[index];
    return (
      later !== undefined &&
      later.id === block.id &&
      later.status === block.status &&
      later.source === block.source &&
      later.etag === block.etag
    );
  });
}

function sameAunitPackageSnapshot(before: AunitPackageSourceSnapshot, after: AunitPackageSourceSnapshot): boolean {
  if (
    before.selection.packageName !== after.selection.packageName ||
    before.selection.includeSubpackages !== after.selection.includeSubpackages ||
    before.selection.membership.length !== after.selection.membership.length ||
    !before.selection.membership.every((row, index) => after.selection.membership[index] === row) ||
    before.entries.length !== after.entries.length
  ) {
    return false;
  }
  return before.entries.every((entry, index) => {
    const later = after.entries[index];
    return (
      later !== undefined &&
      later.type === entry.type &&
      later.name === entry.name &&
      later.packageName === entry.packageName &&
      later.uri === entry.uri &&
      sameAunitSourceSnapshot(entry.tree, later.tree)
    );
  });
}

async function verifyAunitSourceSnapshot(
  client: AdtClient,
  type: string,
  name: string,
  before: AunitSourceTree,
  budget: AunitEvidenceBudget,
): Promise<AunitSourceTree> {
  if (!before.complete) return before;
  const after = await readAunitSourceTree(client, type, name, budget);
  if (!after.complete) {
    return {
      ...before,
      complete: false,
      incompleteReason:
        after.incompleteReason ?? 'The active ABAP source tree could not be re-read after the ABAP Unit run.',
    };
  }
  if (!sameAunitSourceSnapshot(before, after)) {
    return {
      ...before,
      complete: false,
      incompleteReason: 'The active ABAP source tree changed while ABAP Unit evidence was being collected.',
    };
  }
  return before;
}

async function verifyAunitSelectionSnapshot(
  client: AdtClient,
  type: string,
  name: string,
  includeSubpackages: boolean,
  before: AunitSelectionSnapshot,
  budget: AunitEvidenceBudget,
): Promise<AunitSelectionSnapshot> {
  if (before.kind === 'object') {
    return {
      kind: 'object',
      tree: await verifyAunitSourceSnapshot(client, type, name, before.tree, budget),
    };
  }
  if (!before.package.complete) return before;
  const after = await readAunitPackageSourceSnapshot(client, name, includeSubpackages, budget, 1);
  if (!after.complete) {
    return {
      kind: 'package',
      package: {
        ...before.package,
        complete: false,
        incompleteReason:
          after.incompleteReason ?? 'The package selection could not be re-read after the ABAP Unit run.',
      },
    };
  }
  if (!sameAunitPackageSnapshot(before.package, after)) {
    return {
      kind: 'package',
      package: {
        ...before.package,
        complete: false,
        incompleteReason: 'Package membership or active ABAP source changed while ABAP Unit evidence was collected.',
      },
    };
  }
  return before;
}

function reconcileAunitWithSource(result: AunitRunResult, evidence: AunitSourceTree): AunitRunResult {
  return reconcileAunitSourceDeclarations(result, evidence.source, {
    complete: evidence.complete,
    ...(evidence.incompleteReason ? { incompleteReason: evidence.incompleteReason } : {}),
  });
}

function reconcileAunitWithSelection(result: AunitRunResult, evidence: AunitSelectionSnapshot): AunitRunResult {
  if (evidence.kind === 'object') return reconcileAunitWithSource(result, evidence.tree);
  return reconcileAunitProgramSources(result, packageProgramSources(evidence.package), {
    complete: evidence.package.complete,
    ...(evidence.package.incompleteReason ? { incompleteReason: evidence.package.incompleteReason } : {}),
  });
}

function emptyAunitRunResult(coverage: boolean): AunitRunResult {
  return {
    outcome: 'no_tests',
    summary: { tests: 0, passed: 0, failures: 0, errors: 0, skipped: 0, warnings: 0 },
    selection: { maxRisk: 'harmless', durations: ['short', 'medium', 'long'] },
    tests: [],
    alerts: [],
    coverageEvidence: coverage ? 'unavailable' : 'not_requested',
    ...(coverage ? { coverageUnavailableReason: 'measurement_not_reported' as const } : {}),
  };
}

function incompleteAunitRunResult(coverage: boolean, message: string): AunitRunResult {
  return {
    ...emptyAunitRunResult(coverage),
    outcome: 'incomplete',
    summary: { tests: 0, passed: 0, failures: 0, errors: 0, skipped: 0, warnings: 1 },
    alerts: [
      {
        scope: 'run',
        kind: 'deadline',
        severity: 'tolerable',
        title: 'ABAP Unit evidence collection did not complete',
        details: [message],
        message,
        stack: [],
      },
    ],
  };
}

function aunitSelectionRunnable(evidence: AunitSelectionSnapshot): boolean {
  return evidence.kind === 'object' || evidence.package.complete;
}

async function runLegacyAunitForSelection(
  client: AdtClient,
  type: string,
  name: string,
  evidence: AunitSelectionSnapshot,
  coverage: boolean,
  budget: AunitEvidenceBudget,
): Promise<AunitRunResult> {
  if (!aunitSelectionRunnable(evidence)) return emptyAunitRunResult(coverage);
  const objectUrls =
    evidence.kind === 'package'
      ? evidence.package.selection.objects.map((object) => object.uri)
      : [objectUrlForType(type, name)];
  if (objectUrls.length === 0) return emptyAunitRunResult(coverage);
  try {
    return await runUnitTests(client.http, client.safety, objectUrls, {
      coverage,
      requestOptions: { deadline: budget.deadline },
    });
  } catch (error) {
    if (isAunitDeadlineFailure(error)) {
      return incompleteAunitRunResult(
        coverage,
        'The ABAP Unit evidence deadline expired while executing the harmless legacy run.',
      );
    }
    throw error;
  }
}

function legacyAlertStatus(alerts: AunitAlert[]): 'failed' | 'skipped' {
  return alerts.some((alert) => alert.severity !== 'tolerable') ? 'failed' : 'skipped';
}

function legacyAlertRow(alert: AunitAlert, testClass: string, testMethod: string): UnitTestResult {
  return {
    program: alert.program ?? '',
    testClass,
    testMethod,
    status: legacyAlertStatus([alert]),
    ...(alert.message ? { message: alert.message } : {}),
  };
}

/** Compatibility adapter kept at the SAPDiagnose legacy-output boundary. */
export function toLegacyAunitResults(result: AunitRunResult): UnitTestResult[] {
  const rows: UnitTestResult[] = result.alerts
    .filter((alert) => alert.scope === 'run')
    .map((alert) => legacyAlertRow(alert, '(run)', '(alert)'));
  const programs = new Set<string>();
  for (const test of result.tests) programs.add(test.program);
  for (const alert of result.alerts) {
    if (alert.scope !== 'run') programs.add(alert.program ?? '');
  }

  for (const program of programs) {
    rows.push(
      ...result.alerts
        .filter((alert) => alert.scope === 'program' && (alert.program ?? '') === program)
        .map((alert) => legacyAlertRow(alert, '(program)', '(alert)')),
    );
    const classes = new Set<string>();
    for (const test of result.tests) {
      if (test.program === program) classes.add(test.testClass);
    }
    for (const alert of result.alerts) {
      if (alert.scope === 'class' && (alert.program ?? '') === program) classes.add(alert.testClass ?? '');
    }
    for (const testClass of classes) {
      const classAlerts = result.alerts.filter(
        (alert) =>
          alert.scope === 'class' && (alert.program ?? '') === program && (alert.testClass ?? '') === testClass,
      );
      const hasReportedClassAlert = classAlerts.some((alert) => alert.kind !== 'emptyClass');
      for (const alert of classAlerts) {
        if (alert.kind === 'emptyClass' && hasReportedClassAlert) continue;
        rows.push(
          legacyAlertRow(
            alert.kind === 'emptyClass'
              ? { ...alert, message: 'test class reported no test methods and no alert' }
              : alert,
            testClass,
            '(class-level alert)',
          ),
        );
      }
      for (const test of result.tests) {
        if (test.program !== program || test.testClass !== testClass) continue;
        rows.push({
          program,
          testClass,
          testMethod: test.testMethod,
          status: test.alerts.length > 0 ? legacyAlertStatus(test.alerts) : 'passed',
          ...(test.alerts[0]?.message ? { message: test.alerts[0].message } : {}),
          ...(test.durationMs !== undefined ? { duration: test.durationMs / 1000 } : {}),
        });
      }
    }
  }
  return rows;
}

export async function handleSAPDiagnose(client: AdtClient, args: Record<string, unknown>): Promise<ToolResult> {
  const action = String(args.action ?? '');
  const name = String(args.name ?? '');
  const type = normalizeObjectType(String(args.type ?? ''));

  switch (action) {
    case 'syntax': {
      const objectUrl = objectUrlForType(type, name);
      const version = args.version === 'inactive' ? 'inactive' : args.version === 'active' ? 'active' : undefined;
      const content = typeof args.source === 'string' ? (args.source as string) : undefined;
      const opts: { version?: 'active' | 'inactive'; content?: string } = {};
      if (version) opts.version = version;
      if (content !== undefined) opts.content = content;
      const result = await syntaxCheck(
        client.http,
        client.safety,
        objectUrl,
        Object.keys(opts).length > 0 ? opts : undefined,
      );
      // Fail closed: SAP checked nothing (object does not exist yet) → never report "clean", or
      // callers read hasErrors:false as "SAP will accept this source".
      if (!result.checked) {
        return textResult(
          toolJson({
            ...result,
            hasErrors: true,
            messages: [
              {
                severity: 'error',
                text: `Not checked — ${(result.statusText || 'SAP did not process this check').replace(/\.$/, '')}. The source was NOT validated; create the object first (SAPWrite action="create"), then re-run the syntax check.`,
                line: 0,
                column: 0,
              },
            ],
          }),
        );
      }
      return textResult(toolJson(result));
    }
    case 'unittest': {
      const coverage = args.coverage === true;
      const resultFormat = String(args.resultFormat ?? 'legacy');
      const includeSubpackages = type === 'DEVC' && args.includeSubpackages === true;
      const timeoutMs =
        args.timeoutSeconds === undefined ? DEFAULT_PUBLIC_AUNIT_TIMEOUT_MS : Number(args.timeoutSeconds) * 1000;
      const evidenceBudget: AunitEvidenceBudget = {
        deadline: Date.now() + timeoutMs,
        remainingSourceRequests: AUNIT_SOURCE_REQUEST_LIMIT,
      };

      if (resultFormat === 'junit' && !coverage) {
        let publicAvailable: boolean;
        try {
          publicAvailable = await probePublicAunit(client.http, client.safety, {
            deadline: evidenceBudget.deadline,
          });
        } catch (error) {
          if (!isAunitDeadlineFailure(error)) throw error;
          const message = 'The ABAP Unit evidence deadline expired while probing the public run API.';
          return textResult(
            toolJson({
              protocol: 'public-api',
              outcome: 'incomplete',
              summary: { tests: 0, passed: 0, failures: 0, errors: 0, skipped: 0, warnings: 0 },
              coverageEvidence: 'not_requested',
              incompleteReason: 'timeout',
              junit: aunitIncompleteToJunit(message, `${type} ${name}`),
              polls: 0,
              elapsedMs: Date.now() - (evidenceBudget.deadline - timeoutMs),
            }),
          );
        }
        if (publicAvailable) {
          const sourceSnapshot = await readAunitSelectionSnapshot(
            client,
            type,
            name,
            includeSubpackages,
            evidenceBudget,
          );
          let native: Awaited<ReturnType<typeof runPublicAunit>>;
          try {
            native = await runPublicAunit(client.http, client.safety, type, name, {
              includeSubpackages,
              timeoutMs,
              deadline: evidenceBudget.deadline,
            });
          } catch (error) {
            if (!(error instanceof AunitIncompleteError)) throw error;
            const message = error.message;
            return textResult(
              toolJson({
                protocol: 'public-api',
                outcome: 'incomplete',
                summary: { tests: 0, passed: 0, failures: 0, errors: 0, skipped: 0, warnings: 0 },
                coverageEvidence: 'not_requested',
                incompleteReason: 'timeout',
                junit: aunitIncompleteToJunit(message, `${type} ${name}`),
                ...error.evidence,
              }),
            );
          }
          const legacyEvidence = await runLegacyAunitForSelection(
            client,
            type,
            name,
            sourceSnapshot,
            false,
            evidenceBudget,
          );
          const stableSourceSnapshot = await verifyAunitSelectionSnapshot(
            client,
            type,
            name,
            includeSubpackages,
            sourceSnapshot,
            evidenceBudget,
          );
          const legacy = reconcileAunitWithSelection(legacyEvidence, stableSourceSnapshot);
          let outcome = native.summary.outcome;
          let incompleteReason: string | undefined;
          // Native JUnit omits run/class alerts, including harmless-selection refusals. Reconcile
          // every public run with one harmless legacy run; disagreement is evidence, never green.
          if (native.summary.failures > 0 || native.summary.errors > 0 || legacy.outcome === 'failed') {
            outcome = 'failed';
          } else if (native.summary.tests !== legacy.summary.tests) {
            outcome = 'incomplete';
            incompleteReason = 'native_legacy_result_mismatch';
          } else if (
            legacy.outcome === 'incomplete' ||
            (native.summary.tests > 0 && native.summary.skipped === native.summary.tests)
          ) {
            outcome = 'incomplete';
            incompleteReason =
              legacy.sourceSelectionEvidence?.status === 'unavailable'
                ? 'source_selection_unavailable'
                : (legacy.sourceSelectionEvidence?.omittedNonHarmlessTestClasses.length ?? 0) > 0
                  ? 'source_declared_non_harmless_omitted'
                  : legacy.outcome === 'incomplete'
                    ? 'harmless_selection_incomplete'
                    : 'all_tests_skipped';
          } else if (native.summary.tests === 0 && legacy.outcome === 'no_tests') {
            outcome = 'no_tests';
          } else {
            outcome = 'passed';
          }
          const summary = {
            tests: native.summary.tests,
            passed: Math.max(
              0,
              native.summary.tests - native.summary.failures - native.summary.errors - native.summary.skipped,
            ),
            failures: native.summary.failures,
            errors: native.summary.errors,
            skipped: native.summary.skipped,
            warnings: legacy.summary.warnings,
          };
          let junit = native.junit;
          if (
            (outcome === 'failed' || outcome === 'incomplete') &&
            (outcome !== native.summary.outcome || incompleteReason !== undefined)
          ) {
            const diagnosticMessage =
              outcome === 'failed'
                ? 'ARC-1 reconciliation found failure or error evidence in the harmless legacy ABAP Unit result that SAP native JUnit did not represent.'
                : `ARC-1 reconciliation could not verify a complete harmless ABAP Unit run (${incompleteReason ?? 'incomplete legacy evidence'}).`;
            junit = appendAunitJunitDiagnostic(native.junit, native.summary, outcome, diagnosticMessage);
          }
          return textResult(
            toolJson({
              protocol: native.protocol,
              outcome,
              summary,
              coverageEvidence: 'not_requested',
              ...(incompleteReason ? { incompleteReason } : {}),
              selectionEvidence: {
                outcome: legacy.outcome,
                summary: legacy.summary,
                alerts: legacy.alerts,
              },
              sourceSelectionEvidence: legacy.sourceSelectionEvidence,
              junit,
              runPath: native.runPath,
              resultPath: native.resultPath,
              polls: native.polls,
              elapsedMs: native.elapsedMs,
            }),
          );
        }
      }

      // SAP 7.58 can silently omit dangerous/critical classes from harmless-only legacy results.
      // Audit a stable active-source snapshot for every format, including the compatibility array
      // and coverage object, so the generic tool path cannot report a partial run as green.
      const sourceSnapshot = await readAunitSelectionSnapshot(client, type, name, includeSubpackages, evidenceBudget);
      const result = await runLegacyAunitForSelection(client, type, name, sourceSnapshot, coverage, evidenceBudget);
      const stableSourceSnapshot = await verifyAunitSelectionSnapshot(
        client,
        type,
        name,
        includeSubpackages,
        sourceSnapshot,
        evidenceBudget,
      );
      const structured = reconcileAunitWithSelection(result, stableSourceSnapshot);
      if (resultFormat === 'structured') return textResult(toolJson(structured));
      if (resultFormat === 'junit') {
        return textResult(
          toolJson({
            protocol: 'legacy-generated',
            outcome: structured.outcome,
            summary: structured.summary,
            coverage: structured.coverage,
            coverageEvidence: structured.coverageEvidence,
            sourceSelectionEvidence: structured.sourceSelectionEvidence,
            junit: aunitResultToJunit(structured, `${type} ${name}`),
          }),
        );
      }
      const sourceSelectionUnsafe =
        structured.sourceSelectionEvidence?.status !== 'verified' ||
        (structured.sourceSelectionEvidence?.omittedTestClasses.length ?? 0) > 0;
      if (structured.outcome === 'incomplete' || sourceSelectionUnsafe) {
        return errorResult(toolJson(structured));
      }
      // Default (no coverage) keeps the historical array output; coverage requested → {tests, coverage}.
      const tests = toLegacyAunitResults(structured);
      if (!coverage) return textResult(toolJson(tests));
      const out: Record<string, unknown> = { tests };
      if (structured.coverage) out.coverage = structured.coverage;
      else
        out.coverageNote =
          'Coverage unavailable on this system (the coverage-measurement endpoint or measurement result was not available).';
      return textResult(toolJson(out));
    }
    case 'atc': {
      const objectUrl = objectUrlForType(type, name);
      const variant = args.variant as string | undefined;
      const result = await runAtcCheck(client.http, client.safety, objectUrl, variant, {
        ...(args.timeoutSeconds === undefined ? {} : { timeoutMs: Number(args.timeoutSeconds) * 1000 }),
      });
      const response =
        result.processedObjectCount === 0
          ? {
              ...result,
              hint: 'SAP reported no processed ATC objects. Verify the object, package, and selected check variant, then rerun ATC.',
            }
          : result;
      if (args.resultFormat === 'structured') return textResult(toolJson(response));
      // Keep the successful legacy `{findings}` shape, but never discard completeness failures:
      // a generic tool/CLI call must not turn malformed or missing worklist evidence into a clean run.
      if (!result.complete) return errorResult(toolJson(response));
      return textResult(toolJson({ findings: result.findings }));
    }
    case 'atc_variants': {
      // Discover which check variant to pass to action="atc": the system default (used when none is
      // given) + the available variants. `variant` doubles as an optional name filter (default all).
      // Trim/normalize so the echoed `filter` matches what listAtcVariants actually queries.
      const filter = (args.variant as string | undefined)?.trim() || '*';
      // The variant list is the core result; the system default is a best-effort annotation. Only
      // swallow "endpoint absent / not negotiable" (404/406) — a system that simply doesn't expose
      // /atc/customizing still gives a useful list. Auth (401/403), 5xx, and network failures are
      // real problems and must surface, not masquerade as a null default (would hide a regression).
      const [systemDefault, variants] = await Promise.all([
        getAtcSystemDefaultVariant(client.http, client.safety).catch((err) => {
          if (err instanceof AdtApiError && (err.statusCode === 404 || err.statusCode === 406)) return undefined;
          throw err;
        }),
        listAtcVariants(client.http, client.safety, filter),
      ]);
      return textResult(
        toolJson({
          systemDefault: systemDefault ?? null,
          filter,
          count: variants.length,
          variants: variants.map((v) => ({ name: v.name, description: v.description })),
        }),
      );
    }
    case 'cds_testcases': {
      // SAP-suggested ABAP Unit test cases for a CDS entity (CDS Test Double Framework).
      // The CDS name goes straight into the ?ddlsourceName= query param — no object URL.
      if (!name) {
        return errorResult('"name" (the CDS entity / DDLS source name) is required for "cds_testcases".');
      }
      // Discovery-gate: the endpoint exists only on SAP_BASIS 8.16+ (ABAP Platform 2025).
      // `false` = discovery loaded and the collection is absent (7.5x / 758) → clear message.
      // `undefined` = discovery not loaded → attempt and let a 404/400 surface normally.
      if (supportsCdsTestCases(client.http) === false) {
        return errorResult(
          'CDS test-case scaffolding requires SAP_BASIS 8.16+ (ABAP Platform 2025 / S/4HANA 2025). ' +
            'This system does not expose /sap/bc/adt/aunit/dbtestdoubles/cds/testcases.',
        );
      }
      const result = await getCdsTestCases(client.http, client.safety, name);
      const payload = {
        ...result,
        hint:
          `Scaffold an ABAP Unit test class for ${result.cds}: ` +
          `cl_cds_test_environment=>create( i_for_entity = '${result.cds}' ) in class_setup, ` +
          'then implement one FOR TESTING method per case (insert_test_data for the doubled sources, ' +
          'assert with cl_abap_unit_assert). AI testdata/testmethod generation is not exposed.',
      };
      return textResult(toolJson(payload));
    }
    case 'object_state': {
      if (!name || !type) return errorResult('"name" and "type" are required for "object_state" action.');
      const sections =
        type === 'CLAS'
          ? [
              { section: 'main', uri: sourceUrlForType(type, name) },
              { section: 'definitions', uri: classIncludeUrl(name, 'definitions'), optional: true },
              { section: 'implementations', uri: classIncludeUrl(name, 'implementations'), optional: true },
              { section: 'macros', uri: classIncludeUrl(name, 'macros'), optional: true },
              { section: 'testclasses', uri: classIncludeUrl(name, 'testclasses'), optional: true },
            ]
          : [{ section: 'main', uri: sourceUrlForType(type, name) }];

      const result = await getObjectState(client.http, client.safety, { type, name, sections });
      return textResult(toolJson(result));
    }
    case 'quickfix': {
      const source = args.source as string | undefined;
      const sourceUri = args.sourceUri as string | undefined;
      if (!name || !type) return errorResult('"name" and "type" are required for "quickfix" action.');
      if (!source) return errorResult('"source" is required for "quickfix" action.');
      if (args.line == null) return errorResult('"line" is required for "quickfix" action.');

      const line = Number(args.line);
      const column = Number(args.column ?? 0);
      if (!Number.isFinite(line)) return errorResult('"line" must be a number for "quickfix" action.');
      if (!Number.isFinite(column)) return errorResult('"column" must be a number for "quickfix" action.');

      const proposals = await getFixProposals(
        client.http,
        client.safety,
        sourceUri ?? sourceUrlForType(type, name),
        source,
        line,
        column,
      );
      return textResult(toolJson(proposals));
    }
    case 'apply_quickfix': {
      const source = args.source as string | undefined;
      const sourceUri = args.sourceUri as string | undefined;
      const proposalUri = args.proposalUri as string | undefined;
      const proposalUserContent = args.proposalUserContent as string | undefined;
      const proposalAffectedObjects = args.proposalAffectedObjects as FixAffectedObject[] | undefined;
      if (!name || !type) return errorResult('"name" and "type" are required for "apply_quickfix" action.');
      if (!source) return errorResult('"source" is required for "apply_quickfix" action.');
      if (args.line == null) return errorResult('"line" is required for "apply_quickfix" action.');
      if (!proposalUri) return errorResult('"proposalUri" is required for "apply_quickfix" action.');
      if (proposalUserContent === undefined)
        return errorResult('"proposalUserContent" is required for "apply_quickfix" action.');

      const line = Number(args.line);
      const column = Number(args.column ?? 0);
      if (!Number.isFinite(line)) return errorResult('"line" must be a number for "apply_quickfix" action.');
      if (!Number.isFinite(column)) return errorResult('"column" must be a number for "apply_quickfix" action.');

      const deltas = await applyFixProposal(
        client.http,
        client.safety,
        {
          uri: proposalUri,
          type: 'quickfix/proposal',
          name: '',
          description: '',
          userContent: proposalUserContent,
          ...(proposalAffectedObjects ? { affectedObjects: proposalAffectedObjects } : {}),
        },
        sourceUri ?? sourceUrlForType(type, name),
        source,
        line,
        column,
      );
      return textResult(toolJson(deltas));
    }
    case 'dumps': {
      const id = args.id as string | undefined;
      if (id) {
        const detail = await getDump(client.http, client.safety, id);
        const includeFullText = args.includeFullText === true || String(args.includeFullText ?? '') === 'true';
        const selectedSections = selectDumpSections(detail, args.sections);

        const payload: Record<string, unknown> = {
          id: detail.id,
          error: detail.error,
          exception: detail.exception,
          program: detail.program,
          user: detail.user,
          timestamp: detail.timestamp,
          chapters: detail.chapters,
          terminationUri: detail.terminationUri,
          sections: selectedSections,
          selectedSectionIds: Object.keys(selectedSections),
          availableSections: detail.chapters.map((chapter) => ({
            id: chapter.name,
            title: chapter.title,
            line: chapter.line,
          })),
        };
        if (includeFullText) {
          payload.formattedText = detail.formattedText;
        }
        return textResult(toolJson(payload));
      }

      const user = args.user as string | undefined;
      const maxResults = args.maxResults ? Number(args.maxResults) : undefined;
      const dumps = await listDumps(client.http, client.safety, { user, maxResults });
      return textResult(toolJson(dumps));
    }
    case 'traces': {
      const id = args.id as string | undefined;
      if (id) {
        // Get trace analysis
        const analysis = String(args.analysis ?? 'hitlist');
        switch (analysis) {
          case 'hitlist': {
            const hitlist = await getTraceHitlist(client.http, client.safety, id);
            return textResult(toolJson(hitlist));
          }
          case 'statements': {
            const statements = await getTraceStatements(client.http, client.safety, id);
            return textResult(toolJson(statements));
          }
          case 'dbAccesses': {
            const dbAccesses = await getTraceDbAccesses(client.http, client.safety, id);
            return textResult(toolJson(dbAccesses));
          }
          default:
            return errorResult(`Unknown trace analysis type: ${analysis}. Supported: hitlist, statements, dbAccesses`);
        }
      }
      // List traces
      const traces = await listTraces(client.http, client.safety);
      return textResult(toolJson(traces));
    }
    case 'trace_start': {
      const opts: TraceRequestCreateOptions = {};
      if (args.traceUser !== undefined) opts.traceUser = String(args.traceUser);
      if (args.processType !== undefined) opts.processType = args.processType as TracedProcessType;
      if (args.objectType !== undefined) opts.objectType = args.objectType as TracedObjectType;
      if (args.maxExecutions !== undefined) opts.maxExecutions = Number(args.maxExecutions);
      if (args.expiresHours !== undefined) opts.expiresHours = Number(args.expiresHours);
      if (args.sqlTrace !== undefined) opts.sqlTrace = args.sqlTrace === true;
      if (args.aggregate !== undefined) opts.aggregate = args.aggregate === true;
      if (args.description !== undefined) opts.description = String(args.description);
      const request = await createTraceRequest(client.http, client.safety, client.username, client.sapClient, opts);
      return textResult(
        toolJson({
          armed: true,
          request,
          next: 'Reproduce the slow action (e.g. the OData call) as this user PROMPTLY — an http request captures the user\'s very next matching HTTP call, so avoid other ARC-1 calls in between (they would consume it). Then SAPDiagnose(action="traces") with no id to list recorded traces, find the new trace id, and read it with analysis="dbAccesses". Note: for an HTTP/OData trace, dbAccesses lists the tables the request touched but SAP returns no per-statement SQL text/timing here (hitlist/statements are usually empty); for the actual slow SQL + duration + plan use ST05 in SAP GUI. The profiler trace is richest for dialog/report/RFC traces of ABAP-side code.',
        }),
      );
    }
    case 'trace_requests': {
      const user = (args.traceUser as string | undefined) ?? (args.user as string | undefined) ?? client.username;
      const requests = await listTraceRequests(client.http, client.safety, user);
      return textResult(toolJson(requests));
    }
    case 'trace_cancel': {
      const id = args.id as string | undefined;
      if (!id) return errorResult('trace_cancel requires "id" (from trace_start or trace_requests).');
      await deleteTraceRequest(client.http, client.safety, id);
      return textResult(toolJson({ cancelled: true, id }));
    }
    case 'system_messages': {
      const user = args.user as string | undefined;
      const maxResults = args.maxResults ? Number(args.maxResults) : undefined;
      const from = args.from as string | undefined;
      const to = args.to as string | undefined;
      const messages = await listSystemMessages(client.http, client.safety, { user, maxResults, from, to });
      return textResult(toolJson(messages));
    }
    case 'gateway_errors': {
      if (isBtpSystem()) {
        return errorResult(
          'SAP Gateway error log is not available on BTP ABAP Environment. Use this action on on-prem systems.',
        );
      }

      const user = args.user as string | undefined;
      const maxResults = args.maxResults ? Number(args.maxResults) : undefined;
      const from = args.from as string | undefined;
      const to = args.to as string | undefined;
      const detailUrl = args.detailUrl as string | undefined;
      const id = args.id as string | undefined;
      const errorType = args.errorType as string | undefined;

      if (detailUrl || id) {
        const detail = await getGatewayErrorDetail(client.http, client.safety, { detailUrl, id, errorType });
        return textResult(toolJson(detail));
      }

      const errors = await listGatewayErrors(client.http, client.safety, { user, maxResults, from, to });
      return textResult(toolJson(errors));
    }
    case 'odata_perf': {
      const url = String(args.url ?? '').trim();
      if (!url) {
        return errorResult(
          'SAPDiagnose action="odata_perf" requires a "url" — the host-relative OData path from the Fiori app\'s Network tab (e.g. "/sap/opu/odata4/sap/.../Entity?$filter=..." or "/sap/opu/odata/sap/<SRV>/<EntitySet>?$top=20"). ARC-1 GETs it with ?sap-statistics=true and a wall-clock timer, then returns the server-side timing split + a routing verdict.',
        );
      }
      const perf = await probeODataPerformance(client.http, client.safety, url);
      return textResult(toolJson(perf));
    }
    case 'cds_sql': {
      if (!name) {
        return errorResult(
          'SAPDiagnose action="cds_sql" requires a "name" — the CDS DDL source (DDLS), e.g. "I_CURRENCY". Returns the native SQL CREATE VIEW statements the CDS view compiles to.',
        );
      }
      const cdsSql = await getCdsCreateStatements(client.http, client.safety, name);
      return textResult(toolJson(cdsSql));
    }
    case 'sql_trace_state': {
      const states = await getSqlTraceState(client.http, client.safety);
      return textResult(toolJson(states));
    }
    case 'set_sql_trace_state': {
      if (args.sqlOn === undefined) {
        return errorResult(
          'SAPDiagnose action="set_sql_trace_state" requires "sqlOn" (true to arm the ST05 SQL trace, false to disarm). Optional "user" filters the trace to one SAP user. After arming, reproduce the slow request, then call action="sql_trace_directory" for the record-viewer link. Needs SAP_ALLOW_WRITES.',
        );
      }
      const sqlOn = args.sqlOn === true || String(args.sqlOn) === 'true';
      const traceUser = args.user !== undefined ? String(args.user) : undefined;
      const states = await setSqlTraceState(client.http, client.safety, { sqlOn, traceUser });
      return textResult(
        toolJson({
          states,
          next: sqlOn
            ? 'SQL trace armed. Reproduce the slow request, then call SAPDiagnose(action="sql_trace_directory") for the SQL Trace Analysis link, or read the generated SQL with SAPDiagnose(action="cds_sql").'
            : 'SQL trace disarmed.',
        }),
      );
    }
    case 'sql_trace_directory': {
      const dir = await getSqlTraceDirectory(client.http, client.safety);
      return textResult(toolJson(dir));
    }
    case 'authorization_trace': {
      const user = String(args.user ?? '').trim() || undefined;
      const authObject = String(args.authObject ?? '').trim() || undefined;
      const onlyFailures = args.onlyFailures === true || String(args.onlyFailures ?? '') === 'true';
      const maxResults = args.maxResults === undefined ? undefined : Number(args.maxResults);

      try {
        const result = await getAuthorizationTrace(client, { user, authObject, onlyFailures, maxResults });
        return textResult(toolJson(result));
      } catch (err) {
        if (err instanceof AdtApiError && /Cannot find '/i.test(err.message)) {
          return errorResult(
            'Authorization trace not available on this system. It reads the on-prem STUSERTRACE table ' +
              "SUAUTHVALTRC (SAP_BASIS 7.40 SP16+); on ABAP Cloud/Steampunk use the 'Display " +
              "Authorization Trace' Fiori app. Requires SAP_ALLOW_DATA_PREVIEW.",
          );
        }
        throw err;
      }
    }
    default:
      return errorResult(
        `Unknown SAPDiagnose action: ${action}. Supported: syntax, unittest, atc, atc_variants, cds_testcases, object_state, quickfix, apply_quickfix, dumps, traces, trace_start, trace_requests, trace_cancel, system_messages, gateway_errors, odata_perf, cds_sql, sql_trace_state, set_sql_trace_state, sql_trace_directory, authorization_trace`,
      );
  }
}

function selectDumpSections(detail: DumpDetail, requestedSections: unknown): Record<string, string> {
  const availableSections = detail.sections ?? {};
  const availableIds = Object.keys(availableSections);
  if (availableIds.length === 0) return {};

  const requestedIds = resolveRequestedDumpSectionIds(detail, requestedSections);
  const selectedIds = requestedIds.length > 0 ? requestedIds : pickDefaultDumpSectionIds(detail);
  const finalIds = selectedIds.length > 0 ? selectedIds : availableIds.slice(0, 5);

  return Object.fromEntries(finalIds.map((id) => [id, availableSections[id] ?? '']));
}

function resolveRequestedDumpSectionIds(detail: DumpDetail, requestedSections: unknown): string[] {
  if (!Array.isArray(requestedSections)) return [];
  const availableIds = new Set(Object.keys(detail.sections ?? {}));
  const resolved = requestedSections
    .map((entry) => resolveDumpSectionId(detail, String(entry ?? '')))
    .filter((entry): entry is string => typeof entry === 'string' && availableIds.has(entry));
  return Array.from(new Set(resolved));
}

function resolveDumpSectionId(detail: DumpDetail, candidate: string): string | undefined {
  const normalizedCandidate = normalizeDumpSectionKey(candidate);
  if (!normalizedCandidate) return undefined;

  const direct = detail.chapters.find((chapter) => normalizeDumpSectionKey(chapter.name) === normalizedCandidate)?.name;
  if (direct) return direct;

  const exactTitle = detail.chapters.find(
    (chapter) => normalizeDumpSectionKey(chapter.title) === normalizedCandidate,
  )?.name;
  if (exactTitle) return exactTitle;

  const fuzzyTitle = detail.chapters.find((chapter) =>
    normalizeDumpSectionKey(chapter.title).includes(normalizedCandidate),
  )?.name;
  return fuzzyTitle;
}

function pickDefaultDumpSectionIds(detail: DumpDetail): string[] {
  const wanted = ['short text', 'what happened', 'error analysis', 'source code extract', 'active calls', 'call stack'];
  const selected: string[] = [];

  for (const pattern of wanted) {
    const found = detail.chapters.find(
      (chapter) => normalizeDumpSectionKey(chapter.title).includes(normalizeDumpSectionKey(pattern)) && chapter.name,
    );
    if (found?.name && !selected.includes(found.name) && detail.sections[found.name]) {
      selected.push(found.name);
    }
  }

  if (selected.length > 0) return selected;

  const ordered = [...detail.chapters]
    .sort((a, b) => {
      if (a.line !== b.line) return a.line - b.line;
      return a.chapterOrder - b.chapterOrder;
    })
    .map((chapter) => chapter.name)
    .filter((name) => Boolean(name) && Boolean(detail.sections[name]));
  return Array.from(new Set(ordered)).slice(0, 5);
}

function normalizeDumpSectionKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
