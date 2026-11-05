# PR #1142 at `7d24751e`: keep developing, but fix one Medium before freezing a live artifact

**Decision:** continue from this checkpoint. Fix Finding 1 and have it reviewed before freezing live bytes. **The PR stays draft and FEAT-93 stays open; this isn't whole-PR acceptance or a live artifact freeze.**

- **Findings:** no High, 1 Medium, 8 Low. I found no false success, foreign-object activation, write-scope widening or public route to the function candidate.
- **Prior findings:** all three prior Mediums are closed offline. Of the seven prior Lows, four are closed, one is closed with follow-ons (Low 5), and one is closed except its class-pool subitem, which you kept open deliberately (Low 6). One is mostly closed (Low 8).
- **Checks:** all allowed commands passed, with 446 files and 12,240 tests, matching your counts. The snapshot was unchanged at the first and last verifier runs.
- **How findings were reached:** by reading code, tests and repo evidence. Ad hoc scripts were barred, so **I executed no failing case for any finding**.
- **Live status:** nothing here is qualified live. Run `77e41fdcd` doesn't cover these bytes.

## Findings

### 1. Medium: retained SAP activation text bypasses `ARC1_MINIMAL_ERRORS`
**Where:** `src/adt/text-elements.ts:278-287`, `:299-305`; `src/handlers/write/pinned-source-write.ts:98`; `src/handlers/write/pinned-result.ts:63-64`, `:76`.

**Evidence:**
- No `pinned-*` handler reads `config.minimalErrors`, and dispatch doesn't filter returned `ToolResult`s.
- Minimal errors default to `true` on HTTP (`docs_page/configuration-reference.md:353`).
- The legacy text path has an explicit redaction contract and test (`docs/plans/2026-10-08-text-pool-activation.md:79-92`; `tests/unit/handlers/text-elements.test.ts:242-274`).
- At the previous checkpoint this `success:false` branch returned a generic message.

**Trigger:** a pinned text write where SAP returns activation messages, on a default HTTP deployment.

**Impact:** SAP text reaches the client in both `message` and `nativeActivation`, including detail URIs. Per that config line, such text can include lock owners, transport IDs and T100 variables. It goes to the same mapped user and widens no write scope, so this isn't High.

**Scope notes:**
- General `SAPActivate` already returns activation messages in minimal mode on both routes (`src/handlers/activate.ts:438`, `:445`), so I didn't count that path.
- The existing `SAP:` suffix at `src/adt/devtools.ts:1052-1060` has the same exposure through `pinnedFailure`.
- This follows from my previous Low 5 advice to return bounded SAP messages, which didn't mention minimal mode.

**Fix:**
- Keep SAP text out of the `AdtSafetyError` message on this path.
- When `config.minimalErrors` is true, return only `nativeActivation.success`.
- Add rows for minimal true and false with a sentinel message.

### 2. Low: recovery reads can replace the activation failure
**Where:** `text-elements.ts:272`, `:293-298`; `devtools.ts:499-503`.

**Trigger:** the activation POST throws, then either recovery GET also fails. A SAP outage makes that combination likely.

**Impact:**
- The GET's error replaces the activation's error and status, so the claim that native failure is retained doesn't hold on this path.
- `text-activation-unknown` is always overwritten at `:293`, so a 503 and a native refusal share one state and phase.
- `pinnedFailure` drops the "SAP may still finish it" hint, so a caller sees an `inactive` snapshot with no warning.
- The result is still an error, so this isn't a false success.

**Fix:** catch recovery-read failures separately and rethrow the activation error first. Expose an unknown outcome when `err.activationOutcome === 'unknown'`. Add a row.

### 3. Low: M3 refuses unverifiable input only after the PUT
**Where:** `text-elements.ts:366`, `:379-382`; `src/adt/text-part-changes.ts:29-62`.

**Trigger:** a `source` the comparator can never accept, such as a duplicate key, a trailing `@MaxLength`, `@Unknown:x`, or an `=== part ===` marker line.

**Impact:** if SAP accepts the PUT, an inactive draft is left behind and the result is `text-saved-unverified`. That draft can then block PROG deletion and activates with the pool's next write.

**Fix:** run `comparableEntries(part, source)` before the lock and refuse with state `unchanged`. The old "don't validate outgoing syntax" reason (`docs/plans/completed/2026-10-11-text-part-removals.md:19-21`) no longer applies, because this parser now exists and already decides these inputs.

