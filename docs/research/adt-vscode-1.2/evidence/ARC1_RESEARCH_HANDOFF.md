# ARC-1: ADT 1.2 research, results and implementation handoff

Research date: **17 October 2026**. Prepared for Marian Zeis. This document records completed research; proposed interfaces and priorities are recommendations, not existing features or immutable specifications. Recheck current code and upstream work before implementation.

## 1. Objective and recommendation

The original question was which ideas from SAP ADT for VS Code 1.2 ARC-1 should adopt, how Marian and ARC-1 users would benefit, and how transport diff could be improved in detail.

The strongest recommendation after inspecting and testing the code is:

1. Correct transport-review evidence and coverage problems.
2. Build a useful transport-review artifact on that engine, with explicit comparison modes, provenance, bounded collection, checks and coverage.
3. Add reusable SQL notebook artifacts and a runner over existing SAPQuery.
4. Add policy explanations using the existing enforcement logic.
5. Extend diagnostic feeds through discovered schemas and typed filters.
6. Investigate the now-specific DDIC activation-log GET contract, then implement if supported.
7. Expand historical text, function-group and metadata coverage according to real customer review gaps.

The opportunity is repeatable review, investigation and customer handover. A second general-purpose IDE or a longer tool catalog is a weaker investment. Existing Transport Organizer, version history, source search, write-package restrictions and explain-code capabilities should be reused.

## 2. Evidence package and where it lives

Original directory:

`/Users/marianzeis/Documents/Codex/2026-10-16/i-x20/outputs`

Files in the handoff package:

| File | Purpose |
|---|---|
| `ARC1_RESEARCH_HANDOFF.md` | This self-contained research record and prioritized implementation brief |
| `ARC1_IMPLEMENTATION_PROMPT.txt` | Ready-to-paste prompt for the implementation session |
| `arc1-deep-adoption-and-transport-review.html` | Detailed analysis, source links, acceptance criteria, research queue and business value |
| `arc1-adt12-adoption-review.html` | Earlier broad assessment of 19 release areas; the deeper report supersedes its prioritization and activation-log uncertainty |
| `arc1-transport-probe-results.json` | Results of eight synthetic probes against unmodified ARC-1 source |
| `arc1-transport-diff-probes.mts` | Reusable probe harness; takes the ARC-1 repository directory as its argument |
| `Flight_Capacity_Showcase.abapsql` | SQL notebook actually executed in SAP's extension on the 2023 system |
| `ADT_1.2_SQL_Notebook.png` | Screenshot of that real execution |
| `HANDOFF_MANIFEST.json` | File hashes, research baseline and evidence notes |

If the package is moved, resolve these files within the extracted package rather than assuming the original absolute directory is still available.

## 3. Baselines and important corrections

### ARC-1 code

- Repository: https://github.com/arc-mcp/arc-1
- Research commit: `9775645400fdb27f37aff486f14fe9845ecf8639`, dated 14 October 2026.
- Research checkout: `/Users/marianzeis/Documents/Codex/2026-10-16/i-x20/work/arc-1-upstream`.
- Latest published release verified on 17 October: **v1.5.2**, published 10 October 2026.
- Current main at that point contained unreleased work for 1.6.0 despite its package manifest still showing 1.5.2. Release PR #970 was open.
- `src/adt/transport-diff.ts` and `src/handlers/transport.ts` were identical between the research commit and tag v1.5.2.
- Marian's normal checkout, `/Users/marianzeis/DEV/arc-1`, was older, at commit `ceb5d6d00caa41864baee6ef455b368a3d00a166` with package version 0.9.19, and contained user files. It was not changed. Do not assume it is still at that state in the next session.
- The connected MCP surface in this research chat did **not** expose SAPTransport.diff. Its live VERSIONS results omitted transport attribution. This identifies a connector/runtime-surface mismatch, not the precise deployed server version or the absence of backend metadata. Check the running version and connector schema/cache separately.

### SAP extension

- Installed extension: `sapse.adt-vscode-1.2.0-darwin-arm64`.
- Path: `/Users/marianzeis/.vscode/extensions/sapse.adt-vscode-1.2.0-darwin-arm64`.
- Inspected transport/core/DDIC Java bundles: **3.62.0**.
- Inspected language-server bundle: `com.sap.adt.ls_1.2.0.202610161300.jar`.
- Static inspection used the installed classes; it established client behavior, not universal backend support. Do not claim each inspected behavior first appeared in version 1.2.
- The old ARC-1 comparison discusses SAP ADT 3.60.1 / extension 1.1.1. It is historical context, not a current 1.2 specification.
- SAP 1.2 exposes an `ignoreWhitespace` diff option, default false. Do not repeat a blanket claim that SAP has no whitespace-ignore option.

