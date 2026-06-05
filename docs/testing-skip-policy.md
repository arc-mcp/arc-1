# Testing Skip Policy

This document defines ARC-1's policy for skipping tests. Every skip must be explicit, use a standard API, and include an actionable reason visible in test output.

## Valid Skip Reasons

These are the accepted reasons for a test to skip at runtime:

### Missing SAP Credentials (Fail Fast, No Skip)

Integration and E2E tests require a live SAP system. Missing credentials are treated as test setup errors and should fail immediately, not skip.

```typescript
import { requireSapCredentials } from './helpers.js';

beforeAll(() => {
  requireSapCredentials();
});
```

### Missing Fixture on Shared System

Some tests depend on objects that may not exist on every SAP system (e.g., DDLS views, custom Z objects).

```typescript
it('extracts CDS dependencies', async (ctx) => {
  requireOrSkip(ctx, cdsName, SkipReason.NO_DDLS);
  // ...test logic...
});
```

### Backend Does Not Support Feature

Older SAP versions or BTP ABAP may lack specific ADT endpoints.

```typescript
it('reads profiler traces', async (ctx) => {
  if (!profilerAvailable) return skipTest(ctx, 'Backend does not support profiler traces');
});
```

### Optional Custom Objects Not Deployed

E2E tests may require test objects (ZARC1_TEST_REPORT, ZCL_ARC1_TEST, etc.) that are created on demand.

```typescript
it('finds references to ZIF_ARC1_TEST', async (ctx) => {
  if (!hasCustomObjects) return skipTest(ctx, 'Required custom E2E objects were not deployed');
  // ...test logic...
});
```

### No Runtime Data Available

Some diagnostics tests check for short dumps or traces that may not exist on a clean system.

```typescript
it('lists short dump details', async (ctx) => {
  if (dumps.length === 0) return skipTest(ctx, 'No dumps on system — nothing to verify');
  // ...test logic...
});
```

## Problematic Patterns (DO NOT)

### Early return without skip

```typescript
// BAD: counts as PASS, hides missing prerequisites
it('extracts deps', async () => {
  if (!ddlSource) return; // <-- silent pass, inflates pass count
  // ...never reached...
});
```

### Catch-and-continue without assertion

```typescript
// BAD: swallows real failures
it('reads object', async () => {
  try {
    const result = await client.getProgram('ZTEST');
    expect(result).toBeDefined();
  } catch {
    // skip — no assertion, no skip signal
  }
});
```

### Permanent it.skip without issue tracking

```typescript
// BAD: forgotten, never re-enabled
it.skip('flaky transport test', async () => { ... });
```

If a test must be disabled, file an issue and reference it in a comment.

### Workflow-level skip hiding runtime regressions

Excluding entire test suites from certain event types (e.g., only running integration tests on PRs) can hide regressions introduced by direct pushes to main.

## How to Skip Correctly

### For precondition checks: requireOrSkip

Use `requireOrSkip` when a test depends on a value discovered at runtime (e.g., a DDLS name found during `beforeAll`). It narrows the type and skips with a reason if the value is nullish.

```typescript
import { requireOrSkip } from '../../helpers/skip-policy.js';

it('extracts CDS entity name', async (ctx) => {
  requireOrSkip(ctx, cdsName, 'No DDLS candidate found on system');
  // cdsName is now typed as string (non-null)
  const result = await client.getDdlSource(cdsName);
  expect(result).toContain('define');
});
```

### For runtime decisions: skipTest

Use `skipTest(ctx, 'reason')` when the skip decision depends on runtime state that is not a simple null check. This records structured skip telemetry before delegating to Vitest's `ctx.skip`.

```typescript
import { skipTest } from '../../helpers/skip-policy.js';

it('verifies dump details', async (ctx) => {
  if (dumps.length === 0) return skipTest(ctx, 'No dumps on system — nothing to verify');
  const detail = await client.getShortDumpDetail(dumps[0].id);
  expect(detail).toBeDefined();
});
```

### Always include actionable reason text

The reason should tell someone reading CI output what prerequisite is missing and ideally how to fix it.

Good: `'No DDLS object found on system — deploy a CDS view to enable this test'`
Bad: `'skipped'`

## Skip Reason Constants

The shared helper at `tests/helpers/skip-policy.ts` exports these standard constants:

| Constant | Value | When to use |
|----------|-------|-------------|
| `NO_CREDENTIALS` | SAP credentials not configured | Per-test runtime prerequisite (not suite-level gating) |
| `NO_FIXTURE` | Required test fixture not found on SAP system | Persistent or transient test object is unavailable |
| `NO_DDLS` | No DDLS object found on system | CDS/DDLS tests when no view is available |
| `NO_DUMPS` | No short dumps found on system | Diagnostics tests on clean systems |
| `NO_TRANSPORT_PACKAGE` | TEST_TRANSPORT_PACKAGE not configured (transportable package required) | Optional transport-package tests |
| `TRANSPORT_PACKAGE_WRITES_DISABLED` | TEST_TRANSPORT_PACKAGE_WRITE_TESTS not enabled (transportable package writes can leave locked CTS tasks on shared SAP systems) | Manual transportable-package write tests |
| `TRANSPORT_RELEASE_DISABLED` | TEST_TRANSPORT_RELEASE_TESTS not enabled (transport release is permanent on the shared SAP test system) | Permanent transport release paths |
| `BACKEND_UNSUPPORTED` | Backend feature not supported on this SAP system | Release, product, or optional component lacks the tested endpoint |

Use these constants for consistency. Add new constants to the helper when a new skip category emerges.

## CI Policy

- Internal PRs and pushes to `main` run all test suites: unit, integration, and E2E.
- External fork PRs skip integration and E2E jobs because repository secrets are not available to forks.
- Tests that skip at runtime (missing fixtures, unsupported features) appear as SKIPPED in reports, not PASSED.
- Runtime skips are recorded in `test-results/integration-skips.ndjson` and `test-results/e2e-skips.ndjson` so CI can summarize actual skip reasons, not just skipped test titles.

## Reference Patterns

The canonical example of correct skip usage is `tests/e2e/navigate.e2e.test.ts`. It demonstrates:

- A `hasCustomObjects` flag set in `beforeAll` via a lightweight probe
- Individual tests calling `skipTest(ctx, reason)` when the flag is false
- Tests that run when objects are present make real assertions (not just "defined" checks)

```typescript
// From tests/e2e/navigate.e2e.test.ts
it('finds references to ZIF_ARC1_TEST', async (ctx) => {
  if (!hasCustomObjects) return skipTest(ctx, 'Required custom E2E objects were not deployed');
  const result = await callTool(client, 'SAPNavigate', { ... });
  const text = expectToolSuccess(result);
  const refs = JSON.parse(text);
  expect(refs.length).toBeGreaterThanOrEqual(1);
});
```
