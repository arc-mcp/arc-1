# Object Source Version Loading

> **Priority**: Medium
> **Source**: abap-adt-api commit d3c6940 (v6.0.0, 2024-05-07)
> **ARC-1 component**: `src/adt/client.ts`

## What abap-adt-api added

`getObjectSource(url, options?)` now accepts `ObjectSourceOptions` with a `version` parameter:
```typescript
interface ObjectSourceOptions {
  version?: ObjectVersion  // "active" | "inactive" | specific revision
}
```

Uses the ADT `?version=` query parameter on source endpoints. Combined with `revisions(url)` which returns the full revision history.

## ARC-1 current state

- ARC-1 always reads the active (or current) version of source
- No revision history API
- No ability to compare versions

## Assessment

Version comparison is useful for:
- Showing what changed in the last activation
- Comparing active vs inactive versions before activation
- Reviewing recent changes by other developers

The `revisions()` endpoint returns timestamps, authors, and version identifiers that can be used with `getObjectSource()` to fetch specific versions.

## Decision

**Consider future** — Add `version` parameter to SAPRead source operations and a `revisions` action to SAPNavigate. This enables the LLM to compare versions and understand change history.

**Effort**: S (1d — version parameter on GET, revisions endpoint)