### SAP system

- Existing system context identified S/4HANA 2023, SAP_BASIS 758 SP02.
- Required external URL: **`https://a4h.marianzeis.de`**, port 443 with no port suffix; client **001**.
- Never use ports 50000 or 50001. Those are behind the nginx proxy.
- SQL showcase destination in the SAP extension: `A4H2023-2`. This is an editor destination name, not an ARC-1 authorization identifier.
- No credentials are included in this handoff.

## 4. What was actually researched and tested

1. Reviewed SAP 1.2 features against released ARC-1 and current upstream code, roadmap, ADR constraints, issues and PRs.
2. Read transport inventory parsing, logical-object rollup, class-part selection, revision selection, source retrieval, diff computation, truncation, pagination and related tests.
3. Examined the installed SAP transport diff implementation, revision metadata parsing and DDIC activation-log client behavior.
4. Ran four existing unit-test files: **181 tests passed** under Node 24.19.0.
5. Ran **eight synthetic probes** against unmodified research-commit source. These demonstrate code behavior under supplied inputs; they do not establish how frequently those inputs occur in customer systems.
6. Made **five read-only SAP calls** against existing transport demo history.
7. Earlier in the conversation, created and executed the flight-capacity SQL notebook in SAP's official extension and captured its result. ARC-1's data-preview gate was blocked at that point; the notebook demo does not establish that ARC-1 SQL was enabled.

No production source changes, new SAP objects, SAP activations, transport releases, policy changes, deployments or published PRs were performed during this research.

### Existing tests that passed

```text
tests/unit/adt/transport-diff.test.ts           49
tests/unit/adt/source-diff.test.ts              14
tests/unit/adt/revision-feed-transport.test.ts   9
tests/unit/handlers/transport.test.ts          109
Total                                        181
```

These are unit tests with mocked backends; some handler tests exercise mock writes. They did not mutate SAP. Passing them does not invalidate the additional findings: the new mixed/error cases were not adequately covered by the existing suite.

### Live verification

Request `A4HK906371`, task `A4HK906372`, remained readable and released. It contains class `ZCL_ARC1_TD_CALC` main-method and CCIMP components plus program `ZARC1_TD_REPORT`.

- Main revision 00001 → 00002: `rv = iv_a + iv_b.` becomes `rv = iv_a + iv_b + 1.`
- Implementations revision 00001 → 00002: `rv = iv * 2.` becomes `rv = iv * 3.`
- Both are deliberately seeded demo changes.
- Only the two class-part diffs were read in the live verification; no program diff or new ATC/Unit run was claimed.
- Calls used SAPTransport.get, two SAPRead.VERSIONS reads and two explicit SAPRead.diff reads. They establish underlying source-history access, not end-to-end execution of current upstream SAPTransport.diff through the connected older surface.

## 5. Transport diff: findings, decisions and acceptance criteria

The current foundation is valuable: request plus task matching, skipping work-state baselines, skipping contiguous same-transport snapshots, accepting blank-transport predecessors, CTS rollup, class-part mapping, fallback labels and unsupported inventory. Preserve these behaviors.

### TD-01 — Explicitly selected class part disappears on 404

**Evidence:** reproduced. When CTS selects main and CCIMP, main succeeds and implementations history returns 404, the implementations row disappears. The all-parts-failed guard does not cover this mixed result.

**Location:** `diffPart()` and `diffTransportObject()` in `src/adt/transport-diff.ts`, research lines 476 and 538.

**Implement:** retain the selection origin. Every CTS-selected part must have a visible result or explicit coverage classification. Distinguish unavailable, unsupported and genuinely absent. Do not interpret a 404 alone as deletion or no change.

**Acceptance:** main succeeds + selected include 404 still returns the include as an evidence gap; all parts failed and truly absent speculative parts remain correctly classified.

### TD-02 — Unattributed diff is blanked and labelled unchanged

**Evidence:** reproduced. For a whole-class R3TR entry, an exact main match causes a changed sibling with blank transport attribution to have its diff/counts cleared and the note “not changed by this transport.” Its unverified baseline label remains, creating contradictory output.

