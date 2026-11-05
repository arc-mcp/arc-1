/** Local-only original-failure, saved-intent and fresh SM12 prerequisites for the fixed v3 recovery. */
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { privateEvidence, type DeclarativeBinding, PREREQUISITE_AGE_MS } from './native-declarative-prerequisites.js';
import { jpegEvidenceSignature } from './native-declarative-v3-evidence.js';
import {
  V3_RECOVERY,
  V3_FAILED_REVISION,
  v3OriginalHashes,
  v3RecoveryFixture,
  v3RetainedHashes,
} from './native-declarative-v3-recovery-fixed.js';
import { DeclarativeFailure } from './native-declarative-workflow.js';
import { privateDirectory } from './native-lock-binding.js';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
/** Injection is for isolated file fixtures; the entry always uses the fixed defaults. */
export function verifyOriginalV3Failure(
  root = join(homedir(), '.local/state/arc1-qualification/pr1142-native-declarative-v3'),
  expected: Record<keyof typeof v3OriginalHashes, string> = v3OriginalHashes,
) {
  try {
    for (const directory of [root, join(root, 'attempt'), join(root, 'attempt/run')]) privateDirectory(directory);
    const read = (path: string) => privateEvidence(join(root, path));
    if (read('intent.json').sha256 !== expected.intent || read('attempt/result.json').sha256 !== expected.result)
      throw new Error();
    const manifest = read('attempt/manifest.json');
    if (manifest.sha256 !== expected.manifest) throw new Error();
    const names = Array.from({ length: 95 }, (_, index) => `${String(index + 1).padStart(5, '0')}.json`);
    if (JSON.stringify(readdirSync(join(root, 'attempt/run')).sort()) !== JSON.stringify(names)) throw new Error();
    const rows = names.map((name) => [name, read(`attempt/run/${name}`).sha256]);
    if (hash(JSON.stringify(rows)) !== expected.journal) throw new Error();
    const original = JSON.parse(manifest.body.toString('utf8')) as {
      preflightId: string;
      prerequisites: { name: string; sha256: string }[];
    };
    const required = ['result.json', 'sm12-baseline.json', 'sm12-suffix.jpg', 'sm12-user.jpg'];
    if (
      !/^[A-F0-9]{16}$/.test(original.preflightId) ||
      JSON.stringify(original.prerequisites.map((row) => row.name)) !== JSON.stringify(required)
    )
      throw new Error();
    const directory = join(root, 'preflight', original.preflightId);
    privateDirectory(join(root, 'preflight'));
    privateDirectory(directory);
    for (const file of original.prerequisites)
      if (
        privateEvidence(join(directory, file.name), file.name.endsWith('.jpg') ? 8 * 1024 * 1024 : 128 * 1024)
          .sha256 !== file.sha256
      )
        throw new Error();
  } catch {
    throw new DeclarativeFailure('recovery-original');
  }
}
export function recoveryIntentData(binding: DeclarativeBinding) {
  return {
    protocol: V3_RECOVERY,
    binding: binding.evidence,
    failedRevision: V3_FAILED_REVISION,
    originalHashes: v3OriginalHashes,
    owner: v3RecoveryFixture.owner,
    retainedHashes: v3RetainedHashes,
  };
}
export function readV3RecoveryIntent(binding: DeclarativeBinding) {
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
    protocol: z.literal(V3_RECOVERY),
    revision: z.string(),
    intentHash: z.string(),
    originalResultHash: z.literal(v3OriginalHashes.result),
    suffixSearch: search,
    userSearch: search,
  })
  .strict();
export function readV3RecoveryBaseline(
  binding: DeclarativeBinding,
  intent: ReturnType<typeof readV3RecoveryIntent>,
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
      proof.suffixSearch.argument !== '*F4C656905A65AA61*' ||
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
      if (time < intent.createdAt || time > now || now - time > PREREQUISITE_AGE_MS) throw new Error();
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
