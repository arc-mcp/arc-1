Review completed 31 October 2026 using actual Claude Code `claude-opus-5-5`, effort `max`, read-only tools, hooks/MCP disabled. Reviewed immutable commit `03593894c769d6f042a0770f89950c99120fc0aa`; later implementation is outside this review. Reviewer output follows. Dispositions are tracked in the 31 October checkpoint.

# ARC-1 PR #1142 review: prerequisite patch and ADR-0011 inventory

**Bottom line:** I found no security or blocking problems in the prerequisite patch. You can go ahead with implementation, but ADR-0011 needs to name three downstream boundaries before the related adapters are allowed in. This was read-only and I ran no tests. The 16 green CI checks are your evidence, not mine. I used about 30 focused reads.

Short names below: **ADR** = `docs/adr/0011-broader-pinned-pp-mutations.md`, **Plan** = `docs/plans/2026-10-26-broader-pinned-pp-writes.md`, **Inv** = `docs/research/broader-pinned-pp-writes/inventory.{md,json}`, **InvTest** = `tests/unit/server/pinned-mutation-inventory.test.ts`.

## 1. Prerequisite patch

### What I confirmed
- **The shared result covers only the two gates of one decision.**
  - `packageHierarchyDecision` is called in one place only (`src/adt/safety.ts:260`). Its memo lives for a single `checkPackage` call and is shared only by the server and destination gates (`safety.ts:261-266`).
  - Every check point builds a new resolver with `ttlMs: 0` (`src/handlers/write-helpers.ts:949`, `src/handlers/write/pinned.ts:84`, `src/adt/client.ts:335-336`, `src/adt/package-hierarchy.ts:46`). So even a caller that reuses one resolver object gets a fresh walk for each decision.
  - A cached rejection can't leak to the second gate: the server gate throws first (`safety.ts:302-305`).
- **Evidence is fresh at every boundary.** Preflight (`pinned.ts:84/86`), the under-lock check (`pinned.ts:126-133`) and activation's three checks (`pinned-activation.ts:53,60-67`) each re-read the package and walk again. Tests: `pinned-writes.test.ts:240-253, 298-313, 314-325`.
- **Hierarchy and CSRF reads are bounded.**
  - A missing, unbounded or replayable policy is refused before any SAP request (`package-hierarchy.ts:37-38`). Only deadline, signal and the fixed no-replay/no-retry flags are copied (`:40-45`). The hierarchy POST receives that policy (`client.ts:1294-1295`).
  - Unit tests cover this at `pinned-package-hierarchy.test.ts:41-140`.
  - The handler-level abort test covers both preflight and under-lock. It checks signal identity and that no `/source/main` request goes out. In the under-lock case it also checks that UNLOCK is still attempted (`pinned-writes.test.ts:254-288`).
- **Legacy behaviour is unchanged.** The shared cache holder and the original 4-argument POST are untouched (`client.ts:337-342, 1296`). In single-target mode `mutationHttp` passes the raw HTTP client through (`src/adt/mutation-http.ts:58`).
  - Callers that pass no policy now throw in multi-target mode (`write-helpers.ts:1024`, `manage.ts:149,151,264,301`, `write/create.ts:524,1009`, `write/uiad.ts:35`). That is a useful tripwire for PR2.
- **Activation keeps the original deadline.**
  - `activate()` still builds its own 300 s budget (`src/adt/devtools.ts:182-188, 215`). But every request passes through the facade, which takes the earlier of the two deadlines, forces no replay and no retry, and combines the signals (`mutation-http.ts:43-49`).
  - The facade overrides every request method the HTTP client exposes (`mutation-http.ts:63-77` against `src/adt/http.ts:244-276, 1016`), so no request can slip past it.
  - Batch activation and its ED064 fallback are refused in multi-target mode (`devtools.ts:283`).

