# Enterprise Microsoft Copilot Studio Connector — Strategic Plan

**Date:** 2026-03-23
**Report ID:** 2026-03-23-001
**Subject:** Comprehensive plan for transforming vsp into an enterprise-grade SAP connector for Microsoft Copilot Studio
**Fork:** https://github.com/marianfoo/arc-1 (working branch, never touch oisee/vibing-steampunk)

---

## Vision

Transform `vsp` from a developer-focused local tool with 80–122 tools into a clean, enterprise-ready MCP connector between **Microsoft Copilot Studio** and **SAP ABAP systems**. The connector must be trustworthy, predictable, and deployable in enterprise environments — no experimental baggage, no local-dev assumptions, no fragile dependencies.

Key principles:
- **10–11 intent-based tools** with rich, self-explanatory descriptions (LLM-friendly)
- **Read-only by default** — write tools only available when explicitly enabled
- **HTTP Streamable transport first** — required for Copilot Studio REST integration
- **Solid test foundation** — every tool handler unit-testable without a live SAP system
- **Zero side-effect binary** — no CLI DevOps mode, no Lua REPL, no WASM compiler

---

## Current State Analysis

### What We Have Today

| Category | Files / Packages | Lines | Status |
|----------|-----------------|-------|--------|
| MCP server core | `internal/mcp/server.go` | ~360 | **Keep** |
| Tool handlers (25 files) | `internal/mcp/handlers_*.go` | ~7,200 | Partially keep, trim |
| Tool registration | `tools_register.go`, `tools_focused.go`, `tools_groups.go`, `tools_aliases.go` | ~2,200 | Redesign |
| ADT client | `pkg/adt/` (~30 files) | ~10,000+ | Keep core, trim WebSocket/debugger (~2,500 LOC) |
| CLI commands | `cmd/vsp/*.go` (13 files) | ~6,256 | Remove most |
| WASM compiler | `pkg/wasmcomp/` | ~4,000 | **Remove** |
| TS→ABAP transpiler | `pkg/ts2abap/` | ~900 | **Remove** |
| Lua scripting | `pkg/scripting/` | ~500 | **Remove** |
| ABAP LSP server | `internal/lsp/` | ~960 | **Remove** |
| DSL/workflow engine | `pkg/dsl/` | ~1,400 | **Remove** |
| Native ABAP lexer | `pkg/abaplint/` | ~1,800 | **Keep** — static clean core linter (S/4 conversion) |
| Context compression | `pkg/ctxcomp/` | ~2,100 | **Keep** — reduces SAP round-trips in research sessions |
| Cache package | `pkg/cache/` | ~600 | **Keep** — long-running Docker deployment, repeated queries |
| Embedded deps | `embedded/deps/` (abapGit ZIPs) | - | **Remove** — no install tools |
| Embedded ABAP | `embedded/abap/` (ZADT_VSP, WASM) | - | **Remove** — all WebSocket-dependent features removed |
| Docker support | `Dockerfile`, `.dockerignore` | - | **Keep** + improve |

### Tool Count Problem

Current modes: 81 tools (focused), 122 (expert), ~46 (readonly), 1 (hyperfocused).

The problem: even 46 "readonly" tools is too many. Copilot Studio works best with a small, well-described surface. The LLM needs to confidently pick the right tool — too many tools with similar names causes guessing and errors.

Target: **10–11 tools** that cover 95% of enterprise use cases, each with comprehensive descriptions.

---

## What to Remove

### Packages to Remove

#### `pkg/wasmcomp/` — WASM-to-ABAP AOT Compiler
- **Why remove:** Pure research project, not related to MCP connector purpose
- **Impact:** ~4,000 LOC gone, test suite cleanup
- **Risk:** Zero — no handler references it

#### `pkg/ts2abap/` — TypeScript→ABAP Transpiler
- **Why remove:** Experimental, has failing tests (needs `npm install typescript`)
- **Impact:** ~900 LOC, removes the npm/node dependency
- **Risk:** Zero — only `cmd/vsp/cli_compile.go` imports it (also being removed)

#### `pkg/scripting/` — Lua Scripting Engine
- **Why remove:** Local developer feature, not enterprise, requires Lua runtime embedding
- **Impact:** ~500 LOC, removes `gopher-lua` dependency
- **Risk:** Must remove `cmd/vsp/lua.go` (also being removed)

#### `internal/lsp/` — ABAP LSP Server
- **Why remove:** IDE integration feature for local development, not an enterprise MCP concern
- **Impact:** ~960 LOC
- **Risk:** Must remove `cmd/vsp/lsp.go` (also being removed)

