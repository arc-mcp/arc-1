# oisee/vibing-steampunk (Upstream)

> **Repository**: https://github.com/oisee/vibing-steampunk
> **Language**: Go 1.24 | **License**: MIT | **Stars**: 242
> **Status**: Very Active (v2.39.0+, daily commits through April 2026, 495+ total commits)
> **Relationship**: ARC-1's upstream/origin — forked and rewritten in TypeScript

---

## Project Overview

The original Go implementation of a SAP ADT-to-MCP bridge. Provides 99 tools in Expert mode (54 in Focused), with a unique "Hyperfocused" single-tool mode (~200 tokens). Includes a native Go ABAP parser/linter (ported from abaplint), Lua scripting engine, DSL/workflow automation, and experimental WASM/LLVM-to-ABAP compilation. Distributed as a single Go binary via GoReleaser (9 platforms).

Community favorite with 242 stars — highest of any SAP MCP server.

## Architecture

- **Monolithic Go binary** with embedded assets (ABAP sources, abapGit ZIP, SQLite)
- `cmd/vsp/` — CLI (Cobra), `internal/mcp/` — MCP server with 20+ handler files
- `pkg/adt/` — ADT HTTP client, `pkg/abaplint/` — native Go ABAP lexer/parser (3.5M tokens/sec)
- `pkg/ctxcomp/` — context compression, `pkg/scripting/` — Lua engine (50+ bindings)
- `pkg/dsl/` — YAML workflows, `pkg/llvm2abap/` — LLVM IR to ABAP transpiler
- `embedded/abap/` — ABAP classes deployed to SAP (ZADT_VSP handler)

## Tool Inventory (3 operational modes)

| Mode | Tools | Token Cost | Use Case |
|------|-------|-----------|----------|
| Hyperfocused | 1 universal `SAP(action, target, params)` | ~200 tokens | Maximum token efficiency |
| Focused (default) | 54 essential tools | ~14K tokens | Typical development |
| Expert | 99 tools (full set) | ~40K tokens | Advanced/low-level operations |

### Focused Mode (54 tools)
**Unified:** GetSource, WriteSource
**Search:** SearchObject, GrepObjects
**Read:** GetFunctionGroup, GetTable, GetTableContents, GetStructure, GetPackage, GetTransaction, GetTypeInfo, GetCDSDependencies, RunQuery
**System:** GetSystemInfo, GetInstalledComponents
**Analysis:** GetCallGraph
**Dev:** SyntaxCheck, ActivatePackage, RunUnitTests, RunATCCheck, CompareSource, CloneObject, GetClassInfo, CreateTable, CreatePackage
**CRUD:** LockObject, UnlockObject
**Edit:** EditSource (surgical string replacement with syntax check)
**File:** ImportFromFile, ExportToFile
**Code Intel:** FindDefinition, FindReferences
**Debugging:** GetDumps, GetDump
**Profiler:** ListTraces, GetTrace
**SQL Trace:** GetSQLTraceState, ListSQLTraces
**Git:** GitTypes, GitExport
**Install:** InstallZADTVSP, InstallAbapGit, ListDependencies
**Reports:** RunReport, RunReportAsync, GetAsyncResult, GetVariants, GetTextElements, SetTextElements

### Expert Mode adds 45 more tools
GrepObject, GrepPackage, GetProgram, GetClass, GetInterface, GetFunction, GetInclude, GetObjectStructure, GetCallersOf, GetCalleesOf, AnalyzeCallGraph, CompareCallGraphs, TraceExecution, GetATCCustomizing, CreateObject, UpdateSource, DeleteObject, PublishServiceBinding, UnpublishServiceBinding, GetClassInclude, CreateTestInclude, UpdateClassInclude, WriteProgram, WriteClass, CreateAndActivateProgram, CreateClassWithTests, DeployFromFile, SaveToFile, RenameObject, CodeCompletion, PrettyPrint, GetPrettyPrinterSettings, SetPrettyPrinterSettings, GetTypeHierarchy, CreateTransport, GetTransportInfo, ReleaseTransport, GetUserTransports, GetInactiveObjects, ExecuteABAP

