/** Whole-owner activation with an explicit reference validator carried to the confirmation boundary. */
import type { AdtClient } from '../../adt/client.js';
import { type ActivationReference, type ActivationResult, activate } from '../../adt/devtools.js';
import { AdtSafetyError } from '../../adt/errors.js';
import type { FunctionActivationMetadata } from '../../adt/function-activation-metadata.js';
import { assertPinnedGroupGenerationReferences } from '../../adt/function-activation-metadata.js';
import { mutationClient } from '../../adt/mutation-client.js';
import {
  assertMutationContext,
  type PinnedMutationContext,
  pinnedMutationContext,
} from '../../adt/mutation-context.js';
import { isPinnedDdicType } from '../../adt/pinned-ddic-owner.js';
import { isPinnedDocumentType } from '../../adt/pinned-document-owner.js';
import {
  isPinnedDeclarativeType,
  type PinnedProgramOwnerEvidence,
  pinnedFunctionSelection,
  readPinnedFunctionOwner,
  readPinnedProgramOwner,
} from '../../adt/pinned-repository-owner.js';
import { assertPinnedSourceOwner, pinnedRecording } from '../../adt/pinned-write-policy.js';
import { checkOperation, OperationType } from '../../adt/safety.js';
import { readOwnedTextPoolState, textElementsServiceAvailable } from '../../adt/text-elements.js';
import { getCurrentContext } from '../../server/context.js';
import { objectUrlForType } from '../object-types.js';
import { errorResult, type ToolResult, textResult, toolJson } from '../shared.js';
import { enforceAllowedPackageForObjectUrl } from '../write-helpers.js';
import { bindingActivationEvidence, selectPrivateBindingActivation } from './pinned-binding-activation.js';
import { ddicActivationEvidence, selectPrivateDdicActivation } from './pinned-ddic-activation.js';
import { declarativeActivationEvidence, selectPrivateDeclarativeActivation } from './pinned-declarative-activation.js';
import { documentActivationEvidence, selectPrivateDocumentActivation } from './pinned-document-activation.js';
import {
  functionActivationSourceHash,
  readFunctionActivationMetadata,
  selectPinnedFunctionActivation,
  validatePinnedFunctionActivationReferences,
  verifyPinnedFunctionActivation,
  verifyPinnedFunctionGroupGeneration,
} from './pinned-function-activation.js';
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

const groupOperationWarning =
  'The native operation targets the whole function group and may affect other group-owned includes. Function-module draft activation is not verified; activate those modules separately.';
const groupIncludeWarning =
  'SAP activation may regenerate the owning function group. Function-module draft activation is not verified; activate those modules separately.';

const privateFunctionGrant = Symbol('private function activation qualification');
const privateDeclarativeGrant = Symbol('private declarative activation qualification');
const privateBindingGrant = Symbol('private binding activation qualification');
const privateDdicGrant = Symbol('private DDIC activation qualification');
const privateDocumentGrant = Symbol('private native document activation qualification');

/** Qualification only: this symbol cannot be selected by public arguments. */
export function handlePrivatePinnedDocumentActivation(
  client: AdtClient,
  args: Record<string, unknown>,
  minimalErrors = false,
): Promise<ToolResult> {
  return runPinnedActivation(client, args, minimalErrors, privateDocumentGrant);
}

export function handlePinnedActivation(
  client: AdtClient,
  args: Record<string, unknown>,
  minimalErrors = false,
): Promise<ToolResult> {
  if (
    Object.entries(args).some(
      ([key, value]) => value !== undefined && !['action', 'type', 'name', 'group', 'preaudit'].includes(key),
    )
  )
    return Promise.resolve(
      pinnedFailure(new AdtSafetyError('Unsupported pinned activation input.'), 'unchanged', 'validation', false, {
        minimalErrors,
      }),
    );
  const grant =
    args.type === 'FUNC' || args.type === 'FUGR' || (args.type === 'INCL' && args.group !== undefined)
      ? privateFunctionGrant
      : isPinnedDeclarativeType(args.type)
        ? privateDeclarativeGrant
        : args.type === 'SRVB'
          ? privateBindingGrant
          : isPinnedDdicType(args.type) || args.type === 'TABL'
            ? privateDdicGrant
            : args.type === 'ENHO' || args.type === 'SKTD'
              ? privateDocumentGrant
              : undefined;
  return runPinnedActivation(client, args, minimalErrors, grant);
}

