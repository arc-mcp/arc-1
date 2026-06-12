/**
 * Guards the MCP read-only / destructive annotations emitted by getToolDefinitions().
 *
 * The expected values are DERIVED from ACTION_POLICY (the authz source of truth), not mirrored
 * from TOOL_ANNOTATIONS — so a hand-edited annotation that disagrees with what a tool actually
 * does (e.g. marking SAPLint read-only when set_formatter_settings mutates ADT settings, or
 * SAPWrite non-destructive when action=delete removes objects) fails loudly. Clients consume
 * these hints to auto-approve read-only tools, so a wrong hint is a real safety bug.
 */

import { describe, expect, it } from 'vitest';
import { OperationType } from '../../../src/adt/safety.js';
import { ACTION_POLICY } from '../../../src/authz/policy.js';
import { getToolDefinitions } from '../../../src/handlers/tools.js';
import { FULL, features, onprem } from './handler-test-config.js';

// Operation types that change SAP/server state — mirrors MUTATING_OPS ('CDUAWX') in safety.ts.
const MUTATING = new Set<string>([
  OperationType.Create,
  OperationType.Update,
  OperationType.Delete,
  OperationType.Activate,
  OperationType.Workflow,
  OperationType.Transport,
]);

/** ACTION_POLICY entries for a tool: the bare `Tool` key plus every `Tool.action`. */
function policyEntriesFor(tool: string): Array<{ key: string; opType: string }> {
  return Object.entries(ACTION_POLICY)
    .filter(([key]) => key === tool || key.startsWith(`${tool}.`))
    .map(([key, p]) => ({ key, opType: p.opType }));
}

function hasDeleteAction(tool: string): boolean {
  // Delete opType (D), OR a `.delete` action whose opType is the Transport category (X),
  // e.g. SAPTransport.delete removes a transport request.
  return policyEntriesFor(tool).some((e) => e.opType === OperationType.Delete || e.key.endsWith('.delete'));
}

/** Ground truth for the annotation a tool should carry, derived from ACTION_POLICY. */
function expectedAnnotations(tool: string): { readOnlyHint: boolean; destructiveHint?: boolean } {
  const entries = policyEntriesFor(tool);
  if (entries.every((e) => !MUTATING.has(e.opType))) return { readOnlyHint: true };
  return { readOnlyHint: false, destructiveHint: hasDeleteAction(tool) };
}

describe('tool annotations (derived from ACTION_POLICY)', () => {
  const tools = getToolDefinitions(onprem({ ...FULL, allowedPackages: ['Z*'] }), true, features());

  for (const tool of tools) {
    it(`${tool.name} matches the read-only / destructive truth in ACTION_POLICY`, () => {
      expect(tool.annotations).toEqual(expectedAnnotations(tool.name));
    });
  }

  it('marks SAPLint as a writer (set_formatter_settings mutates ADT settings)', () => {
    // explicit regression guard for the classification bug a read action set was masking.
    expect(tools.find((t) => t.name === 'SAPLint')?.annotations?.readOnlyHint).toBe(false);
  });

  it('marks every tool that can delete as destructive', () => {
    for (const t of tools) {
      if (hasDeleteAction(t.name)) expect(t.annotations?.destructiveHint, t.name).toBe(true);
    }
  });

  it('leaves the hyperfocused universal tool unannotated (it can read and write)', () => {
    const hf = getToolDefinitions(onprem({ ...FULL, toolMode: 'hyperfocused' }), true, features());
    expect(hf).toHaveLength(1);
    expect(hf[0].annotations).toBeUndefined();
  });
});
