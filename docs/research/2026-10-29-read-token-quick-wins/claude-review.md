# Claude Code review — PR 1144

Reviewed immutable head `e29d3afc279e499cae50ca372ab447133e9fa056` against
`f3d614b162b4d016bb9a8cc2eff46277536699fe`, using Claude Code 2.1.308 (reported model `claude-opus-5-5`).
MCP access was disabled and source changes were prohibited. The reviewer independently ran
416 focused tests; the live checks and full-suite results were inspected evidence, not rerun by Claude.

## Disposition

- P2 write-error follow-up: addressed by explicitly naming `SAPRead` for inventory and grep,
  with both legacy and pinned `edit_method` error assertions. The pinned test verifies no PUT.
- P2 unreadable suggestions: confirmed on a complete class containing an abstract declaration.
  Candidate ranking now excludes entries without implementation ranges. A matched declaration
  gets a no-implementation explanation. The signature hint is conditional on an own global MAIN
  declaration; qualified/known-local/interface/redefinition entries do not receive it. Legacy
  declaration-only inventory entries can lack owner metadata, so no ownership is asserted.
  A standalone definition-only include currently fails earlier in the legacy listing parser;
  tests preserve that refusal rather than expanding that parser's scope.
- P3 qualified selectors: restored `lhc_x~m`, `lcl_x~m`, `ltc_x~m` schema examples, refreshed
  snapshots, and added a local-method model scenario whose same-named global body is different.
- Evidence qualification: the body-plus-inventory baseline remains explicitly conditional.
  The single-inventory comparison and the absence of a pre-feature model control are recorded.
  Signature-read misses are explicitly distinguished from body-read typo hints in the tool docs.

The CI follow-ups update only `follow-redirects` 1.16.1 → 1.16.2 in the root and AppRouter
lockfiles for GHSA-mrwp-f3q8-3g9p. Both audits pass; no allowlist exception was added.

## Original review

## Verdict: PR #1144 is safe to merge after two small error-message fixes

The structured-read rejection and the signature reader held up in everything I traced, with no correctness, authorization, cache or version problems. The three findings below are all new in this PR and all concern what a model is told next. None returns a wrong signature.

## Findings

