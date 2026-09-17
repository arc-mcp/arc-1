# Issue #798: make the data-source policy explicit on pre-7.52 systems

## Overview

Fix the confirmed release-boundary bug documented in the
[issue dossier](../../research/issues/798-data-source-blocklist-nw750.md). When loaded ADT discovery says the
canonical transparent-table source resource is absent, the experimental data-source blocklist must
fail closed with an actionable `DATA_POLICY_UNAVAILABLE` result before attempting the known-missing
resource. More specific direct, SQL-parser, and graph-visible transitive denials stay unchanged.

This is a small compatibility and diagnostic fix, not a legacy lineage implementation. The 7.50
`/structures` and VIT fallbacks demonstrably omit replacement-object metadata, while replacement
objects exist on that release, so allowing through either fallback would weaken the security property.

## Context

### Current State

`AdtClient.dataSourceBlocklistGuard()` always binds table-source reads to `getTable()`. Once
`enforceBlockedDataSources()` resolves an allowed root or CDS terminal to `TABL/DT`, `replacementAt()`
unconditionally reaches `/sap/bc/adt/ddic/tables/<name>/source/main`. SAP_BASIS 750 discovery does not
advertise that collection and the request returns 404, which is wrapped as generic
`DATA_LINEAGE_UNRESOLVED`.

The existing live integration suite skips the allowed-table policy case on 750 because Data Preview is
unbound there. That skip hid the earlier metadata failure. It does still prove that the old 750 CDS
graph can produce a stronger transitive `DATA_SOURCE_BLOCKED` decision before replacement expansion.

### Target State

When discovery has been loaded and `/sap/bc/adt/ddic/tables` is absent, replacement inspection returns
`DATA_POLICY_UNAVAILABLE`, `executed=false`, and a safe operator action explaining the 7.52 boundary.
No request is sent to the missing table-source or data-preview resource. If discovery is unavailable,
a canonical table-source `404` returns the same typed outcome after that single metadata request;
other failures remain unresolved. Modern discovered systems are unchanged.

### Key Files

| File | Role |
|---|---|
| `docs/research/issues/798-data-source-blocklist-nw750.md` | Verified root-cause and option analysis; authoritative evidence for this plan. |
| `src/adt/data-source-policy.ts` | Pure lineage evaluator, request-scoped guard, public policy codes and client messages. |
| `src/adt/client.ts` | Binds live ADT search, discovery and source reads into the policy guard. |
| `src/server/audit.ts` | Typed protected audit event for policy decisions. |
| `tests/unit/adt/data-source-policy.test.ts` | Pure decision and denial-precedence tests. |
| `tests/unit/adt/client.test.ts` | Shared-client HTTP choke-point behavior. |
| `tests/unit/adt/data-source-policy-client.test.ts` | PP-style unknown-discovery regression across all three data paths. |
| `tests/unit/handlers/dispatch-misc.test.ts` | LLM-facing minimal-error and audit formatting. |
| `tests/integration/data-source-blocklist.integration.test.ts` | Cross-release live contract. |
| `.env.example`, `README.md`, `AGENTS.md`, `docs_page/*.md` | Operator and maintainer compatibility contract. |

### Verified Live Evidence

On 2026-09-17, current HEAD `5bc5310b` was exercised through the production `AdtClient`:

- SAP_BASIS 750: discovery lacked `/ddic/tables`; allowed `SCARR` requests through `SAPQuery`,
  `TABLE_QUERY`, and `TABLE_CONTENTS` each called `/ddic/tables/SCARR/source/main`, received 404, and
  returned `DATA_LINEAGE_UNRESOLVED` with `executed=false`. A direct `USR02` block stayed local.
- SAP_BASIS 758: discovery advertised `/ddic/tables` with the v2 table media type; the same three
  `SCARR` calls executed successfully. `DEMO_SUMDIST` source included
  `@AbapCatalog.replacementObject : 'demo_cds_sumdist'`, and blocking `SCARR` produced the full
  `DEMO_SUMDIST -> DEMO_CDS_SUMDIST -> SCARR` denial path.
