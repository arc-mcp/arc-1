import { supportsRelations } from '../adt/repository-relations.js';
import { isActionDenied } from '../server/deny-actions.js';
import type { ServerConfig } from '../server/types.js';
import type { ToolDefinition } from './tools.js';

/** Pure opt-in projection. Unknown capability stays visible; invocation verifies it before use. */
export function addLiveRelationsDefinition(
  tool: ToolDefinition,
  config: ServerConfig,
  discovery?: ReadonlyMap<string, string[]>,
) {
  if (
    !config.liveRelations ||
    config.multiTargetEndpoints ||
    config.targetId ||
    config.toolMode !== 'standard' ||
    isActionDenied('SAPNavigate', 'relations', config.denyActions) ||
    (discovery?.size && !supportsRelations(discovery))
  )
    return;
  const properties = tool.inputSchema.properties as Record<string, Record<string, unknown>>;
  (properties.action!.enum as string[]).push('relations');
  tool.description +=
    ' Experimental relations: live active CLAS/INTF metadata network; requires type+name, no uri/source. Native coverage is unknown; not a complete call graph. No database or source collection.';
  properties.direction = {
    type: 'string',
    enum: ['incoming', 'outgoing'],
    description: 'relations only: objects using the root, or objects it uses (default outgoing).',
  };
  properties.depth = {
    type: 'integer',
    minimum: 1,
    maximum: 3,
    description: 'relations only: native expansion steps (default 1), not proven source-call hops.',
  };
  properties.expandPackages = {
    type: 'array',
    maxItems: 8,
    items: { type: 'string', minLength: 1, maxLength: 120, pattern: '^(?:/[A-Za-z0-9_]+/)?[A-Za-z0-9_$]+$' },
    description:
      'relations only: exact packages to expand beyond root. Other packages remain visible boundary nodes; not an access-control filter.',
  };
  properties.maxResults!.description +=
    ' relations: node limit including root (default 50, integer 1–100); hard limits may stop earlier.';
}
