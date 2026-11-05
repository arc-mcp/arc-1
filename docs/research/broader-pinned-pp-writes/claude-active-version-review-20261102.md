# PR #1142 at `ca871617`: review of the correction checkpoint

## Decisions

| Question | Decision |
|---|---|
| Delta against `0bf538a3` as a development checkpoint | **Accepted**, with 6 Low findings and no High or Medium |
| Five Low findings from the prior review | **All closed in code.** Two have remainders (Findings 1 and 4), and one is unexecuted |
| Retired repeated-LOCK diagnostic | **Stays retired.** Its findings were dropped with the design, not fixed |
| Active-version correction | **Sound by reading and rows.** It fails closed on every malformed shape I traced, but has test gaps |
| Whole-PR acceptance, native run, PP qualification | **Not granted or assessed.** The PR stays draft and FEAT-93 stays open |

- **Checks:** every allowed command passed, including 12,781 of 12,781 Vitest tests.
- **SAP:** I sent nothing to SAP and ran no operator script.
- **Cause of the invalid-handle 423:** still unknown. Nothing here establishes one.

**Severity:** Low means an edge case, a test gap or a doc gap, with no path to a foreign object or to production.

**Evidence:** new findings come from reading the code, because mutants and ad hoc scripts are barred. Passing tests ran against mocks or loopback, never native SAP.

## Findings in the delta

### 1. Low: the new binding row changes the wrong link
**Where:** `tests/unit/scripts/pr1142-native-contract.test.ts:289`; `tests/fixtures/adt/function-metadata-a4h-activation.json:8`; `docs/research/2026-11-02-native-function-protocol.md:194-196`

- **Gap:** `.replace('xmlns:atom=…')` changes only the first occurrence, which is on the `source/main/versions` link. The tolerated `objectstates` link keeps its binding and is still stripped.
- **Impact:** the row would pass even if the comparator ignored that link's binding. So the doc's "bindings… still differ" claim and prior Finding 1's requested row are untested.
- **Production code:** correct. The match at `native-contract-transport.ts:115-117` is literal.
- **Fix:** target that link:
  `fixture.saved.xml.replace(/(<atom:link[^>]+objectstates[^>]+xmlns:atom=")[^"]+/, '$1http://foreign.invalid')`

### 2. Low: the activated-module DELETE gate depends on the code path, not on observed state
**Where:** `scripts/qualification/pr1142/native-function-contract-run.ts:129-130`, `:245`; `native-contract-inventory.ts:114`, `:122`

- **Holds:** every path where this run's activation can have taken effect blocks both owners, so no DELETE follows. That covers success, a failed proof, a transport error and refused evidence.
- **Gap:** the gate only knows what the run saw. `sourceHashes` includes the saved hash, and the comparator treats saved and active metadata as equal. A module activated some other way therefore passes `beforeDelete`, for example by a save that activates or a preaudit that both activates and prompts.
- **Reachable through:** the stop at `:229`, the comparison failure at `:226-227`, or the preaudit prompt at `:239`.
- **Impact:** a DELETE would go to an activated, owned, random-named `$TMP` fixture. The native record doesn't show this behaviour (doc `:28-29`, `:97-100`), which is why it is Low.
- **Fix:** in the module branch of `beforeDelete`, refuse when the active read reports `nativeVersion === 'active'` and its hash equals a saved hash that differs from the pre-save active hash. Add a row asserting zero DELETEs.

### 3. Low: receipts label the requested version, not the one SAP reported
**Where:** `native-function-contract-run.ts:113-120`, `:249`; `tests/unit/scripts/pr1142-native-runner.test.ts:123`

- **Gap:** a `snapshot` row says `version: 'active'` even when its embedded metadata says `adtcore:version="inactive"`. That is the fallback this correction exists for.
- **Impact:** the body is retained, so nothing is lost, but anyone searching receipts by label gets a false signal. The `:249` error also omits the observed value.
- **Fix:** record `requestedVersion` and `nativeVersion` separately, update the test filter, and put the observed value in the error.

