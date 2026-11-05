/** Private SRVB evidence for the existing whole-owner activation orchestrator. */
import type { AdtClient } from '../../adt/client.js';
import { DataResponseBudget } from '../../adt/data-result-context.js';
import type { ActivationReference } from '../../adt/devtools.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { assertManagedProfileInput } from '../../adt/pinned-managed-resources.js';
import {
  BINDING_XML_TYPE,
  bindingActivationMatches,
  parsePinnedBinding,
  pinnedBindingSelection,
} from '../../adt/pinned-service-binding-owner.js';
import { checkOperation, checkPackage, OperationType } from '../../adt/safety.js';

export function selectPrivateBindingActivation(args: Record<string, unknown>) {
  assertManagedProfileInput('binding-activate', args);
  if (
    args.type !== 'SRVB' ||
    (args.action !== undefined && args.action !== 'activate') ||
    (args.preaudit !== undefined && args.preaudit !== true)
  )
    throw new AdtSafetyError('Select one complete preaudited service binding.');
  return pinnedBindingSelection(args.name);
}
export function bindingActivationEvidence(client: AdtClient, selected: ReturnType<typeof pinnedBindingSelection>) {
  let captured: Awaited<ReturnType<typeof read>> | undefined;
  async function read(version?: 'active', verifying = false) {
    checkOperation(client.safety, OperationType.Read, 'PinnedBindingActivationEvidence');
    const response = await client.http.get(
      selected.objectUrl + (version ? '?version=active' : ''),
      { Accept: BINDING_XML_TYPE, 'Cache-Control': 'no-cache' },
      { responseBudget: new DataResponseBudget(1024 * 1024, 'binding-activation', true) },
    );
    const native = parsePinnedBinding(response.body, selected);
    await checkPackage(client.safety, native.packageName, client.getPackageHierarchyResolver());
    if (
      (native.nativeVersion !== 'active' && native.nativeVersion !== 'inactive') ||
      native.published !== false ||
      (native.bindingCreated !== false && (!verifying || native.bindingCreated !== true))
    )
      throw new AdtSafetyError('Binding activation requires an explicitly versioned, unpublished native owner.');
    return { native, xml: response.body };
  }
  return {
    validateReferences(refs: readonly ActivationReference[]) {
      if (
        refs.length !== 1 ||
        refs.some(
          (ref) =>
            ref.uri.toLowerCase() !== selected.objectUrl.toLowerCase() ||
            (ref.type !== undefined && ref.type !== 'SRVB/SVB') ||
            (ref.name !== undefined && ref.name.trim() !== selected.name) ||
            (ref.deleted !== undefined && ref.deleted !== 'false'),
        )
      )
        throw new AdtSafetyError('Binding activation expanded beyond the selected owner; no confirmation was sent.');
    },
    async capture() {
      const current = await read();
      if (captured && captured.native.metadataHash !== current.native.metadataHash)
        throw new AdtSafetyError('The binding metadata changed during preaudit; no confirmation was sent.');
      captured ??= current;
      return current.native.packageName;
    },
    async verify() {
      if (!captured) throw new AdtSafetyError('Missing captured binding metadata.');
      for (const version of [undefined, 'active'] as const) {
        const current = await read(version, true);
        if (
          current.native.nativeVersion !== 'active' ||
          current.native.inactiveAlternative ||
          !bindingActivationMatches(captured.xml, current.xml, selected)
        )
          throw new AdtSafetyError('The native active binding does not preserve the captured metadata.');
      }
    },
    get metadataHash() {
      return captured?.native.metadataHash;
    },
    get previousVersion() {
      return captured?.native.nativeVersion;
    },
    get wasAlreadyActive() {
      return captured?.native.nativeVersion === 'active' && !captured.native.inactiveAlternative;
    },
  };
}
