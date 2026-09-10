/** Native ATC batches with explicit requested-object coverage and one bounded verification run. */
import { normalizeObjectType, objectUrlForType } from '../handlers/object-types.js';
import { getCurrentContext } from '../server/context.js';
import { logger } from '../server/logger.js';
import {
  ATC_SETTLE_QUIET_MS,
  type AtcObjectIdentity,
  type AtcPollOptions,
  type AtcRunResult,
  prepareAtcExecution,
  runAtcWorklist,
} from './atc.js';
import { AdtApiError, AdtNetworkError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { canonicalHostRelativeAdtPath } from './path-safety.js';
import type { SafetyConfig } from './safety.js';

// DDIC uses ATC's own R3TR reference: TABL covers both tables and structures,
// including releases without the /ddic/tables editor. No subtype lookup is needed.
const ATC_DDIC_BATCH_TYPES = ['TABL', 'DTEL', 'DOMA'] as const;

export function atcDdicObjectUrl(type: string, name: string): string | undefined {
  return ATC_DDIC_BATCH_TYPES.some((candidate) => candidate === type)
    ? `/sap/bc/adt/atc/objects/R3TR/${type}/${encodeURIComponent(name)}`
    : undefined;
}

// Other object-root routes need no parent/group resolution.
export const ATC_BATCH_TYPES = [
  'CLAS',
  'INTF',
  'PROG',
  'FUGR',
  'DDLS',
  'DCLS',
  'BDEF',
  'DDLX',
  'SRVD',
  'SRVB',
  ...ATC_DDIC_BATCH_TYPES,
] as const;
export const ATC_BATCH_MAX_OBJECTS = 20;
export const ATC_BATCH_NAME_PATTERN = '^(?:/[A-Za-z0-9_]+/)?[A-Za-z0-9_]+$';
export const ATC_BATCH_NAME_MAX_LENGTH = 40;
const ATC_BATCH_NAME_REGEX = new RegExp(ATC_BATCH_NAME_PATTERN);

export interface AtcBatchObject extends AtcObjectIdentity {
  type: (typeof ATC_BATCH_TYPES)[number];
}

interface AtcObjectCoverage extends AtcObjectIdentity {
  status: 'reported' | 'notReported';
  /** Unknown for missing or incomplete evidence; never synthesize a clean result. */
  findingCount: number | null;
  worklistId: string | null;
}

function objectKey(object: AtcObjectIdentity): string {
  // Explicit aliases distinguish FUGR/F (group) from FUGR/FF (function module).
  return `${normalizeObjectType(object.type)}:${object.name.replace(/[a-z]/g, (char) => char.toUpperCase())}`;
}

function sameObject(requested: AtcBatchObject, reported: AtcObjectIdentity): boolean {
  if (objectKey(requested) !== objectKey(reported)) return false;
  const root = objectUrlForType(requested.type, requested.name);
  const candidates = [
    requested.uri,
    root,
    `/sap/bc/adt/atc/objects/R3TR/${requested.type}/${encodeURIComponent(requested.name)}`,
  ];
  if (requested.type === 'TABL') candidates.push(objectUrlForType('TABL/DS', requested.name));
  else if (!atcDdicObjectUrl(requested.type, requested.name) && requested.type !== 'SRVB')
    candidates.push(`${root}/source/main`);
  // ABAP names and percent-hex case are equivalent; SAP emits %2f. Accept only
  // exact known object roots/source-main, including the literal namespace form.
  return candidates.some((candidate) =>
    [candidate, candidate.replace(encodeURIComponent(requested.name), requested.name)].some(
      (uri) => uri.toLowerCase() === reported.uri.toLowerCase(),
    ),
  );
}

function reconcile(objects: readonly AtcBatchObject[], runs: readonly AtcRunResult[]): AtcObjectCoverage[] {
  return objects.map((object) => {
    for (const run of runs) {
      const rows = run.processedObjects?.filter((row) => sameObject(object, row)) ?? [];
      if (rows.length === 0) continue;
      return {
        ...object,
        status: 'reported',
        findingCount: run.complete && rows.length === 1 ? rows[0]!.findingCount : null,
        worklistId: run.worklistId,
      };
    }
    return { ...object, status: 'notReported', findingCount: null, worklistId: null };
  });
}

function reviewBatchEvidence(run: AtcRunResult, selection: readonly AtcBatchObject[]) {
  const keys = (run.processedObjects ?? []).map(objectKey);
  if (new Set(keys).size !== keys.length) {
    run.complete = false;
    run.incompleteReasons.push('SAP reported duplicate ATC object identities.');
  }
  if (run.findings.some((finding) => !finding.object)) {
    run.complete = false;
    run.incompleteReasons.push('Some ATC findings have no valid enclosing object identity.');
  }
  if (
    (run.processedObjects ?? []).some((row) =>
      selection.some((object) => objectKey(object) === objectKey(row) && !sameObject(object, row)),
    )
  ) {
    run.complete = false;
    run.incompleteReasons.push('SAP returned an object URI inconsistent with the requested identity.');
  }
  // A verification worklist may repeat an already checked object. Count only
  // this run's explicit selection; keep run totals and the excluded count as evidence.
  const selectedKeys = new Set(selection.map(objectKey));
  const selectedFindings = run.findings.filter(
    (finding) => !finding.object || selectedKeys.has(objectKey(finding.object)),
  );
  return { ...run, selectedFindings, excludedFindingCount: run.findings.length - selectedFindings.length };
}

export async function runAtcBatch(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objects: readonly AtcBatchObject[],
  variant?: string,
  pollOptions: AtcPollOptions = {},
) {
  // Validate at the executor boundary too; the public tool applies the same limits before routing.
  if (
    objects.length < 1 ||
    objects.length > ATC_BATCH_MAX_OBJECTS ||
    objects.some(
      (object) =>
        !ATC_BATCH_TYPES.includes(object.type) ||
        object.name.length > ATC_BATCH_NAME_MAX_LENGTH ||
        !ATC_BATCH_NAME_REGEX.test(object.name) ||
        !canonicalHostRelativeAdtPath(object.uri, '/sap/bc/adt/', { allowRawEncodedSlash: true }) ||
        object.uri.includes('?'),
    )
  )
    throw new Error('Invalid ATC batch selection.');
  const selected = [...new Map(objects.map((object) => [objectKey(object), object])).values()];
  const execution = await prepareAtcExecution(http, safety, variant, pollOptions);
  const runs = [
    reviewBatchEvidence(
      await runAtcWorklist(
        http,
        safety,
        selected.map((object) => object.uri),
        execution,
        true,
      ),
      selected,
    ),
  ];
  let coverage = reconcile(selected, runs);
  const missing = selected.filter((_object, index) => coverage[index]!.status === 'notReported');
  const incompleteReasons: string[] = [];
  let verificationAttempted = false;
  if (runs[0]!.complete && missing.length > 0) {
    if (!execution.variant || execution.variantSource === 'requestedUnverified') {
      incompleteReasons.push('Verification was skipped because the effective check variant could not be confirmed.');
    } else if (pollOptions.signal?.aborted || (pollOptions.now ?? Date.now)() >= execution.requestOptions.deadline!) {
      incompleteReasons.push('Verification was skipped because the request was cancelled or its deadline expired.');
    } else if (
      runs[0]!.completionEvidence === 'legacyWorklistSettled' &&
      execution.requestOptions.deadline! - (pollOptions.now ?? Date.now)() <= ATC_SETTLE_QUIET_MS
    ) {
      incompleteReasons.push(
        'Verification was skipped because the remaining deadline cannot cover legacy worklist settlement.',
      );
    } else {
      verificationAttempted = true;
      try {
        runs.push(
          reviewBatchEvidence(
            await runAtcWorklist(
              http,
              safety,
              missing.map((object) => object.uri),
              execution,
              true,
            ),
            missing,
          ),
        );
      } catch (error) {
        if (
          pollOptions.signal?.aborted ||
          (error instanceof AdtNetworkError && error.cause?.name === 'AbortError') ||
          !(error instanceof AdtApiError || error instanceof AdtNetworkError)
        )
          throw error;
        logger.warn('ATC verification failed; initial findings retained.', {
          requestId: getCurrentContext()?.requestId,
          worklistId: runs[0]!.worklistId,
          errorClass: error.name,
          ...(error instanceof AdtApiError ? { statusCode: error.statusCode } : {}),
        });
        incompleteReasons.push('ATC verification could not be completed; initial findings are retained.');
      }
      coverage = reconcile(selected, runs);
    }
  }
  for (const run of runs)
    incompleteReasons.push(...run.incompleteReasons.map((reason) => `${run.worklistId}: ${reason}`));
  const unreportedCount = coverage.filter((object) => object.status === 'notReported').length;
  if (unreportedCount > 0)
    incompleteReasons.push(`SAP did not report ${unreportedCount} requested object(s); their findings are unknown.`);
  if (coverage.some((object) => object.status === 'reported' && object.findingCount === null)) {
    incompleteReasons.push('Finding counts remain unknown for objects from an incomplete run.');
  }
  const findings = runs.flatMap((run) =>
    run.selectedFindings.map(({ object, ...finding }) => ({
      ...finding,
      ...(object ? { object: { type: normalizeObjectType(object.type), name: object.name } } : {}),
      worklistId: run.worklistId,
    })),
  );
  return {
    complete: incompleteReasons.length === 0 && runs.every((run) => run.complete),
    variant: execution.variant ?? null,
    variantSource: execution.variantSource,
    requestedObjectCount: objects.length,
    uniqueObjectCount: selected.length,
    reportedObjectCount: coverage.length - unreportedCount,
    coverage,
    findings,
    findingCount: findings.length,
    verificationAttempted,
    incompleteReasons,
    // Keep separate provenance and statistics; never pretend two worklists were one run.
    runs: runs.map(
      ({ findings: _findings, processedObjects: _objects, selectedFindings: _selected, ...metadata }) => metadata,
    ),
  };
}
