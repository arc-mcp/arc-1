# Dassian ADT vs ARC-1: Feature Gap Analysis

> **Origin:** PR report from 2026-03-28, autoclosed. Updated 2026-04-14 against current ARC-1 main.
> **Repo:** https://github.com/DassianInc/dassian-adt (53 tools, 32 stars)
> **MCPB:** https://github.com/albanleong/abap-mcpb (MCPB repackaging)
> **Compared against:** ARC-1 main (29e6685, 2026-04-14)

---

## Executive Summary

Dassian ADT has undergone **explosive growth** since the last analysis — from 25 tools to **53 tools** in 2 weeks, adding OAuth/XSUAA auth, multi-system support, fix proposals, unit tests, traces, revisions, inactive objects, and more. Now at **32 stars** (from 0) with 7 forks. Wraps `abap-adt-api` npm library.

**Many gaps have closed in both directions:** Dassian added features ARC-1 already had (find definition, method editing, batch activation), while ARC-1 has closed former gaps (transport contents, transport assign, elicitation). The remaining gaps are narrower but more strategic.

ARC-1 still leads significantly in: safety system, BTP-native deployment, token efficiency (11 vs 53 tools), context compression, caching, audit logging, test maturity (1315 vs 163 tests), MCP scope system, and professional distribution.

---

## Category A: Remaining High-Value Gaps

### 1. ABAP Code Execution (`abap_run`)
**Priority: MEDIUM** (was HIGH — moved down due to security complexity)

Creates temp `ZCL_TMP_ADT_RUN` class implementing `IF_OO_ADT_CLASSRUN`, executes arbitrary ABAP, captures `out->write()` output, auto-deletes afterward.

Key details:
- Auto-detects SAP release (`~run` ≤2023 vs `~main` 2024+) by reading interface source
- Handles leftover classes from failed prior runs via elicitation
- Session management: ends stateful session before classrun POST
- `keepClass` option for debugging
- Guaranteed cleanup in `finally` block

**ARC-1 status:** Not implemented. Would need safety gating (`OperationType.Execute`), elicitation for confirmation, and careful cleanup. vibing-steampunk also has this.

### 2. Error Classification with Actionable Hints
**Priority: HIGH** (partially closed)

Dassian classifies SAP errors with remediation guidance:

| Error Pattern | Hint |
|--------------|------|
| Object locked | "Check SM12 for lock entries" |
| Adjustment/upgrade mode | "Use SPAU_ENH in SAP GUI" |
| Session timeout | Auto-retries via `withSession()` |
| Incorrect URL path | "Message X::NNN usually means wrong object type in URL" |
| L-prefix include (read-only) | "Write to the parent function module instead" |
| String template pipe issues | "Escape literal pipes with \\| or use CONCATENATE" |
| Activation failures | Cross-references `abap_syntax_check` |
| Inactive dependencies | "Activate dependencies first" |

**ARC-1 status:** `formatErrorForLLM()` in `intent.ts` has basic hints for 404/401/403/network errors. **Gap: no SAP-domain-specific classification** (SM12, SPAU, L-prefix includes, activation deps). The dassian-level hints would significantly improve AI self-correction.

### 3. Fix Proposals / Auto-Fix from ATC (NEW)
**Priority: HIGH** (FEAT-12 on roadmap)

Dassian now has `abap_fix_proposals` tool — retrieves auto-fix suggestions from ATC/syntax findings. High value for AI workflows: run ATC → get fix proposals → apply automatically.

**ARC-1 status:** Not implemented. On roadmap as FEAT-12 (P1). The abap-adt-api library has `fixProposals` + `fixEdits` methods — implementation reference available.

### 4. Source Version History / Revisions (NEW)
**Priority: MEDIUM** (FEAT-20 on roadmap)

Dassian added `abap_get_revisions` tool — source version history for any object. Enables diff comparisons and rollback recommendations.

**ARC-1 status:** Not implemented. On roadmap as FEAT-20 (P2).

### 5. Pretty Print / Code Formatting (NEW)
**Priority: MEDIUM** (FEAT-10 on roadmap)

Dassian added `abap_pretty_print` tool — server-side code formatting.

**ARC-1 status:** Not implemented. On roadmap as FEAT-10 (P2, XS effort).

### ~~6. Transport Contents~~ — CLOSED
~~Queries table E071 to list objects on transport.~~
**ARC-1 status:** ✅ Implemented — SAPTransport `get` action returns transport contents. FEAT-39 completed.

### ~~7. Transport Assignment~~ — CLOSED
~~Assigns existing objects to transports.~~
**ARC-1 status:** ✅ Implemented — SAPTransport `reassign` action.

### 8. Function Group Bulk Fetch
**Priority: MEDIUM** (FEAT-18 on roadmap)

Fetches ALL includes + FMs in one call via parallel requests. Reduces LLM round trips.

**ARC-1 status:** Not implemented. On roadmap as FEAT-18 (P1).

### 9. Multi-System Support (NEW — Unique)
**Priority: MEDIUM**

SAP UI Landscape XML auto-discovery — reads system landscape configuration to connect to multiple SAP systems from one instance. Pragmatic for on-premise environments.

**ARC-1 status:** Not implemented. ARC-1 uses one-instance-per-system model. Multi-system routing is on roadmap as OPS-03 (P3).

---

## Category B: Closed Gaps (implemented since 2026-03-28)

These were flagged in the original report but have since been implemented in ARC-1.

### ~~MCP Elicitation~~ — IMPLEMENTED
- `src/server/elicit.ts`: `confirmDestructive()`, `selectOption()`, `promptString()`
- Graceful fallback when client doesn't support elicitation
- Audit logging of all elicitation events