### CLI Mode (28 non-MCP commands)
query, grep, graph, deps, lint, parse, compile, plus more — usable without MCP client.

## Authentication

| Method | Supported |
|--------|-----------|
| Basic Auth | Yes |
| Cookie-based (Netscape format) | Yes |
| OIDC/OAuth/JWT | **No** |
| BTP Destination Service | **No** |
| Principal Propagation | **No** |
| API Key (MCP endpoint) | **No** |

## Safety System

Same architecture as ARC-1 (ARC-1 inherited this design):
- 13 operation type codes: R, S, Q, F, C, U, D, A, T, L, I, W, X
- ReadOnly, BlockFreeSQL, AllowedOps/DisallowedOps, AllowedPackages
- EnableTransports, TransportReadOnly, AllowedTransports, AllowTransportableEdits
- DryRun mode
- Pre-configured profiles: Default (read-only), Development, Unrestricted

## Transport (MCP Protocol)

| Transport | Supported |
|-----------|-----------|
| stdio | Yes |
| HTTP Streamable | Yes (v2.38.0, mcp-go v0.47.0) |
| SSE | **No** |
| TLS | **No** |

## Supported AI Agents (8)

Gemini CLI, Claude Code, GitHub Copilot, OpenAI Codex, Qwen Code, OpenCode, Goose, Mistral Vibe

## March 2026 Release Sprint

| Version | Date | Key Feature |
|---------|------|-------------|
| **v2.39.0+** | Apr 7-8 | Boundary analysis sprint — side effect extraction, LUW classification, package boundary crossing, dead code analysis |
| **v2.38.0** | Apr 5-6 | Streamable HTTP, graph engine, health analysis, rename preview, dead code analysis, API surface inventory, auth redirect fix |
| **v2.33-37** | Apr 2-5 | Massive feature sprint — version history, i18n tools (7), gCTS tools (10), API release state, code coverage, CDS impact, table pagination |
| **v2.32.0** | Mar 22 | "Full Stack ABAP" — Native ABAP parser/linter (91 statements, 8 rules, 100% accuracy), 28 CLI commands, WASM self-host compiler, Lua scripting (50+ bindings) |
| **v2.30.0** | Mar 20 | WASM-to-ABAP AOT compiler (QuickJS: 1,410 functions → 101K lines ABAP), TS-to-Go transpiler, unified 5-layer code intelligence |
| **v2.29.0** | Mar 19 | Token efficiency sprint — hyperfocused mode (~200 tokens), context compression (7-30x), method-level surgery (95% reduction) |
| **v2.27.0** | Mar 1 | Documentation overhaul, 8 AI agent configs, reviewer guide |
| **v2.26.0** | Feb 4 | Package validation fix for local packages ($TMP) |
| **v2.24.0** | Feb 3 | Transportable edits safety feature |
| **v2.22.0** | Feb 1 | Transport fixes, proxy support, MoveObject tool |
| **v2.21.0** | Jan 6 | Method-level source operations (95% token reduction) |

## Testing

- 222 unit tests
- Integration tests require live SAP
- Benchmark tests for context compression
- GoReleaser CI for 9 platforms

## Dependencies

mcp-go v0.17.0, Cobra, Viper, go-sqlite3, godotenv, yaml.v3, Gopher-Lua, WebSocket library

## Community Presence

- Listed on MCP Store, LobeHub MCP directory
- SAP Community blog: "Try Vibing Steampunk to generate ABAP" (setup guide)
- SAP Community: "The Future of SAP ABAP Based Systems with AI: Why MCP Servers Matter"
- Medium: "Vibe Steam Punk (VSP) for ABAP Cloud, Mac & Claude" (Warren Eiserman, Feb 2026)
- Referenced in: "Claude Code via MCP: Poor man's Joule, or a practical tool"

## Known Issues

