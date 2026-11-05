/** Cleanup only: retained active original + inactive updated DDLS, with all five other owners absent. */
import { createHash } from 'node:crypto';
import type { AdtClient } from '../../../src/adt/client.js';
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import { pinnedDeclarativeMetadata, pinnedDeclarativeSelection } from "../../../src/adt/pinned-repository-owner.js";
import { pinnedDeclarativeStateLinkVersion } from "../../../src/adt/pinned-repository-owner.js";
import { declarativeEvidenceRead, declarativeOwnerAbsent } from './native-declarative-evidence.js';
import { recoveryConfig } from './native-declarative-recovery-driver.js';
import {
  checkFixedRecoveryRequest,
  runFixedDeclarativeRecovery,
  type DeclarativeRecoveryInput,
} from './native-declarative-recovery-shared.js';
import {
  v3RecoveryFixture as fixture,
  v3RecoveryFixtures,
  v3RetainedHashes,
} from './native-declarative-v3-recovery-fixed.js';
import { DeclarativeFailure } from './native-declarative-workflow.js';
import { nativeRequestPolicy } from './native-observed-http.js';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const core = 'http://www.sap.com/adt/core';
export function checkV3RecoveryRequest(method: string, path: string, body?: string) {
  checkFixedRecoveryRequest(
    fixture,
    [
      fixture.owner,
      `${fixture.owner}?version=active`,
      `${fixture.owner}/source/main?version=active`,
      `${fixture.owner}/source/main?version=inactive`,
      '/sap/bc/adt/activation/inactiveobjects',
    ],
    method,
    path,
    body,
  );
}
export async function verifyV3OtherAbsence(
  base: AdtClient,
  record: (row: unknown) => void,
  options: AdtRequestOptions,
) {
  for (const other of v3RecoveryFixtures.slice(1)) await declarativeOwnerAbsent(base.http, other, record, options);
}
/** This is a dual-version receipt, never an assertion that the owner has no inactive draft. */
export async function verifyV3RecoveryReceipt(
  base: AdtClient,
  record: (row: unknown) => void,
  options: AdtRequestOptions,
) {
  const selected = pinnedDeclarativeSelection(fixture.type, fixture.name);
  for (const version of ['inactive', 'active'] as const) {
    const path = fixture.owner + (version === 'active' ? '?version=active' : '');
    const response = await declarativeEvidenceRead(
      base.http,
      path,
      'application/*',
      nativeRequestPolicy(options),
      record,
      'body',
    );
    if (response.statusCode !== 200) throw new DeclarativeFailure('metadata-status');
    const { root, packageName } = pinnedDeclarativeMetadata(response.body, selected, true);
    if (
      packageName !== '$TMP' ||
      root.attribute('version', core) !== version ||
      root.attribute('description', core) !== fixture.description ||
      ['createdBy', 'changedBy', 'responsible'].some((field) => root.attribute(field, core) !== 'MARIAN')
    )
      throw new DeclarativeFailure('receipt-drift');
    const links = root
      .children('link', 'http://www.w3.org/2005/Atom')
      .filter((link) => link.attribute('rel', '') === 'http://www.sap.com/adt/relations/objectstates');
    if (
      links.length !== 1 ||
      pinnedDeclarativeStateLinkVersion(fixture.type, fixture.owner, links[0].attribute('href', '')) !==
        (version === 'active' ? 'inactive' : 'active')
    )
      throw new DeclarativeFailure('metadata-state-link');
    if (hash(JSON.stringify(root.canonicalValue({}))) !== v3RetainedHashes[`${version}Metadata`])
      throw new DeclarativeFailure('receipt-drift');
    const source = await declarativeEvidenceRead(
      base.http,
      `${fixture.owner}/source/main?version=${version}`,
      'text/plain',
      nativeRequestPolicy(options),
      record,
      'body',
    );
    if (source.statusCode !== 200) throw new DeclarativeFailure('source-status');
    const media = Object.entries(source.headers)
      .find(([key]) => key.toLowerCase() === 'content-type')?.[1]
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (media !== 'text/plain') throw new DeclarativeFailure('source-media');
    if (
      source.body !== (version === 'active' ? fixture.source : fixture.updatedSource) ||
      hash(source.body) !== v3RetainedHashes[`${version}Source`]
    )
      throw new DeclarativeFailure('receipt-drift');
  }
  await verifyV3OtherAbsence(base, record, options);
  record({ retainedVersions: fixture.owner, ...v3RetainedHashes, otherOwnersAbsent: 5 });
}
export function runV3DeclarativeRecovery(input: DeclarativeRecoveryInput) {
  return runFixedDeclarativeRecovery(input, {
    fixture,
    config: recoveryConfig,
    checkRequest: checkV3RecoveryRequest,
    verifyReceipt: verifyV3RecoveryReceipt,
    verifyOtherAbsence: verifyV3OtherAbsence,
  });
}
