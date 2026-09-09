import { RELATION_ROOT_TYPES } from '../adt/relation-objects.js';
import { supportsRelations } from '../adt/repository-relations.js';
import { isActionDenied } from '../server/deny-actions.js';
import type { ServerConfig } from '../server/types.js';
import type { ToolDefinition } from './tools.js';

/** Capability projection. Unknown stays visible; invocation verifies support before object access. */
export function addLiveRelationsDefinition(
  tool: ToolDefinition,
  config: ServerConfig,
  discovery?: ReadonlyMap<string, string[]>,
) {
  if (
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
    'Experimental relations: dependency maps or package neighborhoods, then selected reads. For consumer locations use references: objectType="CLAS/OC" for class-only requests; otherwise omit. Active metadata, not source-call/runtime proof. Coverage unknown. type+name required, no uri/source. ' +
    tool.description;
  properties.type!.description += ` relations: ${RELATION_ROOT_TYPES.join('/')} (ENHO/XHB, ENHS/XSB only). TTYP=table type; MSAG=message class.`;
  properties.direction = {
    type: 'string',
    enum: ['incoming', 'outgoing'],
    description: 'relations: incoming=users; outgoing=dependencies (default).',
  };
  properties.depth = {
    type: 'integer',
    minimum: 1,
    maximum: 3,
    description: 'relations: native steps (default 1), not source-call hops.',
  };
  properties.expandPackages = {
    type: 'array',
    maxItems: 8,
    items: { type: 'string', minLength: 1, maxLength: 120, pattern: '^(?:/[A-Za-z0-9_]+/)?[A-Za-z0-9_$]+$' },
    description: 'relations: expand exact packages beyond root; others visible. Not authorization.',
  };
  properties.maxResults!.description += ' relations: node cap incl. root, 1–100 (default 50); may stop earlier.';
}
