# PR #1142 at `70d4e83b`: review 20 corrections and private CDS/RAP activation

## Verdict
**The development checkpoint is accepted, with 0 High, 0 Medium and 3 new Low findings.** This is not a whole-PR readiness claim.

- **Review 20:** all five findings are closed.
- **Private activation profile:** acceptable as private offline code. It is not qualified for mutation, because no activation has run natively on these five types.
- **Public surface:** the function family and all five CDS/RAP mutation families are still closed. Aggregate, Basic, Copilot and read-only stay mutation-free, and no Git, plugin, dispatch, schema or `src/server` file is in the delta.
- **Unfinished, per the plan's readiness table:** fresh native execution, public admission, the remaining families, two-writer PP and recording transports.
- **Snapshot:** the first and last checks both reported `70d4e83b…`, 4,538 files, `unchanged`.

Severities follow the earlier reviews: Medium is a missing control or wrong conclusion, and Low is an edge case or a test or doc gap.

## Findings

### 1. Low: an owner with no draft can report `activated`
- **Where:** `src/handlers/write/pinned-activation.ts:296-300`, where `already-active` applies only to group includes. `src/handlers/write/pinned-declarative-activation.ts:96-104` doesn't refuse an owner with no draft.
- **Scenario:** an active owner with no draft passes capture, because `?version=inactive` returns the active bytes (DCLS: same 154 bytes and hash, `review-input/declarative-read-contract/DCLS.json:28-29`, `:39-40`). If SAP then returns `activationExecuted="true"`, every later check passes trivially.
- **Consequence:** the result says `activated`, `activeSourceVerified: true` and `nativeStateVerified: true`. Only `previousNativeVersion: 'active'` shows that nothing changed. This is the same false claim as review 19 Low 2 and review 20 Low 3.
- **Bound:** it needs SAP's explicit flag. The only record I found of an already-active owner activation, on an earlier run, returned unconfirmed (`docs/research/2026-10-22-multi-target-write-qualification.md:199-200`). No receipt covers these five types.
- **Remedy:** report `already-active` when the first capture was active with no inactive alternative, and add a row. FUNC has the same label and no such row, so apply the same decision there.

### 2. Low: some activation guards and the normal edit state have no failing row
By reading, removing or changing these would leave the suite green. All test lines are in `tests/unit/handlers/pinned-declarative-activation.test.ts`.

| Guard or state | Gap | Why it matters |
|---|---|---|
| Missing or unknown version, `pinned-declarative-activation.ts:41-42` | The mock always emits a version (`:45`) | Without the guard, the POST is sent and only the later check refuses |
| Unexpected or duplicate state link, `:49-53` | The mock emits only one valid link (`:41-44`) | Without the guard, the last link wins, so a second link can hide an inactive alternative. The doc claims this refusal at `docs/research/2026-11-02-pinned-declarative-sources.md:76` |
| Draft over an active version | Capture never sees `active` (`:27-30`), and no row asserts `previousNativeVersion: 'active'` | This is the ordinary edit path |
| Metadata budget, `:36` | The `metadata-budget` body (`:81`) is also refused by `src/adt/native-xml-evidence.ts:134` | Losing the budget stays green |
| Budget failure rows | `source-budget-error` and `active-source-budget` assert only failure | A 503 or a hash mismatch fails the same way. `source-budget-success` does prove the source cap |

**Remedy:** add the three missing rows. In the budget rows, assert the limit failure itself: no `statusCode` on the 503 row and no `Cannot verify` message on the metadata row.

### 3. Low: the doc overstates the recording and reference checks
- **Recording:** `docs/research/2026-11-02-pinned-declarative-sources.md:67-69` says CTS policy "must agree with the first capture". `pinned-activation.ts:198-217` discards the recording result on each pass, unlike deletion (`src/adt/pinned-delete.ts:113`).
- **Misleading row:** `recording-drift` (`:67`, `:329-334`) moves to a disallowed request, so it stops on the allow-list, not on a comparison. A move between two allowed requests passes.
- **References:** `:66-67` of the doc implies a native type and a nondeleted marker are required. `pinned-declarative-activation.ts:88-89` accepts either one being absent, and `src/adt/native-activation-evidence.ts:15-17` requires only URI and name.
- **Consequence:** there is no policy bypass, because every request passes both allow-lists and the URI must match exactly. The doc and the row name still claim more than the code does.
- **Remedy:** keep the first recording result and refuse a change on the confirmation pass, with a row using two allowed requests. Reword the reference sentence to "if present, must match".

