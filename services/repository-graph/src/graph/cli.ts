import { access, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { collectMockFixture } from '../collector/http-collector.js';
import { collectLiveGraph } from '../collector/live-collector.js';
import { PgGraphStore } from './store/pg.js';
import type { GraphEdgeInput, GraphImport, GraphNodeInput, NodeRef, RelationKind } from './types.js';
import { validateTraversalOptions } from './types.js';

interface RawFixture {
  extractorVersion: string;
  nodes: Array<Omit<GraphNodeInput, 'systemKey'> & { systemKey?: string }>;
  observations: Array<{
    evidenceMethod?: string;
    evidenceOwner?: string;
    relation: RelationKind;
    source: [string, string];
    sourceResource?: string;
    target: [string, string];
  }>;
  scope: string;
  systemKey: string;
}

const fixturePath = join(process.cwd(), 'tests/graph/fixtures/golden.json');

function ref(systemKey: string, raw: [string, string]): NodeRef {
  const [type, name] = raw;
  return { name, systemKey, type };
}

async function goldenImports(): Promise<GraphImport[]> {
  const raw = JSON.parse(await readFile(fixturePath, 'utf8')) as RawFixture;
  const primaryNodes = raw.nodes
    .filter((node) => (node.systemKey ?? raw.systemKey) === raw.systemKey)
    .map((node): GraphNodeInput => ({ ...node, systemKey: raw.systemKey }));
  const primaryObservations = raw.observations.map(
    (edge, index): GraphEdgeInput => ({
      evidenceMethod: edge.evidenceMethod ?? 'fixture-oracle',
      evidenceOwner: edge.evidenceOwner ?? `${edge.source[0]}:${edge.source[1]}`,
      relation: edge.relation,
      source: ref(raw.systemKey, edge.source),
      sourceResource: edge.sourceResource ?? `fixture:${edge.source[0]}:${edge.source[1]}:${index}`,
      target: ref(raw.systemKey, edge.target),
    }),
  );
  for (let index = 1; index <= 40; index += 1) {
    const name = `ZCL_GENERATED_${String(index).padStart(3, '0')}`;
    primaryNodes.push({
      description: `Deterministic golden node ${index}`,
      name,
      packageName: index % 2 === 0 ? 'ZSALES' : 'ZSHARED',
      systemKey: raw.systemKey,
      type: 'CLAS',
    });
    for (const [targetType, targetName, relation] of [
      ['CLAS', 'ZCL_ORDER_SERVICE', 'static_call'],
      ['CLAS', 'ZCL_ORDER_READER', 'references'],
      ['INTF', 'ZIF_ORDER_READER', 'implements'],
    ] as const) {
      primaryObservations.push({
        evidenceMethod: 'fixture-generator',
        evidenceOwner: `CLAS:${name}`,
        relation,
        source: { name, systemKey: raw.systemKey, type: 'CLAS' },
        sourceResource: `fixture:CLAS:${name}`,
        target: { name: targetName, systemKey: raw.systemKey, type: targetType },
      });
    }
  }
  const imports: GraphImport[] = [
    {
      extractorVersion: raw.extractorVersion,
      nodes: primaryNodes,
      observations: primaryObservations,
      scope: raw.scope,
      systemKey: raw.systemKey,
    },
  ];
  for (const systemKey of new Set(
    raw.nodes.map((node) => node.systemKey).filter((value): value is string => Boolean(value)),
  )) {
    if (systemKey === raw.systemKey) continue;
    imports.push({
      extractorVersion: raw.extractorVersion,
      nodes: raw.nodes.filter((node) => node.systemKey === systemKey).map((node) => ({ ...node, systemKey })),
      observations: [],
      scope: raw.scope,
      systemKey,
    });
  }
  return imports;
}

async function seedGolden(store: PgGraphStore): Promise<Record<string, number>> {
  let nodes = 0;
  let observations = 0;
  for (const input of await goldenImports()) {
    const result = await store.importGraph(input, true);
    nodes += result.nodes;
    observations += result.observations;
  }
  return { nodes, observations };
}

async function verifyGolden(store: PgGraphStore): Promise<Record<string, unknown>> {
  const primaryStats = await store.stats('TRIAL-2023-001');
  const secondaryStats = await store.stats('SECOND-001');
  if (
    primaryStats.systems !== 1 ||
    primaryStats.nodes !== 55 ||
    primaryStats.observations !== 134 ||
    primaryStats.unresolved !== 0 ||
    secondaryStats.systems !== 1 ||
    secondaryStats.nodes !== 1 ||
    secondaryStats.observations !== 0
  ) {
    throw new Error(`Golden counts differ: ${JSON.stringify({ primaryStats, secondaryStats })}`);
  }
  const options = validateTraversalOptions({ direction: 'incoming', maxHops: 3, maxNodes: 100, maxEdges: 300 });
  const impact = await store.traverse({ systemKey: 'TRIAL-2023-001', type: 'TABL', name: 'ZORDER' }, options);
  const impactNames = new Set(impact.nodes.map((node) => node.name));
  for (const expected of ['ZORDER', 'ZI_ORDER', 'ZC_ORDER', 'ZI_ORDER_REPORT', 'ZCL_ORDER_SERVICE']) {
    if (!impactNames.has(expected)) throw new Error(`Golden impact is missing ${expected}`);
  }
  const path = await store.shortestPath(
    { systemKey: 'TRIAL-2023-001', type: 'CLAS', name: 'ZCL_ORDER_REPORT' },
    { systemKey: 'TRIAL-2023-001', type: 'TABL', name: 'ZORDER' },
    validateTraversalOptions({ direction: 'outgoing', maxHops: 3 }),
  );
  if (path.observations.length !== 3) throw new Error(`Expected three-edge path, got ${path.observations.length}`);
  const primarySearch = await store.search('TRIAL-2023-001', 'ZCL_ORDER_SERVICE');
  const secondarySearch = await store.search('SECOND-001', 'ZCL_ORDER_SERVICE');
  if (
    primarySearch.length !== 1 ||
    secondarySearch.length !== 1 ||
    primarySearch[0]?.packageName === secondarySearch[0]?.packageName
  ) {
    throw new Error('System-scoped identity check failed');
  }
  const coupling = await store.packageCoupling('TRIAL-2023-001');
  if (!coupling.some((row) => row.sourcePackage === 'ZSALES' && row.targetPackage === 'ZSHARED')) {
    throw new Error('Expected package coupling was not found');
  }
  return {
    couplingRows: coupling.length,
    impactNodes: impact.nodes.length,
    pathEdges: path.observations.length,
    stats: { primary: primaryStats, secondary: secondaryStats },
  };
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

async function benchmark(store: PgGraphStore): Promise<Record<string, unknown>> {
  const samples: number[] = [];
  const options = validateTraversalOptions({ direction: 'both', maxHops: 3, maxEdges: 300, maxNodes: 100 });
  for (let index = 0; index < 5; index += 1) {
    await store.traverse({ systemKey: 'TRIAL-2023-001', type: 'CLAS', name: 'ZCL_ORDER_SERVICE' }, options);
  }
  for (let index = 0; index < 30; index += 1) {
    const started = performance.now();
    await store.traverse({ systemKey: 'TRIAL-2023-001', type: 'CLAS', name: 'ZCL_ORDER_SERVICE' }, options);
    samples.push(performance.now() - started);
  }
  return {
    maxMs: Math.max(...samples),
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    repetitions: samples.length,
  };
}

function refreshNode(name: string): GraphNodeInput {
  return { name, packageName: 'ZREFRESH', systemKey: 'REFRESH-001', type: name.startsWith('ZIF_') ? 'INTF' : 'CLAS' };
}

function refreshEdge(target: string, owner = 'parsed:A'): GraphEdgeInput {
  return {
    evidenceMethod: owner.startsWith('parsed') ? 'abap-ast-v1' : 'sap-where-used',
    evidenceOwner: owner,
    relation: target.startsWith('ZIF_') ? 'implements' : 'references',
    source: refreshNode('ZCL_A'),
    sourceResource: owner.startsWith('parsed') ? 'active:CLAS:ZCL_A' : 'where-used:CLAS:ZCL_A',
    target: refreshNode(target),
  };
}

async function verifyRefresh(store: PgGraphStore): Promise<Record<string, unknown>> {
  const nodes = ['ZCL_A', 'ZCL_B', 'ZCL_C', 'ZCL_D', 'ZIF_A'].map(refreshNode);
  const parsedScope = { evidenceOwner: 'parsed:A', sourceResource: 'active:CLAS:ZCL_A' };
  const whereUsedScope = { evidenceOwner: 'where-used:A', sourceResource: 'where-used:CLAS:ZCL_A' };
  await store.importGraph(
    {
      evidenceScopes: [parsedScope, whereUsedScope],
      extractorVersion: 'refresh-1',
      nodes,
      observations: [refreshEdge('ZCL_B'), refreshEdge('ZIF_A'), refreshEdge('ZCL_D', 'where-used:A')],
      scope: 'refresh-fixture',
      systemKey: 'REFRESH-001',
    },
    true,
  );
  await store.importGraph(
    {
      evidenceScopes: [parsedScope],
      extractorVersion: 'refresh-2',
      nodes,
      observations: [refreshEdge('ZCL_C')],
      scope: 'refresh-fixture',
      systemKey: 'REFRESH-001',
    },
    true,
  );
  const afterChange = await store.traverse(
    refreshNode('ZCL_A'),
    validateTraversalOptions({ direction: 'outgoing', maxHops: 1, maxEdges: 20, maxNodes: 20 }),
  );
  const afterChangeTargets = new Set(afterChange.observations.map((edge) => edge.target.name));
  if (!afterChangeTargets.has('ZCL_C') || !afterChangeTargets.has('ZCL_D'))
    throw new Error('Changed and independent evidence missing');
  if (afterChangeTargets.has('ZCL_B') || afterChangeTargets.has('ZIF_A'))
    throw new Error('Stale parsed evidence survived replacement');
  try {
    await store.importGraph(
      {
        evidenceScopes: [parsedScope],
        extractorVersion: 'refresh-invalid',
        nodes,
        observations: [{ ...refreshEdge('ZCL_B'), relation: 'invalid_relation' as RelationKind }],
        scope: 'refresh-fixture',
        systemKey: 'REFRESH-001',
      },
      true,
    );
    throw new Error('Invalid refresh unexpectedly committed');
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid refresh unexpectedly committed') throw error;
  }
  const afterFailure = await store.traverse(
    refreshNode('ZCL_A'),
    validateTraversalOptions({ direction: 'outgoing', maxHops: 1, maxEdges: 20, maxNodes: 20 }),
  );
  if (!afterFailure.observations.some((edge) => edge.target.name === 'ZCL_C')) {
    throw new Error('Failed refresh erased the last valid evidence');
  }
  await store.importGraph(
    {
      evidenceScopes: [parsedScope],
      extractorVersion: 'refresh-3',
      nodes,
      observations: [],
      scope: 'refresh-fixture',
      systemKey: 'REFRESH-001',
    },
    true,
  );
  const afterEmpty = await store.traverse(
    refreshNode('ZCL_A'),
    validateTraversalOptions({ direction: 'outgoing', maxHops: 1, maxEdges: 20, maxNodes: 20 }),
  );
  if (afterEmpty.observations.length !== 1 || afterEmpty.observations[0]?.target.name !== 'ZCL_D') {
    throw new Error('Successful empty extraction did not retain only independent evidence');
  }
  const client = await store.pool.connect();
  let timeoutCode = '';
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '50ms'");
    await client.query('SELECT pg_sleep(1)');
  } catch (error) {
    timeoutCode = (error as { code?: string }).code ?? '';
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
  if (timeoutCode !== '57014') throw new Error(`Database cancellation was not observed: ${timeoutCode}`);
  return {
    failedRefreshPreservedLastGood: true,
    independentEvidencePreserved: true,
    statementTimeoutCode: timeoutCode,
    successfulEmptyReplacement: true,
  };
}

async function seedScale(
  store: PgGraphStore,
  nodeCount: number,
  edgesPerNode: number,
): Promise<Record<string, unknown>> {
  if (!Number.isInteger(nodeCount) || nodeCount < 1_000 || nodeCount > 1_000_000)
    throw new Error('nodeCount must be 1000..1000000');
  if (!Number.isInteger(edgesPerNode) || edgesPerNode < 1 || edgesPerNode > 10)
    throw new Error('edgesPerNode must be 1..10');
  const before = await store.pool.query<{ lsn: string }>('SELECT pg_current_wal_lsn() AS lsn');
  const started = performance.now();
  const client = await store.pool.connect();
  try {
    await client.query('BEGIN');
    const system = await client.query<{ id: string }>(
      `INSERT INTO arc_graph.systems(system_key) VALUES ('SCALE-001')
       ON CONFLICT (system_key) DO UPDATE SET updated_at = CURRENT_TIMESTAMP RETURNING id`,
    );
    const systemId = system.rows[0]?.id;
    if (!systemId) throw new Error('Scale system upsert failed');
    await client.query(
      `INSERT INTO arc_graph.nodes(system_id, object_type, object_name, package_name, description, resolution_status)
       SELECT $1, 'CLAS', 'ZSCALE_' || lpad(g::text, 7, '0'),
         'ZSCALE_' || lpad(((g - 1) % 100)::text, 3, '0'), '', 'resolved'
       FROM generate_series(1, $2::int) g
       ON CONFLICT (system_id, object_type, object_name) DO NOTHING`,
      [systemId, nodeCount],
    );
    await client.query(
      `INSERT INTO arc_graph.edge_observations
         (source_node_id, target_node_id, relation_kind, evidence_owner, evidence_method, source_resource)
       SELECT source_node.id, target_node.id, 'references', 'synthetic-scale', 'generated-v1',
         'synthetic:' || source_node.object_name
       FROM generate_series(1, $2::int) source_index
       CROSS JOIN generate_series(1, $3::int) edge_index
       JOIN arc_graph.nodes source_node ON source_node.system_id = $1
         AND source_node.object_type = 'CLAS'
         AND source_node.object_name = 'ZSCALE_' || lpad(source_index::text, 7, '0')
       JOIN arc_graph.nodes target_node ON target_node.system_id = $1
         AND target_node.object_type = 'CLAS'
         AND target_node.object_name = 'ZSCALE_' || lpad((((source_index - 1 + edge_index * 7919) % $2) + 1)::text, 7, '0')
       ON CONFLICT DO NOTHING`,
      [systemId, nodeCount, edgesPerNode],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  const after = await store.pool.query<{ lsn: string }>('SELECT pg_current_wal_lsn() AS lsn');
  const sizes = await store.pool.query<{ edges: string; nodes: string; total: string; wal: string }>(
    `SELECT pg_total_relation_size('arc_graph.nodes')::text AS nodes,
      pg_total_relation_size('arc_graph.edge_observations')::text AS edges,
      (pg_total_relation_size('arc_graph.nodes') + pg_total_relation_size('arc_graph.edge_observations'))::text AS total,
      pg_wal_lsn_diff($1, $2)::text AS wal`,
    [after.rows[0]?.lsn, before.rows[0]?.lsn],
  );
  const row = sizes.rows[0];
  return {
    durationMs: performance.now() - started,
    edgeBytes: Number(row?.edges ?? 0),
    nodeBytes: Number(row?.nodes ?? 0),
    requestedNodes: nodeCount,
    requestedObservations: nodeCount * edgesPerNode,
    totalBytes: Number(row?.total ?? 0),
    walBytes: Number(row?.wal ?? 0),
  };
}

async function benchmarkScale(store: PgGraphStore): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  for (const concurrency of [1, 5, 10]) {
    for (const hops of [1, 3]) {
      const outcomes: Array<{ durationMs: number; error?: string }> = [];
      const options = validateTraversalOptions({ direction: 'both', maxHops: hops, maxEdges: 300, maxNodes: 100 });
      for (let warmup = 0; warmup < 5; warmup += 1) {
        await store
          .traverse({ systemKey: 'SCALE-001', type: 'CLAS', name: 'ZSCALE_0000001' }, options)
          .catch(() => undefined);
      }
      for (let batch = 0; batch < 30 / concurrency; batch += 1) {
        const batchOutcomes = await Promise.all(
          Array.from({ length: concurrency }, (_value, index) =>
            (async () => {
              const started = performance.now();
              try {
                await store.traverse(
                  {
                    systemKey: 'SCALE-001',
                    type: 'CLAS',
                    name: `ZSCALE_${String(batch * concurrency + index + 1).padStart(7, '0')}`,
                  },
                  options,
                );
                return { durationMs: performance.now() - started };
              } catch (error) {
                return {
                  durationMs: performance.now() - started,
                  error: error instanceof Error ? error.message : String(error),
                };
              }
            })(),
          ),
        );
        outcomes.push(...batchOutcomes);
      }
      const representative = await store
        .traverse({ systemKey: 'SCALE-001', type: 'CLAS', name: 'ZSCALE_0000001' }, options)
        .catch(() => undefined);
      const durations = outcomes.map((outcome) => outcome.durationMs);
      const errors = outcomes.filter((outcome) => outcome.error);
      results[`c${concurrency}h${hops}`] = {
        errors: errors.length,
        exploredObservations: representative?.exploredObservations,
        p50Ms: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
        repetitions: outcomes.length,
        returnedNodes: representative?.nodes.length,
        timeoutErrors: errors.filter((outcome) => /timeout/i.test(outcome.error ?? '')).length,
        truncated: representative?.truncated,
      };
    }
  }
  return results;
}

async function verifyBounds(store: PgGraphStore): Promise<Record<string, unknown>> {
  const client = await store.pool.connect();
  try {
    await client.query('BEGIN');
    const system = await client.query<{ id: string }>(
      "SELECT id FROM arc_graph.systems WHERE system_key = 'SCALE-001'",
    );
    const systemId = system.rows[0]?.id;
    if (!systemId) throw new Error('Run seed-scale before verify-bounds');
    const hub = await client.query<{ id: string }>(
      `INSERT INTO arc_graph.nodes(system_id, object_type, object_name, package_name, description, resolution_status)
       VALUES ($1, 'CLAS', 'ZSCALE_HUB', 'ZSCALE_HUB', 'High degree traversal fixture', 'resolved')
       ON CONFLICT (system_id, object_type, object_name) DO UPDATE SET updated_at = CURRENT_TIMESTAMP RETURNING id`,
      [systemId],
    );
    const hubId = hub.rows[0]?.id;
    if (!hubId) throw new Error('High-degree fixture node was not created');
    await client.query(
      `INSERT INTO arc_graph.edge_observations
         (source_node_id, target_node_id, relation_kind, evidence_owner, evidence_method, source_resource)
       SELECT id, $1, 'references', 'synthetic-hub', 'generated-v1', 'synthetic-hub:' || object_name
       FROM arc_graph.nodes
       WHERE system_id = $2 AND object_type = 'CLAS' AND object_name LIKE 'ZSCALE\\_%' ESCAPE '\\'
         AND object_name <> 'ZSCALE_HUB'
       ORDER BY object_name LIMIT 20000
       ON CONFLICT DO NOTHING`,
      [hubId, systemId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  const started = performance.now();
  const result = await store.traverse(
    { systemKey: 'SCALE-001', type: 'CLAS', name: 'ZSCALE_HUB' },
    validateTraversalOptions({ direction: 'incoming', edgeBudget: 10_000, maxEdges: 300, maxHops: 1, maxNodes: 100 }),
  );
  const durationMs = performance.now() - started;
  const responseBytes = Buffer.byteLength(JSON.stringify({ apiVersion: 1, ...result }));
  const nodeIds = new Set(result.nodes.map((node) => node.id));
  // A closed star with a 100-node budget admits the hub and 99 neighbors, not 300 edges
  // pointing to omitted nodes. The SQL candidate window still probes one past maxEdges.
  if (
    !result.truncated ||
    result.exploredObservations !== 301 ||
    result.nodes.length !== 100 ||
    result.observations.length !== 99 ||
    result.observations.some((edge) => !nodeIds.has(edge.source.id) || !nodeIds.has(edge.target.id))
  ) {
    throw new Error(
      `High-degree traversal was not bounded/closed: nodes=${result.nodes.length}, observations=${result.observations.length}, explored=${result.exploredObservations}`,
    );
  }
  if (responseBytes > 512_000) throw new Error(`High-degree result exceeded the API response limit: ${responseBytes}`);
  return {
    durationMs,
    exploredObservations: result.exploredObservations,
    responseBytes,
    returnedNodes: result.nodes.length,
    returnedObservations: result.observations.length,
    truncated: result.truncated,
  };
}

async function retentionCheck(store: PgGraphStore): Promise<Record<string, unknown>> {
  const forbidden = await store.pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'arc_graph' AND column_name IN ('source', 'source_text', 'source_body', 'source_code', 'snippet')`,
  );
  const canaries = await store.pool.query<{ count: string }>(
    `SELECT (
      (SELECT COUNT(*) FROM arc_graph.nodes WHERE object_name ILIKE '%ARC_SOURCE_CANARY%'
        OR description ILIKE '%ARC_SOURCE_CANARY%' OR package_name ILIKE '%ARC_SOURCE_CANARY%') +
      (SELECT COUNT(*) FROM arc_graph.edge_observations WHERE evidence_owner ILIKE '%ARC_SOURCE_CANARY%'
        OR evidence_method ILIKE '%ARC_SOURCE_CANARY%' OR source_resource ILIKE '%ARC_SOURCE_CANARY%')
    )::text AS count`,
  );
  if (forbidden.rowCount || Number(canaries.rows[0]?.count ?? 0) > 0) throw new Error('Source retention check failed');
  return { forbiddenColumns: 0, persistedCanaries: 0 };
}

async function verifyExtraction(store: PgGraphStore): Promise<Record<string, unknown>> {
  const child = await store.traverse(
    { systemKey: 'MOCK-001', type: 'CLAS', name: 'ZCL_EXTRACT_CHILD' },
    validateTraversalOptions({ direction: 'outgoing', maxHops: 1, maxEdges: 100, maxNodes: 100 }),
  );
  const childRelations = new Set(child.observations.map((edge) => `${edge.relation}:${edge.target.name}`));
  for (const expected of [
    'inherits_from:ZCL_EXTRACT_PARENT',
    'implements:ZIF_EXTRACT',
    'static_call:CL_ABAP_CONTEXT_INFO',
    'static_call:ZCL_FACTORY',
    'function_call:Z_EXTRACT_FM',
  ]) {
    if (!childRelations.has(expected)) throw new Error(`Extracted ABAP graph is missing ${expected}`);
  }
  const cds = await store.traverse(
    { systemKey: 'MOCK-001', type: 'DDLS', name: 'ZI_EXTRACT' },
    validateTraversalOptions({ direction: 'outgoing', maxHops: 1, maxEdges: 100, maxNodes: 100 }),
  );
  const cdsRelations = new Set(cds.observations.map((edge) => `${edge.relation}:${edge.target.name}`));
  for (const expected of [
    'reads_from:ZTAB_EXTRACT',
    'reads_from:ZTAB_ITEM',
    'associates_to:ZI_CUSTOMER',
    'composes:ZI_CHILD',
  ]) {
    if (!cdsRelations.has(expected)) throw new Error(`Extracted CDS graph is missing ${expected}`);
  }
  if ([...childRelations, ...cdsRelations].some((edge) => edge.includes('CANARY'))) {
    throw new Error('Comment or literal canary became a relationship');
  }
  return {
    abapObservations: child.observations.length,
    cdsObservations: cds.observations.length,
    sourceCanariesPersisted: 0,
  };
}

async function doctor(): Promise<Record<string, unknown>> {
  const required = ['package.json', 'compose.graph.yaml', 'Dockerfile.graph', 'db/pg/migrations/001_graph.sql'];
  for (const file of required) await access(join(process.cwd(), file));
  const secretDirectory = join(process.cwd(), '.secrets');
  let secretFiles: string[] = [];
  try {
    secretFiles = await readdir(secretDirectory);
    for (const file of secretFiles) {
      const details = await stat(join(secretDirectory, file));
      if ((details.mode & 0o077) !== 0) throw new Error(`Secret file ${file} is accessible outside its owner`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return { requiredFiles: required.length, secretFiles: secretFiles.length };
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (process.env.ARC_GRAPH_BACKEND === 'hana') {
    const { runHanaCli } = await import('./hana-cli.js');
    return runHanaCli(command);
  }
  if (process.env.ARC_GRAPH_BACKEND && process.env.ARC_GRAPH_BACKEND !== 'postgres')
    throw new Error('Unsupported graph backend');
  if (command === 'doctor') {
    process.stdout.write(`${JSON.stringify({ status: 'ok', ...(await doctor()) })}\n`);
    return;
  }
  const store = new PgGraphStore();
  try {
    let result: Record<string, unknown>;
    switch (command) {
      case 'migrate':
        result = { migrationVersion: await store.migrate() };
        break;
      case 'seed-golden':
        result = await seedGolden(store);
        break;
      case 'verify-golden':
        result = await verifyGolden(store);
        break;
      case 'benchmark':
        result = await benchmark(store);
        break;
      case 'retention-check':
        result = await retentionCheck(store);
        break;
      case 'collect-mock':
        result = await collectMockFixture(store);
        break;
      case 'verify-extraction':
        result = await verifyExtraction(store);
        break;
      case 'verify-refresh':
        result = await verifyRefresh(store);
        break;
      case 'seed-scale':
        result = await seedScale(store, Number(process.argv[3] ?? '100000'), Number(process.argv[4] ?? '10'));
        break;
      case 'benchmark-scale':
        result = await benchmarkScale(store);
        break;
      case 'verify-bounds':
        result = await verifyBounds(store);
        break;
      case 'collect-live-metadata':
        result = {
          ...(await store.withCollectionLease(process.env.ARC_GRAPH_SYSTEM_KEY ?? '', (leased) =>
            collectLiveGraph(leased, 'metadata'),
          )),
        };
        break;
      case 'collect-live-source':
        result = {
          ...(await store.withCollectionLease(process.env.ARC_GRAPH_SYSTEM_KEY ?? '', (leased) =>
            collectLiveGraph(leased, 'transient-source'),
          )),
        };
        break;
      default:
        throw new Error(
          'Usage: graph/cli.js <doctor|migrate|seed-golden|verify-golden|benchmark|retention-check|collect-mock|verify-extraction|verify-refresh|seed-scale|benchmark-scale|verify-bounds|collect-live-metadata|collect-live-source>',
        );
    }
    process.stdout.write(`${JSON.stringify({ status: 'ok', ...result })}\n`);
  } finally {
    await store.close();
  }
}

main().catch((error: unknown) => {
  const code = (error as { code?: unknown })?.code;
  process.stderr.write(
    `${JSON.stringify({
      status: 'error',
      operation: process.argv[2],
      code: typeof code === 'string' && /^[A-Z0-9_]{2,40}$/.test(code) ? code : 'operation_failed',
    })}\n`,
  );
  process.exitCode = 1;
});
