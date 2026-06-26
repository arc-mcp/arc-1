# Pseudo-type → `view` parameter (deferred to next major)

## Overview

Architectural cleanup deferred from the audit (see `docs/research/abap-types/02-master-overview.md`,
section "Pseudo cross-cutting reads"). Not a bug fix — a smell fix. **Do not execute as
part of the same release as `audit-purge-invented-adt-types.md`** — this is a much larger
breaking change with broad downstream impact, and should be paired with the next major
version bump.

The smell: ARC-1's `type` enum mixes real R3TR types (`CLAS`, `PROG`, `TABL`, …) with
"actions disguised as types" — `API_STATE`, `INACTIVE_OBJECTS`, `VERSIONS`,
`VERSION_SOURCE`, `TABLE_CONTENTS`. The latter aren't TADIR objects; they're
cross-cutting ADT views over real objects, requiring a second `objectType` parameter or
no `name` at all. They share an enum with real types because that's what the LLM
prompt-surface reads — but it's the source of recurring confusion (the audit found
several LLM-emitted patterns where the model used `API_STATE` as if it were a class
name).

## Context

### Current State

`SAPREAD_TYPES_ONPREM` mixes real R3TR types and pseudo views in a single enum.

### Target State

```ts
SAPRead({
  type: 'TABL',          // R3TR truth — strict
  name: 'SFLIGHT',
  view?: 'contents' | 'versions' | 'version_source' | 'api_state',
});

SAPRead({
  type: 'CLAS',
  name: 'ZCL_FOO',
  view: 'api_state',     // replaces type='API_STATE'
});

// INACTIVE_OBJECTS moves to a workflow tool — it's not really a "read" of an object:
SAPManage({ action: 'list_inactive_drafts' });
```

The deprecated `type` values continue to work for one full major release, with stderr
warnings.

### Key Files

| File | Role |
|------|------|
| `src/handlers/schemas.ts` | Type enums + new `view` field |
| `src/handlers/intent.ts` | Routing |
| `src/handlers/tools.ts` | LLM-facing description |
| `src/adt/client.ts` | View-specific readers |

### Design Principles

1. `type` is exclusively TADIR truth + ARC-1 documented abstractions like `FUNC`/`INCL`.
2. `view` is the cross-cutting axis: same object, different ADT endpoint.
3. Deprecation alias kept for one full major release.
4. `INACTIVE_OBJECTS` is a workflow, not a read — moves to `SAPManage`.

## Development Approach

This is a multi-PR effort. The plan listed here is a sketch, not ready-for-ralphex
yet — it needs additional research on which existing third-party clients depend on
which type values, and how to soft-migrate them.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run test:integration`
- `npm run test:e2e`

### Task 1: Survey downstream consumers

- [ ] Grep `docs/compare/` and any user-facing docs for the deprecated type values
- [ ] Cross-check Copilot Studio / Claude Desktop / Cursor configs published in
      `docs_page/clients/*.md` for hardcoded `API_STATE` etc.
- [ ] Decide: hard rename in next major, or one-major-deprecation-window
- [ ] Run `npm test`

### Task 2: Add `view` parameter to `SAPRead` schema

- [ ] Define `SAPREAD_VIEWS = ['contents', 'versions', 'version_source', 'api_state'] as const`
- [ ] Add `view: z.enum(SAPREAD_VIEWS).optional()` to both schemas
- [ ] Add unit tests
- [ ] Run `npm test`

### Task 3: Route `view` through `handleSAPRead`

- [ ] Add early-return router that, when `view` is set, dispatches to the view-specific
      reader regardless of `type`
- [ ] Add unit tests
- [ ] Run `npm test`

### Task 4: Migrate `TABLE_CONTENTS` → `view='contents'`

- [ ] Keep `TABLE_CONTENTS` as deprecated type alias for one major
- [ ] Emit deprecation log on use
- [ ] Update tools description
- [ ] Add unit + integration tests
- [ ] Run `npm test`

### Task 5: Migrate `VERSIONS` and `VERSION_SOURCE` → `view='versions'` / `view='version_source'`

- [ ] Same pattern as Task 4
- [ ] Run `npm test`

### Task 6: Migrate `API_STATE` → `view='api_state'`

- [ ] Same pattern
- [ ] Run `npm test`

### Task 7: Move `INACTIVE_OBJECTS` to `SAPManage(action='list_inactive_drafts')`

- [ ] Add `list_inactive_drafts` to `SAPManageSchema.action`
- [ ] Wire to existing reader
- [ ] Deprecate `SAPRead(type='INACTIVE_OBJECTS')` with stderr warning + same-result
- [ ] Run `npm test`

### Task 8: Documentation, migration guide, final verification

- [ ] Add a `docs/migrations/<version>-pseudo-types.md` migration guide
- [ ] Update CLAUDE.md, tools.md, roadmap.md, feature matrix
- [ ] Run full test + integration + e2e suite
- [ ] Move plan to completed