## Review 20 closure

| Finding | Status | Basis |
|---|---|---|
| Low 1: guards without rows | **Closed** | See the row-by-row list below |
| Low 2: discarded post-save work | **Closed** | Both hints are gated on `single-target` (`src/handlers/write/update-delete.ts:196-199`, `src/handlers/write/create.ts:796-799`). Pinned rows assert no where-used call and no unlocked source GET. Single-target rows still pass (`tests/unit/handlers/write-create-batch.test.ts:1675`, `tests/unit/handlers/write-ddic.test.ts:2983`) |
| Low 3: already-active include | **Closed** | The generation condition is gone, so either flag gives `already-active`. The inactive-alternative row keeps `activated` |
| Low 4: whitespace-only create | **Closed** | `src/handlers/write/pinned-declarative-context.ts:35-36` refuses it before HTTP. Newline, tab and space rows exist, and empty input keeps skeleton creation |
| Low 5: test count | **Closed** | `docs/research/2026-11-02-pinned-declarative-sources.md:57` now labels the count by its checkpoint. I couldn't confirm that commit, because git is barred |

**Low 1, by reading each row against its guard:**
- **Deletion:** preflight and locked identity, denied package, package drift, foreign CTS request and cancellation each assert no `DELETE`. All five types assert `corrNr` on a recorded delete.
- **Update:** preflight identity is refused before any lock.
- **Create input:** direct rows now reach the context validation, because they clear `expectedSourceHash`.
- **Quality checks:** lint, RAP and CDS refusals run for create and update, and BDEF `extend behavior` creation has a row.
- **Public closure:** create, update, delete and activate are all refused with no HTTP calls.
- **Group activation:** the local-child row with a recorded group and the captured inactive-alternative row both exist.

**Six pre-fix failures:** the set is consistent with the diff (where-used, BDEF hint, three whitespace rows, already-active include). I reasoned this and didn't rerun it.

## Private activation profile

| Area | Verdict | Basis |
|---|---|---|
| Grant and public entry | **Holds** | The grant is a module-private Symbol, and the public handler refuses all five types before HTTP. Only the test imports the private entry; `src/handlers/activate.ts:116` calls the public one |
| Input allowlist | **Holds** | `pinned-declarative-activation.ts:15-22`, with 11 refusal rows before HTTP |
| Reference allowlist | **Holds** | One exact URI, with only `%2f` case normalized. Name, type and deleted must match if present (Finding 3) |
| Native identity and package | **Holds** | Fresh path, root, namespace, name, type and own package on every metadata read; container refs are refused |
| Package policies | **Holds** | Server and destination lists are checked separately on every metadata read (`src/adt/safety.ts:262-272`) |
| CTS policies | **Holds** | Both are checked before each POST (`src/adt/allowlist-policy.ts:27-35`). No comparison across passes (Finding 3) |
| Preaudit stability | **Holds** | Full canonical metadata with nothing omitted, plus the source hash, is re-read before confirmation. It isn't atomic, as the doc states |
| Cancellation, deadline, no replay | **Holds** | Composed in `src/adt/mutation-http.ts:49-63`. Cancellation after preaudit has a row; the deadline holds by reading only |
| Response budgets | **Holds by reading** | 1 MiB per read, counting all responses (`:36`, `:69`, `src/adt/bounded-response.ts:76`). Test proof is partial (Finding 2). CTS reads still lack a streaming budget, as before |
| MIME | **Holds** | Exact `text/plain` after parameters, with rows. All five native source reads returned `text/plain; charset=utf-8` |
| Default and explicit active metadata | **Holds** | Each read has its own fault row, so neither masks the other |
| No inactive alternative | **Holds for the expected shape** | Never observed on these types (see Evidence limits) |
| Active source equality | **Holds** | Byte-exact SHA-256 (`:112`), computed the same way as the saved `sourceHash` |
| Later uncertainty, minimal errors | **Holds** | `nativeActivation`, phase and warning survive, with no retry. Sentinel rows show no native text leaks |
| Existing behavior | **Unchanged** | New branches do no HTTP for other types, and the owner-parser refactor keeps the same checks. Only the group-include label and the refusal wording for these five types changed |
| Generated owners and batches | **Refused** | `refs.length` at `:83`, `args.objects`, and `src/adt/devtools.ts:308` |
| Scope of the claim | **Accurate** | A metadata-only change after the last capture isn't detected, and `docs/research/2026-11-02-pinned-declarative-sources.md:73-76` says so |