### Findings (all Low, none blocking)
1. **[Low] A cancel or timeout during the walk is still reported as a policy refusal, and no decision is recorded.** The error is rewrapped (`package-hierarchy.ts:146-153` → `safety.ts:302-305`) and surfaces as `PINNED_WRITE_REFUSED`. This prior note has no row in the dispositions table at `docs/research/2026-10-29-broader-pinned-pp-writes-progress.md:50-57`. The reported state and phase are correct (`pinned-writes.test.ts:278-281`). Either accept it explicitly or tell cancellation apart before the CTS and delete adapters reuse this path.
2. **[Low] Each walk still covers the whole subtree, and one walk runs while the ADT lock is held.** `computeSubtree` never stops early (`package-hierarchy.ts:159-188`). That means up to 10,000 sequential POSTs at preflight, again under the lock, and up to three decisions per activation. Sharing between gates removed the duplicate, but not the worst case. It fails closed, so the cost is availability and lock-hold time. PR2 multiplies it (batches, multi-owner activation, deletes). Consider stopping once the package is found, since finding it is proof; a denial still needs the full walk. Also consider one decision per phase for batches.
3. **[Low] Prior test gap 2 is only partly closed.** Package drift before the first submission is covered (`pinned-writes.test.ts:314-325`). Still untested: drift at the check after the preaudit prompt (`devtools.ts:259`) under a subtree rule, and whether activation's hierarchy calls carry the policy. The deadline test uses an exact `$TMP` rule, so it makes no hierarchy calls (`:326-348`).
4. **[Nit] The deadline test checks the options object, not the actual abort.** The activation's `fetchTimeoutMs: 300_000` survives the options spread (`mutation-http.ts:44`) and switches to the dispatcher without header/body timeouts (`http.ts:1410-1412, 1505`). The real cut-off depends on `requestDeadlineRemaining` picking the earlier bound (`http-deadline.ts:47-51`, which I only partly read). A test with a hanging POST would pin this down.

### Prior issues: dispositions
| Prior item | Status |
| --- | --- |
| F1 duplicate walks | **Closed** (`safety.ts:260`, test `pinned-writes.test.ts:298-313`); the optional early exit wasn't adopted (see finding 2) |
| F2 unrelated options copied | **Closed** (`package-hierarchy.ts:40-45`; test `pinned-package-hierarchy.test.ts:99-114`) |
| F3 stale docs | **Closed** in the resolver header (`package-hierarchy.ts:25-26`); I didn't re-read the dev guide or operator text |
| Activation child budget | **Closed** (`pinned-activation.ts:52`, `mutation-http.ts:47`, test `:326-348`) |
| Cancellation reads as refusal | **Open, no disposition** (finding 1) |
| Gaps 1, 3, 4, 5, 6, 7, 8 | **Closed:** `pinned-writes.test.ts:254-288`, `:298-313`, `:289-297`, `:287`; `pinned-package-hierarchy.test.ts:99-114`, `:116-140`; error-class and phase assertions at `pinned-writes.test.ts:247` and `pinned-package-hierarchy.test.ts:76-78, 95, 126, 136-138` |
| Gap 2 | **Partial** (finding 3) |

## 2. ADR-0011 and the inventory

The admission chain (ADR:25-30) matches Plan:78-93. The scope matches the owner's direction: Git and custom extensions excluded; aggregate, Basic and destinations without write opt-in stay mutation-free; no acknowledgment flag (ADR:87-89). Every current mutation key has a disposition (Inv json:4-298, InvTest:19-29).

### Findings
**M1 [Medium, ADR defect] — CTS release leaves the target boundary, and the ADR drops the plan's sentence saying so.**
- Plan:381-382 requires stating that request/target policy "is not an import-route sandbox". ADR:49-54 only says `target` is the native TMS target, and ADR:99-101 says "irreversible releases/deletes" in general terms.
- Write grants and request lists decide *which* request on this target can be managed, not *where it goes*.
- Release (Inv json:161-172) exports the request into the import queues of every system on its route. The route comes from the package's transport layer or from the native `target` set at create (Plan:374-376). Recorded deletions travel the same way.
- If imports are scheduled or auto-approved, a writer on DEV can change QA/PRD, which may be ARC-1 targets where that person has no write grant.
- **Fix:** state in the ADR that TMS routes, QA approval and import authorization are the only controls, and name `SAP_DENY_ACTIONS` for release as the opt-out.

