/** Native evidence for the fixed DOMA/DTEL graph. No inferred state from a requested version. */
import { createHash } from 'node:crypto';
import type { AdtClient } from '../../../src/adt/client.js';
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import { pinnedDdicSelection, readDdicEvidence } from '../../../src/adt/pinned-ddic-owner.js';
import { assertSavedFields, derivedMetadataFields } from '../../../src/adt/pinned-metadata-projection.js';
import type { DdicFixture } from './native-ddic-fixtures.js';
import { assertDdicStateAlternatives } from './native-ddic-state.js';
import { declarativeInventoryClean } from './native-declarative-evidence.js';
import type { DeclarativeFixture } from './native-declarative-fixtures.js';
import { packageOwnerAbsent } from './native-package-evidence.js';
export const ddicHash = (value: string) => createHash('sha256').update(value).digest('hex');
const core = 'http://www.sap.com/adt/core';
export async function ddicSnapshot(
  client: AdtClient,
  fixture: DdicFixture,
  updated: boolean,
  active: boolean,
  record: (value: unknown) => void,
  options: AdtRequestOptions,
) {
  const views = [];
  for (const version of active ? ([undefined, 'active', 'inactive'] as const) : ([undefined, 'inactive'] as const)) {
    const value = await readDdicEvidence(client, pinnedDdicSelection(fixture.type, fixture.name), version, options);
    const root = value.root;
    if (
      value.packageName !== '$TMP' ||
      (active
        ? value.version !== 'active'
        : updated
          ? value.version !== 'inactive'
          : !['inactive', 'new'].includes(value.version)) ||
      root.attribute('createdBy', core) !== 'MARIAN' ||
      (root.attribute('changedBy', core) && root.attribute('changedBy', core) !== 'MARIAN') ||
      root.attribute('description', core) !==
        (updated && fixture.type === 'DOMA' ? fixture.update.description : fixture.description)
    )
      throw new Error('DDIC native identity/state/description unconfirmed.');
    assertDdicStateAlternatives(root, fixture, active);
    const fields = value.fields;
    if (fixture.type === 'DOMA') {
      if (
        fields.get('/doma:content/doma:typeInformation/doma:datatype') !== 'CHAR' ||
        Number(fields.get('/doma:content/doma:typeInformation/doma:length')) !== 4 ||
        fields.get('/doma:content/doma:outputInformation/doma:lowercase') !== 'true' ||
        fields.get('/doma:content/doma:outputInformation/doma:signExists') !== 'false' ||
        fields.get('/doma:content/doma:valueInformation/doma:fixValues/doma:fixValue/doma:low') !== 'A' ||
        fields.get('/doma:content/doma:valueInformation/doma:fixValues/doma:fixValue[1]/doma:low') !== 'B'
      )
        throw new Error('DDIC domain content unconfirmed.');
    } else if (
      fields.get('/dtel:dataElement/dtel:typeKind') !== 'domain' ||
      fields.get('/dtel:dataElement/dtel:typeName') !== fixture.create.domainName ||
      fields.get('/dtel:dataElement/dtel:deactivateInputHistory') !== 'true' ||
      fields.get('/dtel:dataElement/dtel:changeDocument') !== 'false' ||
      fields.get('/dtel:dataElement/dtel:shortFieldLabel') !==
        (updated ? fixture.update.shortLabel : fixture.create.shortLabel) ||
      fields.get('/dtel:dataElement/dtel:mediumFieldLabel') !== fixture.create.mediumLabel ||
      fields.get('/dtel:dataElement/dtel:longFieldLabel') !== fixture.create.longLabel ||
      fields.get('/dtel:dataElement/dtel:headingFieldLabel') !== fixture.create.headingLabel
    )
      throw new Error('DDIC data element content unconfirmed.');
    const first = views[0];
    if (first) {
      if (first.version !== value.version) throw new Error('DDIC native version views disagree.');
      assertSavedFields(first.fields, fields, derivedMetadataFields(fixture.type, first.fields), true);
    }
    record({
      snapshot: fixture.owner,
      requestedVersion: version ?? 'default',
      nativeVersion: value.version,
      metadataHash: value.hash,
      bytes: Buffer.byteLength(value.xml),
      sha256: ddicHash(value.xml),
      body: value.xml,
    });
    views.push(value);
  }
  const first = views[0]!;
  return {
    hash: first.hash,
    fields: first.fields,
    canonicalHashes: views.map((v) => ddicHash(JSON.stringify(v.root.canonicalValue({})))),
    updated,
    active,
  };
}
export type DdicReceipt = Awaited<ReturnType<typeof ddicSnapshot>>;
export async function ddicAbsence<F extends { owner: string; name: string }>(
  client: AdtClient,
  fixtures: readonly F[],
  record: (value: unknown) => void,
  options: AdtRequestOptions,
  onUnconfirmed?: (fixtures: readonly F[]) => void,
  inventoryName?: (fixture: F) => string,
) {
  for (const fixture of fixtures) {
    try {
      await packageOwnerAbsent(client.http, fixture, record, options);
    } catch (error) {
      onUnconfirmed?.([fixture]);
      throw error;
    }
  }
  try {
    await declarativeInventoryClean(
      client.http,
      (inventoryName
        ? fixtures.map((f) => ({ ...f, name: inventoryName(f) }))
        : fixtures) as unknown as readonly DeclarativeFixture[],
      record,
      options,
    );
  } catch (error) {
    onUnconfirmed?.(fixtures);
    throw error;
  }
}
