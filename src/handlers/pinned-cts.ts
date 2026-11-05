/** Private CTS qualification entry. Deliberately not imported by dispatch or the public capability matrix. */
import type { AdtClient } from '../adt/client.js';
import { AdtApiError, AdtSafetyError } from '../adt/errors.js';
import { mutationClient } from '../adt/mutation-client.js';
import { pinnedMutationContext } from '../adt/mutation-context.js';
import {
  assertCtsMembers,
  assertCtsNoInactive,
  type CtsNode,
  ctsId,
  ctsMutable,
  ctsObjectKey,
  parseCtsTree,
  readCtsTree,
  readCtsTreeAfterDelete,
  readCtsValues,
} from '../adt/pinned-cts-evidence.js';
import { type CtsSubmission, pinnedCtsHttp } from '../adt/pinned-cts-http.js';
import { preparePinnedTransport } from '../adt/pinned-transport-scope.js';
import { checkPackage, deriveUserSafety } from '../adt/safety.js';
import {
  createTransport,
  createTransportWithTarget,
  deleteTransport,
  reassignTransport,
  releaseTransportAndWait,
  supportsExplicitTransportTarget,
} from '../adt/transport.js';
import { removePinnedTransportEntry } from '../adt/transport-entry.js';
import { hasRequiredScope } from '../authz/policy.js';
import { getCurrentContext } from '../server/context.js';
import { isActionDenied } from '../server/deny-actions.js';
import { pinnedWriteEnabled } from '../server/multi-target-write-surface.js';
import type { ServerConfig } from '../server/types.js';
import { privateCtsInput } from './pinned-cts-input.js';
import { pinnedOperationResult } from './pinned-operation.js';
import type { ToolResult } from './shared.js';

