/** One fixed LOCAL graph protocol. Preparation/check never import native runtime or load credentials. */
import { randomBytes } from 'node:crypto';
import { existsSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { assertDeclarativeRuntime, isDirectEntry } from './native-declarative-entry.js';
import { claimDirectory, durableRecord, journal, nativeLockBinding, privateDirectory } from './native-lock-binding.js';
import {
  PACKAGE_API_MOVED_COMPLETED,
  PACKAGE_API_MOVED_OBSERVED,
  PACKAGE_API_MOVED_PROFILE,
  PACKAGE_API_MOVED_PROTOCOL,
  PACKAGE_API_MOVED_STAGES,
} from './native-package-api-moved-fixed.js';
import {
  PACKAGE_API_PROTOCOL,
  PACKAGE_API_STAGES,
  packageApiIntent,
  packageApiOwners,
} from './native-package-api-profile.js';
import {
  PACKAGE_API_RETAINED_GRAPH,
  PACKAGE_API_RETAINED_PROFILE,
  PACKAGE_API_RETAINED_PROTOCOL,
  PACKAGE_API_RETAINED_STAGES,
} from './native-package-api-retained-fixed.js';
import {
  PACKAGE_NODE,
  PACKAGE_PROTOCOL,
  PACKAGE_STAGES,
  packageFixtures,
  packageOwners,
} from './native-package-fixtures.js';
import { readPackageIntent, readPackagePrerequisites } from './native-package-prerequisites.js';
import {
  PACKAGE_RECOVERY,
  packageRecoveryGraph,
  packageRecoveryHistory,
  packageRecoveryStages,
} from './native-package-recovery-fixed.js';
import type { PackageRuntime } from './native-package-runner.js';
export interface PackagePhaseDependencies {
  validateRuntime: () => void;
  bind: typeof nativeLockBinding;
  runtime: () => Promise<PackageRuntime>;
}
export function assertPackageRuntime(env = process.env, argv = process.execArgv, node = process.version) {
  assertDeclarativeRuntime(env, argv);
  if (node !== PACKAGE_NODE || env.ARC1_LOG_HTTP_DEBUG !== undefined)
    throw new Error('Fixed package runtime required.');
}
export async function runNativePackage(args: string[], dependencies?: PackagePhaseDependencies) {
  return runPackagePhases(args, dependencies);
}
/** Shared fixed phase lifecycle; the separate cleanup entry supplies its static source/history profile. */
export async function runPackagePhases(
  args: string[],
  dependencies?: PackagePhaseDependencies,
  profile?:
    | { entry: URL; verifyHistory: () => void }
    | { entry: URL; recordedApi: true }
    | { entry: URL; retainedApi: true; movedApi?: true; verifyHistory: () => void },
) {
  const movedApi = !!profile && 'movedApi' in profile && profile.movedApi === true;
  const retainedApi = !!profile && 'retainedApi' in profile;
  const recovery = profile && 'verifyHistory' in profile && !('retainedApi' in profile) ? profile : undefined;
  const recordedApi = retainedApi || (!!profile && 'recordedApi' in profile);
  const stages = movedApi
    ? PACKAGE_API_MOVED_STAGES
    : retainedApi
      ? PACKAGE_API_RETAINED_STAGES
      : recovery
        ? packageRecoveryStages
        : recordedApi
          ? PACKAGE_API_STAGES
          : PACKAGE_STAGES;
  const protocol = movedApi
    ? PACKAGE_API_MOVED_PROTOCOL
    : retainedApi
      ? PACKAGE_API_RETAINED_PROTOCOL
      : recovery
        ? PACKAGE_RECOVERY
        : recordedApi
          ? PACKAGE_API_PROTOCOL
          : PACKAGE_PROTOCOL;
  const flag = movedApi
    ? 'package-api-moved-v1'
    : retainedApi
      ? 'package-api-retained-v1'
      : recordedApi
        ? 'package-api-v1'
        : recovery
          ? 'local-package-recovery-v1'
          : 'local-package-v1';
  const mode = ['prepare', 'preflight', 'check', 'execute'].find((p) => args[0] === `--${p}-reviewed-${flag}`);
  if (
    !mode ||
    args.length !== (mode === 'check' || mode === 'execute' ? 3 : 2) ||
    !/^[a-f0-9]{40}$/.test(args[1]) ||
    ((mode === 'check' || mode === 'execute') && !/^[A-F0-9]{16}$/.test(args[2]))
  )
    throw new Error('Fixed phase, full reviewed revision and preflight ID required.');
  (dependencies?.validateRuntime ?? assertPackageRuntime)();
  const binding = await (dependencies?.bind ?? nativeLockBinding)(
    args[1],
    profile?.entry ?? new URL(import.meta.url),
    undefined,
    {
      readOnly: mode === 'check',
    },
  );
  const verifySource = () => {
    binding.verifySource();
    if (profile && 'verifyHistory' in profile) profile.verifyHistory();
  };
  const readIntent = () => {
    const intent = readPackageIntent(binding, protocol);
    if (recovery && JSON.stringify(intent.graph) !== JSON.stringify(packageRecoveryGraph))
      throw new Error('Fixed retained graph required.');
    return intent;
  };
  if (mode !== 'check') process.umask(0o077);
  const native = async () => {
    if (dependencies) return dependencies.runtime();
    const runtime = (await import('./native-package-runner.js')).packageRuntime;
    return movedApi
      ? { ...runtime, execute: (await import('./native-package-driver.js')).runNativePackageApiMovedTail }
      : retainedApi
        ? { ...runtime, execute: (await import('./native-package-driver.js')).runNativePackageApiRetainedTail }
        : recovery
          ? { ...runtime, execute: (await import('./native-package-driver.js')).runNativePackageCleanup }
          : recordedApi
            ? { ...runtime, execute: (await import('./native-package-driver.js')).runNativePackageApi }
            : runtime;
  };
  const idle = () => {
    if (existsSync(join(binding.root, 'attempt')) || existsSync(join(binding.root, 'preflight-running')))
      throw new Error('Protocol already claimed or preflight running.');
  };
  if (mode === 'prepare') {
    verifySource();
    const suffix = retainedApi
        ? PACKAGE_API_RETAINED_GRAPH.suffix
        : recovery
          ? packageRecoveryGraph.suffix
          : randomBytes(8).toString('hex').toUpperCase(),
      graph = packageFixtures(suffix);
    claimDirectory(binding.root);
    durableRecord(join(binding.root, 'intent.json'), {
      protocol,
      createdAt: new Date().toISOString(),
      suffix,
      binding: binding.evidence,
      graph,
      identity: 'MARIAN',
      target: 'A4H/001',
      authentication: 'Basic-native-contract-only',
      ...(recovery ? { history: packageRecoveryHistory } : {}),
      ...(recordedApi
        ? {
            fixedProfile: movedApi
              ? PACKAGE_API_MOVED_PROFILE
              : retainedApi
                ? PACKAGE_API_RETAINED_PROFILE
                : packageApiIntent(graph),
          }
        : {}),
    });
    claimDirectory(join(binding.root, 'preflight'));
    verifySource();
    const intent = readIntent();
    return {
      mode,
      root: binding.root,
      suffix,
      intentHash: intent.hash,
      graph,
      failure: false,
      mutationAttempted: false,
    };
  }
  privateDirectory(binding.root);
  if (mode === 'preflight') {
    idle();
    const running = join(binding.root, 'preflight-running');
    claimDirectory(running);
    try {
      if (existsSync(join(binding.root, 'attempt'))) throw new Error('Protocol already claimed.');
      verifySource();
      const intent = readIntent(),
        sample = randomBytes(8).toString('hex').toUpperCase(),
        root = join(binding.root, 'preflight', sample);
      claimDirectory(root);
      const record = journal(join(root, 'run')),
        common = {
          protocol,
          revision: binding.evidence.revision,
          intentHash: intent.hash,
          startedAt: new Date().toISOString(),
        };
      const verify = () => {
        verifySource();
        intent.verify();
        if (existsSync(join(binding.root, 'attempt'))) throw new Error('Protocol already claimed.');
      };
      durableRecord(join(root, 'manifest.json'), { ...common, graph: intent.graph });
      try {
        verify();
        const runtime = await native(),
          helpers = await import('./native-package-runner.js');
        verify();
        const client = helpers.packageClient(
          runtime,
          binding.repo,
          intent.graph,
          verify,
          false,
          !!recovery || recordedApi,
          recordedApi,
          retainedApi,
        );
        const inspect = retainedApi
          ? movedApi
            ? (await import('./native-package-api-retained-evidence.js')).inspectMovedPackageApi
            : (await import('./native-package-api-retained-evidence.js')).inspectRetainedPackageApi
          : recovery
            ? (await import('./native-package-recovery-preflight.js')).inspectRetainedPackages
            : undefined;
        await helpers.packageGetOnlyPreflight(
          client,
          intent.graph,
          record,
          verify,
          inspect
            ? async (active, options) => {
                await inspect(active, intent.graph, options, record);
              }
            : undefined,
          recordedApi,
          retainedApi,
          movedApi,
        );
        verify();
        const result = {
          ...common,
          completedAt: new Date().toISOString(),
          failure: false,
          mutationAttempted: false,
          verifiedOwners: (recordedApi ? packageApiOwners(intent.graph) : packageOwners(intent.graph)).map(
            (o) => o.owner,
          ),
          inventory: 'valid-without-suffix',
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
    const intent = readIntent(),
      proof = readPackagePrerequisites(binding, intent, args[2], Date.now(), protocol);
    verifySource();
    intent.verify();
    proof.verify();
    idle();
    if (Date.now() >= proof.freshUntil) throw new Error('Prerequisites expired.');
    return {
      mode,
      root: binding.root,
      protocol,
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
  let entered = false,
    stopped = false;
  const stop = () => {
    stopped = true;
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, stop);
  try {
    if (existsSync(join(binding.root, 'preflight-running'))) throw new Error('Concurrent preflight.');
    verifySource();
    const intent = readIntent(),
      proof = readPackagePrerequisites(binding, intent, args[2], Date.now(), protocol);
    // Absolute original baseline lifetime survives every stage. Owning cleanup retains its own small budget.
    const verify = () => {
      verifySource();
      intent.verify();
      proof.verify();
    };
    const ready = () => {
      verify();
      if (stopped || Date.now() >= proof.freshUntil) throw new Error('Stopped or prerequisites expired.');
    };
    ready();
    durableRecord(join(root, 'manifest.json'), {
      protocol,
      binding: binding.evidence,
      intentHash: intent.hash,
      preflightId: args[2],
      prerequisites: proof.receipts,
      freshUntil: new Date(proof.freshUntil).toISOString(),
      graph: intent.graph,
      stages,
      identity: 'MARIAN',
      target: 'A4H/001',
      authentication: 'Basic-native-contract-only',
    });
    const runtime = await native(),
      helpers = await import('./native-package-runner.js');
    ready();
    const client = helpers.packageClient(
      runtime,
      binding.repo,
      intent.graph,
      ready,
      true,
      false,
      recordedApi,
      retainedApi,
    );
    ready();
    entered = true;
    const result = await runtime.execute({
      base: client,
      graph: intent.graph,
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
      JSON.stringify(result.completed) === JSON.stringify(stages) &&
      JSON.stringify(result.confirmedDeleted) ===
        JSON.stringify(
          [...(recordedApi ? packageApiOwners(intent.graph) : packageOwners(intent.graph))]
            .reverse()
            .map((o) => o.owner),
        ) &&
      result.expectedRefusals.length === (recovery || movedApi ? 0 : 2) &&
      (result.expectedRefusals as { stage?: string; owner?: string }[]).every(
        (r, i) =>
          r.stage === (i === 0 ? 'refuse-root-child' : 'refuse-child-class') &&
          r.owner === (i === 0 ? intent.graph.root.owner : intent.graph.child.owner),
      ) &&
      (!movedApi ||
        (JSON.stringify(result.previouslyCompleted) === JSON.stringify(PACKAGE_API_MOVED_COMPLETED) &&
          JSON.stringify(result.observedRetainedWrites) === JSON.stringify(PACKAGE_API_MOVED_OBSERVED) &&
          JSON.stringify(result.retainedBookkeeping?.members) ===
            JSON.stringify(['A4HK906609', 'A4HK906610', 'A4HK906611']))) &&
      result.remaining.length === 0 &&
      result.finalAbsenceConfirmed &&
      !result.cleanupUnconfirmed &&
      (!recordedApi ||
        (result.retainedBookkeeping?.classRecorded === true && result.retainedBookkeeping.apiRecorded === true));
    const outcome = {
      ...result,
      failure: result.failure || stopped || terminal || !complete,
      ...(!complete && !result.failure
        ? {
            completionUnconfirmed: true,
            inspectionRequired: (recordedApi ? packageApiOwners(intent.graph) : packageOwners(intent.graph)).map(
              (o) => o.owner,
            ),
          }
        : {}),
      ...(terminal
        ? {
            failure: true,
            terminalCheckUnconfirmed: true,
            inspectionRequired: [
              ...new Set([
                ...result.inspectionRequired,
                ...(recordedApi ? packageApiOwners(intent.graph) : packageOwners(intent.graph)).map((o) => o.owner),
              ]),
            ],
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
        inspectionRequired: entered ? 'entire-fixed-graph' : [],
      });
    throw error;
  } finally {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.off(signal, stop);
  }
}
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativePackage(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('Fixed package qualification stopped. Preserve all evidence; never repeat a claimed attempt.');
    process.exitCode = 1;
  }
}
