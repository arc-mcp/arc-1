/** Fixed DDIC intent; shared private JPEG/freshness/receipt reads never load native dependencies. */
import { join } from 'node:path';
import { z } from 'zod';
import { COLLECTIONS_PROTOCOL, collectionsFixtures } from './native-ddic-collections-fixtures.js';
import { type DeclarativeBinding, privateEvidence } from './native-declarative-prerequisites.js';
import { privateDirectory } from './native-lock-binding.js';
export function readCollectionsIntent(binding: DeclarativeBinding) {
  return readFixedCollectionsIntent(binding, COLLECTIONS_PROTOCOL, collectionsFixtures);
}
/** Internal compiled profiles only; this is not a CLI or public tool selector. */
export function readFixedCollectionsIntent<F>(
  binding: DeclarativeBinding,
  protocol: string,
  fixturesFor: (suffix: string) => F[],
) {
  privateDirectory(binding.root);
  const path = join(binding.root, 'intent.json'),
    file = privateEvidence(path);
  const intent = z
    .object({
      protocol: z.literal(protocol),
      createdAt: z.iso.datetime(),
      suffix: z.string().regex(/^[A-F0-9]{12}$/),
      binding: z.unknown(),
      fixtures: z.unknown(),
      identity: z.literal('MARIAN'),
      target: z.literal('A4H/001'),
      authentication: z.literal('Basic-native-contract-only'),
    })
    .strict()
    .parse(JSON.parse(file.body.toString('utf8')));
  const fixtures = fixturesFor(intent.suffix);
  if (
    JSON.stringify(intent.binding) !== JSON.stringify(binding.evidence) ||
    JSON.stringify(intent.fixtures) !== JSON.stringify(fixtures)
  )
    throw new Error('Fixed DDIC intent mismatch.');
  return {
    fixtures,
    suffix: intent.suffix,
    hash: file.sha256,
    createdAt: Date.parse(intent.createdAt),
    verify: () => {
      if (privateEvidence(path).sha256 !== file.sha256) throw new Error('DDIC intent changed.');
    },
  };
}
