/** Fixed LOCAL graph intent and raw post-prepare JPEG prerequisites. Pure local reads only. */
import { join } from 'node:path';
import { z } from 'zod';
import { type DeclarativeBinding, PREREQUISITE_AGE_MS, privateEvidence } from './native-declarative-prerequisites.js';
import { jpegEvidenceSignature } from './native-declarative-v3-evidence.js';
import { privateDirectory } from './native-lock-binding.js';
import { PACKAGE_API_MOVED_PROFILE, PACKAGE_API_MOVED_PROTOCOL } from './native-package-api-moved-fixed.js';
import { PACKAGE_API_PROTOCOL, packageApiIntent, packageApiOwners } from './native-package-api-profile.js';
import {
  PACKAGE_API_RETAINED_GRAPH,
  PACKAGE_API_RETAINED_PROFILE,
  PACKAGE_API_RETAINED_PROTOCOL,
} from './native-package-api-retained-fixed.js';
import { PACKAGE_PROTOCOL, packageFixtures, packageOwners } from './native-package-fixtures.js';
import { PACKAGE_RECOVERY, packageRecoveryHistory } from './native-package-recovery-fixed.js';

const date = z.iso.datetime(),
  hash = z.string().regex(/^[a-f0-9]{64}$/),
  revision = z.string().regex(/^[a-f0-9]{40}$/);
