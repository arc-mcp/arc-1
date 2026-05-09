# ARC-1 Implementation Report

**Date:** 2026-03-25
**Report ID:** 004
**Subject:** Transform vsp into ARC-1 (ABAP Relay Connector) — enterprise MCP connector for Copilot Studio
**Related Documents:** [Enterprise Plan](2026-03-23-001-enterprise-copilot-studio-plan.md), [Auth Architecture](2026-03-25-003-centralized-mcp-auth-architecture.md)

---

## What is ARC-1?

**ARC-1** = **A**BAP **R**elay **C**onnector, version **1**.

A lean MCP server that relays AI tool calls to SAP ABAP systems via ADT (ABAP Development Tools) REST APIs. Designed for Microsoft Copilot Studio and other enterprise AI orchestrators.

## Implementation Phases

### Phase 1: Module Rename ✅
- Go module: `github.com/oisee/vibing-steampunk` → `github.com/marianfoo/arc-1`
- Binary name: `vsp` → `arc1`
- MCP server name: `vsp-abap-tools` → `arc1`
- All import paths updated across every .go file

### Phase 2: Intent-Based Tool Surface (10–11 Tools)

Replace 60+ granular tools with 10–11 intent-based tools. Each tool has:
- **Rich description** optimized for mid-tier LLM tool selection (not just GPT-4/Claude)
- **Action/type dispatch** — one tool, multiple operations via parameters
- **Read-only mode awareness** — write tools invisible when read-only

| # | Tool | Replaces | Category |
|---|------|----------|----------|
| 1 | `SAPRead` | GetSource, GetProgram, GetClass, GetInterface, GetFunction, GetInclude, GetTable, GetTableContents, GetPackage, GetSystemInfo, GetInstalledComponents, GetFunctionGroup, GetClassInfo, GetMessages, GetClassInclude, GetDomain, GetDataElement, GetStructure, GetMetadataExtension | Read |
| 2 | `SAPSearch` | SearchObject, GrepObjects, GrepPackages, GetWhereUsed | Discovery |
| 3 | `SAPWrite` | WriteSource, EditSource, CreateObject, UpdateClassInclude | Write (hidden in read-only) |
| 4 | `SAPActivate` | SyntaxCheck, Activate, ActivatePackage, RunUnitTests, RunATCCheck, PrettyPrint | Validate/Build |
| 5 | `SAPNavigate` | FindDefinition, FindReferences, GetObjectStructure, GetCDSDependencies, GetCallGraph, GetCallersOf, GetCalleesOf, AnalyzeCallGraph, CompareCallGraphs | Navigate |
| 6 | `SAPQuery` | RunQuery | SQL |
| 7 | `SAPTransport` | ListTransports, GetTransport, CreateTransport, ReleaseTransport, DeleteTransport | CTS |
| 8 | `SAPContext` | GetContext | AI Context |
| 9 | `SAPLint` | (new — abaplint rules) | Static Analysis |
| 10 | `SAPDiagnose` | ListDumps, GetDump, ListTraces, GetTrace, GetSQLTraceState, ListSQLTraces | Diagnostics |
| 11 | `SAPManage` | CreatePackage, DeleteObject, MoveObject, CreateTable, ExportToFile, ImportFromFile, CompareSource, CloneObject | Lifecycle (hidden in read-only) |

### Phase 3: Test Foundation
- Mock-based unit tests for all 11 tools
- Read-only mode verification tests
- Tool count regression tests

### Phase 4: Enterprise Hardening
- Structured JSON logging
- Request timeouts
- Graceful shutdown

### Skipped
- Auth Phase 3: Principal Propagation (already partially implemented, not needed for Copilot Studio)

## Tool Description Design Principles

Descriptions are written for **mid-tier LLMs** (GPT-3.5, Llama, Mistral) — not just top-tier:

1. **Lead with the verb** — "Read source code…", "Search for objects…"
2. **List what it can do** — explicit enumeration, not abstract generalization
3. **Include examples** — concrete parameter values in the description
4. **Warn about gotchas** — ABAP SQL vs standard SQL, required parent params
5. **State safety** — which actions are blocked in read-only mode
6. **Keep under 500 tokens** — long enough to be useful, short enough to not waste context

## Files Changed

| File | Change |
|------|--------|
| `go.mod` | Module path rename |
| `**/*.go` | Import path rename |
| `internal/mcp/server.go` | Server name → arc1 |
| `internal/mcp/tools_register.go` | Replace with 11-tool registration |
| `internal/mcp/tools_focused.go` | Remove (no longer needed) |
| `internal/mcp/tools_groups.go` | Remove (no longer needed) |
| `internal/mcp/handlers_intent.go` | NEW — all 11 intent-based tool handlers |
| `cmd/vsp/main.go` | Binary branding |
| `Dockerfile` | Binary name |
| `manifest.yml` | Image reference |
