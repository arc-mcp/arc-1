# PR #1142 at `5344e989`: keep developing, but fix three Medium findings before freezing a live artifact

**Decision:** continue from this checkpoint, but don't freeze new live bytes until Findings 1–3 are fixed and reviewed. I found no stale save, replay, foreign-object activation, read-only bypass, or lock held outside its owning session. **The PR stays draft and FEAT-93 stays open; this isn't whole-PR acceptance or a live artifact freeze.**

- **Findings:** no High, 3 Medium, 7 Low. Findings 1 and 2 are false failures. Finding 3 is a possible false success. None widens write scope.
- **Prior findings:** of the 2 Medium and 8 Low, 8 are closed, 1 is closed with a new follow-on finding (Low 4 → Finding 1), and 1 is mostly closed (Low 9).
- **Checks:** all allowed commands passed, with 441 files and 12,136 tests, matching the author's counts. The snapshot was unchanged at the first and last verifier runs.
- **How the findings were reached:** by reading code, fixtures and research notes. Ad hoc scripts were barred, so **I executed no failing case for any finding**.
- **Live status:** nothing here is qualified live. Run `77e41fdcd` doesn't cover these bytes.

## Findings

### 1. Medium: class-include preaudit identity is guessed and can refuse a path with live evidence
**Where:** `src/handlers/write/pinned-activation.ts:29`, `:42-43`; `src/adt/native-activation-evidence.ts:15-16`.

**Evidence:**

| Field | What the code now requires | What the repo shows |
|---|---|---|
| Type | `CLAS/OCN/<include>` | `CLAS/OCN` appears only on AUnit `testclasses` entries (`aunit-testrun-nw750.xml:7`). The type research and class-root XML say `CLAS/I` (`docs/research/abap-types/types/clas.md:15`, `:19`; `class-metadata-758.xml:1`) |
| Name | Must equal the class name and be non-empty | Class-root include entries have `adtcore:name=""`. A recorded prompt shows a composite sub-object name, `ZCL_EXAMPLE         SOME_METHOD` (`docs/plans/completed/2026-04-26-activation-false-success-and-cli-alignment.md:136-138`) |
| Padding | Exact match | The legacy parser trims names (`devtools.ts:1096`); the native reader doesn't |

**Why tests missed it:** the only include prompt has no type and uses the owner's name (`pinned-writes.test.ts:98`, `:750`), so the include type map never runs. No test contains `CLAS/OCN`.

**Trigger:** `SAPActivate(type="CLAS")` when preaudit lists an include with `CLAS/I`, or with an empty or composite name. Whether SAP lists includes at all isn't determined.

**Impact:**
- It refuses after the first POST with `activation-not-confirmed` and "unqualified reference", leaving no way to activate that class on this route.
- The run behind `docs/research/2026-11-01-broader-pinned-pp-writes-includes.md:20-21` activated classes with all four includes replaced, but under the old URI-only check.

**Fix:**
- Keep the exact URI as the binding, because the URI is already restricted to this owner's includes.
- For include refs, accept `CLAS/I` or `CLAS/OCN/<include>`, and don't require the name to equal the owner.
- Keep strict name and type checks for owners and pools, and trim names.
- Add typed include rows, and record raw preaudit bodies in the next live run.

### 2. Medium: an informational pool read turns a successful program activation into an error
**Where:** `pinned-activation.ts:113-119`, `:153-163`; `src/adt/text-elements.ts:94-99`, `:362`.

**Trigger:** `SAPActivate(type="PROG")` succeeds with no pool selected, then the pool read fails. This is certain when discovery lacks the text-elements service, as on NW 7.50 (`docs/research/2026-07-02-class-text-symbols-textpool.md:22`, `:81`). A transient 5xx on that GET triggers it too.

**Impact:**
- The result is `isError: true`, `PINNED_WRITE_INCOMPLETE`, `activation-not-confirmed`, even though SAP affirmed activation and the pool was never in scope.
- Every pinned PROG activation on a discovery-loaded 7.50 target fails this way, and PROG deletion already refuses there.
- This is a regression from `d0993a04`, which read the pool only when `result.success && poolIncluded`.
- It also follows from my previous advice to read the pool after every activation, which didn't say how to handle a failed read.

