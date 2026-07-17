/** MCP-call preparation and the SAPTargets catalog for multi-target v1. */

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { getActionPolicy, hasRequiredScope } from '../authz/policy.js';
import { toolJson } from '../handlers/shared.js';
import { generateRequestId } from './context.js';
import { isActionDenied } from './deny-actions.js';
import type { DestinationRegistry, TargetDescriptor } from './destination-registry.js';
import { logger } from './logger.js';
import type { McpRateLimiter } from './mcp-rate-limit.js';
import { resolveRateLimitUserKey } from './mcp-rate-limit.js';
import { buildMultiTargetConfig } from './multi-target-runtime.js';
import { invocationPolicyKey, multiTargetInvocationDecision, normalizeTarget } from './multi-target-tools.js';
import type { ServerConfig } from './types.js';

export const MULTI_TARGET_SERVER_INSTRUCTIONS = [
  'ARC-1 provides a read-only interface to configured SAP ABAP system/client targets.',
  'Every aggregate tool call requires an explicit target in SID/CLIENT form. Never assume, remember,',
  'or silently reuse a target from an earlier call. Call SAPTargets when it is available to list IDs',
  'and descriptive labels; a listed target does not prove the current user has SAP access.',
  'Data preview and SQL are available only where the instance, destination, user scope, and SAP all allow them.',
  'Writes, activation, transport/Git mutations, SAPLint, ATC, and ABAP Unit are unavailable in multi-target v1.',
].join('\n');

export interface MultiTargetServerOptions {
  mode: 'pinned' | 'aggregate';
  registry: DestinationRegistry;
  instanceConfig: ServerConfig;
  target?: TargetDescriptor;
}

type FailureStage = 'target_resolution_failed' | 'pp_exchange_failed' | 'target_policy_denied';

export type MultiTargetErrorBuilder = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
  stage?: FailureStage,
  target?: string,
) => Record<string, unknown>;

export type PreparedMultiTargetCall =
  | { handled: true; result: Record<string, unknown> }
  | {
      handled: false;
      args: Record<string, unknown>;
      activeConfig: ServerConfig;
      selectedTarget: TargetDescriptor;
      error: MultiTargetErrorBuilder;
      mcpRateLimitConsumed: boolean;
    };

export function structuredToolError(
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    content: [{ type: 'text' as const, text: toolJson({ error: code, message, ...extra }) }],
    isError: true,
  };
}

function createErrorBuilder(
  toolName: string,
  authInfo: AuthInfo | undefined,
  requestId: string,
  selectedTarget: () => TargetDescriptor | undefined,
): MultiTargetErrorBuilder {
  return (code, message, details = {}, stage, target) => {
    const resolvedTarget = target ?? selectedTarget()?.target;
    if (stage) {
      logger.emitAudit({
        timestamp: new Date().toISOString(),
        level: 'warn',
        event: stage,
        requestId,
        user: authInfo?.extra?.userName as string | undefined,
        clientId: authInfo?.clientId,
        target: resolvedTarget,
        tool: toolName,
        errorCode: code,
      });
    }
    return structuredToolError(code, message, {
      ...(resolvedTarget ? { target: resolvedTarget } : {}),
      requestId,
      retryable: false,
      ...details,
    });
  };
}

async function handleSapTargets(
  targets: readonly TargetDescriptor[],
  args: Record<string, unknown>,
  authInfo: AuthInfo | undefined,
  mcpRateLimiter?: McpRateLimiter,
): Promise<Record<string, unknown>> {
  const requestId = generateRequestId();
  const startedAt = Date.now();
  const user = resolveRateLimitUserKey(authInfo);
  logger.emitAudit({
    timestamp: new Date().toISOString(),
    level: 'info',
    event: 'tool_call_start',
    requestId,
    user,
    clientId: authInfo?.clientId,
    tool: 'SAPTargets',
    args: { query: typeof args.query === 'string' ? args.query : undefined },
  });
  if (mcpRateLimiter && authInfo) {
    const decision = await mcpRateLimiter.consume(user, 'SAPTargets');
    if (!decision.allowed) {
      logger.emitAudit({
        timestamp: new Date().toISOString(),
        level: 'warn',
        event: 'mcp_rate_limited',
        requestId,
        user,
        clientId: authInfo.clientId,
        tool: 'SAPTargets',
        limitPerMinute: decision.limitPerMinute,
        retryAfterMs: decision.retryAfterMs,
      });
      logger.emitAudit({
        timestamp: new Date().toISOString(),
        level: 'warn',
        event: 'tool_call_end',
        requestId,
        user,
        clientId: authInfo.clientId,
        tool: 'SAPTargets',
        durationMs: Date.now() - startedAt,
        status: 'error',
        errorClass: 'rate_limited',
      });
      return structuredToolError('rate_limited', 'Rate limit exceeded.', {
        requestId,
        retryAfter: Math.ceil(decision.retryAfterMs / 1000),
      });
    }
  }
  const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
  const listed = targets
    .filter(
      (target) =>
        !query || target.target.toLowerCase().includes(query) || target.description.toLowerCase().includes(query),
    )
    .map((target) => ({ target: target.target, description: target.description }));
  const text = toolJson(listed);
  logger.emitAudit({
    timestamp: new Date().toISOString(),
    level: 'info',
    event: 'tool_call_end',
    requestId,
    user,
    clientId: authInfo?.clientId,
    tool: 'SAPTargets',
    durationMs: Date.now() - startedAt,
    status: 'success',
    resultSize: text.length,
  });
  return { content: [{ type: 'text' as const, text }] };
}

