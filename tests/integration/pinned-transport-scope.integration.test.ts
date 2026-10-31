/** Native CTS adapter evidence using direct test credentials; never a PP-route qualification. */
import { describe, expect, it } from 'vitest';
import { isNotFoundError } from '../../src/adt/errors.js';
import { pinnedMutationContext } from '../../src/adt/mutation-context.js';
import { preparePinnedTransport } from '../../src/adt/pinned-transport-scope.js';
import { createTransport, deleteTransport, getTransport } from '../../src/adt/transport.js';
import { generateUniqueName } from './crud-harness.js';
import { getTestClient } from './helpers.js';

describe('pinned CTS scope against native SAP', () => {
  it('creates a disposable request, freezes its native children, deletes it and verifies absence', async () => {
    const client = getTestClient();
    const policy = {
      enabled: true,
      target: `DIRECT_TEST/${client.sapClient}`,
      allowedPackages: ['$TMP'],
      allowedTransports: ['*'],
      serverAllowedTransports: ['*'],
    };
    const safety = { ...client.safety, multiTargetWrite: policy };
    const context = () => pinnedMutationContext(safety, { deadline: Date.now() + 300_000 }, { unlockFailed: false });
    const creation = await preparePinnedTransport(client.http, safety, context(), 'create');
    const description = `ARC-1 integration test ${generateUniqueName('CTS_SCOPE')}`;
    const id = await createTransport(creation.http, creation.safety, description, '$TMP');
    expect(id).toMatch(/^[A-Z0-9]{1,20}$/);
    let deleted = false;
    try {
      const native = await getTransport(client.http, client.safety, id);
      expect(native?.description).toBe(description);
      const deletion = await preparePinnedTransport(client.http, safety, context(), 'delete', id);
      expect(deletion.verifiedIds).toEqual([id, ...native!.tasks.map((task) => task.id)]);
      await deleteTransport(deletion.http, deletion.safety, id, true, true);
      deleted = true;
      try {
        expect(await getTransport(client.http, client.safety, id)).toBeNull();
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
      }
    } finally {
      // Only the exact request just created by this test can enter cleanup. Never release it.
      if (!deleted) await deleteTransport(client.http, client.safety, id, true, true);
    }
  });
});
