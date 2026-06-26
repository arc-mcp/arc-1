/**
 * handleToolCall — the intent dispatcher for ARC-1.
 *
 * Runs the per-call pipeline (rate-limit → scope → deny-actions → Zod → route to one of the 12
 * tool handlers → audit) and owns the LLM-facing error-formatting tree.
 */

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { AdtClient } from '../adt/client.js';
import { AdtApiError, AdtNetworkError, AdtSafetyError, classifySapDomainError } from '../adt/errors.js';
/**
 * Scope required for each tool.
 *
 * Scope enforcement is ADDITIVE to the safety system:
 * - Safety system (allowWrites, allowedPackages, etc.) gates operations at the ADT client level
 * - Scopes gate operations at the MCP tool level (only enforced when authInfo is present)
 * - Both must pass for an operation to succeed
 *
 * A user with `write` scope but `allowWrites=false` in config still can't write.
 *
 * Scope lookup and implication rules are defined in `src/authz/policy.ts` (ACTION_POLICY,
 * getActionPolicy, hasRequiredScope). This module routes through them.
 */
import { getActionPolicy, hasRequiredScope as hasScopeHelper } from '../authz/policy.js';
import type { CachingLayer } from '../cache/caching-layer.js';
import { type RegistryEntry, type ToolDispatchContext, ToolRegistry } from '../registry/tool-registry.js';
import { sanitizeArgs } from '../server/audit.js';
import { generateRequestId, requestContext } from '../server/context.js';
import { logger } from '../server/logger.js';
import { type McpRateLimiter, resolveRateLimitUserKey } from '../server/mcp-rate-limit.js';
import type { ServerConfig } from '../server/types.js';
import { handleSAPActivate } from './activate.js';
import { buildCacheSecurityContext } from './cache-security.js';
import { handleSAPContext } from './context.js';
import { handleSAPDiagnose } from './diagnose.js';
import { cachedFeatures } from './feature-cache.js';
import { handleSAPGit } from './git.js';
import { expandHyperfocusedArgs } from './hyperfocused.js';
import { handleSAPLint } from './lint.js';
import { handleSAPManage } from './manage.js';
import { handleSAPNavigate } from './navigate.js';
import { canonicalTablType, normalizeObjectType, normalizeTypeArgsForValidation } from './object-types.js';
import { handleSAPQuery } from './query.js';
import { handleSAPRead } from './read.js';
import { getToolSchema } from './schemas.js';
import { handleSAPSearch } from './search.js';
import { errorResult, hasSqlParserSignature, type ToolResult } from './shared.js';
import { handleSAPTransport } from './transport.js';
import { handleSAPWrite } from './write.js';
import { formatZodError } from './zod-errors.js';

/**
 * Back-compat re-export of a tool→scope map derived from ACTION_POLICY.
 * New code should use `getActionPolicy(tool, action)` directly.
 */
export const TOOL_SCOPES: Record<string, string> = Object.fromEntries(
  [
    'SAPRead',
    'SAPSearch',
    'SAPQuery',
    'SAPGit',
    'SAPNavigate',
    'SAPContext',
    'SAPLint',
    'SAPDiagnose',
    'SAPWrite',
    'SAPActivate',
    'SAPManage',
    'SAPTransport',
  ].map((t) => [t, getActionPolicy(t)?.scope ?? 'read']),
);

/**
 * Check if authInfo has the required scope, routing through policy.hasRequiredScope.
 */
export function hasRequiredScope(authInfo: AuthInfo, requiredScope: string): boolean {
  return hasScopeHelper(
    authInfo.scopes,
    requiredScope as 'read' | 'write' | 'data' | 'sql' | 'transports' | 'git' | 'admin',
  );
}

const DDIC_SAVE_HINT_TYPES = new Set(['TABL', 'DDLS', 'DCLS', 'BDEF', 'SRVD', 'SRVB', 'DDLX', 'DOMA', 'DTEL']);

