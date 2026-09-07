import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { collectLiveGraph } from '../collector/live-collector.js';
import { searchRepository } from '../inventory.js';
import { SapClient } from '../sap.js';
import { hanaStorage, pgStorage, walBytesBetween } from './storage.js';
import { HanaGraphStore } from './store/hana.js';
import { PgGraphStore } from './store/pg.js';
import type { GraphImport } from './types.js';

export function soakConfig(env = process.env) {
  if (env.ARC_GRAPH_HANA_BOOTSTRAP === 'true') throw new Error('Bootstrap credentials cannot run sizing experiments');
  const number = (key: string, fallback: number, max: number) => {
    const n = Number(env[key] ?? fallback);
    if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`Invalid ${key}`);
    return n;
  };
  const packages = (env.ARC_GRAPH_SOAK_PACKAGES ?? '').split(',').map((s) => s.trim().toUpperCase());
  if (!packages.length || packages.length > 20 || packages.some((s) => !/^[A-Z0-9_/$]+\*?$/.test(s)))
    throw new Error('Explicit bounded ARC_GRAPH_SOAK_PACKAGES required');
  const systemKey = env.ARC_GRAPH_SYSTEM_KEY ?? '';
  if (!/^SOAK-[A-Z0-9_-]{1,55}$/.test(systemKey)) throw new Error('Use a separate SOAK- system key');
  return {
    packages,
    systemKey,
    objects: number('ARC_GRAPH_SOAK_OBJECTS', 3000, 10000),
    passes: number('ARC_GRAPH_SOAK_PASSES', 2, 5),
    batches: number('ARC_GRAPH_SOAK_BATCHES', 100, 200),
    minutes: number('ARC_GRAPH_SOAK_MINUTES', 90, 180),
  };
}

/** Compare metadata content, excluding timestamps, generated IDs, input ordering and run counters. */
export function metadataFingerprint(input: GraphImport) {
  const stable = (values: unknown[]) => values.map((v) => JSON.stringify(v)).sort();
  return createHash('sha256')
    .update(
      JSON.stringify({
        nodes: stable(input.nodes),
        observations: stable(input.observations),
        scopes: stable(input.evidenceScopes ?? []),
      }),
    )
    .digest('hex');
}

