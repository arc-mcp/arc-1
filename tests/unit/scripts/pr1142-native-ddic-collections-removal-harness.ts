import { readFileSync } from 'node:fs';
import {
  COLLECTIONS_REMOVAL_SUFFIX,
  collectionsRemovalFixtures,
} from '../../../scripts/qualification/pr1142/native-ddic-collections-removal-fixed.js';
import { ddicHarness } from './pr1142-native-ddic-harness.js';

const { runCollectionsRemoval } = await import(
  '../../../scripts/qualification/pr1142/native-ddic-collections-removal-runner.js'
);
export const retained = JSON.parse(
  readFileSync(new URL('../../fixtures/ddic-collections/removal-native.json', import.meta.url), 'utf8'),
) as Record<string, { metadata: string; source?: string }>;
export const fixtures = collectionsRemovalFixtures(COLLECTIONS_REMOVAL_SUFFIX);
export function removalHarness(options: Parameters<typeof ddicHarness>[0] = {}) {
  const h = ddicHarness({ ...options, fixtures, execute: runCollectionsRemoval });
  const useFixtures = (rows = fixtures) => {
    h.useFixtures(rows);
    for (const f of rows) {
      const o = h.world.objects.get(f.owner)!;
      o.metadata = retained[f.type].metadata;
      if (f.type === 'TABL/DS') o.source = retained[f.type].source;
    }
  };
  useFixtures();
  h.hooks.before = (url, init) => {
    if (
      init.method === 'GET' &&
      url.pathname === fixtures[2].owner &&
      h.world.calls.some((c) => c.method === 'PUT') &&
      !h.world.faults.has('msag-inactive')
    ) {
      const o = h.world.objects.get(fixtures[2].owner)!;
      o.metadata = o.metadata.replace('adtcore:version="inactive"', 'adtcore:version="active"');
    }
  };
  return { ...h, useFixtures };
}
