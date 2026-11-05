/** Reviewed mutation surface; independent of tool advertisement and general single-target schemas. */
import { hasExplicitUnrestrictedRequestPolicy } from '../adt/allowlist-policy.js';
import { isMutatingOperationType, isOperationAllowed, OperationType } from '../adt/safety.js';
import { ACTION_POLICY } from '../authz/policy.js';
import { normalizeObjectType, stripLlmEmptyValues } from '../handlers/object-types.js';
import { SAPWRITE_TYPES_BTP } from '../handlers/tool-registry.js';
import { isActionDenied } from './deny-actions.js';
import {
  type PinnedCompanionCapability,
  type PinnedMutationCapability,
  pinnedCompanionCapability,
  pinnedCompanionToolSurface,
  pinnedMutationCapability,
  pinnedMutationToolSurface,
} from './pinned-mutation-capabilities.js';
import { pinnedRepositoryFields } from './pinned-repository-input.js';
import { PINNED_RUNTIME_CANDIDATES, PINNED_RUNTIME_COMPANION_CANDIDATES } from './pinned-runtime-candidates.js';
import type { ServerConfig } from './types.js';

export function pinnedWriteEnabled(config: ServerConfig): boolean {
  return config.allowWrites && config.multiTargetWrite?.enabled === true && config.ppEnabled && config.ppStrict;
}

function inapplicableFunctionFields(args: Record<string, unknown>, action: unknown): string[] {
  const createsFunction = action === 'create' && normalizeObjectType(String(args.type ?? '')) === 'FUNC';
  return ['processingType', 'updateTaskKind'].filter(
    (field) =>
      args[field] !== undefined &&
      (!createsFunction || (field === 'updateTaskKind' && args.processingType !== 'update')),
  );
}

/** Field check only, never admission. Preserve meaningful raw inputs before legacy normalization drops them. */
export function pinnedUnsupportedRawFields(tool: string, action: unknown, args: Record<string, unknown>): string[] {
  const selected = action ?? (tool === 'SAPActivate' ? 'activate' : undefined);
  const capability = pinnedMutationCapability(tool, selected) ?? pinnedCompanionCapability(tool, selected);
  if (!capability) return []; // The invocation gate independently refuses unadmitted mutations.
  const cleaned = stripLlmEmptyValues(args);
  const nativeInput = {
    ...cleaned,
    ...(cleaned.type === undefined ? {} : { type: normalizeObjectType(String(cleaned.type)) }),
  };
  const exactFields =
    tool === 'SAPWrite' && ['create', 'update', 'delete'].includes(String(selected))
      ? (pinnedRepositoryFields(nativeInput) ?? [])
      : capability.fields;
  const unsupported = Object.entries(cleaned)
    .filter(([key, value]) => value !== undefined && !exactFields.includes(key))
    .map(([key]) => key);
  // Legacy normalization removes inapplicable includes (for example on INTF). Validate the selector
  // while still present, so an unsupported selection cannot turn into a main-source write.
  if (
    tool === 'SAPWrite' &&
    cleaned.include !== undefined &&
    capability.fields.includes('include') &&
    !capability.accepts({ ...cleaned, type: normalizeObjectType(String(cleaned.type ?? '')) })
  )
    unsupported.push('include');
  if (
    tool === 'SAPManage' &&
    selected === 'set_api_state' &&
    cleaned.apiState === 'NOT_RELEASED' &&
    cleaned.apiVisibility !== undefined
  )
    unsupported.push('apiVisibility');
  if (tool === 'SAPWrite') {
    unsupported.push(...inapplicableFunctionFields(cleaned, selected));
    if (selected === 'batch_create' && Array.isArray(cleaned.objects))
      cleaned.objects.forEach((item, index) => {
        if (item && typeof item === 'object' && !Array.isArray(item))
          unsupported.push(
            ...inapplicableFunctionFields(item as Record<string, unknown>, 'create').map(
              (field) => `objects[${index}].${field}`,
            ),
          );
      });
  }
  return [...new Set(unsupported)];
}

/** The shared type registry narrows platform support; it never admits a new capability. */
function typeAvailable(tool: string, type: string, config: ServerConfig): boolean {
  return (
    config.systemType !== 'btp' ||
    (tool !== 'SAPWrite' && tool !== 'SAPActivate') ||
    SAPWRITE_TYPES_BTP.some((candidate) => candidate === type)
  );
}

