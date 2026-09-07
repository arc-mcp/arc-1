// Full mock-ADT HTTP -> collector -> real PostgreSQL regression. No live SAP is contacted.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { collectLiveGraph } from '../../dist/collector/live-collector.js';
import { PgGraphStore } from '../../dist/graph/store/pg.js';
import { validateTraversalOptions } from '../../dist/graph/types.js';

const systemKey = 'COLLECTOR-QUALITY-001';
const canary = 'ARC_SOURCE_CANARY_SECRET';
let sourceRequests = 0;
const bodies = new Map([
  ['zq_a', `REPORT zq_a. SELECT * FROM zkeep INTO TABLE @DATA(rows). " ${canary}`],
  ['zq_b', 'REPORT zq_b. DATA x TYPE zother.'],
]);
const catalog = `<objectReferences>${[...bodies.keys()]
  .map(
    (name) =>
      `<objectReference type="PROG/P" name="${name.toUpperCase()}" packageName="ZQUALITY" uri="/sap/bc/adt/programs/programs/${name}"/>`,
  )
  .join('')}</objectReferences>`;
const server = createServer((request, response) => {
  if (request.url.startsWith('/sap/bc/adt/repository/informationsystem/search')) {
    response.setHeader('content-type', 'application/xml');
    response.end(catalog);
    return;
  }
  const name = request.url.match(/programs\/programs\/(zq_[ab])\/source\/main/)?.[1];
  sourceRequests++;
  if (!name || !bodies.has(name)) {
    response.statusCode = 404;
    response.end('not_found');
    return;
  }
  if (bodies.get(name) === null) {
    response.statusCode = 503;
    response.end(canary);
    return;
  }
  response.setHeader('content-type', 'text/plain');
  response.end(bodies.get(name));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
Object.assign(process.env, {
  ARC_GRAPH_SAP_URL: `http://127.0.0.1:${server.address().port}`,
  ARC_GRAPH_SAP_USER: 'fixture',
  ARC_GRAPH_SAP_PASSWORD: 'fixture',
  ARC_GRAPH_SYSTEM_KEY: systemKey,
  ARC_GRAPH_LIVE_QUERY: 'Z*',
  ARC_GRAPH_LIVE_PACKAGES: 'ZQUALITY',
  ARC_GRAPH_LIVE_MAX_OBJECTS: '100',
  ARC_GRAPH_LIVE_CONCURRENCY: '2',
});
const store = new PgGraphStore();
let imported;
const sink = {
  importGraph: async (graph, replace) => {
    imported = graph;
    return store.importGraph(graph, replace);
  },
};
const options = validateTraversalOptions({ direction: 'outgoing', maxHops: 1 });
const targets = async (name) =>
  (await store.traverse({ systemKey, type: 'PROG/P', name }, options)).observations
    .filter((edge) => edge.relation !== 'belongs_to')
    .map((edge) => edge.target.name)
    .sort();
const counts = async () =>
  (
    await store.pool.query(
      `SELECT
  (SELECT count(*) FROM arc_graph.generations g JOIN arc_graph.systems s ON s.id=g.system_id WHERE s.system_key=$1)::int AS generations,
  (SELECT count(*) FROM arc_graph.collection_jobs j JOIN arc_graph.systems s ON s.id=j.system_id WHERE s.system_key=$1)::int AS jobs`,
      [systemKey],
    )
  ).rows[0];
const results = [];
try {
  const initial = await collectLiveGraph(sink, 'transient-source');
  assert.equal(initial.successfulSources, 2);
  assert.deepEqual(await targets('ZQ_A'), ['ZKEEP']);
  results.push('initial SQL and type relationships stored');

  bodies.set('zq_a', 'NOT VALID ABAP ???');
  bodies.set('zq_b', 'REPORT zq_b. DATA x TYPE znew.');
  const partial = await collectLiveGraph(sink, 'transient-source');
  assert.equal(partial.failedParses, 1);
  assert.equal(partial.collectionStatus, 'partial');
  assert.deepEqual(await targets('ZQ_A'), ['ZKEEP']);
  assert.deepEqual(await targets('ZQ_B'), ['ZNEW']);
  const job = (
    await store.pool.query(
      `SELECT j.status,j.checkpoint,j.counters FROM arc_graph.collection_jobs j
    JOIN arc_graph.systems s ON s.id=j.system_id WHERE s.system_key=$1 ORDER BY j.id DESC LIMIT 1`,
      [systemKey],
    )
  ).rows[0];
  assert.equal(job.status, 'partial');
  assert.equal(job.counters.failedParses, 1);
  assert.equal(job.checkpoint.sources.find((source) => source.name === 'ZQ_A').status, 'failed');
  results.push('parse failure preserves A while B updates; partial outcome persisted');

  bodies.set('zq_a', null);
  const outage = await collectLiveGraph(sink, 'transient-source');
  assert.equal(outage.failedReads, 1);
  assert.deepEqual(await targets('ZQ_A'), ['ZKEEP']);
  results.push('HTTP 503 retry exhaustion preserves previous evidence');

  bodies.set('zq_a', 'REPORT zq_a. DATA x TYPE string.');
  bodies.set('zq_b', 'REPORT zq_b. CALL FUNCTION function_name.');
  const empty = await collectLiveGraph(sink, 'transient-source');
  assert.equal(empty.successfulSources, 2);
  assert.equal(empty.dynamicTargets, 1);
  assert.deepEqual(await targets('ZQ_A'), []);
  assert.deepEqual(await targets('ZQ_B'), []);
  results.push('valid empty clears stale edges; dynamic FM has coverage count but no fake target');

  bodies.set('zq_b', 'REPORT zq_b. DATA x TYPE znew.');
  await collectLiveGraph(sink, 'transient-source');
  const validGraph = imported;
  const before = sourceRequests;
  await collectLiveGraph(sink, 'metadata');
  assert.equal(sourceRequests, before);
  assert.deepEqual(await targets('ZQ_B'), ['ZNEW']);
  results.push('metadata refresh does not fetch or erase source evidence');

  const beforeFailure = await counts();
  await assert.rejects(
    store.importGraph(
      { ...validGraph, observations: validGraph.observations.map((edge) => ({ ...edge, relation: 'not_a_relation' })) },
      true,
    ),
  );
  assert.deepEqual(await counts(), beforeFailure);
  assert.deepEqual(await targets('ZQ_B'), ['ZNEW']);
  results.push('DB failure rolls back evidence and collection/generation reports together');

  const retained = await store.pool.query(
    `SELECT count(*)::int AS count FROM arc_graph.collection_jobs j
    JOIN arc_graph.systems s ON s.id=j.system_id WHERE s.system_key=$1 AND (j.checkpoint::text LIKE $2 OR j.counters::text LIKE $2)`,
    [systemKey, `%${canary}%`],
  );
  assert.equal(retained.rows[0].count, 0);
  results.push('source/error canary absent from persisted reports');
  console.log(JSON.stringify({ status: 'ok', systemKey, checks: results, sourceRequests }, null, 2));
} finally {
  await store.close();
  await new Promise((resolve) => server.close(resolve));
}
