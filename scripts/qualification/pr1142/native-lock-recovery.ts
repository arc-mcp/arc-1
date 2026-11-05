/** Separate, explicitly invoked recovery of the whole inspected owned group. Never deletes a FUNC directly. */
import type { AdtClient } from '../../../src/adt/client.js';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { deletePinnedOwner } from '../../../src/adt/pinned-delete.js';
import {
  contractRequestPolicy,
  type NativeContractSelection,
  observeContractHttp,
} from './native-contract-transport.js';
import {
  assertOwnedInventoryMatches,
  captureOwnedFunctionInventory,
  type OwnedFunctionInventory,
} from './native-lock-inventory.js';
import { confirmNativeFunctionAbsence } from './native-contract-absence.js';
import type { ActiveFunctionReceipt } from './native-lock-observation.js';

export async function recoverInspectedFunctionGroup(input: {
  client: AdtClient;
  selection: NativeContractSelection;
  marker: string;
  receipt: ActiveFunctionReceipt;
  inspected: OwnedFunctionInventory;
  record: (value: unknown) => void;
  verifySource: () => void;
  signal: AbortSignal;
}) {
  const { client, selection, marker, receipt, inspected, record, verifySource, signal } = input;
  signal.throwIfAborted();
  verifySource();
  assertOwnedInventoryMatches(selection, inspected, inspected);
  const policy = { ...contractRequestPolicy(), deadline: Date.now() + 60_000, signal };
  const context = pinnedMutationContext(client.safety, policy, { unlockFailed: false });
  const observed = Object.assign(Object.create(Object.getPrototypeOf(client)), client, {
    http: observeContractHttp(client.http, selection, record, async (_owning, path, request) => {
      signal.throwIfAborted();
      verifySource();
      if (path !== selection.groupUrl) throw new Error('Only the complete inspected group may be deleted.');
      // Read through the original stateless connection while the separate group/pool locks are held.
      const current = await captureOwnedFunctionInventory(client.http, selection, marker, receipt, record, request);
      assertOwnedInventoryMatches(selection, inspected, current);
      signal.throwIfAborted();
      verifySource();
      record({ inspectedWholeGroupGuard: selection.groupUrl, resources: Object.keys(current.hashes).length });
    }),
  }) as AdtClient;
  const deletion = await deletePinnedOwner(observed, context, { type: 'FUGR', name: selection.group });
  record({ wholeGroupDeletion: deletion, cleanup: context.cleanup });
  let absenceConfirmed = false;
  if (
    deletion.ok &&
    !context.cleanup.unlockFailed &&
    !context.cleanup.unknownLocks?.length &&
    context.cleanup.sessionClosed === true
  ) {
    try {
      await confirmNativeFunctionAbsence(client.http, selection, record, { signal });
      absenceConfirmed = true;
    } catch (error) {
      record({ recoveryAbsenceUnconfirmed: true, errorType: error instanceof Error ? error.name : 'unknown' });
    }
  }
  return {
    deletion,
    absenceConfirmed,
    cleanupConfirmed: deletion.ok && absenceConfirmed && context.cleanup.sessionClosed === true,
  };
}
