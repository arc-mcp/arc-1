import { AdtApiError, AdtSafetyError } from '../../adt/errors.js';
import { type ToolResult, textResult, toolJson } from '../shared.js';

export const BATCH_CREATE_MAX_OBJECTS = 100;

type Persistence = 'not_attempted' | 'confirmed' | 'unknown';
export type BatchFailurePhase = 'preflight' | 'create' | 'write' | 'activate';

export interface BatchEntryResult {
  index: number;
  type: string;
  name: string;
  packageName: string;
  status: 'success' | 'failed' | 'skipped';
  creation: Persistence;
  write: Persistence | 'not_required';
  activation: Persistence | 'failed';
  failedPhase?: BatchFailurePhase;
  error?: string;
}

export function batchEntryResult(index: number, type: string, name: string, packageName: string): BatchEntryResult {
  return {
    index,
    type,
    name,
    packageName,
    status: 'skipped',
    creation: 'not_attempted',
    write: 'not_required',
    activation: 'not_attempted',
  };
}

/** Runtime failures may wrap a SAP exception, so minimal mode also hides ordinary Error messages. */
export function batchFailureMessage(error: unknown, minimalErrors: boolean): string {
  if (minimalErrors && !(error instanceof AdtSafetyError)) {
    const status = error instanceof AdtApiError ? ` (HTTP ${error.statusCode})` : '';
    return `SAP operation failed${status}. Details hidden because ARC1_MINIMAL_ERRORS=true; use the request ID and server-side logs.`;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 2000 ? `${message.slice(0, 2000)}… [diagnostic truncated]` : message;
}

export function failBatchEntry(entry: BatchEntryResult, phase: BatchFailurePhase, error: string): void {
  entry.status = 'failed';
  entry.failedPhase = phase;
  entry.error = error;
}

export function batchCreateResult(
  results: BatchEntryResult[],
  options: { preflight?: boolean; activateAtEnd: boolean; warnings: string[] },
): ToolResult {
  const created = results.filter((entry) => entry.creation === 'confirmed').length;
  const creationUnknown = results.filter((entry) => entry.creation === 'unknown').length;
  const completed = results.filter((entry) => entry.status === 'success').length;
  const failed = results.filter((entry) => entry.status === 'failed').length;
  const skipped = results.filter((entry) => entry.status === 'skipped').length;
  const packages = [...new Set(results.map((entry) => entry.packageName))];
  const packageSummary =
    packages.length === 1
      ? `in package ${packages[0]}`
      : packages.length <= 3
        ? `across packages [${packages.join(', ')}]`
        : `across ${packages.length} packages`;
  const summary = results
    .map((entry) => {
      const label = `${entry.name} (${entry.type})`;
      if (entry.status === 'success') return `${label} ✓ [${entry.packageName}]`;
      const reason =
        entry.status === 'skipped'
          ? `skipped — ${options.preflight ? 'batch rejected by preflight' : 'stopped after previous failure'}`
          : entry.error;
      return `${label} ✗ [${entry.packageName}] — ${reason}`;
    })
    .join(', ');
  const warnings = options.warnings.length > 0 ? `\n\nPreflight warnings:\n- ${options.warnings.join('\n- ')}` : '';
  if (failed === 0 && skipped === 0) {
    const activation = options.activateAtEnd ? '; activated as a single batch' : '';
    return textResult(`Batch created ${created} objects ${packageSummary}${activation}: ${summary}${warnings}`);
  }
  const prefix = options.preflight
    ? `Batch preflight rejected ${failed}/${results.length} entries; no objects were created`
    : `Batch created ${created}/${results.length} objects ${packageSummary}; ${completed} completed, ${failed} failed, ${skipped} skipped`;
  const persisted =
    created > 0
      ? ` ${created} confirmed-created object(s) remain on SAP; source writing or activation may be incomplete.`
      : '';
  const uncertain =
    creationUnknown > 0
      ? ` ${creationUnknown} creation outcome(s) are unknown; zero confirmed creations does not prove absence.`
      : '';
  const recovery = options.preflight
    ? 'Correct the reported input/preflight failures before retrying.'
    : 'Verify object and source state with SAPRead before retrying; resume the failed phase explicitly. No rollback or overwrite was performed.';
  return {
    isError: true,
    content: [
      { type: 'text', text: `${prefix}: ${summary}${persisted}${uncertain}\n\n${recovery}${warnings}` },
      {
        type: 'text',
        text: toolJson({
          batch: {
            phase: options.preflight ? 'preflight' : 'execution',
            requested: results.length,
            created,
            creationUnknown,
            completed,
            failed,
            skipped,
            results,
          },
        }),
      },
    ],
  };
}
