# Independent review: PR1142 runtime-trace and classic-FLP component at `fcb78914`

**Verdict: accepted for continued private development, with seven corrections recommended (two Medium, five Low).** None of the findings opens a public mutation path, and none is a defect in the intentional private, unadmitted state. Findings 1 and 2 should be fixed before the FLP harness relies on these results.

This is not qualification, merge readiness or approval to run anything natively. Full PR2 scope and the current two-writer and recording-transport qualification remain incomplete.

## Findings

### Medium

**1. The FLP-2 exit condition is weaker than the accepted plan**
- **Where:** `docs/research/2026-11-02-pinned-trace-flp.md:130`, `:139` and `:141-147`; `docs/adr/0011-broader-pinned-pp-mutations.md:110-111`
- **Scenario:** Qualification shows SAP refuses unrecorded changes in a recording client, so the lock is removed under "or proves SAP refuses unrecorded changes". SAP then records accepted changes into whichever open customizing request it selects.
- **Consequence:** FLP mutations could be admitted while SAP records into a request outside the server or destination allowlist. Plan §4 requires validating any native-selected request against both CTS policies before the executing call. ADR-0011:105-107 also ties customizing requests to the request allowlist. The earlier review's "SAP refuses" outcome addresses unrecorded changes, not which request is used.
- **Remedy:** Add a second condition to FLP-2 and the ADR text. Either the target request is established and allowlist-checked before the mutation, or SAP's request selection is shown to be constrained to allowed requests. Otherwise FLP stays a named gap.

**2. A committed FLP write can report "nothing was changed"**
- **Where:** `src/adt/pinned-flp.ts:209`, reached from readbacks at `:340` and `:385`
- **Scenario:** A catalog or group lists 499 tiles, so preflight passes. The POST succeeds and the readback sees 500 entries. `readTiles` then throws an `AdtSafetyError`, and `executePinnedFlpMutation` copies that message into the outcome.
- **Consequence:** The result carries `create-unconfirmed` or `membership-accepted-unconfirmed` together with "nothing was changed". An LLM or operator could believe no write happened. The state field is correct, but the message contradicts it and the "truthful outcome" contract. The tests cover only a full page at preflight (`tests/unit/adt/pinned-flp.test.ts:366-370`).
- **Remedy:** Move the "nothing was changed" wording to the preflight callers, or use a phase-neutral message. Add 499→500 regressions for tile creation and assignment.

### Low

**3. Single-target `trace_requests` changes behavior despite the "unchanged" claim**
- **Where:** `src/handlers/diagnose.ts:1153`
- **Scenario:** The `if (!user)` refusal is unconditional, so it also fires on a single-target route with no configured SAP user. The `AdtClient` default username is `''`, and `buildAdtConfig` copies `config.username`.
- **Consequence:** An empty username previously sent `?user=` to SAP. It now returns "on a Principal Propagation target", which is false on that route. If the username is `undefined`, the old TypeError is replaced by the same misleading text. The tests cover only a non-empty username.
- **Remedy:** Refuse only when `options.requireExplicitTraceUser` is set, and add a regression test.

**4. Aggregate catalogs always say `traceUser` is required**
- **Where:** `src/server/multi-target-runtime.ts:30`, `:68` and `:140`; `src/server/multi-target-tools.ts:263`; `src/server/pinned-runtime-candidates.ts:111`
- **Scenario:** `buildAggregateToolSurfaceConfig` passes no target, so `ppEnabled` is always true. A Basic-only or mixed aggregate catalog therefore says "required here", although Basic targets keep their default at runtime.
- **Consequence:** The schema text is wrong for Basic targets; runtime behavior is correct. The test at `tests/unit/server/pinned-runtime-candidates.test.ts:125-135` uses a `ppEnabled:false` config that aggregate construction never produces.
- **Remedy:** Word it as "required on Principal Propagation targets" for aggregate, or derive it from the visible targets. Test through the real aggregate config builder.

**5. The post-admission catalog description would list actions the caller cannot use**
- **Where:** `src/server/multi-target-tools.ts:249-253`; `src/server/pinned-runtime-candidates.ts:153`; `src/server/tool-auth.ts:31-40`
- **Scenario:** The SAPManage description joins actions before scope and `SAP_DENY_ACTIONS` pruning, and pruning rewrites descriptions only for the `SAP` tool.
- **Consequence:** After admission, a read-only caller's description would name `flp_create_*` and `flp_delete_catalog` while the enum offers only lists. Plan §3 requires one capability decision and accurate reader variants. The admission test checks the enum but not the description (`tests/unit/server/pinned-runtime-admission.test.ts:109-120`).
- **Remedy:** Remove the action list from the description or rebuild it after pruning, and assert it for reader and denied variants. Fix this before any row is moved.

**6. FLP checks accept missing or unchecked ownership fields**
- **Where:** `src/adt/pinned-flp.ts:213-215`, `:230-241`
- **Scenario:** A missing `isReadOnly` or `isCatalogPage` counts as writable, and groups have no scope check. A delivered group in the group container with neither flag present would pass as an assignment target.
- **Consequence:** Native shapes that are still unproven pass by default. FLP-3 and FLP-4 name these questions, but neither makes field presence a pass condition.
- **Remedy:** Have FLP-3 and FLP-4 record field presence, value domain and group scope. Make the checks require those fields before admission, or record why they can't.

