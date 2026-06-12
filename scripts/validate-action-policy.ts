#!/usr/bin/env tsx
/**
 * validate-action-policy.ts — CI validator for the ACTION_POLICY matrix.
 *
 * Ensures that every action/type declared in src/handlers/schemas.ts has a
 * matching entry in src/authz/policy.ts (and vice versa). Fails with a clear
 * diff report if the two ever drift.
 *
 * Run via:   npm run validate:policy
 * Runs in CI as part of test workflow.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { ACTION_POLICY, allPolicyKeys } from '../src/authz/policy.js';
import { OperationType, type OperationTypeCode } from '../src/adt/safety.js';
import { SAPREAD_TYPES_ONPREM } from '../src/handlers/tool-registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_PATH = resolve(__dirname, '..', 'src', 'handlers', 'schemas.ts');

/**
 * Extract every action enum from schemas.ts using a simple regex scan.
 * Returns a map of tool → actions[], plus SAPRead TYPES (on-prem superset).
 */
function extractToolActions(source: string): { tool: string; actions: string[] }[] {
  const results: { tool: string; actions: string[] }[] = [];

  // Match exports like:  export const SAPReadSchema = z.object({  ...  action: z.enum(['a', 'b', ...]),  ...  })
  //                  or: export const SAPTransportSchema = z.object({  action: z.enum([...]) })
  // Tools without an action enum (SAPSearch, SAPQuery) still produce an entry with empty actions
  // so that the tool itself is considered "known" for ACTION_POLICY tool-level checks.
  // SAPRead uses `type: z.enum(SAPREAD_TYPES_ONPREM)` — handled via its own regex below.
  const schemaBlockRe = /export const (SAP\w+)Schema(?:Btp)?\s*=\s*z[\s\S]*?\}\)/g;
  let m: RegExpExecArray | null;
  const seenTools = new Set<string>();
  while ((m = schemaBlockRe.exec(source)) !== null) {
    const tool = m[1];
    // Skip the Hyperfocused schema (key is "SAPHyperfocused" → we treat "SAP" as the canonical tool)
    if (tool === 'SAPHyperfocused') continue;
    if (seenTools.has(tool)) continue; // handle Schema + SchemaBtp pairs
    seenTools.add(tool);
    const block = m[0];
    const actionEnumMatch = block.match(/action:\s*z\.enum\(\[([^\]]+)\]\)/);
    if (actionEnumMatch) {
      const actions = [...actionEnumMatch[1].matchAll(/'([^']+)'/g)].map((a) => a[1]);
      results.push({ tool, actions });
    } else {
      // Tool has no action enum (e.g., SAPSearch, SAPQuery) — tool-level policy only.
      results.push({ tool, actions: [] });
    }
  }

  // SAPRead types now live in tool-registry.ts (single source of truth) — import them directly
  // instead of regex-scanning schemas.ts, which no longer declares them inline.
  results.push({ tool: 'SAPRead', actions: [...SAPREAD_TYPES_ONPREM] });

  return results;
}

function main(): number {
  const source = readFileSync(SCHEMAS_PATH, 'utf8');
  const toolActions = extractToolActions(source);

  const errors: string[] = [];

  // ── Pass 1: every (tool, action) in schemas must be covered by ACTION_POLICY
  const coveredKeys = new Set<string>();
  for (const { tool, actions } of toolActions) {
    // Tool-level key is OK as a fallback
    const toolLevel = ACTION_POLICY[tool];
    for (const action of actions) {
      const specificKey = `${tool}.${action}`;
      coveredKeys.add(specificKey);
      coveredKeys.add(tool);
      const specific = ACTION_POLICY[specificKey];
      if (!specific && !toolLevel) {
        errors.push(`Missing in ACTION_POLICY: ${specificKey} (neither specific nor tool-level key)`);
      }
    }
  }

  // ── Pass 2: every ACTION_POLICY key corresponds to a real action/tool (or is SAP.* hyperfocused)
  const knownTools = new Set(toolActions.map((t) => t.tool));
  knownTools.add('SAP'); // hyperfocused tool alias — not in schemas.ts as SAPSchema but valid
  for (const key of allPolicyKeys()) {
    const [tool, action] = key.split('.');
    if (!knownTools.has(tool)) {
      errors.push(`Dead entry in ACTION_POLICY: ${key} (unknown tool '${tool}')`);
      continue;
    }
    if (action) {
      // Tool-specific action — must appear in that tool's action enum
      if (tool === 'SAP') {
        // Hyperfocused aliases — manually validated via the policy.test.ts keys
        continue;
      }
      // Merge all entries for this tool — a single tool may have both an action enum
      // (e.g., SAPWrite) and a type enum (e.g., SAPRead's TYPES). Both count as valid actions.
      const allActions = toolActions.filter((t) => t.tool === tool).flatMap((t) => t.actions);
      if (allActions.length > 0 && !allActions.includes(action)) {
        errors.push(
          `Dead entry in ACTION_POLICY: ${key} — action '${action}' not in ${tool}'s schema enum (${allActions.join(', ')})`,
        );
      }
    }
  }

  // ── Pass 3: opType↔scope consistency. The existence check above is satisfied by a
  // too-low tool-level fallback (e.g. a state-changing action added to a read-default
  // tool with no specific entry). This pass asserts that a mutating opType maps to a
  // write-family scope, a Query opType to data+, and a FreeSQL opType to sql+ — turning
  // a future under-scoped action into a CI error rather than a silent privilege gap.
  // (security audit 2026-06)
  const MUTATING_OPTYPES = new Set<OperationTypeCode>([
    OperationType.Create,
    OperationType.Update,
    OperationType.Delete,
    OperationType.Activate,
    OperationType.Workflow,
    OperationType.Transport,
  ]);
  const WRITE_FAMILY_SCOPES = new Set(['write', 'transports', 'git', 'admin']);
  for (const key of allPolicyKeys()) {
    const { opType, scope } = ACTION_POLICY[key];
    if (MUTATING_OPTYPES.has(opType) && !WRITE_FAMILY_SCOPES.has(scope)) {
      errors.push(
        `Scope too low for ${key}: opType '${opType}' is mutating but scope is '${scope}' (expected one of write/transports/git/admin)`,
      );
    } else if (opType === OperationType.Query && !['data', 'sql', 'admin'].includes(scope)) {
      errors.push(`Scope too low for ${key}: opType '${opType}' (Query) requires data/sql/admin but scope is '${scope}'`);
    } else if (opType === OperationType.FreeSQL && !['sql', 'admin'].includes(scope)) {
      errors.push(`Scope too low for ${key}: opType '${opType}' (FreeSQL) requires sql/admin but scope is '${scope}'`);
    }
  }

  if (errors.length > 0) {
    console.error('ACTION_POLICY validation failed:');
    for (const err of errors) console.error(`  - ${err}`);
    console.error(`\n${errors.length} issue(s) found. Update src/authz/policy.ts to match src/handlers/schemas.ts.`);
    return 1;
  }

  console.log(`✓ ACTION_POLICY validation passed: ${allPolicyKeys().length} policy entries cover ${toolActions.length} tool schemas.`);
  return 0;
}

process.exit(main());
