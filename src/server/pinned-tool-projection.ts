import type { ToolDefinition } from '../handlers/tools.js';
import { compactPinnedWriteFields } from './pinned-field-descriptions.js';
import { PINNED_CLASS_INCLUDE_NAMES } from './pinned-mutation-capabilities.js';
import { PINNED_BATCH_CREATE_TYPES } from './pinned-repository-input.js';

export function projectPinnedRepositoryTool(
  tool: ToolDefinition,
  surface: { actions: string[]; types: string[]; fields: Set<string> },
): ToolDefinition {
  const write = tool.name === 'SAPWrite';
  const properties = Object.fromEntries(
    Object.entries(tool.inputSchema.properties as Record<string, unknown>).filter(([key]) => surface.fields.has(key)),
  );
  if (write && surface.fields.has('include'))
    properties.include = {
      type: 'string',
      enum: [...PINNED_CLASS_INCLUDE_NAMES],
      description:
        'CLAS local include for source replacement or supported method surgery; lock and package checks use the class owner.',
    };
  if (properties.expectedMetadataHash)
    properties.expectedMetadataHash = {
      type: 'string',
      pattern: '^[a-f0-9]{64}$',
      description:
        'Exact native metadata SHA-256 from SAPRead(format="editable"). Required for document/SRVB updates and publication; optional on partial DDIC merges. Null and blank supplied guards are refused.',
    };
  if (properties.expectedSourceHash)
    properties.expectedSourceHash = {
      type: 'string',
      pattern: '^[a-f0-9]{64}$',
      description:
        'SHA-256 from SAPRead(format="editable") on this exact native source/view. Required for existing source updates and surgery; omit for creates, deletes, text-pool replacement and absent optional class includes.',
    };
  if (properties.lintBeforeWrite)
    properties.lintBeforeWrite = {
      type: 'boolean',
      description:
        'Only scaffold_rap_handlers: apply its existing lint option. General pinned writes cannot bypass server lint.',
    };
  if (properties.transport)
    properties.transport = {
      type: 'string',
      description:
        'Allowed native Workbench request/task for transportable repository changes. Server and destination policies apply independently. Omit for local objects.',
    };
  if (write && properties.objects) {
    const objects = properties.objects as Record<string, unknown>;
    const items = objects.items as Record<string, unknown>;
    properties.objects = {
      ...objects,
      minItems: 1,
      maxItems: 10,
      items: {
        ...items,
        properties: {
          ...(items.properties as object),
          type: { type: 'string', enum: PINNED_BATCH_CREATE_TYPES.filter((type) => surface.types.includes(type)) },
        },
      },
    };
  } else if (properties.objects) properties.objects = { ...(properties.objects as object), minItems: 1, maxItems: 10 };
  if (write) compactPinnedWriteFields(properties);
  return {
    ...tool,
    description: pinnedRepositoryDescription(tool.name, surface.actions),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        ...properties,
        type: { type: 'string', enum: surface.types },
        action: { type: 'string', enum: surface.actions },
      },
      required: write ? ['action'] : [],
      additionalProperties: false,
    },
  };
}

export function pinnedRepositoryDescription(tool: string, actions: readonly string[]): string {
  const has = (...values: string[]) => values.some((value) => actions.includes(value));
  const notes = [
    `Pinned principal-propagation ${tool === 'SAPWrite' ? 'repository writes' : 'activation/publication'}. Exact input contracts and both package/request policies apply.`,
  ];
  if (tool === 'SAPWrite') {
    if (has('create', 'update')) notes.push('Native adapters preserve unknown fields; saves may remain inactive.');
    if (has('delete'))
      notes.push(
        'Deletion is owner-specific; generated/published SRVB cleanup and unsupported native variants are refused.',
      );
    if (has('edit_text_symbols'))
      notes.push('Text replacement activates the entire text pool and pending parts; CLAS supports symbols only.');
    if (has('scaffold_rap_handlers', 'generate_behavior_implementation'))
      notes.push('RAP uses guarded implementation/include writes; unsupported parser/native forms refuse.');
    if (has('batch_create'))
      notes.push(
        'batch_create: at most 10 inputs, 20 owners and 100 raw activation references. Group/document/server-driven creation is excluded from this batch profile.',
      );
    if (
      has(
        'edit_method',
        'edit_unit',
        'add_unit',
        'edit_class_definition',
        'edit_method_signature',
        'add_method',
        'delete_method',
        'change_method_visibility',
      )
    )
      notes.push('Surgery uses an editable hash and owning lock; signature/visibility edits use main source.');
  } else {
    if (has('activate'))
      notes.push(
        'Activate complete owners and their pending drafts, using shared preaudit and native confirmation. objects[] is bounded to 10 inputs/20 owners/100 raw references; unsupported group/document batch combinations and preaudit=false are refused.',
      );
    if (has('publish_srvb', 'unpublish_srvb'))
      notes.push(
        'Publication selects one SRVB name, version, service_type="odatav4" and expectedMetadataHash. Native-governed recording requires explicit * request policies on both sides and selected native platform evidence. Native acknowledgement is not universal frontend/alias verification or a CTS receipt.',
      );
  }
  notes.push('Partial/unknown outcomes never authorize automatic replay.');
  return notes.join(' ');
}
