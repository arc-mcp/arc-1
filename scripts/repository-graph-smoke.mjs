// Read-only native MCP smoke against an operator-selected v2 graph API. No SAP connection.
// npm run build; ARC1_GRAPH_CONNECTION_FILE=/absolute/private/connection.json node scripts/repository-graph-smoke.mjs
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AdtHttpClient } from '../dist/adt/http.js';
import { createRepositoryGraphRuntime } from '../dist/repository-graph/runtime.js';
import { createServer } from '../dist/server/server.js';
import { DEFAULT_CONFIG } from '../dist/server/types.js';

assert.ok(process.env.ARC1_GRAPH_CONNECTION_FILE, 'Explicit private connection file required');
let sapRequests = 0;
const originalSapRequest = AdtHttpClient.prototype.request;
assert.equal(typeof originalSapRequest, 'function', 'Update the SAP transport guard if its entry point changes');
AdtHttpClient.prototype.request = async () => { sapRequests++; throw new Error('SAP request forbidden in graph smoke'); };
const config = { ...DEFAULT_CONFIG, graphConnectionFile: process.env.ARC1_GRAPH_CONNECTION_FILE };
const graph = createRepositoryGraphRuntime(config);
assert.ok(graph);
const server = createServer(config, { repositoryGraph: graph,
  startupAuthPreflightPromise: Promise.resolve({ status: 'failed', blocking: true, endpoint: 'not-contacted', checkedAt: new Date().toISOString(), reason: 'Graph-only smoke: SAP intentionally unavailable' }) });
const client = new Client({ name: 'arc1-graph-live-smoke', version: '1' });
const [ct, st] = InMemoryTransport.createLinkedPair();
let calls = 0;
async function call(args) {
  const result = await client.callTool({ name: 'SAPGraph', arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result)); calls++;
  const data = JSON.parse(result.content[0].text);
  if (data.nodes) {
    assert.ok(data.nodes.length <= (args.maxNodes ?? 100));
    const ids = new Set(data.nodes.map((n) => n.id));
    assert.ok(data.edges.every((e) => ids.has(e.sourceId) && ids.has(e.targetId)));
  }
  return data;
}
try {
  await graph.probe(); assert.equal(graph.listed, true, 'Backend must contain an indexed generation');
  await server.connect(st); await client.connect(ct);
  assert.ok((await client.listTools()).tools.some((t) => t.name === 'SAPGraph'));
  const status = await call({ action: 'status' });
  const search = await call({ action: 'search', query: process.env.ARC1_GRAPH_SMOKE_QUERY ?? 'Z', limit: 100 });
  const root = search.nodes.find((n) => n.resolutionStatus === 'resolved' && n.type === 'CLAS');
  assert.ok(root, 'Smoke query must include at least one indexed class');
  const base = { name: root.name, type: root.type };
  const bare = await call({ action: 'neighbors', ...base });
  const slash = await call({ action: 'neighbors', ...base, type: root.adtType });
  assert.equal(bare.startStatus, 'found'); assert.deepEqual(bare.nodes, slash.nodes);
  const bounded = await call({ action: 'neighbors', ...base, maxNodes: 1 });
  assert.ok(bounded.nodes.length <= 1);
  const impact = await call({ action: 'impact', ...base, depth: 2 });
  assert.equal((await call({ action: 'path', ...base, targetName: root.name, targetType: root.type })).pathFound, true);
  await call({ action: 'package_coupling', limit: 20 });
  const timings = [];
  for (let batch = 0; batch < 10; batch++) await Promise.all(Array.from({ length: 5 }, async () => {
    const start = performance.now(); await call({ action: 'impact', ...base, depth: 2 }); timings.push(performance.now() - start);
  }));
  timings.sort((a, b) => a - b);
  assert.equal(sapRequests, 0, 'Retrieval must not attempt SAP transport work');
  console.log(JSON.stringify({ passed: true, calls, concurrency: 5, measuredQueries: timings.length,
    p50Ms: +timings[Math.floor(timings.length * 0.5)].toFixed(2), p95Ms: +timings[Math.floor(timings.length * 0.95)].toFixed(2),
    sapRequests, coverage: status.coverage, searchNodes: search.nodes.length,
    impactNodes: impact.nodes.length, impactEdges: impact.edges.length,
    sampleNodes: bare.nodes.length, sampleEdges: bare.edges.length, sampleBytes: Buffer.byteLength(JSON.stringify(bare)) }, null, 2));
} finally { graph.stop(); await client.close(); await server.close(); AdtHttpClient.prototype.request = originalSapRequest; }