#### `pkg/dsl/` — Fluent API & YAML Workflow Engine
- **Why remove:** Orchestration for local CLI pipelines, not needed in connector
- **Impact:** ~1,400 LOC
- **Risk:** Only `cmd/vsp/workflow.go` imports it (also being removed). No handler imports.

### Embedded Files to Remove

#### `embedded/abap/wasm_compiler/` — WASM compiler ABAP classes
- Goes with `pkg/wasmcomp/` removal. 3 large ABAP class files.

#### `embedded/deps/` — abapGit ZIPs and lexer ZIP
- `abapgit-full.zip`, `abapgit-standalone.zip`, `abaplint-lexer.zip` — these exist for `handlers_install.go` which is being removed.
- `embed.go` and `embed_test.go` must be trimmed or removed (remove abapGit-specific functions, keep the package if any remaining embedded resources are needed, otherwise remove entirely).

### ADT Client Trimming (`pkg/adt/`)

All WebSocket-dependent features are being removed. This eliminates these files from `pkg/adt/`:

| File | LOC | Reason |
|------|-----|--------|
| `websocket.go` | ~200 | ZADT_VSP WebSocket client |
| `websocket_base.go` | ~150 | Base WebSocket transport |
| `websocket_debug.go` | ~200 | Debug WebSocket operations |
| `websocket_rfc.go` | ~150 | RFC call via WebSocket |
| `websocket_types.go` | ~100 | WebSocket message types |
| `amdp_websocket.go` | ~300 | AMDP WebSocket client |
| `amdp_debugger.go` | ~250 | AMDP debugger operations |
| `debugger.go` | ~400 | External debugger HTTP client |
| `git.go` | ~300 | abapGit WebSocket operations |
| `reports.go` | ~250 | RunReport WebSocket operations |

**Total:** ~2,300 LOC removed from `pkg/adt/`
**Dependency removed:** `gorilla/websocket`

Also remove `server.go` fields: `amdpWSClient`, `debugWSClient` and their initialization code.

### CLI Files to Remove

| File | LOC | Reason |
|------|-----|--------|
| `cmd/vsp/devops.go` | 1,140 | CI/CD pipeline commands |
| `cmd/vsp/debug.go` | 754 | Interactive debugger CLI |
| `cmd/vsp/lua.go` | 107 | Lua REPL |
| `cmd/vsp/lsp.go` | 79 | LSP server start |
| `cmd/vsp/workflow.go` | 316 | YAML workflow runner |
| `cmd/vsp/copy_cmd.go` | 380 | Object copy CLI |
| `cmd/vsp/cli_compile.go` | 333 | WASM compiler CLI |
| `cmd/vsp/cli_deps.go` | 328 | Dependency management CLI |
| `cmd/vsp/cli_extra.go` | 755 | Extra CLI commands |

**Keep:**
- `cmd/vsp/main.go` — Entry point + MCP server flags
- `cmd/vsp/cli.go` — Minimal: search, source read (optional convenience for admin)
- `cmd/vsp/config_cmd.go` — Config init/show (useful for enterprise setup)
- `cmd/vsp/main_test.go` — Keep tests

### Handler Files to Remove

| File | LOC | Reason |
|------|-----|--------|
| `handlers_amdp.go` | 252 | AMDP/HANA debugger — experimental, requires ZADT_VSP |
| `handlers_debugger.go` | 284 | External debugger — unreliable, requires ZADT_VSP WebSocket |
| `handlers_debugger_legacy.go` | 282 | Legacy debugger — HTTP-based, 403 CSRF issues |
| `handlers_install.go` | 603 | Install ZADT_VSP/abapGit — dev setup, not enterprise |
| `handlers_report.go` | 460 | RunReport/RunReportAsync — requires ZADT_VSP WebSocket |
| `handlers_git.go` | 141 | abapGit export — requires ZADT_VSP WebSocket |
| `handlers_workflow.go` | 160 | DSL workflows — goes with `pkg/dsl/` removal |
| `handlers_deploy.go` | 310 | DSL deploy pipeline — goes with `pkg/dsl/` removal |
| `handlers_help.go` | 325 | Hyperfocused mode help — will be redesigned |
| `handlers_servicebinding.go` | 74 | OData service binding — too specialized for baseline |
| `tools_aliases.go` | 59 | Tool aliases (gs, ws, etc.) — dead code, currently commented out |

### Misc Files to Remove

- `package.json`, `package-lock.json` — npm dependencies for ts2abap, not needed
- `_outbox/` — session context dumps
- `contexts/` — session context files
- `Makefile` — CLI-oriented build targets (replace with simpler build)
- `ARCHITECTURE.md`, `VISION.md`, `ROADMAP.md`, `MCP_USAGE.md`, `README_TOOLS.md` — outdated docs referencing removed features (rewrite as needed)
- `reports/` — keep the plan, remove old research reports for WASM/debugger/etc.

