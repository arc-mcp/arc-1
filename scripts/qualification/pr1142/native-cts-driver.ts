/** Fixed sequential CTS representative; shared private adapters, no repair, retry or release compensation. */
import type { AdtClient } from '../../../src/adt/client.js';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import type { AdtHttpClient, AdtRequestOptions } from '../../../src/adt/http.js';
import { throwIfRequestCancelled } from '../../../src/adt/http-deadline.js';
import { mutationClient } from '../../../src/adt/mutation-client.js';
import { type MutationCleanupState, pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { assertCtsNoInactive } from "../../../src/adt/pinned-cts-evidence.js";
import { deletePinnedOwner } from '../../../src/adt/pinned-delete.js';
import { RequestAttemptBudget } from '../../../src/adt/request-attempt-budget.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { handlePrivatePinnedCts } from '../../../src/handlers/pinned-cts.js';
import { preparePrivatePinnedBatchActivation } from '../../../src/handlers/write/pinned-activation.js';
import { createPinnedTextSourceContext } from '../../../src/handlers/write/pinned-source-input.js';
import { executePinnedSourceWrite } from '../../../src/handlers/write/pinned-source-write.js';
import { getCurrentContext, requestContext } from '../../../src/server/context.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import {
  assertCtsOwnedTree,
  assertCtsSummaries,
  assertEmptyCtsGraph,
  bindCreatedRequest,
  classEntry,
  ctsPackage,
  ctsRead,
  generatedCtsId,
  inspectCtsTree,
  observedCtsIds,
} from './native-cts-evidence.js';
import {
  CTS_BASE,
  CTS_PACKAGE,
  CTS_RETAINED_SUFFIX,
  CTS_ROUNDS,
  type CtsGraph,
  type CtsProfile,
  type CtsRound,
  type CtsRoundResult,
  type CtsStep,
  ctsFixtures,
  ctsOrigin,
  ctsProtocol,
  ctsSteps,
  retainedCtsRequest,
} from './native-cts-fixtures.js';
import { CtsReleaseBookkeeping } from './native-cts-release-bookkeeping.js';
import {
  CTS_RETAINED_SOURCE_HASH,
  retainedCtsV3Includes,
  retainedCtsV3Inventory,
  retainedCtsV3Snapshot,
} from './native-cts-retained-v3-evidence.js';
import { retainedCtsV4Snapshot } from './native-cts-retained-v4-evidence.js';
import { retainedCtsV5Snapshot } from './native-cts-retained-v5-evidence.js';
import { assertRetainedCtsV6View, retainedCtsV6Snapshot } from './native-cts-retained-v6-evidence.js';
import { type CtsWireState, checkCtsRequest, ctsEffectful, ctsOwnUnlock } from './native-cts-transport.js';
import { declarativeInventoryClean } from './native-declarative-evidence.js';
import type { DeclarativeFixture } from './native-declarative-fixtures.js';
import { nativeRequestPolicy, observeNativeHttp } from './native-observed-http.js';
import {
  nativeClassSnapshot,
  type OwnerReceipt,
  type PackageJournal,
  packageAdapterEvidence,
  packageOwnerAbsent,
} from './native-package-evidence.js';
export const ctsConfig = () => ({
  ...DEFAULT_CONFIG,
  client: '001',
  language: 'EN',
  systemType: 'onprem' as const,
  abapRelease: '758',
  multiTargetEndpoints: true,
  ppEnabled: true,
  ppStrict: true,
  allowWrites: true,
  allowTransportWrites: true,
  targetId: 'A4H/001',
  allowedPackages: [CTS_PACKAGE],
  allowedTransports: ['*'],
  lintBeforeWrite: false,
  checkBeforeWrite: false,
  multiTargetWrite: {
    target: 'A4H/001',
    enabled: true,
    allowedPackages: [CTS_PACKAGE],
    allowedTransports: ['*'],
    serverAllowedTransports: ['*'],
  },
});
export const ctsSafety = () => ({ ...defaultSafetyConfig(), ...ctsConfig() });
export interface NativeCtsInput {
  base: AdtClient;
  graph: CtsGraph;
  round: CtsRound;
  prior?: CtsRoundResult;
  expectedPackageHash?: string;
  preflight?: boolean;
  profile?: CtsProfile;
  freshUntil: number;
  verify: () => void;
  shouldStop: () => boolean;
  record: PackageJournal;
}
const payload = (result: { content: { type: string; text?: string }[] }) =>
  JSON.parse(
    result.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n'),
  ) as Record<string, unknown>;
