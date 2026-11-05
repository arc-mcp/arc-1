/** Cleanup only for the one inactive DDLS retained by the failed 2 November v1 run. */
import type { AdtClient } from '../../../src/adt/client.js';
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { declarativeSnapshot } from './native-declarative-evidence.js';
import type { DeclarativeFixture } from './native-declarative-fixtures.js';
import { DeclarativeFailure } from './native-declarative-workflow.js';

import {
  checkFixedRecoveryRequest,
  runFixedDeclarativeRecovery,
  type DeclarativeRecoveryInput,
} from './native-declarative-recovery-shared.js';

const name = 'ZARC1_NV_61EDD87470C55DB0';
const description = 'ARC1 declarative 61EDD87470C55DB0';
// Historical source: deliberately retains the rejected alias. Recovery cannot create or repair it.
const source = `// ${description}
@EndUserText.label: '${description}'
@AccessControl.authorizationCheck: #NOT_REQUIRED
@Metadata.allowExtensions: true
define root view entity ${name} as select from sflight
{
  key carrid as Carrier,
  key connid as Connection,
  key fldate as FlightDate
}
`;
export const recoveryFixture: DeclarativeFixture = Object.freeze({
  type: 'DDLS',
  name,
  owner: '/sap/bc/adt/ddic/ddl/sources/zarc1_nv_61edd87470c55db0',
  packageName: '$TMP',
  description,
  source,
  updatedSource: source,
  dependencies: Object.freeze([]),
});
export const recoverySourceHash = '781de85d098984f7661581ebd222ee0f7875f17d57e4d02744694a1019f8c115';
// Canonical namespace-bound full metadata from the fresh post-failure GET-only inspection.
// It includes native version=inactive and explicit MARIAN authorship, package and marker.
export const recoveryMetadataHash = '37b72e19abf15b3d21f5faaa43440ad0acb0c3492ba774ba3345ab3ce6218c54';
export const recoveryConfig = {
  ...DEFAULT_CONFIG,
  client: '001',
  systemType: 'onprem' as const,
  allowWrites: true,
  targetId: 'A4H/001',
  allowedPackages: ['$TMP'],
  lintBeforeWrite: false,
  checkBeforeWrite: false,
  multiTargetWrite: {
    target: 'A4H/001',
    enabled: true,
    allowedPackages: ['$TMP'],
    allowedTransports: [],
    serverAllowedTransports: [],
  },
};

/** A narrower subset of the reviewed experiment: no create, save, activation or foreign owner. */
export function checkRecoveryRequest(method: string, path: string, body?: string) {
  checkFixedRecoveryRequest(
    recoveryFixture,
    [
      recoveryFixture.owner,
      `${recoveryFixture.owner}/source/main?version=inactive`,
      '/sap/bc/adt/activation/inactiveobjects',
    ],
    method,
    path,
    body,
  );
}

/** The original source and post-failure metadata must still match, including inactive state. */
export async function verifyRecoveryReceipt(
  base: AdtClient,
  record: (row: unknown) => void,
  options: AdtRequestOptions,
) {
  const current = await declarativeSnapshot(base.http, recoveryFixture, source, false, record, options);
  if (current.sourceHash !== recoverySourceHash || current.metadataHash !== recoveryMetadataHash)
    throw new DeclarativeFailure('receipt-drift');
}

export async function runDeclarativeRecovery(input: DeclarativeRecoveryInput) {
  return runFixedDeclarativeRecovery(input, {
    fixture: recoveryFixture,
    config: recoveryConfig,
    checkRequest: checkRecoveryRequest,
    verifyReceipt: verifyRecoveryReceipt,
  });
}