async function consumePreparedRateLimit(args: {
  toolName: string;
  authInfo?: AuthInfo;
  mcpRateLimiter?: McpRateLimiter;
  requestId: string;
  target: TargetDescriptor;
  error: MultiTargetErrorBuilder;
}): Promise<{ allowed: true; consumed: boolean } | { allowed: false; result: Record<string, unknown> }> {
  const { toolName, authInfo, mcpRateLimiter, requestId, target, error } = args;
  if (!mcpRateLimiter || !authInfo) return { allowed: true, consumed: false };

  const user = resolveRateLimitUserKey(authInfo);
  const decision = await mcpRateLimiter.consume(user, toolName);
  if (decision.allowed) return { allowed: true, consumed: true };

  const startedAt = Date.now();
  logger.emitAudit({
    timestamp: new Date().toISOString(),
    level: 'info',
    event: 'tool_call_start',
    requestId,
    user,
    clientId: authInfo.clientId,
    target: target.target,
    tool: toolName,
    args: {},
  });
  logger.emitAudit({
    timestamp: new Date().toISOString(),
    level: 'warn',
    event: 'mcp_rate_limited',
    requestId,
    user,
    clientId: authInfo.clientId,
    target: target.target,
    tool: toolName,
    limitPerMinute: decision.limitPerMinute,
    retryAfterMs: decision.retryAfterMs,
  });
  logger.emitAudit({
    timestamp: new Date().toISOString(),
    level: 'warn',
    event: 'tool_call_end',
    requestId,
    user,
    clientId: authInfo.clientId,
    target: target.target,
    tool: toolName,
    durationMs: Date.now() - startedAt,
    status: 'error',
    errorClass: 'rate_limited',
  });
  const retryAfter = Math.ceil(decision.retryAfterMs / 1000);
  return {
    allowed: false,
    result: error(
      'rate_limited',
      `Rate limit exceeded (${decision.limitPerMinute}/min per user). Retry after ${retryAfter} seconds.`,
      { retryAfter, retryable: true },
    ),
  };
}

