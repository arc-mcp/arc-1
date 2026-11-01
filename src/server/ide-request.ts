/** Request-local presentation preferences. Never use these values for SAP routing or authorization. */
import { SAP_SYSID_PATTERN } from './multi-target-identity.js';
import type { ServerConfig } from './types.js';

export const IDE_CLIENT_HEADER = 'arc1-ide-client';
/** Server-selected public target and SID, never a caller-supplied selector. */
export interface IdeLinkContext {
  readonly target?: string;
  readonly style: 'eclipse';
  readonly systemId: string;
}
type Headers = Record<string, string | string[] | undefined>;

/** Only this request opts in. Client names/User-Agent/initialize are not reliable client identity. */
export function resolveHttpIdeContext(config: ServerConfig, headers?: Headers): IdeLinkContext | undefined {
  if (config.transport !== 'http-streamable' || config.ideLinks !== 'eclipse') return undefined;
  if (config.multiTargetEndpoints && !config.targetId) return undefined;
  if (headers?.[IDE_CLIENT_HEADER] !== 'eclipse' || !SAP_SYSID_PATTERN.test(config.ideSystemId)) return undefined;
  return { style: 'eclipse', systemId: config.ideSystemId, target: config.targetId };
}
