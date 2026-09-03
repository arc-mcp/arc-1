# Experimental data-source blocklist with CDS lineage enforcement

> **Plan review:** revised after an adversarial pass over the data-preview call graph, per-user safety
> clones, multi-target runtime construction, SAP_BASIS 750/758 dependency responses, DDIC replacement
> objects, and the current ABAP SQL parser. The review added strict source-name validation, replacement
> expansion, fail-closed classic-view/table-function handling, complete-statement AST checks, explicit
> multi-target propagation, stable policy errors, and negative bypass tests.

## Overview

Add one deliberately narrow, default-off experimental control:
`SAP_BLOCKED_DATA_SOURCES` / `--blocked-data-sources`. It is a comma-separated list of exact ABAP SQL
data-source names. When the list is empty, ARC-1 behaves exactly as it does today and performs no new SAP
metadata calls. When it is non-empty, every `SAPQuery`, `SAPRead(TABLE_QUERY)`, and
`SAPRead(TABLE_CONTENTS)` request must pass a pre-execution source and lineage check.

The first version optimizes for security and explainability, not breadth or speed:

- a direct exact-name match is denied without contacting SAP;
- free SQL is accepted only when `@abaplint/core` proves one complete static `SELECT`/`WITH` statement;
- every direct source is resolved through exact ADT repository search;
- CDS roots are expanded through SAP's active dependency graph and every graph alias is compared with the
  blocklist;
- transparent-table replacement objects are expanded into the replacement CDS graph;
- unsupported or ambiguous sources, classic views, table functions, parser failures, filtered DDIC
  preview, and lineage failures are denied while the feature is active;
- the denial is a typed safety error that says the request was not sent and includes the dependency path.

This is an emergency-brake denylist, not the root-scoped allowlist recommended for a future production
data-policy manifest. Full design evidence and limitations are in
[the research dossier](../../research/2026-09-02-data-source-allowlist-and-cds-lineage.md).

## Success criteria

- Empty/default blocklist produces the current wire behavior and zero new lookup/graph/source calls.
- Configuration is exact, uppercase, deduplicated, source-attributed, visible in safe policy diagnostics,
  propagated through per-user and multi-target clients, and rejected at startup on invalid entries.
- Direct blocked tables/CDS aliases are denied before any SAP call.
- Static SQL joins, unions, subqueries, and CTEs expose all direct data sources to the policy.
- Dynamic sources, host expressions, privileged access, client overrides, secondary connections,
  association paths, multiple statements, malformed/unsupported SQL, and incomplete parses fail closed.
- A blocked table reached through one or more CDS layers is denied with the live dependency path.
- A DDIC table whose replacement CDS reaches a blocked source is denied.
- Classic/generated DDIC views and CDS table functions fail closed in the experimental version.
- Analyzer/search/graph/source failures never fall through to the data-preview POST.
- Unit, integration, regression, type, lint, build, and live SAP_BASIS 750/758 checks pass; 816 is recorded
  honestly if its intentionally stopped container remains unavailable.

## Design decisions

1. **One list, exact names, no wildcard grammar.** Entries match any canonical identity SAP exposes for a
   graph node: repository name, CDS entity name, or database node name. This makes generated aliases
   blockable without pretending they are safe query roots.
2. **The list activates strict analysis.** An empty list is backward-compatible. A configured list makes
   unresolved data lineage a denial; it does not silently downgrade to direct-name matching.
3. **Enforce in `AdtClient` immediately before the POST.** All handlers, fixed internal queries, chunked
   SQL, error-enrichment queries, and future callers share the same boundary. There is no caller-provided
   bypass switch.
4. **No authorization cache in v1.** Re-evaluate active lineage for each request to reduce stale-policy
   risk. The graph check and query are still separate SAP requests, so this is not transactionally atomic.
5. **Filtered DDIC preview is refused.** `sqlFilter` is a condition-language surface without a complete
   security parser. `TABLE_QUERY` remains the structured filtered alternative.
6. **Stable policy errors.** `DATA_SOURCE_BLOCKED` identifies the matched source and path;
   `DATA_SOURCE_UNRESOLVED` identifies a conservative refusal. Both state that execution was stopped
   before the data request.
7. **SAP authorization remains mandatory defense in depth.** The feature neither replaces CDS DCL nor
   SAP table authorization, and it does not remediate SAP Security Note 3772411.

## Validation commands

