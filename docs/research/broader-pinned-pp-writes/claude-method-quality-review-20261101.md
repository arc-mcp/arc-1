# PR #1142 at `771aff1c`: retain; no code or test fix has to come before a fresh PP run

**Decision:** retain this follow-up. It can go to a fresh controlled PP run on a new artifact once the prerequisites below are met. This is not whole-PR acceptance: the PR stays draft, the include family is unqualified, and FEAT-93 stays open.

- **Findings:** no High or Medium, five Low. None blocks the run.
- **Prior five Lows:** three closed within limits, one retained by decision, one correctly deferred.
- **Checks:** all five commands passed, and the snapshot was unchanged at the first and last verifier runs.
- **Cloud restoration:** the receipt is internally consistent, but it is operator evidence. I ran nothing against the cloud and make no claim about current state.
- **Key caveat:** no live request was made for this source, and the refactored route has never run through PP.

## Must precede the run
**Fixes:** none.

**Prerequisites:**
1. **Revision and artifact:** from a clean final HEAD, build and verify a new artifact, create new run and fixture manifests, and run `test:qualification:pr1142`. Shipped `src/` changed, so no earlier artifact or manifest binds.
2. **Baseline:** take a new before-state from the restored cloud state, under a new ledger.
   - The cloud checks don't cover SAP, so recheck SAP roles and profile, runtime identity, destination and fixture absence at that point.
   - Save the complete role definitions before any grant; the last run did not (`include-qualification-attempt-20261101.json:228-229`).
3. **Host:** keep the lid open, hold a run-scoped idle-sleep assertion, and save the power log for the whole run and cleanup, including after a failure (`scripts/qualification/pr1142/README.md:113-118`).
4. **Stop rule:** if any step fails twice, preserve and diagnose before retrying (`README.md:176-177`, now worded for every step). Historical recovery scripts stay unusable (`README.md:184-186`).

**Recommendation:** land Findings 1, 2, 3 and 5 before binding. They touch only docs and tests, so shipped bytes don't change, but the manifests bind the final HEAD. Leave Finding 4 for the deferred cleanup alignment, because it changes `src/` and would need review first.

## Findings

### 1. Low: the missing-period paragraph needs two qualifiers
`docs/research/2026-11-01-shared-pinned-method-edit.md:90-95` correctly withdraws the disproved claim. Two sentences still read stronger than the evidence:
- **"Preserves the selected boundaries" is true of the text only.** The test asserts `result = 2\n ENDMETHOD.` (`tests/unit/context/method-splice-boundaries.test.ts:20-25`). ABAP ends statements at the period, so SAP should see one statement and no separate `ENDMETHOD`. This is reasoning; I did not run it on SAP.
- **"Proves the default quality gate blocks that input" holds only for the tested configuration.** That configuration sets no release, which selects v702 (`src/lint/config-builder.ts:166-170`). The paragraph names only an administrator disabling lint, but three other conditions apply:
  - Above SAP_BASIS 758, parser errors become warnings (`config-builder.ts:112,116`, `src/adt/features.ts:236,249-252`). On the project's 816 system (`docs/research/2026-06-25-bdef-behavior-extension-create.md:37`), this input would save with a warning.
  - Lint exceptions fail open (`src/handlers/write-helpers.ts:1276-1279`).
  - An `abaplintConfig` file can override the rule (`config-builder.ts:150-152`).

**Fix:** say the text is preserved, and list these conditions.

**Stronger requirement: none, and leave the parser unchanged.**
- `update` is admitted for the same owner under the same hash, package and recording gates (`src/server/pinned-mutation-capabilities.ts:36-39`, `src/handlers/write/pinned.ts:74-79,103-106`), so this input adds no reach.
- A caller can't disable lint per call on this route (`pinned-class-context.ts:67`, `pinned-mutation-capabilities.ts:49`).
- The worst case is a broken inactive draft that activation should reject.
- The harness sends a valid body (`deletion-qualification.mjs:283-286`).
- A later period check would need care, because AMDP bodies end in `;` (`method-splice-boundaries.test.ts:93-102`).

### 2. Low: no real-lint success case on the pinned route
- **The gap:** both refusals assert only the generic `Pre-write lint check failed` (`tests/unit/handlers/pinned-shared-method.test.ts:284-297`). Every other pinned case disables or stubs lint. A regression that refused every pinned spliced class would keep them all green.
- **Not vacuous today, by reading:** the blocking rules are few (`config-builder.ts:115-124`) and the fixture parses. A real-lint success exists only for single-target on v758 (`class-surgery-concurrency.test.ts:19,102-119`).
- **Run impact:** such a regression would refuse with `unchanged`, which is safe but would use up the run under the stop rule.

