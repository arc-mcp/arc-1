/**
 * Intent-based tool handler for ARC-1.
 *
 * Routes MCP tool calls to the appropriate ADT client methods.
 * Each of the 12 tools (SAPRead, SAPSearch, etc.) dispatches
 * based on its `type` or `action` parameter.
 *
 * Error handling: all errors are caught and returned as MCP error
 * responses. Internal details (stack traces, SAP XML) are NOT
 * leaked to the LLM — only user-friendly error messages.
 */

import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  checkRepo as abapGitCheckRepo,
  createBranch as abapGitCreateBranch,
  createRepo as abapGitCreateRepo,
  getExternalInfo as abapGitGetExternalInfo,
  listRepos as abapGitListRepos,
  pullRepo as abapGitPullRepo,
  pushRepo as abapGitPushRepo,
  stageRepo as abapGitStageRepo,
  switchBranch as abapGitSwitchBranch,
  unlinkRepo as abapGitUnlinkRepo,
} from '../adt/abapgit.js';
import {
  buildSiblingExtensionFinding,
  type CdsImpactDownstream,
  classifyCdsImpact,
  deriveSiblingStem,
  isSiblingNameMatch,
  type SiblingExtensionCandidate,
} from '../adt/cds-impact.js';
import type { AdtClient, SourceReadResult } from '../adt/client.js';
import {
  findDefinition,
  findInterfaceImplementersViaSeoMetaRel,
  findReferences,
  findWhereUsed,
  getCompletion,
  getWhereUsedScope,
  type ReferenceResult,
  type WhereUsedResult,
} from '../adt/codeintel.js';
import {
  createObject,
  deleteObject,
  lockObject,
  safeUpdateObject,
  safeUpdateSource,
  unlockObject,
  updateObject,
  updateSource,
} from '../adt/crud.js';
import {
  buildDataElementXml,
  buildDomainXml,
  buildMessageClassXml,
  buildPackageXml,
  buildServiceBindingXml,
  type DataElementCreateParams,
  type DomainCreateParams,
  decodeKtdText,
  type MessageClassCreateParams,
  type PackageCreateParams,
  rewriteKtdText,
  type ServiceBindingCreateParams,
} from '../adt/ddic-xml.js';
import {
  type ActivationResult,
  activate,
  activateBatch,
  applyFixProposal,
  getFixProposals,
  getPrettyPrinterSettings,
  type PrettyPrinterSettings,
  prettyPrint,
  publishServiceBinding,
  runAtcCheck,
  runUnitTests,
  setPrettyPrinterSettings,
  syntaxCheck,
  unpublishServiceBinding,
} from '../adt/devtools.js';
import {
  getDump,
  getGatewayErrorDetail,
  getObjectState,
  getTraceDbAccesses,
  getTraceHitlist,
  getTraceStatements,
  listDumps,
  listGatewayErrors,
  listSystemMessages,
  listTraces,
} from '../adt/diagnostics.js';
import {
  AdtApiError,
  AdtNetworkError,
  AdtSafetyError,
  classifySapDomainError,
  isNotFoundError,
} from '../adt/errors.js';
import { classifyTextSearchError, mapSapReleaseToAbaplintVersion, probeFeatures } from '../adt/features.js';
import {
  addTileToGroup,
  createCatalog,
  createGroup,
  createTile,
  deleteCatalog,
  listCatalogs,
  listGroups,
  listTiles,
} from '../adt/flp.js';
import { type FmParameter, type FmParameterKind, parseFmSignature, spliceFmSignature } from '../adt/fm-signature.js';
import {
  type GctsCloneParams,
  cloneRepo as gctsCloneRepo,
  commitRepo as gctsCommitRepo,
  createBranch as gctsCreateBranch,
  deleteRepo as gctsDeleteRepo,
  getCommitHistory as gctsGetCommitHistory,
  getConfig as gctsGetConfig,
  getUserInfo as gctsGetUserInfo,
  listBranches as gctsListBranches,
  listRepoObjects as gctsListRepoObjects,
  listRepos as gctsListRepos,
  pullRepo as gctsPullRepo,
  switchBranch as gctsSwitchBranch,
} from '../adt/gcts.js';
import { generateBehaviorImplementation, isRapGenerateResultSuccess } from '../adt/rap-generate.js';
import {
  applyRapHandlerScaffold,
  extractRapHandlerRequirements,
  findMissingRapHandlerImplementationStubs,
  findMissingRapHandlerRequirements,
} from '../adt/rap-handlers.js';
import { formatRapPreflightFindings, validateRapSource } from '../adt/rap-preflight.js';
import { changePackage } from '../adt/refactoring.js';
import { checkOperation, checkPackage, isOperationAllowed, OperationType } from '../adt/safety.js';
import {
  createTransport,
  deleteTransport,
  getObjectTransports,
  getTransport,
  getTransportInfo,
  listTransports,
  reassignTransport,
  releaseTransport,
  releaseTransportRecursive,
} from '../adt/transport.js';
import type {
  AdtObjectLookupResult,
  AdtSearchResult,
  ClassHierarchy,
  DumpDetail,
  FixAffectedObject,
  InactiveObject,
  ObjectTransportHistory,
  ResolvedFeatures,
} from '../adt/types.js';
import { getAppInfo } from '../adt/ui5-repository.js';
import { validateAffHeader } from '../aff/validator.js';
import type { CachingLayer } from '../cache/caching-layer.js';
import { extractCdsDependencies, extractCdsElements } from '../context/cds-deps.js';
import { compressCdsContext, compressContext } from '../context/compressor.js';
import { extractMethod, formatMethodListing, listMethods, spliceMethod } from '../context/method-surgery.js';
import {
  buildLintConfig,
  type LintConfigOptions,
  listRulesFromConfig,
  type RuleOverrides,
} from '../lint/config-builder.js';
import { detectFilename, lintAbapSource, lintAndFix, validateBeforeWrite } from '../lint/lint.js';
import { sanitizeArgs } from '../server/audit.js';
import { generateRequestId, requestContext } from '../server/context.js';
import { logger } from '../server/logger.js';
import type { ServerConfig } from '../server/types.js';
import { expandHyperfocusedArgs } from './hyperfocused.js';
import { getToolSchema } from './schemas.js';
import { formatZodError } from './zod-errors.js';

/** MCP tool call result */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

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

function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

const DDIC_SAVE_HINT_TYPES = new Set(['TABL', 'DDLS', 'DCLS', 'BDEF', 'SRVD', 'SRVB', 'DDLX', 'DOMA', 'DTEL']);
const DDIC_POST_SAVE_CHECK_TYPES = new Set(['TABL', 'DDLS', 'DCLS', 'BDEF', 'SRVD', 'SRVB', 'DDLX']);
const CDS_DEPENDENCY_SENSITIVE_TYPES = new Set(['DDLS', 'DCLS', 'DDLX', 'BDEF', 'SRVD', 'SRVB', 'TABL']);

type CdsImpactBucket = Exclude<keyof CdsImpactDownstream, 'summary'>;

const CDS_IMPACT_BUCKET_ORDER: CdsImpactBucket[] = [
  'projectionViews',
  'bdefs',
  'serviceDefinitions',
  'serviceBindings',
  'accessControls',
  'metadataExtensions',
  'abapConsumers',
  'tables',
  'documentation',
  'other',
];

const CDS_IMPACT_BUCKET_LABEL: Record<CdsImpactBucket, string> = {
  projectionViews: 'Projection views (DDLS)',
  bdefs: 'Behavior definitions (BDEF)',
  serviceDefinitions: 'Service definitions (SRVD)',
  serviceBindings: 'Service bindings (SRVB)',
  accessControls: 'Access controls (DCLS)',
  metadataExtensions: 'Metadata extensions (DDLX)',
  abapConsumers: 'ABAP consumers',
  tables: 'Tables',
  documentation: 'Documentation (SKTD)',
  other: 'Other',
};

const CDS_REACTIVATION_BUCKET_ORDER: CdsImpactBucket[] = [
  'projectionViews',
  'accessControls',
  'metadataExtensions',
  'bdefs',
  'serviceDefinitions',
  'serviceBindings',
  'other',
];

const CDS_DELETE_BUCKET_ORDER: CdsImpactBucket[] = [
  'serviceBindings',
  'serviceDefinitions',
  'bdefs',
  'metadataExtensions',
  'accessControls',
  'projectionViews',
  'other',
];

interface CdsOrderedObject {
  type: string;
  name: string;
}

const CDS_ORDERABLE_TYPES = new Set(['DDLS', 'DCLS', 'DDLX', 'BDEF', 'SRVD', 'SRVB']);
const CDS_IMPACT_WHERE_USED_TYPES = new Set([
  'DDLS',
  'DCLS',
  'DDLX',
  'BDEF',
  'SRVD',
  'SRVB',
  'CLAS',
  'INTF',
  'PROG',
  'FUGR',
  'TABL',
  'SKTD',
]);

// ─── Search Helpers ─────────────────────────────────────────────────

/**
 * Transliterate non-ASCII characters in search queries.
 * SAP object names are ASCII-only, so umlauts and accented characters
 * never appear in object names. This prevents wasted searches with
 * German terms like "*Schätzung*" that silently return empty results.
 */
export function transliterateQuery(query: string): { normalized: string; changed: boolean } {
  // Explicit German umlaut replacements (must come before NFD decomposition)
  let result = query
    .replace(/ä/g, 'AE')
    .replace(/Ä/g, 'AE')
    .replace(/ö/g, 'OE')
    .replace(/Ö/g, 'OE')
    .replace(/ü/g, 'UE')
    .replace(/Ü/g, 'UE')
    .replace(/ß/g, 'SS');

  // General fallback: strip remaining diacritics (é→e, ñ→n, etc.)
  result = result.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  return { normalized: result, changed: result !== query };
}

/**
 * Detect if a search query looks like a field/column name rather than
 * an object name. Field names are short, uppercase, and typically don't
 * start with Z/Y (which are custom object prefixes).
 */
export function looksLikeFieldName(query: string): boolean {
  // Wildcard patterns are object searches, not field names
  if (query.includes('*')) return false;
  if (query.length === 0 || query.length > 15) return false;
  // Must be uppercase letters, digits, underscores only
  if (!/^[A-Z0-9_]+$/.test(query)) return false;
  // Z/Y prefix → more likely an object name
  if (/^[ZY]/.test(query)) return false;
  return true;
}

function hasSqlParserSignature(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes('only one select statement is allowed') ||
    normalized.includes('only select statement is allowed') ||
    normalized.includes('invalid query string') ||
    normalized.includes('due to grammar') ||
    normalized.includes('is invalid here') ||
    normalized.includes('is invalid at this position')
  );
}

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
    // Append additional SAP messages (line numbers, secondary errors) if available
    const enriched = enrichWithSapDetails(err, message);
    const argType = String(args.type ?? '').toUpperCase();
    const classification = classifySapDomainError(err.statusCode, err.responseBody, err.path);

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
    const argType = String(args.type ?? '').toUpperCase();
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

function isDeleteDependencyError(err: AdtApiError): boolean {
  const clean = AdtApiError.extractCleanMessage(err.responseBody ?? err.message).toLowerCase();
  const body = (err.responseBody ?? '').toLowerCase();
  const diagnostics = err.responseBody ? AdtApiError.extractDdicDiagnostics(err.responseBody) : [];

  if (diagnostics.some((diag) => diag.messageNumber === '039')) return true;

  return /could not be deleted|cannot be deleted|still in use|used by|dependent object|existing reference/.test(
    `${clean}\n${body}`,
  );
}

function formatCdsImpactBuckets(downstream: CdsImpactDownstream, maxNames = 4): string[] {
  const lines: string[] = [];

  for (const bucket of CDS_IMPACT_BUCKET_ORDER) {
    const entries = downstream[bucket];
    if (entries.length === 0) continue;
    const unique = Array.from(
      new Set(
        entries.map((entry) => {
          const mainType = entry.type.split('/')[0] || entry.type || '?';
          return `${entry.name} (${mainType})`;
        }),
      ),
    );
    const listed = unique.slice(0, maxNames).join(', ');
    const more = unique.length > maxNames ? ` (+${unique.length - maxNames} more)` : '';
    lines.push(`- ${CDS_IMPACT_BUCKET_LABEL[bucket]}: ${listed}${more}`);
  }

  return lines;
}

function mainObjectType(type: string): string {
  // First consult SLASH_TYPE_MAP so collapsed types (TABL/DS → TABL, legacy
  // STRU/DS → TABL) resolve to ARC-1's canonical short type. Then fall back to
  // splitting on '/' so unknown slash forms (e.g. BDEF/BO from where-used
  // results) still produce the parent type rather than the full slash form.
  const normalized = normalizeObjectType(type);
  if (normalized && !normalized.includes('/')) return normalized;
  return type.split('/')[0]?.toUpperCase() ?? '';
}

