import assert from 'node:assert/strict';
import { PgGraphStore } from '../../dist/graph/store/pg.js';

const store = new PgGraphStore();
const key = 'SNAPSHOT-LEASE-TEST';
const graph = (description) => ({
  systemKey: key,
  scope: 'test',
  extractorVersion: 'test',
  nodes: [{ systemKey: key, type: 'CLAS', name: 'ZSNAPSHOT', description }],
  observations: [],
});
try {
  await assert.rejects(store.pool.query('UPDATE arc_graph.schema_migrations SET version = version WHERE false'), {
    code: '42501',
  });
  await store.importGraph(graph('before'));
  let oldGeneration;
  await store.withSnapshot(async (snapshot) => {
    oldGeneration = (await snapshot.coverage(key)).generation;
    await store.importGraph(graph('after'));
    assert.equal((await snapshot.search(key, 'ZSNAPSHOT'))[0].description, 'before');
    assert.equal((await snapshot.coverage(key)).generation, oldGeneration);
  });
  assert.equal((await store.search(key, 'ZSNAPSHOT'))[0].description, 'after');
  assert.notEqual((await store.coverage(key)).generation, oldGeneration);
  await store.withCollectionLease(key, async (leased) => {
    await assert.rejects(
      store.withCollectionLease(key, async () => assert.fail('must not collect')),
      /already_running/,
    );
    await leased.importGraph(graph('leased'));
  });
  await assert.rejects(
    store.withCollectionLease(key, async () => {
      throw new Error('fixture failure');
    }),
  );
  await store.withCollectionLease(key, async (leased) => {
    await leased.importGraph(graph('reacquired'));
  });
  assert.equal((await store.search(key, 'ZSNAPSHOT'))[0].description, 'reacquired');
  const started = Date.now();
  await assert.rejects(
    store.withSnapshot(async () => new Promise(() => {})),
    /snapshot deadline/,
  );
  assert.ok(Date.now() - started < 5000, 'whole snapshot must end before the HTTP deadline');
  assert.equal(
    (await store.withSnapshot((snapshot) => snapshot.search(key, 'ZSNAPSHOT')))[0].description,
    'reacquired',
  );
  console.log(
    JSON.stringify({
      status: 'passed',
      checks: [
        'single-snapshot generation and data',
        'new snapshot sees commit',
        'collector exclusion',
        'lease release on failure',
        'real database whole-snapshot deadline and pool recovery',
        'writer cannot change migration history',
      ],
    }),
  );
} finally {
  await store.close();
}