**Fix:** add an unstubbed `call({}, { lintBeforeWrite: true })` expecting `saved-inactive`, and assert `parser_error` in both refusals.

### 3. Low: the syntax fixture isn't the `/checkruns` shape
The fixture replies with `<chkl:messages>` and `<msg>` (`pinned-shared-method.test.ts:94-98`). The parser's own comment labels that "older / some variants" and gives `chkrun:checkMessage` as the `/checkruns` reply (`src/adt/devtools.ts:1155-1159`). The test exercises the real parser and handler, but not that reply on this route.

**Fix:** reply with a processed `chkrun:checkRunReports` report, as `tests/unit/adt/devtools.test.ts` does.

### 4. Low: a verified save's failure result omits its transport
Success reports `transport` (`src/handlers/write/pinned-class-surgery.ts:48`), but failure details don't (`:55-59`). The same is true at `pinned.ts:199-204,231-236`. After a cleanup failure on a transportable object, the caller gets state, hash and warnings, but not the request the save used.

This is pre-existing rather than a regression, and the `$TMP` run doesn't reach it (`README.md:12,59`).

**Fix:** add it during the deferred cleanup alignment, with a test.

### 5. Low: restoration wording over-reads two receipt fields
- **Timestamp:** `docs/research/2026-11-01-broader-pinned-pp-writes-includes.md:270-271` dates the IAM removal 13:44:21. That is the verifier's timestamp, taken after its checks (`review-input/restoration-verifier-evidence-only.py:32`). The supplied evidence has no removal time.
- **Script hash:** `:276-277` cites a restoration script hash, but the verifier computes it at verification time (`restoration-verifier-evidence-only.py:33`). It is retrospective, the limit the attempt JSON already names for the manual recovery (`:185`).

**Fix:** say "verified at" and call the operator hash retrospective. The receipt needn't be regenerated.

## 1. Do the new tests exercise the production path and gates?
Yes. They run the real handlers and HTTP stack with `fetch` mocked, and only the warning cases stub `runPreWriteLint`. By reasoning (no mutants), each removal below fails a test:

| If this is removed | What fails |
|---|---|
| Lint call or block (`class-surgery.ts:118-119`) | Both refusals, because a PUT occurs |
| Syntax call (`class-surgery.ts:121-128`) | Warning cases, because there is no `checkruns` request |
| Warnings passed to save or stored (`class-surgery.ts:132`, `pinned-class-lifecycle.ts:57`) | All three warning cases |
| Warnings in failure details (`pinned-class-surgery.ts:58`) | Unlock and close cases |
| `recording.request` in save (`pinned-class-lifecycle.ts:49`) | `corrNr` assertion |
| Transport in result (`pinned-class-surgery.ts:48`) | Transport assertion |
| Recording preflight (`pinned-class-context.ts:85-93`) | CSRF case, which expects that phase |
| Selector `.trim()` (`pinned-class-context.ts:36`) | Leading-space case, which expects no fetch |
| Whole-line chain check (`class-structure.ts:335,338`) | Three off-by-one cases |

The tests would not catch:
- a blanket lint refusal (Finding 2);
- the `/checkruns` reply shape (Finding 3);
- a different session on `checkruns`, because lock state and the stateful header are asserted but the cookie isn't (by reading, `edit.http` is the lock-owning facade, `crud.ts:125-130`);
- a denied transport on `edit_method`, because only `update` has that negative test (`pinned-writes.test.ts:470-478`), though by reading both use the same `pinnedRecording`.

The shared handler passes no request options to the syntax check, but the facade applies the deadline and no-replay policy anyway (`mutation-http.ts:43-57,76`).

## 2. Source changes: no leakage or regression found
- **Scope:** four `src/` files change, with no capability, schema or route change. The `.trim()` only narrows input.
- **Warnings:** they are stored only after verified read-back (`pinned-class-lifecycle.ts:56-58`), so only verified saves carry them. That is correct, because the syntax text says "source was still written" (`write-helpers.ts:1336`), which would be false on a failed save.
- **Leakage:**
  - State is per call, and the same caller already sees this text on success.
  - Audit `errorMessage` and `resultPreview` are redacted before every sink (`dispatch.ts:1131-1134`, `audit.ts:414,617-619`, `logger.ts:102-106`).
  - `minimalErrors` doesn't filter these results, as on the success path, so there is no new disclosure class.