### 4. Low: class-include references accept any name, not only empty or composite ones
**Where:** `src/handlers/write/pinned-activation.ts:46`; `tests/unit/handlers/pinned-activation-identity.test.ts:9`.

**Trigger:** SAP's preaudit lists a foreign name such as `ZFOREIGN` on this owner's exact include URI. A caller can't cause this.

**Impact:**
- The name is confirmed and sent back (`devtools.ts:362`). The URI still binds the owner.
- The code is broader than your stated contract, and no row covers it.
- The only recorded composite name sits on a method-fragment URI (`docs/plans/completed/2026-04-26-activation-false-success-and-cli-alignment.md:136-137`), which still refuses. A composite name on an include URI is therefore unobserved.
- "Observed `CLAS/I`" comes from class metadata, not preaudit.

**Decision:** don't tighten this blind, because real names may be padded and that would recreate M1. Add a row recording the current behaviour, correct the wording, and capture raw names live before deciding.

### 5. Low: a lost LOCK response is reported as clean
**Where:** `src/adt/crud.ts:196`; `src/adt/http.ts:338`; `pinned-result.ts:65-66`. This predates the diff; the new `lock-lost` row now pins it.

**Trigger:** LOCK reaches SAP but its response is lost, so no context cookie exists to close.

**Impact:** the result is `state: unchanged` with no cleanup flag. "No save was sent" is true, but a possibly held lock isn't mentioned.

**Fix:** on a network or 5xx LOCK failure, report the lock outcome as unknown and point to ADT or SM12.

### 6. Low (private; blocks admission): structured FUNC signatures will likely fail strict readback
**Where:** `src/handlers/write/pinned-source-lifecycle.ts:62`; `src/handlers/write/update-delete.ts:139`; `src/adt/fm-signature.ts:95`, `:104`.

**Evidence:**
- The generator emits uppercase. The plan records that "SAP normalizes to lowercase on read" (`docs/plans/completed/2026-05-10-add-fm-parameters.md:76`).
- A recorded sample and a case-insensitive live assertion are consistent with that (`docs/research/2026-10-21-function-parameter-short-texts.md:29-31`; `tests/integration/fugr-func-params.integration.test.ts:165`).
- The candidate's mock stores and echoes the exact PUT bytes (`tests/unit/handlers/pinned-function-source.test.ts:96`, `:156`), so it can't see this.

**Trigger:** a structured signature update on real SAP.

**Impact:** a saved signature would report `source-save-unknown` with no hash.

**Fix:** capture native readback bytes. Then compare the signature semantically and the body exactly, and add a native-shaped fixture.

### 7. Low (private; blocks admission): FUGR main-source replacement has no native evidence
**Where:** `src/handlers/write/pinned-function-context.ts:19`; `pinned-function-source.test.ts:18`, `:144`.

**Evidence:**
- None of the six GETs covers `source/main`.
- SAP maintains that program itself (`docs/research/2026-07-29-nw750-fixture-create-surface.md:284-285`).
- The research note doesn't list this profile.

**Impact:** once admitted, a replacement that drops `INCLUDE LZ…UXX` could detach the group's modules. The hash only protects against stale input.

**Fix:** restrict the factory to FUNC and group-owned INCL until native PUT and side-effect evidence exists.

### 8. Low (private; dormant): the function-create metadata branch is untested and can hide a failed close
**Where:** `src/handlers/write/function-create-metadata.ts:42`, `:105`; `crud.ts:251`; `src/handlers/write/create.ts:675`, `:772`; `pinned-source-write.ts:57`.

- **No tests:** no row reaches `created-processing-unknown` or any `processing-metadata-*` phase.
- **Masked cleanup:** FUNC create runs two lock lifecycles, and each overwrites `cleanup.sessionClosed`. A failed metadata-session close followed by a good source-session close passes the final check as success. Make `false` sticky, and stop before the second lifecycle after any cleanup failure.
- **Missing guard:** this helper's legacy branch lacks the `assertMutationContext` its siblings call (`src/handlers/write/creation.ts:17`, `:50`, `:92`).
- **For later:** the candidate has no equivalent of the legacy `L<GROUP>` name guard (`src/handlers/write.ts:167-178`), which creation will need.

