/**
 * Guards for the Claude Code plugin + marketplace manifests.
 *
 * The repo root doubles as a single-plugin Claude Code marketplace: `.claude-plugin/plugin.json`
 * declares the ARC-1 MCP server inline and `.claude-plugin/marketplace.json` lists this repo
 * (source "./") so users can `/plugin marketplace add marianfoo/arc-1` →
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

describe('version sync (release-please manages all four)', () => {
  it('keeps plugin/mcpb/server in lockstep with package.json', () => {
    const pkg = readJson('package.json').version;
    expect(plugin.version).toBe(pkg);
    expect(readJson('mcpb-manifest.json').version).toBe(pkg);
    expect(readJson('server.json').version).toBe(pkg);
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
