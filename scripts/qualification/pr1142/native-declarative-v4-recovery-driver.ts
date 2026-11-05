/** Fixed two-owner recovery: BDEF first; its exact DDLS parent only after absence and own cleanup. */
import { createHash } from 'node:crypto';
import type { AdtClient } from '../../../src/adt/client.js';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import { pinnedDeclarativeMetadata, pinnedDeclarativeSelection } from "../../../src/adt/pinned-repository-owner.js";
import { pinnedDeclarativeStateLinkVersion } from "../../../src/adt/pinned-repository-owner.js";
import { RequestAttemptBudget } from '../../../src/adt/request-attempt-budget.js';
import { declarativeAbsence, declarativeEvidenceRead, declarativeOwnerAbsent } from './native-declarative-evidence.js';
import type { DeclarativeFixture } from './native-declarative-fixtures.js';
import { recoveryConfig } from './native-declarative-recovery-driver.js';
import {
  checkFixedRecoveryRequest,
  type DeclarativeRecoveryInput,
  runFixedDeclarativeRecovery,
} from './native-declarative-recovery-shared.js';
import {
  v4MetadataHashes,
  v4RecoveryFixtures,
  v4RecoveryOwners,
  v4ReferencedClass,
  v4SourceHashes,
} from './native-declarative-v4-recovery-fixed.js';
import { boundSourceCheck, DeclarativeFailure, declarativeFailureRow } from './native-declarative-workflow.js';
import { nativeRequestPolicy } from './native-observed-http.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const core = 'http://www.sap.com/adt/core';
type RecordRow = (row: unknown) => void;