- **Result shape:** the field is optional, `update` failures are unchanged, and the harness doesn't read `warnings`.
- **Chain guard:** both forms are tested. The whole-line check also newly refuses `METHODS: a. METHODS b.` when `b` is selected, which fails closed. A chain opener on a shared line with a wrong column still bypasses both forms (reasoning). Pinned routes can't reach it, and the docs already say this is not a validator.
- **Selector:** the run's log shows ` lhc_x~value` reaching dispatch untrimmed with no fetch, so the factory refused it, not the schema. The factory now trims like `detectLocalHandlerInclude` (`object-types.ts:634`). The capability row stays untrimmed (`pinned-mutation-capabilities.ts:50`), which is harmless.

## 3. Close-only disposition: accepted
`pinned-class-surgery.ts:34-37` still refuses and reports `saved-inactive`, the hash, warnings and `sessionClosed: false`, with no retry. `pinned.ts:198` still hides a close-only failure, and the docs defer this rather than claim it fixed (`2026-11-01-shared-pinned-method-edit.md:82`). A clean run therefore doesn't prove sessions closed on `update` or include steps. Unlock failures on `update` also still drop warnings (`pinned.ts:199-204`), which belongs in the same deferred work.

## 4. Metadata helpers: accurately recorded
The prerequisite (`2026-11-01-shared-pinned-method-edit.md:106-113`) matches the code at `class-structure.ts:173,254,324`. Those actions stay closed: the factory admits only `edit_method` (`pinned-class-context.ts:34`) and structure reads throw (`pinned-class-lifecycle.ts:38-40`). Owner, source, name and range agreement remains mandatory before admission.

## 5. Compact fixture, AMDP and missing period
- **Compact fixture:** `source-preconditions.test.ts:361-378` proves refusal, no PUT, unchanged source and a released lock.
- **AMDP:** `method-splice-boundaries.test.ts:27-42` is a true paired control, since only the name differs.
- **Missing period:** see Finding 1. The other half of the prior table row, a header abaplint can't classify, still has no test. By reading it refuses, because the first statement must be a method implementation (`method-surgery.ts:619`).

## 6. Cloud restoration receipt: operator evidence
**Checked by reading and hashes, with no script run:**
- Both script hashes in the receipt equal the manifest hashes of the supplied copies (`8d350e01…`, `cf468fe9…`).
- The receipt's values match `include-qualification-attempt-20261101.json:242-283`, and its run ID matches `:3`.
- The verifier asserts what the docs claim: environment, droplet and route equality, `SAP_ALLOW_WRITES=false`, `STARTED`, seven XSUAA fields, exact absence of both IAM objects, and the ledger flags before `fully-restored` (`restoration-verifier-evidence-only.py:18-31,36-38`).
- The docs keep SAP authorization outside this proof.

**What it does not show:**
- **Baseline origin:** the `*.before.json` files aren't supplied. The digests appear nowhere else in `docs/`, and `originalBaselineUsed: true` is a literal (`:33`).
- **Running state:** as I understand CF, `STARTED` is the desired state. No process or route health is queried (`:23`).
- **Environment scope:** only `environment_variables` are compared (`:20`), not bindings, system environment or scale.
- **XSUAA fields:** a field missing from both sides compares equal (`:26`).
- **Leftovers:** only the current droplet is checked, and the supplied control script never deletes the candidate droplet or package. Only the two named IAM objects are checked for absence.
- **Ledger:** the receipt is written before the flag assertion (`:34,36`), and the code that sets the SAP, fixture and harness flags isn't supplied.
- **Older evidence:** SAP access dates from 12:33:32Z (`attempt JSON:197`) and fixture absence from 11:09:13Z (`:184`). Neither was rechecked.
- **Formatting:** the attempt JSON isn't the script's raw output (`:91` is a one-line array). That fits a later formatter, and the values match the receipt.

## Prior findings
| Prior finding | Disposition |
|---|---|
| 1. Direct quality, CTS and CSRF tests | **Closed**, with the limits in Findings 2 and 3 |
| 2. Warnings lost on cleanup failure | **Closed**, and executed for unlock and close |
| 3. Close-only asymmetry | **Retained by decision**; `update` alignment is deferred |
| 4. Column-dependent chain guard | **Closed for the whole-line opener**; the shared-line residual stays under "not a validator" |
| 5. Whole-line helpers | **Deferred and recorded**; closed on pinned routes |
| Compact, AMDP and leading-space regressions | **Added and executed** |
| Body with no final period "refuses" | **Withdrawn**: the executed test disproved it, and the docs no longer claim it (see Finding 1) |
| Prior prerequisites | Access is done per operator evidence, the stop-rule wording is fixed, and artifact, binding and host remain open |

