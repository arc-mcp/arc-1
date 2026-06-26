# Phase 1: ADT Filestore Read Operations

## Overview

Add read-only BSP/UI5 app browsing capabilities to ARC-1 via the ADT Filestore API (`/sap/bc/adt/filestore/ui5-bsp/objects`). This enables listing deployed Fiori apps, browsing their file structure, and reading individual files — useful for understanding existing apps, verifying deployments, and debugging UI5 issues.

The ADT Filestore is **read-only** (write operations return HTTP 405). ARC-1 already probes for this feature at `src/adt/features.ts:38`. This plan implements the read operations and exposes them via `SAPRead(type="BSP")`.

## Context

### Current State

- Feature probe exists: `{ id: 'ui5', endpoint: '/sap/bc/adt/filestore/ui5-bsp' }` at `src/adt/features.ts:38`
- No client methods, handlers, or tool types for BSP app operations
- The `ui5` feature status is resolved but never used for gating tool availability

### Target State

- `SAPRead(type="BSP")` — list deployed BSP apps (with optional name search)
- `SAPRead(type="BSP", name="ZAPP_BOOKING")` — browse root file structure
- `SAPRead(type="BSP", name="ZAPP_BOOKING", include="i18n")` — browse subfolder
- `SAPRead(type="BSP", name="ZAPP_BOOKING", include="manifest.json")` — read file content
- Feature-gated: BSP type only available when `features.ui5.available === true`

### Key Files

| File | Role |
|------|------|
| `src/adt/client.ts` | ADT client facade — add BSP read methods (line ~264 near `getSrvb`) |
| `src/adt/types.ts` | ADT response types — add `BspAppInfo`, `BspFileNode` |
| `src/adt/xml-parser.ts` | XML parser — add Atom feed parsers for BSP responses |
| `src/handlers/schemas.ts` | Zod schemas — add `BSP` to SAPRead type enum (line ~17, ~45) |
| `src/handlers/tools.ts` | Tool descriptions — add BSP to SAPRead descriptions (line ~87, ~90) |
| `src/handlers/intent.ts` | Intent handler — add BSP case in SAPRead handler (line ~483 near `SRVB`) |
| `tests/unit/adt/client.test.ts` | Client unit tests |
| `tests/unit/handlers/intent.test.ts` | Handler unit tests |
| `tests/fixtures/xml/` | XML fixture files for Atom feed responses |

### Design Principles

1. Follow existing ADT client pattern: safety check → HTTP call → parse response (see `getSrvb` at `src/adt/client.ts:264-270`)
2. Use `fast-xml-parser` with `removeNSPrefix: true` (shared parser at `src/adt/xml-parser.ts:27`)
3. The filestore URL encoding is critical: path separator `/` must be percent-encoded as `%2f` — the entire `appName + path` is a single URL segment via `encodeURIComponent()`
4. Normalize single entry vs array in Atom feed responses (SAP returns object instead of array when only one entry)
5. Feature-gate BSP type: only include in SAPRead when `features.ui5.available`

## Development Approach

Standard unit test approach with mock HTTP responses. Create Atom XML fixture files based on real SAP response format (documented in `docs/plans/2026-04-09-fiori-deployment-api-reference.md` Part 2). No integration tests needed — the API is read-only and low risk.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add BSP types and Atom XML parser

**Files:**
- Modify: `src/adt/types.ts`
- Modify: `src/adt/xml-parser.ts`
- Create: `tests/fixtures/xml/bsp-app-list.xml`
- Create: `tests/fixtures/xml/bsp-folder-listing.xml`

Add TypeScript interfaces for BSP app info and file nodes, then implement Atom XML parsers for the filestore responses.

