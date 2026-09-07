import assert from 'node:assert/strict';
import { selectedBinding } from './bindings.js';
import { graphResponseSchema } from './contract-v2.js';

async function main() {
  const c = selectedBinding(process.env, process.env.ARC_GRAPH_CONNECTION_BINDING ?? '');
  assert.equal(c.version, 1);
  assert.equal(c.sharing, 'shared-repository-metadata');
  assert.equal(typeof c.url, 'string');
  const origin = new URL(c.url as string);
  assert.equal(origin.protocol, 'https:');
  assert.equal(origin.origin, c.url);
  assert.equal(typeof c.apiKey, 'string');
  let calls = 0;
  const request = async (args: Record<string, unknown>, expected = 200, path = '/v2/query', key = c.apiKey) => {
    const response = await fetch(`${c.url}${path}`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ systemKey: c.systemKey, audience: c.audience, ...args }),
    });
    assert.equal(response.status, expected);
    calls++;
    if (expected !== 200) {
      await response.body?.cancel();
      return undefined;
    }
    return graphResponseSchema.parse(await response.json());
  };
  await request({ action: 'status' }, 401, '/v2/query', 'invalid');
  await request({ action: 'status', systemKey: 'UNAUTHORIZED-001' }, 403);
  await request({ action: 'status', audience: 'other' }, 403);
  await request({ action: 'status' }, 410, '/v1/coverage');
  const status = await request({ action: 'status' });
  assert.ok(status?.coverage.generation);
  const search = await request({ action: 'search', query: process.env.ARC_GRAPH_SMOKE_QUERY ?? 'Z', limit: 100 });
  const root = search?.nodes.find((n) => n.resolutionStatus === 'resolved' && n.type === 'CLAS');
  assert.ok(root);
  const args = { name: root.name, type: root.type };
  const neighbors = await request({ action: 'neighbors', ...args });
  assert.equal(neighbors?.startStatus, 'found');
  const bounded = await request({ action: 'neighbors', ...args, maxNodes: 1 });
  assert.ok(bounded && bounded.nodes.length <= 1);
  const impact = await request({ action: 'impact', ...args });
  assert.equal(impact?.startStatus, 'found');
  if (process.env.ARC_GRAPH_SMOKE_QUERY) {
    assert.ok(neighbors && neighbors.edges.length > 0, 'Chosen sample must have real relationships');
    assert.ok(impact && impact.nodes.length > 1 && impact.edges.length > 0, 'Non-vacuous impact sample required');
  }
  const path = await request({ action: 'path', ...args, targetName: root.name, targetType: root.type });
  assert.equal(path?.pathFound, true);
  await request({ action: 'package_coupling', limit: 20 });
  await request({ action: 'neighbors', ...args, maxNodes: 0 }, 400);
  const durations: number[] = [];
  for (let batch = 0; batch < 5; batch++)
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        const started = performance.now();
        await request({ action: 'impact', ...args });
        durations.push(performance.now() - started);
      }),
    );
  durations.sort((a, b) => a - b);
  process.stdout.write(
    JSON.stringify({
      status: 'passed',
      calls,
      concurrency: 3,
      p50Ms: durations[7],
      p95Ms: durations[14],
      searchNodes: search?.nodes.length,
      coverage: status?.coverage,
      impactNodes: impact?.nodes.length,
      impactEdges: impact?.edges.length,
      databaseBound: Boolean(process.env.ARC_GRAPH_PG_SERVICE_BINDING),
      sapBound: Object.keys(JSON.parse(process.env.VCAP_SERVICES ?? '{}')).includes('destination'),
    }) + '\n',
  );
}
main().catch(() => {
  process.stderr.write('Graph cloud API smoke failed (credentials and payloads suppressed)\n');
  process.exitCode = 1;
});
