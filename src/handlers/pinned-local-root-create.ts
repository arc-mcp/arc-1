/** Internal native-governed profile selected by authenticated pinned dispatch or bound qualification. */
import type { AdtClient } from '../adt/client.js';
import { DataResponseBudget } from '../adt/data-result-context.js';
import { AdtSafetyError } from '../adt/errors.js';
import { assertMutationContext, type PinnedMutationContext, pinnedMutationContext } from '../adt/mutation-context.js';
import { assertManagedProfileInput } from '../adt/pinned-managed-resources.js';
import { createPinnedPackage, type PinnedPackageCreateInput, pinnedPackageSelection } from '../adt/pinned-package.js';
import { createPinnedLocalRootProfile } from '../adt/pinned-package-root-profile.js';
import { RequestAttemptBudget } from '../adt/request-attempt-budget.js';
import { checkOperation, isPackageAllowed, OperationType } from '../adt/safety.js';
import { hasRequiredScope } from '../authz/policy.js';
import { getCurrentContext } from '../server/context.js';
import { isActionDenied } from '../server/deny-actions.js';
import { TARGET_ID_PATTERN } from '../server/multi-target-identity.js';
import { pinnedWriteEnabled } from '../server/multi-target-write-surface.js';
import type { ServerConfig } from '../server/types.js';
import { pinnedOperationResult } from './pinned-operation.js';
import type { ToolResult } from './shared.js';

class RootCreateAttempts extends RequestAttemptBudget {
  constructor(
    private readonly validate: () => void,
    private readonly parent?: RequestAttemptBudget,
  ) {
    super(16);
  }
  override consume(): void {
    this.validate();
    super.consume();
    this.parent?.consume();
  }
}

export async function executePrivatePinnedLocalRootCreate(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
  context: PinnedMutationContext,
  scopes: readonly string[],
  coverage: Readonly<Pick<ServerConfig, 'systemType' | 'abapRelease'>> = config,
): Promise<ToolResult> {
  const target = config.targetId;
  try {
    const input = Object.freeze(structuredClone(args));
    const selected = pinnedPackageSelection(input.name);
    const policy = context.recordingPolicy,
      safety = client.safety,
      http = client.http;
    const request = getCurrentContext(),
      principal = request?.user,
      identity = request?.identity;
    const rawScopes = [...scopes];
    const validate = () => {
      assertMutationContext(client.safety, context);
      assertManagedProfileInput('package-create', input);
      checkOperation(config, OperationType.Create, 'PinnedCreatePackage');
      if (
        !rawScopes.includes('write') ||
        !hasRequiredScope(rawScopes, 'read') ||
        !config.multiTargetEndpoints ||
        !pinnedWriteEnabled(config) ||
        !target ||
        !TARGET_ID_PATTERN.test(target) ||
        config.targetId !== target ||
        config.multiTargetWrite !== policy ||
        policy.target !== target ||
        client.safety !== safety ||
        client.http !== http ||
        client.sapClient !== target.split('/')[1] ||
        config.client !== client.sapClient ||
        getCurrentContext() !== request ||
        request?.user !== principal ||
        request?.identity !== identity ||
        identity === 'shared' ||
        (request?.target !== undefined && request.target !== target) ||
        input.superPackage !== undefined ||
        isActionDenied('SAPManage', 'create_package', [...config.denyActions, ...client.safety.denyActions])
      )
        throw new AdtSafetyError('Private LOCAL root creation is unavailable for this caller or selected target.');
      if (!isPackageAllowed({ ...client.safety, allowedPackages: config.allowedPackages }, selected.name))
        throw new AdtSafetyError('The server configuration must authorize the actual future root name.');
    };
    validate();
    if (context.requestPolicy.deadline > Date.now() + 60_000)
      throw new AdtSafetyError('Private LOCAL root creation requires a deadline of at most one minute.');
    const responseBudget =
      context.requestPolicy.responseBudget ?? new DataResponseBudget(4 * 1024 * 1024, 'package-root', true);
    if (!responseBudget.countAllResponses || responseBudget.limitBytes > 4 * 1024 * 1024)
      throw new AdtSafetyError('Private LOCAL root creation requires an all-response allowance of at most 4 MiB.');
    let assertProfile = validate;
    const scoped = pinnedMutationContext(
      client.safety,
      {
        deadline: context.requestPolicy.deadline,
        signal:
          request?.signal && request.signal !== context.requestPolicy.signal
            ? AbortSignal.any([request.signal, ...(context.requestPolicy.signal ? [context.requestPolicy.signal] : [])])
            : context.requestPolicy.signal,
        responseBudget,
        attemptBudget: new RootCreateAttempts(() => assertProfile(), context.requestPolicy.attemptBudget),
      },
      context.cleanup,
    );
    const profile = createPinnedLocalRootProfile(client, scoped, selected.name, coverage, validate);
    assertProfile = profile.assert;
    return pinnedOperationResult(
      await createPinnedPackage(
        client,
        scoped,
        input as unknown as PinnedPackageCreateInput,
        { cloud: false, abapRelease: '758' },
        profile,
      ),
      { ...config, targetId: target },
      { action: 'create_package', name: selected.name },
    );
  } catch (error) {
    return pinnedOperationResult(
      {
        ok: false,
        state: 'unchanged',
        phase: 'validation',
        retryable: false,
        message:
          error instanceof AdtSafetyError ? error.message : 'Private LOCAL root admission could not be established.',
      },
      { ...config, targetId: target },
      { action: 'create_package' },
    );
  }
}
