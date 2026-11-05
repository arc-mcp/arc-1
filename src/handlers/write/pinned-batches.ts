/** Private batch qualification entry. Never imported by dispatch, schemas or the public matrix. */
import type { AdtClient } from '../../adt/client.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { throwIfRequestCancelled } from '../../adt/http-deadline.js';
import { mutationClient } from '../../adt/mutation-client.js';
import { pinnedMutationContext } from '../../adt/mutation-context.js';
import { isPinnedDdicType } from '../../adt/pinned-ddic-owner.js';
import { isPinnedDeclarativeType } from '../../adt/pinned-repository-owner.js';
import { createPinnedBinding, preparePinnedBindingCreate } from '../../adt/pinned-service-binding.js';
import { checkOperation, checkPackage, deriveUserSafety, OperationType } from '../../adt/safety.js';
import { hasRequiredScope } from '../../authz/policy.js';
import { getCurrentContext } from '../../server/context.js';
import { isActionDenied } from '../../server/deny-actions.js';
import { pinnedWriteEnabled } from '../../server/multi-target-write-surface.js';
import type { ServerConfig } from '../../server/types.js';
import { errorResult, type ToolResult, textResult, toolJson } from '../shared.js';
import { SAPWRITE_TYPES_BTP } from '../tool-registry.js';
import type { SapWriteContext } from './context.js';
import { preflightPinnedBatchCreate, resolveFunctionGroupCreatePackage } from './create.js';
import { prepareCreationRecording } from './creation.js';
import { activatePinnedBatchOwners, type BatchPhase } from './pinned-batch-activation.js';
import { privateBatchInput } from './pinned-batch-input.js';
import { createPinnedDdicContext } from './pinned-ddic-context.js';
import { createPinnedDeclarativeContext } from './pinned-declarative-context.js';
import { createPinnedFunctionContext } from './pinned-function-context.js';
import { forgetPinnedSourceContext } from './pinned-source-context.js';
import { createPinnedTextSourceContext } from './pinned-source-input.js';
import { executePinnedSourceWrite } from './pinned-source-write.js';

interface Entry {
  index: number;
  type: unknown;
  name: unknown;
  group?: unknown;
  create?: BatchPhase;
  activation: BatchPhase;
}
function phaseValue(phase: BatchPhase | undefined) {
  if (!phase) return undefined;
  let result: unknown;
  if (phase.result) {
    try {
      result = JSON.parse(phase.result.content.map((part) => part.text).join('\n'));
    } catch {
      result = { error: 'The native adapter did not return a structured result.', state: 'unknown' };
    }
  }
  return {
    status: phase.status,
    ...(phase.attemptedScope ? { attemptedScope: phase.attemptedScope } : {}),
    ...(phase.submissionPossible ? { submissionPossible: true } : {}),
    ...(result === undefined ? {} : { result }),
  };
}

/** Explicit scopes are supplied by the authenticated harness, never accepted inside tool arguments. */
export function handlePrivatePinnedBatchCreate(
  client: AdtClient,
  config: ServerConfig,
  args: unknown,
  scopes: readonly string[],
): Promise<ToolResult> {
  return runPrivateBatch(client, config, args, scopes, true);
}
export function handlePrivatePinnedBatchActivation(
  client: AdtClient,
  config: ServerConfig,
  args: unknown,
  scopes: readonly string[],
): Promise<ToolResult> {
  return runPrivateBatch(client, config, args, scopes, false);
}

