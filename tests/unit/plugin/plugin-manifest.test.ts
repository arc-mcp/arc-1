/**
 * Guards for the portable Agent Plugin, Claude Code/MCPB packages, and Cursor-native adapter.
 *
 * The root `plugin.json`, `mcp.json`, and `skills/` directory are the Agent Plugins 1.0 portable
 * surface. The repo also doubles as a single-plugin marketplace: Claude Code reads its native
 * manifest while Copilot can select the portable root manifest from the same source.
 *
 * These tests make the wiring true by construction:
 * - the portable files stay inside the closed Agent Plugins 1.0 schemas
 * - portable MCP configuration contains no credentials or non-portable substitutions
 * - native adapters retain their client-specific configuration behavior
 * - every shipped skill has Agent Skills-conformant frontmatter
 * - release-please keeps every packaged manifest version in lockstep
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function readJson(rel: string): Record<string, any> {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function readYaml(rel: string): Record<string, any> {
  return parse(readFileSync(join(ROOT, rel), 'utf8')) as Record<string, any>;
}

function placeholder(name: string): string {
  return `\${${name}}`;
}

const agentPlugin = readJson('plugin.json');
const portableMcp = readJson('mcp.json');
const plugin = readJson('.claude-plugin/plugin.json');
const cursorPlugin = readJson('.cursor-plugin/plugin.json');
const marketplace = readJson('.claude-plugin/marketplace.json');

describe('Agent Plugins 1.0 portable package', () => {
  const PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
  const MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
  const MANIFEST_FIELDS = [
    '$schema',
    'author',
    'description',
    'homepage',
    'keywords',
    'license',
    'name',
    'repository',
    'version',
  ];

  it('uses the canonical closed manifest schema', () => {
    expect(agentPlugin.$schema).toBe(PLUGIN_SCHEMA);
    expect(agentPlugin.name).toBe('arc-1');
    expect(agentPlugin.name).toMatch(/^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
    expect(Object.keys(agentPlugin).sort()).toEqual(MANIFEST_FIELDS.sort());
    expect(Object.keys(agentPlugin.author).sort()).toEqual(['name', 'url']);
  });

  it('declares one schema-conformant stdio server', () => {
    expect(portableMcp.$schema).toBe(MCP_SCHEMA);
    expect(Object.keys(portableMcp).sort()).toEqual(['$schema', 'mcpServers']);
    expect(Object.keys(portableMcp.mcpServers)).toEqual(['arc-1']);

    const server = portableMcp.mcpServers['arc-1'];
    expect(Object.keys(server).sort()).toEqual(['args', 'command', 'cwd', 'type']);
    expect(server).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'arc-1@latest'],
      cwd: placeholder('PLUGIN_DATA'),
    });
  });

  it('keeps credentials out of portable package data', () => {
    const raw = JSON.stringify(portableMcp);
    expect(raw).not.toMatch(/SAP_(?:URL|USER|PASSWORD)/);
    expect(raw).not.toMatch(/\$\{(?:env:|user_config\.)/);
    expect(raw.match(/\$\{[^}]+\}/g)).toEqual([placeholder('PLUGIN_DATA')]);
  });
});

describe('Claude Code plugin.json', () => {
  it('identifies the plugin as arc-1 with a synced version', () => {
    expect(plugin.name).toBe('arc-1');
    expect(typeof plugin.version).toBe('string');
  });

  it('declares the ARC-1 MCP server inline as npx arc-1@latest', () => {
    const server = plugin.mcpServers?.['arc-1'];
    expect(server).toBeTruthy();
    expect(server.command).toBe('npx');
    expect(server.args).toEqual(['-y', 'arc-1@latest']);
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
    expect(entry.name).toBe(agentPlugin.name);
    // "./" resolves to the marketplace root (= repo root = the plugin); must start with "./".
    expect(entry.source).toBe('./');
  });
});

describe('Cursor-native plugin adapter', () => {
  it('uses an isolated native MCP config instead of the portable root mcp.json', () => {
    expect(cursorPlugin.mcpServers).toBe('.cursor-plugin/mcp.json');
    const cursorMcp = readJson(cursorPlugin.mcpServers);
    const server = cursorMcp.mcpServers?.['arc-1'];
    expect(server.command).toBe('npx');
    expect(server.args).toEqual(['-y', 'arc-1@latest']);
    expect(server.env.SAP_URL).toBe(placeholder('env:SAP_URL'));
    expect(server.env.SAP_PASSWORD).toBe(placeholder('env:SAP_PASSWORD'));
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
    'SAP_BLOCKED_DATA_SOURCES',
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

describe('packaged version sync', () => {
  it('keeps portable/native plugin, mcpb, and server versions in lockstep with package.json', () => {
    const pkg = readJson('package.json').version;
    expect(agentPlugin.version).toBe(pkg);
    expect(plugin.version).toBe(pkg);
    expect(cursorPlugin.version).toBe(pkg);
    expect(readJson('mcpb-manifest.json').version).toBe(pkg);
    expect(readJson('server.json').version).toBe(pkg);
  });

  it('lets release-please bump every versioned plugin manifest', () => {
    const releasePlease = readJson('release-please-config.json');
    const paths = releasePlease.packages['.']['extra-files'].map((entry: { path: string }) => entry.path);
    for (const path of [
      'plugin.json',
      '.claude-plugin/plugin.json',
      '.cursor-plugin/plugin.json',
      'mcpb-manifest.json',
      'server.json',
    ]) {
      expect(paths, path).toContain(path);
    }
  });
});

describe('deployment templates', () => {
  it('ship the experimental data-source policy disabled', () => {
    for (const rel of ['mta.yaml', 'manifest.yml', 'manifest-btp-abap.yml']) {
      const body = readFileSync(join(ROOT, rel), 'utf8');
      expect(body, rel).toContain('SAP_BLOCKED_DATA_SOURCES: ""');
    }
    expect(readFileSync(join(ROOT, 'Dockerfile'), 'utf8')).toContain('ENV SAP_BLOCKED_DATA_SOURCES=""');
  });

  it('keep the experimental UI explicitly disabled in CF descriptors', () => {
    for (const rel of ['mta.yaml', 'manifest.yml', 'manifest-btp-abap.yml']) {
      const body = readFileSync(join(ROOT, rel), 'utf8');
      expect(body, rel).toContain('ARC1_UI: "off"');
    }
  });

  it('keep SAP TLS verification enabled by default in shipped CF descriptors', () => {
    const mta = readYaml('mta.yaml');
    const appModule = (mta.modules as Array<Record<string, any>>).find((entry) => entry.name === 'arc1-mcp-server');
    expect(appModule?.properties?.SAP_INSECURE).toBe('false');

    const manifest = readYaml('manifest.yml');
    const app = (manifest.applications as Array<Record<string, any>>).find((entry) => entry.name === 'arc1-mcp-server');
    expect(app?.env?.SAP_INSECURE).toBe('false');
  });

  it('keeps the base BTP MTA target-free, preserves strict PP, and documents multi-target opt-in', () => {
    const mta = readYaml('mta.yaml');
    const appModule = (mta.modules as Array<Record<string, any>>).find((entry) => entry.name === 'arc1-mcp-server');

    expect(appModule?.properties?.SAP_BTP_DESTINATION).toBeUndefined();
    expect(appModule?.properties?.SAP_BTP_PP_DESTINATION).toBeUndefined();
    // These stay active so adding a single target during an upgrade cannot silently
    // switch JWT callers to the shared BasicAuth identity. They are inert without a target.
    expect(appModule?.properties?.SAP_PP_ENABLED).toBe('true');
    expect(appModule?.properties?.SAP_PP_STRICT).toBe('true');
    expect(appModule?.properties?.ARC1_MULTI_TARGET_ENDPOINTS).toBeUndefined();

    const raw = readFileSync(join(ROOT, 'mta.yaml'), 'utf8');
    expect(raw).toContain('# ARC1_MULTI_TARGET_ENDPOINTS: "true"');
    expect(raw).toContain('# ARC1_CACHE: none');
  });
});

describe('shipped skills have Agent Skills-conformant frontmatter', () => {
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

      // name: lowercase letters/numbers/hyphens, <=64, no edge/double hyphens, matches folder.
      expect(nameLine).toBe(name);
      expect(nameLine!.length).toBeLessThanOrEqual(64);
      expect(nameLine!).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
      expect(nameLine!).not.toContain('--');

      // description: non-empty, <=1024 chars, no XML tags, written about what/when.
      expect(descLine).toBeTruthy();
      expect(descLine!.length).toBeLessThanOrEqual(1024);
      expect(descLine!).not.toMatch(/<[^>]+>/);
    });
  }
});
