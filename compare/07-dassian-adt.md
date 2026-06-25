# DassianInc/dassian-adt

> **Repository**: https://github.com/DassianInc/dassian-adt
> **Successor/MCPB**: https://github.com/albanleong/abap-mcpb (MCPB format for Claude Desktop)
> **Language**: TypeScript / JavaScript | **License**: MIT | **Stars**: 5 (was 33 — the repo was toggled private→public in 2026-06, which resets GitHub's star count; not a loss of interest) | **Forks**: 7
> **Status**: **Active** — 11 new commits May–Jun 2026 resumed after the April sprint (transport/DDIC hardening, TTYP, ToC bundling, pre-release inactive check, BSP handlers, self-correcting query hints)
> **Relationship**: Fork of mario-andreschak's wrapper → dassian rewrite → enterprise-grade MCP server
> **Deep analysis**: See [07-dassian-adt-updated.md](07-dassian-adt-updated.md) for full implementation internals

---

## Project Overview

A rapidly maturing MCP server building on the `abap-adt-api` library (v7.1.2 by Marcello Urbani) with **53 tools**. Key differentiators: heavy use of **MCP elicitation** for interactive parameter collection, extensive **error intelligence** with self-correction hints, **OAuth 2.0 per-user SAP authentication**, **multi-system support** via SAP UI Landscape XML auto-discovery, and a unique `abap_run` tool for direct ABAP execution.

Backed by Dassian Inc. (commercial entity). MIT licensed. Includes Azure App Service deployment support and GitHub Pages documentation for all 53 tools. **Has gone from 0 stars to 32 stars in 2 weeks** — fastest-growing competitor.

## Architecture

```
src/
  server.ts          # MCP server setup (stdio + HTTP)
  handlers/
    BaseHandler.ts   # Input validation, session recovery, error formatting
    SourceHandlers   # get/set source, function group bulk, edit method, class includes
    ObjectHandlers   # CRUD, search, activation, batch activation
    RunHandlers      # ABAP execution via IF_OO_ADT_CLASSRUN
    TransportHandlers # CTS operations (create/assign/release/list/info/contents)
    DataHandlers     # SQL queries, table contents
    QualityHandlers  # Syntax check, ATC, where-used, fix proposals, unit tests
    GitHandlers      # gCTS repos, pull
    SystemHandlers   # login, health, dumps, raw HTTP, traces
    DiagnosticHandlers # Profiler traces, inactive objects
    DDICHandlers     # Domain, data element, annotation definitions
```

All handlers delegate to `abap-adt-api` v7.1.2.

## Tool Inventory (53 tools — April 2026)

### Source (5)
| Tool | Description |
|------|-------------|
| `abap_get_source` | Read source code by name + type |
| `abap_set_source` | Write with auto lock/unlock, transport elicitation |
| `abap_set_class_include` | Write specific class includes (definitions, implementations, testclasses) |
| `abap_edit_method` | Surgical method-level editing with elicitation recovery |
| `abap_get_function_group` | Fetch ALL includes + FMs in one call (parallel fetch) |

### Object (6)
| Tool | Description |
|------|-------------|
| `abap_create` | Create objects (16 type auto-mappings, package elicitation, BDEF support) |
| `abap_delete` | Delete with elicitation confirmation for non-$TMP, corrNr on DELETE |
| `abap_activate` | Activate with inactive-dependents elicitation |
| `abap_activate_batch` | Batch activation for multiple objects |
| `abap_search` | Wildcard search |
| `abap_object_info` | Metadata (package, transport layer, active/inactive) |

### Run (1)
| Tool | Description |
|------|-------------|
| `abap_run` | Create temp class → execute via IF_OO_ADT_CLASSRUN → capture output → cleanup |

### Transport (6)
transport_create (K/W/T types, auto-classify tasks), transport_assign (with task number resolution), transport_release (with elicitation, ignoreAtc), transport_list, transport_info, transport_contents

### Data (2)
| Tool | Description |
|------|-------------|
| `abap_query` | Free SQL via ADT freestyle data preview |
| `abap_table` | Table/CDS contents (auto-routes LIKE/BETWEEN to freestyle) |

### Quality (5)
| Tool | Description |
|------|-------------|
| `abap_syntax_check` | Syntax check |
| `abap_atc_run` | ATC with ciCheckFlavour workaround, severity grouping |
| `abap_where_used` | Where-used with optional snippets |
| `abap_fix_proposals` | Fix proposals from ATC/syntax findings |
| `abap_unit_test` | Run ABAP unit tests |

### Code Intelligence (1)
| Tool | Description |
|------|-------------|
| `abap_find_definition` | Navigate to definition |

### Diagnostics (4)
| Tool | Description |
|------|-------------|
| `abap_get_dump` | Short dumps (ST22) |
| `abap_get_traces` | Profiler traces |
| `abap_get_inactive_objects` | List pending activations |
| `abap_pretty_print` | Code formatting / pretty print |

### DDIC (2)
| Tool | Description |
|------|-------------|
| `abap_get_annotation_defs` | Annotation definitions |
| `abap_get_revisions` | Source version history |

### RAP (2)
| Tool | Description |
|------|-------------|
| `abap_rap_binding_details` | RAP service binding details |
| `abap_rap_publish_binding` | Publish/unpublish service bindings |

### Transport Admin (1)
| Tool | Description |
|------|-------------|
| `abap_transport_admin` | Advanced transport administration |

### Test (1)
| Tool | Description |
|------|-------------|
| `abap_get_test_include` | Read test class include |

### Git (2)
git_repos (gCTS), git_pull

### System (4)
login, healthcheck, raw_http (arbitrary ADT requests), compact mode toggle

## Authentication

| Method | Supported |
|--------|-----------|
| Basic Auth (stdio) | Yes — shared SAP_USER/SAP_PASSWORD |
| Per-user browser login (HTTP) | Yes — /login page, session-based |
| Shared service account (HTTP) | Yes — env var credentials |
| **MCP OAuth 2.0 per-user** | **Yes (Apr 14, 2026)** — per-user SAP authentication via OAuth |
| **XSUAA OAuth** | **Yes (Apr 12, 2026)** — service key or individual env vars |
| OIDC/JWT | **No** |
| BTP Destination Service | **No** |
| Principal Propagation | **No** |
| API Key | **No** |

**New (Apr 12-14):** OAuth/XSUAA support and MCP OAuth 2.0 per-user authentication. This is a significant enterprise maturity step. Still lacks BTP Destination Service and Principal Propagation.

## Multi-System Support (NEW — Apr 12, 2026)

Added SAP UI Landscape XML auto-discovery — can read `SAPUILandscapeGlobal.xml` to discover and connect to multiple SAP systems. This is unique among MCP servers and leverages SAP's own system landscape configuration.

## Safety/Security

**No safety system.** No read-only mode, no operation filtering, no package restrictions, no SQL blocking. All 53 tools always available including `raw_http` (arbitrary ADT HTTP calls).

**MCP elicitation** provides UX guardrails (confirmation for delete, transport release, ATC variant fallback, batch activation failure, method editing recovery) but no hard blocks.

**Error intelligence**: classifies SAP errors, provides actionable hints (SM12 for locks, SPAU for upgrades, session timeout detection with 400 error broadening).

## Transport (MCP Protocol)

| Transport | Supported |
|-----------|-----------|
| stdio | Yes (default) |
| HTTP Streamable | Yes (configurable port/path) |
| SSE | **No** |

## Testing

163+ unit tests (Jest): URL builder, error classification, input validation. Integration test scaffold exists. AI self-test prompt in `scripts/ai-selftest.md`.

## Dependencies

@modelcontextprotocol/sdk ^1.28.0, abap-adt-api ^7.1.2, dotenv ^16.4.7
Dev: jest ^29.7.0, ts-jest ^29.2.5

## Azure & Cloud Deployment

- **Azure App Service**: PORT env var support (Apr 14, 2026)
- **GitHub Pages**: Human-readable HTML reference for all 53 tools (Apr 12, 2026)
- **CLAUDE.md**: Architecture documentation for AI assistants (Apr 9, 2026)

## Known Issues

| Issue | Description | Relevant to ARC-1? |
|-------|-------------|-------------------|
| No safety system | AI can do anything including raw HTTP | ARC-1's safety system is a major differentiator |
| No caching | Every request hits SAP | ARC-1 has SQLite + memory |
| No linting | No abaplint | ARC-1 has abaplint integration |
| No BTP Destination/PP | Has OAuth but not Destination Service or PP | ARC-1 has full BTP support |
| Lock management fragile | Multiple lock-related bug fixes (session-sticky, dead locks, retry cycles) | ARC-1's withStatefulSession() is more robust |
| Transport task/request confusion | Many fixes for CORRNR vs request number, task classification | Verify ARC-1 transport.ts handles correctly |
| abap-adt-api workarounds | Several bypass the library | Validate ARC-1's custom HTTP handles edge cases |
| raw_http | Unrestricted ADT HTTP | Potential security concern |

---

## Features This Project Has That ARC-1 Lacks

| Feature | Priority | Effort | Status (2026-04-14) |
|---------|----------|--------|---------------------|
| `abap_run` (execute ABAP via IF_OO_ADT_CLASSRUN) | Medium | 2d | Not implemented — needs safety design |
| `abap_get_function_group` (bulk parallel fetch) | Medium | 1d | Not implemented |
| `raw_http` escape hatch | Low | 0.5d | Not implemented — security concern |
| gCTS integration (git_repos, git_pull) | Low | 2d | Feature flag exists, no tools |
| SAP-domain error hints (SM12, SPAU, L-prefix) | High | 1d | Partial — basic HTTP hints exist, no SAP-domain |
| ~~16 type auto-mappings (CLAS→CLAS/OC, etc.)~~ | ~~Low~~ | ~~0.5d~~ | ~~IMPLEMENTED — normalizeObjectType() across SAPRead/SAPWrite/SAPActivate/SAPSearch/SAPNavigate/SAPDiagnose/SAPContext~~ |
| ATC ciCheckFlavour workaround | Low | 0.5d | Not implemented |
| Smart redirect hints (wrong param detection) | Low | 0.5d | Not implemented |
| AI self-test prompt (scripts/ai-selftest.md) | Low | 0.5d | Not implemented |
| **Multi-system (SAP UI Landscape XML)** | **Medium** | **2d** | **Not implemented — unique feature** |
| **Pretty print / code formatting** | **Medium** | **0.5d** | **Not implemented (FEAT-10)** |
| **Source version history / revisions** | **Medium** | **1d** | **Not implemented (FEAT-20)** |
| **Fix proposals from ATC/syntax** | **High** | **1d** | **Not implemented (FEAT-12)** |
| **ABAP unit test execution** | **Low** | **0d** | **ARC-1 already has unit tests via SAPDiagnose** |
| **Annotation definitions read** | **Low** | **0.5d** | **Not implemented** |
| **RAP publish binding** | **Low** | **0d** | **ARC-1 already has via SAPManage** |
| ~~Elicitation for destructive ops (7+ flows)~~ | ~~High~~ | ~~1d~~ | ~~IMPLEMENTED — src/server/elicit.ts~~ |
| ~~Transport contents (E071 objects list)~~ | ~~Medium~~ | ~~0.5d~~ | ~~IMPLEMENTED — SAPTransport get action~~ |
| ~~Transport assign~~ | ~~Medium~~ | ~~1d~~ | ~~IMPLEMENTED — SAPTransport reassign action~~ |
| ~~Session auto-recovery~~ | ~~Medium~~ | ~~0.5d~~ | ~~IMPLEMENTED — CSRF refresh + stateful sessions~~ |
| ~~Batch activation~~ | ~~Medium~~ | ~~0.5d~~ | ~~IMPLEMENTED — SAPActivate batch_activate~~ |
| ~~Find definition~~ | ~~Medium~~ | ~~0.5d~~ | ~~IMPLEMENTED — SAPNavigate find_definition~~ |
| ~~Method-level editing~~ | ~~Medium~~ | ~~1d~~ | ~~IMPLEMENTED — SAPWrite edit_method~~ |

See [08-dassian-adt-feature-gap.md](08-dassian-adt-feature-gap.md) for detailed gap analysis with implementation recommendations.

## Features ARC-1 Has That This Project Lacks

Safety system (read-only, op filter, pkg filter, SQL blocking, transport gating, dry-run), OIDC/JWT auth, BTP Destination Service + Cloud Connector + Principal Propagation, API key auth, abaplint (local offline linting), caching (SQLite + memory), audit logging, intent-based routing (11 vs 53 tools), code completion, npm distribution, Docker image, 1315+ unit tests vs 163, MCP elicitation with audit, context compression (SAPContext 7-30x), method-level surgery (95% reduction), hyperfocused mode (~200 tokens), DDLX read, AFF schema validation, multi-object batch creation, MCP scope system (2D: scopes + roles + safety), CDS dependency extraction, API release state / clean core, feature auto-detection (6 probes), BTP CF deployment (MTA).

---

## Changelog & Relevance Tracker

| Date | Change | Relevant? | Action for ARC-1 | Status |
|------|--------|-----------|-------------------|--------|
| 2026-06-22 | `afc1b66` self-correcting **"Unknown column"** hint on abap_table/abap_query; `df255e1` `abap_get_class_include` (read class-local includes / RAP behavior handlers); `baa4488` wire up BspHandlers | **High / No** | (1) **Unknown-column hint = GAP (High)**: ARC-1 self-corrects unknown *tables* (`query.ts:180`) but not unknown *columns* — add valid-column enrichment on error. (2) class-local include read = **ALREADY-HAVE** (`getClassInclude`, `read.ts include=`). (3) BSP: ARC-1 *reads* BSP (`listBspApps`) but BSP *write*/upload is a PARTIAL gap. | ✅ **DONE (col hint, PR #502)** |
| 2026-06-15 | `ef70b9e` transport/lock/write resilience from prod error-log analysis | No | **ALREADY-HAVE**: ARC-1's lock/transport/write path is already robust — try-finally unlock, CSRF refresh-on-403, 415/406 negotiation retry, 423 handling, stateful session + semaphore (`crud.ts`, `http.ts`). | Done |
| 2026-05-15 | `4cfd841` **pre-release inactive-objects check** + auto-package lookup on create | **High / No** | **Pre-release inactive check = GAP (High, S)** — cleanest win: ARC-1 has the primitive (`getInactiveObjects`/`InactiveListCache`) but the transport `release`/`release_recursive` path never consults it. Wire it in to warn/block. Auto-package lookup: ARC-1 deliberately defaults `$TMP` + allowlist (no action). | ✅ **DONE (inactive check, PR #501)** |
| 2026-05-14 | `3080b28` clean ToC creation + `transport_bundle_into_toc` | **Med** | **PARTIAL / verify**: ARC-1 lists ToCs and its tool advertises K/W/T create, but `createTransport` (CreateCorrectionRequest) has no type param and `createTransportWithTarget` hardcodes `tm:type="K"` — true ToC (type T) creation + object-bundling looks like a gap (possible advertise-vs-impl mismatch in `tools.ts:240`). | ✅ **RESOLVED (PR #501)**: the create path is K-only by design; misleading K/W/T advertise-text corrected. True type-T ToC creation remains out of scope (not wired). |
| 2026-05-12 | `5f691ff` **TTYP (Table Type) creation** + auto-classify transport tasks on release | **Med / Low** | **TTYP = GAP (Med, M)**: ARC-1 has no table-type read/write at all — add TTYP rows + `ddic-xml.ts` builder (mirror DOMA/DTEL). Auto-classify tasks on release = Low (cosmetic). | ✅ **DONE (TTYP read+create, PR #504)** |
| 2026-05-11 | `9911be0` DEVC package creation via CL_PACKAGE_FACTORY (FM-based) | No | ARC-1 creates DEVC via ADT-native `ddic-xml.ts` (packageType + recordChanges). Different (FM) approach — N/A. | Evaluated |
| 2026-05-02 | `5632a0f` transport/DDIC improvements + output pagination | No | ARC-1 already caps + compresses + summarizes large output (`maxResults`/`maxRows` 100, SAPContext, transport `summary` mode); true offset pagination infeasible (ADT `/datapreview` ignores offset). | Evaluated |
| 2026-04-14 | **feat: MCP OAuth 2.0 per-user SAP authentication** | **High** | Enterprise auth catch-up. ARC-1 has PP via BTP — different approach. Monitor adoption. | Evaluated |
| 2026-04-14 | feat: Azure App Service PORT env var compatibility | Low | ARC-1 uses ARC1_HTTP_ADDR | -- |
| 2026-04-13 | fix: TOC creation — reclassify after create instead of wrong OPERATION | Low | Verify ARC-1 transport.ts TOC handling | -- |
| 2026-04-12 | **feat: Multi-system support (SAP UI Landscape XML auto-discovery)** | **Medium** | Unique feature — evaluate if ARC-1 needs multi-system (currently env-var-per-instance) | TODO |
| 2026-04-12 | **feat: OAuth/XSUAA support via service key or env vars** | **High** | Closed major gap vs ARC-1. Still lacks Destination Service + PP. | Evaluated |
| 2026-04-12 | **feat: 16 new tools (traces, DDIC, pretty print, revisions, inactive objects, annotation defs, transport admin, test include, RAP binding)** | **High** | Rapidly closing feature gaps. Fix proposals + unit tests are the most impactful additions. | Evaluated |
| 2026-04-12 | feat: GitHub Pages docs for all 53 tools | Low | Documentation — ARC-1 has CLAUDE.md | -- |
| 2026-04-11 | feat: Transport improvements (TOC, auto-classify, task resolution) | Medium | Multiple transport bug fixes show complex edge cases. Verify ARC-1 transport.ts. | Evaluated |
| 2026-04-09-11 | Multiple lock/session fixes (dead-session cycle, 400 detection, session-sticky) | Medium | Validates ARC-1's withStatefulSession() design | Evaluated |
| 2026-04-05 | fix(data): skip decodeQueryResult crash on null DATE columns | Low | Verify ARC-1 RunQuery handles null dates | Evaluated |
| 2026-04-03 | feat: abap_set_class_include tool + session-sticky lock/write/unlock | Medium | Verify ARC-1 crud.ts class include writes | Evaluated |
| 2026-04-02 | feat: BDEF creation + STRU type support + abap_edit_method + compact mode | Medium | BDEF create: ARC-1 has. Edit method: ARC-1 has method surgery. | Evaluated |
| 2026-04-01 | MCP quality-of-life: elicitation recovery, batch activation, ATC variant fallback | Low | ARC-1 elicitation already more complete | -- |
| 2026-03-27 | Initial commit (v2.0) | Yes | Elicitation patterns reviewed — ARC-1 now has elicitation | Done |

## abap-mcpb (MCPB Variant — March 31, 2026)

albanleong/abap-mcpb packages dassian-adt as an **MCPB** (MCP Bundle) for Claude Desktop. Key differences:
- **Zero build step** — MCPB format with form-based configuration
- **Per-tool permissions** — Claude Desktop's native authorization UI
- May lag behind dassian-adt's rapid development (53 tools vs MCPB's snapshot)
- 2 files customized: QualityHandlers.js (enhanced ATC), index.js (error handling)

## Strategic Assessment (Updated 2026-04-14)

**Dassian-adt has undergone a dramatic transformation** from an early-stage 25-tool prototype to a 53-tool enterprise-grade MCP server in just 2 weeks. Key competitive developments:

1. **OAuth/XSUAA** — Closed the most critical auth gap. Still lacks BTP Destination Service + Principal Propagation.
2. **Multi-system** — SAP UI Landscape XML is unique and pragmatic for on-premise environments.
3. **53 tools** — Feature surface doubled. Now has fix proposals, unit tests, traces, revisions, inactive objects — capabilities ARC-1 also has or plans.
4. **32 stars in 2 weeks** — Fastest community adoption among competitors.
5. **Azure focus** — App Service compatibility suggests Azure-first enterprise positioning.

**ARC-1 still leads in:** Safety system, BTP-native deployment, token efficiency (11 vs 53 tools), context compression, caching, audit logging, CI/testing maturity (1315 tests), MCP scope system, professional distribution (npm/Docker/release-please).

**Risk:** If Dassian adds safety controls and BTP support, the gap narrows significantly. Monitor closely.

_Last updated: 2026-06-24 (deep scan — 11 commits May–Jun resumed after the April sprint; private→public toggle explains 33★→5★, not a loss of interest). Net new gaps: pre-release inactive-objects check (High, S — primitive exists), unknown-column self-correcting hint (High, M), TTYP create (Med, M); ToC bundling needs a focused verify (tool advertises K/W/T but impl looks K-only). Already-have: class-local include reads, transport/lock/write resilience, output cap+compress._
