/** Actual private production adapters; this fixed native wrapper does not grant public access. */

import type { AdtClient } from '../../../src/adt/client.js';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import { type MutationCleanupState, pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import {
  handlePrivatePinnedDocumentActivation,
  preparePrivatePinnedBatchActivation,
} from '../../../src/handlers/write/pinned-activation.js';
import { handlePrivatePinnedDocumentWrite } from '../../../src/handlers/write/pinned-document-write.js';
import { createPinnedTextSourceContext } from '../../../src/handlers/write/pinned-source-input.js';
import { executePinnedSourceWrite } from '../../../src/handlers/write/pinned-source-write.js';
import { ddicConfig } from './native-ddic-workflow.js';
import type { EnhoReceipt } from './native-enho-evidence.js';
import type { EnhoFixture } from './native-enho-fixtures.js';

/** Qualification-local context only; actual authentication is explicitly Basic-native. */
export const enhoConfig = () => ({ ...ddicConfig(), multiTargetEndpoints: true, ppEnabled: true, ppStrict: true });
export async function enhoAction(
  client: AdtClient,
  f: EnhoFixture,
  stage: string,
  before: EnhoReceipt | undefined,
  deadline: number,
  cleanup: MutationCleanupState,
) {
  const options = {
    deadline,
    noReplay: true,
    retryTransientErrors: false,
    responseBudget: new DataResponseBudget(2 * 1024 * 1024, 'fixed-enho-operation', true),
  };
  const context = pinnedMutationContext(client.safety, options, cleanup);
  if (stage.startsWith('activate-') || stage.startsWith('reactivate-')) {
    if (f.type === 'ENHO') return handlePrivatePinnedDocumentActivation(client, { type: f.type, name: f.name });
    const prepared = await preparePrivatePinnedBatchActivation(client, { type: f.type, name: f.name }, false, context);
    if (!('execute' in prepared)) return prepared;
    return prepared.execute();
  }
  const creating = stage.startsWith('create-'),
    deleting = stage.startsWith('delete-'),
    stale = stage.startsWith('stale-');
  const hash = before?.hash;
  const args = {
    action: creating ? 'create' : deleting ? 'delete' : 'update',
    type: f.type,
    name: f.name,
    ...(creating
      ? { package: '$TMP', description: f.description, ...f.create }
      : deleting
        ? {}
        : { ...f.update, expectedMetadataHash: stale ? (hash![0] === '0' ? '1' : '0') + hash!.slice(1) : hash }),
  };
  return f.type === 'ENHO'
    ? handlePrivatePinnedDocumentWrite(client, args, enhoConfig(), context)
    : executePinnedSourceWrite(createPinnedTextSourceContext(client, args, enhoConfig(), context));
}
