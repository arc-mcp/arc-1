/** Pure file prerequisites. No client imports, credential reads, claims or network. */
import { join } from 'node:path';
import { z } from 'zod';
import { type DeclarativeBinding, PREREQUISITE_AGE_MS, privateEvidence } from './native-declarative-prerequisites.js';
import { jpegEvidenceSignature } from './native-declarative-v3-evidence.js';
import { flpNativeEvidence } from './native-flp-evidence.js';
import { privateDirectory } from './native-lock-binding.js';
import { type RuntimeProtocol, runtimeProtocol } from './native-runtime-protocol.js';
import {
  RUNTIME_SUFFIX,
  RuntimeFailure,
  type RuntimeStage,
  runtimeClassOwner,
  runtimeFixture,
} from './native-runtime-slice-fixed.js';
export const runtimeIntentData = (binding: DeclarativeBinding, kind: RuntimeProtocol = 'original') => ({
  protocol: runtimeProtocol(kind).protocol,
  binding: binding.evidence,
  stages: runtimeProtocol(kind).stages,
  ...(runtimeProtocol(kind).retained ? { retainedHistory: runtimeProtocol(kind).retainedHistory } : {}),
  fixtures: runtimeFixture,
  nativeEvidence: flpNativeEvidence,
  authentication: 'Basic-native-contract-only',
  identity: 'MARIAN',
  target: 'A4H/001',
  ppQualified: false,
  publicAdmission: false,
  profilerParameters: 'native-retention-unverified',
  recording: 'native-governed-unverified',
  flpReadAbsenceConfirmed: false,
});
export function readRuntimeIntent(binding: DeclarativeBinding, kind: RuntimeProtocol = 'original') {
  try {
    privateDirectory(binding.root);
    const path = join(binding.root, 'intent.json'),
      saved = privateEvidence(path);
    const { createdAt, ...data } = JSON.parse(saved.body.toString('utf8'));
    if (
      !z.iso.datetime().safeParse(createdAt).success ||
      JSON.stringify(data) !== JSON.stringify(runtimeIntentData(binding, kind))
    )
      throw new Error();
    return {
      hash: saved.sha256,
      createdAt: Date.parse(createdAt),
      verify: () => {
        if (privateEvidence(path).sha256 !== saved.sha256) throw new RuntimeFailure('intent');
      },
    };
  } catch {
    throw new RuntimeFailure('intent');
  }
}
function completed(
  binding: DeclarativeBinding,
  intent: ReturnType<typeof readRuntimeIntent>,
  stage: RuntimeStage,
  previous: string | null,
  now: number,
  kind: RuntimeProtocol,
) {
  privateDirectory(join(binding.root, stage));
  privateDirectory(join(binding.root, stage, 'attempt'));
  const path = join(binding.root, stage, 'attempt/result.json'),
    saved = privateEvidence(path),
    result = JSON.parse(saved.body.toString('utf8'));
  const fields =
    stage === 'formatter' || stage === 'st05'
      ? result.restored === true
      : stage === 'profiler'
        ? result.cancelled === true
        : stage === 'quickfix'
          ? result.finalAbsent === true &&
            result.sourceUnchanged === true &&
            JSON.stringify(result.confirmedDeleted) === JSON.stringify([runtimeClassOwner])
          : Array.isArray(result.nativeDeleteCompleted) &&
            result.nativeDeleteCompleted.length === 2 &&
            result.readAbsenceConfirmed === false;
  if (
    result.protocol !== runtimeProtocol(kind).protocol ||
    result.stage !== stage ||
    result.revision !== binding.evidence.revision ||
    result.intentHash !== intent.hash ||
    result.previousResultHash !== previous ||
    result.failure !== false ||
    result.mutationDispatched !== true ||
    !fields ||
    !Array.isArray(result.remaining) ||
    result.remaining.length ||
    !z.iso.datetime().safeParse(result.completedAt).success ||
    Date.parse(result.completedAt) <= intent.createdAt ||
    Date.parse(result.completedAt) > now
  )
    throw new RuntimeFailure('prior-stage');
  return {
    hash: saved.sha256,
    time: Date.parse(result.completedAt),
    verify: () => {
      if (privateEvidence(path).sha256 !== saved.sha256) throw new RuntimeFailure('prior-stage');
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
const baselineSchema = (kind: RuntimeProtocol) =>
  z
    .object({
      protocol: z.literal(runtimeProtocol(kind).protocol),
      stage: z.enum([...runtimeProtocol(kind).stages, 'final']),
      revision: z.string(),
      intentHash: z.string(),
      previousResultHash: z.string().nullable(),
      ordinaryCustSourceContractAcknowledged: z.literal(true),
      noConcurrentFixtureEditing: z.literal(true),
      noConcurrentMarianDialogOrPreferenceChanges: z.literal(true),
      suffixSearch: search,
      userSearch: search,
    })
    .strict();
export function readRuntimeBaseline(
  binding: DeclarativeBinding,
  intent: ReturnType<typeof readRuntimeIntent>,
  stage: RuntimeStage | 'final',
  now: number,
  kind: RuntimeProtocol = 'original',
) {
  try {
    const stages = runtimeProtocol(kind).stages;
    let previousResultHash: string | null = runtimeProtocol(kind).initialResultHash,
      after = intent.createdAt;
    const history: ReturnType<typeof completed>[] = [];
    const index = stage === 'final' ? stages.length : stages.indexOf(stage);
    if (index < 0) throw new Error();
    for (const prior of stages.slice(0, index)) {
      const item = completed(binding, intent, prior, previousResultHash, now, kind);
      if (item.time < after) throw new Error();
      history.push(item);
      previousResultHash = item.hash;
      after = item.time;
    }
    const directory = join(binding.root, stage, 'prerequisites');
    privateDirectory(join(binding.root, stage));
    privateDirectory(directory);
    const receipts: { name: string; sha256: string; limit: number }[] = [];
    const read = (name: string, limit = 128 * 1024) => {
      const value = privateEvidence(join(directory, name), limit);
      receipts.push({ name, sha256: value.sha256, limit });
      return value;
    };
    const baseline = baselineSchema(kind).parse(JSON.parse(read('sm12-baseline.json').body.toString('utf8')));
    if (
      baseline.stage !== stage ||
      baseline.revision !== binding.evidence.revision ||
      baseline.intentHash !== intent.hash ||
      baseline.previousResultHash !== previousResultHash ||
      baseline.suffixSearch.user !== '*' ||
      baseline.suffixSearch.argument !== `*${RUNTIME_SUFFIX}*` ||
      baseline.userSearch.user !== 'MARIAN' ||
      baseline.userSearch.argument !== '*'
    )
      throw new Error();
    let freshUntil = now + PREREQUISITE_AGE_MS;
    for (const [name, observation] of [
      ['suffix', baseline.suffixSearch],
      ['user', baseline.userSearch],
    ] as const) {
      const time = Date.parse(observation.observedAt);
      if (time <= after || time > now || now - time > PREREQUISITE_AGE_MS) throw new Error();
      freshUntil = Math.min(freshUntil, time + PREREQUISITE_AGE_MS);
      const image = read(`sm12-${name}.jpg`, 8 * 1024 * 1024);
      if (image.sha256 !== observation.evidenceSha256 || !jpegEvidenceSignature(image.body)) throw new Error();
    }
    return {
      freshUntil,
      previousResultHash,
      receipts: receipts.map(({ name, sha256 }) => ({ name, sha256 })),
      verify: () => {
        for (const item of history) item.verify();
        for (const item of receipts)
          if (privateEvidence(join(directory, item.name), item.limit).sha256 !== item.sha256)
            throw new RuntimeFailure('baseline');
      },
    };
  } catch {
    throw new RuntimeFailure('baseline');
  }
}
