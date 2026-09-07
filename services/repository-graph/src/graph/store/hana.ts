import type { GraphResponse } from '../contract-v2.js';
import {
  type GraphEdge,
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
import { type HanaSession, withHanaSession } from './hana-connection.js';
import { validateGraphImport } from './import-validation.js';
import type { GraphStore } from './store.js';
import { selectShortestPath, traverseGraph } from './traversal.js';

type Row = Record<string, string | number | null>;
function mapNode(row: Row): GraphNode {
  return {
    id: Number(row.ID),
    systemKey: String(row.SYSTEM_KEY),
    type: String(row.OBJECT_TYPE),
    name: String(row.OBJECT_NAME),
    packageName: String(row.PACKAGE_NAME),
    description: String(row.DESCRIPTION),
    locator: row.LOCATOR === null ? null : String(row.LOCATOR),
    resolutionStatus: row.RESOLUTION_STATUS as GraphNode['resolutionStatus'],
  };
}
const marks = (values: unknown[]) => values.map(() => '?').join(',');

/** SQL-backed property graph with the same bounded traversal/response contract as PostgreSQL. */
export class HanaGraphStore implements GraphStore {
  constructor(
    private readonly env = process.env,
    private readonly session?: HanaSession,
    private readonly writing = false,
  ) {}

  async close(): Promise<void> {} // Connections are request-scoped and closed, never returned after a timeout.

  private async read<T>(operation: (session: HanaSession) => Promise<T>): Promise<T> {
    return this.session ? operation(this.session) : withHanaSession(operation, this.env);
  }

  async withSnapshot<T>(operation: (store: GraphStore) => Promise<T>): Promise<T> {
    if (this.session) return operation(this);
    return withHanaSession(async (session) => {
      session.connection.setAutoCommit(false);
      await session.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await session.exec('SET TRANSACTION READ ONLY');
      try {
        return await operation(new HanaGraphStore(this.env, session));
      } finally {
        await session.exec('ROLLBACK').catch(() => undefined);
      }
    }, this.env);
  }

  async ready(): Promise<{ migrationVersion: number }> {
    return this.read(async (session) => {
      const rows = await session.exec<Row[]>('SELECT COALESCE(MAX(VERSION), 0) AS VERSION FROM SCHEMA_MIGRATIONS');
      return { migrationVersion: Number(rows[0]?.VERSION ?? 0) };
    });
  }

  async coverage(systemKey: string): Promise<GraphResponse['coverage']> {
    return this.read(async (session) => {
      const rows = await session.exec<Row[]>(
        'SELECT TOP 1 ID, COMPLETED_AT, SCOPE_NAME, EXTRACTOR_VERSION, STATUS, COUNTERS FROM GENERATIONS WHERE SYSTEM_KEY = ? ORDER BY ID DESC',
        [systemKey],
      );
      const row = rows[0];
      const counters = row?.COUNTERS ? (JSON.parse(String(row.COUNTERS)) as Record<string, number>) : undefined;
      // HANA's TIMESTAMP is UTC here but returned without a time-zone suffix by the driver.
      const timestamp = row?.COMPLETED_AT ? `${String(row.COMPLETED_AT).replace(' ', 'T').replace(/Z$/, '')}Z` : null;
      return {
        status: !counters ? 'unknown' : row?.STATUS === 'complete' ? 'complete' : 'partial',
        generation: row ? String(row.ID) : null,
        asOf: timestamp ? new Date(timestamp).toISOString() : null,
        scope: row ? String(row.SCOPE_NAME) : null,
        extractorVersion: row ? String(row.EXTRACTOR_VERSION) : null,
        sourceCounts: {
          parsed: counters?.successfulSources ?? 0,
          failed: (counters?.failedReads ?? 0) + (counters?.failedParses ?? 0),
          partial: counters?.partialParses ?? 0,
          dynamicTargets: counters?.dynamicTargets ?? 0,
        },
      };
    });
  }

  async node(input: NodeRef): Promise<GraphNode | null> {
    const ref = normalizeNodeRef(input);
    return this.read(async (session) => {
      const rows = await session.exec<Row[]>(
        'SELECT * FROM NODES WHERE SYSTEM_KEY = ? AND OBJECT_TYPE = ? AND OBJECT_NAME = ?',
        [ref.systemKey, ref.type, ref.name],
      );
      return rows[0] ? mapNode(rows[0]) : null;
    });
  }

  async resolve(
    systemKey: string,
    type: string,
    name: string,
  ): Promise<{ status: 'found' | 'not_indexed' | 'ambiguous'; node?: GraphNode }> {
    const ref = normalizeNodeRef({ systemKey, type, name });
    return this.read(async (session) => {
      const rows = await session.exec<Row[]>(
        `SELECT TOP 2 * FROM NODES WHERE SYSTEM_KEY = ? AND OBJECT_NAME = ? AND (OBJECT_TYPE = ?${ref.type.includes('/') ? '' : " OR OBJECT_TYPE LIKE ? ESCAPE '\\'"})`,
        [
          ref.systemKey,
          ref.name,
          ref.type,
          ...(ref.type.includes('/') ? [] : [`${ref.type.replace(/[_%\\]/g, '\\$&')}/%`]),
        ],
      );
      if (rows.length > 1) return { status: 'ambiguous' };
      return rows[0] ? { status: 'found', node: mapNode(rows[0]) } : { status: 'not_indexed' };
    });
  }

  async search(systemKey: string, query: string, limit = 20): Promise<GraphNode[]> {
    if (!query.trim() || query.length > 255 || !Number.isInteger(limit) || limit < 1 || limit > 101)
      throw new Error('Invalid search bounds');
    const pattern = `%${query.toUpperCase().replace(/[_%\\]/g, '\\$&')}%`;
    return this.read(async (session) =>
      (
        await session.exec<Row[]>(
          `SELECT * FROM NODES WHERE SYSTEM_KEY = ? AND (UPPER(OBJECT_NAME) LIKE ? ESCAPE '\\' OR UPPER(DESCRIPTION) LIKE ? ESCAPE '\\' OR UPPER(PACKAGE_NAME) LIKE ? ESCAPE '\\')
       ORDER BY CASE WHEN OBJECT_NAME = ? THEN 0 ELSE 1 END, OBJECT_NAME, OBJECT_TYPE LIMIT ?`,
          [systemKey, pattern, pattern, pattern, query.toUpperCase(), limit],
        )
      ).map(mapNode),
    );
  }

  private async edges(frontier: number[], options: TraversalOptions, limit: number): Promise<GraphEdge[]> {
    if (!this.session || !frontier.length) throw new Error('HANA traversal requires a snapshot');
    const kinds = options.kinds ?? [];
    const filter = kinds.length ? ` AND RELATION_KIND IN (${marks(kinds)})` : '';
    const branches = options.direction === 'both' ? ['outgoing', 'incoming'] : [options.direction];
    const candidateRows: Row[] = [];
    for (const branch of branches) {
      const column = branch === 'outgoing' ? 'SOURCE_NODE_ID' : 'TARGET_NODE_ID';
      const other = branch === 'outgoing' ? 'TARGET_NODE_ID' : 'SOURCE_NODE_ID';
      const rows = await this.session.exec<Row[]>(
        `SELECT * FROM EDGE_OBSERVATIONS WHERE ${column} IN (${marks(frontier)})${filter} ORDER BY ${column}, RELATION_KIND, ${other}, ID LIMIT ?`,
        [...frontier, ...kinds, limit],
      );
      candidateRows.push(...rows);
    }
    const rows = candidateRows.slice(0, limit);
    const ids = [...new Set(rows.flatMap((row) => [Number(row.SOURCE_NODE_ID), Number(row.TARGET_NODE_ID)]))];
    const nodes = ids.length
      ? await this.session.exec<Row[]>(`SELECT * FROM NODES WHERE ID IN (${marks(ids)})`, ids)
      : [];
    const mapped = new Map(nodes.map((row) => [Number(row.ID), mapNode(row)]));
    return rows.map((row) => {
      const source = mapped.get(Number(row.SOURCE_NODE_ID));
      const target = mapped.get(Number(row.TARGET_NODE_ID));
      if (!source || !target) throw new Error('Missing graph node');
      return {
        id: Number(row.ID),
        source,
        target,
        relation: row.RELATION_KIND as RelationKind,
        evidenceOwner: String(row.EVIDENCE_OWNER),
        evidenceMethod: String(row.EVIDENCE_METHOD),
        sourceResource: String(row.SOURCE_RESOURCE),
      };
    });
  }

  async traverse(start: NodeRef, options: TraversalOptions): Promise<GraphTraversal> {
    if (!this.session) return this.withSnapshot((snapshot) => snapshot.traverse(start, options));
    const bounds = validateTraversalOptions(options);
    return traverseGraph(await this.node(start), bounds, (frontier, opts, limit) => this.edges(frontier, opts, limit));
  }

  async shortestPath(start: NodeRef, target: NodeRef, options: TraversalOptions): Promise<GraphTraversal> {
    return selectShortestPath(await this.traverse(start, options), start, target, options);
  }

  async packageCoupling(
    systemKey: string,
    kinds?: RelationKind[],
    limit = 50,
  ): Promise<Array<Record<string, unknown>>> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 101) throw new Error('Invalid coupling limit');
    const filter = kinds?.length ? ` AND E.RELATION_KIND IN (${marks(kinds)})` : '';
    return this.read(async (session) =>
      (
        await session.exec<Row[]>(
          `SELECT S.PACKAGE_NAME AS SOURCE_PACKAGE, T.PACKAGE_NAME AS TARGET_PACKAGE, COUNT(*) AS OBSERVATION_COUNT FROM EDGE_OBSERVATIONS E
       JOIN NODES S ON S.ID = E.SOURCE_NODE_ID JOIN NODES T ON T.ID = E.TARGET_NODE_ID
       WHERE S.SYSTEM_KEY = ? AND S.PACKAGE_NAME <> '' AND T.PACKAGE_NAME <> '' AND S.PACKAGE_NAME <> T.PACKAGE_NAME AND E.RELATION_KIND <> 'belongs_to'${filter}
       GROUP BY S.PACKAGE_NAME, T.PACKAGE_NAME ORDER BY OBSERVATION_COUNT DESC, SOURCE_PACKAGE, TARGET_PACKAGE LIMIT ?`,
          [systemKey, ...(kinds ?? []), limit],
        )
      ).map((row) => ({
        sourcePackage: String(row.SOURCE_PACKAGE),
        targetPackage: String(row.TARGET_PACKAGE),
        observationCount: Number(row.OBSERVATION_COUNT),
      })),
    );
  }

  async stats(systemKey?: string): Promise<Record<string, number>> {
    return this.read(async (session) => {
      const filter = systemKey ? ' WHERE SYSTEM_KEY = ?' : '';
      const params = systemKey ? [systemKey] : [];
      const nodes = await session.exec<Row[]>(
        `SELECT COUNT(*) AS NODES, COUNT(DISTINCT SYSTEM_KEY) AS SYSTEMS,
        SUM(CASE WHEN RESOLUTION_STATUS <> 'resolved' THEN 1 ELSE 0 END) AS UNRESOLVED FROM NODES${filter}`,
        params,
      );
      const edges = await session.exec<Row[]>(
        `SELECT COUNT(*) AS OBSERVATIONS FROM EDGE_OBSERVATIONS E JOIN NODES N ON N.ID = E.SOURCE_NODE_ID${filter}`,
        params,
      );
      return {
        nodes: Number(nodes[0]?.NODES ?? 0),
        systems: Number(nodes[0]?.SYSTEMS ?? 0),
        unresolved: Number(nodes[0]?.UNRESOLVED ?? 0),
        observations: Number(edges[0]?.OBSERVATIONS ?? 0),
      };
    });
  }

  async withCollectionLease<T>(_systemKey: string, operation: (store: HanaGraphStore) => Promise<T>): Promise<T> {
    if (this.writing) throw new Error('Nested HANA collection lease');
    // One schema/collector. Losing this connection rolls back every publication made under the lock.
    return withHanaSession(
      async (session) => {
        session.connection.setAutoCommit(false);
        await session.exec('SET TRANSACTION LOCK WAIT TIMEOUT 1000');
        await session.exec('UPDATE COLLECTOR_LOCK SET REVISION = REVISION + 1 WHERE ID = 1');
        try {
          const result = await operation(new HanaGraphStore(this.env, session, true));
          await session.exec('COMMIT');
          return result;
        } catch (error) {
          await session.exec('ROLLBACK').catch(() => undefined);
          throw error;
        }
      },
      this.env,
      600_000,
    );
  }

  async importGraph(input: GraphImport, replaceEvidence = false): Promise<{ nodes: number; observations: number }> {
    const systemKey = validateGraphImport(input);
    if (!this.writing) return this.withCollectionLease(systemKey, (store) => store.importGraph(input, replaceEvidence));
    if (!this.session) throw new Error('HANA writer session missing');
    const session = this.session;
    const ids = new Map<string, number>();
    const upsert = async (inputNode: GraphNodeInput) => {
      const ref = normalizeNodeRef(inputNode);
      const key = `${ref.type}\u0000${ref.name}`;
      const cached = ids.get(key);
      if (cached && inputNode.resolutionStatus === 'unresolved') return cached;
      let node = await this.node(ref);
      if (!node) {
        await session.exec(
          'INSERT INTO NODES(SYSTEM_KEY, OBJECT_TYPE, OBJECT_NAME, PACKAGE_NAME, DESCRIPTION, LOCATOR, RESOLUTION_STATUS) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [
            systemKey,
            ref.type,
            ref.name,
            inputNode.packageName?.trim().toUpperCase() ?? '',
            inputNode.description?.trim() ?? '',
            inputNode.locator ?? null,
            inputNode.resolutionStatus ?? 'resolved',
          ],
        );
        node = await this.node(ref);
      } else if ((inputNode.resolutionStatus ?? 'resolved') === 'resolved') {
        await session.exec(
          "UPDATE NODES SET PACKAGE_NAME = ?, DESCRIPTION = ?, LOCATOR = COALESCE(?, LOCATOR), RESOLUTION_STATUS = 'resolved' WHERE ID = ?",
          [
            inputNode.packageName?.trim().toUpperCase() ?? '',
            inputNode.description?.trim() ?? '',
            inputNode.locator ?? null,
            node.id,
          ],
        );
      }
      if (!node) throw new Error('HANA node insertion failed');
      ids.set(key, node.id);
      return node.id;
    };
    for (const node of input.nodes) await upsert(node);
    if (replaceEvidence) {
      const scopes = input.evidenceScopes ?? [
        ...new Map(
          input.observations.map((edge) => [`${edge.evidenceOwner}\u0000${edge.sourceResource}`, edge]),
        ).values(),
      ];
      for (const scope of scopes)
        await session.exec(
          'DELETE FROM EDGE_OBSERVATIONS WHERE SOURCE_NODE_ID IN (SELECT ID FROM NODES WHERE SYSTEM_KEY = ?) AND EVIDENCE_OWNER = ? AND SOURCE_RESOURCE = ?',
          [systemKey, scope.evidenceOwner, scope.sourceResource],
        );
    }
    for (const edge of input.observations) {
      const source = await upsert({ ...edge.source, resolutionStatus: 'unresolved' });
      const target = await upsert({ ...edge.target, resolutionStatus: 'unresolved' });
      const parameters = [source, target, edge.relation, edge.evidenceOwner, edge.evidenceMethod, edge.sourceResource];
      const existing = await session.exec<Row[]>(
        'SELECT ID FROM EDGE_OBSERVATIONS WHERE SOURCE_NODE_ID = ? AND TARGET_NODE_ID = ? AND RELATION_KIND = ? AND EVIDENCE_OWNER = ? AND EVIDENCE_METHOD = ? AND SOURCE_RESOURCE = ?',
        parameters,
      );
      if (!existing.length)
        await session.exec(
          'INSERT INTO EDGE_OBSERVATIONS(SOURCE_NODE_ID, TARGET_NODE_ID, RELATION_KIND, EVIDENCE_OWNER, EVIDENCE_METHOD, SOURCE_RESOURCE) VALUES (?, ?, ?, ?, ?, ?)',
          parameters,
        );
    }
    const report = input.collection ? collectionReportPayload(input.collection, systemKey) : undefined;
    await session.exec(
      'INSERT INTO GENERATIONS(SYSTEM_KEY, SCOPE_NAME, EXTRACTOR_VERSION, STATUS, COUNTERS) VALUES (?, ?, ?, ?, ?)',
      [
        systemKey,
        input.scope,
        input.extractorVersion,
        report?.status ?? 'complete',
        report ? JSON.stringify(report.counters) : null,
      ],
    );
    if (report) {
      const rows = await session.exec<Row[]>('SELECT MAX(ID) AS ID FROM GENERATIONS WHERE SYSTEM_KEY = ?', [systemKey]);
      await session.exec('INSERT INTO COLLECTION_JOBS(GENERATION_ID, CHECKPOINT) VALUES (?, ?)', [
        Number(rows[0]?.ID),
        JSON.stringify(report.checkpoint),
      ]);
    }
    return { nodes: input.nodes.length, observations: input.observations.length };
  }
}