**Location:** `suppressUntouchedParts()`, research line 625.

**Implement:** retain candidate hunks/statistics, distinguish unattributed from unchanged, and collapse noise only at the presentation layer. Do not label these hunks definitely part of the transport either.

**Acceptance:** different sibling sources with missing attribution remain inspectable and uncertain; they cannot become a verified unchanged result.

### TD-03 — Text-pool coverage is lost during rollup

**Evidence:** reproduced. REPT-only changes become a PROG/CLAS source diff. Identical source returns no source change with no warning that text elements were not compared.

**Location:** `rollupTransportObjects()` and returned object/part model. Existing current text readers are in `src/adt/text-elements.ts`.

**Implement now:** preserve raw component kinds and report text pools as unreviewed/unsupported historical content.

**Investigate later:** historical symbols, selection texts, headings and language. A current text read is not a historical text diff.

**Acceptance:** a text-only transport cannot yield a fully reviewed unchanged conclusion.

### TD-04 — Undated active pseudo-version misclassifies the baseline

**Evidence:** reproduced with synthetic history. A dated released 00002 exists, but an undated active 00000 matching the request sorts last, gets no predecessor and yields no-prior-snapshot. Numeric comparison against zero misses the existing history.

**Location:** `selectTransportRevisionPair()` and `baselineStatusFor()`, research lines 135 and 201.

**Implement:** separate work states from numbered snapshot chronology; report ambiguity when ordering is unresolved. Never equate missing prior history with proven creation.

**Acceptance:** known history cannot become an asserted empty baseline merely because the matching work state lacks a timestamp. Preserve actual creation cases without overstating certainty.

### TD-05 — Source-state intent is implicit

**Evidence:** reproduced and intentionally permitted by an existing test. A newer inactive 99999 can win over active 00000, even though both match the request.

**Implement:** define released, active and draft comparison modes; preserve legacy behavior compatibly where required. Report sourceState, comparison intent and activation status. Pass necessary request state to selection. Released-history gaps must not silently substitute current work.

**Acceptance:** callers can identify exactly what was reviewed. Tests/checks carry the source state/hash they validate; current active ATC is not presented as proof about an older released snapshot. A saved draft is not a release-readiness result.

### TD-06 — Test-transport revision metadata is discarded

**Evidence:** installed SAP client parses `adtcore:isTestTransport`; its diff excludes flagged revisions except the one belonging to the requested transport. ARC-1 drops the flag. Synthetic history [requested 00003, flagged other-request 00002, regular 00001] selects 00002.

**Implement metadata first; validate the selection policy on live fixtures.** Preserve the flag and excluded-revision reasons. Keep a flagged revision when reviewing that request itself; normalize request/task identity consistently. Do not infer flags from descriptions or equate all transports of copies with flagged entries.

**Acceptance:** normal request with an intermediate flagged snapshot, direct review of flagged request, missing flag and task/request cases. Until verified, describe this as a client-contract/parser gap, not a proven production incident.

### TD-07 — Offset pagination does not freeze inventory or source

**Evidence:** code inspection and deterministic counterexample, not a live race test. After first page [A,B] from [A,B,C,D], removing A makes offset 2 return D and skip C. Sorting only solves unstable ordering.

**Implement:** normalized inventory fingerprint and drift detection for review continuation; bind any continuation state/token to the user, target, request and mode. Record exact source hashes and retrieval time. Inventory stability is not source stability; do not imply an atomic SAP snapshot.

**Acceptance:** additions/removals or target changes cannot silently produce a complete multi-page review. Source changes during collection are qualified or detected.

### TD-08 — Line/object caps do not bound the complete workload

**Evidence:** synthetic 300,000-character changed line returned 300,154 diff characters with no truncation flag. Current caps are 20 objects by default, max 40, and 400 displayed diff lines per part. Forty whole classes can require approximately 600 ADT reads plus inventory. Shared concurrency is bounded; total bytes/work are not bounded by those caps.

**Implement:** per-source and total output byte bounds, deadlines/cancellation and bounded queued work. Preserve full statistics when calculable. Prefer summary-first and bounded detail retrieval. Mark omitted hunks/content and keep a path to remaining evidence.

