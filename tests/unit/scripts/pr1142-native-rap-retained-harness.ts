/** Captured owned metadata/source, with only future native effects modeled synthetically. */
import { readFileSync } from 'node:fs';
import { rapSettings } from '../../../scripts/qualification/pr1142/native-rap-fixtures.js';
import {
  RAP_RETAINED_SUFFIX,
  rapRetainedFixtures,
} from '../../../scripts/qualification/pr1142/native-rap-retained-fixed.js';
import { rapHarness } from './pr1142-native-rap-harness.js';

const {
  runNativeRapDocumentsRetained,
  runNativeRapDocumentsRetainedV2,
  runNativeRapDocumentsRetainedV3,
  runNativeRapDocumentsRetainedV4,
} = await import('../../../scripts/qualification/pr1142/native-rap-driver.js');
export const retainedRows = JSON.parse(
  readFileSync(new URL('../../fixtures/json/rap-retained-native-state.json', import.meta.url), 'utf8'),
) as { path: string; body: string; sha256: string }[];
export const updatedDocumentRows = JSON.parse(
  readFileSync(new URL('../../fixtures/json/rap-retained-document-updated-state.json', import.meta.url), 'utf8'),
) as typeof retainedRows;
export const retainedV2Rows = retainedRows.map(
  (row) => updatedDocumentRows.find((next) => next.path === row.path) ?? row,
);
const finalDocument = readFileSync(
  new URL('../../fixtures/xml/sktd-managed-bdef-native-final-draft.xml', import.meta.url),
  'utf8',
);
export const retainedV3Rows = retainedV2Rows.map((row) =>
  row.path === '/sap/bc/adt/documentation/ktd/documents/zrrp_8e66923bdef5' ||
  row.path === '/sap/bc/adt/documentation/ktd/documents/zrrp_8e66923bdef5?version=inactive'
    ? { ...row, body: finalDocument, sha256: 'fc10e52833148c8f946d92a5816761a8948c478afe27ba70a2ea886e4bd09380' }
    : row,
);
export const retainedV4Rows = JSON.parse(
  readFileSync(new URL('../../fixtures/json/rap-retained-v4-native-state.json', import.meta.url), 'utf8'),
) as typeof retainedRows;
export const retainedFixtures = rapRetainedFixtures(RAP_RETAINED_SUFFIX);
export function retainedHarness(
  proxy = false,
  editedDocument: boolean | 'updated-document' | 'active-binding' = false,
) {
  const h = rapHarness({ documents: true, proxy }),
    f = retainedFixtures;
  h.useFixtures(f);
  const execute =
    editedDocument === 'active-binding'
      ? runNativeRapDocumentsRetainedV4
      : editedDocument === 'updated-document'
        ? runNativeRapDocumentsRetainedV3
        : editedDocument
          ? runNativeRapDocumentsRetainedV2
          : runNativeRapDocumentsRetained;
  const bodies = new Map(
    (editedDocument === 'active-binding'
      ? retainedV4Rows
      : editedDocument === 'updated-document'
        ? retainedV3Rows
        : editedDocument
          ? retainedV2Rows
          : retainedRows
    ).map((r) => [r.path.toLowerCase(), r.body]),
  );
  for (const i of editedDocument === 'active-binding' ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 6]) {
    const o = h.world.objects.get(f[i].owner)!;
    o.metadata = bodies.get(f[i].owner.toLowerCase())!;
    o.source = bodies.get(`${f[i].owner}/source/main`.toLowerCase());
  }
  for (const part of ['definitions', 'implementations', 'macros'])
    h.parts[part] = bodies.get(`${f[2].owner}/includes/${part}`)!;
  if (editedDocument) h.activeDocuments.set(f[6].owner, bodies.get(`${f[6].owner}?version=active`)!);
  const reply = h.hooks.reply!;
  const response = (data: string, statusCode = 200) => ({
    statusCode,
    data,
    responseOptions: { headers: { 'content-type': 'application/xml' } },
  });
  h.hooks.reply = (u, m, b) => {
    if (m === 'GET' && u.pathname.toLowerCase() === f[2].owner && h.world.objects.get(f[2].owner)!.metadata)
      return response(h.world.objects.get(f[2].owner)!.metadata);
    if (m === 'GET' && u.pathname.toLowerCase() === rapSettings(f).owner && h.world.objects.get(f[0].owner)!.metadata)
      return response(bodies.get(rapSettings(f).owner)!);
    const result = reply(u, m, b);
    if (m === 'DELETE' && u.pathname.toLowerCase() === f[6].owner) {
      const parent = h.world.objects.get(f[3].owner)!;
      parent.metadata = parent.metadata.replace(
        /<atom:link[^>]*rel="http:\/\/www.sap.com\/adt\/relations\/dita\/documentation"[^>]*\/>/,
        '',
      );
    }
    return result;
  };
  h.runtime.execute = execute;
  let stopped = false;
  return {
    ...h,
    stop: () => {
      stopped = true;
    },
    run: () =>
      execute({
        base: h.client,
        fixtures: f,
        freshUntil: Date.now() + 240000,
        record: (r) => {
          h.records.push(r);
          h.hooks.record?.(r);
        },
        verify: h.verify,
        shouldStop: () => stopped,
      }),
  };
}

export const retainedV2Harness = (proxy = false) => retainedHarness(proxy, true);

export const retainedV3Harness = (proxy = false) => retainedHarness(proxy, 'updated-document');

export const retainedV4Harness = (proxy = false) => retainedHarness(proxy, 'active-binding');