## Checks run
| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` (first) | **Unchanged**, 2,605 files, revision `771aff1c…` |
| `npm exec -- vitest run --silent=true` | **Pass:** 428 files, 11,572 tests |
| `npm run test:qualification:pr1142` | **Pass:** 59 of 59 (20 formatter, 39 deletion) |
| `npm run typecheck` | **Pass:** all three projects, no diagnostics |
| `npm run check:sizes` | **Pass:** 868 files, 12 schema scenarios |
| `python3 review-input/verify-snapshot.py` (second and last) | **Unchanged**, 2,605 files; nothing was read after the last run |

The count reconciles with the prior checkpoint, 11,557 + 15: 3 chain, 3 boundary, 1 CSRF, 6 shared-method, 1 pinned-writes and 1 source-precondition. No command printed a separate exit code; the tool reported no failure for any of them. Build, lint, strict docs, `validate:policy` and the GitHub checks at `b06ffdee6` remain author-reported.

**Immutable files:** I edited nothing. The verifier skips symlinks and excludes `.git`, `test-results`, `dist`, `site`, `node_modules/.cache` and `node_modules/.vite`, so dependency targets and those directories aren't hash-checked.

## Executed controls and reasoning
**Executed, unmodified:**
- all new tests inside the full suite: two real-lint refusals, warning cases with real syntax parsing, CTS, CSRF, the compact fixture, the AMDP pair, the missing-period test, the leading-space case and the chain off-by-one cases;
- the 59 simulations, which use a mock backend and don't exercise the refactored route.

**Reasoning only, no mutants:**
- the removal table;
- the fixture being lint-clean;
- SAP's handling of a missing-period body, and activation rejecting it;
- the outcome on an 816 target;
- the shared-line chain bypass;
- the meaning of CF `STARTED`;
- redaction on sinks other than stderr.

## Remaining limits
- **Live:** no SAP, CF or PP request was made. I don't assert current IAM, XSUAA, role, fixture or app state.
- **What a clean next run won't prove live:** lint refusal, the native syntax check (off by default, `src/server/types.ts:336`), warning propagation, task-to-parent CTS (`$TMP`), CSRF 503 and cleanup failures. The harness checks only `state` (`deletion-qualification.mjs:289`), so record the deployed lint and check settings in the run record.
- **Still unexercised through PP:** the post-`testclasses`-save read and everything after it, whole-owner activation with include receipts, writer B, this binding's formatter run, denied-route include calls and normal delete.
- **Identity:** the mapped user stays unverified; `createdBy` is native evidence, not proof of the PP identity.
- **Failed run:** it stays failed, and its fetch cause stays unknown.
- **Target release:** docs elsewhere record A4H as SAP_BASIS 758, but I didn't verify the PP target's release.
- **Archive:** there is no history, so identity rests on the manifest. I can't prove `followup.diff` is the complete delta from `b06ffdee`; the files I read match its post-image, and the test counts reconcile.
- **Parser:** abaplint's source wasn't read because its symlink resolves outside the working directory, so parser claims rest on repo tests.

## Tool and environment deviations
- **Refused or failed lookups, no content returned:** one `Read` that omitted `source/`, and one `Grep` on a test path that doesn't exist.
- **Empty searches:** two `Grep` calls searched too narrowly and I reran them with a wider path. One on `qualification-config.mjs` returned nothing, so `$TMP` rests on the README.
- **Outside the working directory:** only `Grep` of my own saved Vitest output, which your exception allows.
- **Execution:**
  - Allowed commands ran one at a time in the foreground. Vitest, the simulations, typecheck, `check:sizes` and the second verifier run shared batches with `Read` or `Grep` calls.
  - I ran the verifier three times, because one `Read` came after the second run. The first and last runs were each alone in their batch.
  - The verifier and `check:sizes` used read-only Git internally.
- **Model:** `claude-opus-5-5`. I can't see the effort setting from inside the session, so "max" is unconfirmed by me.
- **Otherwise none:** no ad hoc Python, direct git, edits, installs, delegation, browser, SAP/CF, external network, operator scripts, mutants or background shells. This review exists only in this message.