### P2: `edit_method` errors lost the method list and now give read-only instructions (introduced)
- **Where:** `src/context/method-suggestions.ts:44`, reached through `src/context/method-surgery.ts:572` and `:656`. Callers are `src/handlers/write/class-surgery.ts:94-103` and `src/handlers/write/pinned.ts:146-153`.
- **Repro:** run `SAPWrite(action="edit_method", type="CLAS", name=…, method="nonexistent", source=…)`. It returns `…Use method="*" with the same include to list methods, or grep to search source. Searched main source of X.`
- **Impact:**
    - The message doesn't name `SAPRead`, and `SAPWrite` has no `grep`.
    - A model following it within `SAPWrite` sends `method="*"`, which reaches lock, read and failed splice unless the schema rejects it (I didn't check that). It then fails again.
    - The list was removed here, while the sibling surgery errors at `class-surgery.ts:258`, `:386` and `:438` still include it.
    - The README describes this as a read change and doesn't mention the write path.
- **Fix:** name the tool, for example `Use SAPRead(type="CLAS", method="*", same include) to list methods, or SAPRead grep to search source.`
- **Test gap:** `tests/unit/handlers/write-surgery-rap.test.ts:356` only checks `not found`, `implementations` and `auto-routed`. Add an assertion on the follow-up text for both the legacy and pinned paths.

### P2: The suggestion list offers methods that can't be read, including the name just requested (introduced)
- **Where:** `src/context/method-suggestions.ts:28-37`, called from `src/context/method-surgery.ts:563-572`.
- **Repro:** take a class with `METHODS execute ABSTRACT …` and read `SAPRead(type="CLAS", name=…, method="execute")`. `listMethodsAST` returns it with `startLine: 0`, so the edit distance is 0 and the result is `Method "execute" not found in ZCL_DEMO. Suggestions in selected source: execute.`
- **Other cases:**
    - A typo such as `execut` suggests the same unreadable method.
    - Every candidate from a definition-only `include=definitions` source has the same problem.
- **Impact:**
    - The message contradicts itself and invites a pointless retry.
    - It breaks the code's own rule at line 32, "A suggestion must remain a complete, copyable selector".
    - It never mentions `methodView="signature"`, which is the read that works here.
- **Fix:**
    - Skip candidates with `startLine === 0` when ranking.
    - At `method-surgery.ts:563`, when the exact name matched but has no implementation, return `declared without an implementation in this source`, plus a pointer to `methodView="signature"` for global methods.
- **Test gap:** add unit tests for the abstract and definition-only cases.
- **Verification:** I traced this through the code but couldn't run it, because ad hoc execution wasn't available.

### P3: The shortened `method` description dropped the qualified `~` form (introduced)
- **Where:** `src/handlers/tools.ts:445` and the tool-definition fixtures.
- **Problem:**
    - The old examples `zif_order~process` and `lhc_travel~accept` are gone. The read-only on-prem fixture no longer contains any qualified selector.
    - The new text says `lhc_*/lcl_* use implementations`, but `detectLocalHandlerInclude` (`src/handlers/object-types.ts:616-622`) only routes when `~` is present.
- **Impact:** a local-method read now costs one failed call before the error hint at `read.ts:536` explains the form. No read-method eval covers this case.
- **Fix:** same length, more accurate: `Without include, lhc_x~m/lcl_x~m use implementations, ltc_x~m testclasses, others MAIN.` Then regenerate the snapshots.

## What held up
- **Structured rejection:** it runs before any SAP access in both the schema and the handler. Empty or null `method` values are stripped first, including on the re-entrant hyperfocused path, so whole-class structured reads aren't falsely refused. `handleSAPRead` has one caller, `dispatch.ts:682`.
- **Declaration scoping:**
    - Parsing covers exactly one global DEFINITION.
    - Unknown statements, nested definitions, a missing ENDCLASS and duplicates are all refused.
    - Comments and literals can't produce false matches.
    - Chained declarations are sliced by token position.
- **Redefinitions:** `FINAL REDEFINITION` is covered, because the grammar places `FINAL` inside `Expressions.Redefinition`. There's no explicit test for that form.
- **Routing:** bare names such as `lcl_foo` stay on MAIN, because routing requires `~`.
- **Parser release:**
    - An unprobed system parses as Cloud.
    - 8xx and BTP 920 releases map to v758.
    - An unsupported declaration ends in an explicit refusal, not a wrong signature.
- **Cache and auth:** signatures use the existing `cachedGet` path and aren't cached separately. Draft, warning, per-user revalidation and scope behaviour match ordinary reads, and the tests cover them.
- **Bounds:** suggestion ranking is capped at 2,000 candidates and 128 characters. Cold reads still download and fully parse MAIN with no size limit, the same as existing `method=` reads, so that isn't new.
- **Schemas:** `methodView` is in `tools.ts`, both Zod schemas and the handler. `nullableOptionals` only applies to `SAPWrite`, and `SAPRead` already has single-value enums such as `action`, so this adds no new kind of strict-mode problem.

## Token claims and remaining limitations
- **Arithmetic is correct, but the baseline is the most favourable one:** the 94.2%, 95.9% and 90.9% figures compare against a body read plus an inventory read. The README states this assumption. Compared with a single `method="*"` call, which already includes signatures, the savings are:

| System | Inventory tokens | Signature tokens | Saving |
|---|---:|---:|---:|
| 758 | 2,062 | 365 | 82.3% |
| 750 | 1,261 | 162 | 87.2% |
| BTP | 844 | 86 | 89.8% |

- **Per-turn cost dwarfs the saving:** the failed eval trace recorded a peak prompt of 20,566 tokens with the full tool set (`model-evals.json:137`). One extra turn costs far more than the roughly 856 tokens saved on BTP, so the saving only pays off if call counts don't rise.
- **The model evals have no control run:**
    - None of the three runs used the base schema.
    - In both original-wording failures, the second call was `methodView="signature"` with no `method`, which is rejected. In the run I read in full, the third call read the whole class.
    - So the evals can't show whether the new property reduces or adds extra calls.
- **Signature typos get no suggestions:** `method-signature.ts:94` returns a refusal without nearby names. `docs_page/tools.md`'s suggestion sentence doesn't say it only applies to body reads. This is acceptable for an opt-in option, but a clarifying clause would help.
- **Not qualified:** a principal-propagation deployment and a real edited BTP draft, as you noted.

## Verification
**Tests I ran** (`vitest`, no `-u`, all passing):
- **135 tests in 6 files:** `method-signature`, `method-suggestions`, `method-surgery`, `read-method-options`, `read-method-state` and `read-methods-scenarios`.
- **281 tests in 2 files:** `read.test.ts` and `write-surgery-rap.test.ts`.

**Inspected only, not run:**
- `btp-results.json`, the fingerprint lines of `live-results.json`, the summary and trace fields of `model-evals.json`, and the README.
- The e2e and BTP test sources; their passes are as you reported, and I didn't find a retained per-test record of them.
- The full suite, typecheck, lint, build, schema budgets and the snapshot test, also as you reported.

**Blocked by the permission layer:**
- `shasum` and a Python evidence check were denied. I recalculated the percentages by hand, but **did not verify the SHA-256 fingerprints against HEAD**.
- What I could confirm: the five files `btp-results.json` lists have the same hashes in `live-results.json`, and the second commit changed nothing in `src`, `scripts` or `tests/fixtures`.
- The same restriction ruled out ad hoc adversarial parser runs, so parser edge cases not covered by existing tests were checked by reading the code and abaplint's grammar.


## Follow-up review — 2026-10-31

Claude Code 2.1.308, actual model `claude-opus-5-5`, reviewed the immutable delta `e29d3afc279e499cae50ca372ab447133e9fa056..598740f6d78e68dd55cf66f85be0bfdeafab4c4e` after the fixes and refreshed qualification. It independently passed 271 tests and verified all seven runtime fingerprints plus both lockfile fingerprints. The review used the same read-only restrictions and disabled MCP configuration.

**Disposition:** no code findings remain. The sole P3 finding was a stale “Four” scenario count in the README table. The reviewer inspected the prepared correction to “Five”; this documentation follow-up commits that correction. Runtime files, measurements and their fingerprints are unchanged. No further code change was requested.

### Reviewer response (verbatim)

# Recheck of PR #1144 fixes: `e29d3afc2..598740f6d`

**One docs-only finding remains, and none in code.** All three original fixes are confirmed, with no regressions. The finding doesn't affect behaviour or block the merge.

## Remaining finding

**P3: the committed README still says four scenarios**
- **Where:** `docs/research/2026-10-29-read-token-quick-wins/README.md:94`, at `598740f6d`.
- **Impact:** the Model behavior row says "Four fixture-backed scenarios", but the same README later reports the five-scenario run, and `tests/evals/scenarios/read-methods.ts` defines five.
- **Fix:** commit the edit now sitting uncommitted in this worktree, which changes the row to "Five". I didn't make that edit; it appeared during this review. It also removes a redundant sentence about model improvement, and the no-control caveat stays.
- **Effect on evidence:** none, because the README isn't one of the fingerprinted files.

## Original findings

| Original finding | Status | What confirms it |
|---|---|---|
| **P2: write-error follow-up** | Fixed | The follow-up text names `SAPRead` for both the inventory and grep. Both the legacy test (`write-surgery-rap.test.ts:379-380`) and the pinned test assert it. In the pinned path the failed splice throws at `pinned.ts:153`, before any PUT, and the test confirms no PUT was sent. |
| **P2: unreadable suggestions** | Fixed | Ranking skips entries with no implementation range (`method-suggestions.ts:49`). A matched declaration gets the no-implementation message, and the signature pointer is worded conditionally. Qualified, known-local, interface and redefinition cases get the `SAPRead` follow-up instead. `method-signature.test.ts:57-61` shows the pointed-to read works for an abstract method. |
| **P3: qualified selectors** | Fixed | The `tools.ts:445` text is restored, with exactly one changed line in each of the seven snapshots. The old wording is gone from `src`, the fixtures and `docs_page`. The hyperfocused and live-relations fixtures never had this text and are unchanged. |

**Regressions checked, none found:**
- **Declaration matching:** the new branch only runs for an entry already matched by name and lacking a range, so successful extraction and the ambiguity errors are unchanged.
- **Appended read hints:** the include hint at `read.ts:534-538` still reads correctly after the new message.
- **Local-method eval:** it runs through the real handler, routes to the include and returns `result = 42.` The scenario's final-answer check also forbids `strlen`.

**Known limitation, not a finding:** a wrong-source read of the signature pointer costs one call and ends in an explicit refusal. That matches the conditional wording you described.

## Dependency patch
- **Lockfiles:** each changes only `follow-redirects` from 1.16.1 to 1.16.2, in the version, resolved and integrity lines. The integrity value is identical in both.
- **Parents:** the `^1.16.0` ranges are unchanged and still satisfied.
- **Installed copy:** the root `node_modules` lock records the same integrity value.
- **Config:** I found no `follow-redirects` exception in the root or AppRouter package files, `.github`, `.npmrc` or audit-named files.

## What I tested and inspected

**Ran (no `-u`, all passing):**
- Your six focused files: 240 tests.
- `check-tool-schema-budget` and `method-signature`: 31 tests.
- SHA-256 of seven source files and both lockfiles: all match `qualification-results.json`. The source hashes also match the new `btp-results.json` and final `model-evals.json` entries.

**Inspected only:**
- The delta and adjacent code in `method-surgery.ts`, `read.ts`, `class-surgery.ts` and `pinned.ts`.
- The retained BTP and A4H results, which are all marked passing.
- The final model run, which is 4/5 strict; the implementation-only scenario made 4 calls and never produced a final answer.

**Taken from your report, not rerun:**
- The full unit suite and the live BTP and A4H tests.
- Both `npm audit` runs and the advisory's applicability. I made no registry or network calls.
- The AppRouter's installed `node_modules`.

**Not measured:**
- I didn't run the new tests against the old code. The original abstract-method bug comes from the first review's code trace, plus the new tests passing.
- The 758/750 typo figures in the README are from the older wording and weren't re-measured. Only the BTP figures are fresh.

**Blocked or side effects:**
- The permission layer denied two compound shell commands: a snapshot loop and a Python summary of the evals. I got the same facts from `git diff`, Grep and Read.
- Vitest rewrote `test-results/unit.json`, which doesn't appear in `git status`. I edited nothing else.
