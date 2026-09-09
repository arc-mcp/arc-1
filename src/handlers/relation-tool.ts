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
  tool.description =
    'Experimental relations: start here for CLAS/INTF dependency maps or package neighborhoods, then read selected sources. For class-only consumers or tiny incoming samples prefer references with objectType="CLAS/OC". Live active metadata, not source-call/runtime proof. Coverage unknown. type+name required, no uri/source. ' +
    tool.description;
  properties.type!.description += ' relations: CLAS/INTF roots only; DDIC nodes remain unexpanded boundaries.';
  properties.direction = {
    type: 'string',
    enum: ['incoming', 'outgoing'],
    description: 'relations only: incoming=users of root; outgoing=dependencies (default).',
  };
  properties.depth = {
    type: 'integer',
    minimum: 1,
    maximum: 3,
    description: 'relations only: native steps (default 1), not proven source-call hops.',
  };
  properties.expandPackages = {
    type: 'array',
    maxItems: 8,
    items: { type: 'string', minLength: 1, maxLength: 120, pattern: '^(?:/[A-Za-z0-9_]+/)?[A-Za-z0-9_$]+$' },
    description:
      'relations only: exact packages to expand beyond root; others remain visible boundaries. Not an access-control filter.',
  };
  properties.maxResults!.description +=
    ' relations: node limit including root (default 50, integer 1–100); hard limits may stop earlier.';
}
