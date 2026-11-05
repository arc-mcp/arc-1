/** Public route selection only. Existing adapters own all native orchestration and result semantics. */
import { AdtSafetyError } from '../adt/errors.js';
import { isMutatingOperationType } from '../adt/safety.js';
import { getActionPolicy, hasRequiredScope } from '../authz/policy.js';
import type { ToolDispatchContext } from '../registry/tool-registry.js';
import { getCurrentContext } from '../server/context.js';
import { isTargetGranted, parseTargetGrant } from '../server/multi-target-authorization.js';
import { pinnedCompanionAllowed, pinnedMutationAllowed } from '../server/multi-target-write-surface.js';
import { pinnedCompanionCapability, pinnedMutationCapability } from '../server/pinned-mutation-capabilities.js';
import { getCachedFeatures } from './feature-cache.js';
import { pinnedOperationContext, pinnedOperationResult } from './pinned-operation.js';
import type { ToolResult } from './shared.js';

function selectedEnvironment(ctx: ToolDispatchContext, only758 = false) {
  const native = getCachedFeatures(ctx.config.targetId);
  if (
    !native?.abapRelease ||
    (only758 && (native.abapRelease !== '758' || native.systemType !== 'onprem' || native.systemTypeSource !== 'probe'))
  )
    throw new AdtSafetyError(
      'This adapter requires selected-target native platform evidence; the configured release override is insufficient.',
    );
  return { cloud: native.systemType === 'btp', abapRelease: native.abapRelease };
}

/** Internal profile coverage comes from the validated target, never the compatibility config. */
function selectedNativeCoverage(ctx: ToolDispatchContext) {
  const { abapRelease } = selectedEnvironment(ctx, true);
  return Object.freeze({ systemType: 'onprem' as const, abapRelease });
}

/** Connection projection is necessary but cannot replace raw scope and exact verified grant checks. */
function authorize(ctx: ToolDispatchContext, tool: string, companion: boolean): readonly string[] {
  const { config, client, authInfo, args } = ctx;
  const raw = authInfo?.extra?.arc1VerifiedRawScopes;
  if (
    !Array.isArray(raw) ||
    !raw.every((scope) => typeof scope === 'string') ||
    !raw.includes('write') ||
    !hasRequiredScope(authInfo?.scopes ?? [], 'read') ||
    (!companion && !hasRequiredScope(authInfo?.scopes ?? [], 'write')) ||
    !config.multiTargetEndpoints ||
    config.multiTargetAuthorization !== 'xsuaa-attribute' ||
    config.toolMode !== 'standard' ||
    !config.targetId ||
    !config.ppEnabled ||
    !config.ppStrict ||
    !ctx.isPerUserClient ||
    getCurrentContext()?.identity === 'shared' ||
    client.sapClient !== config.targetId.split('/')[1] ||
    config.client !== client.sapClient ||
    !isTargetGranted(parseTargetGrant(authInfo), config.targetId) ||
    !isTargetGranted(parseTargetGrant(authInfo, 'arc1_write_targets'), config.targetId) ||
    !(companion ? pinnedCompanionAllowed(tool, args, config) : pinnedMutationAllowed(tool, args, config))
  )
    throw new AdtSafetyError(
      'This operation requires the selected strict-PP target, raw write scope, and exact verified read/write grants.',
    );
  return [...raw] as string[];
}