### 4. Low: some corrections have no assertion pinning them
- **Preservation message:** `native-function-contract-run.ts:291-293` isn't asserted anywhere; both strings appear only in that file. Assert the `deliberately preserved` message in the row at `pr1142-native-runner.test.ts:253`, and `Unconfirmed` in the rows at `:281` and `:289`.
- **Hint:** `tests/unit/adt/errors.test.ts:716`, `:738` and `tests/unit/handlers/dispatch-misc.test.ts:914` assert only "Inspect the current object state before retrying", which the old text also contained. Assert "repeat the whole operation" and the absence of "fresh lock".
- **Foreign-namespace version:** the generic refusals at `tests/unit/adt/native-xml-evidence.test.ts:18-26` use `name`. Nothing pins foreign, unqualified or duplicate `version` through `contractIdentity:151` or the proof at `:248`. Add a contract row for each, plus one runner row with a foreign `version`.
- **Fallback shape:** the two new runner rows use authored `moduleMeta`, not captured XML. The realistic fallback (captured `saved.xml` after activation) is covered only by composition with the contract test at `:279`. Add it to `captured` as a third version-fault row.

### 5. Low: the plan still reads as if the diagnostic were pending
**Where:** `docs/plans/2026-10-26-broader-pinned-pp-writes.md:10`

"a bounded lock-continuity diagnostic remains unexecuted" is literally true but contradicts the README (`:225`) and the protocol doc (`:229-230`, `:253`). Say it was rejected and retired without execution, and that no replacement exists.

### 6. Low: the narrowed comparator hasn't been replayed on pre-activation active reads
**Where:** `native-function-contract-run.ts:199-206`; `native-contract-inventory.ts:106-111`; `tests/unit/scripts/pr1142-native-runner.test.ts:141-147`

- **Gap:** the mock returns the same XML whether or not `?version=active` is present, and the fixture has no native pre-activation active read.
- **Risk:** if SAP's active representation gains a `?version=inactive` link once a draft exists, `nextContractActiveReceipt` now throws at source update. It fails closed, but it would waste a live run and leave fixtures needing recovery.
- **Partial evidence:** the doc says run 2 passed source update at `1bb2eb43`, which argues against this. I have no `1bb2eb43` bytes, so I can't confirm that comparison ran there.
- **Fix:** replay the retained `9E54…` post-create and post-save active reads through the current hash. This needs no SAP request. Do it before any ordinary native run.

## Prior Low findings

| # | Prior finding | Disposition | Evidence and remainder |
|---|---|---|---|
| 1 | Comparator wider than the evidence | **Closed in code** | `native-contract-transport.ts:115-117` tolerates exactly one `?version=active` link. The reverse-link row at `pr1142-native-contract.test.ts:288` passes and is effective. **Remainder:** Finding 1. |
| 2 | Audit loses evidence for embedded URLs | **Closed** | Rows at `tests/unit/server/audit.test.ts:490-499` pass. The relative form reaches the regex at `src/server/audit.ts:558`, and the two ambiguous forms return unchanged at `:554`. Doc `:188-191` is corrected. The diff has no `audit.ts` hunk. |
| 3 | Runner ignores captured metadata | **Closed** | Captured XML is replayed at `pr1142-native-runner.test.ts:140-147`, and the drift row at `:281-288` passes. **Remainder:** the fallback bullet in Finding 4. |
| 4 | Wording | **Closed in code** | `native-function-contract-run.ts:291-293`, `scripts/qualification/pr1142/README.md:218`, `src/adt/errors.ts:792`, `:799`. **Remainder:** Finding 4. |
| 5 | Activated-module cleanups only logged | **Closed in code, not executed** | `tests/integration/fugr-func-params.integration.test.ts:252-258` and `tests/e2e/func-params.e2e.test.ts:142-152` were read and typechecked only. Both match the pattern in `fugr-func.integration.test.ts:143-150`. |

**Preservation message accuracy:** `activeSourceVerified` can be true only after every earlier action was clean. Any earlier cleanup failure already throws through `src/handlers/write/pinned-source-write.ts:69-73`, so the deliberate reason can't hide an uncertain mutation.

