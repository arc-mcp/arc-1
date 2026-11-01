/** Existing pinned result serialization, shared by source writes and activation. */

import type { ActivationResult } from '../../adt/devtools.js';
import { AdtApiError, AdtSafetyError } from '../../adt/errors.js';
import type { MutationCleanupState } from '../../adt/mutation-context.js';
import type { PinnedProgramOwnerEvidence } from '../../adt/pinned-program-owner.js';
import { getCurrentContext } from '../../server/context.js';
import { errorResult, type ToolResult, toolJson } from '../shared.js';

const refusedStates = new Set([
  'unchanged',
  'creation-rejected',
  'include-initialization-rejected',
  'source-save-rejected',
]);

export function isPinnedWriteRejection(error: unknown): boolean {
  return error instanceof AdtApiError && [400, 401, 403, 404, 409, 412, 415, 422, 423].includes(error.statusCode);
}

/** A definitive native rejection applies to the submitted phase, not prior successful steps. */
export function rejectedPinnedSourceState(state: string, phase: string, includeInitialized?: boolean): string {
  if (phase === 'create') return 'creation-rejected';
  if (phase === 'include-initialization') return 'include-initialization-rejected';
  if (phase === 'source-save')
    return includeInitialized
      ? 'created-include-source-rejected'
      : state.startsWith('created-')
        ? 'created-source-rejected'
        : 'source-save-rejected';
  // Text-pool PUT is not known atomic on error: native 400 responses can follow a committed part.
  // Keep its submitted state unknown until an explicit readback, even for ordinary HTTP refusals.
  return state;
}

export function pinnedFailure(
  error: unknown,
  state: string,
  phase: string,
  cleanupFailed = false,
  details: {
    sourceHash?: string;
    sessionClosed?: boolean;
    unlockFailures?: MutationCleanupState['unlockFailures'];
    include?: string;
    initialized?: boolean;
    warnings?: string;
    transport?: string;
    textPart?: string;
    activePartVerified?: boolean;
    nativeActivation?: ActivationResult;
    includeUsage?: PinnedProgramOwnerEvidence['includeUsage'];
    textPoolState?: 'active' | 'inactive' | 'unknown';
    next?: string;
  } = {},
): ToolResult {
  const context = getCurrentContext();
  const { transport, ...otherDetails } = details;
  return errorResult(
    toolJson({
      error: refusedStates.has(state) ? 'PINNED_WRITE_REFUSED' : 'PINNED_WRITE_INCOMPLETE',
      message:
        error instanceof AdtSafetyError
          ? error.message
          : state === 'unchanged'
            ? 'No create, source save or activation request was sent. Review the reported phase before continuing.'
            : state.endsWith('-rejected')
              ? 'SAP rejected this operation phase. Review the status and current object before continuing.'
              : 'SAP did not confirm the complete operation. Inspect the object and its inactive source before deciding the next action.',
      target: context?.target,
      requestId: context?.requestId,
      retryable: false,
      state,
      phase,
      ...(error instanceof AdtApiError ? { statusCode: error.statusCode } : {}),
      ...otherDetails,
      ...(!refusedStates.has(state) && transport ? { transport } : {}),
      ...(cleanupFailed || details.sessionClosed === false
        ? {
            cleanupFailed: true,
            cleanup: !cleanupFailed
              ? 'Session closure failed. Verify the SAP session and any remaining locks before continuing.'
              : details.sessionClosed === true
                ? 'Unlock failed; the owning session was closed. Verify the SAP lock before continuing.'
                : 'Unlock failed; session closure was not confirmed. Verify the SAP lock before continuing.',
          }
        : {}),
    }),
  );
}
