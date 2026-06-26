# CRUD Lifecycle Integration Test

## Overview

This plan replaces the placeholder CRUD test in `adt.integration.test.ts` with a real, deterministic lifecycle test that exercises the full create -> read -> update -> activate -> delete -> verify-deletion roundtrip. It includes a CRUD harness with unique name generation, object registry, retry logic for lock conflicts, and cleanup guarantees. The placeholder at `adt.integration.test.ts:299-309` (which only runs a search) is converted to a redirect notice pointing to the new lifecycle suite.

## Context

### Current State

**Placeholder CRUD test:**
- `tests/integration/adt.integration.test.ts` lines 299-309: section named "CRUD operations" only calls `searchObject()` and asserts the result is empty. Does not create, update, or delete anything.

**Actual write coverage (partial):**
- `tests/integration/adt.integration.test.ts` lines 571-593: "batch create in $TMP" section creates two programs and reads them back, but does not update, activate, or assert delete success.
- `tests/integration/adt.integration.test.ts` lines 553-569: `afterAll` cleanup attempts delete with catch-ignore — delete success is never asserted.

**CRUD primitives available:**
- `src/adt/crud.ts`: `lockObject()`, `unlockObject()`, `createObject()`, `updateSource()`, `deleteObject()`, `safeUpdateSource()` — all fully implemented.
- `src/adt/devtools.ts`: `activateObject()` — handles activation.

**Key constraint:** Tests run against a shared SAP system. Objects must use unique names to avoid collisions, must be created in `$TMP` package (no transport required), and must be cleaned up reliably.

### Target State

- A dedicated `tests/integration/crud.lifecycle.integration.test.ts` with a full lifecycle test.
- A `tests/integration/crud-harness.ts` providing unique name generation, object registry, lock-aware retry delete, and cleanup diagnostics.
- The placeholder in `adt.integration.test.ts` is replaced with a comment redirecting to the lifecycle suite.
- npm scripts `test:integration:crud` for targeted lifecycle execution.
- Unit tests for the harness logic.

### Key Files

| File | Role |
|------|------|
| `tests/integration/crud-harness.ts` | New: CRUD test harness (names, registry, cleanup) |
| `tests/integration/crud.lifecycle.integration.test.ts` | New: full lifecycle test |
| `tests/integration/adt.integration.test.ts` | Lines 299-309: placeholder to convert; lines 553-593: existing partial write tests |
| `tests/integration/helpers.ts` | `getTestClient()`, `hasSapCredentials()` — used by new test |
| `src/adt/crud.ts` | CRUD primitives: `lockObject`, `createObject`, `updateSource`, `deleteObject` |
| `src/adt/devtools.ts` | `activateObject()` for activation step |
| `src/adt/safety.ts` | `unrestrictedSafetyConfig()` used in test client |
| `package.json` | New script: `test:integration:crud` |

### Design Principles

1. Unique names per run: `ZARC1_IT_<timestamp>_<case>` pattern avoids collisions on shared systems.
2. Object registry: track every created object for guaranteed cleanup.
3. Cleanup failure = test failure: in required profile, failed cleanup is not silently ignored.
4. Lock-aware retry: if delete fails due to lock conflict, retry with backoff.
5. Full lifecycle in one test: create -> read -> update -> read-updated -> activate -> delete -> read-404.

## Development Approach

Build the harness first with unit tests (pure logic, no SAP dependency), then create the lifecycle test file, then update the placeholder and add npm scripts. The harness is designed to be importable by both the new lifecycle suite and the existing batch-create tests if desired.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Create CRUD Test Harness

**Files:**
- Create: `tests/integration/crud-harness.ts`
- Create: `tests/unit/integration/crud-harness.test.ts`

Build a harness that provides unique name generation, an object registry for cleanup tracking, and retry-aware delete logic.

- [x] Create `tests/integration/crud-harness.ts` with:
  - `generateUniqueName(prefix: string): string` — returns `${prefix}_${Date.now().toString(36).toUpperCase().slice(-6)}` (e.g., `ZARC1_IT_LK4F2A`). Name must be valid ABAP (max 30 chars, uppercase, alphanumeric + underscore).
  - `CrudRegistry` class:
    - `register(objectUrl: string, objectType: string, name: string): void` — tracks created objects.
    - `getAll(): Array<{ objectUrl: string; objectType: string; name: string }>` — returns registered objects in reverse creation order (last created = first deleted).
    - `remove(name: string): void` — removes object from registry after successful delete.
    - `size: number` — count of registered objects.
  - `retryDelete(http: AdtHttpClient, safety: SafetyConfig, objectUrl: string, maxRetries: number, delayMs: number): Promise<{ success: boolean; attempts: number; lastError?: string }>` — attempts delete, retries on lock conflict errors (message contains "locked" or "enqueue"), with exponential backoff.
  - `cleanupAll(http: AdtHttpClient, safety: SafetyConfig, registry: CrudRegistry): Promise<{ cleaned: number; failed: Array<{ name: string; error: string }> }>` — iterates registry, attempts retryDelete for each, returns cleanup report.
  - `buildCreateXml(objectType: string, name: string, packageName: string, description: string): string` — generates ADT-compatible creation XML. This can be extracted from the existing pattern in `adt.integration.test.ts` lines 571-593.
  - All functions should be pure or take explicit dependencies (no global state).
