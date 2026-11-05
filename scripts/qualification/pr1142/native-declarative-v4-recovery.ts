/** Fixed prepare/check/once-only cleanup; never reopens a lifecycle or accepts a caller-selected owner/root. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AdtClient } from '../../../src/adt/client.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import {
  assertDeclarativeRuntime,
  declarativeStopCode,
  invalidNativeCredentialFields,
  isDirectEntry,
} from './native-declarative-entry.js';
import type { runV4DeclarativeRecovery } from './native-declarative-v4-recovery-driver.js';
import { V4_RECOVERY, v4RecoveryOwners } from './native-declarative-v4-recovery-fixed.js';
import { verifyOriginalV4Failure } from './native-declarative-v4-recovery-history.js';
import {
  readV4RecoveryBaseline,
  readV4RecoveryIntent,
  recoveryIntentData,
} from './native-declarative-v4-recovery-prerequisites.js';
import { DeclarativeFailure, declarativeFailureRow } from './native-declarative-workflow.js';
import { claimDirectory, durableRecord, journal, nativeLockBinding } from './native-lock-binding.js';

interface Dependencies {
  validateRuntime: () => void;
  bind: typeof nativeLockBinding;
  verifyOriginal: () => void;
  readEnv: (repo: string) => Record<string, string>;
  createClient: (options: ConstructorParameters<typeof AdtClient>[0]) => AdtClient;
  execute: typeof runV4DeclarativeRecovery;
}
export function assertV4RecoveryRuntime(env = process.env, argv = process.execArgv, node = process.version) {
  assertDeclarativeRuntime(env, argv);
  if (node !== 'v22.21.1' || env.ARC1_LOG_HTTP_DEBUG !== undefined) throw new DeclarativeFailure('recovery-runtime');
}
export async function runNativeV4Recovery(args: string[], dependencies?: Dependencies) {
  const phase = new Map([
    ['--prepare-reviewed-v4-pair-cleanup', 'prepare'],
    ['--check-reviewed-v4-pair-cleanup', 'check'],
    ['--execute-reviewed-v4-pair-cleanup', 'execute'],
  ]).get(args[0]);
  if (!phase || args.length !== 2 || !/^[a-f0-9]{40}$/.test(args[1]))
    throw new Error('A fixed recovery phase and full reviewed revision are required.');
  (dependencies?.validateRuntime ?? assertV4RecoveryRuntime)();
  const bind = dependencies?.bind ?? nativeLockBinding;
  const binding =
    phase === 'check'
      ? await bind(args[1], new URL(import.meta.url), undefined, { readOnly: true })
      : await bind(args[1], new URL(import.meta.url));
  const verifyOriginal = dependencies?.verifyOriginal ?? verifyOriginalV4Failure;
  if (phase === 'prepare') {
    verifyOriginal();
    binding.verifySource();
    process.umask(0o077);
    claimDirectory(binding.root);
    durableRecord(join(binding.root, 'intent.json'), {
      createdAt: new Date().toISOString(),
      ...recoveryIntentData(binding),
    });
    claimDirectory(join(binding.root, 'prerequisites'));
    return {
      phase,
      root: binding.root,
      intentHash: readV4RecoveryIntent(binding).hash,
      failure: false,
      mutationAttempted: false,
    };
  }
  const attempt = join(binding.root, 'attempt');
  if (phase === 'check' && existsSync(attempt)) throw new DeclarativeFailure('recovery-claimed');
  if (phase === 'execute') {
    process.umask(0o077);
    claimDirectory(attempt);
  }
  const record = phase === 'execute' ? journal(join(attempt, 'run')) : undefined;
  let deleteAttempted = false;
  let verify: () => void;
  let receipts: ReturnType<typeof readV4RecoveryBaseline>;
  let intent: ReturnType<typeof readV4RecoveryIntent>;
  try {
    binding.verifySource();
    verifyOriginal();
    intent = readV4RecoveryIntent(binding);
    receipts = readV4RecoveryBaseline(binding, intent, Date.now());
    verify = () => {
      binding.verifySource();
      verifyOriginal();
      intent.verify();
      receipts.verify();
      if (!deleteAttempted && Date.now() > receipts.freshUntil) throw new DeclarativeFailure('recovery-baseline');
    };
    verify();
    if (phase === 'check') {
      if (existsSync(attempt)) throw new DeclarativeFailure('recovery-claimed');
      return {
        phase,
        root: binding.root,
        failure: false,
        mutationAttempted: false,
        attemptClaimed: false,
        executionGrant: false,
        intentHash: intent.hash,
        receipts: receipts.receipts,
        freshUntil: new Date(receipts.freshUntil).toISOString(),
      };
    }
    durableRecord(join(attempt, 'manifest.json'), {
      protocol: V4_RECOVERY,
      binding: binding.evidence,
      intentHash: intent.hash,
      prerequisites: receipts.receipts,
      owners: v4RecoveryOwners.map((owner) => owner.owner),
      purpose:
        'Only delete the exact BDEF active shell/inactive draft, then its DDLS parent; no class mutation, create, save, activation or repair',
    });
  } catch (error) {
    if (phase === 'check') throw error;
    const outcome = {
      failure: true,
      mutationAttempted: false,
      deleteAttempted: false,
      confirmedDeleted: [],
      finalAbsenceConfirmed: false,
      cleanupConfirmed: false,
      stoppedAt: 'prerequisites',
      ...declarativeFailureRow(error),
      remaining: v4RecoveryOwners.map((owner) => owner.owner),
    };
    record!(outcome);
    durableRecord(join(attempt, 'result.json'), outcome);
    return { root: attempt, ...outcome };
  }
  const observe = (value: unknown) => {
    const row = value as { stage?: string; method?: string };
    if (row.stage === 'request' && row.method === 'DELETE') deleteAttempted = true;
    record!(value);
  };
  let stage = 'dependencies',
    mutationAttempted: boolean | 'unknown' = false;
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  try {
    // No native module, dotenv or client is loaded by prepare/check.
    const native = dependencies ?? (await import('./native-declarative-runner.js')).declarativeRunDefaults;
    const execute =
      dependencies?.execute ?? (await import('./native-declarative-v4-recovery-driver.js')).runV4DeclarativeRecovery;
    const { recoveryConfig } = await import('./native-declarative-recovery-driver.js');
    verify();
    stage = 'configuration-env-unreadable';
    const env = native.readEnv(binding.repo);
    let base: AdtClient;
    try {
      stage = 'configuration-env-invalid';
      if (invalidNativeCredentialFields(env).length) throw new DeclarativeFailure('configuration-env-invalid');
      stage = 'configuration-client';
      base = native.createClient({
        baseUrl: 'https://a4h.marianzeis.de',
        client: '001',
        username: env.SAP_USER,
        password: env.SAP_PASSWORD,
        insecure: false,
        safety: { ...defaultSafetyConfig(), ...recoveryConfig },
      });
    } finally {
      delete env.SAP_PASSWORD;
    }
    verify();
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, stop);
    stage = 'execution';
    mutationAttempted = 'unknown';
    let outcome = await execute({
      base,
      record: observe,
      verifySource: verify,
      shouldStop: () => stopped,
      deadline: receipts.freshUntil,
    });
    try {
      verify();
    } catch (error) {
      const failure = declarativeFailureRow(error);
      observe({ recoveryUnconfirmed: true, ...failure });
      // Preserve confirmed native outcomes and any earlier failure; only the immutable binding lost validity.
      outcome = {
        ...failure,
        ...outcome,
        failure: true,
        inspectionRequired: v4RecoveryOwners.map((owner) => owner.owner),
      };
    }
    durableRecord(join(attempt, 'result.json'), outcome);
    return { root: attempt, ...outcome };
  } catch (error) {
    const outcome = {
      failure: true,
      mutationAttempted,
      deleteAttempted,
      confirmedDeleted: [],
      finalAbsenceConfirmed: false,
      cleanupConfirmed: false,
      stoppedAt: stage,
      ...declarativeFailureRow(error),
      remaining: v4RecoveryOwners.map((owner) => owner.owner),
      inspectionRequired: v4RecoveryOwners.map((owner) => owner.owner),
    };
    observe(outcome);
    durableRecord(join(attempt, 'result.json'), outcome);
    return { root: attempt, ...outcome };
  } finally {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.off(signal, stop);
  }
}
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeV4Recovery(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch (error) {
    console.error(`V4 cleanup stopped (${declarativeStopCode(error)}). Preserve every claim; never repeat an attempt.`);
    process.exitCode = 1;
  }
}
