import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import type { ServerConfig } from '../server/types.js';

const descriptorSchema = z
  .object({
    version: z.literal(1),
    url: z.string().max(2048),
    systemKey: z.string().regex(/^[A-Z0-9][A-Z0-9._:-]{0,127}$/),
    audience: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
    sharing: z.literal('shared-repository-metadata'),
    apiKeyFile: z.string().optional(),
    apiKey: z.string().optional(),
    allowInsecureHttp: z.boolean().default(false),
  })
  .strict();
export interface GraphConnection {
  url: string;
  systemKey: string;
  audience: string;
  readKey: () => string;
}
export class GraphError extends Error {
  constructor(
    public readonly code:
      | 'not_configured'
      | 'invalid_connection'
      | 'unavailable'
      | 'unauthorized'
      | 'incompatible'
      | 'cancelled'
      | 'busy',
  ) {
    super(`Repository graph: ${code}`);
  }
}
function privateFile(path: string, maxBytes: number): string {
  if (!isAbsolute(path)) throw new GraphError('invalid_connection');
  const stat = statSync(path);
  if (
    !stat.isFile() ||
    stat.size > maxBytes ||
    (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())))
  )
    throw new GraphError('invalid_connection');
  return readFileSync(path, 'utf8');
}
export function graphConfigured(
  config: Pick<ServerConfig, 'graphMode' | 'graphConnectionFile' | 'graphServiceBinding'>,
): boolean {
  return config.graphMode !== 'off' && !!(config.graphConnectionFile || config.graphServiceBinding);
}
/** No service credentials are discovered implicitly. Keys never enter ServerConfig/diagnostics. */
export function resolveGraphConnection(config: ServerConfig, env: NodeJS.ProcessEnv = process.env): GraphConnection {
  if (!graphConfigured(config)) throw new GraphError('not_configured');
  try {
    if (config.multiTargetEndpoints) throw new GraphError('invalid_connection');
    let raw: unknown;
    if (config.graphConnectionFile) raw = JSON.parse(privateFile(config.graphConnectionFile, 16384));
    else {
      if ((env.VCAP_SERVICES?.length ?? 0) > 1_000_000) throw new GraphError('invalid_connection');
      const services = JSON.parse(env.VCAP_SERVICES ?? '{}') as Record<string, unknown>;
      const candidates = Object.values(services)
        .flatMap((group) => (Array.isArray(group) ? group : []))
        .filter((service) => service?.name === config.graphServiceBinding);
      if (candidates.length !== 1 || candidates[0].label !== 'user-provided')
        throw new GraphError('invalid_connection');
      raw = candidates[0].credentials;
    }
    const data = descriptorSchema.parse(raw);
    const url = new URL(data.url);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      !['https:', 'http:'].includes(url.protocol)
    )
      throw new GraphError('invalid_connection');
    if (
      url.protocol === 'http:' &&
      !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) &&
      !data.allowInsecureHttp
    )
      throw new GraphError('invalid_connection');
    if (!!data.apiKey === !!data.apiKeyFile || (config.graphConnectionFile && data.apiKey))
      throw new GraphError('invalid_connection');
    const readKey = () => {
      try {
        const key = data.apiKeyFile ? privateFile(data.apiKeyFile, 4096).trim() : (data.apiKey ?? '');
        if (!/^[\x21-\x7e]{32,4096}$/.test(key)) throw new GraphError('invalid_connection');
        return key;
      } catch {
        throw new GraphError('invalid_connection');
      }
    };
    readKey();
    return { url: url.origin, systemKey: data.systemKey, audience: data.audience, readKey };
  } catch {
    throw new GraphError('invalid_connection');
  }
}
