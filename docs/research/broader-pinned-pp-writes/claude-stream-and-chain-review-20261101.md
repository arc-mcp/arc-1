# PR #1142 at `8c259f96`: retain, and proceed to a fresh PP run once IAM/XSUAA is restored

**Decision:** retain this revision and proceed to a fresh artifact-bound controlled PP run once the original IAM/XSUAA state is restored. This is not merge approval: the PR stays draft, the include family is unqualified, and FEAT-93 stays open.

- **Findings:** no High or Medium, four Low. None needs a code change before the run. Finding 2 adds one required operator step.
- **Prior findings:** all seven are closed within the limits below.
- **Checks:** all five commands passed, and the verifier reports the snapshot unchanged.

## Must precede the run
1. **Access:** finish the IAM/XSUAA rollback and baseline from the original state. Capture both roles' named rows before any new grant, under a new rollback ledger.
2. **Artifact:** build from the final revision, verify the bytes and record the droplet. Shipped `src/` has changed since the old artifact, so it can't be reused.
3. **Binding:** create new run and fixture manifests from a clean checkout, and run `test:qualification:pr1142` on that revision. A later `src/` or harness change needs its diff reviewed first.
4. **Host:** keep the lid open, hold a sleep assertion, and save the power log for the run window (Finding 2).
5. **Stop rule:** if the same step fails again, don't retry.
   - Preserve the fixture and save its receipts and the power log.
   - Diagnose before any new attempt.
   - Remove the fixture only with a specifically rebound recovery (`scripts/qualification/pr1142/README.md:178-188`). A preserved fixture can wait.

## Findings

### 1. Low: a real stall on the live path won't be labelled `timeout`
- **Timers:** the harness sets 330 s (`scripts/qualification/pr1142/mcp-checks.mjs:43`), but undici documents 300 s defaults for header and body gaps (`node_modules/undici-types/client.d.ts:39,47`). Nothing under `scripts/qualification` overrides them.
- **Effect, by reading:** a silent stall records `UND_ERR_BODY_TIMEOUT` or `UND_ERR_HEADERS_TIMEOUT`, `failureKind: 'unclassified'` (`scripts/qualification/pr1142/safe-io.mjs:82-88`), and about 300 s elapsed against `timeoutMs: 330000`. The 30 s margin over the pinned handler's own budget (`src/handlers/write/pinned.ts:49`) therefore has no effect.
- **Why tests miss it:** the loopback timeout is 150 ms (`tests/unit/scripts/pr1142-transport-diagnostics.test.ts:21`), and neither code is in the cause list (`:58-70`).
- **Owned signal:** by trace, deleting either condition at `safe-io.mjs:84` keeps tests green, because a real abort satisfies both. That branch has no independent test.
- **Why it doesn't block:** the cause code survives, so nothing is lost. Use the reading rules below.
- **Fix when the harness is next edited:**
  - Give these codes a separate fixed kind, so `timeout` keeps meaning the owned signal.
  - Add an injected-cause test.
  - Add a test where the owned signal aborts and the read rejects with a generic error.

### 2. Low: the runbook dropped "save the power log"
The prior step 5 asked for it, but `scripts/qualification/pr1142/README.md:113-117` and `docs/research/2026-11-01-broader-pinned-pp-writes-includes.md:191-193` only require an awake host. Without that log, a repeat failure can't rule out suspension from the record. Make it a required operator step and add it to the README. The README isn't in the harness hash (`scripts/qualification/pr1142/run-manifest.mjs:45`), but commit it before binding, because HEAD is bound.

### 3. Low: three wording gaps in the evidence
None of these changes a conclusion, and none is needed before the run.
- **Unscoped key:** `sapRoleProfileAndDefinitionRestored: true` (`docs/research/broader-pinned-pp-writes/include-qualification-attempt-20261101.json:193`) doesn't say whose definition. The nested audit (`:196-241`) does, so rename or scope the key.
- **Timestamp overlap:** the last RPC receipt (06:57:49.222Z) is 2.2 s after the logged sleep entry, and the journal finish (07:13:47.014Z) is 2.0 s after the logged back-to-sleep. That isn't a contradiction, but `docs/research/2026-11-01-broader-pinned-pp-writes-includes.md:186-188` reads as exact boundaries. Add a sentence saying they aren't.
- **Wrong number:** `scripts/qualification/pr1142/README.md:115` says "956-second gap". The measured gap is 954,253 ms, and 956 s is the reported sleep.

