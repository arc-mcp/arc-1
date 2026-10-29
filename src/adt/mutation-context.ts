/** Internal, request-owned policy for the shared mutation lifecycle. Never built from tool arguments. */
import { AdtSafetyError } from './errors.js';
import type { AdtHttpClient, AdtRequestOptions } from './http.js';
import type { MultiTargetWritePolicy, SafetyConfig } from './safety.js';

export interface MutationCleanupState {
  unlockFailed: boolean;
  sessionClosed?: boolean;
}

interface SingleTargetMutationContext {
  readonly mode: 'single-target';
  readonly requestPolicy: undefined;
  readonly recordingPolicy: 'legacy';
  readonly identityMode: 'legacy';
  readonly activationPolicy: 'legacy';
  readonly cleanup: 'legacy-finally';
}

export interface PinnedMutationContext {
  readonly mode: 'pinned-pp';
  readonly requestPolicy: Readonly<AdtRequestOptions> & {
    readonly deadline: number;
    readonly noReplay: true;
    readonly retryTransientErrors: false;
  };
  readonly recordingPolicy: MultiTargetWritePolicy;
  readonly identityMode: 'mapped-user-unverified';
  /** Source saves do not activate. The existing separate activation adapter must validate the owner. */
  readonly activationPolicy: 'separate-whole-owner-validation';
  readonly cleanup: MutationCleanupState;
}

export type MutationContext = SingleTargetMutationContext | PinnedMutationContext;
const contexts = new WeakSet<MutationContext>();

function register<T extends MutationContext>(context: T): T {
  contexts.add(context);
  return Object.freeze(context);
}

/** Compatibility wrappers must refuse multi-target state instead of selecting the legacy path. */
export function singleTargetMutationContext(safety: SafetyConfig): MutationContext {
  if (safety.multiTargetWrite) throw new AdtSafetyError('Missing pinned mutation context.');
  return register({
    mode: 'single-target',
    requestPolicy: undefined,
    recordingPolicy: 'legacy',
    identityMode: 'legacy',
    activationPolicy: 'legacy',
    cleanup: 'legacy-finally',
  });
}

export function pinnedMutationContext(
  safety: SafetyConfig,
  budget: { deadline: number; signal?: AbortSignal },
  cleanup: MutationCleanupState,
): PinnedMutationContext {
  if (!safety.multiTargetWrite?.enabled || !Number.isFinite(budget.deadline))
    throw new AdtSafetyError('Missing enabled pinned mutation policy or finite request budget.');
  return register({
    mode: 'pinned-pp',
    requestPolicy: Object.freeze({ ...budget, noReplay: true, retryTransientErrors: false }),
    recordingPolicy: safety.multiTargetWrite,
    identityMode: 'mapped-user-unverified',
    activationPolicy: 'separate-whole-owner-validation',
    cleanup,
  });
}

export function assertMutationContext(safety: SafetyConfig, context: MutationContext): void {
  if (
    !contexts.has(context) ||
    (context.mode === 'single-target'
      ? !!safety.multiTargetWrite
      : !safety.multiTargetWrite?.enabled || context.recordingPolicy !== safety.multiTargetWrite)
  )
    throw new AdtSafetyError('Missing or mismatched mutation context.');
}

export function pinnedSessionCleanup(
  context: PinnedMutationContext,
): NonNullable<Parameters<AdtHttpClient['withStatefulSession']>[1]> {
  return {
    timeoutMs: 30_000,
    noReplay: true,
    onClose: (closed) => {
      context.cleanup.sessionClosed = closed;
    },
  };
}
