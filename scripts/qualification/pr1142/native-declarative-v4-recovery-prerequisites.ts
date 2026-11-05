/** Pure local proof/receipt checks for the once-only retained V4 pair cleanup. */
import { join } from 'node:path';
import { z } from 'zod';
import { type DeclarativeBinding, PREREQUISITE_AGE_MS, privateEvidence } from './native-declarative-prerequisites.js';
import { jpegEvidenceSignature } from './native-declarative-v3-evidence.js';
import {
  V4_FAILED_REVISION,
  V4_RECOVERY,
  v4MetadataHashes,
  v4OriginalResultHash,
  v4RecoveryEvidence,
  v4RecoveryOwners,
  v4SourceHashes,
} from './native-declarative-v4-recovery-fixed.js';
import { DeclarativeFailure } from './native-declarative-workflow.js';
import { privateDirectory } from './native-lock-binding.js';
export function recoveryIntentData(binding: DeclarativeBinding) {
  return {
    protocol: V4_RECOVERY,
    binding: binding.evidence,
    failedRevision: V4_FAILED_REVISION,
    originalEvidence: v4RecoveryEvidence,
    owners: v4RecoveryOwners.map((owner) => owner.owner),
    metadataHashes: v4MetadataHashes,
    sourceHashes: v4SourceHashes,
  };
}
export function readV4RecoveryIntent(binding: DeclarativeBinding) {
  try {
    privateDirectory(binding.root);
    const path = join(binding.root, 'intent.json');
    const saved = privateEvidence(path);
    const data = JSON.parse(saved.body.toString('utf8'));
    const { createdAt, ...actual } = data;
    if (
      !z.iso.datetime().safeParse(createdAt).success ||
      JSON.stringify(actual) !== JSON.stringify(recoveryIntentData(binding))
    )
      throw new Error();
    return {
      hash: saved.sha256,
      createdAt: Date.parse(createdAt),
      verify: () => {
        if (privateEvidence(path).sha256 !== saved.sha256) throw new DeclarativeFailure('recovery-intent');
      },
    };
  } catch {
    throw new DeclarativeFailure('recovery-intent');
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
    protocol: z.literal(V4_RECOVERY),
    revision: z.string(),
    intentHash: z.string(),
    originalResultHash: z.literal(v4OriginalResultHash),
    suffixSearch: search,
    userSearch: search,
  })
  .strict();
export function readV4RecoveryBaseline(
  binding: DeclarativeBinding,
  intent: ReturnType<typeof readV4RecoveryIntent>,
  now: number,
) {
  try {
    const directory = join(binding.root, 'prerequisites');
    privateDirectory(directory);
    const captured: { name: string; sha256: string; limit: number }[] = [];
    const read = (name: string, limit = 128 * 1024) => {
      const file = privateEvidence(join(directory, name), limit);
      captured.push({ name, sha256: file.sha256, limit });
      return file;
    };
    const proof = baseline.parse(JSON.parse(read('sm12-baseline.json').body.toString('utf8')));
    if (
      proof.revision !== binding.evidence.revision ||
      proof.intentHash !== intent.hash ||
      proof.suffixSearch.user !== '*' ||
      proof.suffixSearch.argument !== '*013FECCE68663763*' ||
      proof.userSearch.user !== 'MARIAN' ||
      proof.userSearch.argument !== '*'
    )
      throw new Error();
    let freshUntil = now + PREREQUISITE_AGE_MS;
    for (const [name, observation] of [
      ['suffix', proof.suffixSearch],
      ['user', proof.userSearch],
    ] as const) {
      const time = Date.parse(observation.observedAt);
      if (time <= intent.createdAt || time > now || now - time > PREREQUISITE_AGE_MS) throw new Error();
      freshUntil = Math.min(freshUntil, time + PREREQUISITE_AGE_MS);
      const image = read(`sm12-${name}.jpg`, 8 * 1024 * 1024);
      if (image.sha256 !== observation.evidenceSha256 || !jpegEvidenceSignature(image.body)) throw new Error();
    }
    return {
      freshUntil,
      receipts: captured.map(({ name, sha256 }) => ({ name, sha256 })),
      verify: () => {
        if (captured.some((file) => privateEvidence(join(directory, file.name), file.limit).sha256 !== file.sha256))
          throw new DeclarativeFailure('recovery-baseline');
      },
    };
  } catch {
    throw new DeclarativeFailure('recovery-baseline');
  }
}
