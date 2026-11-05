# PR #1142 at `243a7d40`: review 19 corrections and private CDS/RAP CRUD

## Verdict
**The development checkpoint is accepted, with 0 High, 0 Medium and 5 Low findings.** This is not a whole-PR readiness claim.

- **Review 19:** all six findings are closed. Finding 3 below is a nearby variant of Low 2.
- **Private CDS/RAP profiles:** acceptable as private offline code. Add the Finding 1 deletion rows before any live declarative deletion.
- **Public surface:** the function family and all five CDS/RAP mutation families are still closed. Aggregate, Basic, Copilot and read-only stay mutation-free, and Git and plugins are untouched.
- **Snapshot:** the first and last checks both reported `243a7d40…`, 4,527 files, `unchanged`.

Severities follow review 18: Medium is a missing control or wrong conclusion, and Low is an edge case or a test or doc gap.

## Findings

### 1. Low: important guards have no failing row
By reading, removing any of these guards would leave the suite green.

| Guard | Gap |
|---|---|
| **Declarative delete identity**, `src/adt/pinned-delete.ts:84` | Without it, the code falls through to `:86`, and the regex at `src/adt/client.ts:1692` returns the same package. The only delete rows are `tests/unit/handlers/pinned-declarative-source.test.ts:268-283` and `:294-305`. None covers wrong identity, denied package, lock-time drift, foreign CTS request, cancellation or a recorded delete. |
| **Update preflight identity**, `src/handlers/write/pinned-source-context.ts:103` | The identity fault only fires under the lock (`:179-192`). That lock check still protects the save, but the preflight guard itself is untested. |
| **Child/group locality**, `src/handlers/write/pinned-activation.ts:191-197` | Only a local child with a recorded, locked group reaches it. `different-group-recording` stops earlier, at `src/adt/pinned-write-policy.ts:171`. |
| **`already-active` alternative check**, `pinned-activation.ts:267` | The group mock never emits an `objectstates` link. |
| **Create input**, `src/handlers/write/pinned-declarative-context.ts:31-36` | The `{ action: 'create' }` row (`:209`) is refused earlier because `run()` keeps `expectedSourceHash`. |
| **Quality checks** | The suite disables lint and check (`:31-32`). No row shows a lint, RAP or CDS refusal, and none uses BDEF `extend behavior`. The claim at `docs/research/2026-11-02-pinned-declarative-sources.md:42-44` holds by reading only. |
| **Public dispatch** | `:221-234` exercises `update` and activation only. `create` and `delete` are closed by the matrix, but have no row in this suite. |

**Consequence:** a lost identity check on the most destructive path would go unnoticed.

**Fix:** add these rows, with delete rows that assert no `DELETE` is sent and a recorded delete that asserts `corrNr`.

### 2. Low: post-save hint work runs on the pinned path, then gets discarded
- **Where:** `src/handlers/write/update-delete.ts:196` and `src/handlers/write/create.ts:796-798`. `src/handlers/write/pinned-source-write.ts:70` reads only `isError`, and `:80-108` builds the result from state. The test mock at `:122-125` allows the call but asserts nothing.
- **DDLS update:** after the save and unlock, a where-used POST (`src/adt/codeintel.ts:185`) runs with only the request deadline and no byte budget. Its hint never reaches the caller.
- **BDEF extension create:** after a confirmed save and unlock, `getBdef` runs. A 503 turns the result into `PINNED_WRITE_INCOMPLETE`, with `state: saved-inactive` and a stale `source-readback` phase. Any warning it produces is dropped too.
- **Consequence:** a confirmed result can wait on a slow search, and an unbounded response is read for nothing. The BDEF case reports a false failure, though its state stays accurate.
- **Fix:** skip both in `pinned-pp` mode, or make them bounded best-effort and carry the text in `state.warnings`. Add rows for either choice.

