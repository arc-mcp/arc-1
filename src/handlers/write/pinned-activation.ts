/** Whole-owner activation with an explicit reference validator carried to the confirmation boundary. */
import type { AdtClient } from '../../adt/client.js';
import { activate } from '../../adt/devtools.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { mutationClient } from '../../adt/mutation-client.js';
import { pinnedMutationContext } from '../../adt/mutation-context.js';
import { verifyPinnedProgramOwner } from '../../adt/pinned-program-owner.js';
import { assertPinnedSourceOwner, pinnedRecording } from '../../adt/pinned-write-policy.js';
import { checkOperation, OperationType } from '../../adt/safety.js';
import { readOwnedTextPoolState } from '../../adt/text-elements.js';
import { getCurrentContext } from '../../server/context.js';
import { objectUrlForType } from '../object-types.js';
import { errorResult, type ToolResult, textResult, toolJson } from '../shared.js';
import { enforceAllowedPackageForObjectUrl } from '../write-helpers.js';
import { pinnedFailure } from './pinned-result.js';

export function validatePinnedActivationReferences(
  owner: string,
  type: 'CLAS' | 'INTF' | 'PROG' | 'INCL',
  refs: readonly { uri: string }[],
): void {
  const allowed = new Set([owner]);
  if (type === 'CLAS')
    for (const include of ['definitions', 'implementations', 'macros', 'testclasses'])
      allowed.add(`${owner}/includes/${include}`);
  if (type === 'PROG') {
    const encodedName = owner.slice(owner.lastIndexOf('/') + 1);
    allowed.add(`/sap/bc/adt/textelements/programs/${encodedName}`);
    allowed.add(
      `/sap/bc/adt/textelements/programs/${encodeURIComponent(decodeURIComponent(encodedName).toUpperCase())}`,
    );
  }
  if (
    refs.length === 0 ||
    refs.length > (type === 'CLAS' ? 5 : type === 'PROG' ? 2 : 1) ||
    new Set(refs.map((ref) => ref.uri.toLowerCase())).size !== refs.length ||
    refs.some((ref) => !allowed.has(ref.uri))
  ) {
    throw new AdtSafetyError(
      'Activation includes an unqualified reference or another owner. No confirmation was sent. Review the complete activation scope in ADT.',
    );
  }
}

export async function handlePinnedActivation(client: AdtClient, args: Record<string, unknown>): Promise<ToolResult> {
  let submitted = false;
  let poolIncluded = false;
  let nativeReported = false;
  let phase = 'activation';
  try {
    checkOperation(client.safety, OperationType.Activate, 'PinnedActivate');
    if (!client.safety.multiTargetWrite?.enabled) throw new AdtSafetyError('Pinned activation is not authorized.');
    const { type, name } = args;
    assertPinnedSourceOwner(type, name);
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
    const nativePackage = await verifyPinnedProgramOwner(client, owner);
    const pkg =
      nativePackage ??
      (await enforceAllowedPackageForObjectUrl(client, owner, 'Pinned activation', undefined, requestOptions));
    if (!pkg) throw new AdtSafetyError('Owner package is unresolved or inconsistent.');
    await pinnedRecording(http, client.safety, owner, pkg, '', undefined, requestOptions);
    const result = await activate(http, client.safety, owner, {
      name: name as string,
      validateReferences: async (refs) => {
        validatePinnedActivationReferences(owner, type, refs);
        if (type === 'PROG' && refs.some((ref) => ref.uri.startsWith('/sap/bc/adt/textelements/programs/'))) {
          await readOwnedTextPoolState(http, 'PROG', name as string);
          poolIncluded = true;
        }
        const nativePackage = await verifyPinnedProgramOwner(client, owner);
        const currentPackage =
          nativePackage ??
          (await enforceAllowedPackageForObjectUrl(
            client,
            owner,
            'Pinned activation scope',
            undefined,
            requestOptions,
          ));
        if (currentPackage !== pkg) throw new AdtSafetyError('Owner package changed before activation.');
        await pinnedRecording(http, client.safety, owner, pkg, '', undefined, requestOptions);
      },
      beforeSubmit: () => {
        submitted = true;
      },
    });
    nativeReported = result.success;
    if (result.success && poolIncluded) {
      phase = 'text-pool-verification';
      if ((await readOwnedTextPoolState(http, 'PROG', name as string)) !== 'active')
        throw new AdtSafetyError('SAP reported activation, but the selected program text pool is still inactive.');
    }
    const payload = toolJson({
      target: context.recordingPolicy.target,
      type,
      name,
      action: 'activate',
      ...result,
      retryable: false,
      ...(poolIncluded && result.success ? { textPoolState: 'active' } : {}),
      scope:
        type === 'PROG'
          ? 'selected-program-with-native-owned-text-pool-expansion'
          : type === 'INCL'
            ? 'selected-standalone-include-only'
            : 'complete-owner-including-existing-inactive-includes',
    });
    return result.success ? textResult(payload) : errorResult(payload);
  } catch (error) {
    return pinnedFailure(error, submitted ? 'activation-not-confirmed' : 'unchanged', phase, false, {
      ...(nativeReported
        ? {
            warnings:
              'SAP reported activation before the later verification failed. Inspect the owner and its text pool; do not automatically retry.',
          }
        : {}),
    });
  }
}
