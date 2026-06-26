# DassianInc/dassian-adt — Competitive Overview

> **Repo**: https://github.com/DassianInc/dassian-adt  
> **MCPB**: https://github.com/albanleong/abap-mcpb  
> **Language**: TypeScript (compiled JS) | **License**: MIT  
> **Stars**: 33 | **Forks**: 7 | **Issues**: 0 (no public issue tracker)  
> **Last commit**: 2026-04-14 | **Last updated**: 2026-04-16

---

## Stats

| Metric | Value |
|--------|-------|
| Total commits tracked | ~38 (from initial to 6f9d20b) |
| Evaluated | 38 |
| High priority findings | 3 (OAuth/multi-system/abap_run) |
| Medium priority findings | 6 |
| ARC-1 bugs found via comparison | 0 (but validates ARC-1 patterns are superior) |
| abap-adt-api library workarounds | 6+ |

---

## High Priority Items

| Item | Decision | ARC-1 Action |
|------|----------|--------------|
| OAuth per-user SAP auth (6f9d20b, 2026-04-14) | monitor | ARC-1 uses BTP-external auth (XSUAA/OIDC/PP) — different architecture. More enterprise-grade. |
| abap_run endpoint: `POST /sap/bc/adt/oo/classrun/{name}` | evaluate | Not planned — security risk. If ever implemented, needs OperationType.Execute + elicitation. |
| FEAT-18 reference impl: `Promise.all()` over objectstructure hrefs | implement | Implement function group bulk fetch in ARC-1 (P1 roadmap item). |

## Medium Priority Items

| Item | Decision | ARC-1 Action |
|------|----------|--------------|
| Multi-system via SAP UI Landscape XML (`SAPUILandscapeGlobal.xml`) | evaluate | Not planned (P3: OPS-03). BTP Destination Service is ARC-1's equivalent. |
| DdicHandlers: ddic_element (DDIC metadata + CDS annotations) | verify | ARC-1 reads DDIC types individually. ddic_element provides richer metadata including associations. Consider for FEAT-43. |
| TraceHandlers: 8 tools (full profiler workflow) | docs/compare | ARC-1 has traces via SAPDiagnose. 8 dedicated tools vs 1 action — coverage may overlap. |
| Transport: 9 tools including set_owner/add_user/delete | docs/compare | ARC-1 has transport operations via SAPTransport. 9 vs ARC-1's subset — check coverage. |
| Session management: multiple lock/session bug fixes | verify | Validates ARC-1's withStatefulSession() is architecturally superior to abap-adt-api library approach. |
| Null DATE columns in query results crash | verify | Verify ARC-1 RunQuery handles null DATE values gracefully. |

---

## ADT API Patterns Discovered

### `abap_run` (Execute ABAP)
- Endpoint: `POST /sap/bc/adt/oo/classrun/{className}` with `Accept: text/plain`
- Auto-detects interface method: reads `/sap/bc/adt/oo/interfaces/if_oo_adt_classrun/source/main` to determine `~run` vs `~main`
- Full lifecycle: create temp class → lock/write/unlock → activate → POST classrun → delete (best-effort)
- Response: plain text output from IF_OO_ADT_CLASSRUN

### `abap_get_function_group` (Parallel Fetch)
- Endpoint: `GET /sap/bc/adt/functions/groups/{encoded}/objectstructure`
- Parses `atom:link` hrefs for includes and function modules
- `Promise.all()` over all discovered source links
- Exact pattern for ARC-1's FEAT-18 implementation

### `abap_pretty_print` (Code Formatting)
- Endpoint: via abap-adt-api `adtclient.prettyPrinter()` 
- ADT endpoint: `POST /sap/bc/adt/programs/programs/{name}/prettyprinter` or equivalent
- Returns formatted source code

### `abap_revisions` (Source Version History)
- Via abap-adt-api `adtclient.objectVersion()` / revision history API
- ADT endpoint: `/sap/bc/adt/programs/programs/{name}/versions` or similar

### `ddic_element` (DDIC Metadata)
- Via `adtclient.ddicElement()` 
- Returns field names, types, key flags, data element labels, lengths, decimals, CDS annotations
- Supports association resolution and extension views

### `ddic_references` (Impact Analysis)
- Via `adtclient.ddicRepositoryAccess()`
- Lists objects referencing a given entity

---

## abap-adt-api Library Workarounds in dassian-adt

| Commit | Workaround | ARC-1 Implication |
|--------|-----------|-------------------|
| `9186ffd` | Wrong SRVD/SRVB ADT paths in library → patched | Verify ARC-1 SRVD/SRVB endpoint URLs |
| `9027549` | Batch activation breaks with array form → bypass | ARC-1 uses custom HTTP for activation — not affected |
| `98acfe0` | Error classification maps activation errors to SM12 → fixed | ARC-1 custom error handling avoids this |
| `dc28400` | 500 response body swallowed by library → surfaced | ARC-1 always captures body |
| `e171509` | Class includes get wrong `/source/main` suffix → reverted | ARC-1 builds include URLs manually |
| Multiple | Session management: dead session cycles, 400 detection | ARC-1's withStatefulSession() more robust |

**Key finding:** Using abap-adt-api as the HTTP layer introduces library-level fragilities that require workarounds. ARC-1's fully custom HTTP layer (undici + adt/http.ts) avoids all of these.

---

## abap-mcpb (albanleong) Assessment

| Metric | Value |
|--------|-------|
| Stars | 0 |
| Commits | 1 (initial only) |
| Status | Dormant |
| Base version | dassian-adt v2.0 (frozen snapshot — 25 tools) |
| Custom files | QualityHandlers.js (enhanced ATC), index.js (global error handlers) |
| Behind dassian-adt | 28+ tools, OAuth, multi-system |

MCPB format is interesting for ARC-1 user adoption (zero-build-step Claude Desktop install), but abap-mcpb itself is not a competitive threat.

---

## Features dassian-adt Has That ARC-1 Lacks

| Feature | Priority | Status |
|---------|----------|--------|
| Execute ABAP (`abap_run`) | Medium | Not planned — security risk |
| PrettyPrint | P1 (FEAT-10) | On roadmap |
| Source version/revision history | P1 (FEAT-20) | On roadmap |
| Multi-system (SAP UI Landscape XML) | P3 (OPS-03) | Future |
| gCTS integration (2 tools) | P2 (FEAT-22) | On roadmap |
| Browser OAuth login page | Low | ARC-1 has BTP-native approach |
| MCPB one-click install | Low | Not planned |
| ddic_element (richer DDIC metadata) | P2 (FEAT-43) | On roadmap |

## Features ARC-1 Has That dassian-adt Lacks

Safety system (read-only/op filter/pkg filter/SQL block/transport gating/dry-run), BTP Destination Service, Principal Propagation, Cloud Connector proxy, OIDC/JWT validation, API key auth, abaplint (local offline linting), SQLite + memory caching, audit logging, context compression (SAPContext 7-30x), method-level surgery (95% reduction), hyperfocused mode (~200 tokens), DDLX read/write, AFF schema validation, multi-object batch creation, MCP scope system (scopes×roles×safety), CDS dependency extraction, feature auto-detection (7 probes), BTP CF deployment (MTA), npm/Docker distribution, 1315+ unit tests vs 163, error intelligence (SAP-domain classification), GetProgFullCode (include traversal via nodestructure API), Enhancement/BAdI read.

---

_Last updated: 2026-04-16_