- [x] Add unit tests (~10 tests) in `tests/unit/integration/crud-harness.test.ts`:
  - `generateUniqueName` produces valid ABAP names (uppercase, <= 30 chars).
  - `generateUniqueName` produces different names on sequential calls.
  - `CrudRegistry.register` adds entries.
  - `CrudRegistry.getAll` returns reverse order.
  - `CrudRegistry.remove` removes by name.
  - `CrudRegistry.size` reflects current count.
  - `retryDelete` succeeds on first attempt (mock HTTP).
  - `retryDelete` retries on lock conflict and succeeds.
  - `retryDelete` returns failure after max retries.
  - `cleanupAll` reports successes and failures.
  - `buildCreateXml` produces valid XML with correct name and package.
- [x] Run `npm test` — all tests must pass.

### Task 2: Implement Full CRUD Lifecycle Test

**Files:**
- Create: `tests/integration/crud.lifecycle.integration.test.ts`

Create a dedicated integration test that exercises the complete CRUD lifecycle against a live SAP system.

- [x] Create `tests/integration/crud.lifecycle.integration.test.ts`:
  - Import `getTestClient`, `hasSapCredentials` from `./helpers.js`.
  - Import CRUD functions from `../../src/adt/crud.js` (`lockObject`, `unlockObject`, `createObject`, `updateSource`, `deleteObject`).
  - Import `activateObject` from `../../src/adt/devtools.js`.
  - Import `CrudRegistry`, `generateUniqueName`, `cleanupAll`, `buildCreateXml` from `./crud-harness.js`.
  - Top-level gate: `const describeIf = hasSapCredentials() ? describe : describe.skip;`.
  - Create a `CrudRegistry` instance for tracking.
- [x] Implement the lifecycle test inside `describeIf('CRUD lifecycle', ...)`:
  ```
  let testName: string;
  const registry = new CrudRegistry();

  afterAll(async () => {
    const report = await cleanupAll(client.http, safety, registry);
    if (report.failed.length > 0) {
      console.error('CRUD cleanup failures:', report.failed);
      throw new Error(`CRUD cleanup failed for: ${report.failed.map(f => f.name).join(', ')}`);
    }
  });

  it('full lifecycle: create -> read -> update -> activate -> delete -> verify-deleted', async () => {
    testName = generateUniqueName('ZARC1_IT');
    const objectUrl = `/sap/bc/adt/programs/programs/${testName.toLowerCase()}`;
    const sourceUrl = `${objectUrl}/source/main`;
    const xml = buildCreateXml('PROG', testName, '$TMP', 'ARC-1 lifecycle test');

    // 1. CREATE
    await createObject(client.http, safety, '/sap/bc/adt/programs/programs', xml);
    registry.register(objectUrl, 'PROG', testName);

    // 2. READ — verify creation
    const source1 = await client.getProgram(testName);
    expect(typeof source1).toBe('string');

    // 3. UPDATE — modify source
    const newSource = `REPORT ${testName.toLowerCase()}.\nWRITE: / 'updated by CRUD lifecycle test'.`;
    await safeUpdateSource(client.http, safety, objectUrl, sourceUrl, newSource);

    // 4. READ — verify update
    const source2 = await client.getProgram(testName);
    expect(source2).toContain('updated by CRUD lifecycle test');

    // 5. ACTIVATE
    await activateObject(client.http, safety, testName, 'PROG');

    // 6. DELETE
    await client.http.withStatefulSession(async (session) => {
      const lock = await lockObject(session, safety, objectUrl);
      await deleteObject(session, safety, objectUrl, lock.lockHandle);
    });
    registry.remove(testName);

    // 7. VERIFY DELETION — read should fail with 404
    await expect(client.getProgram(testName)).rejects.toThrow();
  });
  ```
  Adjust the exact API calls based on how `src/adt/crud.ts` and `src/adt/client.ts` work. The test client from `getTestClient()` has an unrestricted safety config.
- [x] Set test timeout to 60s (CRUD lifecycle involves multiple network roundtrips).
- [x] Run `npm run test:integration` if SAP credentials are available — lifecycle test should execute end-to-end.
- [x] Run `npm test` — all tests must pass.

### Task 3: Update Placeholder and Add npm Scripts

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/test.yml`

Replace the placeholder CRUD section with a redirect, and add targeted npm scripts.

- [x] In `tests/integration/adt.integration.test.ts`, replace the placeholder "CRUD operations" section at lines 299-309 with:
  ```typescript
  // CRUD lifecycle test moved to tests/integration/crud.lifecycle.integration.test.ts
  // This section previously only verified search — full create/read/update/activate/delete
  // lifecycle is now covered by the dedicated suite.
  ```
  Remove the placeholder `it(...)` block entirely.
- [x] Add npm script to `package.json`:
  ```json
  "test:integration:crud": "vitest run --config vitest.integration.config.ts tests/integration/crud.lifecycle.integration.test.ts"
  ```
- [x] In `.github/workflows/test.yml`, in the integration job, the existing `npm run test:integration` already includes all `tests/integration/**/*.test.ts` files, so the new lifecycle test will be picked up automatically. No workflow change needed for inclusion.
- [x] Run `npm test` — all tests must pass.

### Task 4: Final Verification

- [x] Run full unit suite: `npm test` — all tests pass (including 10+ new harness tests).
- [x] Run typecheck: `npm run typecheck` — no errors.
- [x] Run lint: `npm run lint` — no errors.
- [x] Verify `npm run test:integration:crud` command is valid (will skip if no SAP credentials).
- [x] Verify the placeholder in `adt.integration.test.ts` is removed (no more misleading "CRUD operations" test).
- [x] Move this plan to `docs/plans/completed/` once all tasks are done.