| Issue | Description | Relevant to ARC-1? | Evaluation |
|-------|-------------|-------------------|------------|
| #79 | Session not found — needs stateless ADT sessions | Yes — handle session errors gracefully | Monitor |
| #78 | 423 lock handle errors on ECC 6.0 EHP7 | Medium — ARC-1 targets 7.50+ | [Eval](vibing-steampunk/evaluations/issue-78-lock-handle-ecc.md) |
| #77 | No browser-based SSO authentication | No — ARC-1 already has OIDC | — |
| #76 | Call graph fallback broken for namespaced objects | No — ARC-1 doesn't have call graph | — |
| #75 | InstallZADTVSP not idempotent on ABAP 758 trial | No — ARC-1 doesn't deploy ABAP | — |
| #74 | Missing CDS metadata extension (DDLX/EX) | No — ARC-1 already has DDLX | — |
| #56 | Unable to create new programs | Low — verify create operations | Monitor |
| #9 | Transport API returns 406 — wrong Accept header | High — covered by 415 auto-retry | [Eval](vibing-steampunk/evaluations/issue-9-transport-accept-header.md) |

---

## Features ARC-1 Has That Upstream Lacks

| Feature | Notes |
|---------|-------|
| HTTP Streamable transport | Multi-user, web-deployable |
| OIDC/JWT authentication | Enterprise SSO |
| BTP Destination Service | Cloud-native SAP connectivity |
| BTP ABAP Environment (OAuth 2.0) | Direct BTP connection |
| Principal Propagation | Per-user SAP auth |
| API Key auth | Simple MCP endpoint protection |
| MCP scope system (OAuth) | Scope-gated tool access |
| Audit logging | BTP Audit Log sink |
| MCP elicitation | Interactive parameter collection |
| npm/Docker distribution | Easy installation |
| XSUAA OAuth proxy | BTP-native OAuth |
| Cloud Connector support | On-prem via BTP |

## Features Upstream Has That ARC-1 Lacks

| Feature | Priority | Effort | Notes |
|---------|----------|--------|-------|
| **Native ABAP parser/linter** (Go port, 8 rules) | Low | N/A | ARC-1 uses @abaplint/core (same source) |
| **ABAP debugger** (8 tools) | Low | 5d | Requires ZADT_VSP deployment |
| **AMDP/HANA debugger** (7 tools) | Low | 5d | Requires WebSocket + ZADT_VSP |
| **Lua scripting engine** (50+ bindings) | Low | N/A | Not core MCP value |
| **WASM-to-ABAP compiler** | Low | N/A | Experimental |
| **Call graph analysis** (5 tools) | Medium | 3d | Useful for code understanding |
| **Report execution** (RunReport, async) | Medium | 3d | Requires WebSocket |
| **ExecuteABAP** | Low | 2d | Security risk, needs safety gating |
| **UI5/Fiori BSP CRUD** (7 tools) | Medium | 3d | If UI5 feature detected |
| **Git/abapGit export** | Medium | 2d | If abapGit feature detected |
| **PrettyPrint** (code formatting) | Medium | 1d | Via ADT API |
| **CompareSource** (diff) | Medium | 1d | Source comparison |
| **CloneObject** | Low | 1d | Copy object to new name |
| **CLI mode** (28 commands, no MCP) | Low | N/A | Different distribution model |
| **GetAbapHelp** (F1 documentation) | Medium | 0.5d | ABAP keyword help |
| **Type hierarchy** | Medium | 1d | OO navigation |
| **CDS dependencies** | Medium | 1d | CDS navigation |
| **Inactive objects list** | Medium | 0.5d | Development workflow |

### Closed Gaps (ARC-1 now has these)

| Feature | Implemented In |
|---------|---------------|
| ~~Hyperfocused mode~~ (1 tool, ~200 tokens) | `src/handlers/hyperfocused.ts` |
| ~~Method-level surgery~~ (EditSource) | `src/context/method-surgery.ts` |
| ~~Short dump analysis~~ (ST22) | `src/adt/diagnostics.ts` |
| ~~ABAP profiler traces~~ | `src/adt/diagnostics.ts` |
| ~~SQL trace monitoring~~ | `src/adt/diagnostics.ts` |
| ~~Structures read~~ | `src/adt/client.ts` (getStructure) |
| ~~Transactions read~~ | `src/adt/client.ts` (getTransaction) |

