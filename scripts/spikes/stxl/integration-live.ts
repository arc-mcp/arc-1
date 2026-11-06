/** Read-only public MCP integration smoke; existing text keys/results remain private. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { handleToolCall } from '../../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { liveContext } from './live-client.js';

if (process.env.STXL_ALLOW_HELPERS === 'true' || process.env.STXL_ALLOW_FREE_SQL === 'true')
  throw new Error('Public integration smoke requires helper writes and free SQL disabled');
const context = liveContext();
assert.equal(context.client.safety.allowWrites, false);
assert.equal(context.client.safety.allowFreeSQL, false);
await mkdir(context.output, { recursive: true, mode: 0o700 });
await chmod(context.output, 0o700);
const runId = `integration-${Date.now()}`;
const config = {
  ...DEFAULT_CONFIG,
  systemType: 'onprem' as const,
  allowDataPreview: true,
  allowFreeSQL: false,
  allowWrites: false,
};
const auth = { token: 'local-read-only-smoke', clientId: 'local-read-only-smoke', scopes: ['read', 'data'] };
type Key = { object: string; name: string; id: string; language: string };
type NativeCase = {
  TDOBJECT: string;
  TDNAME: string;
  TDID: string;
  TDSPRAS: string;
  STATUS: number;
  EXPECTED: Array<{ TDFORMAT: string; TDLINE: string }>;
};
type Item = {
  index: number;
  status: string;
  key: Key;
  lines: Array<{ format: string; text: string }>;
  error?: { code: string };
};
type Payload = {
  code?: string;
  mode?: string;
  items?: Item[];
  candidates?: Array<{ key: Key }>;
  matches?: Array<{ key: Key; text: string }>;
  succeeded?: number;
  errors?: unknown[];
};
const stages: Array<{ stage: string; status: string; count?: number; code?: string }> = [];
async function invoke(stage: string, longText: Record<string, unknown>, expectUnsupported = false) {
  const result = await handleToolCall(context.client, config, 'SAPQuery', { action: 'long_text', longText }, auth);
  await context.save(`${runId}-${stage}.json`, result);
  const payload = JSON.parse(result.content[0]!.text) as Payload;
  if (expectUnsupported) {
    assert.equal(result.isError, true);
    assert.equal(payload.code, 'UNSUPPORTED_PLATFORM');
    stages.push({ stage, status: 'unsupported-cleanly', code: payload.code });
    return payload;
  }
  assert.notEqual(result.isError, true, `Public ${stage} call failed; inspect private artifact`);
  return payload;
}
try {
  if (context.label === '750') {
    await invoke('capability', { mode: 'discover', object: 'TEXT', namePrefix: 'ZARC1_CAPABILITY', limit: 1 }, true);
  } else {
    assert.ok(['758', '816'].includes(context.label), 'Unqualified integration target');
    const oracle = JSON.parse(
      await readFile(resolve(context.output, `${context.label}-corpus-E-oracle.json`), 'utf8'),
    ) as { CASES: NativeCase[] };
    const candidate = oracle.CASES.find(
      (item) =>
        item.STATUS === 0 &&
        item.TDOBJECT === 'TEXT' &&
        item.EXPECTED.length < 100 &&
        item.EXPECTED.some((line) => line.TDLINE.trim().length > 0),
    );
    assert.ok(candidate, 'No suitable private existing-text key');
    const key: Key = {
      object: candidate.TDOBJECT,
      name: candidate.TDNAME,
      id: candidate.TDID,
      language: candidate.TDSPRAS,
    };
    await context.save(`${runId}-key.json`, key);
    const read = await invoke('read', { mode: 'read', keys: [key] });
    assert.equal(read.items?.length, 1);
    assert.equal(read.items[0].status, 'ok');
    assert.deepEqual(read.items[0].key, key);
    assert.deepEqual(
      read.items[0].lines,
      candidate.EXPECTED.map((line) => ({
        format: line.TDFORMAT.replace(/ +$/u, ''),
        text: line.TDLINE.replace(/ +$/u, ''),
      })),
    );
    stages.push({ stage: 'read', status: 'pass', count: read.items[0].lines.length });
    const discover = await invoke('discover', {
      mode: 'discover',
      object: key.object,
      namePrefix: key.name,
      id: key.id,
      language: key.language,
      limit: 5,
    });
    assert.ok(discover.candidates?.some((item) => JSON.stringify(item.key) === JSON.stringify(key)));
    stages.push({ stage: 'discover', status: 'pass', count: discover.candidates!.length });
    const missing: Key = { ...key, name: `ZARC1_NO_${randomUUID().replaceAll('-', '').toUpperCase()}` };
    const batch = await invoke('batch', { mode: 'read', keys: [key, missing, key] });
    assert.deepEqual(
      batch.items?.map((item) => item.status),
      ['ok', 'error', 'ok'],
    );
    assert.deepEqual(
      batch.items?.map((item) => item.index),
      [0, 1, 2],
    );
    assert.equal(batch.items![1].error?.code, 'NOT_FOUND');
    assert.deepEqual(batch.items![0].lines, read.items[0].lines);
    assert.deepEqual(batch.items![2].lines, read.items[0].lines);
    stages.push({ stage: 'batch', status: 'pass', count: batch.items!.length });
    const phrase = read.items[0].lines.find((line) => line.text.trim().length > 0)?.text.slice(0, 80);
    assert.ok(phrase, 'Selected text has no searchable nonempty line');
    const search = await invoke('search', { mode: 'search', keys: [key], phrase });
    assert.equal(search.succeeded, 1);
    assert.deepEqual(search.errors, []);
    assert.ok(search.matches?.some((item) => item.text.includes(phrase)));
    stages.push({ stage: 'search', status: 'pass', count: search.matches!.length });
  }
  const summary = {
    label: context.label,
    tool: 'SAPQuery',
    action: 'long_text',
    status: 'pass',
    readonly: true,
    freeSqlEnabled: false,
    helperWritesEnabled: false,
    publicCalls: stages.length,
    stages,
  };
  await context.save(`${runId}-summary.json`, summary);
  await context.save('integration-latest-summary.json', summary);
  process.stderr.write(`${JSON.stringify(summary)}\n`);
} catch (error) {
  await context.save(`${runId}-failure.json`, {
    message: error instanceof Error ? error.message : 'Unknown failure',
    stages,
  });
  await context.save('integration-latest-summary.json', {
    label: context.label,
    tool: 'SAPQuery',
    action: 'long_text',
    status: 'fail',
    readonly: true,
    freeSqlEnabled: false,
    helperWritesEnabled: false,
    completedPublicCalls: stages.length,
    stages,
  });
  throw new Error('Public stored-text integration failed; inspect private integration artifacts');
}
