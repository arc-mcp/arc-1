/** One separately reviewed cleanup-only invocation. It never retries the failed v1 experiment. */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { AdtClient } from '../../../src/adt/client.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { assertDeclarativeRuntime, invalidNativeCredentialFields, isDirectEntry } from './native-declarative-entry.js';
import { recoveryConfig, recoveryFixture, recoveryMetadataHash, recoverySourceHash, runDeclarativeRecovery } from './native-declarative-recovery-driver.js';
import { claimDirectory, durableRecord, fileHash, journal, nativeLockBinding } from './native-lock-binding.js';

export function verifyOriginalDeclarativeFailure() {
  const root = join(homedir(), '.local/state/arc1-qualification/pr1142-native-declarative-v1');
  if (fileHash(join(root, 'manifest.json')) !== '8e728667000831c462cfe10f1854dffa65fad6f8fb75d124e22278e2d995a605' ||
    fileHash(join(root, 'result.json')) !== 'e4a1997c61034c9de302dd0e25c44b524b1d9caa4af69fcb0270685ae13a7bf4')
    throw new Error('The original failure receipts do not match this cleanup.');
}
interface Dependencies {
  validateRuntime: () => void; bind: typeof nativeLockBinding;
  verifyOriginal: () => void; readEnv: (repo: string) => Record<string, string>;
  createClient: (input: ConstructorParameters<typeof AdtClient>[0]) => AdtClient;
  execute: typeof runDeclarativeRecovery;
}
const defaults: Dependencies = {
  validateRuntime: () => {
    assertDeclarativeRuntime();
    if (process.env.ARC1_LOG_HTTP_DEBUG !== undefined) throw new Error('HTTP debug must be unset.');
  },
  bind: nativeLockBinding, verifyOriginal: verifyOriginalDeclarativeFailure,
  readEnv: repo => parse(readFileSync(join(repo, '.env'))),
  createClient: input => new AdtClient(input), execute: runDeclarativeRecovery,
};

export async function runNativeDeclarativeRecovery(args: string[], dependencies: Dependencies = defaults) {
  if (args.length !== 2 || args[0] !== '--execute-reviewed-inactive-ddls-cleanup' || !/^[a-f0-9]{40}$/.test(args[1]))
    throw new Error('Requires --execute-reviewed-inactive-ddls-cleanup <full reviewed commit>.');
  dependencies.validateRuntime();
  const binding = await dependencies.bind(args[1], new URL(import.meta.url));
  process.umask(0o077);
  claimDirectory(binding.root);
  durableRecord(join(binding.root, 'manifest.json'), {
    time: new Date().toISOString(), binding: binding.evidence, owner: recoveryFixture.owner,
    originalExperiment: 'pr1142-native-declarative-v1', identity: 'MARIAN', target: 'A4H/001',
    authentication: 'Basic-native cleanup only; not PP evidence', sourceHash: recoverySourceHash,
    metadataHash: recoveryMetadataHash, purpose: 'Delete only the unchanged owned inactive DDLS; no create, repair or activation',
  });
  const record = journal(join(binding.root, 'run'));
  let base: AdtClient;
  let stage = 'original-receipts', invalidFields: string[] = [];
  try {
    dependencies.verifyOriginal();
    stage = 'configuration-env-unreadable';
    const env = dependencies.readEnv(binding.repo);
    stage = 'configuration-env-invalid';
    invalidFields = invalidNativeCredentialFields(env);
    if (invalidFields.length) throw new Error('Invalid configuration');
    try {
      stage = 'configuration-client';
      base = dependencies.createClient({
        baseUrl: 'https://a4h.marianzeis.de', client: '001', username: env.SAP_USER, password: env.SAP_PASSWORD,
        insecure: false, safety: { ...defaultSafetyConfig(), ...recoveryConfig },
      });
    } finally { delete env.SAP_PASSWORD; }
  } catch {
    const outcome = { failure: true, mutationAttempted: false, deleteAttempted: false, confirmedDeleted: false,
      cleanupConfirmed: false, stoppedAt: stage, ...(invalidFields.length ? { invalidFields } : {}),
      remaining: [recoveryFixture.owner], inspectionRequired: [recoveryFixture.owner] };
    record(outcome); durableRecord(join(binding.root, 'result.json'), outcome);
    return { root: binding.root, ...outcome };
  }
  let stopped = false;
  const stop = () => { stopped = true; };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, stop);
  try {
    const outcome = await dependencies.execute({ base, record, verifySource: binding.verifySource, shouldStop: () => stopped });
    durableRecord(join(binding.root, 'result.json'), outcome);
    return { root: binding.root, ...outcome };
  } catch {
    const outcome = { failure: true, mutationAttempted: 'unknown', deleteAttempted: 'unknown', confirmedDeleted: false,
      cleanupConfirmed: false, stoppedAt: 'execution-error', remaining: [recoveryFixture.owner], inspectionRequired: [recoveryFixture.owner] };
    record(outcome); durableRecord(join(binding.root, 'result.json'), outcome);
    return { root: binding.root, ...outcome };
  } finally {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.off(signal, stop);
  }
}
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const outcome = await runNativeDeclarativeRecovery(process.argv.slice(2));
    console.log(JSON.stringify(outcome));
    process.exitCode = outcome.failure ? 1 : 0;
  } catch {
    console.error('Native cleanup stopped before completion; inspect its private claim and receipts. Never rerun a claimed recovery.');
    process.exitCode = 1;
  }
}