The legacy behaviour itself is preserved: same order, same messages and an equivalent retained-value check, with `client` identical to `ctx.client` at both call sites (`create.ts:428`, `:800`).

### 9. Low: remaining test gaps
- **Missing rows:**
  - minimal mode on pinned text writes
  - recovery-read failure
  - a 200 HTML activation body
  - cancellation after a verified no-op
  - the Low 10 text-profile guard (`text-elements.ts:214-216`, no test mentions `afterUnlockNeeded` or its message)
  - raw `group` refusal on update, delete and text (only `tests/unit/handlers/pinned-procedural-source.test.ts:207`, for INCL `edit_unit`)
- **Weak refusal rows remain:**
  - `tests/unit/handlers/pinned-program-activation.test.ts:211-219`
  - `tests/unit/handlers/pinned-include-method.test.ts:204-205`, `:224-225`
  - `tests/unit/handlers/pinned-shared-method.test.ts:216-220`

  The new `unexpected` guards remove the masking, but these rows can still pass on a wrong refusal reason. `docs/research/2026-11-01-pinned-text-review-followup.md:34` overstates this for the older rows.
- **Fixture and new rows:** `tests/unit/handlers/pinned-delete.test.ts:44-46` still throws inside mocked fetch. Some new candidate rows use a bare `rejects.toThrow()`.

## Prior finding dispositions

| Prior finding | Disposition | Evidence |
|---|---|---|
| M1: class-include identity | **Closed offline**, follow-on in Finding 4 | Only `CLAS/I` is admitted; owners and pools stay strict. No `CLAS/OCN/<include>` remains. Foreign URI, type and fragment refuse (`pinned-activation-identity.test.ts`) |
| M2: optional pool read | **Closed offline** | `pinned-activation.ts:123-135`. Selected pools stay strict. Success and failure wording are both tested (`pinned-program-activation.test.ts`, owner-only rows and final row) |
| M3: requested text | **Closed offline**, follow-on in Finding 3 | Comparator runs before activation. PUT-200 unchanged, dropped-key and failed-clear rows send no activation (`pinned-text-pool.test.ts`) |
| Low 4: `SAPActivate` denial | **Closed** | `src/server/multi-target-write-surface.ts:57-61`, with direct zero-HTTP and schema rows |
| Low 5: activation errors | **Closed**, follow-ons in Findings 1 and 2 | Bounded messages, "not affirmed" wording, read-only observations, preflight rethrow |
| Low 6: recovery and scope | **Closed except the class-pool subitem, kept open deliberately** | Scope label, `includeUsage` and no-op are done. The thrown include path returns `includeUsage` without the warning sentence. The class's own pool reference stays unqualified |
| Low 7: deletion cleanup | **Closed offline** | `http.ts:338`, `crud.ts:257-265`, receipts, blocking test. Real UNLOCK statuses are still unknown |
| Low 8: masked fixtures | **Mostly closed** | Listed mocks moved outside fetch. Finding 9 covers the rest |
| Low 9: missing rows | **Closed** | All listed cases present, and the flag reset is fixed |
| Low 10: consistency | **Closed in code** | Guard row missing (Finding 9) |

## Assessment of your questions

**M3 comparator: conservative enough, with one real boundary.** I traced the recorded native shapes by hand, and each is accepted:
- CRLF and padded keys
- lowercase keys
- DDIC round trip with a resolved label
- `?...` placeholders and omitted FUGR keys
- retained `002=` and a fully empty clear
- heading placeholders

The only value exemption I found for a maintained entry is the designed DDIC-label one.

**Sound by reading and the passing suite:**
- **Predicate and lifetime:**
  - `afterUnlockNeeded` is false only after a verified empty no-op.
  - Callers can't supply it.
  - It skips only the post-unlock block.
  - Unlock and close failures still reach `pinned-source-write.ts:57`.
  - Context state is per request.
- **Cleanup:** explicit context `0` is treated as closed. A removed-lock candidate blocks post-unlock work, and a receipt exists only after confirmed closure.
- **Gates:**
  - `group` isn't in any admitted row's fields, and FUGR and FUNC aren't in any row's types.
  - `pinnedMutationAllowed` applies at both the server and the handler.
  - `createPinnedFunctionContext` has no production caller.
  - Context-spoofing checks are unchanged.
  - Package and CTS gates are present on the new paths.
