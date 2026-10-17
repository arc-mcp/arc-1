/** Offline synthetic fixtures: no SAP connection, credentials or execution. */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unifiedDiff } from '../src/adt/source-diff.js';
import { textResult } from '../src/handlers/shared.js';
import { collectTransportReview, renderTransportReview } from '../src/workflows/transport-review.js';

const directory = process.argv[2] ?? 'test-results/review-demos';
await mkdir(directory, { recursive: true });
const before = 'REPORT zdemo.\nWRITE 1.\n';
const after = 'REPORT zdemo.\nWRITE 2.\n';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const revision = (id: string, transport: string) => ({
  id,
  transport,
  author: 'DEMO',
  timestamp: '2026-10-17T00:00:00Z',
  uri: `/sap/bc/adt/programs/programs/ZDEMO/source/main/versions/20261017000000/${id}/content`,
});
const part = {
  part: 'main',
  baselineStatus: 'prior-revision',
  selectionMethod: 'exact-transport',
  from: '00001',
  to: '00002',
  sourceState: 'released',
  comparisonMode: 'released',
  attribution: 'transport',
  statisticsComplete: true,
  change: 'changed',
  ...unifiedDiff(before, after, '00001', '00002'),
  sourceHashes: { before: sha(before), after: sha(after) },
  revisions: { before: revision('00001', 'DEVK900001'), after: revision('00002', 'DEVK900002'), skipped: [] },
};
const object = {
  type: 'PROG',
  name: 'ZDEMO',
  taskIds: ['DEVK900003'],
  components: [{ pgmid: 'LIMU', type: 'REPS', name: 'ZDEMO', wbtype: 'PROG/P', taskId: 'DEVK900003' }],
  parts: [part],
};
const page = {
  schemaVersion: 1,
  resultFormat: 'structured',
  target: 'SYNTHETIC/001',
  client: '001',
  transport: { id: 'DEVK900002', status: 'R' },
  reviewMode: 'released',
  inventoryFingerprint: sha('demo inventory'),
  continuation: 'synthetic-token',
  offset: 0,
  shown: 1,
  totalObjects: 1,
  objects: [object],
};
for (const scenario of ['complete', 'partial', 'stale'] as const) {
  let calls = 0;
  const report = await collectTransportReview(async () => {
    const value = structuredClone(page);
    if (scenario === 'partial')
      Object.assign(value.objects[0]!, { coverageGaps: ['Historical text pool was not compared.'] });
    if (scenario === 'stale' && calls++ > 0) value.inventoryFingerprint = sha('changed inventory');
    return textResult(JSON.stringify(value));
  }, 'DEVK900002');
  report.observations = [
    'OFFLINE SYNTHETIC DEMO. The displayed report literal changes from 1 to 2; this is not SAP production evidence.',
  ];
  await writeFile(join(directory, `${scenario}.json`), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  await writeFile(join(directory, `${scenario}.html`), renderTransportReview(report), { flag: 'wx' });
}
console.log(`Saved complete, partial and stale review demonstrations to ${directory}`);
