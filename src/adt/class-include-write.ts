/** Shared class-local include protocol, with explicit legacy and pinned lifecycle policies. */
import { initClassInclude, type MutationLockPolicy, updateSource, withLockedMutation } from './crud.js';
import {
  AdtApiError,
  AdtSafetyError,
  classifySapDomainError,
  extractExceptionType,
  isNotFoundError,
} from './errors.js';
import type { AdtHttpClient, AdtRequestOptions } from './http.js';
import { assertMutationContext, type PinnedMutationContext, singleTargetMutationContext } from './mutation-context.js';
import { getMutationContext } from './mutation-http.js';
import { assertPinnedOwner } from './pinned-write-policy.js';
import { checkOperation, OperationType, type SafetyConfig } from './safety.js';
import { assertSourceHash, editableSourceEquals, sourceHash } from './source-precondition.js';

export interface PinnedClassIncludeMutation {
  readonly context: PinnedMutationContext;
  /** Must revalidate the actual class package/recording and native class lock. */
  readonly lockPolicy: MutationLockPolicy;
  readonly onPhase: (phase: 'include-read' | 'include-initialization' | 'source-save' | 'source-readback') => void;
}

function validatePinnedResource(owner: string, include: string): void {
  const prefix = '/sap/bc/adt/oo/classes/';
  if (
    !owner.startsWith(prefix) ||
    !['definitions', 'implementations', 'macros', 'testclasses'].some((name) => include === `${owner}/includes/${name}`)
  )
    throw new AdtSafetyError('The pinned include must belong to the locked class owner.');
  let name: string;
  try {
    name = decodeURIComponent(owner.slice(prefix.length));
  } catch {
    throw new AdtSafetyError('Invalid native class owner URL.');
  }
  assertPinnedOwner('CLAS', name.toUpperCase());
}

/** Native include absence, shared with locked RAP generation; service-level 404 is not absence. */
export function pinnedClassIncludeAbsent(error: unknown): boolean {
  return (
    error instanceof AdtApiError &&
    error.isNotFound &&
    extractExceptionType(error.responseBody ?? '') === 'ExceptionResourceNotFound' &&
    !classifySapDomainError(error.statusCode, error.responseBody, error.path)
  );
}

/** Exact include protocol inside an already-held class lock; never opens another session. */
export async function savePinnedClassIncludeSource(
  session: AdtHttpClient,
  safety: SafetyConfig,
  context: PinnedMutationContext,
  owner: string,
  include: string,
  source: string,
  handle: string,
  transport: string | undefined,
  initialize: boolean,
  before: (phase: 'include-initialization' | 'source-save' | 'source-readback') => Promise<void>,
  initialized?: () => void,
  readOptions?: AdtRequestOptions,
): Promise<{ initialized: boolean; source: string; sourceHash: string }> {
  assertMutationContext(safety, context);
  if (getMutationContext(session, safety) !== context)
    throw new AdtSafetyError('The include requires its scoped owning mutation session.');
  validatePinnedResource(owner, include);
  if (!handle) throw new AdtSafetyError('An owning class lock is required.');
  if (initialize) {
    await before('include-initialization');
    await initClassInclude(session, safety, include, handle, transport);
    initialized?.();
  }
  await before('source-save');
  await updateSource(session, safety, include, source, handle, transport);
  await before('source-readback');
  checkOperation(safety, OperationType.Read, 'GetClassInclude');
  const saved = await session.get(include, { 'Cache-Control': 'no-cache', Accept: 'text/plain' }, readOptions);
  if (!editableSourceEquals(saved.body, source))
    throw new AdtSafetyError(
      'Include save returned but editable source read-back differed. Inspect before continuing.',
    );
  return { initialized: initialize, source: saved.body, sourceHash: sourceHash(saved.body) };
}

/**
 * Lock the class, read its editable include, optionally initialize, then save and unlock.
 * Legacy callers retain optional hashes and their existing 404 initialization behavior.
 * Pinned callers require a registered context and lock policy. Existing source needs a hash;
 * an omitted hash permits initialization only after typed absence under the class lock.
 */
export async function safeUpdateClassInclude(
  http: AdtHttpClient,
  safety: SafetyConfig,
  classObjectUrl: string,
  includeUrl: string,
  source: string,
  transport?: string,
  abapRelease?: string,
  expectedSourceHash?: string,
  pinned?: PinnedClassIncludeMutation,
): Promise<{ initialized: boolean; source?: string; sourceHash?: string }> {
  checkOperation(safety, OperationType.Update, 'UpdateSource');
  const context = pinned?.context ?? singleTargetMutationContext(safety);
  assertMutationContext(safety, context);
  if (pinned) {
    if (
      context.mode !== 'pinned-pp' ||
      typeof pinned.lockPolicy?.beforeLock !== 'function' ||
      typeof pinned.lockPolicy?.validateLock !== 'function' ||
      typeof pinned.onPhase !== 'function'
    )
      throw new AdtSafetyError('Pinned include writes require the complete native lock policy.');
    validatePinnedResource(classObjectUrl, includeUrl);
    if (expectedSourceHash !== undefined && !/^[a-f0-9]{64}$/.test(expectedSourceHash))
      throw new AdtSafetyError('Read the editable include and provide its expectedSourceHash.');
  }
  return withLockedMutation(
    http,
    safety,
    context,
    classObjectUrl,
    pinned?.lockPolicy ?? { beforeLock: () => {}, validateLock: async () => {} },
    async (session, lock) => {
      // The pinned policy supplies the verified parent request; never fall back to a lock task.
      const effectiveTransport = pinned ? transport : (transport ?? (lock.corrNr || undefined));
      let initialized = false;
      let exists = true;
      try {
        pinned?.onPhase('include-read');
        checkOperation(safety, OperationType.Read, 'GetClassInclude');
        const headers = { 'Cache-Control': 'no-cache', ...(pinned ? { Accept: 'text/plain' } : {}) };
        const current = await session.get(includeUrl, headers, { suppressNotFoundLog: true });
        if (pinned && expectedSourceHash === undefined)
          throw new AdtSafetyError(
            'The include already exists. Read its editable source and provide expectedSourceHash.',
          );
        assertSourceHash(current.body, expectedSourceHash, includeUrl);
      } catch (error) {
        const absent = pinned ? pinnedClassIncludeAbsent(error) : isNotFoundError(error);
        if (absent && expectedSourceHash === undefined) exists = false;
        else throw error;
      }
      if (pinned)
        return savePinnedClassIncludeSource(
          session,
          safety,
          pinned.context,
          classObjectUrl,
          includeUrl,
          source,
          lock.lockHandle,
          effectiveTransport,
          !exists,
          async (phase) => {
            pinned.onPhase(phase);
          },
        );
      if (!exists) {
        await initClassInclude(session, safety, includeUrl, lock.lockHandle, effectiveTransport);
        initialized = true;
      }
      await updateSource(session, safety, includeUrl, source, lock.lockHandle, effectiveTransport);
      return { initialized };
    },
    abapRelease,
  );
}
