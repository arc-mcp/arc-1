/** Private RAP qualification entry. Public dispatch and capability rows remain closed. */
import type { AdtClient } from '../../adt/client.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { mutationClient } from '../../adt/mutation-client.js';
import { type MutationCleanupState, pinnedMutationContext } from '../../adt/mutation-context.js';
import { rapOwner } from '../../adt/pinned-rap-evidence.js';
import { registerRapProfile } from '../../adt/rap-profile.js';
import { checkOperation, deriveUserSafety, OperationType } from '../../adt/safety.js';
import { getCurrentContext } from '../../server/context.js';
import { isActionDenied } from '../../server/deny-actions.js';
import { pinnedWriteEnabled } from '../../server/multi-target-write-surface.js';
import type { ServerConfig } from '../../server/types.js';
import { getCachedFeatures } from '../feature-cache.js';
import { errorResult, type ToolResult, textResult, toolJson } from '../shared.js';
import type { SapWriteContext } from './context.js';
import { pinnedRapRuntime } from './pinned-rap-runtime.js';
import { writeActionGenerateBehaviorImplementation, writeActionScaffoldRapHandlers } from './rap.js';

function input(raw: unknown): Readonly<Record<string, unknown>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AdtSafetyError('RAP requires an object input.');
  const args = raw as Record<string, unknown>,
    generate = args.action === 'generate_behavior_implementation';
  const fields = new Set([
    'action',
    'type',
    'name',
    'bdefName',
    'targetAlias',
    'transport',
    ...(generate ? ['dryRun', 'activate'] : ['autoApply', 'lintBeforeWrite']),
  ]);
  if (
    (!generate && args.action !== 'scaffold_rap_handlers') ||
    args.type !== 'CLAS' ||
    Object.keys(args).some((key) => !fields.has(key))
  )
    throw new AdtSafetyError(
      'The private RAP profile accepts only its exact CLAS action fields; caller source/hash/owner overrides are unsupported.',
    );
  for (const key of ['name', 'bdefName']) {
    if (key === 'bdefName' && generate && args[key] === undefined) continue;
    if (typeof args[key] !== 'string' || !/^[A-Z][A-Z0-9_]{0,29}$/.test(args[key] as string))
      throw new AdtSafetyError(
        'The private RAP parser currently requires exact uppercase class and BDEF names; namespaces remain unqualified.',
      );
  }
  if (
    args.targetAlias !== undefined &&
    (typeof args.targetAlias !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,29}$/.test(args.targetAlias))
  )
    throw new AdtSafetyError('RAP alias must be one exact identifier.');
  if (args.transport !== undefined && (typeof args.transport !== 'string' || !/^[A-Z0-9]{1,20}$/.test(args.transport)))
    throw new AdtSafetyError('Select one exact native recording request.');
  for (const key of ['dryRun', 'activate', 'autoApply', 'lintBeforeWrite'])
    if (args[key] !== undefined && typeof args[key] !== 'boolean')
      throw new AdtSafetyError('RAP flags must be booleans.');
  return Object.freeze({ ...args });
}

