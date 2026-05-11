/**
 * ACTION_POLICY — single source of truth for scope/opType/featureGate per tool+action.
 *
 * Every MCP tool call is gated by this matrix. `handleToolCall` in intent.ts looks up
 * `(tool, action-or-type)` here to get the required scope (user-gate) and OperationType
 * (server-safety gate). Tool-listing pruning in server.ts also reads from here to hide
 * actions the user can't execute.
 *
 * Lookup rules:
 *   - Specific key `Tool.action` or `Tool.type` wins if present.
 *   - Falls back to tool-level key `Tool`.
 *   - Missing → treated as "unknown action" error at runtime.
 *
 * Admin-facing invariant: the CI validator at scripts/validate-action-policy.ts
 * asserts every action in src/handlers/schemas.ts is covered here, and vice versa.
 * If you add a new action, add its policy entry here and the validator will tell
 * you if you forgot.
 */

import { OperationType, type OperationTypeCode } from '../adt/safety.js';

export type Scope = 'read' | 'write' | 'data' | 'sql' | 'transports' | 'git' | 'admin';

export type FeatureGate = 'rap' | 'git' | 'transport' | 'flp' | 'ui5-repo';

export interface ActionPolicy {
  scope: Scope;
  opType: OperationTypeCode;
  featureGate?: FeatureGate;
}