export function readPackageIntent(binding: DeclarativeBinding, protocol: string = PACKAGE_PROTOCOL) {
  privateDirectory(binding.root);
  const path = join(binding.root, 'intent.json'),
    file = privateEvidence(path);
  const intent = z
    .object({
      protocol: z.literal(protocol),
      createdAt: date,
      suffix: z.string().regex(/^[A-F0-9]{16}$/),
      binding: z.unknown(),
      graph: z.unknown(),
      identity: z.literal('MARIAN'),
      target: z.literal('A4H/001'),
      authentication: z.literal('Basic-native-contract-only'),
      ...(protocol === PACKAGE_RECOVERY ? { history: z.unknown() } : {}),
      ...([PACKAGE_API_PROTOCOL, PACKAGE_API_RETAINED_PROTOCOL, PACKAGE_API_MOVED_PROTOCOL].includes(protocol)
        ? { fixedProfile: z.unknown() }
        : {}),
    })
    .strict()
    .parse(JSON.parse(file.body.toString('utf8')));
  const graph = packageFixtures(intent.suffix);
  if (
    JSON.stringify(intent.binding) !== JSON.stringify(binding.evidence) ||
    JSON.stringify(intent.graph) !== JSON.stringify(graph) ||
    (protocol === PACKAGE_RECOVERY && JSON.stringify(intent.history) !== JSON.stringify(packageRecoveryHistory)) ||
    (protocol === PACKAGE_API_MOVED_PROTOCOL &&
      (JSON.stringify(intent.fixedProfile) !== JSON.stringify(PACKAGE_API_MOVED_PROFILE) ||
        JSON.stringify(graph) !== JSON.stringify(PACKAGE_API_RETAINED_GRAPH))) ||
    (protocol === PACKAGE_API_RETAINED_PROTOCOL &&
      (JSON.stringify(intent.fixedProfile) !== JSON.stringify(PACKAGE_API_RETAINED_PROFILE) ||
        JSON.stringify(graph) !== JSON.stringify(PACKAGE_API_RETAINED_GRAPH))) ||
    (protocol === PACKAGE_API_PROTOCOL &&
      JSON.stringify(intent.fixedProfile) !== JSON.stringify(packageApiIntent(graph)))
  )
    throw new Error('Fixed package intent mismatch.');
  return {
    graph,
    suffix: intent.suffix,
    hash: file.sha256,
    createdAt: Date.parse(intent.createdAt),
    verify: () => {
      if (privateEvidence(path).sha256 !== file.sha256) throw new Error('Package intent changed.');
    },
  };
}
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
export function readPackagePrerequisites(
  binding: DeclarativeBinding,
  intent: ReturnType<typeof readPackageIntent>,
  sample: string,
  now: number,
  protocol: string = PACKAGE_PROTOCOL,
) {
  return readFixedNativePrerequisites(
    binding,
    intent,
    sample,
    now,
    protocol,
    ([PACKAGE_API_PROTOCOL, PACKAGE_API_RETAINED_PROTOCOL, PACKAGE_API_MOVED_PROTOCOL].includes(protocol)
      ? packageApiOwners(intent.graph)
      : packageOwners(intent.graph)
    ).map((o) => o.owner),
  );
}
/** Shared immutable GET/SM12 receipts; fixed entries alone supply the exact owner list and protocol. */
export function readFixedNativePrerequisites(
  binding: DeclarativeBinding,
  intent: { hash: string; suffix: string; createdAt: number },
  sample: string,
  now: number,
  protocol: string,
  owners: readonly string[],
  inventory: 'valid-without-suffix' | 'valid-unfiltered' = 'valid-without-suffix',
) {
  if (!/^[A-F0-9]{16}$/.test(sample)) throw new Error('Invalid preflight sample.');
  const directory = join(binding.root, 'preflight', sample),
    captured: { path: string; sha256: string; limit: number }[] = [];
  privateDirectory(join(binding.root, 'preflight'));
  privateDirectory(directory);
  const read = (name: string, limit = 128 * 1024) => {
    const path = join(directory, name),
      file = privateEvidence(path, limit);
    captured.push({ path, sha256: file.sha256, limit });
    return file;
  };
  let freshUntil = now + PREREQUISITE_AGE_MS;
  const fresh = (time: string) => {
    const value = Date.parse(time);
    if (!Number.isFinite(value) || value > now || value < intent.createdAt || now - value >= PREREQUISITE_AGE_MS)
      throw new Error('Fresh post-prepare evidence required.');
    freshUntil = Math.min(freshUntil, value + PREREQUISITE_AGE_MS);
    return value;
  };
  const preflight = z
    .object({
      protocol: z.literal(protocol),
      revision,
      intentHash: hash,
      startedAt: date,
      completedAt: date,
      failure: z.literal(false),
      mutationAttempted: z.literal(false),
      verifiedOwners: z.array(z.string()),
      inventory: z.literal(inventory),
    })
    .strict()
    .parse(JSON.parse(read('result.json').body.toString('utf8')));
  const completed = fresh(preflight.completedAt);
  if (
    fresh(preflight.startedAt) > completed ||
    preflight.revision !== binding.evidence.revision ||
    preflight.intentHash !== intent.hash ||
    JSON.stringify(preflight.verifiedOwners) !== JSON.stringify(owners)
  )
    throw new Error('Preflight binding mismatch.');
  const baseline = z
    .object({
      protocol: z.literal(protocol),
      revision,
      intentHash: hash,
      preflightId: z.string(),
      suffixSearch: search,
      userSearch: search,
    })
    .strict()
    .parse(JSON.parse(read('sm12-baseline.json').body.toString('utf8')));
  if (
    baseline.revision !== binding.evidence.revision ||
    baseline.intentHash !== intent.hash ||
    baseline.preflightId !== sample ||
    baseline.suffixSearch.user !== '*' ||
    baseline.suffixSearch.argument !== `*${intent.suffix}*` ||
    baseline.userSearch.user !== 'MARIAN' ||
    baseline.userSearch.argument !== '*'
  )
    throw new Error('SM12 binding mismatch.');
  for (const [name, observation] of [
    ['suffix', baseline.suffixSearch],
    ['user', baseline.userSearch],
  ] as const) {
    const image = read(`sm12-${name}.jpg`, 8 * 1024 * 1024);
    if (
      fresh(observation.observedAt) < completed ||
      image.sha256 !== observation.evidenceSha256 ||
      !jpegEvidenceSignature(image.body)
    )
      throw new Error('Raw JPEG observation mismatch.');
  }
  return {
    freshUntil,
    receipts: captured.map((f) => ({ name: f.path.slice(directory.length + 1), sha256: f.sha256 })),
    verify: () => {
      for (const f of captured)
        if (privateEvidence(f.path, f.limit).sha256 !== f.sha256) throw new Error('Prerequisite evidence changed.');
    },
  };
}
