# Read/write enum symmetry & `FTG2` rename

**References**

- Issue [#218](https://github.com/arc-mcp/arc-1/issues/218) — original audit trigger
- PR [#219](https://github.com/arc-mcp/arc-1/pull/219) — Model B / STRU→TABL collapse (precedent for breaking-rename + deprecation alias)
- PR [#222](https://github.com/arc-mcp/arc-1/pull/222) — Audit (research-only, this plan ships in it)
- [`docs/research/abap-types/02-master-overview.md`](../../research/abap-types/02-master-overview.md) — synthesis + verdict matrix
- Per-type evidence: [`msag.md`](../../research/abap-types/types/msag.md), [`messages.md`](../../research/abap-types/types/messages.md), [`ftg2.md`](../../research/abap-types/types/ftg2.md)
- Companion plan: [`audit-purge-invented-adt-types.md`](2026-05-08-audit-purge-invented-adt-types.md) (Plan A — runs independently of this one)
- External: [SAP/abap-file-formats](https://github.com/SAP/abap-file-formats) — `msag/` directory; no `ftg2/` directory
- Cross-reference: `docs/compare/00-feature-matrix.md:97,108` — ARC-1 sole implementer of `FTG2` (smell evidence)


## Overview

Companion plan to [`audit-purge-invented-adt-types.md`](2026-05-08-audit-purge-invented-adt-types.md).
The same audit (see [`docs/research/abap-types/`](../../research/abap-types/02-master-overview.md))
found two non-bug structural issues that should be fixed together with the invented-alias
purge.

### Issue 1 — read/write enum drift for message classes

**Background**: `MSAG` is the canonical TADIR R3TR type for message classes (table `T100`,
documented in [abap-file-formats](https://github.com/SAP/abap-file-formats) — `msag/`
directory exists). Writes via `SAPWrite(type='MSAG')` work today, but reads must go
through the `MESSAGES` pseudo-type — a read/write asymmetry. Per
[`docs/research/abap-types/types/msag.md`](../../research/abap-types/types/msag.md):
- `MSAG` is listed in `SAPWRITE_TYPES_ONPREM` (~line 233 of `src/handlers/schemas.ts`)
- `MSAG` is **missing** from `SAPREAD_TYPES_ONPREM` (line 17–53)
- `MESSAGES` is listed in read enum but means "system log read", which conflicts with
  the obvious user expectation that `MESSAGES` reads message classes

The split is historical accident — when `SAPRead` was first split out, the message-class
read endpoint was wired through a different code path than write. The fix is to add
`MSAG` to the read enum, route both `MSAG` and `MESSAGES` to the same handler, and
deprecate `MESSAGES` for one minor.

### Issue 2 — `FTG2` is an invented short identifier

**Background**: The endpoint `/sap/bc/adt/sfw/featuretoggles/{name}/states` is real and
returns feature-toggle states. But the short identifier `FTG2` itself appears in **zero**
SAP sources — not TADIR, not [abap-file-formats](https://github.com/SAP/abap-file-formats)
(no `ftg2/` directory), not Eclipse `com.sap.adt.core.apidoc-3.58.1`, not other MCP
servers. Per [`docs/research/abap-types/types/ftg2.md`](../../research/abap-types/types/ftg2.md),
`docs/compare/00-feature-matrix.md:97,108` confirms ARC-1 is the sole implementer using this
identifier.

This is the same bug class as `STRU` and `FUNC/FM` from issue
[#218](https://github.com/arc-mcp/arc-1/issues/218): an ARC-1-private name that looks
like a SAP type but isn't. Fix: rename to `FEATURE_TOGGLE` (descriptive, no false-TADIR
appearance), keep `FTG2` as deprecated alias for one minor.

This plan resolves both. It is a breaking change for anyone scripting `FTG2` or
`SAPRead(type='MESSAGES')` directly.

## Context

### Current State

- `src/handlers/schemas.ts` — `SAPREAD_TYPES_ONPREM` has `MESSAGES` (line ~42) but not
  `MSAG`; `SAPWRITE_TYPES_ONPREM` has `MSAG` (line ~233) but not `MESSAGES`. Asymmetric.
- `src/handlers/schemas.ts` — `FTG2` is in the on-prem read enum.
- `src/handlers/intent.ts` — `FTG2` is wired through `handleSAPRead` to call the
  feature-toggle endpoint.
- `docs/compare/00-feature-matrix.md:97,108` — ARC-1 is the only listed implementer that
  uses `FTG2` as a short type, evidence that the name is ARC-1-private (smell).

### Target State

- `MSAG` is the single canonical identifier for message classes across read and write.
- `MESSAGES` is preserved as a deprecated read alias for one minor release, with a
  warning log on use.
- The feature-toggle reader is exposed as either `FEATURE_TOGGLE` (rename) or as
  `SAPManage(action='get_feature_toggle')`. Decision: rename (cheaper migration). `FTG2`
  becomes a deprecated alias for one minor release.

### Key Files

| File | Role |
|------|------|
| `src/handlers/schemas.ts` | Read/write enums |
| `src/handlers/intent.ts` | Type routing, normalize, handlers |
| `src/handlers/tools.ts` | LLM-facing descriptions |
| `src/probe/catalog.ts` | Probe entries |
| `tests/unit/handlers/schemas.test.ts` | Enum symmetry tests |
| `tests/integration/adt.integration.test.ts` | Round-trip tests |
| `docs/research/abap-types/types/{msag,messages,ftg2}.md` | Per-type evidence |

### Design Principles

1. Canonical names match TADIR / abap-file-formats. ARC-1-invented short forms must be
   replaced or clearly labeled "ARC-1 pseudo".
2. Read and write enums must be symmetric for any type that supports both verbs in ADT.
3. Deprecated aliases stay for exactly one minor release with a stderr warning, then
   removed in the following minor.

## Development Approach

- Schemas first (data), then handlers (wiring), then deprecation warnings, then docs.
- Keep `MESSAGES` and `FTG2` accepted at the schema layer to preserve compat for one
  release; emit a deprecation log when normalized internally.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run test:integration`

### Task 1: Add `MSAG` to read enums

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`

- [ ] Add `'MSAG'` to `SAPREAD_TYPES_ONPREM`
- [ ] (Decide whether MSAG read is BTP-relevant; if yes, add to `SAPREAD_TYPES_BTP`)
- [ ] Add a unit test that asserts read/write enum symmetry: every type in
      `SAPWRITE_TYPES_ONPREM` is in `SAPREAD_TYPES_ONPREM` (or has a documented
      exception list)
- [ ] Add unit test: `SAPRead({ type: 'MSAG', name: 'XYZ' })` passes schema validation
- [ ] Run `npm test` — all tests must pass

### Task 2: Wire MSAG read through intent.ts

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `src/adt/client.ts` (if a getter is missing)
- Modify: `tests/unit/handlers/intent.test.ts`

- [ ] Confirm `client.getMessageClass(name)` (or equivalent) exists in `src/adt/client.ts`;
      if not, add it (URL `/sap/bc/adt/messageclass/<name>`)
- [ ] Add `case 'MSAG':` in `handleSAPRead` returning the message class source
- [ ] Confirm `objectBasePath('MSAG')` returns `/sap/bc/adt/messageclass/` (already does
      per current code at ~line 2702)
- [ ] Add unit tests (~3 tests): MSAG read happy path, MSAG read 404 surfaces typed
      error, MSAG read normalizes `MSAG/N → MSAG`
- [ ] Run `npm test` — all tests must pass

### Task 3: Mark `MESSAGES` as deprecated read alias

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `src/server/logger.ts` (if a deprecation helper is missing)
- Modify: `tests/unit/handlers/intent.test.ts`

- [ ] In `handleSAPRead`, when `type === 'MESSAGES'`, log a deprecation warning to
      stderr ("`MESSAGES` is deprecated; use `MSAG`") then route to the same handler
      as `MSAG`
- [ ] Add unit test: `SAPRead({ type: 'MESSAGES', name: 'XYZ' })` produces the same
      result as `MSAG` AND emits a deprecation log line
- [ ] Run `npm test` — all tests must pass

### Task 4: Rename `FTG2` → `FEATURE_TOGGLE`

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/probe/catalog.ts`
- Modify: `tests/unit/handlers/intent.test.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`

**Background**: The endpoint `/sap/bc/adt/sfw/featuretoggles/{name}/states` is real and
supported. Only the short identifier changes. Per
[`docs/research/abap-types/types/ftg2.md`](../../research/abap-types/types/ftg2.md), `FTG2`
is not in TADIR, not in abap-file-formats, and not in Eclipse apidoc — invented in
ARC-1, evidenced by `docs/compare/00-feature-matrix.md:97,108` showing ARC-1 as sole
implementer.

The audit briefly considered moving the endpoint to `SAPManage(action='get_feature_toggle')`
since feature toggles are arguably operational metadata rather than a "read" object. We
chose rename over move because: (a) the read shape (URL + name input) matches `SAPRead`
better than `SAPManage`, (b) cheaper migration (one identifier change vs cross-tool
move), (c) keeps the existing `name` parameter contract.

- [ ] In `SAPREAD_TYPES_ONPREM`, replace `'FTG2'` with `'FEATURE_TOGGLE'`. Keep `'FTG2'`
      in the enum during the deprecation window (so existing callers don't break).
- [ ] In `handleSAPRead`, route both `'FEATURE_TOGGLE'` and `'FTG2'` to the feature-toggle
      endpoint
- [ ] When `type === 'FTG2'`, log a deprecation warning ("`FTG2` is deprecated; use
      `FEATURE_TOGGLE`")
- [ ] Update `src/probe/catalog.ts` entry name from `FTG2` to `FEATURE_TOGGLE`
- [ ] Update `src/handlers/tools.ts` description to use `FEATURE_TOGGLE`, mention the
      deprecated `FTG2` alias once
- [ ] Add unit tests (~5 tests): `FEATURE_TOGGLE` read happy path; `FTG2` still works +
      emits deprecation log; schema accepts both; tool description has no
      undocumented `FTG2`
- [ ] Run `npm test` — all tests must pass

### Task 5: Integration round-trip tests

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`

- [ ] Add integration test: `SAPRead({ type: 'MSAG', name: '<known message class>' })`
      returns source; URL contains `/sap/bc/adt/messageclass/`
- [ ] Add integration test: `SAPRead({ type: 'FEATURE_TOGGLE', name: '<known toggle>' })`
      hits `/sap/bc/adt/sfw/featuretoggles/`
- [ ] Add integration test: `SAPRead({ type: 'FTG2', name: '<known toggle>' })` returns
      same content as `FEATURE_TOGGLE` (compat) and emits deprecation log
- [ ] Use `requireOrSkip` for missing creds; never empty catch
- [ ] Run `npm run test:integration` against a4h — must pass
- [ ] Run `npm test` — all tests must pass

### Task 6: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs_page/tools.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`

- [ ] CLAUDE.md — update Key Files / Code Patterns to reflect `MSAG` read,
      `FEATURE_TOGGLE`
- [ ] tools.md — `FEATURE_TOGGLE` example, deprecate `FTG2`/`MESSAGES` notes
- [ ] roadmap.md — entry under recent: "Read/write enum symmetry: MSAG read added;
      FTG2 renamed to FEATURE_TOGGLE; MESSAGES deprecated"
- [ ] docs/compare/00-feature-matrix.md — refresh "Last Updated"; rename FTG2 row to
      FEATURE_TOGGLE
- [ ] Run `npm test` — all tests must pass

### Task 7: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Run integration: `npm run test:integration` against a4h — passes
- [ ] Manual verify on a4h: MSAG read works, FEATURE_TOGGLE read works, FTG2 still works
      with deprecation warning
- [ ] Move this plan to `docs/plans/completed/`
