# Feature Parity Implementation: Best of All MCP ADT Tools

**Date:** 2026-03-24
**Report ID:** 001
**Subject:** Implementing missing features from fr0ster/mcp-abap-adt into vsp
**Related Documents:** 2026-03-13-002-feature-comparison-vsp-vs-adt-fr0ster.md

---

## Objective

Combine the best features from all MCP ADT tools into vsp (Go), making it the definitive enterprise MCP connector for SAP ABAP systems. Stay on Go for single-binary distribution, performance, and operational simplicity.

## Research Findings

### fr0ster's "ABAP AST" and "Semantic Analysis"

**Important discovery:** These are NOT server-side ADT features. They are client-side regex-based parsers (`SimpleAbapASTGenerator`, `SimpleAbapSemanticAnalyzer`). vsp already has a **superior** Go-native abaplint lexer port (48 token types, 100% oracle-verified, ~3.5M tokens/sec). No implementation needed.

### Features to Implement

| # | Feature | ADT Endpoint | Priority | Effort |
|---|---------|-------------|----------|--------|
| 1 | Where-Used Analysis | `/sap/bc/adt/repository/informationsystem/usageReferences` | High | Low |
| 2 | Enhancement Framework (3 tools) | `/sap/bc/adt/enhancements/enhsxsb/{spot}` | High | Medium |
| 3 | Domain CRUD | `/sap/bc/adt/ddic/domains` | Medium | Medium |
| 4 | DataElement CRUD | `/sap/bc/adt/ddic/dataelements` | Medium | Medium |
| 5 | DDLX (Metadata Extension) | `/sap/bc/adt/ddic/ddlx/sources` | Medium | Low |
| 6 | JWT/XSUAA Auth | OAuth2 flow | High | High |
| 7 | Service Key Auth | File-based OAuth | High | Medium |
| 8 | Object-specific Validation | `/sap/bc/adt/ddic/{type}/validation` | Low | Low |

### Features vsp Already Has (Advantage)

- Native Go abaplint lexer (superior to fr0ster's regex AST)
- Context compression (reduces SAP round-trips)
- SQLite caching (long-running Docker deployments)
- Safety system (operation filtering, package restrictions)
- Hyperfocused mode (99.5% token reduction)
- Call graph analysis (static + runtime comparison)
- ABAP profiler integration (ListTraces, GetTrace)
- SQL trace integration (ST05)
- Runtime error analysis (ListDumps, GetDump)
- Single binary (no Node runtime)

## Implementation Plan

### Phase 1: Where-Used Analysis (Low effort, high value)

**ADT Client:** `pkg/adt/codeintel.go`
- `GetWhereUsed(ctx, objectURI, enableAllTypes)` — 2-step scope-based API
- Step 1: POST to `.../usageReferences/scope` to get available object types
- Step 2: POST to `.../usageReferences` with scope filter

**MCP Handler:** `internal/mcp/handlers_codeintel.go`
- `handleGetWhereUsed` — New tool with `object_url`, `object_type`, `enable_all_types` params

### Phase 2: Enhancement Framework (Medium effort, enterprise value)

**ADT Client:** New file `pkg/adt/enhancements.go`
- `GetEnhancementSpot(ctx, spotName)` — GET enhancement spot metadata
- `GetEnhancements(ctx, objectURL, objectType)` — GET enhancement elements for objects
- `GetEnhancementImpl(ctx, spotName, implName)` — GET enhancement implementation source

**MCP Handler:** New file `internal/mcp/handlers_enhancements.go`
- 3 tools: `GetEnhancementSpot`, `GetEnhancements`, `GetEnhancementImpl`

### Phase 3: DDIC CRUD (Domain, DataElement, DDLX)

**ADT Client:** New file `pkg/adt/ddic.go`
- Domain: Create/Read/Update/Delete/Validate via `/sap/bc/adt/ddic/domains`
- DataElement: Create/Read/Update/Delete/Validate via `/sap/bc/adt/ddic/dataelements`
- DDLX: Create/Read/Update/Delete/Validate via `/sap/bc/adt/ddic/ddlx/sources`

**MCP Handlers:** New file `internal/mcp/handlers_ddic.go`
- CRUD tools for each DDIC type with proper safety checks

### Phase 4: JWT/XSUAA + Service Key Auth

**Auth Package:** New file `pkg/adt/oauth.go`
- OAuth2 client_credentials flow for XSUAA
- Service key file parsing (ABAP + BTP formats)
- Token caching and auto-refresh
- Integration with existing Transport

### Phase 5: CI Update

Update `.github/workflows/test.yml`:
- Run integration tests on every PR (not just manual dispatch)
- Use `sap-trial` environment with GitHub secrets

## Test Strategy (TDD)

Each feature gets:
1. **Unit tests** with mock HTTP server (no SAP needed)
2. **Integration tests** (tagged `integration`, needs SAP system)
3. **XML fixture files** for response parsing tests

---

## Decisions

- **Skip ABAP AST / Semantic Analysis**: vsp's abaplint lexer is superior
- **Skip RFC Connection**: Legacy, HTTP-only is sufficient for modern systems
- **Keep Go**: Single binary, performance, enterprise ops advantage
- **Auth priority**: JWT/XSUAA is critical for BTP customers
