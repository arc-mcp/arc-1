# PR #1142 at `9bd21e15`: private FUNC activation profile and native evidence

## Decisions

| Question | Decision |
|---|---|
| **Development checkpoint** | **Accepted:** 0 High, 2 Medium, 4 Low |
| **Full PR, public function admission, real PP qualification** | **Not granted.** The PR stays draft and FEAT-93 stays open. |
| **Private FUNC activation profile** | **Acceptable as private offline code.** Close Findings 1 and 2 before admission or any live qualification of this adapter. |
| **Native active-deletion narrative** | **Follows the retained evidence**, except that the operator README contradicts it (Finding 4). |

- **Reach:** I found no path to a foreign object and no public FUNC activation on the production route.
- **SAP:** I sent nothing to SAP and ran no qualification entrypoint. No native experiment is proposed or authorized.
- **Severity:** I used the prior report's definitions. Medium means a missing control or wrong conclusion. Low means an edge case or a test or doc gap.
- **Evidence:** findings come from reading code and receipts, because ad hoc scripts are barred.

## Medium findings

### 1. The active proof passes without any evidence of activation when the draft's source equals the active source

**Where:** `src/handlers/write/pinned-function-activation.ts:86-110`; `src/handlers/write/pinned-activation.ts:140-145`; mock at `tests/unit/handlers/pinned-function-activation.test.ts:73-78`

**Native evidence, all under `review-input/native-evidence/run/`:**

| Signal | Before activation | After activation | Discriminates? |
|---|---|---|---|
| `?version=active` metadata version | `active` (`00105`, `00140`) | `active` (`00156`) | **No** |
| Default metadata version | `inactive` (`00099`, `00146`) | `active` (`00164`, `00180`) | Yes, not read by the adapter |
| `objectstates` link to `?version=inactive` on the active read | Present (`00105`) | Gone (`00156`) | Yes, not read by the adapter |
| Normalized metadata hash | `038cee98…` (`00150`) | `038cee98…` (`00161`) | Stable, so comparable; not used by the adapter |
| Source hash | Stub `53396588…` vs draft `7bf7c96a…` | Both `7bf7c96a…` | Only when the source changed |

`?version=inactive` also falls back to the active bytes when no draft remains (`00183`; protocol doc line 108).

**Scenario:** the draft's source already equals the active source, and SAP returns `activationExecuted="true"`. This covers three cases:
- a never-edited generated stub (`00102` and `00108` hash the same)
- a metadata-only draft, such as a processing-type or description change
- no draft at all

Every adapter check already passes before the POST: version, hash, owner and package.

**Consequence:** the result is `state: 'activated', activeSourceVerified: true`, but the readback adds nothing beyond SAP's flag. A metadata-only change is never compared, and the default metadata could still say `inactive`.

**Comparison:** the consumed harness required `active.metadataHash === saved.metadataHash` (`native-function-contract-run.ts:285`). My prior report's step 5 also asked for "matching metadata". The adapter keeps only identity, owner and package.

**Bound:** SAP's explicit flag must still be true, and the ordinary changed-source case discriminates correctly.

**Fix:**
- Capture the preactivation default metadata version and normalized metadata.
- After activation, require the default read to report `active`, or the active read to have no inactive `objectstates` link.
- Compare normalized metadata.
- Add a native-shaped row where the preactivation `?version=active` read already reports `active`. The current mock doesn't model that.

### 2. FUNC admission is down to one control, and the test that claims closure stops on a different guard

**Where:** `pinned-activation.ts:78`; `src/handlers/activate.ts:115`; `src/handlers/dispatch.ts:1019-1021`; `src/server/multi-target-write-surface.ts:22-29`, `:72-76`; test at `pinned-function-activation.test.ts:208-215`

**What holds today:** the production route refuses FUNC (`multi-target-server.ts:617-619`, then `pinnedMutationAllowed`). All variants normalize to `FUNC` first, the hyperfocused `SAP` tool is forbidden on that route, and `config.multiTargetWrite` is set only in `multi-target-runtime.ts:122`.

**What changed:**
- `handlePinnedActivation` used to refuse FUNC itself through `assertPinnedSourceOwner`, and now skips that check.
- SAPWrite still re-checks admission inside its handler (`pinned-source-write.ts:34`). Activation has no equivalent.

**Scenario, by reading only:** `handleToolCall(pinnedClient, config, 'SAPActivate', { type: 'FUNC', name: 'ZARC1_FN' })` has no `group`, so it passes the raw-field check and the schema. It then reaches native search and the activation POST.

**Why the test is false-green:**
- The test sends `group`, so it stops on the raw-field check and never touches a FUNC type gate.
- If `types` gained `FUNC`, public no-group activation would open and this test would stay green.
- No row under `tests/unit/server` pins FUNC refusal on `SAPActivate`. The only FUNC literals there are in `ide-eclipse.test.ts` and `audit.test.ts`.

