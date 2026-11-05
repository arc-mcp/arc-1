/** Fresh observed native identity/state and exact source receipts, never query-inferred activation. */

import { pinnedClassIncludeAbsent } from '../../../src/adt/class-include-write.js';
import type { AdtClient } from '../../../src/adt/client.js';
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { rapEvidence } from '../../../src/adt/pinned-rap-evidence.js';
import {
  type PinnedBindingEvidence,
  pinnedBindingSelection,
  readBindingDocument,
} from '../../../src/adt/pinned-service-binding-owner.js';
import { editableSourceEquals, sourceHash } from '../../../src/adt/source-precondition.js';
import { ddicHash } from './native-ddic-evidence.js';
import { tableSnapshot } from './native-ddic-table-evidence.js';
import type { TableFixture } from './native-ddic-table-fixtures.js';
import { declarativeSnapshot } from './native-declarative-evidence.js';
import type { DeclarativeFixture } from './native-declarative-fixtures.js';
import { rapDocumentSnapshot } from './native-rap-documents-evidence.js';
import type { RapFixture } from './native-rap-fixtures.js';

const core = 'http://www.sap.com/adt/core';
export interface RapReceipt {
  active: boolean;
  fingerprint: string;
  sourceHashes: Record<string, string>;
  sources?: Record<string, string>;
  metadataHash?: string;
  /** Complete namespace-bound BDEF views, retained for an explicit owned-document link transition. */
  metadataViews?: string[];
  published?: boolean;
  bindingCreated?: boolean;
}
export async function rapSnapshot(
  client: AdtClient,
  f: RapFixture,
  active: boolean,
  record: (v: unknown) => void,
  options: AdtRequestOptions,
  generated?: ReadonlyMap<string, string>,
  published?: boolean,
): Promise<RapReceipt> {
  if (f.type === 'SKTD') return rapDocumentSnapshot(client, f, active, record, options);
  if (f.type === 'TABL/DT') {
    const proof = await tableSnapshot(client, f as TableFixture, false, active, record, options);
    return {
      active,
      fingerprint: ddicHash(JSON.stringify(proof.canonicalHashes)),
      sourceHashes: { main: proof.sourceHash! },
    };
  }
  if (f.type === 'DDLS' || f.type === 'BDEF' || f.type === 'SRVD') {
    const metadataViews: string[] = [];
    const proof = await declarativeSnapshot(
      client.http,
      { ...f, type: f.type, source: f.create.source!, updatedSource: f.create.source! } as DeclarativeFixture,
      f.create.source!,
      active,
      (row) => {
        record(row);
        const value = row as { read?: string; body?: string; status?: number };
        if (
          f.type === 'BDEF' &&
          value.status === 200 &&
          typeof value.body === 'string' &&
          [f.owner, `${f.owner}?version=active`].includes(value.read ?? '')
        )
          metadataViews.push(
            JSON.stringify(
              nativeXmlRoot(value.body, 'blueSource', 'http://www.sap.com/wbobj/blue', true).canonicalValue({}),
            ),
          );
      },
      options,
    );
    if (f.type === 'BDEF' && metadataViews.length !== (active ? 2 : 1))
      throw new Error('Complete BDEF metadata views required.');
    return {
      active,
      fingerprint: ddicHash(JSON.stringify(proof)),
      sourceHashes: { main: proof.sourceHash },
      ...(f.type === 'BDEF' ? { metadataViews } : {}),
    };
  }
  if (f.type === 'SRVB') {
    const views: PinnedBindingEvidence[] = [];
    for (const version of active ? ([undefined, 'active'] as const) : ([undefined] as const)) {
      const { xml, evidence: e } = await readBindingDocument(client, pinnedBindingSelection(f.name), version, options);
      record({
        binding: f.owner,
        requestedVersion: version ?? 'default',
        body: xml,
        sha256: ddicHash(xml),
        metadataHash: e.metadataHash,
      });
      const root = nativeXmlRoot(xml, 'serviceBinding', 'http://www.sap.com/adt/ddic/ServiceBindings', true);
      if (
        e.packageName !== '$TMP' ||
        e.description !== f.description ||
        (active
          ? e.nativeVersion !== 'active' || e.inactiveAlternative
          : !['inactive', 'new'].includes(e.nativeVersion ?? '')) ||
        e.bindingType !== 'ODATA' ||
        e.odataVersion !== 'V4' ||
        e.category !== '1' ||
        e.published !== (published ?? false) ||
        e.bindingCreated === undefined ||
        (!active && e.bindingCreated !== false) ||
        (published !== undefined && e.bindingCreated !== true) ||
        (published !== undefined && e.implementation !== f.name) ||
        e.services.length !== 1 ||
        e.services[0].name !== f.name ||
        e.services[0].version !== '0001' ||
        e.services[0].serviceDefinition !== f.create.serviceDefinition ||
        ['createdBy', 'changedBy'].some((k) => {
          const v = root.attribute(k, core);
          return v !== undefined && v !== 'MARIAN';
        })
      )
        throw new Error('Fixed native V4 binding identity/state unconfirmed.');
      views.push(e);
    }
    if (views.some((v) => v.metadataHash !== views[0].metadataHash)) throw new Error('Binding native views differ.');
    const e = views[0];
    return {
      active,
      fingerprint: e.metadataHash,
      metadataHash: e.metadataHash,
      sourceHashes: {},
      published: e.published,
      bindingCreated: e.bindingCreated,
    };
  }
  const evidence = rapEvidence(client, f.name);
  const metadata = await evidence.classMetadata(client.http, active);
  const currentMetadata = active ? await evidence.classMetadata(client.http) : metadata;
  if (
    active &&
    (currentMetadata.version !== 'active' ||
      currentMetadata.includes.some((i) => i.version !== 'active') ||
      currentMetadata.bdefName !== metadata.bdefName ||
      currentMetadata.packageName !== metadata.packageName)
  )
    throw new Error('Behavior pool editable state is not active.');
  const currentBefore = active ? await evidence.get(client.http, f.owner) : undefined;
  const before = await evidence.get(client.http, f.owner + (active ? '?version=active' : ''));
  const root = nativeXmlRoot(before, 'abapClass', 'http://www.sap.com/adt/oo/classes', true);
  if (
    metadata.packageName !== '$TMP' ||
    metadata.bdefName !== f.name.replace('ZBP_RP_', 'ZRRP_') ||
    root.attribute('description', core) !== f.description ||
    ['createdBy', 'changedBy'].some((k) => {
      const v = root.attribute(k, core);
      return v !== undefined && v !== 'MARIAN';
    }) ||
    (active && (metadata.version !== 'active' || metadata.includes.some((i) => i.version !== 'active')))
  )
    throw new Error('Native behavior-pool identity, marker or state unconfirmed.');
  const sources: Record<string, string> = {},
    hashes: Record<string, string> = {};
  for (const part of ['main', 'definitions', 'implementations', 'macros', 'testclasses']) {
    if (!['main', 'definitions', 'implementations'].includes(part) && !metadata.includes.some((i) => i.part === part))
      continue;
    const path = `${f.owner}/${part === 'main' ? 'source/main' : `includes/${part}`}`;
    try {
      const source = await evidence.get(client.http, path + (active ? '?version=active' : ''), true);
      if (part === 'main' && !editableSourceEquals(source, f.create.source!))
        throw new Error('Behavior pool main source changed.');
      if (generated?.has(part) && !editableSourceEquals(source, generated.get(part)!))
        throw new Error('Generated include readback differs.');
      if (active && sourceHash(await evidence.get(client.http, path, true)) !== sourceHash(source))
        throw new Error('Behavior pool saved and active sources differ.');
      sources[part] = source;
      hashes[part] = sourceHash(source);
    } catch (error) {
      if (part === 'main' || active || generated?.has(part) || !pinnedClassIncludeAbsent(error)) throw error;
      sources[part] = '';
      hashes[part] = 'typed-absent';
      record({ include: path, absence: 'typed-native-include' });
    }
  }
  const after = await evidence.get(client.http, f.owner + (active ? '?version=active' : ''));
  const beforeHash = ddicHash(JSON.stringify(root.canonicalValue({}))),
    afterHash = ddicHash(
      JSON.stringify(nativeXmlRoot(after, 'abapClass', 'http://www.sap.com/adt/oo/classes', true).canonicalValue({})),
    );
  const currentAfter = active ? await evidence.get(client.http, f.owner) : undefined;
  const currentHash = (xml: string) =>
    ddicHash(
      JSON.stringify(nativeXmlRoot(xml, 'abapClass', 'http://www.sap.com/adt/oo/classes', true).canonicalValue({})),
    );
  if (
    currentBefore !== undefined &&
    currentAfter !== undefined &&
    currentHash(currentBefore) !== currentHash(currentAfter)
  )
    throw new Error('Behavior pool editable metadata changed during active readback.');
  if (beforeHash !== afterHash) throw new Error('Behavior pool metadata changed across source observations.');
  record({
    behaviorPool: f.owner,
    nativeVersion: metadata.version,
    rootEntity: metadata.bdefName,
    includes: metadata.includes,
    metadataHash: beforeHash,
    sourceHashes: hashes,
  });
  return {
    active,
    fingerprint: ddicHash(
      JSON.stringify([beforeHash, currentBefore === undefined ? null : currentHash(currentBefore), hashes]),
    ),
    sourceHashes: hashes,
    sources,
  };
}
