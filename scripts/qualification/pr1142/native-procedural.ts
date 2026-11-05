/** One fixed intent, one GET preflight and one lifecycle attempt; checks never load credentials. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AdtClient } from '../../../src/adt/client.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { assertDeclarativeRuntime, invalidNativeCredentialFields, isDirectEntry } from './native-declarative-entry.js';
import { claimDirectory, durableRecord, journal, nativeLockBinding, privateDirectory } from './native-lock-binding.js';
import type { runNativeProceduralContract } from './native-procedural-driver.js';
import { owners, ProceduralFailure, proceduralConfig, proceduralFailure } from './native-procedural-fixed.js';
import {
  type ProceduralPhaseProfile,
  proceduralIntentData,
  readProceduralIntent,
  readProceduralPrerequisites,
  standardProceduralProfile,
} from './native-procedural-prerequisites.js';

export interface ProceduralDependencies {
  validateRuntime: () => void;
  bind: typeof nativeLockBinding;
  readEnv: (repo: string) => Record<string, string>;
  createClient: (input: ConstructorParameters<typeof AdtClient>[0]) => AdtClient;
  execute: typeof runNativeProceduralContract;
}
export function assertProceduralRuntime(env = process.env, argv = process.execArgv, node = process.version) {
  assertDeclarativeRuntime(env, argv);
  if (node !== 'v22.21.1' || env.ARC1_LOG_HTTP_DEBUG !== undefined) throw new ProceduralFailure('configuration');
}
export async function runNativeProcedural(
  args: string[],
  dependencies?: ProceduralDependencies,
  profile: ProceduralPhaseProfile & {
    entry?: URL;
    verifyHistory?: () => void;
    native?: () => Promise<Pick<ProceduralDependencies, 'readEnv' | 'createClient' | 'execute'>>;
  } = standardProceduralProfile,
): Promise<Record<string, unknown> & { failure: boolean }> {
  const phase = new Map([
    ['--prepare-reviewed-procedural', 'prepare'],
    ['--preflight-reviewed-procedural', 'preflight'],
    ['--check-reviewed-procedural', 'check'],
    ['--execute-reviewed-procedural', 'execute'],
    ['--verify-reviewed-procedural-cleanup', 'final'],
  ]).get(args[0]);
  if (!phase || args.length !== 2 || !/^[a-f0-9]{40}$/.test(args[1])) throw new ProceduralFailure('scope');
  (dependencies?.validateRuntime ?? assertProceduralRuntime)();
  const binding = await (dependencies?.bind ?? nativeLockBinding)(
    args[1],
    profile.entry ?? new URL(import.meta.url),
    undefined,
    {
      readOnly: phase === 'check' || phase === 'final',
    },
  );
  const bound = () => {
    try {
      binding.verifySource();
      profile.verifyHistory?.();
    } catch {
      throw new ProceduralFailure('binding');
    }
  };
  if (phase === 'prepare') {
    bound();
    process.umask(0o077);
    claimDirectory(binding.root);
    durableRecord(join(binding.root, 'intent.json'), {
      createdAt: new Date().toISOString(),
      ...proceduralIntentData(binding, profile),
    });
    for (const directory of ['prerequisites', 'final']) claimDirectory(join(binding.root, directory));
    return {
      phase,
      root: binding.root,
      failure: false,
      mutationAttempted: false,
      intentHash: readProceduralIntent(binding, profile).hash,
    };
  }
  privateDirectory(binding.root);
  if ((phase === 'check' || (profile.history && phase === 'preflight')) && existsSync(join(binding.root, 'execute')))
    throw new ProceduralFailure('scope');
  if (phase === 'check' || phase === 'final') {
    bound();
    const proof = readProceduralPrerequisites(binding, phase === 'check' ? 'execute' : 'final', Date.now(), profile);
    proof.verify();
    bound();
    if (Date.now() >= proof.freshUntil || (phase === 'check' && existsSync(join(binding.root, 'execute'))))
      throw new ProceduralFailure('prerequisites');
    return { phase, failure: false, mutationAttempted: false, executionGrant: false, ...proof, verify: undefined };
  }
  process.umask(0o077);
  const directory = join(binding.root, phase);
  claimDirectory(directory);
  const record = journal(join(directory, 'run'));
  const startedAt = new Date().toISOString();
  let prerequisiteProof: ReturnType<typeof readProceduralPrerequisites> | undefined;
  let stopped = false,
    mutationAttempted = false,
    intentHash: string | undefined,
    outcome: Record<string, unknown>;
  const stop = () => {
    stopped = true;
  };
  const observe = (row: unknown) => {
    const r = row as { stage?: string; method?: string };
    if (r.stage === 'request' && ['POST', 'PUT', 'DELETE'].includes(r.method ?? '')) mutationAttempted = true;
    record(row);
  };
  try {
    bound();
    const intent = readProceduralIntent(binding, profile);
    intentHash = intent.hash;
    const proof =
      phase === 'execute' ? readProceduralPrerequisites(binding, 'execute', Date.now(), profile) : undefined;
    prerequisiteProof = proof;
    const freshUntil = proof?.freshUntil ?? Date.now() + 60_000;
    const verify = () => {
      bound();
      intent.verify();
      proof?.verify();
      if (Date.now() >= freshUntil) throw new ProceduralFailure('prerequisites');
    };
    verify();
    durableRecord(join(directory, 'manifest.json'), {
      protocol: profile.protocol,
      phase,
      binding: binding.evidence,
      intentHash,
      prerequisiteReceipts: proof?.receipts ?? [],
      previousResultHash: proof?.previousResultHash ?? null,
      freshUntil: new Date(freshUntil).toISOString(),
      authentication: 'Basic-native-contract-only',
    });
    const native =
      dependencies ??
      (profile.native
        ? await profile.native()
        : (await import('./native-procedural-runtime.js')).nativeProceduralDefaults);
    verify();
    let env: Record<string, string>;
    try {
      env = native.readEnv(binding.repo);
    } catch {
      throw new ProceduralFailure('configuration');
    }
    let base: AdtClient;
    try {
      if (invalidNativeCredentialFields(env).length) throw new ProceduralFailure('configuration');
      verify();
      base = native.createClient({
        baseUrl: 'https://a4h.marianzeis.de',
        client: '001',
        language: 'EN',
        username: env.SAP_USER,
        password: env.SAP_PASSWORD,
        insecure: false,
        safety: { ...defaultSafetyConfig(), ...proceduralConfig() },
      });
    } finally {
      delete env.SAP_PASSWORD;
    }
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, stop);
    outcome = await native.execute({
      base,
      preflight: phase === 'preflight',
      freshUntil,
      verifySource: verify,
      shouldStop: () => stopped,
      record: observe,
    });
    try {
      verify();
    } catch {
      outcome = {
        ...outcome,
        failure: true,
        reason: 'binding',
        ...(profile.history ? { terminalCheckUnconfirmed: true, inspectionRequired: owners } : {}),
      };
    }
  } catch (error) {
    outcome = {
      failure: true,
      reason: proceduralFailure(error),
      mutationAttempted,
      remaining: mutationAttempted || profile.history ? owners : [],
      ...(profile.history ? { inspectionRequired: owners } : {}),
      independentLockVerification: 'required',
    };
  } finally {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.off(signal, stop);
  }
  const result = {
    ...outcome,
    failure: outcome.failure !== false,
    protocol: profile.protocol,
    phase,
    revision: binding.evidence.revision,
    intentHash,
    owners,
    previousResultHash: prerequisiteProof?.previousResultHash ?? null,
    prerequisiteReceipts: prerequisiteProof?.receipts ?? [],
    startedAt,
    completedAt: new Date().toISOString(),
    authentication: 'Basic-native-contract-only',
    ppQualified: false,
  };
  durableRecord(join(directory, 'result.json'), result);
  return result;
}
if (isDirectEntry(process.argv[1], import.meta.url))
  runNativeProcedural(process.argv.slice(2))
    .then((result) => {
      console.log(JSON.stringify(result));
      if (result.failure) process.exitCode = 1;
    })
    .catch(() => {
      console.error('PROCEDURAL_QUALIFICATION_STOPPED');
      process.exitCode = 1;
    });
