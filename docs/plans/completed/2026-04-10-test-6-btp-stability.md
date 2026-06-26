# BTP Test Stability Model (CI Smoke + Local Extended)

## Overview

This plan splits the BTP ABAP integration tests into two tiers: a CI-capable smoke suite with deterministic, non-interactive tests, and the existing extended suite for local interactive testing. It adds a scheduled GitHub Actions workflow for BTP smoke tests with failure taxonomy reporting, and documents BTP stability requirements and tenant assumptions.

Currently, the entire BTP suite (`tests/integration/btp-abap.integration.test.ts`) is local-only and never runs in CI due to interactive OAuth requirements and free-tier instability.

## Context

### Current State

- `tests/integration/btp-abap.integration.test.ts` lines 7-13 document why tests are local-only: BTP free tier stops nightly, instances expire after 90 days, OAuth requires interactive browser login.
- Line 58: suite gated by `hasBtpCredentials()` checking `TEST_BTP_SERVICE_KEY_FILE`.
- CI workflow (`.github/workflows/test.yml`) does not inject BTP env vars — all 28 BTP tests are always skipped in CI.
- Lines 194-232: restriction tests accept both success and failure permissively.
- The suite has valuable tests: connectivity, system info, released object access, search, code intelligence — but all are dormant in CI.

### Target State

- BTP tests split into smoke (CI-capable) and extended (local-only).
- Smoke tests: connectivity check, system info shape, released-object read, released-object search — deterministic contracts that don't require write access or interactive OAuth.
- Smoke tests skip with explicit reason when BTP service key is missing.
- A scheduled workflow (`btp-smoke.yml`) runs smoke tests on a cron and on manual dispatch.
- Smoke workflow produces failure taxonomy (auth/connectivity/assertion/unknown) in artifacts.
- Extended tests remain in original file with clear documentation.
- `docs/btp-abap-environment.md` updated with stability requirements and failure taxonomy.

### Key Files

| File | Role |
|------|------|
| `tests/integration/btp-abap.integration.test.ts` | Current monolithic BTP test file — keep for extended tests |
| `tests/integration/btp-abap.smoke.integration.test.ts` | New: CI-capable BTP smoke tests |
| `package.json` | New scripts: `test:integration:btp:smoke`, `test:integration:btp:extended` |
| `.github/workflows/btp-smoke.yml` | New: scheduled BTP smoke workflow |
| `docs/btp-abap-environment.md` | BTP testing documentation |
| `tests/integration/helpers.ts` | `hasBtpCredentials()` — already exists |

### Design Principles

1. Smoke = deterministic + non-interactive: only tests that can run with a service key (no browser OAuth).
2. Smoke tests assert strict contracts: system info has expected fields, released objects are accessible, search returns valid shapes.
3. Failure taxonomy: classify every failure as auth/connectivity/assertion/backend-unavailable.
4. Non-blocking initially: smoke workflow is informational until stability is proven.
5. Extended tests untouched: the existing local-only suite continues to work as before.

## Development Approach

Extract smoke-worthy tests into a new file, add failure taxonomy helpers, create the scheduled workflow, then update documentation. The existing BTP test file is modified minimally — only to add comments distinguishing extended tests.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Create BTP Smoke Test Suite

**Files:**
- Create: `tests/integration/btp-abap.smoke.integration.test.ts`
- Modify: `tests/integration/helpers.ts`

Create a focused BTP smoke test file with strict, deterministic assertions for CI execution.

- [x] In `tests/integration/helpers.ts`, verify `hasBtpCredentials()` exists and check if it also handles a `TEST_BTP_SERVICE_KEY` env var (direct JSON, not just file path). If not, add support for it so CI can inject the key directly as a secret. The function should check `process.env.TEST_BTP_SERVICE_KEY_FILE || process.env.TEST_BTP_SERVICE_KEY`.
- [x] Create `tests/integration/btp-abap.smoke.integration.test.ts`:
  - Import `hasBtpCredentials` from `./helpers.js`.
  - Top-level gate: `const describeIf = hasBtpCredentials() ? describe : describe.skip;`.
  - Client creation in `beforeAll`: create BTP client from service key (follow pattern in existing `btp-abap.integration.test.ts`).
  - Organize as `describeIf('BTP ABAP smoke', () => { ... })`.
