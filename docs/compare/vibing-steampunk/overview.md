# oisee/vibing-steampunk — Commit & Issue Tracker

> Tracking commits and issues from [oisee/vibing-steampunk](https://github.com/oisee/vibing-steampunk) (ARC-1's upstream) for features and bug fixes worth adopting.

_Last updated: 2026-04-27_

## Approach

- **Commits**: Grouped by release in `commits.json`. Auto-triaged by commit prefix.
- **Issues**: All 67 issues evaluated in `issues.json`
- **Evaluations**: Detailed write-ups for high/medium priority items in `evaluations/`
- **Scope**: Tracking from v2.22.0 (2026-02-01) onwards
- **Key difference from fr0ster**: VSP is ARC-1's upstream — same safety system design, shared heritage. ~70% of commits are experimental (WASM/LLVM compilers, Lua, JS evaluator) and not relevant.

## Stats

| Metric | Commits | Issues |
|--------|---------|--------|
| Total | 517+ | 67 |
| Tracked | 117 | 67 |
| Evaluated | 109 | 67 |
| Pending evaluation | 0 | 0 |
| Skipped (not relevant) | 68 | 30 |
| Evaluation files | 34 | 10 |

## Priority Summary

### High Priority (implement in ARC-1)

| Source | ID | Description | ARC-1 Matrix Ref |
|--------|----|-------------|-------------------|
| commit | **0713d75** | **CRITICAL: Package safety bypass on mutations — ARC-1 has same bug** | **Safety system bypass** |
| commit | 7270ad7 | API release state for S/4HANA Clean Core | New — critical for BTP/cloud |
| commit | **22517d4** | **Fix lock-handle bug class: add modificationSupport check to lockObject()** | **crud.ts reliability** |
| issue | **#104** | **CSRF fetch via HEAD fails on S/4HANA public cloud (CL_ADT_WB_RES_APP returns 403)** | **http.ts CSRF resilience** |
| issue | **#98** | **423 on DDLS LOCK+UPDATE in separate sessions — root cause confirmed** | **Verify withStatefulSession for CDS** |
| issue | **#124** | **STRATEGIC: SAP API Policy v.4.2026 may classify ADT REST as off-limits for productive use** | **Project narrative — not code** |
| ~~issue~~ | ~~#9~~ | ~~Transport 406 Accept header (same class as fr0ster 415)~~ | ~~Critical #3~~ ✅ ARC-1 has 415/406 retry |

### Medium Priority (evaluate/verify)

| Source | ID | Description | ARC-1 Matrix Ref |
|--------|----|-------------|-------------------|
| commit | f00356a + 3d1353e | RecoverFailedCreate — partial-create recovery on 5xx | SAPWrite reliability |
| commit | daedc99 | VSP now has Streamable HTTP transport | No action — landscape update |
| commit | 27d4d7c | Auth headers on redirects + stateful lock sessions | Verify http.ts |
| commit | dcaa358 | Rename refactoring preview | Medium #18 in matrix |
| commit | dd06202 | Version history tools (3 tools) | Medium #25 in matrix |
| commit | 566f1f7 | 7 i18n/translation tools | Closes VSP #40 |
| commit | 81cce41 | 10 gCTS tools | Medium #15 in matrix |
| commit | 333f462 | Code coverage + check run results | Enhance SAPDiagnose |
| commit | 6c67140 | CDS impact analysis + element info | Enhance SAPNavigate |
| commit | 9fb6c8a | Table pagination (offset + columns_only) | Enhance SAPQuery |
| commit | 11c2253 | Side effect extraction + LUW classification | Novel — SAPContext enhancement |
| commit | 53fb790 | Package boundary crossing analysis | Novel — architecture governance |
| commit | 1ecafe7 | Dead code analysis (method-level) | Novel — SAPDiagnose extension |
| commit | 74efe5e | Package health analysis | Novel — aggregation tool |
| commit | aa5aa5b | API surface inventory | Covered by contract.ts |
| commit | ca02f47 | S/4HANA 757 transport endpoint compat | Verify transport.ts |
| commit | 6d1f00a | Namespaced class URI in syntax check | Verify devtools.ts |
| commit | d73460a | 401 auto-retry after idle timeout | Verify http.ts |
| commit | 59b4b90 | Namespace URL encoding for ADT ops | Verify http.ts |
| commit | 7fbfbba | ignore_warnings for EditSource | Consider for edit_method |
| commit | ba83e22 + 558a300 | Package deps + call graph analysis | Medium #31 in matrix |
| commit | 0756e94 | ABAP parser + deps as MCP tools | Consider for SAPContext |
| commit | a66bcd5 | API release state bug fix (C0-C4 structure) | Verify getApiReleaseState |
| commit | e62c7d5 | SAML SSO for S/4HANA Public Cloud | Low — defer unless SAML-only demand |
| commit | 880aa68 | Default mode → hyperfocused (market signal) | Validates intent-based approach |
| issue | #91, #88, #92 | 423 lock handle errors (recurring) | Verify crud.ts |
| issue | #78 | 423 lock handle on ECC 6.0 | Verify crud.ts |
| issue | #40 | i18n/translation tools | Closed by commit 566f1f7 |
| issue | #39 | gCTS tools | Closed by commit 81cce41 |
| issue | #34 | Table contents pagination | Closed by commit 9fb6c8a |
| issue | #33 | Syntax warnings blocking saves | Verify edit_method |

### Low / Skip (no action needed)

- WASM/LLVM/JS compiler experiments (30+ commits) — experimental, not MCP tooling
- Lua scripting — Go-specific
- ABAP LSP — niche
- CLI governance tools (cr-config-audit, cr-audit) — not MCP tooling
- CLI mode — ARC-1 is MCP-only
- Debugger — requires ZADT_VSP deployment
- GetAbapHelp — requires ZADT_VSP WebSocket
- BTP Basic Auth issue (#90) — ARC-1 correctly uses OAuth
- SAProuter (#103) — ARC-1 uses Cloud Connector

## How to Update

Run `/update-competitor-tracker` from Claude Code (covers both fr0ster and vibing-steampunk).

## Relationship to Existing Analysis

This tracker **complements** [../01-vibing-steampunk.md](../01-vibing-steampunk.md) which has:
- High-level project comparison
- Feature gap analysis (what upstream has vs ARC-1)
- Changelog & Relevance Tracker (release-level)