function getWriteInfrastructureHint(err: AdtApiError, tool: string, args: Record<string, unknown>): string | undefined {
  if (tool !== 'SAPWrite') return undefined;
  const action = String(args.action ?? '').toLowerCase();
  if (!['create', 'update', 'batch_create', 'edit_method', 'delete'].includes(action)) return undefined;

  // These failures happen around ADT session management, often after SAP has
  // already accepted a mutation. They need cleanup guidance, not DDIC syntax hints.
  const combined = `${err.message}\n${err.responseBody ?? ''}\n${err.path}`.toLowerCase();
  const failedDuringCsrfFetch = err.path.includes('/sap/bc/adt/core/discovery') || combined.includes('no csrf token');
  const failedDuringUnlock = combined.includes('_action=unlock');
  const serviceRoutingFailure = combined.includes('service cannot be reached');
  if (!failedDuringCsrfFetch && !failedDuringUnlock && !serviceRoutingFailure) return undefined;

  return (
    'SAP ADT write/session infrastructure failed, not a DDIC source save failure. ' +
    'The object may have been partially created or changed before the session failed; verify with SAPRead/SAPSearch, ' +
    'wait briefly, then retry cleanup. If an edit lock remains, release it in ADT/SM12 or ask Basis to clear it.'
  );
}

/** Format error messages with LLM-friendly remediation hints */
function formatErrorForLLM(
  err: unknown,
  message: string,
  tool: string,
  args: Record<string, unknown>,
  config: ServerConfig,
): string {
  const base = buildBaseErrorMessage(err, message, tool, args, config);
  // Handler-attached remediation hints (e.g., CDS delete blocker list) always
  // appear last so the message reads "what happened → diagnostics → how to fix".
  if (err instanceof AdtApiError && err.extraHint && !base.includes(err.extraHint)) {
    return `${base}\n\n${err.extraHint}`;
  }
  return base;
}

