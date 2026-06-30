# MCP Server Publishing Guide

This document describes how to publish ARC-1 to various MCP server registries, marketplaces, and directories. The goal is to make ARC-1 discoverable wherever developers search for MCP servers.

## Overview

| Registry / Marketplace | Automated | Status | Unlocks |
|------------------------|-----------|--------|---------|
| [Official MCP Registry](#1-official-mcp-registry) | Yes (CI) | Ready | VS Code `@mcp` search, GitHub MCP Registry, Windsurf, aggregators |
| [Glama.ai](#2-glamaai) | Auto-indexed | Ready | awesome-mcp-servers listing, quality score badge |
| [Cline Marketplace](#3-cline-marketplace) | Manual | Ready | Cline VS Code extension marketplace |
| [VS Code / GitHub Copilot](#4-vs-code--github-copilot) | Via MCP Registry | Automatic | VS Code Extensions `@mcp` gallery |
| [Cursor Marketplace](#5-cursor-marketplace) | Manual | Ready | Cursor IDE built-in marketplace |
| [Claude Desktop Extensions](#6-claude-desktop-extensions) | Yes (CI builds + validates + packs .mcpb) | Ready | Claude Desktop Extensions directory |
| [Claude Code Plugin](#8-claude-code-plugin--marketplace) | Yes (repo is the marketplace) | Ready | `/plugin install` — MCP server + skills |

## Files in This Repository

| File | Purpose |
|------|---------|
| `server.json` | Official MCP Registry server metadata |
| `glama.json` | Glama.ai ownership claim |
| `mcp.json` | Cursor plugin MCP server config |
| `.cursor-plugin/plugin.json` | Cursor Marketplace plugin manifest |
| `mcpb-manifest.json` | Claude Desktop Extension (MCPB) manifest |
| `.mcpbignore` | Files excluded from MCPB bundle |
| `icon.png` | Bundle + listing icon (regenerate with `scripts/assets/generate-icon.py`) |
| `.claude-plugin/plugin.json` | Claude Code plugin manifest (inline `arc-1` MCP server + `userConfig`) |
| `.claude-plugin/marketplace.json` | Single-plugin Claude Code marketplace (`source: "./"`) |

---

## 1. Official MCP Registry

**URL:** https://registry.modelcontextprotocol.io  
**Impact:** Highest. Feeds VS Code `@mcp` search, GitHub MCP Registry, and most aggregators.

### What's Automated

The `publish-mcp-registry` job in `.github/workflows/release.yml` runs automatically on every release:

1. Downloads `mcp-publisher` CLI
2. Authenticates via GitHub OIDC (no secrets needed)
3. Updates version fields in `server.json` from the release tag
4. Validates and publishes to the registry

### Prerequisites (One-Time)

1. **`mcpName` in package.json** — Already added: `"mcpName": "io.github.arc-mcp/arc-1"`
2. **OCI label in Dockerfile** — Already added: `LABEL io.modelcontextprotocol.server.name="io.github.arc-mcp/arc-1"`
3. **`id-token: write` permission** — Already set on the `publish-mcp-registry` job

### First-Time Manual Publish

The first publish must be done manually to establish the namespace:

```bash
# Install mcp-publisher
brew install mcp-publisher
# OR: download from https://github.com/modelcontextprotocol/registry/releases

# Authenticate with GitHub
mcp-publisher login github

# Validate
mcp-publisher validate server.json

# Publish
mcp-publisher publish
```

After the first publish, all subsequent releases are automated via CI.

### Verification

After publishing, verify at:
- https://registry.modelcontextprotocol.io/ (search for "arc-1")
- https://github.com/mcp (search for "arc-1")

### Version Management

- `server.json` top-level `version` is auto-bumped by release-please
- The CI workflow also updates `packages[0].version` and `packages[1].identifier` with the release version

---

## 2. Glama.ai

**URL:** https://glama.ai/mcp/servers  
**Impact:** High. Required prerequisite for awesome-mcp-servers. Provides quality score badge.

### Steps

1. **Check if already auto-indexed:**
   Visit https://glama.ai/mcp/servers?query=arc-1

2. **If not indexed, submit manually:**
   Go to https://glama.ai/mcp/servers and click "Add Server", provide `https://github.com/arc-mcp/arc-1`

3. **Claim ownership:**
   Authenticate with GitHub at Glama. The `glama.json` file in the repo root establishes `marianfoo` as maintainer.

4. **Get the badge** (for awesome-mcp-servers PR):
   ```markdown
   [![MCP Server](https://glama.ai/mcp/servers/arc-mcp/arc-1/badges/score.svg)](https://glama.ai/mcp/servers/arc-mcp/arc-1)
   ```

### Quality Score

Glama scores tool definitions on:
- Purpose Clarity, Usage Guidelines, Behavioral Transparency (70%)
- Server Coherence (30%)

ARC-1's rich tool descriptions should score well.

---

## 3. Cline Marketplace

**URL:** https://github.com/cline/mcp-marketplace  
**Impact:** Medium-high. Millions of Cline users.

### Steps

1. **Prepare a 400x400 PNG logo** for ARC-1

2. **Open a GitHub issue** using the submission template:
   https://github.com/cline/mcp-marketplace/issues/new?template=mcp-server-submission.yml

3. **Fill in the template:**
   - **GitHub Repository URL:** `https://github.com/arc-mcp/arc-1`
   - **Logo Image:** Upload the 400x400 PNG
   - **Installation Testing:** Check both boxes (test with Cline first)
   - **Additional Information:**
     ```
     Name: ARC-1 - MCP Server for SAP ABAP Systems
     npm: https://www.npmjs.com/package/arc-1
     Docker: ghcr.io/arc-mcp/arc-1
     Install: npx -y arc-1
     License: MIT
     
     12 intent-based MCP tools for SAP ABAP Development Tools (ADT).
     Read, write, search, activate, lint, navigate, query, and manage
     ABAP objects. Read-only by default with configurable safety gates.
     Supports on-premise SAP and BTP ABAP Environment.
     ```

4. **Review timeline:** Typically a couple of days, but backlog can be longer.

### Optional: llms-install.md

Create an `llms-install.md` in the repo root with Cline-specific installation guidance (environment variables, prerequisites). This helps Cline's AI agent assist users during setup.

---

## 4. VS Code / GitHub Copilot

**URL:** VS Code Extensions view → `@mcp` search  
**Impact:** Very high. Largest developer editor.

### No Separate Submission Needed

VS Code's MCP Gallery automatically pulls from the Official MCP Registry. Once [step 1](#1-official-mcp-registry) is complete, ARC-1 will appear in:

- VS Code Extensions view when users search `@mcp arc-1` or `@mcp sap`
- GitHub MCP Registry at https://github.com/mcp with an "Install in VS Code" button
- JetBrains, Eclipse, and Xcode Copilot MCP galleries (via GitHub MCP Registry)

### Deeplink for Documentation

Add this to the README for one-click VS Code setup:
```markdown
[Install in VS Code](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%7B%22name%22%3A%22arc-1%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22arc-1%22%5D%7D)
```

---

## 5. Cursor Marketplace

**URL:** https://cursor.com/marketplace  
**Impact:** High. Major AI-native IDE.

### Files Already in Repo

- `.cursor-plugin/plugin.json` — Plugin manifest
- `cursor-mcp.json` — MCP server configuration

### Steps

1. **Test locally:**
   ```bash
   # Symlink to local plugins directory
   ln -s "$(pwd)" ~/.cursor/plugins/local/arc-1
   # Restart Cursor → verify MCP server appears
   ```

2. **Submit at:** https://cursor.com/marketplace/publish
   - Provide the GitHub repository URL: `https://github.com/arc-mcp/arc-1`
   - The plugin must be open source (ARC-1 is MIT)
   - Every submission and update is manually reviewed by the Cursor team

3. **Alternative — cursor.directory (community):**
   - Go to https://cursor.directory/plugins/new
   - Authenticate via GitHub
   - Paste repo URL — auto-detects the `.cursor-plugin` directory

### Deeplink for Documentation

Add to README for one-click Cursor install (no marketplace listing needed):
```
cursor://anysphere.cursor-deeplink/mcp/install?name=arc-1&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImFyYy0xIl0sImVudiI6eyJTQVBfVVJMIjoiJHtlbnY6U0FQX1VSTH0iLCJTQVBfVVNFUiI6IiR7ZW52OlNBUF9VU0VSfSIsIlNBUF9QQVNTV09SRCI6IiR7ZW52OlNBUF9QQVNTV09SRH0ifX0=
```

---

## 6. Claude Desktop Extensions

**URL:** Claude Desktop → Settings → Extensions  
**Impact:** High. Direct Anthropic ecosystem integration.

### Building the MCPB Bundle

**This is automated** — the `build-mcpb` job in `.github/workflows/release.yml` assembles, packs,
and attaches `arc-1-<version>.mcpb` to every GitHub Release. The steps below reproduce
it locally for testing.

> **Do not `mcpb sign` the bundle.** Signing appends an `MCPB_SIG_V1` block after the ZIP's
> end-of-central-directory record; strict third-party MCPB/DXT hosts then reject the file with
> *"Invalid comment length … extra bytes at the end of the file"*. The [official Claude build
> flow](https://claude.com/docs/connectors/building/mcpb) is `mcpb init` → `mcpb pack` with **no
> sign step** — Claude Desktop installs an unsigned bundle after an "Install Anyway" prompt, and a
> self-signed signature adds no real trust (there is no key-management/Developer-Program analog),
> so CI ships the bundle unsigned.

```bash
# Build the project first
npm run build

# Prepare a bundle directory with production files
mkdir -p mcpb-bundle
cp mcpb-manifest.json mcpb-bundle/manifest.json
cp icon.png mcpb-bundle/
cp -r dist mcpb-bundle/dist
cp package.json package-lock.json mcpb-bundle/

# Install prod deps WITHOUT the native better-sqlite3, so the bundle is pure-JS and
# cross-platform (darwin/win32/linux). The server falls back to the in-memory cache at
# runtime — see createCachingLayer() in src/server/server.ts.
( cd mcpb-bundle && npm ci --omit=dev --ignore-scripts )
rm -rf mcpb-bundle/node_modules/better-sqlite3

# Validate, then pack. Do NOT `mcpb sign` — see the note above (breaks strict third-party hosts).
npx @anthropic-ai/mcpb validate mcpb-bundle/manifest.json
npx @anthropic-ai/mcpb pack mcpb-bundle/ arc-1.mcpb
```

### Distribution

Users install by double-clicking the `.mcpb` file or dragging it into Claude Desktop → Settings →
Extensions. CI builds, validates, and packs `arc-1-<version>.mcpb`, then attaches it to every GitHub Release automatically (the
`build-mcpb` job — see [CI Automation](#ci-automation-implemented) below). User-facing install steps
live in [docs_page/install-in-claude.md](../docs_page/install-in-claude.md).

### Submitting to the Extensions Directory

The Claude Desktop Extensions Directory is currently Anthropic-curated with no public self-service submission. To get listed:

1. Confirm the release carries the `.mcpb` (packed unsigned for broad host compatibility) and that tool annotations are emitted (both automated below)
2. Submit via the connector submission form at https://claude.com/partners/mcp
3. Anthropic reviews for quality, security, and compatibility

### Tool Annotations

ARC-1 **emits** MCP tool annotations from `src/handlers/tools.ts` (`getToolDefinitions()` attaches
them from the `TOOL_ANNOTATIONS` map; guarded by `tests/unit/handlers/tool-annotations.test.ts`).
These travel in the **MCP protocol** tool list the client receives — they are **not** the
`mcpb-manifest.json` `tools[]` array (that array is only a static display hint for the listing).
Clients use them to badge tools and to auto-approve read-only ones; the Extensions Directory
requires them.

| Tool | readOnlyHint | destructiveHint |
|------|-------------|----------------|
| SAPRead | true | — |
| SAPSearch | true | — |
| SAPContext | true | — |
| SAPLint | true | — |
| SAPNavigate | true | — |
| SAPDiagnose | true | — |
| SAPQuery | true | — |
| SAPWrite | false | false |
| SAPActivate | false | false |
| SAPTransport | false | false |
| SAPGit | false | false |
| SAPManage | false | true |

### CI Automation (implemented)

The `build-mcpb` job in `.github/workflows/release.yml` runs on every release: it builds, assembles
a **pure-JS** bundle (omitting the native `better-sqlite3` so one `.mcpb` runs on macOS / Windows /
Linux — the server falls back to the in-memory cache), validates, packs (unsigned — see the
signing note under [Building the MCPB Bundle](#building-the-mcpb-bundle)), and attaches
`arc-1-<version>.mcpb` to the GitHub Release via `gh release upload`. The manifest `version` is kept
in sync with `package.json` by release-please (`extra-files` in `release-please-config.json`). No
manual step is required.

---

## 7. Additional Directories (Manual, Lower Priority)

These don't require files in the repo — just web submissions:

| Directory | Submit URL | Notes |
|-----------|-----------|-------|
| awesome-mcp-servers | PR to [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | Requires Glama listing first + badge |
| PulseMCP | https://www.pulsemcp.com/use-cases/submit | 12.5K+ servers |
| MCP.so | Issue at [chatmcp/mcpso](https://github.com/chatmcp/mcpso) | 19K+ servers |
| Smithery.ai | `smithery mcp publish` CLI | 7K+ servers, hosted remote |
| MCPServers.org | https://mcpservers.org/submit | |
| MCPMarket.com | https://mcpmarket.com/submit | |
| Docker MCP Catalog | PR to [docker/mcp-registry](https://github.com/docker/mcp-registry) | Verified Docker images |
| LobeHub | https://lobehub.com/mcp | |

### awesome-mcp-servers PR Template

After Glama listing is live, submit a PR to `punkpeye/awesome-mcp-servers`:

```markdown
- [ARC-1](https://github.com/arc-mcp/arc-1) [![arc-mcp/arc-1 MCP server](https://glama.ai/mcp/servers/arc-mcp/arc-1/badges/score.svg)](https://glama.ai/mcp/servers/arc-mcp/arc-1) - MCP server for SAP ABAP systems with 12 intent-based tools for reading, writing, searching, activating, and managing ABAP objects
```

Place in the appropriate category (likely "Developer Tools" or "Enterprise").

---

## 8. Claude Code Plugin & Marketplace

**URL:** Claude Code → `/plugin`
**Impact:** High. One install gives Claude Code users the MCP server **and** all SAP skills.

The repository root doubles as a **single-plugin Claude Code marketplace**.

### Files Already in Repo

- `.claude-plugin/plugin.json` — plugin manifest. Declares the `arc-1` MCP server **inline**
  (`mcpServers` → `npx arc-1`) and a `userConfig` that prompts for the SAP connection (password →
  OS keychain). Skills are the repo's existing `skills/` directory, which Claude Code always
  auto-scans for a plugin — no duplication. Inline `mcpServers` (rather than a root `.mcp.json`)
  avoids auto-starting the server for anyone developing *in* this repo.
- `.claude-plugin/marketplace.json` — catalog listing one plugin with `source: "./"`.

### Install (users)

```text
/plugin marketplace add arc-mcp/arc-1
/plugin install arc-1@arc-1
```

Skills load namespaced as `/arc-1:<skill>`. `plugin.json` `$.version` is bumped by release-please.
Validate locally with `claude plugin validate .`. Guard: `tests/unit/plugin/plugin-manifest.test.ts`.

### Submit to the Community Marketplace (optional)

- **claude.ai** (Team/Enterprise + directory-management access): https://claude.ai/admin-settings/directory/submissions/plugins/new
- **Console** (individual authors): https://platform.claude.com/plugins/submit

Run `claude plugin validate` first; approved plugins are pinned into `anthropics/claude-plugins-community`.

---

## Checklist

- [ ] First-time `mcp-publisher publish` (manual, one-time)
- [ ] Verify MCP Registry listing
- [ ] Verify VS Code `@mcp arc-1` search works
- [ ] Claim Glama.ai listing
- [ ] Submit awesome-mcp-servers PR (after Glama)
- [ ] Submit Cline Marketplace issue (need 400x400 logo)
- [ ] Submit Cursor Marketplace at cursor.com/marketplace/publish
- [ ] Submit cursor.directory listing
- [ ] Verify the release attached `arc-1-<version>.mcpb` (packed unsigned for broad host compatibility; build-mcpb job)
- [ ] Test the Claude Code plugin: `/plugin marketplace add arc-mcp/arc-1` → `/plugin install arc-1@arc-1`
- [ ] Submit Claude Code plugin (claude.ai/admin-settings/directory/submissions/plugins/new or platform.claude.com/plugins/submit)
- [ ] Submit Claude Desktop extension at claude.com/partners/mcp
- [ ] Submit to PulseMCP, MCP.so, Smithery (lower priority)