**Acceptance:** wide-line and large multi-class fixtures respect limits; truncated or timed-out work cannot become complete. Measure bytes, backend requests, latency and memory. Examine supported diff-library work bounds rather than assuming network concurrency solves CPU/memory usage.

### TD-09 — Feed completeness and malformed history

**Evidence:** synthetic rel=next is discarded; parser catches errors and returns empty history. Live pagination of these SAP history endpoints was not established.

**Implement:** distinguish invalid/unexpected history responses from valid empty histories.

**Investigate:** whether supported backends advertise actual continuation/limits. Implement pagination only from an observed contract; otherwise retain an explicit completeness qualification.

### TD-10 — Broader historical coverage and attribution

**Investigate:** text pools, FUGR includes and ownership, metadata histories, deletions, Customizing/table keys, transport-of-copies semantics, and simultaneous changes to different methods in different requests.

A whole class main-source diff can be broader than the CTS METH component under review. Do not attribute every hunk to one request until that mapping is proven. A source-system correction diff also does not establish what is deployed in QAS/PRD.

For each family, preserve explicit inventory gaps until a correct before/after contract exists. Prioritize classic text/FUGR/DDIC coverage for ERP maintenance customers, and DDLS/BDEF/SRVD plus activation/service diagnostics for RAP teams.

## 6. Transport-review artifact design

Compose existing tools rather than introducing a second review engine. Prefer additive changes to the existing intent tools and a CLI/client-side collector.

Deterministic evidence should contain:

- Target/system/client, request/task identities, request type/status, retrieval time and comparison mode.
- Raw CTS components, logical rollup and inventory fingerprint.
- Expected/attempted/returned parts and mutually exclusive coverage counts with a stated denominator.
- Structured revision evidence, source state, attribution, source hashes, baseline status and skipped reasons.
- Complete/truncated/stale/error states and bounded ways to retrieve remaining evidence.
- Checks with passed/failed/blocked/error/not-run/stale states and their actual source state/version/hash.

The human report should contain changed behavior, findings with object/part/hunk references, checks actually executed, coverage gaps and open questions. Keep deterministic facts separate from model interpretation. An empty diff is not a release verdict.

Reuse SAPContext for changed or uncertain objects and existing syntax/ATC/ABAP Unit actions. Historical evidence must not be misrepresented by checks performed on current active source. Avoid running every analysis on every dependency by default.

Deliver JSON evidence plus a readable HTML report with escaped source/text, no secrets and clear handling of optional included source/results. Preserve existing fields for compatibility rather than silently redefining them.

## 7. Other recommended work

### NB-01 — SQL notebook artifact and runner

**Build:** versioned Markdown/SQL cells with stable IDs, explicit logical target mapping, row cap, optional aggregate assertions and a runner over existing SAPQuery. Produce reusable query documents and optional execution reports with SQL/hash, target/client, execution time, row count, completeness and backend timing.

**Use cases:** data quality, before/after transport validation, migration reconciliation and performance investigation.

**Constraints:** imported notebooks do not auto-run; saved results are optional; preserve original string values, identifiers and decimal precision. Use purpose-built aggregate queries for assertions instead of drawing whole-data conclusions from limited detail rows. Do not invent generic OFFSET paging. Retain SQL/data scopes and gates, row ceiling and byte budgets. Parameter substitution, if implemented, must have an explicit safe contract.

**Interop:** the real `.abapsql` file demonstrates an observed SAP serialization, not a guaranteed public contract. Adapt supported fields, preserve unknown fields where possible, and map the editor destination explicitly to an authorized ARC-1 connection. The demo destination name is not itself a permission grant.

**Defer:** a full editor, another SAP credential store and expansion of the operator/admin UI into an IDE. Add a thin editor only when repeated real notebook usage identifies editing as the bottleneck.

### POL-01 — Explain the current caller's effective policy

**Build:** a read-only action explaining why a specific proposed action/target/object is allowed, denied or unresolved, using the same decision logic as execution.

**Reuse:** ACTION_POLICY, dispatch/safety checks, deny-action rules, target grants, real-package resolution and feature availability. Refactor shared evaluation if necessary; do not create a parallel approximate policy engine.

**Result:** separate target grant, required scope, server ceiling, feature state, package match and SAP authorization status. “Allowed by ARC-1” is not “SAP authorization verified.” Never make a write to test permission. Return only the current caller's relevant sanitized view; keep final execution-time enforcement.

