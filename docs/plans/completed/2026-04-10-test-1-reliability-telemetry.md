# Test Reliability Telemetry Foundation

## Overview

This plan creates CI-visible reliability telemetry that reports executed/passed/skipped test counts and skip reasons per suite. The goal is to make test health visible in every CI run so that "green" pipelines carry real evidence of what was exercised. The telemetry is non-blocking initially (warning-only mode) but provides the data foundation for future enforcement gates.

Currently, CI produces no machine-readable test result artifacts for integration tests, and the E2E JUnit XML is uploaded but never parsed into a human-readable summary. This plan adds JSON reporters to all test levels, creates scripts to parse and summarize results, and wires everything into GitHub Actions step summaries and artifacts.

## Context

### Current State

- Unit tests (`vitest.config.ts`) use only the default console reporter. No coverage config, no JSON output.
- Integration tests (`vitest.integration.config.ts`) use only the default console reporter. No JSON/JUnit output.
- E2E tests (`tests/e2e/vitest.e2e.config.ts`) already produce JUnit XML to `/tmp/arc1-e2e-logs/junit-results.xml` (lines 16-26) and upload it as an artifact.
- The E2E JUnit artifact is never parsed or summarized in GitHub step summary.
- `.github/workflows/test.yml` uploads E2E logs (lines 127-133) but no integration artifacts.
- There is no script to aggregate executed/skipped/failed counts across suites.
- `scripts/ci/` directory does not exist.

### Target State

- All three test levels (unit, integration, E2E) produce JSON result artifacts.
- A `collect-test-reliability.mjs` script parses all artifacts and publishes a Markdown summary to `GITHUB_STEP_SUMMARY`.
- An `assert-required-test-execution.mjs` script checks minimum executed tests per profile (warning-only initially).
- npm scripts exist for local reproducibility of the CI parsing logic.
- Unit tests cover the parser and threshold logic deterministically.

### Key Files

| File | Role |
|------|------|
| `.github/workflows/test.yml` | Main CI orchestration — needs artifact upload and summary steps |
| `vitest.config.ts` | Unit test config — needs JSON reporter addition |
| `vitest.integration.config.ts` | Integration test config — needs JSON reporter addition |
| `tests/e2e/vitest.e2e.config.ts` | E2E test config — already has JUnit, needs JSON addition |
| `package.json` | npm scripts — needs reliability report scripts |
| `scripts/ci/collect-test-reliability.mjs` | New: parses JSON artifacts into Markdown summary |
| `scripts/ci/assert-required-test-execution.mjs` | New: checks minimum executed test thresholds |

### Design Principles

1. Non-blocking first: telemetry is informational. No builds fail due to telemetry script errors initially.
2. Local reproducibility: every CI step can be run locally via npm scripts.
3. Machine-readable artifacts: JSON output enables future tooling (trend dashboards, PR comments).
4. Minimal config changes: add reporters alongside existing ones, don't replace.

## Development Approach

Start by adding JSON reporters to all vitest configs, then create the parsing/assertion scripts with unit tests, then wire into CI workflows. Test the scripts against synthetic fixture data so unit tests are deterministic and don't require a real test run.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add JSON Reporters to All Vitest Configs

**Files:**
- Modify: `vitest.config.ts`
- Modify: `vitest.integration.config.ts`
- Modify: `tests/e2e/vitest.e2e.config.ts`

Add Vitest JSON reporter to all three test configs so each level produces machine-readable output alongside the existing console output.

- [x] In `vitest.config.ts`, add `reporters` array with `['default', ['json', { outputFile: 'test-results/unit.json' }]]` and set `outputFile` for the JSON reporter. Keep the existing `include`, `exclude`, `testTimeout`, and `isolate` settings unchanged.
- [x] In `vitest.integration.config.ts`, add `reporters` array with `['default', ['json', { outputFile: 'test-results/integration.json' }]]`. Keep the existing `include`, `testTimeout`, and `sequence` settings unchanged.
- [x] In `tests/e2e/vitest.e2e.config.ts`, add JSON reporter alongside the existing JUnit reporter: add `['json', { outputFile: process.env.E2E_LOG_DIR ? '${process.env.E2E_LOG_DIR}/e2e.json' : 'test-results/e2e.json' }]` to the existing `reporters` array (lines 16-26).
- [x] Add `test-results/` to `.gitignore` so generated JSON files are not committed.
- [x] Run `npm test` locally and verify `test-results/unit.json` is created with valid JSON containing `testResults` array.
- [x] Run `npm test` — all tests must pass.

### Task 2: Create Reliability Collection Script

**Files:**
- Create: `scripts/ci/collect-test-reliability.mjs`
- Modify: `package.json`

Create a Node.js script that reads Vitest JSON result files and produces a Markdown summary table with executed/passed/skipped/failed counts and top skip reasons.

- [x] Create `scripts/ci/` directory structure.
- [x] Implement `scripts/ci/collect-test-reliability.mjs` with the following behavior:
  - Accept `--results-dir` argument (default: `test-results/`).
  - For each JSON file found (`unit.json`, `integration.json`, `e2e.json`), parse and extract: total tests, passed, failed, skipped, and skip reasons (from `testResults[].assertionResults[].status === 'skipped'`).
  - Generate a Markdown table: `| Suite | Total | Passed | Failed | Skipped | Skip % |`.
  - Generate a "Top Skip Reasons" section listing unique skip reason texts and their counts.
  - If `GITHUB_STEP_SUMMARY` env var is set, append the Markdown to that file.
  - Also print the summary to stdout for local use.
  - Exit 0 always (informational only).
  - Handle missing files gracefully (report "no results found" for that suite).
