/** Exact two-view retained draft, then only the owned settings activation/parent coupling. */
import type { AdtClient } from '../../../src/adt/client.js';
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { pinnedDdicSelection, readDdicEvidence } from '../../../src/adt/pinned-ddic-owner.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import { ddicHash } from './native-ddic-evidence.js';
import { tableSnapshot } from './native-ddic-table-evidence.js';
import type { TableFixture } from './native-ddic-table-fixtures.js';
import { TABLE_SETTINGS_RECEIPTS } from './native-ddic-table-settings-fixed.js';
import type { DdicWorkflowReceipt } from './native-ddic-workflow.js';
const core = 'http://www.sap.com/adt/core',
  atom = 'http://www.w3.org/2005/Atom',
  ns = 'http://www.sap.com/dictionary/table/settings';
const settingsInvariant = (xml: string) =>
  nativeXmlRoot(xml, 'tableSettings', ns, true).canonicalValue({
    omitAttribute: (name, namespace, depth) =>
      depth === 0 && namespace === core && ['version', 'changedAt'].includes(name),
    omitChild: (name, namespace, child, depth) =>
      depth === 1 &&
      namespace === atom &&
      name === 'link' &&
      child.attribute('rel', '') === 'http://www.sap.com/adt/relations/objectstates',
  });
export function settingsTailEvidence() {
  // This value can only originate from the fixed hash-bound size2 native receipt below.
  let savedSettingsInvariant: string | undefined;
  const snapshot = async (
    client: AdtClient,
    fixture: TableFixture,
    updated: boolean,
    active: boolean,
    record: (v: unknown) => void,
    options: AdtRequestOptions,
  ): Promise<DdicWorkflowReceipt> => {
    if (!['TABL/DT', 'TABL/DTT'].includes(fixture.type))
      return tableSnapshot(client, fixture, updated, active, record, options);
    if (active) {
      const result = await tableSnapshot(
        client,
        fixture,
        fixture.type === 'TABL/DTT',
        true,
        (row) => {
          const value = row as { snapshot?: string; sha256?: string; body?: string };
          if (value.snapshot) {
            if (fixture.type === 'TABL/DT' && value.sha256 !== TABLE_SETTINGS_RECEIPTS.tableActive)
              throw new Error('Parent activation changed more than the bound version/link/ETag coupling.');
            if (fixture.type === 'TABL/DTT') {
              const root = nativeXmlRoot(value.body!, 'tableSettings', ns, true),
                time = root.attribute('changedAt', core);
              if (
                !savedSettingsInvariant ||
                JSON.stringify(settingsInvariant(value.body!)) !== savedSettingsInvariant ||
                !time ||
                !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(time) ||
                !Number.isFinite(Date.parse(time)) ||
                Date.parse(time) < Date.parse('2026-11-04T15:27:22Z')
              )
                throw new Error('Settings activation changed unselected full native metadata.');
            }
          }
          record(row);
        },
        options,
      );
      if (fixture.type === 'TABL/DT' && result.sourceHash !== TABLE_SETTINGS_RECEIPTS.source)
        throw new Error('Owned coupled parent source changed.');
      return result;
    }
    const values = [];
    for (const version of [undefined, 'active', 'inactive'] as const) {
      const value = await readDdicEvidence(client, pinnedDdicSelection(fixture.type, fixture.name), version, options);
      const table = fixture.type === 'TABL/DT',
        expected = table
          ? version === 'inactive'
            ? TABLE_SETTINGS_RECEIPTS.tableInactive
            : TABLE_SETTINGS_RECEIPTS.tableActive
          : version === 'active'
            ? TABLE_SETTINGS_RECEIPTS.settingsActive
            : TABLE_SETTINGS_RECEIPTS.settingsInactive;
      record({
        snapshot: fixture.owner,
        requestedVersion: version ?? 'default',
        nativeVersion: value.version,
        sha256: ddicHash(value.xml),
        body: value.xml,
      });
      if (ddicHash(value.xml) !== expected) throw new Error('Exact retained per-view parent/settings receipt changed.');
      if (table) {
        const path = fixture.owner + '/source/main' + (version ? `?version=${version}` : '');
        const response = await client.http.get(path, { Accept: 'text/plain', 'Cache-Control': 'no-cache' }, options);
        record({
          source: path,
          requestedVersion: version ?? 'default',
          sha256: ddicHash(response.body),
          bytes: Buffer.byteLength(response.body),
          body: response.body,
        });
        if (
          ddicHash(response.body) !== TABLE_SETTINGS_RECEIPTS.source ||
          Buffer.byteLength(response.body) !== TABLE_SETTINGS_RECEIPTS.sourceBytes ||
          sourceHash(response.body) !== TABLE_SETTINGS_RECEIPTS.source
        )
          throw new Error('Retained coupled parent source changed.');
      } else if (version !== 'active') savedSettingsInvariant = JSON.stringify(settingsInvariant(value.xml));
      values.push(value);
    }
    return {
      hash: values[0].hash,
      fields: values[0].fields,
      canonicalHashes: values.map((v) => ddicHash(JSON.stringify(v.root.canonicalValue({})))),
      updated: fixture.type === 'TABL/DTT',
      active: false,
      ...(fixture.type === 'TABL/DT' ? { sourceHash: TABLE_SETTINGS_RECEIPTS.source } : {}),
    };
  };
  return {
    snapshot,
    refreshImplicitParent: async (
      client: AdtClient,
      child: TableFixture,
      parent: TableFixture,
      prior: DdicWorkflowReceipt,
      record: (v: unknown) => void,
      options: AdtRequestOptions,
    ) => {
      if (
        child.type !== 'TABL/DTT' ||
        parent.type !== 'TABL/DT' ||
        child.dependencies.length !== 1 ||
        child.dependencies[0] !== parent.owner ||
        prior.active ||
        prior.updated ||
        prior.sourceHash !== TABLE_SETTINGS_RECEIPTS.source
      )
        throw new Error('Only the bound owned settings activation can refresh its retained parent.');
      return snapshot(client, parent, false, true, record, options);
    },
  };
}