### 4. Low: the chain guard recognizes one shape, but the public docs describe all chains
- **Gap:** `src/adt/class-structure.ts:339` refuses only when the keyword and colon open the selected range. Something else before the colon, or a release whose range starts at the member, reaches the whole-line splice.
- **Evidence base:** one active class on one release. The research note discloses the limit (`docs/research/2026-11-01-class-surgery-range-boundaries.md:35-37`), but `docs_page/tools.md:1263-1265` doesn't.
- **Fix before admitting any adapter that uses these helpers:** require `(CLASS-)METHODS <selected name>` at the range start and refuse everything else. This run is unaffected, because pinned writes don't call these helpers.

## Focus areas
1. **SSE and receipts:** closed, apart from Finding 1.
   - The executed tests cover a stall and a disconnect after partial SSE, real timing bounds, and no body text in the receipt.
   - An absent cause stays null. Unlisted values become `OTHER`, including lookalike prefixes and a number.
   - A failed receipt write keeps the original error and adds the flag. A successful response whose receipt can't be persisted still rejects.
   - By reading, the flag reaches `qualification.execution` (`scripts/qualification/pr1142/deletion-qualification.mjs:461`).
2. **CI and CSRF:** the scope statement is honest.
   - The step is in the Node 22/24 matrix, and that job has no title gate (`.github/workflows/test.yml:69,124-125`).
   - Create and update prove one HEAD, GET/HEAD requests only, and `unchanged` at `recording-preflight` (`tests/unit/handlers/pinned-csrf-bootstrap.test.ts:59-66`).
   - By reading, `edit_method` and include updates share that preflight (`src/handlers/write/pinned.ts:107-116`). A search of pinned, formatter, activation and deletion test files found no bootstrap-503 test for delete or activation.
   - Correction to the prior review: this first bootstrap reports `unchanged`, not `creation-unknown`.
3. **Chain refusal:** sound for the observed shape.
   - The native XML has 11 ranges starting at row 18, plus a single-member chain at row 193, which is also refused. The first two ranges end at rows 35 and 53, matching the source.
   - The guard replay's helper hash equals the current file's manifest hash (`review-input/operator-evidence/class-chain-chain-guard-check.json:5`).
   - 16 new tests ran, covering first and later members, comments and CRLF. The handler tests show no PUT, a locked structure read and a completed unlock (`tests/unit/handlers/class-surgery-concurrency.test.ts:279-328`).
   - The capability table is unchanged, so no new pinned action is admitted.
4. **Evidence corrections:** accurate.
   - The hashes, UTC conversions and timing arithmetic all check out.
   - I counted 16 and 15 role rows, and the activities match. No equality is claimed for the read-only role.
   - The docs say the sleep explains the gap, not the fetch cause.
   - IAM/XSUAA is still recorded as pending.
5. **Recovery:** an adequate written prerequisite, not runtime coverage.
   - The README covers every required binding and forbids defaulting to writer A.
   - Both historical scripts hard-code the deleted fixture (`review-input/operator-evidence/partial-include-recovery-executed.mts:26`, `partial-include-recovery-instrumented.mts:27`), so they refuse any other.
   - No generic recovery exists in the harness.
   - The four fixtures' absence is supplied typed-404 evidence from 11:09Z. I did not re-check it live.
6. **Merge and prior review:**
   - The diff names `c8a0c9c27`, and its only remerge conflict is `AGENTS.md`. Both rows survive at `AGENTS.md:210-211`, with no conflict markers.
   - The prior review still contains its failed size row and deviations (`docs/research/broader-pinned-pp-writes/claude-main-integration-review-20261101.md:115,120-129`). I have no separate copy to prove it byte-for-byte verbatim.