export function checkV4RecoveryRequest(fixture: DeclarativeFixture, method: string, path: string, body?: string) {
  if (!v4RecoveryOwners.includes(fixture)) throw new DeclarativeFailure('request-out-of-scope');
  checkFixedRecoveryRequest(
    fixture,
    [
      fixture.owner,
      `${fixture.owner}?version=active`,
      ...['', '?version=active', '?version=inactive'].map((query) => `${fixture.owner}/source/main${query}`),
      '/sap/bc/adt/activation/inactiveobjects',
    ],
    method,
    path,
    body,
  );
}
async function receipt(base: AdtClient, fixture: DeclarativeFixture, record: RecordRow, options: AdtRequestOptions) {
  const prefix = fixture.type === 'BDEF' ? 'BDEF' : 'ABSTRACT-DDLS';
  const selected = pinnedDeclarativeSelection(fixture.type, fixture.name);
  for (const requested of ['default', 'active'] as const) {
    const response = await declarativeEvidenceRead(
      base.http,
      fixture.owner + (requested === 'active' ? '?version=active' : ''),
      'application/*',
      nativeRequestPolicy(options),
      record,
      'body',
    );
    if (response.statusCode !== 200) throw new DeclarativeFailure('metadata-status');
    const { root, packageName } = pinnedDeclarativeMetadata(response.body, selected, true);
    const version = prefix === 'BDEF' && requested === 'default' ? 'inactive' : 'active';
    if (
      packageName !== '$TMP' ||
      root.attribute('version', core) !== version ||
      root.attribute('description', core) !== fixture.description ||
      ['createdBy', 'changedBy', 'responsible'].some((field) => root.attribute(field, core) !== 'MARIAN') ||
      hash(response.body) !== v4MetadataHashes[`${prefix}-${requested}-metadata.xml`]
    )
      throw new DeclarativeFailure('receipt-drift');
    const links = root
      .children('link', 'http://www.w3.org/2005/Atom')
      .filter((link) => link.attribute('rel', '') === 'http://www.sap.com/adt/relations/objectstates');
    if (
      prefix === 'BDEF'
        ? links.length !== 1 ||
          pinnedDeclarativeStateLinkVersion(fixture.type, fixture.owner, links[0].attribute('href', '')) !==
            (version === 'active' ? 'inactive' : 'active')
        : links.length !== 0
    )
      throw new DeclarativeFailure('metadata-state-link');
  }
  for (const requested of ['default', 'active', 'inactive'] as const) {
    const response = await declarativeEvidenceRead(
      base.http,
      `${fixture.owner}/source/main${requested === 'default' ? '' : `?version=${requested}`}`,
      'text/plain',
      nativeRequestPolicy(options),
      record,
      'body',
    );
    if (response.statusCode !== 200) throw new DeclarativeFailure('source-status');
    const media = Object.entries(response.headers)
      .find(([name]) => name.toLowerCase() === 'content-type')?.[1]
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (media !== 'text/plain') throw new DeclarativeFailure('source-media');
    if (hash(response.body) !== v4SourceHashes[`${prefix}-source-${requested}.abap`])
      throw new DeclarativeFailure('receipt-drift');
  }
  record({
    retainedOwner: fixture.owner,
    versions: prefix === 'BDEF' ? 'active-shell-and-inactive-draft' : 'active-with-inactive-source-fallback',
  });
}
async function absentPeers(base: AdtClient, record: RecordRow, options: AdtRequestOptions) {
  for (const other of v4RecoveryFixtures.filter((candidate) => !v4RecoveryOwners.includes(candidate)))
    await declarativeOwnerAbsent(base.http, other, record, options);
  await declarativeOwnerAbsent(base.http, v4ReferencedClass, record, options);
}
/** The reference is absence-only evidence; it never grants class ownership or modification. */
export async function verifyV4RecoveryReceipt(
  base: AdtClient,
  record: RecordRow,
  options: AdtRequestOptions,
  bdefAbsent: boolean,
) {
  if (bdefAbsent) await declarativeOwnerAbsent(base.http, v4RecoveryOwners[0], record, options);
  else await receipt(base, v4RecoveryOwners[0], record, options);
  await receipt(base, v4RecoveryOwners[1], record, options);
  await absentPeers(base, record, options);
}
class RecoveryAttempts extends RequestAttemptBudget {
  constructor(private readonly validate: () => void) {
    super(192);
  }
  override consume() {
    this.validate();
    super.consume();
  }
}
export async function runV4DeclarativeRecovery(input: DeclarativeRecoveryInput) {
  const verify = boundSourceCheck(input.verifySource);
  const assertContinuing = () => {
    verify();
    if (input.shouldStop()) throw new DeclarativeFailure('stopped');
  };
  const options = {
    deadline: Math.min(Date.now() + 180_000, input.deadline ?? Infinity),
    responseBudget: new DataResponseBudget(2 * 1024 * 1024, 'v4-recovery', true),
    attemptBudget: new RecoveryAttempts(assertContinuing),
  };
  const outcomes: { owner: string; result: Awaited<ReturnType<typeof runFixedDeclarativeRecovery>> }[] = [];
  let finalAbsenceConfirmed = false;
  let failure: ReturnType<typeof declarativeFailureRow> | undefined;
  try {
    for (const [index, fixture] of v4RecoveryOwners.entries()) {
      assertContinuing();
      const result = await runFixedDeclarativeRecovery(input, {
        fixture,
        config: recoveryConfig,
        requestPolicy: options,
        checkRequest: (method, path, body) => checkV4RecoveryRequest(fixture, method, path, body),
        verifyReceipt: (base, record, policy) => verifyV4RecoveryReceipt(base, record, policy, index === 1),
        verifyOtherAbsence: async (base, record, policy) => {
          if (index === 0) await receipt(base, v4RecoveryOwners[1], record, policy);
          else await declarativeOwnerAbsent(base.http, v4RecoveryOwners[0], record, policy);
          await absentPeers(base, record, policy);
        },
      });
      outcomes.push({ owner: fixture.owner, result });
      if (result.failure) break;
    }
    if (outcomes.length === 2 && outcomes.every(({ result }) => !result.failure)) {
      assertContinuing();
      await declarativeAbsence(input.base.http, v4RecoveryFixtures, input.record, options);
      await declarativeOwnerAbsent(input.base.http, v4ReferencedClass, input.record, options);
      assertContinuing();
      finalAbsenceConfirmed = true;
    }
  } catch (error) {
    failure = declarativeFailureRow(error);
    input.record({ recoveryUnconfirmed: true, ...failure });
  }
  const confirmedDeleted = outcomes.filter(({ result }) => result.confirmedDeleted).map(({ owner }) => owner);
  const cleanupConfirmed = outcomes.length === 2 && outcomes.every(({ result }) => result.cleanupConfirmed);
  const failed =
    !!failure || !finalAbsenceConfirmed || !cleanupConfirmed || outcomes.some(({ result }) => result.failure);
  return {
    failure: failed,
    mutationAttempted: outcomes.some(({ result }) => result.mutationAttempted),
    deleteAttempted: outcomes.some(({ result }) => result.deleteAttempted),
    confirmedDeleted,
    cleanupConfirmed,
    finalAbsenceConfirmed,
    stopped: input.shouldStop(),
    ...(failure ?? {}),
    outcomes,
    remaining: v4RecoveryOwners.filter((owner) => !confirmedDeleted.includes(owner.owner)).map((owner) => owner.owner),
    inspectionRequired: failed ? v4RecoveryOwners.map((owner) => owner.owner) : [],
  };
}