/** Qualification entry only. The public handler never accepts this grant from tool arguments. */
export function handlePrivatePinnedFunctionActivation(
  client: AdtClient,
  args: Record<string, unknown>,
  minimalErrors = false,
): Promise<ToolResult> {
  return runPinnedActivation(client, args, minimalErrors, privateFunctionGrant);
}

/** Qualification entry only; its grant cannot be supplied through tool arguments. */
export function handlePrivatePinnedDeclarativeActivation(
  client: AdtClient,
  args: Record<string, unknown>,
  minimalErrors = false,
): Promise<ToolResult> {
  return runPinnedActivation(client, args, minimalErrors, privateDeclarativeGrant);
}

/** Internal qualification entry; no public field can select this profile. */
export function handlePrivatePinnedBindingActivation(
  client: AdtClient,
  args: Record<string, unknown>,
  minimalErrors = false,
) {
  return runPinnedActivation(client, args, minimalErrors, privateBindingGrant);
}

/** Qualification entry only; its grant cannot be supplied through tool arguments. */
export function handlePrivatePinnedDdicActivation(
  client: AdtClient,
  args: Record<string, unknown>,
  minimalErrors = false,
): Promise<ToolResult> {
  return runPinnedActivation(client, args, minimalErrors, privateDdicGrant);
}

async function runPinnedActivation(
  client: AdtClient,
  args: Record<string, unknown>,
  minimalErrors: boolean,
  grant?:
    | typeof privateFunctionGrant
    | typeof privateDeclarativeGrant
    | typeof privateBindingGrant
    | typeof privateDdicGrant
    | typeof privateDocumentGrant,
): Promise<ToolResult> {
  const prepared = await preparePinnedActivation(client, args, minimalErrors, grant);
  return 'execute' in prepared ? prepared.execute() : prepared;
}

export interface PreparedPinnedActivation {
  readonly owner: string;
  readonly name: string;
  assertReferences(refs: readonly ActivationReference[]): void;
  validateReferences(refs: readonly ActivationReference[]): Promise<void>;
  beforeSubmit(): void;
  recordNativeResult(result: ActivationResult): void;
  finish(result: ActivationResult): Promise<ToolResult>;
  failure(error: unknown): ToolResult;
  execute(): Promise<ToolResult>;
}

/** Private batch preparation reuses each native owner profile and never renews the caller budget. */
export async function preparePrivatePinnedBatchActivation(
  client: AdtClient,
  args: Record<string, unknown>,
  minimalErrors: boolean,
  context: PinnedMutationContext,
): Promise<PreparedPinnedActivation | ToolResult> {
  const grant =
    args.type === 'FUNC'
      ? privateFunctionGrant
      : isPinnedDeclarativeType(args.type)
        ? privateDeclarativeGrant
        : args.type === 'SRVB'
          ? privateBindingGrant
          : isPinnedDdicType(args.type) || args.type === 'TABL'
            ? privateDdicGrant
            : undefined;
  return preparePinnedActivation(client, args, minimalErrors, grant, context);
}

