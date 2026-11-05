/** Pure local prerequisites: no native imports, claims, credentials or screenshot interpretation. */
import { join } from 'node:path';
import { z } from 'zod';
import { type DeclarativeBinding, PREREQUISITE_AGE_MS, privateEvidence } from './native-declarative-prerequisites.js';
import { jpegEvidenceSignature } from './native-declarative-v3-evidence.js';
import { flpNativeEvidence } from './native-flp-evidence.js';
import {
  FLP_PROTOCOL,
  FLP_SUFFIX,
  FlpQualificationFailure,
  type FlpStage,
  flpFixtures,
  flpOwner,
} from './native-flp-fixed.js';
import { privateDirectory } from './native-lock-binding.js';
export const flpIntentData = (binding: DeclarativeBinding) => ({
  protocol: FLP_PROTOCOL,
  binding: binding.evidence,
  fixtures: flpFixtures,
  nativeEvidence: flpNativeEvidence,
  authentication: 'Basic-native-contract-only',
  target: 'A4H/001',
  identity: 'MARIAN',
  recording: 'native-governed-unverified',
  readAbsenceConfirmed: false,
});
export function readFlpIntent(binding: DeclarativeBinding) {
  try {
    privateDirectory(binding.root);
    const path = join(binding.root, 'intent.json'),
      saved = privateEvidence(path);
    const { createdAt, ...actual } = JSON.parse(saved.body.toString('utf8'));
    if (
      !z.iso.datetime().safeParse(createdAt).success ||
      JSON.stringify(actual) !== JSON.stringify(flpIntentData(binding))
    )
      throw new Error();
    return {
      hash: saved.sha256,
      createdAt: Date.parse(createdAt),
      verify: () => {
        if (privateEvidence(path).sha256 !== saved.sha256) throw new FlpQualificationFailure('intent');
      },
    };
  } catch {
    throw new FlpQualificationFailure('intent');
  }
}
export function readCompletedFlpStage(
  binding: DeclarativeBinding,
  intent: ReturnType<typeof readFlpIntent>,
  stage: FlpStage,
  now: number,
) {
  try {
    privateDirectory(join(binding.root, stage));
    privateDirectory(join(binding.root, stage, 'attempt'));
    const path = join(binding.root, stage, 'attempt/result.json'),
      saved = privateEvidence(path);
    const result = JSON.parse(saved.body.toString('utf8'));
    if (
      result.protocol !== FLP_PROTOCOL ||
      result.stage !== stage ||
      result.revision !== binding.evidence.revision ||
      result.intentHash !== intent.hash ||
      result.owner !== flpOwner(stage) ||
      JSON.stringify(result.declaredNativeParts) !==
        JSON.stringify(stage === 'catalog' ? ['Page', 'PageConfig'] : ['Page']) ||
      result.failure !== false ||
      result.createAcknowledged !== true ||
      result.ownedReadbackVerified !== true ||
      result.deleteAcknowledged !== true ||
      result.nativeDeleteCompleted !== true ||
      result.readAbsenceConfirmed !== false ||
      (stage === 'page' ? result.previousResultHash !== null : !/^[a-f0-9]{64}$/.test(result.previousResultHash)) ||
      result.postDeleteLookup !== 'unknown' ||
      !['closed', 'not-issued'].includes(result.sessionCleanup) ||
      !z.iso.datetime().safeParse(result.completedAt).success ||
      Date.parse(result.completedAt) <= intent.createdAt ||
      Date.parse(result.completedAt) > now
    )
      throw new Error();
    return {
      hash: saved.sha256,
      previousResultHash: result.previousResultHash,
      completedAt: Date.parse(result.completedAt),
      verify: () => {
        if (privateEvidence(path).sha256 !== saved.sha256) throw new FlpQualificationFailure('prior-stage');
      },
    };
  } catch {
    throw new FlpQualificationFailure('prior-stage');
  }
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
const baseline = z
  .object({
    protocol: z.literal(FLP_PROTOCOL),
    stage: z.enum(['page', 'catalog', 'final']),
    revision: z.string(),
    intentHash: z.string(),
    previousResultHash: z.string().nullable(),
    ordinaryCustSourceContractAcknowledged: z.literal(true),
    noConcurrentFixtureEditing: z.literal(true),
    suffixSearch: search,
    userSearch: search,
  })
  .strict();
export function readFlpBaseline(
  binding: DeclarativeBinding,
  intent: ReturnType<typeof readFlpIntent>,
  stage: FlpStage | 'final',
  now: number,
) {
  try {
    const previous =
      stage === 'page'
        ? undefined
        : readCompletedFlpStage(binding, intent, stage === 'catalog' ? 'page' : 'catalog', now);
    // Final verification also requires the unchanged first-stage receipt.
    const page = stage === 'final' ? readCompletedFlpStage(binding, intent, 'page', now) : undefined;
    if (page && previous?.previousResultHash !== page.hash) throw new Error();
    privateDirectory(join(binding.root, stage));
    const directory = join(binding.root, stage, 'prerequisites');
    privateDirectory(directory);
    const captured: { name: string; sha256: string; limit: number }[] = [];
    const read = (name: string, limit = 128 * 1024) => {
      const value = privateEvidence(join(directory, name), limit);
      captured.push({ name, sha256: value.sha256, limit });
      return value;
    };
    const data = baseline.parse(JSON.parse(read('sm12-baseline.json').body.toString('utf8')));
    if (
      data.stage !== stage ||
      data.revision !== binding.evidence.revision ||
      data.intentHash !== intent.hash ||
      data.previousResultHash !== (previous?.hash ?? null) ||
      data.suffixSearch.user !== '*' ||
      data.suffixSearch.argument !== `*${FLP_SUFFIX}*` ||
      data.userSearch.user !== 'MARIAN' ||
      data.userSearch.argument !== '*'
    )
      throw new Error();
    let freshUntil = now + PREREQUISITE_AGE_MS;
    for (const [name, observation] of [
      ['suffix', data.suffixSearch],
      ['user', data.userSearch],
    ] as const) {
      const time = Date.parse(observation.observedAt);
      if (
        time <= Math.max(intent.createdAt, previous?.completedAt ?? 0) ||
        time > now ||
        now - time > PREREQUISITE_AGE_MS
      )
        throw new Error();
      freshUntil = Math.min(freshUntil, time + PREREQUISITE_AGE_MS);
      const image = read(`sm12-${name}.jpg`, 8 * 1024 * 1024);
      if (image.sha256 !== observation.evidenceSha256 || !jpegEvidenceSignature(image.body)) throw new Error();
    }
    return {
      freshUntil,
      previousResultHash: previous?.hash ?? null,
      receipts: captured.map(({ name, sha256 }) => ({ name, sha256 })),
      verify: () => {
        previous?.verify();
        page?.verify();
        for (const file of captured)
          if (privateEvidence(join(directory, file.name), file.limit).sha256 !== file.sha256)
            throw new FlpQualificationFailure('baseline');
      },
    };
  } catch {
    throw new FlpQualificationFailure('baseline');
  }
}