/** Dedicated benchmark task only. Sequential comparison, NOT a production dual-write feature. */
export async function runSoak() {
  const config = soakConfig();
  const started = performance.now();
  const pg = new PgGraphStore();
  const hana = new HanaGraphStore();
  const emit = (event: string, data: object) =>
    console.log(JSON.stringify({ event, ...data, at: new Date().toISOString() }));
  const timeout = setTimeout(() => {
    emit('deadline', { minutes: config.minutes });
    process.exit(2);
  }, config.minutes * 60000);
  const sample = async () => ({ pg: await pgStorage(pg), hana: await hanaStorage() });
  try {
    // Refuse accidental mixing with a previous run. Repeated passes below deliberately reuse their own data.
    const existing = [await pg.stats(config.systemKey), await hana.stats(config.systemKey)];
    if (existing.some((s) => (s.nodes ?? 0) > 0)) throw new Error('Soak system key already contains data');
    const baseline = await sample();
    emit('baseline', { config, storage: baseline });
    const sap = await SapClient.create();
    const packages = new Set<string>();
    let discoveryRequests = 0;
    let planningSapRequests = 0;
    let discoveryCapped = false;
    try {
      for (const pattern of config.packages) {
        if (!pattern.endsWith('*')) {
          packages.add(pattern);
          continue;
        }
        const rows = await searchRepository(sap, pattern, 1000, 'DEVC');
        discoveryRequests++;
        if (rows.length >= 1000) discoveryCapped = true;
        for (const row of rows)
          if (row.type.startsWith('DEVC/') && row.name.startsWith(pattern.slice(0, -1))) packages.add(row.name);
      }
      emit('discovery', {
        packages: packages.size,
        discoveryRequests,
        discoveryCapped,
        transport: sap.transport,
        ...sap.metrics(),
      });
      planningSapRequests = sap.metrics().sapRequestAttempts;
    } finally {
      await sap.close();
    }
    const planned: Array<{ packageName: string; maximum: number; fingerprint: string }> = [];
    const unique = new Set<string>();
    let reads = 0;
    let downloadedBytes = 0;
    let attempts = planningSapRequests;
    let stableRefreshes = 0;
    let batches = 0;
    let firstPassStats: Record<string, number> | undefined;
    for (let pass = 1; pass <= config.passes; pass++) {
      const units =
        pass === 1
          ? [...packages].sort().map((packageName) => ({ packageName, maximum: 500, fingerprint: '' }))
          : planned;
      for (const unit of units) {
        if (pass === 1 && (unique.size >= config.objects || batches >= config.batches)) break;
        const maximum = pass === 1 ? Math.min(500, config.objects - unique.size) : unit.maximum;
        process.env.ARC_GRAPH_LIVE_PACKAGES = unit.packageName;
        process.env.ARC_GRAPH_LIVE_QUERY = '*';
        process.env.ARC_GRAPH_LIVE_MAX_OBJECTS = String(maximum);
        process.env.ARC_GRAPH_LIVE_CONCURRENCY = '2';
        let metadataBytes = 0;
        let fingerprint = '';
        let pgMs = 0;
        let hanaMs = 0;
        // Each database holds only its own per-batch lease; a failed second import is explicitly a failed run.
        const result = await collectLiveGraph(
          {
            importGraph: async (input, replace) => {
              metadataBytes = Buffer.byteLength(JSON.stringify(input));
              fingerprint = metadataFingerprint(input);
              for (const source of input.collection?.sources ?? []) unique.add(`${source.type}:${source.name}`);
              let begin = performance.now();
              const p = await pg.withCollectionLease(config.systemKey, (s) => s.importGraph(input, replace));
              pgMs = performance.now() - begin;
              begin = performance.now();
              await hana.importGraph(input, replace);
              hanaMs = performance.now() - begin;
              return p;
            },
          },
          'transient-source',
        );
        if (pass === 1 && result.discoveredObjects)
          planned.push({ packageName: unit.packageName, maximum, fingerprint });
        if (pass > 1 && fingerprint === unit.fingerprint) stableRefreshes++;
        batches++;
        reads += result.discoveredObjects;
        downloadedBytes += result.downloadedBytes;
        attempts += result.sapRequestAttempts;
        const { sourceOutcomes: _sources, ...counts } = result;
        emit('batch', {
          pass,
          batch: batches,
          packageName: unit.packageName,
          counts,
          metadataBytes,
          fingerprint,
          pgMs,
          hanaMs,
          stableContent: pass > 1 ? fingerprint === unit.fingerprint : null,
          uniqueObjects: unique.size,
          maxRssBytes: process.resourceUsage().maxRSS * 1024,
          rssBytes: process.memoryUsage().rss,
        });
      }
      const p = await pg.stats(config.systemKey);
      const h = await hana.stats(config.systemKey);
      for (const key of ['nodes', 'observations', 'unresolved'])
        if (p[key] !== h[key]) throw new Error('Database logical counts differ');
      if (pass === 1) firstPassStats = p;
      emit('pass', {
        pass,
        stats: { pg: p, hana: h },
        storage: await sample(),
        elapsedMs: performance.now() - started,
      });
    }
    if (!unique.size) throw new Error('No supported objects collected');
    const final = await sample();
    emit('summary', {
      systemKey: config.systemKey,
      uniqueObjects: unique.size,
      sourceReads: reads,
      downloadedBytes,
      sapRequestAttempts: attempts,
      batches,
      plannedBatches: planned.length,
      stableRefreshes,
      firstPassStats,
      finalStats: await pg.stats(config.systemKey),
      baseline,
      final,
      generatedClusterWalBytes: walBytesBetween(baseline.pg.walPosition, final.pg.walPosition),
      durationMs: performance.now() - started,
      maxRssBytes: process.resourceUsage().maxRSS * 1024,
      warning:
        'Bounded package sample, not full-system coverage. WAL generated is not WAL retained. HANA persistence can lag.',
    });
  } finally {
    clearTimeout(timeout);
    await Promise.all([pg.close(), hana.close()]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runSoak().catch(() => {
    console.error(JSON.stringify({ event: 'failed', message: 'Soak failed; inspect last safe progress event' }));
    process.exitCode = 1;
  });
}
