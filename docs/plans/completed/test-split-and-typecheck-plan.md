# Test Split & Typecheck Plan — Stage C + follow-ups (PR after #402)

Successor to [architecture-consolidation-plan.md](architecture-consolidation-plan.md) (v2, executed
as [PR #402](https://github.com/marianfoo/arc-1/pull/402)). That PR drained the two source
monoliths (intent.ts → per-tool modules, write.ts → write/ package) and deleted the barrel. This
plan covers what was deliberately deferred: the last monolith — `tests/unit/handlers/intent.test.ts`
— plus the small verified follow-ups from the three review rounds.

**Status: ✅ Stage T + Stage C + Stage R DONE** (shipped as [PR #405](https://github.com/marianfoo/arc-1/pull/405)). Stage T type-checks `tests/` via
`tsconfig.tests.json` chained onto `npm run typecheck` (fixed 65 latent errors). Stage C split
intent.test.ts (712 tests) into 10 per-module files — read, search-navigate, lint-diagnose, activate,
manage-context, transport, write-ddic, write-create-batch, write-surgery-rap, dispatch-misc — all
under the 3,000-line budget, blocks moved verbatim (names unchanged), exactly 712 tests preserved.
Stage R ride-alongs landed as separate commits: R1 SDO⊆table registry-sync assertion
(mutation-proven; later superseded in this PR by deriving the table rows from `SDO_TYPES` —
by-construction, which also covers the BTP side the assertion missed), R2 the #403-stale dev-guide
SRVB row, R3 the `SAPWRITE_CLAS_INCLUDES` alias retirement (fixtures byte-identical). A full
multi-agent review of the PR then landed: split-file titles/comment repairs, the features()/
featuresOff() factory sweep, two typecheck-gate hole closures (mjs `any`-wildcard → allowJs;
root vitest configs into the tests program), and the shared undici-mock prologue helper.
The mapping/grouping below is the as-shipped layout.

## Baseline (measured on `origin/main` @ 909f2534, 2026-06-11, post-#402+#403)

| Metric | Value |
|---|---|
| Unit suite | 109 files / **3,721 tests**, green |
| `tests/unit/handlers/intent.test.ts` | **15,487 lines / 712 tests** (ratchet budget 15,500) |
| Its structure | 3 top-level describes; one mega-describe `'Intent Handler'` (line 58→~15,370) containing **68 second-level describes**; + `stripLlmEmptyValues` (15,371) + `normalizeTypeArgsForValidation` (15,431) top-levels |
| Second-level distribution | SAPWrite ×21, SAPRead ×5, SAPDiagnose ×4, SAPNavigate ×3, SAPSearch ×2, one each for the other 7 tools, ~20 cross-cutting blocks (error formatting, scopes, normalize/strip, hyperfocused, BTP adaptation, buildCreateXml, …) |
| Shared scaffolding | lines 1–57: imports, `mockFetch` + `vi.mock('undici')`, 6 dynamic `await import()`s, `createClient()`, `dataPreviewXml()`, `freestylePostCalls()`, `fetchedPathWithVersion()` |
| Latent tsc errors in tests/ | **68 errors / 16 files** (tests are excluded from `npm run typecheck` — tsconfig `exclude: ["tests"]` — and no vitest typecheck exists). Per file: intent.test.ts 29, adt/client.test.ts 12, server/http-security-headers.test.ts 6, server/oauth-state.test.ts 4, adt/devtools.test.ts 3, 11 files ≤2. Classes: TS7006 implicit-any ×19, TS2739 FeatureStatus-literal ×13, TS2339 ×11, TS2749 ×6, TS7016 ×5, rest ≤4 |
| LLM-surface guarantee | `tests/fixtures/tool-definitions/*.json` (9 snapshots) — byte-identical through every commit (test-only PR ⇒ trivially, but keep in the gate) |

## Principles (carry over the proven playbook — AGENTS.md "Engineering Playbook")

1. Move-only: test blocks relocate **verbatim**; improvements ride as separate commits.
2. Full gate per step, commit small: `npm test` + count parity + `typecheck` + `typecheck:tests`
   (once it exists) + `lint` + A1 snapshot zero-diff + `check:sizes`.
3. Invariants by construction: budgets lowered in the same commit that shrinks a file; the
   dangling-BUDGETS guard forces key removal in the same commit that deletes a file.
4. Region-bounded codemods only; brace-matched block extraction must use a string/template-aware
   tokenizer (template literals contain `{}` — a naive matcher mis-spans; this bit us in Stage D).
5. Commit prefixes `test:` / `chore:` / `docs:` only — **no release** (release-please).

## Stage T — type-check the tests (do FIRST, it protects the whole split)

Rationale for ordering: fixing 29 errors inside one 15.5K-line file is easier than fixing them
scattered across 12 new files, and the new gate then guards every Stage C move.

- **T1. Lock the inventory.** Add `tsconfig.tests.json` (extends base; `include`: `src/**/*`,
  `tests/**/*`; **must override `exclude` to `["node_modules", "dist"]`** — exclude is inherited
  and silently re-filters `include`, which produced a false-clean run during planning). Run
  `tsc -p tsconfig.tests.json --noEmit`, snapshot the 68-error list into the PR description.
- **T2. Fix `intent.test.ts`'s 29 errors** — mostly mechanical:
  - TS2739/TS2741 (`{available:false}` missing `id`/`mode`): adopt `feat()`/`features()` from
    `tests/unit/handlers/handler-test-config.ts` (this IS the planned features-factory ride-along).
    Rewrite `setBtpMode()` (line ~8583) over `features({abapGit:false, …})` + explicit
    `abapRelease`/`systemType` — drop the hand-rolled 13-line literal.
  - TS7006 implicit-any: annotate callback params.
- **T3. Fix the other 15 files (39 errors)** — same classes; `adt/client.test.ts` (12) and the two
  `server/` files are the only ones needing real reading. Replace the 5 `as ResolvedFeatures` casts
  in `action-policy-integration.test.ts` and 5 `as any` feature objects in `tools.test.ts` with the
  factory (the other planned ride-along; kills TS-invisible drift when `FeatureStatus` changes).
  `tests/e2e/helpers.ts` leaks into the program via a unit-test import (2 errors) — fix, don't exclude.
- **T4. Wire the gate.** `npm run typecheck:tests` script; add to `.github/workflows/test.yml`
  next to `typecheck`; one line in AGENTS.md Build & Test. From here on the gate runs in every
  Stage C step.

## Stage C — split `intent.test.ts` (15,487 lines → per-module test files)

- **C0. Inventory the mega-describe with the tokenizer** (do not skip): list every depth-1
  statement inside `'Intent Handler'` that is NOT a `describe(` — especially **`beforeEach`/
  `afterEach` hooks, shared `let`s, and mid-file helpers** (e.g. `setBtpMode` is block-local at
  ~8583; there may be others). Every split file must replicate the hooks it depends on; a missed
  `beforeEach(resetAllMocks)` makes tests order-dependent and flaky. Output: a checklist mapping
  each depth-1 item → "goes to test-helpers" / "replicate per file" / "local to block N".
- **C1. Extract `tests/unit/handlers/test-helpers.ts`:** `createClient()`, `dataPreviewXml()`,
  `freestylePostCalls(mockFetch)` (takes the per-file mock as a param), `fetchedPathWithVersion()`,
  plus whatever C0 surfaces. **The `vi.mock('undici')` + `const mockFetch = vi.fn()` prologue
  CANNOT move to a helper** — `vi.mock` is hoisted per test module; each split file keeps its own
  ~8-line prologue + only the dynamic imports it actually uses. Commit; intent.test.ts shrinks a
  little; gate.
- **C2–C13. Move blocks verbatim, one target file per commit** (brace-matched extraction; Stage D
  recipe + tokenizer). Proposed mapping (68 blocks + 2 top-levels):

  | New file | Blocks | Est. size |
  |---|---|---|
  | `write-create.test.ts` | SAPWrite create/batch_create/buildCreateXml/BDEF content type/responsible wiring/CDS pre-write blocks | ~2.5K |
  | `write-update-delete.test.ts` | SAPWrite update/delete/include blocks | ~2K |
  | `write-surgery.test.ts` | edit_method/signature/add/delete/visibility/class-definition blocks | ~1.5K |
  | `write-rap.test.ts` | scaffold_rap_handlers/generate_behavior_implementation + FUNC/FUGR write blocks | ~1.5K |
  | `read.test.ts` | SAPRead ×5 + method-level + FUGR expansion + INACTIVE_OBJECTS + DDLS warning + FUNC auto-resolve | ~2K |
  | `dispatch-errors.test.ts` | error handling/guidance, formatErrorForLLM ×3, SAP domain hints, transport error hints, 5xx, unknown tool | ~1.5K |
  | `dispatch-scopes.test.ts` | scope enforcement, hasRequiredScope, TOOL_SCOPES | small |
  | `diagnose.test.ts` / `navigate.test.ts` / `search.test.ts` | their blocks (4/3/2) | ~1K each |
  | `activate.test.ts`, `query.test.ts`, `transport.test.ts`, `git.test.ts`, `context.test.ts`, `lint.test.ts`, `manage.test.ts` | one block each (merge tiny ones into a single `small-handlers.test.ts` if <200 lines each — executor's call, note it in the commit) | small |
  | `object-types-normalize.test.ts` | normalizeObjectType, type auto-mappings, + the 2 top-level describes (stripLlmEmptyValues, normalizeTypeArgsForValidation) | ~1K |
  | `btp-adaptation.test.ts` | BTP ABAP handler adaptation (uses setBtpMode → moves with it) | ~0.5K |
  | `hyperfocused-dispatch.test.ts` | hyperfocused mode block | small |
  | `cds-hints-warn.test.ts` + `write-helpers-misc.test.ts` | warnCdsReservedKeywords / stripFmParamCommentBlock | small |

  Naming may not collide with existing files (`tools.test.ts`, `schemas.test.ts`,
  `intent-rate-limit.test.ts` exist). Aim every file ≤3,000 lines (`DEFAULT_TEST` budget) — no new
  BUDGETS keys. Lower the `intent.test.ts` budget in each shrinking commit.
- **C14. Delete the empty `intent.test.ts`** + its BUDGETS key (same commit — the dangling-key
  guard fails CI otherwise, by design). Rename consideration: `intent-rate-limit.test.ts` may keep
  its name (it tests dispatch-level rate limiting; optionally rename `dispatch-rate-limit.test.ts`).
- **Count parity gate (every C-step):** full suite stays exactly **3,721**; after C14 the sum of
  tests across the new handler test files must be exactly **712**. Check via
  `npx vitest run tests/unit/handlers/ 2>&1 | grep Tests` before/after each move — a moved block
  that silently loses an `it()` (e.g. a dangling helper reference) must fail the step, not be
  discovered at the end.

## Stage R — small verified ride-alongs (separate commits, same PR)

- **R1.** `registry-sync.test.ts`: assert `Object.keys(SDO_REGISTRY) ⊆ SAPREAD_TYPE_TABLE ∧
  SAPWRITE_TYPE_TABLE` types (~5 lines). Closes the verified gap where a 7th SDO type wired in
  `server-driven.ts` but missing a table row ships silently unexposed to LLMs.
- **R2.** `docs/dev-guide.md` allowedPackages row: drop "SRVB publish/unpublish is intentionally
  NOT gated… tracked as a follow-up" — **#403 closed it** (activate.ts now gates publish/unpublish
  via `enforceAllowedPackageForObjectUrl` + `SERVICEBINDING_V2_ACCEPT`). One-line docs fix.
- **R3 (optional).** Retire the `SAPWRITE_CLAS_INCLUDES` alias: rename the 5 schema-layer usages to
  `CLASS_WRITE_INCLUDES` imported from `object-types.js`, delete the re-export. Constant name is
  not LLM-visible — REQUIRE byte-identical tool-definition fixtures as the proof. Skip if any
  fixture diff appears.

## Explicitly deferred (decided, with rationale — do NOT ride along)

- AGENTS.md ↔ dev-guide.md row-sync CI guard: real drift risk but needs anchor design; revisit
  after the docs settle for a release or two.
- `btp: boolean` → richer availability encoding (`minRelease`, …): rows-as-objects extends
  mechanically when a third dimension is actually needed; speculative today.
- Splitting `tests/unit/handlers/tools.test.ts` / widening typecheck to integration+e2e configs:
  only if T1's inventory shows them cheap; integration tests import live-credential helpers and
  may need their own tsconfig story.

## Verification & PR

- Every commit: `npm test` (3,721) + count parity + `npm run typecheck` + `npm run typecheck:tests`
  + `npm run lint` + A1 snapshots byte-identical + `npm run check:sizes`.
- One PR; commits `test:`/`chore:`/`docs:` only (R3, if taken, is `refactor:` — still no release).
- PR description: link this plan; paste the T1 error inventory and the C-mapping table with final
  per-file test counts (must sum to 712).

## Known hazards (from the #402 execution — do not relearn these)

- `vi.mock` hoisting is per-module: the mock prologue must be duplicated into every split file;
  putting it in test-helpers silently stops intercepting (`tests pass` against the real fetch? no —
  they'd hang/fail; either way: per-file prologue).
- Unused-import cleanup after block moves: import-region-bounded cleaner ONLY (a bare `name,`-line
  stripper corrupted call bodies once; see AGENTS.md Playbook §6).
- zsh eats backticks in `git commit -m` — use `git commit -F` with a file/heredoc.
- Bash tool cwd persists across calls — absolute paths or re-`cd` per command.
- `vitest -u` is forbidden unless a fixture change is the intended, reviewed outcome.