- SAP_BASIS 750 live `DEMO_SUMDIST`: `/structures/.../source/main` and VIT metadata both returned 200
  but omitted replacement metadata. SAP's official 7.50 documentation confirms replacement objects
  exist; the ADT database-table editor/resource begins at 7.52 SP00.

Full commands, response summaries, references and rejected alternatives are retained in the dossier.

### Design Principles

1. Keep fail-closed authorization: no 7.50 allow fallback may discard replacement lineage.
2. Use capability discovery, not a hard-coded parsed release number; this respects backports and selected
   targets in multi-target mode.
3. Preserve the existing order of decisions: direct match and SQL grammar first, CDS graph before
   terminal replacement reads, capability denial only when the missing resource is actually required.
4. Treat discovery as tri-state. `false` gives the proactive result; `undefined` attempts the canonical
   read and maps only its `404` to unavailable capability; `true` keeps a `404` as unresolved lineage.
5. Add one public error code rather than special-casing text inside generic lineage failures. This keeps
   minimal-error mode actionable without exposing source names or SAP response details.
6. No new config, CLI flags, caches, endpoints, schemas, or authorization scopes.

## Development Approach

Use test-first implementation. Add focused assertions for the release capability and minimal-error
surface, run them red, then add the smallest optional resolver capability and client binding. Reuse
`AdtHttpClient.hasDiscoveryData()` and `discoveryAcceptFor()`; do not add a second feature cache or
release parser. Keep `src/adt/client.ts` within its file-size ratchet and avoid duplicating existing
direct/transitive precedence tests.

Live verification must run on both 750 and 758 after implementation. The 750 integration branch should
assert the new typed denial instead of skipping. No SAP mutation is involved, and the intentionally
stopped 816 target is not required to establish the 7.52 boundary.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add release-boundary regression tests

**Files:**
- Modify: `tests/unit/adt/data-source-policy.test.ts` (`describe('enforceBlockedDataSources')`)
- Modify: `tests/unit/adt/client.test.ts` (experimental data-source blocklist tests)
- Add: `tests/unit/adt/data-source-policy-client.test.ts` (unknown-discovery HTTP regression)
- Modify: `tests/unit/handlers/dispatch-misc.test.ts` (`describe('error guidance')`)
- Modify: `tests/integration/data-source-blocklist.integration.test.ts`

Encode the expected contract before production code changes so the test fails for the same generic 404
behavior reproduced live.

- [x] Add a pure evaluator test where loaded capability is absent: expect
      `DATA_POLICY_UNAVAILABLE`, the original source path, and no `readTableSource()` call.
- [x] Retain/confirm the existing unknown-capability path calls `readTableSource()` and modern behavior
      remains unchanged.
- [x] Reproduce the principal-propagation unknown-discovery case across `SAPQuery`, `TABLE_QUERY`, and
      `TABLE_CONTENTS`; classify only a canonical source `404` as `DATA_POLICY_UNAVAILABLE` and never
      execute the data request.
- [x] Add one ADT-client regression proving a loaded discovery map without `/ddic/tables` performs exact
      search, then denies before table-source and data-preview HTTP calls.
- [x] Add a minimal-error dispatch assertion proving the new code explains the 7.52 boundary without
      leaking the source, configured names, or raw backend diagnostics.
- [x] Change the live unrelated-table test to use the independently read SAP_BASIS release for its
      expected unavailable/allow result, so a failed discovery request is not mistaken for proven
      capability absence.
- [x] Run the focused unit suites and confirm the new expectations fail before implementation.

### Task 2: Implement the discovery-gated policy outcome

**Files:**
- Modify: `src/adt/data-source-policy.ts` (`DataSourcePolicyErrorCode`,
  `DataSourcePolicyResolver`, `DataSourcePolicyBackend`, `replacementAt()`)
