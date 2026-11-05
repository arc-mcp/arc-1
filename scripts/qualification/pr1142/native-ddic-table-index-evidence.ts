/** Exact inspected four-owner state, then existing native activation/readback and own cleanup. */
import type { AdtClient } from '../../../src/adt/client.js';
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import { pinnedDdicSelection, readDdicEvidence } from '../../../src/adt/pinned-ddic-owner.js';
import { assertSavedFields, type MetadataFields } from '../../../src/adt/pinned-metadata-projection.js';
import { ddicHash } from './native-ddic-evidence.js';
import { tableSnapshot } from './native-ddic-table-evidence.js';
import type { TableFixture } from './native-ddic-table-fixtures.js';
import { TABLE_INDEX_RECEIPTS as proof } from './native-ddic-table-index-fixed.js';
export function indexTailEvidence() {
  let indexFields: MetadataFields | undefined;
  return {
    snapshot: async (
      client: AdtClient,
      fixture: TableFixture,
      _updated: boolean,
      active: boolean,
      record: (row: unknown) => void,
      options: AdtRequestOptions,
    ) => {
      const index = fixture.type === 'TABL/DTI',
        after = index && active;
      const expected =
        fixture.type === 'TABL/DT'
          ? proof.table
          : fixture.type === 'TABL/DTT'
            ? proof.settings
            : fixture.type === 'ENQU'
              ? proof.lock
              : proof.indexNew;
      const current = await tableSnapshot(
        client,
        fixture,
        fixture.type !== 'TABL/DT',
        index ? active : true,
        (row) => {
          const value = row as { snapshot?: string; source?: string; sha256?: string };
          if (!after && value.snapshot && value.sha256 !== expected)
            throw new Error('Exact retained native metadata changed.');
          if (value.source && value.sha256 !== (index ? proof.indexSource : proof.tableSource))
            throw new Error('Exact retained native source changed.');
          record(row);
        },
        options,
      );
      if (index && !active) {
        const stored = await readDdicEvidence(
          client,
          pinnedDdicSelection(fixture.type, fixture.name),
          'active',
          options,
        );
        record({
          snapshot: fixture.owner,
          requestedVersion: 'active',
          nativeVersion: stored.version,
          sha256: ddicHash(stored.xml),
          body: stored.xml,
        });
        if (stored.version !== 'active' || ddicHash(stored.xml) !== proof.indexActive)
          throw new Error('Retained index active base changed.');
        const path = fixture.owner + '/source/main?version=active',
          source = await client.http.get(path, { Accept: 'application/json', 'Cache-Control': 'no-cache' }, options);
        record({ source: path, requestedVersion: 'active', sha256: ddicHash(source.body), body: source.body });
        if (ddicHash(source.body) !== proof.indexActiveSource) throw new Error('Retained index active source changed.');
        current.canonicalHashes.push(ddicHash(JSON.stringify(stored.root.canonicalValue({}))));
        indexFields = current.fields;
      } else if (after) {
        if (!indexFields) throw new Error('Missing exact retained index receipt.');
        // Native read-only links/timestamps remain governed by the shared projection; no stored field may change.
        assertSavedFields(indexFields, current.fields, []);
      }
      return current;
    },
  };
}
