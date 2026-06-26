# Coverage as Informational CI Signal

## Overview

This plan enables code coverage reporting as non-blocking telemetry in both the test and release CI workflows. Currently, `npm run test:coverage` fails because `@vitest/coverage-v8` is not installed, and no workflow collects or publishes coverage data. After this plan, coverage runs alongside unit tests, produces reports (`text-summary`, `json-summary`, `lcov`), and publishes a concise summary to GitHub step summaries — all without blocking builds.

## Context

### Current State

- `package.json` line ~34 defines `"test:coverage": "vitest run --coverage"` but running it fails: `MISSING DEPENDENCY Cannot find dependency '@vitest/coverage-v8'`.
- `vitest.config.ts` has no `coverage` configuration block — no provider, reporters, or thresholds.
- `.github/workflows/test.yml` does not run coverage or publish coverage artifacts.
- `.github/workflows/release.yml` runs `npm test` before publish (line 50) but has no coverage step.
- In all audited CI runs (24197428731, 24212490295, 24213793920), no coverage artifact or summary was produced.

### Target State

- `@vitest/coverage-v8` is installed as a dev dependency.
- `vitest.config.ts` configures coverage with `v8` provider, `text-summary` + `json-summary` + `lcov` reporters, and no thresholds.
- CI test workflow runs coverage after unit tests and publishes `coverage/` as an artifact with a summary in the job step summary.
- Release workflow mirrors the informational coverage step.
- A `scripts/ci/coverage-summary.mjs` script parses `coverage-summary.json` and produces a Markdown summary.
- Coverage step uses `continue-on-error: true` — explicitly non-blocking.

### Key Files

| File | Role |
|------|------|
| `package.json` | Dev dependency and scripts |
| `vitest.config.ts` | Unit test config — needs coverage block |
| `.github/workflows/test.yml` | CI workflow — needs coverage step |
| `.github/workflows/release.yml` | Release workflow — needs coverage step |
| `scripts/ci/coverage-summary.mjs` | New: parses coverage JSON into Markdown |

### Design Principles

1. Informational only: coverage never blocks a build. `continue-on-error: true` on all coverage steps.
2. Multiple formats: `text-summary` for console/CI, `json-summary` for scripts, `lcov` for future integration with coverage services.
3. No thresholds initially: collect baseline data before defining targets.
4. Rollout-safe: if coverage provider fails, test results are unaffected.

## Development Approach

Install the dependency first, configure vitest, create the summary script with unit tests, then wire into workflows. Keep coverage concerns isolated from test execution — coverage runs as a separate step that cannot affect test pass/fail.

## Validation Commands

- `npm test`
- `npm run test:coverage`
- `npm run typecheck`
- `npm run lint`

### Task 1: Install Coverage Provider and Configure Vitest

**Files:**
- Modify: `package.json`
- Modify: `vitest.config.ts`

Install `@vitest/coverage-v8` and add coverage configuration to the unit test vitest config.

- [x] Run `npm install --save-dev @vitest/coverage-v8` to add the coverage provider as a dev dependency.
- [x] In `vitest.config.ts`, add a `coverage` block inside the `test` property:
  ```typescript
  coverage: {
    provider: 'v8',
    reporter: ['text-summary', 'json-summary', 'lcov'],
    reportsDirectory: 'coverage',
    // No thresholds — informational only for now
  },
  ```
  Keep all existing settings (`include`, `exclude`, `testTimeout`, `isolate`) unchanged.
- [x] Add `coverage/` to `.gitignore` if not already present.
- [x] Run `npm run test:coverage` — verify it completes and produces `coverage/coverage-summary.json` and `coverage/lcov.info`.
- [x] Run `npm test` — all tests must pass (coverage config should not affect regular test runs).

### Task 2: Create Coverage Summary Script

