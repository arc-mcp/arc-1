# PR-E TADIR Lookup And Batch Create Package Fix

## Overview

This plan implements PR-E from the RAP migration run notes: add a reliable cross-package TADIR-style object lookup and fix `SAPWrite(action="batch_create")` so package and transport values supplied on individual objects are honored. The lookup should use ADT repository quick search instead of `SAPQuery` against `TADIR`, because the S/4 7.58 test system rejects long `WHERE OBJ_NAME IN (...)` lists once the SQL literal grows past 255 characters.

The key design decision is to expose lookup through `SAPSearch` as `searchType="tadir_lookup"`, backed by `/sap/bc/adt/repository/informationsystem/search?operation=quickSearch`. Eclipse ADT apidoc 3.58.1 describes quick search as a lightweight direct TADIR-based search when search providers are not requested, and live S/4 7.58 probes returned exact object type, package, description, and URI for `ZDM_PROJECT_D`, `ZR_DM_PROJECT`, and `ZUI_DM_PROJECTS_O4`.

## Context

### Current State

`SAPSearch` supports object-name search and source-code search, but it has no exact batch lookup mode. The migration skill therefore fell back to `SAPQuery` against `TADIR`; on S/4 7.58, a 12-name `IN (...)` query failed with a 400 parser error about a text literal longer than 255 characters. `batch_create` also reads only top-level `package` and `transport`, while the migration skill naturally emits per-object `{ package, transport }` entries; Zod currently strips those unknown object fields, so the handler defaults the whole batch to `$TMP`.

### Target State

`SAPSearch(searchType="tadir_lookup", names=[...], objectTypes=[...])` returns exact per-name lookup results with matches grouped by requested name and missing names called out. It uses repository search, not free SQL, and supports optional type narrowing. `SAPWrite(action="batch_create")` accepts per-object package and transport values, checks every target package against safety allowlists before mutating, performs transport preflight per effective package, and uses the effective object package in create XML, `_package` query parameters where required, source writes, and result summaries.

### Key Files

| File | Role |
|------|------|
| `src/adt/client.ts` | Add repository-search backed lookup helper and optional object type query parameter support. |
| `src/handlers/intent.ts` | Route `SAPSearch searchType="tadir_lookup"` and apply per-object package/transport in `batch_create`. |
| `src/handlers/schemas.ts` | Add `tadir_lookup`, `names`, `objectTypes`, and per-object `package`/`transport` validation. |
| `src/handlers/tools.ts` | Update MCP tool descriptions and JSON schema properties. |
| `tests/unit/adt/client.test.ts` | Cover lookup URL construction and parsing. |
| `tests/unit/handlers/intent.test.ts` | Cover lookup response shape and batch per-object package/transport propagation. |
| `tests/unit/handlers/schemas.test.ts` | Cover new schema acceptance/rejection cases. |
| `tests/unit/handlers/tools.test.ts` | Cover exposed tool properties and descriptions. |
| `docs_page/tools.md` | Document TADIR lookup and batch object package behavior. |
| `docs_page/mcp-usage.md` | Update batch_create examples and TADIR lookup guidance. |
| `docs_page/roadmap.md` | Mark PR-E items as implemented or add a completed note. |
| `docs/compare/00-feature-matrix.md` | Add/update the object lookup capability if needed. |
| `skills/generate-rap-service-researched.md` | Update RAP creation guidance to use object-level package/transport and lookup. |

### Design Principles

1. Prefer ADT repository search for object directory lookup because it is available without enabling freestyle SQL and matches Eclipse ADT's quick search contract.
2. Preserve existing `SAPSearch(query="Z*")` behavior; `tadir_lookup` is opt-in and exact-match filtered.
3. Preserve existing top-level `batch_create` package and transport behavior; per-object fields override the top-level defaults only for that object.
4. Fail before mutating if any effective package is disallowed or clearly requires a transport that is not available.
5. Keep the response compact but structured enough for agents to decide whether to delete, update, or create objects.

## Development Approach

Implement the lookup helper first so handler tests can mock a single parser contract. Then adjust schemas/tools, wire `SAPSearch`, and fix `batch_create` package propagation. Add focused unit tests around exact behavior and update docs/skills. Use live S/4 7.58 probes as research evidence, but keep CI tests mocked and deterministic; NW 7.50 compatibility is covered by existing probe fixtures proving repository search exists on supported 7.50 landscapes.

## Validation Commands

- `npm test -- tests/unit/adt/client.test.ts tests/unit/handlers/intent.test.ts tests/unit/handlers/schemas.test.ts tests/unit/handlers/tools.test.ts`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add Repository Search Lookup Helper

**Files:**
- Modify: `src/adt/client.ts`
- Modify: `src/adt/types.ts` if a shared lookup result type is useful
- Modify: `tests/unit/adt/client.test.ts`

