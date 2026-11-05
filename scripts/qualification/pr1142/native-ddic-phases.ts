/** Fixed-profile phase orchestration. Preparation/check never load client or credentials. */
import { randomBytes } from 'node:crypto';
import { existsSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AdtClient } from '../../../src/adt/client.js';
import { DDIC_NODE } from './native-ddic-fixtures.js';
import type { DdicRuntime } from './native-ddic-runner.js';
import type { DdicWorkflowFixture, DdicWorkflowInput, runFixedDdicWorkflow } from './native-ddic-workflow.js';
import { assertDeclarativeRuntime } from './native-declarative-entry.js';
import type { DeclarativeBinding } from './native-declarative-prerequisites.js';
import { claimDirectory, durableRecord, journal, nativeLockBinding, privateDirectory } from './native-lock-binding.js';
import { readFixedNativePrerequisites } from './native-package-prerequisites.js';
export interface FixedDdicIntent<F> {
  fixtures: F[];
  suffix: string;
  hash: string;
  createdAt: number;
  verify: () => void;
}
export interface DdicPhaseRuntime<F extends DdicWorkflowFixture> extends Pick<DdicRuntime, 'readEnv' | 'createClient'> {
  execute: (input: DdicWorkflowInput<F>) => Promise<Awaited<ReturnType<typeof runFixedDdicWorkflow>>>;
}
export interface DdicPhaseDependencies<F extends DdicWorkflowFixture> {
  validateRuntime: () => void;
  bind: typeof nativeLockBinding;
  runtime: () => Promise<DdicPhaseRuntime<F>>;
}
export interface DdicPhaseProfile<F extends DdicWorkflowFixture> {
  protocol: string;
  flag: string;
  suffixBytes: number;
  /** Compiled cleanup profiles retain one existing name; ordinary lifecycles always draw fresh names. */
  fixedSuffix?: string;
  retainedOwners?: readonly string[];
  verifyHistory?: () => void;
  inventory?: 'valid-without-suffix' | 'valid-unfiltered';
  stages: readonly string[];
  failureGraph: string;
  /** Independent DELETE owners only; parent-owned resources still require final absence. */
  deletedOwners?: (fixtures: readonly F[]) => readonly string[];
  fixtures: (suffix: string) => F[];
  intent: (binding: DeclarativeBinding) => FixedDdicIntent<F>;
  helpers: () => Promise<{
    runtime: DdicPhaseRuntime<F>;
    client: (
      runtime: Pick<DdicRuntime, 'readEnv' | 'createClient'>,
      repo: string,
      verify: () => void,
      writes: boolean,
    ) => AdtClient;
    preflight: (
      client: AdtClient,
      fixtures: readonly F[],
      record: (v: unknown) => void,
      verify: () => void,
    ) => Promise<void>;
  }>;
}
export function assertDdicRuntime(env = process.env, argv = process.execArgv, node = process.version) {
  assertDeclarativeRuntime(env, argv);
  if (node !== DDIC_NODE || env.ARC1_LOG_HTTP_DEBUG !== undefined) throw new Error('Fixed DDIC runtime required.');
}
export async function runFixedDdicPhases<F extends DdicWorkflowFixture>(
  args: string[],
  entry: URL,
  profile: DdicPhaseProfile<F>,
  dependencies?: DdicPhaseDependencies<F>,
) {
  const mode = ['prepare', 'preflight', 'check', 'execute'].find((m) => args[0] === `--${m}-reviewed-${profile.flag}`);
  if (
    !mode ||
    args.length !== (mode === 'check' || mode === 'execute' ? 3 : 2) ||
    !/^[a-f0-9]{40}$/.test(args[1]) ||
    ((mode === 'check' || mode === 'execute') && !/^[A-F0-9]{16}$/.test(args[2]))
  )
    throw new Error('Fixed DDIC phase/full revision/sample required.');
  (dependencies?.validateRuntime ?? assertDdicRuntime)();
  const binding = await (dependencies?.bind ?? nativeLockBinding)(args[1], entry, undefined, {
    readOnly: mode === 'check',
  });
  const verifySource = () => {
    binding.verifySource();
    profile.verifyHistory?.();
  };
  const idle = () => {
    if (existsSync(join(binding.root, 'attempt')) || existsSync(join(binding.root, 'preflight-running')))
      throw new Error('DDIC protocol already claimed or preflight running.');
  };
  if (mode !== 'check') process.umask(0o077);
  if (mode === 'prepare') {
    verifySource();
    const suffix = profile.fixedSuffix ?? randomBytes(profile.suffixBytes).toString('hex').toUpperCase(),
      fixtures = profile.fixtures(suffix);
    claimDirectory(binding.root);
    durableRecord(join(binding.root, 'intent.json'), {
      protocol: profile.protocol,
      createdAt: new Date().toISOString(),
      suffix,
      fixtures,
      binding: binding.evidence,
      identity: 'MARIAN',
      target: 'A4H/001',
      authentication: 'Basic-native-contract-only',
    });
    claimDirectory(join(binding.root, 'preflight'));
    verifySource();
    const intent = profile.intent(binding);
    return {
      mode,
      root: binding.root,
      suffix,
      intentHash: intent.hash,
      fixtures,
      failure: false,
      mutationAttempted: false,
    };
  }
  privateDirectory(binding.root);
  const native = async () => (dependencies ? dependencies.runtime() : (await profile.helpers()).runtime);
  if (mode === 'preflight') {
    idle();
    const running = join(binding.root, 'preflight-running');
    claimDirectory(running);
    try {
      verifySource();
      const intent = profile.intent(binding),
        sample = randomBytes(8).toString('hex').toUpperCase(),
        root = join(binding.root, 'preflight', sample);
      claimDirectory(root);
      const record = journal(join(root, 'run')),
        common = {
          protocol: profile.protocol,
          revision: binding.evidence.revision,
          intentHash: intent.hash,
          startedAt: new Date().toISOString(),
        };
      durableRecord(join(root, 'manifest.json'), { ...common, fixtures: intent.fixtures });
      const verify = () => {
        verifySource();
        intent.verify();
        if (existsSync(join(binding.root, 'attempt'))) throw new Error('DDIC attempt already claimed.');
      };
      try {
        verify();
        const runtime = await native(),
          helpers = await profile.helpers();
        verify();
        const client = helpers.client(runtime, binding.repo, verify, false);
        await helpers.preflight(client, intent.fixtures, record, verify);
        verify();
        const result = {
          ...common,
          completedAt: new Date().toISOString(),
          failure: false,
          mutationAttempted: false,
          verifiedOwners: intent.fixtures.map((f) => f.owner),
          inventory: profile.inventory ?? 'valid-without-suffix',
        };
        durableRecord(join(root, 'result.json'), result);
        return { mode, root, preflightId: sample, ...result };
      } catch (error) {
        durableRecord(join(root, 'result.json'), {
          ...common,
          completedAt: new Date().toISOString(),
          failure: true,
          mutationAttempted: false,
          reason: 'GET-only-preflight-unconfirmed',
        });
        throw error;
      }
    } finally {
      rmdirSync(running);
    }
  }
  if (mode === 'check') {
    idle();
    verifySource();
    const intent = profile.intent(binding),
      proof = readFixedNativePrerequisites(
        binding,
        intent,
        args[2],
        Date.now(),
        profile.protocol,
        intent.fixtures.map((f) => f.owner),
        profile.inventory,
      );
    verifySource();
    intent.verify();
    proof.verify();
    idle();
    if (Date.now() >= proof.freshUntil) throw new Error('DDIC prerequisites expired.');
    return {
      mode,
      root: binding.root,
      protocol: profile.protocol,
      revision: binding.evidence.revision,
      intentHash: intent.hash,
      preflightId: args[2],
      receipts: proof.receipts,
      freshUntil: new Date(proof.freshUntil).toISOString(),
      failure: false,
      mutationAttempted: false,
      attemptClaimed: false,
      executionGrant: false,
    };
  }
  const root = join(binding.root, 'attempt');
  claimDirectory(root);
  const record = journal(join(root, 'run'));
  let executionOwners: readonly string[] | undefined;
  let entered = false,
    stopped = false;
  const stop = () => {
    stopped = true;
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, stop);
  try {
    if (existsSync(join(binding.root, 'preflight-running'))) throw new Error('Concurrent DDIC preflight.');
    verifySource();
    const intent = profile.intent(binding),
      proof = readFixedNativePrerequisites(
        binding,
        intent,
        args[2],
        Date.now(),
        profile.protocol,
        intent.fixtures.map((f) => f.owner),
        profile.inventory,
      );
    const verify = () => {
      verifySource();
      intent.verify();
      proof.verify();
    };
    const ready = () => {
      verify();
      if (stopped || Date.now() >= proof.freshUntil) throw new Error('DDIC stopped or expired.');
    };
    ready();
    durableRecord(join(root, 'manifest.json'), {
      protocol: profile.protocol,
      binding: binding.evidence,
      intentHash: intent.hash,
      preflightId: args[2],
      prerequisites: proof.receipts,
      freshUntil: new Date(proof.freshUntil).toISOString(),
      fixtures: intent.fixtures,
      stages: profile.stages,
      identity: 'MARIAN',
      target: 'A4H/001',
      authentication: 'Basic-native-contract-only',
    });
    const runtime = await native(),
      helpers = await profile.helpers();
    ready();
    const client = helpers.client(runtime, binding.repo, ready, true);
    ready();
    executionOwners = intent.fixtures.map((f) => f.owner);
    entered = true;
    const result = await runtime.execute({
      base: client,
      fixtures: intent.fixtures,
      freshUntil: proof.freshUntil,
      record,
      verify,
      shouldStop: () => stopped,
    });
    let terminal = false;
    try {
      ready();
    } catch {
      terminal = true;
    }
    const complete =
      JSON.stringify(result.completed) === JSON.stringify(profile.stages) &&
      JSON.stringify(result.confirmedDeleted) ===
        JSON.stringify(
          profile.deletedOwners?.(intent.fixtures) ?? [...intent.fixtures].reverse().map((f) => f.owner),
        ) &&
      result.remaining.length === 0 &&
      result.finalAbsenceConfirmed &&
      !result.cleanupUnconfirmed;
    const outcome = {
      ...result,
      failure: result.failure || stopped || terminal || !complete,
      ...(terminal || (!complete && !result.failure)
        ? {
            terminalCheckUnconfirmed: terminal,
            completionUnconfirmed: !complete,
            inspectionRequired: [...new Set([...result.inspectionRequired, ...intent.fixtures.map((f) => f.owner)])],
          }
        : {}),
      stopped: result.stopped || stopped,
    };
    durableRecord(join(root, 'result.json'), outcome);
    return { mode, root, ...outcome };
  } catch (error) {
    if (!existsSync(join(root, 'result.json')))
      durableRecord(join(root, 'result.json'), {
        failure: true,
        mutationAttempted: entered ? 'unknown' : false,
        cleanupUnconfirmed: entered,
        finalAbsenceConfirmed: false,
        reason: entered ? 'execution-unconfirmed' : 'prerequisites-or-configuration',
        ...(profile.retainedOwners
          ? {
              remaining: [...(entered ? (executionOwners ?? profile.retainedOwners) : profile.retainedOwners)],
              inspectionRequired: [...(entered ? (executionOwners ?? profile.retainedOwners) : profile.retainedOwners)],
            }
          : { inspectionRequired: entered ? profile.failureGraph : [] }),
      });
    throw error;
  } finally {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.off(signal, stop);
  }
}