## Prior finding dispositions
| Finding | Disposition |
|---|---|
| 1. Diagnostics only for rejected fetch | **Closed**; the response-read path now ran. Limit: Finding 1 |
| 2. Unlisted cause looks absent | **Closed**; 11 allowlisted and 5 absent/unlisted cases ran |
| 3. Pinned CSRF 503 retry removed | **Retained**; coverage closed for create/update preflight only |
| 4. Unnamed SAP definition | **Closed, with a permanent limit**: the historical read-only definition is unknown |
| 5. Recovery template | **Closed as a written prerequisite**; nothing executed |
| 6. Controls absent from CI | **Closed**; no GitHub run observed |
| 7. Writes doc contradiction | **Closed** (`docs_page/multi-target-writes.md:180`) |

The earlier c6d dispositions stand, and its "response read only read" limit is now executed.

## Reading the next failure
- **`UND_ERR_*_TIMEOUT`, about 300 s, `unclassified`:** Node's fetch timer fired, by reading.
- **`failureKind: timeout`, about 330 s:** the harness signal fired, which by reading needs data still arriving.
- **`elapsedMs` well above `timeoutMs`, or a long gap before `startedAt`:** compare with the saved power log.
- **`statusCode: 503` at `recording-preflight`:** a CSRF bootstrap failure before any create, save or activation request. This is not a transport failure.

## Negative controls
**Executed, unmodified:**
- the partial-SSE stall and disconnect tests
- the cause-allowlist and absent/unlisted tests
- both receipt-failure tests
- the one-HEAD CSRF test
- the chain refusal tests
- all 59 simulations, including `includes-post-save-read-rejection`

**Reasoning only, no mutants run:**
- Constant-zero timing would fail the timing bounds.
- Removing the guard would fail the `.toThrow` chain tests.
- A retried HEAD would fail the count assertion.
- Either timeout condition can be deleted with tests staying green.
- The 300 s path in Finding 1.
- A failed simulation exits non-zero (`scripts/qualification/pr1142/deletion-regression.mjs:694-696`).

## Checks run
| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` | **Unchanged**, 2,617 files, revision `8c259f96…`; ran first, after the other checks, and last |
| `npm exec -- vitest run --silent=true` | **Pass:** 425 files, 11,516 tests |
| `npm run test:qualification:pr1142` | **Pass:** 59 of 59 (20 formatter, 39 deletion, including 22 include) |
| `npm run typecheck` | **Pass:** all three projects |
| `npm run check:sizes` | **Pass:** 861 files, all schema scenarios |

Counts reconcile with the author's: 3 more files and 38 more tests (13 + 3 chain, 20 transport, 2 CSRF). Lint, strict docs, build and the workflow YAML parse remain author-reported.

## Remaining proof limits
- **Not live:** nothing here ran against SAP or through PP.
- **Still unexercised through PP:**
  - the `testclasses` read after an existing save, and everything after it
  - whole-owner activation with include receipts
  - writer B
  - this binding's formatter run
  - denied-route include calls
  - normal delete
- **Chain guard:** no live save exercised it, and the next PP run won't either. Replay results are supplied without their scripts.
- **Failed run:** the fetch cause stays unknown, and clock behaviour across macOS sleep is not established.
- **SAP audit:** it reads role definition rows, not generated profile contents or a runtime authorization check. All operator records are supplied, not observed by me.
- **CI and runtime:** no GitHub run was observed, so Node 22/24 on Linux is unproven. I couldn't record the local Node version, or confirm that Node's bundled fetch uses the documented 300 s defaults.
- **Revision identity:** it rests on the manifest, because the archive has no original history.

## Tool and environment deviations
- **Refused reads:** two `Read` calls omitted `source/` and were refused, with no content returned.
- **Failed searches:**
  - `node_modules/@types/undici-types` doesn't exist; the copy I used is `node_modules/undici-types`.
  - One conflict-marker search had a bad pattern, so I reran it correctly.
- **Outside the working directory:** only a `Grep` of my own saved Vitest output, which your exception allows.
- **Execution:**
  - Checks ran one at a time in the foreground, though file reads ran alongside some of them.
  - Two read-only searches followed the second verifier run, so I ran the verifier a third time.
  - The verifier and `check:sizes` used read-only Git internally.
- **Model:** `claude-opus-5-5`. I can't see the effort setting from inside the session, so "max" is unconfirmed by me.
- **Otherwise none:** no direct git, edits, installs, delegation, browser, SAP/CF, external network, operator scripts or mutants. This review exists only in this message.
