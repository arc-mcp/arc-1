/** Shared local evidence validation; protocol/image contracts are fixed by the reviewed entry wrappers. */
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { declarativeV2Fixtures, declarativeV4Fixtures } from './native-declarative-fixtures.js';
import { declarativeV5Fixtures } from './native-declarative-v5-fixtures.js';
import { declarativeV5References } from './native-declarative-v5-references.js';
import { DeclarativeFailure } from './native-declarative-workflow.js';
import { privateDirectory, type nativeLockBinding } from './native-lock-binding.js';

export const PREREQUISITE_AGE_MS = 5 * 60_000;
export type DeclarativeBinding = Awaited<ReturnType<typeof nativeLockBinding>>;
const digest = (body: Buffer) => createHash('sha256').update(body).digest('hex');
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.string().regex(/^[a-f0-9]{40}$/);
const date = z.iso.datetime();

/** Bounded owned-file reads. Native evidence is private; fixed historical reports may be readable, never shared-writable. */
export function privateEvidence(path: string, limit = 128 * 1024, readableHistoricalReport = false) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.mode & (readableHistoricalReport ? 0o022 : 0o077) || stat.size > limit)
      throw new Error('Private bounded evidence required.');
    const bytes = Buffer.alloc(Math.min(stat.size + 1, limit + 1));
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size !== stat.size) throw new Error('Evidence changed during its read.');
    const body = bytes.subarray(0, size);
    return { body, sha256: digest(body) };
  } finally {
    closeSync(fd);
  }
}

export function readSavedDeclarativeIntent(
  binding: DeclarativeBinding,
  version: 'v2' | 'v3' | 'v4' | 'v5',
  history?: unknown,
) {
  try {
    privateDirectory(binding.root);
    const path = join(binding.root, 'intent.json');
    const file = privateEvidence(path);
    const intent = z
      .object({
        protocol: z.literal(`pr1142-native-declarative-${version}`),
        createdAt: date,
        suffix: z.string().regex(/^[A-F0-9]{16}$/),
        binding: z.unknown(),
        fixtures: z.unknown(),
        identity: z.literal('MARIAN'),
        target: z.literal('A4H/001'),
        authentication: z.literal('Basic-native-contract-only'),
        ...(['v4', 'v5'].includes(version) ? { history: z.unknown() } : {}),
        ...(version === 'v5' ? { readOnlyReferences: z.unknown() } : {}),
      })
      .strict()
      .parse(JSON.parse(file.body.toString('utf8')));
    const fixtures = (version === 'v5' ? declarativeV5Fixtures : version === 'v4' ? declarativeV4Fixtures : declarativeV2Fixtures)(intent.suffix);
    if (
      (['v4', 'v5'].includes(version) && (history === undefined || JSON.stringify(intent.history) !== JSON.stringify(history))) ||
      JSON.stringify(intent.binding) !== JSON.stringify(binding.evidence) ||
      JSON.stringify(intent.fixtures) !== JSON.stringify(fixtures) ||
      (version === 'v5' && JSON.stringify(intent.readOnlyReferences) !== JSON.stringify(declarativeV5References(fixtures)))
    )
      throw new Error('Intent mismatch.');
    return {
      suffix: intent.suffix,
      createdAt: Date.parse(intent.createdAt),
      fixtures,
      readOnlyReferences: version === 'v5' ? declarativeV5References(fixtures) : [],
      hash: file.sha256,
      verify: () => {
        if (privateEvidence(path).sha256 !== file.sha256) throw new DeclarativeFailure(`${version}-intent`);
      },
    };
  } catch {
    throw new DeclarativeFailure(`${version}-intent`);
  }
}
export type DeclarativeIntent = ReturnType<typeof readSavedDeclarativeIntent>;

const preflightSchema = (version: 'v2' | 'v3' | 'v4' | 'v5') =>
  z
    .object({
      protocol: z.literal(`pr1142-native-declarative-${version}`),
      revision,
      intentHash: hash,
      startedAt: date,
      completedAt: date,
      failure: z.literal(false),
      mutationAttempted: z.literal(false),
      verifiedOwners: z.array(z.string()),
      ...(version === 'v5' ? { verifiedReadOnlyReferences: z.array(z.string()) } : {}),
      inventory: z.literal('valid-without-suffix'),
    })
    .strict();