- **Function owner:**
  - Parent and child checks are fresh and namespace-bound.
  - Both package ceilings apply.
  - Only `%2f` hex case is interchangeable.
  - Invalid action, hash and source fail before the group search.
- **Legacy:** the text path, activation parsing and session close keep their behaviour. The no-op predicate only replaces an early return.

**Architecture:** `writeTextElementPartWithPolicy` is now about 200 lines. Split out the pinned post-unlock hook the next time it changes.

**Performance:** 5,000 FORMs took 64 ms to splice and 140 ms to lint at about 197 MB RSS, in line with the last run. The comparator is linear under the 1 MiB bound. Recovery adds no requests beyond the two reads already there. Function checks add 1–2 GETs per checkpoint, plus any subtree lookups. The benchmark doesn't cover these paths or concurrency.

## Checks and snapshot integrity

Each Bash command ran alone, in sequence.

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` (first) | **Unchanged**, 4,343 files, revision `7d24751e…` |
| `npm exec -- vitest run --silent=true` | **Pass:** 446 files, 12,240 tests, 34.40 s |
| `npm run test:qualification:pr1142` | **Pass:** 59 of 59. These cover older harness families, not the new profiles |
| `npm run typecheck` | **Pass:** all three projects, no diagnostics |
| `npm run check:sizes` | **Pass:** 907 files, all 12 schema scenarios in budget |
| `node --import tsx …/source-parse-benchmark.mts` | **Ran once**, three samples, lint not blocked |
| `python3 review-input/verify-snapshot.py` (last) | **Unchanged**, 4,343 files; nothing was read after it |

The doc's hash for my previous report (`8a3207c1…`) matches both the committed copy and `review-input/prior-verbatim-verdict.md` in the manifest.

## Evidence limits

- **Largest live unknown:** pool activation's real response body. If it lacks `activationExecuted="true"`, every pinned text write returns an error, even with an active pool and matching text. The repo records an empty success shape and an unconfirmed already-active activation (`2026-04-26-…:106`; `docs/research/2026-10-22-multi-target-write-qualification.md:199-200`).
- **M3 native format:**
  - The note says SAP accepts "leading whitespace" (`2026-10-11-text-part-removals.md:14-15`) without saying key or value. The comparator keeps value spaces, so stripping would cause a false refusal after the save.
  - Escapes, non-ASCII normalization and unknown native annotations are also undetermined.
  - All of these fail closed. The native shapes come from notes and live-integration assertions, not from this run.
- **Other native unknowns:**
  - raw class preaudit bodies
  - UNLOCK status after DELETE
  - controlled active/inactive selection (`version=invalid` returned the same body)
  - never-activated pools
  - both PP writers
- **Recorded fragment shape:** the only recorded class prompt with a method fragment still refuses. The 758 run on `0632606a` activated edited classes in local and transportable packages, but the current include-aware validator is unqualified. Capture raw bodies in the next run.
- **Function candidate:**
  - The evidence is six A4H/758 GETs of sanitized fixtures, all in active state. I can't verify the original hashes.
  - Other releases aren't covered: 7.50 `containerRef` fields and activation identities are unknown.
  - Generated includes and FUGR child side effects are undetermined.
  - Mutation rows use authored mocks.
- **Author-reported only:** build, lint, the 135-entry policy check, strict docs, the reproduced failing rows, and the restored cloud/SAP state.
- **Snapshot:** the manifest proves these bytes, not that `followup.diff` is complete, and there's no history. I skipped diff lines 153–375, the committed copy of my prior report whose hash matches.
- **Live:** I made no SAP, CF, browser or external network request.

## Deviations

- **Refused reads:** two `Read` calls left out `source/`, pointing outside the working directory, and were refused with nothing returned. I then read `src/handlers/pinned-operation.ts` and `tests/fixtures/xml/function-module-properties.xml` at the correct paths.
- **Outside the working directory:** only `Grep` of my saved Vitest output, which you allowed.
- **Internal Git:** `verify-snapshot.py` runs `git ls-files`, and `check:sizes` reports tracked files. I ran no direct git.
- **Model:** `claude-opus-5-5`. I can't see the effort setting from inside the session, so "max" is unconfirmed by me.
- **Otherwise none:** no edits, installs, delegation, operator scripts, mutants, background shells, pipes or ad hoc scripts. `Read` and `Grep` calls ran in parallel, but all Bash ran one at a time.