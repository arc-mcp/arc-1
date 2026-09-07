import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { HanaGraphStore } from './store/hana.js';
import { withHanaSession } from './store/hana-connection.js';
import type { GraphImport } from './types.js';

const readerEnv = {
  ...process.env,
  ARC_GRAPH_HANA_BOOTSTRAP: 'false',
  ARC_GRAPH_HANA_SERVICE_BINDING: 'arc-graph-hana-reader',
};
const writerEnv = {
  ...process.env,
  ARC_GRAPH_HANA_BOOTSTRAP: 'false',
  ARC_GRAPH_HANA_SERVICE_BINDING: 'arc-graph-hana-writer',
};
// Integration-only binding names can be overridden without changing any credential content.
readerEnv.ARC_GRAPH_HANA_SERVICE_BINDING =
  process.env.ARC_GRAPH_TEST_READER_BINDING ?? readerEnv.ARC_GRAPH_HANA_SERVICE_BINDING;
writerEnv.ARC_GRAPH_HANA_SERVICE_BINDING =
  process.env.ARC_GRAPH_TEST_WRITER_BINDING ?? writerEnv.ARC_GRAPH_HANA_SERVICE_BINDING;
const reader = new HanaGraphStore(readerEnv);
const writer = new HanaGraphStore(writerEnv);
const systemKey = 'HANA-QUALITY-001';
const node = (name: string) => ({ name, type: 'CLAS', systemKey, packageName: 'ZQUALITY' });
const a = node('ZQUALITY_A');
const b = node('ZQUALITY_B');
const freshName = `ZQUALITY_NEW_${Date.now()}`;
const input: GraphImport = {
  systemKey,
  scope: 'quality',
  extractorVersion: 'quality-1',
  nodes: [a, b],
  observations: [
    {
      source: a,
      target: b,
      relation: 'references',
      evidenceMethod: 'test',
      evidenceOwner: 'quality',
      sourceResource: 'quality:a',
    },
  ],
  evidenceScopes: [{ evidenceOwner: 'quality', sourceResource: 'quality:a' }],
  collection: { status: 'complete', counters: { successfulSources: 1 }, sources: [] },
};
const checks: string[] = [];
try {
  assert.equal((await reader.ready()).migrationVersion, 1);
  await assert.rejects(
    withHanaSession((s) => s.exec('DELETE FROM NODES WHERE SYSTEM_KEY = ?', ['NO_SUCH_SYSTEM']), readerEnv),
    /258/,
  );
  await assert.rejects(
    withHanaSession((s) => s.exec('UPDATE SCHEMA_MIGRATIONS SET VERSION = VERSION WHERE 1 = 0'), writerEnv),
    /258/,
  );
  await assert.rejects(
    withHanaSession((s) => s.exec('CREATE TABLE ARC_GRAPH.QUALITY_FORBIDDEN_DDL(ID INTEGER)'), writerEnv),
    /258/,
  );
  checks.push('reader cannot mutate; writer cannot change schema/version');
  await writer.importGraph(input, true);
  const before = await reader.coverage(systemKey);
  await reader.withSnapshot(async (snapshot) => {
    assert.equal((await snapshot.coverage(systemKey)).generation, before.generation);
    await writer.importGraph({ ...input, extractorVersion: 'quality-2', nodes: [a, b, node(freshName)] }, true);
    assert.equal((await snapshot.coverage(systemKey)).generation, before.generation);
    assert.equal((await snapshot.search(systemKey, freshName)).length, 0);
  });
  assert.equal((await reader.search(systemKey, freshName)).length, 1);
  checks.push('read snapshot stays consistent across a concurrent commit');
  const committed = await reader.coverage(systemKey);
  await assert.rejects(
    writer.withCollectionLease(systemKey, async (leased) => {
      await leased.importGraph({ ...input, nodes: [node('ZQUALITY_ROLLBACK')] }, true);
      throw new Error('intentional rollback');
    }),
    /intentional rollback/,
  );
  assert.equal((await reader.coverage(systemKey)).generation, committed.generation);
  assert.equal((await reader.search(systemKey, 'ZQUALITY_ROLLBACK')).length, 0);
  checks.push('failed publication rolls back generation and graph together');
  const started = performance.now();
  await writer.withCollectionLease(systemKey, async () => {
    await assert.rejects(writer.withCollectionLease(systemKey, async () => undefined));
  });
  assert.ok(performance.now() - started < 4000, 'Lease contention must fail promptly');
  checks.push('concurrent collectors are excluded with a bounded lock wait');
  await writer.importGraph(
    {
      ...input,
      observations: [],
      evidenceScopes: [],
      collection: {
        status: 'partial',
        counters: { failedReads: 1, failedSources: 1 },
        sources: [{ name: a.name, type: a.type, status: 'read_failed', reasons: ['read_failed'], dynamicTargets: 0 }],
      },
    },
    true,
  );
  assert.equal((await reader.stats(systemKey)).observations, 1);
  assert.equal((await reader.coverage(systemKey)).status, 'partial');
  await writer.importGraph({ ...input, observations: [] }, true);
  assert.equal((await reader.stats(systemKey)).observations, 0);
  checks.push('failed refresh retains evidence; explicit successful-empty refresh clears it');
  const columns = await withHanaSession(
    (s) => s.exec('SELECT COLUMN_NAME FROM SYS.TABLE_COLUMNS WHERE SCHEMA_NAME = ?', ['ARC_GRAPH']),
    readerEnv,
  );
  assert.ok(columns.length > 10, 'Column inspection must actually see the graph schema');
  assert.equal(
    columns.filter((row) =>
      /^(SOURCE|SOURCE_TEXT|SOURCE_CODE|CONTENT|BODY|ERROR_MESSAGE)$/.test(String(row.COLUMN_NAME)),
    ).length,
    0,
  );
  checks.push('metadata schema has no source/body/error-message columns');
  process.stdout.write(`${JSON.stringify({ status: 'passed', database: 'hana', checks })}\n`);
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      status: 'failed',
      database: 'hana',
      completedChecks: checks,
      reason:
        error instanceof Error && /^HANA operation failed \(\d+\)$/.test(error.message)
          ? error.message
          : 'quality_assertion_failed',
    })}\n`,
  );
  process.exitCode = 1;
}
