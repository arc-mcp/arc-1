/** Fixed DDIC intent; shared private JPEG/freshness/receipt reads never load native dependencies. */
import { join } from 'node:path';
import { z } from 'zod';
import { DDIC_PROTOCOL, ddicFixtures } from './native-ddic-fixtures.js';
import { type DeclarativeBinding, privateEvidence } from './native-declarative-prerequisites.js';
import { privateDirectory } from './native-lock-binding.js';
import { readFixedNativePrerequisites } from './native-package-prerequisites.js';
export function readDdicIntent(binding: DeclarativeBinding) {
  privateDirectory(binding.root);
  const path = join(binding.root, 'intent.json'),
    file = privateEvidence(path);
  const intent = z
    .object({
      protocol: z.literal(DDIC_PROTOCOL),
      createdAt: z.iso.datetime(),
      suffix: z.string().regex(/^[A-F0-9]{16}$/),
      binding: z.unknown(),
      fixtures: z.unknown(),
      identity: z.literal('MARIAN'),
      target: z.literal('A4H/001'),
      authentication: z.literal('Basic-native-contract-only'),
    })
    .strict()
    .parse(JSON.parse(file.body.toString('utf8')));
  const fixtures = ddicFixtures(intent.suffix);
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
export function readDdicPrerequisites(
  binding: DeclarativeBinding,
  intent: ReturnType<typeof readDdicIntent>,
  sample: string,
  now: number,
) {
  return readFixedNativePrerequisites(
    binding,
    intent,
    sample,
    now,
    DDIC_PROTOCOL,
    intent.fixtures.map((f) => f.owner),
  );
}
