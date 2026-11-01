import { AdtError } from '../../adt/errors.js';
import type { SapWriteContext } from './context.js';

/** Keep confirmed creation, typed diagnostics, and locally written recovery guidance together. */
export function postCreateError(
  ctx: Pick<SapWriteContext, 'config' | 'invalidateWrittenObject'>,
  cause: unknown,
  type: string,
  name: string,
  hint: string,
): AdtError {
  const error =
    cause instanceof AdtError
      ? cause
      : new AdtError(
          ctx.config.minimalErrors
            ? 'Post-create follow-up failed. Detailed diagnostics are hidden.'
            : cause instanceof Error
              ? cause.message
              : String(cause),
        );
  error.creationOutcome = 'confirmed';
  error.extraHint = [error.extraHint, hint].filter(Boolean).join('\n\n');
  try {
    ctx.invalidateWrittenObject(type, name);
  } catch {
    // Cache bookkeeping must not replace the original failure or its recovery guidance.
  }
  return error;
}