### 3. Low: a group include can still report `activated` with no observed change
- **Where:** `src/handlers/write/pinned-activation.ts:264-269`, where `:265` limits `already-active` to generation.
- **Scenario:** the include was already active with no draft, and the whole-group POST returns `activationExecuted="true"`, for example because another member had a draft. The result says `activated`.
- **Consequence:** this is the false claim from review 19's Low 2, reached through the other SAP flag. It stays Low like that finding, and because no receipt shows this flag on a group.
- **Test gap:** `already-active` (`tests/unit/handlers/pinned-function-group-activation.test.ts:277`) covers only generation, and `native-activation` (`:289`) covers only FUGR.
- **Fix:** remove the `:265` condition, or report `native-operation-confirmed` here, and add the row.

### 4. Low: declarative create accepts a whitespace-only source
- **Where:** `src/handlers/write/pinned-declarative-context.ts:33`, unlike `:39` and `src/handlers/write/pinned-source-input.ts:35`. See also `src/handlers/write/create.ts:624` and `src/adt/source-precondition.ts:10-18`.
- **Scenario:** `source: "\n"` passes validation, so the POST and PUT both run. Read-back ignores terminal newlines, so the result is `saved-inactive`.
- **Consequence:** the generated skeleton is replaced by a blank draft and reported as success. Only a new object is affected.
- **Fix:** refuse a non-empty source that trims to nothing, and add a row.

### 5. Low: the declarative doc carries an older test count
- **Where:** `docs/research/2026-11-02-pinned-declarative-sources.md:57` says 492 files and 13,175 tests. This revision has 493 and 13,201, as `docs/research/2026-11-02-group-activation-review-followup.md:29` says.
- **Fix:** update the count or label it as an earlier run.

## Review 19 disposition

| Finding | Status | Basis |
|---|---|---|
| Medium 1: recording checks | **Closed** | Child, then group using the child's request, before each POST (`pinned-activation.ts:178-197`). All five CTS rows exist; the locality branch lacks a row (Finding 1). |
| Low 2: result labels | **Closed as listed** | Generation-only `already-active` and FUGR `generated` / `native-operation-confirmed` are correct. Finding 3 is the remaining variant. |
| Low 3: failure scope | **Closed** | Failures after submission keep group, scope and warning (`:315-327`). Execution kind survives minimal errors (`src/handlers/write/pinned-result.ts:97`). |
| Low 4: masked tests | **Closed** | Faults now affect one read each. Lowercase escapes, repeated-child order, canonicalizer guards, group namespaces, cancellation and minimal-error rows all exist. |
| Low 5: canonicalizer cost | **Closed** | Inherited bindings are reused, with a 64-binding cap and 16,384 shared visits per parsed document (`src/adt/native-xml-evidence.ts:27-41`). This is a bound, not a timing measurement. |
| Low 6: older doc | **Closed** | The historical banner and links are present, and the verbatim report hash matches the manifest. |

Review 19's missing `00154` limit is also closed. The request path and body match `src/adt/devtools.ts:257-268`, and `activationExecuted="false" generationExecuted="true"` classifies as generation. The record's `bytes: 212` matches my hand count.

## Private CDS/RAP profiles

