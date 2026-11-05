/** Shared fixed DDIC stage engine; only compiled wrappers supply profiles. No catch cleanup. */
import type { AdtClient } from '../../../src/adt/client.js';
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import { type MutationCleanupState, pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import type { FieldMatcher } from '../../../src/adt/pinned-metadata-projection.js';
import {
  assertOnlyRequestedChanges,
  assertSavedFields,
  derivedMetadataFields,
} from '../../../src/adt/pinned-metadata-projection.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { preparePrivatePinnedBatchActivation } from '../../../src/handlers/write/pinned-activation.js';
import { createPinnedDdicContext } from '../../../src/handlers/write/pinned-ddic-context.js';
import { executePinnedSourceWrite } from '../../../src/handlers/write/pinned-source-write.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

import { ddicBoundHttp } from './native-ddic-transport.js';
import { observeNativeHttp } from './native-observed-http.js';
import { packageAdapterEvidence, packageOwnerAbsent } from './native-package-evidence.js';
export const ddicConfig = () => ({
  ...DEFAULT_CONFIG,
  client: '001',
  language: 'EN',
  systemType: 'onprem' as const,
  abapRelease: '758',
  allowWrites: true,
  targetId: 'A4H/001',
  allowedPackages: ['$TMP'],
  allowedTransports: [],
  lintBeforeWrite: false,
  checkBeforeWrite: false,
  multiTargetWrite: {
    target: 'A4H/001',
    enabled: true,
    allowedPackages: ['$TMP'],
    allowedTransports: [],
    serverAllowedTransports: [],
  },
});
export const ddicSafety = () => ({ ...defaultSafetyConfig(), ...ddicConfig() });
const payload = (result: { content: { text: string }[] }) =>
  JSON.parse(result.content[0].text) as Record<string, unknown>;
export interface DdicWorkflowFixture {
  type: string;
  name: string;
  owner: string;
  packageName: string;
  description: string;
  dependencies: readonly string[];
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}
export interface DdicWorkflowReceipt {
  hash: string;
  fields: ReadonlyMap<string, string>;
  canonicalHashes: string[];
  updated: boolean;
  active: boolean;
  sourceHash?: string;
  metadataXml?: string;
}
export interface DdicWorkflowInput<F extends DdicWorkflowFixture> {
  base: AdtClient;
  fixtures: readonly F[];
  freshUntil: number;
  record: (v: unknown) => void;
  verify: () => void;
  shouldStop: () => boolean;
}
export interface DdicWorkflowProfile<F extends DdicWorkflowFixture> {
  stages: readonly string[];
  /** Only a compiled retained profile may start with externally bound receipts. */
  retained?: boolean | readonly string[];
  /** Compiled retained profiles bind their initial state; callers cannot supply resume positions. */
  initialState?: (fixture: F) => { updated: boolean; active: boolean };
  /** Only a compiled native contract may require immediate-active metadata saves. */
  metadataActive?: (fixture: F) => boolean;
  attemptLimit?: 256 | 384 | 640;
  prepare?: (client: AdtClient) => Promise<void>;
  /** Compiled cleanup/continuation profiles alone may adopt externally bound existing owners. */
  /** Compiled table graph only: settings exist and disappear with their exact parent. */
  implicitParent?: (fixture: F) => string | undefined;
  /** Re-prove owned dependencies at each actual child-write/activation boundary. */
  guardDependencies?: boolean;
  /** Compiled retained graphs can also protect an already owned implicit child before parent activation. */
  guardOwned?: (fixture: F, stage: string | undefined) => readonly string[];
  /** Compiled retained settings tail only: prove the exact parent's owned activation coupling. */
  refreshImplicitParent?: (
    client: AdtClient,
    child: F,
    parent: F,
    prior: DdicWorkflowReceipt,
    record: (v: unknown) => void,
    options: AdtRequestOptions,
  ) => Promise<DdicWorkflowReceipt>;
  wrapHttp?: (http: AdtClient['http']) => AdtClient['http'];
  check: (
    fixtures: readonly F[],
    selected: F | undefined,
    stage: string | undefined,
    method: string,
    path: string,
    body?: string,
  ) => void;
  unlock: (selected: F | undefined, method: string, path: string) => boolean;
  snapshot: (
    client: AdtClient,
    fixture: F,
    updated: boolean,
    active: boolean,
    record: (v: unknown) => void,
    options: AdtRequestOptions,
  ) => Promise<DdicWorkflowReceipt>;
  absence: (
    client: AdtClient,
    fixtures: readonly F[],
    record: (v: unknown) => void,
    options: AdtRequestOptions,
    uncertain: (fixtures: readonly F[]) => void,
  ) => Promise<void>;
  source: (fixture: F) => boolean;
  postCreateCleanup: (fixture: F) => boolean;
  changedPaths: (fixture: F) => readonly FieldMatcher[];
  verifyUpdated?: (fixture: F, before: DdicWorkflowReceipt, after: DdicWorkflowReceipt) => void;
}
export async function runFixedDdicWorkflow<F extends DdicWorkflowFixture>(
  { base, fixtures, freshUntil, record, verify, shouldStop }: DdicWorkflowInput<F>,
  profile: DdicWorkflowProfile<F>,
) {
  const config = ddicConfig(),
    signature = JSON.stringify(base.safety);
  if (
    !base.safety.allowWrites ||
    JSON.stringify(base.safety.multiTargetWrite) !== JSON.stringify(config.multiTargetWrite) ||
    JSON.stringify(base.safety.allowedPackages) !== JSON.stringify(config.allowedPackages)
  )
    throw new Error('Fixed DDIC client policy required.');
  const retainedFixtures =
    profile.retained === true
      ? fixtures
      : fixtures.filter((f) => Array.isArray(profile.retained) && profile.retained.includes(f.owner));
  if (Array.isArray(profile.retained) && retainedFixtures.length !== profile.retained.length)
    throw new Error('Exact retained owner subset required.');
  const deadline = Math.min(freshUntil, Date.now() + 4 * 60000),
    completed: string[] = [],
    created: string[] = [],
    deleted: string[] = [],
    adopted: string[] = [],
    removedWithParent: string[] = [],
    touched = new Set<string>(retainedFixtures.map((f) => f.owner)),
    unconfirmedAbsences = new Set<string>();
  const receipts = new Map<string, DdicWorkflowReceipt>();
  let stage: string | undefined, selected: F | undefined, cleanup: MutationCleanupState | undefined;
  let failure = false,
    stoppedAt: string | undefined,
    cleanupUnconfirmed = false,
    mutationAttempted = false,
    mutationDispatched = false;
  const assert = () => {
    verify();
    if (shouldStop() || JSON.stringify(base.safety) !== signature || Date.now() >= deadline)
      throw new Error('DDIC source/policy/stop/deadline check failed.');
  };
  const validate = (method: string, path: string, body?: string) => {
    profile.check(fixtures, selected, stage, method, path, body);
    if (!profile.unlock(selected, method, path)) assert();
  };
  const observe = (v: unknown) => {
    const row = v as { stage?: string; method?: string; path?: string; body?: unknown };
    if (
      ['request', 'dispatch'].includes(row.stage ?? '') &&
      !['GET', 'HEAD'].includes(row.method ?? '') &&
      !row.path?.startsWith('/sap/bc/adt/cts/transportchecks')
    ) {
      mutationAttempted = true;
      if (row.stage === 'dispatch') mutationDispatched = true;
      if (selected) {
        touched.add(selected.owner);
        for (const child of fixtures.filter((f) => profile.implicitParent?.(f) === selected!.owner))
          touched.add(child.owner);
      }
    }
    const { body, ...safe } = row;
    record({ phase: stage ?? 'preflight', ...(row.path === '/sap/bc/adt/activation/inactiveobjects' ? safe : row) });
  };
  const options = () => ({ deadline, noReplay: true, retryTransientErrors: false });
  // Confirmed deletion is history; a later failed absence proof is current inspection evidence.
  const absenceUnconfirmed = (owners: readonly F[]) => {
    for (const fixture of owners) unconfirmedAbsences.add(fixture.owner);
  };
  const requireAbsent = async (http: AdtClient['http'], fixture: F) => {
    try {
      await packageOwnerAbsent(http, fixture, record, options());
    } catch (error) {
      absenceUnconfirmed([fixture]);
      throw error;
    }
  };
  const copy = (http: AdtClient['http']) =>
    Object.assign(Object.create(Object.getPrototypeOf(base)), base, { http }) as AdtClient;
  const http = observeNativeHttp(
    ddicBoundHttp(base.http, {
      deadline,
      assert,
      attemptLimit: profile.attemptLimit,
      unlock: (m, p) => profile.unlock(selected, m, p),
    }),
    validate,
    observe,
    async (session, path) => {
      if (!selected || path !== selected.owner || stage !== `delete-${selected.type}`)
        throw new Error('Unexpected DDIC deletion.');
      await matches(copy(session), selected);
      if (profile.guardDependencies)
        for (const parent of fixtures.filter(
          (f) => selected!.dependencies.includes(f.owner) || profile.guardOwned?.(selected!, stage).includes(f.owner),
        ))
          await matches(copy(session), parent);
      for (const child of fixtures.filter(
        (f) => f.dependencies.includes(selected!.owner) && !profile.implicitParent?.(f),
      ))
        await requireAbsent(session, child);
      assert();
    },
  );
  const parentGuard = (baseHttp: AdtClient['http']): AdtClient['http'] =>
    new Proxy(baseHttp, {
      get(target, key) {
        if (key === 'withStatefulSession')
          return (run: (session: AdtClient['http']) => unknown, close: unknown) =>
            Reflect.apply(target.withStatefulSession, target, [
              (session: AdtClient['http']) => run(parentGuard(session)),
              close,
            ]);
        if ((key === 'post' || key === 'put') && profile.guardDependencies)
          return async (...args: unknown[]) => {
            const path = String(args[0]);
            if (
              selected &&
              !path.includes('_action=') &&
              !path.startsWith('/sap/bc/adt/cts/transportchecks') &&
              !path.startsWith('/sap/bc/adt/deletion/check')
            ) {
              for (const parent of fixtures.filter(
                (f) =>
                  selected!.dependencies.includes(f.owner) || profile.guardOwned?.(selected!, stage).includes(f.owner),
              ))
                await matches(copy(target), parent);
              assert();
            }
            return Reflect.apply(Reflect.get(target, key), target, args);
          };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  const client = copy(parentGuard(profile.wrapHttp?.(http) ?? http));
  const snapshot = (c: AdtClient, f: F, updated: boolean, active: boolean) =>
    profile.snapshot(c, f, updated, active, record, options());
  async function matches(c: AdtClient, f: F) {
    const prior = receipts.get(f.owner);
    if (!prior) throw new Error('Missing owned DDIC receipt.');
    const now = await snapshot(c, f, prior.updated, prior.active);
    if (
      now.hash !== prior.hash ||
      now.sourceHash !== prior.sourceHash ||
      JSON.stringify(now.canonicalHashes) !== JSON.stringify(prior.canonicalHashes)
    )
      throw new Error('Owned DDIC receipt drift.');
    assert();
    return prior;
  }
  function ownCleanup() {
    if (!cleanup || cleanup.unlockFailed || cleanup.unknownLocks?.length || cleanup.sessionClosed !== true) {
      cleanupUnconfirmed = true;
      throw new Error('DDIC own-session cleanup unconfirmed.');
    }
  }
  try {
    assert();
    await profile.prepare?.(client);
    assert();
    if (profile.retained) {
      for (const fixture of retainedFixtures) {
        const initial = profile.initialState?.(fixture) ?? { updated: false, active: false };
        receipts.set(fixture.owner, await snapshot(client, fixture, initial.updated, initial.active));
      }
      const uncreated = fixtures.filter((f) => !retainedFixtures.includes(f));
      if (uncreated.length) await profile.absence(client, uncreated, record, options(), absenceUnconfirmed);
    } else await profile.absence(client, fixtures, record, options(), absenceUnconfirmed);
    assert();
    for (const next of profile.stages) {
      assert();
      stage = next;
      selected = fixtures.find((f) => next.endsWith(`-${f.type}`))!;
      const action = next.split('-')[0];
      cleanup = { unlockFailed: false };
      const context = pinnedMutationContext(client.safety, options(), cleanup);
      record({ stageStarted: next, owner: selected.owner, deadline: new Date(deadline).toISOString() });
      if (action === 'adopt') {
        const parent = fixtures.find((f) => f.owner === profile.implicitParent?.(selected!));
        if (!parent || !selected.dependencies.includes(parent.owner)) throw new Error('Unqualified implicit owner.');
        await matches(client, parent);
        const current = await snapshot(client, selected, false, true);
        receipts.set(selected.owner, current);
        adopted.push(selected.owner);
        touched.add(selected.owner);
        record({ implicitResourceObserved: selected.owner, parent: parent.owner });
      } else if (action === 'create') {
        for (const parent of fixtures.filter((f) => selected!.dependencies.includes(f.owner)))
          await matches(client, parent);
        const result = await executePinnedSourceWrite(
          await createPinnedDdicContext(
            client,
            {
              action: 'create',
              type: selected.type,
              name: selected.name,
              package: '$TMP',
              description: selected.description,
              ...selected.create,
            },
            config,
            context,
          ),
        );
        record({ adapter: next, result: packageAdapterEvidence(result), cleanup });
        const value = payload(result);
        if (
          result.isError ||
          value.state !==
            (profile.source(selected)
              ? 'saved-inactive'
              : profile.metadataActive?.(selected)
                ? 'created-active'
                : 'created')
        )
          throw new Error('DDIC create not confirmed.');
        created.push(selected.owner);
        if (profile.postCreateCleanup(selected)) ownCleanup();
        const current = await snapshot(client, selected, false, profile.metadataActive?.(selected) === true);
        if (profile.source(selected) ? value.sourceHash !== current.sourceHash : value.metadataHash !== current.hash)
          throw new Error('Create hash mismatch.');
        receipts.set(selected.owner, current);
      } else if (action === 'activate' || action === 'reactivate') {
        const prior = await matches(client, selected);
        const prepared = await preparePrivatePinnedBatchActivation(
          client,
          { type: selected.type, name: selected.name },
          false,
          context,
        );
        if (!('execute' in prepared)) throw new Error('DDIC activation admission refused.');
        const result = await prepared.execute();
        record({ adapter: next, result: packageAdapterEvidence(result) });
        if (result.isError || payload(result).success !== true || payload(result).nativeStateVerified !== true)
          throw new Error('DDIC activation unconfirmed.');
        const current = await snapshot(client, selected, prior.updated, true);
        if (profile.source(selected)) {
          if (prior.sourceHash !== current.sourceHash) throw new Error('Activated source changed.');
        } else
          assertSavedFields(prior.fields, current.fields, derivedMetadataFields(selected.type, prior.fields), true);
        receipts.set(selected.owner, current);
        if (profile.refreshImplicitParent) {
          const parent = fixtures.find((f) => f.owner === profile.implicitParent?.(selected!));
          if (parent) {
            const before = receipts.get(parent.owner);
            if (!before || !selected.dependencies.includes(parent.owner))
              throw new Error('Missing owned implicit activation parent.');
            const refreshed = await profile.refreshImplicitParent(client, selected, parent, before, record, options());
            assert();
            receipts.set(parent.owner, refreshed);
            record({ implicitActivationParentRefreshed: parent.owner, child: selected.owner });
          }
        }
      } else if (action === 'stale' || action === 'update') {
        const prior = await matches(client, selected);
        const stale = action === 'stale';
        const beforeHash = profile.source(selected) ? prior.sourceHash! : prior.hash;
        const wrong = (beforeHash[0] === '0' ? '1' : '0') + beforeHash.slice(1);
        const result = await executePinnedSourceWrite(
          await createPinnedDdicContext(
            client,
            {
              action: 'update',
              type: selected.type,
              name: selected.name,
              ...selected.update,
              ...(profile.source(selected)
                ? { expectedSourceHash: stale ? wrong : beforeHash }
                : { expectedMetadataHash: stale ? wrong : beforeHash }),
            },
            config,
            context,
          ),
        );
        const value = payload(result);
        record({ adapter: next, result: packageAdapterEvidence(result), cleanup });
        ownCleanup();
        if (stale) {
          if (
            !result.isError ||
            value.state !== 'unchanged' ||
            value.phase !== (profile.source(selected) ? 'source-read' : 'metadata-read')
          )
            throw new Error('Expected stale refusal not confirmed.');
          await matches(client, selected);
        } else {
          const active = profile.metadataActive?.(selected) === true;
          if (result.isError || value.state !== (active ? 'saved-active' : 'saved-inactive'))
            throw new Error('DDIC update unconfirmed.');
          const current = await snapshot(client, selected, true, active);
          if (profile.source(selected)) {
            if (value.sourceHash !== current.sourceHash) throw new Error('Update source hash mismatch.');
          } else {
            if (value.metadataHash !== current.hash) throw new Error('Update hash mismatch.');
            if (profile.verifyUpdated) profile.verifyUpdated(selected, prior, current);
            else assertOnlyRequestedChanges(prior.fields, current.fields, profile.changedPaths(selected));
          }
          receipts.set(selected.owner, current);
        }
      } else if (action === 'delete') {
        if (profile.implicitParent?.(selected)) throw new Error('No independent implicit-resource DELETE.');
        await matches(client, selected);
        const result = await executePinnedSourceWrite(
          await createPinnedDdicContext(
            client,
            { action: 'delete', type: selected.type, name: selected.name },
            config,
            context,
          ),
        );
        record({ adapter: next, result: packageAdapterEvidence(result), cleanup });
        if (payload(result).state !== 'deleted') throw new Error('DDIC deletion unconfirmed.');
        await requireAbsent(client.http, selected);
        deleted.push(selected.owner);
        ownCleanup();
        if (result.isError) throw new Error('Deleted with adapter failure.');
        for (const child of fixtures.filter((f) => profile.implicitParent?.(f) === selected!.owner)) {
          await requireAbsent(client.http, child);
          removedWithParent.push(child.owner);
          record({ implicitResourceAbsenceConfirmed: child.owner, parent: selected.owner });
        }
      } else throw new Error('Unknown fixed DDIC stage.');
      assert();
      completed.push(next);
      record({ stageCompleted: next });
    }
    await profile.absence(client, fixtures, record, options(), absenceUnconfirmed);
    assert();
  } catch {
    failure = true;
    stoppedAt = stage ?? 'preflight';
    if (cleanup?.unlockFailed || cleanup?.unknownLocks?.length || cleanup?.sessionClosed === false)
      cleanupUnconfirmed = true;
    record({ failure: true, stoppedAt, cleanupUnconfirmed });
  }
  const remaining = [
    ...new Set(
      [...touched]
        .filter((o) => !deleted.includes(o) && !removedWithParent.includes(o))
        .concat([...unconfirmedAbsences]),
    ),
  ];
  return {
    failure,
    stopped: shouldStop(),
    stoppedAt,
    mutationAttempted,
    mutationDispatched,
    completed,
    created,
    ...(Array.isArray(profile.retained) ? { retainedOwners: retainedFixtures.map((f) => f.owner) } : {}),
    confirmedDeleted: deleted,
    ...(profile.implicitParent ? { adopted, removedWithParent } : {}),
    remaining,
    inspectionRequired: failure
      ? [
          ...new Set([
            ...remaining,
            ...(cleanupUnconfirmed && selected ? [selected.owner] : []),
            ...(remaining.length ? [] : fixtures.map((f) => f.owner)),
          ]),
        ]
      : [],
    cleanupUnconfirmed,
    finalAbsenceConfirmed: !failure && deleted.length + removedWithParent.length === fixtures.length,
  };
}
