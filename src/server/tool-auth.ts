import { getActionPolicy, hasRequiredScope } from '../authz/policy.js';
import { pruneQueryDefinition } from '../handlers/query-tool.js';
import type { ToolDefinition } from '../handlers/tools.js';
import { isActionDenied } from './deny-actions.js';

/**
 * Prune a tool's action or type enum based on the user's scopes and the server deny list.
 * SAPRead uses `type`; action-bearing tools use `action`.
 */
function pruneToolByPolicy(
  tool: ToolDefinition,
  scopes: string[],
  denyActions: string[],
  queryAvailable: boolean,
): ToolDefinition {
  const schema = tool.inputSchema as Record<string, unknown>;
  const properties = (schema.properties as Record<string, unknown> | undefined) ?? {};
  const enumField = tool.name === 'SAPRead' ? 'type' : 'action';
  const enumDef = (properties[enumField] as Record<string, unknown> | undefined) ?? {};
  const enumValues = Array.isArray(enumDef.enum) ? enumDef.enum.map(String) : null;

  if (!enumValues) return tool;

  const filtered = enumValues.filter((value) => {
    if (tool.name === 'SAP' && value === 'query' && !queryAvailable) return false;
    const policy = getActionPolicy(tool.name, value);
    if (!policy) return true;
    return hasRequiredScope(scopes, policy.scope) && !isActionDenied(tool.name, value, denyActions);
  });

  const pruned = {
    ...tool,
    ...(tool.name === 'SAP'
      ? {
          description: tool.description.replace(
            `Actions: ${enumValues.join(', ')}.`,
            `Actions: ${filtered.join(', ')}.`,
          ),
        }
      : {}),
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
  return pruneQueryDefinition(pruned, filtered);
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
  queryDefinition?: ToolDefinition,
): ToolDefinition[] {
  // The universal query delegator has no single scope: its enabled concrete actions
  // must also permit this caller. A missing configured definition fails closed.
  const queryProperties = queryDefinition?.inputSchema.properties as Record<string, unknown> | undefined;
  const queryActions = (queryProperties?.action as { enum?: unknown[] } | undefined)?.enum ?? [];
  const queryAvailable =
    queryDefinition?.name === 'SAPQuery' &&
    !isActionDenied('SAPQuery', undefined, denyActions) &&
    queryActions.some((value) => {
      const action = String(value);
      const policy = getActionPolicy('SAPQuery', action);
      return policy && hasRequiredScope(scopes, policy.scope) && !isActionDenied('SAPQuery', action, denyActions);
    });
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
    .map((tool) => pruneToolByPolicy(tool, scopes, denyActions, queryAvailable))
    .filter(hasNonEmptyActionOrTypeEnum);
}
