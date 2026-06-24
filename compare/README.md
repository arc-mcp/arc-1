# ARC-1 Competitive Landscape

This folder contains detailed analysis documents for each SAP ADT / MCP project in the ecosystem. These documents serve as a living reference to:

1. **Track feature parity** -- understand what ARC-1 has vs. what competitors offer
2. **Identify adoption opportunities** -- bug fixes and patterns from other projects that can benefit ARC-1
3. **Evaluate placement** -- determine if a feature belongs in ARC-1 (developer tools) or [mcp-sap-docs](https://github.com/marianfoo/mcp-sap-docs) (documentation/search)

## Projects Analyzed

| # | Project | Type | Language | Status |
|---|---------|------|----------|--------|
| 1 | [oisee/vibing-steampunk](01-vibing-steampunk.md) (392★) | ADT MCP Server (upstream) | Go | Active (v2.40.0+) |
| 2 | [mario-andreschak/mcp-abap-abap-adt-api](02-mcp-abap-abap-adt-api.md) (109★) | ADT MCP Server (abap-adt-api wrapper) | TypeScript | Dormant |
| 3 | [mario-andreschak/mcp-abap-adt](03-mcp-abap-adt.md) (103★) | ADT MCP Server (read-only) | TypeScript | Dormant |
| 4 | [AWS ABAP Accelerator](04-aws-abap-accelerator.md) (33★) | ADT MCP Server (Amazon Q) | Python | Stale (Mar 2026) |
| 5 | [fr0ster/mcp-abap-adt](05-fr0ster-mcp-abap-adt.md) (63★) | ADT MCP Server (monorepo, ~330 tools) | TypeScript | Very Active (v7.2.1) |
| 6 | [lemaiwo/btp-sap-odata-to-mcp-server](06-btp-odata-mcp.md) (120★) | OData-to-MCP Bridge | TypeScript | Dormant (Jan 2026) |
| 7 | [DassianInc/dassian-adt](07-dassian-adt.md) (32★) | ADT MCP Server (53 tools, OAuth, multi-system) | TypeScript | **Very Active** (fastest-growing) |
| 8 | [Dassian ADT Gap Analysis](08-dassian-adt-feature-gap.md) | Feature gap deep-dive — extensively updated 2026-04-14 | — | Updated 2026-04-14 |
| 9 | [jfilak/sapcli](09-sapcli.md) (91★) | Python CLI for ADT (CI/CD automation, oldest OSS ADT client) | Python | Very Active |
| 10 | [SAP Joule for Developers (J4D)](J4D/01-joule-for-developers.md) | SAP's native AI copilot for ABAP — **Q2 2026 GA announced** for VS Code extension | — | Updated 2026-04-14 |
| 11 | [SAP ABAP MCP Server & ADT for VS Code](J4D/02-sap-abap-mcp-server-vscode.md) | SAP's official ABAP MCP server (`SAPSE.adt-vscode` v1.0.0) — now a tracked **"SAP ABAP MCP" column** in the [feature matrix](00-feature-matrix.md); 14 built-in tools, localhost Streamable-HTTP, RAP-generation scope | — | **Shipping** (GA Q2 2026), updated 2026-06-02 |
| 12 | [ABAP File Formats (AFF) Opportunity](J4D/03-abap-file-formats-opportunity.md) | How SAP's open-source file format spec could enhance ARC-1 — 7 opportunities analyzed | — | Updated 2026-04-04 |

## How to Update

Run the `/compare-projects` skill from Claude Code to trigger a fresh evaluation across all projects. This will:
- Check each project's recent commits and releases
- Identify new features or bug fixes relevant to ARC-1
- Update the `## Changelog & Relevance Tracker` section in each document
- Flag items requiring action

## Feature Placement Guide

| If the feature is about... | It belongs in... |
|----------------------------|-----------------|
| ABAP source code read/write/activate | ARC-1 |
| ADT API operations (transport, debug, lint) | ARC-1 |
| SAP documentation search | mcp-sap-docs |
| SAP community content | mcp-sap-docs |
| OData service discovery/execution | Separate project (not ADT) |
| BTP deployment/auth patterns | ARC-1 (server-side) |