- `npx vitest run tests/unit/adt/sql-source-analyzer.test.ts tests/unit/adt/data-source-policy.test.ts`
- `npx vitest run tests/unit/adt/client.test.ts tests/unit/adt/safety.test.ts`
- `npx vitest run tests/unit/server/config.test.ts tests/unit/server/effective-policy-log.test.ts tests/unit/server/ui.test.ts tests/unit/server/multi-target-runtime.test.ts`
- `npx vitest run tests/unit/handlers/dispatch-misc.test.ts`
- `npm run test:integration` (with repository live-system environment)
- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run check:sizes`
- `npm run validate:policy`
- `npm run btp:validate`
- `git diff --check`

### Task 1: Add and propagate the experimental administrator policy

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/config.ts`
- Modify: `src/adt/safety.ts`
- Modify: `src/server/server.ts`
- Modify: `src/server/multi-target-runtime.ts`
- Modify: `src/server/effective-policy-log.ts`
- Modify: `src/server/ui-state.ts`
- Modify: `src/cli.ts`
- Modify: `.claude-plugin/plugin.json`
- Modify: `Dockerfile`
- Modify: `manifest-btp-abap.yml`
- Modify: `manifest.yml`
- Modify: `mcpb-manifest.json`
- Modify: `mta.yaml`
- Modify: `tests/unit/plugin/plugin-manifest.test.ts`
- Modify: `tests/unit/server/config.test.ts`
- Modify: `tests/unit/adt/safety.test.ts`
- Modify: `tests/unit/server/effective-policy-log.test.ts`
- Modify: `tests/unit/server/ui.test.ts`
- Modify: `tests/unit/server/multi-target-runtime.test.ts`
- Modify: `tests/unit/cli/config-show.test.ts`

- [x] Add `blockedDataSources` to the server and safety contracts with `[]` as the safe, backward-compatible
      default. Normalize configured values with trim + uppercase + dedupe.
- [x] Accept only non-empty exact technical names made of `A-Z`, digits, `_`, `/`, or `$`, with a bounded
      length. Fail startup on a malformed item; never ignore a typo in security configuration.
- [x] Resolve CLI over env over default and record the source under the existing config-source contract.
- [x] Copy the list through `buildAdtConfig`, `deriveUserSafety`, profile intersection (deny union), and the
      explicit read-only multi-target config constructor. A user/destination may narrow but never remove the
      server blocklist.
- [x] Show the normalized list/count in `arc1 config show`, the read-only admin UI, structured startup
      policy logs, the human policy line, and source attribution without exposing any credentials.
- [x] Add focused tests first, observe the expected failures, implement, then run the focused config/safety
      suites and typecheck.

### Task 2: Build the strict ABAP SQL source analyzer

**Files:**
- Add: `src/adt/sql-source-analyzer.ts`
- Add: `tests/unit/adt/sql-source-analyzer.test.ts`

- [x] Wrap caller SQL in a synthetic report and parse with the pinned `@abaplint/core` v758 grammar.
      Require exactly the synthetic report/start event plus one complete `SELECT` or `WITH` statement whose
      terminator and synthetic target are present.
- [x] Extract every recursive `Expressions.DatabaseTable` identity so joins, unions, nested subqueries, and
      CTE bodies are covered; omit CTE aliases themselves.
- [x] Reject every caller host marker and every `SQLPrivilegedAccess`, `SQLClient`, `DatabaseConnection`,
      `Dynamic`, `SQLPathForEntity`, `SQLPathForColumn`, and `SQLProvidedBy` node.
- [x] Reject empty/no-source, multi-statement, caller-owned `INTO`, malformed, parser-incomplete, and source
      names outside the exact technical-name grammar. Return normalized unique source names only.
- [x] Build a negative corpus containing comments/string literals, keyword case, joins, union/subquery/CTE,
      dynamic sources, host method/value expressions, association paths, privileged access, client/connection
      clauses, injected periods/semicolons, DML tails, and unsupported syntax.
- [x] Confirm focused tests fail before implementation and pass after the smallest implementation.

### Task 3: Resolve live CDS lineage and DDIC replacements

**Files:**
- Add: `src/adt/data-source-policy.ts`
- Add: `src/adt/table-query.ts`
- Modify: `src/adt/client.ts`
- Modify: `scripts/ci/check-file-sizes.mjs`
- Add: `tests/fixtures/xml/cds-dependency-graph-750.xml`
- Add: `tests/fixtures/xml/cds-dependency-graph-758.xml`
- Add: `tests/unit/adt/data-source-policy.test.ts`
- Modify: `tests/unit/adt/client.test.ts`

- [x] Parse both sanitized live response families (`elementinfo+xml` on 750 and
      `SQLDependencyModel.v3+xml` on 758) into one bounded tree while preserving all aliases, source kind,
      relation, and dependency path.
- [x] Add a discovery-aware graph GET for `/sap/bc/adt/ddic/ddl/dependencies/graphdata`, using the advertised
      media type and `addMetrics=true` only for the SQLDependencyModel family. If discovery is unavailable,
      try the modern type then the old type only on a media-negotiation rejection; fail closed otherwise.