**M2 [Medium, unaccounted boundary] — DDIC dependent effects are invisible to the activation check.**
- ADR:44 implies that checking initial owners plus the references SAP lists bounds the activation. But the check only sees SAP's inactive-objects prompt (`devtools.ts:254-261`).
- DDIC activation also processes *active* dependents during the run: tables, structures and table types that use a changed DOMA/DTEL/structure (Inv json:427-505). These can live in packages outside the allowlist, and table changes can require a database adjustment.
- Signature edits work similarly (Inv json:59-76): they don't reactivate dependents, but they break them at runtime in packages the writer can't edit.
- So `allowedPackages` limits what is edited, not how far the effects reach.
- **Fix:** before the P2-C metadata families and P2-D, choose one: a where-used preflight that refuses or reports when dependents fall outside both policies, or an explicit ADR statement accepting the effect.

**M3 [Medium, unaccounted boundary] — Readers keep tools that consume what writers can now create.**
- The reader surface keeps `unittest`, `traces`, `trace_requests` and the ST05 reads (`src/server/multi-target-tools.ts:63-81`, with `ALLOWED_OPS` including Test at `:90-97`). All are `read` scope (`src/authz/policy.ts:151,159,162,172,174`), whereas `authorization_trace` is `data` scope (`:170`).
- **(a) Test code written by writers runs as the reader.** PR2 makes PROG/FUNC/FUGR/INCL and class test includes writable (Inv json:301-354, Inv md:20-22). ABAP Unit runs that code as whoever calls `unittest`, with that person's SAP authorizations. That includes pinned readers, admin/CI identities, and readers on a writes-off destination pointing at the same system and client, where that exists. The declared risk level is chosen by the author.
  - Plan:556-559 names this path and the `SAP_DENY_ACTIONS=SAPDiagnose.unittest` mitigation. The ADR only says "authored-code effects" (ADR:99-100).
- **(b) Writers can trace other users, and readers can read the result.** Writers can arm traces for an explicit *other* SAP user (ADR:69, 79-81; Plan:401-405). The resulting profiles are readable at `read` scope, limited only by SAP's native authorization. The ADR should decide: self-only on pinned routes, `data` scope, or explicit acceptance.
- **(c) ST05 may not be limited to the target's client.** ADR:47 calls traces "target/client-level", but Plan:415-417 says ST05 state is set per application-server instance. Check natively whether a user filter stays within the client; if it doesn't, it reaches other ARC-1 targets on the same system.

**M4 [Medium, prerequisite for P2-B] — Today's catalog filtering is keyed by tool name only.**
- `MULTI_TARGET_ACTION_RULES` and `ALLOWED_OPS` (`multi-target-tools.ts:32-97`) take no input about route, destination or grants.
- Adding PR2 actions there, or un-hiding `target`, `transportLayer`, `owner`, `recursive` or `removeLockedObjects` (`:48-57`) or `indentation`/`style` (`:41`), would widen every reader that uses this map.
- **Fix:** build the capability-keyed decision the plan and ADR require (Plan:68-69, ADR:32), plus a regression test that the reader view stays exactly as it is today.