- [x] Add `BspAppInfo` interface to `src/adt/types.ts`: `{ name: string; description: string }`
- [x] Add `BspFileNode` interface to `src/adt/types.ts`: `{ name: string; path: string; type: 'file' | 'folder'; etag?: string }`
- [x] Add `parseBspAppList(xml: string): BspAppInfo[]` to `src/adt/xml-parser.ts` — parse Atom feed with entries where `title` is app name and `summary` is description
- [x] Add `parseBspFolderListing(xml: string, appName: string): BspFileNode[]` to `src/adt/xml-parser.ts` — parse Atom feed, detect file vs folder via `<category term="file|folder"/>`, extract name from `title.split('/').pop()`, path from `title.substring(appName.length)`, etag from `content['@_afr:etag']`
- [x] Handle single-entry normalization: `Array.isArray(feed.entry) ? feed.entry : feed.entry ? [feed.entry] : []`
- [x] Create fixture files in `tests/fixtures/xml/` with realistic Atom XML (use format from `docs/plans/2026-04-09-fiori-deployment-api-reference.md` Part 2 section 2.3)
- [x] Add unit tests (~6 tests) for both parsers: happy path, empty results, single entry, folder detection, file etag extraction
- [x] Run `npm test` — all tests must pass

### Task 2: Add BSP client methods

**Files:**
- Modify: `src/adt/client.ts`

Add three methods to the `AdtClient` class for BSP read operations. Place them after `getSrvb()` (line ~270).

- [x] Add `listBspApps(query?: string, maxResults?: number): Promise<BspAppInfo[]>` — `GET /sap/bc/adt/filestore/ui5-bsp/objects` with optional `name` and `maxResults` query params. Accept header: `application/atom+xml`. Safety check: `checkOperation(safety, OperationType.Read, 'ListBSPApps')`
- [x] Add `getBspAppStructure(appName: string, subPath?: string): Promise<BspFileNode[]>` — `GET /sap/bc/adt/filestore/ui5-bsp/objects/${encodeURIComponent(appName.toUpperCase() + (subPath || ''))}/content`. Accept: `application/xml`. Content-Type: `application/atom+xml`. Safety check: `checkOperation(safety, OperationType.Read, 'GetBSPApp')`
- [x] Add `getBspFileContent(appName: string, filePath: string): Promise<string>` — `GET /sap/bc/adt/filestore/ui5-bsp/objects/${encodeURIComponent(appName.toUpperCase() + '/' + filePath)}/content`. Accept: `application/xml`. Content-Type: `application/octet-stream`. Returns raw text body. Safety check: `checkOperation(safety, OperationType.Read, 'GetBSPFile')`
- [x] Ensure `subPath` parameter starts with `/` when non-empty; strip leading `/` from `filePath` before combining
- [x] Add unit tests (~8 tests) in `tests/unit/adt/client.test.ts`: list apps, list with query, browse root, browse subfolder, read file, URL encoding verification (check the `%2f` in the request URL), safety block test, empty results
- [x] Run `npm test` — all tests must pass

### Task 3: Wire up SAPRead handler and schema

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/handlers/intent.ts`

Expose BSP operations via the existing SAPRead tool.

- [x] Add `'BSP'` to `SAPREAD_TYPES_ONPREM` array at `src/handlers/schemas.ts:17` and `SAPREAD_TYPES_BTP` array at line ~45
- [x] Update SAPRead description strings in `src/handlers/tools.ts` (both `SAPREAD_DESC_ONPREM` at line ~87 and `SAPREAD_DESC_BTP` at line ~90) to include: `BSP (deployed UI5/Fiori apps — list apps, browse files, read content; use name to browse app structure, include for subfolder or file)`
- [x] Add BSP case in `handleSAPRead` at `src/handlers/intent.ts` (near line ~483, after the SRVB case). Logic: if no `name` → `client.listBspApps(args.name)` (search); if `name` without `include` → `client.getBspAppStructure(name)`; if `name` with `include` that has an extension (contains `.`) → `client.getBspFileContent(name, include)`; otherwise → `client.getBspAppStructure(name, '/' + include)`
- [x] Add handler unit tests (~5 tests) in `tests/unit/handlers/intent.test.ts`: list BSP apps, browse app structure, browse subfolder, read file content, feature gate (should error or fallback when ui5 feature unavailable)
- [x] Run `npm test` — all tests must pass

### Task 4: Final verification

- [x] Run full test suite: `npm test` — all tests pass
- [x] Run typecheck: `npm run typecheck` — no errors
- [x] Run lint: `npm run lint` — no errors
- [x] Verify BSP type appears in SAPRead tool schema when listing tool definitions
- [x] Move this plan to `docs/plans/completed/`
