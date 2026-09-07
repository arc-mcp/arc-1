import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { PgGraphStore } from '../../dist/graph/store/pg.js';

const store = new PgGraphStore();
try {
  const count = (await store.stats('SCALE-001')).nodes;
  assert.ok(count >= 100000, 'Run seed-scale first');
  const results = [];
  for (const query of ['ZSCALE_0000001', 'NO_SUCH_SCALE_OBJECT', 'ZSCALE']) {
    const times = [];
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      await store.withSnapshot((snapshot) => snapshot.search('SCALE-001', query, 20));
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    results.push({ query, p50Ms: times[15], p95Ms: times[28], maxMs: times[29] });
  }
  let captured;
  const execute = store.pool.query.bind(store.pool);
  store.pool.query = async (sql, values) => {
    captured = { sql, values };
    return execute(sql, values);
  };
  await store.search('SCALE-001', 'NO_SUCH_SCALE_OBJECT', 20);
  const explained = await execute(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${captured.sql}`, captured.values);
  const plan = explained.rows[0]['QUERY PLAN'][0];
  const nodes = [];
  const visit = (node) => {
    nodes.push({ operation: node['Node Type'], index: node['Index Name'], rows: node['Actual Rows'] });
    for (const child of node.Plans ?? []) visit(child);
  };
  visit(plan.Plan);
  console.log(
    JSON.stringify({
      status: 'passed',
      graphNodes: count,
      concurrency: 1,
      warmRuns: 30,
      results,
      plan: nodes,
      fullTextIndexUsed: JSON.stringify(plan).includes('nodes_metadata_search_idx'),
      executionMs: plan['Execution Time'],
    }),
  );
} finally {
  await store.close();
}
