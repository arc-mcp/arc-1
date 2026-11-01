/** Reviewed mutation surface; independent of tool advertisement and general single-target schemas. */
import { isMutatingOperationType, isOperationAllowed, OperationType } from '../adt/safety.js';
import { ACTION_POLICY } from '../authz/policy.js';
import { stripLlmEmptyValues } from '../handlers/object-types.js';
import {
  type PinnedCompanionCapability,
  type PinnedMutationCapability,
  pinnedCompanionCapability,
  pinnedCompanionToolSurface,
  pinnedMutationCapability,
  pinnedMutationToolSurface,
} from './pinned-mutation-capabilities.js';
import type { ServerConfig } from './types.js';

export function pinnedWriteEnabled(config: ServerConfig): boolean {
  return config.allowWrites && config.multiTargetWrite?.enabled === true && config.ppEnabled && config.ppStrict;
}

/** Field check only, never admission. Preserve meaningful raw inputs before legacy normalization drops them. */
export function pinnedUnsupportedRawFields(tool: string, action: unknown, args: Record<string, unknown>): string[] {
  const selected = action ?? (tool === 'SAPActivate' ? 'activate' : undefined);
  const capability = pinnedMutationCapability(tool, selected) ?? pinnedCompanionCapability(tool, selected);
  if (!capability) return []; // The invocation gate independently refuses unadmitted mutations.
  return Object.entries(stripLlmEmptyValues(args))
    .filter(([key, value]) => value !== undefined && !capability.fields.includes(key))
    .map(([key]) => key);
}

function capabilityEnabled(capability: PinnedMutationCapability, config: ServerConfig): boolean {
  const policy = ACTION_POLICY[`${capability.tool}.${capability.action}`];
  return !!policy && isMutatingOperationType(policy.opType) && isOperationAllowed(config, policy.opType);
}

/** Called on normalized arguments before Destination lookup. Schema construction may omit type/name. */
export function pinnedMutationAllowed(tool: string, args: Record<string, unknown>, config: ServerConfig): boolean {
  if (!pinnedWriteEnabled(config)) return false;
  const action = args.action ?? (tool === 'SAPActivate' ? 'activate' : undefined);
  const capability = pinnedMutationCapability(tool, action);
  if (!capability || !capabilityEnabled(capability, config)) return false;
  if (args.type !== undefined && !capability.types?.includes(args.type as string)) return false;
  if (Object.entries(args).some(([key, value]) => value !== undefined && !capability.fields.includes(key)))
    return false;
  return capability.accepts(args);
}

export function pinnedMutationSurface(tool: string, config: ServerConfig) {
  return pinnedWriteEnabled(config)
    ? pinnedMutationToolSurface(tool, (capability) => capabilityEnabled(capability, config))
    : undefined;
}

function companionEnabled(capability: PinnedCompanionCapability, config: ServerConfig): boolean {
  const policy = ACTION_POLICY[`${capability.tool}.${capability.action}`];
  return (
    !!policy &&
    policy.scope === 'read' &&
    (policy.opType === OperationType.Read || policy.opType === OperationType.Intelligence) &&
    isOperationAllowed(config, policy.opType)
  );
}

export function pinnedCompanionAllowed(tool: string, args: Record<string, unknown>, config: ServerConfig): boolean {
  if (!pinnedWriteEnabled(config)) return false;
  const capability = pinnedCompanionCapability(tool, args.action);
  if (!capability || !companionEnabled(capability, config)) return false;
  if (Object.entries(args).some(([key, value]) => value !== undefined && !capability.fields.includes(key)))
    return false;
  return capability.accepts(args);
}

export function pinnedCompanionSurface(tool: string, config: ServerConfig) {
  return pinnedWriteEnabled(config)
    ? pinnedCompanionToolSurface(tool, (capability) => companionEnabled(capability, config))
    : undefined;
}
