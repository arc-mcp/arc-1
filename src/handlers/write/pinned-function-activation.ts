/** Native function-child evidence used by the shared pinned activation orchestrator; not public admission. */
import { createHash } from 'node:crypto';
import type { AdtClient } from '../../adt/client.js';
import { DataResponseBudget } from '../../adt/data-result-context.js';
import type { ActivationReference } from '../../adt/devtools.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { type FunctionActivationMetadata, functionActivationMetadata } from '../../adt/function-activation-metadata.js';
import { nativeXmlRoot } from '../../adt/native-xml-evidence.js';
import {
  assertPinnedFunctionIdentifier,
  type PinnedFunctionSelection,
  pinnedFunctionSelection,
} from '../../adt/pinned-repository-owner.js';
import { checkOperation, OperationType } from '../../adt/safety.js';
import { prepareFunctionSourceVerification } from '../../adt/source-precondition.js';

const core = 'http://www.sap.com/adt/core';
const canonical = (uri: string) => uri.replace(/%2f/gi, '%2F');

export async function selectPinnedFunctionActivation(client: AdtClient, name: unknown, group: unknown) {
  // Validate before a possible native group lookup. Never interpolate an unvalidated selector.
  assertPinnedFunctionIdentifier(name);
  const resolved =
    group === undefined
      ? await client.resolveFunctionGroup(name, {
          responseBudget: new DataResponseBudget(1024 * 1024, 'function-group-lookup', true),
        })
      : group;
  if (!resolved) throw new AdtSafetyError('Cannot resolve the function group; provide group explicitly.');
  return pinnedFunctionSelection('FUNC', name, resolved);
}

export function validatePinnedFunctionActivationReferences(
  selected: PinnedFunctionSelection,
  refs: readonly ActivationReference[],
): void {
  if (
    (selected.type !== 'FUNC' && selected.type !== 'INCL') ||
    refs.length !== 1 ||
    refs.some(
      (ref) =>
        canonical(ref.uri) !== canonical(selected.objectUrl) ||
        (ref.name !== undefined && ref.name.trim() !== selected.name) ||
        (ref.type !== undefined && ref.type !== (selected.type === 'FUNC' ? 'FUGR/FF' : 'FUGR/I')) ||
        (ref.deleted !== undefined && ref.deleted !== 'false'),
    )
  )
    throw new AdtSafetyError(
      'Function activation includes an unqualified reference or another owner. No confirmation was sent.',
    );
}

export async function functionActivationSourceHash(
  client: AdtClient,
  selected: PinnedFunctionSelection,
  version: 'active' | 'inactive',
): Promise<string> {
  if (selected.type !== 'FUNC' && selected.type !== 'INCL')
    throw new AdtSafetyError('Activation source evidence requires a function child.');
  checkOperation(client.safety, OperationType.Read, 'FunctionActivationEvidence');
  const response = await client.http.get(
    `${selected.objectUrl}/source/main?version=${version}`,
    {
      Accept: 'text/plain',
      'Cache-Control': 'no-cache',
    },
    { responseBudget: new DataResponseBudget(1024 * 1024, 'function-activation-source', true) },
  );
  if (
    !Object.entries(response.headers).some(
      ([key, value]) =>
        key.toLowerCase() === 'content-type' && value.split(';', 1)[0].trim().toLowerCase() === 'text/plain',
    )
  )
    throw new AdtSafetyError('Function activation source read did not return native text.');
  try {
    if (selected.type === 'FUNC') prepareFunctionSourceVerification(response.body, selected.name);
  } catch {
    throw new AdtSafetyError(
      'Function activation requires the bounded native signature/body frame for the selected module.',
    );
  }
  return createHash('sha256').update(response.body).digest('hex');
}

export async function readFunctionActivationMetadata(
  client: AdtClient,
  selected: PinnedFunctionSelection,
  pkg: string,
): Promise<FunctionActivationMetadata> {
  checkOperation(client.safety, OperationType.Read, 'FunctionActivationEvidence');
  const response = await client.http.get(
    selected.objectUrl,
    { Accept: 'application/*', 'Cache-Control': 'no-cache' },
    { responseBudget: new DataResponseBudget(1024 * 1024, 'function-default-metadata', true) },
  );
  return functionActivationMetadata(response.body, selected, pkg);
}

export async function verifyPinnedFunctionActivation(
  client: AdtClient,
  selected: PinnedFunctionSelection,
  pkg: string,
  expectedSourceHash: string,
  expectedMetadataHash: string,
): Promise<void> {
  const current = await readFunctionActivationMetadata(client, selected, pkg);
  if (current.version !== 'active' || current.inactiveAlternative || current.hash !== expectedMetadataHash)
    throw new AdtSafetyError('Default function metadata does not confirm that the captured draft became active.');
  const response = await client.http.get(
    `${selected.objectUrl}?version=active`,
    { Accept: 'application/*', 'Cache-Control': 'no-cache' },
    { responseBudget: new DataResponseBudget(1024 * 1024, 'function-activation-metadata', true) },
  );
  const active = functionActivationMetadata(response.body, selected, pkg);
  if (active.version !== 'active' || active.inactiveAlternative || active.hash !== expectedMetadataHash)
    throw new AdtSafetyError('Explicit active function metadata does not match the captured draft.');
  if ((await functionActivationSourceHash(client, selected, 'active')) !== expectedSourceHash)
    throw new AdtSafetyError('Native active function-child source does not match the selected preactivation source.');
}

export async function verifyPinnedFunctionGroupGeneration(
  client: AdtClient,
  selected: PinnedFunctionSelection,
  pkg: string,
): Promise<void> {
  if (selected.type !== 'FUGR') throw new AdtSafetyError('Generation metadata requires the selected group.');
  checkOperation(client.safety, OperationType.Read, 'FunctionActivationEvidence');
  const response = await client.http.get(
    `${selected.groupUrl}?version=active`,
    { Accept: 'application/*', 'Cache-Control': 'no-cache' },
    { responseBudget: new DataResponseBudget(1024 * 1024, 'function-group-generation-metadata', true) },
  );
  const root = nativeXmlRoot(response.body, 'abapFunctionGroup', 'http://www.sap.com/adt/functions/groups');
  const ownPackage = root.child('packageRef', core);
  if (
    root.attribute('name', core) !== selected.group ||
    root.attribute('type', core) !== 'FUGR/F' ||
    root.attribute('version', core) !== 'active' ||
    root.hasChild('containerRef') ||
    ownPackage?.attribute('name', core) !== pkg ||
    ownPackage.attribute('type', core) !== 'DEVC/K'
  )
    throw new AdtSafetyError('Native active function-group identity and package were not confirmed.');
}
