/** Reviewed mutation surface; independent of tool advertisement and general single-target schemas. */
import { pinnedMutationCapability, pinnedMutationToolSurface } from './pinned-mutation-capabilities.js';
import type { ServerConfig } from './types.js';

export function pinnedWriteEnabled(config: ServerConfig): boolean {
  return config.allowWrites && config.multiTargetWrite?.enabled === true && config.ppEnabled && config.ppStrict;
}

/** Called on normalized arguments before Destination lookup. Schema construction may omit type/name. */
export function pinnedMutationAllowed(tool: string, args: Record<string, unknown>, config: ServerConfig): boolean {
  if (!pinnedWriteEnabled(config)) return false;
  const action = args.action ?? (tool === 'SAPActivate' ? 'activate' : undefined);
  const capability = pinnedMutationCapability(tool, action);
  if (!capability) return false;
  if (args.type !== undefined && !capability.types.includes(args.type as string)) return false;
  if (Object.entries(args).some(([key, value]) => value !== undefined && !capability.fields.includes(key)))
    return false;
  return capability.accepts(args);
}

export function pinnedMutationSurface(tool: string, config: ServerConfig) {
  return pinnedWriteEnabled(config) ? pinnedMutationToolSurface(tool) : undefined;
}