**Why tests missed it:** `pool-unreadable` always selects the pool, and the activation test file never sets discovery.

**Fix:**
- When no pool was selected, make the read best-effort: keep the native success, set `textPoolState: "unknown"` and add a warning.
- Skip the read when the service is known to be absent.
- Keep the strict failure only when the pool was selected.
- Add rows for owner-only with a 503 and owner-only with no service, and update `docs_page/multi-target-writes.md:148-149`.

### 3. Medium: `activePartVerified` never checks the text the caller asked to save
**Where:** `text-elements.ts:329-338`, `:270-274`; `src/handlers/write/pinned-text-pool.ts:312-331`.

**Evidence:**
- The readback is compared only with the active body, never with `source`.
- The source adapter does compare against its input (`pinned-source-lifecycle.ts:62`).
- `textPartChanges` reports only removals (`text-part-changes.ts:27-30`).
- SAP normalizes keys and resolves dictionary labels (`text-part-changes.ts:3-4`; `docs/plans/2026-10-08-text-pool-activation.md:115-116`), so byte equality is the wrong test and a parsed comparison is needed.
- The mock always stores the request exactly (`pinned-text-pool.test.ts:147-149`).

**Trigger:** the PUT returns 2xx but SAP persists something else: an entry is dropped, a dictionary label is substituted, or nothing changes. This includes `source=""` not actually clearing the part. Whether SAP does this isn't determined.

**Impact:** the result says `text-saved-active`, `activePartVerified: true`, and the whole pool has been activated. The caller gets a verified success for text they didn't request.

**Fix:** before activation, compare parsed entries using the `entries()` logic in `text-part-changes.ts`. A missing key or changed value refuses at `text-saved-unverified` without activating, with an exception for `@DDICReference` lines. Tune the normalization from live data, and add "PUT 200 but dropped" and "PUT 200 but unchanged" rows.

### 4. Low: `SAP_DENY_ACTIONS=SAPActivate` doesn't stop pool activation
**Where:** `src/server/deny-actions.ts:147-156`, `src/server/multi-target-write-surface.ts:50-58`, `docs_page/multi-target-writes.md:244`.

**Assessment:**
- **Consistent with:** the name-based matcher, legacy behavior since #940, and ADR-0011's text-pool exception and no-upgrade-acknowledgment rule (`docs/adr/0011-broader-pinned-pp-mutations.md:45`, `:146-147`).
- **Inconsistent with:** the alias guard for `SAPRead.SYNTAX` ("must not bypass existing administrator restrictions") and the previous guide, which offered `SAPActivate` alone as the way to activate separately.
- **Effect:** after upgrading, an operator with the old setting gets pool activation, including other parts' pending drafts. It needs the same `write` scope and native authorization still applies, so nobody gains privilege.
- **Tests:** no test covers this combination.

**Decision:** not a blocker. Fix it anyway, because it's small: on pinned routes, have a denial of `SAPActivate.activate` also deny `edit_text_symbols` in `capabilityEnabled`, leave legacy unchanged, and add a test.

### 5. Low: text activation drops native errors and misdescribes empty responses
**Where:** `text-elements.ts:262-263`; `native-activation-evidence.ts:29`; `native-xml-evidence.ts:77-78`.

- **Native error:** a `<msg type="E">` becomes a generic message with state `text-activation-unknown`, and SAP's text is lost. The legacy path (`text-elements.ts:424`) and pinned owner activation both keep it.
- **Empty 200 or HTML login page:** these now report "Cannot verify malformed…" or a missing-root error instead of "SAP did not affirm activation execution". An empty body is a recorded native shape (`2026-04-26-…:106`).
- **No post-check:** an unconfirmed result skips the adapter's own metadata and active-body reads, even though they would resolve the uncertainty without mutating anything. Pool activation's real response body isn't determined, so this could affect every text write.