/** The central policy matrix — all tools, all actions/types. */
export const ACTION_POLICY: Record<string, ActionPolicy> = {
  // ── SAPRead ──────────────────────────────────────────────────────
  // Tool-level default — applies to all SAP object reads (PROG, CLAS, etc.)
  SAPRead: { scope: 'read', opType: OperationType.Read },
  // Per-type overrides
  'SAPRead.TABLE_CONTENTS': { scope: 'data', opType: OperationType.Query },

  // ── SAPSearch ────────────────────────────────────────────────────
  SAPSearch: { scope: 'read', opType: OperationType.Search },
  // tadir_lookup `source='db'` and `source='both'` issue freestyle SQL against TADIR
  // (the only way to surface ghost rows the ADT info-system filters out). Both
  // escalate to the `sql` scope + FreeSQL opType so viewer-only profiles cannot
  // piggyback on the ADT info-system route to perform a SQL query. The default
  // `source='adt'` stays on the tool-level entry above (`read` scope).
  // Synthesized at runtime by handleSAPSearch as `SAPSearch.tadir_lookup_<source>`.
  'SAPSearch.tadir_lookup_db': { scope: 'sql', opType: OperationType.FreeSQL },
  'SAPSearch.tadir_lookup_both': { scope: 'sql', opType: OperationType.FreeSQL },

  // ── SAPQuery (freestyle SQL) ─────────────────────────────────────
  SAPQuery: { scope: 'sql', opType: OperationType.FreeSQL },

  // ── SAPWrite ─────────────────────────────────────────────────────
  SAPWrite: { scope: 'write', opType: OperationType.Update },
  'SAPWrite.create': { scope: 'write', opType: OperationType.Create },
  'SAPWrite.update': { scope: 'write', opType: OperationType.Update },
  'SAPWrite.delete': { scope: 'write', opType: OperationType.Delete },
  'SAPWrite.edit_method': { scope: 'write', opType: OperationType.Update },
  'SAPWrite.batch_create': { scope: 'write', opType: OperationType.Create },
  // scaffold_rap_handlers updates an existing behavior-pool CLAS (writes method
  // declarations into one or more includes). It is a RAP-feature-specific
  // action — explicit entry lets admins target it with SAP_DENY_ACTIONS
  // (e.g. "SAPWrite.scaffold_rap_handlers") to block it while still allowing
  // plain create/update. The featureGate tag also keeps this action aligned
  // with the SAPTransport/SAPGit/FLP pattern for future enforcement.
  'SAPWrite.scaffold_rap_handlers': { scope: 'write', opType: OperationType.Update, featureGate: 'rap' },
  // generate_behavior_implementation is the higher-level RAP one-shot wrapper
  // around scaffold_rap_handlers — same scope, same opType, same RAP feature
  // gate. Explicit entry so admins can target it with SAP_DENY_ACTIONS.
  'SAPWrite.generate_behavior_implementation': {
    scope: 'write',
    opType: OperationType.Update,
    featureGate: 'rap',
  },

  // ── SAPActivate ──────────────────────────────────────────────────
  SAPActivate: { scope: 'write', opType: OperationType.Activate },
  'SAPActivate.activate': { scope: 'write', opType: OperationType.Activate },
  'SAPActivate.publish_srvb': { scope: 'write', opType: OperationType.Activate },
  'SAPActivate.unpublish_srvb': { scope: 'write', opType: OperationType.Activate },

  // ── SAPNavigate ──────────────────────────────────────────────────
  SAPNavigate: { scope: 'read', opType: OperationType.Intelligence },
  'SAPNavigate.definition': { scope: 'read', opType: OperationType.Intelligence },
  'SAPNavigate.references': { scope: 'read', opType: OperationType.Intelligence },
  'SAPNavigate.completion': { scope: 'read', opType: OperationType.Intelligence },
  'SAPNavigate.hierarchy': { scope: 'read', opType: OperationType.Intelligence },

  // ── SAPLint ──────────────────────────────────────────────────────
  SAPLint: { scope: 'read', opType: OperationType.Intelligence },
  'SAPLint.lint': { scope: 'read', opType: OperationType.Intelligence },
  'SAPLint.lint_and_fix': { scope: 'read', opType: OperationType.Intelligence },
  'SAPLint.list_rules': { scope: 'read', opType: OperationType.Intelligence },
  'SAPLint.format': { scope: 'read', opType: OperationType.Intelligence },
  'SAPLint.get_formatter_settings': { scope: 'read', opType: OperationType.Intelligence },
  // CLASSIFICATION BUG FIX: set_formatter_settings mutates server-side settings
  'SAPLint.set_formatter_settings': { scope: 'write', opType: OperationType.Update },

  // ── SAPDiagnose ──────────────────────────────────────────────────
  SAPDiagnose: { scope: 'read', opType: OperationType.Read },
  'SAPDiagnose.syntax': { scope: 'read', opType: OperationType.Read },
  'SAPDiagnose.unittest': { scope: 'read', opType: OperationType.Test },
  'SAPDiagnose.atc': { scope: 'read', opType: OperationType.Read },
  'SAPDiagnose.dumps': { scope: 'read', opType: OperationType.Read },
  'SAPDiagnose.traces': { scope: 'read', opType: OperationType.Read },
  'SAPDiagnose.system_messages': { scope: 'read', opType: OperationType.Read },
  'SAPDiagnose.gateway_errors': { scope: 'read', opType: OperationType.Read },
  'SAPDiagnose.object_state': { scope: 'read', opType: OperationType.Read },
  'SAPDiagnose.quickfix': { scope: 'read', opType: OperationType.Read },
  'SAPDiagnose.apply_quickfix': { scope: 'read', opType: OperationType.Read },

  // ── SAPTransport ─────────────────────────────────────────────────
  // CLASSIFICATION BUG FIX: check/history/list/get are reads; previously required write
  SAPTransport: { scope: 'read', opType: OperationType.Read, featureGate: 'transport' },
  'SAPTransport.list': { scope: 'read', opType: OperationType.Read, featureGate: 'transport' },
  'SAPTransport.get': { scope: 'read', opType: OperationType.Read, featureGate: 'transport' },
  'SAPTransport.check': { scope: 'read', opType: OperationType.Read, featureGate: 'transport' },
  'SAPTransport.history': { scope: 'read', opType: OperationType.Read, featureGate: 'transport' },
  'SAPTransport.create': { scope: 'transports', opType: OperationType.Transport, featureGate: 'transport' },
  'SAPTransport.release': { scope: 'transports', opType: OperationType.Transport, featureGate: 'transport' },
  'SAPTransport.release_recursive': { scope: 'transports', opType: OperationType.Transport, featureGate: 'transport' },
  'SAPTransport.reassign': { scope: 'transports', opType: OperationType.Transport, featureGate: 'transport' },
  'SAPTransport.delete': { scope: 'transports', opType: OperationType.Transport, featureGate: 'transport' },

  // ── SAPGit ───────────────────────────────────────────────────────
  SAPGit: { scope: 'read', opType: OperationType.Read, featureGate: 'git' },
  'SAPGit.list_repos': { scope: 'read', opType: OperationType.Read, featureGate: 'git' },
  'SAPGit.whoami': { scope: 'read', opType: OperationType.Read, featureGate: 'git' },
  'SAPGit.config': { scope: 'read', opType: OperationType.Read, featureGate: 'git' },
  'SAPGit.branches': { scope: 'read', opType: OperationType.Read, featureGate: 'git' },
  'SAPGit.external_info': { scope: 'read', opType: OperationType.Read, featureGate: 'git' },
  'SAPGit.history': { scope: 'read', opType: OperationType.Read, featureGate: 'git' },
  'SAPGit.objects': { scope: 'read', opType: OperationType.Read, featureGate: 'git' },
  'SAPGit.check': { scope: 'read', opType: OperationType.Read, featureGate: 'git' },
  'SAPGit.stage': { scope: 'git', opType: OperationType.Update, featureGate: 'git' },
  'SAPGit.clone': { scope: 'git', opType: OperationType.Create, featureGate: 'git' },
  'SAPGit.pull': { scope: 'git', opType: OperationType.Update, featureGate: 'git' },
  'SAPGit.push': { scope: 'git', opType: OperationType.Update, featureGate: 'git' },
  'SAPGit.commit': { scope: 'git', opType: OperationType.Update, featureGate: 'git' },
  'SAPGit.switch_branch': { scope: 'git', opType: OperationType.Update, featureGate: 'git' },
  'SAPGit.create_branch': { scope: 'git', opType: OperationType.Create, featureGate: 'git' },
  'SAPGit.unlink': { scope: 'git', opType: OperationType.Delete, featureGate: 'git' },

  // ── SAPContext ───────────────────────────────────────────────────
  SAPContext: { scope: 'read', opType: OperationType.Intelligence },
  'SAPContext.deps': { scope: 'read', opType: OperationType.Intelligence },
  'SAPContext.usages': { scope: 'read', opType: OperationType.Intelligence },
  'SAPContext.impact': { scope: 'read', opType: OperationType.Intelligence },

  // ── SAPManage ────────────────────────────────────────────────────
  SAPManage: { scope: 'write', opType: OperationType.Update },
  'SAPManage.features': { scope: 'read', opType: OperationType.Read },
  'SAPManage.probe': { scope: 'read', opType: OperationType.Read },
  'SAPManage.cache_stats': { scope: 'read', opType: OperationType.Read },
  'SAPManage.create_package': { scope: 'write', opType: OperationType.Create },
  'SAPManage.delete_package': { scope: 'write', opType: OperationType.Delete },
  'SAPManage.change_package': { scope: 'write', opType: OperationType.Update },
  // CLASSIFICATION BUG FIX: flp_list_* are read operations; previously required write
  'SAPManage.flp_list_catalogs': { scope: 'read', opType: OperationType.Read, featureGate: 'flp' },
  'SAPManage.flp_list_groups': { scope: 'read', opType: OperationType.Read, featureGate: 'flp' },
  'SAPManage.flp_list_tiles': { scope: 'read', opType: OperationType.Read, featureGate: 'flp' },
  'SAPManage.flp_create_catalog': { scope: 'write', opType: OperationType.Workflow, featureGate: 'flp' },
  'SAPManage.flp_create_group': { scope: 'write', opType: OperationType.Workflow, featureGate: 'flp' },
  'SAPManage.flp_create_tile': { scope: 'write', opType: OperationType.Workflow, featureGate: 'flp' },
  'SAPManage.flp_add_tile_to_group': { scope: 'write', opType: OperationType.Workflow, featureGate: 'flp' },
  'SAPManage.flp_delete_catalog': { scope: 'write', opType: OperationType.Workflow, featureGate: 'flp' },

  // ── Hyperfocused SAP (single-tool mode) ──────────────────────────
  // Mirrors the action surface of the non-hyperfocused tools. Keys are SAP.<action>.
  // Most are identical to the per-tool entries above.
  SAP: { scope: 'read', opType: OperationType.Read },
  'SAP.read': { scope: 'read', opType: OperationType.Read },
  'SAP.search': { scope: 'read', opType: OperationType.Search },
  'SAP.query': { scope: 'sql', opType: OperationType.FreeSQL },
  'SAP.navigate': { scope: 'read', opType: OperationType.Intelligence },
  'SAP.context': { scope: 'read', opType: OperationType.Intelligence },
  'SAP.lint': { scope: 'read', opType: OperationType.Intelligence },
  'SAP.diagnose': { scope: 'read', opType: OperationType.Read },
  'SAP.write': { scope: 'write', opType: OperationType.Update },
  'SAP.activate': { scope: 'write', opType: OperationType.Activate },
  // Hyperfocused delegators are intentionally read-scoped at the top level.
  // The recursive real-tool call enforces the concrete sub-action policy
  // (for example SAPTransport.create => transports, SAPManage.create_package => write).
  'SAP.transport': { scope: 'read', opType: OperationType.Read, featureGate: 'transport' },
  'SAP.git': { scope: 'read', opType: OperationType.Read, featureGate: 'git' },
  'SAP.manage': { scope: 'read', opType: OperationType.Read },
};