async function preparePinnedActivation(
  client: AdtClient,
  args: Record<string, unknown>,
  minimalErrors: boolean,
  grant?:
    | typeof privateFunctionGrant
    | typeof privateDeclarativeGrant
    | typeof privateBindingGrant
    | typeof privateDdicGrant
    | typeof privateDocumentGrant,
  sharedContext?: PinnedMutationContext,
): Promise<PreparedPinnedActivation | ToolResult> {
  let submitted = false;
  let poolIncluded = false;
  let ownerSelected = false;
  let nativeReported = false;
  let nativeActivation: ActivationResult | undefined;
  let textPoolState: 'active' | 'inactive' | 'unknown' | undefined;
  let poolWarning: string | undefined;
  let includeUsage: PinnedProgramOwnerEvidence['includeUsage'];
  let phase = 'activation';
  let documentSelected = false;
  let groupOperation: { group: string; scope: string } | undefined;
  let functionWarning = groupOperationWarning;
  const failure = (error: unknown): ToolResult => {
    return pinnedFailure(error, submitted ? 'activation-not-confirmed' : 'unchanged', phase, false, {
      minimalErrors,
      nativeActivation,
      textPoolState,
      includeUsage,
      ...(documentSelected && submitted ? { scope: 'selected-document-owner-only' } : {}),
      ...(groupOperation && submitted ? groupOperation : {}),
      ...(nativeReported || (groupOperation && submitted)
        ? {
            warnings: [
              nativeReported
                ? `SAP reported ${nativeActivation?.execution === 'generation' ? 'generation' : 'activation'} before the later verification failed. Inspect the returned verification phase; do not automatically retry.`
                : '',
              groupOperation && submitted ? functionWarning : '',
            ]
              .filter(Boolean)
              .join(' '),
          }
        : {}),
    });
  };
  try {
    checkOperation(client.safety, OperationType.Activate, 'PinnedActivate');
    if (!client.safety.multiTargetWrite?.enabled) throw new AdtSafetyError('Pinned activation is not authorized.');
    const { type, name } = args;
    const functionResource = type === 'FUNC' || type === 'FUGR' || (type === 'INCL' && args.group !== undefined);
    if (functionResource !== (grant === privateFunctionGrant))
      throw new AdtSafetyError(
        'Function-family activation is private and is not admitted on the public pinned handler.',
      );
    const declarativeResource = isPinnedDeclarativeType(type);
    if (declarativeResource !== (grant === privateDeclarativeGrant))
      throw new AdtSafetyError('Declarative activation is private and is not admitted on the public pinned handler.');
    const declarativeOwner = declarativeResource ? selectPrivateDeclarativeActivation(args) : undefined;
    const bindingResource = type === 'SRVB';
    if (bindingResource !== (grant === privateBindingGrant))
      throw new AdtSafetyError('Binding activation is private and is not admitted on the public pinned handler.');
    const bindingOwner = bindingResource ? selectPrivateBindingActivation(args) : undefined;
    const documentResource = isPinnedDocumentType(type) || type === 'KTD';
    if (documentResource !== (grant === privateDocumentGrant))
      throw new AdtSafetyError('Document activation is private and not admitted on the public pinned handler.');
    const documentOwner = documentResource ? selectPrivateDocumentActivation(args) : undefined;
    const ddicResource = isPinnedDdicType(type) || type === 'TABL';
    if (ddicResource !== (grant === privateDdicGrant))
      throw new AdtSafetyError('DDIC activation is private and is not admitted on the public pinned handler.');
    if (!functionResource && !declarativeResource && !ddicResource && !bindingResource && !documentResource)
      assertPinnedSourceOwner(type, name);
    if (!functionResource && args.group !== undefined)
      throw new AdtSafetyError('This activation type cannot select a function group.');
    if ((args.action ?? 'activate') !== 'activate' || args.objects !== undefined || args.preaudit === false)
      throw new AdtSafetyError('Only whole-owner preaudited activation is allowed.');
    const documentBudgets = documentResource
      ? {
          responseBudget: new (await import('../../adt/data-result-context.js')).DataResponseBudget(
            8 * 1024 * 1024,
            'document-activation',
            true,
          ),
          attemptBudget: new (await import('../../adt/request-attempt-budget.js')).RequestAttemptBudget(64),
        }
      : {};
    const context =
      sharedContext ??
      pinnedMutationContext(
        client.safety,
        {
          deadline: Date.now() + 300_000,
          ...documentBudgets,
          signal: getCurrentContext()?.signal,
        },
        { unlockFailed: false },
      );
    assertMutationContext(client.safety, context);
    client = mutationClient(client, context);
    const ddicOwner = ddicResource ? await selectPrivateDdicActivation(client, args) : undefined;
    const ddic = ddicOwner ? ddicActivationEvidence(client, ddicOwner) : undefined;
    const functionOwner =
      type === 'FUNC'
        ? await selectPinnedFunctionActivation(client, name, args.group)
        : functionResource
          ? pinnedFunctionSelection(type, name, args.group)
          : undefined;
    const declarative = declarativeOwner ? declarativeActivationEvidence(client, declarativeOwner) : undefined;
    documentSelected = documentOwner !== undefined;
    const binding = bindingOwner
      ? bindingActivationEvidence(client, bindingOwner)
      : documentOwner
        ? documentActivationEvidence(client, documentOwner)
        : undefined;
    // A group POST can report success while its structural include remains inactive (A4H 758).
    // Submit the exact FUGR/I URI, as the single-target activation path does.
    const groupGeneration = functionOwner?.type === 'FUGR';
    if (functionOwner && functionOwner.type !== 'FUNC') {
      functionWarning = functionOwner.type === 'INCL' ? groupIncludeWarning : groupOperationWarning;
      groupOperation = {
        group: functionOwner.group,
        scope:
          functionOwner.type === 'INCL' ? 'selected-group-include-only' : 'selected-function-group-native-operation',
      };
    }
    const owner =
      (groupGeneration ? functionOwner.groupUrl : functionOwner?.objectUrl) ??
      declarativeOwner?.objectUrl ??
      bindingOwner?.objectUrl ??
      documentOwner?.objectUrl ??
      ddicOwner?.objectUrl ??
      objectUrlForType(type as string, (name as string).toLowerCase());
    let functionSourceHash: string | undefined;
    let functionMetadata: FunctionActivationMetadata | undefined;
    const requestOptions = context.requestPolicy;
    // The activation engine can create a child budget, but its HTTP/CSRF calls
    // must never extend the outer preflight-to-confirmation deadline.
    const http = client.http;
    let pkg: string | undefined;
    let recording: Awaited<ReturnType<typeof pinnedRecording>> | undefined;
    const assertReferences = (refs: readonly ActivationReference[]): void => {
      if (groupGeneration) assertPinnedGroupGenerationReferences(owner, functionOwner.group, refs);
      else if (functionOwner) validatePinnedFunctionActivationReferences(functionOwner, refs);
      else if (declarative) declarative.validateReferences(refs);
      else if (binding) binding.validateReferences(refs);
      else if (ddic) ddic.validateReferences(refs);
      else validatePinnedActivationReferences(owner, type as 'CLAS' | 'INTF' | 'PROG' | 'INCL', refs);
    };
    const validateReferences = async (refs: readonly ActivationReference[]): Promise<void> => {
      assertReferences(refs);
      ownerSelected = refs.some((ref) => ref.uri.replace(/%2f/gi, '%2F') === owner.replace(/%2f/gi, '%2F'));
      const evidence = await readPinnedProgramOwner(client, owner);
      const functionEvidence = await readPinnedFunctionOwner(client, functionOwner?.objectUrl ?? owner);
      const currentPackage =
        (await declarative?.capture()) ??
        (await binding?.capture()) ??
        (await ddic?.capture()) ??
        functionEvidence?.packageName ??
        evidence?.packageName ??
        (await enforceAllowedPackageForObjectUrl(client, owner, 'Pinned activation scope', undefined, requestOptions));
      if (!currentPackage || (pkg !== undefined && currentPackage !== pkg))
        throw new AdtSafetyError('Owner package is unresolved or changed before activation.');
      pkg = currentPackage;
      includeUsage = evidence?.includeUsage;
      const childRecording =
        functionOwner?.type === 'INCL'
          ? await pinnedRecording(http, client.safety, functionOwner.objectUrl, pkg, '', undefined, requestOptions)
          : undefined;
      const ownerRecording = await pinnedRecording(
        http,
        client.safety,
        functionOwner?.type === 'INCL' ? functionOwner.groupUrl : owner,
        pkg,
        '',
        childRecording?.request,
        requestOptions,
      );
      if (recording && (recording.local !== ownerRecording.local || recording.request !== ownerRecording.request))
        throw new AdtSafetyError('The owner recording context changed during preaudit; no confirmation was sent.');
      recording ??= ownerRecording;
      if (
        childRecording &&
        (childRecording.local !== ownerRecording.local || childRecording.request !== ownerRecording.request)
      )
        throw new AdtSafetyError('The selected include and owning group require matching native recording contexts.');
      if (functionOwner && functionOwner.type !== 'FUGR') {
        const metadata = await readFunctionActivationMetadata(client, functionOwner, pkg);
        if (functionMetadata !== undefined && metadata.hash !== functionMetadata.hash)
          throw new AdtSafetyError('The function-child metadata changed during preaudit; no confirmation was sent.');
        functionMetadata ??= metadata;
        const currentHash = await functionActivationSourceHash(client, functionOwner, 'inactive');
        if (functionSourceHash !== undefined && currentHash !== functionSourceHash)
          throw new AdtSafetyError('The function-child source changed during preaudit; no confirmation was sent.');
        functionSourceHash = currentHash;
      }
      if (type === 'PROG' && refs.some((ref) => ref.uri.startsWith('/sap/bc/adt/textelements/programs/'))) {
        await readOwnedTextPoolState(http, 'PROG', name as string, pkg);
        poolIncluded = true;
      }
    };
    const beforeSubmit = () => {
      submitted = true;
    };
    const recordNativeResult = (result: ActivationResult) => {
      nativeActivation = result;
      nativeReported = result.success;
    };
    const finish = async (result: ActivationResult): Promise<ToolResult> => {
      try {
        recordNativeResult(result);
        if (functionOwner && result.success) {
          phase = groupGeneration ? 'function-group-verification' : 'function-active-verification';
          if (!pkg || (functionOwner.type !== 'FUGR' && (!functionSourceHash || !functionMetadata)))
            throw new AdtSafetyError('Function activation lacks its source and owner evidence.');
          if (functionOwner.type === 'FUGR') await verifyPinnedFunctionGroupGeneration(client, functionOwner, pkg);
          else
            await verifyPinnedFunctionActivation(
              client,
              functionOwner,
              pkg,
              functionSourceHash!,
              functionMetadata!.hash,
            );
        }
        if (declarative && result.success) {
          phase = 'declarative-active-verification';
          await declarative.verify();
        }
        if (binding && result.success) {
          phase = documentOwner ? 'document-active-verification' : 'binding-active-verification';
          await binding.verify();
        }
        if (ddic && result.success) {
          phase = 'ddic-active-verification';
          ddic.assertResult(result);
          await ddic.verify();
        }
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
              (result.success
                ? ' The confirmed owner activation is preserved.'
                : ' Native activation was not confirmed.');
          }
          if (result.success && poolIncluded && textPoolState !== 'active')
            throw new AdtSafetyError('SAP reported activation, but the selected program text pool is still inactive.');
        }
        const payload = toolJson({
          target: context.recordingPolicy.target,
          type,
          name,
          action: 'activate',
          ...(minimalErrors && !result.success ? { ...result, messages: [], details: [] } : result),
          retryable: false,
          ...(binding
            ? {
                nativeMetadataVerified: result.success,
                previousNativeVersion: binding.previousVersion,
                metadataHash: binding.metadataHash,
              }
            : {}),
          ...(declarative
            ? {
                activeSourceVerified: result.success,
                nativeStateVerified: result.success,
                previousNativeVersion: declarative.previousVersion,
                sourceHash: declarative.sourceHash,
              }
            : {}),
          ...(ddic
            ? {
                ...(ddic.sourceBacked
                  ? { activeSourceVerified: result.success, sourceHash: ddic.sourceHash }
                  : { metadataHash: ddic.metadataHash }),
                nativeStateVerified: result.success,
                previousNativeVersion: ddic.previousVersion,
                warnings:
                  'DDIC activation can adjust active dependent objects outside the selected package, including database structures; SAP preaudit references do not enumerate them.',
              }
            : {}),
          ...(functionOwner ? { group: functionOwner.group } : {}),
          ...(functionOwner && functionOwner.type !== 'FUGR'
            ? {
                activeSourceVerified: result.success,
                nativeMetadataVerified: result.success,
                previousNativeVersion: functionMetadata?.version,
              }
            : {}),
          state: result.success
            ? functionOwner?.type === 'FUGR'
              ? result.execution === 'generation'
                ? 'generated'
                : 'native-operation-confirmed'
              : declarative?.wasAlreadyActive ||
                  binding?.wasAlreadyActive ||
                  ddic?.wasAlreadyActive ||
                  (functionOwner && functionMetadata?.version === 'active' && !functionMetadata.inactiveAlternative)
                ? 'already-active'
                : 'activated'
            : 'activation-not-confirmed',
          ...(groupOperation
            ? {
                warnings: functionWarning,
              }
            : {}),
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
                warnings:
                  'The program text pool still has an inactive draft; owner activation did not activate that pool.',
              }
            : {}),
          scope: documentOwner
            ? 'selected-document-owner-only'
            : binding
              ? 'selected-service-binding-owner-only'
              : declarative
                ? 'selected-declarative-source-owner-only'
                : ddic
                  ? 'selected-ddic-owner-only'
                  : functionOwner
                    ? functionOwner.type === 'FUNC'
                      ? 'selected-function-module-only'
                      : functionOwner.type === 'INCL'
                        ? 'selected-group-include-only'
                        : 'selected-function-group-native-operation'
                    : type === 'PROG'
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
        return failure(error);
      }
    };
    const prepared: PreparedPinnedActivation = {
      owner,
      name: groupGeneration ? functionOwner.group : (name as string),
      assertReferences,
      validateReferences,
      beforeSubmit,
      recordNativeResult,
      finish,
      failure,
      execute: async () => {
        try {
          return await finish(
            await activate(http, client.safety, owner, {
              name: groupGeneration ? functionOwner.group : (name as string),
              ...(groupGeneration ? { functionGroupGeneration: true as const } : {}),
              validateReferences,
              beforeSubmit,
            }),
          );
        } catch (error) {
          return failure(error);
        }
      },
    };
    if (sharedContext) await validateReferences([{ uri: owner, name: prepared.name }]);
    return prepared;
  } catch (error) {
    return failure(error);
  }
}
