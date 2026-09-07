import type { GraphStore } from './store.js';

export async function createGraphStore(env: NodeJS.ProcessEnv = process.env): Promise<GraphStore> {
  if (env.ARC_GRAPH_BACKEND === 'hana') {
    if (env.ARC_GRAPH_HANA_BOOTSTRAP === 'true') throw new Error('Bootstrap credentials cannot run the graph API');
    const { HanaGraphStore } = await import('./hana.js');
    return new HanaGraphStore(env);
  }
  if (env.ARC_GRAPH_BACKEND && env.ARC_GRAPH_BACKEND !== 'postgres') throw new Error('Unsupported graph backend');
  const { Pool } = await import('pg');
  const { graphPoolConfig } = await import('../config.js');
  const { PgGraphStore } = await import('./pg.js');
  return new PgGraphStore(new Pool(graphPoolConfig(env)));
}
