import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { graphPoolConfig } from '../config.js';
import type { GraphResponse } from '../contract-v2.js';
import {
  type GraphEdge,
  type GraphEdgeInput,
  type GraphImport,
  type GraphNode,
  type GraphNodeInput,
  type GraphTraversal,
  type NodeRef,
  normalizeNodeRef,
  type RelationKind,
  type TraversalOptions,
  validateTraversalOptions,
} from '../types.js';
import { collectionReportPayload } from './collection-report.js';
import { validateGraphImport } from './import-validation.js';
import type { GraphStore } from './store.js';
import { selectShortestPath, traverseGraph } from './traversal.js';

interface NodeRow {
  description: string;
  id: string;
  locator: string | null;
  name: string;
  package_name: string;
  resolution_status: 'resolved' | 'unresolved' | 'out_of_scope';
  system_key: string;
  type: string;
}

interface ObservationRow {
  evidence_method: string;
  evidence_owner: string;
  id: string;
  relation_kind: RelationKind;
  source_resource: string;
  source_node_id: string;
  target_node_id: string;
}

const NODE_COLUMNS = `n.id, s.system_key, n.object_type AS type, n.object_name AS name,
  n.package_name, n.description, n.locator, n.resolution_status`;
const EDGE_OBSERVATION_COLUMNS =
  'eo.id, eo.source_node_id, eo.target_node_id, eo.relation_kind, eo.evidence_owner, eo.evidence_method, eo.source_resource';

function mapNode(row: NodeRow): GraphNode {
  return {
    description: row.description,
    id: Number(row.id),
    locator: row.locator,
    name: row.name,
    packageName: row.package_name,
    resolutionStatus: row.resolution_status,
    systemKey: row.system_key,
    type: row.type,
  };
}