**Fix:** return up to five bounded SAP messages, treat a non-checklist body as "not affirmed", and run the read-only verification after an unconfirmed result. Add rows for a native error and `activationExecuted="false"`.

### 6. Low: recovery and scope reporting gaps
- **Unfollowable guidance:** `pinned-source-write.ts:98-100` says to read "pool state", but `SAPRead` returns only part bodies (`read.ts:1078-1087`) and the inactive feed can omit the pool (`docs/plans/2026-10-12-text-pool-state.md:5-7`). Point to ADT, or return the state in the failure payload.
- **Class pool reference:** `SAPActivate(CLAS)` doesn't admit its own `/textelements/classes/...` reference (`pinned-activation.ts:27-29`). If SAP lists it, a pool draft left by this adapter blocks class activation until the text write is rerun. Whether SAP lists it isn't determined.
- **Pool-only prompt:** the result says `activated` with the program-plus-pool scope, but the owner wasn't confirmed (`pinned-program-activation.test.ts:220`). Give it its own scope label.
- **Failed include activation:** the failure path omits `includeUsage` (`pinned-activation.ts:154-163`).
- **No-op with cleanup or cancellation problems:** a class no-op whose unlock then fails, or that is cancelled after the read, reports phase `complete`. The failed-unlock case also says a post-unlock operation "was not sent" (`crud.ts:224-228`), though none was needed. Check `result.unchanged` first.

### 7. Low: deletion cleanup edge cases
- `http.ts:337-338` returns `undefined` if SAP already reset the context to `0`, while `:360` treats that reset as confirmed closure. A typed removed-lock then reports as a cleanup failure (`crud.ts:255`). This is conservative and not determined natively.
- A resolved removed-lock leaves no trace in the result, so the next live run must capture raw UNLOCK statuses from the HTTP audit log rather than tool output.
- The `removedLocks.length` branch at `crud.ts:225` has no test, and no adapter uses both hooks today, so it's dead code for now.

### 8. Low: expected refusals can still mask mock failures
**Your question: still yes, in older files.** I found no concrete masked regression, because positive rows run the same paths.

- `pinned-include-method.test.ts:68`, `:75`, `:92`, `:94`, `:105` still assert inside mocked fetch, and `:114` throws. Pinned requests carry a deadline, so `http.ts:396-399` wraps these failures as network errors.
- Rows at `:197-198`, `:217-218` and `:258-259` check only state, so they can pass for the wrong reason.
- Unexpected-request throws remain at `pinned-shared-method.test.ts:148`, `pinned-formatter.test.ts:52` and `pinned-csrf-bootstrap.test.ts:44`. `pinned-shared-method.test.ts:197` and `:213` assert only `isError` plus a count.
- I missed these files last time. They also contradict the claim at `docs/research/2026-11-01-pinned-source-adapters.md:308`.
- `pinned-program-activation.test.ts:187-195` asserts only `isError` and a POST count. `pinned-writes.test.ts:114` answers unknown requests with 200.

### 9. Low: missing cases on the new paths

| Area | Gap |
|---|---|
| Text PUT | `Content-Type` and `Accept` aren't asserted in the pinned handler test (`pinned-text-pool.test.ts:331`, `:347`). Only the legacy client test covers that shared line |
| Text policy | No rows for lock `CORRNR` mismatch, a transportable save without a request, a lost LOCK response, or pool identity drift during the post-unlock check |
| Legacy wrappers | `writeTextElementPart`, `activateTextPool` and `withActiveTextPoolForDelete` have no multi-target refusal row. `mutation-lifecycle.test.ts:181` covers only two other wrappers |
| Deletion | No missing-service row on the delete path (only the text path has one, `pinned-text-pool.test.ts:422`) |
| State leak | `usedInclude` isn't reset in `pinned-program-activation.test.ts:39-47`. It's harmless today only because that row runs last |

