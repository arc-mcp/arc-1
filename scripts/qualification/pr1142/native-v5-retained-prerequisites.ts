/** Local-only fixed intent and genuinely fresh post-preflight raw JPEG checks; never claims an attempt. */
import { join } from 'node:path';
import { z } from 'zod';
import {
  type DeclarativeBinding,
  privateEvidence,
  PREREQUISITE_AGE_MS,
} from './native-declarative-prerequisites.js';
import { jpegEvidenceSignature } from './native-declarative-v3-evidence.js';
import { privateDirectory } from './native-lock-binding.js';
import {
  initialHashes,
  originalResultHash,
  retainedFacts,
  retainedOwners,
  retainedService,
  retainedStages,
  RETAINED_PROTOCOL,
  RETAINED_SUFFIX,
} from './native-v5-retained-fixed.js';
export function retainedIntentData(binding: DeclarativeBinding) {
  return {
    protocol: RETAINED_PROTOCOL,
    binding: binding.evidence,
    facts: retainedFacts,
    owners: retainedOwners,
    hashes: initialHashes,
    source: retainedService.source,
    updatedSource: retainedService.updatedSource,
    stages: retainedStages,
  };
}
export function readRetainedIntent(binding: DeclarativeBinding) {
  privateDirectory(binding.root);
  const path = join(binding.root, 'intent.json'),
    file = privateEvidence(path),
    data = JSON.parse(file.body.toString('utf8'));
  const { createdAt, ...actual } = data;
  if (
    !z.iso.datetime().safeParse(createdAt).success ||
    JSON.stringify(actual) !== JSON.stringify(retainedIntentData(binding))
  )
    throw new Error('Fixed retained intent changed.');
  return {
    hash: file.sha256,
    createdAt: Date.parse(createdAt),
    verify: () => {
      if (privateEvidence(path).sha256 !== file.sha256) throw new Error('Fixed retained intent changed.');
    },
  };
}
const date = z.iso.datetime(),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
const search = z
  .object({
    observedAt: date,
    client: z.literal('001'),
    user: z.string(),
    table: z.literal('*'),
    argument: z.string(),
    lockCount: z.literal(0),
    evidenceSha256: hash,
  })
  .strict();
export function readRetainedPrerequisites(
  binding: DeclarativeBinding,
  intent: ReturnType<typeof readRetainedIntent>,
  sample: string,
  now: number,
) {
  if (!/^[A-F0-9]{16}$/.test(sample)) throw new Error('Invalid retained preflight sample.');
  privateDirectory(join(binding.root, 'preflight'));
  const directory = join(binding.root, 'preflight', sample);
  privateDirectory(directory);
  const captured: { name: string; sha256: string; limit: number }[] = [];
  const read = (name: string, limit = 128 * 1024) => {
    const file = privateEvidence(join(directory, name), limit);
    captured.push({ name, sha256: file.sha256, limit });
    return file;
  };
  let freshUntil = now + PREREQUISITE_AGE_MS;
  const fresh = (value: string) => {
    const time = Date.parse(value);
    if (time < intent.createdAt || time > now || now - time >= PREREQUISITE_AGE_MS)
      throw new Error('Fresh post-prepare evidence required.');
    freshUntil = Math.min(freshUntil, time + PREREQUISITE_AGE_MS);
    return time;
  };
  const proof = z
    .object({
      protocol: z.literal(RETAINED_PROTOCOL),
      revision: z.string(),
      intentHash: hash,
      startedAt: date,
      completedAt: date,
      failure: z.literal(false),
      mutationAttempted: z.literal(false),
      owners: z.array(z.string()),
    })
    .strict()
    .parse(JSON.parse(read('result.json').body.toString('utf8')));
  const completed = fresh(proof.completedAt);
  if (
    fresh(proof.startedAt) > completed ||
    proof.revision !== binding.evidence.revision ||
    proof.intentHash !== intent.hash ||
    JSON.stringify(proof.owners) !== JSON.stringify(retainedOwners)
  )
    throw new Error('Retained preflight binding changed.');
  const baseline = z
    .object({
      protocol: z.literal(RETAINED_PROTOCOL),
      revision: z.string(),
      intentHash: hash,
      preflightId: z.literal(sample),
      originalResultHash: z.literal(originalResultHash),
      suffixSearch: search,
      userSearch: search,
    })
    .strict()
    .parse(JSON.parse(read('sm12-baseline.json').body.toString('utf8')));
  if (
    baseline.revision !== binding.evidence.revision ||
    baseline.intentHash !== intent.hash ||
    baseline.suffixSearch.user !== '*' ||
    baseline.suffixSearch.argument !== `*${RETAINED_SUFFIX}*` ||
    baseline.userSearch.user !== 'MARIAN' ||
    baseline.userSearch.argument !== '*'
  )
    throw new Error('Retained SM12 filters changed.');
  for (const [name, observation] of [
    ['suffix', baseline.suffixSearch],
    ['user', baseline.userSearch],
  ] as const) {
    if (fresh(observation.observedAt) <= completed)
      throw new Error('SM12 evidence must follow this preflight.');
    const image = read(`sm12-${name}.jpg`, 8 * 1024 * 1024);
    if (image.sha256 !== observation.evidenceSha256 || !jpegEvidenceSignature(image.body))
      throw new Error('Unmodified raw JPEG evidence required.');
  }
  return {
    freshUntil,
    receipts: captured.map(({ name, sha256 }) => ({ name, sha256 })),
    verify: () => {
      for (const row of captured)
        if (privateEvidence(join(directory, row.name), row.limit).sha256 !== row.sha256)
          throw new Error('Retained prerequisite bytes changed.');
    },
  };
}
