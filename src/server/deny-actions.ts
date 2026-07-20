/**
 * SAP_DENY_ACTIONS parser and validator.
 *
 * Admin-facing replacement for the removed op-code blocklist env vars.
 * Grammar is **tool-qualified only**: `Tool`, `Tool.action`, or `Tool.glob*`.
 * Cross-tool wildcards (e.g. `*.delete`) are intentionally rejected — forces
 * admins to be explicit about which tool they're blocking.
 *
 * Source: the env var / CLI value can be either:
 *   - A path (starts with `/`, `./`, `~/`, `../`, or a Windows drive letter like `C:\`) →
 *     JSON array of strings from file
 *   - An inline comma-separated list
 *
 * Fails fast: any read error, JSON error, grammar violation, or unknown tool/action
 * aborts startup with a specific error message.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve as resolvePath } from 'node:path';

import { ACTION_POLICY } from '../authz/policy.js';

const PATH_PREFIXES = ['/', './', '~/', '../'] as const;
// Windows drive-letter absolute path (e.g. C:\deny.json or C:/deny.json). Detected by a fixed
// regex rather than path.isAbsolute(), which is platform-dependent (posix rules don't recognize
// drive letters, so it would only detect this on a Windows-hosted server).
const WINDOWS_ABSOLUTE_PATH_RE = /^[a-zA-Z]:[\\/]/;

function isPathLike(value: string): boolean {
  return WINDOWS_ABSOLUTE_PATH_RE.test(value) || PATH_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function expandTilde(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return resolvePath(homedir(), p.slice(2));
  return p;
}

/**
 * Parse the raw SAP_DENY_ACTIONS value into a list of pattern strings.
 * Auto-detects path vs inline.
 */
export function parseDenyActions(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (isPathLike(trimmed)) {
    const path = expandTilde(trimmed);
    let contents: string;
    try {
      contents = readFileSync(path, 'utf8');
    } catch (err) {
      throw new Error(`SAP_DENY_ACTIONS: cannot read file '${path}': ${(err as Error).message}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch (err) {
      throw new Error(`SAP_DENY_ACTIONS: invalid JSON in '${path}': ${(err as Error).message}`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`SAP_DENY_ACTIONS: file '${path}' must contain a JSON array of strings`);
    }
    return parsed
      .map((entry, i) => {
        if (typeof entry !== 'string') {
          throw new Error(`SAP_DENY_ACTIONS: entry at index ${i} in '${path}' must be a string`);
        }
        return entry.trim();
      })
      .filter((entry) => entry.length > 0);
  }

  return trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Pattern grammar: Tool | Tool.action | Tool.glob* (glob allowed in action part; leading `*` or `_` ok). */
const PATTERN_RE = /^[A-Z][A-Za-z]+(?:\.(?:\*|[A-Za-z_][A-Za-z0-9_]*\*?))?$/;
const CROSS_TOOL_WILDCARD_RE = /^\*/;

/**
 * Validate each pattern against the grammar and against ACTION_POLICY.
 * Throws with a specific error for any violation. No silent skipping.
 */
export function validateDenyActions(patterns: string[]): void {
  for (const pattern of patterns) {
    if (CROSS_TOOL_WILDCARD_RE.test(pattern)) {
      throw new Error(
        `SAP_DENY_ACTIONS: cross-tool wildcards are not supported ('${pattern}'). ` +
          `Use tool-qualified patterns: 'Tool', 'Tool.action', or 'Tool.glob*'.`,
      );
    }
    if (!PATTERN_RE.test(pattern)) {
      throw new Error(
        `SAP_DENY_ACTIONS: invalid pattern '${pattern}'. ` +
          `Valid forms: 'Tool' (e.g., SAPWrite), 'Tool.action' (e.g., SAPWrite.delete), ` +
          `or 'Tool.glob*' (e.g., SAPManage.flp_*).`,
      );
    }

    const [tool, action] = pattern.split('.');

    // Check tool exists in ACTION_POLICY (either at tool level or any Tool.* key)
    const knownTools = new Set<string>();
    for (const key of Object.keys(ACTION_POLICY)) {
      knownTools.add(key.split('.')[0]);
    }
    if (!knownTools.has(tool)) {
      throw new Error(
        `SAP_DENY_ACTIONS: unknown tool '${tool}' in pattern '${pattern}'. ` +
          `Valid tools: ${[...knownTools].sort().join(', ')}.`,
      );
    }

    if (!action) continue; // tool-level pattern is always valid if tool exists

    // Action (or glob) must match at least one real ACTION_POLICY entry under this tool.
    const toolActions: string[] = [];
    for (const key of Object.keys(ACTION_POLICY)) {
      if (key.startsWith(`${tool}.`)) toolActions.push(key.slice(tool.length + 1));
    }
    const regex = globToRegex(action);
    const matches = toolActions.filter((a) => regex.test(a));
    if (matches.length === 0) {
      throw new Error(
        `SAP_DENY_ACTIONS: pattern '${pattern}' matches no actions. ` +
          `Valid actions for ${tool}: ${toolActions.sort().join(', ') || '(none — tool-level only)'}.`,
      );
    }
  }
}

function globToRegex(glob: string): RegExp {
  // Only `*` supported; matches `.*` (any chars including dots)
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/**
 * Check whether a given (tool, action) is covered by any of the deny patterns.
 * Empty patterns list → never denied.
 */
export function isActionDenied(tool: string, action: string | undefined, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const fullKey = action ? `${tool}.${action}` : tool;

  for (const pattern of patterns) {
    // Tool-level pattern denies everything for that tool
    if (pattern === tool) return true;

    const [patternTool, patternAction] = pattern.split('.');
    if (patternTool !== tool) continue;

    if (!action) {
      // No specific action requested, but we're checking tool-level. Pattern has an action → doesn't match.
      continue;
    }

    const regex = globToRegex(patternAction);
    if (regex.test(action)) return true;
    // Also match against the full "Tool.action" form for completeness (identity check)
    if (patternAction === action) return true;
    // Glob match already handled above via regex. Log-level skip if there's a mismatch.
    if (`${tool}.${action}` === pattern) return true;

    // Fallback: check full fullKey against pattern as regex
    const fullRegex = globToRegex(pattern);
    if (fullRegex.test(fullKey)) return true;
  }
  return false;
}
