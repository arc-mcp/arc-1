import type { Connection, ConnectionOptions } from '@sap/hana-client';
import { selectedBinding } from '../bindings.js';

export function hanaConfig(env: NodeJS.ProcessEnv = process.env): ConnectionOptions {
  if (!env.ARC_GRAPH_HANA_SERVICE_BINDING) throw new Error('Explicit HANA binding required');
  const credentials = selectedBinding(env, env.ARC_GRAPH_HANA_SERVICE_BINDING);
  const { host, user, password, schema } = credentials;
  if (
    typeof host !== 'string' ||
    !/^[a-zA-Z0-9.-]+$/.test(host) ||
    typeof user !== 'string' ||
    !/^[A-Z_][A-Z0-9_]{0,126}$/.test(user) ||
    typeof password !== 'string' ||
    !password ||
    (schema !== undefined && (typeof schema !== 'string' || !/^[A-Z_][A-Z0-9_]{0,126}$/.test(schema))) ||
    Number(credentials.port) !== 443
  )
    throw new Error('Invalid HANA graph credentials');
  if (user === 'DBADMIN' && env.ARC_GRAPH_HANA_BOOTSTRAP !== 'true')
    throw new Error('DBADMIN is forbidden for the graph runtime');
  return {
    serverNode: `${host}:443`,
    uid: user,
    pwd: password,
    encrypt: true,
    sslValidateCertificate: true,
    connectTimeout: 2000,
    ...(schema ? { currentSchema: schema } : {}),
  };
}

export class HanaSession {
  constructor(readonly connection: Connection) {}

  exec<T = Array<Record<string, unknown>>>(sql: string, parameters: Array<string | number | null> = []): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.connection.exec<T>(sql, parameters, (error, result) => {
        if (error) {
          // SQL errors can contain bound metadata/credentials. Expose only the numeric code.
          const code = (error as Error & { code?: number }).code;
          reject(new Error(`HANA operation failed${Number.isInteger(code) ? ` (${code})` : ''}`));
        } else resolve(result as T);
      });
    });
  }
}

export async function loadHanaDriver() {
  // The official native driver is CommonJS and exposes only `default` to Node ESM.
  return (await import('@sap/hana-client')).default;
}

export async function withHanaSession<T>(
  operation: (session: HanaSession) => Promise<T>,
  env: NodeJS.ProcessEnv = process.env,
  deadlineMs = 4500,
): Promise<T> {
  const config = hanaConfig(env);
  const { createConnection } = await loadHanaDriver();
  const connection = createConnection();
  let timer: NodeJS.Timeout | undefined;
  let expired = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      connection.abort(() => undefined);
      reject(new Error('HANA operation deadline exceeded'));
    }, deadlineMs);
  });
  try {
    return await Promise.race([
      timeout,
      (async () => {
        await new Promise<void>((resolve, reject) => {
          connection.connect(config, (error) => (error ? reject(new Error('HANA connection failed')) : resolve()));
        });
        if (expired) {
          connection.disconnect(() => undefined);
          throw new Error('HANA operation deadline exceeded');
        }
        return operation(new HanaSession(connection));
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    connection.disconnect(() => undefined);
  }
}