## Checks

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` (first, alone) | **Unchanged:** 4,538 files |
| `npm exec -- vitest run --silent=true` | **Pass:** 494 of 494 files, 13,301 of 13,301 tests, 37.32 s |
| `npm run test:qualification:pr1142` | **Pass:** 59 of 59 (20 + 22 + 17); these historical scenarios don't exercise these profiles |
| `npm run typecheck` | **Pass:** all three projects |
| `npm run check:sizes` | **Pass:** 978 files, 12 schema scenarios |
| `python3 review-input/verify-snapshot.py` (last, alone) | **Unchanged:** 4,538 files; nothing read after it |

The doc's focused count also matches: 72 + 36 + 70 = 178, with 70 new activation cases.

## Evidence limits
- **Nothing here touched SAP:** the native reads are GET-only from `246b98b05`, and I didn't execute the probe. They don't qualify lock, save, activation, deletion absence or PP.
- **What the read evidence supports:** all five bodies match the profiles by hand, and each manifest row matches its record. It supports explicit state checks, not a mechanism. DDLS and SRVD returned `inactive` on `?version=active`, with empty sources, and activation history wasn't inspected.
- **`?version=` may not discriminate on these types:**
  - The review 20 default-read and new explicit-active metadata hash fields match for all five.
  - Inactive and active source hash fields match for all five.
  - No sampled object had a draft that differed from its active version, so these reads can't show the parameter selects anything. Default-read `adtcore:version` carries most of the proof, and its change on activation is unobserved for these types.
- **State link never observed:** none of the five bodies has an `objectstates` link. The expected shape comes from FUNC fixtures, so a different shape would refuse rather than pass.
- **Byte-exact source check:** if activation changed only a terminal newline, the result would be a false `activation-not-confirmed`, not a false success.
- **Different activating users:** a draft owned by another user isn't separately refused. That remains for two-writer PP.
- **Reasoned, not run:** ad hoc mutants were barred, so Finding 2 and the pre-fix claim rest on reading.
- **Hashes:** I compared recorded hash fields and didn't recompute body hashes. The manifest confirms the probe hash `209431c9…` and the verbatim review hash `046641eb…`.
- **Author-reported only:** build, lint, policy, strict docs and CI.
- **Group evidence:** `00153` and `00154` raised no new concern, so I didn't re-review them.

## Execution deviations
- **Refused out-of-snapshot read:** I mistyped one `Read` path without `/source`, pointing to the test file in the parent directory. The harness refused it and returned no content, and I then read the correct file.
- **Refused oversized read:** a `Read` of `review-input/manifest.json` failed on size with no content, so I searched that file instead.
- **Saved Vitest output:** at 2.3 MB it went to `~/.claude/projects/…/tool-results/bd786in8f.txt`, and I only searched that file.
- **`00154.json`:** I ran one count-only search on it, which told me nothing useful.
- **Check order:** the checks ran one at a time, each in its own batch. I searched the saved Vitest output in its own batch before the next check, and five more reads followed the last check but came before the final snapshot check.
- **Dependencies:** the approved checks load `node_modules` at runtime. I didn't read or traverse dependency symlinks myself.
- **Otherwise none:** no edits, report files, delegation, mutants, installs, or SAP, browser or other network activity.
- **Model:** `claude-opus-5-5`. I can't see the effort setting from inside the session, so max effort rests on the launcher.
