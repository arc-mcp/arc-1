/**
 * Invariant: the UNPROBED tool surface is a superset of every probed one.
 *
 * tools/list answers immediately, before startup feature discovery finishes (clients cancel it on
 * their own schedule — Cline at ~5s — and a probe against a real SAP system can outlast that). So
 * the surface built with `resolvedFeatures === undefined` is what every stdio client sees FIRST,
 * and on clients that ignore tools/list_changed it is all they ever see.
 *
 * Therefore discovery may only ever NARROW the surface. If it can also add, the unprobed answer is
 * missing something and that capability is unreachable for the whole session — which is exactly how
 * SAPGit went missing: the visibility rule existed twice and only the hyperfocused copy handled
 * `undefined`. Both now share isGitToolVisible().
 */
import { describe, expect, it } from 'vitest';
import { getToolDefinitions } from '../../../src/handlers/tools.js';
import { btp, FULL, features, onprem } from './handler-test-config.js';

/** Tool names plus every enum value, so a shrunken action list fails too — not just a dropped tool. */
function surface(tools: ReturnType<typeof getToolDefinitions>): Set<string> {
  const out = new Set<string>();
  for (const tool of tools) {
    out.add(tool.name);
    const props = (tool.inputSchema as { properties?: Record<string, { enum?: string[] }> }).properties ?? {};
    for (const [prop, schema] of Object.entries(props)) {
      for (const value of schema.enum ?? []) out.add(`${tool.name}.${prop}=${value}`);
    }
  }
  return out;
}

const CONFIGS = [
  ['onprem', onprem(FULL)],
  ['btp', btp(FULL)],
  ['onprem-readonly', onprem()],
  ['onprem-hyperfocused', onprem({ ...FULL, toolMode: 'hyperfocused' })],
  ['btp-hyperfocused', btp({ ...FULL, toolMode: 'hyperfocused' })],
] as const;

// Every way discovery can come back, including the ones that used to ADD a tool.
const PROBED = [
  ['all available', true, features()],
  ['text search off', false, features()],
  ['git off', true, features({ gcts: false, abapGit: false })],
  ['nothing available', false, features({}, false)],
] as const;

describe('unprobed tool surface is a superset', () => {
  it.each(CONFIGS)('%s', (_label, config) => {
    const unprobed = surface(getToolDefinitions(config, undefined, undefined));
    for (const [probeLabel, textSearch, resolved] of PROBED) {
      const missing = [...surface(getToolDefinitions(config, textSearch, resolved))].filter((e) => !unprobed.has(e));
      expect(missing, `discovery "${probeLabel}" adds entries absent before it finished`).toEqual([]);
    }
  });

  // Stronger than the superset check, and it ties the pre-discovery surface to an existing frozen
  // snapshot: the unprobed answer IS the everything-available surface, already byte-pinned by
  // tests/fixtures/tool-definitions/{onprem,btp}-full-textsearch-on.json. So no separate fixture is
  // needed for what stdio clients see first — those two already are it.
  it.each(CONFIGS)('%s unprobed surface equals the all-available surface', (_label, config) => {
    expect(getToolDefinitions(config, undefined, undefined)).toEqual(getToolDefinitions(config, true, features()));
  });

  it('keeps SAPGit visible before discovery, and hides it only once probed unavailable', () => {
    const config = onprem(FULL);
    const names = (textSearch?: boolean, resolved?: ReturnType<typeof features>) =>
      getToolDefinitions(config, textSearch, resolved).map((t) => t.name);

    expect(names(undefined, undefined)).toContain('SAPGit');
    expect(names(true, features())).toContain('SAPGit');
    expect(names(true, features({ gcts: false, abapGit: false }))).not.toContain('SAPGit');
  });

  it('honours an explicit git opt-out even before discovery', () => {
    const config = onprem({ ...FULL, featureAbapGit: 'off', featureGcts: 'off' });
    expect(getToolDefinitions(config, undefined, undefined).map((t) => t.name)).not.toContain('SAPGit');
  });
});