function collectOrderedCdsObjects(
  downstream: CdsImpactDownstream,
  bucketOrder: readonly CdsImpactBucket[],
): CdsOrderedObject[] {
  const seen = new Set<string>();
  const ordered: CdsOrderedObject[] = [];

  for (const bucket of bucketOrder) {
    for (const entry of downstream[bucket]) {
      const type = mainObjectType(entry.type);
      const name = String(entry.name ?? '').toUpperCase();
      if (!type || !name || !CDS_ORDERABLE_TYPES.has(type)) continue;
      const key = `${type}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push({ type, name });
    }
  }

  return ordered;
}

function dedupeCdsObjects(objects: readonly CdsOrderedObject[]): CdsOrderedObject[] {
  const seen = new Set<string>();
  const deduped: CdsOrderedObject[] = [];
  for (const obj of objects) {
    const key = `${obj.type}:${obj.name.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(obj);
  }
  return deduped;
}

function formatCdsObjectList(objects: readonly CdsOrderedObject[], max = 8): string {
  if (objects.length === 0) return '';
  const listed = objects
    .slice(0, max)
    .map((obj) => `${obj.type} ${obj.name}`)
    .join(', ');
  return objects.length > max ? `${listed} (+${objects.length - max} more)` : listed;
}

function formatCdsActivationPayload(objects: readonly CdsOrderedObject[], max = 8): string {
  if (objects.length === 0) return '[]';
  const listed = objects
    .slice(0, max)
    .map((obj) => `{type:"${obj.type}",name:"${obj.name}"}`)
    .join(', ');
  return objects.length > max ? `[${listed}, ...] (+${objects.length - max} more)` : `[${listed}]`;
}

function dedupeWhereUsedResults(results: readonly WhereUsedResult[]): WhereUsedResult[] {
  const seen = new Set<string>();
  const deduped: WhereUsedResult[] = [];

  for (const result of results) {
    const uriKey = result.uri.toLowerCase();
    const fallbackKey = `${mainObjectType(result.type)}:${String(result.name ?? '').toUpperCase()}`;
    const key = uriKey || fallbackKey;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }

  return deduped;
}

function isCdsImpactWhereUsedType(objectType: string): boolean {
  return CDS_IMPACT_WHERE_USED_TYPES.has(mainObjectType(objectType));
}

async function loadScopedCdsWhereUsedResults(client: AdtClient, objectUrl: string): Promise<WhereUsedResult[]> {
  try {
    const scope = await getWhereUsedScope(client.http, client.safety, objectUrl);
    const scopedTypes = Array.from(
      new Set(
        scope.entries
          .filter((entry) => entry.count > 0 && isCdsImpactWhereUsedType(entry.objectType))
          .map((entry) => entry.objectType),
      ),
    );
    const scopedResults: WhereUsedResult[] = [];

    for (const objectType of scopedTypes) {
      try {
        scopedResults.push(...(await findWhereUsed(client.http, client.safety, objectUrl, objectType)));
      } catch {
        // Scoped results only enrich guidance; one unsupported filter must not
        // make the write/delete/activate path fail.
      }
    }

    return scopedResults;
  } catch (err) {
    if (err instanceof AdtApiError && [404, 405, 415, 501].includes(err.statusCode)) {
      return [];
    }
    // Where-used enrichment is advisory; the original write/delete/activate
    // result should not fail just because a scoped lookup is unavailable.
    return [];
  }
}

async function loadCdsImpactDownstream(client: AdtClient, objectUrl: string): Promise<CdsImpactDownstream | undefined> {
  try {
    const whereUsed = await findWhereUsed(client.http, client.safety, objectUrl);
    // Some SAP releases return a shallow/default result set for unfiltered
    // usageReferences. Scope + object-type filters usually expose the full
    // bucket fan-out, which is exactly what CRUD guidance needs.
    const scopedWhereUsed = await loadScopedCdsWhereUsedResults(client, objectUrl);
    const combinedWhereUsed = dedupeWhereUsedResults([...whereUsed, ...scopedWhereUsed]);
    return classifyCdsImpact(combinedWhereUsed, { includeIndirect: true });
  } catch (err) {
    if (err instanceof AdtApiError && [404, 405, 415, 501].includes(err.statusCode)) {
      return undefined;
    }
    return undefined;
  }
}

async function buildCdsUpdateCrudHint(client: AdtClient, name: string, objectUrl: string): Promise<string> {
  const lines: string[] = [];
  lines.push(`CDS update follow-up for ${name}:`);

  const downstream = await loadCdsImpactDownstream(client, objectUrl);
  let orderedReactivation: CdsOrderedObject[] = [];
  if (downstream) {
    const bucketLines = formatCdsImpactBuckets(downstream);
    if (bucketLines.length > 0) {
      lines.push(`- Downstream consumers in ADT where-used index: ${downstream.summary.total}`);
      lines.push(...bucketLines);
      orderedReactivation = collectOrderedCdsObjects(downstream, CDS_REACTIVATION_BUCKET_ORDER);
    } else {
      lines.push('- No downstream consumers found in the current ADT where-used index.');
    }
  } else {
    lines.push('- Where-used index is unavailable on this system (impact list could not be fetched).');
  }

  lines.push(`- SAPWrite(update) stores inactive source only. Run SAPActivate(type="DDLS", name="${name}").`);
  lines.push('- Field/alias/signature changes may require re-activation of dependent DDLS/BDEF/SRVD/DDLX objects.');
  if (orderedReactivation.length > 0) {
    const activationPlan = dedupeCdsObjects([{ type: 'DDLS', name }, ...orderedReactivation]);
    lines.push(`- Suggested re-activation order: ${formatCdsObjectList(activationPlan)}.`);
    lines.push(`- Batch call template: SAPActivate(objects=${formatCdsActivationPayload(activationPlan)}).`);
  }

  return lines.join('\n');
}

async function buildCdsDeleteDependencyHint(
  client: AdtClient,
  type: string,
  name: string,
  objectUrl: string,
): Promise<string | undefined> {
  const downstream = await loadCdsImpactDownstream(client, objectUrl);
  if (!downstream || downstream.summary.total === 0) {
    const lines: string[] = [];
    lines.push(`Delete dependency follow-up for ${type} ${name}:`);
    if (!downstream) {
      lines.push('- ADT where-used lookup is unavailable on this system or failed during error enrichment.');
    } else {
      lines.push(
        '- No current ADT where-used dependents were returned, but SAP still rejected delete with a DDIC dependency error.',
      );
    }
    lines.push(
      '- If dependents were just deleted, wait briefly and retry; SAP active dependency/index state can lag in the same cleanup session.',
    );
    lines.push(
      `- If source was stripped or restored, run SAPActivate(type="${type}", name="${name}") first; delete checks active DDIC dependencies.`,
    );
    lines.push(
      `- If it keeps failing, run SAPNavigate(action="references", type="${type}", name="${name}") and check for edit locks/inactive objects before retrying.`,
    );
    return lines.join('\n');
  }

  const lines: string[] = [];
  lines.push(`Blocking dependents for ${type} ${name} (ADT where-used):`);
  lines.push(...formatCdsImpactBuckets(downstream));
  const orderedDelete = collectOrderedCdsObjects(downstream, CDS_DELETE_BUCKET_ORDER);
  if (orderedDelete.length > 0) {
    lines.push(`Suggested delete order: ${formatCdsObjectList(orderedDelete)}, then ${type} ${name}.`);
  }
  lines.push(
    `Delete/refactor these dependents first, then retry SAPWrite(action="delete", type="${type}", name="${name}").`,
  );
  lines.push(
    'If the listed dependents were just deleted, wait briefly and retry; SAP active dependency/index state can lag in the same cleanup session.',
  );
  lines.push(
    'For cyclic CDS projection graphs, temporarily strip redirected/composition associations, activate stripped DDLS, then delete.',
  );
  lines.push('If source was already stripped, activate first — delete checks active version dependencies.');

  return lines.join('\n');
}

async function buildCdsActivationDependencyHint(client: AdtClient, name: string, objectUrl: string): Promise<string> {
  const lines: string[] = [];
  const downstream = await loadCdsImpactDownstream(client, objectUrl);
  let orderedReactivation: CdsOrderedObject[] = [];

  lines.push(`CDS activation impact for ${name}:`);
  if (!downstream || downstream.summary.total === 0) {
    lines.push('- No downstream consumers found in ADT where-used index, or index is unavailable.');
  } else {
    lines.push(...formatCdsImpactBuckets(downstream));
    orderedReactivation = collectOrderedCdsObjects(downstream, CDS_REACTIVATION_BUCKET_ORDER);
  }
  lines.push('- When fields/elements change, dependents may fail until re-activated in dependency order.');
  if (orderedReactivation.length > 0) {
    const activationPlan = dedupeCdsObjects([{ type: 'DDLS', name }, ...orderedReactivation]);
    lines.push(`- Suggested re-activation order: ${formatCdsObjectList(activationPlan)}.`);
    lines.push(`- Batch call template: SAPActivate(objects=${formatCdsActivationPayload(activationPlan)}).`);
  } else {
    lines.push(`- Try SAPActivate(objects=[{type:"DDLS",name:"${name}"}, ...dependents...]).`);
  }

  return lines.join('\n');
}

/** Run a syntax check on the inactive version and format the errors for appending to an
 *  error message. Returns '' on any failure or when no errors are reported. */
async function inactiveSyntaxDiagnostic(client: AdtClient, type: string, name: string): Promise<string> {
  try {
    const checkResult = await syntaxCheck(client.http, client.safety, objectUrlForType(type, name), {
      version: 'inactive',
    });
    if (!checkResult.hasErrors) return '';

    const errors = checkResult.messages.filter((msg) => msg.severity === 'error');
    if (errors.length === 0) return '';

    const lines = errors.map((msg) => {
      const prefix = msg.line ? `[line ${msg.line}] ` : '';
      const suffix = msg.uri ? ` (${msg.uri})` : '';
      return `- ${prefix}${msg.text}${suffix}`;
    });

    return `\nServer syntax check (inactive):\n${lines.join('\n')}`;
  } catch {
    return '';
  }
}

async function tryPostSaveSyntaxCheck(client: AdtClient, type: string, name: string): Promise<string> {
  if (!DDIC_POST_SAVE_CHECK_TYPES.has(type.toUpperCase())) return '';
  return inactiveSyntaxDiagnostic(client, type, name);
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
): Promise<ToolResult> {
  const reqId = generateRequestId();
  const start = Date.now();

  // Build user context for audit logging
  const user = authInfo?.extra?.userName as string | undefined;
  const clientId = authInfo?.clientId;

  // Emit tool_call_start audit event
  logger.emitAudit({
    timestamp: new Date().toISOString(),
    level: 'info',
    event: 'tool_call_start',
    requestId: reqId,
    user,
    clientId,
    tool: toolName,
    args: sanitizeArgs(args),
  });

  // Unified scope enforcement via ACTION_POLICY — routes through action/type-aware lookup.
  // For SAPRead, the policy key is Tool.{type}; for other action-bearing tools, Tool.{action};
  // for tools without an action/type enum (SAPSearch, SAPQuery), the tool-level default applies.
  // For SAPSearch.tadir_lookup with source='db'|'both', synthesize a sub-action key so the
  // sql-scoped policy entry kicks in (otherwise viewer-only profiles could piggyback on the
  // ADT info-system route to issue freestyle SQL).
  // Runs BEFORE Zod validation so scope errors don't leak schema details to unauthorized callers.
  let actionOrType: string | undefined =
    toolName === 'SAPRead'
      ? typeof args.type === 'string'
        ? args.type
        : undefined
      : typeof args.action === 'string'
        ? args.action
        : undefined;
  if (
    toolName === 'SAPSearch' &&
    typeof args.searchType === 'string' &&
    args.searchType === 'tadir_lookup' &&
    typeof args.source === 'string'
  ) {
    const src = args.source.toLowerCase();
    if (src === 'db' || src === 'both') {
      actionOrType = `tadir_lookup_${src}`;
    }
  }
  const policy = getActionPolicy(toolName, actionOrType);

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
    args = normalizeTypeArgsForValidation(toolName, args);
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
      let result: ToolResult;

      switch (toolName) {
        case 'SAPRead':
          result = await handleSAPRead(client, args, cachingLayer);
          break;
        case 'SAPSearch':
          result = await handleSAPSearch(client, args);
          break;
        case 'SAPQuery':
          result = await handleSAPQuery(client, args);
          break;
        case 'SAPWrite':
          result = await handleSAPWrite(client, args, config, cachingLayer);
          break;
        case 'SAPActivate':
          result = await handleSAPActivate(client, args, cachingLayer);
          break;
        case 'SAPNavigate':
          result = await handleSAPNavigate(client, args);
          break;
        case 'SAPLint':
          result = await handleSAPLint(client, args, config);
          break;
        case 'SAPDiagnose':
          result = await handleSAPDiagnose(client, args);
          break;
        case 'SAPTransport':
          result = await handleSAPTransport(client, args);
          break;
        case 'SAPGit':
          result = await handleSAPGit(client, args, authInfo);
          break;
        case 'SAPContext':
          result = await handleSAPContext(client, args, cachingLayer);
          break;
        case 'SAPManage':
          result = await handleSAPManage(client, config, args, cachingLayer, isPerUserClient);
          break;
        case 'SAP': {
          // Hyperfocused mode: route to the appropriate handler
          const expanded = expandHyperfocusedArgs(args);
          if ('error' in expanded) {
            result = errorResult(expanded.error);
            break;
          }
          // Delegate to the real handler (recursive call, but with the mapped tool name)
          // The concrete tool/action policy is enforced by the recursive call.
          result = await handleToolCall(
            client,
            config,
            expanded.toolName,
            expanded.expandedArgs,
            authInfo,
            _server,
            cachingLayer,
            isPerUserClient,
          );
          break;
        }
        default:
          result = errorResult(`Unknown tool: ${toolName}`);
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
function isBtpSystem(): boolean {
  return cachedFeatures?.systemType === 'btp';
}

/** BTP-specific error messages for unavailable operations */
const BTP_HINTS: Record<string, string> = {
  PROG: 'Executable programs (reports) are not available on BTP ABAP Environment. Use CLAS with IF_OO_ADT_CLASSRUN for console applications.',
  INCL: 'Includes are not available on BTP ABAP Environment. Use classes and interfaces instead — INCLUDE is forbidden in ABAP Cloud.',
  VIEW: 'Classic DDIC views are not available on BTP ABAP Environment. Use DDLS (CDS views) instead.',
  TEXT_ELEMENTS:
    'Text elements are not available on BTP ABAP Environment (no classic programs). Use message classes or constant classes instead.',
  VARIANTS: 'Variants are not available on BTP ABAP Environment (no classic programs).',
  SOBJ: 'BOR business objects (SOBJ) are not available on BTP ABAP Environment. Use RAP behavior definitions (BDEF) instead.',
  TRAN: 'Transaction codes (TRAN) are not available on BTP ABAP Environment. Use SAPSearch to find apps and services instead.',
};

type SourceVersion = 'active' | 'inactive';
type RequestedSourceVersion = SourceVersion | 'auto';

const VERSIONED_SOURCE_READ_TYPES = new Set([
  'PROG',
  'CLAS',
  'INTF',
  'FUNC',
  'INCL',
  'DDLS',
  'DCLS',
  'BDEF',
  'SRVD',
  'DDLX',
  'SRVB',
  'SKTD',
  'TABL',
  'VIEW',
]);

function inactiveTypeMatches(readType: string, inactiveType: string): boolean {
  return (inactiveType.split('/')[0] ?? inactiveType).toUpperCase() === readType.toUpperCase();
}

async function resolveVersionAndDraftInfo(
  client: AdtClient,
  cachingLayer: CachingLayer | undefined,
  type: string,
  name: string,
  requestedVersion: RequestedSourceVersion,
): Promise<{ effectiveVersion: SourceVersion; draft?: InactiveObject }> {
  if (!VERSIONED_SOURCE_READ_TYPES.has(type)) {
    return { effectiveVersion: requestedVersion === 'auto' ? 'active' : requestedVersion };
  }

  let draft: InactiveObject | undefined;
  if (cachingLayer || requestedVersion !== 'active') {
    try {
      const inactiveObjects = cachingLayer
        ? await cachingLayer.inactiveLists.getOrFetch(client)
        : await client.getInactiveObjects();
      const upperName = name.toUpperCase();
      draft = inactiveObjects.find(
        (object) => inactiveTypeMatches(type, object.type) && object.name.toUpperCase() === upperName,
      );
    } catch (err) {
      logger.debug('Inactive object list unavailable while resolving source version', {
        type,
        name,
        requestedVersion,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (requestedVersion === 'auto') {
    return { effectiveVersion: draft ? 'inactive' : 'active', draft };
  }
  return { effectiveVersion: requestedVersion, draft };
}

function sourceVersionWarning(effectiveVersion: SourceVersion, draft?: InactiveObject): string | undefined {
  if (effectiveVersion === 'active' && draft) {
    const deletion = draft.deleted ? ' deletion' : '';
    const transport = draft.transport ? ` (in transport ${draft.transport})` : '';
    return `Note: You have an unactivated${deletion} draft of this object${transport}. The source below is the LAST ACTIVATED version. To work with your draft, activate it first via SAPActivate or re-run with version='inactive' to read it directly.`;
  }
  if (effectiveVersion === 'inactive' && !draft) {
    return 'Note: No inactive draft exists for this object on the server. Returning the active version.';
  }
  return undefined;
}

async function handleSAPRead(
  client: AdtClient,
  args: Record<string, unknown>,
  cachingLayer?: CachingLayer,
): Promise<ToolResult> {
  const type = normalizeObjectType(String(args.type ?? ''));
  const name = String(args.name ?? '');
  const requestedVersion = (args.version ?? 'active') as RequestedSourceVersion;

  // BTP: return helpful error for unavailable types
  if (isBtpSystem() && BTP_HINTS[type]) {
    return errorResult(BTP_HINTS[type]);
  }

  if (args.force_refresh === true && cachingLayer && VERSIONED_SOURCE_READ_TYPES.has(type)) {
    cachingLayer.inactiveLists.invalidate(client.username);
    cachingLayer.invalidate(type, name, 'all');
  }

  const { effectiveVersion, draft } = await resolveVersionAndDraftInfo(
    client,
    cachingLayer,
    type,
    name,
    requestedVersion,
  );
  const versionWarning = sourceVersionWarning(effectiveVersion, draft);

  // Helper: get source with cache support, returns cache hit status
  const cachedGet = async (
    objType: string,
    objName: string,
    version: SourceVersion,
    fetcher: (ifNoneMatch?: string) => Promise<SourceReadResult>,
  ): Promise<{ source: string; cacheHit: boolean; revalidated: boolean }> => {
    if (!cachingLayer) {
      const result = await fetcher(undefined);
      return { source: result.source, cacheHit: false, revalidated: false };
    }
    const { source, hit, revalidated } = await cachingLayer.getSource(objType, objName, fetcher, { version });
    return { source, cacheHit: hit, revalidated };
  };

  /** Prepend draft-awareness notes and cache indicator when the server revalidated a cached source. */
  const cachedTextResult = (source: string, cacheHit: boolean, revalidated: boolean, warning?: string): ToolResult => {
    const note = warning ? `${warning}\n\n` : '';
    const indicator = cacheHit && revalidated ? '[cached:revalidated]\n' : '';
    return textResult(`${note}${indicator}${source}`);
  };

  // Structured format is only supported for CLAS type
  if (args.format === 'structured' && type !== 'CLAS') {
    return errorResult('The "structured" format is only supported for CLAS type. Other types return text format.');
  }

  switch (type) {
    case 'PROG': {
      const { source, cacheHit, revalidated } = await cachedGet('PROG', name, effectiveVersion, (ifNoneMatch) =>
        client.getProgram(name, { ifNoneMatch, version: effectiveVersion }),
      );
      return cachedTextResult(source, cacheHit, revalidated, versionWarning);
    }
    case 'CLAS': {
      // Structured format: return JSON with metadata + decomposed source
      if (args.format === 'structured') {
        const structured = await client.getClassStructured(name);
        return textResult(JSON.stringify(structured, null, 2));
      }
      const methodParam = args.method as string | undefined;
      if (methodParam && !args.include) {
        // Method-level read — fetch full source then extract (no cache indicator for derived results)
        const { source: fullSource } = await cachedGet('CLAS', name, effectiveVersion, (ifNoneMatch) =>
          client.getClass(name, undefined, { ifNoneMatch, version: effectiveVersion }),
        );
        const abaplintVer = cachedFeatures?.abapRelease
          ? mapSapReleaseToAbaplintVersion(cachedFeatures.abapRelease)
          : undefined;
        if (methodParam === '*') {
          const listing = listMethods(fullSource, name, abaplintVer);
          return textResult(formatMethodListing(listing));
        }
        const extracted = extractMethod(fullSource, name, methodParam, abaplintVer);
        if (!extracted.success) {
          return errorResult(extracted.error ?? `Method "${methodParam}" not found in ${name}.`);
        }
        return cachedTextResult(extracted.methodSource, false, false, versionWarning);
      }
      // Only cache the full merged source (no include param), not individual includes
      if (!args.include) {
        const { source, cacheHit, revalidated } = await cachedGet('CLAS', name, effectiveVersion, (ifNoneMatch) =>
          client.getClass(name, undefined, { ifNoneMatch, version: effectiveVersion }),
        );
        return cachedTextResult(source, cacheHit, revalidated, versionWarning);
      }
      const includeResult = await client.getClass(name, args.include as string | undefined, {
        version: effectiveVersion,
      });
      return cachedTextResult(includeResult.source, false, false, versionWarning);
    }
    case 'INTF': {
      const { source, cacheHit, revalidated } = await cachedGet('INTF', name, effectiveVersion, (ifNoneMatch) =>
        client.getInterface(name, { ifNoneMatch, version: effectiveVersion }),
      );
      return cachedTextResult(source, cacheHit, revalidated, versionWarning);
    }
    case 'FUNC': {
      let group = String(args.group ?? '');
      if (!group) {
        // Use cached func group resolution if available
        const resolved = cachingLayer
          ? await cachingLayer.resolveFuncGroup(client, name)
          : await client.resolveFunctionGroup(name);
        if (!resolved) {
          return errorResult(
            `Cannot resolve function group for "${name}". Provide the group parameter explicitly, or use SAPSearch("${name}") to find the function group.`,
          );
        }
        group = resolved;
      }
      const { source, cacheHit, revalidated } = await cachedGet('FUNC', name, effectiveVersion, (ifNoneMatch) =>
        client.getFunction(group, name, { ifNoneMatch, version: effectiveVersion }),
      );
      // Issue #252: when caller asks for includeSignature, return JSON with the
      // source body and the parsed structured signature.
      if (args.includeSignature === true) {
        const parsed = parseFmSignature(source);
        const grouped: Record<FmParameterKind, FmParameter[]> = {
          importing: [],
          exporting: [],
          changing: [],
          tables: [],
          exceptions: [],
          raising: [],
        };
        for (const p of parsed.params) grouped[p.kind].push(p);
        const payload = {
          source,
          signature: grouped,
        };
        return textResult(JSON.stringify(payload, null, 2));
      }
      return cachedTextResult(source, cacheHit, revalidated, versionWarning);
    }
    case 'FUGR': {
      const expand = Boolean(args.expand_includes);
      if (expand) {
        const { source } = await client.getFunctionGroupSource(name, { version: effectiveVersion });
        // Match INCLUDE statements but skip ABAP comment lines (starting with *)
        const includePattern = /^[^*\n]*\bINCLUDE\s+(\S+)\s*\./gim;
        const parts: string[] = [`=== FUGR ${name} (main) ===\n${source}`];
        let m: RegExpExecArray | null;
        while ((m = includePattern.exec(source)) !== null) {
          const inclName = m[1]!;
          try {
            const { source: inclSource } = await client.getInclude(inclName, { version: effectiveVersion });
            parts.push(`\n=== ${inclName} ===\n${inclSource}`);
          } catch {
            parts.push(`\n=== ${inclName} ===\n[Could not read include "${inclName}"]`);
          }
        }
        return textResult(parts.join('\n'));
      }
      const fg = await client.getFunctionGroup(name);
      return textResult(JSON.stringify(fg, null, 2));
    }
    case 'INCL': {
      const { source, cacheHit, revalidated } = await cachedGet('INCL', name, effectiveVersion, (ifNoneMatch) =>
        client.getInclude(name, { ifNoneMatch, version: effectiveVersion }),
      );
      return cachedTextResult(source, cacheHit, revalidated, versionWarning);
    }
    case 'DDLS': {
      const {
        source: ddlSource,
        cacheHit,
        revalidated,
      } = await cachedGet('DDLS', name, effectiveVersion, (ifNoneMatch) =>
        client.getDdls(name, { ifNoneMatch, version: effectiveVersion }),
      );
      if (ddlSource.trim() === '') {
        return textResult(
          `DDLS ${name} exists in the object directory but has no source code stored. ` +
            `The DDL source may need to be written via SAPWrite(action="create" or "update", type="DDLS", name="${name}", source="...").`,
        );
      }
      if ((args.include as string | undefined)?.toLowerCase() === 'elements') {
        // Elements extraction is derived from source — no cache indicator
        return cachedTextResult(extractCdsElements(ddlSource, name), false, false, versionWarning);
      }
      return cachedTextResult(ddlSource, cacheHit, revalidated, versionWarning);
    }
    case 'DCLS': {
      const { source, cacheHit, revalidated } = await cachedGet('DCLS', name, effectiveVersion, (ifNoneMatch) =>
        client.getDcl(name, { ifNoneMatch, version: effectiveVersion }),
      );
      return cachedTextResult(source, cacheHit, revalidated, versionWarning);
    }
    case 'BDEF': {
      const { source, cacheHit, revalidated } = await cachedGet('BDEF', name, effectiveVersion, (ifNoneMatch) =>
        client.getBdef(name, { ifNoneMatch, version: effectiveVersion }),
      );
      return cachedTextResult(source, cacheHit, revalidated, versionWarning);
    }
    case 'SRVD': {
      const { source, cacheHit, revalidated } = await cachedGet('SRVD', name, effectiveVersion, (ifNoneMatch) =>
        client.getSrvd(name, { ifNoneMatch, version: effectiveVersion }),
      );
      return cachedTextResult(source, cacheHit, revalidated, versionWarning);
    }
    case 'DDLX': {
      try {
        const { source, cacheHit, revalidated } = await cachedGet('DDLX', name, effectiveVersion, (ifNoneMatch) =>
          client.getDdlx(name, { ifNoneMatch, version: effectiveVersion }),
        );
        return cachedTextResult(source, cacheHit, revalidated, versionWarning);
      } catch (err) {
        if (isNotFoundError(err)) {
          return textResult(
            `No metadata extension (DDLX) found for "${name}". This means no @UI annotations are defined via DDLX for this view. The view may use inline annotations in the DDLS source, or the Fiori app may configure columns via manifest.json / app descriptor.`,
          );
        }
        throw err;
      }
    }
    case 'SRVB': {
      const { source, cacheHit, revalidated } = await cachedGet('SRVB', name, effectiveVersion, (ifNoneMatch) =>
        client.getSrvb(name, { ifNoneMatch, version: effectiveVersion }),
      );
      return cachedTextResult(source, cacheHit, revalidated, versionWarning);
    }
    case 'SKTD': {
      try {
        // ADT returns a <sktd:docu> XML envelope with the Markdown body base64-encoded
        // inside <sktd:text>. Cache the raw envelope (update flow re-uses it) and
        // return the decoded Markdown to the LLM.
        const { source, cacheHit, revalidated } = await cachedGet('SKTD', name, effectiveVersion, (ifNoneMatch) =>
          client.getKtd(name, { ifNoneMatch, version: effectiveVersion }),
        );
        return cachedTextResult(decodeKtdText(source), cacheHit, revalidated, versionWarning);
      } catch (err) {
        if (isNotFoundError(err)) {
          return textResult(
            `No Knowledge Transfer Document (SKTD) found for "${name}". KTD docs are optional Markdown documentation attached to ABAP objects — either one was never created for "${name}", or the name is wrong.`,
          );
        }
        throw err;
      }
    }
    case 'TABL': {
      // Unified TABL: covers transparent tables and DDIC structures (Model B).
      // client.getTabl() handles the /tables/ → /structures/ fallback internally
      // and caches the resolved URL for subsequent write/activate paths.
      const { source, cacheHit, revalidated } = await cachedGet('TABL', name, effectiveVersion, (ifNoneMatch) =>
        client.getTabl(name, { ifNoneMatch, version: effectiveVersion }),
      );
      return cachedTextResult(source, cacheHit, revalidated, versionWarning);
    }
    case 'VIEW': {
      const { source, cacheHit, revalidated } = await cachedGet('VIEW', name, effectiveVersion, (ifNoneMatch) =>
        client.getView(name, { ifNoneMatch, version: effectiveVersion }),
      );
      return cachedTextResult(source, cacheHit, revalidated, versionWarning);
    }
    case 'DOMA': {
      const domain = await client.getDomain(name);
      return textResult(JSON.stringify(domain, null, 2));
    }
    case 'DTEL': {
      const dtel = await client.getDataElement(name);
      return textResult(JSON.stringify(dtel, null, 2));
    }
    case 'AUTH': {
      const authField = await client.getAuthorizationField(name);
      return textResult(JSON.stringify(authField, null, 2));
    }
    case 'FTG2':
    case 'FEATURE_TOGGLE': {
      // FEATURE_TOGGLE is the canonical short type. 'FTG2' is a deprecated alias —
      // see research/abap-types/types/ftg2.md (ARC-1-invented; zero hits in TADIR,
      // abap-file-formats, Eclipse apidoc). Removed in the next minor.
      if (type === 'FTG2') {
        logger.warn('SAPRead type "FTG2" is deprecated — use "FEATURE_TOGGLE" instead', {
          type: 'FTG2',
          replacement: 'FEATURE_TOGGLE',
        });
      }
      const toggle = await client.getFeatureToggle(name);
      return textResult(JSON.stringify(toggle, null, 2));
    }
    case 'ENHO': {
      const enhancement = await client.getEnhancementImplementation(name);
      return textResult(JSON.stringify(enhancement, null, 2));
    }
    case 'VERSIONS': {
      const include = typeof args.include === 'string' ? args.include : undefined;
      let group = typeof args.group === 'string' ? args.group : undefined;
      const objectType = normalizeObjectType(String(args.objectType ?? '')) || inferObjectType(name) || 'PROG';

      if (objectType === 'FUNC' && !group) {
        const resolved = cachingLayer
          ? await cachingLayer.resolveFuncGroup(client, name)
          : await client.resolveFunctionGroup(name);
        if (!resolved) {
          return errorResult(
            `Cannot resolve function group for "${name}". Provide the group parameter explicitly, or use SAPSearch("${name}") to find the function group.`,
          );
        }
        group = resolved;
      }

      try {
        const revisions = await client.getRevisions(objectType, name, { include, group });
        return textResult(JSON.stringify(revisions, null, 2));
      } catch (err) {
        if (isNotFoundError(err)) {
          return textResult(
            `No version history available for ${objectType} "${name}" on this SAP system. ` +
              `This usually means the object does not exist, or the ADT versions endpoint is not supported for ${objectType} on this backend release.`,
          );
        }
        throw err;
      }
    }
    case 'VERSION_SOURCE': {
      const versionUri = String(args.versionUri ?? '');
      if (!versionUri) {
        return errorResult(
          'VERSION_SOURCE requires a versionUri parameter. Get it from SAPRead(type="VERSIONS", name="...") response (.revisions[].uri).',
        );
      }
      try {
        return textResult(await client.getRevisionSource(versionUri));
      } catch (err) {
        if (isNotFoundError(err)) {
          return errorResult(
            `Revision at URI "${versionUri}" was not found. The revision may have been removed, or the URI is malformed. Fetch a fresh list via SAPRead(type="VERSIONS", name="...").`,
          );
        }
        throw err;
      }
    }
    case 'TRAN': {
      const tran = await client.getTransaction(name);
      // Enrich with program name via SQL — only if free SQL is allowed by safety config
      if (isOperationAllowed(client.safety, OperationType.FreeSQL)) {
        try {
          const safeName = name.toUpperCase().replace(/[^A-Z0-9_/]/g, '');
          const data = await client.runQuery(`SELECT TCODE, PGMNA FROM TSTC WHERE TCODE = '${safeName}'`, 1);
          if (data.rows.length > 0) {
            tran.program = String(data.rows[0]!.PGMNA ?? '').trim();
          }
        } catch {
          // SQL failed (e.g., TSTC not found on BTP) — still return metadata
        }
      }
      return textResult(JSON.stringify(tran, null, 2));
    }
    case 'API_STATE': {
      // Determine object type for URL construction — use explicit objectType, infer from name, or error
      const explicitType = normalizeObjectType(String(args.objectType ?? ''));
      const inferredType = explicitType || inferObjectType(name);
      if (!inferredType) {
        return errorResult(
          `Cannot infer object type from name "${name}". Please specify objectType explicitly (e.g., objectType="CLAS", "INTF", "PROG", "TABL", "DDLS", "DCLS", "FUGR", "DOMA", "DTEL", "SRVD", "SRVB", "BDEF").`,
        );
      }
      // Use raw URI (no name encoding) — getApiReleaseState encodes the full URI as a single path segment
      const objectUri = objectUrlForTypeRaw(inferredType, name);
      const releaseState = await client.getApiReleaseState(objectUri);
      return textResult(JSON.stringify(releaseState, null, 2));
    }
    case 'TABLE_CONTENTS': {
      const maxRows = Number(args.maxRows ?? 100);
      const data = await client.getTableContents(name, maxRows, args.sqlFilter as string | undefined);
      return textResult(JSON.stringify(data, null, 2));
    }
    case 'SOBJ': {
      const method = String(args.method ?? '');
      // Sanitize inputs to prevent SQL injection — BOR names are alphanumeric + underscore only
      const safeName = name.toUpperCase().replace(/[^A-Z0-9_/]/g, '');
      const safeMethod = method.toUpperCase().replace(/[^A-Z0-9_]/g, '');
      if (safeName !== name.toUpperCase().replace(/\s/g, '')) {
        return errorResult(
          `Invalid BOR object name: "${name}". Only alphanumeric characters, underscores, and slashes are allowed.`,
        );
      }
      if (safeMethod) {
        // Read specific BOR method implementation via SWOTLV lookup
        const data = await client.runQuery(
          `SELECT PROGNAME, FORMNAME FROM SWOTLV WHERE LOBJTYPE = '${safeName}' AND VERB = '${safeMethod}'`,
          1,
        );
        if (data.rows.length > 0) {
          const prog = String(data.rows[0]!.PROGNAME ?? '').trim();
          if (!prog) {
            return errorResult(`BOR method "${method}" on "${name}" has no program assigned.`);
          }
          const { source } = await client.getProgram(prog);
          return textResult(
            `=== BOR ${name}.${method} (program: ${prog}, form: ${String(data.rows[0]!.FORMNAME ?? '').trim()}) ===\n${source}`,
          );
        }
        return errorResult(
          `BOR method "${method}" not found on object type "${name}". Use SAPRead(type="SOBJ", name="${name}") without method to list all methods.`,
        );
      }
      // List all methods for this BOR object
      const methods = await client.runQuery(
        `SELECT VERB, PROGNAME, FORMNAME, DESCRIPT FROM SWOTLV WHERE LOBJTYPE = '${safeName}'`,
        100,
      );
      if (methods.rows.length === 0) {
        return errorResult(`No BOR methods found for object type "${name}". Verify the BOR object type name.`);
      }
      return textResult(JSON.stringify(methods, null, 2));
    }
    case 'DEVC': {
      const maxResults = args.maxResults != null ? Number(args.maxResults) : undefined;
      const contents = await client.getPackageContents(name, maxResults);
      return textResult(JSON.stringify(contents, null, 2));
    }
    case 'SYSTEM':
      return textResult(await client.getSystemInfo());
    case 'COMPONENTS': {
      const components = await client.getInstalledComponents();
      return textResult(JSON.stringify(components, null, 2));
    }
    case 'MESSAGES':
    case 'MSAG': {
      // MSAG is the canonical TADIR R3TR type for message classes; 'MESSAGES' is a
      // deprecated read alias kept for one minor release. See
      // research/abap-types/types/msag.md.
      if (type === 'MESSAGES') {
        logger.warn('SAPRead type "MESSAGES" is deprecated — use "MSAG" instead', {
          type: 'MESSAGES',
          replacement: 'MSAG',
        });
      }
      try {
        const mcInfo = await client.getMessageClassInfo(name);
        return textResult(JSON.stringify(mcInfo, null, 2));
      } catch {
        // Fall back to legacy endpoint if messageclass endpoint unavailable
        return textResult(await client.getMessages(name));
      }
    }
    case 'TEXT_ELEMENTS':
      return textResult(await client.getTextElements(name));
    case 'VARIANTS':
      return textResult(await client.getVariants(name));
    case 'BSP': {
      if (cachedFeatures?.ui5 && !cachedFeatures.ui5.available) {
        return errorResult(
          'UI5/Fiori BSP Filestore is not available on this SAP system. ' +
            'Run SAPManage(action="probe") to verify feature availability.',
        );
      }
      const include = args.include as string | undefined;
      if (!name) {
        // List all BSP apps (optional search via query param not used here since name is empty)
        const apps = await client.listBspApps();
        return textResult(JSON.stringify(apps, null, 2));
      }
      if (!include) {
        // Browse root structure of the app
        return textResult(JSON.stringify(await client.getBspAppStructure(name), null, 2));
      }
      // If include contains a dot, treat as file read; otherwise browse subfolder
      if (include.includes('.')) {
        return textResult(await client.getBspFileContent(name, include));
      }
      return textResult(JSON.stringify(await client.getBspAppStructure(name, `/${include}`), null, 2));
    }
    case 'BSP_DEPLOY': {
      if (cachedFeatures?.ui5repo && !cachedFeatures.ui5repo.available) {
        return errorResult(
          'ABAP Repository OData Service is not available on this SAP system. ' +
            'Run SAPManage(action="probe") to verify feature availability.',
        );
      }
      if (!name) {
        return errorResult('BSP_DEPLOY requires a name parameter (e.g., name="ZAPP_BOOKING").');
      }
      const info = await getAppInfo(client.http, client.safety, name);
      if (!info) {
        return textResult(`App "${name}" not found in ABAP Repository.`);
      }
      return textResult(JSON.stringify(info, null, 2));
    }
    case 'INACTIVE_OBJECTS': {
      const objects = await client.getInactiveObjects();
      return textResult(JSON.stringify({ count: objects.length, objects }, null, 2));
    }
    default:
      return errorResult(
        `Unknown SAPRead type: "${type}". Supported types: PROG, CLAS, INTF, FUNC, FUGR, INCL, DDLS, DCLS, DDLX, BDEF, SRVD, SRVB, SKTD, TABL, VIEW, DOMA, DTEL, MSAG, AUTH, FEATURE_TOGGLE, ENHO, VERSIONS, VERSION_SOURCE, TRAN, TABLE_CONTENTS, DEVC, SOBJ, SYSTEM, COMPONENTS, TEXT_ELEMENTS, VARIANTS, BSP, BSP_DEPLOY, API_STATE, INACTIVE_OBJECTS. Deprecated aliases: MESSAGES (use MSAG), FTG2 (use FEATURE_TOGGLE). ` +
          'Tip: Type aliases are auto-normalized (e.g., DDLS/DF → DDLS, DCLS/DL → DCLS, CLAS/OC → CLAS, PROG/P → PROG). ' +
          'Do not pass a URI — use the "type" and "name" parameters instead.',
      );
  }
}

async function handleSAPSearch(client: AdtClient, args: Record<string, unknown>): Promise<ToolResult> {
  const rawQuery = String(args.query ?? '');
  const maxResults = Number(args.maxResults ?? 100);
  const searchType = String(args.searchType ?? 'object');

  if (searchType === 'tadir_lookup') {
    const names = extractLookupNames(rawQuery, args.names);
    if (names.length === 0) {
      return errorResult('SAPSearch(searchType="tadir_lookup") requires names[] or query with at least one name.');
    }
    const objectTypes = extractLookupObjectTypes(args.objectType, args.objectTypes);
    const rawSource = typeof args.source === 'string' ? args.source.toLowerCase() : 'adt';
    const source: 'adt' | 'db' | 'both' =
      rawSource === 'db' || rawSource === 'both' ? (rawSource as 'db' | 'both') : 'adt';

    // Stamp each match with provenance so a merged 'both' result is unambiguous and
    // viewer tooling can colour-code ghost rows. The DB path already stamps `_origin:'db'`
    // (see `lookupObjectsViaDb`); we stamp ADT matches here.
    const tagOrigin = (lookups: AdtObjectLookupResult[], origin: 'adt' | 'db'): AdtObjectLookupResult[] =>
      lookups.map((l) => ({
        ...l,
        matches: l.matches.map((m) => ({ ...m, _origin: m._origin ?? origin })),
      }));

    let finalLookups: AdtObjectLookupResult[];
    const wildcardNames = names.filter((name) => name.includes('*'));
    const warnings: string[] = [];
    let splitBrain: string[] = [];

    if (source === 'adt') {
      finalLookups = tagOrigin(await client.lookupObjects(names, { maxResults, objectTypes }), 'adt');
    } else if (source === 'db') {
      // The 'db' path bypasses ADT info-system entirely; `lookupObjectsViaDb` already
      // tags matches with `_origin:'db'`. Safety/scope gating runs at handleToolCall
      // and in client.runQuery (FreeSQL operation), so unauthorized callers never reach here.
      finalLookups = await client.lookupObjectsViaDb(names, { maxResults, objectTypes });
    } else {
      // 'both' — parallel ADT + DB, merge per name with dedupe.
      const [adtLookups, dbLookups] = await Promise.all([
        client.lookupObjects(names, { maxResults, objectTypes }).then((r) => tagOrigin(r, 'adt')),
        client.lookupObjectsViaDb(names, { maxResults, objectTypes }),
      ]);

      const dbByName = new Map(dbLookups.map((l) => [l.name.toUpperCase(), l]));
      const adtByName = new Map(adtLookups.map((l) => [l.name.toUpperCase(), l]));

      finalLookups = names.map((rawName) => {
        const upper = rawName.toUpperCase();
        const adt = adtByName.get(upper);
        const db = dbByName.get(upper);
        const adtMatches = adt?.matches ?? [];
        const dbMatches = db?.matches ?? [];

        // Dedupe by (baseObjectType, objectName) — TADIR stores bare types ('DDLS')
        // while ADT info-system returns slash-form ('DDLS/DF'). Stripping the suffix
        // keeps the same logical object from appearing twice in the merged matches.
        // Preserve the more-specific slash form when both originate from ADT+DB.
        const seen = new Map<string, AdtSearchResult>();
        const baseKey = (m: AdtSearchResult): string =>
          `${(m.objectType.split('/')[0] || m.objectType).toUpperCase()} ${m.objectName.toUpperCase()}`;
        for (const m of adtMatches) seen.set(baseKey(m), m);
        for (const m of dbMatches) {
          const k = baseKey(m);
          if (!seen.has(k)) seen.set(k, m);
        }
        const mergedMatches = [...seen.values()];

        // Split-brain detection: an object is divergent if exactly one source has matches.
        // (Zero matches on both sides = consistent absence; matches on both = consistent presence.)
        if (adtMatches.length > 0 !== dbMatches.length > 0) {
          splitBrain.push(rawName);
        }

        return { name: rawName, found: mergedMatches.length > 0, matches: mergedMatches };
      });

      // Compose human-friendly warnings per split-brain name. Keep them grounded in
      // the most common cause (TADIR ghost from aborted create/delete) so LLM clients
      // can suggest the right cleanup path without inventing a new pointer.
      for (const name of splitBrain) {
        const adt = adtByName.get(name.toUpperCase());
        const db = dbByName.get(name.toUpperCase());
        const adtHas = (adt?.matches.length ?? 0) > 0;
        const dbHas = (db?.matches.length ?? 0) > 0;
        if (dbHas && !adtHas) {
          warnings.push(
            `${name} exists in TADIR (DB) but ADT cannot resolve it — likely a TADIR ghost from an aborted create/delete cycle. Consider RS_DD_TADIR_CLEANUP or manual SE03 cleanup.`,
          );
        } else if (adtHas && !dbHas) {
          warnings.push(
            `${name} resolves via ADT but is not present in the TADIR row scan — likely a release-time mismatch or a type filter excluding the row. Re-run with broader objectTypes or no filter to confirm.`,
          );
        }
      }
    }

    // Dedupe split-brain names (defensive; merge loop should already avoid duplicates).
    splitBrain = [...new Set(splitBrain)];

    if (wildcardNames.length > 0) {
      warnings.push(
        `tadir_lookup performs exact-name lookup; wildcard characters are treated literally for: ${wildcardNames.join(', ')}`,
      );
    }

    const missing = finalLookups.filter((l) => !l.found).map((l) => l.name);
    const matchCount = finalLookups.reduce((count, lookup) => count + lookup.matches.length, 0);

    const payload: Record<string, unknown> = { count: matchCount, lookups: finalLookups, missing };
    if (splitBrain.length > 0) payload.splitBrain = splitBrain;
    if (warnings.length > 0) payload.warnings = warnings;

    return textResult(JSON.stringify(payload, null, 2));
  }

  if (searchType === 'source_code') {
    // Source code search: do NOT transliterate — source can contain umlauts in strings/comments
    if (cachedFeatures?.textSearch && !cachedFeatures.textSearch.available) {
      return errorResult(
        `Source code search is not available on this SAP system. ${cachedFeatures.textSearch.reason ?? ''}` +
          `\nUse SAPSearch with searchType="object" to search by object name instead, or use SAPQuery to search metadata tables.`,
      );
    }
    const objectType = args.objectType ? normalizeObjectType(String(args.objectType)) : undefined;
    const packageName = args.packageName as string | undefined;
    try {
      const results = await client.searchSource(rawQuery, maxResults, objectType, packageName);
      return textResult(JSON.stringify(results, null, 2));
    } catch (err) {
      if (err instanceof AdtApiError) {
        const permanentCodes = [401, 403, 404, 501];
        if (permanentCodes.includes(err.statusCode)) {
          const classified = classifyTextSearchError(err.statusCode);
          return errorResult(
            `Source code search is not available on this SAP system. ${classified.reason ?? ''}` +
              `\nUse SAPSearch with searchType="object" to search by object name instead, or use SAPQuery to search metadata tables.`,
          );
        }
      }
      throw err;
    }
  }

  // Object search: transliterate non-ASCII (SAP object names are ASCII-only)
  const { normalized: query, changed: wasTransliterated } = transliterateQuery(rawQuery);
  const transliterationNote = wasTransliterated
    ? `Note: Query contained non-ASCII characters. Transliterated "${rawQuery}" → "${query}" (SAP object names are ASCII-only).\n\n`
    : '';

  const results = await client.searchObject(query, maxResults);
  if (Array.isArray(results) && results.length === 0) {
    let hint =
      '[]' +
      '\n\n' +
      transliterationNote +
      'No objects found. If searching for custom objects, try Z* or Y* prefixes (e.g., "Z*ESTIM*"). ' +
      'If you already found objects in a package, use SAPRead with type=DEVC to list all package contents instead of more searches.';
    if (looksLikeFieldName(query)) {
      const stripped = query.replace(/\*/g, '');
      hint += `\nThis looks like a field/column name. Use SAPQuery("SELECT fieldname, rollname, domname FROM dd03l WHERE fieldname = '${stripped}'") or SAPRead(type='DDLS', include='elements') to find fields.`;
    }
    return textResult(hint);
  }
  return textResult(transliterationNote + JSON.stringify(results, null, 2));
}

function extractLookupNames(query: string, rawNames: unknown): string[] {
  const fromNames = Array.isArray(rawNames) ? rawNames.map((n) => String(n).trim()).filter(Boolean) : [];
  const fromQuery = query
    .split(/[,\s]+/)
    .map((n) => n.trim())
    .filter(Boolean);
  return [...new Set([...fromNames, ...fromQuery].map((n) => n.toUpperCase()))];
}

function extractLookupObjectTypes(rawObjectType: unknown, rawObjectTypes: unknown): string[] {
  const types = Array.isArray(rawObjectTypes)
    ? rawObjectTypes.map((t) => normalizeObjectType(String(t))).filter(Boolean)
    : [];
  if (typeof rawObjectType === 'string' && rawObjectType.trim()) {
    types.push(normalizeObjectType(rawObjectType));
  }
  return [...new Set(types)];
}

function normalizePackageOverride(rawPackage: unknown, fallback: string): string {
  if (rawPackage === undefined || rawPackage === null) {
    return fallback;
  }
  const value = String(rawPackage).trim();
  return value || fallback;
}

function normalizeTransportOverride(rawTransport: unknown): string | undefined {
  if (rawTransport === undefined || rawTransport === null) {
    return undefined;
  }
  const value = String(rawTransport).trim();
  return value || undefined;
}

function classifySapQueryParserError(err: AdtApiError, sql: string): string | undefined {
  if (err.statusCode !== 400) return undefined;

  const combined = `${err.message}\n${err.responseBody ?? ''}`;
  if (!hasSqlParserSignature(combined)) return undefined;

  const hints = [
    'ADT freestyle SQL parser rejected this query on this backend/version.',
    'Submit exactly one SELECT statement (no semicolons, no multi-statement scripts).',
    'Remove ABAP target clauses from SQL text (INTO, APPENDING, PACKAGE SIZE).',
  ];

  if (/\bJOIN\b/i.test(sql)) {
    hints.push('JOIN parsing can fail on some systems (SAP Note 3605050); split into staged single-table queries.');
  }

  if (/\bINTO\b|\bAPPENDING\b|\bPACKAGE\s+SIZE\b/i.test(sql)) {
    hints.push('Use the MCP maxRows parameter for row limits instead of ABAP target-table clauses.');
  }

  return `${err.message}\n\nHint: ${hints.join(' ')}`;
}

const SAPQUERY_IN_LIST_CHUNK_SIZE = 8;

interface SimpleInListChunkPlan {
  statements: string[];
}

function planSimpleInListChunking(
  sql: string,
  chunkSize = SAPQUERY_IN_LIST_CHUNK_SIZE,
): SimpleInListChunkPlan | undefined {
  const maskedSql = maskSqlStringLiterals(sql);
  if (maskedSql.includes(';')) return undefined;
  if (countSelectKeywords(maskedSql) !== 1) return undefined;

  const matches = [...maskedSql.matchAll(/\b[A-Za-z_][A-Za-z0-9_~.]*\s+IN\s*\(/gi)];
  if (matches.length !== 1) return undefined;

  const match = matches[0]!;
  const matchText = match[0];
  const fieldName = matchText.match(/^([A-Za-z_][A-Za-z0-9_~.]*)\s+IN\s*\(/i)?.[1];
  if (!fieldName || fieldName.toUpperCase() === 'NOT') return undefined;

  const matchStart = match.index ?? 0;
  const openParen = matchStart + matchText.lastIndexOf('(');
  const closeParen = findMatchingParen(maskedSql, openParen);
  if (closeParen < 0) return undefined;

  const literals = parseSingleQuotedLiteralList(sql.slice(openParen + 1, closeParen));
  if (!literals || literals.length <= chunkSize) return undefined;

  const prefix = sql.slice(0, openParen + 1);
  const suffix = sql.slice(closeParen);
  const statements: string[] = [];
  for (let i = 0; i < literals.length; i += chunkSize) {
    statements.push(`${prefix}${literals.slice(i, i + chunkSize).join(', ')}${suffix}`);
  }

  return { statements };
}

function maskSqlStringLiterals(sql: string): string {
  let masked = '';
  let inString = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (ch === "'") {
      if (inString && sql[i + 1] === "'") {
        masked += '  ';
        i++;
        continue;
      }
      inString = !inString;
      masked += ' ';
      continue;
    }
    masked += inString ? ' ' : ch;
  }

  return masked;
}

function countSelectKeywords(maskedSql: string): number {
  return [...maskedSql.matchAll(/\bSELECT\b/gi)].length;
}

function findMatchingParen(text: string, openParen: number): number {
  let depth = 0;
  for (let i = openParen; i < text.length; i++) {
    if (text[i] === '(') depth++;
    if (text[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseSingleQuotedLiteralList(listText: string): string[] | undefined {
  const literals: string[] = [];
  let i = 0;
  let expectingValue = true;

  while (i < listText.length) {
    while (i < listText.length && /\s/.test(listText[i]!)) i++;
    if (i >= listText.length) return expectingValue && literals.length > 0 ? undefined : literals;
    if (!expectingValue || listText[i] !== "'") return undefined;

    const start = i;
    i++;
    let closed = false;
    while (i < listText.length) {
      if (listText[i] === "'") {
        if (listText[i + 1] === "'") {
          i += 2;
          continue;
        }
        i++;
        closed = true;
        break;
      }
      i++;
    }
    if (!closed) return undefined;
    literals.push(listText.slice(start, i));
    expectingValue = false;

    while (i < listText.length && /\s/.test(listText[i]!)) i++;
    if (i >= listText.length) return literals;
    if (listText[i] !== ',') return undefined;
    i++;
    expectingValue = true;
  }

  return expectingValue && literals.length > 0 ? undefined : literals;
}

async function runChunkedSapQuery(
  client: AdtClient,
  plan: SimpleInListChunkPlan,
  maxRows: number,
): Promise<{ columns: string[]; rows: Record<string, string>[] }> {
  const rowLimit = Number.isFinite(maxRows) && maxRows > 0 ? Math.floor(maxRows) : 100;
  const rows: Record<string, string>[] = [];
  let columns: string[] = [];

  for (const statement of plan.statements) {
    const remaining = Math.max(0, rowLimit - rows.length);
    if (remaining === 0) break;
    const chunk = await client.runQuery(statement, remaining);
    if (columns.length === 0) columns = chunk.columns;
    rows.push(...chunk.rows);
  }

  return { columns, rows: rows.slice(0, rowLimit) };
}

async function handleSAPQuery(client: AdtClient, args: Record<string, unknown>): Promise<ToolResult> {
  const sql = String(args.sql ?? '');
  const maxRows = Number(args.maxRows ?? 100);
  const chunkPlan = planSimpleInListChunking(sql);
  let chunkingAttempted = false;

  try {
    chunkingAttempted = chunkPlan != null;
    const data = chunkPlan ? await runChunkedSapQuery(client, chunkPlan, maxRows) : await client.runQuery(sql, maxRows);
    return textResult(JSON.stringify(data, null, 2));
  } catch (err) {
    if (err instanceof AdtApiError && err.isNotFound) {
      // Try to extract table name from SQL and suggest similar names
      const tableMatch = sql.match(/FROM\s+["']?([A-Za-z0-9_/$]+)["']?/i);
      if (tableMatch) {
        const tableName = tableMatch[1]!;

        try {
          const suggestions = await client.searchObject(`${tableName}*`, 10);
          const tableNames = suggestions
            .filter(
              (s) =>
                s.objectType.startsWith('TABL') || s.objectType.startsWith('VIEW') || s.objectType.startsWith('DDLS'),
            )
            .map((s) => s.objectName)
            .slice(0, 5);
          if (tableNames.length > 0) {
            return errorResult(
              `Table "${tableName}" not found.\n\nDid you mean: ${tableNames.join(', ')}?\n\nUse SAPSearch("${tableName}*") for more results, or discover tables with: SAPQuery(sql="SELECT tabname FROM dd02l WHERE tabname LIKE '%${tableName}%'")`,
            );
          }
        } catch {
          // Search failed — fall through to original error
        }
      }
    }
    if (err instanceof AdtApiError) {
      let parserHint = classifySapQueryParserError(err, sql);
      if (parserHint && chunkingAttempted) {
        parserHint +=
          '\nARC-1 already split this simple long IN list into smaller ADT freestyle queries; this backend still rejected one chunk. Reduce the query further or use staged named-table previews.';
      }
      if (parserHint) return errorResult(parserHint);
    }
    throw err;
  }
}

// Some SAPLint actions run offline (@abaplint/core), others call SAP ADT formatter APIs.
async function handleSAPLint(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
): Promise<ToolResult> {
  const action = String(args.action ?? '');
  const ruleOverrides = args.rules as RuleOverrides | undefined;
  const configOptions = buildLintConfigOptions(config, ruleOverrides);

  switch (action) {
    case 'lint': {
      const source = String(args.source ?? '');
      if (!source) return errorResult('"source" is required for lint action.');
      const name = String(args.name ?? 'UNKNOWN');
      const filename = detectFilename(source, name);
      const lintConfig = buildLintConfig(configOptions);
      const issues = lintAbapSource(source, filename, lintConfig);
      return textResult(JSON.stringify(issues, null, 2));
    }
    case 'lint_and_fix': {
      const source = String(args.source ?? '');
      if (!source) return errorResult('"source" is required for lint_and_fix action.');
      const name = String(args.name ?? 'UNKNOWN');
      const filename = detectFilename(source, name);
      const lintConfig = buildLintConfig(configOptions);
      const result = lintAndFix(source, filename, lintConfig);
      return textResult(JSON.stringify(result, null, 2));
    }
    case 'list_rules': {
      const lintConfig = buildLintConfig(configOptions);
      const rules = listRulesFromConfig(lintConfig);
      const enabled = rules.filter((r) => r.enabled);
      const disabled = rules.filter((r) => !r.enabled);
      const effectiveAbapRelease = configOptions.abapRelease ?? 'unknown';
      const syntax = lintConfig.get().syntax as { version?: string } | undefined;
      return textResult(
        JSON.stringify(
          {
            preset: configOptions.systemType === 'btp' ? 'cloud' : 'onprem',
            abapVersion: effectiveAbapRelease,
            syntaxVersion: syntax?.version ?? 'unknown',
            enabledRules: enabled.length,
            disabledRules: disabled.length,
            rules: enabled,
            disabledRuleNames: disabled.map((r) => r.rule),
          },
          null,
          2,
        ),
      );
    }
    case 'format': {
      const source = String(args.source ?? '');
      if (!source) return errorResult('"source" is required for format action.');
      const formatted = await prettyPrint(client.http, client.safety, source);
      return textResult(formatted);
    }
    case 'get_formatter_settings': {
      const settings = await getPrettyPrinterSettings(client.http, client.safety);
      return textResult(JSON.stringify(settings, null, 2));
    }
    case 'set_formatter_settings': {
      const indentation = args.indentation as boolean | undefined;
      const style = args.style as PrettyPrinterSettings['style'] | undefined;
      if (indentation === undefined && style === undefined) {
        return errorResult('At least one of "indentation" or "style" is required for set_formatter_settings.');
      }
      const current = await getPrettyPrinterSettings(client.http, client.safety);
      const next: PrettyPrinterSettings = {
        indentation: indentation ?? current.indentation,
        style: style ?? current.style,
      };
      await setPrettyPrinterSettings(client.http, client.safety, next);
      return textResult(JSON.stringify(next, null, 2));
    }
    default:
      return errorResult(
        `Unknown SAPLint action: "${action}". Supported: lint, lint_and_fix, list_rules, format, get_formatter_settings, set_formatter_settings. For atc/syntax/unittest, use SAPDiagnose instead.`,
      );
  }
}

/**
 * Build LintConfigOptions from server config and cached features.
 *
 * Uses cachedFeatures (from SAPManage probe) when available, but falls back
 * to config.systemType so that --system-type btp works even before the first
 * probe. Without this fallback, cloud lint rules wouldn't apply until a probe
 * populates cachedFeatures.
 */
function buildLintConfigOptions(config: ServerConfig, ruleOverrides?: RuleOverrides): LintConfigOptions {
  // Probe-detected system type is most accurate; fall back to CLI config
  const systemType = cachedFeatures?.systemType ?? (config.systemType !== 'auto' ? config.systemType : undefined);
  return {
    systemType,
    abapRelease: cachedFeatures?.abapRelease ?? config.abapRelease,
    configFile: config.abaplintConfig,
    ruleOverrides,
  };
}

// ─── Object Creation XML ─────────────────────────────────────────────

const DOMAIN_V2_CONTENT_TYPE = 'application/vnd.sap.adt.domains.v2+xml; charset=utf-8';
const DATAELEMENT_V2_CONTENT_TYPE = 'application/vnd.sap.adt.dataelements.v2+xml; charset=utf-8';
const SERVICEBINDING_V2_CONTENT_TYPE = 'application/vnd.sap.adt.businessservices.servicebinding.v2+xml; charset=utf-8';
const BDEF_CONTENT_TYPE = 'application/vnd.sap.adt.blues.v1+xml';
const MESSAGECLASS_CONTENT_TYPE = 'application/vnd.sap.adt.mc.messageclass+xml';
const SKTD_V2_CONTENT_TYPE = 'application/vnd.sap.adt.sktdv2+xml';
// Function group + function module content types — verified live on a4h S/4HANA 2023
// (issue #250). FUGR uses the v3 group envelope; FUNC uses the unversioned fmodule envelope.
const FUNCTION_GROUP_CONTENT_TYPE = 'application/vnd.sap.adt.functions.groups.v3+xml';
const FUNCTION_MODULE_CONTENT_TYPE = 'application/vnd.sap.adt.functions.fmodules+xml';

function isMetadataWriteType(type: string): boolean {
  return type === 'DOMA' || type === 'DTEL' || type === 'MSAG' || type === 'SRVB';
}

/** Types that require a specific vendor content type for creation (not application/*) */
function needsVendorContentType(type: string): boolean {
  return (
    type === 'DOMA' ||
    type === 'DTEL' ||
    type === 'BDEF' ||
    type === 'MSAG' ||
    type === 'SKTD' ||
    type === 'FUGR' ||
    type === 'FUNC'
  );
}

/** Content type used for create POST */
function createContentTypeForType(type: string): string {
  // SRVB creation works with wildcard content type; updates use vendor v2 type.
  if (type === 'SRVB') return 'application/*';
  return needsVendorContentType(type) ? vendorContentTypeForType(type) : 'application/*';
}

/**
 * Check if a DTEL create has properties that SAP ignores on POST but accepts on PUT.
 * SAP's DTEL POST only stores the shell (name, description, package, typeKind, typeName, dataType, length).
 * Labels, searchHelp, setGetParameter, etc. require a follow-up PUT to take effect.
 */
function dtelNeedsPostCreateUpdate(props: Record<string, unknown>): boolean {
  return Boolean(
    props.shortLabel ||
      props.mediumLabel ||
      props.longLabel ||
      props.headingLabel ||
      props.searchHelp ||
      props.searchHelpParameter ||
      props.setGetParameter ||
      props.defaultComponentName ||
      props.changeDocument,
  );
}

function vendorContentTypeForType(type: string): string {
  switch (type) {
    case 'DOMA':
      return DOMAIN_V2_CONTENT_TYPE;
    case 'DTEL':
      return DATAELEMENT_V2_CONTENT_TYPE;
    case 'SRVB':
      return SERVICEBINDING_V2_CONTENT_TYPE;
    case 'BDEF':
      return BDEF_CONTENT_TYPE;
    case 'MSAG':
      return MESSAGECLASS_CONTENT_TYPE;
    case 'SKTD':
      return SKTD_V2_CONTENT_TYPE;
    case 'FUGR':
      return FUNCTION_GROUP_CONTENT_TYPE;
    case 'FUNC':
      return FUNCTION_MODULE_CONTENT_TYPE;
    default:
      // Wildcard lets the SAP server resolve the correct handler.
      // Sending 'application/xml' causes 415 on DDL-based endpoints
      // (DDLS, SRVD, DDLX) whose resource classes reject that literal type.
      return 'application/*';
  }
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return undefined;
}

function getMetadataWriteProperties(input: Record<string, unknown>): Record<string, unknown> {
  const props: Record<string, unknown> = {
    dataType: input.dataType,
    length: input.length,
    decimals: input.decimals,
    outputLength: input.outputLength,
    conversionExit: input.conversionExit,
    signExists: input.signExists,
    lowercase: input.lowercase,
    fixedValues: input.fixedValues,
    valueTable: input.valueTable,
    typeKind: input.typeKind,
    typeName: input.typeName,
    domainName: input.domainName,
    shortLabel: input.shortLabel,
    mediumLabel: input.mediumLabel,
    longLabel: input.longLabel,
    headingLabel: input.headingLabel,
    searchHelp: input.searchHelp,
    searchHelpParameter: input.searchHelpParameter,
    setGetParameter: input.setGetParameter,
    defaultComponentName: input.defaultComponentName,
    changeDocument: input.changeDocument,
    messages: input.messages,
    serviceDefinition: input.serviceDefinition,
    bindingType: input.bindingType,
    category: input.category,
    version: input.version,
    odataVersion: input.odataVersion,
    // Function-module create needs the parent function-group name for the
    // <adtcore:containerRef> in the create payload (issue #250).
    group: input.group,
  };

  return props;
}

/**
 * Fetch existing DDIC metadata and merge with provided properties.
 * This ensures that updating a single field (e.g., shortLabel) doesn't
 * reset other fields (e.g., dataType, typeKind) to defaults, since
 * DDIC updates are full-XML-replace operations.
 *
 * Internal _description and _package fields carry the existing values
 * for the caller to use as fallbacks.
 */
function normalizeSrvbCategory(value: unknown): '0' | '1' | undefined {
  if (value === '0' || value === 0 || value === 'UI') return '0';
  if (value === '1' || value === 1 || value === 'Web API') return '1';
  return undefined;
}

async function mergeMetadataWriteProperties(
  client: AdtClient,
  type: string,
  name: string,
  provided: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    if (type === 'MSAG') {
      const existing = await client.getMessageClassInfo(name);
      return {
        _description: existing.description,
        _package: existing.package,
        messages: provided.messages ?? existing.messages,
      };
    }
    if (type === 'DOMA') {
      const existing = await client.getDomain(name);
      return {
        _description: existing.description,
        _package: existing.package,
        dataType: provided.dataType ?? existing.dataType,
        length: provided.length ?? existing.length,
        decimals: provided.decimals ?? existing.decimals,
        outputLength: provided.outputLength ?? existing.outputLength,
        conversionExit: provided.conversionExit ?? existing.conversionExit,
        signExists: provided.signExists ?? existing.signExists,
        lowercase: provided.lowercase ?? existing.lowercase,
        fixedValues: provided.fixedValues ?? existing.fixedValues,
        valueTable: provided.valueTable ?? existing.valueTable,
      };
    }
    if (type === 'DTEL') {
      const existing = await client.getDataElement(name);
      return {
        _description: existing.description,
        _package: existing.package,
        dataType: provided.dataType ?? existing.dataType,
        length: provided.length ?? existing.length,
        decimals: provided.decimals ?? existing.decimals,
        typeKind: provided.typeKind ?? existing.typeKind,
        typeName: provided.typeName ?? existing.typeName,
        domainName: provided.domainName ?? existing.typeName, // DTEL stores domain in typeName
        shortLabel: provided.shortLabel ?? existing.shortLabel,
        mediumLabel: provided.mediumLabel ?? existing.mediumLabel,
        longLabel: provided.longLabel ?? existing.longLabel,
        headingLabel: provided.headingLabel ?? existing.headingLabel,
        searchHelp: provided.searchHelp ?? existing.searchHelp,
        searchHelpParameter: provided.searchHelpParameter,
        setGetParameter: provided.setGetParameter,
        defaultComponentName: provided.defaultComponentName ?? existing.defaultComponentName,
        changeDocument: provided.changeDocument,
      };
    }
    if (type === 'SRVB') {
      const { source: existingRaw } = await client.getSrvb(name);
      const existing = JSON.parse(existingRaw) as Record<string, unknown>;
      return {
        _description: existing.description,
        _package: existing.package,
        serviceDefinition: provided.serviceDefinition ?? existing.serviceDefinition,
        bindingType: provided.bindingType ?? existing.bindingType,
        category: provided.category ?? normalizeSrvbCategory(existing.bindingCategory),
        version: provided.version ?? existing.serviceVersion,
        odataVersion: provided.odataVersion ?? existing.odataVersion,
      };
    }
  } catch {
    // If we can't read existing metadata (e.g., object is new/inactive), fall through
  }
  return provided;
}

/**
 * Build the type-specific XML body for ADT object creation.
 *
 * SAP ADT requires each object type to have its own root XML element.
 * Using a generic body (e.g. adtcore:objectReferences) returns 400:
 *   "System expected the element '{http://www.sap.com/adt/programs/programs}abapProgram'"
 */

// ─── CDS Pre-Write Validation ──────────────────────────────────────

/** Common CDS reserved/function keywords that cause silent DDL save failures when used as field names */
const CDS_RESERVED_KEYWORDS = new Set([
  'position',
  'value',
  'type',
  'data',
  'timestamp',
  'language',
  'text',
  'source',
  'target',
  'name',
  'description',
  'concat',
  'replace',
  'substring',
  'length',
  'left',
  'right',
  'round',
  'abs',
  'floor',
  'ceiling',
  'division',
  'mod',
  'case',
  'when',
  'then',
  'else',
  'end',
  'cast',
  'coalesce',
  'uuid',
]);

/**
 * Guard CDS syntax against known version-dependent features.
 * Returns an error result if the source uses unsupported syntax, or undefined to proceed.
 * Best-effort: if cachedFeatures is not available (no probe yet), always proceeds.
 */
function guardCdsSyntax(
  type: string,
  source: string,
  features: ResolvedFeatures | undefined,
): ReturnType<typeof errorResult> | undefined {
  if (type !== 'DDLS' || !source) return undefined;

  // Guard: "define table entity" requires ABAP Cloud (BTP) or SAP_BASIS >= 757
  if (/\bdefine\s+table\s+(entity|function)\b/i.test(source)) {
    const release = features?.abapRelease;
    const isBtp = features?.systemType === 'btp';
    if (!isBtp && release) {
      const releaseNum = Number.parseInt(release.replace(/\D/g, ''), 10);
      if (releaseNum > 0 && releaseNum < 757) {
        return errorResult(
          `"define table entity" syntax requires ABAP Cloud (BTP) or S/4HANA on-premise with SAP_BASIS >= 757. ` +
            `This system reports SAP_BASIS ${release}. ` +
            `Use DDIC transparent tables (SAPWrite type="TABL" or SE11) + CDS view entities ("define [root] view entity") instead.`,
        );
      }
    }
  }

  // Advisory: warn about CDS reserved keywords used as field names
  const keywordWarning = warnCdsReservedKeywords(source);
  if (keywordWarning) {
    // Non-blocking — return undefined to proceed, but the warning will be
    // appended to the success message by the caller if needed.
    // For now we return it as an advisory error only when the keyword is
    // highly likely to cause issues (position is the most common).
    // We don't block the write — just append it as advisory context.
  }

  return undefined;
}

/**
 * Detect CDS reserved keywords used as field names in DDL source.
 * Returns a warning string listing suspicious field names, or undefined if none found.
 */
export function warnCdsReservedKeywords(source: string): string | undefined {
  // Extract field-name-like tokens: lines inside { } that define fields
  // Pattern: whitespace + identifier + colon (field definitions)
  const fieldNames: string[] = [];
  const braceStart = source.indexOf('{');
  const braceEnd = source.lastIndexOf('}');
  if (braceStart === -1 || braceEnd === -1) return undefined;

  const body = source.slice(braceStart + 1, braceEnd);
  // Match field definitions: leading whitespace, optional "key", then identifier before ":"
  const fieldPattern = /^\s*(?:key\s+)?(\w+)\s*:/gim;
  let match: RegExpExecArray | null;
  while ((match = fieldPattern.exec(body)) !== null) {
    const fieldName = match[1]?.toLowerCase();
    if (fieldName && CDS_RESERVED_KEYWORDS.has(fieldName)) {
      fieldNames.push(match[1]!);
    }
  }

  if (fieldNames.length === 0) return undefined;

  return (
    `Warning: field name(s) ${fieldNames.map((f) => `'${f}'`).join(', ')} may be CDS reserved keywords. ` +
    `If the DDL save fails with a generic syntax error, rename them (e.g., 'position' → 'playing_position', 'type' → 'obj_type').`
  );
}

export function buildCreateXml(
  type: string,
  name: string,
  pkg: string,
  description: string,
  properties?: Record<string, unknown>,
): string {
  switch (type) {
    case 'PROG':
      return `<?xml version="1.0" encoding="UTF-8"?>
<program:abapProgram xmlns:program="http://www.sap.com/adt/programs/programs"
                     xmlns:adtcore="http://www.sap.com/adt/core"
                     adtcore:description="${escapeXml(description)}"
                     adtcore:name="${escapeXml(name)}"
                     adtcore:type="PROG/P"
                     adtcore:masterLanguage="EN"
                     adtcore:masterSystem="H00"
                     adtcore:responsible="DEVELOPER">
  <adtcore:packageRef adtcore:name="${escapeXml(pkg)}"/>
</program:abapProgram>`;
    case 'CLAS':
      return `<?xml version="1.0" encoding="UTF-8"?>
<class:abapClass xmlns:class="http://www.sap.com/adt/oo/classes"
                 xmlns:adtcore="http://www.sap.com/adt/core"
                 adtcore:description="${escapeXml(description)}"
                 adtcore:name="${escapeXml(name)}"
                 adtcore:type="CLAS/OC"
                 adtcore:masterLanguage="EN"
                 adtcore:masterSystem="H00"
                 adtcore:responsible="DEVELOPER">
  <adtcore:packageRef adtcore:name="${escapeXml(pkg)}"/>
</class:abapClass>`;
    case 'INTF':
      return `<?xml version="1.0" encoding="UTF-8"?>
<intf:abapInterface xmlns:intf="http://www.sap.com/adt/oo/interfaces"
                    xmlns:adtcore="http://www.sap.com/adt/core"
                    adtcore:description="${escapeXml(description)}"
                    adtcore:name="${escapeXml(name)}"
                    adtcore:type="INTF/OI"
                    adtcore:masterLanguage="EN"
                    adtcore:masterSystem="H00"
                    adtcore:responsible="DEVELOPER">
  <adtcore:packageRef adtcore:name="${escapeXml(pkg)}"/>
</intf:abapInterface>`;
    case 'INCL':
      return `<?xml version="1.0" encoding="UTF-8"?>
<include:abapInclude xmlns:include="http://www.sap.com/adt/programs/includes"
                     xmlns:adtcore="http://www.sap.com/adt/core"
                     adtcore:description="${escapeXml(description)}"
                     adtcore:name="${escapeXml(name)}"
                     adtcore:type="PROG/I"
                     adtcore:masterLanguage="EN"
                     adtcore:masterSystem="H00"
                     adtcore:responsible="DEVELOPER">
  <adtcore:packageRef adtcore:name="${escapeXml(pkg)}"/>
</include:abapInclude>`;
    case 'DDLS':
      return `<?xml version="1.0" encoding="UTF-8"?>
<ddl:ddlSource xmlns:ddl="http://www.sap.com/adt/ddic/ddlsources"
               xmlns:adtcore="http://www.sap.com/adt/core"
               adtcore:description="${escapeXml(description)}"
               adtcore:name="${escapeXml(name)}"
               adtcore:type="DDLS/DF"
               adtcore:masterLanguage="EN"
               adtcore:masterSystem="H00"
                 adtcore:responsible="DEVELOPER">
  <adtcore:packageRef adtcore:name="${escapeXml(pkg)}"/>
</ddl:ddlSource>`;
    case 'DCLS':
      return `<?xml version="1.0" encoding="UTF-8"?>
<dcl:dclSource xmlns:dcl="http://www.sap.com/adt/acm/dclsources"
               xmlns:adtcore="http://www.sap.com/adt/core"
               adtcore:description="${escapeXml(description)}"
               adtcore:name="${escapeXml(name)}"
               adtcore:type="DCLS/DL"
               adtcore:masterLanguage="EN"
               adtcore:masterSystem="H00"
               adtcore:responsible="DEVELOPER">
  <adtcore:packageRef adtcore:name="${escapeXml(pkg)}"/>
</dcl:dclSource>`;
    case 'TABL':
      // TABL creation also uses SAP's "blue" framework envelope, then source is written via /source/main.
      return `<?xml version="1.0" encoding="UTF-8"?>
<blue:blueSource xmlns:blue="http://www.sap.com/wbobj/blue"
                 xmlns:adtcore="http://www.sap.com/adt/core"
                 adtcore:description="${escapeXml(description)}"
                 adtcore:name="${escapeXml(name)}"
                 adtcore:type="TABL/DT"
                 adtcore:masterLanguage="EN"
                 adtcore:masterSystem="H00"
                 adtcore:responsible="DEVELOPER">
  <adtcore:packageRef adtcore:name="${escapeXml(pkg)}"/>
</blue:blueSource>`;
    case 'BDEF':
      // BDEF uses SAP's "blue" framework — blue:blueSource with http://www.sap.com/wbobj/blue namespace.
      // Confirmed by vibing-steampunk (Go) and fr0ster (TypeScript) reference implementations.
      return `<?xml version="1.0" encoding="UTF-8"?>
<blue:blueSource xmlns:blue="http://www.sap.com/wbobj/blue"
                 xmlns:adtcore="http://www.sap.com/adt/core"
                 adtcore:description="${escapeXml(description)}"
                 adtcore:name="${escapeXml(name)}"
                 adtcore:type="BDEF/BDO"
                 adtcore:masterLanguage="EN"
                 adtcore:masterSystem="H00"
                 adtcore:responsible="DEVELOPER">
  <adtcore:packageRef adtcore:name="${escapeXml(pkg)}"/>
</blue:blueSource>`;
    case 'SRVD':
      return `<?xml version="1.0" encoding="UTF-8"?>
<srvd:srvdSource xmlns:srvd="http://www.sap.com/adt/ddic/srvdsources"
                 xmlns:adtcore="http://www.sap.com/adt/core"
                 adtcore:description="${escapeXml(description)}"
                 adtcore:name="${escapeXml(name)}"
                 adtcore:type="SRVD/SRV"
                 adtcore:masterLanguage="EN"
                 adtcore:masterSystem="H00"
                 adtcore:responsible="DEVELOPER"
                 srvd:srvdSourceType="S">
  <adtcore:packageRef adtcore:name="${escapeXml(pkg)}"/>
</srvd:srvdSource>`;
    case 'SRVB': {
      const serviceDefinition = String(properties?.serviceDefinition ?? '').trim();
      if (!serviceDefinition) {
        throw new Error('SRVB create/update requires "serviceDefinition" (referenced SRVD name).');
      }
      const categoryRaw = properties?.category;
      const category =
        categoryRaw === '1' || categoryRaw === 1 ? '1' : categoryRaw === '0' || categoryRaw === 0 ? '0' : undefined;
      const params: ServiceBindingCreateParams = {
        name,
        description,
        package: pkg,
        serviceDefinition,
        bindingType: properties?.bindingType ? String(properties.bindingType) : undefined,
        category,
        version: properties?.version ? String(properties.version) : undefined,
        odataVersion: properties?.odataVersion ? String(properties.odataVersion) : undefined,
      };
      return buildServiceBindingXml(params);
    }
    case 'DDLX':
      return `<?xml version="1.0" encoding="UTF-8"?>
<ddlx:ddlxSource xmlns:ddlx="http://www.sap.com/adt/ddic/ddlxsources"
                 xmlns:adtcore="http://www.sap.com/adt/core"
                 adtcore:description="${escapeXml(description)}"
                 adtcore:name="${escapeXml(name)}"
                 adtcore:type="DDLX/EX"
                 adtcore:masterLanguage="EN"
                 adtcore:masterSystem="H00"
                     adtcore:responsible="DEVELOPER">
  <adtcore:packageRef adtcore:name="${escapeXml(pkg)}"/>
</ddlx:ddlxSource>`;
    case 'DOMA': {
      const fixedValuesRaw = Array.isArray(properties?.fixedValues) ? properties.fixedValues : [];
      const fixedValues = fixedValuesRaw
        .filter((value): value is Record<string, unknown> => typeof value === 'object' && value !== null)
        .map((value) => ({
          low: String(value.low ?? ''),
          high: value.high === undefined ? undefined : String(value.high),
          description: value.description === undefined ? undefined : String(value.description),
        }));

      const params: DomainCreateParams = {
        name,
        description,
        package: pkg,
        dataType: String(properties?.dataType ?? 'CHAR'),
        length: (properties?.length as string | number | undefined) ?? 0,
        decimals: properties?.decimals as string | number | undefined,
        outputLength: properties?.outputLength as string | number | undefined,
        conversionExit: properties?.conversionExit ? String(properties.conversionExit) : undefined,
        signExists: toBoolean(properties?.signExists),
        lowercase: toBoolean(properties?.lowercase),
        fixedValues,
        valueTable: properties?.valueTable ? String(properties.valueTable) : undefined,
      };
      return buildDomainXml(params);
    }
    case 'DTEL': {
      const typeKindRaw = String(properties?.typeKind ?? '');
      const typeKind: DataElementCreateParams['typeKind'] =
        typeKindRaw === 'domain' || typeKindRaw === 'predefinedAbapType' ? typeKindRaw : undefined;
      const params: DataElementCreateParams = {
        name,
        description,
        package: pkg,
        typeKind,
        typeName: properties?.typeName ? String(properties.typeName) : undefined,
        domainName: properties?.domainName ? String(properties.domainName) : undefined,
        dataType: properties?.dataType ? String(properties.dataType) : undefined,
        length: properties?.length as string | number | undefined,
        decimals: properties?.decimals as string | number | undefined,
        shortLabel: properties?.shortLabel ? String(properties.shortLabel) : undefined,
        mediumLabel: properties?.mediumLabel ? String(properties.mediumLabel) : undefined,
        longLabel: properties?.longLabel ? String(properties.longLabel) : undefined,
        headingLabel: properties?.headingLabel ? String(properties.headingLabel) : undefined,
        searchHelp: properties?.searchHelp ? String(properties.searchHelp) : undefined,
        searchHelpParameter: properties?.searchHelpParameter ? String(properties.searchHelpParameter) : undefined,
        setGetParameter: properties?.setGetParameter ? String(properties.setGetParameter) : undefined,
        defaultComponentName: properties?.defaultComponentName ? String(properties.defaultComponentName) : undefined,
        changeDocument: toBoolean(properties?.changeDocument),
      };
      return buildDataElementXml(params);
    }
    case 'MSAG': {
      const messagesRaw = Array.isArray(properties?.messages) ? properties.messages : [];
      const messages = messagesRaw
        .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
        .map((m) => ({
          number: String(m.number ?? ''),
          shortText: String(m.shortText ?? ''),
        }));
      const params: MessageClassCreateParams = {
        name,
        description,
        package: pkg,
        messages: messages.length > 0 ? messages : undefined,
      };
      return buildMessageClassXml(params);
    }
    case 'FUGR':
      // Function group create envelope. POSTed to /sap/bc/adt/functions/groups
      // with Content-Type: application/vnd.sap.adt.functions.groups.v3+xml.
      // Verified live on a4h S/4HANA 2023 (issue #250).
      return `<?xml version="1.0" encoding="UTF-8"?>
<group:abapFunctionGroup xmlns:group="http://www.sap.com/adt/functions/groups" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:description="${escapeXml(description)}" adtcore:language="EN" adtcore:name="${escapeXml(name)}" adtcore:type="FUGR/F" adtcore:masterLanguage="EN">
  <adtcore:packageRef adtcore:name="${escapeXml(pkg)}"/>
</group:abapFunctionGroup>`;
    case 'FUNC': {
      // Function module create envelope. POSTed to
      // /sap/bc/adt/functions/groups/{group_lc}/fmodules with
      // Content-Type: application/vnd.sap.adt.functions.fmodules+xml.
      // No <adtcore:packageRef> — FM inherits package from the parent FUGR.
      // adtcore:uri must be lowercase (verified live on a4h).
      const group = String(properties?.group ?? '').trim();
      if (!group) {
        throw new Error(
          'FUNC create requires "group" property — pass it via SAPWrite args (the parent function group must already exist).',
        );
      }
      const groupLc = encodeURIComponent(group.toLowerCase());
      return `<?xml version="1.0" encoding="UTF-8"?>
<fmodule:abapFunctionModule xmlns:fmodule="http://www.sap.com/adt/functions/fmodules" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:description="${escapeXml(description)}" adtcore:name="${escapeXml(name)}" adtcore:type="FUGR/FF">
  <adtcore:containerRef adtcore:name="${escapeXml(group)}" adtcore:type="FUGR/F" adtcore:uri="/sap/bc/adt/functions/groups/${groupLc}"/>
</fmodule:abapFunctionModule>`;
    }
    default:
      // Fallback — generic objectReferences using the correct URL for the type
      return `<?xml version="1.0" encoding="UTF-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="${escapeXml(objectUrlForType(type, name))}" adtcore:type="${escapeXml(type)}" adtcore:name="${escapeXml(name)}" adtcore:packageName="${escapeXml(pkg)}"/>
</adtcore:objectReferences>`;
  }
}

/**
 * Strip SAPGUI-style function-module parameter comment blocks from an FM source body.
 *
 * SAP rejects PUT-to-source/main with parameter comment blocks (verified live on a4h
 * S/4HANA 2023 — issue #250):
 *   HTTP 400 / com.sap.adt.sedi / ExceptionResourceScanDuringSaveFailure
 *   "Parameter comment blocks are not allowed" (T100KEY FUNC_ADT028)
 *
 * The signature is metadata, not source. LLMs frequently emit the SAPGUI block out
 * of muscle memory (every released FM ships with one). This helper strips lines whose
 * first non-whitespace tokens are `*"` so the PUT succeeds, and reports back whether
 * stripping occurred so the caller can append a warning to the response.
 *
 * Only `*"…` lines are stripped — single `*` ABAP comments and inline `"` comments
 * are preserved. Exported for unit tests.
 */
export function stripFmParamCommentBlock(source: string): { source: string; wasStripped: boolean } {
  const lines = source.split('\n');
  const kept = lines.filter((line) => !/^\s*\*"/.test(line));
  return { source: kept.join('\n'), wasStripped: kept.length !== lines.length };
}

/** Escape special characters for XML attribute values */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── Object URL Mapping ──────────────────────────────────────────────

// Every entry verified against either Eclipse ADT apidoc 3.58.1, live a4h S/4HANA
// 2023 + npl NW 7.50 ADT responses (captured 2026-05-08 — both systems agree), or
// abap-file-formats schemas. Per-entry evidence in research/abap-types/types/<x>.md.
// SLASH_TYPE_EVIDENCE below MUST stay key-equal (anti-cargo-cult guard, enforced by
// tests/unit/handlers/slash-type-map.test.ts — see issue #218 follow-up).
// Exported for tests only — the citation guard
// (tests/unit/handlers/slash-type-map.test.ts) needs to assert key-equality
// against SLASH_TYPE_EVIDENCE so a new entry without evidence fails CI.
// Production callers should keep using normalizeObjectType().
export const SLASH_TYPE_MAP: Record<string, string> = {
  'PROG/P': 'PROG', // research/abap-types/types/prog.md
  'PROG/I': 'INCL', // research/abap-types/types/incl.md
  'CLAS/OC': 'CLAS', // research/abap-types/types/clas.md
  // 'CLAS/LI' removed — invented; absent from Eclipse apidoc; no live ADT response
  // emits it. Pass-through means schema validation rejects it loudly.
  'INTF/OI': 'INTF', // research/abap-types/types/intf.md
  // 'FUNC/FM' removed — invented; ADT emits FUGR/FF for function modules, not
  // FUNC/FM. Function modules are LIMU FUNC under R3TR FUGR.
  'FUGR/F': 'FUGR', // function group container — research/abap-types/types/fugr.md
  // FUGR/FF is a function module (LIMU FUNC under FUGR), not the function group.
  // Live a4h: GET .../groups/su_user/fmodules/bapi_user_getlist returns
  // adtcore:type="FUGR/FF" with <adtcore:containerRef adtcore:type="FUGR/F"/>.
  'FUGR/FF': 'FUNC', // research/abap-types/types/fugr.md + func.md
  'DDLS/DF': 'DDLS', // research/abap-types/types/ddls.md
  'DCLS/DL': 'DCLS', // research/abap-types/types/dcls.md
  'BDEF/BDO': 'BDEF', // research/abap-types/types/bdef.md
  'SRVD/SRV': 'SRVD', // research/abap-types/types/srvd.md
  'SRVB/SVB': 'SRVB', // research/abap-types/types/srvb.md
  'DDLX/EX': 'DDLX', // research/abap-types/types/ddlx.md (live a4h + npl 2026-05-08)
  // DDIC TABL: ADT exposes /DT (transparent table) and /DS (DDIC structure)
  // subtypes. Both share TADIR R3TR TABL (DD02L-TABCLASS = TRANSP vs INTTAB).
  // ARC-1 collapses both into the canonical short type 'TABL' (Model B — see
  // docs/plans/completed/collapse-stru-into-tabl.md).
  'TABL/DT': 'TABL', // research/abap-types/types/tabl.md
  'TABL/DS': 'TABL', // research/abap-types/types/tabl.md
  // Legacy slash-form alias — ADT never actually returns this, but pre-Model-B
  // ARC-1 prompts learned it from older docs. Kept so they normalize to TABL
  // instead of producing a schema error. Bare 'STRU' is NOT aliased.
  'STRU/DS': 'TABL', // research/abap-types/types/tabl.md (legacy alias)
  'DOMA/DD': 'DOMA', // research/abap-types/types/doma.md
  'DTEL/DE': 'DTEL', // research/abap-types/types/dtel.md
  'MSAG/N': 'MSAG', // research/abap-types/types/msag.md
  'DEVC/K': 'DEVC', // research/abap-types/types/devc.md
  // TRAN/T (was TRAN/O — invented). Live a4h + npl 2026-05-08 both return
  // adtcore:type="TRAN/T" for SE38, SU01, etc.
  'TRAN/T': 'TRAN', // research/abap-types/types/tran.md
  // VIEW/DV (was VIEW/V — invented). Live a4h + npl 2026-05-08 both return
  // adtcore:type="VIEW/DV" for V_USR_NAME.
  'VIEW/DV': 'VIEW', // research/abap-types/types/view.md
  'SKTD/TYP': 'SKTD', // research/abap-types/types/sktd.md
};

/**
 * Citation guard companion for SLASH_TYPE_MAP. Keys MUST stay key-equal to
 * SLASH_TYPE_MAP (enforced by tests/unit/handlers/slash-type-map.test.ts). Each
 * value points at a research evidence file or a fixture that backs the slash code.
 * Adding an entry without evidence is the anti-cargo-cult guard.
 */
export const SLASH_TYPE_EVIDENCE: Record<string, string> = {
  'PROG/P': 'research/abap-types/types/prog.md',
  'PROG/I': 'research/abap-types/types/incl.md',
  'CLAS/OC': 'research/abap-types/types/clas.md',
  'INTF/OI': 'research/abap-types/types/intf.md',
  'FUGR/F': 'research/abap-types/types/fugr.md',
  'FUGR/FF': 'research/abap-types/types/fugr.md',
  'DDLS/DF': 'research/abap-types/types/ddls.md',
  'DCLS/DL': 'research/abap-types/types/dcls.md',
  'BDEF/BDO': 'research/abap-types/types/bdef.md',
  'SRVD/SRV': 'research/abap-types/types/srvd.md',
  'SRVB/SVB': 'research/abap-types/types/srvb.md',
  'DDLX/EX': 'research/abap-types/types/ddlx.md',
  'TABL/DT': 'research/abap-types/types/tabl.md',
  'TABL/DS': 'research/abap-types/types/tabl.md',
  'STRU/DS': 'research/abap-types/types/tabl.md',
  'DOMA/DD': 'research/abap-types/types/doma.md',
  'DTEL/DE': 'research/abap-types/types/dtel.md',
  'MSAG/N': 'research/abap-types/types/msag.md',
  'DEVC/K': 'research/abap-types/types/devc.md',
  'TRAN/T': 'research/abap-types/types/tran.md',
  'VIEW/DV': 'research/abap-types/types/view.md',
  'SKTD/TYP': 'research/abap-types/types/sktd.md',
};

/**
 * Set of canonical short types that MUST have a working `objectBasePath` case.
 * Drives the exhaustiveness guard inside `objectBasePath` so a new canonical type
 * added to SAPRead/SAPWrite enums without an URL builder fails loudly. The VIEW
 * silent-fallthrough bug (research/abap-types/types/view.md) is exactly what this
 * guard prevents from reoccurring.
 */
export const KNOWN_BASE_TYPES = new Set([
  'PROG',
  'CLAS',
  'INTF',
  'INCL',
  'FUGR',
  'FUNC',
  'DDLS',
  'DCLS',
  'BDEF',
  'SRVD',
  'SRVB',
  'DDLX',
  'TABL',
  'DOMA',
  'DTEL',
  'MSAG',
  'DEVC',
  'TRAN',
  'VIEW',
  'SKTD',
]);

/** Normalize ADT type codes and aliases to ARC-1 canonical short types. */
export function normalizeObjectType(type: string): string {
  const normalized = String(type).trim().toUpperCase();
  if (!normalized) return '';
  return SLASH_TYPE_MAP[normalized] ?? normalized;
}

/** Normalize type fields before schema validation so slash/case aliases are accepted. */
function normalizeTypeArgsForValidation(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  switch (toolName) {
    case 'SAPRead':
      return {
        ...args,
        type: normalizeObjectType(String(args.type ?? '')),
        objectType: args.objectType === undefined ? undefined : normalizeObjectType(String(args.objectType ?? '')),
      };
    case 'SAPWrite':
      return {
        ...args,
        type: args.type === undefined ? undefined : normalizeObjectType(String(args.type ?? '')),
        objects: Array.isArray(args.objects)
          ? args.objects.map((obj) =>
              typeof obj === 'object' && obj !== null
                ? {
                    ...obj,
                    type: normalizeObjectType(String((obj as Record<string, unknown>).type ?? '')),
                  }
                : obj,
            )
          : args.objects,
      };
    case 'SAPActivate':
      return {
        ...args,
        type: args.type === undefined ? undefined : normalizeObjectType(String(args.type ?? '')),
        objects: Array.isArray(args.objects)
          ? args.objects.map((obj) =>
              typeof obj === 'object' && obj !== null
                ? {
                    ...obj,
                    type: normalizeObjectType(String((obj as Record<string, unknown>).type ?? '')),
                  }
                : obj,
            )
          : args.objects,
      };
    case 'SAPSearch':
      return {
        ...args,
        objectType: args.objectType === undefined ? undefined : normalizeObjectType(String(args.objectType ?? '')),
      };
    case 'SAPNavigate':
      // Only normalize `type` (for URL building). `objectType` is passed to SAP's
      // where-used scope API in slash format (e.g., CLAS/OC) — normalizing it would break the filter.
      return {
        ...args,
        type: args.type === undefined ? undefined : normalizeObjectType(String(args.type ?? '')),
      };
    case 'SAPDiagnose':
      return {
        ...args,
        type: args.type === undefined ? undefined : normalizeObjectType(String(args.type ?? '')),
      };
    case 'SAPContext':
      return {
        ...args,
        type: args.type === undefined ? undefined : normalizeObjectType(String(args.type ?? '')),
      };
    case 'SAPTransport':
      // Normalize `type` for SAPTransport actions that route through
      // objectBasePath (e.g. when a future action accepts a slash-form
      // workbench type). Codex review of PR #223 flagged this gap: without
      // normalization, a caller passing `type: 'FUNC/FM'` would slip past the
      // string-typed schema and hit the slash-form throw inside objectBasePath,
      // which is correct as a last-resort fence but not as a friendly error.
      return {
        ...args,
        type: args.type === undefined ? undefined : normalizeObjectType(String(args.type ?? '')),
      };
    default:
      return args;
  }
}

/**
 * Base path for an object type. Returns path prefix without trailing name segment.
 * Exported for tests (Plan A Task 4 — exhaustiveness guard regression test).
 */
export function objectBasePath(type: string): string {
  switch (type) {
    case 'PROG':
      return '/sap/bc/adt/programs/programs/';
    case 'CLAS':
      return '/sap/bc/adt/oo/classes/';
    case 'INTF':
      return '/sap/bc/adt/oo/interfaces/';
    case 'FUNC':
      // Codex review of PR #223 follow-up: function modules cannot be
      // addressed with a single base path — they live at
      // /sap/bc/adt/functions/groups/{group}/fmodules/{fm} and require the
      // parent function group. Returning the group prefix for FUNC was the
      // pre-PR behaviour and silently mis-routed a real ADT search result
      // `{ type: "FUGR/FF", name: "BAPI_USER_GETLIST" }` (which now
      // canonicalises to FUNC) to /functions/groups/BAPI_USER_GETLIST. Throw
      // so generic URL builders (SAPActivate / SAPDiagnose / SAPTransport via
      // objectUrlForType) fail loudly. SAPRead and SAPNavigate handle FUNC
      // through dedicated `case 'FUNC'` branches that take a `group` arg and
      // build the correct URL via client.getFunction(group, name) — those
      // paths do not call objectBasePath and remain unaffected.
      throw new Error(
        `objectBasePath: type 'FUNC' (function module) cannot be resolved to a ` +
          `single base path — it requires the parent function group via ` +
          `client.getFunction(group, name) or an explicit /sap/bc/adt/functions/` +
          `groups/{group}/fmodules/{name} URI. Caller must take the FUNC-aware ` +
          `path or pass 'uri' directly. See PR #223 codex follow-up.`,
      );
    case 'INCL':
      return '/sap/bc/adt/programs/includes/';
    case 'FUGR':
      return '/sap/bc/adt/functions/groups/';
    case 'DDLS':
      return '/sap/bc/adt/ddic/ddl/sources/';
    case 'DCLS':
      return '/sap/bc/adt/acm/dcl/sources/';
    case 'BDEF':
      return '/sap/bc/adt/bo/behaviordefinitions/';
    case 'SRVD':
      return '/sap/bc/adt/ddic/srvd/sources/';
    case 'DDLX':
      return '/sap/bc/adt/ddic/ddlx/sources/';
    case 'SRVB':
      return '/sap/bc/adt/businessservices/bindings/';
    case 'TABL':
      // Default URL prefix for TABL: /tables/ (transparent tables). DDIC structures
      // live at /sap/bc/adt/ddic/structures/<name>; for those, callers must use
      // AdtClient.resolveTablObjectUrl(name) which falls back on 404.
      return '/sap/bc/adt/ddic/tables/';
    case 'DOMA':
      return '/sap/bc/adt/ddic/domains/';
    case 'DTEL':
      return '/sap/bc/adt/ddic/dataelements/';
    case 'MSAG':
      return '/sap/bc/adt/messageclass/';
    case 'DEVC':
      return '/sap/bc/adt/packages/';
    case 'TRAN':
      // VIT generic-object endpoint. The 'trant' infix is the ADT workbench type
      // for transactions; live a4h + npl 2026-05-08 confirm GET with this prefix
      // returns 200 for SE38/SU01.
      return '/sap/bc/adt/vit/wb/object_type/trant/object_name/';
    case 'VIEW':
      // VIT generic-object endpoint for DDIC views. /sap/bc/adt/ddic/views/
      // returns HTTP 500 on a4h + npl (verified 2026-05-08); only the VIT URL
      // works. Without this case, VIEW reads silently fell through to
      // /programs/programs/ — see research/abap-types/types/view.md.
      return '/sap/bc/adt/vit/wb/object_type/viewdv/object_name/';
    case 'SKTD':
      return '/sap/bc/adt/documentation/ktd/documents/';
    default:
      // Exhaustiveness guard: canonical types in KNOWN_BASE_TYPES MUST have a
      // switch case — that catches the silent-fallthrough bug class (VIEW pre-PR).
      if (KNOWN_BASE_TYPES.has(type)) {
        throw new Error(
          `objectBasePath: canonical type '${type}' is in KNOWN_BASE_TYPES but ` +
            `has no switch case. Add a case here or remove it from KNOWN_BASE_TYPES. ` +
            `See docs/plans/completed/audit-purge-invented-adt-types.md.`,
        );
      }
      // Slash-form guard: a normalized slash code (e.g. 'FUNC/FM', 'CLAS/LI',
      // 'VIEW/V', 'TRAN/O') must NEVER reach here. If it did, normalizeObjectType
      // failed to map it and we'd silently route the request to the program
      // endpoint. Tools like SAPNavigate/SAPActivate/SAPDiagnose/SAPTransport
      // accept `type: string` (no enum), so the schema layer can't catch this
      // for them — only this guard can. Throw with a hint pointing at the
      // citation guard so the contributor adds the alias correctly. Codex
      // review of PR #223 caught that the previous default-fallback could
      // still silently route removed aliases via these non-enum tools.
      if (type.includes('/')) {
        throw new Error(
          `objectBasePath: refusing to build URL for slash-form type '${type}' — ` +
            `this normally indicates an invented or unmapped ADT slash code. Add ` +
            `it to SLASH_TYPE_MAP + SLASH_TYPE_EVIDENCE (with a research entry) ` +
            `if it is real, or correct the caller. See ` +
            `docs/plans/completed/audit-purge-invented-adt-types.md and ` +
            `tests/unit/handlers/slash-type-map.test.ts.`,
        );
      }
      // Unknown raw inputs (no slash, not canonical) fall through to the
      // program path so legacy callers like inferObjectType keep working.
      return '/sap/bc/adt/programs/programs/';
  }
}

/** Map object type + name to the ADT object URL used by CRUD/DevTools/etc. Name is URI-encoded. */
function objectUrlForType(type: string, name: string): string {
  // KTD endpoints require lowercase object names in the URL path (confirmed via Eclipse ADT trace).
  const effectiveName = type === 'SKTD' ? name.toLowerCase() : name;
  return `${objectBasePath(type)}${encodeURIComponent(effectiveName)}`;
}

/** Infer SAP object type from naming conventions. Returns empty string if type cannot be determined. */
function inferObjectType(name: string): string {
  const upper = name.toUpperCase();
  if (upper.startsWith('IF_') || upper.startsWith('ZIF_') || upper.startsWith('YIF_')) return 'INTF';
  if (upper.startsWith('CL_') || upper.startsWith('ZCL_') || upper.startsWith('YCL_')) return 'CLAS';
  if (upper.startsWith('CX_') || upper.startsWith('ZCX_') || upper.startsWith('YCX_')) return 'CLAS';
  return '';
}

/**
 * Map object type + name to the ADT object URL WITHOUT encoding the name.
 * Used for API release state where the full URI is encoded as a single path segment by the caller.
 */
function objectUrlForTypeRaw(type: string, name: string): string {
  const effectiveName = type === 'SKTD' ? name.toLowerCase() : name;
  return `${objectBasePath(type)}${effectiveName}`;
}

/** Get the source URL for an object (appends /source/main) */
function sourceUrlForType(type: string, name: string): string {
  return `${objectUrlForType(type, name)}/source/main`;
}

type ClassWriteInclude = 'definitions' | 'implementations' | 'macros' | 'testclasses';
const CLASS_WRITE_INCLUDES: readonly ClassWriteInclude[] = ['definitions', 'implementations', 'macros', 'testclasses'];

/** Get a CLAS include URL (definitions/implementations/macros/testclasses) */
function classIncludeUrl(name: string, include: ClassWriteInclude): string {
  return `/sap/bc/adt/oo/classes/${encodeURIComponent(name)}/includes/${include}`;
}

function normalizeClassWriteInclude(include: unknown): ClassWriteInclude | undefined {
  if (typeof include !== 'string') return undefined;
  const normalized = include.toLowerCase() as ClassWriteInclude;
  return CLASS_WRITE_INCLUDES.includes(normalized) ? normalized : undefined;
}

/**
 * Auto-detect which class include a method specifier targets, based on the
 * local-class prefix on the LHS of `<localclass>~<method>`. Used by
 * `edit_method` so callers can pass `lhc_project~approve_project` and have
 * ARC-1 transparently route the read+write to `/includes/implementations`
 * instead of `/source/main`.
 *
 * Prefix → include mapping (intentionally narrow; extend via explicit
 * `include` parameter when a code-base uses other conventions):
 *   - `lhc_*`  → implementations (RAP behavior pool handler classes)
 *   - `lcl_*`  → implementations (local helper classes)
 *   - `ltc_*`  → testclasses    (ABAP Unit local test classes)
 *
 * Returns `undefined` for:
 *   - Specifiers with no `~` (route to MAIN)
 *   - Global-interface methods like `zif_order~create`, `if_oo_adt_classrun~main`
 *     (route to MAIN — the impl lives in a global class)
 *   - `lif_*` local interfaces (interfaces only declare methods — there's no
 *     impl in CCDEF; an `lhc_*`/`lcl_*` class implements them and the call
 *     site uses that class's prefix instead)
 */
function detectLocalHandlerInclude(method: string): ClassWriteInclude | undefined {
  if (!method.includes('~')) return undefined;
  const lhs = method.slice(0, method.indexOf('~')).trim().toLowerCase();
  if (/^(lhc|lcl)_/.test(lhs)) return 'implementations';
  if (/^ltc_/.test(lhs)) return 'testclasses';
  return undefined;
}

/** Strip the leading "=== <include> ===\n" header that `client.getClass(name, include)` prepends. */
function stripIncludeHeader(source: string): string {
  return source.replace(/^=== \w+ ===\n/, '');
}

// ─── SAPWrite Handler ────────────────────────────────────────────────

async function handleSAPWrite(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
  cachingLayer?: CachingLayer,
): Promise<ToolResult> {
  const action = String(args.action ?? '');
  const type = normalizeObjectType(String(args.type ?? ''));
  const name = String(args.name ?? '');
  const source = String(args.source ?? '');
  const hasSource = typeof args.source === 'string';
  const include = normalizeClassWriteInclude(args.include);
  const transport = args.transport as string | undefined;
  const lintOverride = args.lintBeforeWrite as boolean | undefined;
  const preflightOverride = args.preflightBeforeWrite as boolean | undefined;
  const checkOverride = args.checkBeforeWrite as boolean | undefined;

  // type and name are required for all actions except batch_create
  if (action !== 'batch_create' && (!type || !name)) {
    return errorResult('"type" and "name" are required for this action.');
  }

  // SAP TADIR stores object names uppercase. Mixed-case names cause silent corruption
  // (e.g. DDLS created as "Zc_MyView" registers as "ZC_MYVIEW" in TADIR but the source body
  // still contains "Zc_MyView", confusing every downstream tool). Reject pre-flight on create —
  // applies on every SAP release; this is universal SAP convention, not a 7.50 quirk.
  // Note: source code INSIDE the object can use mixed case (e.g. for DDLS: name="ZC_MYVIEW"
  // but `define view entity Zc_MyView` is fine inside the source body).
  if (action === 'create' && name && name !== name.toUpperCase()) {
    return errorResult(
      `Object name "${name}" contains lowercase characters. SAP object names must be uppercase (e.g. "${name.toUpperCase()}").\n\n` +
        `Note: the object NAME in TADIR must be uppercase, but the source code inside the object can use mixed case ` +
        `(e.g. for DDLS: name="${name.toUpperCase()}" but source can contain "define view entity ${name}").`,
    );
  }

  // For TABL update/delete/edit_method, the existing object may live at /tables/
  // (transparent) or /structures/ (DDIC structure). Resolve once via the client's
  // cached URL probe. For 'create' the default /tables/ URL is correct (we only
  // create transparent tables today; structure creation is out of scope).
  //
  // For FUNC, the URL has the parent function group baked into the path:
  //   /sap/bc/adt/functions/groups/{group_lc}/fmodules/{name_lc}
  // `objectBasePath('FUNC')` deliberately throws (PR #223 — generic URL builders
  // must fail loudly for FM since they can't know the parent group). Issue #250:
  // we pre-resolve the URL here from `args.group` (required for create; auto-
  // resolved via search for update/delete) so the action switch downstream uses
  // the correct URL. We also mirror the resolved group back onto args so
  // `buildCreateXml('FUNC', …, properties)` finds it.
  let objectUrl: string;
  let srcUrl: string;
  if (type === 'TABL' && action !== 'create' && action !== 'batch_create') {
    objectUrl = await client.resolveTablObjectUrl(name);
    srcUrl = `${objectUrl}/source/main`;
  } else if (type === 'FUNC') {
    let group = String(args.group ?? '').trim();
    if (!group) {
      if (action === 'create') {
        return errorResult(
          '"group" is required to create a FUNC. Create the parent function group first (SAPWrite type=FUGR) or pass group explicitly.',
        );
      }
      // For update/delete try to auto-resolve the group via search
      const resolved = cachingLayer
        ? await cachingLayer.resolveFuncGroup(client, name)
        : await client.resolveFunctionGroup(name);
      if (!resolved) {
        return errorResult(
          `Cannot resolve function group for FM "${name}". Provide the "group" parameter explicitly, or use SAPSearch to find the parent group.`,
        );
      }
      group = resolved;
    }
    const groupLc = encodeURIComponent(group.toLowerCase());
    objectUrl = `/sap/bc/adt/functions/groups/${groupLc}/fmodules/${encodeURIComponent(name.toLowerCase())}`;
    srcUrl = `${objectUrl}/source/main`;
    // Pass the resolved group through to buildCreateXml via args.group
    (args as Record<string, unknown>).group = group;
  } else {
    objectUrl = objectUrlForType(type, name);
    srcUrl = sourceUrlForType(type, name);
  }

  const invalidateWrittenObject = (objType = type, objName = name): void => {
    cachingLayer?.invalidate(objType, objName, 'all');
    cachingLayer?.inactiveLists.invalidate(client.username);
  };

  // Helper: enforce allowedPackages for existing objects (update/delete/edit_method/scaffold_rap_handlers).
  // Only fetches metadata when package restrictions are configured — no extra HTTP call otherwise.
  async function enforcePackageForExistingObject(): Promise<string | undefined> {
    if (client.safety.allowedPackages.length === 0) return undefined;
    const pkg = await client.resolveObjectPackage(objectUrl);
    if (pkg) checkPackage(client.safety, pkg);
    return pkg;
  }

  switch (action) {
    case 'update': {
      const existingPackage = await enforcePackageForExistingObject();

      // Keep CLAS local include writes ahead of the generic /source/main fallthrough.
      // If CLAS ever gains separate metadata-update handling, this branch must still
      // win whenever callers pass include=definitions|implementations|macros|testclasses.
      if (args.include !== undefined) {
        if (!include) {
          return errorResult(
            `Invalid CLAS include "${String(args.include)}". Valid values: ${CLASS_WRITE_INCLUDES.join(', ')}.`,
          );
        }
        if (type !== 'CLAS') {
          return errorResult('SAPWrite include is only supported for action="update" with type="CLAS".');
        }
        if (!hasSource) {
          return errorResult('"source" is required when updating a CLAS include.');
        }

        await safeUpdateSource(
          client.http,
          client.safety,
          objectUrl,
          classIncludeUrl(name, include),
          source,
          transport,
          cachedFeatures?.abapRelease,
        );
        invalidateWrittenObject(type, name);
        return textResult(
          `Successfully updated ${type} ${name} include ${include}. Active version remains unchanged until activation; read with SAPRead(version="inactive") to verify the draft.`,
        );
      }

      if (type === 'SKTD') {
        // KTD update requires the full <sktd:docu> XML envelope with the Markdown
        // body base64-encoded inside <sktd:text>, PUT with
        // `application/vnd.sap.adt.sktdv2+xml`. PUTting raw text/plain silently
        // no-ops (or 415s on strict systems). Fetch the current envelope,
        // replace only the <sktd:text> body, and PUT it back — preserves
        // responsible/masterLanguage/packageRef/refObject metadata.
        const { source: currentEnvelope } = await client.getKtd(name);
        const body = rewriteKtdText(currentEnvelope, source);
        await safeUpdateObject(
          client.http,
          client.safety,
          objectUrl,
          body,
          SKTD_V2_CONTENT_TYPE,
          transport,
          cachedFeatures?.abapRelease,
        );
        invalidateWrittenObject(type, name);
        return textResult(`Successfully updated ${type} ${name}.`);
      }

      if (isMetadataWriteType(type)) {
        // Metadata updates are full-XML-replace — we must fetch existing metadata
        // and merge with provided fields so omitted fields keep their current values.
        // Without this, updating just labels would reset dataType/typeKind to defaults.
        const metadataProps = getMetadataWriteProperties(args);
        const mergedProps = await mergeMetadataWriteProperties(client, type, name, metadataProps);
        const description = String(args.description ?? mergedProps._description ?? name);
        const pkg = String(args.package ?? existingPackage ?? mergedProps._package ?? '$TMP');
        const body = buildCreateXml(type, name, pkg, description, mergedProps);
        await safeUpdateObject(
          client.http,
          client.safety,
          objectUrl,
          body,
          vendorContentTypeForType(type),
          transport,
          cachedFeatures?.abapRelease,
        );
        invalidateWrittenObject(type, name);
        return textResult(`Successfully updated ${type} ${name}.`);
      }

      // RAP deterministic preflight validation
      const preflightWarnings = runRapPreflightValidation(
        source,
        type,
        name,
        cachedFeatures,
        config.systemType,
        preflightOverride,
      );
      if (preflightWarnings.blocked) return preflightWarnings.result!;

      // CDS pre-write validation: reject unsupported syntax early
      const cdsGuardUpdate = guardCdsSyntax(type, source, cachedFeatures);
      if (cdsGuardUpdate) return cdsGuardUpdate;

      // FUNC-source sanitization: strip SAPGUI-style parameter comment blocks.
      // SAP rejects PUT-to-source/main with these blocks (HTTP 400 / FUNC_ADT028
      // "Parameter comment blocks are not allowed" — verified live a4h S/4HANA 2023,
      // issue #250). LLMs frequently emit them out of muscle memory because every
      // released FM has one. Strip and warn rather than fail.
      //
      // Issue #252: when `parameters` is supplied as a structured array, splice
      // it into the FM source as ABAP-source-based signature syntax. If `source`
      // is omitted entirely, fetch the existing source first to preserve the
      // body. The structured clause replaces any existing signature region.
      let effectiveSource = source;
      let fmParamStripWarning: string | undefined;
      let fmParamMergeWarning: string | undefined;
      if (type === 'FUNC') {
        const parameters = args.parameters as FmParameter[] | undefined;
        if (parameters !== undefined) {
          // If caller passed parameters but no source, fetch the current source so
          // the body is preserved (the parameters array re-emits only the signature).
          let baseSource = source;
          if (!baseSource || baseSource.trim() === '') {
            const groupName = String(args.group ?? '');
            const fetched = await client.getFunction(groupName, name).catch(() => null);
            baseSource = fetched?.source ?? `FUNCTION ${name}.\nENDFUNCTION.\n`;
          } else if (!/^\s*FUNCTION\s+/i.test(baseSource)) {
            // Body-only source: wrap in FUNCTION/ENDFUNCTION so the splicer has
            // something to work with. Common shape from LLMs: just the body.
            baseSource = `FUNCTION ${name}.\n${baseSource}\nENDFUNCTION.\n`;
          }
          try {
            effectiveSource = spliceFmSignature(baseSource, name, parameters);
          } catch {
            // No FUNCTION token in the supplied source — fall back to user's source.
            effectiveSource = baseSource;
            fmParamMergeWarning =
              'Could not splice structured parameters: source did not start with FUNCTION keyword. Used the supplied source verbatim.';
          }
        }
        // Defense-in-depth: strip *" comment blocks even after splicing — the
        // user's body may contain them (e.g. pasted from SAPGUI).
        const stripped = stripFmParamCommentBlock(effectiveSource);
        effectiveSource = stripped.source;
        if (stripped.wasStripped) {
          fmParamStripWarning =
            'Stripped *"…IMPORTING/EXPORTING…*" parameter comment blocks (SAP rejects them on PUT — pass `parameters` as a structured array instead).';
        }
      }

      // Pre-write lint validation (uses sanitized source for FUNC)
      const lintWarnings = runPreWriteLint(effectiveSource, type, name, config, lintOverride);
      if (lintWarnings.blocked) return lintWarnings.result!;

      // Pre-write server-side syntax check (opt-in; never blocks — warnings only).
      const checkNotes = await runPreWriteSyntaxCheck(client, type, effectiveSource, objectUrl, config, checkOverride);

      // If safeUpdateSource throws (lock conflict, network error, etc.), checkNotes
      // is intentionally discarded — pre-check warnings only matter when the write succeeded.
      await safeUpdateSource(
        client.http,
        client.safety,
        objectUrl,
        srcUrl,
        effectiveSource,
        transport,
        cachedFeatures?.abapRelease,
      );
      invalidateWrittenObject(type, name);
      const msg = `Successfully updated ${type} ${name}.`;
      const cdsUpdateHint = type === 'DDLS' ? await buildCdsUpdateCrudHint(client, name, objectUrl) : undefined;
      const warnings = mergePreWriteWarnings(
        preflightWarnings.warnings,
        lintWarnings.warnings,
        checkNotes,
        cdsUpdateHint,
        fmParamStripWarning,
        fmParamMergeWarning,
      );
      return warnings ? textResult(`${msg}\n\n${warnings}`) : textResult(msg);
    }
    case 'create': {
      const pkg = String(args.package ?? '$TMP');
      checkPackage(client.safety, pkg);
      const description = String(args.description ?? name);

      // Pre-flight: check transport requirements for non-$TMP packages when no transport provided.
      // SAP requires a transport number for objects in transportable packages.
      // Instead of letting SAP return a cryptic error, we detect this early and return
      // an actionable error message guiding the LLM to use SAPTransport first.
      let effectiveTransport = transport;
      if (!transport && pkg.toUpperCase() !== '$TMP') {
        try {
          const transportInfo = await getTransportInfo(client.http, client.safety, objectUrl, pkg, 'I');
          if (transportInfo.lockedTransport) {
            // Object is already locked in a transport — use it automatically
            effectiveTransport = transportInfo.lockedTransport;
          } else if (!transportInfo.isLocal && transportInfo.recording) {
            // Transport IS required but none provided — return guidance
            const existingList =
              transportInfo.existingTransports.length > 0
                ? `\n\nExisting transports for this package:\n${transportInfo.existingTransports
                    .slice(0, 10)
                    .map((t) => `  - ${t.id}: ${t.description} (${t.owner})`)
                    .join('\n')}`
                : '';
            return errorResult(
              `Package "${pkg}" requires a transport number for object creation, but none was provided.\n\n` +
                `To fix this, either:\n` +
                `1. Use SAPTransport(action="list") to find an existing modifiable transport\n` +
                `2. Use SAPTransport(action="create", description="...") to create a new one\n` +
                `3. Then retry SAPWrite(action="create", ..., transport="<transport_id>")` +
                existingList,
            );
          }
          // isLocal=true or recording=false → no transport needed, proceed without one
        } catch {
          // If transportInfo check fails (older system, permissions, etc.), proceed without it.
          // SAP will return its own error if a transport is actually needed.
        }
      }

      // MSAG transport-vs-task guard. Some SAP releases silently drop message inserts when
      // given a task number as corrNr — CL_ADT_MESSAGE_CLASS_API=>create() passes corrNr to
      // CTS_WBO_API_INSERT_OBJECTS which only accepts request numbers. The TADIR entry is
      // created but T100/T100A are never written, leaving a phantom MSAG. Confirmed on NW 7.50;
      // unclear whether later releases fixed it, so validate everywhere.
      // Cost: one extra HTTP roundtrip per MSAG create (negligible vs. the data loss risk).
      if (type === 'MSAG' && effectiveTransport) {
        const tr = await getTransport(client.http, client.safety, effectiveTransport);
        if (!tr) {
          return errorResult(
            `Transport "${effectiveTransport}" is not a valid transport request. ` +
              `MSAG creation requires a transport request number, not a task number. ` +
              `Use SAPTransport(action="get", id="<request>") to verify, or SAPTransport(action="list") to find modifiable requests.`,
          );
        }
      }

      // CDS pre-write validation: reject unsupported syntax early
      const cdsGuard = guardCdsSyntax(type, source, cachedFeatures);
      if (cdsGuard) return cdsGuard;

      // RAP deterministic preflight validation (before object creation to avoid stubs)
      const preflightWarnings = runRapPreflightValidation(
        source,
        type,
        name,
        cachedFeatures,
        config.systemType,
        preflightOverride,
      );
      if (preflightWarnings.blocked) return preflightWarnings.result!;

      // AFF header validation (if schema available for this type)
      const affResult = validateAffHeader(type, { description, originalLanguage: 'en' });
      if (!affResult.valid) {
        return errorResult(
          `AFF metadata validation failed for ${type} ${name}:\n- ${(affResult.errors ?? []).join('\n- ')}\n\nFix the metadata and retry.`,
        );
      }

      if (type === 'SKTD') {
        // A KTD is not a standalone object — it documents a parent object (e.g., a DDLS view or a CLAS).
        // The create POST goes to the collection URL with a sktd:docu XML body that references the parent.
        const refType = String(args.refObjectType ?? '');
        if (!refType) {
          return errorResult(
            '"refObjectType" is required for SKTD create — the ADT type+subtype of the parent object being documented (e.g., "DDLS/DF", "CLAS/OC", "PROG/P", "INTF/OI", "BDEF/BDO", "SRVD/SRV").',
          );
        }
        const refName = String(args.refObjectName ?? name);
        // SAP rule: a KTD's own name must equal the parent object's name (one KTD per object).
        // Creating a KTD named differently from its parent fails server-side with a cryptic
        // "Check of condition failed" — fail fast with a clear message instead.
        if (refName.toUpperCase() !== name.toUpperCase()) {
          return errorResult(
            `SKTD name "${name}" must match refObjectName "${refName}" — a Knowledge Transfer Document inherits the name of the ABAP object it documents (one KTD per object). To document "${refName}", call SAPWrite(action="create", type="SKTD", name="${refName}", refObjectType="${refType}", ...).`,
          );
        }
        const refDescription = String(args.refObjectDescription ?? '');
        // Build the parent URI. ADT URIs use lowercase names by convention (matches the Eclipse trace).
        const refParentType = refType.split('/')[0] ?? '';
        const refUri = `${objectBasePath(refParentType)}${encodeURIComponent(refName.toLowerCase())}`;

        const ktdBody = `<?xml version="1.0" encoding="UTF-8"?>
<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:language="EN" adtcore:name="${escapeXml(name)}" adtcore:type="SKTD/TYP" adtcore:masterLanguage="EN">
  <adtcore:packageRef adtcore:name="${escapeXml(pkg)}"/>
  <sktd:refObject adtcore:description="${escapeXml(refDescription)}" adtcore:name="${escapeXml(refName)}" adtcore:type="${escapeXml(refType)}" adtcore:uri="${escapeXml(refUri)}"/>
</sktd:docu>`;

        const ktdCreateUrl = '/sap/bc/adt/documentation/ktd/documents';
        const ktdResult = await createObject(
          client.http,
          client.safety,
          ktdCreateUrl,
          ktdBody,
          SKTD_V2_CONTENT_TYPE,
          effectiveTransport,
          undefined,
          cachedFeatures?.abapRelease,
        );

        // If initial Markdown was provided, follow up with an update PUT to write it.
        // Same envelope contract as the update path: fetch-then-rewrite ensures we
        // PUT back exactly the shape SAP gave us (with all the server-assigned
        // metadata), only swapping <sktd:text>.
        if (source) {
          const { source: currentEnvelope } = await client.getKtd(name);
          const body = rewriteKtdText(currentEnvelope, source);
          await safeUpdateObject(
            client.http,
            client.safety,
            objectUrl,
            body,
            SKTD_V2_CONTENT_TYPE,
            effectiveTransport,
            cachedFeatures?.abapRelease,
          );
          invalidateWrittenObject(type, name);
          return textResult(
            `Created SKTD ${name} in package ${pkg} and wrote Markdown content.\nNext step: SAPActivate(type="SKTD", name="${name}").\n${ktdResult}`,
          );
        }
        invalidateWrittenObject();
        return textResult(
          `Created SKTD ${name} in package ${pkg} (no Markdown content written — pass "source" to write the body).\nNext step: SAPActivate(type="SKTD", name="${name}").\n${ktdResult}`,
        );
      }

      // Build type-specific creation XML body.
      // SAP ADT requires the root element to match the object type —
      // a generic objectReferences body returns 400 "System expected the element ...".
      const metadataProperties = getMetadataWriteProperties(args);
      const body = buildCreateXml(type, name, pkg, description, metadataProperties);

      // Step 1: Create the object (metadata only)
      const createUrl = objectUrl.replace(/\/[^/]+$/, ''); // parent collection URL
      // DOMA/DTEL/BDEF require vendor-specific content types; all other types use
      // 'application/*' — the wildcard lets the SAP server resolve the correct
      // handler (matching how ADT Eclipse and abap-adt-api send requests).
      const contentType = createContentTypeForType(type);
      const needsPackageParam = type === 'BDEF' || type === 'TABL';
      let result: string;
      try {
        result = await createObject(
          client.http,
          client.safety,
          createUrl,
          body,
          contentType,
          effectiveTransport,
          needsPackageParam ? pkg : undefined,
          cachedFeatures?.abapRelease,
        );
      } catch (createErr) {
        if (createErr instanceof AdtApiError && (createErr.statusCode === 400 || createErr.statusCode === 409)) {
          const syntaxDetail = await tryPostSaveSyntaxCheck(client, type, name);
          if (syntaxDetail) {
            createErr.message += syntaxDetail;
          }
        }
        throw createErr;
      }

      if (isMetadataWriteType(type)) {
        // SAP's DTEL POST ignores labels, searchHelp, etc. — they require a follow-up PUT.
        // Use withStatefulSession directly (not safeUpdateObject) to keep the lock cycle
        // on the main client's session, avoiding lock contention with subsequent operations.
        if (type === 'DTEL' && dtelNeedsPostCreateUpdate(metadataProperties)) {
          const ct = vendorContentTypeForType(type);
          await client.http.withStatefulSession(async (session) => {
            const lock = await lockObject(session, client.safety, objectUrl, 'MODIFY', cachedFeatures?.abapRelease);
            const lockTransport = effectiveTransport ?? (lock.corrNr || undefined);
            try {
              await updateObject(session, client.safety, objectUrl, body, lock.lockHandle, ct, lockTransport);
            } finally {
              await unlockObject(session, objectUrl, lock.lockHandle);
            }
          });
        }
        // MSAG: POST creates empty container — follow-up PUT to write messages
        if (type === 'MSAG' && Array.isArray(metadataProperties.messages) && metadataProperties.messages.length > 0) {
          const ct = vendorContentTypeForType(type);
          await client.http.withStatefulSession(async (session) => {
            const lock = await lockObject(session, client.safety, objectUrl, 'MODIFY', cachedFeatures?.abapRelease);
            const lockTransport = effectiveTransport ?? (lock.corrNr || undefined);
            try {
              await updateObject(session, client.safety, objectUrl, body, lock.lockHandle, ct, lockTransport);
            } finally {
              await unlockObject(session, objectUrl, lock.lockHandle);
            }
          });
        }
        invalidateWrittenObject();
        const followUpHint =
          type === 'SRVB'
            ? `\n\nNext steps:\n1. SAPActivate(type="SRVB", name="${name}")\n2. SAPActivate(action="publish_srvb", name="${name}")`
            : '';
        return textResult(`Created ${type} ${name} in package ${pkg}.\n${result}${followUpHint}`);
      }

      // Step 2: Write source code if provided.
      // Issue #252: FUNC create accepts a structured `parameters` array; if
      // provided we must follow up with a source PUT even when `source` is
      // omitted (the array alone synthesizes a minimal FUNCTION/ENDFUNCTION
      // body containing the signature clause).
      const funcParameters = type === 'FUNC' ? (args.parameters as FmParameter[] | undefined) : undefined;
      const shouldWriteSource = !!source || (funcParameters !== undefined && funcParameters.length > 0);
      if (shouldWriteSource) {
        // FUNC: build/splice the signature, then strip SAPGUI parameter comment
        // blocks as defense-in-depth (see update path for rationale).
        let createSource = source ?? '';
        let fmParamStripWarning: string | undefined;
        let fmParamMergeWarning: string | undefined;
        if (type === 'FUNC') {
          if (funcParameters !== undefined) {
            let baseSource: string;
            if (!createSource || createSource.trim() === '') {
              baseSource = `FUNCTION ${name}.\nENDFUNCTION.\n`;
            } else if (!/^\s*FUNCTION\s+/i.test(createSource)) {
              // Body-only source — wrap so the splicer has a signature region.
              baseSource = `FUNCTION ${name}.\n${createSource}\nENDFUNCTION.\n`;
            } else {
              baseSource = createSource;
            }
            try {
              createSource = spliceFmSignature(baseSource, name, funcParameters);
            } catch {
              createSource = baseSource;
              fmParamMergeWarning =
                'Could not splice structured parameters: source did not start with FUNCTION keyword. Used the supplied source verbatim.';
            }
          }
          const stripped = stripFmParamCommentBlock(createSource);
          createSource = stripped.source;
          if (stripped.wasStripped) {
            fmParamStripWarning =
              'Stripped *"…IMPORTING/EXPORTING…*" parameter comment blocks (pass `parameters` as a structured array instead).';
          }
        }

        // Pre-write lint validation
        const lintWarnings = runPreWriteLint(createSource, type, name, config, lintOverride);
        if (lintWarnings.blocked) {
          return textResult(
            `Created ${type} ${name} in package ${pkg}, but source was rejected by lint:\n${lintWarnings.result!.content[0].text}`,
          );
        }

        await safeUpdateSource(
          client.http,
          client.safety,
          objectUrl,
          srcUrl,
          createSource,
          effectiveTransport,
          cachedFeatures?.abapRelease,
        );
        invalidateWrittenObject(type, name);
        const msg = `Created ${type} ${name} in package ${pkg} and wrote source code.`;
        const warnings = mergePreWriteWarnings(
          preflightWarnings.warnings,
          lintWarnings.warnings,
          fmParamStripWarning,
          fmParamMergeWarning,
        );
        return warnings ? textResult(`${msg}\n\n${warnings}`) : textResult(msg);
      }

      return textResult(`Created ${type} ${name} in package ${pkg}.\n${result}`);
    }
    case 'edit_method': {
      const method = String(args.method ?? '');
      if (!method) return errorResult('"method" is required for edit_method action.');
      if (!source) return errorResult('"source" (new method body) is required for edit_method action.');
      if (type !== 'CLAS') return errorResult('edit_method is only supported for type=CLAS.');
      await enforcePackageForExistingObject();

      // ── Resolve which class section the method body lives in ──
      // Order:
      //   1. Explicit `include` parameter wins (must be a valid CLAS include).
      //      If the user passed something but normalization rejected it,
      //      report it the same way `case 'update'` does.
      //   2. Auto-detect from local-class prefix in `method` specifier
      //      (lhc_*/lcl_* → implementations, ltc_* → testclasses). This is
      //      transparent to RAP-skill callers passing `lhc_project~approve_project`.
      //   3. Fall through to MAIN (existing behavior — covers global classes
      //      and `zif_order~create` style interface methods).
      if (args.include !== undefined && !include) {
        return errorResult(
          `Invalid CLAS include "${String(args.include)}". Valid values: ${CLASS_WRITE_INCLUDES.join(', ')}.`,
        );
      }
      const detectedInclude = include ? undefined : detectLocalHandlerInclude(method);
      const resolvedInclude: ClassWriteInclude | undefined = include ?? detectedInclude;

      // Fetch the source that contains the method.
      // Note: include reads bypass the source cache because the cache key is
      // `(type, name, active|inactive)` and does not differentiate by include.
      // Mixing MAIN and CCIMP bytes under the same key would silently corrupt
      // subsequent reads. Future enhancement: extend cache key with include.
      let currentSource: string;
      if (resolvedInclude) {
        // **Draft-aware include reads (PR-D review fix, P1).**
        // After `SAPWrite update include=...` or `scaffold_rap_handlers`, the
        // edited CCDEF/CCIMP lives as an inactive draft; the active include
        // is often still the empty placeholder. Reading "active" here would
        // splice against stale content (and frequently "method not found").
        // Use the standard inactive-list lookup to pick the right version —
        // same auto-resolution semantics SAPRead exposes via `version='auto'`.
        const { effectiveVersion } = await resolveVersionAndDraftInfo(client, cachingLayer, 'CLAS', name, 'auto');
        const fetched = await client.getClass(name, resolvedInclude, { version: effectiveVersion });
        currentSource = stripIncludeHeader(fetched.source);
        // If the include itself has no draft (only MAIN does), SAP returns the
        // active include body for `?version=inactive`. That's correct — we
        // splice whatever the editor would see. If the include source isn't
        // available at all (response contains the "not available" placeholder
        // injected by client.getClass on 404), splice will surface a clean
        // "method not found" with the include name.
      } else {
        currentSource = cachingLayer
          ? (
              await cachingLayer.getSource('CLAS', name, (ifNoneMatch) =>
                client.getClass(name, undefined, { ifNoneMatch }),
              )
            ).source
          : (await client.getClass(name)).source;
      }

      // Use detected ABAP version from probe if available
      const abaplintVer = cachedFeatures?.abapRelease
        ? mapSapReleaseToAbaplintVersion(cachedFeatures.abapRelease)
        : undefined;

      // Splice in the new method body
      const spliced = spliceMethod(currentSource, name, method, source, abaplintVer);
      if (!spliced.success) {
        // Augment the error with which include was searched, so the LLM can
        // either correct the method specifier or override include= explicitly.
        const where = resolvedInclude ? `include "${resolvedInclude}"` : 'main source';
        const baseError = spliced.error ?? `Failed to splice method "${method}" in ${name}.`;
        const hint = detectedInclude
          ? ` (auto-routed via "${method}" prefix; pass include= explicitly to override).`
          : '';
        return errorResult(`${baseError} Searched ${where} of ${name}.${hint}`);
      }

      // Pre-write lint + server-side syntax check on the spliced source.
      //
      // Skip BOTH for include= writes. abaplint cannot parse a CCIMP/CCDEF
      // fragment as a complete class (the DEFINITION/IMPLEMENTATION halves
      // live in different files), so it would block legitimate writes with
      // "Expected CLASSDEFINITION" errors. The existing `case 'update'` include=
      // path also bypasses these checks for the same reason — keep parity.
      // The full-class activation pass after the write is the authoritative
      // syntax check.
      let lintWarnings: ReturnType<typeof runPreWriteLint> = { blocked: false } as ReturnType<typeof runPreWriteLint>;
      let checkNotes = '';
      if (!resolvedInclude) {
        lintWarnings = runPreWriteLint(spliced.newSource, type, name, config, lintOverride);
        if (lintWarnings.blocked) return lintWarnings.result!;

        checkNotes = await runPreWriteSyntaxCheck(client, type, spliced.newSource, objectUrl, config, checkOverride);
      }

      // Write the full source back (existing lock/modify/unlock flow).
      // For include writes, the parent class lock auto-applies; the include URL
      // takes the body. See `compare/eclipse-adt/api/05-lock-create-update-transport.md`.
      const writeUrl = resolvedInclude ? classIncludeUrl(name, resolvedInclude) : srcUrl;
      await safeUpdateSource(
        client.http,
        client.safety,
        objectUrl,
        writeUrl,
        spliced.newSource,
        transport,
        cachedFeatures?.abapRelease,
      );
      invalidateWrittenObject(type, name);
      const where = resolvedInclude ? ` (include: ${resolvedInclude})` : '';
      const msg = `Successfully updated method "${method}" in ${type} ${name}${where}.`;
      const extras = [lintWarnings.warnings, checkNotes].filter(Boolean).join('\n\n');
      return extras ? textResult(`${msg}\n\n${extras}`) : textResult(msg);
    }
    case 'scaffold_rap_handlers': {
      // What this action does:
      //   Given a behavior-pool class (ZBP_*) and its interface BDEF, inspect
      //   the class for every `lhc_<alias>` local handler class and make
      //   sure it declares a METHOD for every action / determination /
      //   validation / authorization master the BDEF requires. When autoApply
      //   is true, missing METHODS signatures plus empty METHOD stubs are
      //   inserted directly and the class is saved.
      //
      // Why this exists:
      //   Without it, the LLM agent trying to author a RAP behavior pool has
      //   to manually read the BDEF, compute the required handler signatures,
      //   paste them into the correct local class, and then save — a
      //   boilerplate-heavy step that is easy to get wrong (alias case,
      //   RESULT vs no RESULT, factory/static modifiers). The activation
      //   errors for an incomplete pool are particularly unhelpful. See
      //   docs/plans/completed/rap-onprem-agent-gap-closure.md.
      if (type !== 'CLAS') {
        return errorResult('scaffold_rap_handlers is only supported for type=CLAS behavior pool classes.');
      }
      const bdefName = String(args.bdefName ?? '').trim();
      if (!bdefName) {
        return errorResult('"bdefName" is required for scaffold_rap_handlers (interface behavior definition name).');
      }
      const autoApply = Boolean(args.autoApply ?? false);
      const targetAlias = String(args.targetAlias ?? '')
        .trim()
        .toLowerCase();

      if (autoApply) {
        await enforcePackageForExistingObject();
      }

      // Why scan all three CLAS includes (main, definitions, implementations):
      //   Behavior-pool handler classes CAN live in any of the three, and
      //   which include they occupy depends on how the pool was generated:
      //     - "main" (source/main) — unusual; some hand-written pools put
      //       lhc_* alongside the global class definition
      //     - "definitions" (CCDEF) — the ADT "Create Behavior Impl Class"
      //       wizard default target
      //     - "implementations" (CCIMP) — older SAP templates and every
      //       example under /DMO/* ship the handler classes here
      //   We read all three so the diff (findMissingRapHandlerRequirements)
      //   reflects what's actually declared anywhere in the class, and the
      //   apply flow can fall through main → definitions → implementations.
      const classStructured = await client.getClassStructured(name);
      const classMainSource = classStructured.main ?? '';
      const classDefinitionsSource = classStructured.definitions ?? '';
      const classImplementationsSource = classStructured.implementations ?? '';
      const classCombinedSource = [classMainSource, classDefinitionsSource, classImplementationsSource]
        .filter(Boolean)
        .join('\n\n');
      const bdefSource = cachingLayer
        ? (await cachingLayer.getSource('BDEF', bdefName, (ifNoneMatch) => client.getBdef(bdefName, { ifNoneMatch })))
            .source
        : (await client.getBdef(bdefName)).source;

      let requirements = extractRapHandlerRequirements(bdefSource);
      if (targetAlias) {
        requirements = requirements.filter((req) => req.entityAlias.toLowerCase() === targetAlias);
      }

      if (requirements.length === 0) {
        const allAliases = Array.from(new Set(extractRapHandlerRequirements(bdefSource).map((req) => req.entityAlias)));
        const aliasHint =
          targetAlias && allAliases.length > 0
            ? ` Available aliases in ${bdefName}: ${allAliases.join(', ')}.`
            : ' No RAP action/determination/validation/auth handler declarations were found in the BDEF source.';
        return errorResult(`No RAP handler requirements were found for the requested scope.${aliasHint}`);
      }

      const missing = findMissingRapHandlerRequirements(requirements, classCombinedSource);
      const missingImplementationStubs = findMissingRapHandlerImplementationStubs(requirements, classCombinedSource);
      const summary = {
        className: name,
        bdefName,
        targetAlias: targetAlias || undefined,
        scannedSections: [
          'main',
          classDefinitionsSource ? 'definitions' : undefined,
          classImplementationsSource ? 'implementations' : undefined,
        ].filter(Boolean),
        requiredCount: requirements.length,
        missingCount: missing.length,
        missing,
        missingImplementationStubCount: missingImplementationStubs.length,
        missingImplementationStubs,
      };

      if (!autoApply || (missing.length === 0 && missingImplementationStubs.length === 0)) {
        return textResult(JSON.stringify({ ...summary, applied: false }, null, 2));
      }

      // Pure RAP transformation planning lives in rap-handlers.ts. Keep this
      // handler focused on MCP/ADT concerns: safety, linting, locking, writes.
      const scaffoldPlan = applyRapHandlerScaffold(
        {
          main: classMainSource,
          definitions: classDefinitionsSource || undefined,
          implementations: classImplementationsSource || undefined,
        },
        missing,
        missingImplementationStubs,
      );

      if (scaffoldPlan.changedSections.length === 0) {
        const unresolvedHandlerClasses = Array.from(
          new Set(scaffoldPlan.unresolved.map((req) => req.targetHandlerClass)),
        );
        const unresolvedHint =
          unresolvedHandlerClasses.length > 0
            ? `No source changes were applied because handler class skeleton(s) ${unresolvedHandlerClasses.join(', ')} were not found in main, definitions, or implementations. Create the local handler class skeleton(s) first (for example with the ADT quick fix "Create local handler class"), then rerun with autoApply=true.`
            : undefined;
        return textResult(
          JSON.stringify(
            {
              ...summary,
              applied: false,
              hint: unresolvedHint,
              applyResult: {
                skeletons: scaffoldPlan.skeletons,
                main: scaffoldPlan.signatures.main,
                definitions: scaffoldPlan.signatures.definitions,
                implementations: scaffoldPlan.signatures.implementations,
                implementationStubs: scaffoldPlan.implementationStubs,
                unresolved: scaffoldPlan.unresolved,
              },
            },
            null,
            2,
          ),
        );
      }

      const finalMainSource = scaffoldPlan.sections.main;
      const finalDefinitionsSource = scaffoldPlan.sections.definitions;
      const finalImplementationsSource = scaffoldPlan.sections.implementations;
      const { changed } = scaffoldPlan;

      // Run lint for every section we are about to update; block before any write to avoid partial state.
      let lintWarningsMain: PreWriteLintResult | undefined;
      if (changed.main) {
        lintWarningsMain = runPreWriteLint(finalMainSource, type, name, config, lintOverride);
        if (lintWarningsMain.blocked) return lintWarningsMain.result!;
      }
      let lintWarningsDefinitions: PreWriteLintResult | undefined;
      if (changed.definitions && finalDefinitionsSource) {
        lintWarningsDefinitions = runPreWriteLint(finalDefinitionsSource, type, name, config, lintOverride);
        if (lintWarningsDefinitions.blocked) return lintWarningsDefinitions.result!;
      }
      let lintWarningsImplementations: PreWriteLintResult | undefined;
      if (changed.implementations && finalImplementationsSource) {
        lintWarningsImplementations = runPreWriteLint(finalImplementationsSource, type, name, config, lintOverride);
        if (lintWarningsImplementations.blocked) return lintWarningsImplementations.result!;
      }
      // All modified includes share one lock so we never end up in a partial-state
      // (e.g. main written, implementations errored → handler class declares but
      // doesn't implement methods → class cannot activate). The lock is taken once
      // at the class object URL, and every include PUT carries the same lockHandle.
      // This mirrors how ADT-in-Eclipse saves a multi-include class in one commit.
      await client.http.withStatefulSession(async (session) => {
        const lock = await lockObject(session, client.safety, objectUrl, 'MODIFY', cachedFeatures?.abapRelease);
        const effectiveTransport = transport ?? (lock.corrNr || undefined);
        try {
          if (changed.main) {
            await updateSource(session, client.safety, srcUrl, finalMainSource, lock.lockHandle, effectiveTransport);
          }
          if (changed.definitions && finalDefinitionsSource) {
            await updateSource(
              session,
              client.safety,
              classIncludeUrl(name, 'definitions'),
              finalDefinitionsSource,
              lock.lockHandle,
              effectiveTransport,
            );
          }
          if (changed.implementations && finalImplementationsSource) {
            await updateSource(
              session,
              client.safety,
              classIncludeUrl(name, 'implementations'),
              finalImplementationsSource,
              lock.lockHandle,
              effectiveTransport,
            );
          }
        } finally {
          // Best-effort unlock — if the object was already removed or the session
          // expired, we still want to surface the original error instead of masking
          // it with an unlock failure.
          try {
            await unlockObject(session, objectUrl, lock.lockHandle);
          } catch {
            // Swallowed intentionally; see comment above.
          }
        }
      });
      invalidateWrittenObject();

      const msg =
        `Scaffolded ${scaffoldPlan.insertedSignatureCount} RAP handler signature(s) and ${scaffoldPlan.insertedImplementationStubCount} implementation stub(s) in ${type} ${name} from BDEF ${bdefName}. ` +
        `Auto-created ${scaffoldPlan.skeletons.createdDefinitions.length + scaffoldPlan.skeletons.createdImplementations.length} handler skeleton section(s). ` +
        `Updated section(s): ${scaffoldPlan.changedSections.join(', ')}.`;
      const warnings = mergePreWriteWarnings(
        lintWarningsMain?.warnings,
        lintWarningsDefinitions?.warnings,
        lintWarningsImplementations?.warnings,
      );
      const details = JSON.stringify(
        {
          ...summary,
          applied: true,
          applyResult: {
            skeletons: scaffoldPlan.skeletons,
            main: scaffoldPlan.signatures.main,
            definitions: scaffoldPlan.signatures.definitions,
            implementations: scaffoldPlan.signatures.implementations,
            implementationStubs: scaffoldPlan.implementationStubs,
            unresolved: scaffoldPlan.unresolved,
          },
        },
        null,
        2,
      );
      return warnings ? textResult(`${msg}\n\n${warnings}\n\n${details}`) : textResult(`${msg}\n\n${details}`);
    }
    case 'generate_behavior_implementation': {
      // PR-C: high-level RAP one-shot — auto-discover BDEF via class metadata's
      // rootEntityRef, scaffold every required handler (creating lhc_<alias>
      // skeletons when missing), write under one lock, and (by default) activate.
      // Reliable equivalent of Eclipse ADT's "Generate Behavior Implementation"
      // Cmd+1 quickfix; avoids the broken /sap/bc/adt/quickfixes/proposals/
      // create_class_implementation server endpoint (HTTP 500 on a4h, verified
      // live during PR-C research). See docs/plans/add-generate-behavior-implementation.md.
      if (type !== 'CLAS') {
        return errorResult('generate_behavior_implementation is only supported for type=CLAS behavior pool classes.');
      }
      if (!name) {
        return errorResult('"name" is required for generate_behavior_implementation.');
      }
      const dryRun = args.dryRun === true || String(args.dryRun ?? '') === 'true';
      const activate = args.activate === undefined ? true : args.activate === true || String(args.activate) === 'true';
      const explicitBdef = (args.bdefName as string | undefined)?.trim() || undefined;
      const targetAlias = (args.targetAlias as string | undefined)?.trim() || undefined;

      // Package gate only when we'll actually mutate. dryRun=true is read-only;
      // bypassing the gate matches the scaffold_rap_handlers preview pattern.
      if (!dryRun) {
        await enforcePackageForExistingObject();
      }

      const result = await generateBehaviorImplementation(client, name, {
        bdefName: explicitBdef,
        targetAlias,
        activate,
        dryRun,
        transport,
      });
      invalidateWrittenObject();
      // MCP result-code mapping via the exported helper — see
      // `isRapGenerateResultSuccess` for the success/error contract (Codex review on PR #260, P1).
      // The structured JSON is preserved in both branches so the caller can still see what
      // was discovered, written, and what activation reported.
      const json = JSON.stringify(result, null, 2);
      return isRapGenerateResultSuccess(result) ? textResult(json) : errorResult(json);
    }
    case 'delete': {
      await enforcePackageForExistingObject();

      // Lock, delete, unlock pattern (works for all types including SKTD) — auto-propagate lock corrNr if no explicit transport
      try {
        await client.http.withStatefulSession(async (session) => {
          const lock = await lockObject(session, client.safety, objectUrl, 'MODIFY', cachedFeatures?.abapRelease);
          const effectiveTransport = transport ?? (lock.corrNr || undefined);
          try {
            await deleteObject(session, client.safety, objectUrl, lock.lockHandle, effectiveTransport);
          } finally {
            try {
              await unlockObject(session, objectUrl, lock.lockHandle);
            } catch {
              // Object may already be deleted — unlock failure is expected
            }
          }
        });
      } catch (err) {
        if (err instanceof AdtApiError && CDS_DEPENDENCY_SENSITIVE_TYPES.has(type) && isDeleteDependencyError(err)) {
          const hint = await buildCdsDeleteDependencyHint(client, type, name, objectUrl);
          if (hint) {
            // Attach via extraHint so the LLM-facing formatter renders it after
            // DDIC diagnostics ("what happened → diagnostics → how to fix").
            // Mutating err.message would surface the hint before diagnostics and
            // leak into any other consumer of the same error instance.
            err.extraHint = hint;
          }
        }
        throw err;
      }
      invalidateWrittenObject();
      return textResult(`Deleted ${type} ${name}.`);
    }
    case 'batch_create': {
      const objects = args.objects as Array<Record<string, unknown>> | undefined;
      if (!objects || !Array.isArray(objects) || objects.length === 0) {
        return errorResult('"objects" array is required and must be non-empty for batch_create action.');
      }

      // Opt-in deferred-activation: writes every object as an inactive draft first,
      // then issues a single terminal activateBatch over the written subset. Use case:
      // composition-linked DDLS / interdependent RAP graphs where per-object inline
      // activate() can't resolve cross-references to not-yet-active siblings.
      const activateAtEnd = args.activateAtEnd === true || String(args.activateAtEnd) === 'true';

      const defaultPackage = normalizePackageOverride(args.package, '$TMP');

      const batchPlan = objects.map((obj) => {
        const objType = normalizeObjectType(String(obj.type ?? ''));
        const objName = String(obj.name ?? '');
        const objPackage = normalizePackageOverride(obj.package, defaultPackage);
        const explicitTransport = normalizeTransportOverride(obj.transport) ?? transport;
        return { obj, type: objType, name: objName, packageName: objPackage, explicitTransport };
      });

      // Check every target package before starting any creates.
      for (const pkg of new Set(batchPlan.map((item) => item.packageName))) {
        checkPackage(client.safety, pkg);
      }

      // Pre-flight transport check for batch_create (same logic as single create),
      // but keyed by each effective package because objects can override package.
      const autoTransportByPackage = new Map<string, string | undefined>();
      const firstPlanNeedingTransportByPackage = new Map<string, (typeof batchPlan)[number]>();
      for (const plan of batchPlan) {
        if (
          !plan.explicitTransport &&
          plan.packageName.toUpperCase() !== '$TMP' &&
          !firstPlanNeedingTransportByPackage.has(plan.packageName)
        ) {
          firstPlanNeedingTransportByPackage.set(plan.packageName, plan);
        }
      }
      for (const [pkg, plan] of firstPlanNeedingTransportByPackage) {
        try {
          const firstUrl = objectUrlForType(plan.type, plan.name);
          const transportInfo = await getTransportInfo(client.http, client.safety, firstUrl, pkg, 'I');
          if (transportInfo.lockedTransport) {
            autoTransportByPackage.set(pkg, transportInfo.lockedTransport);
          } else if (!transportInfo.isLocal && transportInfo.recording) {
            const existingList =
              transportInfo.existingTransports.length > 0
                ? `\n\nExisting transports for this package:\n${transportInfo.existingTransports
                    .slice(0, 10)
                    .map((t) => `  - ${t.id}: ${t.description} (${t.owner})`)
                    .join('\n')}`
                : '';
            return errorResult(
              `Package "${pkg}" requires a transport number for object creation, but none was provided.\n\n` +
                `To fix this, either:\n` +
                `1. Use SAPTransport(action="list") to find an existing modifiable transport\n` +
                `2. Use SAPTransport(action="create", description="...") to create a new one\n` +
                `3. Then retry SAPWrite(action="batch_create", ..., transport="<transport_id>")` +
                existingList,
            );
          }
        } catch (err) {
          logger.warn('SAPWrite batch_create transport preflight failed; continuing without auto transport', {
            package: pkg,
            type: plan.type,
            name: plan.name,
            error: err instanceof Error ? err.message : String(err),
          });
          // If transportInfo check fails, proceed — SAP will return its own error if needed.
        }
      }

      const results: Array<{
        type: string;
        name: string;
        packageName: string;
        status: 'success' | 'failed';
        error?: string;
      }> = [];
      const batchWarnings: string[] = [];
      // Per-batch cache for the MSAG transport-vs-task guard. The bug is universal so the
      // guard fires for every MSAG entry, but a batch typically shares one transport — cache
      // the lookup result to avoid one HTTP roundtrip per object.
      const transportLookupCache = new Map<string, Awaited<ReturnType<typeof getTransport>>>();
      // Accumulated objects whose create + source-write phase succeeded — used by the
      // terminal activateBatch when activateAtEnd=true. Order matches the input order.
      const writtenObjects: BatchActivationObject[] = [];

      for (const plan of batchPlan) {
        const { obj, type: objType, name: objName, packageName: objPackage } = plan;
        const objTransport = plan.explicitTransport ?? autoTransportByPackage.get(objPackage);
        const metadataObject = isMetadataWriteType(objType);
        const objSource = obj.source ? String(obj.source) : undefined;
        const objDescription = String(obj.description ?? objName);

        // Mixed-case object name rejection (matches the create-path check above).
        // Universal SAP convention — TADIR is uppercase on every release.
        // Cheap check first: no HTTP call, fail fast on bad names.
        if (objName && objName !== objName.toUpperCase()) {
          results.push({
            type: objType,
            name: objName,
            packageName: objPackage,
            status: 'failed',
            error: `Object name "${objName}" contains lowercase characters. SAP object names must be uppercase (e.g. "${objName.toUpperCase()}"). Source code inside the object can use mixed case.`,
          });
          break;
        }

        // MSAG transport-vs-task guard (per-batch cache to avoid per-object roundtrip).
        if (objType === 'MSAG' && objTransport) {
          let tr = transportLookupCache.get(objTransport);
          if (tr === undefined) {
            tr = await getTransport(client.http, client.safety, objTransport);
            transportLookupCache.set(objTransport, tr);
          }
          if (!tr) {
            results.push({
              type: objType,
              name: objName,
              packageName: objPackage,
              status: 'failed',
              error: `Transport "${objTransport}" is not a valid transport request. MSAG creation requires a transport request number, not a task number.`,
            });
            break;
          }
        }

        // AFF header validation per object (if schema available)
        const affResult = validateAffHeader(objType, { description: objDescription, originalLanguage: 'en' });
        if (!affResult.valid) {
          results.push({
            type: objType,
            name: objName,
            packageName: objPackage,
            status: 'failed',
            error: `AFF metadata validation failed:\n- ${(affResult.errors ?? []).join('\n- ')}`,
          });
          break;
        }

        try {
          // Pre-validate source with lint BEFORE creating the object to avoid orphaned objects.
          // Metadata objects (DOMA/DTEL) are XML-only and intentionally skip source lint.
          if (!metadataObject && objSource) {
            const preflightWarnings = runRapPreflightValidation(
              objSource,
              objType,
              objName,
              cachedFeatures,
              config.systemType,
              preflightOverride,
            );
            if (preflightWarnings.blocked) {
              results.push({
                type: objType,
                name: objName,
                packageName: objPackage,
                status: 'failed',
                error: preflightWarnings.result!.content[0].text,
              });
              break;
            }
            if (preflightWarnings.warnings) {
              batchWarnings.push(`${objType} ${objName}: ${preflightWarnings.warnings}`);
            }

            const lintWarnings = runPreWriteLint(objSource, objType, objName, config, lintOverride);
            if (lintWarnings.blocked) {
              results.push({
                type: objType,
                name: objName,
                packageName: objPackage,
                status: 'failed',
                error: `source rejected by lint: ${lintWarnings.result!.content[0].text}`,
              });
              break;
            }
          }

          // Step 1: Create the object
          const objUrl = objectUrlForType(objType, objName);
          const createUrl = objUrl.replace(/\/[^/]+$/, '');
          const objMetadataProps = getMetadataWriteProperties(obj);
          const body = buildCreateXml(objType, objName, objPackage, objDescription, objMetadataProps);
          const contentType = createContentTypeForType(objType);
          const needsPackageParam = objType === 'BDEF' || objType === 'TABL';
          try {
            await createObject(
              client.http,
              client.safety,
              createUrl,
              body,
              contentType,
              objTransport,
              needsPackageParam ? objPackage : undefined,
              cachedFeatures?.abapRelease,
            );
          } catch (createErr) {
            if (createErr instanceof AdtApiError && (createErr.statusCode === 400 || createErr.statusCode === 409)) {
              const syntaxDetail = await tryPostSaveSyntaxCheck(client, objType, objName);
              if (syntaxDetail) {
                createErr.message += syntaxDetail;
              }
            }
            throw createErr;
          }

          // Step 1b: DTEL POST ignores labels — follow up with PUT on main session
          if (objType === 'DTEL' && dtelNeedsPostCreateUpdate(objMetadataProps)) {
            await client.http.withStatefulSession(async (session) => {
              const lock = await lockObject(session, client.safety, objUrl, 'MODIFY', cachedFeatures?.abapRelease);
              const lockTransport = objTransport ?? (lock.corrNr || undefined);
              try {
                await updateObject(session, client.safety, objUrl, body, lock.lockHandle, contentType, lockTransport);
              } finally {
                await unlockObject(session, objUrl, lock.lockHandle);
              }
            });
          }

          // Step 2: Write source if provided
          if (!metadataObject && objSource) {
            const srcUrl = sourceUrlForType(objType, objName);
            await safeUpdateSource(
              client.http,
              client.safety,
              objUrl,
              srcUrl,
              objSource,
              objTransport,
              cachedFeatures?.abapRelease,
            );
          }

          // Resolve the activation URL up front so both the inline path and the
          // deferred terminal-activate path use the same URL. FUNC needs the parent
          // function-group baked into the path (issue #250); objectUrlForType throws
          // for FUNC so we mirror the FUNC-aware resolver from handleSAPActivate. For
          // TABL we keep objUrl (already resolved to /tables/) — DDIC-structure FMs
          // aren't a real concept and the create path doesn't expose one.
          let activationUrl = objUrl;
          if (objType === 'FUNC') {
            let group = String(obj.group ?? args.group ?? '').trim();
            if (!group) {
              const resolved = cachingLayer
                ? await cachingLayer.resolveFuncGroup(client, objName)
                : await client.resolveFunctionGroup(objName);
              if (!resolved) {
                throw new Error(
                  `Cannot resolve function group for FM "${objName}" in batch_create activation step. Provide "group" on the FUNC entry.`,
                );
              }
              group = resolved;
            }
            const groupLc = encodeURIComponent(group.toLowerCase());
            activationUrl = `/sap/bc/adt/functions/groups/${groupLc}/fmodules/${encodeURIComponent(objName.toLowerCase())}`;
          }

          if (activateAtEnd) {
            // Step 3 deferred: track this object for the terminal activateBatch call.
            // Cache invalidation also moves to AFTER the terminal activate succeeds —
            // invalidating now would let the next read see a draft we couldn't activate.
            writtenObjects.push({ type: objType, name: objName, url: activationUrl });
            results.push({ type: objType, name: objName, packageName: objPackage, status: 'success' });
          } else {
            // Step 3: Activate the object (inline, default behavior).
            const activationResult = await activate(client.http, client.safety, activationUrl);
            if (!activationResult.success) {
              results.push({
                type: objType,
                name: objName,
                packageName: objPackage,
                status: 'failed',
                error: `activation failed: ${activationResult.messages.join('; ')}`,
              });
              break;
            }

            invalidateWrittenObject(objType, objName);
            results.push({ type: objType, name: objName, packageName: objPackage, status: 'success' });
          }
        } catch (err) {
          results.push({
            type: objType,
            name: objName,
            packageName: objPackage,
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          });
          break;
        }
      }

      // Add 'skipped' entries for objects that were never attempted due to early break
      for (let i = results.length; i < objects.length; i++) {
        const skippedPlan = batchPlan[i];
        const skipped = skippedPlan?.obj ?? objects[i];
        results.push({
          type: skippedPlan?.type ?? normalizeObjectType(String(skipped?.type ?? '')),
          name: skippedPlan?.name ?? String(skipped?.name ?? ''),
          packageName: skippedPlan?.packageName ?? normalizePackageOverride(skipped?.package, defaultPackage),
          status: 'failed',
          error: 'skipped — stopped after previous failure',
        });
      }

      // ── Terminal activateBatch (activateAtEnd=true) ─────────────────────
      // After every write-phase succeeded (or broke off early), issue ONE batch
      // activate over the already-written subset. This is the killer feature
      // for composition-linked DDLS and RAP behavior stacks — SAP's activator
      // sees the whole graph in a single POST and resolves cross-references
      // internally, so parent → child siblings activate cleanly.
      let terminalActivationFailure: string | undefined;
      if (activateAtEnd && writtenObjects.length > 0) {
        const activationOutcome = await activateBatch(client.http, client.safety, writtenObjects);
        if (activationOutcome.success) {
          // Defensive: per-object status was already 'success' from the write phase.
          // Cache invalidation moves here so a failed terminal activate doesn't strand
          // a stale 'active' cache entry. Invalidate inactive-lists once for the user.
          for (const o of writtenObjects) {
            cachingLayer?.invalidate(o.type, o.name, 'all');
          }
          cachingLayer?.inactiveLists.invalidate(client.username);
        } else {
          // Flip every written-but-not-yet-activated entry to 'failed', preserving the
          // "create + source-write succeeded" context. Reuse the existing per-object
          // diagnostic mapper so callers see the activation messages keyed by object name.
          const batchStatuses = buildBatchActivationStatuses(writtenObjects, activationOutcome);
          const statusDetails = formatBatchActivationStatuses(batchStatuses);
          terminalActivationFailure = statusDetails;
          const statusByName = new Map(batchStatuses.map((s) => [`${s.type} ${s.name}`, s]));
          for (const result of results) {
            if (result.status !== 'success') continue;
            const key = `${result.type} ${result.name}`;
            const matched = statusByName.get(key);
            if (!matched) continue;
            // Some entries may still report status 'active' if the activator returned
            // success: false but had no per-object error details — keep them as 'success'.
            if (matched.status === 'active') continue;
            result.status = 'failed';
            const detail = matched.messages.length > 0 ? ` — ${matched.messages.join('; ')}` : '';
            // Preserve the "create + source-write succeeded" context so the user sees that
            // the failure was specifically the activation step, not the write step.
            result.error = `${writtenObjects.length}/${writtenObjects.length} written, batch activation failed${detail}`;
          }
        }
      }
      // ────────────────────────────────────────────────────────────────────

      const summary = results
        .map((r) =>
          r.status === 'success'
            ? `${r.name} (${r.type}) ✓ [${r.packageName}]`
            : `${r.name} (${r.type}) ✗ [${r.packageName}] — ${r.error}`,
        )
        .join(', ');
      const successCount = results.filter((r) => r.status === 'success').length;
      const hasFailure = results.some((r) => r.status === 'failed');
      const warningSuffix =
        batchWarnings.length > 0 ? `\n\nRAP preflight warnings:\n- ${batchWarnings.join('\n- ')}` : '';
      const activateAtEndSuffix =
        terminalActivationFailure !== undefined ? `\n\nBatch activation diagnostics:${terminalActivationFailure}` : '';
      const packageNames = [...new Set(batchPlan.map((item) => item.packageName))];
      const packageSummary =
        packageNames.length === 1
          ? `in package ${packageNames[0]}`
          : packageNames.length <= 3
            ? `across packages [${packageNames.join(', ')}]`
            : `across ${packageNames.length} packages`;
      const activateAtEndPrefix = activateAtEnd ? '; activated as a single batch' : '';

      if (hasFailure) {
        const cleanupHint =
          successCount > 0
            ? ` Note: ${successCount} already-created object(s) remain on the SAP system and may need manual cleanup.`
            : '';
        return errorResult(
          `Batch created ${successCount}/${objects.length} objects ${packageSummary}${activateAtEndPrefix}: ${summary}${cleanupHint}${warningSuffix}${activateAtEndSuffix}`,
        );
      }
      return textResult(
        `Batch created ${successCount} objects ${packageSummary}${activateAtEndPrefix}: ${summary}${warningSuffix}${activateAtEndSuffix}`,
      );
    }
    default:
      return errorResult(
        `Unknown SAPWrite action: ${action}. Supported: create, update, delete, edit_method, batch_create, scaffold_rap_handlers, generate_behavior_implementation`,
      );
  }
}

/** Pre-write lint check result */
interface PreWriteLintResult {
  /** Whether the write was blocked by lint errors */
  blocked: boolean;
  /** Error result to return if blocked */
  result?: ToolResult;
  /** Warning text to append to success message */
  warnings?: string;
}

/** Pre-write RAP preflight check result */
interface PreWriteRapPreflightResult {
  /** Whether the write was blocked by RAP preflight errors */
  blocked: boolean;
  /** Error result to return if blocked */
  result?: ToolResult;
  /** Warning text to append to success message */
  warnings?: string;
}

/**
 * Run deterministic RAP preflight checks for non-ABAP RAP artifact types.
 *
 * Unlike lint, this check is intentionally narrow and rule-based. It focuses on
 * known activation churn patterns (TABL curr/quan semantics, BDEF enum/header
 * misuse, DDLX scope/duplicate annotations) and can cover types that offline
 * abaplint does not parse well.
 */
function runRapPreflightValidation(
  source: string,
  type: string,
  name: string,
  features: ResolvedFeatures | undefined,
  configSystemType: ServerConfig['systemType'],
  perCallOverride?: boolean,
): PreWriteRapPreflightResult {
  const enabled = perCallOverride ?? true;
  if (!enabled || !source) {
    return { blocked: false };
  }

  const systemType = features?.systemType ?? (configSystemType !== 'auto' ? configSystemType : undefined);
  const result = validateRapSource(type, source, {
    systemType,
    abapRelease: features?.abapRelease,
  });

  if (result.errors.length > 0) {
    const details = formatRapPreflightFindings(result.errors);
    return {
      blocked: true,
      result: errorResult(
        `RAP preflight validation failed for ${type} ${name}. Fix these issues before writing:\n${details}\n\n` +
          'Set preflightBeforeWrite=false only when you intentionally need to bypass these checks.',
      ),
    };
  }

  if (result.warnings.length > 0) {
    return {
      blocked: false,
      warnings: `RAP preflight warnings:\n${formatRapPreflightFindings(result.warnings)}`,
    };
  }

  return { blocked: false };
}

function mergePreWriteWarnings(...warnings: Array<string | undefined>): string | undefined {
  const parts = warnings.filter((w): w is string => Boolean(w));
  if (parts.length === 0) return undefined;
  return parts.join('\n\n');
}

/**
 * Run pre-write lint validation on source code.
 *
 * This is a "lint-before-lock" optimization (pattern from vibing-steampunk):
 * by validating locally before acquiring the SAP object lock, we avoid
 * holding locks on objects that would fail validation anyway.
 *
 * Only runs a strict subset of correctness rules (parser_error, cloud_types, etc.)
 * — not style/formatting rules. This prevents false rejections from opinionated
 * style checks while catching genuine errors that would fail server-side anyway.
 *
 * If lint itself throws (e.g., abaplint bug on unusual syntax), we don't block
 * the write — we let the SAP server-side syntax check handle it instead.
 */
function runPreWriteLint(
  source: string,
  type: string,
  name: string,
  config: ServerConfig,
  perCallOverride?: boolean,
): PreWriteLintResult {
  // Per-call override takes precedence over server config
  const enabled = perCallOverride ?? config.lintBeforeWrite;
  if (!enabled || !source) {
    return { blocked: false };
  }

  // abaplint supports ABAP source (PROG/CLAS/INTF/INCL) and CDS views (DDLS) via
  // its CDS parser. DDLS lint catches syntax errors (cds_parser_error) like missing commas,
  // wrong keywords, and invalid DDL constructs. BDEF/SRVD/SRVB/DDLX are silently ignored
  // by abaplint (no parser for those types — garbage passes without errors). TABL (define
  // table syntax) is not supported by the CDS parser and produces false cds_parser_error.
  // For unsupported types, SAP server-side compilation handles validation.
  //
  // FUNC is intentionally excluded: abaplint's FM-source parser does not understand
  // source-based signatures (`FUNCTION X\n  IMPORTING …\n.`) and emits a structural
  // parser_error that blocks the write. Issue #252 made this visible — once we
  // started emitting real signatures from structured `parameters`, every FUNC PUT
  // hit the lint gate. Pre-#252 lint coverage was effectively trivial (only
  // signature-less FUNCTION/ENDFUNCTION stubs passed). Validation falls back to
  // SAP's server-side syntax check (opt-in via `SAP_CHECK_BEFORE_WRITE`) and the
  // activate step.
  const LINTABLE_TYPES = new Set(['PROG', 'CLAS', 'INTF', 'INCL', 'DDLS']);
  if (!LINTABLE_TYPES.has(type)) {
    return { blocked: false };
  }

  try {
    const filename = detectFilename(source, name);
    const systemType = cachedFeatures?.systemType ?? (config.systemType !== 'auto' ? config.systemType : undefined);
    const configOptions: LintConfigOptions = {
      systemType,
      abapRelease: cachedFeatures?.abapRelease ?? config.abapRelease,
      configFile: config.abaplintConfig,
    };
    const result = validateBeforeWrite(source, filename, configOptions);

    if (!result.pass) {
      const errorLines = result.errors.map((e) => `  Line ${e.line}: [${e.rule}] ${e.message}`).join('\n');
      return {
        blocked: true,
        result: errorResult(
          `Pre-write lint check failed for ${type} ${name}. Fix these errors before writing:\n${errorLines}\n\n` +
            'Use SAPLint action="lint_and_fix" to auto-fix, or disable with --lint-before-write=false.',
        ),
      };
    }

    if (result.warnings.length > 0) {
      const warningLines = result.warnings.map((w) => `  Line ${w.line}: [${w.rule}] ${w.message}`).join('\n');
      return {
        blocked: false,
        warnings: `Lint warnings:\n${warningLines}`,
      };
    }

    return { blocked: false };
  } catch {
    // If lint itself fails, don't block the write
    return { blocked: false };
  }
}

/** Types that carry source code that SAP's /checkruns endpoint can meaningfully compile.
 *  Metadata-write types (DOMA/DTEL/TABL/MSAG/DEVC/SKTD) have no /source/main artifact. */
const SYNTAX_CHECKABLE_TYPES = new Set([
  'PROG',
  'CLAS',
  'INTF',
  'FUNC',
  'FUGR',
  'INCL',
  'DDLS',
  'DCLS',
  'DDLX',
  'BDEF',
  'SRVD',
]);

/** Pre-write SAP server-side syntax check via /checkruns with inline <chkrun:content>.
 *  Sends the proposed source to SAP's compiler without writing. Surfaces errors AND
 *  warnings as informational text appended to the write's success message — never
 *  blocks the write. Rationale: multi-file edits have inter-object dependencies, so
 *  intermediate writes legitimately trip compile errors that resolve once the whole
 *  sequence lands. Real blocking is deferred to SAPActivate, which runs after all
 *  dependencies are in place. Best-effort: network/endpoint failures return ''. */
async function runPreWriteSyntaxCheck(
  client: AdtClient,
  type: string,
  source: string,
  objectUrl: string,
  config: ServerConfig,
  perCallOverride?: boolean,
): Promise<string> {
  const enabled = perCallOverride ?? config.checkBeforeWrite;
  if (!enabled || !source) return '';
  if (!SYNTAX_CHECKABLE_TYPES.has(type.toUpperCase())) return '';

  try {
    const result = await syntaxCheck(client.http, client.safety, objectUrl, { content: source, version: 'active' });
    if (result.messages.length === 0) return '';

    const errors = result.messages.filter((m) => m.severity === 'error');
    const warnings = result.messages.filter((m) => m.severity === 'warning');
    const parts: string[] = [];

    if (errors.length > 0) {
      const lines = errors.map((m) => `  Line ${m.line || '?'}${m.column ? `:${m.column}` : ''}: ${m.text}`).join('\n');
      parts.push(
        `Server syntax check errors (source was still written — activate to confirm whether these resolve once dependencies are in place):\n${lines}`,
      );
    }
    if (warnings.length > 0) {
      const lines = warnings.map((m) => `  Line ${m.line || '?'}: ${m.text}`).join('\n');
      parts.push(`Server syntax check warnings:\n${lines}`);
    }
    return parts.join('\n\n');
  } catch {
    // Best-effort: never let a failing pre-check fail the write.
    return '';
  }
}

// ─── SAPActivate Handler ─────────────────────────────────────────────

async function handleSAPActivate(
  client: AdtClient,
  args: Record<string, unknown>,
  cachingLayer?: CachingLayer,
): Promise<ToolResult> {
  const action = String(args.action ?? 'activate');
  const name = String(args.name ?? '');
  const version = String(args.version ?? '0001');
  const explicitServiceType = args.service_type as string | undefined;

  // Resolve the OData service type for publish/unpublish endpoints.
  // Explicit service_type parameter takes precedence; otherwise auto-detect from SRVB metadata.
  async function resolveServiceType(): Promise<'odatav2' | 'odatav4'> {
    if (explicitServiceType === 'odatav4' || explicitServiceType === 'odatav2') return explicitServiceType;
    try {
      const { source: srvbJson } = await client.getSrvb(name);
      const srvb = JSON.parse(srvbJson);
      if (srvb.odataVersion === 'V4') return 'odatav4';
    } catch {
      // If readback fails, fall back to odatav2 (legacy default)
    }
    return 'odatav2';
  }

  // Publish service binding
  if (action === 'publish_srvb') {
    if (!name) {
      return errorResult('Missing required "name" parameter for publish_srvb action.');
    }
    const serviceType = await resolveServiceType();
    const result = await publishServiceBinding(client.http, client.safety, name, version, serviceType);
    if (result.severity === 'ERROR') {
      return errorResult(
        `Failed to publish service binding ${name}: ${result.shortText}${result.longText ? ` — ${result.longText}` : ''}`,
      );
    }
    let srvbInfo: string;
    try {
      srvbInfo = (await client.getSrvb(name)).source;
    } catch {
      if (result.severity === 'UNKNOWN') {
        return errorResult(
          `Publish response for ${name} could not be parsed and readback failed — use SAPRead to verify publish status.`,
        );
      }
      return textResult(
        `Successfully published service binding ${name} (readback of binding metadata failed — use SAPRead to verify)`,
      );
    }
    // Verify the published flag from the SRVB readback
    try {
      const srvbData = JSON.parse(srvbInfo);
      if (srvbData.published === false) {
        return errorResult(
          `Publish of service binding ${name} may have failed — binding is still unpublished.\n\n${srvbInfo}`,
        );
      }
    } catch {
      // If we can't parse the readback JSON, fall through — better to return what we have
    }
    if (result.severity === 'UNKNOWN') {
      return textResult(
        `Publish request for ${name} completed but response could not be fully parsed. Verify status below:\n\n${srvbInfo}`,
      );
    }
    return textResult(`Successfully published service binding ${name}.\n\n${srvbInfo}`);
  }

  // Unpublish service binding
  if (action === 'unpublish_srvb') {
    if (!name) {
      return errorResult('Missing required "name" parameter for unpublish_srvb action.');
    }
    const serviceType = await resolveServiceType();
    const result = await unpublishServiceBinding(client.http, client.safety, name, version, serviceType);
    if (result.severity === 'ERROR') {
      return errorResult(
        `Failed to unpublish service binding ${name}: ${result.shortText}${result.longText ? ` — ${result.longText}` : ''}`,
      );
    }
    let srvbInfo: string | undefined;
    try {
      srvbInfo = (await client.getSrvb(name)).source;
    } catch {
      // Readback failed — fall through with what we have
    }
    // Verify the published flag from the SRVB readback
    if (srvbInfo) {
      try {
        const srvbData = JSON.parse(srvbInfo);
        if (srvbData.published === true) {
          return errorResult(
            `Unpublish of service binding ${name} may have failed — binding is still published.\n\n${srvbInfo}`,
          );
        }
      } catch {
        // If we can't parse the readback JSON, fall through
      }
    }
    if (result.severity === 'UNKNOWN') {
      return textResult(
        `Unpublish request for ${name} completed but response could not be fully parsed.${srvbInfo ? ` Verify status below:\n\n${srvbInfo}` : ' Use SAPRead to verify status.'}`,
      );
    }
    return textResult(`Successfully unpublished service binding ${name}.${srvbInfo ? `\n\n${srvbInfo}` : ''}`);
  }

  // Batch activation: multiple objects at once (for RAP stacks etc.)
  const type = normalizeObjectType(String(args.type ?? ''));
  const preaudit = args.preaudit !== undefined ? Boolean(args.preaudit) : undefined;
  const activateOpts = preaudit !== undefined ? { preaudit } : undefined;

  if (args.objects && Array.isArray(args.objects)) {
    const rawObjects = args.objects as Array<Record<string, unknown>>;
    // Resolve URLs sequentially. For TABL we await the URL resolver so DDIC
    // structures (which live at /sap/bc/adt/ddic/structures/) are addressed
    // correctly; the resolver short-circuits on its in-memory cache.
    // For FUNC the URL needs the parent function-group baked into the path
    // (issue #250); each batch entry must carry `group` or be auto-resolvable
    // by name.
    const objects = await Promise.all(
      rawObjects.map(async (o) => {
        const objType = normalizeObjectType(String(o.type ?? type));
        const objName = String(o.name ?? '');
        let url: string;
        if (objType === 'TABL') {
          url = await client.resolveTablObjectUrl(objName);
        } else if (objType === 'FUNC') {
          let group = String(o.group ?? args.group ?? '').trim();
          if (!group) {
            const resolved = cachingLayer
              ? await cachingLayer.resolveFuncGroup(client, objName)
              : await client.resolveFunctionGroup(objName);
            if (!resolved) {
              throw new Error(
                `Cannot resolve function group for FM "${objName}" in batch activate. Provide "group" on each FUNC entry.`,
              );
            }
            group = resolved;
          }
          const groupLc = encodeURIComponent(group.toLowerCase());
          url = `/sap/bc/adt/functions/groups/${groupLc}/fmodules/${encodeURIComponent(objName.toLowerCase())}`;
        } else {
          url = objectUrlForType(objType, objName);
        }
        return { type: objType, name: objName, url };
      }),
    );

    const result = await activateBatch(client.http, client.safety, objects, activateOpts);
    const names = objects.map((o) => o.name).join(', ');
    const batchStatuses = buildBatchActivationStatuses(objects, result);
    const statusDetails = formatBatchActivationStatuses(batchStatuses);

    if (result.success) {
      for (const object of objects) {
        cachingLayer?.invalidate(object.type, object.name, 'all');
      }
      cachingLayer?.inactiveLists.invalidate(client.username);
      return textResult(`Successfully activated ${objects.length} objects: ${names}.${statusDetails}`);
    }
    // On batch failure enrich with per-object inactive-version syntax errors —
    // only for objects whose activation returned no error details, to avoid duplicating messages.
    const objectsNeedingSyntaxCheck = objects.filter((_o, i) => batchStatuses[i].status !== 'error');
    const diagnostics = await Promise.all(
      objectsNeedingSyntaxCheck.map((o) => inactiveSyntaxDiagnostic(client, o.type, o.name)),
    );
    const combinedDiag = diagnostics
      .map((d, i) => (d ? `\n[${objectsNeedingSyntaxCheck[i].name}]${d}` : ''))
      .filter(Boolean)
      .join('');
    return errorResult(
      `Batch activation failed for: ${names}.${statusDetails}\n${formatActivationMessages(result)}${combinedDiag}`,
    );
  }

  // Single activation (existing behavior). For TABL we resolve the URL because
  // the existing object may live at /tables/ (transparent) or /structures/
  // (DDIC structure); using the wrong one would produce a confusing 404.
  // For FUNC the URL needs the parent function group baked into the path
  // (issue #250) — `objectBasePath('FUNC')` deliberately throws so generic
  // builders fail loudly. Auto-resolve the group when omitted.
  let objectUrl: string;
  if (type === 'TABL') {
    objectUrl = await client.resolveTablObjectUrl(name);
  } else if (type === 'FUNC') {
    let group = String(args.group ?? '').trim();
    if (!group) {
      const resolved = cachingLayer
        ? await cachingLayer.resolveFuncGroup(client, name)
        : await client.resolveFunctionGroup(name);
      if (!resolved) {
        return errorResult(`Cannot resolve function group for FM "${name}". Provide the "group" parameter explicitly.`);
      }
      group = resolved;
    }
    const groupLc = encodeURIComponent(group.toLowerCase());
    objectUrl = `/sap/bc/adt/functions/groups/${groupLc}/fmodules/${encodeURIComponent(name.toLowerCase())}`;
  } else {
    objectUrl = objectUrlForType(type, name);
  }

  const result = await activate(client.http, client.safety, objectUrl, { ...activateOpts, name });

  if (result.success) {
    cachingLayer?.invalidate(type, name, 'all');
    cachingLayer?.inactiveLists.invalidate(client.username);
    return textResult(`Successfully activated ${type} ${name}.${formatActivationMessages(result)}`);
  }
  // On failure, try to enrich with the actual compiler errors from the inactive version —
  // especially useful when SAP returned <ioc:inactiveObjects> with no <msg> detail.
  // Skip when activation already returned error details to avoid duplicating the same messages.
  const hasActivationErrors = result.details.some((d) => d.severity === 'error');
  const syntaxDetail = hasActivationErrors ? '' : await inactiveSyntaxDiagnostic(client, type, name);
  let activationError = `Activation failed for ${type} ${name}.\n${formatActivationMessages(result)}${syntaxDetail}`;
  if (type === 'DDLS') {
    activationError += `\n\n${await buildCdsActivationDependencyHint(client, name, objectUrl)}`;
  }
  return errorResult(activationError);
}

/** Format activation result messages with structured detail (line numbers, URIs) when available */
function formatActivationMessages(result: ActivationResult): string {
  if (result.details.length === 0) return '';

  const errors = result.details.filter((d) => d.severity === 'error');
  const warnings = result.details.filter((d) => d.severity === 'warning');

  const parts: string[] = [];

  if (errors.length > 0) {
    const formatted = errors.map((e) => {
      const prefix = e.line ? `[line ${e.line}] ` : '';
      const suffix = e.uri ? ` (${e.uri})` : '';
      return `- ${prefix}${e.text}${suffix}`;
    });
    parts.push(`Errors:\n${formatted.join('\n')}`);
  }

  if (warnings.length > 0) {
    const formatted = warnings.map((w) => {
      const prefix = w.line ? `[line ${w.line}] ` : '';
      return `- ${prefix}${w.text}`;
    });
    parts.push(`Warnings:\n${formatted.join('\n')}`);
  }

  // Fall back to flat messages if no errors/warnings but info messages exist
  if (parts.length === 0 && result.messages.length > 0) {
    return `\nMessages: ${result.messages.join('; ')}`;
  }

  return parts.length > 0 ? `\n${parts.join('\n')}` : '';
}

interface BatchActivationObject {
  type: string;
  name: string;
  url: string;
}

interface BatchActivationObjectStatus {
  type: string;
  name: string;
  status: 'active' | 'warning' | 'error';
  messages: string[];
}

function normalizeActivationUri(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  return uri.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
}

function buildBatchActivationStatuses(
  objects: BatchActivationObject[],
  result: ActivationResult,
): BatchActivationObjectStatus[] {
  // Group error details by object. SAP error URIs may be subpaths of the object URL
  // (e.g. .../classes/zcl_demo/source/main for object .../classes/ZCL_DEMO) and may
  // differ in case, so we lowercase and use startsWith for matching.
  const objectKeys = objects.map((obj) => normalizeActivationUri(obj.url) ?? '');
  const perObject: Array<Array<{ severity: 'error' | 'warning' | 'info'; text: string }>> = objects.map(() => []);
  const unassigned: string[] = [];

  for (const detail of result.details) {
    const detailUri = normalizeActivationUri(detail.uri);
    const prefix = detail.line ? `[line ${detail.line}] ` : '';
    const suffix = detail.uri ? ` (${detail.uri})` : '';
    if (!detailUri) {
      unassigned.push(`${prefix}${detail.text}${suffix}`);
      continue;
    }
    const matchIdx = objectKeys.findIndex((k) => k && detailUri.startsWith(k));
    if (matchIdx >= 0) {
      perObject[matchIdx].push({ severity: detail.severity, text: `${prefix}${detail.text}${suffix}` });
    } else {
      unassigned.push(`${prefix}${detail.text}${suffix}`);
    }
  }

  return objects.map((obj, index) => {
    const details = perObject[index];
    const hasError = details.some((detail) => detail.severity === 'error');
    const hasWarning = details.some((detail) => detail.severity === 'warning');
    const status: BatchActivationObjectStatus['status'] = hasError ? 'error' : hasWarning ? 'warning' : 'active';
    const messages = details.map((detail) => detail.text);
    if (index === 0 && unassigned.length > 0) {
      messages.push(...unassigned);
    }
    return {
      type: obj.type,
      name: obj.name,
      status,
      messages,
    };
  });
}

function formatBatchActivationStatuses(statuses: BatchActivationObjectStatus[]): string {
  if (statuses.length === 0) return '';
  const lines: string[] = [];
  for (const status of statuses) {
    if (status.messages.length === 0) {
      lines.push(`- ${status.name} (${status.type}): ${status.status}`);
    } else {
      for (const msg of status.messages) {
        lines.push(`- ${status.name} (${status.type}) ${msg}`);
      }
    }
  }
  return `\n${lines.join('\n')}`;
}

// ─── SAPNavigate Handler ─────────────────────────────────────────────

async function handleSAPNavigate(client: AdtClient, args: Record<string, unknown>): Promise<ToolResult> {
  const action = String(args.action ?? '');
  let uri = String(args.uri ?? '');
  const line = Number(args.line ?? 1);
  const column = Number(args.column ?? 1);
  const source = String(args.source ?? '');

  // Allow symbolic type+name as alternative to uri for references
  if (!uri && args.type && args.name) {
    const symType = normalizeObjectType(String(args.type));
    const symName = String(args.name);
    if (symType === 'FUNC') {
      // FUNC needs group to build URL — auto-resolve it
      const group = await client.resolveFunctionGroup(symName);
      if (group) {
        uri = `/sap/bc/adt/functions/groups/${encodeURIComponent(group)}/fmodules/${encodeURIComponent(symName)}`;
      } else {
        return errorResult(
          `Cannot resolve function group for "${symName}". Provide the full uri parameter, or use SAPSearch("${symName}") to find the ADT URI.`,
        );
      }
    } else if (symType === 'TABL') {
      // DDIC TABL: where-used and other navigate paths must use the canonical
      // object URL — `/sap/bc/adt/ddic/tables/{name}` for transparent tables,
      // `/sap/bc/adt/ddic/structures/{name}` for DDIC structures. NW 7.50
      // returns 500 from usageReferences for /tables/ URLs even for transparent
      // tables, so we always resolve before building. resolveTablObjectUrl
      // caches on the AdtClient, so this is one HTTP probe per cold name.
      uri = await client.resolveTablObjectUrl(symName);
    } else {
      uri = objectUrlForType(symType, symName);
    }
  }

  switch (action) {
    case 'definition': {
      if (!uri) {
        return errorResult('Provide uri (or type+name) and line+column for definition lookup.');
      }
      const result = await findDefinition(client.http, client.safety, uri, line, column, source);
      if (!result) {
        return textResult('No definition found at this position.');
      }
      return textResult(JSON.stringify(result, null, 2));
    }
    case 'references': {
      if (!uri) {
        return errorResult('Provide uri or type+name to find references.');
      }
      // objectType is passed to SAP's where-used scope API which expects slash format (CLAS/OC, PROG/P).
      // Do NOT normalize it — the slash suffix is semantically meaningful for the SAP filter.
      const objectType = args.objectType ? String(args.objectType) : undefined;
      let results: WhereUsedResult[] | ReferenceResult[];
      try {
        results = await findWhereUsed(client.http, client.safety, uri, objectType);
      } catch (err) {
        // Only fall back for HTTP errors indicating the endpoint is not available (older SAP systems)
        if (err instanceof AdtApiError && [404, 405, 415, 501].includes(err.statusCode)) {
          results = await findReferences(client.http, client.safety, uri);
          if (results.length === 0) {
            return textResult('No references found.');
          }
          const json = JSON.stringify(results, null, 2);
          if (objectType) {
            return textResult(
              JSON.stringify(
                {
                  note: `This SAP system does not support scope-based Where-Used. The objectType filter "${objectType}" was ignored — results below are unfiltered.`,
                  results,
                },
                null,
                2,
              ),
            );
          }
          return textResult(json);
        } else {
          throw err;
        }
      }

      // Augment interface where-used with implementing classes from SEOMETAREL.
      // SAP's scope-based usageReferences endpoint sometimes does NOT surface
      // interface→implementing-class links — the implementations sit inside a
      // `canHaveChildren="true"` Interface Section node, and the snippet
      // expansion endpoint returns 404 on every release we've probed (NW 7.50,
      // S/4HANA 2023). SEOMETAREL is the canonical OO-relation table and is
      // always populated, so this augmentation makes references reliable for
      // interfaces. Silently skipped when SQL/data access isn't available.
      const intfMatch = uri.match(/\/sap\/bc\/adt\/oo\/interfaces\/([^/?]+)/i);
      if (intfMatch && (!objectType || /^CLAS/i.test(objectType))) {
        const interfaceName = decodeURIComponent(intfMatch[1]).toUpperCase();
        const canFreeSQL = isOperationAllowed(client.safety, OperationType.FreeSQL);
        const canQuery = isOperationAllowed(client.safety, OperationType.Query);
        try {
          let implementers: WhereUsedResult[] = [];
          if (canFreeSQL) {
            implementers = await findInterfaceImplementersViaSeoMetaRel(
              (sql, max) => client.runQuery(sql, max),
              interfaceName,
            );
          } else if (canQuery) {
            implementers = await findInterfaceImplementersViaSeoMetaRel(
              (_sql, max) =>
                client.getTableContents('SEOMETAREL', max, `REFCLSNAME = '${interfaceName}' AND RELTYPE = '1'`),
              interfaceName,
            );
          }
          // Dedupe: don't add an implementer if SAP already returned it
          const existingNames = new Set(
            (results as WhereUsedResult[]).map((r) => r.name?.toUpperCase()).filter(Boolean),
          );
          const augmented = implementers.filter((r) => !existingNames.has(r.name.toUpperCase()));
          if (augmented.length > 0) {
            (results as WhereUsedResult[]).push(...augmented);
          }
        } catch {
          // SEOMETAREL augmentation is best-effort; if SQL fails, fall back to
          // whatever the where-used HTTP endpoint returned. Don't block the response.
        }
      }

      if (results.length === 0) {
        return textResult('No references found.');
      }
      return textResult(JSON.stringify(results, null, 2));
    }
    case 'completion': {
      const proposals = await getCompletion(client.http, client.safety, uri, line, column, source);
      return textResult(JSON.stringify(proposals, null, 2));
    }
    case 'hierarchy': {
      const className = String(args.name ?? '').toUpperCase();
      if (!className) {
        return errorResult('Provide name (class name) for hierarchy lookup.');
      }
      // Sanitize to prevent SQL injection — class names are alphanumeric + underscore + namespace slash
      const safeName = className.replace(/[^A-Z0-9_/]/g, '');
      if (safeName !== className) {
        return errorResult(
          `Invalid class name: "${className}". Only alphanumeric characters, underscores, and slashes are allowed.`,
        );
      }

      const canFreeSQL = isOperationAllowed(client.safety, OperationType.FreeSQL);
      const canQuery = isOperationAllowed(client.safety, OperationType.Query);

      if (!canFreeSQL && !canQuery) {
        return errorResult(
          'Class hierarchy requires data access permissions. ' +
            'Enable free SQL (SAP_ALLOW_FREE_SQL=true / --allow-free-sql=true) or table preview ' +
            '(SAP_ALLOW_DATA_PREVIEW=true / --allow-data-preview=true), and grant the matching sql/data scope in HTTP auth mode.',
        );
      }

      try {
        let ownRels: { columns: string[]; rows: Record<string, string>[] };
        let subRels: { columns: string[]; rows: Record<string, string>[] };

        if (canFreeSQL) {
          ownRels = await client.runQuery(
            `SELECT CLSNAME, REFCLSNAME, RELTYPE FROM SEOMETAREL WHERE CLSNAME = '${safeName}'`,
            100,
          );
          subRels = await client.runQuery(
            `SELECT CLSNAME FROM SEOMETAREL WHERE REFCLSNAME = '${safeName}' AND RELTYPE = '2'`,
            100,
          );
        } else {
          // Fall back to named table preview (Query op type)
          ownRels = await client.getTableContents('SEOMETAREL', 100, `CLSNAME = '${safeName}'`);
          subRels = await client.getTableContents('SEOMETAREL', 100, `REFCLSNAME = '${safeName}' AND RELTYPE = '2'`);
        }

        let superclass: string | null = null;
        const interfaces: string[] = [];
        for (let i = 0; i < ownRels.rows.length; i++) {
          const row = ownRels.rows[i]!;
          const reltype = String(row.RELTYPE ?? '').trim();
          const refName = String(row.REFCLSNAME ?? '').trim();
          if (reltype === '2') {
            superclass = refName;
          } else if (reltype === '1') {
            interfaces.push(refName);
          }
        }

        const subclasses: string[] = [];
        for (let i = 0; i < subRels.rows.length; i++) {
          subclasses.push(String(subRels.rows[i]!.CLSNAME ?? '').trim());
        }

        const result: ClassHierarchy = { className: safeName, superclass, interfaces, subclasses };
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        if (err instanceof AdtApiError && err.statusCode === 404) {
          return errorResult('Cannot query SEOMETAREL — table may not be accessible on this system.');
        }
        throw err;
      }
    }
    default:
      return errorResult(
        `Unknown SAPNavigate action: ${action}. Supported: definition, references, completion, hierarchy`,
      );
  }
}

// ─── SAPDiagnose Handler ─────────────────────────────────────────────

async function handleSAPDiagnose(client: AdtClient, args: Record<string, unknown>): Promise<ToolResult> {
  const action = String(args.action ?? '');
  const name = String(args.name ?? '');
  const type = normalizeObjectType(String(args.type ?? ''));

  switch (action) {
    case 'syntax': {
      const objectUrl = objectUrlForType(type, name);
      const version = args.version === 'inactive' ? 'inactive' : args.version === 'active' ? 'active' : undefined;
      const content = typeof args.source === 'string' ? (args.source as string) : undefined;
      const opts: { version?: 'active' | 'inactive'; content?: string } = {};
      if (version) opts.version = version;
      if (content !== undefined) opts.content = content;
      const result = await syntaxCheck(
        client.http,
        client.safety,
        objectUrl,
        Object.keys(opts).length > 0 ? opts : undefined,
      );
      return textResult(JSON.stringify(result, null, 2));
    }
    case 'unittest': {
      const objectUrl = objectUrlForType(type, name);
      const results = await runUnitTests(client.http, client.safety, objectUrl);
      return textResult(JSON.stringify(results, null, 2));
    }
    case 'atc': {
      const objectUrl = objectUrlForType(type, name);
      const variant = args.variant as string | undefined;
      const result = await runAtcCheck(client.http, client.safety, objectUrl, variant);
      return textResult(JSON.stringify(result, null, 2));
    }
    case 'object_state': {
      if (!name || !type) return errorResult('"name" and "type" are required for "object_state" action.');
      const sections =
        type === 'CLAS'
          ? [
              { section: 'main', uri: sourceUrlForType(type, name) },
              { section: 'definitions', uri: classIncludeUrl(name, 'definitions'), optional: true },
              { section: 'implementations', uri: classIncludeUrl(name, 'implementations'), optional: true },
              { section: 'macros', uri: classIncludeUrl(name, 'macros'), optional: true },
              { section: 'testclasses', uri: classIncludeUrl(name, 'testclasses'), optional: true },
            ]
          : [{ section: 'main', uri: sourceUrlForType(type, name) }];

      const result = await getObjectState(client.http, client.safety, { type, name, sections });
      return textResult(JSON.stringify(result, null, 2));
    }
    case 'quickfix': {
      const source = args.source as string | undefined;
      const sourceUri = args.sourceUri as string | undefined;
      if (!name || !type) return errorResult('"name" and "type" are required for "quickfix" action.');
      if (!source) return errorResult('"source" is required for "quickfix" action.');
      if (args.line == null) return errorResult('"line" is required for "quickfix" action.');

      const line = Number(args.line);
      const column = Number(args.column ?? 0);
      if (!Number.isFinite(line)) return errorResult('"line" must be a number for "quickfix" action.');
      if (!Number.isFinite(column)) return errorResult('"column" must be a number for "quickfix" action.');

      const proposals = await getFixProposals(
        client.http,
        client.safety,
        sourceUri ?? sourceUrlForType(type, name),
        source,
        line,
        column,
      );
      return textResult(JSON.stringify(proposals, null, 2));
    }
    case 'apply_quickfix': {
      const source = args.source as string | undefined;
      const sourceUri = args.sourceUri as string | undefined;
      const proposalUri = args.proposalUri as string | undefined;
      const proposalUserContent = args.proposalUserContent as string | undefined;
      const proposalAffectedObjects = args.proposalAffectedObjects as FixAffectedObject[] | undefined;
      if (!name || !type) return errorResult('"name" and "type" are required for "apply_quickfix" action.');
      if (!source) return errorResult('"source" is required for "apply_quickfix" action.');
      if (args.line == null) return errorResult('"line" is required for "apply_quickfix" action.');
      if (!proposalUri) return errorResult('"proposalUri" is required for "apply_quickfix" action.');
      if (proposalUserContent === undefined)
        return errorResult('"proposalUserContent" is required for "apply_quickfix" action.');

      const line = Number(args.line);
      const column = Number(args.column ?? 0);
      if (!Number.isFinite(line)) return errorResult('"line" must be a number for "apply_quickfix" action.');
      if (!Number.isFinite(column)) return errorResult('"column" must be a number for "apply_quickfix" action.');

      const deltas = await applyFixProposal(
        client.http,
        client.safety,
        {
          uri: proposalUri,
          type: 'quickfix/proposal',
          name: '',
          description: '',
          userContent: proposalUserContent,
          ...(proposalAffectedObjects ? { affectedObjects: proposalAffectedObjects } : {}),
        },
        sourceUri ?? sourceUrlForType(type, name),
        source,
        line,
        column,
      );
      return textResult(JSON.stringify(deltas, null, 2));
    }
    case 'dumps': {
      const id = args.id as string | undefined;
      if (id) {
        const detail = await getDump(client.http, client.safety, id);
        const includeFullText = args.includeFullText === true || String(args.includeFullText ?? '') === 'true';
        const selectedSections = selectDumpSections(detail, args.sections);

        const payload: Record<string, unknown> = {
          id: detail.id,
          error: detail.error,
          exception: detail.exception,
          program: detail.program,
          user: detail.user,
          timestamp: detail.timestamp,
          chapters: detail.chapters,
          terminationUri: detail.terminationUri,
          sections: selectedSections,
          selectedSectionIds: Object.keys(selectedSections),
          availableSections: detail.chapters.map((chapter) => ({
            id: chapter.name,
            title: chapter.title,
            line: chapter.line,
          })),
        };
        if (includeFullText) {
          payload.formattedText = detail.formattedText;
        }
        return textResult(JSON.stringify(payload, null, 2));
      }

      const user = args.user as string | undefined;
      const maxResults = args.maxResults ? Number(args.maxResults) : undefined;
      const dumps = await listDumps(client.http, client.safety, { user, maxResults });
      return textResult(JSON.stringify(dumps, null, 2));
    }
    case 'traces': {
      const id = args.id as string | undefined;
      if (id) {
        // Get trace analysis
        const analysis = String(args.analysis ?? 'hitlist');
        switch (analysis) {
          case 'hitlist': {
            const hitlist = await getTraceHitlist(client.http, client.safety, id);
            return textResult(JSON.stringify(hitlist, null, 2));
          }
          case 'statements': {
            const statements = await getTraceStatements(client.http, client.safety, id);
            return textResult(JSON.stringify(statements, null, 2));
          }
          case 'dbAccesses': {
            const dbAccesses = await getTraceDbAccesses(client.http, client.safety, id);
            return textResult(JSON.stringify(dbAccesses, null, 2));
          }
          default:
            return errorResult(`Unknown trace analysis type: ${analysis}. Supported: hitlist, statements, dbAccesses`);
        }
      }
      // List traces
      const traces = await listTraces(client.http, client.safety);
      return textResult(JSON.stringify(traces, null, 2));
    }
    case 'system_messages': {
      const user = args.user as string | undefined;
      const maxResults = args.maxResults ? Number(args.maxResults) : undefined;
      const from = args.from as string | undefined;
      const to = args.to as string | undefined;
      const messages = await listSystemMessages(client.http, client.safety, { user, maxResults, from, to });
      return textResult(JSON.stringify(messages, null, 2));
    }
    case 'gateway_errors': {
      if (isBtpSystem()) {
        return errorResult(
          'SAP Gateway error log is not available on BTP ABAP Environment. Use this action on on-prem systems.',
        );
      }

      const user = args.user as string | undefined;
      const maxResults = args.maxResults ? Number(args.maxResults) : undefined;
      const from = args.from as string | undefined;
      const to = args.to as string | undefined;
      const detailUrl = args.detailUrl as string | undefined;
      const id = args.id as string | undefined;
      const errorType = args.errorType as string | undefined;

      if (detailUrl || id) {
        const detail = await getGatewayErrorDetail(client.http, client.safety, { detailUrl, id, errorType });
        return textResult(JSON.stringify(detail, null, 2));
      }

      const errors = await listGatewayErrors(client.http, client.safety, { user, maxResults, from, to });
      return textResult(JSON.stringify(errors, null, 2));
    }
    default:
      return errorResult(
        `Unknown SAPDiagnose action: ${action}. Supported: syntax, unittest, atc, object_state, quickfix, apply_quickfix, dumps, traces, system_messages, gateway_errors`,
      );
  }
}

function selectDumpSections(detail: DumpDetail, requestedSections: unknown): Record<string, string> {
  const availableSections = detail.sections ?? {};
  const availableIds = Object.keys(availableSections);
  if (availableIds.length === 0) return {};

  const requestedIds = resolveRequestedDumpSectionIds(detail, requestedSections);
  const selectedIds = requestedIds.length > 0 ? requestedIds : pickDefaultDumpSectionIds(detail);
  const finalIds = selectedIds.length > 0 ? selectedIds : availableIds.slice(0, 5);

  return Object.fromEntries(finalIds.map((id) => [id, availableSections[id] ?? '']));
}

function resolveRequestedDumpSectionIds(detail: DumpDetail, requestedSections: unknown): string[] {
  if (!Array.isArray(requestedSections)) return [];
  const availableIds = new Set(Object.keys(detail.sections ?? {}));
  const resolved = requestedSections
    .map((entry) => resolveDumpSectionId(detail, String(entry ?? '')))
    .filter((entry): entry is string => typeof entry === 'string' && availableIds.has(entry));
  return Array.from(new Set(resolved));
}

function resolveDumpSectionId(detail: DumpDetail, candidate: string): string | undefined {
  const normalizedCandidate = normalizeDumpSectionKey(candidate);
  if (!normalizedCandidate) return undefined;

  const direct = detail.chapters.find((chapter) => normalizeDumpSectionKey(chapter.name) === normalizedCandidate)?.name;
  if (direct) return direct;

  const exactTitle = detail.chapters.find(
    (chapter) => normalizeDumpSectionKey(chapter.title) === normalizedCandidate,
  )?.name;
  if (exactTitle) return exactTitle;

  const fuzzyTitle = detail.chapters.find((chapter) =>
    normalizeDumpSectionKey(chapter.title).includes(normalizedCandidate),
  )?.name;
  return fuzzyTitle;
}

function pickDefaultDumpSectionIds(detail: DumpDetail): string[] {
  const wanted = ['short text', 'what happened', 'error analysis', 'source code extract', 'active calls', 'call stack'];
  const selected: string[] = [];

  for (const pattern of wanted) {
    const found = detail.chapters.find(
      (chapter) => normalizeDumpSectionKey(chapter.title).includes(normalizeDumpSectionKey(pattern)) && chapter.name,
    );
    if (found?.name && !selected.includes(found.name) && detail.sections[found.name]) {
      selected.push(found.name);
    }
  }

  if (selected.length > 0) return selected;

  const ordered = [...detail.chapters]
    .sort((a, b) => {
      if (a.line !== b.line) return a.line - b.line;
      return a.chapterOrder - b.chapterOrder;
    })
    .map((chapter) => chapter.name)
    .filter((name) => Boolean(name) && Boolean(detail.sections[name]));
  return Array.from(new Set(ordered)).slice(0, 5);
}

function normalizeDumpSectionKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ─── SAPGit Handler ──────────────────────────────────────────────────

type SapGitBackend = 'gcts' | 'abapgit';

function resolveSapGitBackend(args: Record<string, unknown>): { backend?: SapGitBackend; error?: string } {
  const forced = args.backend as SapGitBackend | undefined;
  const hasGcts = Boolean(cachedFeatures?.gcts?.available);
  const hasAbapGit = Boolean(cachedFeatures?.abapGit?.available);

  if (!hasGcts && !hasAbapGit) {
    return {
      error:
        'Neither gCTS nor abapGit is available on this SAP system. Run SAPManage(action="probe") to refresh feature detection.',
    };
  }

  if (forced) {
    if (forced === 'gcts' && !hasGcts) return { error: 'gCTS backend is not available on this SAP system.' };
    if (forced === 'abapgit' && !hasAbapGit) return { error: 'abapGit backend is not available on this SAP system.' };
    return { backend: forced };
  }

  return { backend: hasGcts ? 'gcts' : 'abapgit' };
}

async function loadAbapGitRepo(client: AdtClient, repoId: string) {
  const repos = await abapGitListRepos(client.http, client.safety);
  const repo = repos.find((candidate) => candidate.key === repoId);
  if (!repo) {
    throw new Error(
      `abapGit repository "${repoId}" was not found. Run SAPGit(action="list_repos", backend="abapgit").`,
    );
  }
  return repo;
}

async function handleSAPGit(
  client: AdtClient,
  args: Record<string, unknown>,
  _authInfo?: AuthInfo,
): Promise<ToolResult> {
  // Scope enforcement happens at handleToolCall level via ACTION_POLICY.
  // This handler only dispatches action logic.
  const action = String(args.action ?? '');
  if (!getActionPolicy('SAPGit', action)) {
    return errorResult(`Unknown SAPGit action: ${action}`);
  }

  const resolved = resolveSapGitBackend(args);
  if (!resolved.backend) {
    return errorResult(resolved.error ?? 'Unable to resolve SAPGit backend.');
  }

  const backend = resolved.backend;
  const repoId = String(args.repoId ?? '').trim();
  const url = String(args.url ?? '').trim();
  const branch = String(args.branch ?? '').trim();
  const packageName = String(args.package ?? '').trim();
  const user = String(args.user ?? '').trim() || undefined;
  const password = String(args.password ?? '').trim() || undefined;
  const token = String(args.token ?? '').trim() || undefined;
  const limit = Number(args.limit ?? 20);

  const gctsOnlyActions = new Set(['whoami', 'config', 'branches', 'history', 'objects', 'commit']);
  const abapGitOnlyActions = new Set(['external_info', 'check', 'stage', 'push']);
  if (backend === 'abapgit' && gctsOnlyActions.has(action)) {
    return errorResult(`Action '${action}' is only supported by gCTS; this system uses abapGit.`);
  }
  if (backend === 'gcts' && abapGitOnlyActions.has(action)) {
    return errorResult(`Action '${action}' is only supported by abapGit; this system uses gCTS.`);
  }

  let result: unknown;
  switch (action) {
    case 'list_repos':
      result =
        backend === 'gcts'
          ? await gctsListRepos(client.http, client.safety)
          : await abapGitListRepos(client.http, client.safety);
      break;
    case 'whoami':
      result = await gctsGetUserInfo(client.http, client.safety);
      break;
    case 'config':
      result = await gctsGetConfig(client.http, client.safety, repoId || undefined);
      break;
    case 'branches':
      if (!repoId) return errorResult('SAPGit(action="branches") requires repoId.');
      result = await gctsListBranches(client.http, client.safety, repoId);
      break;
    case 'external_info':
      if (!url) return errorResult('SAPGit(action="external_info") requires url.');
      result = await abapGitGetExternalInfo(client.http, client.safety, url, user, password);
      break;
    case 'history':
      if (!repoId) return errorResult('SAPGit(action="history") requires repoId.');
      result = await gctsGetCommitHistory(client.http, client.safety, repoId, Number.isFinite(limit) ? limit : 20);
      break;
    case 'objects':
      if (!repoId) return errorResult('SAPGit(action="objects") requires repoId.');
      result = await gctsListRepoObjects(client.http, client.safety, repoId);
      break;
    case 'check': {
      if (!repoId) return errorResult('SAPGit(action="check") requires repoId.');
      const repo = await loadAbapGitRepo(client, repoId);
      result = await abapGitCheckRepo(client.http, client.safety, repo);
      break;
    }
    case 'stage': {
      if (!repoId) return errorResult('SAPGit(action="stage") requires repoId.');
      const repo = await loadAbapGitRepo(client, repoId);
      result = await abapGitStageRepo(client.http, client.safety, repo);
      break;
    }
    case 'clone':
      if (!url) return errorResult('SAPGit(action="clone") requires url.');
      if (backend === 'gcts') {
        const params: GctsCloneParams = {
          rid: repoId || undefined,
          name: repoId || undefined,
          url,
          ...(packageName ? { package: packageName } : {}),
          user,
          password,
          token,
        };
        result = await gctsCloneRepo(client.http, client.safety, params);
      } else {
        if (!packageName) return errorResult('SAPGit(action="clone", backend="abapgit") requires package.');
        result = await abapGitCreateRepo(client.http, client.safety, {
          package: packageName,
          url,
          branchName: branch || undefined,
          transportRequest: String(args.transport ?? '').trim() || undefined,
          user,
          password,
        });
      }
      break;
    case 'pull':
      if (!repoId) return errorResult('SAPGit(action="pull") requires repoId.');
      if (backend === 'gcts') {
        result = await gctsPullRepo(client.http, client.safety, repoId, String(args.commit ?? '').trim() || undefined);
      } else {
        result = await abapGitPullRepo(client.http, client.safety, repoId, {
          ...(packageName ? { package: packageName } : {}),
          ...(url ? { url } : {}),
          ...(branch ? { branchName: branch } : {}),
          transportRequest: String(args.transport ?? '').trim() || undefined,
          user,
          password,
        });
      }
      break;
    case 'push': {
      if (!repoId) return errorResult('SAPGit(action="push") requires repoId.');
      const repo = await loadAbapGitRepo(client, repoId);
      const staging =
        Array.isArray(args.objects) && args.objects.length > 0
          ? { repoKey: repo.key, branchName: repo.branchName, objects: args.objects as Array<Record<string, unknown>> }
          : await abapGitStageRepo(client.http, client.safety, repo);
      await abapGitPushRepo(client.http, client.safety, repo, staging);
      result = { ok: true };
      break;
    }
    case 'commit':
      if (!repoId) return errorResult('SAPGit(action="commit") requires repoId.');
      result = await gctsCommitRepo(client.http, client.safety, repoId, {
        message: String(args.message ?? '').trim() || undefined,
        description: String(args.description ?? '').trim() || undefined,
        objects: Array.isArray(args.objects) ? (args.objects as Array<{ type?: string; name?: string }>) : undefined,
      });
      break;
    case 'switch_branch':
      if (!repoId || !branch) return errorResult('SAPGit(action="switch_branch") requires repoId and branch.');
      if (backend === 'gcts') {
        result = await gctsSwitchBranch(client.http, client.safety, repoId, branch);
      } else {
        await abapGitSwitchBranch(client.http, client.safety, repoId, branch, false);
        result = { ok: true };
      }
      break;
    case 'create_branch':
      if (!repoId || !branch) return errorResult('SAPGit(action="create_branch") requires repoId and branch.');
      if (backend === 'gcts') {
        result = await gctsCreateBranch(client.http, client.safety, repoId, {
          branch,
          ...(packageName ? { package: packageName } : {}),
        });
      } else {
        await abapGitCreateBranch(client.http, client.safety, repoId, branch);
        result = { ok: true };
      }
      break;
    case 'unlink':
      if (!repoId) return errorResult('SAPGit(action="unlink") requires repoId.');
      if (backend === 'gcts') {
        await gctsDeleteRepo(client.http, client.safety, repoId);
      } else {
        await abapGitUnlinkRepo(client.http, client.safety, repoId);
      }
      result = { ok: true };
      break;
    default:
      return errorResult(`Unknown SAPGit action: ${action}`);
  }

  const payload = backend === 'gcts' || backend === 'abapgit' ? { backend, result } : result;
  return textResult(JSON.stringify(payload, null, 2));
}

// ─── SAPTransport Handler ────────────────────────────────────────────

async function handleSAPTransport(client: AdtClient, args: Record<string, unknown>): Promise<ToolResult> {
  const action = String(args.action ?? '');

  switch (action) {
    case 'list': {
      const user = (args.user as string | undefined) || client.username;
      const status = (args.status as string | undefined) ?? 'D';
      const transports = await listTransports(client.http, client.safety, user, status === '*' ? undefined : status);
      return textResult(JSON.stringify(transports, null, 2));
    }
    case 'get': {
      const id = String(args.id ?? '');
      if (!id) return errorResult('Transport ID is required for "get" action.');
      const transport = await getTransport(client.http, client.safety, id);
      if (!transport) return textResult(`Transport ${id} not found.`);
      return textResult(JSON.stringify(transport, null, 2));
    }
    case 'create': {
      const description = String(args.description ?? '');
      if (!description) return errorResult('Description is required for "create" action.');
      const targetPackage = args.package ? String(args.package) : undefined;
      const id = await createTransport(client.http, client.safety, description, targetPackage);
      if (!id)
        return errorResult(
          'Transport creation succeeded but no transport ID was returned. Check the SAP system manually.',
        );
      return textResult(`Created transport request: ${id}`);
    }
    case 'release': {
      const id = String(args.id ?? '');
      if (!id) return errorResult('Transport ID is required for "release" action.');
      await releaseTransport(client.http, client.safety, id);
      return textResult(`Released transport request: ${id}`);
    }
    case 'delete': {
      const id = String(args.id ?? '');
      if (!id) return errorResult('Transport ID is required for "delete" action.');
      const recursive = Boolean(args.recursive ?? false);
      await deleteTransport(client.http, client.safety, id, recursive);
      return textResult(`Deleted transport request: ${id}${recursive ? ' (recursive)' : ''}`);
    }
    case 'reassign': {
      const id = String(args.id ?? '');
      if (!id) return errorResult('Transport ID is required for "reassign" action.');
      const owner = String(args.owner ?? '');
      if (!owner) return errorResult('Owner is required for "reassign" action.');
      const recursive = Boolean(args.recursive ?? false);
      await reassignTransport(client.http, client.safety, id, owner, recursive);
      return textResult(`Reassigned transport ${id} to ${owner}${recursive ? ' (recursive)' : ''}`);
    }
    case 'release_recursive': {
      const id = String(args.id ?? '');
      if (!id) return errorResult('Transport ID is required for "release_recursive" action.');
      const result = await releaseTransportRecursive(client.http, client.safety, id);
      return textResult(JSON.stringify(result, null, 2));
    }
    case 'check': {
      // Check transport requirements for an object/package combination.
      // Does NOT require allowTransportWrites — this is a read-only check.
      const objectType = String(args.type ?? '');
      const objectName = String(args.name ?? '');
      const pkg = String(args.package ?? '');
      if (!objectType || !objectName) return errorResult('"type" and "name" are required for "check" action.');
      if (!pkg) return errorResult('"package" is required for "check" action.');

      const objectUrl = objectUrlForType(objectType, objectName);
      const info = await getTransportInfo(client.http, client.safety, objectUrl, pkg, 'I');

      const summary = info.isLocal
        ? `Package "${pkg}" is local — no transport required.`
        : info.recording
          ? `Package "${pkg}" requires a transport for object creation.`
          : `Package "${pkg}" does not require transport recording.`;

      return textResult(
        JSON.stringify(
          {
            package: pkg,
            transportRequired: !info.isLocal && info.recording,
            isLocal: info.isLocal,
            deliveryUnit: info.deliveryUnit,
            existingTransports: info.existingTransports,
            ...(info.lockedTransport ? { lockedTransport: info.lockedTransport } : {}),
            summary,
          },
          null,
          2,
        ),
      );
    }
    case 'history': {
      const objectType = String(args.type ?? '');
      const objectName = String(args.name ?? '');
      if (!objectType || !objectName) {
        return errorResult('"type" and "name" are required for "history" action.');
      }

      const objectUrl = objectUrlForType(objectType, objectName);
      const primary = await getObjectTransports(client.http, client.safety, objectUrl);
      let candidateTransports = primary.candidateTransports;

      // Fallback: if per-object transport lookup is empty, derive the package via
      // the object metadata endpoint and ask transportchecks for candidate transports.
      if (primary.relatedTransports.length === 0 && candidateTransports.length === 0) {
        try {
          const pkg = await client.resolveObjectPackage(objectUrl);
          if (pkg && pkg !== '$TMP') {
            const info = await getTransportInfo(client.http, client.safety, objectUrl, pkg, '');
            candidateTransports = info.existingTransports;
          }
        } catch {
          // best-effort-fallback
        }
      }

      const lockOwner = primary.relatedTransports[0]?.owner;
      const summary = primary.lockedTransport
        ? `Object ${objectName} is locked in transport ${primary.lockedTransport}${lockOwner ? ` by ${lockOwner}` : ''}.`
        : candidateTransports.length > 0
          ? `Object ${objectName} has no active lock; ${candidateTransports.length} transport(s) available for assignment.`
          : `Object ${objectName} has no related or candidate transports (likely $TMP / local object).`;

      const history: ObjectTransportHistory = {
        object: { type: objectType, name: objectName, uri: objectUrl },
        ...(primary.lockedTransport ? { lockedTransport: primary.lockedTransport } : {}),
        relatedTransports: primary.relatedTransports,
        candidateTransports,
        summary,
      };

      return textResult(JSON.stringify(history, null, 2));
    }
    default:
      return errorResult(
        `Unknown SAPTransport action: ${action}. Supported: list, get, create, release, delete, reassign, release_recursive, check, history`,
      );
  }
}

// ─── SAPContext Handler ───────────────────────────────────────────────

const DEFAULT_SIBLING_MAX_CANDIDATES = 4;
const HARD_MAX_SIBLING_MAX_CANDIDATES = 10;

function parseSiblingMaxCandidates(value: unknown): number {
  const parsed = Number(value ?? DEFAULT_SIBLING_MAX_CANDIDATES);
  if (!Number.isFinite(parsed)) return DEFAULT_SIBLING_MAX_CANDIDATES;
  const rounded = Math.trunc(parsed);
  return Math.min(Math.max(rounded, 1), HARD_MAX_SIBLING_MAX_CANDIDATES);
}

async function handleSAPContext(
  client: AdtClient,
  args: Record<string, unknown>,
  cachingLayer?: CachingLayer,
): Promise<ToolResult> {
  const action = String(args.action ?? '');
  // action="impact" is DDLS-only on the server side — default the type so LLMs
  // don't have to supply it redundantly (and don't get a validation retry when
  // they don't). Any non-DDLS value still fails the guardrail below.
  const rawType = String(args.type ?? '');
  const type = normalizeObjectType(rawType || (action === 'impact' ? 'DDLS' : ''));
  const name = String(args.name ?? '');
  const maxDeps = Number(args.maxDeps ?? 20);
  const depth = Math.min(Math.max(Number(args.depth ?? 1), 1), 3);

  // ─── Reverse dep lookup (pre-warmer only) ─────────────────────────
  if (action === 'usages') {
    if (!name) return errorResult('"name" is required for usages action.');
    if (!cachingLayer) {
      return errorResult(
        'Reverse dependency lookup requires object caching. Cache is disabled (ARC1_CACHE=none). ' +
          'Enable caching and run cache warmup to use this feature.',
      );
    }
    const usages = cachingLayer.getUsages(name);
    if (usages === null) {
      return errorResult(
        `Reverse dependency lookup requires a pre-warmed cache. The cache warmup has not been run yet.\n\n` +
          `To enable this feature:\n` +
          `1. Start ARC-1 with --cache-warmup (or set ARC1_CACHE_WARMUP=true)\n` +
          `2. Wait for the warmup to complete (indexes all custom objects)\n` +
          `3. Then retry SAPContext(action="usages", name="${name}")\n\n` +
          `Alternative: Use SAPNavigate(action="references", type="CLAS", name="${name}") for a live ADT lookup (slower, but works without warmup).`,
      );
    }
    if (usages.length === 0) {
      return textResult(`No objects found that depend on "${name}" in the cached index.`);
    }
    return textResult(JSON.stringify({ name, usageCount: usages.length, usages }, null, 2));
  }

  if (!type || !name) {
    return errorResult('Both "type" and "name" are required for SAPContext.');
  }

  // Helper: get source with cache support
  const cachedGet = async (
    objType: string,
    objName: string,
    fetcher: (ifNoneMatch?: string) => Promise<SourceReadResult>,
  ): Promise<string> => {
    if (!cachingLayer) return (await fetcher()).source;
    const { source } = await cachingLayer.getSource(objType, objName, fetcher);
    return source;
  };

  if (action === 'impact') {
    if (type !== 'DDLS') {
      return errorResult(
        'SAPContext(action="impact") supports DDLS only. For non-CDS objects, use SAPNavigate(action="references").',
      );
    }

    const ddlSource = await cachedGet('DDLS', name, (ifNoneMatch) => client.getDdls(name, { ifNoneMatch }));
    const upstream = buildCdsUpstream(extractCdsDependencies(ddlSource));
    const includeIndirect = args.includeIndirect === true;
    const siblingCheck = args.siblingCheck !== false;
    const siblingMaxCandidates = parseSiblingMaxCandidates(args.siblingMaxCandidates);
    let downstream = classifyCdsImpact([], { includeIndirect });
    const warnings: string[] = [];
    const consistencyHints: string[] = [];
    let siblingExtensionAnalysis:
      | {
          enabled: boolean;
          stem: string;
          searchQuery: string;
          includeIndirect: boolean;
          maxCandidates: number;
          filters: {
            samePackage: boolean;
            siblingStem: string;
          };
          target: {
            name: string;
            packageName?: string;
            metadataExtensions: number;
          };
          consideredCandidates: number;
          checkedCandidates: Array<SiblingExtensionCandidate & { downstreamTotal: number }>;
          skipped: {
            self: number;
            nonDdls: number;
            packageMismatch: number;
            nameMismatch: number;
            overLimit: number;
          };
        }
      | undefined;

    try {
      const whereUsed = await findWhereUsed(client.http, client.safety, objectUrlForType('DDLS', name));
      downstream = classifyCdsImpact(whereUsed, { includeIndirect });
    } catch (err) {
      if (err instanceof AdtApiError && [404, 405, 415, 501].includes(err.statusCode)) {
        warnings.push('Where-used endpoint not available on this system');
      } else {
        throw err;
      }
    }

    if (siblingCheck && warnings.length === 0) {
      try {
        const targetName = name.toUpperCase();
        const stem = deriveSiblingStem(targetName);
        // Guard against over-broad sibling searches for short/degenerate stems
        // (e.g., target "Z1" -> stem "Z" -> searchQuery "Z*" would scan the full Z namespace).
        if (stem.length < 3) {
          warnings.push(
            `Sibling consistency check skipped: derived stem "${stem}" is too short to identify siblings safely.`,
          );
        } else {
          const targetMatches = await client.searchObject(targetName, 25);
          const targetMatch = targetMatches.find(
            (candidate) =>
              normalizeObjectType(candidate.objectType) === 'DDLS' && candidate.objectName.toUpperCase() === targetName,
          );
          const targetPackageName = targetMatch?.packageName;

          if (!targetPackageName) {
            warnings.push(`Sibling consistency check skipped: could not resolve package for DDLS "${targetName}".`);
          } else {
            const searchQuery = `${stem}*`;
            const searchMaxResults = Math.min(100, Math.max(siblingMaxCandidates * 4, siblingMaxCandidates + 4));
            const siblingCandidates = await client.searchObject(searchQuery, searchMaxResults);
            const skipped = {
              self: 0,
              nonDdls: 0,
              packageMismatch: 0,
              nameMismatch: 0,
              overLimit: 0,
            };
            const filteredCandidates: Array<{ name: string; packageName: string }> = [];
            const seenNames = new Set<string>();

            for (const candidate of siblingCandidates) {
              if (normalizeObjectType(candidate.objectType) !== 'DDLS') {
                skipped.nonDdls += 1;
                continue;
              }

              const candidateName = candidate.objectName.toUpperCase();
              if (candidateName === targetName) {
                skipped.self += 1;
                continue;
              }
              if (candidate.packageName !== targetPackageName) {
                skipped.packageMismatch += 1;
                continue;
              }
              if (!isSiblingNameMatch(targetName, candidateName, stem)) {
                skipped.nameMismatch += 1;
                continue;
              }
              if (seenNames.has(candidateName)) {
                continue;
              }
              seenNames.add(candidateName);
              filteredCandidates.push({ name: candidateName, packageName: candidate.packageName });
            }

            const selectedCandidates = filteredCandidates.slice(0, siblingMaxCandidates);
            skipped.overLimit = Math.max(filteredCandidates.length - selectedCandidates.length, 0);

            const checkedCandidates: Array<SiblingExtensionCandidate & { downstreamTotal: number }> = [];
            let skippedWhereUsedCandidates = 0;

            for (const candidate of selectedCandidates) {
              try {
                const siblingWhereUsed = await findWhereUsed(
                  client.http,
                  client.safety,
                  objectUrlForType('DDLS', candidate.name),
                );
                const siblingDownstream = classifyCdsImpact(siblingWhereUsed, { includeIndirect });
                checkedCandidates.push({
                  name: candidate.name,
                  packageName: candidate.packageName,
                  metadataExtensions: siblingDownstream.metadataExtensions.length,
                  downstreamTotal: siblingDownstream.summary.total,
                });
              } catch (err) {
                if (err instanceof AdtApiError && [404, 405, 415, 501].includes(err.statusCode)) {
                  skippedWhereUsedCandidates += 1;
                  continue;
                }
                throw err;
              }
            }

            if (skippedWhereUsedCandidates > 0) {
              warnings.push(
                `Sibling consistency check skipped ${skippedWhereUsedCandidates} candidate(s) due to where-used endpoint errors.`,
              );
            }

            const siblingFinding = buildSiblingExtensionFinding({
              targetName,
              targetPackageName,
              stem,
              targetMetadataExtensions: downstream.metadataExtensions.length,
              siblings: checkedCandidates,
            });
            if (siblingFinding) {
              consistencyHints.push(siblingFinding.message);
            }

            siblingExtensionAnalysis = {
              enabled: true,
              stem,
              searchQuery,
              includeIndirect,
              maxCandidates: siblingMaxCandidates,
              filters: {
                samePackage: true,
                siblingStem: stem,
              },
              target: {
                name: targetName,
                packageName: targetPackageName,
                metadataExtensions: downstream.metadataExtensions.length,
              },
              consideredCandidates: filteredCandidates.length,
              checkedCandidates,
              skipped,
            };
          }
        }
      } catch (err) {
        logger.debug('Sibling consistency check aborted', {
          name,
          error: err instanceof Error ? err.message : String(err),
        });
        warnings.push('Sibling consistency check skipped due to search or where-used processing errors.');
      }
    }

    const upstreamCount =
      upstream.tables.length + upstream.views.length + upstream.associations.length + upstream.compositions.length;

    const response = {
      name,
      type: 'DDLS',
      upstream,
      downstream,
      summary: {
        upstreamCount,
        downstreamTotal: downstream.summary.total,
        downstreamDirect: downstream.summary.direct,
      },
      ...(consistencyHints.length > 0 ? { consistencyHints } : {}),
      ...(siblingExtensionAnalysis ? { siblingExtensionAnalysis } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };

    return textResult(JSON.stringify(response, null, 2));
  }

  // Get source — either provided or fetched from SAP
  let source: string;
  if (args.source) {
    source = String(args.source);
  } else {
    switch (type) {
      case 'CLAS':
        source = await cachedGet('CLAS', name, (ifNoneMatch) => client.getClass(name, undefined, { ifNoneMatch }));
        break;
      case 'INTF':
        source = await cachedGet('INTF', name, (ifNoneMatch) => client.getInterface(name, { ifNoneMatch }));
        break;
      case 'PROG':
        source = await cachedGet('PROG', name, (ifNoneMatch) => client.getProgram(name, { ifNoneMatch }));
        break;
      case 'FUNC': {
        const group = String(args.group ?? '');
        if (!group) {
          return errorResult(
            'The "group" parameter is required for FUNC type. Use SAPSearch to find the function group.',
          );
        }
        source = await cachedGet('FUNC', name, (ifNoneMatch) => client.getFunction(group, name, { ifNoneMatch }));
        break;
      }
      case 'DDLS': {
        const ddlSource = await cachedGet('DDLS', name, (ifNoneMatch) => client.getDdls(name, { ifNoneMatch }));
        const cdsResult = await compressCdsContext(client, ddlSource, name, maxDeps, depth, cachingLayer);
        return textResult(cdsResult.output);
      }
      default:
        return errorResult(`SAPContext supports types: CLAS, INTF, PROG, FUNC, DDLS. Got: ${type}`);
    }
  }

  // Check dep graph cache — if source hash matches, return cached contracts
  if (cachingLayer) {
    const cachedGraph = cachingLayer.getCachedDepGraph(source);
    if (cachedGraph) {
      const successful = cachedGraph.contracts.filter((c) => c.success);
      const failed = cachedGraph.contracts.filter((c) => !c.success);
      const lines: string[] = [];
      lines.push(
        `* === Dependency context for ${name} (${successful.length} deps resolved${failed.length > 0 ? `, ${failed.length} failed` : ''}) [cached] ===`,
      );
      lines.push('');
      for (const contract of successful) {
        const typeLabel = contract.type.toLowerCase();
        const methodLabel = contract.methodCount > 0 ? `, ${contract.methodCount} methods` : '';
        lines.push(`* --- ${contract.name} (${typeLabel}${methodLabel}) ---`);
        lines.push(contract.source.trim());
        lines.push('');
      }
      if (failed.length > 0) {
        lines.push('* --- Failed dependencies ---');
        for (const f of failed) {
          lines.push(`* ${f.name}: ${f.error}`);
        }
        lines.push('');
      }
      const totalLines = lines.length;
      lines.push(
        `* Stats: ${successful.length + failed.length} deps found, ${successful.length} resolved, ${failed.length} failed, ${totalLines} lines [from cache]`,
      );
      return textResult(lines.join('\n'));
    }
  }

  // Use detected ABAP version from probe if available, otherwise Cloud (superset)
  const abaplintVersion = cachedFeatures?.abapRelease
    ? mapSapReleaseToAbaplintVersion(cachedFeatures.abapRelease)
    : undefined;

  const result = await compressContext(client, source, name, type, maxDeps, depth, abaplintVersion, cachingLayer);
  return textResult(result.output);
}

function buildCdsUpstream(
  deps: Array<{
    name: string;
    kind: 'data_source' | 'association' | 'composition' | 'projection_base';
  }>,
): {
  tables: Array<{ name: string }>;
  views: Array<{ name: string }>;
  associations: Array<{ name: string }>;
  compositions: Array<{ name: string }>;
} {
  const tableNames = new Set<string>();
  const viewNames = new Set<string>();
  const associationNames = new Set<string>();
  const compositionNames = new Set<string>();

  for (const dep of deps) {
    const upperName = dep.name.toUpperCase();
    if (dep.kind === 'association') {
      associationNames.add(upperName);
      continue;
    }
    if (dep.kind === 'composition') {
      compositionNames.add(upperName);
      continue;
    }
    if (dep.kind === 'projection_base') {
      viewNames.add(upperName);
      continue;
    }
    if (isLikelyCdsViewName(upperName)) {
      viewNames.add(upperName);
    } else {
      tableNames.add(upperName);
    }
  }

  return {
    tables: [...tableNames].sort().map((name) => ({ name })),
    views: [...viewNames].sort().map((name) => ({ name })),
    associations: [...associationNames].sort().map((name) => ({ name })),
    compositions: [...compositionNames].sort().map((name) => ({ name })),
  };
}

function isLikelyCdsViewName(name: string): boolean {
  if (name.startsWith('/')) {
    return /\/[ICRPAZ][A-Z0-9_]*_/.test(name);
  }
  return /^(ZI_|ZC_|ZR_|ZP_|I_|C_|R_|P_)/.test(name);
}

// ─── SAPManage Handler ────────────────────────────────────────────────

/** Cached feature status — populated on first probe */
let cachedFeatures: ResolvedFeatures | undefined;
let cachedDiscovery: Map<string, string[]> = new Map();

async function handleSAPManage(
  client: AdtClient,
  config: ServerConfig,
  args: Record<string, unknown>,
  cachingLayer?: CachingLayer,
  isPerUserClient?: boolean,
): Promise<ToolResult> {
  const action = String(args.action ?? '');
  const flpUnavailableMessage =
    'FLP customization service (PAGE_BUILDER_CUST) is not available on this system. Check ICF service activation in SICF.';

  switch (action) {
    case 'features': {
      if (!cachedFeatures) {
        return textResult(
          JSON.stringify({ message: 'No features probed yet. Use action="probe" to probe the SAP system first.' }),
        );
      }
      return textResult(JSON.stringify(cachedFeatures, null, 2));
    }

    case 'create_package': {
      const name = String(args.name ?? '').trim();
      const description = String(args.description ?? '').trim();
      const superPackage = String(args.superPackage ?? '').trim();
      const softwareComponent = String(args.softwareComponent ?? '').trim();
      const transportLayer = String(args.transportLayer ?? '').trim();
      const transport = String(args.transport ?? '').trim();

      if (!name) return errorResult('"name" is required for create_package action.');
      if (!description) return errorResult('"description" is required for create_package action.');

      checkOperation(client.safety, OperationType.Create, 'CreatePackage');

      // Package allowlist is enforced on the parent package, not the new package name.
      // This enables creating children in allowed parents like $TMP.
      if (superPackage) {
        checkPackage(client.safety, superPackage);
      }

      let effectiveTransport = transport || undefined;
      const packageUrl = `/sap/bc/adt/packages/${encodeURIComponent(name)}`;

      // Transport pre-flight for non-local parent packages when no transport is provided.
      if (!effectiveTransport && superPackage && superPackage.toUpperCase() !== '$TMP') {
        try {
          const transportInfo = await getTransportInfo(client.http, client.safety, packageUrl, superPackage, 'I');
          if (transportInfo.lockedTransport) {
            effectiveTransport = transportInfo.lockedTransport;
          } else if (!transportInfo.isLocal && transportInfo.recording) {
            const existingList =
              transportInfo.existingTransports.length > 0
                ? `\n\nExisting transports for this package:\n${transportInfo.existingTransports
                    .slice(0, 10)
                    .map((t) => `  - ${t.id}: ${t.description} (${t.owner})`)
                    .join('\n')}`
                : '';
            return errorResult(
              `Package "${superPackage}" requires a transport number for package creation, but none was provided.\n\n` +
                `To fix this, either:\n` +
                `1. Use SAPTransport(action="list") to find an existing modifiable transport\n` +
                `2. Use SAPTransport(action="create", description="...") to create a new one\n` +
                `3. Then retry SAPManage(action="create_package", ..., transport="<transport_id>")` +
                existingList,
            );
          }
        } catch {
          // Graceful fallback: let SAP enforce transport requirements if the pre-check fails.
        }
      }

      const packageTypeRaw = String(args.packageType ?? '').trim();
      const packageType: PackageCreateParams['packageType'] =
        packageTypeRaw === 'development' || packageTypeRaw === 'structure' || packageTypeRaw === 'main'
          ? packageTypeRaw
          : undefined;

      const xml = buildPackageXml({
        name,
        description,
        superPackage: superPackage || undefined,
        softwareComponent: softwareComponent || undefined,
        transportLayer: transportLayer || undefined,
        packageType,
      });

      await createObject(
        client.http,
        client.safety,
        '/sap/bc/adt/packages',
        xml,
        'application/*',
        effectiveTransport,
        undefined,
        cachedFeatures?.abapRelease,
      );
      return textResult(`Created package ${name}.`);
    }

    case 'delete_package': {
      const name = String(args.name ?? '').trim();
      const transport = String(args.transport ?? '').trim();
      if (!name) return errorResult('"name" is required for delete_package action.');

      checkOperation(client.safety, OperationType.Delete, 'DeletePackage');

      const packageUrl = `/sap/bc/adt/packages/${encodeURIComponent(name)}`;
      await client.http.withStatefulSession(async (session) => {
        const lock = await lockObject(session, client.safety, packageUrl, 'MODIFY', cachedFeatures?.abapRelease);
        const effectiveTransport = transport || lock.corrNr || undefined;
        try {
          await deleteObject(session, client.safety, packageUrl, lock.lockHandle, effectiveTransport);
        } finally {
          try {
            await unlockObject(session, packageUrl, lock.lockHandle);
          } catch {
            // Object may already be deleted — unlock failure is expected.
          }
        }
      });

      return textResult(`Deleted package ${name}.`);
    }

    case 'change_package': {
      const objectName = String(args.objectName ?? '').trim();
      const objectType = String(args.objectType ?? '').trim();
      const oldPackage = String(args.oldPackage ?? '').trim();
      const newPackage = String(args.newPackage ?? '').trim();
      const transport = String(args.transport ?? '').trim();
      let objectUri = String(args.objectUri ?? '').trim();

      if (!objectName) return errorResult('"objectName" is required for change_package action.');
      if (!objectType) return errorResult('"objectType" is required for change_package action.');
      if (!oldPackage) return errorResult('"oldPackage" is required for change_package action.');
      if (!newPackage) return errorResult('"newPackage" is required for change_package action.');

      checkOperation(client.safety, OperationType.Update, 'ChangePackage');
      checkPackage(client.safety, oldPackage);
      checkPackage(client.safety, newPackage);

      // Resolve object URI via search if not provided
      if (!objectUri) {
        const searchResp = await client.http.get(
          `/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=${encodeURIComponent(objectName)}&maxResults=10`,
        );
        const uriMatch = searchResp.body.match(
          new RegExp(`adtcore:uri="([^"]*)"[^>]*adtcore:type="${objectType.replace('/', '\\/')}"`, 'i'),
        );
        if (!uriMatch?.[1]) {
          return errorResult(
            `Could not find object "${objectName}" with type "${objectType}" via ADT search. ` +
              `Verify the object exists and the type is correct (e.g., CLAS/OC, DDLS/DF, PROG/P).`,
          );
        }
        objectUri = uriMatch[1];
      }

      // Transport pre-flight for non-local target packages
      let effectiveTransport = transport || undefined;
      if (!effectiveTransport && newPackage.toUpperCase() !== '$TMP') {
        try {
          const transportInfo = await getTransportInfo(client.http, client.safety, objectUri, newPackage, 'I');
          if (transportInfo.lockedTransport) {
            effectiveTransport = transportInfo.lockedTransport;
          } else if (!transportInfo.isLocal && transportInfo.recording) {
            const existingList =
              transportInfo.existingTransports.length > 0
                ? `\n\nExisting transports for this package:\n${transportInfo.existingTransports
                    .slice(0, 10)
                    .map((t) => `  - ${t.id}: ${t.description} (${t.owner})`)
                    .join('\n')}`
                : '';
            return errorResult(
              `Package "${newPackage}" requires a transport number for change_package, but none was provided.\n\n` +
                `To fix this, either:\n` +
                `1. Use SAPTransport(action="list") to find an existing modifiable transport\n` +
                `2. Use SAPTransport(action="create", description="...") to create a new one\n` +
                `3. Then retry SAPManage(action="change_package", ..., transport="<transport_id>")` +
                existingList,
            );
          }
        } catch {
          // Graceful fallback: let SAP enforce transport requirements if the pre-check fails.
        }
      }

      const result = await changePackage(client.http, client.safety, {
        objectUri,
        objectType,
        objectName,
        oldPackage,
        newPackage,
        transport: effectiveTransport,
      });

      const transportNote = result.transport ? ` (transport: ${result.transport})` : '';
      return textResult(`Moved ${objectName} from package ${oldPackage} to ${newPackage}${transportNote}.`);
    }

    case 'flp_list_catalogs': {
      const catalogs = await listCatalogs(client.http, client.safety);
      const customCount = catalogs.filter((c) => /^(Z|Y)/i.test(c.domainId)).length;
      const lines = [
        `${catalogs.length} catalogs (${customCount} custom Z/Y). Columns: domainId | title | type | scope | chips`,
        ...catalogs.map(
          (c) => `${c.domainId} | ${c.title || '(no title)'} | ${c.type || '-'} | ${c.scope || '-'} | ${c.chipCount}`,
        ),
      ];
      return textResult(lines.join('\n'));
    }

    case 'flp_list_groups': {
      const groups = await listGroups(client.http, client.safety);
      const lines = [
        `${groups.length} groups. Columns: id | title`,
        ...groups.map((g) => `${g.id} | ${g.title || '(no title)'}`),
      ];
      return textResult(lines.join('\n'));
    }

    case 'flp_list_tiles': {
      const catalogId = String(args.catalogId ?? '');
      if (!catalogId) return errorResult('"catalogId" is required for flp_list_tiles action.');
      const result = await listTiles(client.http, client.safety, catalogId);
      if (result.backendError) {
        return textResult(`⚠ Backend error for catalog "${catalogId}": ${result.backendError}\n\nReturned 0 tiles.`);
      }
      const lines = [
        `${result.tiles.length} tiles in catalog "${catalogId}". Columns: instanceId | title | chipId | semanticObject | semanticAction`,
        ...result.tiles.map((t) => {
          const so = (t.configuration as Record<string, unknown> | null)?.semantic_object ?? '';
          const sa = (t.configuration as Record<string, unknown> | null)?.semantic_action ?? '';
          return `${t.instanceId} | ${t.title || '(no title)'} | ${t.chipId} | ${so} | ${sa}`;
        }),
      ];
      return textResult(lines.join('\n'));
    }

    case 'flp_create_catalog': {
      if (cachedFeatures?.flp && !cachedFeatures.flp.available) {
        return errorResult(flpUnavailableMessage);
      }
      const domainId = String(args.domainId ?? '');
      const title = String(args.title ?? '');
      if (!domainId) return errorResult('"domainId" is required for flp_create_catalog action.');
      if (!title) return errorResult('"title" is required for flp_create_catalog action.');
      const catalog = await createCatalog(client.http, client.safety, domainId, title);
      return textResult(JSON.stringify(catalog, null, 2));
    }

    case 'flp_create_group': {
      if (cachedFeatures?.flp && !cachedFeatures.flp.available) {
        return errorResult(flpUnavailableMessage);
      }
      const groupId = String(args.groupId ?? '');
      const title = String(args.title ?? '');
      if (!groupId) return errorResult('"groupId" is required for flp_create_group action.');
      if (!title) return errorResult('"title" is required for flp_create_group action.');
      const group = await createGroup(client.http, client.safety, groupId, title);
      return textResult(JSON.stringify(group, null, 2));
    }

    case 'flp_create_tile': {
      if (cachedFeatures?.flp && !cachedFeatures.flp.available) {
        return errorResult(flpUnavailableMessage);
      }
      const catalogId = String(args.catalogId ?? '');
      if (!catalogId) return errorResult('"catalogId" is required for flp_create_tile action.');
      const rawTile = args.tile;
      if (!rawTile || typeof rawTile !== 'object' || Array.isArray(rawTile)) {
        return errorResult('"tile" object is required for flp_create_tile action.');
      }
      const tile = rawTile as Record<string, unknown>;
      const id = String(tile.id ?? '');
      const title = String(tile.title ?? '');
      const semanticObject = String(tile.semanticObject ?? '');
      const semanticAction = String(tile.semanticAction ?? '');
      if (!id || !title || !semanticObject || !semanticAction) {
        return errorResult(
          '"tile.id", "tile.title", "tile.semanticObject", and "tile.semanticAction" are required for flp_create_tile action.',
        );
      }
      const tileInstance = await createTile(client.http, client.safety, catalogId, {
        id,
        title,
        semanticObject,
        semanticAction,
        icon: typeof tile.icon === 'string' ? tile.icon : undefined,
        url: typeof tile.url === 'string' ? tile.url : undefined,
        subtitle: typeof tile.subtitle === 'string' ? tile.subtitle : undefined,
        info: typeof tile.info === 'string' ? tile.info : undefined,
      });
      return textResult(JSON.stringify(tileInstance, null, 2));
    }

    case 'flp_add_tile_to_group': {
      if (cachedFeatures?.flp && !cachedFeatures.flp.available) {
        return errorResult(flpUnavailableMessage);
      }
      const groupId = String(args.groupId ?? '');
      const catalogId = String(args.catalogId ?? '');
      const tileInstanceId = String(args.tileInstanceId ?? '');
      if (!groupId) return errorResult('"groupId" is required for flp_add_tile_to_group action.');
      if (!catalogId) return errorResult('"catalogId" is required for flp_add_tile_to_group action.');
      if (!tileInstanceId) return errorResult('"tileInstanceId" is required for flp_add_tile_to_group action.');
      const result = await addTileToGroup(client.http, client.safety, groupId, catalogId, tileInstanceId);
      return textResult(JSON.stringify(result, null, 2));
    }

    case 'flp_delete_catalog': {
      if (cachedFeatures?.flp && !cachedFeatures.flp.available) {
        return errorResult(flpUnavailableMessage);
      }
      const catalogId = String(args.catalogId ?? '');
      if (!catalogId) return errorResult('"catalogId" is required for flp_delete_catalog action.');
      await deleteCatalog(client.http, client.safety, catalogId);
      return textResult(`Deleted FLP catalog: ${catalogId}`);
    }

    case 'cache_stats': {
      if (!cachingLayer) {
        return textResult(JSON.stringify({ enabled: false, message: 'Object cache is disabled (ARC1_CACHE=none).' }));
      }
      const stats = cachingLayer.stats();
      return textResult(
        JSON.stringify(
          {
            enabled: true,
            warmupAvailable: cachingLayer.isWarmupAvailable,
            ...stats,
            inactiveListCache: cachingLayer.inactiveLists.stats(),
          },
          null,
          2,
        ),
      );
    }

    case 'probe': {
      const { defaultFeatureConfig } = await import('../adt/config.js');
      const featureConfig = defaultFeatureConfig();
      // Override with server config feature toggles
      featureConfig.hana = config.featureHana as 'auto' | 'on' | 'off';
      featureConfig.abapGit = config.featureAbapGit as 'auto' | 'on' | 'off';
      featureConfig.rap = config.featureRap as 'auto' | 'on' | 'off';
      featureConfig.amdp = config.featureAmdp as 'auto' | 'on' | 'off';
      featureConfig.ui5 = config.featureUi5 as 'auto' | 'on' | 'off';
      featureConfig.transport = config.featureTransport as 'auto' | 'on' | 'off';
      featureConfig.ui5repo = config.featureUi5Repo as 'auto' | 'on' | 'off';
      featureConfig.flp = config.featureFlp as 'auto' | 'on' | 'off';

      const probed = await probeFeatures(client.http, featureConfig, config.systemType);

      // In PP mode with a per-user client, auth-sensitive results (401/403 on any
      // feature) must not poison the global cache — another user may have different
      // authorizations.  Return the per-user result to the caller but keep the global
      // cache unchanged.  However, when PP is enabled but the request fell back to the
      // shared/default client (no JWT, missing btpConfig, or non-strict fallback), the
      // probe ran with the same service-account credentials as the startup probe, so
      // updating the cache is safe and allows a manual probe to repair a failed startup.
      // Apply the same auth-failure sanitization as the startup probe: in PP mode,
      // shared-client 401/403 on textSearch must not hide source_code from users who
      // might have authorization via per-user clients.
      if (!isPerUserClient) {
        if (config.ppEnabled && probed.textSearch && !probed.textSearch.available) {
          const reason = probed.textSearch.reason ?? '';
          if (reason.includes('authorization') || reason.includes('401') || reason.includes('403')) {
            probed.textSearch = undefined;
          }
        }
        cachedFeatures = probed;
      }
      return textResult(JSON.stringify(probed, null, 2));
    }

    default:
      return errorResult(
        `Unknown SAPManage action: ${action}. Supported: features, probe, cache_stats, create_package, delete_package, change_package, flp_list_catalogs, flp_list_groups, flp_list_tiles, flp_create_catalog, flp_create_group, flp_create_tile, flp_add_tile_to_group, flp_delete_catalog`,
      );
  }
}

/** Reset cached features (for testing) */
export function resetCachedFeatures(): void {
  cachedFeatures = undefined;
  cachedDiscovery = new Map();
}

/** Set cached features directly (for testing BTP mode, etc.) */
export function setCachedFeatures(features: ResolvedFeatures | undefined): void {
  cachedFeatures = features;
}

/** Get cached features (for tool definition adaptation) */
export function getCachedFeatures(): ResolvedFeatures | undefined {
  return cachedFeatures;
}

/** Set startup-cached ADT discovery MIME map. */
export function setCachedDiscovery(map: Map<string, string[]>): void {
  cachedDiscovery = map;
}

/** Get startup-cached ADT discovery MIME map. */
export function getCachedDiscovery(): Map<string, string[]> {
  return cachedDiscovery;
}