**Files:**
- Create: `scripts/ci/coverage-summary.mjs`
- Modify: `package.json`
- Create: `tests/unit/scripts/coverage-summary.test.ts`
- Create: `tests/fixtures/coverage/` (fixture files)

Create a script that reads `coverage-summary.json` and outputs a concise Markdown summary suitable for GitHub step summaries.

- [x] Implement `scripts/ci/coverage-summary.mjs`:
  - Accept `--coverage-dir` argument (default: `coverage/`).
  - Read `coverage-summary.json` from the coverage directory.
  - Extract `total` metrics: `lines`, `statements`, `functions`, `branches` — each with `pct` (percentage) and `total`/`covered` counts.
  - Generate a Markdown table: `| Metric | Coverage | Covered/Total |` with rows for lines, statements, functions, branches.
  - If `GITHUB_STEP_SUMMARY` is set, append the table.
  - Print to stdout for local use.
  - Exit 0 always. Handle missing file with "No coverage data found" message.
- [x] Add npm script `"test:coverage-report": "node scripts/ci/coverage-summary.mjs"` to `package.json`.
- [x] Create fixture files in `tests/fixtures/coverage/`:
  - `coverage-summary-healthy.json` — realistic coverage data with 80%+ across all metrics.
  - `coverage-summary-low.json` — low coverage (<30%) for visual comparison.
  - `coverage-summary-partial.json` — missing some metric fields.
- [x] Add unit tests (~6 tests) in `tests/unit/scripts/coverage-summary.test.ts`:
  - Parses healthy coverage correctly (percentages and counts match).
  - Parses low coverage correctly.
  - Handles missing coverage file gracefully.
  - Handles malformed JSON gracefully.
  - Handles partial coverage data (missing metrics).
  - Generates valid Markdown table format.
- [x] Run `npm test` — all tests must pass.

### Task 3: Wire Coverage into CI Test Workflow

**Files:**
- Modify: `.github/workflows/test.yml`

Add a coverage step to the unit test job that runs after tests, publishes the coverage directory as an artifact, and generates a step summary.

- [x] In the `test` job (lines 10-35), after the existing `npm test` step, add:
  ```yaml
  - name: Run coverage (informational)
    run: npm run test:coverage
    continue-on-error: true

  - name: Coverage summary
    if: always()
    run: node scripts/ci/coverage-summary.mjs
    continue-on-error: true

  - name: Upload coverage
    if: always()
    uses: actions/upload-artifact@v4
    with:
      name: coverage-${{ matrix.node-version }}
      path: coverage/
      retention-days: 7
    continue-on-error: true
  ```
- [x] Add a comment above the coverage steps: `# Coverage — informational only, does not block the build`.
- [x] Run `npm test` — all tests must pass.

### Task 4: Wire Coverage into Release Workflow

**Files:**
- Modify: `.github/workflows/release.yml`

Add an informational coverage step in the release workflow so publish runs include visibility into tested surface area.

- [x] In the `publish-npm` job (after the `npm test` step at line 50), add:
  ```yaml
  - name: Run coverage (informational)
    run: npm run test:coverage
    continue-on-error: true

  - name: Coverage summary
    if: always()
    run: node scripts/ci/coverage-summary.mjs
    continue-on-error: true
  ```
- [x] Add a comment: `# Coverage — informational only, does not block release`.
- [x] Run `npm test` — all tests must pass.

### Task 5: Final Verification

- [x] Run full unit suite: `npm test` — all tests pass (including 6+ new coverage summary tests).
- [x] Run `npm run test:coverage` — completes successfully, produces `coverage/coverage-summary.json`.
- [x] Run `npm run test:coverage-report` — prints Markdown coverage table to stdout.
- [x] Run typecheck: `npm run typecheck` — no errors.
- [x] Run lint: `npm run lint` — no errors.
- [x] Verify `coverage/` is in `.gitignore`.
- [x] Verify workflow steps use `continue-on-error: true`.
- [x] Move this plan to `docs/plans/completed/` once all tasks are done.