### ~~Session Auto-Recovery~~ — IMPLEMENTED
- `src/adt/http.ts`: `withStatefulSession()` ensures lock/modify/unlock share same session cookies
- Automatic CSRF token refresh on 403
- Cookie persistence via internal `cookieJar` Map

### ~~Object Type Expansion~~ — IMPLEMENTED
- DDLX, SRVB, DOMA, DTEL, STRU, TRAN all added
- Still missing: DCLS (access control, FEAT-37), ENHO/ENHS (enhancements), SQLT (table types), SHLP (search helps)

### ~~Error Hints for LLM~~ — PARTIALLY IMPLEMENTED
- `formatErrorForLLM()` provides HTTP-level hints (404, 401, network)
- Missing: SAP-domain-specific hints (see Category A item #2 above)

### ~~Batch Activation~~ — IMPLEMENTED
- `SAPActivate` supports `objects` array for batch activation

### ~~Transport Contents~~ — IMPLEMENTED
- `SAPTransport` `get` action returns transport objects (FEAT-39)

### ~~Transport Assign / Reassign~~ — IMPLEMENTED
- `SAPTransport` `reassign` action for owner reassignment

### ~~Find Definition~~ — IMPLEMENTED
- `SAPNavigate` `find_definition` action

### ~~Method-Level Editing~~ — IMPLEMENTED
- `SAPWrite` `edit_method` action with surgical replacement

### ~~Inactive Objects List~~ — IMPLEMENTED
- `SAPActivate` `preaudit` returns inactive objects

---

## Category C: Lower Priority / Deferred

| Feature | Dassian | ARC-1 Status | Priority |
|---------|---------|-------------|----------|
| `raw_http` escape hatch | Arbitrary ADT requests | Not implemented (all ops gated) | Low — security concern |
| gCTS (git_repos, git_pull) | Yes | Feature flag exists, no tools | Low |
| ~~16 type auto-mappings (CLAS→CLAS/OC)~~ | ~~Yes~~ | ~~Implemented (2026-04-14)~~ | ~~Low~~ |
| ATC ciCheckFlavour workaround | Yes | Not implemented | Low |
| Per-user browser login (HTTP) | `/login` page | OIDC/XSUAA covers this better | Low |
| Smart parameter redirects | Error-based hints | Not implemented | Low |
| SAP release auto-detection | For `abap_run` | Not needed unless code exec added | Low |
| AI self-test prompt | scripts/ai-selftest.md | Interesting idea, not critical | Low |
| Annotation definitions read | Yes (new) | Not implemented | Low |
| Test include read | Yes (new) | ARC-1 reads test classes via structured decomposition | Low |
| Transport admin tools | Yes (new) | ARC-1 has transport CRUD | Low |

---

## Category D: ARC-1 Advantages (no Dassian equivalent)

| ARC-1 Feature | Detail |
|---|---|
| Safety system | Read-only, op filter, pkg filter, SQL blocking, transport gating, dry-run |
| BTP Destination Service + Cloud Connector | Per-user SAP identity via PP — Dassian has OAuth but not BTP-native |
| Principal Propagation | Maps MCP user to SAP user — Dassian lacks this |
| OIDC / XSUAA / API key / MCP scope auth | 4 auth methods vs 3 (Dassian now has OAuth/XSUAA but no OIDC/API key) |
| MCP scope system (2D) | Scope-gated tool access (read/write/admin) — no Dassian equivalent |
| Feature auto-detection | 6 probes for SAP capabilities |
| ABAP Lint (abaplint/core) | Local offline linting |
| Code completion | Dassian has find_definition but not completion |
| Cache (SQLite + memory) | Reduces SAP round trips |
| Context compression (SAPContext) | AST-based, 7-30x reduction |
| Method-level surgery | 95% source reduction |
| Hyperfocused mode | Single tool, ~200 tokens |
| Token efficiency | 11 intent tools vs 53 individual tools |
| npm + Docker + release-please | Professional distribution |
| BTP CF deployment (MTA) | Cloud-native deployment — Dassian targets Azure |
| 1315+ unit tests | vs 163 — 8x more test coverage |
| AFF schema validation | Pre-create validation against SAP schemas |
| Multi-object batch creation | Single call creates multiple objects |
| CDS dependency extraction | AST-based dependency graph |
| API release state / clean core | S/4HANA ABAP Cloud API compatibility check |
| Audit logging (multi-sink) | stderr + file + BTP Audit Log Service |
| Structured JSON logging | Stderr, sensitive field redaction |

---

## Recommended Next Steps (aligned with ARC-1 goals)

### Quick Wins (< 1 day each)
1. **SAP-domain error hints** (FEAT-16) — Extend `formatErrorForLLM()` with SM12/SPAU/L-prefix/activation-dep patterns. High impact, low effort. Dassian's implementation is a good reference.
2. **Pretty print** (FEAT-10) — Simple ADT endpoint, XS effort.

### Medium Effort (1-3 days)
3. **Fix proposals / auto-fix** (FEAT-12) — High value for AI workflows. abap-adt-api has `fixProposals` + `fixEdits` methods.
4. **Function group bulk fetch** (FEAT-18) — Parallel include fetching, return combined response.
5. **Source version history** (FEAT-20) — Revisions endpoint, enables diff and rollback.

### Deferred (needs design)
6. **ABAP code execution** — Significant security implications. Needs `OperationType.Execute`, elicitation, cleanup. Both dassian-adt, vibing-steampunk, and sapcli have this — increasing market pressure.
7. **Multi-system routing** (OPS-03) — Dassian's SAP UI Landscape XML approach is interesting but ARC-1's one-instance-per-system model is more aligned with BTP-native deployment.

---

_Last updated: 2026-04-14_
