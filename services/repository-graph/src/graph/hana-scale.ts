import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import type { Statement } from '@sap/hana-client';
import { hanaStorage } from './storage.js';
import { HanaGraphStore } from './store/hana.js';
import { type HanaSession, withHanaSession } from './store/hana-connection.js';
import { validateTraversalOptions } from './types.js';

export function scaleConfig(env = process.env) {
  if (env.ARC_GRAPH_HANA_BOOTSTRAP === 'true') throw new Error('Bootstrap credentials cannot run sizing experiments');
  const systemKey = env.ARC_GRAPH_SCALE_SYSTEM_KEY ?? '';
  const nodes = Number(env.ARC_GRAPH_SCALE_NODES ?? 1000);
  const fanout = Number(env.ARC_GRAPH_SCALE_FANOUT ?? 10);
  if (env.ARC_GRAPH_SCALE_CONFIRM !== 'synthetic-metadata-only' || !/^SCALE-[A-Z0-9_-]{1,55}$/.test(systemKey))
    throw new Error('Explicit synthetic confirmation and separate SCALE- key required');
  if (
    !Number.isInteger(nodes) ||
    nodes < 1000 ||
    nodes > 100000 ||
    !Number.isInteger(fanout) ||
    fanout < 1 ||
    fanout > 10
  )
    throw new Error('Scale bounds: 1000..100000 nodes and 1..10 observations per node');
  let a = 7919;
  let b = nodes;
  while (b) [a, b] = [b, a % b];
  return { systemKey, nodes, fanout, stride: a === 1 ? 7919 : 1 };
}

function batchError(error: Error & { code?: number }) {
  return new Error(`HANA operation failed${Number.isInteger(error.code) ? ` (${error.code})` : ''}`);
}