---

## What to Keep

### Packages

#### `pkg/abaplint/` — Native ABAP Lexer + Static Linter ✅ KEEP
- **Why keep:** Foundation for deterministic clean core compliance checking. Instead of the LLM guessing whether code follows clean core rules, abaplint applies rule sets statically (naming conventions, obsolete statements, modification of SAP standard, etc.). This is a primary enterprise use case for S/4HANA conversion projects.
- **Future tool:** `SAPLint` — runs abaplint rule set against an object or package, returns structured findings. CI-ready.
- **Effort needed:** Wire existing lexer/parser into a linting handler; define configurable rule sets.

#### `pkg/ctxcomp/` — Context Compression Engine ✅ KEEP
- **Why keep:** The server is long-running (Docker), and research sessions involve many queries about related objects. ctxcomp fetches dependency contracts (type signatures of what a class uses) and bundles them with the source, reducing the number of round-trips to SAP and the number of LLM tool calls needed to understand unfamiliar code.
- **Trim:** Remove benchmark/live tests that require a real SAP connection from the unit test suite.

#### `pkg/cache/` — In-Memory + SQLite Cache ✅ KEEP
- **Why keep:** Long-running Docker deployment means the process stays alive across many Copilot Studio sessions. Research usage pattern = many repeated queries on the same objects (e.g., browsing a whole package). Caching SAP responses reduces load on the SAP system and speeds up responses.
- **Configuration:** In-memory by default (zero config); SQLite opt-in via `SAP_CACHE_PATH` env var for persistence across restarts.
- **Trim:** Remove unused API surface caching (designed for CROSS/WBCROSSGT graph traversal that won't be implemented).

#### `pkg/adt/` — ADT HTTP Client ✅ KEEP (trimmed)
- Core read/write/search/devtools operations stay.
- WebSocket and debugger files removed (see above).

#### `pkg/config/` — Configuration Loading ✅ KEEP

### Handler Files to Keep

#### Kept as-is (fold into new tool surface):
| File | LOC | Maps to new tool |
|------|-----|-----------------|
| `handlers_source.go` | 439 | `SAPRead`, `SAPWrite` |
| `handlers_read.go` | 363 | `SAPRead` |
| `handlers_grep.go` | 113 | `SAPSearch` |
| `handlers_search.go` | 59 | `SAPSearch` |
| `handlers_codeintel.go` | 385 | `SAPNavigate` |
| `handlers_system.go` | 130 | `SAPRead` (type: SYSTEM) |
| `handlers_crud.go` | 463 | `SAPManage`, `SAPWrite` |
| `handlers_devtools.go` | 143 | `SAPActivate` |
| `handlers_atc.go` | 93 | `SAPActivate` (action: atc_check) |
| `handlers_transport.go` | 330 | `SAPTransport` |
| `handlers_analysis.go` | 316 | `SAPNavigate` (call graph uses ADT APIs, no abaplint dependency) |
| `handlers_context.go` | 467 | `SAPContext` (imports `pkg/ctxcomp`) |
| `handlers_universal.go` | 191 | Keep for hyperfocused mode fallback |
| `handlers_fileio.go` | 260 | `SAPWrite` (EditSource), `SAPManage` (ImportFromFile/ExportToFile) |
| `handlers_classinclude.go` | 106 | `SAPRead` (include param), `SAPWrite` (UpdateClassInclude) |
| `handlers_sqltrace.go` | 58 | `SAPDiagnose` (action: sql_trace) |
| `handlers_traces.go` | 76 | `SAPDiagnose` (action: traces) |
| `handlers_dumps.go` | 80 | `SAPDiagnose` (action: dumps) |

---

## The New Tool Surface (10–11 Tools)

The goal: intent-based tools that an LLM can reason about confidently.

### Proposed Tool Set

#### 1. `SAPRead` — Read any SAP object
```
Read source code, table structures, table contents, package contents,
class metadata, message class texts, system information, or object metadata
from SAP. Handles ABAP programs, classes, interfaces, function modules,
CDS views, DDIC tables, and more.

Parameters:
  type: PROG | CLAS | INTF | FUNC | FUGR | INCL | DDLS | BDEF | SRVD
        | TABLE | TABLE_CONTENTS | PACKAGE | SYSTEM | COMPONENTS | MESSAGES
  name: Object name
  options: {
    method?: string      — Return only this method block (CLAS only)
    include?: string     — Class include: definitions, implementations, macros, testclasses
    parent?: string      — Function group name (FUNC only)
    max_rows?: number    — Max rows for TABLE_CONTENTS (default 100)
    sql_query?: string   — ABAP SQL filter for TABLE_CONTENTS
  }
```
**Replaces:** GetSource, GetProgram, GetClass, GetInterface, GetFunction, GetInclude,
GetTable, GetTableContents, GetPackage, GetSystemInfo, GetInstalledComponents,
GetFunctionGroup, GetClassInfo, GetMessages, GetClassInclude

---

#### 2. `SAPSearch` — Find objects in SAP
```
Search for ABAP objects by name pattern, search within source code
(grep), or find all objects in a package. Use this to discover what
exists in the system before reading or modifying.

Parameters:
  query: Name pattern (ZCL_*, Z*ORDER*) or regex for source_text scope
  scope: object | source_text
  object_type?: CLAS | PROG | INTF | FUNC | ... (optional filter)
  packages?: string[]   — Package(s) to search within (required for source_text)
  include_subpackages?: boolean — Recursively search subpackages (default false)
  case_insensitive?: boolean
  max_results?: number
```
**Replaces:** SearchObject, GrepObjects, GrepPackages

---

#### 3. `SAPWrite` — Write/create ABAP source
```
Create or update ABAP source code. Automatically handles locking,
writing, activation, and unlocking. For new objects, creates them first.
Supports surgical string replacement (edit mode) for precise changes.
NOT available in read-only mode.

Parameters:
  type: PROG | CLAS | INTF | DDLS | BDEF | SRVD
  name: Object name
  source: ABAP source code (full source for create/overwrite)
  mode?: create | update | edit (default: auto-detect)
  package?: string       — Required for new objects
  description?: string   — Required for new objects
  include?: string       — Class include to write (definitions, implementations, etc.)
  find?: string          — For edit mode: text to find
  replace?: string       — For edit mode: replacement text
  transport?: string     — Transport request (for transportable packages)
```
**Replaces:** WriteSource, EditSource, CreateObject, UpdateClassInclude
**Hidden in read-only mode**

---

#### 4. `SAPActivate` — Activate/validate ABAP objects
```
Check syntax, activate objects, run unit tests, or run ATC quality checks.
Use after writing source code to make changes effective. Syntax check and
unit tests run without modifying objects (safe in read-only).
Activation makes changes live (blocked in read-only).

Parameters:
  action: syntax_check | activate | activate_package | run_tests | atc_check
  type: Object type
  name: Object name (or package name for activate_package/run_tests)
```
**Replaces:** SyntaxCheck, Activate, ActivatePackage, RunUnitTests, RunATCCheck
**`activate` and `activate_package` hidden in read-only mode; syntax_check, run_tests, atc_check always available**

---

#### 5. `SAPNavigate` — Navigate code relationships
```
Find where a symbol is defined, find all references to it, browse the object
structure tree, or get CDS view dependency chains. Essential for understanding
unfamiliar codebases. Also provides call graph analysis (who calls what).

Parameters:
  action: find_definition | find_references | object_structure
        | dependencies | call_graph | callers | callees
  type: Object type
  name: Object name
  line?: number          — Source line for find_definition
  column?: number        — Source column for find_definition
  source?: string        — Source code context for find_definition
  max_depth?: number     — For call_graph/callers/callees (default 3)
```
**Replaces:** FindDefinition, FindReferences, GetObjectStructure, GetCDSDependencies,
GetCallGraph, GetCallersOf, GetCalleesOf, AnalyzeCallGraph

---

#### 6. `SAPQuery` — Query SAP database
```
Execute SQL queries against SAP database tables using ABAP SQL syntax.
IMPORTANT: Uses ABAP SQL, NOT standard SQL.
Use ASCENDING/DESCENDING instead of ASC/DESC. Use max_rows parameter
instead of LIMIT. GROUP BY and WHERE work normally.
Can be blocked entirely via --block-free-sql flag for safety.

Parameters:
  sql: ABAP SQL SELECT statement
  max_rows: Maximum rows (default 100)
```
**Replaces:** RunQuery
**Can be blocked via `--block-free-sql` flag**

---

#### 7. `SAPTransport` — Work with CTS transports
```
List, inspect, create, or release CTS transport requests. Transport
write operations (create, release, delete) are disabled by default and
must be explicitly enabled via --enable-transports flag.

Parameters:
  action: list | get | create | release | delete
  transport?: string     — Transport number (for get/release/delete)
  user?: string          — Filter by user (for list, default: current user, '*' for all)
  description?: string   — Description (for create)
```
**Replaces:** ListTransports, GetTransport, CreateTransport, ReleaseTransport, DeleteTransport
**Write operations (create, release, delete) require `--enable-transports` flag**

---

#### 8. `SAPContext` — Get rich context for AI analysis
```
Get compressed context for one or more objects including their source,
type signatures of dependencies, and usage patterns. Optimized to
provide maximum useful information within token limits. Use before
asking questions about unfamiliar code. Results are cached — repeated
calls for the same objects return instantly.

Parameters:
  objects: List of "TYPE NAME" pairs (e.g. ["CLAS ZCL_ORDER", "INTF ZIF_ORDER"])
  depth: Dependency expansion depth (1-3, default 1)
```
**Replaces:** GetContext
**Backed by:** `pkg/ctxcomp` (compression) + `pkg/cache` (caching)

---

#### 9. `SAPLint` — Static ABAP code analysis
```
Run deterministic static analysis on ABAP source code using abaplint rules.
Returns structured findings: naming violations, obsolete statements, clean core
violations. Use this BEFORE asking the LLM to review code — get objective
rule-based findings first, then use AI for judgment calls.

Critical for S/4HANA conversion projects: identifies code that will break
when moving to S/4HANA or ABAP Cloud.

Configurable rule sets:
  - clean_core: Detect clean core violations (critical for S/4 conversion)
  - naming: Naming convention violations (class/method/variable patterns)
  - obsolete: Deprecated ABAP statements (MOVE, COMPUTE, SELECT *, etc.)
  - all: All rules (default)

Parameters:
  type: Object type (CLAS, PROG, INTF, ...)
  name: Object name
  rules?: Rule set to apply (clean_core | naming | obsolete | all)
  source?: string — Optional: lint provided source instead of fetching from SAP
```
**Replaces:** ad-hoc LLM code review for rule-based issues
**Backed by:** `pkg/abaplint` (Go-native lexer/parser)

---

#### 10. `SAPDiagnose` — Runtime diagnostics
```
Investigate runtime errors (short dumps), performance traces (ABAP profiler),
and SQL traces (ST05). Essential for enterprise operations: "why did this
program crash?" or "why is this report slow?"

Parameters:
  action: list_dumps | get_dump | list_traces | get_trace
        | sql_trace_state | list_sql_traces
  dump_id?: string       — Dump ID (for get_dump)
  trace_id?: string      — Trace ID (for get_trace)
  user?: string          — Filter by user
  program?: string       — Filter by program
  date_from?: string     — Start date YYYYMMDD
  date_to?: string       — End date YYYYMMDD
  max_results?: number   — Limit results (default 100)
```
**Replaces:** ListDumps, GetDump, ListTraces, GetTrace, GetSQLTraceState, ListSQLTraces

---

#### 11. `SAPManage` — Object lifecycle management (write-gated)
```
Create packages, delete objects, move objects between packages, create
DDIC tables, or manage file-based import/export. All operations are
blocked in read-only mode.

Parameters:
  action: create_package | delete | move | create_table
        | export_to_file | import_from_file | compare_source
  type?: Object type
  name?: Object name
  package?: string       — Target package
  description?: string   — For create operations
  output_dir?: string    — For export_to_file
  transport?: string     — Transport request
```
**Replaces:** CreatePackage, DeleteObject, MoveObject, CreateTable,
ExportToFile, ImportFromFile, CompareSource, CloneObject
**Hidden in read-only mode**

---

### Read-Only Mode Behavior

When `--read-only` (or `SAP_READ_ONLY=true`):

| Tool | Behavior |
|------|----------|
| `SAPRead` | Fully available |
| `SAPSearch` | Fully available |
| `SAPWrite` | **Not registered** (invisible to LLM) |
| `SAPActivate` | Only `syntax_check`, `run_tests`, `atc_check` — `activate`/`activate_package` blocked |
| `SAPNavigate` | Fully available |
| `SAPQuery` | Available (controlled separately by `--block-free-sql`) |
| `SAPTransport` | Only `list` and `get` actions |
| `SAPContext` | Fully available |
| `SAPLint` | Fully available |
| `SAPDiagnose` | Fully available |
| `SAPManage` | **Not registered** (invisible to LLM) |

In read-only mode: **9 tools visible**, 0 write capability. The LLM cannot even see write tools exist.

---

## Test Foundation

Two-layer strategy: mock-based unit tests (no SAP needed, fast, run in CI) + integration tests against a real ABAP 2023 trial system for edge cases and regressions.

### Layer 1 — Unit Tests (Mock SAP, no live system)

Based on the foundation from [PR #66](https://github.com/oisee/vibing-steampunk/pull/66).

```
internal/mcp/
  testhelpers_test.go          // Mock SAP HTTP server, request recording, fixture loader
  handlers_read_test.go        // SAPRead scenarios
  handlers_write_test.go       // SAPWrite scenarios
  handlers_search_test.go      // SAPSearch scenarios
  handlers_activate_test.go    // SAPActivate scenarios
  handlers_navigate_test.go    // SAPNavigate scenarios
  handlers_query_test.go       // SAPQuery scenarios
  handlers_transport_test.go   // SAPTransport scenarios
  handlers_context_test.go     // SAPContext scenarios
  handlers_lint_test.go        // SAPLint scenarios
  handlers_diagnose_test.go    // SAPDiagnose scenarios
  handlers_manage_test.go      // SAPManage scenarios
  server_mode_test.go          // Read-only mode, tool registration, safety checks
  server_transport_test.go     // HTTP transport (existing)
```

Principles:
1. **No live SAP required** — mock HTTP server intercepts all ADT calls, returns fixture XML responses
2. **Table-driven** — each tool: happy path, empty result, SAP error response (401/403/404/500), malformed XML
3. **Read-only mode** — verify write tools are not registered; verify read-only tool restrictions
4. **Tool count regression** — assert exact tool count per mode (so additions are intentional)
5. **Safety checks** — read-only blocks writes, block-free-sql blocks SAPQuery, allowed-packages restricts scope

### Layer 2 — Integration Tests (ABAP 2023 Trial System)

Target: SAP ABAP Platform 2023 trial (available from SAP's trial program).
Build tag: `integration` (existing pattern, `go test -tags=integration`).

#### Regression Tests from Closed Issues

These bugs were fixed but have no automated tests — they will regress without coverage:

| Issue | Test scenario |
|-------|--------------|
| [#70](https://github.com/oisee/vibing-steampunk/issues/70) | `CreateTransport` on S/4HANA 757 — correct endpoint and content-type |
| [#52](https://github.com/oisee/vibing-steampunk/issues/52) | `SyntaxCheck` with long namespaced class name (>30 chars) |
| [#71](https://github.com/oisee/vibing-steampunk/issues/71) | `CreatePackage` with empty/blank transport string |
| [#54](https://github.com/oisee/vibing-steampunk/issues/54) | `SAP_ALLOWED_PACKAGES` does not block install-style operations |

#### Open Bug Tests (reproduce + fix)

| Issue | Test scenario |
|-------|--------------|
| [#56](https://github.com/oisee/vibing-steampunk/issues/56) | `CreateObject` for PROG type — create new program end-to-end |
| [#26](https://github.com/oisee/vibing-steampunk/issues/26) | `GetTransport` where transport exists but response parsing fails |
| [#34](https://github.com/oisee/vibing-steampunk/issues/34) | `GetTableContents` pagination: request page 2, verify offset |

#### Feature/Edge Case Tests

| Issue | Test scenario |
|-------|--------------|
| [#74](https://github.com/oisee/vibing-steampunk/issues/74) | `GetSource` with DDLX/EX object type (CDS metadata extension) |
| [#75](https://github.com/oisee/vibing-steampunk/issues/75) | ABAP 758 trial compatibility — basic read ops work on newer runtime |

#### Standard Integration Coverage (existing pattern, expand)

```
pkg/adt/integration_test.go  // existing 34 tests
  + TestCreateProgram_EndToEnd        // #56
  + TestGetTransport_ParsesCorrectly  // #26
  + TestGetTableContents_Pagination   // #34
  + TestSyntaxCheck_LongNamespace     // #52
  + TestCreateTransport_S4H757        // #70
  + TestCreatePackage_BlankTransport  // #71
```

### CI Setup

```yaml
# .github/workflows/test.yml
jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.23'
      - run: go test ./...   # mock-only, always runs
      - run: go build -o /dev/null ./cmd/vsp  # verify build

  integration:
    runs-on: ubuntu-latest
    if: github.event_name == 'workflow_dispatch' || github.ref == 'refs/heads/main'
    environment: sap-trial   # secrets: SAP_URL, SAP_USER, SAP_PASSWORD, SAP_CLIENT
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.23'
      - run: go test -tags=integration -v -count=1 ./pkg/adt/
        env:
          SAP_URL: ${{ secrets.SAP_URL }}
          SAP_USER: ${{ secrets.SAP_USER }}
          SAP_PASSWORD: ${{ secrets.SAP_PASSWORD }}
          SAP_CLIENT: ${{ secrets.SAP_CLIENT }}
```

---

## Microsoft Copilot Studio Integration

### Transport
Use `--transport http-streamable` with `--http-addr 0.0.0.0:8080`.

Copilot Studio connects via the MCP REST endpoint at `/mcp`.

### Authentication Mapping
Copilot Studio passes credentials via environment or headers. The connector uses:
- `SAP_URL`, `SAP_USER`, `SAP_PASSWORD` (env vars) — single-user Docker deployment
- Or `SAP_COOKIE_STRING` for SSO/cookie-based auth (useful for enterprise SSO)


### Deployment Pattern
```yaml
# Docker Compose for enterprise deployment
services:
  vsp:
    image: ghcr.io/marianfoo/arc-1:latest
    ports:
      - "8080:8080"
    environment:
      SAP_URL: https://sap-host:44300
      SAP_USER: ${SAP_USER}
      SAP_PASSWORD: ${SAP_PASSWORD}
      SAP_CLIENT: "100"
      SAP_READ_ONLY: "true"          # Safe default
      SAP_BLOCK_FREE_SQL: "true"     # No free SQL in enterprise
      SAP_TRANSPORT: http-streamable
      SAP_HTTP_ADDR: 0.0.0.0:8080
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8080/health"]
      interval: 30s
      timeout: 5s
      retries: 3
```

### Module Name Change
The Go module is still `github.com/oisee/vibing-steampunk`. This should be updated to `github.com/marianfoo/arc-1` as part of the fork takeover.

This is a mechanical change: update `go.mod` and find+replace all import paths across every `.go` file. Also update `Dockerfile`, `README.md`, `.goreleaser.yml`, `.github/workflows/`.

---

## Implementation Phases

### Phase 1 — Cleanup (Remove experimental features)
**Scope:** Remove packages, handlers, CLI files, embedded resources, and ADT WebSocket code.

Steps:
1. Remove packages: `pkg/wasmcomp/`, `pkg/ts2abap/`, `pkg/scripting/`, `pkg/dsl/`
2. Remove `internal/lsp/`
3. Remove CLI files: `devops.go`, `debug.go`, `lua.go`, `lsp.go`, `workflow.go`, `copy_cmd.go`, `cli_compile.go`, `cli_deps.go`, `cli_extra.go`
4. Remove handler files: `handlers_amdp.go`, `handlers_debugger.go`, `handlers_debugger_legacy.go`, `handlers_install.go`, `handlers_report.go`, `handlers_git.go`, `handlers_workflow.go`, `handlers_deploy.go`, `handlers_help.go`, `handlers_servicebinding.go`, `tools_aliases.go`
5. Remove ADT WebSocket files: `pkg/adt/websocket*.go`, `pkg/adt/amdp_websocket.go`, `pkg/adt/amdp_debugger.go`, `pkg/adt/debugger.go`, `pkg/adt/git.go`, `pkg/adt/reports.go`
6. Remove embedded resources: `embedded/abap/wasm_compiler/`, `embedded/deps/abapgit-*.zip`, `embedded/deps/abaplint-lexer.zip`. Trim or remove `embedded/deps/embed.go`
7. Remove `server.go` fields: `amdpWSClient`, `debugWSClient`, `ensureAMDPWSClient()`, `ensureDebugWSClient()` and initialization code
8. Remove `package.json`, `package-lock.json` (npm deps for ts2abap)
9. Update `go.mod` — remove: `gopher-lua` (Lua), `gorilla/websocket` (WebSocket). Keep: `mattn/go-sqlite3` (cache)
10. Update `tools_register.go` and `tools_focused.go` — remove references to deleted handlers/tools
11. Run `go test ./...` — must be all green
12. Run `go build -o vsp ./cmd/vsp` — verify smaller binary

**Success criteria:** All tests pass, build works, no import of removed packages anywhere.

### Phase 2 — Module Rename
**Scope:** Rename Go module from `github.com/oisee/vibing-steampunk` to `github.com/marianfoo/arc-1`

Steps:
1. Update `go.mod` module path
2. Mass find+replace all import paths across every `.go` file
3. Update `Dockerfile`, `README.md`, `.goreleaser.yml`, `.github/workflows/`
4. `go mod tidy && go test ./...`

**Note:** This touches every `.go` file but is entirely mechanical.

### Phase 3 — New Tool Surface (10–11 tools)
**Scope:** Redesign from ~80 tools to 10–11 intent-based tools

Steps:
1. Design new tool schemas with full parameter definitions and rich descriptions
2. Implement new handler files — each new tool delegates to existing handler functions
3. Redesign `tools_register.go` — register only the new tools, implement read-only gating
4. Implement per-tool read-only restrictions (some tools hidden, some actions restricted)
5. Keep existing handler functions as internal implementation — the new tools are routing wrappers
6. Keep `hyperfocused` mode (single SAP tool) as a fallback/alternative

**Deliverable:** New tool registration with 10–11 tools; old individual tool names removed from registration but handler code preserved as internal functions.

### Phase 4 — Test Foundation
**Scope:** Comprehensive test suite, no live SAP required for unit tests

Steps:
1. Create/expand `testhelpers_test.go` with mock SAP HTTP server and XML fixture loader
2. Add unit tests for all 10–11 new tools (3–5 cases each: happy, empty, error, edge)
3. Add read-only mode tests (tool visibility, action restrictions)
4. Add tool registration regression tests (exact count assertions per mode)
5. Add safety tests (block-free-sql, allowed-packages, read-only)
6. Fix/complete tests from PR #66
7. Set up integration test framework for ABAP 2023 trial

**Target:** 100+ unit tests (all passing without SAP), integration test suite ready for trial system

### Phase 5 — Enterprise Hardening
**Scope:** Production-readiness for Docker/Kubernetes deployment

Steps:
1. Health check endpoint at `/health` (for container orchestration)
2. Structured logging (JSON format for enterprise log aggregation, e.g. ELK/Splunk)
3. Request timeout configuration (prevent long-running SAP calls from blocking)
4. Update Dockerfile: multi-stage build, non-root user, health check, minimal image
5. GitHub Actions: CI pipeline with unit tests on every push, Docker publish to GHCR on tag
6. (Future) OAuth2/SAML auth support for enterprise SSO
7. (Future) OpenTelemetry tracing for observability

---

## File Structure (Target)

```
cmd/vsp/
  main.go              # Entry point + MCP server flags + env config
  config_cmd.go        # Config init/show/validate
  cli.go               # Optional: minimal CLI for admin convenience
  main_test.go         # CLI argument tests

internal/mcp/
  server.go            # Server struct, Serve(), transport setup
  config.go            # Config struct
  tools.go             # Tool registration (10-11 tools, read-only gating)
  sap_read.go          # SAPRead handler
  sap_write.go         # SAPWrite handler
  sap_search.go        # SAPSearch handler
  sap_activate.go      # SAPActivate handler
  sap_navigate.go      # SAPNavigate handler
  sap_query.go         # SAPQuery handler
  sap_transport.go     # SAPTransport handler
  sap_context.go       # SAPContext handler
  sap_lint.go          # SAPLint handler
  sap_diagnose.go      # SAPDiagnose handler
  sap_manage.go        # SAPManage handler
  sap_universal.go     # SAP universal tool (hyperfocused mode)
  helpers.go           # Shared handler utilities
  *_test.go            # Per-handler unit tests

pkg/adt/               # ADT HTTP client (trimmed: no WebSocket, no debugger)
  client.go            # HTTP client, read operations
  crud.go              # CRUD operations
  devtools.go          # Syntax check, activation, unit tests
  codeintel.go         # Find definition, find references
  http.go              # HTTP transport, CSRF tokens
  config.go            # ADT configuration
  safety.go            # Safety checks
  features.go          # Feature detection
  xml.go               # XML types
  cookies.go           # Cookie auth
  cds.go               # CDS dependencies
  transport.go         # CTS transport operations
  ui5.go               # UI5 read operations
  workflows_*.go       # Source/edit/grep/fileio/execute workflows

pkg/abaplint/          # ABAP lexer + statement parser (clean core linting)
pkg/ctxcomp/           # Context compression (dependency contracts)
pkg/cache/             # In-memory + SQLite caching
pkg/config/            # System profile configuration
```

---

## Dependency Summary (go.mod after cleanup)

**Keep:**
| Dependency | Reason |
|-----------|--------|
| `mark3labs/mcp-go` | MCP protocol implementation |
| `spf13/cobra` | CLI framework |
| `spf13/viper` | Configuration management |
| `joho/godotenv` | .env file loading |
| `mattn/go-sqlite3` | SQLite cache backend |
| `gopkg.in/yaml.v3` | YAML config parsing |

**Remove:**
| Dependency | Reason |
|-----------|--------|
| `yuin/gopher-lua` | Lua scripting engine — removed |
| `gorilla/websocket` | WebSocket client for ZADT_VSP — removed |
| npm/node (`package.json`) | ts2abap transpiler — removed |

---

## Summary

| Metric | Current | Target |
|--------|---------|--------|
| Tools (default) | 81 | 10–11 |
| Tools (read-only) | ~46 | 9 (write tools hidden) |
| Go packages | 11 | 6 (adt, config, ctxcomp, cache, abaplint, mcp) |
| CLI commands | ~15 subcommands | 2 (serve, config) |
| LOC (approx) | ~35,000 | ~15,000 |
| Handler files | 25 | 18 (keep as implementation, wrap in new tools) |
| Unit tests | ~244 | 350+ (mock-based, no SAP) |
| Integration tests | ~34 | 50+ (ABAP 2023 trial) |
| External deps | sqlite3, Lua, WebSocket, npm | sqlite3 only |
| Transport | stdio + http-streamable | http-streamable primary, stdio kept |
| Binary size | ~16 MB | ~10 MB (estimate) |

The result is a focused, enterprise-deployable connector that does one thing well: connect Microsoft Copilot Studio to SAP ABAP systems safely and reliably.