**L5 [Low] — The drift guard is weaker than ADR:22-23 claims.**
- **Actions:** mutations are picked by operation type, and `SAP.*` keys are skipped (InvTest:20-22). Action lists aren't snapshotted, so a new action classified as Read or Test changes nothing in the test. The runtime refuses unknown actions by default (`multi-target-tools.ts:30-31`), so this is a completeness gap, not an admission gap. Snapshot each inventoried tool's full action list, and assert that `SAP.*` is refused on pinned routes (the ADR relies on standard tools, ADR:30).
- **Aliases:** only `SLASH_TYPE_MAP` is scanned (InvTest:41-50). A bare `TABL` resolves to either a table or a structure (Inv md:25), so admission must use the resolved family or endpoint, not the raw `type` string.
- **Nested inputs:** only top-level fields are checked. That's acceptable for an initial inventory (Inv md:54-57), but snapshot `objects` (Inv json:701, 740) and the FLP `tile` field (`:766`) before the batch, activation and FLP adapters.

**L6 [Low, ADR wording for accepted tradeoffs] — CTS request-list semantics.**
- ADR:46 should say that an absent destination request list denies all management (Plan:152, 336-337). This is exactly the case where the legacy guards treat the runtime's empty `allowedTransports` as unrestricted (Plan:338-343).
- It should also state the consequence of the `*` requirement for create (ADR:49-51). The same list governs source recording (Plan:155), so enabling create also lifts the request restriction on recording and allows management of every request on that client, including other users' requests (Plan:329-332).

**L7 [Low, prerequisite] — Some pinned lookups don't require the policy.** ADR:72-73 says every policy lookup shares the deadline and cancellation. However, `resolvePinnedRequest` can be called without a policy (`pinned-writes.test.ts:167`). Also, `resolveObjectPackage` and `getSubpackages` run on `client.http`, outside the facade (`write-helpers.ts:942`, `client.ts:336`). Make the policy mandatory, using the same tripwire as `package-hierarchy.ts:37-38`, before the CTS and batch adapters reuse them.

### Other prerequisites by adapter
- **Repository:** convert the policy-less call sites listed in section 1 to pass the policy, and admit on the resolved type.
- **Activation (P2-D):** add a test for drift after the preaudit prompt. Decide how to treat listed references that are another user's inactive draft (ADR:100 is generic). Allow ED064 only within the validated set (Plan:298-300).
- **CTS (P2-F):** land both low-level guard branches together with the runtime switch (Plan:338-343, 473). Build negative tests from `buildMultiTargetConfig` (Plan:498-500).
- **FLP:** in clients that record customizing changes automatically, FLP needs a customizing request, but CTS create only makes Workbench requests (Plan:357-358). Decide whether request lists may contain customizing requests; otherwise FLP refuses, which ADR:47 already allows.
- **Publication:** `publish_srvb` (Inv json:113-124) creates a reachable OData service governed by SAP service authorization, not package lists. Unpublishing removes it for other consumers. State this in the ADR.
- **Quickfix:** "returns deltas" (ADR:83) is an assumption. Verify it per proposal kind (see `proposalAffectedObjects`, Inv json:825).

### Accepted tradeoffs, not defects
- Transport scope applies across the whole application (ADR:56-62).
- No new flag or acknowledgment.
- CTS authority is at request level.
- Create needs `*`.
- Traces, settings and FLP are authorized at target level, with no package ownership (Plan:392-395).
- Delete has no source hash (ADR:43).
- Trace state survives the tool call (Plan:418-420).
- No rollback; partial outcomes are reported.
- The initial drift guard is top-level only.

## Verdicts
- **(a) Prerequisite patch: accept it as the PR2 prerequisite checkpoint.** No security or blocking findings. Record a decision for finding 1; findings 2 and 3 can wait until before the broader adapters.
- **(b) Implementation: go ahead, with conditions.**
  - Start P2-B now, including M4 and the action-list and alias parts of L5.
  - Before allowing in CTS (P2-F), DDIC families and generalized activation (P2-C/D), PROG/FUGR/test-include writes, or trace actions (P2-G), amend ADR-0011 for M1, M2, M3 and L6.

Neither verdict approves merging the full PR2 or counts as live PP qualification. Not read: dev guide, `crud.ts`, `pinned-write-policy.ts`, `multi-target-write-surface.ts`, gate record and manifest.