/** Bounded native SYNTHETIC seed, deliberately not a measurement of live collector throughput. */
export async function seedHanaScale(s: HanaSession, env = process.env, progress?: (nodesProcessed: number) => void) {
  const { systemKey, nodes, fanout, stride } = scaleConfig(env);
  s.connection.setAutoCommit(false);
  await s.exec('SET TRANSACTION LOCK WAIT TIMEOUT 1000');
  await s.exec('UPDATE COLLECTOR_LOCK SET REVISION = REVISION + 1 WHERE ID = 1');
  try {
    const existing = await s.exec<Array<{ N: number }>>('SELECT COUNT(*) AS N FROM NODES WHERE SYSTEM_KEY = ?', [
      systemKey,
    ]);
    if (Number(existing[0]?.N) !== 0) throw new Error('Synthetic key already populated or count unavailable');
    // Only bounded integers enter SQL text; identities remain bound parameters.
    await s.exec(
      `INSERT INTO NODES(SYSTEM_KEY, OBJECT_TYPE, OBJECT_NAME, PACKAGE_NAME, DESCRIPTION, RESOLUTION_STATUS)
      SELECT ?, 'CLAS', 'ZSCALE_' || LPAD(TO_NVARCHAR(GENERATED_PERIOD_START), 7, '0'),
        'ZSCALE_' || LPAD(TO_NVARCHAR(MOD(GENERATED_PERIOD_START - 1, 100)), 3, '0'), '', 'resolved'
      FROM SERIES_GENERATE_INTEGER(1, 1, ${nodes + 1})`,
      [systemKey],
    );
    // Avoid an expensive expression-join plan: map the bounded synthetic inventory once,
    // then bind at most 5,000 observations per native batch within the same transaction.
    const ids = await s.exec<Array<{ ID: number; OBJECT_NAME: string }>>(
      "SELECT ID, OBJECT_NAME FROM NODES WHERE SYSTEM_KEY = ? AND OBJECT_TYPE = 'CLAS' ORDER BY OBJECT_NAME",
      [systemKey],
    );
    assert.equal(ids.length, nodes);
    for (let n = 0; n < ids.length; n++) {
      assert.ok(Number.isSafeInteger(Number(ids[n]!.ID)));
      assert.equal(ids[n]!.OBJECT_NAME, `ZSCALE_${String(n + 1).padStart(7, '0')}`);
    }
    const statement = await new Promise<Statement>((resolve, reject) => {
      s.connection.prepare(
        "INSERT INTO EDGE_OBSERVATIONS(SOURCE_NODE_ID, TARGET_NODE_ID, RELATION_KIND, EVIDENCE_OWNER, EVIDENCE_METHOD, SOURCE_RESOURCE) VALUES (?, ?, 'references', 'synthetic-scale', 'generated-v1', ?)",
        (error, result) => {
          if (error) reject(batchError(error));
          else if (!result) reject(new Error('HANA operation failed'));
          else resolve(result);
        },
      );
    });
    try {
      for (let begin = 0; begin < nodes; begin += 500) {
        const end = Math.min(begin + 500, nodes);
        const rows: Array<Array<string | number>> = [];
        for (let n = begin; n < end; n++)
          for (let edge = 1; edge <= fanout; edge++)
            rows.push([
              Number(ids[n]!.ID),
              Number(ids[(n + edge * stride) % nodes]!.ID),
              `synthetic:${ids[n]!.OBJECT_NAME}`,
            ]);
        await new Promise<void>((resolve, reject) => {
          statement.execBatch<void>(rows, (error: Error | null) => (error ? reject(batchError(error)) : resolve()));
        });
        progress?.(end);
      }
    } finally {
      await new Promise<void>((resolve) => statement.drop(() => resolve()));
    }
    await s.exec('COMMIT');
  } catch (error) {
    await s.exec('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export function scaleFailureCode(error: unknown): string {
  if (error instanceof assert.AssertionError) return 'assertion';
  const message = error instanceof Error ? error.message : '';
  const code = /^HANA operation failed \((\d+)\)$/.exec(message)?.[1];
  return code ? `hana-${code}` : message === 'HANA operation deadline exceeded' ? 'deadline' : 'operation';
}

let stage = 'configuration';
async function main() {
  const config = scaleConfig();
  stage = 'baseline';
  const baseline = await hanaStorage();
  // This experiment never tries to fill a service. Require known, small pre-existing schema usage.
  if (baseline.diskBytes === null || baseline.diskBytes > 1_073_741_824)
    throw new Error('Scale test requires visible schema storage below 1 GiB');
  const started = performance.now();
  console.log(JSON.stringify({ event: 'hana-scale-started', config, baseline, at: new Date().toISOString() }));
  stage = 'seed';
  await withHanaSession(
    (s) =>
      seedHanaScale(s, process.env, (nodesProcessed) => {
        if (nodesProcessed % 10000 === 0 || nodesProcessed === config.nodes)
          console.log(
            JSON.stringify({ event: 'hana-scale-progress', nodesProcessed, elapsedMs: performance.now() - started }),
          );
      }),
    process.env,
    600000,
  );
  const seedMs = performance.now() - started;
  const store = new HanaGraphStore();
  try {
    stage = 'verify';
    const stats = await store.stats(config.systemKey);
    assert.equal(stats.nodes, config.nodes);
    assert.equal(stats.observations, config.nodes * config.fanout);
    console.log(
      JSON.stringify({ event: 'hana-scale-seeded', config, stats, seedMs, baseline, immediate: await hanaStorage() }),
    );
    const results = [];
    stage = 'traversal';
    for (const concurrency of [1, 3])
      for (const hops of [1, 3]) {
        const options = validateTraversalOptions({ direction: 'both', maxHops: hops, maxNodes: 100, maxEdges: 300 });
        const root = { systemKey: config.systemKey, type: 'CLAS', name: 'ZSCALE_0000001' };
        const representative = await store.traverse(root, options);
        assert.ok(representative.observations.length > 0);
        const times: number[] = [];
        for (let batch = 0; batch < 12 / concurrency; batch++)
          await Promise.all(
            Array.from({ length: concurrency }, async (_, i) => {
              const start = performance.now();
              const result = await store.traverse(
                { ...root, name: `ZSCALE_${String(batch * concurrency + i + 1).padStart(7, '0')}` },
                options,
              );
              assert.ok(result.nodes.length <= 100 && result.observations.length <= 300);
              times.push(performance.now() - start);
            }),
          );
        times.sort((a, b) => a - b);
        results.push({
          concurrency,
          hops,
          p50Ms: times[6],
          p95Ms: times[11],
          repetitions: times.length,
          returnedNodes: representative.nodes.length,
          returnedEdges: representative.observations.length,
          truncated: representative.truncated,
        });
      }
    console.log(
      JSON.stringify({
        event: 'hana-scale-complete',
        config,
        stats,
        seedMs,
        benchmark: results,
        baseline,
        storage: await hanaStorage(),
        at: new Date().toISOString(),
        warning:
          'Synthetic SQL seed, not live ingestion or a general HANA compression ratio. Recheck persistence after settling.',
      }),
    );
  } finally {
    await store.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(
      JSON.stringify({
        event: 'hana-scale-failed',
        stage,
        code: scaleFailureCode(error),
        message: 'No source or credentials logged; inspect last safe progress event',
      }),
    );
    process.exitCode = 1;
  });
