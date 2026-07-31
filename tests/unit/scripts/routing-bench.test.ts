/**
 * The routing bench's load-bearing guard: a generated prompt that names the tool or the literal
 * enum value tests string matching, not routing — and every case that slips through inflates the
 * score of whatever description is being judged. Test the filter, not the LLM.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildCliArgs,
  CASES_PATH,
  enumTargets,
  FULL_CONFIG,
  leaks,
  sanitizedEnv,
} from '../../../scripts/routing-bench.js';
import { getToolDefinitions, type ToolDefinition } from '../../../src/handlers/tools.js';

describe('leaks', () => {
  it('rejects a prompt naming the tool', () => {
    expect(leaks('Use SAPTransport to release my request', 'SAPTransport', 'release')).toBe(true);
    expect(leaks('use saptransport here', 'SAPTransport')).toBe(true);
  });

  it('rejects technical identifiers, which never occur in natural phrasing', () => {
    expect(leaks('run edit_method on ZCL_ORDER', 'SAPWrite', 'edit_method')).toBe(true);
    expect(leaks('Read DOMA BUKRS', 'SAPRead', 'DOMA')).toBe(true);
  });

  it('rejects schema-shaped mentions of an ordinary word', () => {
    expect(leaks('Call it with action=release for A4HK900123', 'SAPTransport', 'release')).toBe(true);
    expect(leaks('use action: format on this code', 'SAPLint', 'format')).toBe(true);
    expect(leaks('run the "activate" step on ZHELLO', 'SAPActivate', 'activate')).toBe(true);
  });

  it('accepts natural developer phrasing that happens to use the word', () => {
    // The first filter rejected these, which threw away coverage for every value that is an
    // ordinary English verb — activate, format, syntax — i.e. exactly the common paths.
    expect(leaks('Format this ABAP code properly', 'SAPLint', 'format')).toBe(false);
    expect(leaks('Activate ZHELLO for me', 'SAPActivate', 'activate')).toBe(false);
    expect(leaks('Check the syntax of ZCL_ORDER', 'SAPDiagnose', 'syntax')).toBe(false);
    expect(leaks('Ship transport A4HK900123 to QA', 'SAPTransport', 'release')).toBe(false);
  });

  it('does not false-positive a type code on an ordinary word containing it', () => {
    expect(leaks('Show me the domain behind field BUKRS', 'SAPRead', 'DOMA')).toBe(false);
    expect(leaks('What columns does the table T001 have', 'SAPRead', 'TABL')).toBe(false);
  });
});

describe('enumTargets', () => {
  const tools = getToolDefinitions(FULL_CONFIG) as ToolDefinition[];
  const targets = enumTargets(tools);

  it('emits one target per enum value across action and type', () => {
    const read = targets.filter((t) => t.tool.name === 'SAPRead');
    const sapRead = tools.find((t) => t.name === 'SAPRead');
    expect(sapRead).toBeDefined();
    const props = (sapRead as ToolDefinition).inputSchema as {
      properties: Record<string, { enum?: unknown[] }>;
    };
    expect(read).toHaveLength(props.properties.type.enum?.length ?? 0);
  });

  it('covers every tool, including ones with no enum discriminator', () => {
    expect(new Set(targets.map((t) => t.tool.name)).size).toBe(tools.length);
    expect(targets.filter((t) => t.tool.name === 'SAPQuery')).toHaveLength(1);
  });

  it('ignores single-value enums that carry no routing weight', () => {
    // SAPRead.action has one value and is never passed explicitly; counting it would read as 0/1.
    expect(targets.some((t) => t.tool.name === 'SAPRead' && t.key === 'action')).toBe(false);
  });
});

/**
 * Coverage parity. Generation skips a case it cannot produce a leak-free prompt for and still exits
 * 0, so the corpus silently drifts below the target list — it shipped missing SAPRead.type.VARIANTS
 * without anything failing. The benchmark's whole claim is "every discriminator value", so assert it.
 */
describe('corpus coverage', () => {
  const tools = getToolDefinitions(FULL_CONFIG) as ToolDefinition[];
  const expected = new Set(enumTargets(tools).map((t) => (t.key ? `${t.tool.name}.${t.key}.${t.value}` : t.tool.name)));
  const cases = JSON.parse(readFileSync(CASES_PATH, 'utf8')) as Array<{ id: string; quarantined?: string }>;

  it('has a record for every enum target, with none left over', () => {
    const actual = new Set(cases.map((c) => c.id));
    expect([...expected].filter((id) => !actual.has(id))).toEqual([]);
    expect([...actual].filter((id) => !expected.has(id))).toEqual([]);
  });

  it('SCORES every target — quarantined records do not count as coverage', () => {
    // Parity on raw records would stay green while a quarantined case contributes nothing, letting
    // a candidate delete guidance for it unnoticed. Coverage means SCORED coverage.
    const active = new Set(cases.filter((c) => !c.quarantined).map((c) => c.id));
    const uncovered = [...expected].filter((id) => !active.has(id));
    expect(uncovered, `${uncovered.length} target(s) have no scored case`).toEqual([]);
  });

  it('states a reason for every quarantined case', () => {
    for (const c of cases.filter((x) => x.quarantined)) {
      expect(c.quarantined!.length, `${c.id} needs a reason`).toBeGreaterThan(15);
    }
  });
});

