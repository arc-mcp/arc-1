/** Current native identity/version and raw receipts; query parameters never establish active state. */
import type { AdtClient } from '../../../src/adt/client.js';
import { prepareDdicDdlSourceVerification } from "../../../src/adt/source-precondition.js";
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import { parseLockObject } from '../../../src/adt/lock-object.js';
import { pinnedDdicSelection, readDdicEvidence } from '../../../src/adt/pinned-ddic-owner.js';
import { assertSavedFields, derivedMetadataFields } from '../../../src/adt/pinned-metadata-projection.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import { parseTableSettings } from '../../../src/adt/table-settings.js';
import { ddicHash } from './native-ddic-evidence.js';
import { assertDdicStateAlternatives } from './native-ddic-state.js';
import type { TableFixture } from './native-ddic-table-fixtures.js';

const core = 'http://www.sap.com/adt/core';
export async function tableSnapshot(
  client: AdtClient,
  fixture: TableFixture,
  updated: boolean,
  active: boolean,
  record: (v: unknown) => void,
  options: AdtRequestOptions,
) {
  const views = [],
    hashes: string[] = [];
  for (const version of active ? ([undefined, 'active', 'inactive'] as const) : ([undefined, 'inactive'] as const)) {
    const value = await readDdicEvidence(client, pinnedDdicSelection(fixture.type, fixture.name), version, options);
    record({
      snapshot: fixture.owner,
      requestedVersion: version ?? 'default',
      nativeVersion: value.version,
      metadataHash: value.hash,
      sha256: ddicHash(value.xml),
      bytes: Buffer.byteLength(value.xml),
      body: value.xml,
    });
    if (
      value.packageName !== '$TMP' ||
      value.root.attribute('createdBy', core) !== 'MARIAN' ||
      (value.root.attribute('changedBy', core) && value.root.attribute('changedBy', core) !== 'MARIAN') ||
      value.root.attribute('description', core) !== fixture.description ||
      (active
        ? value.version !== 'active'
        : updated && fixture.type !== 'TABL/DTI'
          ? value.version !== 'inactive'
          : !['new', 'inactive'].includes(value.version))
    )
      throw new Error('Table graph identity/marker/native version unconfirmed.');
    assertDdicStateAlternatives(value.root, fixture, active);
    if (fixture.type === 'TABL/DTT') {
      const parsed = parseTableSettings(value.xml, fixture.name);
      const sizePath = '/' + JSON.stringify(['http://www.sap.com/dictionary/table/settings', 'sizeCategory']);
      if (
        value.fields.get(sizePath) !== String(parsed.source.sizeCategory) ||
        (updated ? parsed.source.sizeCategory !== 2 : parsed.source.sizeCategory === 2)
      )
        throw new Error('Settings change is not substantive or its requested value is missing.');
    } else if (fixture.type === 'ENQU') {
      const parsed = parseLockObject(value.xml),
        expected = JSON.parse(fixture.create.source!).primaryTable.tableName;
      if (
        value.fields.get('/enqu:content/enqu:allowRFC') !== 'false' ||
        value.fields.get('/enqu:content/enqu:primaryTable/enqu:tableName') !== expected ||
        value.fields.get('/enqu:content/enqu:primaryTable/enqu:lockMode') !== (updated ? 'S' : 'E') ||
        parsed.allowRFC ||
        parsed.primaryTable.tableName !== expected ||
        parsed.primaryTable.lockMode !== (updated ? 'S' : 'E') ||
        parsed.secondaryTables.length ||
        ((active || updated) && parsed.lockParameters.length !== 2) ||
        parsed.lockParameters.some(
          (p, i) =>
            value.fields.get(
              `/enqu:content/enqu:lockParameters/enqu:lockParameter${i ? `[${i}]` : ''}/enqu:parameterWanted`,
            ) !== 'true' ||
            p.parameterName !== ['CLIENT', 'ID'][i] ||
            p.fieldName !== ['CLIENT', 'ID'][i] ||
            p.tableName !== expected ||
            !p.parameterWanted,
        )
      )
        throw new Error('Owned ENQU table/definition/derived keys unconfirmed.');
      // Generated module references are retained in XML, never used as mutation authority.
    } else {
      const path = `${fixture.owner}/source/main${version ? `?version=${version}` : ''}`;
      const response = await client.http.get(
        path,
        { Accept: fixture.type === 'TABL/DTI' ? 'application/json' : 'text/plain', 'Cache-Control': 'no-cache' },
        options,
      );
      const hash = sourceHash(response.body);
      record({
        source: path,
        requestedVersion: version ?? 'default',
        bytes: Buffer.byteLength(response.body),
        sha256: ddicHash(response.body),
        sourceHash: hash,
        body: response.body,
      });
      if (fixture.type === 'TABL/DT') {
        if (!prepareDdicDdlSourceVerification(fixture.create.source!)(response.body))
          throw new Error('Table DDL changed.');
      } else {
        const actual = JSON.parse(response.body),
          expected = JSON.parse((updated ? fixture.update : fixture.create).source!);
        if (
          actual.formatVersion !== '1' ||
          actual.header?.description !== expected.header.description ||
          actual.header?.originalLanguage !== 'en' ||
          actual.uniqueIndex !== false ||
          actual.bufferIndexOnly !== false ||
          actual.textIndex !== false ||
          !Array.isArray(actual.indexFields) ||
          actual.indexFields.length !== expected.indexFields.length ||
          actual.indexFields.some(
            (f: { fieldName?: string }, i: number) => f.fieldName !== expected.indexFields[i].fieldName,
          )
        )
          throw new Error('Nonunique index source contract unconfirmed.');
      }
      if (hashes.length && hashes[0] !== hash) throw new Error('Source views disagree.');
      hashes.push(hash);
    }
    if (views[0]) {
      if (views[0].version !== value.version) throw new Error('Metadata views disagree.');
      assertSavedFields(views[0].fields, value.fields, derivedMetadataFields(fixture.type, views[0].fields), true);
    }
    views.push(value);
  }
  const first = views[0]!;
  return {
    hash: first.hash,
    fields: first.fields,
    canonicalHashes: views.map((v) => ddicHash(JSON.stringify(v.root.canonicalValue({})))),
    updated,
    active,
    ...(hashes.length ? { sourceHash: hashes[0] } : {}),
  };
}
