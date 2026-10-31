/** Existing pinned result serialization, shared by source writes and activation. */
import { AdtApiError, AdtSafetyError } from '../../adt/errors.js';
import { getCurrentContext } from '../../server/context.js';
import { errorResult, type ToolResult, toolJson } from '../shared.js';

export function pinnedFailure(
  error: unknown,
  state: string,
  phase: string,
  cleanupFailed = false,
  details: { sourceHash?: string; sessionClosed?: boolean } = {},
): ToolResult {
  const context = getCurrentContext();
  return errorResult(
    toolJson({
      error: ['unchanged', 'creation-rejected', 'source-save-rejected'].includes(state)
        ? 'PINNED_WRITE_REFUSED'
        : 'PINNED_WRITE_INCOMPLETE',
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
      ...details,
      ...(cleanupFailed
        ? {
            cleanupFailed: true,
            cleanup:
              details.sessionClosed === true
                ? 'Unlock failed; the owning session was closed. Verify the SAP lock before continuing.'
                : 'Unlock failed; session closure was not confirmed. Verify the SAP lock before continuing.',
          }
        : {}),
    }),
  );
}
