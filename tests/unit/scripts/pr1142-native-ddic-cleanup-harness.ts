import { readFileSync } from 'node:fs';
import {
  STRUCTURE_SUFFIX,
  structureCleanupFixtures,
} from '../../../scripts/qualification/pr1142/native-ddic-structure-cleanup-fixed.js';
import { ddicHarness } from './pr1142-native-ddic-harness.js';

const { runStructureCleanup } = await import(
  '../../../scripts/qualification/pr1142/native-ddic-structure-cleanup-runner.js'
);
export const retained = JSON.parse(
  readFileSync(new URL('../../fixtures/adt/structure-cleanup-a4h.json', import.meta.url), 'utf8'),
);
export const fixtures = structureCleanupFixtures(STRUCTURE_SUFFIX);
export function cleanupHarness(options: Parameters<typeof ddicHarness>[0] = {}) {
  const h = ddicHarness({ ...options, fixtures, execute: runStructureCleanup });
  const useFixtures = (rows = fixtures) => {
    h.useFixtures(rows);
    const owner = h.world.objects.get(fixtures[0].owner)!;
    owner.metadata = retained.metadata;
    owner.source = retained.source;
  };
  useFixtures();
  return { ...h, useFixtures };
}
