import { z } from 'zod';
import type { ToolDefinition } from '../handlers/tools.js';
import { GRAPH_ACTIONS, graphInputSchema } from './contract.js';

export function graphToolDefinition(): ToolDefinition {
  const schema = z.toJSONSchema(graphInputSchema, { io: 'input' });
  // Runtime retains all validation/defaults. Omit repetitive regex/default annotations from
  // the model surface; keep every field, enum and size bound. MCP defaults to draft 2020-12.
  delete schema.$schema;
  for (const property of Object.values(schema.properties ?? {})) {
    if (typeof property === 'object' && property) {
      delete property.pattern;
      delete property.default;
    }
  }
  return {
    name: 'SAPGraph',
    description:
      'Indexed metadata, not live SAP authorization. Check coverage/limits; missing evidence is not no dependency. impact = potential callers; SAPRead = live source.',
    inputSchema: schema as ToolDefinition['inputSchema'],
  };
}

export function addGraphTool(tools: ToolDefinition[], hyperfocused: boolean): ToolDefinition[] {
  if (!hyperfocused) return [...tools, graphToolDefinition()];
  return tools.map((tool) => {
    if (tool.name !== 'SAP') return tool;
    const schema = structuredClone(tool.inputSchema);
    const action = (schema.properties as Record<string, unknown> | undefined)?.action as
      | { enum?: string[] }
      | undefined;
    action?.enum?.push('graph');
    return {
      ...tool,
      inputSchema: schema,
      description: `${tool.description} Optional graph: params.action=${GRAPH_ACTIONS.join('|')}; indexed metadata, not live SAP authorization.`,
    };
  });
}
