/** Native current/active/inactive views must agree with the exact retained stage; query labels are not state proof. */
import type { AdtClient } from '../../../src/adt/client.js';
import { buildMessageClassXml } from '../../../src/adt/ddic-xml.js';
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import {
  addedMessageNumbers,
  assertSavedMessageClass,
  preparePinnedMessageClassUpdate,
} from '../../../src/adt/pinned-msag-document.js';
import { collectionsSnapshot } from './native-ddic-collections-evidence.js';
import type { CollectionsFixture } from './native-ddic-collections-fixtures.js';
import { COLLECTIONS_RETAINED_RECEIPTS } from './native-ddic-collections-retained-fixed.js';
import type { DdicWorkflowReceipt } from './native-ddic-workflow.js';
export type CollectionsRetainedReceipts = Record<
  keyof typeof COLLECTIONS_RETAINED_RECEIPTS,
  { hash: string; canonical: string; sourceHash?: string }
>;
export async function collectionsRetainedSnapshot(
  client: AdtClient,
  fixture: CollectionsFixture,
  updated: boolean,
  active: boolean,
  record: (v: unknown) => void,
  options: AdtRequestOptions,
  expectedReceipts: CollectionsRetainedReceipts = COLLECTIONS_RETAINED_RECEIPTS,
) {
  if (!active || (fixture.type !== 'MSAG' && !updated)) throw new Error('Only the retained active stage is admitted.');
  const result = await collectionsSnapshot(client, fixture, updated, active, record, options);
  if (fixture.type !== 'MSAG' || !updated) {
    const expected = expectedReceipts[fixture.type];
    if (
      result.hash !== expected.hash ||
      result.canonicalHashes.length !== 3 ||
      result.canonicalHashes.some((h) => h !== expected.canonical) ||
      result.sourceHash !== ('sourceHash' in expected ? expected.sourceHash : undefined)
    )
      throw new Error('Exact retained native metadata/source receipt changed.');
  }
  return result;
}
function retainedMessagePlan(fixture: CollectionsFixture, before: DdicWorkflowReceipt) {
  if (fixture.type !== 'MSAG' || !before.metadataXml || before.updated || !before.active)
    throw new Error('Exact retained message-class receipt required.');
  const requested = buildMessageClassXml({
    name: fixture.name,
    description: fixture.description,
    package: '$TMP',
    language: 'EN',
    messages: fixture.update.messages,
  });
  return preparePinnedMessageClassUpdate(before.metadataXml, requested, { messages: true, description: false });
}
export function retainedMessageUpdate(fixture: CollectionsFixture, before: DdicWorkflowReceipt) {
  return retainedMessagePlan(fixture, before).body;
}
export function verifyRetainedMessageUpdate(
  fixture: CollectionsFixture,
  before: DdicWorkflowReceipt,
  after: DdicWorkflowReceipt,
) {
  if (!after.metadataXml || !after.active || !after.updated)
    throw new Error('Active message-class update unconfirmed.');
  const target = retainedMessagePlan(fixture, before).persistedBody;
  assertSavedMessageClass(target, after.metadataXml, addedMessageNumbers(before.metadataXml!, target));
}
