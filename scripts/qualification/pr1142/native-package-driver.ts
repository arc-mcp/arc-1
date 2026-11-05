/** Fixed three-owner lifecycle; shared native writers and owning-lock deletion, no rollback or retry. */
import type { AdtClient } from '../../../src/adt/client.js';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import type { AdtHttpClient, AdtRequestOptions } from '../../../src/adt/http.js';
import { throwIfRequestCancelled } from '../../../src/adt/http-deadline.js';
import { mutationClient } from '../../../src/adt/mutation-client.js';
import { type MutationCleanupState, pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { deletePinnedOwner } from '../../../src/adt/pinned-delete.js';
import { createPinnedPackage, deletePinnedPackage } from '../../../src/adt/pinned-package.js';
import { createPinnedLocalRootProfile } from '../../../src/adt/pinned-package-root-profile.js';
import { RequestAttemptBudget } from '../../../src/adt/request-attempt-budget.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { preparePrivatePinnedBatchActivation } from '../../../src/handlers/write/pinned-activation.js';
import { handlePrivatePinnedBatchCreate } from '../../../src/handlers/write/pinned-batches.js';
import { createPinnedTextSourceContext } from '../../../src/handlers/write/pinned-source-input.js';
import { executePinnedSourceWrite } from '../../../src/handlers/write/pinned-source-write.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { declarativeInventoryClean } from './native-declarative-evidence.js';
import type { DeclarativeFixture } from './native-declarative-fixtures.js';
import { nativeRequestPolicy, observeNativeHttp } from './native-observed-http.js';
import { packageApiActions } from './native-package-api-actions.js';
import {
  PACKAGE_API_MOVED_COMPLETED,
  PACKAGE_API_MOVED_OBSERVED,
  PACKAGE_API_MOVED_PAIR,
  PACKAGE_API_MOVED_READS,
  PACKAGE_API_MOVED_STAGES,
} from './native-package-api-moved-fixed.js';
import {
  PACKAGE_API_STAGES,
  type PackageApiOwner,
  type PackageLifecycleStage,
  packageApiExtraStage,
  packageApiInterface,
  packageApiOwners,
  packageApiStageOwner,
  RECORDED_PACKAGE,
} from './native-package-api-profile.js';
import { inspectRetainedPackageApi } from './native-package-api-retained-evidence.js';
import {
  PACKAGE_API_RETAINED_COMPLETED,
  PACKAGE_API_RETAINED_GRAPH,
  PACKAGE_API_RETAINED_PAIR,
  PACKAGE_API_RETAINED_READS,
  PACKAGE_API_RETAINED_STAGES,
} from './native-package-api-retained-fixed.js';
import { checkPackageApiRequest, packageApiUnlock } from './native-package-api-transport.js';
import { packageDeleteDiagnostic } from './native-package-delete-diagnostic.js';
import {
  nativePackageNonempty,
  type OwnerReceipt,
  type PackageJournal,
  packageAbsence,
  packageAdapterEvidence,
  packageOwnerAbsent,
  packageSnapshot,
} from './native-package-evidence.js';
import {
  PACKAGE_STAGES,
  type PackageGraph,
  type PackageStage,
  packageOwners,
  stageOwner,
} from './native-package-fixtures.js';
import {
  packageRecoveryGraph,
  packageRecoveryReceipts,
  packageRecoveryStages,
} from './native-package-recovery-fixed.js';
import { checkPackageRequest, packageUnlock } from './native-package-transport.js';
export function packageConfig(graph: PackageGraph, recordedApi = false, retainedApi = false) {
  return {
    ...DEFAULT_CONFIG,
    client: '001',
    language: 'EN',
    systemType: 'onprem' as const,
    abapRelease: '758',
    allowWrites: true,
    targetId: 'A4H/001',
    allowedPackages: [graph.root.name, graph.child.name, ...(recordedApi ? [RECORDED_PACKAGE] : [])],
    allowedTransports: retainedApi ? [PACKAGE_API_RETAINED_PAIR.request] : ['*'],
    lintBeforeWrite: false,
    checkBeforeWrite: false,
    ...(recordedApi ? { multiTargetEndpoints: true, ppEnabled: true, ppStrict: true } : {}),
    multiTargetWrite: {
      target: 'A4H/001',
      enabled: true,
      allowedPackages: [graph.root.name, graph.child.name, ...(recordedApi ? [RECORDED_PACKAGE] : [])],
      allowedTransports: retainedApi ? [PACKAGE_API_RETAINED_PAIR.request] : ['*'],
      serverAllowedTransports: retainedApi ? [PACKAGE_API_RETAINED_PAIR.request] : ['*'],
    },
  };
}
export const packageSafety = (graph: PackageGraph, recordedApi = false, retainedApi = false) => ({
  ...defaultSafetyConfig(),
  ...packageConfig(graph, recordedApi, retainedApi),
});
function payload(result: { content: { type: string; text?: string }[] }) {
  return JSON.parse(
    result.content
      .filter((p) => p.type === 'text')
      .map((p) => p.text ?? '')
      .join('\n'),
  ) as Record<string, unknown>;
}
const environment = { cloud: false, abapRelease: '758' };
export interface PackageRunInput {
  base: AdtClient;
  graph: PackageGraph;
  freshUntil: number;
  record: PackageJournal;
  verify: () => void;
  shouldStop: () => boolean;
}
export async function runNativePackageContract(input: PackageRunInput) {
  return runPackageLifecycle(input);
}
export async function runNativePackageApi(input: PackageRunInput) {
  return runPackageLifecycle(input, undefined, true);
}
export async function runNativePackageApiRetainedTail(input: PackageRunInput) {
  if (JSON.stringify(input.graph) !== JSON.stringify(PACKAGE_API_RETAINED_GRAPH))
    throw new Error('Fixed retained graph required.');
  return runPackageLifecycle(input, undefined, true, true);
}
export async function runNativePackageApiMovedTail(input: PackageRunInput) {
  if (JSON.stringify(input.graph) !== JSON.stringify(PACKAGE_API_RETAINED_GRAPH))
    throw new Error('Fixed moved graph required.');
  return runPackageLifecycle(input, undefined, true, true, true);
}
export async function runNativePackageCleanup(input: PackageRunInput) {
  if (JSON.stringify(input.graph) !== JSON.stringify(packageRecoveryGraph))
    throw new Error('Fixed retained graph required.');
  return runPackageLifecycle(input, packageRecoveryReceipts);
}
async function runPackageLifecycle(
  { base, graph, freshUntil, record, verify, shouldStop }: PackageRunInput,
  retained?: Readonly<Record<string, OwnerReceipt>>,
  recordedApi = false,
  retainedApi = false,
  movedApi = false,
) {
  const owners = recordedApi ? packageApiOwners(graph) : packageOwners(graph);
  const selectedOwner = (stage: PackageLifecycleStage) =>
    recordedApi ? packageApiStageOwner(graph, stage) : stageOwner(graph, stage);
  const config = packageConfig(graph, recordedApi, retainedApi),
    signature = JSON.stringify(base.safety);
  if (
    JSON.stringify(base.safety.allowedPackages) !== JSON.stringify(config.allowedPackages) ||
    (retainedApi && JSON.stringify(base.safety.allowedTransports) !== JSON.stringify(config.allowedTransports)) ||
    JSON.stringify(base.safety.multiTargetWrite) !== JSON.stringify(config.multiTargetWrite) ||
    !base.safety.allowWrites ||
    (recordedApi && base.safety.allowTransportWrites)
  )
    throw new Error('Fixed package policies required.');
  const deadline = Math.min(freshUntil, Date.now() + 4 * 60_000),
    attempts = new RequestAttemptBudget(recordedApi ? 640 : 256),
    responses = new DataResponseBudget(2 * 1024 * 1024, 'native-local-packages', true);
  let stage: PackageLifecycleStage | undefined,
    ended = false,
    mutationAttempted = false,
    childPresent = !!retained || retainedApi;
  const receipts = new Map<string, OwnerReceipt>(),
    touched = new Set<string>(),
    uncertainOwners = new Set<string>(),
    created: string[] = retained || retainedApi ? owners.map((o) => o.owner) : [],
    deleted: string[] = [],
    reportedDeleted: string[] = [],
    completed: string[] = [],
    refusals: unknown[] = [];
  if (retained) for (const [owner, receipt] of Object.entries(retained)) receipts.set(owner, structuredClone(receipt));
  const stages = movedApi
    ? PACKAGE_API_MOVED_STAGES
    : retainedApi
      ? PACKAGE_API_RETAINED_STAGES
      : retained
        ? packageRecoveryStages
        : recordedApi
          ? PACKAGE_API_STAGES
          : PACKAGE_STAGES;
  const entered = new Set<string>();
  const sessionClosures: { stage: PackageLifecycleStage | undefined; closed: boolean }[] = [];
  let cleanup: MutationCleanupState | undefined;
  let batchOutcome: unknown;
  const refusal: { value: ReturnType<typeof nativePackageNonempty> } = { value: undefined };
  const observedRefusal = (): ReturnType<typeof nativePackageNonempty> => refusal.value;
  const assert = () => {
    verify();
    if (ended || shouldStop() || JSON.stringify(base.safety) !== signature)
      throw new Error('Package execution stopped or policy drifted.');
    throwIfRequestCancelled({ deadline });
  };
  const options = (): AdtRequestOptions => ({
    deadline,
    noReplay: true,
    retryTransientErrors: false,
    attemptBudget: attempts,
    responseBudget: responses,
  });
  const isUnlock = (selected: PackageLifecycleStage | undefined, method: string, path: string) =>
    recordedApi ? packageApiUnlock(graph, selected, method, path) : packageUnlock(graph, selected, method, path);
  const validate = (method: string, path: string, body?: string) => {
    if (
      retainedApi &&
      method === 'GET' &&
      (movedApi ? PACKAGE_API_MOVED_READS : PACKAGE_API_RETAINED_READS).some((r) => r.path === path)
    ) {
      assert();
      return;
    }
    if (recordedApi) checkPackageApiRequest(graph, stage, method, path, body, api?.scope());
    else checkPackageRequest(graph, stage as PackageStage | undefined, method, path, body);
    if (retainedApi && stage && !(stages as readonly string[]).includes(stage))
      throw new Error('Consumed prefix cannot replay.');
    if (retained && stage && !(packageRecoveryStages as readonly string[]).includes(stage))
      throw new Error('Cleanup stage scope.');
    if (!isUnlock(stage, method, path)) assert();
  };
  // The observer retains conservative intent; the boundary budget repeats proof after queue/auth/CSRF waits.
  const boundary = (http: AdtHttpClient): AdtHttpClient =>
    new Proxy(http, {
      get(target, key) {
        if (key === 'withStatefulSession')
          return (fn: (s: AdtHttpClient) => unknown, close: Parameters<AdtHttpClient['withStatefulSession']>[1]) => {
            const selectedStage = stage;
            return Reflect.apply(target.withStatefulSession, target, [
              (session: AdtHttpClient) => fn(boundary(session)),
              recordedApi && close
                ? {
                    ...close,
                    onClose: (closed: boolean) => {
                      close.onClose(closed);
                      sessionClosures.push({ stage: selectedStage, closed });
                      record({ owningSessionClose: { stage: selectedStage, closed } });
                    },
                  }
                : close,
            ]);
          };
        const value = Reflect.get(target, key, target);
        if (!['get', 'head', 'post', 'put', 'delete'].includes(String(key)))
          return typeof value === 'function' ? value.bind(target) : value;
        return async (...args: unknown[]) => {
          const method = String(key).toUpperCase(),
            path = args[0] as string,
            body = method === 'POST' || method === 'PUT' ? (args[1] as string | undefined) : undefined,
            index = method === 'POST' || method === 'PUT' ? 4 : 2;
          const requestKey = `${stage}:${method}:${path}`;
          if (
            method !== 'GET' &&
            method !== 'HEAD' &&
            !path.startsWith('/sap/bc/adt/cts/transportchecks') &&
            !path.startsWith('/sap/bc/adt/repository/nodestructure')
          ) {
            if (entered.has(requestKey)) throw new Error('Stage request replay refused.');
            entered.add(requestKey);
          }
          const selected = stage,
            unlock = isUnlock(selected, method, path),
            supplied = args[index] as AdtRequestOptions | undefined;
          const policy = nativeRequestPolicy({
            ...supplied,
            deadline: unlock
              ? Math.min(supplied?.deadline ?? Infinity, Date.now() + 30_000)
              : Math.min(supplied?.deadline ?? Infinity, deadline),
            responseBudget: unlock ? new DataResponseBudget(64 * 1024, 'package-unlock', true) : responses,
            attemptBudget: unlock ? new RequestAttemptBudget(4) : (supplied?.attemptBudget ?? attempts),
          });
          const allowance = policy.attemptBudget!;
          policy.attemptBudget = new Proxy(allowance, {
            get(b, k) {
              if (k === 'consume')
                return () => {
                  const used = attempts.used;
                  b.consume();
                  if (!unlock && attempts.used === used) attempts.consume();
                  if (stage !== selected) throw new Error('Package stage changed before dispatch.');
                  validate(method, path, body);
                  throwIfRequestCancelled(policy);
                };
              const v = Reflect.get(b, k);
              return typeof v === 'function' ? v.bind(b) : v;
            },
          });
          args[index] = policy;
          if (
            recordedApi &&
            stage === 'batch-create' &&
            (method === 'POST' || method === 'PUT') &&
            !unlock &&
            !path.startsWith('/sap/bc/adt/cts/transportchecks') &&
            !path.includes('_action=LOCK')
          ) {
            const proofClient = mutationClient(client, freshContext());
            await survived(proofClient);
            if (path.startsWith('/sap/bc/adt/activation?'))
              for (const owner of [packageApiInterface(graph), graph.clas]) await snapshot(proofClient, owner, false);
            assert();
          }
          if (
            recordedApi &&
            stage &&
            ((method === 'PUT' && path.startsWith('/sap/bc/adt/apireleases/')) ||
              (method === 'POST' && path.startsWith('/sap/bc/adt/refactorings')))
          ) {
            await survived(mutationClient(client, freshContext()));
            await api!.readTree(client);
            assert();
            record({ recordedGuardVerified: { stage, method, path } });
          }
          try {
            return await Reflect.apply(value, target, args);
          } catch (error) {
            if ((retained || recordedApi) && method === 'DELETE')
              record({
                nativeDeleteDiagnostic: packageDeleteDiagnostic(
                  error,
                  new URL(path, 'https://native.invalid').searchParams.get('lockHandle') ?? '',
                ),
                owner: path.split('?')[0],
              });
            if (method === 'DELETE' && selected?.startsWith('refuse-'))
              refusal.value = nativePackageNonempty(error, stageOwner(graph, selected));
            throw error;
          }
        };
      },
    });
  const observe = (row: unknown) => {
    const r = row as { stage?: string; method?: string; path?: string; body?: unknown };
    if (
      r.stage === 'request' &&
      r.method !== 'GET' &&
      r.method !== 'HEAD' &&
      !r.path?.startsWith('/sap/bc/adt/cts/transportchecks') &&
      !r.path?.startsWith('/sap/bc/adt/repository/nodestructure')
    ) {
      mutationAttempted = true;
      if (stage && stage !== 'create-request') {
        if (stage === 'batch-create') {
          for (const owner of [packageApiInterface(graph), graph.clas])
            if (
              r.path?.startsWith(owner.owner) ||
              r.path === owner.owner.slice(0, owner.owner.lastIndexOf('/')) ||
              r.path?.startsWith('/sap/bc/adt/activation?')
            )
              touched.add(owner.owner);
        } else touched.add(selectedOwner(stage).owner);
      }
    }
    const { body: inventoryBody, ...safe } = r;
    record({ phase: stage ?? 'preflight', ...(r.path === '/sap/bc/adt/activation/inactiveobjects' ? safe : r) });
  };
  const http = observeNativeHttp(boundary(base.http), validate, observe, async (session, path) => {
    if (!stage || path !== selectedOwner(stage).owner) throw new Error('Unexpected delete owner.');
    await survived(Object.assign(Object.create(Object.getPrototypeOf(base)), base, { http: session }));
    assert();
  });
  const client = Object.assign(Object.create(Object.getPrototypeOf(base)), base, { http }) as AdtClient;
  const api = recordedApi
    ? packageApiActions(
        client,
        graph,
        options,
        record,
        assert,
        movedApi ? PACKAGE_API_MOVED_PAIR : retainedApi ? PACKAGE_API_RETAINED_PAIR : undefined,
      )
    : undefined;
  const freshContext = (selected = client) => {
    cleanup = { unlockFailed: false };
    return pinnedMutationContext(selected.safety, options() as { deadline: number } & AdtRequestOptions, cleanup);
  };
  const activeClient = () => mutationClient(client, freshContext());
  const snapshot = (c: AdtClient, owner: PackageApiOwner, active = true) =>
    packageSnapshot(c, owner, graph, options(), record, active, childPresent, api?.moved ? 'recorded' : 'local');
  const matches = async (c: AdtClient, owner: PackageApiOwner) => {
    const current = await snapshot(c, owner);
    if (JSON.stringify(current) !== JSON.stringify(receipts.get(owner.owner))) throw new Error('Owned receipt drift.');
    assert();
    return current;
  };
  const survived = async (c: AdtClient) => {
    if (api)
      for (const owner of owners) {
        if (!deleted.includes(owner.owner)) continue;
        try {
          await packageOwnerAbsent(c.http, owner, record, options());
        } catch (error) {
          uncertainOwners.add(owner.owner);
          throw error;
        }
      }
    for (const owner of owners)
      if (created.includes(owner.owner) && !deleted.includes(owner.owner)) await matches(c, owner);
    assert();
  };
  const checkCleanup = () => {
    if (!cleanup || cleanup.unlockFailed || cleanup.unknownLocks?.length || cleanup.sessionClosed !== true)
      throw new Error('Owning cleanup unconfirmed.');
  };
  const refreshRoot = async (c: AdtClient) => {
    const current = await snapshot(c, graph.root),
      prior = receipts.get(graph.root.owner);
    if (!prior || current.metadataHash !== prior.metadataHash)
      throw new Error('Parent metadata drift across declared child transition.');
    receipts.set(graph.root.owner, current);
  };
  let failure = false,
    terminalBindingUnconfirmed = false,
    stoppedAt: string | undefined;
  try {
    assert();
    if (retainedApi) {
      const adopted = await inspectRetainedPackageApi(activeClient(), graph, options(), record, movedApi);
      for (const [owner, receipt] of Object.entries(adopted)) receipts.set(owner, receipt);
      await api!.adopt();
      await survived(activeClient());
    } else if (retained) {
      await survived(activeClient());
      await declarativeInventoryClean(
        activeClient().http,
        owners as unknown as readonly DeclarativeFixture[],
        record,
        options(),
      );
    } else {
      await packageAbsence(mutationClient(client, freshContext()).http, graph, record, options());
      if (api) await packageOwnerAbsent(activeClient().http, packageApiInterface(graph), record, options());
    }
    assert();
    for (const next of stages) {
      assert();
      stage = next;
      refusal.value = undefined;
      const selected = selectedOwner(next),
        selectedClient = api && !['create-request', 'create-root'].includes(next) ? api.scoped() : client,
        context = freshContext(selectedClient),
        scoped = mutationClient(selectedClient, context);
      record({ stageStarted: next, owner: selected.owner, deadline: new Date(deadline).toISOString() });
      if (api && next === 'batch-create') {
        await survived(scoped);
        const intf = packageApiInterface(graph);
        const result = await handlePrivatePinnedBatchCreate(
          selectedClient,
          {
            ...config,
            allowedTransports: selectedClient.safety.allowedTransports,
            multiTargetWrite: selectedClient.safety.multiTargetWrite,
          },
          {
            action: 'batch_create',
            activateAtEnd: true,
            objects: [
              {
                type: 'INTF',
                name: intf.name,
                package: graph.root.name,
                description: intf.description,
                source: intf.source,
              },
              {
                type: 'CLAS',
                name: graph.clas.name,
                package: graph.child.name,
                description: graph.clas.description,
                source: graph.clas.source,
              },
            ],
          },
          ['read', 'write'],
        );
        const value = payload(result) as {
          ok?: boolean;
          objects?: {
            name?: string;
            create?: { status?: string; result?: { sourceHash?: string } };
            activation?: { status?: string };
          }[];
        };
        batchOutcome = value;
        record({ adapter: 'batch-create', result: value });
        const batchOwners = [intf, graph.clas];
        for (const [i, owner] of batchOwners.entries())
          if (value.objects?.[i]?.name === owner.name && value.objects[i].create?.status === 'confirmed')
            created.push(owner.owner);
        if (
          result.isError ||
          value.ok !== true ||
          value.objects?.length !== 2 ||
          value.objects.some(
            (v, i) =>
              v.name !== batchOwners[i].name ||
              v.create?.status !== 'confirmed' ||
              v.activation?.status !== 'confirmed',
          )
        )
          throw new Error('Batch creation/activation incomplete.');
        if (sessionClosures.filter((v) => v.stage === 'batch-create' && v.closed).length !== 2)
          throw new Error('Both batch owning session closures are required.');
        for (const [i, owner] of batchOwners.entries()) {
          const receipt = await snapshot(scoped, owner);
          if (receipt.sourceHash !== value.objects[i].create?.result?.sourceHash)
            throw new Error('Batch stored source hash differs.');
          receipts.set(owner.owner, receipt);
        }
      } else if (api && packageApiExtraStage(next)) {
        await survived(scoped);
        const priorSource = receipts.get(graph.clas.owner)?.sourceHash;
        await api.run(next, selectedClient, context);
        if (next !== 'create-request') {
          const current = await snapshot(scoped, graph.clas);
          if (current.sourceHash !== priorSource) throw new Error('Class source changed across recorded operation.');
          receipts.set(graph.clas.owner, current);
        }
      } else if (next === 'create-root' || next === 'create-child') {
        if (next === 'create-child') await matches(scoped, graph.root);
        const root =
          next === 'create-root'
            ? createPinnedLocalRootProfile(
                selectedClient,
                context,
                selected.name,
                { systemType: 'onprem', abapRelease: '758' },
                assert,
              )
            : undefined;
        const result = await createPinnedPackage(
          selectedClient,
          context,
          {
            name: selected.name,
            description: selected.description,
            responsible: 'MARIAN',
            softwareComponent: 'LOCAL',
            packageType: 'development',
            recordChanges: false,
            ...(selected.parent ? { superPackage: selected.parent } : {}),
          },
          environment,
          root,
        );
        record({ adapter: 'create-package', result: packageAdapterEvidence(result) });
        if (!result.ok || result.state !== 'created') throw new Error('Package create unconfirmed.');
        created.push(selected.owner);
        if (next === 'create-child') childPresent = true;
        receipts.set(selected.owner, await snapshot(scoped, selected));
        if (next === 'create-child') await refreshRoot(scoped);
      } else if (next === 'create-class') {
        await survived(scoped);
        const result = await executePinnedSourceWrite(
          createPinnedTextSourceContext(
            selectedClient,
            {
              action: 'create',
              type: 'CLAS',
              name: selected.name,
              package: graph.child.name,
              description: selected.description,
              source: graph.clas.source,
            },
            config,
            context,
          ),
        );
        record({ adapter: 'create-class', result: packageAdapterEvidence(result), cleanup });
        const value = payload(result);
        if (result.isError || value.state !== 'saved-inactive') throw new Error('Class save unconfirmed.');
        created.push(selected.owner);
        checkCleanup();
        const receipt = await snapshot(scoped, selected, false);
        if (value.sourceHash !== receipt.sourceHash) throw new Error('Class save hash mismatch.');
        receipts.set(selected.owner, receipt);
      } else if (next === 'activate-class') {
        const prior = await snapshot(scoped, selected, false);
        if (JSON.stringify(prior) !== JSON.stringify(receipts.get(selected.owner)))
          throw new Error('Class preactivation drift.');
        const prepared = await preparePrivatePinnedBatchActivation(
          selectedClient,
          { type: 'CLAS', name: selected.name },
          false,
          context,
        );
        if (!('execute' in prepared)) throw new Error('Class activation refused before submission.');
        const result = await prepared.execute();
        record({ adapter: 'activate-class', result: packageAdapterEvidence(result) });
        if (result.isError || payload(result).success !== true) throw new Error('Class activation unconfirmed.');
        const receipt = await snapshot(scoped, selected);
        if (receipt.sourceHash !== prior.sourceHash) throw new Error('Class activation source changed.');
        receipts.set(selected.owner, receipt);
      } else {
        await survived(scoped);
        let result: Awaited<ReturnType<typeof deletePinnedOwner>>;
        if (next.startsWith('refuse-') || next === 'delete-class' || next === 'delete-interface') {
          // Fixed owned-graph negative experiment replaces only the optional positive browser shortcut.
          // The same shared owner/recording/lock/delete/typed-absence/cleanup lifecycle remains in force.
          result = await deletePinnedOwner(
            selectedClient,
            context,
            {
              ...(api?.moved && selected.kind === 'class' ? { transport: api.ids().request } : {}),
              type: selected.kind === 'interface' ? 'INTF' : selected.kind === 'class' ? 'CLAS' : 'DEVC',
              name: selected.name,
            },
            {
              owner: selected.owner,
              packageFor: async (c) => {
                await matches(c, selected);
                return selected.kind === 'interface'
                  ? graph.root.name
                  : selected.kind === 'class'
                    ? api?.moved
                      ? RECORDED_PACKAGE
                      : graph.child.name
                    : selected.name;
              },
              precondition: async (c) => {
                await survived(c);
                if (api?.moved && selected.kind === 'class') await api.beforeDelete(c);
              },
              validateRecording: (r) => {
                if (api?.moved && selected.kind === 'class') {
                  if (r.local || r.request !== api.ids().request)
                    throw new Error('Exact native recorded request required.');
                } else if (!r.local || r.request !== undefined) throw new Error('Native local recording required.');
              },
            },
          );
        } else result = await deletePinnedPackage(selectedClient, context, { name: selected.name }, environment);
        record({ adapter: next, result: packageAdapterEvidence(result), cleanup, nativeRefusal: refusal.value });
        if (next.startsWith('refuse-')) {
          const expected = observedRefusal();
          if (result.ok || result.phase !== 'delete' || !expected || result.statusCode !== expected.status)
            throw new Error('Native nonempty refusal unconfirmed.');
          checkCleanup();
          await survived(scoped);
          refusals.push({ stage: next, owner: selected.owner, ...expected });
        } else {
          if (result.state === 'deleted') reportedDeleted.push(selected.owner);
          if (!result.ok || result.state !== 'deleted') throw new Error('Native deletion unconfirmed.');
          checkCleanup();
          await packageOwnerAbsent(scoped.http, selected, record, options());
          deleted.push(selected.owner);
          receipts.delete(selected.owner);
          if (next === 'delete-child') {
            childPresent = false;
            await refreshRoot(scoped);
          }
          await survived(scoped);
        }
      }
      assert();
      completed.push(next);
      record({
        stageComplete: next,
        ...(retained || retainedApi ? { retainedFromOriginal: [...created] } : { created: [...created] }),
        confirmedDeleted: [...deleted],
      });
    }
    if (api) await survived(activeClient());
    await packageAbsence(activeClient().http, graph, record, options(), (owner) => uncertainOwners.add(owner));
    if (api) await api.terminal(client);
    assert();
  } catch {
    failure = true;
    stoppedAt = stage ?? 'preflight';
    record({ stoppedAt, reason: 'package-stage-unconfirmed', nativeRefusal: refusal.value, cleanup });
  }
  try {
    verify();
    if (JSON.stringify(base.safety) !== signature) throw new Error();
  } catch {
    failure = true;
    terminalBindingUnconfirmed = true;
    if (recordedApi) stoppedAt ??= 'terminal-binding';
    else stoppedAt = 'terminal-binding';
  }
  ended = true;
  const remaining = [...new Set([...created, ...touched, ...uncertainOwners])].filter(
    (o) => !deleted.includes(o) || uncertainOwners.has(o),
  );
  const result = {
    failure,
    mutationAttempted,
    completed,
    created: retained || retainedApi ? [] : created,
    ...(retained || retainedApi ? { retainedFromOriginal: [...created] } : {}),
    ...(retainedApi
      ? {
          previouslyCompleted: [...(movedApi ? PACKAGE_API_MOVED_COMPLETED : PACKAGE_API_RETAINED_COMPLETED)],
          ...(movedApi ? { observedRetainedWrites: [...PACKAGE_API_MOVED_OBSERVED] } : {}),
        }
      : {}),
    confirmedDeleted: deleted,
    adapterReportedDeleted: reportedDeleted,
    expectedRefusals: refusals,
    ...(api
      ? {
          retainedBookkeeping: api.evidence(),
          terminalBindingUnconfirmed,
          owningSessionClosures: sessionClosures,
          batchOutcome,
        }
      : {}),
    remaining,
    inspectionRequired: failure ? (remaining.length ? remaining : owners.map((o) => o.owner)) : [],
    cleanupUnconfirmed:
      sessionClosures.some((v) => !v.closed) ||
      (!!cleanup && (cleanup.unlockFailed || !!cleanup.unknownLocks?.length || cleanup.sessionClosed === false)),
    finalAbsenceConfirmed: !failure,
    stopped: shouldStop(),
    ...(stoppedAt ? { stoppedAt } : {}),
  };
  record({ result });
  return result;
}
