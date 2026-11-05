/** Exact retained V5 owners; no historical fixture, claim or source is rewritten. */
import { createHash } from 'node:crypto';
import { declarativeV5Fixtures } from './native-declarative-v5-fixtures.js';
import { declarativeV5References } from './native-declarative-v5-references.js';
export const RETAINED_PROTOCOL = 'pr1142-native-declarative-v5-retained-v2';
export const RETAINED_SUFFIX = '3481C958A6CA5AC1';
export const failedRevision = '59eab1d09c331e605593284700bc180423aa74fe';
export const originalResultHash = '36da5677a1a68a509941a0fc6c2ed613b78b036228f41be6d307273abbe6732b';
export const retainedLedgerHash = 'c1f70879f4facc49d7f06461aada7c648368405c7d83f764fca194c246c9fd68';
export const retainedHash = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
export const originalFixtures = declarativeV5Fixtures(RETAINED_SUFFIX);
export const retainedView = originalFixtures[0];
export const originalService = originalFixtures[5];
export const absentPeers = Object.freeze(originalFixtures.slice(1, 5));
export const absentReference = declarativeV5References(originalFixtures)[0];
export const retainedOwners = Object.freeze([originalService.owner, retainedView.owner]);
export const revisedLabel = `${originalService.description} revised`;
const marker = `// ${originalService.description}\n`;
if (!originalService.source.startsWith(marker)) throw new Error('The historical service source changed.');
const corrected = originalService.source.slice(marker.length);
export const retainedService = Object.freeze({
  ...originalService,
  source: corrected,
  updatedSource: corrected.replace(`'${originalService.description}'`, `'${revisedLabel}'`),
});
export const initialHashes = Object.freeze({
  serviceMetadata: 'd11a9f95d8fb4bb441125e2141a42ce4ee75c178f360e7949088534bb727cecf',
  serviceSource: 'fb29a9b67fceb26e82ce701b003c860f82075d09d0ddf21e03875439c386ef6a',
  viewMetadata: 'ffeaf6face9401d283dfc5143c24bcd7fc178abfe4b7455e4935c36859fc3111',
  viewSource: '20800608b7cb47ae19e944191bf5c3ba906cf8cab478c4a18535549535c67398',
  correctedSource: '30a88a649a3a3761c61aa785327d0d8ff872f366959f1d5ab5d704ecb9db20fe',
  revisedSource: '0c042b46e8d74d7ee0ab45a2b684f057aa369d9e4f5e5f174fafa8ebfd37d26c',
});
if (
  retainedHash(retainedService.source) !== initialHashes.correctedSource ||
  retainedHash(retainedService.updatedSource) !== initialHashes.revisedSource
)
  throw new Error('The fixed comment-free source plan changed.');
export const retainedStages = Object.freeze([
  'correct',
  'activate-corrected',
  'revise-label',
  'activate-revised',
  'delete-service',
  'delete-view',
] as const);
export type RetainedStage = (typeof retainedStages)[number] | 'inspect' | 'final';
export const retainedFacts = Object.freeze({
  failedRevision,
  originalResultHash,
  retainedLedgerHash,
  originalOutcome: 'failed-SRVD-comment-preaudit; original claim permanently consumed',
  priorCompleted: 'five create/activate/update/activate lifecycles; four owners deleted',
  continuation: 'existing SRVD correction and qualification, then SRVD-before-view cleanup; no CREATE',
  authentication: 'Basic-native-contract-only; not PP/public admission',
  priorRetainedAttempt: 'v1 stopped before mutation: missing pinned policy; consumed claim is preserved',
  priorRetainedResultHash: '5729e99676ec7a831d7f5989170396bf22e69974ca9741e150fd146d211c58da',
  priorRetainedAuditHash: 'c336ace51aebc5360a8c64555303c425d5b8857afa4d2e4f5af2fb8a78801c77',
});
