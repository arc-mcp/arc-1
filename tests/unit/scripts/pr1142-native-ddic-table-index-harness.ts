import { readFileSync } from 'node:fs';
import {
  indexTailFixtures,
  TABLE_INDEX_SUFFIX,
} from '../../../scripts/qualification/pr1142/native-ddic-table-index-fixed.js';
import { tableHarness } from './pr1142-native-ddic-table-harness.js';

const { runIndexTailGraph } = await import('../../../scripts/qualification/pr1142/native-ddic-table-index-runner.js');
export const fixtures = indexTailFixtures(TABLE_INDEX_SUFFIX);
const load = (name: string) =>
  readFileSync(new URL('../../fixtures/pr1142-table-index-tail/' + name, import.meta.url), 'utf8');
const table = readFileSync(
    new URL('../../fixtures/pr1142-table-settings-tail/table-active.xml', import.meta.url),
    'utf8',
  ),
  source = readFileSync(new URL('../../fixtures/pr1142-table-settings-tail/source.ddl', import.meta.url), 'utf8');
export function indexTailHarness(options: Parameters<typeof tableHarness>[0] = {}) {
  const h = tableHarness(options);
  let activated = false,
    stopped = false;
  const views = { indexActive: load('index-active.xml'), indexActiveSource: load('index-active.json.txt') };
  const seed = () => {
    h.useFixtures(fixtures);
    activated = false;
    views.indexActive = load('index-active.xml');
    views.indexActiveSource = load('index-active.json.txt');
    for (const [i, metadata, body] of [
      [0, table, source],
      [1, load('settings-active.xml'), ''],
      [2, load('enqu-active.xml'), ''],
      [3, load('index-new.xml'), load('index-current.json.txt')],
    ] as const)
      Object.assign(h.world.objects.get(fixtures[i].owner)!, { metadata, source: body });
  };
  seed();
  const previous = h.hooks.reply!;
  h.hooks.reply = (url, method, body) => {
    const index = fixtures[3],
      object = h.world.objects.get(index.owner)!;
    if (
      method === 'GET' &&
      url.searchParams.get('version') === 'active' &&
      !activated &&
      object.metadata &&
      (url.pathname === index.owner || url.pathname === index.owner + '/source/main')
    )
      return {
        statusCode: 200,
        data: url.pathname === index.owner ? views.indexActive : views.indexActiveSource,
        responseOptions: {
          headers: { 'content-type': url.pathname === index.owner ? 'application/xml' : 'application/json' },
        },
      };
    if (
      method === 'POST' &&
      url.pathname === '/sap/bc/adt/activation' &&
      url.searchParams.get('preauditRequested') === 'false' &&
      body.includes(index.owner) &&
      !h.world.faults.has('still-inactive')
    ) {
      activated = true;
      object.metadata = object.metadata
        .replace(/<atom:link[^>]*rel="http:\/\/www.sap.com\/adt\/relations\/objectstates"[^>]*\/>/, '')
        .replace('version="new"', 'version="active"');
    }
    return previous(url, method, body);
  };
  h.runtime.execute = runIndexTailGraph;
  return {
    ...h,
    seed,
    views,
    stop: () => {
      stopped = true;
      h.stop();
    },
    run: () =>
      runIndexTailGraph({
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