/**
 * Look up the policy for a tool + optional action/type.
 * Falls back to tool-level default if the specific key is absent.
 */
export function getActionPolicy(tool: string, action?: string): ActionPolicy | undefined {
  if (action) {
    const specific = ACTION_POLICY[`${tool}.${action}`];
    if (specific) return specific;
  }
  return ACTION_POLICY[tool];
}

/** Return all keys in the policy matrix (used by validator + consistency tests). */
export function allPolicyKeys(): string[] {
  return Object.keys(ACTION_POLICY);
}

/**
 * Expand implicit scopes.
 * - `admin` implies all other scopes.
 * - `write` implies `read`.
 * - `sql` implies `data`.
 * Returns a sorted deduplicated list.
 */
export function expandScopes(scopes: string[]): string[] {
  const expanded = new Set<string>(scopes);
  if (expanded.has('admin')) {
    expanded.add('read');
    expanded.add('write');
    expanded.add('data');
    expanded.add('sql');
    expanded.add('transports');
    expanded.add('git');
  }
  if (expanded.has('write')) expanded.add('read');
  if (expanded.has('sql')) expanded.add('data');
  return [...expanded].sort();
}

/**
 * Check whether a user's scopes satisfy the required scope, applying implications.
 * Returns true when:
 *   - The user has the exact required scope, OR
 *   - The user has `admin` (implies all), OR
 *   - required=`read` and the user has `write` OR any other scope that implies read, OR
 *   - required=`data` and the user has `sql`.
 */
export function hasRequiredScope(scopes: string[], required: Scope): boolean {
  const expanded = new Set(expandScopes(scopes));
  return expanded.has(required);
}