function buildBaseErrorMessage(
  err: unknown,
  message: string,
  tool: string,
  args: Record<string, unknown>,
  config: ServerConfig,
): string {
  if (err instanceof AdtApiError) {
    if (config.minimalErrors) return formatMinimalAdtError(err);

    // Append additional SAP messages (line numbers, secondary errors) if available
    const enriched = enrichWithSapDetails(err, message);
    const argType = canonicalTablType(String(args.type ?? '').toUpperCase());
    // Pass the detected SAP_BASIS release so the 423 lock-handle hint can specialize
    // (< 7.51 → point at abapfs_extensions; see issue #293). cachedFeatures is set by the
    // startup probe; config.abapRelease is the manual SAP_ABAP_RELEASE override fallback.
    const abapRelease = cachedFeatures?.abapRelease ?? config.abapRelease;
    const classification = classifySapDomainError(err.statusCode, err.responseBody, err.path, abapRelease);

    if (classification) {
      const transactionLine = classification.transaction ? `\nSAP Transaction: ${classification.transaction}` : '';
      return `${enriched}\n\nHint: ${classification.hint}${transactionLine}`;
    }

    if (err.isNotFound) {
      const diagnosticsHint = buildDiagnosticsNotFoundHint(tool, args);
      if (diagnosticsHint) {
        return `${enriched}\n\nHint: ${diagnosticsHint}`;
      }
      const name = String(args.name ?? '');
      const type = String(args.type ?? '');
      return `${enriched}\n\nHint: Object "${name}" (type ${type}) was not found. Use SAPSearch with query "${name}" to verify the name exists and check the correct type.`;
    }
    if (err.isUnauthorized || err.isForbidden) {
      if (config.cookieFile || config.cookieString) {
        return (
          `${enriched}\n\n` +
          'Hint: SAP cookies have expired. Ask the user to re-extract cookies ' +
          'with `arc1-cli extract-cookies`. The next SAP call after extraction ' +
          'will automatically reload the fresh cookies — no restart needed.'
        );
      }
      return `${enriched}\n\nHint: Authorization error. Check SAP_CLIENT (default: '100'), SAP_USER, and SAP_PASSWORD. The configured SAP user may lack permissions for this object.`;
    }
    // Transport / corrNr specific hints
    const transportHint = getTransportHint(err);
    if (transportHint) {
      return `${enriched}\n\nHint: ${transportHint}`;
    }
    if (tool === 'SAPRead' && argType === 'TABLE_CONTENTS' && err.statusCode === 400) {
      const combined = `${err.message}\n${err.responseBody ?? ''}`;
      if (hasSqlParserSignature(combined)) {
        return (
          `${enriched}\n\nHint: TABLE_CONTENTS sqlFilter must be a condition expression only ` +
          '(no WHERE, no SELECT, no semicolon). Examples: ' +
          `sqlFilter="MANDT = '100'" or sqlFilter="MATNR LIKE 'Z%'".`
        );
      }
    }
    if (tool === 'SAPRead' && argType === 'TABLE_QUERY' && err.statusCode === 400) {
      const combined = `${err.message}\n${err.responseBody ?? ''}`;
      if (/is invalid here|due to grammar/i.test(combined)) {
        return (
          `${enriched}\n\nHint: TABLE_QUERY parser error — check field names match the actual column names ` +
          'exposed by the table/CDS view (use SAPRead(type="DDLS", include="elements") to inspect CDS view fields). ' +
          'Also verify value formats (e.g. FiscalPeriod is C(2,0) so use "01" not "001").'
        );
      }
    }
    const behaviorPoolHint = getBehaviorPoolSaveFailureHint(err, args);
    if (behaviorPoolHint) {
      return `${enriched}\n\nHint: ${behaviorPoolHint}`;
    }
    const writeInfrastructureHint = getWriteInfrastructureHint(err, tool, args);
    if (writeInfrastructureHint) {
      return `${enriched}\n\nHint: ${writeInfrastructureHint}`;
    }
    // Save hint — applies to create/update/batch_create/edit_method, not delete.
    // Delete failures on DDIC types have different remediation (dependency resolution, not annotation fixes).
    const action = String(args.action ?? '').toLowerCase();
    const isSaveAction =
      action === '' ||
      action === 'create' ||
      action === 'update' ||
      action === 'batch_create' ||
      action === 'edit_method';
    if ((err.statusCode === 400 || err.statusCode === 409) && DDIC_SAVE_HINT_TYPES.has(argType) && isSaveAction) {
      return (
        `${enriched}\n\nHint: DDIC save failed. Check the diagnostic details above for specific field or annotation errors. ` +
        'Common fixes: add missing @AbapCatalog annotations, fix field type names, check key field definitions.'
      );
    }
    // Server errors (500, 502, 503, etc.)
    if (err.isServerError) {
      // Detect syntax errors in dependent objects (e.g., BDEF syntax errors blocking SRVB activation)
      const syntaxMatch = err.message.match(/[Ss]yntax error in program (\S+)/);
      if (syntaxMatch) {
        const program = syntaxMatch[1].replace(/=+\w*$/, ''); // Strip "====BD" padding
        return `${enriched}\n\nHint: A dependent object has syntax errors that block this operation. The program "${program}" has syntax errors — fix those first, then retry. Use SAPRead to inspect the object, or SAPDiagnose(action="dumps") for details.`;
      }
      return `${enriched}\n\nHint: SAP application server error (${err.statusCode}). This is often transient — wait 10-30 seconds and retry. If the error persists, check SAPDiagnose(action="dumps") for short dumps, or verify the SAP system is responding via SAPRead(type="SYSTEM").`;
    }
    return enriched;
  }

  if (err instanceof AdtSafetyError) {
    const argType = canonicalTablType(String(args.type ?? '').toUpperCase());
    if (tool === 'SAPRead' && argType === 'TABLE_CONTENTS') {
      return (
        `${message}\n\nHint: TABLE_CONTENTS is blocked by safety configuration or missing data scope. ` +
        'Set SAP_ALLOW_DATA_PREVIEW=true at the server level and, in authenticated HTTP mode, ' +
        'ensure the token includes data (or sql) scope.'
      );
    }
    return message;
  }

  if (err instanceof AdtNetworkError) {
    if (tool === 'SAPRead' && String(args.type ?? '').toUpperCase() === 'SYSTEM') {
      return (
        `${message}\n\nHint: Connectivity probe failed. Fix connectivity first, then retry ` +
        'SAPRead(type="SYSTEM") before running any batch or parallel tool calls.'
      );
    }
    return (
      `${message}\n\nHint: Cannot reach the SAP system. Run SAPRead(type="SYSTEM") once as a connectivity ` +
      'probe before retrying batch/parallel calls.'
    );
  }

  return message;
}

function formatMinimalAdtError(err: AdtApiError): string {
  const classification = classifySapDomainError(err.statusCode, err.responseBody, err.path);
  const category = classification ? ` Category: ${classification.category}.` : '';
  return (
    `ADT API error: status ${err.statusCode}.${category}\n\n` +
    'Hint: Detailed SAP error text is hidden because ARC1_MINIMAL_ERRORS=true. ' +
    'Use the request ID to correlate server-side audit and SAP-native logs, or retry in a trusted admin session with minimal errors disabled.'
  );
}

