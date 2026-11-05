/** Fixed document tail within the owned RAP graph. Actual production write/activation/cleanup only. */

import type { AdtClient } from '../../../src/adt/client.js';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import type { KtdShortText } from '../../../src/adt/ddic-xml.js';
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import { type MutationCleanupState, pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import {
  documentStableValue,
  pinnedDocumentSelection,
  readNativeDocument,
} from '../../../src/adt/pinned-document-owner.js';
import { rewritePinnedKtdDocument } from '../../../src/adt/pinned-ktd-document.js';
import { handlePrivatePinnedDocumentActivation } from '../../../src/handlers/write/pinned-activation.js';
import { handlePrivatePinnedDocumentWrite } from '../../../src/handlers/write/pinned-document-write.js';
import type { ServerConfig } from '../../../src/server/types.js';
import { ddicHash } from './native-ddic-evidence.js';
import { packageAdapterEvidence } from './native-package-evidence.js';
import { documentNodes } from './native-rap-documents-evidence.js';
import { documentChanges } from './native-rap-documents-fixtures.js';
import type { RapReceipt } from './native-rap-evidence.js';
import type { RapFixture } from './native-rap-fixtures.js';
export function armDocumentPut(f: RapFixture, stage: string, xml: string, creating = false) {
  const native = documentNodes(f, xml);
  if (creating && (native.evidence.version === 'active' || native.ids.some((id) => native.nodes.get(id)!.text !== '')))
    throw new Error('Fresh generated document has unexpected content/state.');
  const changes = documentChanges(f, stage);
  return rewritePinnedKtdDocument(xml, changes.source as string, changes.shortTexts as KtdShortText[] | undefined);
}
export async function runRapDocumentStage(input: {
  client: AdtClient;
  observedClient: AdtClient;
  config: ServerConfig;
  fixture: RapFixture;
  stage: string;
  before?: RapReceipt;
  active?: RapReceipt;
  options: AdtRequestOptions & { deadline: number };
  record: (v: unknown) => void;
  assert: () => void;
  absent: () => Promise<void>;
  snapshot: (active: boolean) => Promise<RapReceipt>;
}): Promise<RapReceipt | undefined> {
  const { client, observedClient, config, fixture: f, stage, before, active, options, record } = input;
  const activating = stage.startsWith('activate-'),
    creating = stage === 'create-document',
    deleting = stage === 'delete-document';
  const cleanup: MutationCleanupState = { unlockFailed: false };
  const changes = !activating && !deleting ? documentChanges(f, stage) : {};
  const result = activating
    ? await handlePrivatePinnedDocumentActivation(client, { type: 'SKTD', name: f.name })
    : await handlePrivatePinnedDocumentWrite(
        client,
        {
          action: creating ? 'create' : deleting ? 'delete' : 'update',
          type: 'SKTD',
          name: f.name,
          ...(creating
            ? { package: '$TMP', ...f.create }
            : deleting
              ? {}
              : { expectedMetadataHash: before!.metadataHash }),
          ...changes,
        },
        config,
        pinnedMutationContext(
          client.safety,
          { ...options, responseBudget: new DataResponseBudget(2 * 1024 * 1024, 'fixed-rap-document', true) },
          cleanup,
        ),
      );
  const value = JSON.parse(result.content.map((v) => v.text).join('\n')) as {
    ok?: boolean;
    success?: boolean;
    nativeMetadataVerified?: boolean;
    scope?: string;
    state?: string;
    metadataHash?: string;
  };
  record({ adapter: stage, result: packageAdapterEvidence(result), ...(!activating ? { cleanup } : {}) });
  if (deleting && value.state === 'deleted') await input.absent();
  if (
    result.isError ||
    (activating
      ? value.success !== true ||
        value.nativeMetadataVerified !== true ||
        value.scope !== 'selected-document-owner-only'
      : value.ok !== true) ||
    value.state !== (activating ? 'activated' : deleting ? 'deleted' : creating ? 'created' : 'saved-inactive') ||
    (!activating && (cleanup.unlockFailed || cleanup.unknownLocks?.length || cleanup.sessionClosed !== true))
  )
    throw new Error('Owned document stage or owning cleanup is unconfirmed.');
  if (deleting) {
    input.assert();
    return undefined;
  }
  const after = await input.snapshot(activating);
  if (activating && before!.sourceHashes.document !== after.sourceHashes.document)
    throw new Error('Document activation changed stored document content.');
  if (!activating && !creating) {
    const expected = armDocumentPut(f, stage, before!.sources!.document);
    if (
      ddicHash(documentStableValue(expected, pinnedDocumentSelection('SKTD', f.name))) !== after.sourceHashes.document
    )
      throw new Error('Document partial save changed unselected native content.');
  }
  const decoded = documentNodes(f, after.sources!.document),
    [rootId, createId, updateId] = decoded.ids;
  if (
    decoded.nodes.get(rootId)!.text !== f.create.source ||
    (['update-document-create', 'update-document-update', 'activate-document-updated'].includes(stage) &&
      decoded.nodes.get(createId)!.text !== 'Owned create documentation.') ||
    (['update-document-update', 'activate-document-updated'].includes(stage) &&
      (decoded.nodes.get(updateId)!.text !== 'Owned update documentation.' ||
        decoded.nodes.get(createId)!.shortText !== 'Create an owned RAP item' ||
        decoded.nodes.get(updateId)!.shortText !== 'Update an owned RAP item'))
  )
    throw new Error('Document root, accumulated drafts or selected short texts were not preserved.');
  if (active && !activating) {
    const prior = await readNativeDocument(observedClient, pinnedDocumentSelection('SKTD', f.name), 'active', options);
    documentNodes(f, prior.xml);
    record({
      documentActiveCounterpart: f.owner,
      body: prior.xml,
      sha256: ddicHash(prior.xml),
      nativeVersion: prior.version,
    });
    if (prior.version !== 'active' || ddicHash(prior.stable) !== active.sourceHashes.document)
      throw new Error('Pending document update altered the previously active counterpart.');
  }
  input.assert();
  return after;
}
