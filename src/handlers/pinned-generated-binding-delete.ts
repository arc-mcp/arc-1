/** Private, source-covered whole-parent deletion. No public capability or caller bypass flag. */
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { hasExplicitUnrestrictedPackagePolicy, hasExplicitUnrestrictedRequestPolicy } from '../adt/allowlist-policy.js';
import type { AdtClient } from '../adt/client.js';
import { DataResponseBudget } from '../adt/data-result-context.js';
import { AdtSafetyError } from '../adt/errors.js';
import { assertMutationContext, type PinnedMutationContext, pinnedMutationContext } from '../adt/mutation-context.js';
import { deletePinnedOwner, type PinnedDeleteResult } from '../adt/pinned-delete.js';
import { normalizePinnedRequest } from '../adt/pinned-managed-resources.js';
import { pinnedBindingSelection, readPinnedBinding } from '../adt/pinned-service-binding-owner.js';
import { RequestAttemptBudget } from '../adt/request-attempt-budget.js';
import { hasRequiredScope } from '../authz/policy.js';
import { getCurrentContext } from '../server/context.js';
import { isActionDenied } from '../server/deny-actions.js';
import { isTargetGranted, parseTargetGrant } from '../server/multi-target-authorization.js';
import { TARGET_ID_PATTERN } from '../server/multi-target-identity.js';
import { pinnedWriteEnabled } from '../server/multi-target-write-surface.js';
import type { ServerConfig } from '../server/types.js';
import { pinnedOperationResult } from './pinned-operation.js';
import type { ToolResult } from './shared.js';

/** Transport handoff counts, not observer intents or successful native effects. */
class GeneratedDeleteAttempts extends RequestAttemptBudget {
  deletes = 0;
  constructor(
    private readonly validate: () => void,
    private readonly parent?: RequestAttemptBudget,
  ) {
    super(64);
  }
  override consume(): void {
    this.validate();
    super.consume();
    this.parent?.consume();
    this.validate(); // The enclosing proof can synchronously revoke authority too.
  }
  override dispatched = (method: string) => {
    if (method === 'DELETE') this.deletes++;
    this.parent?.dispatched?.(method);
  };
}

/**
 * authInfo comes from the verified HTTP boundary, never tool input. This entry does not verify JWTs
 * or create a mapped-user client. Its source coverage is the captured A4H 758 standard V4 chain,
 * not evidence of a target's native behavior, PP mapping or universal cloud/frontend semantics.
 */
