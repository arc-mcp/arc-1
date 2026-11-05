/** Fixed prepare/check/once-per-stage execution. Importing or checking never loads credentials. */
import { verifyRuntimeSt05History } from './native-runtime-st05-history.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AdtClient } from '../../../src/adt/client.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { assertDeclarativeRuntime, invalidNativeCredentialFields } from './native-declarative-entry.js';
import { verifyFlpNativeEvidence } from './native-flp-evidence.js';
import { claimDirectory, durableRecord, journal, nativeLockBinding, privateDirectory } from './native-lock-binding.js';
import { type RuntimeProtocol, runtimeProtocol } from './native-runtime-protocol.js';
import { verifyRuntimeRetainedV2History } from './native-runtime-retained-v2-history.js';
import { verifyRuntimeRetainedHistory } from './native-runtime-retained-history.js';
import type { runRuntimeSlice } from './native-runtime-slice-driver.js';
import {
  RuntimeFailure,
  type RuntimeStage,
  runtimeClassOwner,
  runtimeConfig,
  runtimeReason,
} from './native-runtime-slice-fixed.js';
import { readRuntimeBaseline, readRuntimeIntent, runtimeIntentData } from './native-runtime-slice-prerequisites.js';

export interface RuntimeDependencies {
  validateRuntime: () => void;
  bind: typeof nativeLockBinding;
  verifyEvidence: () => void;
  readEnv: (repo: string) => Record<string, string>;
  createClient: (input: ConstructorParameters<typeof AdtClient>[0]) => AdtClient;
  execute?: typeof runRuntimeSlice;
}
export function assertRuntimeSliceRuntime(env = process.env, argv = process.execArgv, node = process.version) {
  assertDeclarativeRuntime(env, argv);
  if (node !== 'v22.21.1' || env.ARC1_LOG_HTTP_DEBUG !== undefined) throw new RuntimeFailure('runtime');
}
export async function runFixedRuntimeProtocol(
  args: string[],
  kind: RuntimeProtocol,
  entry: URL,
  dependencies?: RuntimeDependencies,
) {
  const protocol = runtimeProtocol(kind);
  const fixedEntry = new URL(protocol.entry, import.meta.url);
  if (entry.href !== fixedEntry.href) throw new RuntimeFailure('scope');
  const commands = new Map<string, string>([
    [`--prepare-reviewed-${protocol.command}`, 'prepare'],
    [`--verify-reviewed-${protocol.command}-cleanup`, 'verify-final'],
  ]);
  for (const stage of protocol.stages) {
    commands.set(`--check-reviewed-${protocol.command}-${stage}`, `check:${stage}`);
    commands.set(`--execute-reviewed-${protocol.command}-${stage}`, `execute:${stage}`);
  }
  const phase = commands.get(args[0]);
  if (!phase || args.length !== 2 || !/^[a-f0-9]{40}$/.test(args[1])) throw new RuntimeFailure('scope');
  (dependencies?.validateRuntime ?? assertRuntimeSliceRuntime)();
  const binding = await (dependencies?.bind ?? nativeLockBinding)(args[1], entry, undefined, {
    readOnly: phase.startsWith('check') || phase === 'verify-final',
  });
  const verifyEvidence =
    dependencies?.verifyEvidence ??
    (() => {
      verifyFlpNativeEvidence();
      if (kind === 'st05-tail') verifyRuntimeSt05History();
      else if (kind === 'retained-v2') verifyRuntimeRetainedV2History();
      else if (kind === 'retained') verifyRuntimeRetainedHistory();
    });
  const bound = () => {
    try {
      binding.verifySource();
      verifyEvidence();
    } catch {
      throw new RuntimeFailure('binding');
    }
  };
  if (phase === 'prepare') {
    bound();
    process.umask(0o077);
    claimDirectory(binding.root);
    durableRecord(join(binding.root, 'intent.json'), {
      createdAt: new Date().toISOString(),
      ...runtimeIntentData(binding, kind),
    });
    for (const stage of [...protocol.stages, 'final']) {
      claimDirectory(join(binding.root, stage));
      claimDirectory(join(binding.root, stage, 'prerequisites'));
    }
    return {
      phase,
      root: binding.root,
      intentHash: readRuntimeIntent(binding, kind).hash,
      failure: false,
      mutationAttempted: false,
    };
  }
  const stage = (phase === 'verify-final' ? 'final' : phase.split(':')[1]) as RuntimeStage | 'final';
  const attempt = join(binding.root, stage, 'attempt');
  const executing = phase.startsWith('execute');
  if (executing) {
    privateDirectory(binding.root);
    privateDirectory(join(binding.root, stage));
    process.umask(0o077);
    claimDirectory(attempt);
  } else if (stage !== 'final' && existsSync(attempt)) throw new RuntimeFailure('claimed');
  const record = executing ? journal(join(attempt, 'run')) : undefined;
  let intent: ReturnType<typeof readRuntimeIntent>,
    baseline: ReturnType<typeof readRuntimeBaseline>,
    verify: () => void;
  try {
    bound();
    intent = readRuntimeIntent(binding, kind);
    baseline = readRuntimeBaseline(binding, intent, stage, Date.now(), kind);
    verify = () => {
      bound();
      intent.verify();
      baseline.verify();
      if (Date.now() >= baseline.freshUntil) throw new RuntimeFailure('baseline');
    };
    verify();
    if (!executing) {
      if (stage !== 'final' && existsSync(attempt)) throw new RuntimeFailure('claimed');
      return {
        phase,
        root: binding.root,
        intentHash: intent.hash,
        failure: false,
        mutationAttempted: false,
        executionGrant: false,
        freshUntil: new Date(baseline.freshUntil).toISOString(),
        receipts: baseline.receipts,
        ...(stage === 'final'
          ? {
              fixedRepresentativesCompleted: true,
              ...(protocol.retained
                ? { completedHere: protocol.stages, retainedHistory: protocol.retainedHistory }
                : {}),
              profilerRequestCancelled: true,
              profilerParametersCleanup: 'native-retention-unverified',
              independentZeroLocksVerified: true,
              readAbsenceConfirmed: false,
              recording: 'native-governed-unverified',
            }
          : {}),
      };
    }
    durableRecord(join(attempt, 'manifest.json'), {
      protocol: protocol.protocol,
      stage,
      binding: binding.evidence,
      intentHash: intent.hash,
      prerequisites: baseline.receipts,
      fixedStage: stage,
      authentication: 'Basic-native-contract-only',
      ppQualified: false,
      readAbsenceConfirmed: false,
    });
  } catch (error) {
    if (!executing) throw error;
    const outcome = {
      protocol: protocol.protocol,
      stage,
      failure: true,
      mutationAttempted: false,
      reason: runtimeReason(error),
      stoppedAt: 'prerequisites',
      ...(protocol.retained && stage === 'quickfix'
        ? { remaining: [runtimeClassOwner], inspectionRequired: [runtimeClassOwner] }
        : {}),
    };
    record!(outcome);
    durableRecord(join(attempt, 'result.json'), outcome);
    return outcome;
  }
  let mutationAttempted: boolean | 'unknown' = false,
    stopped = false;
  const stop = () => {
    stopped = true;
  };
  const startedAt = new Date().toISOString();
  const observe = (row: unknown) => {
    const r = row as { stage?: string; method?: string };
    if (r.stage === 'dispatch' && ['POST', 'PUT', 'DELETE'].includes(r.method ?? '')) mutationAttempted = true;
    record!(row);
  };
  let outcome: Record<string, unknown>;
  try {
    const native = dependencies ?? (await import('./native-runtime-slice-runtime.js')).nativeRuntimeDefaults;
    verify();
    let env: Record<string, string>;
    try {
      env = native.readEnv(binding.repo);
    } catch {
      throw new RuntimeFailure('configuration');
    }
    let base: AdtClient;
    try {
      if (invalidNativeCredentialFields(env).length) throw new RuntimeFailure('configuration');
      verify();
      base = native.createClient({
        baseUrl: 'https://a4h.marianzeis.de',
        client: '001',
        language: 'EN',
        username: env.SAP_USER,
        password: env.SAP_PASSWORD,
        insecure: false,
        safety: { ...defaultSafetyConfig(), ...runtimeConfig() },
      });
    } finally {
      delete env.SAP_PASSWORD;
    }
    verify();
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, stop);
    mutationAttempted = 'unknown';
    outcome = {
      ...(await (
        dependencies?.execute ??
        (kind === 'st05-tail'
          ? (
              await import('./native-runtime-st05-driver.js')
            ).runRetainedSt05
          : protocol.retained
            ? (
                await import('./native-runtime-retained-driver.js')
              ).runRetainedRuntimeSlice
            : (
                await import('./native-runtime-slice-runtime.js')
              ).nativeRuntimeDefaults.execute)
      )({
        base,
        stage: stage as RuntimeStage,
        record: observe,
        verifySource: verify,
        shouldStop: () => stopped,
        deadline: baseline.freshUntil,
      })),
    };
    try {
      verify();
      if (protocol.retained && stopped) throw new RuntimeFailure('stopped');
    } catch (error) {
      outcome = { ...outcome, failure: true, reason: runtimeReason(error), bindingUnconfirmed: true };
    }
  } catch (error) {
    outcome = {
      failure: true,
      mutationAttempted,
      reason: runtimeReason(error),
      nativeDeleteCompleted: false,
      readAbsenceConfirmed: false,
      ...(protocol.retained && stage === 'quickfix'
        ? { remaining: [runtimeClassOwner], inspectionRequired: [runtimeClassOwner] }
        : {}),
    };
  } finally {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.off(signal, stop);
  }
  const result = {
    ...outcome,
    protocol: protocol.protocol,
    stage,
    revision: binding.evidence.revision,
    intentHash: intent.hash,
    startedAt,
    previousResultHash: baseline.previousResultHash,
    authentication: 'Basic-native-contract-only',
    ppQualified: false,
    publicAdmission: false,
    completedAt: new Date().toISOString(),
  };
  record!(result);
  durableRecord(join(attempt, 'result.json'), result);
  return { root: attempt, ...result };
}
