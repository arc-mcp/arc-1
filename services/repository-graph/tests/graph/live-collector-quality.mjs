// Explicit live opt-in through the normal ARC_GRAPH_LIVE_* environment variables.
// Reads SAP source transiently; persists only graph evidence and approved collection metadata.
import assert from 'node:assert/strict';
import { collectLiveGraph } from '../../dist/collector/live-collector.js';
import { PgGraphStore } from '../../dist/graph/store/pg.js';

const systemKey = process.env.ARC_GRAPH_SYSTEM_KEY;
assert.ok(systemKey, 'ARC_GRAPH_SYSTEM_KEY is required');
const store = new PgGraphStore();
const evidence = async () =>
  (
    await store.pool.query(
      `SELECT eo.evidence_owner,eo.source_resource,eo.relation_kind,
  eo.evidence_method,tn.object_type AS target_type,tn.object_name AS target_name
  FROM arc_graph.edge_observations eo JOIN arc_graph.nodes sn ON sn.id=eo.source_node_id
  JOIN arc_graph.nodes tn ON tn.id=eo.target_node_id JOIN arc_graph.systems s ON s.id=sn.system_id
  WHERE s.system_key=$1 AND eo.source_resource LIKE 'active:%'
  ORDER BY eo.evidence_owner,eo.source_resource,eo.relation_kind,eo.evidence_method,tn.object_type,tn.object_name`,
      [systemKey],
    )
  ).rows;
const results = [];
try {
  const before = await evidence();
  let firstStats;
  for (let iteration = 1; iteration <= 2; iteration++) {
    const result = await collectLiveGraph(store, 'transient-source');
    const after = await evidence();
    const preserved = [];
    for (const source of result.sourceOutcomes.filter((item) => item.status !== 'parsed')) {
      const owner = `${source.type}:${source.name}`;
      const previous = before.filter((edge) => edge.evidence_owner === owner);
      assert.deepEqual(
        after.filter((edge) => edge.evidence_owner === owner),
        previous,
      );
      preserved.push({
        name: source.name,
        status: source.status,
        reasons: source.reasons,
        preservedEdges: previous.length,
      });
    }
    const stats = await store.stats(systemKey);
    if (firstStats)
      assert.deepEqual(stats, firstStats, 'Stable trial scope should be idempotent across these two immediate runs');
    firstStats ??= stats;
    const job = (
      await store.pool.query(
        `SELECT j.status,j.counters FROM arc_graph.collection_jobs j
      JOIN arc_graph.systems s ON s.id=j.system_id WHERE s.system_key=$1 ORDER BY j.id DESC LIMIT 1`,
        [systemKey],
      )
    ).rows[0];
    assert.equal(job.status, result.collectionStatus);
    assert.equal(job.counters.failedSources, result.failedSources);
    results.push({
      iteration,
      discoveredObjects: result.discoveredObjects,
      successfulSources: result.successfulSources,
      failedReads: result.failedReads,
      failedParses: result.failedParses,
      partialParses: result.partialParses,
      collectionStatus: result.collectionStatus,
      durationMs: Math.round(result.durationMs),
      nominalRequests: result.requests,
      downloadedBytes: result.downloadedBytes,
      emittedObservations: result.observations,
      stats,
      preserved,
    });
  }
  console.log(JSON.stringify({ status: 'ok', results }, null, 2));
} finally {
  await store.close();
}
