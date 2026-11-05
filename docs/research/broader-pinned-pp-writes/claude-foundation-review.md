# Foundation follow-up — Claude Code Opus 5.5 max

Date: 31 October 2026. Read-only CLI review of an immutable source snapshot.
The foundation review covers commit `87dcd620a`; the hierarchy review covers the separate
early-exit delta atop that commit. Findings below are preserved verbatim. Fixes and final
qualification remain tracked in the [progress record](../2026-10-31-broader-pinned-pp-writes-progress.md).

**No High or Medium defects.** All six earlier findings are fixed on the reviewed paths, and Tasks 2 and 3 pass. I found eight Low defects; fix 1 and 2 before wiring the CTS adapter, and 6 before admitting quickfix or KTD.

I ran nothing and used all 30 reads, so test and native results are as you reported them. Paths are relative to the snapshot's `source/`.

## Defects

**1. Low: delete and reassign miss a new child that appears only at root level**
`src/adt/transport.ts:1002`, `src/adt/transport.ts:1097`, `src/adt/transport.ts:1395`
- **Trigger:** after the freeze, a parent read returns `<request P><task T/></request><task U parent="P"/>`.
- **Consequence:** `parseTransportList` reads only tasks under the request, so the preflight sees `[T]` and passes. Delete submits T and then P. Reassign changes T and P and reports success, leaving U with its old owner. `src/adt/pinned-transport-scope.ts:112` and recursive release both count this shape. It stays Low because authority remains at the allowed parent and I have no evidence SAP sends this shape for a parent read.
- **Fix:** in pinned mode, derive the second-read task set from the same body with `parseTransportNodeStates`, and refuse any difference before the first submission. Test both operations with this document, asserting no `put` or `delete`.

**2. Low: `remove_object` keeps a wider selection than it needs**
`src/adt/pinned-transport-scope.ts:186`, `tests/unit/adt/pinned-transport-scope.test.ts:256`
- **Trigger:** an adapter prepares `remove_object` for task T, then calls `removeObjectFromTransport` with the parent ID.
- **Consequence:** the gate admits the parent and siblings, so the object can be removed from a sibling task. The earlier review suggested this exemption, but only parent selection needs it.
- **Fix:** delete the `scope.action !== 'remove_object' &&` clause; parent-selected removal still walks the tree. Add `remove_object` to that `it.each`.

**3. Low: the not-submitted release path has no positive test**
`src/adt/transport.ts:762`, `src/adt/transport.ts:726`, `tests/unit/adt/pinned-transport-scope.test.ts:346`
- **Trigger:** removing `releaseAdmissionFailures` or breaking the detail at line 726.
- **Consequence:** tests stay green, because the only assertion on the field expects `undefined`. I traced the path and it behaves correctly today, but it could regress to "outcome is uncertain" unnoticed.
- **Fix:** add a two-task `release_recursive` test where the first POST aborts the signal. Assert one POST, `notSubmitted: true` on the second submission, and the "admission refused" detail.

**4. Low: the committed native test never reads a task**
`tests/integration/pinned-transport-scope.integration.test.ts:30`, `src/adt/pinned-transport-scope.ts:100`
- **Trigger:** the test only prepares with the parent ID.
- **Consequence:** your task-read result can't be reproduced from the repo, so a change in SAP's task-detail shape would surface only during adapter qualification.
- **Fix:** before deletion, assert the request has a task, prepare `reassign` with that task ID, and assert `parentId`. This sends no mutation.

**5. Low: no test pins the under-lock package check to the locked session**
`src/handlers/write/pinned.ts:128`, `tests/unit/handlers/pinned-writes.test.ts:246`
- **Trigger:** reverting line 128 to plain `client`.
- **Consequence:** tests stay green because that client is also bounded, so the per-session property could disappear unnoticed.
- **Fix:** use the prototype spies' recorded `this` to assert that the under-lock `resolveObjectPackage` and `getSubpackages` use a different `http` from preflight, with the same context.

**6. Low: the nested guard covers three hard-coded fields, on-prem only**
`tests/unit/server/pinned-mutation-inventory.test.ts:87`, `:90`, `src/handlers/schemas.ts:862`, `:982`, `:1142`
- **Trigger:** changing `QuickfixAffectedObjectSchema` (input to the mutating `apply_quickfix`), `ktdShortTextSchema`, or the BTP `objects` schema.
- **Consequence:** tests stay green, although ADR line 33 expects nested objects to be validated. L5's three named fields are covered, but nothing checks completeness, and the multi-target surface already branches on BTP (`src/server/multi-target-tools.ts:116`).
- **Fix:** derive the list from each inventoried schema and require a contract or explicit exclusion for every object or array-of-objects field. Add both missing fields. Check both schema variants, or state that the inventory is on-prem only. I didn't classify `schemas.ts:1389`.

**7. Low: the inventory text still says top-level only**
`docs/research/broader-pinned-pp-writes/inventory.md:6`, `:55`
- **Trigger:** someone relies on the document to judge the guard.
- **Consequence:** it understates what the guard now covers and doesn't state the gaps in defect 6.
- **Fix:** name the action lists and `nested-input-contracts.json`, and say what they miss.

**8. Low: three ADR wording errors**
`docs/adr/0011-broader-pinned-pp-mutations.md:90`, `:94`, `:84`
- **Line 90:** it names only `SAPDiagnose.unittest`, but `unittest_ci` has its own policy key (`src/authz/policy.ts:152`) and also runs ABAP Unit (`src/handlers/diagnose-ci.ts:71`). If it is later admitted, the named opt-out leaves an execution path. It is refused on multi-target today (`src/server/multi-target-tools.ts:63`). State that, and require denying both if it is admitted.
- **Line 94:** "retain their read scope" is wrong for `authorization_trace`, which has `data` scope (`src/authz/policy.ts:170`). Use "their current scopes".
- **Line 84:** "chosen policy" reads as decided in a Proposed ADR. Use "proposed", as line 72 does.