---

## Changelog & Relevance Tracker

| Date | Upstream Change | Relevant? | Decision | Status |
|------|----------------|-----------|----------|--------|
| 2026-04-24 | **Issue #124: SAP API Policy v.4.2026 may classify ADT REST as off-limits for productive use** | **Strategic** | **No code action** — track for project narrative; affects every ADT-based MCP. Possible mitigations: developer-tool framing, BTP-only positioning, wait for SAP clarification. | [Eval](vibing-steampunk/evaluations/issue-124-sap-api-policy-v42026.md) |
| 2026-04-23 | Issue #123: GetRevisions 404 for INTF/DDLS (vsp uses wrong URL `oo/interfaces/{name}/includes/main/versions`) | Medium | Verify — ARC-1's path is `/source/main/versions` for INTF (likely correct). Run integration test against a4h to confirm. | — |
| 2026-04-21 | Issue #110: Lock-handle regression on S/4HANA 758 (vsp v2.32→v2.36) | Medium | Cross-check whenever ARC-1 touches crud.ts — withStatefulSession should already cover it. | — |
| 2026-04-20 | Issue #116: vsp's WriteSource rejects INCL | No | ARC-1 already supports INCL in SAPWRITE_TYPES_ONPREM with full case 'INCL' wiring. Win for ARC-1. | — |
| 2026-04-20 | Issue #114: HANA detection on S/4HANA 758 (COMPONENTS endpoint returns 406, vsp probe doesn't fall back to S4CORE) | Medium | Verify ARC-1 capability detection has a 406-fallback path on 758. | — |
| 2026-04-18 | Issue #109: vsp lacks DOMA/DTEL create | No | ARC-1 already supports DOMA/DTEL create+update via metadata XML writes (ddic-xml.ts). Win for ARC-1. | — |
| 2026-04-12 | **CRITICAL: Package safety bypass on mutations (#101)** — `SAP_ALLOWED_PACKAGES` not enforced on update/delete. **ARC-1 has same bug.** | **Critical** | **Fix immediately** — checkPackage() missing on update/delete/edit_method | [Eval](vibing-steampunk/evaluations/0713d75-package-safety-mutations.md) |
| 2026-04-12 | SAML SSO auth for S/4HANA Public Cloud (#97) — programmatic + browser + credential-cmd | Low | Defer — ARC-1 uses BTP OAuth / Destination Service | [Eval](vibing-steampunk/evaluations/e62c7d5-saml-sso-auth.md) |
| 2026-04-15 | **Fix lock-handle bug class — modificationSupport guard** (22517d4) | **High** | **Implement**: add modificationSupport parsing to lockObject() in crud.ts. If false, fail early with clear LLM-friendly error (object locked in released transport). Fixes root cause of all 423 errors. | [Eval](vibing-steampunk/evaluations/22517d4-lock-handle-bug-class.md) |
| 2026-04-15 | Issue #104: CSRF HEAD fails on S/4HANA public cloud (CL_ADT_WB_RES_APP) | **High** | **Verify**: ARC-1 http.ts uses HEAD for CSRF fetch — add GET fallback if HEAD returns 403 | [Eval](vibing-steampunk/evaluations/22517d4-lock-handle-bug-class.md) |
| 2026-04-13 | feat: RecoverFailedCreate recovery primitive (f00356a, 3d1353e) | Medium | Consider future — ARC-1's 409 hint already handles most cases | [Eval](vibing-steampunk/evaluations/f00356a-recover-failed-create.md) |
| 2026-04-12 to 2026-04-13 | cr-config-audit sprint — CLI governance tooling (DDIC delivery classes, transport change analysis, boundary crossing) | Low | No action — CLI-only governance tools, not MCP | [Eval](vibing-steampunk/evaluations/cr-config-audit-sprint.md) |
| 2026-04-11 | Issue #98: 423 on DDLS — LOCK and UPDATE_SOURCE in separate HTTP sessions (root cause confirmed) | **High** | **Verify**: ARC-1 withStatefulSession() should cover this — test DDLS update flow specifically | [Eval](vibing-steampunk/evaluations/22517d4-lock-handle-bug-class.md) |
| 2026-04-12 | HANA database detection from S4CORE component (#100) | Low | Consider — system info enhancement | — |
| 2026-04-10 | API release state bug fix — C0-C4 structure (#95) | Medium | Verify ARC-1 getApiReleaseState | [Eval](vibing-steampunk/evaluations/a66bcd5-release-state-bugfix.md) |
| 2026-04-09 | Default mode → hyperfocused (1 tool), transport/CR boundary analysis, batch IN-clause fix | Low | Market signal — validates intent-based approach | — |
| 2026-04-08 | v2.39.0 — Side effect extraction, LUW classification, boundary crossing | Review | Consider future — novel analysis capabilities | [Eval](vibing-steampunk/evaluations/11c2253-side-effects-luw.md) |
| 2026-04-07 | v2.38.1 — Auth headers on redirects, stateful lock sessions | Yes | Verify — check ARC-1 http.ts redirect behavior | [Verify](vibing-steampunk/evaluations/27d4d7c-auth-redirect-stateful.md) |
| 2026-04-06 | v2.38.0 — Health analysis, rename preview, dead code, API surface | Review | Rename: consider (#18). Others: defer. | [Eval](vibing-steampunk/evaluations/dcaa358-rename-refactoring.md) |
| 2026-04-05 | v2.38.0 — **Streamable HTTP transport** (mcp-go v0.47.0) | Landscape | ARC-1 no longer unique — VSP also has HTTP now | [Eval](vibing-steampunk/evaluations/daedc99-streamable-http.md) |
| 2026-04-05 | v2.33-37 — i18n (7 tools), gCTS (10 tools), API release state | Yes | **API release state: implement**. i18n/gCTS: consider future. | [Eval](vibing-steampunk/evaluations/7270ad7-api-release-state.md) |
| 2026-04-04 | v2.33-37 — Code coverage, CDS impact, table pagination, version history | Review | All medium priority — enhance existing tools | [Eval](vibing-steampunk/evaluations/dd06202-version-history.md) |
| 2026-04-02 | Post-v2.32.0 — jseval LLVM improvements | No | N/A — experimental | — |
| 2026-03-29 | LLVM-to-ABAP transpiler improvements | No | N/A — experimental | — |
| 2026-03-22 | v2.32.0 — Native ABAP parser/linter, call graph, package deps | Review | Parser: no-action (same abaplint). Call graph: defer. | Done |
| 2026-03-20 | v2.30.0 — WASM Compiler, parse/analyze MCP tools | Review | WASM: no. Parse tools: no-action (ARC-1 uses internally). | Done |
| 2026-03-19 | v2.29.0 — Hyperfocused mode, method-level surgery, context compression | Yes | **Implemented** — hyperfocused + method surgery in ARC-1 | ✅ |
| 2026-03-01 | v2.27.0 — 8 AI agent configs, doc overhaul | No | No action — agent configs are client-side | Done |
| 2026-02-04 | v2.26.0 — Package validation fix ($TMP) | Yes | Verify — check ARC-1 safety.ts for local packages | [Verify](vibing-steampunk/evaluations/2ef8c3e-package-safety-check.md) |
| 2026-02-03 | v2.24.0 — Transportable edits safety | No | ARC-1 already has this | — |
| 2026-02-01 | v2.22.0 — Transport fixes, namespace URL encoding, 401 auto-retry | Yes | Verify — namespace encoding, transport compat, 401 retry | [Verify](vibing-steampunk/evaluations/59b4b90-namespace-url-encoding.md) |

> **Detailed commit-level tracking**: See [`docs/compare/vibing-steampunk/`](vibing-steampunk/) for per-commit and per-issue evaluations.

_Last updated: 2026-04-27_