const searchSchema = z
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
const baselineSchema = (version: 'v2' | 'v3' | 'v4' | 'v5') =>
  z
    .object({
      protocol: z.literal(`pr1142-native-declarative-${version}`),
      revision,
      intentHash: hash,
      preflightId: z.string(),
      suffixSearch: searchSchema,
      userSearch: searchSchema,
    })
    .strict();

/** Receipt syntax/digests bind an operator's two SM12 observations; this is not screenshot interpretation. */
export function readSavedDeclarativePrerequisites(
  binding: DeclarativeBinding,
  intent: DeclarativeIntent,
  sample: string,
  now: number,
  imageContract: { version: 'v2' | 'v3' | 'v4' | 'v5'; extension: 'png' | 'jpg'; signature: (body: Buffer) => boolean },
) {
  const { version, extension, signature } = imageContract;
  if (!/^[A-F0-9]{16}$/.test(sample)) throw new DeclarativeFailure(`${version}-preflight`);
  const directory = join(binding.root, 'preflight', sample);
  let freshUntil = now + PREREQUISITE_AGE_MS;
  const captured: { path: string; sha256: string; limit: number }[] = [];
  const read = (name: string, limit = 128 * 1024) => {
    const path = join(directory, name),
      file = privateEvidence(path, limit);
    captured.push({ path, sha256: file.sha256, limit });
    return file;
  };
  const fresh = (time: string) => {
    const value = Date.parse(time);
    if (!Number.isFinite(value) || value > now || now - value > PREREQUISITE_AGE_MS)
      throw new Error('Fresh observation required.');
    freshUntil = Math.min(freshUntil, value + PREREQUISITE_AGE_MS);
    return value;
  };
  let completed: number;
  try {
    privateDirectory(join(binding.root, 'preflight'));
    privateDirectory(directory);
    const proof = preflightSchema(version).parse(JSON.parse(read('result.json').body.toString('utf8')));
    completed = fresh(proof.completedAt);
    if (
      fresh(proof.startedAt) > completed ||
      (['v4', 'v5'].includes(version) && Date.parse(proof.startedAt) < intent.createdAt) ||
      proof.revision !== binding.evidence.revision ||
      proof.intentHash !== intent.hash ||
      JSON.stringify(proof.verifiedOwners) !== JSON.stringify(intent.fixtures.map((fixture) => fixture.owner)) ||
      (version === 'v5' && JSON.stringify(proof.verifiedReadOnlyReferences) !== JSON.stringify(intent.readOnlyReferences.map(r => r.owner)))
    )
      throw new Error('Preflight mismatch.');
  } catch {
    throw new DeclarativeFailure(`${version}-preflight`);
  }
  try {
    const proof = baselineSchema(version).parse(JSON.parse(read('sm12-baseline.json').body.toString('utf8')));
    if (
      proof.revision !== binding.evidence.revision ||
      proof.intentHash !== intent.hash ||
      proof.preflightId !== sample ||
      proof.suffixSearch.user !== '*' ||
      proof.suffixSearch.argument !== `*${intent.suffix}*` ||
      proof.userSearch.user !== 'MARIAN' ||
      proof.userSearch.argument !== '*'
    )
      throw new Error('Baseline mismatch.');
    for (const [name, search] of [
      ['suffix', proof.suffixSearch],
      ['user', proof.userSearch],
    ] as const) {
      if (fresh(search.observedAt) < completed) throw new Error('Baseline predates preflight.');
      const image = read(`sm12-${name}.${extension}`, 8 * 1024 * 1024);
      if (image.sha256 !== search.evidenceSha256 || !signature(image.body))
        throw new Error('Baseline capture mismatch.');
    }
  } catch {
    throw new DeclarativeFailure(`${version}-baseline`);
  }
  return {
    freshUntil,
    receipts: captured.map(({ path, sha256 }) => ({ name: path.slice(directory.length + 1), sha256 })),
    verify: () => {
      if (captured.some((file) => privateEvidence(file.path, file.limit).sha256 !== file.sha256))
        throw new DeclarativeFailure(`${version}-baseline`);
    },
  };
}