export async function runNativeCtsRound({
  base,
  graph,
  round,
  prior,
  expectedPackageHash,
  preflight = false,
  profile = 'original',
  freshUntil,
  verify: proof,
  shouldStop,
  record,
}: NativeCtsInput): Promise<CtsRoundResult> {
  const protocol = ctsProtocol(profile),
    steps = ctsSteps(round, profile),
    retained = profile !== 'original' && round === 'A' ? retainedCtsRequest(profile) : undefined,
    retainedClass = profile === 'retained-v3' && round === 'A',
    retainedPairReleased = profile === 'retained-v6' && round === 'A',
    retainedReleased = (profile === 'retained-v5' || profile === 'retained-v6') && round === 'A',
    retainedDeleted = ['retained-v4', 'retained-v5', 'retained-v6'].includes(profile) && round === 'A',
    retainedRecorded = retainedClass || retainedDeleted;
  if (
    (profile !== 'original' && JSON.stringify(graph) !== JSON.stringify(ctsFixtures(CTS_RETAINED_SUFFIX))) ||
    (prior && prior.protocol !== protocol) ||
    (round === 'A' && prior) ||
    (round !== 'A' && (!prior || prior.failure || prior.round !== CTS_ROUNDS[CTS_ROUNDS.indexOf(round) - 1]))
  )
    throw new Error('Successful immediately previous fixed round required.');
  if (
    ['retained-v5', 'retained-v6'].includes(profile) &&
    prior &&
    (!Array.isArray(prior.releaseWitnesses) ||
      prior.releaseWitnesses.length !== prior.requests.length ||
      JSON.stringify(prior.adoptedReleased) !==
        JSON.stringify(profile === 'retained-v6' ? ['A4HK906607', 'A4HK906608'] : ['A4HK906608']) ||
      prior.releaseWitnesses.some(
        (w, i) => w.parent !== prior.requests[i]?.parent || w.task !== prior.requests[i]?.task,
      ))
  )
    throw Error('Exact previous v5 adoption/proof graph required.');
  const config = ctsConfig(),
    signature = JSON.stringify(base.safety),
    deadline = Math.min(freshUntil, Date.now() + 4 * 60_000),
    attempts = new RequestAttemptBudget(256),
    responses = new DataResponseBudget(2 * 1024 * 1024, 'native-cts', true);
  const releaseProof = ['retained-v5', 'retained-v6'].includes(profile)
    ? new CtsReleaseBookkeeping(
        graph,
        prior?.releaseWitnesses,
        prior?.requests,
        profile === 'retained-v6' ? 'native-parent-state' : 'modifiable-parent',
      )
    : undefined;
  const assertOwned = (
    tree: Parameters<typeof assertCtsOwnedTree>[0],
    own: Parameters<typeof assertCtsOwnedTree>[1],
    step?: CtsStep,
  ) =>
    releaseProof
      ? releaseChecked(() => releaseProof.assertTree(tree, own, step))
      : assertCtsOwnedTree(tree, own, graph, step);
  const state: CtsWireState = { round, requests: structuredClone(prior?.requests ?? (retained ? [retained] : [])) };
  const result: CtsRoundResult = {
    protocol,
    ...(profile !== 'original' ? { origin: ctsOrigin(profile) } : {}),
    round,
    failure: false,
    completed: [],
    requests: state.requests,
    confirmedDeleted: [...(prior?.confirmedDeleted ?? (retainedDeleted ? [graph.classes[0].owner] : []))],
    confirmedReleased: [...(prior?.confirmedReleased ?? [])],
    current: retainedRecorded
      ? { [graph.classes[0].owner]: 'unknown', [retained!.parent]: 'unknown', [retained!.task]: 'unknown' }
      : {},
    inspectionRequired: [],
    unknownCreation: false,
    cleanupUnconfirmed: false,
    dispatchedMutations: 0,
    remaining: [],
    retainedReleasedHistory: [],
    ...(releaseProof
      ? { releaseWitnesses: releaseProof.witnesses(), adoptedReleased: [...(prior?.adoptedReleased ?? [])] }
      : {}),
  };
  const refusal = releaseProof ? new AbortController() : undefined;
  const releaseChecked = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (error) {
      if (refusal && !refusal.signal.aborted) {
        result.failure = true;
        result.releaseProofRefusal = {
          step: state.step ?? 'inspection',
          reason: error instanceof Error ? error.message.slice(0, 300) : 'Unknown qualification proof failure',
        };
        for (const req of state.requests) {
          unexpected.add(req.parent);
          unexpected.add(req.task);
        }
        refusal.abort(new Error('Fixed v5 release proof refused.'));
        record({ releaseProofRefusal: result.releaseProofRefusal });
      }
      throw error;
    }
  };
  const creationIds = new Set<string>();
  const unexpected = new Set<string>(),
    dispatched = new Set<string>();
  const cls = graph.classes[round === 'B' ? 1 : 0];
  let cleanup: MutationCleanupState | undefined,
    receipt: OwnerReceipt | undefined,
    ended = false,
    removalSubmitted = false,
    retainedInitial = !!retained,
    retainedVerified = false;
  const options = (): AdtRequestOptions => ({
    deadline,
    noReplay: true,
    retryTransientErrors: false,
    attemptBudget: attempts,
    responseBudget: responses,
  });
  const ready = () => {
    proof();
    if (ended || shouldStop() || refusal?.signal.aborted) throw new Error('CTS qualification stopped.');
    if (
      JSON.stringify(base.safety) !== signature ||
      !base.safety.allowWrites ||
      !base.safety.allowTransportWrites ||
      JSON.stringify(base.safety.multiTargetWrite) !== JSON.stringify(config.multiTargetWrite) ||
      JSON.stringify(base.safety.allowedPackages) !== JSON.stringify(config.allowedPackages)
    )
      throw new Error('Fixed CTS policy changed.');
    throwIfRequestCancelled(options());
  };
  const unique = (list: string[], id: string) => {
    if (!list.includes(id)) list.push(id);
  };
  const own = () => {
    const found = state.requests.find((r) => r.round === round);
    if (!found) throw new Error('Generated ownership not yet bound.');
    return found;
  };
  const key = (method: string, path: string) => `${state.step}:${method}:${path.split('?')[0]}`;
  const validate = (method: string, path: string, body?: string) => {
    if (retainedPairReleased && !['HEAD', 'GET'].includes(method))
      throw Error('Released A is read-only;607/608 and all repository mutations are permanently forbidden.');
    if (
      retainedDeleted &&
      !['HEAD', 'GET'].includes(method) &&
      !(
        method === 'POST' &&
        (retainedReleased ? ['release-parent'] : ['release-task', 'release-parent']).includes(state.step ?? '') &&
        path === CTS_BASE + (state.step === 'release-task' ? retained!.task : retained!.parent) + '/newreleasejobs'
      )
    )
      throw new Error('Retained deleted-class A permits only the two remaining release starts.');
    if (retained && method === 'POST' && path === '/sap/bc/adt/cts/transports')
      throw new Error('Original CTS CREATE must never be replayed.');
    checkCtsRequest(graph, state, method, path, body);
    if (!ctsOwnUnlock(graph, state, method, path)) {
      ready();
      if (ctsEffectful(method, path) && dispatched.has(key(method, path))) throw new Error('No mutation replay.');
    }
  };
  const observe = (row: unknown) => {
    const r = row as { stage?: string; method?: string; path?: string; status?: number; body?: string };
    if (r.stage === 'dispatch' && r.method && r.path && ctsEffectful(r.method, r.path)) {
      dispatched.add(key(r.method, r.path));
      result.dispatchedMutations++;
      if (releaseProof && r.method === 'POST' && r.path.startsWith(CTS_BASE))
        releaseProof.dispatch(r.path, own(), state.step, deadline);
      if (state.step === 'remove-object' && r.method === 'PUT') removalSubmitted = true;
      if (r.path === '/sap/bc/adt/cts/transports') result.unknownCreation = true;
    }
    // Persist the response and generated ID before allowing the adapter's independent lookup.
    const { body, ...safe } = r;
    record({
      round,
      step: state.step ?? 'inspection',
      ...(['/sap/bc/adt/activation/inactiveobjects', '/sap/bc/adt/core/discovery'].includes(r.path ?? '') ? safe : r),
    });
    if (r.stage !== 'response') return;
    if (releaseProof && r.method === 'POST' && r.path?.startsWith(CTS_BASE))
      releaseChecked(() => releaseProof.report(body ?? '', r.status ?? 0, r.path!, own()));
    if (
      r.method === 'POST' &&
      r.path === '/sap/bc/adt/cts/transports' &&
      (r.status ?? 0) >= 200 &&
      (r.status ?? 0) < 300
    ) {
      state.generatedParent = generatedCtsId(
        body ?? '',
        state.requests.flatMap((o) => [o.parent, o.task]),
      );
      result.current[state.generatedParent] = 'unknown';
      record({ generatedRequest: state.generatedParent, round, ownership: 'unconfirmed' });
    }
    if (r.method === 'GET' && r.status === 200 && r.path?.startsWith(CTS_BASE)) {
      const id = r.path.slice(CTS_BASE.length),
        bound = state.requests.find((o) => o.parent === id || o.task === id),
        parent = bound?.parent ?? state.generatedParent;
      if (!parent) throw new Error('Unowned CTS response.');
      const observed = observedCtsIds(body ?? '');
      if (!bound) {
        for (const id of observed) {
          creationIds.add(id);
          result.current[id] = 'unknown';
        }
        record({ generatedRequestObservedIds: [...creationIds], ownership: 'unconfirmed' });
      }
      if (bound) {
        const extra = observed.filter((id) => ![bound.parent, bound.task].includes(id));
        for (const id of extra) {
          unexpected.add(id);
          result.current[id] = 'unknown';
        }
        // Observation is diagnostic only: no new ID enters state.requests or wire authority.
        if (extra.length) record({ unexpectedRequestObservedIds: extra, ownership: 'unconfirmed' });
      }
      if (profile === 'retained-v6' && bound?.round === 'A')
        releaseChecked(() => assertRetainedCtsV6View(id, r.status!, body ?? ''));
      const tree = releaseProof
        ? releaseChecked(() => inspectCtsTree(body ?? '', parent))
        : inspectCtsTree(body ?? '', parent);
      if (releaseProof && bound) releaseChecked(() => releaseProof.observe(body ?? '', r.path!, tree, bound));
      if (retainedInitial && bound?.round === 'A') {
        if (retainedRecorded) assertRetainedClassRequest(tree);
        else {
          const fresh = bindCreatedRequest(tree, graph, 'A');
          if (JSON.stringify(fresh) !== JSON.stringify(retained))
            throw new Error('Exact retained empty native request/task required.');
        }
      }
      // Every early response matters, including the adapter's first creation GET. Later empty
      // views cannot erase a contradiction seen before adopting the generated graph.
      if (
        !bound ||
        bound.round === 'C' ||
        (bound.round === round &&
          (['create-request', 'reassign-away', 'reassign-back'].includes(state.step ?? '') ||
            (state.step === 'remove-object' && removalSubmitted)))
      )
        assertEmptyCtsGraph(tree);
      if (bound) {
        if (tree.parent) {
          assertOwned(tree, bound, state.step);
          if (releaseProof) releaseChecked(() => assertCtsSummaries(body ?? '', bound, graph));
          else assertCtsSummaries(body ?? '', bound, graph);
        } else if (
          state.step !== 'delete-recursive' &&
          !(bound.round === 'C' && [bound.parent, bound.task].every((id) => result.confirmedDeleted.includes(id)))
        )
          throw new Error('Unexpected parent disappearance.');
        result.current[bound.parent] = tree.parent
          ? ['R', 'N'].includes(tree.parent.status)
            ? 'released'
            : 'modifiable'
          : 'absent';
        const task = tree.tasks.find((t) => t.id === bound.task);
        result.current[bound.task] = task
          ? ['R', 'N'].includes(task.status)
            ? 'released'
            : 'modifiable'
          : !tree.parent || state.step === 'delete-recursive'
            ? 'absent'
            : result.confirmedReleased.includes(bound.task) && ['R', 'N'].includes(tree.parent.status)
              ? 'released'
              : 'unknown';
        if (task && task.type !== bound.taskType) {
          record({ nativeTaskClassification: { id: task.id, from: bound.taskType, to: task.type } });
          bound.taskType = task.type;
        }
      }
    }
    if (r.method === 'GET' && r.status === 200 && graph.classes.some((c) => c.owner === r.path))
      result.current[r.path!] = 'present';
  };
  const clone = (http: AdtHttpClient) =>
    Object.assign(Object.create(Object.getPrototypeOf(base)), base, { http }) as AdtClient;
  const bounded = (http: AdtHttpClient): AdtHttpClient =>
    new Proxy(http, {
      get(target, property) {
        if (property === 'withStatefulSession')
          return (fn: (s: AdtHttpClient) => unknown, finish: unknown) =>
            Reflect.apply(target.withStatefulSession, target, [(s: AdtHttpClient) => fn(bounded(s)), finish]);
        const value = Reflect.get(target, property, target);
        if (!['get', 'head', 'post', 'put', 'delete'].includes(String(property)))
          return typeof value === 'function' ? value.bind(target) : value;
        return async (...args: unknown[]) => {
          const method = String(property).toUpperCase(),
            path = String(args[0]),
            idx = ['POST', 'PUT'].includes(method) ? 4 : 2,
            supplied = args[idx] as AdtRequestOptions | undefined,
            unlock = ctsOwnUnlock(graph, state, method, path);
          args[idx] = nativeRequestPolicy({
            ...supplied,
            ...options(),
            deadline: unlock ? Date.now() + 10_000 : Math.min(deadline, supplied?.deadline ?? Infinity),
            signal: unlock ? undefined : supplied?.signal,
            attemptBudget: unlock ? new RequestAttemptBudget(4) : attempts,
            responseBudget: unlock ? new DataResponseBudget(64 * 1024, 'cts-own-unlock', true) : responses,
          });
          if (retainedClass && state.step === 'save-class' && method === 'PUT') {
            await retainedCtsV3Snapshot(target, graph, options(), record);
            ready();
          }
          if (retainedDeleted && method === 'POST') {
            result.current[cls.owner] = 'unknown';
            await packageOwnerAbsent(target, cls, record, options());
            result.current[cls.owner] = 'absent';
            if (retainedReleased && state.step === 'release-parent')
              await retainedCtsV5Snapshot(target, options(), record);
            if (state.step === 'release-task') await retainedCtsV4Snapshot(target, graph, options(), record);
            ready();
          }
          return Reflect.apply(value, target, args);
        };
      },
    });
  const http = bounded(
    observeNativeHttp(base.http, validate, observe, async (session, path) => {
      if (path === cls.owner && state.step === 'delete-class') await matches(clone(session));
      else if (state.step === 'delete-recursive' && [own().task, own().parent].some((id) => path === CTS_BASE + id)) {
        const tree = await ctsRead(session, own().parent, options(), record);
        assertOwned(tree, own(), state.step);
        if (
          !tree.parent ||
          [tree.parent, ...tree.tasks].some((n) => n.objects.length || n.owner !== 'MARIAN' || n.status !== 'D')
        )
          throw new Error('CTS deletion requires current own empty modifiable nodes.');
      } else throw new Error('Unexpected DELETE scope.');
      ready();
    }),
  );
  const client = clone(http),
    context = () => {
      cleanup = { unlockFailed: false };
      return pinnedMutationContext(client.safety, options() as { deadline: number } & AdtRequestOptions, cleanup);
    };
  const snapshot = async (c: AdtClient, active = true) => {
    const result = await nativeClassSnapshot(c, cls, CTS_PACKAGE, cls.source, options(), record, active);
    if (retainedClass) await retainedCtsV3Includes(c.http, graph, options(), record);
    ready();
    return result;
  };
  const matches = async (c: AdtClient) => {
    const current = await snapshot(c);
    if (!receipt || JSON.stringify(current) !== JSON.stringify(receipt))
      throw new Error('Exact class metadata/source drift.');
    ready();
  };
  const clean = () => {
    if (!cleanup || cleanup.unlockFailed || cleanup.unknownLocks?.length || cleanup.sessionClosed !== true) {
      result.cleanupUnconfirmed = true;
      throw new Error('Own class cleanup unconfirmed.');
    }
  };
  const assertRetainedClassRequest = (tree: ReturnType<typeof inspectCtsTree>) => {
    if (retainedReleased) {
      assertOwned(tree, retained!);
      if (
        tree.parent?.status !== (retainedPairReleased ? 'R' : 'D') ||
        tree.tasks.length !== 1 ||
        tree.tasks[0]?.status !== 'R'
      )
        throw Error('Retained parent-D/task-R state required.');
      return;
    }
    classEntry(tree, retained!, graph);
    if (
      tree.parent?.status !== 'D' ||
      tree.tasks.length !== 1 ||
      tree.tasks[0].status !== 'D' ||
      tree.tasks[0].owner !== 'MARIAN'
    )
      throw new Error('Exact retained recorded class membership required.');
  };
  const inventory = (allowRetained: boolean) =>
    retainedClass && allowRetained
      ? retainedCtsV3Inventory(http, graph, options(), record)
      : declarativeInventoryClean(http, graph.classes as unknown as readonly DeclarativeFixture[], record, options());
  const inspect = async (allowRetained = false) => {
    for (const c of graph.classes) {
      result.current[c.owner] = 'unknown';
      try {
        if (retainedClass && allowRetained && c.owner === graph.classes[0].owner) {
          await retainedCtsV3Snapshot(http, graph, options(), record);
          ready();
          result.current[c.owner] = 'present';
        } else {
          await packageOwnerAbsent(http, c, record, options());
          result.current[c.owner] = 'absent';
        }
      } catch {
        result.failure = true;
      }
    }
    for (const req of state.requests) {
      result.current[req.parent] = 'unknown';
      result.current[req.task] = 'unknown';
      try {
        const deleted = req.round === 'C' && [req.parent, req.task].every((id) => result.confirmedDeleted.includes(id));
        const tree = await ctsRead(http, req.parent, options(), record, deleted);
        if (deleted && !tree.parent && tree.tasks.length === 0) {
          result.current[req.parent] = 'absent';
          result.current[req.task] = 'absent';
        }
        const held = allowRetained && retainedVerified && req.parent === retained?.parent;
        if (req.round !== 'C' && !held && (!tree.parent || !['R', 'N'].includes(tree.parent.status)))
          result.failure = true;
        if (req.round === 'C' && tree.parent) result.failure = true;
      } catch {
        result.failure = true;
      }
    }
  };
  const manage = async (args: Record<string, unknown>) => {
    // The private adapter owns its convergence clock. Carry the new profile's remaining
    // outer allowance into that clock too; refused sends must not leave a five-minute local poll.
    const boundedArgs =
      ['retained-v4', 'retained-v5', 'retained-v6'].includes(profile) &&
      ['release', 'release_recursive'].includes(String(args.action))
        ? { ...args, timeoutSeconds: Math.min(300, Math.max(1, Math.floor((deadline - Date.now()) / 1000))) }
        : args;
    const execute = () => handlePrivatePinnedCts(client, config, boundedArgs, ['read', 'write', 'transports']);
    const inherited = getCurrentContext();
    // Only the qualification CTS call receives this signal. Owning class cleanup keeps its
    // separate allowance. Existing production convergence already observes the registered signal.
    const out = await (refusal
        ? requestContext.run(
            {
              ...inherited,
              requestId: inherited?.requestId ?? `native-cts-v5-${round}`,
              signal: inherited?.signal ? AbortSignal.any([inherited.signal, refusal.signal]) : refusal.signal,
            },
            execute,
          )
        : execute()),
      data = payload(out);
    record({ adapter: 'private-cts', step: state.step, result: out });
    // These remain historical facts even if a later observation is contradictory or unknown.
    if (Array.isArray(data.completed))
      for (const item of data.completed) {
        const c = item as { id?: string; operation?: string };
        if (c.id && state.requests.some((o) => [o.parent, o.task].includes(c.id!))) {
          if (c.operation === 'delete') unique(result.confirmedDeleted, c.id);
          if (c.operation === 'release') unique(result.confirmedReleased, c.id);
        }
      }
    if (out.isError || data.ok !== true || data.state !== 'confirmed') {
      if (state.step !== 'create-request' && Array.isArray(data.submissions) && data.submissions.length)
        for (const id of [own().parent, own().task]) unexpected.add(id);
      throw new Error('Native CTS operation unconfirmed; retain all affected IDs.');
    }
    return data;
  };
  try {
    ready();
    result.packageMetadataHash = await ctsPackage(http, options(), record);
    if (expectedPackageHash && expectedPackageHash !== result.packageMetadataHash)
      throw new Error('Package changed after preflight.');
    if (retained) {
      const tree = await ctsRead(http, retained.parent, options(), record);
      const fresh = retainedRecorded ? retained : bindCreatedRequest(tree, graph, 'A');
      if (retainedRecorded) assertRetainedClassRequest(tree);
      if (JSON.stringify(fresh) !== JSON.stringify(retained)) throw new Error('Retained ownership changed.');
      if (retainedPairReleased) await retainedCtsV6Snapshot(http, options(), record);
      else if (retainedReleased) await retainedCtsV5Snapshot(http, options(), record);
      else if (retainedDeleted) await retainedCtsV4Snapshot(http, graph, options(), record);
      ready();
      retainedVerified = true;
      if (retainedPairReleased) {
        unique(result.confirmedReleased, retained.parent);
        unique(result.adoptedReleased!, retained.parent);
      }
      if (retainedReleased) {
        unique(result.confirmedReleased, retained.task);
        unique(result.adoptedReleased!, retained.task);
      }
      record({ ownedRequest: fresh, adoptedFrom: ctsOrigin(profile), round });
    }
    await inspect(!!retained);
    if (result.failure) throw new Error('Initial own history/absence unconfirmed.');
    await inventory(!!retained);
    if (retainedDeleted) await assertCtsNoInactive(http, [retained!.parent, retained!.task]);
    ready();
    retainedInitial = !!retained && preflight;
    if (!preflight)
      for (const step of steps) {
        state.step = step;
        ready();
        if ((await ctsPackage(http, options(), record)) !== result.packageMetadataHash)
          throw new Error('Package changed during the round.');
        if (step === 'adopt-released-a') {
          if (!retainedPairReleased) throw Error('Literal v6 A adoption only.');
          await retainedCtsV6Snapshot(http, options(), record);
          await inspect();
          await inventory(false);
          await assertCtsNoInactive(http, [retained!.parent, retained!.task]);
          ready();
          if (result.failure || result.dispatchedMutations !== 0) throw Error('Read-only A adoption unconfirmed.');
        } else if (step === 'create-request') {
          const data = await manage({ action: 'create', description: graph.descriptions[round], package: CTS_PACKAGE });
          if (data.selected !== state.generatedParent || !state.generatedParent)
            throw new Error('Creation result disagrees with native returned ID.');
          const tree = await ctsRead(http, state.generatedParent, options(), record),
            bound = bindCreatedRequest(tree, graph, round);
          assertCtsSummaries((await http.get(CTS_BASE + bound.parent, undefined, options())).body, bound, graph);
          if (creationIds.size !== 2 || [...creationIds].some((id) => ![bound.parent, bound.task].includes(id)))
            throw new Error('Creation membership changed across native reads.');
          record({ ownedRequest: bound, round });
          state.requests.push(bound);
          state.generatedParent = undefined;
          result.unknownCreation = false;
        } else if (step === 'reassign-away' || step === 'reassign-back') {
          const owner = step === 'reassign-away' ? 'ARC1_WG_RO' : 'MARIAN';
          await manage({ action: 'reassign', id: own().task, owner, recursive: false });
          const tree = await ctsRead(http, own().parent, options(), record);
          if (tree.tasks[0]?.owner !== owner || tree.parent?.owner !== 'MARIAN' || tree.tasks[0].objects.length)
            throw new Error('Owner roundtrip changed native membership.');
        } else if (step === 'create-class' || step === 'save-class') {
          const ctx = context(),
            out = await executePinnedSourceWrite(
              createPinnedTextSourceContext(
                client,
                {
                  action: step === 'save-class' ? 'update' : 'create',
                  ...(step === 'save-class' ? { expectedSourceHash: CTS_RETAINED_SOURCE_HASH } : {}),
                  type: 'CLAS',
                  name: cls.name,
                  package: CTS_PACKAGE,
                  description: cls.description,
                  source: cls.source,
                  transport: own().task,
                },
                config,
                ctx,
              ),
            );
          record({
            adapter: step === 'save-class' ? 'class-save-retained' : 'class-create',
            result: packageAdapterEvidence(out),
            cleanup,
          });
          clean();
          if (out.isError || payload(out).state !== 'saved-inactive') throw new Error('Class save unconfirmed.');
          receipt = await snapshot(mutationClient(client, ctx), false);
          if (payload(out).sourceHash !== receipt.sourceHash) throw new Error('Saved source mismatch.');
          classEntry(await ctsRead(http, own().parent, options(), record), own(), graph);
        } else if (step === 'activate-class') {
          const ctx = context(),
            before = await snapshot(mutationClient(client, ctx), false);
          if (JSON.stringify(before) !== JSON.stringify(receipt)) throw new Error('Preactivation drift.');
          const prepared = await preparePrivatePinnedBatchActivation(
              client,
              { type: 'CLAS', name: cls.name, transport: own().task },
              false,
              ctx,
            ),
            out = 'execute' in prepared ? await prepared.execute() : prepared;
          record({ adapter: 'class-activate', result: packageAdapterEvidence(out) });
          if (out.isError || payload(out).success !== true) throw new Error('Activation unconfirmed.');
          receipt = await snapshot(client);
          if (receipt.sourceHash !== before.sourceHash) throw new Error('Activation changed source.');
        } else if (step === 'remove-object') {
          await matches(client);
          state.remove = classEntry(await ctsRead(http, own().parent, options(), record), own(), graph);
          await manage({
            action: 'remove_object',
            id: own().parent,
            pgmid: state.remove.pgmid,
            type: state.remove.type,
            name: state.remove.name,
          });
          await matches(client);
          assertEmptyCtsGraph(await ctsRead(http, own().parent, options(), record));
          state.remove = undefined;
        } else if (step === 'delete-class') {
          const ctx = context(),
            out = await deletePinnedOwner(
              client,
              ctx,
              { type: 'CLAS', name: cls.name, transport: own().task },
              {
                owner: cls.owner,
                packageFor: async (c) => {
                  await matches(c);
                  return CTS_PACKAGE;
                },
                precondition: matches,
                validateRecording: (r) => {
                  if (r.local || r.request !== own().parent) throw new Error('Exact own parent recording required.');
                },
              },
            );
          record({ adapter: 'class-delete', result: packageAdapterEvidence(out), cleanup });
          result.current[cls.owner] = 'unknown';
          if (out.state === 'deleted') {
            await packageOwnerAbsent(http, cls, record, options());
            result.current[cls.owner] = 'absent';
            unique(result.confirmedDeleted, cls.owner);
          }
          clean();
          if (!out.ok || out.state !== 'deleted') throw new Error('Class deletion unconfirmed.');
        } else {
          const tree = await ctsRead(http, own().parent, options(), record);
          assertOwned(tree, own(), step);
          await declarativeInventoryClean(
            http,
            graph.classes as unknown as readonly DeclarativeFixture[],
            record,
            options(),
          );
          if (step === 'release-task') await manage({ action: 'release', id: own().task, timeoutSeconds: 300 });
          if (step === 'release-parent') await manage({ action: 'release', id: own().parent, timeoutSeconds: 300 });
          if (step === 'release-recursive') {
            if (tree.tasks[0]?.status !== 'D') throw new Error('Recursive release requires the open own child.');
            await manage({ action: 'release_recursive', id: own().parent, timeoutSeconds: 300 });
          }
          if (step === 'delete-recursive')
            await manage({ action: 'delete', id: own().parent, recursive: true, removeLockedObjects: false });
        }
        result.completed.push(step);
        record({
          completedStep: step,
          requests: state.requests,
          historicalDeleted: result.confirmedDeleted,
          historicalReleased: result.confirmedReleased,
        });
      }
  } catch (error) {
    result.failure = true;
    record({
      stoppedAt: state.step ?? 'preflight',
      reason: error instanceof Error ? error.name : 'unknown',
      inspection: 'No retry or compensation; inspect every retained ID and raw receipt.',
    });
  }
  state.step = undefined;
  if (retainedPairReleased) {
    try {
      await retainedCtsV6Snapshot(http, options(), record);
      ready();
    } catch {
      result.failure = true;
      unexpected.add(retained!.parent);
      unexpected.add(retained!.task);
    }
  }
  await inspect(!!retained && preflight);
  try {
    ready();
    await inventory(!!retained && preflight);
    ready();
  } catch {
    result.failure = true;
  }
  ended = true;
  if (releaseProof) result.releaseWitnesses = releaseProof.witnesses();
  result.retainedReleasedHistory = [...result.confirmedReleased];
  result.remaining = Object.entries(result.current)
    .filter(([, state]) => !['absent', 'released'].includes(state))
    .map(([id]) => id);
  result.inspectionRequired = [
    ...new Set([
      ...result.remaining,
      ...unexpected,
      ...(result.unknownCreation ? [state.generatedParent ?? 'native-created-request-id-unconfirmed'] : []),
    ]),
  ];
  // A GET-only preflight intentionally retains the exactly re-proved empty pair. It is not deleted,
  // released, newly created, or a completed action. Failed/uncertain observations never get this exception.
  if (retained && preflight && retainedVerified && !result.failure)
    result.inspectionRequired = result.inspectionRequired.filter(
      (id) =>
        !(
          ([retained.parent, retained.task].includes(id) && result.current[id] === 'modifiable') ||
          (retainedClass && id === graph.classes[0].owner && result.current[id] === 'present')
        ),
    );
  if (
    result.inspectionRequired.length ||
    result.cleanupUnconfirmed ||
    (!preflight && JSON.stringify(result.completed) !== JSON.stringify(steps))
  )
    result.failure = true;
  return result;
}