**Test count:** my count of new tests in the diff is 6, which matches the move from 12,775 to 12,781. The doc's intermediate "43 focused" also fits: 19 runner plus 24 contract tests, before the drift row made it 20.

## Retired diagnostic

- **Disposition:** prior Findings 6 to 11 (five Medium and the Low bundle) are **dropped with the design, not fixed**. The candidate wasn't executed, by the author's report.
- **Consistency:** dropping it follows the prior review's own stop rule: "If the handle is held in the session, or a repeat LOCK is refused by design, drop this method."
- **Not verifiable here:** the candidate isn't in this snapshot, which I confirmed by search. The unconditional refusal, the private archive, the `LSEUQ*` inspection and the X-lock, scope 1 evidence are all author-reported. I didn't open the SAP help link.
- **Still open for any replacement:**
  - Timestamp resolution and whether LOCK and the DELETE check derive the handle the same way aren't fully answered.
  - The controls from Findings 6 to 11 still apply: one-time execution claim, code binding, separate cleanup authority, stop gates, per-step context evidence and a mock rehearsal.
- **SM12:** the doc at `:265-269` treats it only as an available view, which is the right limit. The selection covers `TFDIR` and `ZARC1_NF_*` only, so it says nothing about group or text-pool locks.

## Active-version correction

I traced each shape through `contractIdentity`, `src/adt/native-xml-evidence.ts:27-34` and the proof at `native-function-contract-run.ts:248-251`.

| Root `version` on the explicit active GET | Result | Basis |
|---|---|---|
| Core-bound `active`, matching source and metadata | Verified, then both owners preserved | Executed: `pr1142-native-runner.test.ts:253` |
| Core-bound `inactive` | Refused | Executed: `:289` |
| Missing | Refused | Executed: `:289` |
| Unprefixed, or a foreign-bound prefix | Refused by `AdtSafetyError` | Reading; generic `name` rows only |
| Foreign plus core, or two core prefixes | Refused, two keys | Reading; generic `name` rows only |
| An `xmlns:version` declaration | Refused, the local-name filter counts it | Reading; no row |
| Rebound `adtcore` prefix | Refused earlier, on `name` | Reading; generic `name` row only |
| `ACTIVE` or empty | Refused by strict equality | Reading; no row |
| DOCTYPE, malformed, over 1 MiB | Refused at `native-xml-evidence.ts:61` | Generic rows |
| `" active "` | **Accepted:** the parser trims attribute values (`OrderedObjParser.js:223`). Source and metadata must still match, so I consider it harmless | Reading |

- **Cleanup paths:** the proof runs after `preserve` at `:245`, so any throw leaves both owners blocked. The `finally` block records the `Unconfirmed` reason and sends no DELETE. The three new rows assert zero DELETEs.
- **Remaining false positive:** metadata and source are separate GETs, and the source response carries no version. The attribute can't prove which version the source GET served. I found no evidence of a problem, but the limit remains.
- **New throw surface:** `contractIdentity` now reads `version` on every metadata read, including the group baseline at `native-contract-inventory.ts:86`. A stray attribute fails closed, and the snapshot has native bytes for the module only, not the group.
- **Same pattern elsewhere:** none found. The PP harness already requires `active` at `scripts/qualification/pr1142/native-fixture-operations.mts:65`, `:111`.

## Other requested checks

- **Class-structure fixture:** semantically equivalent.
  - The first `>` ends the root start tag at `tests/fixtures/class-surgery/pinned.xml:1`.
  - The old replacement had no `$` patterns, so the bytes are identical.
  - The added length assertion uses the same unit as the guard at `src/adt/class-structure-evidence.ts:41`.
  - I found no matching single-character literal or non-global regex `replace` in `src`, `tests`, `scripts` or `bin`.
  - **Whether the CodeQL annotation clears is unverified until the next CI run.**