/**
 * The CLI invocation is a safety boundary, not a convenience: the corpus contains "Delete the
 * ZCL_PAYMENT_VALIDATOR class from the system", release, push and unlink prompts, and an earlier
 * version ran them with the user's plugins, hooks and SAP-connected MCP servers live. Pin the flags
 * and the environment scrub so neither can regress silently.
 */
describe('claude CLI isolation', () => {
  const args = buildCliArgs('claude-haiku-4-5-20251001');

  it('disables every customization surface that can execute', () => {
    // A built-in denylist is not enough — hooks run outside tool permissions.
    for (const flag of ['--safe-mode', '--disable-slash-commands', '--no-session-persistence', '--strict-mcp-config']) {
      expect(args, `${flag} missing`).toContain(flag);
    }
    expect(args[args.indexOf('--mcp-config') + 1]).toBe('{"mcpServers":{}}');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('plan');
    expect(args).toContain('--tools');
    expect(args[args.indexOf('--tools') + 1]).toBe('');
  });

  it('never passes the prompt as an argument', () => {
    // --tools and --disallowedTools are variadic; a trailing prompt gets eaten as a tool name.
    expect(args.some((a) => a.length > 200)).toBe(false);
  });

  it('passes an allowlist, so secrets it has never heard of cannot leak', () => {
    // A prefix denylist has to know every secret in advance; it previously left VCAP_SERVICES,
    // GITHUB_TOKEN, AWS_* and NPL_* untouched.
    const env = sanitizedEnv({
      PATH: '/usr/bin',
      HOME: '/home/x',
      SAP_PASSWORD: 'secret',
      ARC1_API_KEYS: 'k:admin',
      VCAP_SERVICES: '{"xsuaa":[…]}',
      TEST_BTP_ACCESS_TOKEN: 'tok',
      NPL_PASSWORD: 'p',
      GITHUB_TOKEN: 'ghp_x',
      AWS_SECRET_ACCESS_KEY: 'aws',
      SOME_FUTURE_SECRET: 'x',
    });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/x');
    for (const k of [
      'SAP_PASSWORD',
      'ARC1_API_KEYS',
      'VCAP_SERVICES',
      'TEST_BTP_ACCESS_TOKEN',
      'NPL_PASSWORD',
      'GITHUB_TOKEN',
      'AWS_SECRET_ACCESS_KEY',
      'SOME_FUTURE_SECRET',
    ]) {
      expect(env[k], `${k} leaked to child`).toBeUndefined();
    }
  });
});

/**
 * The oracle checked a single discriminator, so on SAPWrite — where destructive and constructive
 * actions share one schema — "Create a global class ZCL_PAYMENT_GATEWAY" scored a PASS for
 * {action:"delete", type:"CLAS"}. Every behaviour-selecting argument the prompt fixes must be
 * pinned, or the benchmark rewards the opposite of what was asked.
 */
describe('multi-field expectations', () => {
  const cases = JSON.parse(readFileSync(CASES_PATH, 'utf8')) as Array<{
    id: string;
    tool: string;
    key?: string;
    prompt: string;
    expectedArgs?: Record<string, string>;
  }>;

  it('pins the implied action on every SAPWrite type case', () => {
    const unpinned = cases
      .filter((c) => c.tool === 'SAPWrite' && c.key === 'type' && !c.expectedArgs?.action)
      .map((c) => c.id);
    expect(unpinned, `${unpinned.length} SAPWrite type case(s) do not pin an action`).toEqual([]);
  });

  it('never pins an action that contradicts the prompt verb', () => {
    for (const c of cases.filter((x) => x.expectedArgs?.action === 'delete')) {
      expect(/\b(delete|remove|drop)\b/i.test(c.prompt), `${c.id}: pinned delete but prompt is not destructive`).toBe(
        true,
      );
    }
    for (const c of cases.filter((x) => x.expectedArgs?.action === 'create')) {
      expect(/\b(delete|remove|drop)\b/i.test(c.prompt), `${c.id}: pinned create but prompt reads destructive`).toBe(
        false,
      );
    }
  });
});
