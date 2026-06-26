# API Release State Bug Fix (C0-C4 Structure)

> **Priority**: Medium — verify ARC-1's API release state implementation
> **Source**: vibing-steampunk commit a66bcd5 (2026-04-10), PR #95 fix
> **ARC-1 component**: `src/adt/client.ts` (getApiReleaseState)

## The Bug

vibing-steampunk's `runAPISurface()` had a bug where `releaseState` was read from an uninitialized variable instead of the actual data structure:

```go
// WRONG: releaseState was empty string, never populated
releaseState = strings.ToUpper(strings.TrimSpace(releaseState))

// FIXED: read from actual C1 status structure
releaseState = strings.ToUpper(strings.TrimSpace(state.C1.Status.State))
```

The test updates also changed from old `apiState` XML schema to new `apiRelease` structure with `c1Release` and `status` elements, validating against `/sap/bc/adt/apireleases/` endpoint.

## ARC-1 comparison

ARC-1 implemented API release state in PR #77 (`src/adt/client.ts`). The implementation should be verified to ensure:

1. The release state is correctly extracted from the XML response
2. The C0-C4 classification is properly parsed
3. The `/sap/bc/adt/apireleases/` endpoint format matches expectations

### Verification steps

1. Check `src/adt/client.ts` for `getApiReleaseState` — ensure it reads the state from the correct XML element
2. Check `src/adt/xml-parser.ts` — ensure the API release state parser handles the `c1Release.status.state` path
3. Run integration tests against a live system to verify C0/C1/C2/C3/C4 states are returned correctly

## Decision

**Verify** — review ARC-1's API release state implementation against this bug pattern. Low effort (code review), could prevent a similar extraction bug.
