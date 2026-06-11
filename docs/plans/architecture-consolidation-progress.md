# Architecture Consolidation — PR 1 Progress / PR Description Draft

Tracks execution of [architecture-consolidation-plan.md](architecture-consolidation-plan.md) (v2).
Single PR, staged commits, no behavior change. Update as stages land.

## Baselines (recorded against the pre-refactor monolith, 2026-06-11)

| Metric | Baseline |
|---|---|
| Unit suite (pre-Stage-A) | 105 files / 3,583 tests, green, ~14 s |
| Unit suite (post-Stage-A) | 109 files / 3,672 tests, green |
| `src/handlers/` coverage | lines **84.58%**, stmts 82.62%, funcs 90.29%, branches 73.96% (6 files) |
| `intent.ts` coverage | lines 83.59%, funcs 89.28%, branches 72.56% |
| `intent.ts` size | 8,199 lines |
| `intent.test.ts` size | 15,135 lines |

The **headline guarantee**: `tests/fixtures/tool-definitions/*.json` (9 snapshots) freeze the exact
JSON the LLM sees. They must be zero-diff from the first Stage-A commit to the final commit. ✅ so far.

## Stage status

- [x] **A1** snapshot LLM-visible tool surface — `tool-definitions-snapshot.test.ts`, 9 fixtures. Biome excluded from `tests/fixtures/tool-definitions/`.
- [x] **A2** barrel-surface lock — `barrel-surface.test.ts` (20 runtime exports + `ToolResult`).
- [x] **A3** single-source type lists — `tool-registry.ts`; `tools.ts`/`schemas.ts`/`validate-action-policy.ts` consume it. A1 zero-diff confirmed.
- [x] **A4** registry drift + SAPRead dispatch coverage — `registry-sync.test.ts` (53 tests).
- [x] **A5** Zod↔JSON-Schema key parity — `schema-key-sync.test.ts` (24 tests, empty mismatch allowlist).
- [x] **A6** coverage/count baseline recorded (this file).
- [x] **A7** file-size ratchet — `scripts/ci/check-file-sizes.mjs`, wired into `test.yml` (+ `validate:policy`, previously not run in CI).
- [~] **A8** regenerate SAPRead default-case error from registry — **DEFERRED**. The current message deliberately omits the 6 server-driven types and curates alias notes; regenerating from the full registry would change user-visible error text (a behavior change this PR forbids). A4's dispatch-coverage test already removes the drift risk A8 targeted.
- [x] **B** split `intent.ts` (move-only) → **DONE**. `intent.ts` is now a **38-line back-compat barrel**. Created: 6 leaf modules (`object-types` 508, `feature-cache` 53, `shared` 34, `cds-hints` 459, `write-helpers` 996, `tool-registry` 185), 12 handler modules (`read` 690, `write` 1961, `search` 239, `query` 216, `lint` 100, `activate` 397, `navigate` 230, `diagnose` 333, `git` 278, `transport` 329, `context` 434, `manage` 443), and `dispatch.ts` (765, handleToolCall + error tree + scope). Every step was move-only with typecheck + full suite + A1 zero-diff + commit. Cross-cutting helpers relocated to leaf modules along the way (isBtpSystem/isTablesEndpointAvailable→feature-cache; inactiveSyntaxDiagnostic/tryPostSaveSyntaxCheck→write-helpers; hasSqlParserSignature→shared). Handler→handler deps are acyclic (write→read for resolveVersionAndDraftInfo, write→activate for batch helpers). 25 commits, all green.
- [ ] **C** split `intent.test.ts` (15,135 lines) — **deferred follow-up**. The per-tool `describe` blocks are scattered/interleaved throughout the file (SAPRead/SAPWrite tests recur ~10× each, not contiguous), so a clean per-tool split is a high-effort scatter-gather. The file passes and is under its ratchet budget (15,300). Recommended approach when resumed: extract `tests/unit/handlers/test-helpers.ts` (the `createClient`/`mockFetch` scaffolding) first, then relocate blocks tool-by-tool with a test-count-parity assertion (≥ 3,672).
- [ ] **D** split `write.ts` (1,961 lines) into `write/{index,create,update-delete,class-surgery,rap,server-driven}.ts` — **deferred follow-up**. handleSAPWrite's 12 `switch(action)` case bodies are tightly coupled to a shared prologue: computed `objectUrl`/`srcUrl` and three closures (`invalidateWrittenObject`, `enforcePackageForExistingObject`, `fetchClassStructureAndMain`). Clean extraction needs a `SapWriteContext` threading those (incl. closures) — the plan's "strictest protocol" stage, in the write path. Budgeted at 2,050 in the ratchet until done. Do this under the deferred executing-LLM rules, one case at a time, with a verbatim-body + full-destructure approach.
- [ ] **E** migrate consumers off the barrel — **deferred follow-up**. `intent.ts` is a 38-line `@deprecated` barrel; migrating `src/cli.ts`, `src/server/server.ts`, and the test imports to the specific `handlers/*` modules, then deleting the barrel, is low-risk cleanup for a later PR.
- [x] **F** verification gate — green at the Stage A+B checkpoint: `npm test` (109 files / 3,672 tests), typecheck, lint, validate:policy, build, check:sizes all pass; A1 snapshots byte-identical.

## Commits so far

| Commit | Stage | Summary |
|---|---|---|
| `ce252f1e` | A1 | snapshot LLM-visible tool surface + Biome exclude |
| `7328ba07` | A2/A3 | single-source `tool-registry.ts` + barrel-surface lock |
| `10dc2b67` | A4/A5/A7 | registry drift guards + file-size ratchet |
| `92f4639f` | A6 | progress tracker + baselines |
| `70baf97f` | B | extract object-types.ts |
| `d4a140ce` | B | extract feature-cache.ts (live bindings) |
| `2a692be6` | B | extract shared.ts (ToolResult + result ctors) |
| (multiple) | B | extract cds-hints, write-helpers, + relocate shared helpers |
| (multiple) | B | extract 12 handler modules (manage…write) |
| (final) | B | extract dispatch.ts; intent.ts → 38-line barrel |

**Stage B end state:** intent.ts 8,199 → 38 lines (barrel). Largest handler file: write.ts 1,961 (Stage D target). All gates green; A1 byte-identical from first commit to here.

## Verification run each stage

`npm test` · `npm run typecheck` · `npm run lint` · `npm run validate:policy` · `npm run build` ·
`node scripts/ci/check-file-sizes.mjs` · A1 snapshots zero-diff.
