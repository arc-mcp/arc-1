# PR-F ED064 Retry And 7.58 Lint Release Override

## Overview

This plan implements PR-F from the RAP migration/vibe-coding follow-up: make `SAPActivate(action="batch_activate")` recover from the S/4HANA 2023 batch activation quirk where SAP reports ED064 "no next/previous object found", and let administrators pin the ABAP release used by ARC-1's local abaplint configuration when system probing is unavailable or incomplete.

The activation change is intentionally narrow. It does not add a new ADT endpoint; it keeps the existing `/sap/bc/adt/activation?method=activate` flow and retries each object once through the existing single-object `activate()` path only when the batch failure is purely the ED064 quirk. Mixed real compiler/activation errors remain failures.

The lint change is also narrow. ARC-1 already maps SAP_BASIS release `758` to abaplint `Version.v758`; the missing feature is a stable config source. Add `SAP_ABAP_RELEASE` / `--abap-release` so S/4HANA 2023 systems can use 7.58 syntax even before `SAPManage probe` has populated `cachedFeatures.abapRelease`.

## Context

### Current State

- `src/adt/devtools.ts` has `activate()` and `activateBatch()` with a two-step preaudit handshake, but `activateBatch()` returns a terminal failure for every error outcome. It does not recognize ED064 as a recoverable batch-only quirk.
- `RUN-NOTES.md` from the SEGW-to-RAP migration captured ED064 recurring on ABAP 7.58 during table batch activation. The LLM recovered by activating the affected table individually; this should be ARC-1 behavior.
- Eclipse ADT evidence in `/Users/marianzeis/DEV/arc-1-eclipse-adt/api/06-activation-checkruns-inactive-objects.md` confirms the activation endpoint and object-reference payload ARC-1 already uses.
- `src/adt/features.ts` already maps SAP_BASIS `758` and greater to abaplint `Version.v758`.
- `src/lint/config-builder.ts` falls back to `Version.v702` for on-prem systems when no `abapRelease` is available.
- `src/handlers/intent.ts` builds lint config from `cachedFeatures?.abapRelease` only; `ServerConfig` has no manual ABAP release override.
- Live read-only ADT checks during research confirmed A4H reports SAP_BASIS `758` and NPL reports SAP_BASIS `750`.

### Target State

- Batch activation with only ED064/no-next-previous-object failures automatically retries each requested object once via single-object activation and returns success if every retry succeeds.
- Batch activation with ED064 plus any real error does not retry and preserves the original failure details.
- The retry result is transparent but visible in messages/details so users can see ARC-1 recovered from a SAP batch activation quirk.
- `SAP_ABAP_RELEASE` and `--abap-release` are parsed into `ServerConfig.abapRelease`.
- Lint config resolution uses `cachedFeatures?.abapRelease ?? config.abapRelease`, preserving probe data as the most accurate source.
- `SAPLint(action="list_rules")`, on-demand lint, and pre-write lint all use the same effective release.
- Documentation and assistant guidance list the new config option.

### Key Files

| File | Role |
|------|------|
| `src/adt/devtools.ts` | Activation endpoint wrappers, preaudit handshake, activation message parsing, ED064 retry helper |
| `tests/unit/adt/devtools.test.ts` | Unit coverage for activation batch behavior and retry guardrails |
| `src/server/types.ts` | `ServerConfig` and `DEFAULT_CONFIG`; add optional `abapRelease` |
| `src/server/config.ts` | CLI/env parser; add `SAP_ABAP_RELEASE` / `--abap-release` |
| `tests/unit/server/config.test.ts` | Config parser tests for env/CLI/default/precedence |
| `src/handlers/intent.ts` | `SAPLint` config option builder and pre-write lint config builder |
| `tests/unit/handlers/intent.test.ts` | `SAPLint list_rules` and handler-level release override tests |
| `src/lint/config-builder.ts` | Existing version resolver; add direct `758` regression tests if needed |
| `tests/unit/lint/config-builder.test.ts` | abaplint version mapping tests for on-prem 7.58 and pre-write config |
| `.env.example` | Document environment variable |
| `CLAUDE.md` and `AGENTS.md` | Config table and assistant guidance |
| `README.md` | User-facing feature summary if useful |

### Design Principles

1. Keep ED064 matching conservative: retry only when every error detail/message is the known quirk, never on mixed real errors.
2. Retry at most once and through existing `activate()` so all safety checks, preaudit handling, and lock hints remain centralized.
3. Preserve user-visible diagnostics: append a recovery note and include retry failure details if the fallback does not fully succeed.
4. Prefer system-probed release over manual config; manual config is only a fallback for startup/no-probe/offline paths.
5. Do not invent a new lint preset. Use the existing SAP_BASIS-to-abaplint mapper and add a stable config source.
6. Do not broaden PR-F into RAP preflight, quickfix, behavior-pool generation, or class include routing.

## Development Approach

Implement activation recovery first because it is isolated to `devtools.ts` and its tests. Then add the config type/parser and thread it into the lint configuration builder call sites in `intent.ts`. Finally update docs and run focused tests before full quality checks.

No live mutating SAP test is required for ED064 because deliberately triggering activation against the shared systems is risky. The live research for this PR is read-only: A4H SAP_BASIS `758`, NPL SAP_BASIS `750`, and Eclipse ADT activation endpoint evidence.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add ED064 batch activation retry

**Files:**
- Modify: `src/adt/devtools.ts`
- Modify: `tests/unit/adt/devtools.test.ts`

The migration run notes captured ED064 "no next/previous object found" as a recurring S/4HANA 2023 batch activation quirk where single-object activation succeeds. Add a guarded fallback inside `activateBatch()` that retries each requested object once only when the batch result contains no real errors besides ED064.