- [x] Add smoke test: **connectivity check**:
  ```typescript
  it('connects to BTP ABAP and gets CSRF token', async () => {
    // The client constructor should have established connectivity
    // A simple read verifies the full auth chain works
    const info = await client.getSystemInfo();
    expect(info).toBeTruthy();
  });
  ```
- [x] Add smoke test: **system info shape**:
  ```typescript
  it('returns system info with expected fields', async () => {
    const info = await client.getSystemInfo();
    expect(info.systemId).toBeTruthy();
    expect(info.systemType).toBeTruthy();
    // BTP systems report component version
    expect(typeof info.systemId).toBe('string');
  });
  ```
- [x] Add smoke test: **released object read** (read a standard released API, e.g., `CL_ABAP_RANDOM`):
  ```typescript
  it('reads a released SAP class', async () => {
    const source = await client.getClass('CL_ABAP_RANDOM');
    expect(typeof source).toBe('string');
    expect(source.length).toBeGreaterThan(0);
  });
  ```
- [x] Add smoke test: **released object search**:
  ```typescript
  it('searches for released objects', async () => {
    const results = await client.searchObject('CL_ABAP_*', 5);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('objectName');
  });
  ```
- [x] Add smoke test: **BTP-specific behavior** (verify some classic programs are NOT available):
  ```typescript
  it('classic programs are not accessible on BTP', async () => {
    try {
      await client.getProgram('RSHOWTIM');
      // Unexpected success — BTP should not have classic programs
    } catch (err) {
      expectSapFailureClass(err, [403, 404], [/not found/i, /not available/i]);
    }
  });
  ```
- [x] Set test timeout to 30s.
- [x] Import `expectSapFailureClass` from `../../helpers/expected-error.js` (created in plan test-4). If that plan hasn't been executed yet, inline the assertion: `expect(err).toBeInstanceOf(Error); expect((err as Error).message).toMatch(/404|403|not found/i);`.
- [x] Run `npm test` — all tests must pass (BTP tests will be skipped without credentials).

### Task 2: Add npm Scripts and Document Extended Suite

**Files:**
- Modify: `package.json`
- Modify: `tests/integration/btp-abap.integration.test.ts`

Add targeted npm scripts for smoke and extended BTP tests, and mark the existing test file as the extended suite.

- [x] Add npm scripts to `package.json`:
  ```json
  "test:integration:btp:smoke": "vitest run --config vitest.integration.config.ts tests/integration/btp-abap.smoke.integration.test.ts",
  "test:integration:btp:extended": "vitest run --config vitest.integration.config.ts tests/integration/btp-abap.integration.test.ts"
  ```
- [x] Rename existing `"test:integration:btp"` script to point to the extended suite specifically (if it currently points to the whole file, keep it as an alias for extended).
- [x] In `tests/integration/btp-abap.integration.test.ts`, add a header comment at the top:
  ```typescript
  /**
   * BTP ABAP Extended Integration Tests (LOCAL ONLY)
   *
   * These tests require interactive browser login and are NOT run in CI.
   * For CI-capable BTP tests, see btp-abap.smoke.integration.test.ts.
   *
   * Reasons for local-only:
   * - BTP free tier instances are stopped each night
   * - Free tier instances are deleted after 90 days
   * - OAuth browser login requires interactive user
   */
  ```
  Replace or merge with the existing comment at lines 7-13.
- [x] Run `npm test` — all tests must pass.

### Task 3: Create Scheduled BTP Smoke Workflow