function buildDiagnosticsNotFoundHint(tool: string, args: Record<string, unknown>): string | undefined {
  if (tool !== 'SAPDiagnose') return undefined;

  const action = String(args.action ?? '');
  const id = String(args.id ?? '').trim();
  const detailUrl = String(args.detailUrl ?? '').trim();

  if (action === 'dumps' && id) {
    return `Dump ID "${id}" was not found. Re-list dumps with SAPDiagnose(action="dumps", maxResults=50), then retry with a fresh ID from that list.`;
  }

  if (action === 'traces' && id) {
    return `Trace ID "${id}" was not found. Re-list traces with SAPDiagnose(action="traces") and retry using an existing trace ID.`;
  }

  if (action === 'gateway_errors' && (detailUrl || id)) {
    return 'Gateway error detail was not found. Re-list SAPDiagnose(action="gateway_errors") and reuse a current detailUrl from the list output.';
  }

  return undefined;
}

function buildAuditResultPreview(toolName: string, args: Record<string, unknown>, fullText: string): string {
  const maxLen = 500;
  const truncate = (value: string): string => (value.length > maxLen ? `${value.slice(0, maxLen)}...` : value);

  if (toolName !== 'SAPDiagnose') return truncate(fullText);

  const action = String(args.action ?? '');
  const isDetailDump = action === 'dumps' && Boolean(args.id);
  const isDetailGateway =
    action === 'gateway_errors' && (Boolean(args.detailUrl) || (Boolean(args.id) && Boolean(args.errorType)));

  if (!isDetailDump && !isDetailGateway) return truncate(fullText);

  try {
    const payload = JSON.parse(fullText) as Record<string, unknown>;
    if (isDetailDump) {
      const sections =
        payload.sections && typeof payload.sections === 'object' ? (payload.sections as Record<string, unknown>) : {};
      const compact = {
        id: payload.id,
        error: payload.error,
        program: payload.program,
        user: payload.user,
        timestamp: payload.timestamp,
        selectedSectionIds: payload.selectedSectionIds,
        sections: Object.fromEntries(
          Object.entries(sections).map(([key, value]) => {
            if (typeof value === 'string') return [key, `[omitted ${value.length} chars]`];
            return [key, '[omitted]'];
          }),
        ),
        formattedText:
          typeof payload.formattedText === 'string' ? `[omitted ${payload.formattedText.length} chars]` : undefined,
      };
      return truncate(JSON.stringify(compact));
    }

    if (isDetailGateway && payload.sourceCode && typeof payload.sourceCode === 'object') {
      const sourceCode = payload.sourceCode as Record<string, unknown>;
      const lines = Array.isArray(sourceCode.lines) ? sourceCode.lines.length : 0;
      const compact = {
        type: payload.type,
        shortText: payload.shortText,
        transactionId: payload.transactionId,
        username: payload.username,
        dateTime: payload.dateTime,
        sourceCode: `[omitted ${lines} lines]`,
        callStackCount: Array.isArray(payload.callStack) ? payload.callStack.length : 0,
      };
      return truncate(JSON.stringify(compact));
    }

    return truncate(JSON.stringify(payload));
  } catch {
    return truncate(fullText);
  }
}

/** Enrich error message with additional SAP XML diagnostic detail (extra messages, properties) */
function enrichWithSapDetails(err: AdtApiError, message: string): string {
  if (!err.responseBody) return message;

  const extraMessages = AdtApiError.extractAllMessages(err.responseBody);
  const props = AdtApiError.extractProperties(err.responseBody);

  const parts: string[] = [message];

  if (extraMessages.length > 0) {
    parts.push(`\nAdditional detail:\n${extraMessages.map((m) => `  - ${m}`).join('\n')}`);
  }

  const ddicDiagnostics = AdtApiError.formatDdicDiagnostics(err.responseBody);
  if (ddicDiagnostics) {
    parts.push(ddicDiagnostics);
    // Skip raw Properties dump — DDIC diagnostics already include the structured
    // T100KEY details (message ID, number, variables, line). Showing both would
    // triplicate the same information.
  } else {
    // Surface line/column info from properties if present (non-DDIC errors only)
    const lineInfo = props.LINE || props['T100KEY-NO'];
    if (lineInfo || Object.keys(props).length > 0) {
      const propStr = Object.entries(props)
        .slice(0, 5) // Limit to avoid overwhelming output
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      if (propStr) parts.push(`Properties: ${propStr}`);
    }
  }

  return parts.join('\n');
}

