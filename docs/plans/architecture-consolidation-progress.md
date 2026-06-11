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
- [~] **B** split `intent.ts` (move-only) → dispatch + 12 handlers + 6 helper modules + ≤60-line barrel. **IN PROGRESS** — leaf modules extracted so far: `object-types.ts` (508), `feature-cache.ts` (live-binding state), `shared.ts` (ToolResult + textResult/errorResult). intent.ts 8,199 → 7,707. Remaining: `cds-hints.ts` (bulk contiguous ~728–1010 + constants + guardCdsSyntax/warnCdsReservedKeywords cluster), `write-helpers.ts`, then the 12 handler modules + `dispatch.ts`, then reduce intent.ts to the barrel. Error-formatting tree (`formatErrorForLLM` + helpers) is dispatch-only (1 call site) so it stays with dispatch, not shared.ts.
- [ ] **C** split `intent.test.ts` along the same seams (count parity ≥ baseline).
- [ ] **D** split `handleSAPWrite` (1,827 lines) into `write/{index,create,update-delete,class-surgery,rap,server-driven}.ts`.
- [ ] **E** migrate consumers off the barrel (keep ≤60-line `@deprecated` shim one release).
- [ ] **F** final verification gate.

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

## Verification run each stage

`npm test` · `npm run typecheck` · `npm run lint` · `npm run validate:policy` · `npm run build` ·
`node scripts/ci/check-file-sizes.mjs` · A1 snapshots zero-diff.
