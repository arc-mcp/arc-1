/** Real shared factories/lifecycle; no execution, generated child mutation, repair, rollback or replay. */
import type { AdtClient } from '../../../src/adt/client.js';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import { parseFmSignature, spliceFmSignature } from '../../../src/adt/fm-signature.js';
import { prepareFunctionSourceVerification } from "../../../src/adt/source-precondition.js";
import type { AdtHttpClient, AdtRequestOptions } from '../../../src/adt/http.js';
import { throwIfRequestCancelled } from '../../../src/adt/http-deadline.js';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { RequestAttemptBudget } from '../../../src/adt/request-attempt-budget.js';
import { editableSourceEquals, sourceHash } from '../../../src/adt/source-precondition.js';
import { textPartMatchesRequest } from '../../../src/adt/text-part-changes.js';
import { insertUnit, spliceUnit } from '../../../src/context/unit-surgery.js';
import { handlePrivatePinnedFunctionActivation } from '../../../src/handlers/write/pinned-activation.js';
import { createPinnedFunctionContext } from '../../../src/handlers/write/pinned-function-context.js';
import { executePinnedSourceWrite } from '../../../src/handlers/write/pinned-source-write.js';
import { createPinnedTextPoolContext } from '../../../src/handlers/write/pinned-text-pool.js';
import { requestContext } from '../../../src/server/context.js';
import { confirmNativeFunctionAbsence } from './native-contract-absence.js';
import {
  type ContractGroupBaseline,
  captureContractGroupBaseline,
  verifyContractGroupBaseline,
} from './native-contract-inventory.js';
import { contractIdentity } from './native-contract-transport.js';
import { nativeRequestPolicy, observeNativeHttp } from './native-observed-http.js';
import {
  absent,
  type ChildReceipt,
  childReceipt,
  type ProceduralRecord,
  poolReceipt,
  sameChild,
} from './native-procedural-evidence.js';
import {
  ADDED_FORM,
  EDITED_FORM,
  GROUP,
  INCLUDE,
  INCLUDE_SOURCE,
  initialParameters,
  MARKER,
  MODULE,
  MODULE_SOURCE,
  owners,
  POOL,
  PRESERVED_FORM,
  ProceduralFailure,
  proceduralConfig,
  selected,
  TEXTS,
  updatedParameters,
} from './native-procedural-fixed.js';
import { checkProceduralRequest, type ProceduralGrant, proceduralUnlock } from './native-procedural-transport.js';

