/** Offline immutable intent, completed GET preflight and real post-prepare JPEG controls. */
import { join } from 'node:path';
import { z } from 'zod';
import { type DeclarativeBinding, PREREQUISITE_AGE_MS, privateEvidence } from './native-declarative-prerequisites.js';
import { jpegEvidenceSignature } from './native-declarative-v3-evidence.js';
import { privateDirectory } from './native-lock-binding.js';
import {
  ADDED_FORM,
  EDITED_FORM,
  GROUP,
  INCLUDE,
  INCLUDE_SOURCE,
  initialParameters,
  MARKER,
  MODULE,
  MODULE_SOURCE,
  owners,
  PROCEDURAL_PROTOCOL,
  PROCEDURAL_SUFFIX,
  ProceduralFailure,
  STAGES,
  TEXTS,
  updatedParameters,
} from './native-procedural-fixed.js';
export interface ProceduralPhaseProfile {
  protocol: string;
  stages: readonly string[];
  history?: { intent: string; result: string };
  /** Compiled cleanup profile only; omitted profiles retain the original complete reverse deletion scope. */
  finalDeletionOwners?: readonly string[];
}
export const standardProceduralProfile: ProceduralPhaseProfile = { protocol: PROCEDURAL_PROTOCOL, stages: STAGES };
export const proceduralIntentData = (binding: DeclarativeBinding, profile = standardProceduralProfile) => ({
  protocol: profile.protocol,
  binding: binding.evidence,
  owners,
  group: GROUP,
  module: MODULE,
  include: INCLUDE,
  description: MARKER,
  moduleSource: MODULE_SOURCE,
  includeSource: INCLUDE_SOURCE,
  texts: TEXTS,
  initialParameters,
  updatedParameters,
  editedForm: EDITED_FORM,
  addedForm: ADDED_FORM,
  stages: profile.stages,
  ...(profile.finalDeletionOwners ? { finalDeletionOwners: profile.finalDeletionOwners } : {}),
  ...(profile.history ? { history: profile.history } : {}),
  sourceEvidence:
    'Repository-bound current function metadata/source and function-owner native captures; no new native observation implied.',
  authentication: 'Basic-native-contract-only',
  identity: 'MARIAN',
  target: 'A4H/001',
  package: '$TMP',
  separateFunctionActivation: true,
});
export function readProceduralIntent(binding: DeclarativeBinding, profile = standardProceduralProfile) {
  privateDirectory(binding.root);
  const path = join(binding.root, 'intent.json'),
    saved = privateEvidence(path);
  const { createdAt, ...actual } = JSON.parse(saved.body.toString('utf8'));
  if (
    !z.iso.datetime().safeParse(createdAt).success ||
    JSON.stringify(actual) !== JSON.stringify(proceduralIntentData(binding, profile))
  )
    throw new ProceduralFailure('prerequisites');
  return {
    hash: saved.sha256,
    createdAt: Date.parse(createdAt),
    verify: () => {
      if (privateEvidence(path).sha256 !== saved.sha256) throw new ProceduralFailure('binding');
    },
  };
}
const search = z
  .object({
    observedAt: z.iso.datetime(),
    client: z.literal('001'),
    user: z.string(),
    table: z.literal('*'),
    argument: z.string(),
    lockCount: z.literal(0),
    evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const schema = z
  .object({
    protocol: z.literal(PROCEDURAL_PROTOCOL),
    phase: z.enum(['execute', 'final']),
    revision: z.string(),
    intentHash: z.string(),
    previousResultHash: z.string(),
    noConcurrentFixtureEditing: z.literal(true),
    suffixSearch: search,
    userSearch: search,
  })
  .strict();
export function readProceduralPrerequisites(
  binding: DeclarativeBinding,
  phase: 'execute' | 'final',
  now: number,
  profile = standardProceduralProfile,
) {
  const intent = readProceduralIntent(binding, profile);
  const preceding = phase === 'execute' ? 'preflight' : 'execute';
  privateDirectory(join(binding.root, preceding));
  const path = join(binding.root, preceding, 'result.json'),
    receipt = privateEvidence(path);
  const result = JSON.parse(receipt.body.toString('utf8'));
  if (
    result.protocol !== profile.protocol ||
    result.revision !== binding.evidence.revision ||
    result.intentHash !== intent.hash ||
    JSON.stringify(result.owners) !== JSON.stringify(owners) ||
    result.phase !== preceding ||
    result.failure !== false ||
    !z.iso.datetime().safeParse(result.startedAt).success ||
    !z.iso.datetime().safeParse(result.completedAt).success ||
    Date.parse(result.startedAt) <= intent.createdAt ||
    Date.parse(result.completedAt) < Date.parse(result.startedAt) ||
    Date.parse(result.completedAt) > now
  )
    throw new ProceduralFailure('prerequisites');
  if (
    phase === 'execute'
      ? result.mutationAttempted !== false || JSON.stringify(result.completed) !== '["preflight"]'
      : JSON.stringify(result.confirmedDeleted) !==
          JSON.stringify(profile.finalDeletionOwners ?? [...owners].reverse()) ||
        result.finalAbsenceConfirmed !== true ||
        result.cleanupConfirmed !== true ||
        result.remaining?.length !== 0 ||
        JSON.stringify(result.completed) !== JSON.stringify(profile.stages)
  )
    throw new ProceduralFailure('prerequisites');
  const history: { path: string; hash: string; limit: number }[] = [];
  if (phase === 'final') {
    const preflight = join(binding.root, 'preflight/result.json');
    if (privateEvidence(preflight).sha256 !== result.previousResultHash) throw new ProceduralFailure('binding');
    history.push({ path: preflight, hash: result.previousResultHash, limit: 128 * 1024 });
    if (!Array.isArray(result.prerequisiteReceipts) || result.prerequisiteReceipts.length !== 3)
      throw new ProceduralFailure('binding');
    for (const [i, name] of ['sm12-baseline.json', 'sm12-suffix.jpg', 'sm12-user.jpg'].entries()) {
      const prior = result.prerequisiteReceipts[i],
        limit = name.endsWith('.jpg') ? 8 * 1024 * 1024 : 128 * 1024;
      const path = join(binding.root, 'prerequisites', name);
      if (prior?.name !== name || prior.limit !== limit || privateEvidence(path, limit).sha256 !== prior.hash)
        throw new ProceduralFailure('binding');
      history.push({ path, hash: prior.hash, limit });
    }
  }
  const directory = join(binding.root, phase === 'execute' ? 'prerequisites' : 'final');
  privateDirectory(directory);
  const captured: { name: string; hash: string; limit: number }[] = [];
  const read = (name: string, limit = 128 * 1024) => {
    const value = privateEvidence(join(directory, name), limit);
    captured.push({ name, hash: value.sha256, limit });
    return value;
  };
  const baseline = schema
    .extend({ protocol: z.literal(profile.protocol) })
    .parse(JSON.parse(read('sm12-baseline.json').body.toString('utf8')));
  if (
    baseline.phase !== phase ||
    baseline.revision !== binding.evidence.revision ||
    baseline.intentHash !== intent.hash ||
    baseline.previousResultHash !== receipt.sha256 ||
    baseline.suffixSearch.user !== '*' ||
    baseline.suffixSearch.argument !== `*${PROCEDURAL_SUFFIX}*` ||
    baseline.userSearch.user !== 'MARIAN' ||
    baseline.userSearch.argument !== '*'
  )
    throw new ProceduralFailure('prerequisites');
  let freshUntil = phase === 'execute' ? Date.parse(result.startedAt) + PREREQUISITE_AGE_MS : now + PREREQUISITE_AGE_MS;
  for (const [name, observation] of [
    ['suffix', baseline.suffixSearch],
    ['user', baseline.userSearch],
  ] as const) {
    const time = Date.parse(observation.observedAt),
      image = read(`sm12-${name}.jpg`, 8 * 1024 * 1024);
    if (
      time <= Date.parse(result.completedAt) ||
      time > now ||
      now - time >= PREREQUISITE_AGE_MS ||
      image.sha256 !== observation.evidenceSha256 ||
      !jpegEvidenceSignature(image.body)
    )
      throw new ProceduralFailure('prerequisites');
    freshUntil = Math.min(freshUntil, time + PREREQUISITE_AGE_MS);
  }
  if (now >= freshUntil) throw new ProceduralFailure('prerequisites');
  return {
    intentHash: intent.hash,
    previousResultHash: receipt.sha256,
    freshUntil,
    receipts: captured,
    verify: () => {
      intent.verify();
      if (history.some((r) => privateEvidence(r.path, r.limit).sha256 !== r.hash))
        throw new ProceduralFailure('binding');
      if (
        privateEvidence(path).sha256 !== receipt.sha256 ||
        captured.some((r) => privateEvidence(join(directory, r.name), r.limit).sha256 !== r.hash)
      )
        throw new ProceduralFailure('binding');
    },
  };
}
