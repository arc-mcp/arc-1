import { readFileSync } from 'node:fs';
import {
  retainedTableFixtures,
  TABLE_RETAINED_SUFFIX,
} from '../../../scripts/qualification/pr1142/native-ddic-table-retained-fixed.js';
import { tableHarness } from './pr1142-native-ddic-table-harness.js';

const { runRetainedTableGraph } = await import(
  '../../../scripts/qualification/pr1142/native-ddic-table-retained-runner.js'
);
export const fixtures = retainedTableFixtures(TABLE_RETAINED_SUFFIX);
export const retainedMetadata = readFileSync(
  new URL('../../fixtures/pr1142-table-retained/table.xml', import.meta.url),
  'utf8',
);
export const retainedSettings = readFileSync(
  new URL('../../fixtures/pr1142-table-retained/settings.xml', import.meta.url),
  'utf8',
);
export const retainedSource = readFileSync(
  new URL('../../fixtures/pr1142-table-retained/source.ddl', import.meta.url),
  'utf8',
);
export function retainedTableHarness(options: Parameters<typeof tableHarness>[0] = {}) {
  const h = tableHarness(options);
  let stopped = false;
  const seed = () => {
    h.useFixtures(fixtures);
    h.world.objects.get(fixtures[0].owner)!.metadata = retainedMetadata;
    h.world.objects.get(fixtures[0].owner)!.source = retainedSource;
    h.world.objects.get(fixtures[1].owner)!.metadata = retainedSettings;
  };
  seed();
  h.runtime.execute = runRetainedTableGraph;
  return {
    ...h,
    seed,
    stop: () => {
      stopped = true;
      h.stop();
    },
    run: () =>
      runRetainedTableGraph({
        base: h.client,
        fixtures,
        freshUntil: Date.now() + 240000,
        verify: h.verify,
        shouldStop: () => stopped,
        record: (r) => {
          h.records.push(r);
          h.hooks.record?.(r);
        },
      }),
  };
}
