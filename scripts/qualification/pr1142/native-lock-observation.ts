/** Private diagnostic sequence: one LOCK, bounded reads, passive external observations, then cleanup. */
import { createHash } from 'node:crypto';
import type { AdtClient } from '../../../src/adt/client.js';
import { withLockedMutation } from '../../../src/adt/crud.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { pinnedMutationContext, type MutationCleanupState } from '../../../src/adt/mutation-context.js';
import { pinnedRecording, validatePinnedLock } from '../../../src/adt/pinned-write-policy.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import {
  contractFunctionMetadataHash,
  contractIdentity,
  contractRequestPolicy,
  contractSelection,
  type NativeContractSelection,
  observeContractHttp,
} from './native-contract-transport.js';

export type PassiveLockObservation = 'present' | 'absent' | 'changed' | 'unknown';
export interface LockObservationPrompt {
  step: string;
  resource: string;
  signal: AbortSignal;
}
export interface ActiveFunctionReceipt {
  hash: string;
  metadataHash: string;
}
export interface NativeLockObservationResult {
  state: 'observed' | 'stopped' | 'failed';
  phase: string;
  observations: { step: string; observation: PassiveLockObservation }[];
  lockAttempted: boolean;
  cleanupConfirmed: boolean;
  cleanup: MutationCleanupState;
}

/** Abort an external observation wait too; cleanup must not depend on its promise settling. */
async function boundedObservation(
  observe: (prompt: LockObservationPrompt) => Promise<PassiveLockObservation>,
  prompt: LockObservationPrompt,
): Promise<PassiveLockObservation> {
  prompt.signal.throwIfAborted();
  let listener: () => void = () => {};
  try {
    return await Promise.race([
      observe(prompt),
      new Promise<never>((_, reject) => {
        listener = () => reject(new Error('Passive observation cancelled.'));
        prompt.signal.addEventListener('abort', listener, { once: true });
        if (prompt.signal.aborted) listener();
      }),
    ]);
  } finally {
    prompt.signal.removeEventListener('abort', listener);
  }
}

