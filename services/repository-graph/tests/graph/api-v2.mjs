import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { createGraphApi } from '../../dist/graph/api.js';
import { HanaGraphStore } from '../../dist/graph/store/hana.js';
import { PgGraphStore } from '../../dist/graph/store/pg.js';

const Store = process.env.ARC_GRAPH_BACKEND === 'hana' ? HanaGraphStore : PgGraphStore;
const store = new Store();
const systemKey = 'API-V2-QUALITY-001';
const audience = 'test';
const key = 'v2-test-key-only-012345678901234567890';
const ref = (name, type = 'CLAS/OC') => ({ name, type, systemKey });
const a = ref('ZV2_A');
const b = ref('ZV2_B');
const c = ref('ZV2_C');
await store.importGraph(
  {
    systemKey,
    scope: 'quality',
    extractorVersion: 'quality-v2',
    nodes: [a, b, c, ref('ZV2_AMBIGUOUS', 'TABL/DT'), ref('ZV2_AMBIGUOUS', 'TABL/DS')].map((node, i) => ({
      ...node,
      resolutionStatus: 'resolved',
      packageName: i === 0 ? 'ZPKGA' : 'ZPKGB',
    })),
    observations: [
      [a, b],
      [b, c],
    ].map(([source, target]) => ({
      source,
      target,
      relation: 'static_call',
      evidenceMethod: 'test-v2',
      evidenceOwner: 'quality',
      sourceResource: source.name,
    })),
    collection: {
      status: 'partial',
      counters: { successfulSources: 2, failedSources: 1, failedParses: 1 },
      sources: [{ name: c.name, type: c.type, status: 'failed', reasons: ['empty_source'], dynamicTargets: 0 }],
    },
  },
  true,
);
const server = createServer(createGraphApi(store, [key], { systemKey, audience }));
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}`;
async function raw(args, path = '/v2/query', suppliedKey = key) {
  const r = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${suppliedKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ systemKey, audience, ...args }),
  });
  return { status: r.status, value: await r.json() };
}
async function query(args) {
  const r = await raw(args);
  assert.equal(r.status, 200, JSON.stringify(r.value));
  return r.value;
}
let checks = 0;
try {
  const malformed = await new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: server.address().port, path: '//[' }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => (body += chunk));
      response.once('error', reject);
      response.once('end', () => resolve({ status: response.statusCode, body }));
    });
    req.once('error', reject);
    req.end();
  });
  assert.deepEqual(malformed, { status: 400, body: JSON.stringify({ error: 'invalid_request_target' }) });
  checks++;
  const limited = await query({ action: 'search', query: 'ZV2_', limit: 1 });
  assert.equal(limited.nodes.length, 1);
  assert.equal(limited.hasMore, true);
  checks++;
  const exact = await query({ action: 'search', query: 'ZV2_A', limit: 100 });
  assert.equal(exact.hasMore, false);
  assert.equal(exact.coverage.status, 'partial');
  assert.equal(exact.coverage.sourceCounts.failed, 1);
  checks++;
  const slash = await query({ action: 'neighbors', name: a.name, type: a.type });
  const bare = await query({ action: 'neighbors', name: a.name, type: 'CLAS' });
  assert.deepEqual(bare.nodes, slash.nodes);
  assert.equal(bare.startStatus, 'found');
  checks++;
  const missing = await query({ action: 'impact', name: 'NO_SUCH_OBJECT', type: 'CLAS' });
  assert.equal(missing.startStatus, 'not_indexed');
  assert.equal(missing.hasMore, false);
  assert.equal(missing.coverage.status, 'partial');
  checks++;
  const ambiguous = await query({ action: 'neighbors', name: 'ZV2_AMBIGUOUS', type: 'TABL' });
  assert.equal(ambiguous.startStatus, 'ambiguous');
  assert.equal(ambiguous.nodes.length, 0);
  checks++;
  const one = await query({ action: 'neighbors', name: a.name, type: 'CLAS', maxNodes: 1 });
  assert.equal(one.nodes.length, 1);
  assert.equal(one.edges.length, 0);
  assert.equal(one.hasMore, true);
  checks++;
  const path = await query({
    action: 'path',
    name: a.name,
    type: 'CLAS',
    targetName: c.name,
    targetType: 'CLAS',
    depth: 2,
    direction: 'outgoing',
  });
  assert.equal(path.pathFound, true);
  assert.equal(path.nodes.length, 3);
  assert.equal(path.edges.length, 2);
  assert.ok(path.edges.every((e) => !('source' in e)));
  checks++;
  const short = await query({
    action: 'path',
    name: a.name,
    type: 'CLAS',
    targetName: c.name,
    targetType: 'CLAS',
    depth: 1,
    direction: 'outgoing',
  });
  assert.equal(short.pathFound, false);
  assert.equal(short.targetStatus, 'found');
  checks++;
  for (const patch of [{ systemKey: 'OTHER' }, { audience: 'other' }])
    assert.equal((await raw({ action: 'status', ...patch })).status, 403);
  assert.equal((await raw({ action: 'status' }, '/v1/coverage')).status, 410);
  assert.equal((await raw({ action: 'status' }, '/v2/query', 'bad')).status, 401);
  checks++;
  assert.equal((await raw({ action: 'neighbors', type: 'CLAS', name: a.name, maxNodes: 0 })).status, 400);
  checks++;
  assert.equal((await raw({ action: 'impact', type: 'CLAS', name: a.name, kinds: ['belongs_to'] })).status, 400);
  checks++;
  const saved = Store.prototype.search;
  Store.prototype.search = async () => {
    throw new Error('SECRET_ERROR_SOURCE_CANARY');
  };
  try {
    const error = await raw({ action: 'search', query: 'Z' });
    assert.equal(error.status, 503);
    assert.ok(!JSON.stringify(error).includes('CANARY'));
    checks++;
  } finally {
    Store.prototype.search = saved;
  }
  const coupling = await query({ action: 'package_coupling', limit: 1 });
  assert.equal(coupling.couplings.length, 1);
  assert.equal(coupling.hasMore, false);
  checks++;
  console.log(
    JSON.stringify({
      checks,
      systemKey,
      result: 'passed',
      partialCoverage: exact.coverage,
      compactPathBytes: Buffer.byteLength(JSON.stringify(path)),
    }),
  );
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await store.close();
}