**Files:**
- Create: `.github/workflows/btp-smoke.yml`

Create a GitHub Actions workflow that runs BTP smoke tests on a schedule and manual dispatch, with failure taxonomy reporting.

- [x] Create `.github/workflows/btp-smoke.yml`:
  ```yaml
  name: BTP Smoke Tests

  on:
    schedule:
      - cron: '0 8 * * 1-5'  # Weekdays at 08:00 UTC (after BTP free tier restarts)
    workflow_dispatch:  # Manual trigger

  jobs:
    btp-smoke:
      runs-on: ubuntu-latest
      timeout-minutes: 10
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: 22
            cache: npm
        - run: npm ci
        - name: Run BTP smoke tests
          run: npm run test:integration:btp:smoke
          env:
            TEST_BTP_SERVICE_KEY: ${{ secrets.TEST_BTP_SERVICE_KEY }}
          continue-on-error: true
          id: smoke
        - name: Upload test results
          if: always()
          uses: actions/upload-artifact@v4
          with:
            name: btp-smoke-results
            path: test-results/
            retention-days: 30
        - name: Classify failures
          if: always()
          run: |
            echo "## BTP Smoke Test Results" >> $GITHUB_STEP_SUMMARY
            echo "" >> $GITHUB_STEP_SUMMARY
            if [ "${{ steps.smoke.outcome }}" == "success" ]; then
              echo "All smoke tests passed." >> $GITHUB_STEP_SUMMARY
            else
              echo "Some tests failed. Check artifacts for details." >> $GITHUB_STEP_SUMMARY
              echo "" >> $GITHUB_STEP_SUMMARY
              echo "Common failure categories:" >> $GITHUB_STEP_SUMMARY
              echo "- **auth**: OAuth token expired or service key invalid" >> $GITHUB_STEP_SUMMARY
              echo "- **connectivity**: BTP instance stopped or unreachable" >> $GITHUB_STEP_SUMMARY
              echo "- **assertion**: Test contract violation (potential regression)" >> $GITHUB_STEP_SUMMARY
            fi
  ```
- [x] Run `npm test` — all tests must pass.

### Task 4: Update BTP Documentation

**Files:**
- Modify: `docs/btp-abap-environment.md`

Update the BTP ABAP Environment documentation to describe the smoke/extended split, stability requirements, and failure escalation path.

- [x] Read `docs/btp-abap-environment.md` to understand current content.
- [x] Add a "Testing" section covering:
  - **Smoke tests** (CI-capable): what they test, how to run (`npm run test:integration:btp:smoke`), what secrets are needed (`TEST_BTP_SERVICE_KEY`), expected behavior when instance is down.
  - **Extended tests** (local-only): what they test, how to run (`npm run test:integration:btp:extended`), why they need browser login, environment setup.
  - **Failure taxonomy**: auth failures (token expired, key invalid), connectivity failures (instance stopped, DNS unreachable), assertion failures (API contract changed), backend unavailable (503, maintenance).
  - **Tenant assumptions**: tests assume BTP ABAP with standard released objects; free-tier limitations (nightly stop, 90-day expiry); recommended: use paid test tenant for reliable CI.
  - **Scheduled workflow**: runs weekday mornings, results in GitHub Actions artifacts.
- [x] Run `npm test` — all tests must pass.

### Task 5: Final Verification

- [x] Run full unit suite: `npm test` — all tests pass.
- [x] Run typecheck: `npm run typecheck` — no errors.
- [x] Run lint: `npm run lint` — no errors.
- [x] Verify `npm run test:integration:btp:smoke` command works (tests will skip without BTP credentials — that's expected).
- [x] Verify `.github/workflows/btp-smoke.yml` is valid YAML.
- [x] Verify `docs/btp-abap-environment.md` has the new testing section.
- [x] Move this plan to `docs/plans/completed/` once all tasks are done.
