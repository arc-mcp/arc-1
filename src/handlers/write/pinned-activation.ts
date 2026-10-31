/** Whole-owner activation with an explicit reference validator carried to the confirmation boundary. */
import type { AdtClient } from '../../adt/client.js';
import { activate } from '../../adt/devtools.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { mutationClient } from '../../adt/mutation-client.js';
import { pinnedMutationContext } from '../../adt/mutation-context.js';
import { assertPinnedOwner, pinnedRecording } from '../../adt/pinned-write-policy.js';
import { checkOperation, OperationType } from '../../adt/safety.js';
import { getCurrentContext } from '../../server/context.js';
import { objectUrlForType } from '../object-types.js';
import { errorResult, type ToolResult, textResult, toolJson } from '../shared.js';
import { enforceAllowedPackageForObjectUrl } from '../write-helpers.js';
import { pinnedFailure } from './pinned-result.js';

export function validatePinnedActivationReferences(
  owner: string,
  type: 'CLAS' | 'INTF',
  refs: readonly { uri: string }[],
): void {
  const allowed = new Set([owner]);
  if (type === 'CLAS')
    for (const include of ['definitions', 'implementations', 'macros', 'testclasses'])
      allowed.add(`${owner}/includes/${include}`);
  if (refs.length === 0 || refs.length > 5 || refs.some((ref) => !allowed.has(ref.uri))) {
    throw new AdtSafetyError(
      'Activation includes an unqualified reference or another owner. No confirmation was sent. Review the complete activation scope in ADT.',
    );
  }
}

export async function handlePinnedActivation(client: AdtClient, args: Record<string, unknown>): Promise<ToolResult> {
  let submitted = false;
  try {
    checkOperation(client.safety, OperationType.Activate, 'PinnedActivate');
    if (!client.safety.multiTargetWrite?.enabled) throw new AdtSafetyError('Pinned activation is not authorized.');
    const { type, name } = args;
    assertPinnedOwner(type, name);
    if ((args.action ?? 'activate') !== 'activate' || args.objects !== undefined || args.preaudit === false)
      throw new AdtSafetyError('Only whole-owner preaudited activation is allowed.');
    const owner = objectUrlForType(type, (name as string).toLowerCase());
    const context = pinnedMutationContext(
      client.safety,
      {
        deadline: Date.now() + 300_000,
        signal: getCurrentContext()?.signal,
      },
      { unlockFailed: false },
    );
    client = mutationClient(client, context);
    const requestOptions = context.requestPolicy;
    // The activation engine can create a child budget, but its HTTP/CSRF calls
    // must never extend the outer preflight-to-confirmation deadline.
    const http = client.http;
    const pkg = await enforceAllowedPackageForObjectUrl(client, owner, 'Pinned activation', undefined, requestOptions);
    if (!pkg) throw new AdtSafetyError('Owner package is unresolved.');
    await pinnedRecording(http, client.safety, owner, pkg, '', undefined, requestOptions);
    const result = await activate(http, client.safety, owner, {
      name: name as string,
      validateReferences: async (refs) => {
        validatePinnedActivationReferences(owner, type, refs);
        const currentPackage = await enforceAllowedPackageForObjectUrl(
          client,
          owner,
          'Pinned activation scope',
          undefined,
          requestOptions,
        );
        if (currentPackage !== pkg) throw new AdtSafetyError('Owner package changed before activation.');
        await pinnedRecording(http, client.safety, owner, pkg, '', undefined, requestOptions);
      },
      beforeSubmit: () => {
        submitted = true;
      },
    });
    const payload = toolJson({
      target: context.recordingPolicy.target,
      type,
      name,
      action: 'activate',
      ...result,
      retryable: false,
      scope: 'complete-owner-including-existing-inactive-includes',
    });
    return result.success ? textResult(payload) : errorResult(payload);
  } catch (error) {
    return pinnedFailure(error, submitted ? 'activation-not-confirmed' : 'unchanged', 'activation');
  }
}