/** Detect transport/corrNr failure signatures and return a remediation hint, or undefined if not transport-related. */
function getTransportHint(err: AdtApiError): string | undefined {
  const body = (err.responseBody ?? '').toLowerCase();
  // Use the clean SAP error message, NOT err.message which includes the URL path.
  // The URL path contains `corrNr=<id>` when a transport IS provided, causing false positives
  // if we check for "corrnr" in the full message string.
  const cleanMsg = AdtApiError.extractCleanMessage(err.responseBody ?? '').toLowerCase();
  const combined = `${cleanMsg} ${body}`;

  // Missing or invalid transport/correction number
  if (
    combined.includes('correction number') ||
    combined.includes('corrnr') ||
    (combined.includes('transport request') &&
      (combined.includes('missing') || combined.includes('required') || combined.includes('invalid')))
  ) {
    return 'A transport/correction number is required but was not provided or is invalid. Provide an explicit "transport" parameter with a valid transport request ID, or check SE09 in SAP GUI that an open transport exists for your user and target package.';
  }

  // Transport not found or not modifiable
  if (
    combined.includes('e070') ||
    (combined.includes('transport') &&
      (combined.includes('not found') || combined.includes('does not exist') || combined.includes('not modifiable')))
  ) {
    return 'The specified transport request was not found or is not modifiable. Verify the transport ID in SE09, ensure it is not yet released, and that it belongs to the correct user and target package.';
  }

  // Package / transport layer mismatch
  if (
    combined.includes('transport layer') ||
    (combined.includes('package') &&
      combined.includes('transport') &&
      (combined.includes('mismatch') || combined.includes('not assigned') || combined.includes('no transport layer')))
  ) {
    return 'The target package has no transport layer or a transport layer mismatch. Check that the package is configured for transport in SE80/TDEVC, or use a local package ($TMP) if no transport is needed.';
  }

  // Authorization for transport operations
  if (
    combined.includes('s_transprt') ||
    (combined.includes('transport') && (combined.includes('no authorization') || combined.includes('not authorized')))
  ) {
    return 'The SAP user lacks transport authorization (S_TRANSPRT). Contact your SAP basis administrator to grant the required transport permissions.';
  }

  return undefined;
}

function inferBdefNameFromBehaviorPoolSource(source: string): string | undefined {
  const match = source.match(/\bfor\s+behavior\s+of\s+([A-Za-z_][\w/]+)/i);
  return match?.[1];
}

function getBehaviorPoolSaveFailureHint(err: AdtApiError, args: Record<string, unknown>): string | undefined {
  const type = normalizeObjectType(String(args.type ?? ''));
  if (type !== 'CLAS') return undefined;

  const name = String(args.name ?? '');
  const source = String(args.source ?? '');
  const clean = AdtApiError.extractCleanMessage(err.responseBody ?? '').toLowerCase();
  const body = (err.responseBody ?? '').toLowerCase();
  const isGenericSaveFailure =
    clean.includes('an error occured during the save operation') ||
    clean.includes('an error occurred during the save operation') ||
    body.includes('an error occured during the save operation') ||
    body.includes('an error occurred during the save operation');
  if (!isGenericSaveFailure) return undefined;

  const looksLikeBehaviorPool = /\bfor\s+behavior\s+of\b/i.test(source) || /^zbp_/i.test(name) || /^ybp_/i.test(name);
  if (!looksLikeBehaviorPool) return undefined;

  const inferredBdef = inferBdefNameFromBehaviorPoolSource(source);
  const bdefHint = inferredBdef ? `, bdefName="${inferredBdef}"` : ', bdefName="<interface_bdef_name>"';

  return (
    `Behavior-pool class save failed on handler declarations. Use ` +
    `SAPWrite(action="scaffold_rap_handlers", type="CLAS", name="${name}"${bdefHint}) ` +
    `to list missing RAP handler signatures, then rerun with autoApply=true to inject declarations. ` +
    `If SAP still rejects the full-class write, use ADT quick-fix to stamp signatures and continue with SAPWrite(action="edit_method").`
  );
}

function classifyError(err: unknown): string {
  if (err instanceof AdtApiError) {
    const classification = classifySapDomainError(err.statusCode, err.responseBody, err.path);
    return classification ? `AdtApiError:${classification.category}` : 'AdtApiError';
  }
  if (err instanceof AdtNetworkError) return 'AdtNetworkError';
  if (err instanceof AdtSafetyError) return 'AdtSafetyError';
  if (err instanceof Error) return err.constructor.name;
  return 'Unknown';
}

// ─── Tool registry (FEAT-61) ─────────────────────────────────────────
// The 12 built-ins register through the same ToolRegistry that plugin (Custom_*) tools use. Each
// built-in `invoke` is a thin adapter over its existing handler — the shared pipeline (rate-limit,
// scope, deny, Zod, audit) stays in handleToolCall; the registry only owns the inner dispatch that
// used to be a `switch`. See docs/research/2026-06-17-extension-framework-spec.md §4.
let _toolRegistry: ToolRegistry | undefined;