| Area | Verdict | Basis |
|---|---|---|
| Identity, type, root, namespace, own package | **Holds** | `src/adt/pinned-declarative-owner.ts:86-97`. Refuses container refs, duplicates and wrong bindings. |
| URI canonicalization | **Holds** | Only `%2f` case is normalized. Other noncanonical forms are refused before HTTP. |
| Field allowlists | **Holds** | Separate sets for create, update and delete, except Finding 4. |
| Preflight and under-lock authorization | **Holds** | Fresh owner read and both package ceilings in preflight and under the lock. Create is rechecked under the lock after POST. |
| Read budgets | **Partial** | Only the owner read has 1 MiB (`:83`). Source read, read-back and absence reads (`src/handlers/write/pinned-source-lifecycle.ts:33`, `:67`, `src/adt/pinned-delete.ts:127`) are deadline-only, as are CTS and hierarchy reads. This is existing shared behavior, and the docs don't claim otherwise. |
| Real-package deletion | **Holds by reading** | Native package, recording and lock checks all apply, but rows are missing (Finding 1). |
| Source-hash concurrency | **Holds** | Update requires a 64-hex hash, checked under the lock against fresh bytes. |
| Recording contexts | **Holds** | Task resolves to its parent, the `corrNr` is asserted on update, and the lock must agree. |
| Retries, cleanup, uncertainty | **Holds** | `noReplay` applies throughout, with owning-session cleanup and no retry. Uncertain create, save and delete states are preserved, apart from the false failure in Finding 2. |
| Existing profiles | **Unchanged** | New branches do no HTTP for other URIs, and all existing suites pass. Only one warning's wording changed, on the shared failure path. |
| Public closure | **Holds** | The matrix lists only CLAS, INTF, PROG and INCL, and a test pins it exactly. Public factories refuse first, and no production code imports the private factory. No `src/server`, dispatch, schema, Git or plugin file is in the delta. |

**Native metadata:** path, root, namespace, type, package, version, timestamp and hash fields match the fixture for all five types. I walked the original bodies through the parser logic by hand and found one own package, no container and no colliding `name` or `type` attributes. All five source URIs resolve to `/source/main`.

## Checks

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` (first, alone) | **Unchanged:** 4,527 files |
| `npm run check:sizes` | **Pass:** 976 files, 12 schema scenarios |
| `npm run typecheck` | **Pass:** all three projects |
| `npm run test:qualification:pr1142` | **Pass:** 59 of 59 (20 + 22 + 17); historical scenarios that don't exercise these profiles |
| `npm exec -- vitest run --silent=true` | **Pass:** 493 of 493 files, 13,201 of 13,201 tests, 37.49 s |
| `python3 review-input/verify-snapshot.py` (last, alone) | **Unchanged:** 4,527 files; nothing read after it |

The focused activation count matches the doc: 55 + 33 + 40 = 128. The new suites have 45, 26 and 9 tests.

## Evidence limits
- **Nothing here touched SAP:** the metadata is GET-only from one target and doesn't qualify create, update, delete, activation or PP.
- **Unobserved native behavior:** the probe's request headers weren't recorded, and no `/source/main` read was made. That leaves `Accept: application/*`, `Accept: text/plain`, lock, PUT and typed absence unobserved for these types. With `noReplay`, a 406 is refused rather than renegotiated (`src/adt/http.ts:809-811`).
- **Hashes not recomputed:** approved commands can't hash the bodies, so I compared recorded hash fields only.
- **Reasoned, not run:** ad hoc mutants were barred, so Finding 1 is reasoned. The seven pre-fix failures are consistent with the old code, but I didn't rerun them.
- **Group evidence:** `00153` and `00154` are historical and prove neither child activation nor recording behavior. No receipt shows `activationExecuted="true"` on a group.
- **Author-reported only:** build, lint, policy, strict docs and CI.
- **Still unfinished:** fresh native qualification, public admission, the remaining families, two-writer PP and recording transports, per the plan's readiness table.

## Execution deviations
- **Refused out-of-snapshot read:** I mistyped one `Read` path, without `/source`, so it pointed to `src/adt/pinned-function-owner.ts` in the parent directory. The harness refused it and returned no content, and I then read the correct file.
- **Check order and overlap:** Bash ran one command at a time in the foreground, but the four middle checks ran in a different order from your list. Each shared a tool batch with reads; only the first and last snapshot checks ran alone.
- **Saved Vitest output:** at 2.3 MB it went to `~/.claude/projects/…/tool-results/bsv7m3ig2.txt`, and I only searched that file.
- **Otherwise none:** no edits, report files, delegation, mutants, installs, or SAP, browser or other network activity. No dependency symlinks were traversed.
- **Model:** `claude-opus-5-5`. I can't see the effort setting from inside the session, so max effort rests on the launcher.