**Benefit:** less onboarding/support work and fewer repeated blocked operations. Write-package restrictions do not establish read-package or data-query restrictions.

### FEED-01 — Discovered feed schemas and typed filters (FEAT-74)

**Existing evidence:** roadmap records `/sap/bc/adt/feeds` attributes/operators and query depth 2 on SAP_BASIS 816. Examples include runtimeError, exception, objectName, package and datetime. This is not proof of all fields on 758.

**Build after a bounded 758 probe:** expose approved feed schemas, validate typed filter trees against each target's schema, serialize through a grammar-aware compiler, and preserve user/from/to compatibility. Retain time/page/row budgets and existing same-timestamp pagination safeguards. Cache schema with correct target/auth context; do not share incident content across users.

**Benefit:** focused dump/error triage, fewer broad fetches and less irrelevant model context. Transport/incident correlation should produce candidates, not asserted causation.

### DDIC-01 — Dictionary activation-log reader (FEAT-71)

**New installed-client evidence:** `DdicActivationLogSupport.getLogUri()` resolves:

```text
relation: http://www.sap.com/adt/relations/ddic/activationlog
media type: application/vnd.sap.adt.logs+xml
```

`AdtLsActivationExtension` follows the discovered URI using GET. The log contains a severity hierarchy, messages and object links. This is different from `/activation/runs`; the earlier broad investigation description is now incomplete.

**Probe first:** existing DDIC metadata/logs on 758, advertised same-target canonical ADT link, missing log, denied access, stale log and object/run correlation. Prefer existing evidence before creating controlled failure fixtures.

**Implement when supported:** bounded read action under SAPDiagnose, with typed severities, hierarchy, references and unavailable/unsupported/denied states. Follow-up after a failed activation may read the log; it must not reactivate an object merely to obtain one.

**Acceptance:** distinguish log retrieval time from activation time. If the backend cannot correlate the log with the current attempt, say “latest available log; not correlated to this attempt.”

### SYN-01 — Mass syntax check (FEAT-69)

Validate the existing ADT multi-object checkObjectList contract, then support bounded object lists with deterministic per-object results and explicit incomplete/error/not-checked states. Reuse it in the transport workflow as appropriate. ATC and syntax are distinct checks.

### Conditional work and things to defer

- Historical text, FUGR, metadata and deletion adapters: implement only after each historical contract is established.
- OData service inspection: favor bounded metadata and safe GET validation for a demonstrated customer workflow; investigate SRVC generation separately before implementing authoring.
- Source search, object history, transport management, package restrictions and explain-code: reuse what exists.
- Generic unclassified object-action execution, arbitrary RFC parity, full type parity, automatic ATC exemptions and a full timeline/IDE: defer.
- Anchored editing already had open proposal #586; avoid duplication and recheck its status.
- Multi-target writes were an open proposal, not an approved baseline. Preserve the repository's current ADR constraints.

## 8. Delivery sequence, benefit and definition of done

Recommended sequence:

1. Verify current upstream/deployed/connector baselines and preserve the user's existing work.
2. Reproduce and fix TD-01 through TD-04; preserve raw component evidence.
3. Deliver TD-05 through TD-09 as appropriate, with the test-transport rule and history continuation gated by evidence.
4. Build the review collector and report. Add relevant mass syntax checking and reuse existing diagnostic/test tools.
5. Deliver the small notebook artifact/runner and policy explanation.
6. Verify and implement the feed and DDIC-log contracts where supported.
7. Investigate TD-10 families and service consumption in bounded slices; implement only those justified by evidence and demand.

Effort estimates from the research: 2–4 developer-days for focused transport corrections, 3–5 for the review contract/collection, 2–4 for a usable artifact; approximately 7–13 total for those slices, excluding deployment and broader cross-release validation. Notebook artifact/runner 2–4, policy explanation 2–4, feed probe ½–1 plus implementation 3–5, DDIC probe ½–1 plus implementation 2–4 if supported. These are estimates, not commitments or measured completion times.

Commercial hypotheses: transport-review deliverables, repeatable incident/migration investigations, supported deployment and enablement. ARC-1's MIT license makes services, support and integration natural offers; feature work does not prove customer willingness to pay.

Measure reviewer preparation time and rework, coverage by part/type, false complete/unchanged classifications, backend calls/bytes/latency/memory, time to relevant incidents, notebook reruns and onboarding blocked-call retries. Example only: 30 reviews/month × 15 minutes saved = 7.5 hours/month; freed capacity is not automatically revenue.