### 10. Low: small consistency items
- `text-elements.ts:206-213` rejects `afterUnlock` from a caller's policy but not `confirmedResourceDeletion`. It's harmless today because only `pinned-delete.ts` sets it, but reject it for symmetry.
- The comment at `pinned-result.ts:24-25` describes text-save behavior above the `source-save` branch, which is misleading.

## Prior finding dispositions

| Prior finding | Disposition | Evidence |
|---|---|---|
| Medium 1: namespaced hex case | **Closed** | `pinned-activation.ts:23`. Other escapes still refuse. Tests at `pinned-program-activation.test.ts:197-214`, `:222`, `pinned-writes.test.ts:781-796` |
| Medium 2: false cleanup failure on delete | **Closed offline** | `crud.ts:179-191`, `:254-257`; `pinned-delete.ts:81`, `:128`; tests at `pinned-program-delete.test.ts:236-269`. SAP's real UNLOCK statuses remain unknown; see Finding 7 |
| Low 3: weak pool evidence | **Closed** | Validator, DOCTYPE refusal, explicit `Accept` and package comparison (`text-elements.ts:374-395`). Native evidence is from PROG only, so the CLAS root under this `Accept` is unconfirmed |
| Low 4: URI-only preaudit | **Closed, with Finding 1 as follow-on** | Name, type and deleted fields reach the validator, and foreign refs can't reach confirmation. The class-include values are the new problem |
| Low 5: activation result reporting | **Closed, with Findings 2 and 6 as follow-ons** | Conditional scope, explicit state on `success:false`, corrected `next` |
| Low 6: delete guidance | **Closed** | `text-elements.ts:494-497`, `:94-99`; `docs_page/multi-target-writes.md:148-153`. Missing test row in Finding 9 |
| Low 7: include usage | **Closed** | Returned on delete and successful activation, and no consumer is followed (`pinned-program-activation.test.ts:274-284`). Failure-path gap in Finding 6 |
| Low 8: namespaces and SAPL context | **Closed** | `native-xml-evidence.ts`; `pinned-program-owner.ts:53-76`. Native prefixes match the NPL and A4H fixtures |
| Low 9: masked refusals | **Mostly closed** | All listed files and gaps were addressed. Older files remain (Finding 8) |
| Low 10: documentation drift | **Closed** | All listed lines corrected. A new overstated claim is in Finding 8 |

## Assessment of your questions

**Sound by reading and the passing suite:**
- **Foreign references:**
  - Confirmation requires an exact allowed URI, and only `%2f` hex case is normalized.
  - Name, type and `ioc:deleted` are bound, including namespace collisions and duplicates.
  - Program owners, includes and pools have correct native handling. Class includes are the exception (Finding 1).
- **Native XML reader:** it's bounded, keeps namespace bindings and refuses DOCTYPE, malformed XML and ambiguous attributes. Its one edge, an unbound prefix matching the empty namespace, requires malformed native XML.
- **Program evidence:** SAPL contexts refuse, and include consumers are reported but never followed or authorized.
- **Removed-lock proof:**
  - The callback closes over one request's `outcome`, and `deleted` is set only after typed absence (`pinned-delete.ts:114`).
  - `owningSessionClosed` belongs to one call, so a child or earlier session can't resolve it.
  - `unlockFailed` is only ever set, never cleared, so unrelated failures survive.
  - `release` never throws, so the primary error is preserved.
- **Activation grant:**
  - It's scoped to the session, URI and context, single-use, and valid only during the post-unlock phase.
  - Plain, cloned, foreign, stale and reused options all refuse, with no POST.
  - A preaudit expansion is reported as not confirmed and never followed.
- **Text lifecycle:**
  - One lock and one session, one PUT, and unlock before activation. The owner is never submitted.
  - Submitted PUT errors stay `text-save-unknown`, including the injected 400-after-save.
  - Cancellation, readback, unlock and close failures keep the right state and don't activate.
- **Legacy text path:**
  - The session, lock, URIs and headers are unchanged.
  - Saved-state wrapping and activation errors keep their original precedence, and the unlock error still replaces the primary one.
  - The multi-target context refuses on all three wrappers by reading, though without test rows (Finding 9).
