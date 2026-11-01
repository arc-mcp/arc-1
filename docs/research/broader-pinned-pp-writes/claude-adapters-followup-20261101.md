Actual Claude Code `claude-opus-5-5`, effort `max`, CLI 2.1.302. Immutable source revision `1a621f67f0d5dd25e16ef1dc5704b343e02e6b39`.

# PR #1142 correction `1a621f67f`: production delta accepted at source level, evidence wording not yet

**Decision:** all six production findings are closed, and I found no new authorization, parsing, capability, session, deadline, cleanup or invocation defect. One Low gap remains in the production delta. The evidence wording needs three Medium and three Low corrections, all documentation only. This does not approve the PR.

I only read and traced the code, and ran no tests, build, hashes or live checks. `validation.json` reports 10,843 tests, which fits 10,819 plus the 24 new cases I counted in the patch, but I did not reproduce that result. I ran as `claude-opus-5-5`; I can't see the effort setting or CLI version, so record those from the invocation.

## Closure of the six findings
1. **Legacy single-target on an overlap instance: closed.**
   - `source/src/handlers/write.ts:65` now uses the same markers as `source/src/handlers/lint.ts:33`.
   - The base `/mcp` config has none of them. They are set per call (`source/src/server/multi-target-runtime.ts:96,122`), and multi-target servers always replace the config first (`source/src/server/server.ts:818-833`).
   - Tests cover both the legacy route and the remaining markers (`source/tests/unit/handlers/pinned-delete.test.ts:50-69,175-196,211-219`).
2. **Raw selectors and fields: closed at both layers.**
   - `source/src/server/multi-target-write-surface.ts:20-27` removes only null and blank values before checking fields, so it catches every silent drop in `source/src/handlers/object-types.ts:254-262,304-307`.
   - Preparation checks the args as supplied (`source/src/server/multi-target-server.ts:609,617`), and dispatch checks before Zod (`source/src/handlers/dispatch.ts:1000-1023`).
   - HTTP calls stop at preparation, so the dispatch check is a backstop for direct callers.
3. **Source-less delete schema: closed.** `required` is now `['action','type','name']` (`source/src/server/multi-target-tools.ts:186`), and the test validates against the advertised schema (`source/tests/unit/server/multi-target-writes.test.ts:98-99`). Create, update and edit_method are still refused without source (`source/src/handlers/write/pinned.ts:54-55`).
4. **Typed absence: closed.**
   - `source/src/adt/pinned-delete.ts:92-97` requires a 404, `ExceptionResourceNotFound` and no classifier match. ICF pages, "No suitable resource found", proxy HTML and empty bodies stay `delete-unconfirmed` (`source/tests/unit/adt/pinned-delete.test.ts:111-127`).
   - A typed endpoint-level 404 looks the same, but that URL has just served the under-lock package read and DELETE in this session (`:74,87`).
5. **Primary failure plus cleanup: closed.**
   - Unlock errors are recorded rather than thrown (`source/src/adt/crud.ts:136-147`), so the primary phase and status survive.
   - Cleanup details are separate (`source/src/adt/pinned-delete.ts:131-141`) and reach the result (`source/src/handlers/pinned-operation.ts:46-59`).
   - `phase: "unlock"` now appears only when no earlier error occurred (`source/src/adt/pinned-delete.ts:128`).
6. **Deletion opt-out documentation: closed.** `source/docs_page/multi-target-writes.md:150` is accurate. `SAPWrite.delete` is a valid rule (`source/src/authz/policy.ts:90`) that matches only that action (`source/src/server/deny-actions.ts:171-180`). It is enforced in the catalog, preparation and dispatch (`source/src/server/tool-auth.ts:24-29`, `source/src/server/multi-target-server.ts:664-681`, `source/src/handlers/dispatch.ts:981-998`).

## Defects

### Medium: the deletion record says the native evidence still covers "the same" adapter
**Where:** `source/docs/research/2026-11-01-broader-pinned-pp-writes-deletion.md:16-18,53-54`, `source/docs_page/roadmap.md:222-223`

- **Problem:** this delta changed that adapter. The live run used the earlier any-404 check at base `1c05fda69` (`source/docs/research/broader-pinned-pp-writes/delete-native-2026-11-01.json:8-12`), so the typed absence check has never run against SAP.
- **Repair:** say that the native run exercised the earlier any-404 adapter and that typed absence has unit evidence only. Also fix the roadmap sentence that breaks at "checks;".

### Medium: the formatter record says native bytes "prove restoration"
**Where:** `source/docs/research/broader-pinned-pp-writes/formatter-pp-2026-11-01.json:325,378`, `source/docs/research/2026-11-01-broader-pinned-pp-writes-formatter.md:156`

- **Problem:** this contradicts FMT-1. Identical bytes are also what you'd see if the pinned PP writes never reached MARIAN's record.
- **Repair:** say the record ended byte-identical to its pre-run state, and that this doesn't show the writes reached it. Keep the recorded field, and add the limit next to it.