Done means implemented behavior with meaningful regression tests, current policy/schema consistency, documentation and roadmap changes where appropriate, and honest evidence about live verification. For a genuinely unsupported backend contract, a bounded investigation with recorded evidence, explicit unsupported behavior and a concrete resume condition is preferable to a guessed implementation. Continue independent deliverable work if a single research item remains blocked.

## 9. Engineering constraints to preserve

- Follow the current repository AGENTS.md, relevant dev-guide sections and applicable skills. Read the roadmap at the beginning and end; avoid duplicating current PR work.
- Preserve uncommitted user work. Use a suitable isolated checkout/worktree when needed, based on verified current upstream rather than the old research snapshot.
- Keep scope intersected with server safety and SAP authorization; fail closed on real-package checks; preserve separate SQL/data/transport/Git gates and per-user isolation.
- Single-target is the default. Keep experimental read-only multi-target architecture within its current ADRs; do not broaden it incidentally.
- Prefer extending existing intent tools and reuse their central schemas and action policies. Keep tools.ts, schemas.ts, handlers, docs and policy validation consistent.
- Do not retain SAP locks across MCP round trips, introduce arbitrary endpoint execution, or create an independent SAP authentication stack for notebooks.
- Run focused tests and the repository-required gates. Use a supported Node version; research used 24.19.0. Local default Node 22.18.0 was below the package requirement at the research baseline.
- Existing live evidence is read-only. Local implementation does not by itself authorize deployment, production writes, transport release or public publication.

## 10. Reproducing the probes and locating source evidence

After installing the repository's dependencies, from the intended ARC-1 checkout:

```sh
node --import tsx /absolute/path/to/handoff/arc1-transport-diff-probes.mts "$PWD"
```

Use a supported Node runtime. The harness calls pure selectors and mocked clients against the source in the repository passed as an argument. It makes no SAP/network calls. Output is an observation record, not an assertion suite; turn the desired corrected behavior into actual regression tests in the implementation.

Focused existing test command:

```sh
node node_modules/vitest/vitest.mjs run \
  tests/unit/adt/transport-diff.test.ts \
  tests/unit/adt/source-diff.test.ts \
  tests/unit/adt/revision-feed-transport.test.ts \
  tests/unit/handlers/transport.test.ts --reporter=default
```

Important files at the research commit:

| Area | Source |
|---|---|
| Revision selection/coverage/rollup | `src/adt/transport-diff.ts` |
| Transport pagination/inventory/release behavior | `src/handlers/transport.ts`, `src/adt/transport.ts` |
| Feed parsing and revision metadata | `src/adt/xml-parser.ts` |
| Revision endpoint map and query budgets | `src/adt/client.ts` |
| Diff algorithm | `src/adt/source-diff.ts` |
| Current text pools | `src/adt/text-elements.ts` |
| SQL output | `src/handlers/query.ts`, `src/adt/table-query.ts` |
| Diagnostics | `src/adt/diagnostics.ts` |
| Policy | `src/authz/policy.ts`, `src/handlers/dispatch.ts`, `src/handlers/write-helpers.ts` |
| Target grants | `src/server/multi-target-authorization.ts` |
| Roadmap | `docs_page/roadmap.md` (FEAT-69, FEAT-71, FEAT-74, FEAT-32) |
| Historical transport research | `docs/plans/2026-08-03-transport-diff.md`, `docs/research/2026-08-03-transport-diff-comparison-and-plan.md` |

Pinned source root: https://github.com/arc-mcp/arc-1/tree/9775645400fdb27f37aff486f14fe9845ecf8639

Primary documentation:

- https://help.sap.com/docs/abap-cloud/abap-development-tools-for-visual-studio-code/mcp-tools
- https://help.sap.com/docs/abap-cloud/abap-development-tools-for-visual-studio-code/enabling-adt-mcp-server
- https://help.sap.com/docs/abap-cloud/abap-development-tools-for-visual-studio-code/working-with-sql-console
- https://code.visualstudio.com/api/extension-guides/notebook
- https://github.com/arc-mcp/arc-1/pull/970
- https://github.com/arc-mcp/arc-1/pull/586

The HTML report contains direct pinned line links and additional rationale. Do not treat old roadmap notes or comments as stronger evidence than current source, reproduced behavior and verified backend responses.