- [x] Resolve a submitted source with exact ADT quick search. Prefer a unique `STOB/DO` URI for CDS entity to
      DDLS mapping; accept a unique `TABL/DT` as a table; reject ambiguity, structures, DDLS source-only names,
      `VIEW/DV`, or unknown kinds.
- [x] For each table root, read active TABL source and detect the active
      `@AbapCatalog.replacementObject` with comment/string-aware lexing. Resolve the replacement entity
      recursively. Treat duplicate, present-but-malformed, or unterminated syntax as unresolved.
- [x] Reject oversized graph XML before parsing, then traverse with node/depth/cycle limits. Compare the configured list against `adtcore:name`,
      `ENTITY_NAME`, and `NODE_NAME` at every node. Accept only CDS-view and table node kinds; refuse table
      functions, classic views, external/unknown kinds, missing names, and explicit non-existing database
      objects.
- [x] Return the first blocked path in a typed `DataSourcePolicyError`; wrap resolver/parser/network failures
      as `DATA_SOURCE_UNRESOLVED` without losing the safe source/path context.
- [x] In `getTableContents`, `runTableQuery`, and `postFreestyleQuery`, return immediately when the list is
      empty; otherwise validate/analyze/resolve before the data-preview POST. Reject non-empty `sqlFilter`.
- [x] Assert direct blocks make no HTTP call; allowed tables/CDS issue metadata calls then one data POST;
      blocked transitive/replacement paths and every resolver failure issue no data POST.
- [x] Keep the ADT facade below its size ratchet by extracting the existing structured-query builder and the
      new request-scoped lineage adapter into dedicated modules; tighten the client budget after the split.

### Task 4: Make denials actionable and document the boundary

**Files:**
- Modify: `src/handlers/dispatch.ts`
- Modify: `tests/unit/handlers/dispatch-misc.test.ts`
- Modify: `.env.example`
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `docs_page/configuration-reference.md`
- Modify: `docs_page/authorization.md`
- Modify: `docs_page/security-guide.md`
- Modify: `docs_page/cli-guide.md`
- Modify: `docs_page/tools.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `docs/research/2026-09-02-data-source-allowlist-and-cds-lineage.md`

- [x] Format typed policy errors before the generic `TABLE_CONTENTS` safety hint so a blocked dependency is
      never misreported as a missing `SAP_ALLOW_DATA_PREVIEW` flag. Classify the audit error as
      `DataSourcePolicyError:<code>`.
- [x] Keep the reason concise: request not executed, stable code, direct source, first blocked dependency
      path or unresolved analyzer reason, and operator action. Do not include SQL literals or returned data.
- [x] Document exact matching, normalization, supported request subset, performance cost, fail-closed cases,
      multi-target global scope, non-atomic check/query race, and empty-list compatibility. Label it
      experimental everywhere operators configure it.
- [x] State explicitly that this is a deny emergency brake, not the future production allowlist, row/column
      security, DCL inheritance, or a substitute for SAP authorization/Note 3772411.
- [x] Update only capability/roadmap/release surfaces whose current claims would otherwise become stale; do
      not edit generated tool-definition fixtures because the MCP input schema is unchanged.

### Task 5: Detailed verification, correction, and final review

- [x] Run all focused unit suites, then the full test suite, typecheck, lint, build, and `git diff --check`.
      Fix every product or test issue and repeat the affected gates.
- [x] Add/run a live integration probe on SAP_BASIS 758 proving: a blocked direct table is denied before the
      data POST, a blocked transitive table denies a CDS root with its path, an unrelated static table query
      still executes, and disabling the list restores existing behavior.
- [x] On SAP_BASIS 750, prove the old graph shape reaches the same blocked-path decision before the unbound
      data-preview endpoint. Do not turn that backend limitation into a test skip unless it uses the existing
      taxonomy and helper.
- [x] Run 816 only if the intentionally stopped target is already available or can be started safely under
      the repository runbook; otherwise record it as unavailable rather than inventing evidence.
- [x] Review the complete diff for bypasses, unsafe fallback, list removal across auth/multi-target clones,
      TOCTOU overclaiming, secrets, raw live data, unrelated changes, and misleading docs. Search specifically
      for every data-preview POST and every `SafetyConfig` constructor.
- [x] Run a branch-diff security review, reproduce validated findings, correct them, and prove the original
      exploit paths are closed without weakening legitimate blocklist behavior.
- [x] Move this file to `docs/plans/completed/`, repair its research link, update the dossier with final
      commands/results and implementation deviations, and rerun documentation/link-sensitive tests.
- [x] Stage explicit files only; create a conventional `feat:` commit, push only to `origin`, and open a PR
      against `main` whose body summarizes the security contract, limitations, and unit/live verification.
