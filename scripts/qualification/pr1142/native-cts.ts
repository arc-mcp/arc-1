/** Once-only A/B/C entry. Check is pure offline; no arbitrary ID, request, owner or RPC input. */
import { randomBytes } from 'node:crypto';
import { existsSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AdtClient } from '../../../src/adt/client.js';
import type { NativeCtsInput } from './native-cts-driver.js';
import {
  CTS_NODE,
  CTS_RETAINED_SUFFIX,
  CTS_ROUNDS,
  type CtsProfile,
  type CtsRound,
  type CtsRoundResult,
  ctsFixtures,
  ctsOrigin,
  ctsPhaseProfile,
  ctsProtocol,
  ctsSteps,
  retainedCtsRequest,
} from './native-cts-fixtures.js';
import { ctsJournalBinding, readCtsHistory, readCtsIntent, readCtsPrerequisites } from './native-cts-prerequisites.js';
import { retainedCtsHistory } from './native-cts-retained-history.js';
import { retainedCtsV2History } from './native-cts-retained-v2-history.js';
import { retainedCtsV3History } from './native-cts-retained-v3-history.js';
import { retainedCtsV4History } from './native-cts-retained-v4-history.js';
import { retainedCtsV5History } from './native-cts-retained-v5-history.js';
import { retainedCtsV6History } from './native-cts-retained-v6-history.js';
import { ctsEffectful } from './native-cts-transport.js';
import { assertDeclarativeRuntime, invalidNativeCredentialFields, isDirectEntry } from './native-declarative-entry.js';
import { claimDirectory, durableRecord, journal, nativeLockBinding, privateDirectory } from './native-lock-binding.js';
export interface NativeCtsDependencies {
  validateRuntime: () => void;
  bind: typeof nativeLockBinding;
  readEnv: (repo: string) => Record<string, string>;
  createClient: (options: ConstructorParameters<typeof AdtClient>[0]) => AdtClient;
  execute: (input: NativeCtsInput) => Promise<CtsRoundResult>;
  retainedHistory?: () => { verify: () => void };
}
export function assertNativeCtsRuntime(env = process.env, argv = process.execArgv, node = process.version) {
  assertDeclarativeRuntime(env, argv);
  if (node !== CTS_NODE || env.ARC1_LOG_HTTP_DEBUG !== undefined) throw new Error('Fixed CTS runtime required.');
}
export async function runNativeCts(
  args: string[],
  dependencies?: NativeCtsDependencies,
  profile: CtsProfile = 'original',
) {
  const protocol = ctsProtocol(profile),
    origin = profile !== 'original' ? { origin: ctsOrigin(profile) } : {},
    mode = ['prepare', 'preflight', 'check', 'execute'].find(
      (m) => args[0] === `--${m}-reviewed-native-cts-${ctsPhaseProfile(profile)}`,
    ),
    round = args[2] as CtsRound;
  if (
    !mode ||
    !/^\w{40}$/.test(args[1] ?? '') ||
    !/^[a-f0-9]{40}$/.test(args[1] ?? '') ||
    args.length !== (mode === 'prepare' ? 2 : mode === 'preflight' ? 3 : 4) ||
    (mode !== 'prepare' && !CTS_ROUNDS.includes(round)) ||
    (['check', 'execute'].includes(mode) && !/^[A-F0-9]{16}$/.test(args[3] ?? ''))
  )
    throw new Error('Fixed phase, full reviewed revision, round and sample required.');
  (dependencies?.validateRuntime ?? assertNativeCtsRuntime)();
  const binding = await (dependencies?.bind ?? nativeLockBinding)(
      args[1],
      new URL(
        profile === 'retained-v6'
          ? './native-cts-retained-v6.ts'
          : profile === 'retained-v5'
            ? './native-cts-retained-v5.ts'
            : profile === 'retained-v4'
              ? './native-cts-retained-v4.ts'
              : profile === 'retained-v3'
                ? './native-cts-retained-v3.ts'
                : profile === 'retained-v2'
                  ? './native-cts-retained-v2.ts'
                  : profile === 'retained'
                    ? './native-cts-retained.ts'
                    : './native-cts.ts',
        import.meta.url,
      ),
      undefined,
      {
        readOnly: mode === 'check',
      },
    ),
    original =
      profile !== 'original'
        ? (
            dependencies?.retainedHistory ??
            (profile === 'retained-v6'
              ? retainedCtsV6History
              : profile === 'retained-v5'
                ? retainedCtsV5History
                : profile === 'retained-v4'
                  ? retainedCtsV4History
                  : profile === 'retained-v3'
                    ? retainedCtsV3History
                    : profile === 'retained-v2'
                      ? retainedCtsV2History
                      : retainedCtsHistory)
          )()
        : undefined;
  if (mode !== 'check') process.umask(0o077);
  if (mode === 'prepare') {
    binding.verifySource();
    original?.verify();
    const graph = ctsFixtures(
      profile !== 'original' ? CTS_RETAINED_SUFFIX : randomBytes(8).toString('hex').toUpperCase(),
    );
    claimDirectory(binding.root);
    durableRecord(join(binding.root, 'intent.json'), {
      protocol,
      ...origin,
      createdAt: new Date().toISOString(),
      binding: binding.evidence,
      suffix: graph.suffix,
      graph,
      identity: 'MARIAN',
      target: 'A4H/001',
      authentication: 'Basic-native-contract-only',
    });
    for (const r of CTS_ROUNDS) {
      claimDirectory(join(binding.root, r));
      claimDirectory(join(binding.root, r, 'preflight'));
    }
    const intent = readCtsIntent(binding, profile);
    binding.verifySource();
    original?.verify();
    intent.verify();
    return {
      mode,
      protocol,
      ...origin,
      root: binding.root,
      intentHash: intent.hash,
      graph,
      failure: false,
      mutationAttempted: false,
    };
  }
  privateDirectory(binding.root);
  privateDirectory(join(binding.root, round));
  const intent = readCtsIntent(binding, profile),
    history = readCtsHistory(binding, intent, round),
    attempt = join(binding.root, round, 'attempt'),
    running = join(binding.root, 'running');
  const idle = () => {
    if (
      existsSync(attempt) ||
      existsSync(running) ||
      CTS_ROUNDS.slice(CTS_ROUNDS.indexOf(round) + 1).some((r) => existsSync(join(binding.root, r, 'attempt')))
    )
      throw new Error('CTS round already claimed or another phase running.');
  };
  const proof = () => {
    binding.verifySource();
    original?.verify();
    intent.verify();
    history.verify();
  };
  idle();
  proof();
  if (mode === 'check') {
    const controls = readCtsPrerequisites(binding, intent, round, args[3], Date.now());
    proof();
    controls.verify();
    idle();
    if (Date.now() >= controls.freshUntil) throw new Error('Controls expired.');
    return {
      mode,
      protocol,
      ...origin,
      root: binding.root,
      round,
      preflightId: args[3],
      intentHash: intent.hash,
      history: history.receipts,
      receipts: controls.receipts,
      freshUntil: new Date(controls.freshUntil).toISOString(),
      failure: false,
      attemptClaimed: false,
      mutationAttempted: false,
      executionGrant: false,
    };
  }
  claimDirectory(running);
  let directory = '',
    stopped = false,
    entered = false,
    wireMutation = false,
    dispatchedMutations = 0,
    createdRequestUnconfirmed = false;
  const held = profile !== 'original' && round === 'A' ? [retainedCtsRequest(profile)] : [],
    observedIds = new Set<string>([
      ...(history.prior?.requests ?? held).flatMap((o) => [o.parent, o.task]),
      ...(['retained-v3', 'retained-v4', 'retained-v5', 'retained-v6'].includes(profile) && round === 'A'
        ? [intent.graph.classes[0].owner]
        : []),
    ]),
    stop = () => {
      stopped = true;
    };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, stop);
  try {
    if (existsSync(attempt)) throw new Error('CTS round already claimed.');
    const sample = mode === 'preflight' ? randomBytes(8).toString('hex').toUpperCase() : args[3];
    directory = mode === 'preflight' ? join(binding.root, round, 'preflight', sample) : attempt;
    claimDirectory(directory);
    const raw = journal(join(directory, 'run')),
      record = (value: unknown) => {
        const row = value as {
          stage?: string;
          method?: string;
          path?: string;
          generatedRequest?: string;
          generatedRequestObservedIds?: string[];
          unexpectedRequestObservedIds?: string[];
          ownedRequest?: { parent: string; task: string };
        };
        if (row.stage === 'dispatch' && row.method && row.path && ctsEffectful(row.method, row.path)) {
          dispatchedMutations++;
          wireMutation = true;
          if (row.path === '/sap/bc/adt/cts/transports') createdRequestUnconfirmed = true;
        }
        if (row.generatedRequest) observedIds.add(row.generatedRequest);
        for (const id of [...(row.generatedRequestObservedIds ?? []), ...(row.unexpectedRequestObservedIds ?? [])])
          observedIds.add(id);
        if (row.ownedRequest) {
          observedIds.add(row.ownedRequest.parent);
          observedIds.add(row.ownedRequest.task);
          createdRequestUnconfirmed = false;
        }
        raw(value);
      };
    const startedAt = new Date().toISOString(),
      controls = mode === 'execute' ? readCtsPrerequisites(binding, intent, round, sample, Date.now()) : undefined,
      freshUntil = controls?.freshUntil ?? Date.now() + 60_000;
    const verify = () => {
      proof();
      controls?.verify();
      if (stopped || Date.now() >= freshUntil) throw new Error('Stopped or original controls expired.');
    };
    durableRecord(join(directory, 'manifest.json'), {
      protocol,
      ...origin,
      round,
      preflightId: sample,
      binding: binding.evidence,
      intentHash: intent.hash,
      history: history.receipts,
      prerequisites: controls?.receipts ?? [],
      freshUntil: new Date(freshUntil).toISOString(),
      startedAt,
      authentication: 'Basic-native-contract-only',
      steps: ctsSteps(round, profile),
    });
    let result: CtsRoundResult;
    try {
      verify();
      const runtime = dependencies ?? (await import('./native-cts-runtime.js')).nativeCtsRuntime;
      const { ctsSafety } = await import('./native-cts-driver.js');
      verify();
      const env = runtime.readEnv(binding.repo);
      let base: AdtClient;
      try {
        if (invalidNativeCredentialFields(env).length) throw new Error('Exact native credentials required.');
        verify();
        base = runtime.createClient({
          baseUrl: 'https://a4h.marianzeis.de',
          client: '001',
          language: 'EN',
          username: env.SAP_USER,
          password: env.SAP_PASSWORD,
          insecure: false,
          safety: ctsSafety(),
        });
      } finally {
        delete env.SAP_PASSWORD;
      }
      verify();
      entered = true;
      result = await runtime.execute({
        base,
        graph: intent.graph,
        round,
        prior: history.prior,
        expectedPackageHash: controls?.packageMetadataHash,
        preflight: mode === 'preflight',
        profile,
        freshUntil,
        verify,
        shouldStop: () => stopped,
        record,
      });
      try {
        verify();
      } catch {
        result = {
          ...result,
          failure: true,
          inspectionRequired: [
            ...new Set([...result.inspectionRequired, ...observedIds, ...intent.graph.classes.map((c) => c.owner)]),
          ],
        };
      }
    } catch (error) {
      const affected = [...new Set([...observedIds, ...(entered ? intent.graph.classes.map((c) => c.owner) : [])])];
      record({
        phaseUnconfirmed: true,
        entered,
        wireMutation,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      result = {
        protocol,
        ...origin,
        round,
        failure: true,
        completed: [],
        requests: history.prior?.requests ?? held,
        confirmedDeleted:
          history.prior?.confirmedDeleted ??
          (['retained-v4', 'retained-v5', 'retained-v6'].includes(profile) && round === 'A'
            ? [intent.graph.classes[0].owner]
            : []),
        confirmedReleased: history.prior?.confirmedReleased ?? [],
        current: Object.fromEntries(affected.map((id) => [id, 'unknown' as const])),
        inspectionRequired: affected,
        unknownCreation: createdRequestUnconfirmed,
        cleanupUnconfirmed: wireMutation,
        dispatchedMutations,
        remaining: affected,
        retainedReleasedHistory: history.prior?.confirmedReleased ?? [],
      };
    }
    const common = {
      protocol,
      ...origin,
      round,
      revision: binding.evidence.revision,
      intentHash: intent.hash,
      startedAt,
      completedAt: new Date().toISOString(),
      journal: ctsJournalBinding(join(directory, 'run')),
    };
    const outcome =
      mode === 'preflight'
        ? {
            ...common,
            failure: result.failure,
            mutationAttempted: wireMutation,
            packageMetadataHash: result.packageMetadataHash,
            history: history.receipts,
          }
        : { ...result, ...common };
    durableRecord(join(directory, 'result.json'), outcome);
    return { ...outcome, mode, root: binding.root, preflightId: sample };
  } catch (error) {
    if (directory && !existsSync(join(directory, 'result.json')))
      durableRecord(join(directory, 'result.json'), {
        protocol,
        ...origin,
        round,
        failure: true,
        mutationAttempted: wireMutation,
        entered,
        unknownCreation: createdRequestUnconfirmed,
        dispatchedMutations,
        inspectionRequired: [
          ...new Set([...observedIds, ...(entered ? intent.graph.classes.map((c) => c.owner) : [])]),
        ],
        remaining: [...new Set([...observedIds, ...(entered ? intent.graph.classes.map((c) => c.owner) : [])])],
        reason: 'phase-prerequisites-or-seal-unconfirmed',
      });
    throw error;
  } finally {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.off(signal, stop);
    rmdirSync(running);
  }
}
if (isDirectEntry(process.argv[1], import.meta.url))
  try {
    const result = await runNativeCts(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error(
      'Fixed CTS qualification stopped. Preserve every claim, history and generated ID; never retry a claimed round.',
    );
    process.exitCode = 1;
  }