**Consequence:** no exposure today, but "public FUNC remains gated" rests on one array with no regression protection.

**Fix:**
- Add `multiTargetInvocationDecision('SAPActivate', { type: 'FUNC', name, action: 'activate' }, writer) === 'forbidden'`, plus a dispatch row without `group`.
- Restore a handler-level refusal, with the private path selected by an internal grant that tool arguments cannot supply.

## Low findings

| # | Finding | Where | Scenario and consequence | Fix |
|---|---|---|---|---|
| 3 | **Minimal mode isn't honored on activation.** The handler has no config and never passes `minimalErrors`. | `pinned-activation.ts:202-212`; `pinned-result.ts:92`; compare `pinned-source-write.ts:48`, `:136` | With minimal errors on, a verification failure after native success returns full `nativeActivation.messages` and `details`. The same mapped user receives it, so scope doesn't widen. It matches general `SAPActivate` (`activate.ts:438`, `:445`), which review 7 chose not to count. FUNC has no row either way. | Decide the policy before admission, and either pass the flag or document the exception. Add a sentinel row. |
| 4 | **The operator README contradicts the result.** The passive section has a consumed banner (`:251`), but this one still says "Candidate only: not executed". | `scripts/qualification/pr1142/README.md:200-201`, `:209`, `:230`; protocol doc `:502` | The narrative says never rerun, but the procedure reads as still pending. The claim sits under one host's home directory (`:216`), so the README is the only cross-host warning. It also keeps "stateless", which this delta corrected in the protocol doc. | Add a consumed banner and result link, and change the wording to "base". |
| 5 | **Some FUNC rows pass on another guard or are missing.** | Test `:71`, `:156`, `:200-205`; `pinned-activation.ts:79-80`, `:118`; `pinned-function-activation.ts:92`, `:102-106` | `package-drift` fails the allow-list, so `currentPackage !== pkg` is never reached. Only the container name is mutated after activation. There's no end-to-end namespaced FUNC row and no namespaced source-frame row. The non-FUNC `group` refusal has no row. The cancel row doesn't assert state. | Add these rows, including drift between two allowed packages. |
| 6 | **The budget is partial.** Group, module and search reads have no response budget, so `response.text()` buffers them whole. Only the deadline bounds that, and the 1 MiB XML check runs after buffering. | `pinned-function-owner.ts:73`, `:87`; `client.ts:1024`; `http.ts:562` | A large preflight response is held in memory before refusal. The doc correctly scopes the budget to source and active-metadata reads, so nothing is misreported. | Pass an all-response budget on these reads. |

## Requested assessments

| Area | Verdict | Basis |
|---|---|---|
| Selected native references | **Holds** | Exactly one reference, exact URI apart from `%2f` hex case; name, `FUGR/FF` and deleted marker must agree. |
| Ownership, package, recording rechecks | **Holds** | Fresh parent and child reads and `checkPackage`, then `pinnedRecording`, on both validations. Native shapes appear in `00166`, `00168`, `00170`. |
| Draft stability before confirmation | **Holds** | Hash captured first and rechecked before confirmation. A later change fails closed at active readback. |
| Active version, owner, source proof | **Partly** | Holds for changed source: native inactive and active bytes match (`00150`, `00160`). See Finding 1 otherwise. |
| Cancellation, deadline, no replay | **Holds** | `composeOptions` forces these on every facade call, and redirects are refused. |
| Budgets | **Holds as documented** | Each source and active-metadata read gets its own 1 MiB all-response budget, and the oversize row reaches the real stream cap. See Finding 6. |
| Uncertain-success reporting | **Holds** | `activation-not-confirmed`, phase, warning, preserved native result, `retryable: false`, no `activeSourceVerified`. |
| Minimal-error reporting | **Not honored** | Safety messages are static and API failures return status only, but native diagnostics pass through. See Finding 3. |
| Source MIME | **Holds** | Full media-type equality, and `text/plain-unsupported` is refused. The harness applied the same check natively (`native-function-contract-run.ts:114`). |
| Native type and XML namespace | **Holds** | Bound namespaces on root and references. The adapter's field checks are all present in native receipt `00156`. |
| Existing CLAS/INTF/PROG/INCL | **Holds** | No added requests, because FUNC ownership returns early for other URIs. The only changes are the `group` refusal, which the public gate already blocked, and warning wording. |
| Public admission | **Closed on the production route** | See Finding 2 for the lost second layer. |

## Native evidence and narrative