**Cleanup:** remove the orphaned doc comment at `src/adt/safety.ts:314`, and move the end-of-file import at `tests/unit/adt/pinned-transport-scope.test.ts:398` to the top.

## Verdicts

### Task 1: Pass, with defects 1–4 as follow-ups

Test lines below refer to `tests/unit/adt/pinned-transport-scope.test.ts`; "scope" means `src/adt/pinned-transport-scope.ts`.

| # | Earlier finding | Status | Evidence |
|---|---|---|---|
| 1 | Mutation before refusing a new child | Fixed; defect 1 remains | `src/adt/transport.ts:1006`, `:1101`; scope `:197`; test `:228` |
| 2 | Scope not bound to the selection | Fixed; defect 2 remains | scope `:17`, `:185`; `src/adt/transport.ts:1020`; tests `:256`, `:269` |
| 3 | Conflicting parent attributes | Fixed | scope `:126`; test `:279` |
| 4 | Polling ignores cancellation and deadline | Fixed; defect 3 is a test gap | `src/adt/transport.ts:638`, `:762`; tests `:334`, `:351` |
| 5 | Parsers disagree; no native fixture | Parser omissions now refused; parsers still differ (defect 1) | scope `:88`, `:121`, `:210`; tests `:290`, `:300`, `:317` |
| 6 | Runtime import cycles | Fixed | see below |

- **Finding 5:** the empty nested `tm:parent` case at scope line 121 has no explicit test.
- **Finding 6:** no runtime import path from `safety.ts` or `transport.ts` leads back to either. The only cycle I found on that path is the `xml-parser.ts:1325` and `revision-feed.ts:3` pair; neither file changed, and neither reaches `safety.ts`.

### Task 2: Pass; defect 5 is the only gap
- **Wiring:** pinned writes and activation use the bound client (`src/handlers/write/pinned.ts:66`, `src/handlers/write/pinned-activation.ts:49`), which closes L7's package-read gap.
- **Recording policy:** it is mandatory and refuses weakened budgets before any lookup (`src/adt/pinned-write-policy.ts:17`, `tests/unit/adt/mutation-client.test.ts:111`).
- **Legacy paths:** single-target keeps the same client and raw HTTP (`src/adt/mutation-client.ts:21`, `src/adt/mutation-http.ts:65`), so normal reads don't pick up the mutation policy.
- **CLAS/INTF behavior:** in the source path, the diff changes only client binding, so the hash, read-back and state logic is unchanged.
- **Responsible identity:** an undefined value omits the attribute (`src/adt/ddic-xml.ts:196`), and a raw pinned client is refused (`src/adt/mutation-client.ts:31`).
- **Earlier test gaps:** post-preaudit drift and the real hanging-request abort are now covered (`tests/unit/handlers/pinned-writes.test.ts:334`, `:361`).

### Task 3: Pass as proposed tradeoffs, not qualification

| Item | ADR lines | Result |
|---|---|---|
| M1 import routes | `:76-81` | Closed: not a route sandbox; names the real controls and deny keys |
| M2 DDIC dependents | `:82-87` | Closed: accepts the effect explicitly and keeps reference checks |
| M3(a) ABAP Unit | `:88-92` | Closed; see defect 8 |
| M3(b) trace access | `:93-95` | Closed; see defect 8 |
| M3(c) ST05 scope | `:47`, `:96-98` | Closed: unqualified filter semantics stay blocked |
| L6 request lists | `:56-60` | Closed; matches the code at `src/adt/pinned-transport-scope.ts:46`, `:53` |
| Stronger inventory | test `:30`, `:74`, `:86` | Action lists, `SAP.*` refusal and L5's named fields are guarded; see defect 6 |

No new operations or types are enabled. `multi-target-tools.ts`, `multi-target-write-surface.ts` and `handlers/transport.ts` are unchanged, and no changed `src/` file imports `preparePinnedTransport`.

## Remaining qualification limits
- **PP route:** there is no PP evidence yet. The capability matrix, type/state/native metadata and PP routing remain pending.
- **CTS adapter:** none exists, and type and state checks are still its job (`src/adt/pinned-transport-scope.ts:93`).
- **Native mutations:** only create and delete have a committed native test. Release, reassign and remove-object have mock evidence only, and release needs a disposable route.
- **Task-selected parity gap:** recursive or cleanup delete, recursive reassign and `removeObjectFromTransport` all fail for a task ID, because `getTransport` matches only request IDs (`src/adt/transport.ts:191`). This is safe, but the adapter must clear those flags or refuse clearly.
- **Native shapes:** the committed membership fixture is the A4H one, and other releases are unqualified. `src/adt/transport.ts:959` documents known 7.5x differences.
- **Responsible on metadata PUT:** omission semantics are unqualified, and that path isn't reachable on pinned today (`src/handlers/write/metadata-update.ts:56`).
- **Documentation:** the ABAP Unit interaction still needs writing up, and `src/handlers/tools.ts:1131` still calls it "harmless".
- **This review:** I didn't recompute hashes or read `crud.ts`, `devtools.ts`, `http-deadline.ts`, `multi-target-write-surface.ts`, the `SAP_DENY_ACTIONS` matcher, the fixture's attributes or the SAP links. As you instructed, I didn't raise traversal early-exit or the pre-submit cancellation envelope.