/** The process-wide tool registry, lazily seeded with the built-ins. Exported for tests. */
export function getToolRegistry(): ToolRegistry {
  if (_toolRegistry) return _toolRegistry;
  const r = new ToolRegistry();
  const reg = (name: string, invoke: RegistryEntry['invoke']): void => {
    const policy = getActionPolicy(name);
    if (!policy) throw new Error(`Built-in tool '${name}' has no ACTION_POLICY entry`);
    r.register({ name, source: 'builtin', policy, invoke });
  };
  reg('SAPRead', (ctx) => handleSAPRead(ctx.client, ctx.args, ctx.cache, ctx.cacheSecurity));
  reg('SAPSearch', (ctx) => handleSAPSearch(ctx.client, ctx.args));
  reg('SAPQuery', (ctx) => handleSAPQuery(ctx.client, ctx.args));
  reg('SAPWrite', (ctx) => handleSAPWrite(ctx.client, ctx.args, ctx.config, ctx.cache, ctx.cacheSecurity));
  reg('SAPActivate', (ctx) => handleSAPActivate(ctx.client, ctx.args, ctx.cache, ctx.cacheSecurity));
  reg('SAPNavigate', (ctx) => handleSAPNavigate(ctx.client, ctx.args));
  reg('SAPLint', (ctx) => handleSAPLint(ctx.client, ctx.args, ctx.config));
  reg('SAPDiagnose', (ctx) => handleSAPDiagnose(ctx.client, ctx.args));
  reg('SAPTransport', (ctx) => handleSAPTransport(ctx.client, ctx.args));
  reg('SAPGit', (ctx) => handleSAPGit(ctx.client, ctx.args, ctx.authInfo));
  reg('SAPContext', (ctx) => handleSAPContext(ctx.client, ctx.args, ctx.cache, ctx.cacheSecurity));
  reg('SAPManage', (ctx) => handleSAPManage(ctx.client, ctx.config, ctx.args, ctx.cache, ctx.isPerUserClient));
  reg('SAP', async (ctx) => {
    const expanded = expandHyperfocusedArgs(ctx.args);
    if ('error' in expanded) return errorResult(expanded.error);
    return handleToolCall(
      ctx.client,
      ctx.config,
      expanded.toolName,
      expanded.expandedArgs,
      ctx.authInfo,
      ctx.server,
      ctx.cache,
      ctx.isPerUserClient,
    );
  });
  _toolRegistry = r;
  return r;
}

/**
 * Handle an MCP tool call.
 *
 * @param authInfo - Authenticated user context from MCP SDK (XSUAA/OIDC/API key).
 *   When present, scope enforcement is active. When absent (stdio, no auth),
 *   all tools are allowed (backward compatibility).
 * @param server - MCP Server instance for elicitation support.
 */