- [x] Add npm script `"test:reliability-report": "node scripts/ci/collect-test-reliability.mjs"` to `package.json`.
- [x] Run `npm test` — all tests must pass.

### Task 3: Create Required Execution Assertion Script

**Files:**
- Create: `scripts/ci/assert-required-test-execution.mjs`
- Modify: `package.json`

Create a script that checks whether minimum test execution thresholds are met, with configurable profiles and a warning-only default mode.

- [x] Implement `scripts/ci/assert-required-test-execution.mjs` with the following behavior:
  - Accept `--results-dir` (default: `test-results/`), `--mode` (`warn` or `enforce`, default: `warn`), and `--config` (inline JSON or file path for thresholds).
  - Default thresholds: `{ "unit": { "minExecuted": 1000 }, "integration": { "minExecuted": 10 }, "e2e": { "minExecuted": 5 } }`.
  - For each suite, check if `passed + failed >= minExecuted`. If below threshold: in `warn` mode, print warning to stderr and exit 0; in `enforce` mode, exit 1.
  - Report which suites passed/failed threshold checks.
  - Handle missing result files as threshold failure (0 executed).
- [x] Add npm script `"test:assert-execution": "node scripts/ci/assert-required-test-execution.mjs"` to `package.json`.
- [x] Run `npm test` — all tests must pass.

### Task 4: Add Unit Tests for Telemetry Scripts

**Files:**
- Create: `tests/unit/scripts/collect-test-reliability.test.ts`
- Create: `tests/unit/scripts/assert-required-test-execution.test.ts`
- Create: `tests/fixtures/test-results/` (fixture JSON files)

Add deterministic unit tests for both scripts using synthetic Vitest JSON result fixtures.

- [x] Create fixture files in `tests/fixtures/test-results/`:
  - `unit-healthy.json` — 100 passed, 0 failed, 0 skipped.
  - `integration-mixed.json` — 80 passed, 2 failed, 40 skipped with reason texts.
  - `e2e-all-skipped.json` — 0 passed, 0 failed, 20 skipped.
  - `malformed.json` — invalid JSON for error handling tests.
  - Fixtures should follow the Vitest JSON reporter output format: `{ testResults: [{ assertionResults: [{ status, title, failureMessages }] }] }`.
- [x] Test `collect-test-reliability.mjs` (~8 tests):
  - Parses healthy unit results correctly (counts match).
  - Parses mixed integration results with skip reasons.
  - Handles all-skipped suite.
  - Handles missing result file gracefully.
  - Handles malformed JSON gracefully.
  - Generates valid Markdown table format.
  - Generates skip reason summary with correct counts.
  - Writes to GITHUB_STEP_SUMMARY file when env var is set (use temp file).
- [x] Test `assert-required-test-execution.mjs` (~8 tests):
  - Passes when all suites meet thresholds.
  - Warns when suite is below threshold in warn mode (exit 0).
  - Fails when suite is below threshold in enforce mode (exit 1).
  - Handles missing result file as 0 executed.
  - Accepts custom threshold config.
  - Reports per-suite pass/fail status.
  - Handles all-skipped suite correctly (0 executed).
  - Default thresholds are applied when no config given.
- [x] Since scripts are `.mjs`, tests may need to import them or spawn them as child processes. Choose the approach that best fits vitest patterns (e.g., extract core logic into importable functions, or test via `execFileSync`).
- [x] Run `npm test` — all tests must pass (16+ new tests).

### Task 5: Wire Telemetry into CI Workflows

**Files:**
- Modify: `.github/workflows/test.yml`

Add artifact upload steps for all test result JSON files and add a reliability summary step.

- [x] In the `test` job (unit tests, lines 10-35), after the `npm test` step, add:
  - Upload artifact step: `actions/upload-artifact@v4` with name `test-results-unit-${{ matrix.node-version }}`, path `test-results/unit.json`, retention 7 days, `if: always()`.
- [x] In the `integration` job (lines 39-65), after the `npm run test:integration` step, add:
  - Upload artifact step: `actions/upload-artifact@v4` with name `test-results-integration`, path `test-results/integration.json`, retention 7 days, `if: always()`.
  - Reliability summary step: run `node scripts/ci/collect-test-reliability.mjs --results-dir test-results/` with `if: always()` and `continue-on-error: true`.
- [x] In the `e2e` job (lines 69-133), after the existing test step but before artifact uploads, add:
  - Copy `test-results/e2e.json` to the E2E log dir if it exists.
  - Add `test-results/e2e.json` to the existing artifact upload paths.
  - Add reliability summary step similar to integration.
- [x] Add a final summary job that depends on all other jobs, downloads all `test-results-*` artifacts, runs `collect-test-reliability.mjs` on the combined results, and runs `assert-required-test-execution.mjs` in warn mode. Use `if: always()` so it runs even if test jobs fail.
- [x] Run `npm test` — all tests must pass.

### Task 6: Final Verification

- [x] Run full unit suite: `npm test` — all tests pass (including 16+ new telemetry tests).
- [x] Run typecheck: `npm run typecheck` — no errors.
- [x] Run lint: `npm run lint` — no errors.
- [x] Verify `test-results/unit.json` is created after `npm test` and contains valid JSON with test counts.
- [x] Verify `test-results/` is in `.gitignore`.
- [x] Verify `npm run test:reliability-report` runs without error (may show "no results" for integration/e2e if not configured locally — that's expected).
- [x] Move this plan to `docs/plans/completed/` once all tasks are done.
