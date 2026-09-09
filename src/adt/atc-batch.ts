/** Native ATC batches with explicit requested-object coverage and one bounded verification run. */
import {
  type AtcObjectIdentity,
  type AtcPollOptions,
  type AtcRunResult,
  prepareAtcExecution,
  runAtcWorklist,
} from './atc.js';
import { AdtApiError } from './errors.js';
import type { AdtHttpClient } from './http.js';
import { canonicalHostRelativeAdtPath } from './path-safety.js';
import type { SafetyConfig } from './safety.js';

// Only object-root routes that need no parent/group or DDIC-subtype resolution.
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
] as const;
export const ATC_BATCH_MAX_OBJECTS = 20;
export const ATC_BATCH_NAME_PATTERN = '^(?:/[A-Za-z0-9_]+/)?[A-Za-z0-9_]+$';
export const ATC_BATCH_NAME_MAX_LENGTH = 40;

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
  return `${object.type.toUpperCase().split('/')[0]}:${object.name.toUpperCase()}`;
}

function sameObject(requested: AtcBatchObject, reported: AtcObjectIdentity): boolean {
  if (objectKey(requested) !== objectKey(reported)) return false;
  // SAP 750/758/816 return ATC object URIs, not the original OO/DDIC object-root URI.
  const atcUri = `/sap/bc/adt/atc/objects/R3TR/${requested.type}/${encodeURIComponent(requested.name)}`;
  const uri = reported.uri.toLowerCase();
  return uri === requested.uri.toLowerCase() || uri === atcUri.toLowerCase();
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

function reviewBatchEvidence(run: AtcRunResult): AtcRunResult {
  const keys = (run.processedObjects ?? []).map(objectKey);
  if (new Set(keys).size !== keys.length) {
    run.complete = false;
    run.incompleteReasons.push('SAP reported duplicate ATC object identities.');
  }
  if (run.findings.some((finding) => !finding.object)) {
    run.complete = false;
    run.incompleteReasons.push('Some ATC findings have no valid enclosing object identity.');
  }
  return run;
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
        !new RegExp(ATC_BATCH_NAME_PATTERN).test(object.name) ||
        !canonicalHostRelativeAdtPath(object.uri, '/sap/bc/adt/', { allowRawEncodedSlash: true }) ||
        object.uri.includes('?'),
    )
  )
    throw new AdtApiError('Invalid ATC batch selection.', 400, '/sap/bc/adt/atc/runs');
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
          ),
        );
      } catch {
        // Do not throw away already collected findings or expose raw SAP/network error details.
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
    incompleteReasons.push('Some requested objects have incomplete or duplicate worklist evidence.');
  }
  const findings = runs.flatMap((run) => run.findings.map((finding) => ({ ...finding, worklistId: run.worklistId })));
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
    runs: runs.map(({ findings: _findings, processedObjects: _objects, ...metadata }) => metadata),
  };
}
