/** Two exact owned owners, shared native dispatch bounds and real production adapters. No catch cleanup. */
import type { AdtClient } from '../../../src/adt/client.js';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import {
  badiContainerXml,
  buildBadiImplementationXml,
  parseBadiImplementationDefinition,
} from '../../../src/adt/enhancement-impl.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import type { MutationCleanupState } from '../../../src/adt/mutation-context.js';
import {
  documentStableValue,
  pinnedDocumentSelection,
  readNativeDocument,
} from '../../../src/adt/pinned-document-owner.js';
import { patchPinnedEnhoDocument, resolvePinnedBadiDefinition } from '../../../src/adt/pinned-enho-document.js';
import { enhoSavedMatches } from "../../../src/adt/pinned-enho-document.js";
import { collectionsResponseCap } from './native-ddic-collections-transport.js';
import { ddicAbsence, ddicHash } from './native-ddic-evidence.js';
import { ddicBoundHttp, ddicUnlock } from './native-ddic-transport.js';
import { type DdicWorkflowInput, ddicConfig } from './native-ddic-workflow.js';
import { declarativeInventoryClean } from './native-declarative-evidence.js';
import { enhoAction } from './native-enho-actions.js';
import { enhoCapabilities, enhoDependencies } from './native-enho-dependencies.js';
import { type EnhoReceipt, enhoDocument, enhoSnapshot } from './native-enho-evidence.js';
import { ENHO_STAGES, type EnhoFixture, enhoFixtures } from './native-enho-fixtures.js';
import {
  ENHO_RETAINED_MODE,
  ENHO_RETAINED_STAGES,
  ENHO_RETAINED_SUFFIX,
  retainedEnhoFixtures,
} from './native-enho-retained-fixed.js';
import { readRetainedEnhoStart, retainedEnhoCounterpart } from './native-enho-retained-state.js';
import { checkEnhoRequest } from './native-enho-transport.js';
import { observeNativeHttp } from './native-observed-http.js';
import { packageAdapterEvidence, packageOwnerAbsent } from './native-package-evidence.js';

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export async function runNativeEnho(input: DdicWorkflowInput<EnhoFixture>, profile?: typeof ENHO_RETAINED_MODE) {
  const retained = profile === ENHO_RETAINED_MODE;
  if (profile !== undefined && !retained) throw new Error('Unknown enhancement profile.');
  const { base, fixtures: f, record, verify, shouldStop } = input;
  if (
    f.length !== 2 ||
    (retained && !equal(f, retainedEnhoFixtures(ENHO_RETAINED_SUFFIX))) ||
    !equal(f, enhoFixtures(f[0].name.slice(-12))) ||
    !base.safety.allowWrites ||
    !equal(base.safety.multiTargetWrite, ddicConfig().multiTargetWrite) ||
    !equal(base.safety.allowedPackages, ['$TMP'])
  )
    throw new Error('Fixed fresh enhancement graph and policy required.');
  const deadline = Math.min(input.freshUntil, Date.now() + 240000),
    signature = JSON.stringify(base.safety);
  const receipts = new Map<string, EnhoReceipt>(),
    touched = new Set<string>(),
    uncertain = new Set<string>(),
    createdAcks = new Set<string>(),
    sent = new Set<string>();
  const completed: string[] = [],
    confirmedDeleted: string[] = [],
    closures: (boolean | undefined)[] = [];
  let stage: string | undefined,
    selected: EnhoFixture | undefined,
    dependencyReceipt: string | undefined,
    createBody: string | undefined,
    putBody: string | undefined,
    putBaseline: string | undefined;
  let failure = false,
    mutationAttempted = false,
    mutationDispatched = false,
    cleanupUnconfirmed = false,
    opened = 0,
    finalAbsenceConfirmed = false;
  const assert = () => {
    verify();
    if (shouldStop() || JSON.stringify(base.safety) !== signature || Date.now() >= deadline)
      throw new Error('Enhancement source/policy/stop/deadline changed.');
  };
  const options = () => ({ deadline, noReplay: true, retryTransientErrors: false });
  const clone = (http: AdtHttpClient) =>
    Object.assign(Object.create(Object.getPrototypeOf(base)), base, { http }) as AdtClient;
  const absent = async (http: AdtHttpClient, item: EnhoFixture) => {
    try {
      await packageOwnerAbsent(http, item, record, options());
    } catch (e) {
      uncertain.add(item.owner);
      throw e;
    }
  };
  const snapshot = (c: AdtClient, item: EnhoFixture, updated: boolean, active: boolean) =>
    enhoSnapshot(c, f, item, updated, active, record, options());
  async function matches(c: AdtClient, item: EnhoFixture) {
    const before = receipts.get(item.owner);
    if (!before) throw new Error('Owned enhancement receipt missing.');
    const after = await snapshot(c, item, before.updated, before.active);
    if (!equal(before, after)) throw new Error('Owned enhancement receipt changed.');
    assert();
    return after;
  }
  async function dependencies(c: AdtClient) {
    const value = await enhoDependencies(c, record, options());
    if (value !== dependencyReceipt) throw new Error('Standard read-only enhancement dependency changed.');
    assert();
  }
  const oneShot = (method: string, path: string) =>
    ['POST', 'PUT', 'DELETE'].includes(method) &&
    !path.includes('_action=') &&
    !path.startsWith('/sap/bc/adt/cts/transportchecks');
  const sendKey = (method: string, path: string) => {
    const u = new URL(path, 'https://a4h.marianzeis.de');
    u.searchParams.delete('lockHandle');
    return `${stage}:${method}:${u.pathname.toLowerCase()}${u.search}`;
  };
  const sessions = (http: AdtHttpClient): AdtHttpClient =>
    new Proxy(http, {
      get(target, key) {
        if (key === 'withStatefulSession')
          return (
            fn: (s: AdtHttpClient) => Promise<unknown>,
            close: Parameters<AdtHttpClient['withStatefulSession']>[1],
          ) => {
            opened++;
            return target.withStatefulSession((s) => fn(sessions(s)), {
              timeoutMs: close?.timeoutMs ?? 30000,
              noReplay: true,
              responseBudget: close?.responseBudget ?? new DataResponseBudget(65536, 'enho-own-close', true),
              onClose: (value) => {
                closures.push(value);
                record({ ownSessionClosed: value ?? 'unknown', phase: stage });
                close?.onClose(value);
              },
            });
          };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  const observe = (v: unknown) => {
    const x = v as { stage?: string; method?: string; path?: string; status?: number; body?: unknown };
    if (x.stage === 'dispatch' && x.method && x.path && oneShot(x.method, x.path)) sent.add(sendKey(x.method, x.path));
    if (
      x.stage === 'response' &&
      x.method === 'POST' &&
      [200, 201].includes(x.status ?? 0) &&
      stage?.startsWith('create-') &&
      selected &&
      x.path?.split('?')[0].toLowerCase() === selected.owner.slice(0, selected.owner.lastIndexOf('/')).toLowerCase()
    )
      createdAcks.add(selected.owner);
    if (
      ['request', 'dispatch'].includes(x.stage ?? '') &&
      !['GET', 'HEAD'].includes(x.method ?? '') &&
      !x.path?.startsWith('/sap/bc/adt/cts/transportchecks') &&
      !x.path?.includes('_action=UNLOCK')
    ) {
      mutationAttempted = true;
      if (x.stage === 'dispatch') mutationDispatched = true;
      if (selected) touched.add(selected.owner);
    }
    const { body, ...safe } = x;
    record({ phase: stage ?? 'preflight', ...(x.path === '/sap/bc/adt/activation/inactiveobjects' ? safe : x) });
  };
  const observed = observeNativeHttp(
    ddicBoundHttp(sessions(base.http), {
      deadline,
      attemptLimit: 384,
      assert,
      unlock: (m, p) => ddicUnlock(selected, m, p),
    }),
    (m, p, b) => {
      if (
        retained &&
        (m === 'PUT' ||
          (stage !== undefined && !ENHO_RETAINED_STAGES.includes(stage as (typeof ENHO_RETAINED_STAGES)[number])))
      )
        throw new Error('No retained enhancement prefix replay.');
      checkEnhoRequest(f, stage, m, p, b, createBody, putBody);
      if (oneShot(m, p) && sent.has(sendKey(m, p))) throw new Error('Enhancement mutation already dispatched.');
      if (!ddicUnlock(selected, m, p)) assert();
    },
    observe,
    async (session, path) => {
      if (!selected || path.toLowerCase() !== selected.owner.toLowerCase() || stage !== `delete-${selected.type}`)
        throw new Error('No owned enhancement delete stage.');
      await matches(clone(session), selected);
      await dependencies(clone(session));
      if (retained && selected.type === 'ENHO') await matches(clone(session), f[0]);
      for (const child of f.filter((v) => v.dependencies.includes(selected!.owner))) await absent(session, child);
      assert();
    },
  );
  // Re-read the exact owned class/dependencies in the real child-write path, under the same outer budget.
  // For the dynamic document PUT, compile only from the fresh owned native bytes under its owning lock.
  const guarded = (http: AdtHttpClient): AdtHttpClient =>
    new Proxy(http, {
      get(target, key) {
        if (key === 'withStatefulSession')
          return (
            fn: (s: AdtHttpClient) => Promise<unknown>,
            close: Parameters<AdtHttpClient['withStatefulSession']>[1],
          ) => target.withStatefulSession((s) => fn(guarded(s)), close);
        const value = Reflect.get(target, key, target);
        if (key === 'post' || key === 'put')
          return async (...args: unknown[]) => {
            const path = String(args[0]);
            if (
              selected &&
              selected.type === 'ENHO' &&
              !path.includes('_action=') &&
              !path.startsWith('/sap/bc/adt/cts/transportchecks')
            ) {
              await matches(clone(target), f[0]);
              await dependencies(clone(target));
              if (retained && stage === 'reactivate-ENHO') {
                await matches(clone(target), selected);
                await retainedEnhoCounterpart(clone(target), f, record, options());
              }
              if (key === 'put') {
                if (!['create-ENHO', 'update-ENHO'].includes(stage ?? '')) throw new Error('No ENHO save stage.');
                const creating = stage === 'create-ENHO',
                  selection = pinnedDocumentSelection('ENHO', selected.name),
                  native = await readNativeDocument(clone(target), selection, undefined, options());
                enhoDocument(selected, f[0], native.xml, false, creating);
                if (
                  creating
                    ? !createdAcks.has(selected.owner) || !['new', 'inactive'].includes(native.version)
                    : native.hash !== receipts.get(selected.owner)?.hash
                )
                  throw new Error('Fresh owned document PUT baseline changed.');
                putBaseline = native.xml;
                putBody = await patchPinnedEnhoDocument(
                  clone(target),
                  native.xml,
                  selection,
                  parseBadiImplementationDefinition(String(creating ? selected.create.source : selected.update.source)),
                  creating ? selected.description : selected.update.description,
                );
                if (args[1] !== putBody) throw new Error('Unexpected owned ENHO PUT body.');
                record({ ownedPutBaseline: selected.owner, body: putBaseline, sha256: ddicHash(putBaseline) });
              }
              assert();
            }
            return Reflect.apply(value, target, args);
          };
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  const client = clone(collectionsResponseCap(guarded(observed), true));
  if (retained) for (const item of f) touched.add(item.owner);
  try {
    assert();
    await enhoCapabilities(client);
    dependencyReceipt = await enhoDependencies(client, record, options());
    record({ dependencySignature: dependencyReceipt });
    if (retained) {
      const adopted = await readRetainedEnhoStart(client, f, record, options());
      f.forEach((item, i) => receipts.set(item.owner, adopted[i]));
      await declarativeInventoryClean(client.http, [], record, options());
      record({
        retainedOwners: f.map((v) => v.owner),
        acknowledgedUpdateNotReplayed: true,
        inventoryScope: 'valid-unfiltered',
      });
    } else {
      await ddicAbsence(
        client,
        f,
        record,
        options(),
        (items) => items.forEach((v) => uncertain.add(v.owner)),
        () => f[0].name.slice(-12),
      );
    }
    assert();
    for (const next of retained ? ENHO_RETAINED_STAGES : ENHO_STAGES) {
      stage = next;
      selected = f.find((v) => stage!.endsWith(`-${v.type}`))!;
      createBody = putBody = putBaseline = undefined;
      assert();
      const before = next.startsWith('create-') ? undefined : await matches(client, selected),
        priorDispatches = sent.size,
        priorSessions = opened;
      if (selected.type === 'ENHO') await matches(client, f[0]);
      await dependencies(client);
      if (next === 'create-ENHO') {
        const definition = await resolvePinnedBadiDefinition(
          client,
          parseBadiImplementationDefinition(selected.create.source),
          selected.name,
        );
        createBody = badiContainerXml(
          buildBadiImplementationXml({
            name: selected.name,
            package: '$TMP',
            description: selected.description,
            masterLanguage: 'EN',
            responsibleAttr: '',
            definition,
          }),
        );
      }
      record({ stageStarted: next, owner: selected.owner, deadline: new Date(deadline).toISOString() });
      const cleanup: MutationCleanupState = { unlockFailed: false };
      const result = await enhoAction(client, selected, next, before, deadline, cleanup);
      const value = JSON.parse(result.content.map((v) => v.text).join('\n')) as {
        state?: string;
        phase?: string;
        success?: boolean;
        nativeStateVerified?: boolean;
        nativeMetadataVerified?: boolean;
        scope?: string;
        metadataHash?: string;
        sourceHash?: string;
        ok?: boolean;
      };
      record({ adapter: next, result: packageAdapterEvidence(result), cleanup });
      if (next.startsWith('delete-') && value.state === 'deleted') {
        await absent(client.http, selected);
        confirmedDeleted.push(selected.owner);
      }
      if (
        opened !== closures.length ||
        closures.some((v) => v !== true) ||
        cleanup.unlockFailed ||
        cleanup.unknownLocks?.length
      ) {
        cleanupUnconfirmed = true;
        throw new Error('Owned enhancement session cleanup unconfirmed.');
      }
      if (next === 'stale-ENHO') {
        if (
          !result.isError ||
          value.state !== 'unchanged' ||
          value.phase !== 'package-preflight' ||
          sent.size !== priorDispatches ||
          opened !== priorSessions
        )
          throw new Error('Expected stale ENHO refusal before mutation unconfirmed.');
        await matches(client, selected);
      } else {
        const creating = next.startsWith('create-'),
          deleting = next.startsWith('delete-'),
          activating = next.startsWith('activate-') || next.startsWith('reactivate-');
        const expected = activating
          ? 'activated'
          : deleting
            ? 'deleted'
            : creating
              ? selected.type === 'CLAS'
                ? 'saved-inactive'
                : 'created'
              : 'saved-inactive';
        if (
          result.isError ||
          value.state !== expected ||
          (activating &&
            (value.success !== true ||
              (selected.type === 'ENHO'
                ? value.nativeMetadataVerified !== true || value.scope !== 'selected-document-owner-only'
                : false)))
        )
          throw new Error('Native enhancement stage incomplete.');
        if (!activating && cleanup.sessionClosed !== true) {
          cleanupUnconfirmed = true;
          throw new Error('Required owner session did not close.');
        }
        if (creating && !createdAcks.has(selected.owner)) throw new Error('Native create acknowledgement missing.');
        if (!deleting) {
          const updated = next === 'update-ENHO' || next === 'reactivate-ENHO',
            after = await snapshot(client, selected, updated, activating);
          if (selected.type === 'CLAS') {
            if (creating ? after.sourceHash !== value.sourceHash : after.sourceHash !== before!.sourceHash)
              throw new Error('Owned class source hash changed.');
          } else if (activating) {
            if (documentStableValue(before!.xml!, pinnedDocumentSelection('ENHO', selected.name)) !== after.stable)
              throw new Error('Activation changed owned ENHO content.');
          } else {
            if (
              value.metadataHash !== after.hash ||
              !putBody ||
              !putBaseline ||
              !enhoSavedMatches(putBaseline, putBody, after.xml!, pinnedDocumentSelection('ENHO', selected.name))
            )
              throw new Error('Owned ENHO saved content/hash unconfirmed.');
            if (before?.active) {
              const active = await readNativeDocument(
                client,
                pinnedDocumentSelection('ENHO', selected.name),
                'active',
                options(),
              );
              enhoDocument(selected, f[0], active.xml, false);
              record({ activeCounterpart: selected.owner, body: active.xml, sha256: ddicHash(active.xml) });
              if (active.version !== 'active' || active.stable !== before.stable)
                throw new Error('ENHO draft changed the prior active counterpart.');
            }
          }
          receipts.set(selected.owner, after);
        }
      }
      assert();
      completed.push(next);
      record({ stageCompleted: next });
    }
    await ddicAbsence(
      client,
      f,
      record,
      options(),
      (items) => items.forEach((v) => uncertain.add(v.owner)),
      () => f[0].name.slice(-12),
    );
    await dependencies(client);
    assert();
    finalAbsenceConfirmed = true;
  } catch (error) {
    failure = true;
    cleanupUnconfirmed ||= opened !== closures.length || closures.some((v) => v !== true);
    record({
      failure: true,
      stoppedAt: stage ?? 'preflight',
      reason: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown enhancement failure',
      cleanupUnconfirmed,
    });
  }
  const remaining = [...new Set([...touched].filter((v) => !confirmedDeleted.includes(v)).concat([...uncertain]))];
  return {
    failure,
    stopped: shouldStop(),
    stoppedAt: failure ? (stage ?? 'preflight') : undefined,
    mutationAttempted,
    mutationDispatched,
    completed,
    created: [...createdAcks],
    confirmedDeleted,
    remaining,
    inspectionRequired: failure ? [...new Set([...remaining, ...(remaining.length ? [] : f.map((v) => v.owner))])] : [],
    cleanupUnconfirmed,
    finalAbsenceConfirmed: !failure && finalAbsenceConfirmed,
    ...(retained
      ? {
          retainedOwners: f.map((v) => v.owner),
          priorCompleted: ENHO_STAGES.slice(0, 5),
          priorAcknowledged: ['update-ENHO'],
        }
      : {}),
    authentication: 'Basic-native-contract-only',
  };
}