/** Scopes are supplied by the authenticated internal harness, never by tool arguments. */
export async function handlePrivatePinnedRap(
  original: AdtClient,
  config: ServerConfig,
  raw: unknown,
  scopes: readonly string[],
): Promise<ToolResult> {
  let dispose: (() => void) | undefined;
  let runtime: ReturnType<typeof pinnedRapRuntime> | undefined;
  const cleanup: MutationCleanupState = { unlockFailed: false };
  let args: Readonly<Record<string, unknown>> | undefined;
  let report: unknown;
  const finish = (ok: boolean, error?: unknown) => {
    const details = runtime?.state;
    const payload = toolJson({
      target: config.targetId,
      action: args?.action,
      name: args?.name,
      ok,
      state: ok
        ? details?.activation.status === 'confirmed'
          ? 'activated'
          : details?.submitted
            ? 'saved-inactive'
            : 'unchanged'
        : details?.submitted
          ? 'incomplete'
          : 'unchanged',
      retryable: false,
      atomic: false,
      phase: details?.phase ?? 'admission',
      sections: details?.sections,
      dependency: details?.dependency,
      observedOwner: details?.observedOwner,
      activation: details?.activation
        ? {
            ...details.activation,
            ...(details.activation.result && Buffer.byteLength(JSON.stringify(details.activation.result)) > 64 * 1024
              ? { result: { omitted: true, reason: 'Native activation diagnostics exceeded the 64 KiB report bound.' } }
              : {}),
          }
        : undefined,
      cleanup,
      ...(report === undefined ? {} : { report }),
      ...(error
        ? {
            message:
              error instanceof AdtSafetyError
                ? error.message
                : 'RAP stopped on unavailable evidence, cancellation or request failure; inspect each section before continuing.',
          }
        : {}),
      sourceSemantics:
        'Observed editable sources, freshly planned under the class lock for mutations; no caller multi-source hash and no atomic BDEF snapshot.',
      activationScope: 'Whole class, including preexisting inactive includes; other owners are not selected.',
      next: ok
        ? 'Inspect the reported native sources and activation evidence. This private profile is not public/native/PP qualification.'
        : 'Inspect the reported partial states and owning-lock cleanup. No rollback, repair or automatic retry was attempted.',
    });
    return ok ? textResult(payload) : errorResult(payload);
  };
  try {
    args = input(raw);
    const safety = deriveUserSafety(original.safety, [...scopes]);
    const activate =
      args.action === 'generate_behavior_implementation' && args.dryRun !== true && args.activate !== false;
    if (
      !scopes.includes('write') ||
      !pinnedWriteEnabled(config) ||
      !config.multiTargetEndpoints ||
      !config.targetId ||
      !safety.allowWrites ||
      !safety.multiTargetWrite?.enabled ||
      safety.multiTargetWrite.target !== config.targetId ||
      config.multiTargetWrite?.target !== config.targetId
    )
      throw new AdtSafetyError('Private RAP is unavailable for this caller or selected strict-PP target.');
    const denials = [...safety.denyActions, ...config.denyActions];
    if (
      isActionDenied('SAPWrite', args.action as string, denials) ||
      isActionDenied('SAPWrite', 'update', denials) ||
      (activate && isActionDenied('SAPActivate', 'activate', denials))
    )
      throw new AdtSafetyError('RAP or its nested mutation is denied by policy.');
    if (config.featureRap === 'off' || getCachedFeatures(config.targetId)?.rap?.available !== true)
      throw new AdtSafetyError('RAP availability has not been established for this selected target.');
    checkOperation(safety, OperationType.Update, 'PinnedRap');
    const context = pinnedMutationContext(
      safety,
      { deadline: Date.now() + 300_000, signal: getCurrentContext()?.signal },
      cleanup,
    );
    const client = mutationClient(original.withSafety(safety), context);
    runtime = pinnedRapRuntime(client, config, args, context);
    dispose = registerRapProfile(client, runtime.profile);
    const owner = rapOwner(args.name as string);
    const ctx: SapWriteContext = {
      mutationContext: context,
      client,
      args,
      config,
      cachingLayer: undefined,
      cacheSecurity: { isPerUserClient: true },
      type: 'CLAS',
      name: args.name as string,
      source: '',
      hasSource: false,
      include: undefined,
      includeProvided: false,
      transport: args.transport as string | undefined,
      lintOverride: args.lintBeforeWrite as boolean | undefined,
      preflightOverride: undefined,
      checkOverride: undefined,
      objectUrl: owner,
      srcUrl: `${owner}/source/main`,
      invalidateWrittenObject: () => {},
      enforcePackageForExistingObject: runtime.preflight,
    };
    const result = await (args.action === 'generate_behavior_implementation'
      ? writeActionGenerateBehaviorImplementation(ctx)
      : writeActionScaffoldRapHandlers(ctx));
    // Keep the shared action's diagnostics bounded; the journal, not prose, determines persistence.
    const body = result.content.map((part) => part.text).join('\n');
    report =
      Buffer.byteLength(body) <= 64 * 1024
        ? body
        : 'The shared RAP report exceeded its result bound; inspect the per-section journal.';
    if (result.isError || cleanup.unlockFailed || cleanup.sessionClosed === false || cleanup.unknownLocks?.length)
      return finish(false);
    runtime.state.phase = 'complete';
    return finish(true);
  } catch (error) {
    return finish(false, error);
  } finally {
    dispose?.();
  }
}