async function systemId(client: PoolClient, systemKey: string): Promise<number> {
  const normalized = normalizeNodeRef({ systemKey, type: 'SYSTEM', name: systemKey }).systemKey;
  const result = await client.query<{ id: string }>(
    `INSERT INTO arc_graph.systems(system_key) VALUES ($1)
     ON CONFLICT (system_key) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [normalized],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('System upsert returned no id');
  return Number(id);
}

async function upsertNode(client: PoolClient, input: GraphNodeInput): Promise<number> {
  const ref = normalizeNodeRef(input);
  const sid = await systemId(client, ref.systemKey);
  const result = await client.query<{ id: string }>(
    `INSERT INTO arc_graph.nodes
       (system_id, object_type, object_name, package_name, description, locator, resolution_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (system_id, object_type, object_name) DO UPDATE SET
       package_name = CASE WHEN EXCLUDED.resolution_status = 'resolved' THEN EXCLUDED.package_name ELSE arc_graph.nodes.package_name END,
       description = CASE WHEN EXCLUDED.resolution_status = 'resolved' THEN EXCLUDED.description ELSE arc_graph.nodes.description END,
       locator = COALESCE(EXCLUDED.locator, arc_graph.nodes.locator),
       resolution_status = CASE WHEN arc_graph.nodes.resolution_status = 'resolved' THEN 'resolved' ELSE EXCLUDED.resolution_status END,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [
      sid,
      ref.type,
      ref.name,
      input.packageName?.trim().toUpperCase() ?? '',
      input.description?.trim() ?? '',
      input.locator?.trim() || null,
      input.resolutionStatus ?? 'resolved',
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Node upsert returned no id');
  return Number(id);
}

function stub(ref: NodeRef): GraphNodeInput {
  return { ...ref, resolutionStatus: 'unresolved' };
}

async function insertObservation(client: PoolClient, input: GraphEdgeInput): Promise<void> {
  const sourceId = await upsertNode(client, stub(normalizeNodeRef(input.source)));
  const targetId = await upsertNode(client, stub(normalizeNodeRef(input.target)));
  await client.query(
    `INSERT INTO arc_graph.edge_observations
       (source_node_id, target_node_id, relation_kind, evidence_owner, evidence_method, source_resource)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (source_node_id, target_node_id, relation_kind, evidence_owner, evidence_method, source_resource)
     DO UPDATE SET observed_at = CURRENT_TIMESTAMP`,
    [sourceId, targetId, input.relation, input.evidenceOwner, input.evidenceMethod, input.sourceResource],
  );
}

export class PgGraphStore implements GraphStore {
  constructor(
    readonly pool = new Pool(graphPoolConfig()),
    private readonly snapshotClient?: PoolClient,
    private readonly writerClient?: PoolClient,
  ) {}
  private get executor() {
    return this.snapshotClient ?? this.pool;
  }

  async withCollectionLease<T>(systemKey: string, operation: (store: PgGraphStore) => Promise<T>): Promise<T> {
    const key = normalizeNodeRef({ systemKey, type: 'SYSTEM', name: systemKey }).systemKey;
    const client = await this.pool.connect();
    let acquired = false;
    try {
      const result = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 731941001)) AS acquired', [
        key,
      ]);
      acquired = result.rows[0]?.acquired === true;
      if (!acquired) throw new Error('collection_already_running');
      // Import uses this exact connection: losing the lock connection also fences its write.
      return await operation(new PgGraphStore(this.pool, undefined, client));
    } finally {
      if (acquired)
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 731941001))', [key]).catch(() => undefined);
      client.release();
    }
  }

  async withSnapshot<T>(operation: (store: GraphStore) => Promise<T>): Promise<T> {
    if (this.snapshotClient) return operation(this);
    const expires = Date.now() + 4500;
    const client = await this.pool.connect();
    let discarded = false;
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => {
          discarded = true;
          client.release(true); // Destroy the session; never recycle a timed-out transaction.
          reject(new Error('Graph snapshot deadline exceeded'));
        },
        Math.max(1, expires - Date.now()),
      );
    });
    try {
      return await Promise.race([
        deadline,
        (async () => {
          await client.query('BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ');
          await client.query("SET LOCAL statement_timeout = '2000ms'");
          await client.query("SET LOCAL idle_in_transaction_session_timeout = '5000ms'");
          const result = await operation(new PgGraphStore(this.pool, client));
          await client.query('COMMIT');
          return result;
        })(),
      ]);
    } catch (error) {
      if (!discarded) await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      clearTimeout(timer);
      if (!discarded) client.release();
    }
  }

  async resolve(
    systemKey: string,
    type: string,
    name: string,
  ): Promise<{ status: 'found' | 'not_indexed' | 'ambiguous'; node?: GraphNode }> {
    const ref = normalizeNodeRef({ systemKey, type, name });
    // Only type-family aliases, never name-only guessing. Bare and slash rows aren't merged.
    const matches = await this.executor.query<{ object_type: string }>(
      `SELECT n.object_type FROM arc_graph.nodes n JOIN arc_graph.systems s ON s.id = n.system_id
     WHERE s.system_key = $1 AND n.object_name = $2 AND
       (n.object_type = $3 OR ($4::boolean AND split_part(n.object_type, '/', 1) = $3)) LIMIT 2`,
      [ref.systemKey, ref.name, ref.type, !ref.type.includes('/')],
    );
    if (matches.rows.length > 1) return { status: 'ambiguous' };
    const foundType = matches.rows[0]?.object_type;
    const node = foundType ? await this.node({ ...ref, type: foundType }) : undefined;
    return node ? { status: 'found', node } : { status: 'not_indexed' };
  }

  async coverage(systemKey: string): Promise<GraphResponse['coverage']> {
    const result = await this.executor.query<{
      id: string;
      completed_at: Date;
      scope_name: string;
      extractor_version: string;
      status: string;
      counters: Record<string, number> | null;
    }>(
      `SELECT g.id, g.completed_at, g.scope_name, g.extractor_version, g.status,
       (SELECT j.counters FROM arc_graph.collection_jobs j WHERE j.system_id = g.system_id
          AND j.scope_name = g.scope_name AND j.updated_at = g.started_at ORDER BY j.id DESC LIMIT 1) AS counters
     FROM arc_graph.generations g JOIN arc_graph.systems s ON s.id = g.system_id
     WHERE s.system_key = $1 AND g.status <> 'building' ORDER BY g.id DESC LIMIT 1`,
      [systemKey],
    );
    const row = result.rows[0];
    const counters = row?.counters;
    return {
      // Legacy imports without outcomes cannot assert parser coverage.
      status: !counters ? 'unknown' : row?.status === 'complete' ? 'complete' : 'partial',
      generation: row?.id ?? null,
      asOf: row?.completed_at?.toISOString() ?? null,
      scope: row?.scope_name ?? null,
      extractorVersion: row?.extractor_version ?? null,
      sourceCounts: {
        parsed: counters?.successfulSources ?? 0,
        failed: (counters?.failedReads ?? 0) + (counters?.failedParses ?? 0),
        partial: counters?.partialParses ?? 0,
        dynamicTargets: counters?.dynamicTargets ?? 0,
      },
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async ready(): Promise<{ migrationVersion: number }> {
    const result = await this.executor.query<{ version: number }>(
      'SELECT COALESCE(MAX(version), 0)::int AS version FROM arc_graph.schema_migrations',
    );
    return { migrationVersion: result.rows[0]?.version ?? 0 };
  }

  async migrate(
    directory = process.env.ARC_GRAPH_MIGRATIONS_DIR ?? join(process.cwd(), 'db/pg/migrations'),
  ): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock(731941001)');
      await client.query('CREATE SCHEMA IF NOT EXISTS arc_graph');
      await client.query(
        'CREATE TABLE IF NOT EXISTS arc_graph.schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)',
      );
      const files = ['001_graph.sql'];
      for (const file of files) {
        const version = Number.parseInt(file.split('_', 1)[0] ?? '', 10);
        const existing = await client.query('SELECT 1 FROM arc_graph.schema_migrations WHERE version = $1', [version]);
        if (existing.rowCount) continue;
        const sql = await readFile(join(directory, file), 'utf8');
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO arc_graph.schema_migrations(version) VALUES ($1)', [version]);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
      // Repair the earlier experimental schema-1 grant on an explicit admin migration run.
      // The collector may publish graph data, never alter schema-version history.
      await client.query(`DO $roles$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arc_graph_writer') THEN
          REVOKE INSERT, UPDATE, DELETE ON arc_graph.schema_migrations FROM arc_graph_writer;
          ALTER DEFAULT PRIVILEGES IN SCHEMA arc_graph REVOKE INSERT, UPDATE, DELETE ON TABLES FROM arc_graph_writer;
        END IF;
      END $roles$`);
      const ready = await client.query<{ version: number }>(
        'SELECT MAX(version)::int AS version FROM arc_graph.schema_migrations',
      );
      return ready.rows[0]?.version ?? 0;
    } finally {
      await client.query('SELECT pg_advisory_unlock(731941001)').catch(() => undefined);
      client.release();
    }
  }

  async importGraph(input: GraphImport, replaceEvidence = false): Promise<{ nodes: number; observations: number }> {
    validateGraphImport(input);
    const systemKey = normalizeNodeRef({ systemKey: input.systemKey, type: 'SYSTEM', name: input.systemKey }).systemKey;
    if (input.nodes.some((node) => normalizeNodeRef(node).systemKey !== systemKey)) {
      throw new Error('All imported nodes must belong to graph.systemKey');
    }
    if (
      input.observations.some(
        (edge) =>
          normalizeNodeRef(edge.source).systemKey !== systemKey ||
          normalizeNodeRef(edge.target).systemKey !== systemKey,
      )
    ) {
      throw new Error('All imported observations must belong to graph.systemKey');
    }
    const report = input.collection ? collectionReportPayload(input.collection, systemKey) : undefined;
    const client = this.writerClient ?? (await this.pool.connect());
    try {
      await client.query('BEGIN');
      const sid = await systemId(client, systemKey);
      const generation = await client.query<{ id: string }>(
        `INSERT INTO arc_graph.generations(system_id, scope_name, extractor_version, status)
         VALUES ($1, $2, $3, 'building') RETURNING id`,
        [sid, input.scope, input.extractorVersion],
      );
      for (const node of input.nodes) await upsertNode(client, node);
      if (replaceEvidence) {
        const scopes = input.evidenceScopes ?? [
          ...new Map(
            input.observations.map((edge) => [`${edge.evidenceOwner}\u0000${edge.sourceResource}`, edge]),
          ).values(),
        ];
        for (const scope of scopes) {
          await client.query(
            `DELETE FROM arc_graph.edge_observations eo USING arc_graph.nodes n
             WHERE eo.source_node_id = n.id AND n.system_id = $1
               AND eo.evidence_owner = $2 AND eo.source_resource = $3`,
            [sid, scope.evidenceOwner, scope.sourceResource],
          );
        }
      }
      for (const observation of input.observations) await insertObservation(client, observation);
      if (report) {
        await client.query(
          `INSERT INTO arc_graph.collection_jobs(system_id, scope_name, status, checkpoint, counters)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
          [sid, input.scope, report.status, JSON.stringify(report.checkpoint), JSON.stringify(report.counters)],
        );
      }
      await client.query(
        `UPDATE arc_graph.generations SET status = $4, completed_at = CURRENT_TIMESTAMP,
           node_count = $1, observation_count = $2 WHERE id = $3`,
        [input.nodes.length, input.observations.length, generation.rows[0]?.id, report?.status ?? 'complete'],
      );
      await client.query('COMMIT');
      return { nodes: input.nodes.length, observations: input.observations.length };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      if (!this.writerClient) client.release();
    }
  }

  async node(ref: NodeRef, client?: PoolClient): Promise<GraphNode | null> {
    const normalized = normalizeNodeRef(ref);
    const executor = client ?? this.executor;
    const result = await executor.query<NodeRow>(
      `SELECT ${NODE_COLUMNS} FROM arc_graph.nodes n JOIN arc_graph.systems s ON s.id = n.system_id
       WHERE s.system_key = $1 AND n.object_type = $2 AND n.object_name = $3`,
      [normalized.systemKey, normalized.type, normalized.name],
    );
    return result.rows[0] ? mapNode(result.rows[0]) : null;
  }

  async search(systemKey: string, query: string, limit = 20): Promise<GraphNode[]> {
    if (!query.trim() || query.length > 255) throw new Error('Invalid search query');
    if (!Number.isInteger(limit) || limit < 1 || limit > 101) throw new Error('Invalid search limit');
    const normalized = normalizeNodeRef({ systemKey, type: 'SYSTEM', name: systemKey }).systemKey;
    const result = await this.executor.query<NodeRow>(
      `SELECT ${NODE_COLUMNS} FROM arc_graph.nodes n JOIN arc_graph.systems s ON s.id = n.system_id
       WHERE s.system_key = $1 AND (n.object_name ILIKE $2 OR n.description ILIKE $2 OR n.package_name ILIKE $2)
       ORDER BY (n.object_name = $3) DESC, n.object_name, n.object_type LIMIT $4`,
      [normalized, `%${query.replace(/[\\%_]/g, '\\$&')}%`, query.toUpperCase(), limit],
    );
    return result.rows.map(mapNode);
  }

  private async edgeRows(
    client: PoolClient,
    frontier: number[],
    options: TraversalOptions,
    rowLimit: number,
  ): Promise<GraphEdge[]> {
    const kinds = options.kinds?.length ? options.kinds : null;
    const limit = Math.max(1, rowLimit);
    const outgoing = `SELECT 0 AS branch_order, ${EDGE_OBSERVATION_COLUMNS} FROM arc_graph.edge_observations eo
      WHERE eo.source_node_id = ANY($1::bigint[]) AND ($2::text[] IS NULL OR eo.relation_kind = ANY($2::text[]))
      ORDER BY eo.source_node_id, eo.relation_kind, eo.target_node_id, eo.id LIMIT $3`;
    const incoming = `SELECT 1 AS branch_order, ${EDGE_OBSERVATION_COLUMNS} FROM arc_graph.edge_observations eo
      WHERE eo.target_node_id = ANY($1::bigint[]) AND ($2::text[] IS NULL OR eo.relation_kind = ANY($2::text[]))
      ORDER BY eo.target_node_id, eo.relation_kind, eo.source_node_id, eo.id LIMIT $3`;
    const body =
      options.direction === 'outgoing'
        ? outgoing
        : options.direction === 'incoming'
          ? incoming
          : `(${outgoing}) UNION ALL (${incoming})`;
    const result = await client.query<ObservationRow>(
      `WITH bounded_edges AS MATERIALIZED (
         SELECT * FROM (${body}) candidate_edges
         ORDER BY branch_order, source_node_id, relation_kind, target_node_id, id LIMIT $3
       )
       SELECT id, source_node_id, target_node_id, relation_kind, evidence_owner, evidence_method, source_resource
       FROM bounded_edges ORDER BY source_node_id, relation_kind, target_node_id, id`,
      [frontier, kinds, limit],
    );
    const nodeIds = [
      ...new Set(result.rows.flatMap((row) => [Number(row.source_node_id), Number(row.target_node_id)])),
    ];
    const nodeRows = nodeIds.length
      ? await client.query<NodeRow>(
          `SELECT ${NODE_COLUMNS} FROM arc_graph.nodes n JOIN arc_graph.systems s ON s.id = n.system_id
           WHERE n.id = ANY($1::bigint[])`,
          [nodeIds],
        )
      : { rows: [] };
    const nodes = new Map(nodeRows.rows.map((row) => [Number(row.id), mapNode(row)]));
    return result.rows.map((row) => {
      const source = nodes.get(Number(row.source_node_id));
      const target = nodes.get(Number(row.target_node_id));
      if (!source || !target) throw new Error('Graph observation references a missing node');
      return {
        evidenceMethod: row.evidence_method,
        evidenceOwner: row.evidence_owner,
        id: Number(row.id),
        relation: row.relation_kind,
        source,
        sourceResource: row.source_resource,
        target,
      };
    });
  }

  async traverse(start: NodeRef, rawOptions: TraversalOptions): Promise<GraphTraversal> {
    const options = validateTraversalOptions(rawOptions);
    const client = this.snapshotClient ?? (await this.pool.connect());
    try {
      if (!this.snapshotClient) await client.query('BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ');
      await client.query(`SET LOCAL statement_timeout = '${options.statementTimeoutMs}ms'`);
      const startNode = await this.node(start, client);
      if (!startNode) {
        if (!this.snapshotClient) await client.query('COMMIT');
        return { exploredObservations: 0, nodes: [], observations: [], partial: false, truncated: false };
      }
      const result = await traverseGraph(startNode, options, (frontier, bounds, limit) =>
        this.edgeRows(client, frontier, bounds, limit),
      );
      if (!this.snapshotClient) await client.query('COMMIT');
      return result;
    } catch (error) {
      if (!this.snapshotClient) await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      if (!this.snapshotClient) client.release();
    }
  }

  async shortestPath(start: NodeRef, target: NodeRef, options: TraversalOptions): Promise<GraphTraversal> {
    return selectShortestPath(await this.traverse(start, options), start, target, options);
  }

  async stats(systemKey?: string): Promise<Record<string, number>> {
    const filter = systemKey ? 'WHERE s.system_key = $1' : '';
    const params = systemKey ? [normalizeNodeRef({ systemKey, type: 'SYSTEM', name: systemKey }).systemKey] : [];
    const result = await this.executor.query<{
      nodes: string;
      observations: string;
      unresolved: string;
      systems: string;
    }>(
      `SELECT COUNT(DISTINCT s.id) AS systems, COUNT(DISTINCT n.id) AS nodes,
        COUNT(DISTINCT eo.id) AS observations,
        COUNT(DISTINCT n.id) FILTER (WHERE n.resolution_status <> 'resolved') AS unresolved
       FROM arc_graph.systems s LEFT JOIN arc_graph.nodes n ON n.system_id = s.id
       LEFT JOIN arc_graph.edge_observations eo ON eo.source_node_id = n.id ${filter}`,
      params,
    );
    const row = result.rows[0];
    return {
      nodes: Number(row?.nodes ?? 0),
      observations: Number(row?.observations ?? 0),
      systems: Number(row?.systems ?? 0),
      unresolved: Number(row?.unresolved ?? 0),
    };
  }

  async packageCoupling(
    systemKey: string,
    kinds?: RelationKind[],
    limit = 50,
  ): Promise<Array<Record<string, unknown>>> {
    const normalized = normalizeNodeRef({ systemKey, type: 'SYSTEM', name: systemKey }).systemKey;
    const effectiveKinds = kinds?.length ? kinds : null;
    const result = await this.executor.query<{
      observation_count: string;
      source_package: string;
      target_package: string;
    }>(
      `SELECT sn.package_name AS source_package, tn.package_name AS target_package,
        COUNT(*) AS observation_count
       FROM arc_graph.edge_observations eo
       JOIN arc_graph.nodes sn ON sn.id = eo.source_node_id
       JOIN arc_graph.nodes tn ON tn.id = eo.target_node_id
       JOIN arc_graph.systems s ON s.id = sn.system_id
       WHERE s.system_key = $1 AND sn.package_name <> '' AND tn.package_name <> ''
         AND sn.package_name <> tn.package_name AND eo.relation_kind <> 'belongs_to'
         AND ($2::text[] IS NULL OR eo.relation_kind = ANY($2::text[]))
       GROUP BY sn.package_name, tn.package_name
       ORDER BY observation_count DESC, source_package, target_package LIMIT $3`,
      [normalized, effectiveKinds, limit],
    );
    return result.rows.map((row) => ({
      observationCount: Number(row.observation_count),
      sourcePackage: row.source_package,
      targetPackage: row.target_package,
    }));
  }
}
