/** Exact-owner activation evidence for private metadata documents; no public admission. */
import type { AdtClient } from '../../adt/client.js';
import type { ActivationReference } from '../../adt/devtools.js';
import { AdtSafetyError } from '../../adt/errors.js';
import {
  canonicalDocumentUri,
  type PinnedDocumentSelection,
  pinnedDocumentSelection,
  readPinnedDocument,
} from '../../adt/pinned-document-owner.js';
export function selectPrivateDocumentActivation(args: Record<string, unknown>) {
  if (
    Object.entries(args).some(
      ([key, value]) => value !== undefined && !['type', 'name', 'action', 'preaudit'].includes(key),
    ) ||
    (args.action !== undefined && args.action !== 'activate') ||
    (args.preaudit !== undefined && args.preaudit !== true)
  )
    throw new AdtSafetyError('Private document activation selects one complete owner with mandatory preaudit.');
  return pinnedDocumentSelection(args.type, args.name);
}
export function documentActivationEvidence(client: AdtClient, selected: PinnedDocumentSelection) {
  let captured: Awaited<ReturnType<typeof readPinnedDocument>> | undefined;
  return {
    validateReferences(refs: readonly ActivationReference[]) {
      if (
        refs.length !== 1 ||
        refs.some(
          (ref) =>
            canonicalDocumentUri(ref.uri) !== canonicalDocumentUri(selected.objectUrl) ||
            (ref.name !== undefined && ref.name !== selected.name) ||
            (ref.type !== undefined && ref.type !== selected.native) ||
            (ref.deleted !== undefined && ref.deleted !== 'false'),
        )
      )
        throw new AdtSafetyError(
          'Document activation expanded beyond the exact selected native owner. No confirmation was sent.',
        );
    },
    async capture() {
      const current = await readPinnedDocument(client, selected);
      const inactive = await readPinnedDocument(client, selected, 'inactive');
      if (
        current.stable !== inactive.stable ||
        current.version !== inactive.version ||
        (captured && (captured.hash !== current.hash || captured.packageName !== current.packageName))
      )
        throw new AdtSafetyError('The selected native document draft changed or has conflicting version evidence.');
      captured ??= current;
      return current.packageName;
    },
    async verify() {
      if (!captured) throw new AdtSafetyError('Document activation lacks captured native evidence.');
      for (const version of [undefined, 'active', 'inactive'] as const) {
        const current = await readPinnedDocument(client, selected, version);
        if (
          current.packageName !== captured.packageName ||
          current.version !== 'active' ||
          current.inactiveAlternative ||
          current.stable !== captured.stable
        )
          throw new AdtSafetyError('Native active document content or state is unconfirmed.');
      }
    },
    get previousVersion() {
      return captured?.version;
    },
    get wasAlreadyActive() {
      return captured?.version === 'active' && !captured.inactiveAlternative;
    },
    get metadataHash() {
      return captured?.hash;
    },
  };
}