- [x] In `src/adt/devtools.ts`, add a helper such as `isRecoverableEd064BatchQuirk(result: ActivationResult): boolean` near the activation helpers. It should return true only when `result.success === false`, there is at least one error detail/message, and every error text matches ED064 or the known "no next/previous object found" wording.
- [x] Add a helper such as `retryBatchActivationIndividuallyAfterEd064(http, safety, objects, originalResult, options)` that calls existing `activate(http, safety, object.url, { name: object.name, preaudit: options?.preaudit })` once per original object.
- [x] In `activateBatch()`, after converting the first non-preaudit outcome to an `ActivationResult`, call the retry helper only for the recoverable ED064 case.
- [x] In the preaudit confirmation path for batch activation, apply the same ED064 retry guard to the confirmed result if phase 2 returns a pure ED064 failure.
- [x] Preserve original error details if any single-object retry fails, and append retry details/messages so the user can see what happened.
- [x] Add unit tests: pure ED064 batch error triggers individual retries and succeeds when all retries succeed; mixed ED064 plus real activation error does not retry; retry failure returns failure with original ED064 plus retry details; `preaudit: false` is propagated to individual retries.
- [x] Run `npm test -- tests/unit/adt/devtools.test.ts` — all activation tests pass.

### Task 2: Add ABAP release config parsing

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/config.ts`
- Modify: `tests/unit/server/config.test.ts`

ARC-1 can detect SAP_BASIS from `/sap/bc/adt/system/components`, but local linting can run before probe data exists. Add an explicit release override so admins can pin `758` for S/4HANA 2023 or `750` for old NetWeaver when needed.

- [x] Add optional `abapRelease?: string` to `ServerConfig` in `src/server/types.ts` under the System Type / Lint area.
- [x] Leave `DEFAULT_CONFIG.abapRelease` undefined so current behavior remains unchanged without configuration.
- [x] In `src/server/config.ts`, parse `SAP_ABAP_RELEASE` / `--abap-release` using `resolveOptionalStr` near `SAP_SYSTEM_TYPE` or the lint config block.
- [x] Record the config source under `sources.abapRelease`.
- [x] Add config parser tests: default undefined; env var parses; CLI flag parses; CLI flag wins over env; values are treated as strings so `7.58`, `758`, and future labels pass through to the existing mapper.
- [x] Run `npm test -- tests/unit/server/config.test.ts` — config tests pass.

### Task 3: Thread the release override into SAPLint

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`
- Modify: `tests/unit/lint/config-builder.test.ts`

The existing `buildLintConfigOptions()` and `runPreWriteLint()` read `cachedFeatures?.abapRelease` only. Change both paths so probe data remains authoritative, while `config.abapRelease` supplies the startup/no-probe fallback.

- [x] In `buildLintConfigOptions(config, ruleOverrides)`, set `abapRelease` to `cachedFeatures?.abapRelease ?? config.abapRelease`.
- [x] In `runPreWriteLint()`, use the same release expression when building `LintConfigOptions`.
- [x] In `SAPLint action="list_rules"`, report the effective release as `cachedFeatures?.abapRelease ?? config.abapRelease ?? 'unknown'` and include the selected syntax version if straightforward to expose from the built config.
- [x] Add handler tests: `SAPLint list_rules` with `{ systemType: 'onprem', abapRelease: '758' }` and no cached features reports release `758` and uses syntax `v758`; cached feature release overrides config release; pre-write lint uses the config release when cached features are absent.
- [x] Add config-builder regression tests for `buildLintConfig({ systemType: 'onprem', abapRelease: '758' })` and `buildPreWriteConfig({ systemType: 'onprem', abapRelease: '758' })`.
- [x] Run `npm test -- tests/unit/handlers/intent.test.ts tests/unit/lint/config-builder.test.ts` — focused lint tests pass.

### Task 4: Update docs and assistant guidance

**Files:**
- Modify: `.env.example`
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`
- Modify: `README.md` if the user-facing summary benefits from mentioning release-pinned linting
- Modify: `docs/compare/00-feature-matrix.md` only if wording for batch activation or abaplint status needs a small clarification

Document the new configuration option and the ED064 recovery behavior where users and future coding agents will look first.

- [x] Add `SAP_ABAP_RELEASE=758` example/comment to `.env.example` near `SAP_SYSTEM_TYPE` or lint configuration.
- [x] Add `SAP_ABAP_RELEASE` / `--abap-release` to the configuration tables in `CLAUDE.md` and `AGENTS.md`.
- [x] Add a concise note in `CLAUDE.md` key patterns or SAP version-quirk guidance that pure ED064 batch activation failures are auto-retried individually.
- [x] Update README only if the existing SAPLint/SAPActivate bullets need a short mention without bloating the front page.
- [x] Do not add docs for unrelated RAP behavior-pool, quickfix, or class include fixes in this PR.
- [x] Run `npm run lint` — documentation changes do not trigger formatting/lint errors.

### Task 5: Final verification and plan completion

**Files:**
- Move: `docs/plans/completed/2026-05-10-pr-f-ed064-retry-758-lint-preset.md` to `docs/plans/completed/2026-05-10-pr-f-ed064-retry-758-lint-preset.md`

- [x] Run focused tests: `npm test -- tests/unit/adt/devtools.test.ts tests/unit/server/config.test.ts tests/unit/handlers/intent.test.ts tests/unit/lint/config-builder.test.ts` — all pass.
- [x] Run full unit suite: `npm test` — all tests pass.
- [x] Run typecheck: `npm run typecheck` — no errors.
- [x] Run lint: `npm run lint` — no errors.
- [x] Review `git diff` for scope creep, secret leakage, unrelated file churn, and accidental changes outside PR-F.
- [x] Move this plan to `docs/plans/completed/`.
