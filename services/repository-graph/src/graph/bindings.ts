import { z } from 'zod';

export function selectedBinding(env: NodeJS.ProcessEnv, name: string): Record<string, unknown> {
  try {
    if ((env.VCAP_SERVICES?.length ?? 0) > 1_000_000) throw new Error();
    const services = JSON.parse(env.VCAP_SERVICES ?? '{}') as Record<string, unknown>;
    const matches = Object.values(services)
      .flatMap((value) => (Array.isArray(value) ? value : []))
      .filter((value) => value?.name === name);
    if (matches.length !== 1 || !matches[0].credentials || typeof matches[0].credentials !== 'object')
      throw new Error();
    return matches[0].credentials as Record<string, unknown>;
  } catch {
    throw new Error('Invalid or ambiguous graph service binding');
  }
}

const credentialsSchema = z
  .object({
    host: z.string().min(1).optional(),
    hostname: z.string().min(1).optional(),
    port: z.coerce.number().int().min(1).max(65535),
    dbname: z.string().min(1).optional(),
    database: z.string().min(1).optional(),
    username: z.string().min(1).optional(),
    user: z.string().min(1).optional(),
    password: z.string().min(1),
    sslcert: z.string().min(1).optional(),
  })
  .passthrough();

export function boundPgConfig(env: NodeJS.ProcessEnv, name: string) {
  try {
    const c = credentialsSchema.parse(selectedBinding(env, name));
    const host = c.host ?? c.hostname;
    const database = c.dbname ?? c.database;
    const user = c.username ?? c.user;
    if (!host || !database || !user || /[\s/@]/.test(host)) throw new Error();
    return {
      host,
      database,
      user,
      port: c.port,
      password: c.password,
      ssl: { rejectUnauthorized: true, ...(c.sslcert ? { ca: c.sslcert } : {}) },
    };
  } catch {
    throw new Error('Invalid graph PostgreSQL binding');
  }
}
