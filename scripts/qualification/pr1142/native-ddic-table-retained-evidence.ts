/** Seed only the exact saved new-version table/settings; later snapshots keep the ordinary graph proof. */
import type { AdtClient } from '../../../src/adt/client.js';
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import { tableSnapshot } from './native-ddic-table-evidence.js';
import type { TableFixture } from './native-ddic-table-fixtures.js';
import { TABLE_RETAINED_RECEIPTS } from './native-ddic-table-retained-fixed.js';
export async function retainedTableSnapshot(
  client: AdtClient,
  fixture: TableFixture,
  updated: boolean,
  active: boolean,
  record: (v: unknown) => void,
  options: AdtRequestOptions,
) {
  const initial = !updated && !active && ['TABL/DT', 'TABL/DTT'].includes(fixture.type);
  const rows: { snapshot?: string; nativeVersion?: string; sha256?: string; source?: string; bytes?: number }[] = [];
  const value = await tableSnapshot(
    client,
    fixture,
    updated,
    active,
    (row) => {
      rows.push(row as (typeof rows)[number]);
      record(row);
    },
    options,
  );
  if (initial) {
    const metadata = rows.filter((r) => r.snapshot === fixture.owner),
      source = rows.filter((r) => r.source);
    if (
      metadata.length !== 2 ||
      metadata.some(
        (r) =>
          r.nativeVersion !== 'new' ||
          r.sha256 !==
            (fixture.type === 'TABL/DT' ? TABLE_RETAINED_RECEIPTS.metadata : TABLE_RETAINED_RECEIPTS.settings),
      ) ||
      (fixture.type === 'TABL/DT' &&
        (source.length !== 2 ||
          source.some(
            (r) => r.sha256 !== TABLE_RETAINED_RECEIPTS.source || r.bytes !== TABLE_RETAINED_RECEIPTS.sourceBytes,
          ) ||
          value.sourceHash !== TABLE_RETAINED_RECEIPTS.source))
    )
      throw new Error('Exact retained table/settings raw proof changed.');
  }
  return value;
}