export async function handleToolCall(
  client: AdtClient,
  config: ServerConfig,
  toolName: string,
  args: Record<string, unknown>,
  authInfo?: AuthInfo,
  _server?: Server,
  cachingLayer?: CachingLayer,
  isPerUserClient?: boolean,
  mcpRateLimiter?: McpRateLimiter,
): Promise<ToolResult> {
  const reqId = generateRequestId();
  const start = Date.now();

  // Build user context for audit logging
  const user = authInfo?.extra?.userName as string | undefined;
  const clientId = authInfo?.clientId;
  // For plugin (Custom_*) tools, tag every audit event with the contributing plugin (spec §9).
  const pluginName = getToolRegistry().get(toolName)?.pluginName;

  // Emit tool_call_start audit event
  logger.emitAudit({
    timestamp: new Date().toISOString(),
    level: 'info',
    event: 'tool_call_start',
    requestId: reqId,
    user,
    clientId,
    tool: toolName,
    pluginName,
    args: sanitizeArgs(args),
  });

  // ─── Layer 2: per-user MCP tool-call rate limit ─────────────────────
  // Applied immediately so we don't waste any work on denied calls. Stdio mode
  // (no authInfo) is exempt — there's no user identity to key on. On denial we
  // return an MCP tool error (not HTTP 429) so the LLM client surfaces it as a
  // tool failure and the agent loop backs off via its own retry policy.
  // See docs_page/rate-limiting.md (Layer 2). Cost weighting per tool is deferred
  // to v2 — every consume call counts as one point.
  if (mcpRateLimiter && authInfo) {
    // Walks the most-specific identity claim first (userName → email → sub →
    // preferred_username → clientId) so OIDC users sharing one `azp` clientId
    // don't collapse into a single bucket. See resolveRateLimitUserKey.
    const userKey = resolveRateLimitUserKey(authInfo);
    const decision = await mcpRateLimiter.consume(userKey, toolName);
    if (!decision.allowed) {
      const retryAfter = Math.ceil(decision.retryAfterMs / 1000);
      logger.emitAudit({
        timestamp: new Date().toISOString(),
        level: 'warn',
        event: 'mcp_rate_limited',
        requestId: reqId,
        clientId,
        user: userKey,
        tool: toolName,
        limitPerMinute: decision.limitPerMinute,
        retryAfterMs: decision.retryAfterMs,
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              error: 'rate_limited',
              retryAfter,
              message: `Rate limit exceeded (${decision.limitPerMinute}/min per user). Retry after ${retryAfter} seconds.`,
            }),
          },
        ],
        isError: true,
      };
    }
  }

  // Unified scope enforcement via ACTION_POLICY — routes through action/type-aware lookup.
  // For SAPRead, the policy key is Tool.{type}; for other action-bearing tools, Tool.{action};
  // for tools without an action/type enum (SAPSearch, SAPQuery), the tool-level default applies.
  // For SAPSearch.tadir_lookup with source='db'|'both', synthesize a sub-action key so the
  // sql-scoped policy entry kicks in (otherwise viewer-only profiles could piggyback on the
  // ADT info-system route to issue freestyle SQL).
  //
  // SECURITY (privilege-escalation hardening): the scope key is derived from the SAME
  // normalized value the handler ultimately dispatches on. `normalizeTypeArgsForValidation`
  // upper-cases + slash-collapses `type` and coerces non-string inputs via String(), so a
  // caller cannot evade the per-type scope gate by sending a value that misses the policy key
  // here yet is canonicalized into a privileged type just before Zod runs. Two such bypasses
  // existed when this lookup read the RAW `args`: an array (`type: ["TABLE_CONTENTS"]` —
  // typeof "object" → undefined key → base `read`) and a lowercase string
  // (`type: "table_contents"` — no `SAPRead.table_contents` key → base `read`), both of which
  // were then normalized into the data-scoped `TABLE_CONTENTS` for the handler. Normalizing
  // first closes the array, case, and slash-form variants in one place (and keeps the
  // SAP_DENY_ACTIONS match below consistent with the canonical form). The normalized object is
  // reused for Zod validation below so canonicalization happens exactly once.
  // Runs BEFORE Zod validation so scope errors don't leak schema details to unauthorized callers.
  const normalizedArgs = normalizeTypeArgsForValidation(toolName, args);
  const rawScopeKey = toolName === 'SAPRead' ? normalizedArgs.type : normalizedArgs.action;
  let actionOrType: string | undefined =
    rawScopeKey === undefined || rawScopeKey === null || rawScopeKey === '' ? undefined : String(rawScopeKey);
  if (
    toolName === 'SAPSearch' &&
    typeof normalizedArgs.searchType === 'string' &&
    normalizedArgs.searchType === 'tadir_lookup' &&
    typeof normalizedArgs.source === 'string'
  ) {
    const src = normalizedArgs.source.toLowerCase();
    if (src === 'db' || src === 'both') {
      actionOrType = `tadir_lookup_${src}`;
    }
  }
  // Built-in policy from ACTION_POLICY; plugin (Custom_*) policy from the registry (FEAT-61).
  // Kept here (not inside getActionPolicy) so validate-action-policy.ts stays built-ins-only.
  const policy = getActionPolicy(toolName, actionOrType) ?? getToolRegistry().get(toolName)?.policy;

  if (authInfo && policy) {
    if (!hasRequiredScope(authInfo, policy.scope)) {
      logger.emitAudit({
        timestamp: new Date().toISOString(),
        level: 'warn',
        event: 'auth_scope_denied',
        requestId: reqId,
        user,
        clientId,
        tool: toolName,
        requiredScope: policy.scope,
        availableScopes: authInfo.scopes,
      });
      const actionLabel = actionOrType
        ? `${toolName}(${toolName === 'SAPRead' ? 'type' : 'action'}="${actionOrType}")`
        : toolName;
      return errorResult(
        `Insufficient scope: '${policy.scope}' required for ${actionLabel}. Your scopes: [${authInfo.scopes.join(', ')}]`,
      );
    }
  }

  // Server-level denyActions (SAP_DENY_ACTIONS) — blocks before any per-user scope allows it.
  const { isActionDenied } = await import('../server/deny-actions.js');
  if (isActionDenied(toolName, actionOrType, config.denyActions ?? [])) {
    logger.emitAudit({
      timestamp: new Date().toISOString(),
      level: 'warn',
      event: 'safety_blocked',
      requestId: reqId,
      user,
      clientId,
      operation: `${toolName}${actionOrType ? `.${actionOrType}` : ''}`,
      reason: 'Action denied by SAP_DENY_ACTIONS',
    });
    return errorResult(
      `Action '${toolName}${actionOrType ? `.${actionOrType}` : ''}' is denied by server policy (SAP_DENY_ACTIONS).`,
    );
  }

  // Validate tool arguments with Zod schema (runs AFTER scope + deny check).
  const isBtp = config.systemType === 'btp';
  const schema = getToolSchema(toolName, isBtp);
  if (schema) {
    // Reuse the normalized args computed for the scope-key derivation above —
    // re-normalizing would be redundant (the transform is idempotent) and risks
    // the two paths drifting.
    args = normalizedArgs;
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      const validationError = formatZodError(parsed.error, toolName);
      logger.emitAudit({
        timestamp: new Date().toISOString(),
        level: 'warn',
        event: 'safety_blocked',
        requestId: reqId,
        user,
        clientId,
        operation: toolName,
        reason: 'Input validation failed',
      });
      return errorResult(validationError);
    }
    args = parsed.data as Record<string, unknown>;
  }

  // Run within request context so HTTP-level logs get the requestId
  return requestContext.run({ requestId: reqId, user, tool: toolName }, async () => {
    try {
      const cacheSecurity = buildCacheSecurityContext(authInfo, isPerUserClient);

      // FEAT-61: inner dispatch is owned by the ToolRegistry (built-ins + plugin Custom_* tools).
      // The shared pipeline above (rate-limit, scope, deny, Zod, audit) is unchanged; the registry
      // only replaces the former `switch (toolName)`. See extension-framework-spec.md §4.
      const entry = getToolRegistry().get(toolName);
      let result: ToolResult;
      // Plugin (Custom_*) tools are out of scope for hyperfocused mode (spec §1): hidden from
      // tools/list AND not directly invocable, so a client that knows a Custom_ name can't reach a
      // plugin tool here either. Built-ins (incl. the `SAP` wrapper) dispatch normally.
      if (!entry || (config.toolMode === 'hyperfocused' && entry.source === 'plugin')) {
        result = errorResult(`Unknown tool: ${toolName}`);
      } else {
        const dispatchCtx: ToolDispatchContext = {
          client,
          config,
          args,
          cache: cachingLayer,
          authInfo,
          isPerUserClient,
          cacheSecurity,
          server: _server,
          requestId: reqId,
        };
        result = await entry.invoke(dispatchCtx);
      }

      const durationMs = Date.now() - start;
      const fullText = result.content.map((c) => c.text).join('');
      const resultSize = fullText.length;
      const resultPreview = buildAuditResultPreview(toolName, args, fullText);

      logger.emitAudit({
        timestamp: new Date().toISOString(),
        level: result.isError ? 'error' : 'info',
        event: 'tool_call_end',
        requestId: reqId,
        user,
        clientId,
        tool: toolName,
        pluginName,
        durationMs,
        status: result.isError ? 'error' : 'success',
        errorMessage: result.isError ? result.content[0]?.text : undefined,
        errorClass: result.isError ? 'result-path' : undefined,
        resultSize,
        resultPreview,
      });

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const durationMs = Date.now() - start;

      logger.emitAudit({
        timestamp: new Date().toISOString(),
        level: 'error',
        event: 'tool_call_end',
        requestId: reqId,
        user,
        clientId,
        tool: toolName,
        pluginName,
        durationMs,
        status: 'error',
        errorClass: classifyError(err),
        errorMessage: message,
      });

      return errorResult(formatErrorForLLM(err, message, toolName, args, config));
    }
  });
}

// ─── Individual Tool Handlers ────────────────────────────────────────

/** Check if the connected system is BTP ABAP Environment */

/** Return whether the SAP ADT discovery feed advertises the /sap/bc/adt/ddic/tables
 *  collection (the transparent-table editor endpoint). Absent on NW 7.50/7.51 —
 *  SAP added it in NW 7.52 along with the new database-table editor. When the
 *  discovery cache is empty (e.g. probe never ran, tests that bypass SAPManage),
 *  returns `undefined` so callers can decide whether to default-allow.
 *  See issue #285. */