- **Gates:** global, destination, PP, strict, deny-action, unsupported input and BTP narrowing all refuse before any SAP call.

**Architecture:** this is a net improvement. One engine now serves both profiles, and the coordinator gains only two narrow hooks. `writeTextElementPartWithPolicy` is carrying a lot of branching, so split out the pinned hook if it grows further.

**Accepted residuals:**
- Whole-part replacement has no hash, so another writer's changed value can be overwritten silently (`changes` lists only removals).
- Other parts' pending drafts activate with the pool, possibly another developer's. This is disclosed in the tool description and the success result.

**Performance:** 5,000 FORMs took 62 ms to splice and 135 ms to lint, at about 197 MB RSS, closely matching the committed sample. A text write makes roughly 15 or more requests within a 300-second budget. The benchmark doesn't cover the new paths or concurrency.

**Not determined:**
- Whether preaudit lists class includes, and with what type and name.
- Pool activation's real response body, and what SAP does with text that differs from the request.
- UNLOCK statuses after DELETE, and pool LOCK `IS_LOCAL` and `CORRNR` on transportable objects.
- Controlled active/inactive selection, real part bodies, empty and never-activated pools, and both PP writers.

## Checks and snapshot integrity

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` (first, alone) | **Unchanged**, 4,331 files, revision `5344e989…` |
| `npm exec -- vitest run --silent=true` | **Pass:** 441 files, 12,136 tests |
| `npm run test:qualification:pr1142` | **Pass:** 59 of 59 |
| `npm run typecheck` | **Pass:** all three projects, no diagnostics |
| `npm run check:sizes` | **Pass:** 899 files, all 12 schema scenarios in budget |
| `node --import tsx …/source-parse-benchmark.mts` | **Ran once**, three samples, lint not blocked |
| `python3 review-input/verify-snapshot.py` (last, alone) | **Unchanged**, 4,331 files; nothing was read after it |

The doc's hash for my previous report (`0dec00e3…`) matches both the committed copy and `review-input/prior-verbatim-verdict.md`. The four benchmark hashes match the manifest.

## Evidence limits
- **Live:** I made no SAP, CF, browser or external network request. The 59 simulations cover the historical formatter and deletion harness, not the new adapters.
- **Fixtures:** all new text and activation behavior is mock-only with authored XML. Findings 1–3 rest on repo fixtures, research notes and code reading, not on an observed failure.
- **Author-reported only:**
  - build, lint, the policy check and strict docs, which aren't on my allowlist;
  - the corrected first test run;
  - the private SAP source observations and their hashes;
  - the restored live environment.
- **Commit structure:** I can't confirm that source is `ea92863c9` with a documentation-only commit after it, because the snapshot has no history. I reviewed the final bytes and read the affected source directly.
- **Snapshot:** the manifest proves these bytes, not that `followup.diff` is complete.

## Deviations
- **Bash ordering:** you required sequential Bash. I issued `typecheck`, `check:sizes` and the benchmark in one parallel tool block, so I can't confirm they ran strictly one after another. All three passed and the benchmark closely matched the committed sample, but its timings could have been affected. The verifier runs were each alone.
- **Refused or failed reads:** one `Read` left out `source/` and was refused, returning nothing. One oversized `Read` of `followup.diff` returned nothing, so I read it in parts. One `Grep` used a wrong in-tree path.
- **Outside the working directory:** only `Grep` of my saved Vitest output, which your exception allows.
- **Internal Git:** `verify-snapshot.py:16` runs `git ls-files`, and `check:sizes` reports tracked files. I ran no direct git.
- **Model:** `claude-opus-5-5`. I can't see the effort setting from inside the session, so "max" is unconfirmed by me.
- **Otherwise none:** no edits, installs, delegation, operator scripts, mutants, background shells, pipes or ad hoc scripts. I didn't read dependencies outside the snapshot through symlinks.