/** No fixture creation, activation or DELETE. The caller must supply its recorded active receipt. */
export async function observeNativeFunctionLock(input: {
  client: AdtClient;
  selection: NativeContractSelection;
  marker: string;
  receipt: ActiveFunctionReceipt;
  observe: (prompt: LockObservationPrompt) => Promise<PassiveLockObservation>;
  record: (value: unknown) => void;
  verifySource: () => void;
  signal: AbortSignal;
  timeoutMs?: number;
}): Promise<NativeLockObservationResult> {
  const { client, selection, marker, receipt, observe, record, verifySource } = input;
  const canonical = contractSelection(selection.group.slice(-16));
  if (Object.entries(canonical).some(([key, value]) => selection[key as keyof NativeContractSelection] !== value))
    throw new Error('The observation selection is not canonical.');
  if (
    marker !== `ARC1 native contract ${selection.group.slice(-16)}` ||
    ![receipt.hash, receipt.metadataHash].every((value) => /^[a-f0-9]{64}$/.test(value))
  )
    throw new Error('The owned active-function receipt is incomplete.');
  const timeoutMs = input.timeoutMs ?? 240_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 240_000)
    throw new Error('The observation deadline must be at most four minutes.');
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)]);
  const budget = { ...contractRequestPolicy(), deadline: Date.now() + timeoutMs, fetchTimeoutMs: 30_000, signal };
  const context = pinnedMutationContext(client.safety, budget, { unlockFailed: false });
  const http = observeContractHttp(client.http, selection, record, async () => {
    throw new Error('Deletion is forbidden during passive lock observation.');
  });
  const observations: { step: string; observation: PassiveLockObservation }[] = [];
  let lockAttempted = false;
  let knownLock = false;
  let lockContext: string | undefined;
  let contextStable = false;
  let state: 'observed' | 'stopped' | 'failed' = 'failed';
  let phase = 'preflight';
  const check = () => {
    signal.throwIfAborted();
    verifySource();
  };
  async function read(session: AdtHttpClient, path: string) {
    check();
    const source = path.includes('/source/');
    const response = await session.get(
      path,
      {
        Accept: source ? 'text/plain' : 'application/*',
        'Cache-Control': 'no-cache',
      },
      contractRequestPolicy(context.requestPolicy),
    );
    const media = response.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
    if (
      response.statusCode !== 200 ||
      Buffer.byteLength(response.body) > 1024 * 1024 ||
      (source
        ? media !== 'text/plain'
        : !(media === 'application/xml' || media === 'text/xml' || media?.endsWith('+xml')))
    )
      throw new Error('A complete bounded native response with the expected media type is required.');
    if (!source) contractIdentity(response.body, path.split('?')[0] === selection.groupUrl, selection, marker);
    record({ observationRead: path, sha256: createHash('sha256').update(response.body).digest('hex') });
    return response.body;
  }
  const sessionContext = (session: AdtHttpClient) =>
    (session as unknown as { cookieJar: Map<string, string> }).cookieJar.get('sap-contextid');
  async function checkpoint(step: string, session: AdtHttpClient) {
    check();
    phase = step;
    const currentContext = sessionContext(session);
    contextStable = contextStable && !!currentContext && currentContext !== '0' && currentContext === lockContext;
    record({
      observationContext: step,
      present: !!currentContext,
      closed: currentContext === '0',
      sameAsLock: contextStable,
    });
    if (!contextStable) return false;
    const observation = await boundedObservation(observe, { step, resource: selection.module, signal });
    if (!['present', 'absent', 'changed', 'unknown'].includes(observation))
      throw new Error('Invalid passive observation.');
    record({ passiveObservation: step, observation, source: 'operator-SM12' });
    observations.push({ step, observation });
    check();
    return observation === 'present';
  }
  try {
    check();
    await read(http, selection.groupUrl);
    const metadata = await read(http, `${selection.moduleUrl}?version=active`);
    const source = await read(http, `${selection.moduleUrl}/source/main?version=active`);
    if (
      contractIdentity(metadata, false, selection, marker).nativeVersion !== 'active' ||
      contractFunctionMetadataHash(metadata, selection) !== receipt.metadataHash ||
      sourceHash(source) !== receipt.hash
    )
      throw new Error('The active fixture no longer matches its recorded receipt.');
    const recording = await pinnedRecording(
      http,
      client.safety,
      selection.moduleUrl,
      '$TMP',
      '',
      undefined,
      contractRequestPolicy(context.requestPolicy),
    );
    if (!recording.local || recording.request) throw new Error('The diagnostic requires an unrecorded local fixture.');
    await withLockedMutation(
      http,
      client.safety,
      context,
      selection.moduleUrl,
      {
        beforeLock: () => {
          check();
          phase = 'lock';
          lockAttempted = true;
        },
        validateLock: (session, lock) => {
          knownLock = true;
          lockContext = sessionContext(session);
          contextStable = !!lockContext && lockContext !== '0';
          return validatePinnedLock(session, client.safety, lock, recording, context.requestPolicy);
        },
      },
      async (session) => {
        try {
          state = 'stopped';
          if (!(await checkpoint('locked', session))) return;
          const steps = [
            { label: 'group-default', path: selection.groupUrl },
            { label: 'module-default', path: selection.moduleUrl },
            { label: 'recording-check', path: undefined },
            ...['active', 'inactive'].flatMap((version) => [
              { label: `group-${version}`, path: `${selection.groupUrl}?version=${version}` },
              { label: `module-${version}`, path: `${selection.moduleUrl}?version=${version}` },
              { label: `source-${version}`, path: `${selection.moduleUrl}/source/main?version=${version}` },
            ]),
          ];
          for (const step of steps) {
            check();
            phase = step.label;
            if (step.path) await read(session, step.path);
            else {
              const current = await pinnedRecording(
                session,
                client.safety,
                selection.moduleUrl,
                '$TMP',
                '',
                undefined,
                contractRequestPolicy(context.requestPolicy),
              );
              if (!current.local || current.request) throw new Error('The local recording context changed.');
            }
            if (!(await checkpoint(step.label, session))) return;
          }
          state = 'observed';
        } finally {
          const current = sessionContext(session);
          contextStable = contextStable && !!current && current !== '0' && current === lockContext;
          record({
            observationContext: 'before-cleanup',
            present: !!current,
            closed: current === '0',
            sameAsLock: contextStable,
          });
        }
      },
    );
  } catch (error) {
    state = 'failed';
    record({
      observationFailed: phase,
      errorType: error instanceof Error ? error.name : 'unknown',
      ...(error instanceof AdtApiError ? { statusCode: error.statusCode } : {}),
    });
  }
  const cleanupConfirmed =
    !lockAttempted ||
    (knownLock &&
      contextStable &&
      context.cleanup.sessionClosed === true &&
      !context.cleanup.unlockFailed &&
      !context.cleanup.unknownLocks?.length);
  record({
    observationFinished: state,
    phase,
    observations,
    lockAttempted,
    cleanupConfirmed,
    cleanup: context.cleanup,
  });
  // A complete transcript is not a proof of native handle identity or successful deletion.
  return { state, phase, observations, lockAttempted, cleanupConfirmed, cleanup: context.cleanup };
}