export async function executePrivatePinnedGeneratedBindingDelete(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
  context: PinnedMutationContext,
  authInfo: AuthInfo,
): Promise<ToolResult> {
  const target = config.targetId;
  let attempts: GeneratedDeleteAttempts | undefined;
  let name: string | undefined;
  let implementation: string | undefined;
  const finish = (result: PinnedDeleteResult) => {
    const submitted = attempts?.deletes ?? 0;
    return pinnedOperationResult(
      {
        ...result,
        // Parent absence is an independent fact; it does not prove generated G4BA/SUSH cleanup.
        state: result.state === 'deleted' ? 'accepted-unverified' : result.state,
        parentState: result.state,
        submitted,
        generatedCleanup: !submitted
          ? 'not-submitted'
          : result.state === 'deleted' || result.phase === 'absence-readback'
            ? 'accepted-unverified'
            : 'unknown',
        recording: attempts?.used ? 'native-governed-unverified' : 'not-established',
        implementation,
        scope: 'Whole selected SRVB parent and its native-owned generated V4 group; no SRVD or child DELETE.',
        observations:
          'Typed parent absence does not verify generated persistence, frontend aliases, cloud BAdI effects or CTS bookkeeping. Native refusal can follow partial effects; no automatic compensation or replay.',
        ...(config.minimalErrors && result.message
          ? { message: 'Private binding deletion did not complete; inspect the operator audit.' }
          : {}),
      },
      { ...config, targetId: target },
      { action: 'delete', type: 'SRVB', name },
    );
  };
  try {
    const input = structuredClone(args);
    if (
      Object.keys(input).some((key) => !['name', 'expectedMetadataHash', 'transport'].includes(key)) ||
      typeof input.expectedMetadataHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(input.expectedMetadataHash)
    )
      throw new AdtSafetyError(
        'Generated binding deletion requires only an exact name, fresh metadata hash and optional parent transport.',
      );
    const selected = pinnedBindingSelection(input.name);
    name = selected.name;
    const transport = normalizePinnedRequest(input.transport);
    const policy = context.recordingPolicy;
    const request = getCurrentContext();
    const originalUser = request?.user;
    const originalClient = authInfo.clientId;
    const originalToken = authInfo.token;
    const originalRequestId = request?.requestId;
    const originalDestination = request?.destination;
    const validate = () => {
      assertMutationContext(client.safety, context);
      const raw = Object.getOwnPropertyDescriptor(authInfo.extra ?? {}, 'arc1VerifiedRawScopes')?.value;
      if (
        !Array.isArray(raw) ||
        !Array.from(raw).every((scope) => typeof scope === 'string') ||
        !raw.includes('write') ||
        !hasRequiredScope(authInfo.scopes, 'write') ||
        !hasRequiredScope(authInfo.scopes, 'read') ||
        authInfo.clientId !== originalClient ||
        authInfo.token !== originalToken ||
        (authInfo.expiresAt !== undefined &&
          (!Number.isFinite(authInfo.expiresAt) || authInfo.expiresAt * 1000 <= Date.now())) ||
        !isTargetGranted(parseTargetGrant(authInfo), target ?? '') ||
        !isTargetGranted(parseTargetGrant(authInfo, 'arc1_write_targets'), target ?? '') ||
        !config.multiTargetEndpoints ||
        config.multiTargetAuthorization !== 'xsuaa-attribute' ||
        config.toolMode !== 'standard' ||
        !pinnedWriteEnabled(config) ||
        !client.safety.allowWrites ||
        config.systemType !== 'onprem' ||
        config.abapRelease !== '758' ||
        !target ||
        !TARGET_ID_PATTERN.test(target) ||
        config.targetId !== target ||
        config.multiTargetWrite !== policy ||
        policy.target !== target ||
        client.sapClient !== target.split('/')[1] ||
        config.client !== client.sapClient ||
        !request ||
        request.identity !== 'per-user' ||
        request.target !== target ||
        request.user !== originalUser ||
        getCurrentContext() !== request ||
        request.requestId !== originalRequestId ||
        request.destination !== originalDestination ||
        !hasExplicitUnrestrictedPackagePolicy(config.allowedPackages) ||
        !hasExplicitUnrestrictedPackagePolicy(client.safety.allowedPackages) ||
        !hasExplicitUnrestrictedPackagePolicy(policy.allowedPackages) ||
        !hasExplicitUnrestrictedRequestPolicy(policy.serverAllowedTransports) ||
        !hasExplicitUnrestrictedRequestPolicy(policy.allowedTransports) ||
        isActionDenied('SAPWrite', 'delete', [...config.denyActions, ...client.safety.denyActions])
      )
        throw new AdtSafetyError(
          'Private generated V4 deletion requires a verified exact strict-PP target grant and explicit unrestricted server and destination package/request policies.',
        );
    };
    validate();
    if (context.requestPolicy.deadline > Date.now() + 180_000)
      throw new AdtSafetyError('Private generated binding deletion requires a deadline of at most three minutes.');
    const responseBudget =
      context.requestPolicy.responseBudget ?? new DataResponseBudget(2 * 1024 * 1024, 'generated-binding-delete', true);
    if (!responseBudget.countAllResponses || responseBudget.limitBytes > 2 * 1024 * 1024)
      throw new AdtSafetyError(
        'Private generated binding deletion requires an all-response allowance of at most 2 MiB.',
      );
    attempts = new GeneratedDeleteAttempts(validate, context.requestPolicy.attemptBudget);
    const scoped = pinnedMutationContext(
      client.safety,
      {
        deadline: context.requestPolicy.deadline,
        signal:
          request?.signal && request.signal !== context.requestPolicy.signal
            ? AbortSignal.any([request.signal, ...(context.requestPolicy.signal ? [context.requestPolicy.signal] : [])])
            : context.requestPolicy.signal,
        responseBudget,
        attemptBudget: attempts,
      },
      context.cleanup,
    );
    const result = await deletePinnedOwner(
      client,
      scoped,
      { type: 'SRVB', name, transport },
      {
        owner: selected.objectUrl,
        packageFor: async (active) => {
          const binding = await readPinnedBinding(active, selected);
          if (
            binding.metadataHash !== input.expectedMetadataHash ||
            binding.nativeVersion !== 'active' ||
            binding.inactiveAlternative ||
            binding.bindingCreated !== true ||
            binding.published !== false ||
            binding.bindingType !== 'ODATA' ||
            binding.odataVersion !== 'V4' ||
            !['0', '1'].includes(binding.category ?? '') ||
            binding.implementation !== name ||
            binding.services.length !== 1 ||
            !binding.services[0]?.name ||
            !/^\d{4}$/.test(binding.services[0]?.version ?? '') ||
            !binding.services[0]?.serviceDefinition
          )
            throw new AdtSafetyError(
              'Generated deletion requires unchanged active, explicitly unpublished ODATA/V4 metadata, one native service version and an implementation matching the selected parent.',
            );
          implementation = binding.implementation;
          return binding.packageName;
        },
      },
    );
    return finish(result);
  } catch (error) {
    return finish({
      ok: false,
      state: attempts?.deletes ? 'delete-unconfirmed' : 'unchanged',
      phase: 'admission',
      retryable: false,
      message:
        error instanceof AdtSafetyError
          ? error.message
          : 'Private generated binding deletion could not establish its outcome.',
    });
  }
}