### Medium: the formatter review outcome did not reach every status statement
- **Contradiction:** `source/docs/research/2026-11-01-broader-pinned-pp-writes-formatter.md:6-8` says the build "passed" and that review is "still pending". Its own limits at `:150-152` say the review happened and did not accept the same-actor proof.
- **Public guide:** `source/docs_page/multi-target-writes.md:146-147` still presents "two-user PP evidence" with only acceptance pending.
- **Other stale text:**
  - `source/docs/adr/0011-broader-pinned-pp-mutations.md:130-131`
  - `source/docs/plans/2026-10-26-broader-pinned-pp-writes.md:3-4,440`, and `:12`, which still says "Unadvertised" for deletion
  - `source/docs/research/broader-pinned-pp-writes/inventory.md:40`
  - `source/docs/research/broader-pinned-pp-writes/formatter-native-2026-11-01.json:60`
- **Repair:** reuse the accurate wording from `source/docs_page/roadmap.md:217-219`.

### Low
1. **Production: nothing pins the runtime source requirement** (`source/src/handlers/write/pinned.ts:54`, `source/src/server/multi-target-tools.ts:158`).
   - Neither the catalog nor Zod (`source/src/handlers/schemas.ts:790`) requires `source` now, so this check is the only guard. It is correct, but I found no test for it.
   - **Repair:** add a missing-source case for each of the three actions, modelled on `source/tests/unit/handlers/pinned-writes.test.ts:225-229`. Change the description to "Required for create/update/edit_method; omit for delete", like its siblings at `:163,174`.
2. **FMT-12 is only half corrected** (`source/docs/research/2026-11-01-broader-pinned-pp-writes-formatter.md:81-82`). "`read` for companions" still conflicts with the read-only token's refusal at `:128`.
   - **Repair:** say companions need `read` scope on a writable pinned connection (`source/src/server/multi-target-write-surface.ts:62-63`).
3. **Provenance labels are incomplete.**
   - The formatter evidence states token handling and restoration as fact (`source/docs/research/broader-pinned-pp-writes/formatter-pp-2026-11-01.json:327-337`, `source/docs/research/2026-11-01-broader-pinned-pp-writes-formatter.md:107,141-144`), though the closing review treats these as reported only.
   - `source/docs/research/2026-11-01-broader-pinned-pp-writes-pp-qualification.md:85` says "no token was persisted", while its JSON (`source/docs/research/broader-pinned-pp-writes/pp-qualification-2026-11-01.json:139`) says there is no exhaustive attestation.
   - The claim at `source/docs/research/2026-11-01-broader-pinned-pp-writes-pp-qualification.md:68` is too broad: `claimProvenance` omits `backendSentinel` and `preflightAbsent`, and `secondaryAttemptReservations` is unlabelled. I can't verify that reservation claim from this snapshot.
   - **Repair:** add the missing labels and match the wording to them.
4. **The deletion JSON lacks limits that its record states** (`source/docs/research/broader-pinned-pp-writes/delete-native-2026-11-01.json:30,48,52-56`). It omits the same-stack absence read, the lack of a TADIR check, the active-version and `changedBy` gaps, and the untested cleanup branch.
   - **Repair:** copy them from `source/docs/research/2026-11-01-broader-pinned-pp-writes-deletion.md:75-77`.

The other wording corrections match the closing reviews, including the per-run harness labels, the formatter limits and the CLS items recorded. "Every response" at `source/docs/research/2026-11-01-broader-pinned-pp-writes-formatter.md:134` holds for MCP responses: the JSON has 59 consecutive per-connection checks.

## Checked, no new defect
- **Authorization gates:** the route, scope, grant and destination gates are unchanged (`source/src/server/multi-target-runtime.ts:107-116`, `source/src/handlers/pinned-operation.ts:22-33`).
- **Unusual input:**
  - Array and mixed-case `action` values, `objects`, and `0`/`false`/`[]` values are all refused.
  - A `__proto__` key slips past the field check, but nothing from it reaches `SAPWrite`, and other tools see the same value at every gate.
- **Session and deadline:**
  - Every mutation request keeps the finite deadline with replay off.
  - Unlock and session close keep their own 30-second budgets, even after cancellation (`source/src/adt/mutation-http.ts:43-57`, `source/src/adt/crud.ts:136-147`, `source/src/adt/http.ts:304-322`).
- **Failure states:** cancelled, lost-response and surviving-owner cases never report `deleted`.
- **Results:** no Eclipse link is attached to a deleted object (`source/src/server/ide-links.ts:72`).

## Outstanding qualification
1. **Deletion on PP:** run two writers on CLAS and INTF, plus the negative routes, on the corrected revision.
   - Record the exception type of the absence response. If A4H's real body differs, every deletion reports `delete-unconfirmed`, which is safe but blocks acceptance.
   - Use a harness with the DEL-1 to DEL-3 repairs and a cleanup-failure fault test. The older class harness refuses deletion by design.
2. **Transportable deletion:** no live evidence exists for empty `OPERATION` (`source/src/adt/transport.ts:1211`), `corrNr` on DELETE (`source/src/adt/crud.ts:296-298`), or unlock after delete on other releases (`source/src/handlers/write/update-delete.ts:241-245`).
3. **Formatter:** do a current-revision rerun with a native sentinel and a during-write native read (FMT-1), plus the FMT-2 to FMT-5 repairs. FMT-6 to FMT-11 are harness and wording fixes to make before that rerun.
4. **Overlap `/mcp`:** the legacy write route has unit evidence only.
5. **Everything else:** other SAP releases and the remaining operation families are still pending.