**Verified from the supplied receipts:**
- **Hashes:** result `2cc61219…`, evidence manifest `e3db18ab…` and review 17 `94cd3c7f…` all match the snapshot manifest. The committed review copy is byte-identical to the prior verdict.
- **Journal:** 297 records are present. Spot-checked hashes match the evidence manifest.
- **Binding:** revision, entry hash, lockfile hash and Node 22.21.1 match the GO conditions.
- **Single attempt:** one activation exchange (`00152`, `00153`), no confirmation, one activation validation (`00151`), one source PUT, one FUNC DELETE and one group DELETE. All nine error rows are 404s.
- **Deletion:** LOCK 200 (`00172`), guard hashes equal to the active receipt (`00184`, `00190`), DELETE 200 (`00192`), then 404, UNLOCK 200 and `sessionClosed: true` (`00197`).
- **Parent baseline:** I compared all 15 pre-child and post-removal raw hashes pair by pair, and all are equal. That is stronger than the normalized comparison the runner used.
- **SM12:** the AX captures show `Lock Table (0)` for both searches as described. The first is MARIAN/001 across all tables and arguments. The second is all users in client 001 with `*484A9C5D2E47F1B2*` at 11:15:16Z.
- **Secrets:** no lock handles, cookies or auth headers appear in the native evidence or prerequisites.

**Disposition of my prior report:**
- **Medium 1:** closed by the author's replay and by the native guard passing.
- **Medium 2:** closed by observed restoration. The replay's "group preservation expected" turned out wrong, and its own limit allowed for that.
- **Medium 3:** closed for this run by the written controls and table, though the README was never updated (Finding 4).
- **Medium 4:** correctly kept as an interpretation limit. Nothing here establishes the 423's cause, and the narrative claims no cause.
- **Low findings:** correctly recorded as limits of the consumed harness, not as fixed.

**Result:** the outcome matches "Pass, then zero locks". It supports one active FUNC DELETE with this owning sequence, not a cause, production lock order, admission or PP.

## Checks

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` (first, alone) | **Unchanged:** 4,807 files, revision `9bd21e15…` |
| `npm exec -- vitest run --silent=true` | **Pass:** 486 of 486 files, 13,000 of 13,000 tests, 37.30 s; both FUNC files pass, 39 tests |
| `npm run test:qualification:pr1142` | **Pass:** 59 of 59 scenarios (20 + 22 + 17) |
| `npm run typecheck` | **Pass:** all three projects |
| `npm run check:sizes` | **Pass:** 965 files, 12 schema scenarios |
| `python3 review-input/verify-snapshot.py` (last, alone) | **Unchanged:** 4,807 files, revision `9bd21e15…`; nothing read after it |

**Not run by me:** build, lint, policy and strict docs. These and the pre-fix MIME failure remain author-reported.

## Evidence limits

- **Adapter never run natively:** the shape comparisons above are by reading.
- **FUNC prompt path:** both supplied native FUNC activations returned no prompt, so this branch rests on authored fixtures.
- **Author-reported:**
  - environment checks and strict-TLS discovery (`environment.json` not supplied)
  - that the stop rules were written before the run, since the file has no timestamp
  - CI results
  - the retained replay's source receipts
  - absence of the earlier fixtures, so "All native fixtures are absent" is verified only for this run's suffix
  - no BTP, PP or permission change
- **Connection isolation:** the journal doesn't label connections and holds no headers, so "the guard used the base connection" comes from the harness code, not a receipt.
- **Final absence:** the pool 404 and inactive list are summary rows only (`00296`, `00297`), a limit review 17 already recorded.
- **SM12:** two samples 3.5 minutes apart around the run, not a trace. PNGs were not supplied.
- **Scope of the sample:** one local Basic-native `$TMP` run at `5b1669eb`. It is not current-code PP evidence.
- **Tests:** they ran against mocks, so they don't establish live SAP behavior.

## Unresolved scope

This is accepted unfinished work, not unsupported SAP behavior:
- public function admission
- FUGR and group-include activation
- remaining function profile qualification
- DDIC, CDS and SDO; RAP and batches
- package, API and publication; CTS
- trace and quickfix; classic FLP
- current-byte two-writer and recording-transport PP qualification

The last PP artifact remains `77e41fdcd`. Git and custom plugins stay excluded, and aggregate, Basic, Copilot and read-only connections stay mutation-free.

## Execution deviations

- **Two refused reads:** I omitted `source/` on `src/adt/mutation-client.ts` and `tests/unit/handlers/setup-undici-mock.ts`, which pointed outside the snapshot. The harness refused both and returned nothing, and I corrected the paths.
- **Overflowed search:** one broad `Grep` over the journal was saved by the harness under `~/.claude/projects/…`. I saw only its preview, did not open the file because it wasn't approved-check output, and reran narrower searches.
- **Saved Vitest output:** it exceeded the display limit, so I searched my own saved copy with `Grep`, as allowed.
- **Test side effects:** approved suites produced their normal outputs. Review 17 noted that one creates temporary repositories and the home state parent directory. I did not inspect those, and the closing verifier reports the snapshot unchanged.
- **Otherwise none:** Bash ran only the five approved commands, one at a time. There were no `wc`, pipes, chains, edits, installs, mutants, delegation, SAP, browser or external network use.
- **Model:** `claude-opus-5-5`. I can't see the effort setting from inside the session, so max effort rests on the launcher.
