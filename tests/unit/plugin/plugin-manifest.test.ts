/**
 * Guards for the Claude Code plugin + marketplace manifests.
 *
 * The repo root doubles as a single-plugin Claude Code marketplace: `.claude-plugin/plugin.json`
 * declares the ARC-1 MCP server inline and `.claude-plugin/marketplace.json` lists this repo
 * (source "./") so users can `/plugin marketplace add arc-mcp/arc-1` →
 * `/plugin install arc-1@arc-1`. The plugin's skills are the existing root `skills/` directory,
 * which Claude Code always auto-scans for a plugin.
 *
 * These tests make the wiring true by construction:
 * - manifests are valid JSON and self-consistent (names/source match the layout)
 * - the bundled MCP server stays `npx arc-1` with the SAP user_config env mapping
 * - every shipped skill has plugin-legal frontmatter (the rules Anthropic enforces)
 * - the plugin version stays in lockstep with package.json / mcpb / server.json (release-please
 *   manages all four; a manual edit that drifts one is caught here)
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function readJson(rel: string): Record<string, any> {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

const plugin = readJson('.claude-plugin/plugin.json');
const marketplace = readJson('.claude-plugin/marketplace.json');

describe('plugin.json', () => {
  it('identifies the plugin as arc-1 with a synced version', () => {
    expect(plugin.name).toBe('arc-1');
    expect(typeof plugin.version).toBe('string');
  });

  it('declares the ARC-1 MCP server inline as npx arc-1', () => {
    const server = plugin.mcpServers?.['arc-1'];
    expect(server).toBeTruthy();
    expect(server.command).toBe('npx');
    expect(server.args).toContain('arc-1');
  });

  it('maps SAP credentials from userConfig into the server env', () => {
    // password must be sensitive (keychain), url/user/password required.
    for (const key of ['sap_url', 'sap_user', 'sap_password']) {
      expect(plugin.userConfig?.[key]?.required, key).toBe(true);
    }
    expect(plugin.userConfig.sap_password.sensitive).toBe(true);
    // env values are user_config substitutions (asserted without the ${} literal to keep lint quiet).
    expect(plugin.mcpServers['arc-1'].env.SAP_URL).toContain('user_config.sap_url');
    expect(plugin.mcpServers['arc-1'].env.SAP_PASSWORD).toContain('user_config.sap_password');
  });
});

describe('marketplace.json', () => {
  it('is a single-plugin catalog pointing at the repo root', () => {
    expect(marketplace.name).toBe('arc-1');
    expect(marketplace.owner?.name).toBeTruthy();
    expect(Array.isArray(marketplace.plugins)).toBe(true);
    expect(marketplace.plugins).toHaveLength(1);
  });

  it('references this repo as the plugin source', () => {
    const entry = marketplace.plugins[0];
    expect(entry.name).toBe(plugin.name);
    // "./" resolves to the marketplace root (= repo root = the plugin); must start with "./".
    expect(entry.source).toBe('./');
  });
});

describe('mcpb-manifest.json (Claude Desktop bundle)', () => {
  const mcpb = readJson('mcpb-manifest.json');
  const STANDARD_TOOLS = [
    'SAPRead',
    'SAPSearch',
    'SAPWrite',
    'SAPActivate',
    'SAPNavigate',
    'SAPQuery',
    'SAPTransport',
    'SAPGit',
    'SAPContext',
    'SAPLint',
    'SAPDiagnose',
    'SAPManage',
  ];

  it('lists all 12 intent tools (incl. SAPGit) with no duplicates', () => {
    const names = mcpb.tools.map((t: { name: string }) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of STANDARD_TOOLS) expect(names).toContain(t);
    expect(mcpb.tools).toHaveLength(STANDARD_TOOLS.length);
  });

  it('references the bundled icon and states the tool count', () => {
    expect(mcpb.icon).toBe('icon.png');
    expect(mcpb.long_description).toContain('12 intent-based tools');
  });
});

describe('config surface parity (plugin ↔ mcpb)', () => {
  const mcpb = readJson('mcpb-manifest.json');
  // Every env var exposed by the packaged config surfaces must be wired in BOTH surfaces.
  const ENV_KEYS = [
    'SAP_URL',
    'SAP_USER',
    'SAP_PASSWORD',
    'SAP_CLIENT',
    'SAP_LANGUAGE',
    'SAP_INSECURE',
    'SAP_ALLOW_WRITES',
    'SAP_ALLOWED_PACKAGES',
    'SAP_ALLOW_DATA_PREVIEW',
    'SAP_ALLOW_FREE_SQL',
    'SAP_ALLOW_TRANSPORT_WRITES',
    'SAP_ALLOW_GIT_WRITES',
    'ARC1_UI',
    'ARC1_UI_OPEN',
    'ARC1_UI_ADDR',
  ];

  const surfaces: Record<string, { env: Record<string, string>; cfg: Record<string, Record<string, unknown>> }> = {
    plugin: { env: plugin.mcpServers['arc-1'].env, cfg: plugin.userConfig },
    mcpb: { env: mcpb.server.mcp_config.env, cfg: mcpb.user_config },
  };

  for (const [name, { env, cfg }] of Object.entries(surfaces)) {
    it(`${name} wires every packaged env var to an existing user_config key`, () => {
      expect(Object.keys(env).sort()).toEqual([...ENV_KEYS].sort());
      for (const [key, value] of Object.entries(env)) {
        // Each value must be EXACTLY a ${user_config.<key>} substitution (anchored) — a typo like
        // ${userconfig.x} or a stray literal fails here instead of silently shipping a broken value.
        const m = /^\$\{user_config\.([a-z0-9_]+)\}$/.exec(value);
        expect(m, `${name}.${key} = ${value}`).not.toBeNull();
        expect(cfg, `${name} → ${m?.[1]}`).toHaveProperty(m?.[1] as string);
      }
    });
  }

  it('plugin and mcpb declare identical user-config field bodies', () => {
    const keys = Object.keys(plugin.userConfig).sort();
    expect(keys).toEqual(Object.keys(mcpb.user_config).sort());
    // Pin the security-relevant + user-facing fields so Desktop and Claude Code can't diverge
    // (a different default/sensitive/type/description between the two surfaces is a real bug).
    for (const key of keys) {
      const p = plugin.userConfig[key];
      const m = mcpb.user_config[key];
      for (const field of ['type', 'title', 'description', 'default', 'sensitive'] as const) {
        expect(m[field], `mcpb.${key}.${field} vs plugin`).toEqual(p[field]);
      }
    }
  });

  it('keeps the experimental UI disabled by default in packaged installs', () => {
    for (const [name, { cfg }] of Object.entries(surfaces)) {
      expect(cfg.arc1_ui?.default, `${name}.arc1_ui.default`).toBe(false);
      expect(cfg.arc1_ui_open?.default, `${name}.arc1_ui_open.default`).toBe(false);
      expect(cfg.arc1_ui_addr?.default, `${name}.arc1_ui_addr.default`).toBe('127.0.0.1:8711');
    }
  });
});

describe('version sync (release-please manages all four)', () => {
  it('keeps plugin/mcpb/server in lockstep with package.json', () => {
    const pkg = readJson('package.json').version;
    expect(plugin.version).toBe(pkg);
    expect(readJson('mcpb-manifest.json').version).toBe(pkg);
    expect(readJson('server.json').version).toBe(pkg);
  });
});

describe('deployment templates', () => {
  it('keep the experimental UI explicitly disabled in CF descriptors', () => {
    for (const rel of ['mta.yaml', 'manifest.yml', 'manifest-btp-abap.yml']) {
      const body = readFileSync(join(ROOT, rel), 'utf8');
      expect(body, rel).toContain('ARC1_UI: "off"');
    }
  });
});

describe('shipped skills have plugin-legal frontmatter', () => {
  const skillsDir = join(ROOT, 'skills');
  const skillNames = readdirSync(skillsDir).filter((name) => {
    const p = join(skillsDir, name);
    return statSync(p).isDirectory();
  });

  it('finds the skills directory', () => {
    expect(skillNames.length).toBeGreaterThan(0);
  });

  for (const name of skillNames) {
    it(`${name}/SKILL.md has a valid name + description`, () => {
      const body = readFileSync(join(skillsDir, name, 'SKILL.md'), 'utf8');
      const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      expect(fm, 'frontmatter block').toBeTruthy();
      const front = fm![1];

      const nameLine = front.match(/^name:\s*(.+)$/m)?.[1]?.trim();
      const descLine = front.match(/^description:\s*(.+)$/m)?.[1]?.trim();

      // name: lowercase letters/numbers/hyphens, <=64, no reserved words, matches the folder.
      expect(nameLine).toBe(name);
      expect(nameLine!).toMatch(/^[a-z0-9-]{1,64}$/);
      expect(nameLine!).not.toMatch(/anthropic|claude/);

      // description: non-empty, <=1024 chars, no XML tags, written about what/when.
      expect(descLine).toBeTruthy();
      expect(descLine!.length).toBeLessThanOrEqual(1024);
      expect(descLine!).not.toMatch(/<[^>]+>/);
    });
  }
});