export async function dispatchPinnedOperation(tool: string, ctx: ToolDispatchContext): Promise<ToolResult | undefined> {
  ctx = { ...ctx, args: Object.fromEntries(Object.entries(ctx.args).filter(([, value]) => value !== undefined)) };
  const { client, config, args } = ctx;
  if (!config.targetId && !config.multiTargetWrite) return;
  const action = String(args.action ?? (tool === 'SAPActivate' ? 'activate' : ''));
  const companion = !!pinnedCompanionCapability(tool, action);
  if (!companion && !pinnedMutationCapability(tool, action)) {
    const policy = getActionPolicy(tool, action);
    if (tool === 'SAPGit' || tool.startsWith('Custom_') || (policy && isMutatingOperationType(policy.opType)))
      throw new AdtSafetyError('This operation has no admitted pinned adapter.');
    return;
  }
  let scopes: readonly string[];
  try {
    scopes = authorize(ctx, tool, companion);
  } catch {
    return pinnedOperationResult(
      {
        ok: false,
        state: 'unchanged',
        phase: 'validation',
        retryable: false,
        message:
          'Operation is unavailable: the selected strict-PP target, raw write scope, and exact verified read/write grants are required.',
      },
      config,
      { action },
    );
  }

  if (tool === 'SAPTransport')
    return (await import('./pinned-cts.js')).handlePrivatePinnedCts(client, config, args, scopes);
  if (tool === 'SAPDiagnose' && action === 'apply_quickfix')
    return (await import('./pinned-quickfix.js')).executePrivatePinnedQuickfix(client, args, config, scopes);
  if (tool === 'SAPWrite') {
    if (action === 'batch_create')
      return (await import('./write/pinned-batches.js')).handlePrivatePinnedBatchCreate(client, config, args, scopes);
    if (['scaffold_rap_handlers', 'generate_behavior_implementation'].includes(action))
      return (await import('./write/pinned-rap.js')).handlePrivatePinnedRap(client, config, args, scopes);
    if (['ENHO', 'SKTD'].includes(String(args.type))) {
      const context = pinnedOperationContext(client, config, { tool, args, timeoutMs: 300_000, attempts: 64 });
      return (await import('./write/pinned-document-write.js')).handlePrivatePinnedDocumentWrite(
        client,
        args,
        config,
        context,
      );
    }
    if (args.type === 'SRVB') {
      const context = pinnedOperationContext(client, config, { tool, args, timeoutMs: 300_000 });
      const { action: _action, type: _type, ...input } = args;
      const adapter = await import('../adt/pinned-service-binding.js');
      const result =
        action === 'create'
          ? await adapter.createPinnedBinding(client, context, input, config.language)
          : action === 'update'
            ? await adapter.updatePinnedBinding(client, context, input)
            : await adapter.deletePinnedBinding(client, context, input);
      return pinnedOperationResult(result, config, { action, type: 'SRVB', name: String(args.name) });
    }
    return (await import('./write/pinned-source-write.js')).handlePinnedSourceWrite(client, args, config);
  }
  if (tool === 'SAPActivate') {
    if (action === 'activate')
      return args.objects !== undefined
        ? (await import('./write/pinned-batches.js')).handlePrivatePinnedBatchActivation(client, config, args, scopes)
        : (await import('./write/pinned-activation.js')).handlePinnedActivation(client, args, config.minimalErrors);
    const coverage = selectedNativeCoverage(ctx);
    const context = pinnedOperationContext(client, config, {
      tool,
      args,
      timeoutMs: 300_000,
      responseBytes: 4 * 1024 * 1024,
    });
    return (await import('./pinned-publication-native-governed.js')).executePrivatePinnedNativeGovernedPublication(
      client,
      {
        action,
        bindings: [
          {
            name: args.name,
            version: args.version,
            serviceType: args.service_type,
            expectedMetadataHash: args.expectedMetadataHash,
          },
        ],
      },
      config,
      context,
      scopes,
      coverage,
    );
  }
  if (tool === 'SAPManage' && action.startsWith('flp_') && !companion) {
    const coverage = selectedNativeCoverage(ctx);
    const context = pinnedOperationContext(client, config, { tool, args, timeoutMs: 60_000 });
    return (await import('./pinned-flp-native-recording.js')).executePrivatePinnedNativeGovernedFlp(
      client,
      args,
      config,
      context,
      scopes,
      coverage,
    );
  }
  if (tool === 'SAPManage' && !companion) {
    const context = pinnedOperationContext(client, config, {
      tool,
      args,
      timeoutMs: 60_000,
      ...(action === 'create_package' && args.superPackage === undefined
        ? { responseBytes: 4 * 1024 * 1024, attempts: 16 }
        : {}),
    });
    const { action: _action, ...input } = args;
    let result: { ok: boolean; state: string };
    if (action === 'create_package') {
      const environment = selectedEnvironment(ctx);
      if (input.superPackage === undefined) {
        const coverage = selectedNativeCoverage(ctx);
        return (await import('./pinned-local-root-create.js')).executePrivatePinnedLocalRootCreate(
          client,
          input,
          config,
          context,
          scopes,
          coverage,
        );
      }
      result = await (await import('../adt/pinned-package.js')).createPinnedPackage(
        client,
        context,
        {
          name: input.name,
          description: input.description,
          superPackage: input.superPackage,
          responsible: input.responsible,
          softwareComponent: input.softwareComponent,
          transportLayer: input.transportLayer,
          packageType: input.packageType,
          recordChanges: input.recordChanges,
          transport: input.transport,
        },
        environment,
      );
    } else if (action === 'delete_package') {
      result = await (await import('../adt/pinned-package.js')).deletePinnedPackage(
        client,
        context,
        { name: input.name, transport: input.transport },
        selectedEnvironment(ctx, true),
      );
    } else if (action === 'change_package') {
      result = await (await import('../adt/pinned-package-move.js')).movePinnedObjectPackage(client, context, {
        objectName: input.objectName,
        objectType: input.objectType,
        oldPackage: input.oldPackage,
        newPackage: input.newPackage,
        transport: input.transport,
      });
    } else if (action === 'set_api_state') {
      result = await (await import('../adt/pinned-api-release.js')).setPinnedApiReleaseState(client, context, {
        type: input.type,
        name: input.name,
        group: input.group,
        contract: input.contract,
        apiState: input.apiState,
        expectedCurrentState: input.expectedCurrentState,
        apiVisibility: input.apiVisibility,
        transport: input.transport,
      });
    } else throw new AdtSafetyError('No pinned native adapter is registered for this action.');
    return pinnedOperationResult(result, config, { action, name: String(args.name ?? args.objectName) });
  }
  // Existing bounded trace, formatter, FLP reads and selected-runtime feature/cache readers.
  return;
}
