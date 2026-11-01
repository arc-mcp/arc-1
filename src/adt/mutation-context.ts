/** Internal, request-owned policy for the shared mutation lifecycle. Never built from tool arguments. */
import { AdtSafetyError } from './errors.js';
import type { AdtHttpClient, AdtRequestOptions } from './http.js';
import type { MultiTargetWritePolicy, SafetyConfig } from './safety.js';

export interface MutationCleanupState {
  unlockFailed: boolean;
  sessionClosed?: boolean;
  /** The LOCK request may have reached SAP without returning its handle/context. */
  unknownLocks?: { uri: string; statusCode?: number }[];
  unlockFailures?: { uri: string; statusCode?: number; absentAfterDelete?: true }[];
  /** Typed UNLOCK 404 after verified DELETE/absence, resolved only by confirmed owning-session closure. */
  removedLocksAfterDelete?: { uri: string; statusCode: 404; absentAfterDelete: true }[];
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
  /** Source saves remain separate; owner or internal resource activation needs its native validation. */
  readonly activationPolicy: 'validated-native-activation';
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
    activationPolicy: 'validated-native-activation',
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
      if (context.cleanup.sessionClosed !== false) context.cleanup.sessionClosed = closed;
    },
  };
}