Add a client helper that runs quick search for exact object names and optional object types, returning grouped lookup results without using `SAPQuery`.

- [x] Add `lookupObjects(names, options)` or equivalent to `AdtClient`, using `/sap/bc/adt/repository/informationsystem/search?operation=quickSearch`.
- [x] Support optional `objectTypes` by adding `objectType=<type>` to the search URL; when no types are provided, use the default quick-search mode.
- [x] Exact-filter returned references by object name after parsing so wildcard or substring hits do not count as found.
- [x] Dedupe duplicate references by type, name, package, and URI.
- [x] Add unit tests for default lookup, typed lookup, exact-match filtering, URL encoding, and missing results.
- [x] Run `npm test -- tests/unit/adt/client.test.ts`.

### Task 2: Wire SAPSearch TADIR Lookup

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`
- Modify: `tests/unit/handlers/tools.test.ts`

Expose exact lookup through `SAPSearch(searchType="tadir_lookup")`, accepting either `names` or a comma/whitespace-separated `query`.

- [x] Extend `SAPSearchSchema` and no-source variant with `searchType="tadir_lookup"`, optional `names: string[]`, and optional `objectTypes: string[]`.
- [x] Keep `query` required for `object` and `source_code`; require at least one lookup name for `tadir_lookup`.
- [x] Update `buildSAPSearchTool()` so tool descriptions and JSON schema explain `tadir_lookup`, `names`, and `objectTypes`.
- [x] In `handleSAPSearch`, route `tadir_lookup` to the new client helper and return JSON with `count`, `lookups`, and `missing`.
- [x] Add handler/schema/tool tests for names-array lookup, query-string lookup, typed lookup, missing names, and validation errors.
- [x] Run `npm test -- tests/unit/handlers/intent.test.ts tests/unit/handlers/schemas.test.ts tests/unit/handlers/tools.test.ts`.

### Task 3: Fix batch_create Per-Object Package And Transport

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`
- Modify: `tests/unit/handlers/tools.test.ts`

Honor `package` and `transport` supplied on each `objects[]` item while preserving top-level defaults.

- [x] Add optional `package` and `transport` fields to batch object schemas and tool JSON schema.
- [x] Compute `effectivePackage = object.package ?? args.package ?? "$TMP"` and `effectiveTransport = object.transport ?? args.transport ?? autoDetectedTransportForPackage`.
- [x] Check every unique effective package with `checkPackage()` before creating the first object.
- [x] Run transport preflight per unique non-`$TMP` effective package when no explicit transport is available for that package.
- [x] Use `effectivePackage` in `buildCreateXml()`, `_package` query parameters for BDEF/TABL, and success/failure summaries.
- [x] Use `effectiveTransport` for create, post-create metadata update, source write, and MSAG transport-vs-task validation.
- [x] Add tests for object-level package without top-level package, object-level transport overriding top-level transport, mixed packages in one batch, and package allowlist rejection before mutation.
- [x] Run `npm test -- tests/unit/handlers/intent.test.ts tests/unit/handlers/schemas.test.ts tests/unit/handlers/tools.test.ts`.

### Task 4: Update Documentation And Skills

**Files:**
- Modify: `docs_page/tools.md`
- Modify: `docs_page/mcp-usage.md`
- Modify: `docs_page/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md` if the matrix has a suitable lookup row
- Modify: `skills/generate-rap-service-researched.md`
- Modify: `CLAUDE.md` if the Key Files table should mention TADIR lookup

Document the new user-visible behavior so agents stop using fragile long `SAPQuery` `IN` lists for object-existence checks.

- [x] Add `SAPSearch(searchType="tadir_lookup", names=[...])` examples to tool and MCP usage docs.
- [x] Update `batch_create` docs to state that object-level `package` and `transport` are accepted and override top-level defaults.
- [x] Update the RAP generation skill to use `tadir_lookup` in reset/preflight and to allow per-object package/transport in `batch_create`.
- [x] Update roadmap/matrix only where an existing PR-E or object-lookup capability entry exists.
- [x] Run `npm test -- tests/unit/handlers/tools.test.ts`.

### Task 5: Final Verification And Review

**Files:**
- Review: all modified files

Run focused and broad verification, then review the implementation for edge cases before opening the PR.

- [x] Run focused unit tests: `npm test -- tests/unit/adt/client.test.ts tests/unit/handlers/intent.test.ts tests/unit/handlers/schemas.test.ts tests/unit/handlers/tools.test.ts`.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint`.
- [x] Run live S/4 7.58 smoke checks if credentials are available: `SAPSearch(searchType="tadir_lookup", names=["ZDM_PROJECT_D","ZR_DM_PROJECT","ZUI_DM_PROJECTS_O4"])` and a dry batch package URL/unit-level check.
- [x] Review the diff for accidental schema regressions, safety bypasses, and unrelated changes.
- [x] Move this plan to `docs/plans/completed/`.
