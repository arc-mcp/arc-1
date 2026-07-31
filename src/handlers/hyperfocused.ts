/**
 * Hyperfocused mode — a single universal `SAP` tool (~200 tokens of schema).
 *
 * Instead of 12 intent-based tools (~14K tokens), hyperfocused mode exposes
 * a single `SAP` tool that routes to all operations via an `action` parameter.
 * This is useful for token-constrained scenarios (small context windows,
 * cost optimization, or when the LLM already knows the ARC-1 API).
 *
 * Activate with: --tool-mode hyperfocused or ARC1_TOOL_MODE=hyperfocused
 */

import type { ResolvedFeatures } from '../adt/types.js';
import { getActionPolicy } from '../authz/policy.js';
import type { ServerConfig } from '../server/types.js';
import { isGitToolVisible } from './tool-registry.js';
import type { ToolDefinition } from './tools.js';

/** Map hyperfocused action to the real tool name */
const ACTION_TO_TOOL: Record<string, string> = {
  read: 'SAPRead',
  search: 'SAPSearch',
  query: 'SAPQuery',
  write: 'SAPWrite',
  activate: 'SAPActivate',
  navigate: 'SAPNavigate',
  lint: 'SAPLint',
  diagnose: 'SAPDiagnose',
  transport: 'SAPTransport',
  git: 'SAPGit',
  context: 'SAPContext',
  manage: 'SAPManage',
};

/**
 * Get the required scope for a hyperfocused action.
 * Must stay consistent with ACTION_POLICY.
 */
export function getHyperfocusedScope(action: string): string {
  return getActionPolicy('SAP', action)?.scope ?? 'read';
}

/**
 * Resolve the real tool name from a hyperfocused action.
 */
export function resolveHyperfocusedTool(action: string): string | undefined {
  return ACTION_TO_TOOL[action];
}

/**
 * Expand hyperfocused args into the flat args format expected by the real handler.
 * Merges top-level type/name with params object. Top-level values take precedence.
 */
export function expandHyperfocusedArgs(args: Record<string, unknown>):
  | {
      toolName: string;
      expandedArgs: Record<string, unknown>;
    }
  | { error: string } {
  const action = String(args.action ?? '');
  const toolName = resolveHyperfocusedTool(action);

  if (!toolName) {
    const validActions = Object.keys(ACTION_TO_TOOL).join(', ');
    return { error: `Unknown action: "${action}". Valid actions: ${validActions}` };
  }

  // Merge params with top-level args (top-level takes precedence)
  const params = (args.params as Record<string, unknown>) ?? {};
  const expandedArgs: Record<string, unknown> = { ...params };

  // Copy standard top-level fields
  if (args.type !== undefined) expandedArgs.type = args.type;
  if (args.name !== undefined) expandedArgs.name = args.name;
  if (args.version !== undefined) expandedArgs.version = args.version;

  // For write/activate, copy action from params if not already set
  // (the real SAPWrite has its own "action" field like "create"/"update"/"delete")
  if (!expandedArgs.action && params.action) {
    expandedArgs.action = params.action;
  }

  return { toolName, expandedArgs };
}

/**
 * Get the hyperfocused tool definition (~200 tokens).
 */
export function getHyperfocusedToolDefinition(
  config: ServerConfig,
  resolvedFeatures?: ResolvedFeatures,
): ToolDefinition {
  const gitAvailable = isGitToolVisible(config, resolvedFeatures);
  // Mixed delegators stay visible when their read sub-actions are usable.
  // Mutating sub-actions are enforced downstream by the concrete tool policy.
  const readActions = [
    'read',
    'search',
    ...(config.allowFreeSQL ? ['query'] : []),
    'navigate',
    'context',
    'lint',
    'diagnose',
    ...(config.featureTransport === 'off' ? [] : ['transport']),
    ...(gitAvailable ? ['git'] : []),
    'manage',
  ];
  const writeActions = config.allowWrites ? ['write', 'activate'] : [];
  const allActions = [...readActions, ...writeActions];

  return {
    name: 'SAP',
    description:
      'Universal SAP tool. Actions: ' +
      allActions.join(', ') +
      '. Use "type" and "name" for object operations, "params" for additional tool-specific parameters.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: allActions,
          description: 'Operation to perform',
        },
        type: { type: 'string', description: 'Object or action type (e.g., CLAS, PROG, INTF, syntax, unittest)' },
        name: { type: 'string', description: 'Object name' },
        version: {
          type: 'string',
          enum: ['active', 'inactive', 'auto'],
          description: 'For read action: source version (active, inactive, auto)',
        },
        params: {
          type: 'object',
          description: 'Additional parameters (tool-specific). Merged with type/name.',
          additionalProperties: true,
        },
      },
      required: ['action'],
    },
  };
}