function capabilityEnabled(capability: PinnedMutationCapability, config: ServerConfig): boolean {
  const policy = ACTION_POLICY[`${capability.tool}.${capability.action}`];
  return (
    !!policy &&
    isMutatingOperationType(policy.opType) &&
    isOperationAllowed(config, policy.opType) &&
    !(policy.featureGate === 'flp' && config.featureFlp === 'off') &&
    !(
      capability.tool === 'SAPWrite' &&
      capability.action === 'edit_text_symbols' &&
      isActionDenied('SAPActivate', 'activate', config.denyActions)
    ) &&
    (!capability.types || capability.types.some((type) => typeAvailable(capability.tool, type, config)))
  );
}

/** Public native-governed recording is distinct from private explicitly selected recording profiles. */
function publicRecordingEnabled(capability: PinnedMutationCapability, config: ServerConfig): boolean {
  return (
    !(capability.resource === 'flp' || ['publish_srvb', 'unpublish_srvb'].includes(capability.action)) ||
    (hasExplicitUnrestrictedRequestPolicy(config.multiTargetWrite?.allowedTransports) &&
      hasExplicitUnrestrictedRequestPolicy(config.multiTargetWrite?.serverAllowedTransports))
  );
}

/** Called on normalized arguments before Destination lookup. Schema construction may omit type/name. */
export function pinnedMutationAllowed(tool: string, args: Record<string, unknown>, config: ServerConfig): boolean {
  if (!pinnedWriteEnabled(config)) return false;
  const action = args.action ?? (tool === 'SAPActivate' ? 'activate' : undefined);
  const capability = pinnedMutationCapability(tool, action);
  if (!capability || !capabilityEnabled(capability, config) || !publicRecordingEnabled(capability, config))
    return false;
  if (
    args.type !== undefined &&
    ((capability.types !== undefined && !capability.types.includes(args.type as string)) ||
      !typeAvailable(tool, args.type as string, config))
  )
    return false;
  if (Object.entries(args).some(([key, value]) => value !== undefined && !capability.fields.includes(key)))
    return false;
  return capability.accepts(Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)));
}

export function pinnedMutationSurface(tool: string, config: ServerConfig) {
  const surface = pinnedWriteEnabled(config)
    ? pinnedMutationToolSurface(
        tool,
        (capability) => capabilityEnabled(capability, config) && publicRecordingEnabled(capability, config),
      )
    : undefined;
  return surface ? { ...surface, types: surface.types.filter((type) => typeAvailable(tool, type, config)) } : undefined;
}

function companionEnabled(capability: PinnedCompanionCapability, config: ServerConfig): boolean {
  const policy = ACTION_POLICY[`${capability.tool}.${capability.action}`];
  return (
    !!policy &&
    policy.scope === 'read' &&
    (policy.opType === OperationType.Read || policy.opType === OperationType.Intelligence) &&
    isOperationAllowed(config, policy.opType) &&
    !(policy.featureGate === 'flp' && config.featureFlp === 'off')
  );
}

/**
 * Internal runtime-profile decision. Public routing adds its token/platform and native-governed
 * recording checks separately; explicitly selected internal recording profiles remain distinct.
 */
export function pinnedRuntimeCandidateAllowed(
  tool: string,
  args: Record<string, unknown>,
  config: ServerConfig,
): boolean {
  if (!pinnedWriteEnabled(config) || isActionDenied(tool, String(args.action ?? ''), config.denyActions)) return false;
  const mutation = PINNED_RUNTIME_CANDIDATES.find((row) => row.tool === tool && row.action === args.action);
  const companion = PINNED_RUNTIME_COMPANION_CANDIDATES.find((row) => row.tool === tool && row.action === args.action);
  const row = mutation ?? companion;
  if (!row || Object.entries(args).some(([key, value]) => value !== undefined && !row.fields.includes(key)))
    return false;
  return (mutation ? capabilityEnabled(mutation, config) : companionEnabled(row, config)) && row.accepts(args);
}

export function pinnedCompanionAllowed(tool: string, args: Record<string, unknown>, config: ServerConfig): boolean {
  if (!pinnedWriteEnabled(config)) return false;
  const capability = pinnedCompanionCapability(tool, args.action);
  if (!capability || !companionEnabled(capability, config)) return false;
  if (Object.entries(args).some(([key, value]) => value !== undefined && !capability.fields.includes(key)))
    return false;
  return capability.accepts(Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)));
}

export function pinnedCompanionSurface(tool: string, config: ServerConfig) {
  return pinnedWriteEnabled(config)
    ? pinnedCompanionToolSurface(tool, (capability) => companionEnabled(capability, config))
    : undefined;
}