interface Step {
  id: string;
  operation: string;
  state: 'confirmed';
  object?: string;
}
/** Caller scopes come from authenticated pinned dispatch or a bound harness, never tool arguments. */
export async function handlePrivatePinnedCts(
  client: AdtClient,
  config: ServerConfig,
  raw: Record<string, unknown>,
  scopes: readonly string[],
): Promise<ToolResult> {
  const submissions: CtsSubmission[] = [],
    completed: Step[] = [];
  let selected: string | undefined, parent: string | undefined, nativeTarget: string | undefined;
  let intended: readonly string[] = [];
  let phase = 'admission';
  let action = 'invalid';
  const unexpectedChildren = new Set<string>();
  const refuseExpansion = () => {
    if (unexpectedChildren.size)
      throw new AdtSafetyError('Observed CTS membership expansion prevents further explicit mutations.');
  };
  const finish = (ok: boolean, state: string, extra: Record<string, unknown> = {}) =>
    pinnedOperationResult(
      {
        ok,
        state,
        phase,
        selected,
        parent,
        nativeTarget,
        intended,
        completed,
        submissions: submissions.map((entry) => ({
          method: entry.method,
          id: entry.path.match(/\/transportrequests\/([A-Z0-9]+)(?:[/?]|$)/)?.[1],
          acknowledged: entry.acknowledged,
        })),
        ...extra,
        unexpectedChildren: [...unexpectedChildren],
      },
      config,
      { action },
    );
  try {
    const args = privateCtsInput(raw);
    action = args.action;
    const companion = args.action === 'layers' || args.action === 'targets';
    const safety = deriveUserSafety(client.safety, [...scopes]);
    if (
      (!companion && !scopes.includes('write')) ||
      !hasRequiredScope([...scopes], 'read') ||
      !pinnedWriteEnabled(config) ||
      !config.multiTargetEndpoints ||
      (!companion && (!config.allowTransportWrites || !safety.allowWrites || !safety.allowTransportWrites)) ||
      !config.targetId ||
      safety.multiTargetWrite?.target !== config.targetId ||
      config.multiTargetWrite?.target !== config.targetId ||
      !safety.multiTargetWrite?.enabled ||
      isActionDenied('SAPTransport', args.action, [...config.denyActions, ...safety.denyActions])
    )
      throw new AdtSafetyError('Private CTS management is unavailable for this caller or selected target.');
    const context = pinnedMutationContext(
      safety,
      {
        deadline: Date.now() + (args.timeoutSeconds ?? 300) * 1000,
        signal: getCurrentContext()?.signal,
      },
      { unlockFailed: false },
    );
    const http = pinnedCtsHttp(client.http, safety, context, submissions, {
      // Observe all organizer GETs, including those inside the legacy convergence engine.
      // Never forget an expansion because a subsequent snapshot omits the new member.
      read: (path, body) => {
        if (
          action === 'create' ||
          !parent ||
          !intended.length ||
          !/^\/sap\/bc\/adt\/cts\/transportrequests\/[A-Z0-9]{1,20}(?:\?|$)/.test(path)
        )
          return;
        for (const node of parseCtsTree(body, parent).tasks)
          if (!intended.includes(node.id)) unexpectedChildren.add(node.id);
      },
      beforeMutation: refuseExpansion,
    });
    if (args.action === 'layers' || args.action === 'targets') {
      phase = 'value-help';
      return finish(true, 'confirmed', { values: await readCtsValues(http, args.action), complete: true });
    }
    phase = 'membership';
    const prepared = await preparePinnedTransport(http, safety, context, args.action, args.id);
    const owned = prepared.http,
      policy = prepared.safety;
    selected = prepared.requestedId;
    parent = prepared.parentId;
    intended = prepared.verifiedIds;
    if (args.action === 'create') {
      phase = 'create-preflight';
      if (args.target !== undefined && supportsExplicitTransportTarget(owned) !== true)
        throw new AdtSafetyError('Explicit CTS target creation requires affirmative native discovery evidence.');
      if (args.package !== undefined)
        await checkPackage(
          policy,
          args.package,
          mutationClient(client.withSafety(safety), context, http).getPackageHierarchyResolver({
            ...context.requestPolicy,
          }),
        );
      phase = 'create';
      const id =
        args.target !== undefined
          ? await createTransportWithTarget(owned, policy, args.description!, args.target)
          : await createTransport(owned, policy, args.description!, args.package, undefined, args.transportLayer);
      selected = parent = ctsId(id);
      intended = [selected];
      phase = 'create-verification';
      const tree = await readCtsTree(owned, parent);
      if (
        tree.parent?.type !== 'K' ||
        !['D', 'L'].includes(tree.parent.status) ||
        tree.parent.description !== args.description ||
        (args.target !== undefined && tree.parent.target !== args.target)
      )
        throw new AdtSafetyError(
          'Created request identity/type/state/description/target could not be independently confirmed.',
        );
      nativeTarget = tree.parent.target;
      completed.push({ id: parent, operation: 'create', state: 'confirmed' });
      return finish(true, 'confirmed');
    }
    const removed = new Set<string>();
    const initial = await readCtsTree(owned, parent!);
    assertCtsMembers(initial, intended);
    const initialNodes = [initial.parent!, ...initial.tasks];
    const chosen = initialNodes.find((node) => node.id === selected)!;
    const recursive = args.action === 'release_recursive' || args.recursive === true;
    if (recursive && selected !== parent)
      throw new AdtSafetyError('Recursive CTS management requires the parent request.');
    const targets = recursive ? [...initial.tasks, initial.parent!] : [chosen];
    if (args.action !== 'release' && args.action !== 'release_recursive') targets.forEach(ctsMutable);
    nativeTarget = initial.parent!.target;
    const refresh = async () => {
      const tree = await readCtsTree(owned, parent!);
      assertCtsMembers(tree, intended, removed);
      const nodes = [tree.parent, ...tree.tasks].filter((node): node is CtsNode => !!node);
      return nodes;
    };
    const freshNode = async (id: string) => {
      refuseExpansion();
      const node = (await refresh()).find((entry) => entry.id === id);
      if (!node) throw new AdtSafetyError('Selected CTS member disappeared before submission.');
      return node;
    };
    if (args.action === 'release' || args.action === 'release_recursive') {
      phase = 'inactive-precheck';
      await assertCtsNoInactive(owned, intended);
      for (const node of targets) {
        phase = 'release-preflight';
        await freshNode(node.id);
        await assertCtsNoInactive(owned, intended);
        phase = 'release';
        const result = await releaseTransportAndWait(owned, policy, node.id, {
          deadline: context.requestPolicy.deadline,
        });
        for (const id of result.unexpectedChildren ?? []) unexpectedChildren.add(ctsId(id));
        if (!result.verified)
          return finish(false, submissions.length ? 'incomplete' : 'unchanged', {
            release: {
              outcome: result.outcome,
              released: result.released,
              intended: result.intended,
              unexpectedChildren: [...unexpectedChildren],
              reportConflicts: result.reportConflicts,
            },
          });
        // Legacy convergence accepts several SAP omission shapes. This private adapter additionally
        // requires namespace-checked terminal evidence; unsupported disappearance remains uncertain.
        const terminal = await readCtsTree(owned, parent!);
        const observed = [terminal.parent, ...terminal.tasks].find((entry) => entry?.id === node.id);
        if (
          !(observed && ['R', 'N'].includes(observed.status)) &&
          !(node.kind === 'task' && terminal.parent && ['R', 'N'].includes(terminal.parent.status))
        )
          throw new AdtSafetyError('CTS release lacks independently typed terminal-state evidence.');
        completed.push({ id: node.id, operation: 'release', state: 'confirmed' });
        if (node.kind === 'task') removed.add(node.id); // CTS can omit a terminal task from its parent tree.
      }
      phase = 'release-verification';
      await readCtsTree(owned, parent!);
      return finish(unexpectedChildren.size === 0, unexpectedChildren.size ? 'incomplete' : 'confirmed', {
        nativeChildEffects: 'Parent-level CTS effects are not an atomic task snapshot.',
      });
    }
    if (args.action === 'remove_object') {
      phase = 'object-preflight';
      const candidates = initialNodes
        .filter((node) => selected === parent || node.id === selected)
        .flatMap((node) =>
          node.objects
            .filter(
              (object) =>
                object.pgmid === (args.pgmid ?? 'R3TR') && object.type === args.type && object.name === args.name,
            )
            .map((object) => ({ node, object })),
        );
      if (candidates.length !== 1 || candidates[0].node.kind !== 'task')
        throw new AdtSafetyError('Entry removal requires one unambiguous native task-owned full object key.');
      const { node, object } = candidates[0];
      if (!object.lockKnown)
        throw new AdtSafetyError(
          'CTS entry removal requires the native lock metadata contract; older removal services are unqualified.',
        );
      ctsMutable(node);
      const current = await freshNode(node.id);
      ctsMutable(current);
      if (!current.objects.some((entry) => entry.lockKnown && ctsObjectKey(entry) === ctsObjectKey(object)))
        throw new AdtSafetyError('Selected CTS object key changed before removal.');
      phase = 'remove-object';
      await removePinnedTransportEntry(owned, policy, node.id, object, 'RemoveTransportObject');
      const after = await freshNode(node.id);
      if (after.objects.some((entry) => ctsObjectKey(entry) === ctsObjectKey(object)))
        throw new AdtSafetyError('CTS entry removal was not confirmed.');
      completed.push({ id: node.id, operation: 'remove_object', object: ctsObjectKey(object), state: 'confirmed' });
      return finish(true, 'confirmed');
    }
    // Preflight every affected entry before removing the first lock or deleting the first task.
    const cleanupNodes = args.removeLockedObjects ? (selected === parent ? initialNodes : [chosen]) : [];
    for (const node of cleanupNodes) {
      ctsMutable(node);
      if (
        node.objects.some((object) => !object.lockKnown) ||
        (node.kind === 'request' && node.objects.some((object) => object.locked))
      )
        throw new AdtSafetyError('Locked-object cleanup requires qualified task-owned lock metadata.');
    }
    for (const node of cleanupNodes)
      for (const object of node.objects.filter((entry) => entry.locked)) {
        phase = 'locked-entry-preflight';
        const current = await freshNode(node.id);
        ctsMutable(current);
        if (
          !current.objects.some(
            (entry) => entry.lockKnown && entry.locked && ctsObjectKey(entry) === ctsObjectKey(object),
          )
        )
          throw new AdtSafetyError('CTS lock entry changed after preflight.');
        phase = 'remove-locked-entry';
        await removePinnedTransportEntry(owned, policy, node.id, object, 'DeleteTransportObject');
        if ((await freshNode(node.id)).objects.some((entry) => ctsObjectKey(entry) === ctsObjectKey(object)))
          throw new AdtSafetyError('Locked-entry cleanup was not confirmed.');
        completed.push({
          id: node.id,
          operation: 'remove_locked_entry',
          object: ctsObjectKey(object),
          state: 'confirmed',
        });
      }
    for (const node of targets) {
      phase = `${args.action}-preflight`;
      ctsMutable(await freshNode(node.id));
      phase = args.action;
      if (args.action === 'reassign') {
        await reassignTransport(owned, policy, node.id, args.owner!);
        if ((await freshNode(node.id)).owner !== args.owner)
          throw new AdtSafetyError('CTS owner change was not confirmed.');
      } else {
        await deleteTransport(owned, policy, node.id);
        const after = await readCtsTreeAfterDelete(owned, parent!);
        if ([after.parent?.id, ...after.tasks.map((task) => task.id)].includes(node.id))
          throw new AdtSafetyError('CTS deletion was not confirmed by typed native absence.');
        removed.add(node.id);
        assertCtsMembers(after, intended, removed);
      }
      completed.push({ id: node.id, operation: args.action, state: 'confirmed' });
    }
    return finish(true, 'confirmed');
  } catch (error) {
    return finish(false, submissions.length ? 'incomplete' : 'unchanged', {
      reason:
        error instanceof AdtSafetyError
          ? error.message
          : 'CTS evidence or execution failed; inspect native state before retrying.',
      ...(error instanceof AdtApiError ? { httpStatus: error.statusCode } : {}),
    });
  }
}
