/** Whole-owner activation with an explicit reference validator carried to the confirmation boundary. */
import type { AdtClient } from '../../adt/client.js';
import { type ActivationReference, type ActivationResult, activate } from '../../adt/devtools.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { mutationClient } from '../../adt/mutation-client.js';
import { pinnedMutationContext } from '../../adt/mutation-context.js';
import { type PinnedProgramOwnerEvidence, readPinnedProgramOwner } from '../../adt/pinned-program-owner.js';
import { assertPinnedSourceOwner, pinnedRecording } from '../../adt/pinned-write-policy.js';
import { checkOperation, OperationType } from '../../adt/safety.js';
import { readOwnedTextPoolState, textElementsServiceAvailable } from '../../adt/text-elements.js';
import { getCurrentContext } from '../../server/context.js';
import { objectUrlForType } from '../object-types.js';
import { errorResult, type ToolResult, textResult, toolJson } from '../shared.js';
import { enforceAllowedPackageForObjectUrl } from '../write-helpers.js';
import { pinnedFailure } from './pinned-result.js';

export function validatePinnedActivationReferences(
  owner: string,
  type: 'CLAS' | 'INTF' | 'PROG' | 'INCL',
  refs: readonly ActivationReference[],
): void {
  // Only the hex spelling of encoded namespace separators is interchangeable. Never decode other escapes.
  const canonical = (uri: string) => uri.replace(/%2f/gi, '%2F');
  const expectedName = decodeURIComponent(owner.slice(owner.lastIndexOf('/') + 1)).toUpperCase();
  const nativeType = { CLAS: 'CLAS/OC', INTF: 'INTF/OI', PROG: 'PROG/P', INCL: 'PROG/I' }[type];
  const allowed = new Map<string, string>([[canonical(owner), nativeType]]);
  const includes = new Set<string>();
  if (type === 'CLAS')
    for (const include of ['definitions', 'implementations', 'macros', 'testclasses']) {
      const uri = canonical(`${owner}/includes/${include}`);
      includes.add(uri);
      allowed.set(uri, 'CLAS/I');
    }
  if (type === 'PROG') {
    const encodedName = owner.slice(owner.lastIndexOf('/') + 1);
    for (const name of [encodedName, encodeURIComponent(expectedName)])
      allowed.set(canonical(`/sap/bc/adt/textelements/programs/${name}`), 'PROG/PX');
  }
  if (
    refs.length === 0 ||
    refs.length > (type === 'CLAS' ? 5 : type === 'PROG' ? 2 : 1) ||
    new Set(refs.map((ref) => ref.uri.toLowerCase())).size !== refs.length ||
    refs.some(
      (ref) =>
        !allowed.has(canonical(ref.uri)) ||
        (!includes.has(canonical(ref.uri)) && ref.name !== undefined && ref.name.trim() !== expectedName) ||
        (ref.type !== undefined && allowed.get(canonical(ref.uri)) !== ref.type) ||
        (ref.deleted !== undefined && ref.deleted !== 'false'),
    )
  ) {
    throw new AdtSafetyError(
      'Activation includes an unqualified reference or another owner. No confirmation was sent. Review the complete activation scope in ADT.',
    );
  }
}

export async function handlePinnedActivation(client: AdtClient, args: Record<string, unknown>): Promise<ToolResult> {
  let submitted = false;
  let poolIncluded = false;
  let ownerSelected = false;
  let nativeReported = false;
  let nativeActivation: ActivationResult | undefined;
  let textPoolState: 'active' | 'inactive' | 'unknown' | undefined;
  let poolWarning: string | undefined;
  let includeUsage: PinnedProgramOwnerEvidence['includeUsage'];
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
    let pkg: string | undefined;
    const result = await activate(http, client.safety, owner, {
      name: name as string,
      validateReferences: async (refs) => {
        validatePinnedActivationReferences(owner, type, refs);
        ownerSelected = refs.some((ref) => ref.uri.replace(/%2f/gi, '%2F') === owner.replace(/%2f/gi, '%2F'));
        const evidence = await readPinnedProgramOwner(client, owner);
        const currentPackage =
          evidence?.packageName ??
          (await enforceAllowedPackageForObjectUrl(
            client,
            owner,
            'Pinned activation scope',
            undefined,
            requestOptions,
          ));
        if (!currentPackage || (pkg !== undefined && currentPackage !== pkg))
          throw new AdtSafetyError('Owner package is unresolved or changed before activation.');
        pkg = currentPackage;
        includeUsage = evidence?.includeUsage;
        await pinnedRecording(http, client.safety, owner, pkg, '', undefined, requestOptions);
        if (type === 'PROG' && refs.some((ref) => ref.uri.startsWith('/sap/bc/adt/textelements/programs/'))) {
          await readOwnedTextPoolState(http, 'PROG', name as string, pkg);
          poolIncluded = true;
        }
      },
      beforeSubmit: () => {
        submitted = true;
      },
    });
    nativeActivation = result;
    nativeReported = result.success;
    if (type === 'PROG') {
      phase = 'text-pool-verification';
      textPoolState = 'unknown';
      try {
        if (poolIncluded || textElementsServiceAvailable(http, 'PROG'))
          textPoolState = await readOwnedTextPoolState(http, 'PROG', name as string, pkg);
        if (textPoolState === 'unknown')
          poolWarning = 'The text pool was not selected; its native state is unavailable on this target.';
      } catch (error) {
        if (poolIncluded) throw error;
        poolWarning =
          'The text pool was not selected; its native state could not be read.' +
          (result.success ? ' The confirmed owner activation is preserved.' : ' Native activation was not confirmed.');
      }
      if (result.success && poolIncluded && textPoolState !== 'active')
        throw new AdtSafetyError('SAP reported activation, but the selected program text pool is still inactive.');
    }
    const payload = toolJson({
      target: context.recordingPolicy.target,
      type,
      name,
      action: 'activate',
      ...result,
      retryable: false,
      state: result.success ? 'activated' : 'activation-not-confirmed',
      ...(textPoolState === undefined ? {} : { textPoolState }),
      ...(poolWarning ? { warnings: poolWarning } : {}),
      ...(includeUsage
        ? {
            includeUsage,
            warnings:
              'Include consumers may be affected. Returned native contexts are not a complete where-used inventory.',
          }
        : {}),
      ...(type === 'PROG' && !poolIncluded && textPoolState === 'inactive'
        ? {
            warnings: 'The program text pool still has an inactive draft; owner activation did not activate that pool.',
          }
        : {}),
      scope:
        type === 'PROG'
          ? poolIncluded && !ownerSelected
            ? 'selected-program-text-pool-only'
            : poolIncluded
              ? 'selected-program-with-native-owned-text-pool-expansion'
              : 'selected-program-only'
          : type === 'INCL'
            ? 'selected-standalone-include-only'
            : type === 'INTF'
              ? 'selected-interface-only'
              : 'complete-owner-including-existing-inactive-includes',
    });
    return result.success ? textResult(payload) : errorResult(payload);
  } catch (error) {
    return pinnedFailure(error, submitted ? 'activation-not-confirmed' : 'unchanged', phase, false, {
      nativeActivation,
      textPoolState,
      includeUsage,
      ...(nativeReported
        ? {
            warnings:
              'SAP reported activation before the later verification failed. Inspect the owner and its text pool; do not automatically retry.',
          }
        : {}),
    });
  }
}
