# Transport Enhancements (FEAT-19 + FEAT-39)

## Overview

Extend `SAPTransport` with the full CTS lifecycle: delete transport/task, reassign owner, transport type selection (K/W/T/S/R), recursive release, and transport contents listing. This subsumes FEAT-19 (transport contents) into the broader FEAT-39 (transport enhancements).

**SAP test system validation** confirmed all planned endpoints work on A4H:
- `DELETE /sap/bc/adt/cts/transportrequests/{id}` → HTTP 200 (idempotent; 400 if already released)
- Create with types K, W, T all return HTTP 201 (S and R need further testing — may require specific CTS config)
- Change owner via `POST /{id}` with `tm:useraction="changeowner"` → HTTP 200
- Transport contents (E071 objects): **NOT included** in GET response on trial system — the `addobject` mechanism requires proper CTS layer config. However, the `getTransport()` response XML already has the structure for `<tm:task>` nodes, and task objects would appear as nested `<tm:abap_object>` elements when the system records them. For now, we enhance parsing to capture whatever the system returns, and note that transport contents depend on CTS configuration.

**Reference implementation: [sapcli](https://github.com/jfilak/sapcli)** (`sap/adt/cts.py`) — trusted reference for CTS ADT operations. Key patterns adopted:
- XML element for objects is `tm:abap_object` (with underscore), attributes: `tm:pgmid`, `tm:type`, `tm:name`, `tm:wbtype`, `tm:obj_desc`/`tm:obj_info`, `tm:lock_status`, `tm:position`
- All three operations (delete, reassign, release) support `recursive` — release children first, skip already-released (status `R`)
- Release response should be parsed for success/failure report (`ReleaseResponseHandler` in sapcli)
- List transports sends dual Accept: `transportorganizertree.v1+xml, transportorganizer.v1+xml`
- sapcli uses `PUT` for reassign with `tm:targetuser` attribute on root element; our A4H test showed `PUT` returns 400 but `POST` with nested `<tm:request tm:owner="...">` works — we use POST (likely SAP version difference, both are valid)
- Create payload includes `tm:useraction="newrequest"` and a nested `<tm:task tm:owner="{owner}"/>` — we omit these as SAP accepts the simpler form

**Bugs found during testing:**
- `getTransport()` uses `CTS_ACCEPT_TREE` but should use `CTS_CONTENT_TYPE_ORGANIZER` — works via 406/415 retry fallback but wastes a round-trip
- `releaseTransport()` same issue — uses `CTS_ACCEPT_TREE` instead of `CTS_CONTENT_TYPE_ORGANIZER`

These bugs will be fixed as part of this plan.

## Context

### Current State

ARC-1 supports 4 transport actions: `list`, `get`, `create` (Workbench/K only), `release`. sapcli has full CTS lifecycle including delete, reassign, 5 transport types, recursive release, and `-rrr` detail levels showing objects.

Current code:
- `src/adt/transport.ts` — 4 functions: `listTransports`, `getTransport`, `createTransport`, `releaseTransport`
- `src/handlers/intent.ts:1806-1841` — `handleSAPTransport()` switch on 4 actions
- `src/handlers/schemas.ts:216-221` — Zod schema with `action: z.enum(['list', 'get', 'create', 'release'])`
- `src/handlers/tools.ts:647-663` — Tool definition with 4 enum values
- `src/adt/safety.ts:172-193` — `checkTransport()` with `enableTransports`, `transportReadOnly`, `allowedTransports`

### Target State

SAPTransport supports 7 actions: `list`, `get`, `create`, `release`, `delete`, `reassign`, `release_recursive`. Create accepts a `type` parameter (K/W/T). Delete and reassign also support a `recursive` flag (matching sapcli). Get response includes task objects when available.

### Key Files

| File | Role |
|------|------|
| `src/adt/transport.ts` | Core transport ADT operations — add `deleteTransport()`, `reassignTransport()`, enhance `createTransport()`, `releaseTransport()`, fix Accept headers |
| `src/adt/types.ts` | Transport types — add `TransportObject` interface, extend `TransportTask` with `objects` field |
| `src/handlers/intent.ts` | Tool handler — add `delete`, `reassign`, `release_recursive` cases |
| `src/handlers/schemas.ts` | Zod validation — extend `SAPTransportSchema` with new actions and params |
| `src/handlers/tools.ts` | Tool definition — add new actions, `type`, `owner` params |
| `src/adt/safety.ts` | Safety — `deleteTransport` and `reassignTransport` are write ops |
| `tests/unit/adt/transport.test.ts` | Unit tests for transport functions |
| `tests/unit/handlers/intent.test.ts` | Unit tests for handler routing |
| `tests/integration/transport.integration.test.ts` | Integration tests against live SAP |
| `tests/e2e/saptransport.e2e.test.ts` | E2E tests via MCP client |

### Design Principles

1. **All new actions gated by `checkTransport()`** — delete and reassign are write operations (`isWrite: true`), matching create/release behavior.
2. **Transport type limited to K/W/T** — Development-Correction (S) and Repair (R) require specific CTS config that most systems lack. Start with the 3 types confirmed working on the test system.
3. **Recursive release is a new action, not a flag** — `release_recursive` as a distinct action prevents accidental recursive release when the LLM only intends single release. Delete and reassign accept a `recursive` boolean parameter (matching sapcli pattern).
4. **Transport contents parsing is best-effort** — The GET response includes task objects only when the system records them. Parse whatever is available, don't fail if missing. Object attributes follow sapcli's `WorkbenchABAPObject` model: `pgmid`, `type`, `name`, `wbtype`, `description`, `locked`, `position`.
5. **Fix Accept header bugs opportunistically** — `getTransport()` and `releaseTransport()` should use `CTS_CONTENT_TYPE_ORGANIZER`, not `CTS_ACCEPT_TREE`.
6. **Follow sapcli patterns** — sapcli (`sap/adt/cts.py`) is the trusted reference implementation. Follow its XML structures, attribute names, and recursive operation patterns.

## Development Approach

Tasks are ordered: types first, then core transport functions, then handler wiring, then tests, then docs. Each task is self-contained with full context for autonomous execution.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Extend transport types and fix Accept headers

**Files:**
- Modify: `src/adt/types.ts`
- Modify: `src/adt/transport.ts`

Add types for transport objects and fix the Accept header bugs found during SAP system testing.

- [ ] In `src/adt/types.ts`, add `TransportObject` interface after the `TransportTask` interface (line ~110). Follow sapcli's `WorkbenchABAPObject` model from `sap/adt/cts.py`:
  ```typescript
  export interface TransportObject {
    pgmid: string;       // e.g., "R3TR", "LIMU" — from tm:pgmid
    type: string;        // e.g., "PROG", "CLAS", "TABD" — from tm:type
    name: string;        // e.g., "ZTEST_PROGRAM" — from tm:name
    wbtype: string;      // 2-letter workbench type code — from tm:wbtype
    description: string; // object description — from tm:obj_desc or tm:obj_info
    locked: boolean;     // lock status — from tm:lock_status ('X' = locked)
    position: string;    // 6-digit zero-padded position — from tm:position
  }
  ```
- [ ] In `src/adt/types.ts`, add `objects: TransportObject[]` to the `TransportTask` interface (line ~105-110)
- [ ] In `src/adt/transport.ts`, fix `getTransport()` (line 50): change `Accept: CTS_ACCEPT_TREE` to `Accept: CTS_CONTENT_TYPE_ORGANIZER` — the single-transport endpoint requires the organizer media type, not the tree variant
- [ ] In `src/adt/transport.ts`, fix `releaseTransport()` (line 89): change `Accept: CTS_ACCEPT_TREE` to `Accept: CTS_CONTENT_TYPE_ORGANIZER` — same issue
- [ ] In `src/adt/transport.ts`, update `parseTransportList()` (line ~100-116) to extract `<tm:abap_object>` nodes (note: underscore in element name, per sapcli's SAX handler) from within each `<tm:task>` element. Map attributes: `@_pgmid` → `pgmid`, `@_type` → `type`, `@_name` → `name`, `@_wbtype` → `wbtype` (default `''`), `@_obj_desc` or `@_obj_info` → `description` (default `''`), `@_lock_status` → `locked` (`'X'` = true), `@_position` → `position` (default `'000000'`). Use `findDeepNodes(task, 'abap_object')` for extraction.
- [ ] Run `npm test` — all tests must pass (some transport unit tests may need Accept header assertions updated)

### Task 2: Add deleteTransport, reassignTransport, and enhance createTransport

**Files:**
- Modify: `src/adt/transport.ts`

Add the three new transport operations to the ADT layer.

- [ ] Add `deleteTransport(http, safety, transportId, recursive?)` function. SAP endpoint: `DELETE /sap/bc/adt/cts/transportrequests/{id}`. Use `checkTransport(safety, transportId, 'DeleteTransport', true)` — it's a write operation. The endpoint is idempotent (returns 200 even for non-existent transports) but returns 400 for already-released transports. When `recursive=true`, first fetch the transport via `getTransport()`, then delete all unreleased tasks (status !== 'R') before deleting the parent — matching sapcli's `_delete_children()` pattern.
- [ ] Add `reassignTransport(http, safety, transportId, newOwner, recursive?)` function. SAP endpoint: `POST /sap/bc/adt/cts/transportrequests/{id}` with body:
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <tm:root xmlns:tm="http://www.sap.com/cts/adt/tm" tm:useraction="changeowner">
    <tm:request tm:number="{id}" tm:owner="{newOwner}"/>
  </tm:root>
  ```
  Use `CTS_CONTENT_TYPE_ORGANIZER` for both Content-Type and Accept. Use `checkTransport(safety, transportId, 'ReassignTransport', true)`. When `recursive=true`, first reassign all unreleased tasks before the parent — matching sapcli's `_reassign_children()` pattern. Note: sapcli uses `PUT` with `tm:targetuser` on root, but our A4H testing confirmed `POST` with nested `<tm:request tm:owner>` works; `PUT` returned 400. Use POST.
- [ ] Enhance `createTransport()` (line ~58-79) to accept an optional `transportType` parameter (default `'K'`). Replace the hardcoded `tm:type="K"` on line 68 with `tm:type="${escapeXml(transportType)}"`. Valid values are `'K'` (Workbench), `'W'` (Customizing), `'T'` (Transport of Copies).
- [ ] Run `npm test` — all tests must pass

### Task 3: Add recursive release

**Files:**
- Modify: `src/adt/transport.ts`

Add a function that releases all unreleased tasks of a transport before releasing the transport itself. This is the equivalent of sapcli's recursive release behavior.

- [ ] Add `releaseTransportRecursive(http, safety, transportId)` function. First call `getTransport()` to fetch the transport and its tasks. Then iterate over tasks where `status !== 'R'` (not yet released) and call `releaseTransport()` for each task ID. Finally call `releaseTransport()` on the parent transport ID. Use `checkTransport(safety, transportId, 'ReleaseTransportRecursive', true)`.
- [ ] Return a summary object: `{ released: string[] }` listing all IDs that were released (tasks + request), in order.
- [ ] Run `npm test` — all tests must pass

### Task 4: Wire new actions into handler, schema, and tool definition

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `src/handlers/intent.ts`

Connect the new transport functions to the MCP tool interface.

- [ ] In `src/handlers/schemas.ts` (line ~216-221), extend `SAPTransportSchema`:
  - Add `'delete'`, `'reassign'`, `'release_recursive'` to the `action` enum
  - Add `type: z.enum(['K', 'W', 'T']).optional()` for transport type selection on create
  - Add `owner: z.string().optional()` for reassign target
  - Add `recursive: z.boolean().optional()` for recursive delete/reassign (matches sapcli's `--recursive` flag)
- [ ] In `src/handlers/tools.ts` (line ~647-663), update the SAPTransport tool definition:
  - Extend the `action` enum: `['list', 'get', 'create', 'release', 'delete', 'reassign', 'release_recursive']`
  - Add `type` property: `{ type: 'string', enum: ['K', 'W', 'T'], description: 'Transport type for create: K=Workbench (default), W=Customizing, T=Transport of Copies' }`
  - Add `owner` property: `{ type: 'string', description: 'New owner (for reassign)' }`
  - Add `recursive` property: `{ type: 'boolean', description: 'Apply recursively to tasks (for delete/reassign). release_recursive always recurses.' }`
  - Update the tool description string (both `SAPTRANSPORT_DESC_ONPREM` and `SAPTRANSPORT_DESC_BTP`) to mention new actions
- [ ] In `src/handlers/intent.ts` (line ~1806-1841), add cases to the `handleSAPTransport()` switch:
  - `case 'delete'`: require `id`, pass `recursive` boolean, call `deleteTransport()`, return success message
  - `case 'reassign'`: require `id` and `owner`, pass `recursive` boolean, call `reassignTransport()`, return success message
  - `case 'release_recursive'`: require `id`, call `releaseTransportRecursive()`, return JSON of released IDs
  - For `case 'create'`: pass `args.type` (cast to string, default `'K'`) as the new `transportType` parameter
  - Update the default error message to list all 7 supported actions
- [ ] Import the new functions (`deleteTransport`, `reassignTransport`, `releaseTransportRecursive`) in `intent.ts`
- [ ] Run `npm test` — all tests must pass

### Task 5: Unit tests for new transport functions

**Files:**
- Modify: `tests/unit/adt/transport.test.ts`

Add comprehensive unit tests for the new transport operations. The existing test file has 28 tests following patterns with `vi.fn()` mock HTTP clients and `enabledSafety` config.

- [ ] Add tests for `deleteTransport()` (~7 tests):
  - Blocked when transports not enabled
  - Blocked when transport read-only
  - Sends DELETE to correct URL with encoded transport ID
  - Succeeds on HTTP 200
  - Verify it passes correct headers
  - Recursive: deletes unreleased tasks before parent (verify call order — tasks first, then parent)
  - Recursive: skips already-released tasks (status 'R')
- [ ] Add tests for `reassignTransport()` (~7 tests):
  - Blocked when transports not enabled
  - Blocked when transport read-only
  - Sends POST with correct XML body containing `tm:useraction="changeowner"` and new owner
  - Escapes special characters in owner name
  - Uses correct CTS_CONTENT_TYPE_ORGANIZER media type
  - Recursive: reassigns unreleased tasks before parent
  - Recursive: skips already-released tasks (status 'R')
- [ ] Add tests for `createTransport()` with transport type (~3 tests):
  - Default type is 'K' when not specified (existing behavior preserved)
  - Type 'W' included in XML body as `tm:type="W"`
  - Type 'T' included in XML body as `tm:type="T"`
- [ ] Add tests for `releaseTransportRecursive()` (~4 tests):
  - Blocked when transports not enabled
  - Releases unreleased tasks before parent (verify call order via mock)
  - Skips already-released tasks (status 'R')
  - Returns list of all released IDs in order
- [ ] Add tests for Accept header fixes (~2 tests):
  - `getTransport()` sends `CTS_CONTENT_TYPE_ORGANIZER` Accept header (was `CTS_ACCEPT_TREE`)
  - `releaseTransport()` sends `CTS_CONTENT_TYPE_ORGANIZER` Accept header (was `CTS_ACCEPT_TREE`)
- [ ] Add tests for transport object parsing (~3 tests):
  - Tasks with `<tm:abap_object>` elements (underscore in name, per sapcli) parsed into `objects` array with all fields: pgmid, type, name, wbtype, description, locked, position
  - Tasks without objects return empty `objects` array
  - Object with `tm:lock_status="X"` parses as `locked: true`, missing/empty parses as `locked: false`
- [ ] Run `npm test` — all tests must pass

### Task 6: Unit tests for handler routing

**Files:**
- Modify: `tests/unit/handlers/intent.test.ts`

Add handler-level tests for the new SAPTransport actions. Follow existing patterns in the file — search for "SAPTransport" to find the existing test block.

- [ ] Add test for `delete` action: verifies `deleteTransport()` called with correct transport ID
- [ ] Add test for `delete` without ID: returns error result
- [ ] Add test for `reassign` action: verifies `reassignTransport()` called with ID and owner
- [ ] Add test for `reassign` without owner: returns error result
- [ ] Add test for `release_recursive` action: verifies `releaseTransportRecursive()` called
- [ ] Add test for `create` with `type: 'W'`: verifies type passed through to `createTransport()`
- [ ] Add test for `create` without type: defaults to `'K'`
- [ ] Run `npm test` — all tests must pass

### Task 7: Integration tests

**Files:**
- Modify: `tests/integration/transport.integration.test.ts`

Add integration tests for the new transport operations. The existing file creates transports in the test SAP system and validates responses. Tests require `TEST_SAP_URL` env vars and use `getTestClient()` factory with `enableTransports: true`.

- [ ] Add integration test for delete: create a transport, then delete it, then verify `getTransport()` returns null
- [ ] Add integration test for create with type 'W': create a Customizing transport, verify it has type 'W', then clean up (delete)
- [ ] Add integration test for create with type 'T': create a Transport of Copies, verify type 'T', then clean up
- [ ] Add integration test for reassign: create a transport, reassign to same user (safe — we know the user exists), verify owner is updated via `getTransport()`, clean up
- [ ] Add integration test for recursive release: create a transport, call `releaseTransportRecursive()`, verify transport status is 'R'. Note: on A4H trial, tasks may not exist on fresh transports, so recursive release should still work (just releases the request)
- [ ] Use `try/finally` for cleanup (delete transports). Tag cleanup catches with `// best-effort-cleanup`
- [ ] Run `npm run test:integration` if SAP credentials are available, otherwise just run `npm test`

### Task 8: E2E tests

**Files:**
- Modify: `tests/e2e/saptransport.e2e.test.ts`

Add E2E tests for the new transport actions via MCP client. The existing file uses `connectClient()`, `callTool()`, `expectToolSuccess()` from `tests/e2e/helpers.ts`.

- [ ] Add E2E test for `delete`: create transport, then call SAPTransport with `action: 'delete'`, verify success message
- [ ] Add E2E test for `create` with `type: 'W'`: create Customizing transport, verify success, clean up with delete
- [ ] Add E2E test for `reassign`: create transport, reassign to same user, verify success
- [ ] Add E2E test for `release_recursive`: create transport, call with `action: 'release_recursive'`, verify released IDs in response
- [ ] Add E2E test for unknown action error message: verify it now lists all 7 actions
- [ ] Use `try/finally` with best-effort cleanup (delete transports). Tag catches with `// best-effort-cleanup`
- [ ] Run `npm test` — all tests must pass (E2E tests require running server)

### Task 9: Documentation updates

**Files:**
- Modify: `docs/tools.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `CLAUDE.md`

Update all affected documentation artifacts.

- [ ] In `docs/tools.md`, update the SAPTransport section:
  - Add `delete`, `reassign`, `release_recursive` to the action enum
  - Add `type` parameter (K/W/T) for create
  - Add `owner` parameter for reassign
  - Update examples to show new actions
- [ ] In `docs/roadmap.md`:
  - Update FEAT-19 status to "Completed" (subsumed by FEAT-39 implementation)
  - Update FEAT-39 status to "Completed"
  - Add note about which transport types are supported and which are deferred (S, R)
- [ ] In `docs/compare/00-feature-matrix.md`, section "9. Transport / CTS" (line ~151-162):
  - Update "Transport contents" row: change ARC-1 from `❌` to `⚠️ (parsed when available)`
  - Update "Transport assign" row: change ARC-1 from `❌` to `✅`
  - Add row for "Delete transport": ARC-1 `✅`, fill other columns based on existing data
  - Add row for "Transport types" showing ARC-1 `⚠️ (K/W/T)` vs sapcli `✅ (5 types: K/W/T/S/R)`
  - Add row for "Recursive release": ARC-1 `✅` vs sapcli `✅ (recursive)`
  - Update "Last updated" date
- [ ] In `CLAUDE.md`:
  - No structural changes needed — the config table already has `SAP_ENABLE_TRANSPORTS`, and the Key Files table already references `src/adt/transport.ts` and `src/handlers/intent.ts`
- [ ] Run `npm run lint` — no errors

### Task 10: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Verify the new actions appear in the tool schema when `enableTransports=true` by inspecting `src/handlers/tools.ts`
- [ ] Verify safety gates: `deleteTransport` and `reassignTransport` are blocked by `transportReadOnly` and `!enableTransports`
- [ ] Move this plan to `docs/plans/completed/`
