import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Deliberately uses the core SDK installation: the backend has no MCP dependency.
const require = createRequire(new URL('../../../../package.json', import.meta.url));
const { Client } = await import(require.resolve('@modelcontextprotocol/sdk/client/index.js'));
const { StreamableHTTPClientTransport } = await import(
  require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js')
);
const [url, keyFile, mode = 'enabled'] = process.argv.slice(2);
const endpoint = new URL(url);
assert.equal(endpoint.protocol, 'https:');
assert.equal(endpoint.username + endpoint.password, '');
assert.ok(['enabled', 'hidden', 'unavailable', 'denied'].includes(mode));
const key = readFileSync(keyFile, 'utf8').trim();
const client = new Client({ name: 'arc-graph-validation', version: '0.0.1' });
let checks = 0;
const call = async (args) => {
  const result = await client.callTool({ name: 'SAPGraph', arguments: args });
  assert.notEqual(result.isError, true, `Graph action ${args.action} failed`);
  checks += 1;
  return JSON.parse(result.content.find((item) => item.type === 'text').text);
};
try {
  await client.connect(
    new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { authorization: `Bearer ${key}` } },
    }),
  );
  const { tools } = await client.listTools();
  const listed = tools.some((tool) => tool.name === 'SAPGraph');
  if (mode !== 'enabled') {
    assert.equal(listed, false);
    const result = await client.callTool({ name: 'SAPGraph', arguments: { action: 'search', query: 'Z' } });
    assert.equal(result.isError, true);
    checks += 2;
  } else {
    assert.equal(listed, true);
    checks += 1;
    assert.equal((await call({ action: 'status' })).state, 'ready');
    const search = await call({ action: 'search', query: 'ZSSI', limit: 100 });
    assert.ok(search.nodes.length > 0, 'Expected live-collected fixture metadata');
    const node = search.nodes.find((item) => item.resolutionStatus === 'resolved' && item.type === 'CLAS');
    assert.ok(node, 'A resolved live class is required');
    const base = { type: node.adtType, name: node.name };
    const neighbors = await call({ action: 'neighbors', ...base, depth: 1 });
    assert.equal(neighbors.startStatus, 'found');
    assert.ok(neighbors.edges.length > 0, 'Expected a real indexed relationship');
    const firstEdge = neighbors.edges[0];
    const start = neighbors.nodes.find((item) => item.id === firstEdge.sourceId);
    const target = neighbors.nodes.find((item) => item.id === firstEdge.targetId);
    const path = await call({
      action: 'path',
      type: start.adtType,
      name: start.name,
      targetType: target.adtType,
      targetName: target.name,
      direction: 'outgoing',
    });
    assert.equal(path.pathFound, true);
    assert.equal(path.edges.length, 1);
    assert.equal((await call({ action: 'impact', ...base, depth: 2 })).scope.direction, 'incoming');
    await call({ action: 'package_coupling' });
    const invalid = await client.callTool({ name: 'SAPGraph', arguments: { action: 'neighbors', ...base, depth: 4 } });
    assert.equal(invalid.isError, true);
    const missing = await call({ action: 'neighbors', type: 'CLAS', name: 'Z_ARC_GRAPH_NOT_INDEXED_7A950' });
    assert.equal(missing.startStatus, 'not_indexed');
    assert.equal(missing.nodes.length, 0);
    checks += 2;
    // SAP source is only transiently inspected; never print or save it.
    const live = await client.callTool({ name: 'SAPRead', arguments: { type: node.type, name: node.name } });
    assert.notEqual(live.isError, true);
    assert.ok(live.content.some((item) => item.type === 'text' && item.text.length > 100));
    checks += 1;
  }
  console.log(JSON.stringify({ mode, status: 'passed', checks, checkedAt: new Date().toISOString() }));
} catch {
  console.error(`ARC graph MCP validation failed (${mode}); no credential or response bodies logged.`);
  process.exitCode = 1;
} finally {
  await client.close();
}
