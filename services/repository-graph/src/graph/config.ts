import { readFileSync } from 'node:fs';
import type { PoolConfig } from 'pg';
import { boundPgConfig, selectedBinding } from './bindings.js';

function optionalSecret(fileSetting: string, valueSetting: string, env = process.env): string | undefined {
  const file = env[fileSetting]?.trim();
  if (file) return readFileSync(file, 'utf8').trim();
  return env[valueSetting]?.trim() || undefined;
}

export function graphPoolConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  const max = Number(env.ARC_GRAPH_PG_POOL_MAX ?? '5');
  if (!Number.isInteger(max) || max < 1 || max > 10) throw new Error('Graph pool size must be 1..10');
  const limits = {
    max,
    connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 10000,
    application_name: env.ARC_GRAPH_APPLICATION_NAME ?? 'arc-repository-graph',
    statement_timeout: env.ARC_GRAPH_APPLICATION_NAME === 'graph-api' ? 2000 : undefined,
  };
  if (env.ARC_GRAPH_PG_SERVICE_BINDING) return { ...boundPgConfig(env, env.ARC_GRAPH_PG_SERVICE_BINDING), ...limits };
  if (env.VCAP_APPLICATION) throw new Error('Cloud graph requires an explicitly selected PostgreSQL binding');
  return {
    ...limits,
    connectionString: env.ARC_GRAPH_DATABASE_URL,
    database: env.PGDATABASE ?? 'arc_graph',
    host: env.PGHOST ?? '127.0.0.1',
    password: optionalSecret('ARC_GRAPH_PG_PASSWORD_FILE', 'PGPASSWORD', env),
    port: Number.parseInt(env.PGPORT ?? '5432', 10),
    ssl: env.ARC_GRAPH_PG_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
    user: env.PGUSER ?? 'arc_graph_api',
  };
}

export function graphApiKeys(env = process.env): string[] {
  const binding = env.ARC_GRAPH_API_AUTH_BINDING;
  let candidates: unknown[];
  if (binding) {
    const credentials = selectedBinding(env, binding);
    if (credentials.apiKeys !== undefined && !Array.isArray(credentials.apiKeys))
      throw new Error('Invalid graph API credential binding');
    candidates = credentials.apiKeys === undefined ? [credentials.apiKey] : (credentials.apiKeys as unknown[]);
  } else {
    const fromFile = optionalSecret('ARC_GRAPH_API_KEY_FILE', 'ARC_GRAPH_API_KEY', env);
    candidates = [...(fromFile ? [fromFile] : []), ...(env.ARC_GRAPH_API_KEYS?.split(',') ?? [])];
  }
  if (
    candidates.length < 1 ||
    candidates.length > 2 ||
    candidates.some((key) => typeof key !== 'string' || !/^[\x21-\x7e]{32,4096}$/.test(key))
  )
    throw new Error(binding ? 'Invalid graph API credential binding' : 'One or two valid graph API keys required');
  return [...new Set(candidates as string[])];
}
