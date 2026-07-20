import { getActionPolicy, hasRequiredScope } from '../authz/policy.js';
import type { ToolDefinition } from '../handlers/tools.js';
import { isActionDenied } from './deny-actions.js';

/**
 * Prune a tool's action or type enum based on the user's scopes and the server deny list.
 * SAPRead uses `type`; action-bearing tools use `action`.
 */
function pruneToolByPolicy(tool: ToolDefinition, scopes: string[], denyActions: string[]): ToolDefinition {
  const schema = tool.inputSchema as Record<string, unknown>;
  const properties = (schema.properties as Record<string, unknown> | undefined) ?? {};
  const enumField = tool.name === 'SAPRead' ? 'type' : 'action';
  const enumDef = (properties[enumField] as Record<string, unknown> | undefined) ?? {};
  const enumValues = Array.isArray(enumDef.enum) ? enumDef.enum.map(String) : null;

  if (!enumValues) return tool;

  const filtered = enumValues.filter((value) => {
    const policy = getActionPolicy(tool.name, value);
    if (!policy) return true;
    return hasRequiredScope(scopes, policy.scope) && !isActionDenied(tool.name, value, denyActions);
  });

  return {
    ...tool,
    inputSchema: {
      ...schema,
      properties: {
        ...properties,
        [enumField]: {
          ...enumDef,
          enum: filtered,
        },
      },
    },
  };
}

function hasNonEmptyActionOrTypeEnum(tool: ToolDefinition): boolean {
  const schema = tool.inputSchema as Record<string, unknown>;
  const properties = (schema.properties as Record<string, unknown> | undefined) ?? {};
  const enumField = tool.name === 'SAPRead' ? 'type' : 'action';
  const enumDef = (properties[enumField] as Record<string, unknown> | undefined) ?? {};
  return !Array.isArray(enumDef.enum) || enumDef.enum.length > 0;
}

/**
 * Filter tools by user scope and server deny list.
 *
 * A tool remains visible when its tool-level scope is satisfied, or when at least one of its
 * actions/types is allowed. Its enum is then narrowed to the entries the caller can invoke, and
 * tools with an empty enum are removed.
 */
export function filterToolsByAuthScope(
  tools: ToolDefinition[],
  scopes: string[],
  denyActions: string[] = [],
): ToolDefinition[] {
  return tools
    .filter((tool) => {
      if (isActionDenied(tool.name, undefined, denyActions)) return false;

      const toolPolicy = getActionPolicy(tool.name);
      if (toolPolicy && !hasRequiredScope(scopes, toolPolicy.scope)) {
        const schema = tool.inputSchema as Record<string, unknown>;
        const properties = (schema.properties as Record<string, unknown> | undefined) ?? {};
        const enumField = tool.name === 'SAPRead' ? 'type' : 'action';
        const enumDef = (properties[enumField] as Record<string, unknown> | undefined) ?? {};
        const enumValues = Array.isArray(enumDef.enum) ? enumDef.enum.map(String) : null;
        if (!enumValues) return false;

        const anyAllowed = enumValues.some((value) => {
          const policy = getActionPolicy(tool.name, value);
          return policy && hasRequiredScope(scopes, policy.scope) && !isActionDenied(tool.name, value, denyActions);
        });
        if (!anyAllowed) return false;
      }
      return true;
    })
    .map((tool) => pruneToolByPolicy(tool, scopes, denyActions))
    .filter(hasNonEmptyActionOrTypeEnum);
}
