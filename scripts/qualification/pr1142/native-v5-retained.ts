/** Fixed retained-owner continuation: prepare, GET-only preflight, nonclaiming check, one consumed attempt. */
import { randomBytes } from 'node:crypto';
import { existsSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AdtClient } from '../../../src/adt/client.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import {
  assertDeclarativeRuntime,
  declarativeStopCode,
  invalidNativeCredentialFields,
  isDirectEntry,
} from './native-declarative-entry.js';
import { recoveryConfig } from './native-declarative-recovery-driver.js';
import { declarativeFailureRow } from './native-declarative-workflow.js';
import { claimDirectory, durableRecord, journal, nativeLockBinding, privateDirectory } from './native-lock-binding.js';
import type { runRetainedContinuation } from './native-v5-retained-driver.js';
import type { inspectRetained } from './native-v5-retained-evidence.js';
import { RETAINED_PROTOCOL, retainedOwners, retainedStages } from './native-v5-retained-fixed.js';
import {
  readRetainedIntent,
  readRetainedPrerequisites,
  retainedIntentData,
} from './native-v5-retained-prerequisites.js';
import { verifyRetainedRetryHistory } from './native-v5-retained-retry-history.js';
export interface RetainedDependencies {
  validateRuntime: () => void;
  bind: typeof nativeLockBinding;
  verifyHistory: () => void;
  readEnv: (repo: string) => Record<string, string>;
  createClient: (options: ConstructorParameters<typeof AdtClient>[0]) => AdtClient;
  execute: typeof runRetainedContinuation;
  inspect: typeof inspectRetained;
}
export function assertRetainedRuntime(env = process.env, argv = process.execArgv, node = process.version) {
  assertDeclarativeRuntime(env, argv);
  if (node !== 'v22.21.1' || env.ARC1_LOG_HTTP_DEBUG !== undefined) throw new Error('Retained runtime refused.');
}
async function nativeEdges(dependencies?: RetainedDependencies) {
  if (dependencies) return dependencies;
  const { declarativeRunDefaults } = await import('./native-declarative-runner.js');
  const { runRetainedContinuation } = await import('./native-v5-retained-driver.js');
  const { inspectRetained } = await import('./native-v5-retained-evidence.js');
  return {
    readEnv: declarativeRunDefaults.readEnv,
    createClient: declarativeRunDefaults.createClient,
    execute: runRetainedContinuation,
    inspect: inspectRetained,
  };
}
async function clientFor(
  native: Awaited<ReturnType<typeof nativeEdges>>,
  repo: string,
  verify: () => void,
  writes: boolean,
) {
  verify();
  const env = native.readEnv(repo);
  try {
    verify();
    if (invalidNativeCredentialFields(env).length) throw new Error('Retained credential fields refused.');
    const base = native.createClient({
      baseUrl: 'https://a4h.marianzeis.de',
      client: '001',
      username: env.SAP_USER,
      password: env.SAP_PASSWORD,
      insecure: false,
      safety: {
        ...defaultSafetyConfig(),
        ...(writes ? recoveryConfig : {}),
        allowWrites: writes,
        allowedPackages: ['$TMP'],
      },
    });
    verify();
    return base;
  } finally {
    delete env.SAP_PASSWORD;
  }
}
export async function runNativeRetained(args: string[], dependencies?: RetainedDependencies) {
  const phase = new Map([
    ['--prepare-reviewed-v5-retained', 'prepare'],
    ['--preflight-reviewed-v5-retained', 'preflight'],
    ['--check-reviewed-v5-retained', 'check'],
    ['--execute-reviewed-v5-retained', 'execute'],
  ]).get(args[0]);
  const sampled = phase === 'check' || phase === 'execute';
  if (
    !phase ||
    args.length !== (sampled ? 3 : 2) ||
    !/^[a-f0-9]{40}$/.test(args[1]) ||
    (sampled && !/^[A-F0-9]{16}$/.test(args[2]))
  )
    throw new Error('Exact retained phase, reviewed revision and applicable sample required.');
  (dependencies?.validateRuntime ?? assertRetainedRuntime)();
  const binding = await (dependencies?.bind ?? nativeLockBinding)(
    args[1],
    new URL(import.meta.url),
    undefined,
    phase === 'check' ? { readOnly: true } : undefined,
  );
  const history = dependencies?.verifyHistory ?? verifyRetainedRetryHistory;
  const original = () => {
    binding.verifySource();
    history();
  };
  if (phase === 'prepare') {
    original();
    process.umask(0o077);
    claimDirectory(binding.root);
    durableRecord(join(binding.root, 'intent.json'), {
      createdAt: new Date().toISOString(),
      ...retainedIntentData(binding),
    });
    claimDirectory(join(binding.root, 'preflight'));
    return {
      phase,
      root: binding.root,
      failure: false,
      mutationAttempted: false,
      intentHash: readRetainedIntent(binding).hash,
    };
  }
  const attempt = join(binding.root, 'attempt'),
    running = join(binding.root, 'preflight-running');
  if (phase === 'preflight') {
    original();
    const intent = readRetainedIntent(binding);
    if (existsSync(attempt)) throw new Error('Retained attempt already claimed.');
    process.umask(0o077);
    claimDirectory(running);
    const sample = randomBytes(8).toString('hex').toUpperCase(),
      root = join(binding.root, 'preflight', sample);
    try {
      privateDirectory(join(binding.root, 'preflight'));
      claimDirectory(root);
      const common = {
        protocol: RETAINED_PROTOCOL,
        revision: binding.evidence.revision,
        intentHash: intent.hash,
        startedAt: new Date().toISOString(),
      };
      durableRecord(join(root, 'manifest.json'), { ...common, owners: retainedOwners, method: 'GET only' });
      const record = journal(join(root, 'run'));
      const deadline = Date.now() + 60_000;
      const verify = () => {
        original();
        intent.verify();
        if (existsSync(attempt) || Date.now() >= deadline) throw new Error('Preflight stopped or expired.');
      };
      try {
        verify();
        const native = await nativeEdges(dependencies);
        verify();
        const base = await clientFor(native, binding.repo, verify, false);
        const { retainedTransport } = await import('./native-v5-retained-transport.js');
        verify();
        const transport = retainedTransport(base.http, {
          stage: () => 'inspect',
          verify,
          shouldStop: () => false,
          deadline,
          record,
          readOnly: true,
        });
        try {
          await native.inspect(transport.http, record, { deadline });
          verify();
        } finally {
          transport.finish();
        }
        const outcome = {
          ...common,
          completedAt: new Date().toISOString(),
          failure: false as const,
          mutationAttempted: false as const,
          owners: retainedOwners,
        };
        durableRecord(join(root, 'result.json'), outcome);
        return { phase, root, sample, ...outcome };
      } catch (error) {
        const outcome = {
          ...common,
          completedAt: new Date().toISOString(),
          failure: true,
          mutationAttempted: false,
          ...declarativeFailureRow(error),
        };
        record(outcome);
        durableRecord(join(root, 'result.json'), outcome);
        return { phase, root, sample, ...outcome };
      }
    } finally {
      rmdirSync(running);
    }
  }
  if (phase === 'check' && existsSync(attempt)) throw new Error('Retained attempt already claimed.');
  if (phase === 'execute') {
    process.umask(0o077);
    claimDirectory(attempt);
  }
  const record = phase === 'execute' ? journal(join(attempt, 'run')) : undefined;
  let verify: () => void, prerequisites: ReturnType<typeof readRetainedPrerequisites>;
  try {
    if (existsSync(running)) throw new Error('Preflight is still running.');
    original();
    const intent = readRetainedIntent(binding);
    prerequisites = readRetainedPrerequisites(binding, intent, args[2], Date.now());
    verify = () => {
      original();
      intent.verify();
      prerequisites.verify();
      if (Date.now() >= prerequisites.freshUntil) throw new Error('Original retained baseline expired.');
    };
    verify();
    if (phase === 'check') {
      if (existsSync(attempt)) throw new Error('Retained attempt already claimed.');
      return {
        phase,
        root: binding.root,
        failure: false,
        mutationAttempted: false,
        attemptClaimed: false,
        executionGrant: false,
        intentHash: intent.hash,
        freshUntil: new Date(prerequisites.freshUntil).toISOString(),
        receipts: prerequisites.receipts,
      };
    }
    durableRecord(join(attempt, 'manifest.json'), {
      protocol: RETAINED_PROTOCOL,
      binding: binding.evidence,
      intentHash: intent.hash,
      preflightId: args[2],
      prerequisites: prerequisites.receipts,
      owners: retainedOwners,
    });
  } catch (error) {
    if (phase === 'check') throw error;
    const outcome = {
      failure: true,
      mutationAttempted: false,
      confirmedDeleted: [],
      cleanupConfirmed: false,
      finalAbsenceConfirmed: false,
      remaining: retainedOwners,
      inspectionRequired: retainedOwners,
      stoppedAt: 'prerequisites',
      ...declarativeFailureRow(error),
    };
    record!(outcome);
    durableRecord(join(attempt, 'result.json'), outcome);
    return { phase, root: attempt, ...outcome };
  }
  let stopped = false,
    started = false;
  const stop = () => {
    stopped = true;
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, stop);
  const ready = () => {
    verify();
    if (stopped) throw new Error('Retained execution stopped.');
  };
  try {
    ready();
    const native = await nativeEdges(dependencies);
    ready();
    const base = await clientFor(native, binding.repo, ready, true);
    ready();
    started = true;
    let outcome = await native.execute({
      base,
      record: record!,
      verifySource: ready,
      shouldStop: () => stopped,
      deadline: prerequisites.freshUntil,
    });
    try {
      ready();
      if (
        !outcome.failure &&
        (JSON.stringify(outcome.completed) !== JSON.stringify(retainedStages) ||
          JSON.stringify(outcome.confirmedDeleted) !== JSON.stringify(retainedOwners) ||
          !outcome.cleanupConfirmed ||
          !outcome.finalAbsenceConfirmed ||
          outcome.remaining.length ||
          outcome.inspectionRequired.length)
      )
        throw new Error('Retained completion is incomplete.');
    } catch (error) {
      record!({ terminalCheckUnconfirmed: true, ...declarativeFailureRow(error) });
      outcome = { ...outcome, failure: true, inspectionRequired: [...retainedOwners] };
    }
    durableRecord(join(attempt, 'result.json'), outcome);
    return { phase, root: attempt, ...outcome };
  } catch (error) {
    const outcome = {
      failure: true,
      mutationAttempted: started ? 'unknown' : false,
      confirmedDeleted: [],
      cleanupConfirmed: false,
      finalAbsenceConfirmed: false,
      remaining: retainedOwners,
      inspectionRequired: retainedOwners,
      stoppedAt: started ? 'execution' : 'configuration',
      ...declarativeFailureRow(error),
    };
    record!(outcome);
    durableRecord(join(attempt, 'result.json'), outcome);
    return { phase, root: attempt, ...outcome };
  } finally {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.off(signal, stop);
  }
}
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeRetained(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch (error) {
    console.error(
      `Retained V5 stopped (${declarativeStopCode(error)}). Preserve every claim; never repeat an attempt.`,
    );
    process.exitCode = 1;
  }
}