export async function prepareMultiTargetCall(args: {
  options: MultiTargetServerOptions;
  toolName: string;
  rawArgs: Record<string, unknown>;
  authInfo?: AuthInfo;
  mcpRateLimiter?: McpRateLimiter;
}): Promise<PreparedMultiTargetCall> {
  const { options, toolName, rawArgs, authInfo, mcpRateLimiter } = args;
  const requestId = generateRequestId();
  let selectedTarget: TargetDescriptor | undefined;
  const error = createErrorBuilder(toolName, authInfo, requestId, () => selectedTarget);

  if (!options.registry.available) {
    return {
      handled: true,
      result: error(
        'MULTI_TARGET_REGISTRY_UNAVAILABLE',
        'The multi-target registry is unavailable. An administrator can inspect GET /targets and the server logs.',
        {},
        'target_resolution_failed',
      ),
    };
  }
  if (options.mode === 'aggregate' && options.registry.targets.length === 0) {
    return {
      handled: true,
      result: error(
        'NO_TARGETS_CONFIGURED',
        'No multi-target destinations are configured. An administrator must add an enabled destination and restart ARC-1.',
        {},
        'target_resolution_failed',
      ),
    };
  }
  if (toolName === 'SAPTargets') {
    if (options.mode !== 'aggregate' || options.registry.targets.length <= 1) {
      return {
        handled: true,
        result: error('UNKNOWN_TOOL', 'SAPTargets is available only on aggregate endpoints with multiple targets.'),
      };
    }
    const catalogPolicy = getActionPolicy('SAPTargets');
    if (authInfo && catalogPolicy && !hasRequiredScope(authInfo.scopes, catalogPolicy.scope)) {
      logger.emitAudit({
        timestamp: new Date().toISOString(),
        level: 'warn',
        event: 'auth_scope_denied',
        requestId,
        user: authInfo.extra?.userName as string | undefined,
        clientId: authInfo.clientId,
        tool: 'SAPTargets',
        requiredScope: catalogPolicy.scope,
        availableScopes: authInfo.scopes,
      });
      return {
        handled: true,
        result: error(
          'INSUFFICIENT_SCOPE',
          `Scope '${catalogPolicy.scope}' is required for this operation. Sign in with the required ARC-1 role and try again.`,
        ),
      };
    }
    if (isActionDenied('SAPTargets', undefined, options.instanceConfig.denyActions)) {
      return {
        handled: true,
        result: error('MULTI_TARGET_OPERATION_FORBIDDEN', 'This operation is disabled by the ARC-1 instance policy.'),
      };
    }
    return {
      handled: true,
      result: await handleSapTargets(options.registry.targets, rawArgs, authInfo, mcpRateLimiter),
    };
  }

  let callArgs = rawArgs;
  if (options.mode === 'aggregate') {
    const normalized = normalizeTarget(rawArgs.target);
    if (!normalized.ok) {
      return { handled: true, result: error(normalized.code, normalized.message, {}, 'target_resolution_failed') };
    }
    selectedTarget = options.registry.get(normalized.target);
    if (!selectedTarget) {
      return {
        handled: true,
        result: error(
          'UNKNOWN_TARGET',
          `Target ${normalized.target} is not configured. Call SAPTargets and retry with one of its target IDs.`,
          {},
          'target_resolution_failed',
          normalized.target,
        ),
      };
    }
    callArgs = { ...rawArgs };
    delete callArgs.target;
  } else {
    selectedTarget = options.target;
  }
  if (!selectedTarget) {
    return {
      handled: true,
      result: error('UNKNOWN_TARGET', 'The selected target is not configured.', {}, 'target_resolution_failed'),
    };
  }

  const activeConfig = buildMultiTargetConfig(options.instanceConfig, selectedTarget);
  const action = invocationPolicyKey(toolName, callArgs);
  const invocationDecision = multiTargetInvocationDecision(toolName, callArgs, activeConfig);
  if (invocationDecision === 'forbidden') {
    return {
      handled: true,
      result: error(
        'MULTI_TARGET_OPERATION_FORBIDDEN',
        'This tool or operation is not available in read-only multi-target v1.',
      ),
    };
  }
  const actionPolicy = getActionPolicy(toolName, action);
  if (authInfo && actionPolicy && !hasRequiredScope(authInfo.scopes, actionPolicy.scope)) {
    logger.emitAudit({
      timestamp: new Date().toISOString(),
      level: 'warn',
      event: 'auth_scope_denied',
      requestId,
      user: authInfo.extra?.userName as string | undefined,
      clientId: authInfo.clientId,
      target: selectedTarget.target,
      tool: toolName,
      requiredScope: actionPolicy.scope,
      availableScopes: authInfo.scopes,
    });
    return {
      handled: true,
      result: error(
        'INSUFFICIENT_SCOPE',
        `Scope '${actionPolicy.scope}' is required for this operation. Sign in with the required ARC-1 role and try again.`,
      ),
    };
  }
  if (isActionDenied(toolName, action, activeConfig.denyActions)) {
    return {
      handled: true,
      result: error('MULTI_TARGET_OPERATION_FORBIDDEN', 'This operation is disabled by the ARC-1 instance policy.'),
    };
  }
  if (invocationDecision === 'target-policy-denied') {
    return {
      handled: true,
      result: error(
        'TARGET_POLICY_DENIED',
        `Target ${selectedTarget.target} does not enable this data or SQL operation at both the instance and destination layers.`,
        {},
        'target_policy_denied',
      ),
    };
  }
  // Consume Layer 2 before the uncached per-user Destination lookup and SAP feature probe.
  // handleToolCall receives no limiter after this succeeds, so every accepted request costs
  // exactly one point and a rejected request performs no BTP or SAP work.
  const rateLimit = await consumePreparedRateLimit({
    toolName,
    authInfo,
    mcpRateLimiter,
    requestId,
    target: selectedTarget,
    error,
  });
  if (!rateLimit.allowed) return { handled: true, result: rateLimit.result };
  return {
    handled: false,
    args: callArgs,
    activeConfig,
    selectedTarget,
    error,
    mcpRateLimitConsumed: rateLimit.consumed,
  };
}