export interface ProceduralInput {
  base: AdtClient;
  preflight: boolean;
  freshUntil: number;
  verifySource: () => void;
  shouldStop: () => boolean;
  record: ProceduralRecord;
}
export const runNativeProceduralContract = (input: ProceduralInput) => runProceduralWorkflow(input);
/** Compiled fixed-history entry only; not a tool argument or generic resumption facility. */
export interface RetainedProceduralStart {
  /** Only the new fixed tail entry selects this; no external resume argument. */
  startAt?: 'include-activate';
  inspect: (
    client: AdtClient,
    record: ProceduralRecord,
    policy: AdtRequestOptions,
  ) => Promise<{
    baseline: ContractGroupBaseline;
    originalModule: ChildReceipt;
    draftModule: ChildReceipt;
    include: ChildReceipt;
  }>;
}
/** A distinct compiled cleanup entry, with no caller-selectable resumption position. */
export interface ProceduralGroupCleanupStart {
  startAt: 'group-delete';
  checkRequest: (grant: ProceduralGrant, method: string, path: string, body?: string) => void;
  inspect: (
    client: AdtClient,
    record: ProceduralRecord,
    policy: AdtRequestOptions,
  ) => Promise<{ baseline: ContractGroupBaseline }>;
}
export async function runProceduralWorkflow(
  input: ProceduralInput,
  retained?: RetainedProceduralStart | ProceduralGroupCleanupStart,
) {
  const { base, record } = input,
    config = proceduralConfig(),
    deadline = Math.min(input.freshUntil, Date.now() + 240_000);
  const attempts = new RequestAttemptBudget(768),
    responses = new DataResponseBudget(2 * 1024 * 1024, 'native-procedural', true);
  const policy = () => ({
    deadline,
    noReplay: true,
    retryTransientErrors: false,
    attemptBudget: attempts,
    responseBudget: responses,
  });
  let grant: ProceduralGrant = { stage: 'preflight' },
    ended = false,
    mutationAttempted = false,
    cleanupConfirmed = false;
  const completed: string[] = [],
    attemptedOwners = new Set<string>(retained ? owners : []),
    confirmedDeleted = new Set<string>(),
    uncertain = new Set<string>();
  const latestAbsence = new Map<string, boolean>(),
    entered = new Set<string>(),
    receipts = new Map<string, ChildReceipt>();
  const safety = JSON.stringify(base.safety);
  const selection = {
    group: GROUP,
    module: MODULE,
    groupUrl: selected.FUGR.objectUrl,
    moduleUrl: selected.FUNC.objectUrl,
  };
  let createdGroup = false;
  let textBefore: Awaited<ReturnType<typeof poolReceipt>> | undefined;
  let baseline: ContractGroupBaseline | undefined, initialPool: Awaited<ReturnType<typeof poolReceipt>> | undefined;
  const verify = () => {
    if (ended || input.shouldStop()) throw new ProceduralFailure('stopped');
    input.verifySource();
    if (ended || input.shouldStop()) throw new ProceduralFailure('stopped');
    if (
      JSON.stringify(base.safety) !== safety ||
      !base.safety.allowWrites ||
      JSON.stringify(base.safety.multiTargetWrite) !== JSON.stringify(config.multiTargetWrite) ||
      JSON.stringify(base.safety.allowedPackages) !== '["$TMP"]'
    )
      throw new ProceduralFailure('configuration');
    throwIfRequestCancelled(policy());
  };
  const validate = (method: string, path: string, body?: string) => {
    if (
      retained &&
      [
        'group-create',
        'group-generate',
        'module-create',
        'module-activate',
        'module-stale-hash',
        'module-signature',
        'include-create',
        ...(retained.startAt === 'include-activate' ? ['include-edit', 'include-add'] : []),
      ].includes(grant.stage)
    )
      throw new ProceduralFailure('retained-stage');
    if (retained?.startAt === 'group-delete') retained.checkRequest(grant, method, path, body);
    checkProceduralRequest(grant, method, path, body);
    if (!proceduralUnlock(method, path)) verify();
  };
  const observe: ProceduralRecord = (value) => {
    const row = value as { stage?: string; method?: string; path?: string; status?: number; body?: string },
      safe = { ...row };
    if (
      row.stage === 'request' &&
      ['POST', 'PUT', 'DELETE'].includes(row.method ?? '') &&
      !row.path?.includes('/transportchecks')
    )
      mutationAttempted = true;
    if (
      row.stage === 'request' &&
      row.method === 'POST' &&
      grant.stage.endsWith('-create') &&
      !row.path?.includes('?_action=') &&
      !row.path?.includes('/transportchecks')
    ) {
      const owner =
        grant.stage === 'group-create' ? owners[0] : grant.stage === 'module-create' ? owners[1] : owners[2];
      attemptedOwners.add(owner);
      latestAbsence.set(owner, false);
    }
    if (row.path === '/sap/bc/adt/deletion/check' && typeof safe.body === 'string') {
      Object.assign(safe, { bodyHash: sourceHash(safe.body) });
      delete safe.body;
    }
    if (row.path === '/sap/bc/adt/activation/inactiveobjects' && typeof safe.body === 'string') {
      Object.assign(safe, { bodyHash: sourceHash(safe.body) });
      delete safe.body;
    }
    record({ workflowStage: grant.stage, ...safe });
  };
  const clone = (http: AdtHttpClient) =>
    Object.assign(Object.create(Object.getPrototypeOf(base)), base, { http }) as AdtClient;
  const bounded = (http: AdtHttpClient): AdtHttpClient =>
    new Proxy(http, {
      get(target, key) {
        if (key === 'withStatefulSession')
          return (fn: (session: AdtHttpClient) => unknown, cleanup: unknown) =>
            Reflect.apply(target.withStatefulSession, target, [
              (session: AdtHttpClient) => fn(bounded(session)),
              cleanup,
            ]);
        const value = Reflect.get(target, key, target);
        if (!['get', 'head', 'post', 'put', 'delete'].includes(String(key)))
          return typeof value === 'function' ? value.bind(target) : value;
        return async (...args: unknown[]) => {
          const method = String(key).toUpperCase(),
            path = args[0] as string,
            index = method === 'POST' || method === 'PUT' ? 4 : 2,
            supplied = args[index] as AdtRequestOptions | undefined,
            unlock = proceduralUnlock(method, path);
          args[index] = nativeRequestPolicy({
            ...supplied,
            ...policy(),
            deadline: unlock ? Date.now() + 10_000 : Math.min(deadline, supplied?.deadline ?? Infinity),
            signal: unlock ? undefined : supplied?.signal,
            attemptBudget: unlock ? new RequestAttemptBudget(4) : attempts,
            responseBudget: unlock ? new DataResponseBudget(64 * 1024, 'procedural-unlock', true) : responses,
          });
          const requestKey = `${grant.stage}:${method}:${path}`;
          if (
            !['GET', 'HEAD'].includes(method) &&
            !path.includes('/transportchecks') &&
            !path.includes('/deletion/check')
          ) {
            if (entered.has(requestKey)) throw new ProceduralFailure('replay');
            entered.add(requestKey);
          }
          if (
            !unlock &&
            createdGroup &&
            ['POST', 'PUT'].includes(method) &&
            !path.includes('/transportchecks') &&
            !path.includes('/deletion/check') &&
            !path.includes('_action=')
          ) {
            const group = await inspection.http.get(
              owners[0],
              { Accept: 'application/*', 'Cache-Control': 'no-cache' },
              args[index] as AdtRequestOptions,
            );
            contractIdentity(group.body, true, selection, MARKER);
          }
          if (
            method === 'PUT' &&
            [`${owners[1]}/source/main`, `${owners[2]}/source/main`].includes(path.split('?')[0])
          ) {
            const type = path.startsWith(owners[1]) ? 'FUNC' : 'INCL';
            const current = await childReceipt(inspection, type, undefined, observe, args[index] as AdtRequestOptions);
            const prior = receipts.get(type);
            if (prior) sameChild(current, prior);
          }
          if (method === 'POST' && path.startsWith('/sap/bc/adt/activation?') && grant.stage === 'group-generate')
            await verifyContractGroupBaseline(
              inspection.http,
              selection,
              MARKER,
              baseline,
              observe,
              args[index] as AdtRequestOptions,
            );
          if (method === 'POST' && path.startsWith('/sap/bc/adt/activation?') && grant.activation?.pool) {
            if (!textBefore || !grant.source) throw new ProceduralFailure('text-proof');
            const current = await poolReceipt(inspection, observe);
            const part = grant.source.path.split('/').at(-1) as keyof typeof current.parts;
            if (
              current.state !== 'inactive' ||
              !textPartMatchesRequest(part, grant.source.body, current.parts[part].inactive)
            )
              throw new ProceduralFailure('inactive-pool-proof');
            for (const sibling of ['symbols', 'selections', 'headings'] as const) {
              if (
                current.parts[sibling].active !== textBefore.parts[sibling].active ||
                (sibling !== part && current.parts[sibling].inactive !== textBefore.parts[sibling].inactive)
              )
                throw new ProceduralFailure('preactivation-pool-drift');
            }
            record({
              workflowStage: grant.stage,
              pendingPartVerified: part,
              activePartsUnchangedBeforeActivation: true,
            });
          }
          validate(method, path, method === 'POST' || method === 'PUT' ? (args[1] as string) : undefined);
          return Reflect.apply(value, target, args);
        };
      },
    });
  let client: AdtClient;
  const confirmAbsent = async (owner: string) => {
    latestAbsence.set(owner, false);
    uncertain.add(owner);
    await absent(client, owner, observe, policy());
    latestAbsence.set(owner, true);
    uncertain.delete(owner);
  };
  // Extra proof reads use the original stateless connection. They never borrow or disturb an owning native lock.
  const inspection = clone(
    bounded(
      observeNativeHttp(base.http, validate, observe, async () => {
        throw new ProceduralFailure('scope');
      }),
    ),
  );
  client = clone(
    bounded(
      observeNativeHttp(base.http, validate, observe, async (_session, path, options) => {
        if (!attemptedOwners.has(path)) throw new ProceduralFailure('owner');
        if (path === owners[0]) {
          if (retained?.startAt === 'group-delete') await retained.inspect(clone(bounded(_session)), observe, options);
          await confirmAbsent(owners[2]);
          await confirmAbsent(owners[1]);
          await verifyContractGroupBaseline(inspection.http, selection, MARKER, baseline, observe, options);
          if ((await poolReceipt(inspection, observe)).state !== 'active') throw new ProceduralFailure('pool-state');
        } else {
          const type = path === owners[1] ? 'FUNC' : 'INCL',
            prior = receipts.get(type);
          if (!prior) throw new ProceduralFailure('owner');
          sameChild(await childReceipt(inspection, type, undefined, observe, options), prior);
          sameChild(await childReceipt(inspection, type, 'active', observe, options), prior);
        }
        verify();
      }),
    ),
  );
  const receipt = async (type: 'FUNC' | 'INCL', version?: 'active' | 'inactive') =>
    childReceipt(client, type, version, observe, policy());
  const write = async (
    type: 'FUGR' | 'FUNC' | 'INCL',
    action: string,
    extra: Record<string, unknown> = {},
    negative = false,
  ) => {
    const context = pinnedMutationContext(client.safety, policy(), { unlockFailed: false });
    const s = selected[type],
      args = { type, name: s.name, action, ...(type === 'FUGR' ? {} : { group: GROUP }), ...extra };
    const result = await executePinnedSourceWrite(await createPinnedFunctionContext(client, args, config, context));
    const payload = JSON.parse(result.content[0].text);
    cleanupConfirmed =
      !context.cleanup.unlockFailed && !context.cleanup.unknownLocks?.length && context.cleanup.sessionClosed === true;
    record({ workflowStage: grant.stage, operation: action, result, cleanup: context.cleanup });
    if (negative) {
      if (
        !result.isError ||
        payload.state !== 'unchanged' ||
        !cleanupConfirmed ||
        !String(payload.message).includes('Source changed, or expectedSourceHash')
      )
        throw new ProceduralFailure('negative-control');
      return;
    }
    if (action === 'delete' && payload.state === 'deleted') {
      confirmedDeleted.add(s.objectUrl);
      await confirmAbsent(s.objectUrl);
    }
    if (
      result.isError ||
      !cleanupConfirmed ||
      !(action === 'delete'
        ? payload.state === 'deleted'
        : type === 'FUGR'
          ? payload.state === 'created'
          : payload.state === 'saved-inactive')
    )
      throw new ProceduralFailure('write-unconfirmed');
    if (type !== 'FUGR' && action !== 'delete') {
      const current = await receipt(type);
      if (current.sourceHash !== payload.sourceHash || current.version !== 'inactive')
        throw new ProceduralFailure('save-proof');
      const expected = grant.source?.body;
      if (
        !expected ||
        (type === 'FUNC'
          ? !prepareFunctionSourceVerification(expected, MODULE)(current.source)
          : !editableSourceEquals(expected, current.source))
      )
        throw new ProceduralFailure('saved-source');
      receipts.set(type, current);
    }
  };
  const activate = async (type: 'FUGR' | 'FUNC' | 'INCL') => {
    const s = selected[type];
    grant.activation = { uri: s.objectUrl, name: s.name };
    const result = await handlePrivatePinnedFunctionActivation(
        client,
        { type, name: s.name, ...(type === 'FUGR' ? {} : { group: GROUP }) },
        true,
      ),
      payload = JSON.parse(result.content[0].text);
    record({ workflowStage: grant.stage, activation: result });
    if (
      result.isError ||
      (type === 'FUGR'
        ? !['generated', 'native-operation-confirmed'].includes(payload.state)
        : !['activated', 'already-active'].includes(payload.state))
    )
      throw new ProceduralFailure('activation-unconfirmed');
    if (type !== 'FUGR') {
      const current = await receipt(type),
        active = await receipt(type, 'active'),
        prior = receipts.get(type)!;
      sameChild(current, active);
      sameChild(current, prior, false);
      if (current.version !== 'active' || current.inactiveAlternative) throw new ProceduralFailure('active-proof');
      receipts.set(type, current);
    }
  };
  const deleteGroupAndFinish = async () => {
    grant = { stage: 'group-delete' };
    await confirmAbsent(owners[2]);
    await confirmAbsent(owners[1]);
    await write('FUGR', 'delete');
    completed.push(grant.stage);
    grant = { stage: 'final' };
    for (const owner of [...owners, POOL]) await confirmAbsent(owner);
    for (const owner of [...owners, POOL]) {
      latestAbsence.set(owner, false);
      uncertain.add(owner);
    }
    await confirmNativeFunctionAbsence(client.http, selection, observe, policy());
    if (retained?.startAt === 'group-delete') for (const owner of [...owners, POOL]) await confirmAbsent(owner);
    for (const owner of [...owners, POOL]) {
      latestAbsence.set(owner, true);
      uncertain.delete(owner);
    }
    verify();
    completed.push(grant.stage);
  };
  let reason: string | undefined;
  try {
    await requestContext.run({ requestId: 'native-procedural', user: 'native-contract-MARIAN' }, async () => {
      verify();
      if (retained?.startAt === 'group-delete') {
        baseline = (await retained.inspect(client, observe, policy())).baseline;
        createdGroup = true;
        await confirmAbsent(owners[2]);
        await confirmAbsent(owners[1]);
        completed.push('preflight');
        if (!input.preflight) await deleteGroupAndFinish();
        return;
      }
      let originalModule: ChildReceipt, draftModule: ChildReceipt;
      if (retained) {
        const initial = await retained.inspect(client, observe, policy());
        baseline = initial.baseline;
        originalModule = initial.originalModule;
        draftModule = initial.draftModule;
        receipts.set('FUNC', draftModule);
        receipts.set('INCL', initial.include);
        createdGroup = true;
        completed.push('preflight');
        if (input.preflight) return;
      } else {
        await confirmNativeFunctionAbsence(client.http, selection, observe, policy());
        await confirmAbsent(owners[2]);
        completed.push('preflight');
        if (input.preflight) return;
        grant = { stage: 'group-create' };
        await write('FUGR', 'create', { package: '$TMP', description: MARKER });
        baseline = await captureContractGroupBaseline(client.http, selection, MARKER, observe, policy());
        createdGroup = true;
        completed.push(grant.stage);
        grant = { stage: 'group-generate' };
        await activate('FUGR');
        baseline = await captureContractGroupBaseline(client.http, selection, MARKER, observe, policy());
        initialPool = await poolReceipt(client, observe);
        if (
          initialPool.state !== 'active' ||
          initialPool.parts.symbols.active !== '' ||
          initialPool.parts.symbols.inactive !== '' ||
          !textPartMatchesRequest('selections', '', initialPool.parts.selections.active)
        )
          throw new ProceduralFailure('initial-pool');
        completed.push(grant.stage);
        grant = {
          stage: 'module-create',
          source: {
            path: `${owners[1]}/source/main`,
            body: spliceFmSignature(MODULE_SOURCE, MODULE, initialParameters, 'EN'),
          },
        };
        await write('FUNC', 'create', { description: MARKER, source: MODULE_SOURCE, parameters: initialParameters });
        completed.push(grant.stage);
        grant = { stage: 'module-activate' };
        await activate('FUNC');
        originalModule = receipts.get('FUNC')!;
        completed.push(grant.stage);
        grant = { stage: 'module-stale-hash' };
        await write('FUNC', 'update', { parameters: updatedParameters, expectedSourceHash: '0'.repeat(64) }, true);
        sameChild(await receipt('FUNC'), originalModule);
        completed.push(grant.stage);
        grant = {
          stage: 'module-signature',
          source: {
            path: `${owners[1]}/source/main`,
            body: spliceFmSignature(originalModule.source, MODULE, updatedParameters, 'EN'),
          },
        };
        await write('FUNC', 'update', { parameters: updatedParameters, expectedSourceHash: originalModule.sourceHash });
        draftModule = receipts.get('FUNC')!;
        // The shared complete source-frame proof above preserves literals/body and accepts native
        // identifier casing. The public signature parser intentionally reports native type spelling.
        if (parseFmSignature(draftModule.source).params.length !== updatedParameters.length)
          throw new ProceduralFailure('signature-proof');
        sameChild(await receipt('FUNC', 'active'), originalModule, false);
        completed.push(grant.stage);
        grant = { stage: 'include-create', source: { path: `${owners[2]}/source/main`, body: INCLUDE_SOURCE } };
        await write('INCL', 'create', { description: MARKER, source: INCLUDE_SOURCE });
        completed.push(grant.stage);
      }
      if (retained?.startAt !== 'include-activate')
        for (const [stage, action, unit, source] of [
          ['include-edit', 'edit_unit', 'changed', EDITED_FORM],
          ['include-add', 'add_unit', 'added', ADDED_FORM],
        ] as const) {
          const prior = receipts.get('INCL')!,
            edit = (action === 'edit_unit' ? spliceUnit : insertUnit)(prior.source, INCLUDE, unit, source);
          if (!edit.success || !edit.newSource.replace(/\r\n/g, '\n').includes(PRESERVED_FORM))
            throw new ProceduralFailure('unit-plan');
          grant = { stage, source: { path: `${owners[2]}/source/main`, body: edit.newSource } };
          await write('INCL', action, { unit, source, expectedSourceHash: prior.sourceHash });
          completed.push(stage);
        }
      grant = { stage: 'include-activate' };
      await activate('INCL');
      completed.push(grant.stage);
      // Include activation must not be mistaken for the independently selected FUNC's activation.
      sameChild(await receipt('FUNC'), draftModule);
      sameChild(await receipt('FUNC', 'active'), originalModule, false);
      for (const [stage, part, source] of [
        ['empty-symbols', 'symbols', ''],
        ['text-headings', 'headings', TEXTS.headings],
        ['text-symbols', 'symbols', TEXTS.symbols],
        ['text-selections', 'selections', ''],
        ['clear-symbols', 'symbols', ''],
      ] as const) {
        grant = {
          stage,
          source: { path: `${POOL}/source/${part}`, body: source },
          activation: { uri: POOL, name: GROUP, pool: true },
        };
        const before = await poolReceipt(client, observe),
          context = pinnedMutationContext(client.safety, policy(), { unlockFailed: false });
        textBefore = before;
        const result = await executePinnedSourceWrite(
          createPinnedTextPoolContext(
            client,
            { action: 'edit_text_symbols', type: 'FUGR', name: GROUP, textPart: part, source },
            config,
            context,
          ),
        );
        const payload = JSON.parse(result.content[0].text);
        cleanupConfirmed =
          !context.cleanup.unlockFailed &&
          !context.cleanup.unknownLocks?.length &&
          context.cleanup.sessionClosed === true;
        record({ workflowStage: stage, textPart: part, result, cleanup: context.cleanup });
        if (result.isError || !cleanupConfirmed || !['text-saved-active', 'unchanged'].includes(payload.state))
          throw new ProceduralFailure('text-unconfirmed');
        const after = await poolReceipt(client, observe);
        if (
          after.state !== 'active' ||
          !textPartMatchesRequest(part, source, after.parts[part].active) ||
          !textPartMatchesRequest(part, source, after.parts[part].inactive)
        )
          throw new ProceduralFailure('text-proof');
        for (const sibling of ['symbols', 'selections', 'headings'] as const)
          if (sibling !== part && JSON.stringify(after.parts[sibling]) !== JSON.stringify(before.parts[sibling]))
            throw new ProceduralFailure('text-sibling');
        sameChild(await receipt('FUNC'), draftModule);
        sameChild(await receipt('FUNC', 'active'), originalModule, false);
        completed.push(stage);
      }
      grant = { stage: 'module-final-activate' };
      await activate('FUNC');
      completed.push(grant.stage);
      grant = { stage: 'include-delete' };
      await write('INCL', 'delete');
      completed.push(grant.stage);
      grant = { stage: 'module-delete' };
      await confirmAbsent(owners[2]);
      await write('FUNC', 'delete');
      completed.push(grant.stage);
      // Only our previously verified whole-part changes replace initial pool hashes; source/tree baseline stays fixed.
      const pool = await poolReceipt(client, observe),
        hashes = { ...baseline.hashes };
      for (const part of ['symbols', 'selections', 'headings'] as const)
        for (const version of ['active', 'inactive'] as const) {
          const expected = part === 'headings' ? TEXTS.headings : '';
          if (!textPartMatchesRequest(part, expected, pool.parts[part][version]))
            throw new ProceduralFailure('final-pool');
          hashes[`${POOL}/source/${part}?version=${version}`] = sourceHash(pool.parts[part][version]);
        }
      baseline = { group: GROUP, hashes };
      await deleteGroupAndFinish();
    });
  } catch (error) {
    reason = error instanceof ProceduralFailure ? error.reason : 'native-or-evidence-refusal';
    record({ workflowStage: grant.stage, failure: reason, errorType: error instanceof Error ? error.name : 'unknown' });
  }
  ended = true;
  const remaining = [...new Set([...attemptedOwners, ...uncertain])].filter(
    (owner) => latestAbsence.get(owner) !== true,
  );
  return {
    failure: reason !== undefined,
    ...(reason ? { reason } : {}),
    owners,
    completed,
    stoppedAt: grant.stage,
    mutationAttempted,
    confirmedDeleted: [...confirmedDeleted],
    cleanupConfirmed,
    finalAbsenceConfirmed: completed.includes('final'),
    remaining,
    inspectionRequired: [...new Set([...remaining, ...(reason && retained ? owners : [])])],
    independentLockVerification: 'required',
    authentication: 'Basic-native-contract-only',
    ppQualified: false,
  };
}
