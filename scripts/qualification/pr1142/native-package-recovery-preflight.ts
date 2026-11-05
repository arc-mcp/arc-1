/** GET-only inspection of the retained graph; uses the exact same owner receipts as cleanup. */
import type { AdtClient } from '../../../src/adt/client.js';
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import { declarativeInventoryClean } from './native-declarative-evidence.js';
import type { DeclarativeFixture } from './native-declarative-fixtures.js';
import { type PackageJournal, packageSnapshot } from './native-package-evidence.js';
import { type PackageGraph, packageOwners } from './native-package-fixtures.js';
import { packageRecoveryGraph, packageRecoveryReceipts } from './native-package-recovery-fixed.js';

export async function inspectRetainedPackages(
  client: AdtClient,
  graph: PackageGraph,
  options: AdtRequestOptions,
  record: PackageJournal,
) {
  if (JSON.stringify(graph) !== JSON.stringify(packageRecoveryGraph)) throw new Error('Fixed retained graph required.');
  for (const owner of packageOwners(graph)) {
    const current = await packageSnapshot(client, owner, graph, options, record, true, true);
    if (JSON.stringify(current) !== JSON.stringify(packageRecoveryReceipts[owner.owner]))
      throw new Error('Retained package receipt drift.');
  }
  await declarativeInventoryClean(
    client.http,
    packageOwners(graph) as unknown as readonly DeclarativeFixture[],
    record,
    options,
  );
}