- Modify: `src/adt/client.ts` (`dataSourceBlocklistGuard()`)
- Modify: `src/server/audit.ts` (`DataSourcePolicyDecisionEvent.code`)

Thread one tri-state capability from the already-loaded HTTP discovery map into replacement inspection.
Do not gate the request before direct and graph checks.

- [x] Add stable code `DATA_POLICY_UNAVAILABLE` with non-minimal and minimal client guidance that the
      table-source metadata is absent, this is expected before 7.52, and the operator must use a
      capable target or keep data access disabled. Removing the blocklist is an explicit security decision.
- [x] Add an optional tri-state resolver value and required backend value using
      `true | false | undefined`; consult it at `replacementAt()` before the source read.
- [x] Bind the value to `hasDiscoveryData()` plus discovery presence for
      `/sap/bc/adt/ddic/tables`; return `undefined` when discovery has not been loaded.
- [x] Keep metadata request accounting truthful: a proactive capability denial must not count the
      skipped table-source HTTP call.
- [x] When capability is unknown, count the attempted source request and map only HTTP `404` to
      `DATA_POLICY_UNAVAILABLE`; advertised-capability `404` and non-404 failures remain unresolved.
- [x] Add the new code to the typed audit event and keep `executed=false`.
- [x] Run focused policy/client/dispatch unit suites until green, then run typecheck and the file-size
      check to catch surface drift.

### Task 3: Document the real compatibility boundary

**Files:**
- Modify: `docs_page/authorization.md`
- Modify: `docs_page/configuration-reference.md`
- Modify: `docs_page/security-guide.md`
- Modify: `docs_page/tools.md`
- Modify: `docs_page/release-notes.md`
- Modify: `docs/research/issues/798-data-source-blocklist-nw750.md` only if implementation evidence
  refines its before-fix conclusions

State the shipped capability accurately on the canonical operator surfaces; link to the detailed
authorization contract instead of repeating release behavior across overview and setup files.

- [x] Explain that usable allow decisions require the discovery-advertised transparent-table source
      resource (normally SAP_BASIS 7.52+), because replacement objects exist on 7.50 and fallbacks omit
      them.
- [x] Document `DATA_POLICY_UNAVAILABLE` alongside the existing stable codes and its no-execution
      guarantee.
- [x] State the precedence nuance: direct and graph-visible blocked matches can still return their
      stronger codes before the missing replacement resource is needed.
- [x] Keep the empty default and modern-system behavior descriptions unchanged.
- [x] Avoid promising a startup failure: the implemented gate is target/request-specific.

### Task 4: Final verification and completion

**Files:**
- Move: `docs/plans/2026-09-17-issue-798-data-source-policy-nw750.md` to
  `docs/plans/completed/2026-09-17-issue-798-data-source-policy-nw750.md`

Verify the implementation against the dossier, all repository gates, and both sides of the live release
boundary. Fix any discovered defect and repeat the affected checks before committing.

- [x] Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `git diff --check`.
- [x] Run the focused live integration suite on NPL/SAP_BASIS 750 and A4H/SAP_BASIS 758 with credentials
      from `INFRASTRUCTURE.md`.
- [x] Re-run the four-case live probe on 750: allowed `SAPQuery`, `TABLE_QUERY`, and `TABLE_CONTENTS`
      return `DATA_POLICY_UNAVAILABLE` without `/ddic/tables`; direct `USR02` remains
      `DATA_SOURCE_BLOCKED` with zero metadata calls.
- [x] Re-run the 758 allow and replacement-block cases; behavior must match the before-fix modern
      baseline.
- [x] Review the full diff for scope, security, error-message disclosure, test duplication, file-size
      ratchets, and consistency with the dossier.
- [x] Mark completed tasks, move this plan to `docs/plans/completed/`, and update its dossier link for
      the new relative depth.
