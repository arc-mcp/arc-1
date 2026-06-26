# fr0ster/mcp-abap-adt — Commit & Issue Tracker

> Tracking commits and issues from [fr0ster/mcp-abap-adt](https://github.com/fr0ster/mcp-abap-adt) for features worth adopting in ARC-1.

_Last updated: 2026-04-27_

## Approach

- **Commits**: Grouped by release in `commits.json`. Auto-triaged by commit prefix:
  - `feat:` → needs evaluation (pending)
  - `fix:` with SAP/ADT relevance → check
  - `chore:/docs:/test:/style:/ci:` → skipped
- **Issues**: All 63 issues evaluated in `issues.json` with relevance to ARC-1
- **Evaluations**: Detailed write-ups only for high/medium priority items in `evaluations/`
- **Scope**: Tracking from v2.4.0 (2026-02-15) onwards — earlier commits are scaffolding/refactoring

## Stats

| Metric | Commits | Issues |
|--------|---------|--------|
| Total | 873 | 63 |
| Tracked | 142 | 63 |
| Evaluated | 65 | 63 |
| Pending evaluation | 0 | 0 |
| Skipped (not relevant) | 77 | 31 |
| Evaluation files | 30 | 13 |

## Priority Summary

### High Priority (implement in ARC-1)

| Source | ID | Description | ARC-1 Matrix Ref |
|--------|----|-------------|-------------------|
| commit | TLS cluster (5 commits) | HTTPS/TLS for HTTP Streamable transport | Critical #5 |
| ~~issue~~ | ~~#22, #23, #25~~ | ~~415 Content-Type auto-retry / Accept negotiation~~ | ~~Critical #3~~ ✅ ARC-1 already has 406/415 retry |
| issue | #26 | TLS/HTTPS implementation reference | Critical #5 |
| issue | #77 + commit `3a3fa65` | UpdateFunctionModule loses parameters (open upstream); ARC-1 has latent broken FUNC update path | New: fix or remove FUNC from SAPWRITE_TYPES_ONPREM |
| commit | `795633a` | FM group validation against ADT containerRef metadata | New: harden `getFunction()` |

### Medium Priority (evaluate for adoption)

| Source | ID | Description | ARC-1 Matrix Ref |
|--------|----|-------------|-------------------|
| commit | c0775a3 | SM02 system messages reader (RuntimeListSystemMessages) | New SAPDiagnose action |
| commit | 276f414 | Gateway error log with detail view (RuntimeGetGatewayErrorLog) | New SAPDiagnose action |
| commit | 459f961 | Dump lookup by datetime+user, structured dump list | Enhance SAPDiagnose |
| commit | e5628dc | Read handlers returning source + metadata together | UX improvement |
| commit | 9ef5843 | Create vs Update separation (breaking change) | SAPWrite design |
| commit | available_in cluster | Dynamic tool hiding by system capabilities | features.ts enhancement |
| commit | 5f975fe | MCP client auto-configurator | High #21 in matrix |
| commit | 8fd0ef3 | GetInactiveObjects endpoint (list pending activations) | New SAPRead/SAPDiagnose action |
| commit | 4f95094 | 13 high-level Check handlers (per-type syntax/semantic) | No action — ARC-1 uses single SAPDiagnose |
| commit | 51781d3 | ServiceBindingVariant — V4 publish endpoint must use `odatav4` | Fix bug in devtools.ts publishServiceBinding() |
| commit | c2b8006 | UpdateInterface BTP Cloud: transport param causes 400 | Verify safeUpdateSource() omits transport on BTP |
| issue | #61 | UpdateInterface `corrNr not found` on BTP ABAP | Verify ARC-1 crud.ts for BTP transport omission |
| issue | #57 | Lock/unlock must use try/finally | Verify — ARC-1 already does |
| issue | #45 | CSRF cookie corruption on sequential creates | Verify — ARC-1 uses withStatefulSession |
| issue | #46 | stdio log leak corrupting MCP protocol | Verify — ARC-1 uses stderr-only |
| issue | #30 | Object history + transport contents | Medium #20, #25 in matrix |
| issue | #13 | i18n check handling for non-EN languages | Verify in ARC-1 |
| issue | #7, #6 | 409 error detail extraction for LLM | Verify in ARC-1 |

### Low / Skip (no action needed)

- RFC connectivity (ARC-1 is HTTP-only)
- RAG tool descriptions / per-type tool description enrichment #66 (ARC-1 uses intent routing)
- SSE transport (not in scope)
- Compact mode (ARC-1 has hyperfocused)
- Health endpoint (ARC-1 already has) — fr0ster's Dockerfile HTTP fix `b2ef76d` doesn't apply (ARC-1 already correct)
- YAML config (ARC-1 uses env vars)
- Legacy system support (ARC-1 targets 7.50+)
- Per-instance systemType #69 (ARC-1 is one-process-per-system; no embed API)
- ReadOnly dedup strategy `1246cc2` (ARC-1 has no readonly/high/low tier split)
- Issue #68 — PROG CRUD already supported in ARC-1
- Debug/trace scripts (`dab9963`, `8bbaa8a`, `3a3fa65` for fr0ster maintainer use)
- node-rfc lockfile cleanup #67 (ARC-1 doesn't depend on node-rfc)

## How to Update

Run `/update-fr0ster-tracker` from Claude Code. This will:
1. Fetch new commits since `lastCheckedSha` in `commits.json`
2. Fetch new/updated issues since `lastUpdated` date
3. Auto-triage, evaluate, and create evaluation files for high/medium items
4. Update all related documents (this file, `05-fr0ster-mcp-abap-adt.md`, `00-feature-matrix.md`)

## Relationship to Existing Analysis

This tracker **complements** [../05-fr0ster-mcp-abap-adt.md](../05-fr0ster-mcp-abap-adt.md) which has:
- High-level project comparison
- Feature gap analysis (what they have vs ARC-1)
- Changelog & Relevance Tracker (release-level)

This folder provides **commit-level granularity** for specific implementation decisions and patterns worth studying.
