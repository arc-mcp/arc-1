/** Fixed cleanup only; separate permanent claim, never a replay of the failed collections run. */
import { join } from 'node:path';
import { z } from 'zod';
import { type DdicPhaseDependencies, runFixedDdicPhases } from './native-ddic-phases.js';
import {
  STRUCTURE_CLEANUP,
  STRUCTURE_SUFFIX,
  type StructureCleanupFixture,
  structureCleanupFixtures,
  structureCleanupStages,
} from './native-ddic-structure-cleanup-fixed.js';
import { verifyStructureCleanupHistory } from './native-ddic-structure-cleanup-history.js';
import { isDirectEntry } from './native-declarative-entry.js';
import { type DeclarativeBinding, privateEvidence } from './native-declarative-prerequisites.js';

function intent(binding: DeclarativeBinding) {
  const path = join(binding.root, 'intent.json'),
    saved = privateEvidence(path);
  const value = z
    .object({
      protocol: z.literal(STRUCTURE_CLEANUP),
      createdAt: z.iso.datetime(),
      suffix: z.literal(STRUCTURE_SUFFIX),
      fixtures: z.unknown(),
      binding: z.unknown(),
      identity: z.literal('MARIAN'),
      target: z.literal('A4H/001'),
      authentication: z.literal('Basic-native-contract-only'),
    })
    .strict()
    .parse(JSON.parse(saved.body.toString('utf8')));
  const fixtures = structureCleanupFixtures(value.suffix);
  if (
    JSON.stringify(value.fixtures) !== JSON.stringify(fixtures) ||
    JSON.stringify(value.binding) !== JSON.stringify(binding.evidence)
  )
    throw new Error('Fixed retained structure intent mismatch.');
  return {
    fixtures,
    suffix: value.suffix,
    hash: saved.sha256,
    createdAt: Date.parse(value.createdAt),
    verify: () => {
      if (privateEvidence(path).sha256 !== saved.sha256) throw new Error('Cleanup intent changed.');
    },
  };
}
export function runNativeStructureCleanup(
  args: string[],
  dependencies?: DdicPhaseDependencies<StructureCleanupFixture> & { verifyHistory: () => void },
) {
  return runFixedDdicPhases(
    args,
    new URL(import.meta.url),
    {
      protocol: STRUCTURE_CLEANUP,
      flag: 'ddic-structure-cleanup-v1',
      suffixBytes: 6,
      fixedSuffix: STRUCTURE_SUFFIX,
      retainedOwners: structureCleanupFixtures(STRUCTURE_SUFFIX).map((f) => f.owner),
      inventory: 'valid-unfiltered',
      verifyHistory: dependencies?.verifyHistory ?? verifyStructureCleanupHistory,
      stages: structureCleanupStages,
      failureGraph: 'one-retained-TABL/DS',
      fixtures: structureCleanupFixtures,
      intent,
      helpers: async () => {
        const h = await import('./native-ddic-structure-cleanup-runner.js');
        return { runtime: h.structureCleanupRuntime, client: h.ddicClient, preflight: h.structureCleanupPreflight };
      },
    },
    dependencies,
  );
}
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeStructureCleanup(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('Retained structure cleanup stopped. Preserve all claims and evidence; never replay.');
    process.exitCode = 1;
  }
}
