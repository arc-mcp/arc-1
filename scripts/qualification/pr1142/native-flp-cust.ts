/** Fixed prepare/check/once-per-stage execution. Importing or checking never loads credentials. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AdtClient } from '../../../src/adt/client.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { assertDeclarativeRuntime, invalidNativeCredentialFields, isDirectEntry } from './native-declarative-entry.js';
import type { runNativeFlpStage } from './native-flp-driver.js';
import { verifyFlpNativeEvidence } from './native-flp-evidence.js';
import {
  FLP_PROTOCOL,
  FlpQualificationFailure,
  type FlpStage,
  flpFailure,
  flpOwner,
  nativeFlpConfig,
} from './native-flp-fixed.js';
import { flpIntentData, readFlpBaseline, readFlpIntent } from './native-flp-prerequisites.js';
import { claimDirectory, durableRecord, journal, nativeLockBinding, privateDirectory } from './native-lock-binding.js';

interface Dependencies {
  validateRuntime: () => void;
  bind: typeof nativeLockBinding;
  verifyEvidence: () => void;
  readEnv: (repo: string) => Record<string, string>;
  createClient: (input: ConstructorParameters<typeof AdtClient>[0]) => AdtClient;
  execute: typeof runNativeFlpStage;
}
export function assertFlpRuntime(env = process.env, argv = process.execArgv, node = process.version) {
  assertDeclarativeRuntime(env, argv);
  if (node !== 'v22.21.1' || env.ARC1_LOG_HTTP_DEBUG !== undefined) throw new FlpQualificationFailure('runtime');
}
export async function runNativeFlp(args: string[], dependencies?: Dependencies) {
  const commands = new Map([
    ['--prepare-reviewed-flp', 'prepare'],
    ['--check-reviewed-flp-page', 'check-page'],
    ['--execute-reviewed-flp-page', 'execute-page'],
    ['--check-reviewed-flp-catalog', 'check-catalog'],
    ['--execute-reviewed-flp-catalog', 'execute-catalog'],
    ['--verify-reviewed-flp-cleanup', 'verify-final'],
  ]);
  const phase = commands.get(args[0]);
  if (!phase || args.length !== 2 || !/^[a-f0-9]{40}$/.test(args[1])) throw new FlpQualificationFailure('scope');
  (dependencies?.validateRuntime ?? assertFlpRuntime)();
  const binding = await (dependencies?.bind ?? nativeLockBinding)(args[1], new URL(import.meta.url), undefined, {
    readOnly: phase.startsWith('check') || phase === 'verify-final',
  });
  const verifyEvidence = dependencies?.verifyEvidence ?? verifyFlpNativeEvidence;
  const bound = () => {
    try {
      binding.verifySource();
      verifyEvidence();
    } catch {
      throw new FlpQualificationFailure('binding');
    }
  };
  if (phase === 'prepare') {
    bound();
    process.umask(0o077);
    claimDirectory(binding.root);
    durableRecord(join(binding.root, 'intent.json'), {
      createdAt: new Date().toISOString(),
      ...flpIntentData(binding),
    });
    for (const stage of ['page', 'catalog', 'final']) {
      claimDirectory(join(binding.root, stage));
      claimDirectory(join(binding.root, stage, 'prerequisites'));
    }
    return {
      phase,
      root: binding.root,
      intentHash: readFlpIntent(binding).hash,
      failure: false,
      mutationAttempted: false,
    };
  }
  const stage = phase.split('-')[1] as FlpStage | 'final';
  const attempt = join(binding.root, stage, 'attempt');
  const executing = phase.startsWith('execute');
  if (executing) {
    privateDirectory(binding.root);
    privateDirectory(join(binding.root, stage));
    process.umask(0o077);
    claimDirectory(attempt);
  } else if (stage !== 'final' && existsSync(attempt)) throw new FlpQualificationFailure('claimed');
  const record = executing ? journal(join(attempt, 'run')) : undefined;
  let intent: ReturnType<typeof readFlpIntent>, baseline: ReturnType<typeof readFlpBaseline>, verify: () => void;
  try {
    bound();
    intent = readFlpIntent(binding);
    baseline = readFlpBaseline(binding, intent, stage, Date.now());
    verify = () => {
      bound();
      intent.verify();
      baseline.verify();
      if (Date.now() >= baseline.freshUntil) throw new FlpQualificationFailure('baseline');
    };
    verify();
    if (!executing) {
      if (stage !== 'final' && existsSync(attempt)) throw new FlpQualificationFailure('claimed');
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
              nativeCleanupCompleted: true,
              independentZeroLocksVerified: true,
              readAbsenceConfirmed: false,
              recording: 'native-governed-unverified',
            }
          : {}),
      };
    }
    durableRecord(join(attempt, 'manifest.json'), {
      protocol: FLP_PROTOCOL,
      stage,
      binding: binding.evidence,
      intentHash: intent.hash,
      prerequisites: baseline.receipts,
      owner: flpOwner(stage as FlpStage),
      authentication: 'Basic-native-contract-only',
      ppQualified: false,
      readAbsenceConfirmed: false,
    });
  } catch (error) {
    if (!executing) throw error;
    const outcome = {
      protocol: FLP_PROTOCOL,
      stage,
      failure: true,
      mutationAttempted: false,
      reason: flpFailure(error),
      stoppedAt: 'prerequisites',
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
    if (r.stage === 'request' && ['POST', 'DELETE'].includes(r.method ?? '')) mutationAttempted = true;
    record!(row);
  };
  let outcome: Record<string, unknown>;
  try {
    const native = dependencies ?? (await import('./native-flp-runtime.js')).nativeFlpDefaults;
    verify();
    let env: Record<string, string>;
    try {
      env = native.readEnv(binding.repo);
    } catch {
      throw new FlpQualificationFailure('configuration');
    }
    let base: AdtClient;
    try {
      if (invalidNativeCredentialFields(env).length) throw new FlpQualificationFailure('configuration');
      verify();
      base = native.createClient({
        baseUrl: 'https://a4h.marianzeis.de',
        client: '001',
        language: 'EN',
        username: env.SAP_USER,
        password: env.SAP_PASSWORD,
        insecure: false,
        safety: { ...defaultSafetyConfig(), ...nativeFlpConfig() },
      });
    } finally {
      delete env.SAP_PASSWORD;
    }
    verify();
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, stop);
    mutationAttempted = 'unknown';
    outcome = {
      ...(await native.execute({
        base,
        stage: stage as FlpStage,
        record: observe,
        verifySource: verify,
        shouldStop: () => stopped,
        deadline: baseline.freshUntil,
      })),
    };
    try {
      verify();
    } catch (error) {
      outcome = { ...outcome, failure: true, reason: flpFailure(error), bindingUnconfirmed: true };
    }
  } catch (error) {
    outcome = {
      failure: true,
      mutationAttempted,
      reason: flpFailure(error),
      nativeDeleteCompleted: false,
      readAbsenceConfirmed: false,
    };
  } finally {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.off(signal, stop);
  }
  const result = {
    ...outcome,
    protocol: FLP_PROTOCOL,
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
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeFlp(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch (error) {
    console.error(
      `FLP qualification stopped (${flpFailure(error)}). Preserve all claims; never repeat a consumed stage.`,
    );
    process.exitCode = 1;
  }
}
