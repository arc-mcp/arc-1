/** Native metadata and exact source receipts, independently of successful adapter responses. */
import type { AdtClient } from '../../../src/adt/client.js';
import { prepareDdicDdlSourceVerification } from "../../../src/adt/source-precondition.js";
import { parseTableType } from '../../../src/adt/ddic-xml.js';
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import { pinnedDdicSelection, readDdicEvidence } from '../../../src/adt/pinned-ddic-owner.js';
import { assertSavedFields, derivedMetadataFields } from '../../../src/adt/pinned-metadata-projection.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import type { CollectionsFixture } from './native-ddic-collections-fixtures.js';
import { ddicHash } from './native-ddic-evidence.js';
import { assertDdicStateAlternatives } from './native-ddic-state.js';

const core = 'http://www.sap.com/adt/core',
  mc = 'http://www.sap.com/adt/MessageClass';
export async function collectionsSnapshot(
  client: AdtClient,
  fixture: CollectionsFixture,
  updated: boolean,
  active: boolean,
  record: (v: unknown) => void,
  options: AdtRequestOptions,
) {
  const views = [],
    sourceHashes: string[] = [];
  for (const version of active ? ([undefined, 'active', 'inactive'] as const) : ([undefined, 'inactive'] as const)) {
    const value = await readDdicEvidence(client, pinnedDdicSelection(fixture.type, fixture.name), version, options),
      root = value.root;
    record({
      snapshot: fixture.owner,
      requestedVersion: version ?? 'default',
      nativeVersion: value.version,
      metadataHash: value.hash,
      bytes: Buffer.byteLength(value.xml),
      sha256: ddicHash(value.xml),
      body: value.xml,
    });
    if (
      value.packageName !== '$TMP' ||
      (active
        ? value.version !== 'active'
        : updated
          ? value.version !== 'inactive'
          : !['new', 'inactive'].includes(value.version)) ||
      root.attribute('createdBy', core) !== 'MARIAN' ||
      (root.attribute('changedBy', core) && root.attribute('changedBy', core) !== 'MARIAN') ||
      root.attribute('description', core) !== fixture.description
    )
      throw new Error('Collections native identity/state unconfirmed.');
    assertDdicStateAlternatives(root, fixture, active);
    if (fixture.type === 'TTYP') {
      const row = parseTableType(value.xml);
      if (
        !row.plainStandardTable ||
        row.rowType !== (updated ? fixture.update.rowType : 'CHAR') ||
        row.rowTypeKind !== (updated ? 'dictionaryType' : 'predefinedAbapType') ||
        (!updated && (Number(row.rowTypeLength) !== 4 || Number(row.rowTypeDecimals) !== 0))
      )
        throw new Error('Table type row/key contract unconfirmed.');
    } else if (fixture.type === 'MSAG') {
      const expected = updated ? fixture.update.messages : fixture.create.messages;
      const rows = root.children('messages', mc);
      if (
        root.attribute('language', core) !== 'EN' ||
        root.attribute('masterLanguage', core) !== 'EN' ||
        rows.length !== expected.length ||
        rows.some(
          (r, i) =>
            r.attribute('msgno', mc) !== expected[i].number ||
            r.attribute('msgtext', mc) !== expected[i].shortText ||
            r.attribute('selfexplainatory', mc) !== 'true' ||
            r.attribute('documented', mc) !== 'false',
        )
      )
        throw new Error('Message class content/language/flags unconfirmed.');
    } else {
      const path = `${fixture.owner}/source/main${version ? `?version=${version}` : ''}`,
        source = await client.http.get(path, { Accept: 'text/plain', 'Cache-Control': 'no-cache' }, options);
      const hash = sourceHash(source.body);
      record({
        source: path,
        status: source.statusCode,
        bytes: Buffer.byteLength(source.body),
        sha256: ddicHash(source.body),
        sourceHash: hash,
        body: source.body,
      });
      if (
        !prepareDdicDdlSourceVerification(updated ? fixture.update.source : fixture.create.source)(source.body) ||
        (sourceHashes.length && sourceHashes[0] !== hash)
      )
        throw new Error('Structure source/state views disagree.');
      sourceHashes.push(hash);
    }
    if (views[0]) {
      if (views[0].version !== value.version) throw new Error('Collections metadata state views disagree.');
      assertSavedFields(views[0].fields, value.fields, derivedMetadataFields(fixture.type, views[0].fields), true);
    }
    views.push(value);
  }
  const first = views[0]!;
  return {
    hash: first.hash,
    metadataXml: first.xml,
    fields: first.fields,
    canonicalHashes: views.map((v) => ddicHash(JSON.stringify(v.root.canonicalValue({})))),
    updated,
    active,
    ...(sourceHashes.length ? { sourceHash: sourceHashes[0] } : {}),
  };
}