**7. Companion list reads keep legacy semantics that conflict with the adapter's rules**
- **Where:** `src/handlers/pinned-flp.ts:23-33`; `src/adt/flp.ts:183-186`, `:178`, `:196`
- **Scenario:** `flp_list_catalogs` turns any 404 into an empty list, including an HTML 404 from an inactive ICF node. Catalog and group lists stop silently at 500 entries, and these reads have no response budget.
- **Consequence:** If admitted, an unavailable service would read as "0 catalogs" and a capped list would look complete. The research note's HTML-404 guarantee applies only to the mutation reads. FLP-1 would not detect this.
- **Remedy:** Before admitting the lists, use the OData-shaped absence check, a truncation note and a response budget on the pinned path, leaving the legacy path unchanged.

**Test comment (no separate finding):** `tests/unit/adt/pinned-trace.test.ts:37` calls its feed the "Real 758 feed shape" from the June research. That document has no `atom:author` or admin-role evidence. The subject check depends on `author[role=trace]`, so the comment overstates its provenance. The behavior fails closed, and TRC-1 must prove the shape. Reword the comment.

## Reviewed with no new finding

| Area | Result |
| --- | --- |
| **Public closure** | No candidate row exists in `pinned-mutation-capabilities.ts`. Pinned and aggregate calls stop at `multi-target-server.ts:617-640`, before PP preparation. Direct dispatch still reaches `pinnedOperationContext`, which refuses without falling back to legacy adapters. |
| **Ceilings and identity** | `buildMultiTargetConfig` requires pinned mode, XSUAA attribute authorization, PP, destination opt-in, raw write scope and both exact grants. Basic targets get `ppEnabled:false`. |
| **Private entries** | No `src`, `scripts` or `bin` caller exists, and they are not in package exports. They repeat the non-token gates and deliberately skip the token-scope check, which the author disclosed. The FLP `_recording` argument is enforced only at compile time, so it is not a runtime check. |
| **`trace_requests`** | Multi-target PP requires an explicit user, and shared Basic keeps its default. |
| **Profiler** | The orphaned and unconfirmed states are correct at each POST and at cancellation between them. No request replays. Subject and client come only from explicit native roles. Bounds and exact-user rules hold. Cancel deletes only the listed native path. The same-user readback skip is reported, and the June 758 evidence supports it for HTTP. |
| **ST05** | Unknown shapes and live-filter replacement are refused. Only two fields are edited, and escaping and decoding work. The weak-ETag state is reported honestly. Every instance and all unrelated fields are compared on readback. No own-user or client-isolation claim is made. |
| **FLP** | Keys are restricted and encoded, tile URLs are constrained, and nested fields are validated raw. Membership requires the native composite reference. There is no `$filter`, and only OData-shaped 404s count as absence on mutation reads. |
| **Mechanical changes** | The trace extraction is move-only, including query parameter order. The ETag helper keeps the formatter message by default. Docs and tests make no public-capability claim. |

## FLP recording assessment

**The question is unresolved, and the current code handles it correctly.** Public mutations refuse, and every private outcome says `recording: not-established`. That matches plan §4 ("refuse… until qualified") and the earlier review's rule that an operator declaration is not an option. Existing GET-only research is not recording evidence.

Native evidence still needed, all through real pinned PP rather than direct Basic:

1. **Client settings matrix:** Run each of the five mutations in clients set to automatic recording, changes without recording, and no changes allowed. The recipe's "on and off" misses the third. Use 750, 758 and 816 where available.
2. **Request preconditions:** In the recording client, test with no open customizing request, one open request for the mapped user, and several open requests. Capture the full status, headers and error body for each.
3. **Refusal behavior:** Confirm whether SAP refuses, selects a request or persists without recording. After any refusal, a keyed read must show nothing was stored.
4. **Recording proof:** After any success, capture the CTS request or task, its owner and its entries, and show the owner is the mapped SAP user rather than the IdP name. Compare the request against both allowlists. This proof comes after the mutation, so on its own it doesn't satisfy the plan's "before mutation" rule.
5. **Pre-mutation signal:** If a candidate read exists, record it for every matrix cell and show it predicted the outcome each time. Any wrong prediction disqualifies it.
6. **Delete and nested effects:** Show whether a catalog delete records its tiles and any group references, and whether the recording differs from creates.

If items 3–5 yield neither a usable signal nor a constrained request, FLP mutations stay a named gap, and the list reads can be admitted separately once finding 7 is fixed.

**Additional gap outside FLP:** TRC rows don't cover multi-instance behavior for `server=*`, and the June evidence is from one host. The adapter requires exactly one entry in the create response, so a per-instance response would make every start `request-unconfirmed`. Add this to TRC-4.

## Checks

| Check | Result |
| --- | --- |
| `python3 review-input/verify-snapshot.py` (first and last) | `fcb78914…`, 4,554 files, unchanged both times |
| `npm exec -- vitest run --silent=true` | 505 files, 13,673 tests passed |
| `npm run test:qualification:pr1142` | All printed scenarios `passed:true`, exit 0 |
| `npm run typecheck` | Passed |
| `npm run check:sizes` | Passed, 997 files and all schema budgets within limits |
| `npm run validate:policy` | Passed, 135 policy entries across 14 tool schemas |

## Evidence limits and deviations

- **Evidence limits:**
  - This was offline source review with mocks and earlier research only. No SAP system, network, browser or delegation was used, and no mutants were run.
  - The check results show the suite passes, not that native shapes are right. Those shapes remain unproven until the TRC, ST5 and FLP scenarios run.
  - For finding 3, I confirmed the `''` default and the `config.username` copy, but not which deployment configurations produce each value.
- **Deviations:**
  - One Grep used a path outside the snapshot root by mistake. The tool refused it and I re-ran it on the correct path.
  - The Vitest output was too large to display, so I read its summary from the saved output file with Grep. That file is outside the working directory.
  - I edited nothing, wrote no report files and ran no commands outside the approved list.
- **Not reported as defects:** the unadmitted state, the FLP recording lock, the absent `allUsers` schema and the native harness files from the `13f` baseline.