- **Private profiles and allowlists:** no weakening found.
  - The only production change is the two hint strings in `src/adt/errors.ts`, and `checkContractMutation` has no hunk.
  - `createPinnedFunctionContext` is referenced only by the probe script and tests.
  - Nothing in `src/` imports the qualification scripts or `nativeVersion`.
  - Git, plugins, aggregate, Basic, Copilot and read-only connections aren't touched by this diff.
- **Activated-module deletion:** the runner's refusal stays intact, and a test still models the observed 423 at `pr1142-native-runner.test.ts:441`. CI's FUNC deletions were on a4h-2025, so nothing here qualifies pinned deletion on A4H/001.

## Checks and snapshot integrity

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` (first, alone) | **Unchanged:** 4,473 files, revision `ca87161729b0…` |
| `npm exec -- vitest run --silent=true` | **Pass:** 474 of 474 files, 12,781 of 12,781 tests, 36.20 s |
| `npm run test:qualification:pr1142` | **Pass:** 59 of 59 by my count, older families only, no function family |
| `npm run typecheck` | **Pass:** all three projects |
| `npm run check:sizes` | **Pass:** 952 files, all 12 schema scenarios |
| `python3 review-input/verify-snapshot.py` (last, alone) | **Unchanged:** 4,473 files; nothing was read after it |

The manifest gives `71b063da…` for both `prior-verbatim-verdict.md` and its committed copy, matching the hash cited at doc `:239`. `followup.diff` and `authored.diff` have the same hash, so I read that content once. The code and test hunks in the diff match the snapshot bytes I read.

## Evidence limits

- **Live coverage:** no run covers these bytes. PP remains at `77e41fdcd`, which isn't current-byte evidence.
- **Author-reported, not verified here:**
  - build, lint (3 infos), policy and strict docs, which aren't allowed commands
  - the absence of both fixture pairs, the recovery results and the absence of cloud changes
  - the pre-fix failures, including the two version rows and the reverse-link row; by reading, they would fail before the fix
  - all native receipts, the vendor inspection and SM12
- **Not executed:** the integration and e2e changes, on any target.
- **Diff completeness:** I have no `0bf538a3` bytes or history. The manifest proves these bytes, not that `followup.diff` is the complete delta.

## Deviations

- **Refused read:** one `Read` of `pinned-delete.ts` omitted `source/` and pointed outside the snapshot. The harness refused it and returned nothing, and I repeated it with the correct path.
- **Saved output:** Vitest's output exceeded the display limit, so I searched my own saved copy, as the rules allow.
- **Parallel reads:** `Read` and `Grep` calls ran alongside the middle checks, but never alongside either verifier run. Bash commands ran one at a time in the foreground.
- **Child processes:** the suite includes tests that start the existing CLI (written to refuse before any SAP request), use loopback and create a temporary `node_modules/` directory, all through the approved commands. The final verifier run reported the snapshot unchanged.
- **Dependency read:** I read one line range of `fast-xml-parser`, which the manifest lists as a copied file inside the snapshot.
- **Otherwise none:** no edits, installs, delegation, operator scripts, mutants, ad hoc scripts, direct git, pipes or background shells.
- **Model:** `claude-opus-5-5`. I can't see the effort setting from inside the session, so max effort rests on the launcher.

## Next implementation steps

1. Fix Findings 1, 3, 4 and 5 as a small test and doc patch.
2. Before any ordinary native run, fix Finding 2 and run the receipt replay in Finding 6.
3. Don't repeat the known 423 with another ordinary run. Any replacement investigation needs its own design and review, must not repeat LOCK, and should carry forward the controls listed above.
4. When production function activation is implemented, require all three proofs: native `active`, matching source and matching metadata. Keep the function profiles private until admission.
5. Confirm the CodeQL annotation on the next CI run.
6. Continue the open scope:
   - function activation and admission, and activated-module deletion
   - DDIC, CDS and SDO; RAP and batches
   - package, API and publication; CTS
   - runtime trace and quickfix; classic FLP
   - resource policies
   - current-byte two-writer and recording-transport PP qualification

Missing implementation here is not evidence of backend non-support.
