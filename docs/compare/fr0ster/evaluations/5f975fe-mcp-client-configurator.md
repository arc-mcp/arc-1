# MCP Client Auto-Configurator

> **Priority**: Medium (High #21 in feature matrix)
> **Source**: fr0ster v2.2.0 — commits 5f975fe, e6fc034, f1bbcc8, e415679 + later d9c04af, 38a13cd, 6993c83, a0ce26f, f2a2ec3, 6dce74e (2026-02-09)
> **ARC-1 component**: New feature (no existing equivalent)

## What fr0ster did

Created `@mcp-abap-adt/configurator` package with `mcp-conf` CLI that auto-generates MCP client config for 11 clients:

```bash
mcp-conf --client cline --name abap --mcp TRIAL
```

Generates the correct JSON config block for: Claude Desktop, Cline, Continue, Cursor, Windsurf, Codex, Goose, Roo Code, OpenCode, VS Code Copilot, and a generic fallback.

Each client has different config file locations and formats:
- Claude Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Cline: VS Code settings → `mcpServers`
- Cursor: `~/.cursor/mcp.json`
- etc.

Also published `server.json` for MCP registry discoverability.

## ARC-1 current state

No auto-configurator. Users manually edit their MCP client config. Documentation provides examples but it's a friction point for onboarding.

## Assessment

**Pros**:
- Great onboarding UX — biggest barrier to adoption is config setup
- 11 clients is impressive coverage
- Reduces support burden (most issues are config-related)

**Cons**:
- Each client changes their config format regularly — maintenance burden
- ARC-1 is already easy to configure (npm package, simple env vars)
- A CLI tool adds another binary to maintain

**Alternative**: Instead of a full configurator, ARC-1 could:
1. Add `arc-1 config --client claude-desktop` that prints the config snippet to stdout
2. User copies and pastes — simpler to maintain, no file writes
3. Document config snippets in README for top 5 clients

## Decision

**Implement lightweight version** — A `arc-1 config` command that prints config snippets is 80% of the value with 20% of the effort. Full auto-configurator with file writes is over-engineering. Prioritize after more critical items (TLS, 415 retry).

**Effort**: ~1d for snippet printer, ~3d for full configurator