async function runPrivateBatch(
  original: AdtClient,
  config: ServerConfig,
  raw: unknown,
  scopes: readonly string[],
  creation: boolean,
): Promise<ToolResult> {
  const entries: Entry[] = [],
    contexts: SapWriteContext[] = [];
  let phase = 'admission';
  let activateAtEnd = false;
  const action = creation ? 'batch_create' : 'activate';
  const finish = (ok: boolean, message?: string) => {
    const payload = toolJson({
      target: config.targetId,
      action,
      ok,
      phase,
      retryable: false,
      atomic: false,
      state: ok
        ? 'confirmed'
        : entries.some(
              (entry) =>
                (entry.create?.status !== undefined && entry.create.status !== 'not-attempted') ||
                entry.activation.submissionPossible ||
                entry.activation.status === 'confirmed' ||
                entry.activation.status === 'unconfirmed',
            )
          ? 'incomplete'
          : 'unchanged',
      ...(creation ? { activateAtEnd } : {}),
      objects: entries.map((entry) => ({
        ...entry,
        create: phaseValue(entry.create),
        activation: phaseValue(entry.activation),
      })),
      ...(message ? { message } : {}),
      next: ok
        ? 'Review the reported complete owners and their native side effects. Publication was not requested.'
        : 'Inspect each reported state in SAP. Earlier results are preserved; no rollback, repair or automatic retry was attempted.',
    });
    return ok ? textResult(payload) : errorResult(payload);
  };
  try {
    const safety = deriveUserSafety(original.safety, [...scopes]);
    if (
      !scopes.includes('write') ||
      !hasRequiredScope([...scopes], 'read') ||
      !pinnedWriteEnabled(config) ||
      !config.multiTargetEndpoints ||
      !config.targetId ||
      !safety.allowWrites ||
      !safety.multiTargetWrite?.enabled ||
      safety.multiTargetWrite.target !== config.targetId ||
      config.multiTargetWrite?.target !== config.targetId
    )
      throw new AdtSafetyError('Private batch mutation is unavailable for this caller or selected strict-PP target.');
    const denials = [...safety.denyActions, ...config.denyActions];
    if (
      isActionDenied('SAPActivate', 'activate', denials) ||
      (creation &&
        (isActionDenied('SAPWrite', 'batch_create', denials) || isActionDenied('SAPWrite', 'create', denials)))
    )
      throw new AdtSafetyError('A batch or nested mutation is denied by policy.');
    checkOperation(safety, creation ? OperationType.Create : OperationType.Activate, 'PinnedBatch');
    const context = pinnedMutationContext(
      safety,
      { deadline: Date.now() + 300_000, signal: getCurrentContext()?.signal },
      { unlockFailed: false },
    );
    const client = original.withSafety(safety);
    phase = 'validation';
    const input = privateBatchInput(raw, creation, config.systemType === 'btp');
    activateAtEnd = input.activateAtEnd;
    if (
      config.systemType === 'btp' &&
      input.objects.some((item) => !SAPWRITE_TYPES_BTP.some((type) => type === item.type))
    )
      throw new AdtSafetyError('A batch type is unavailable on this platform.');
    entries.push(
      ...input.objects.map((item, index) => ({
        index,
        type: item.type,
        name: item.name,
        ...(item.group === undefined ? {} : { group: item.group }),
        ...(creation ? { create: { status: 'not-attempted' as const } } : {}),
        activation: { status: 'not-attempted' as const },
      })),
    );
    throwIfRequestCancelled(context.requestPolicy);
    if (!creation) {
      phase = 'activation';
      return finish(
        await activatePinnedBatchOwners(
          client,
          input.objects,
          context,
          entries.map((entry) => entry.activation),
          config.minimalErrors,
        ),
      );
    }
    // Every static branch/body/quality check completes before the first native create. Each actual
    // adapter then re-proves its exact native package/recording immediately before its own mutation.
    const plans: ({ source: SapWriteContext } | { binding: Record<string, unknown> })[] = [];
    for (const item of input.objects) {
      throwIfRequestCancelled(context.requestPolicy);
      if (item.type === 'SRVB') {
        const { type: _type, action: _action, ...binding } = item;
        preparePinnedBindingCreate(binding);
        plans.push({ binding });
        continue;
      }
      if (
        ['CLAS', 'INTF', 'PROG', 'INCL'].includes(item.type as string) &&
        Object.keys(item).some(
          (field) => !['action', 'type', 'name', 'source', 'description', 'package', 'transport'].includes(field),
        )
      )
        throw new AdtSafetyError('Unsupported field for this batch source owner.');
      const ctx = isPinnedDdicType(item.type)
        ? await createPinnedDdicContext(client, item, config, context)
        : isPinnedDeclarativeType(item.type)
          ? createPinnedDeclarativeContext(client, item, config, context)
          : item.type === 'FUNC'
            ? await createPinnedFunctionContext(client, item, config, context)
            : createPinnedTextSourceContext(client, item, config, context);
      contexts.push(ctx);
      preflightPinnedBatchCreate(ctx);
      plans.push({ source: ctx });
    }
    phase = 'package-recording-preflight';
    for (const plan of plans) {
      throwIfRequestCancelled(context.requestPolicy);
      if ('source' in plan) {
        const ctx = plan.source;
        const pkg =
          ctx.type === 'FUNC'
            ? await resolveFunctionGroupCreatePackage(ctx, String(ctx.args.group), ctx.args.package)
            : String(ctx.args.package);
        await checkPackage(safety, pkg, ctx.client.getPackageHierarchyResolver());
        await prepareCreationRecording(ctx, pkg);
      } else {
        // The definition may be an earlier explicit SRVD create; its native identity/recording
        // is proved by the binding adapter at execution, without inventing dependency expansion.
        const binding = preparePinnedBindingCreate(plan.binding);
        await checkPackage(safety, binding.pkg.name, mutationClient(client, context).getPackageHierarchyResolver());
      }
    }
    for (let i = 0; i < plans.length; i++) {
      throwIfRequestCancelled(context.requestPolicy);
      phase = 'create';
      const plan = plans[i],
        entry = entries[i];
      entry.create!.status = 'unconfirmed';
      let result: ToolResult;
      if ('source' in plan) result = await executePinnedSourceWrite(plan.source);
      else {
        const native = await createPinnedBinding(client, context, plan.binding, config.language);
        result = native.ok ? textResult(toolJson(native)) : errorResult(toolJson(native));
      }
      entry.create!.result = result;
      entry.create!.status = result.isError ? 'failed' : 'confirmed';
      if (result.isError) return finish(false);
      if (!activateAtEnd) {
        phase = 'activation';
        if (
          !(await activatePinnedBatchOwners(
            client,
            [input.objects[i]],
            context,
            [entry.activation],
            config.minimalErrors,
          ))
        )
          return finish(false);
      }
    }
    if (activateAtEnd) {
      phase = 'activation';
      if (
        !(await activatePinnedBatchOwners(
          client,
          input.objects,
          context,
          entries.map((entry) => entry.activation),
          config.minimalErrors,
        ))
      )
        return finish(false);
    }
    phase = 'complete';
    return finish(true);
  } catch (error) {
    return finish(
      false,
      error instanceof AdtSafetyError
        ? error.message
        : 'The batch stopped on unavailable evidence, cancellation or request failure.',
    );
  } finally {
    for (const ctx of contexts) forgetPinnedSourceContext(ctx);
  }
}
