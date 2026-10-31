# Foundation closure — Claude Code Opus 5.5 max

Date: 31 October 2026. Read-only review of the frozen source identified by
[fixes-review-source-manifest.json](fixes-review-source-manifest.json), atop `87dcd620a`.
The later capability-table refactor is outside this review. The two nonblocking test follow-ups
were subsequently added: all four second-read drift shapes and strict HTTP identity assertions.
No source change was required by this closing review.

**Verdict: ACCEPT this prerequisite delta.** There are no High or Medium defects, and I found no regression caused by the fixes. All eight foundation findings, the cleanup and the four hierarchy test findings are closed. Two small test gaps remain, and neither blocks acceptance. This verdict covers only this delta, not PP qualification or full PR 2.

I ran nothing, so test and native results are as you reported, and I used all 15 reads. Paths are relative to the snapshot's `source/`. "Scope" means `src/adt/pinned-transport-scope.ts`, and bare test lines refer to `tests/unit/adt/pinned-transport-scope.test.ts`.

## New defects

**1. Low: only added tasks are tested on a real second read**
Test `:273`, `:362`, `:324`, `:142`; scope `:215`
- **Trigger:** nothing in this test file reaches scope line 216, so deleting lines 215-216 would leave it green. The omission test at `:362` serves the same document to both reads, so it passes the new check and throws later at scope line 234. The conflict and duplicate tests (`:324`, `:142`) stop during prepare.
- **Consequence:** the code is right by trace: an omitted, conflicting or duplicate second read refuses before any `put` or `delete`. Only the added-task case is proven by a test, and the CTS adapter will rely on all four.
- **Fix:** run the `:273` test over three more second-read documents: `tree('')`, the conflicting document at `:327` and the duplicate document at `:142`. `tree('')` can't isolate line 216, because line 234 throws the same message, and that redundancy is harmless. Add these before wiring the CTS adapter.

**2. Nit: the hierarchy half of the owning-session test compares sessions by value**
`tests/unit/handlers/pinned-writes.test.ts:262`, `src/adt/mutation-http.ts:85`
- **Trigger:** `toEqual` on these Proxies compares the wrapped clients' enumerable fields, so it isn't an identity check. I didn't read `AdtHttpClient`, so I can't say whether two sessions ever compare equal.
- **Consequence:** the filed trigger is still caught, because reverting `src/handlers/write/pinned.ts:128` fails the `not.toBe` at `:261`. Only a later change that gives hierarchy a different client from metadata could slip past.
- **Fix:** assert each hierarchy context against `preflight.http` and `locked.http` with `toBe`.

## Closure

| Finding | Status | Evidence |
|---|---|---|
| Foundation 1: root-level child missed | Closed | `src/adt/transport.ts:985-996`, `:1017`, `:1117`; scope `:200-217`; test `:273` |
| Foundation 2: `remove_object` widening | Closed | scope `:192`; test `:257`; parent-selected traversal kept, test `:419` |
| Foundation 3: not-submitted release test | Closed | `src/adt/transport.ts:725-728`, `:759-763`; test `:297-312` |
| Foundation 4: native task read | Closed | `tests/integration/pinned-transport-scope.integration.test.ts:30-38`; failure cleanup kept at `:48-51` |
| Foundation 5: locked-session test | Closed for the filed trigger; see new defect 2 | `tests/unit/handlers/pinned-writes.test.ts:259-267` |
| Foundation 6: nested guard | Closed | `tests/unit/server/pinned-mutation-inventory.test.ts:69`, `:76`, `:90-103`; 9 common plus 2 per variant gives 11 contract keys each |
| Foundation 7: inventory prose | Closed | `docs/research/broader-pinned-pp-writes/inventory.md:7-8`, `:58` |
| Foundation 8: ADR wording | Closed | `docs/adr/0011-broader-pinned-pp-mutations.md:84`, `:91-92`, `:95` |
| Cleanup | Closed | orphan comment gone from `src/adt/safety.ts`; test import now at line 1 |
| Empty nested parent test | Closed | test `:292` |
| Hierarchy 1: two-level budget | Closed | `tests/unit/adt/pinned-package-hierarchy.test.ts:104-112` |
| Hierarchy 2: cancel between levels | Closed | same file `:141-143` |
| Hierarchy 3: cap boundaries | Closed | same file `:69-74` |
| Hierarchy 4: cancelled self-check | Closed | same file `:123-125` |
| CI lockfile | Accepted | only the `follow-redirects` version, resolved and integrity lines change |

## Regression checks, no defect
- **Same document:** `assertPinnedTransportDocument` and `parseTransportList` read the same `response.body`, so nothing can change between validating and parsing (`src/adt/transport.ts:993-995`).
- **Legacy path:** without a pinned policy, the code delegates to the unchanged `getTransport` (`src/adt/transport.ts:991`).
- **Dropped read check:** the pinned second read no longer calls `checkTransport(..., 'GetTransport', false)`. Nothing is lost, because the write check runs before and after the read, and the facade still adds the budget (`src/adt/mutation-http.ts:74`).
- **Task-selected recursion:** this is still refused with the same message (scope `:210`), so the parity gap from the last review is unchanged.
- **`remove_object`:** it stays on `getTransport` (`src/adt/transport.ts:1080`), and I accept that. It changes one task, checked at `:1095`, and nothing depends on seeing the full task set.
- **Refactor:** the diff shows `parseTree` and `parentMembers` were extracted without logic changes.
- **Admission:** only four `src/` files changed, `safety.ts` is just a comment removal, and no routing or handler source is in the manifest. No new actions or types are admitted.

## Not verified
- **Manifest hashes:** I had no hashing tool, so they're unchecked.
- **Contract bodies:** I checked the keys only and didn't read diff lines 200-1411. The test is what compares the bodies with the runtime schemas.
- **Hierarchy source:** the diff still matches the line references in my earlier acceptance (198, 210, 215), but I didn't compare it against the old snapshot.
- **Unread code:**
  - `AdtHttpClient`
  - `findDeepNodes`, where I relied on the comment at `src/adt/transport.ts:1441`
  - `enforceAllowedPackageForObjectUrl`
  - `prepareTransportRelease`
  - the release loop after `src/adt/transport.ts:824`
  - `getToolSchema`
- **Progress record:** both review headers point to it for fix tracking, but it isn't in this delta and I didn't open it. I can't say whether it records these fixes or whether the link resolves.
