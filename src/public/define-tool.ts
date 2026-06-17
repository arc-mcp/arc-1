import type { PluginToolDefinition } from './types.js';

/**
 * Identity helper for authoring a plugin tool — returns the definition unchanged but validates
 * its shape eagerly (at module load) so authors get a clear error instead of a late runtime
 * failure or a silently-dropped tool. The registry enforces the same invariants at registration;
 * this is the friendly first line of defence.
 */
export function defineTool(def: PluginToolDefinition): PluginToolDefinition {
  if (!def || typeof def.name !== 'string' || !def.name.startsWith('Custom_')) {
    throw new Error(`defineTool: tool name must start with 'Custom_' (got '${def?.name}')`);
  }
  if (!def.description) {
    throw new Error(`defineTool: '${def.name}' needs a description`);
  }
  if (!def.schema) {
    throw new Error(`defineTool: '${def.name}' needs a Zod 'schema'`);
  }
  if (!def.policy?.scope || !def.policy.opType) {
    throw new Error(`defineTool: '${def.name}' needs policy.scope + policy.opType`);
  }
  if (typeof def.handler !== 'function') {
    throw new Error(`defineTool: '${def.name}' needs a 'handler' function`);
  }
  return def;
}
