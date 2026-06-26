# FEAT-49: Object Transport History (Reverse Lookup)

## Overview

This plan adds a new `SAPTransport(action="history", type, name)` action that, given an ABAP object (type + name), returns the related transport requests for that object — the reverse lookup of "what transports touched this object?". Today ARC-1 supports the forward direction (`SAPTransport(action="get", id)` lists objects in a transport) but not the reverse, which is the missing piece for the fr0ster#30 transport-scoped code review workflow (combine with FEAT-20 source revisions and FEAT-24 diff).

The implementation uses the per-object ADT endpoint `GET {objectUrl}/transports` (advertised as `rel="http://www.sap.com/adt/relations/transport"` in the object structure response) as the **primary source**. When that endpoint returns no related transports, we **fall back** to the existing `transportchecks` endpoint (`getTransportInfo()`) to surface the currently locked transport and any candidate transports the object could be added to. This dual-path keeps the answer useful regardless of object state ($TMP vs. transportable, locked vs. released).

The action is read-only and does **not** require `--enable-transports` — it's a discovery aid, not a transport modification. The new action is wired into the existing `SAPTransport` tool (no new tool created, preserves the 11-tool ceiling). Pure REST only — no SQL/E071 fallback (Phase 2 in the roadmap is deferred until a clear demand emerges, since it would require `blockFreeSQL=false` and bypass per-user safety).

## Context

### Current State

- `SAPTransport` supports 8 actions: `list`, `get`, `create`, `release`, `delete`, `reassign`, `release_recursive`, `check`. There is no "given object → which transports?" action.
- `getTransportInfo()` (`src/adt/transport.ts:237`) already calls `POST /sap/bc/adt/cts/transportchecks` and parses both `LOCKS/HEADER/TRKORR` (current locked transport) and `TRANSPORTS/headers` (available transports). Today this is exposed only via `SAPTransport(action="check", type, name, package)` — and it requires the user to know the package.
- `docs/compare/00-feature-matrix.md` (line 163-175 "Transport / CTS") has no row for "object → transport reverse lookup". `dassian-adt` and `abap-adt-api` both expose `transportReference`, but our test against the live A4H system showed that endpoint only resolves the object URI — it does not return transports.
- ADT verification (live `A4H` test, 2026-04-17) confirmed:
  - `GET /sap/bc/adt/cts/transportrequests/reference?pgmid=R3TR&obj_wbtype=CLAS&obj_name=ZCL_ARC1_TEST&tr_number=` → returns `<atom:link rel="http://www.sap.com/cts/relations/objecturi">` only, **no transport data**.
  - The object structure response (`GET /sap/bc/adt/oo/classes/zcl_arc1_test`) advertises a `<atom:link rel="http://www.sap.com/adt/relations/transport" href="/sap/bc/adt/oo/classes/zcl_arc1_test/transports" type="application/vnd.sap.as+xml;...dataname=com.sap.adt.lock.result2"/>` — this is the per-object endpoint to use.
  - `GET {objectUrl}/transports` returns 200 with empty body for `$TMP` objects (expected — no related transports). On a transportable object that's been changed it returns a `dataname=com.sap.adt.lock.result2` payload structurally identical to what `transportchecks` returns (LOCKS + TRANSPORTS).
- The roadmap entry (`docs/roadmap.md:1369-1411`) names `transportrequests/reference` as Phase 1 — that documentation is incorrect based on live testing and must be updated as part of this plan.

### Target State

- New action: `SAPTransport(action="history", type="CLAS", name="ZCL_ORDER")`. Returns JSON:
  ```json
  {
    "object": { "type": "CLAS", "name": "ZCL_ORDER", "uri": "/sap/bc/adt/oo/classes/zcl_order" },
    "lockedTransport": "A4HK900123",
    "relatedTransports": [
      { "id": "A4HK900123", "description": "...", "owner": "DEVELOPER", "status": "D" }
    ],
    "candidateTransports": [
      { "id": "A4HK900124", "description": "...", "owner": "DEVELOPER" }
    ],
    "summary": "Object ZCL_ORDER is locked in transport A4HK900123."
  }
  ```
- Action is read-only and works without `--enable-transports`.
- Action does NOT require the `package` argument — package is auto-resolved via the object structure when needed for the `transportchecks` fallback.
- Documentation (`docs/tools.md`, `docs/roadmap.md`, `docs/compare/00-feature-matrix.md`) reflects the new capability and the corrected ADT endpoint research.

### Key Files

| File | Role |
|------|------|
| `src/adt/transport.ts` | CTS module — add `getObjectTransports(objectUrl, type, name)` and parser; reuses existing `parseTransportInfo()` for the lock-result2 payload |
| `src/adt/types.ts` | Response type definitions — add `ObjectTransportHistory` interface |
| `src/handlers/intent.ts` | `handleSAPTransport` switch (~line 2940) — add `case 'history'`; uses `objectUrlForType()` (line 1853) and resolves package via `client.getStructure()` when fallback is needed |
| `src/handlers/schemas.ts` | `SAPTransportSchema` (line 421) — add `'history'` to action enum |
| `src/handlers/tools.ts` | `SAPTransport` tool definition (line 1006) and `SAPTRANSPORT_DESC_*` (line 243, 251) — add `history` to action enum, parameter docs, and description |
| `src/adt/safety.ts` | No changes — `OperationType.Read` is sufficient |
| `tests/unit/adt/transport.test.ts` | Add ~5 unit tests for `getObjectTransports` (success with related transports, empty body, locked transport extraction, safety check is read-only, URL construction) |
| `tests/fixtures/xml/object-transports-related.xml` | Realistic `lock.result2` payload with one locked + two candidate transports |
| `tests/fixtures/xml/object-transports-empty.xml` | Empty payload (200 OK with no transports) |
| `tests/integration/transport.integration.test.ts` | Add integration test calling `getObjectTransports` against `ZCL_ARC1_TEST` (existing E2E fixture) — assert empty result for `$TMP` object, gracefully skip when not a transportable system |
| `tests/e2e/saptransport.e2e.test.ts` | Add E2E test for `SAPTransport(action="history")` via MCP client |
| `docs/tools.md` | SAPTransport section (line 335) — add `history` action documentation, parameters, example output |
| `docs/roadmap.md` | FEAT-49 entry (line 1369) — fix the Phase 1 endpoint description (object structure `/transports` link, not `transportrequests/reference`); mark FEAT-49 Completed; update top matrix at line 50 |
| `docs/compare/00-feature-matrix.md` | Add new row in section 9 (line 163) for "Object → transport reverse lookup" |
| `CLAUDE.md` | "Key Files for Common Tasks" table — add a row for "Add object transport history (reverse lookup)" |

### Design Principles

1. **No new MCP tool — extend existing `SAPTransport`.** ARC-1's 11-tool ceiling is a core token-budget design principle. Add `history` as a new action on `SAPTransport`, not a separate tool.
2. **Read-only, no `enableTransports` requirement.** Same precedent as the `check` action (line 2996 in `intent.ts`). Use `checkOperation(safety, OperationType.Read, 'GetObjectTransports')` — not `checkTransport()`. The whole point of the action is discovery for code review, which should work on read-only safety profiles.
3. **Package auto-resolution.** Caller provides only `type` + `name`. When the per-object endpoint returns empty (e.g., $TMP) and we fall back to `transportchecks`, derive the package from the object's structure response (`adtcore:packageRef`) — do not require the caller to pass it. Cache nothing; structure fetches are cheap.
4. **Reuse `parseTransportInfo`.** The per-object `/transports` payload uses the same `dataname=com.sap.adt.lock.result2` MIME and structure as `transportchecks`. Reuse `parseTransportInfo()` (transport.ts:269) — do NOT duplicate the parser.
5. **Empty body is a normal outcome, not an error.** `$TMP` objects, freshly created objects, or objects on systems without transport configuration legitimately return empty. The handler returns `relatedTransports: []` and a clear `summary`.
6. **wbtype mapping is best-effort.** The roadmap's `obj_wbtype` is needed only for the `transportrequests/reference` endpoint, which we **do not use** (live testing showed it doesn't return transports). The per-object `/transports` URL is derived from `objectUrlForType()` so type mapping is already handled by the existing helper.
7. **Fail closed on unknown action.** The `default:` branch in `handleSAPTransport` already returns an actionable error listing supported actions — update its message to include `history`.
8. **No SQL/E071 fallback.** Phase 2 (SQL-based full history) from the roadmap is deferred. Reasons: (a) requires `blockFreeSQL=false` which violates safe defaults; (b) bypasses per-user SAP authorization on E070/E071 in some setups; (c) the per-object endpoint covers the practical use case ("what's the open transport touching this?"). Document the deferral in the roadmap entry update.

## Development Approach

- **Order:** types → ADT client method → schema/tool → handler → tests → docs. Each layer is a fresh task.
- Pure REST against existing ADT endpoints — no new HTTP infrastructure, no CSRF handling beyond what `http.get()` already does (the endpoint is GET, no token needed).
- Unit tests use `vi.mock('undici', ...)` + `mockResponse(200, xml, { 'x-csrf-token': 'T' })` per `tests/unit/adt/transport.test.ts:642` (`getTransportInfo` describe block) — the same pattern.
- Reuse `loadFixture()` helper for XML fixtures (already used elsewhere in unit tests).
- Integration test against the live `A4H` system (see `INFRASTRUCTURE.md`): expect empty result for `$TMP` E2E fixtures, full skip via `requireOrSkip(ctx, false, SkipReason.BACKEND_UNSUPPORTED, '...')` on 404. Do NOT use empty `catch {}` — every catch must assert via `expectSapFailureClass`.
- E2E test for round-trip MCP behavior, mirroring `tests/e2e/saptransport.e2e.test.ts` patterns (use `connectClient()`, `callTool()`, `expectToolSuccess()`).

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add `ObjectTransportHistory` type in `src/adt/types.ts`

**Files:**
- Modify: `src/adt/types.ts`

This is the typed return shape for the new ADT method and the `SAPTransport(action="history")` JSON output.

- [ ] Open `src/adt/types.ts` and find the existing `TransportRequest` / `TransportTask` / `TransportObject` interfaces.
- [ ] Add a new exported interface `ObjectTransportHistory` immediately after the existing transport types:
  ```ts
  /** Result of looking up transports related to a given ABAP object. */
  export interface ObjectTransportHistory {
    object: { type: string; name: string; uri: string };
    /** Transport currently holding a lock on this object (if any). */
    lockedTransport?: string;
    /** All transports the object is referenced from (active + queued). Empty when none. */
    relatedTransports: Array<{ id: string; description: string; owner: string; status: string }>;
    /** Transports the object could be added to (from transportchecks fallback). Only populated when relatedTransports is empty. */
    candidateTransports: Array<{ id: string; description: string; owner: string }>;
    /** Human-readable summary used by SAPTransport response. */
    summary: string;
  }
  ```
- [ ] Run `npm run typecheck` — must pass (types-only change).
- [ ] No unit tests for this task (types have no runtime behavior).

### Task 2: Add `getObjectTransports` to `src/adt/transport.ts`

**Files:**
- Modify: `src/adt/transport.ts`
- Create: `tests/fixtures/xml/object-transports-related.xml`
- Create: `tests/fixtures/xml/object-transports-empty.xml`
- Modify: `tests/unit/adt/transport.test.ts`

Add an exported function that calls `GET {objectUrl}/transports` with `Accept: application/vnd.sap.as+xml` and parses the response. The payload structure matches `transportchecks` output (`dataname=com.sap.adt.lock.result2`), so reuse `parseTransportInfo()` (line 269 in this file).

Verified endpoint (live A4H test 2026-04-17):
- URL: `GET {objectUrl}/transports` (e.g., `/sap/bc/adt/oo/classes/zcl_order/transports`)
- Accept: `application/vnd.sap.as+xml`
- Empty response is 200 OK with `content-length: 0` for `$TMP` and unrelated objects.
- Populated response has `<asx:abap><asx:values><DATA><LOCKS>...<TRANSPORTS>...` — same shape as `transportchecks`.

Steps:

- [ ] Create `tests/fixtures/xml/object-transports-related.xml` — realistic `lock.result2` payload with:
  - `<DATA>` root containing `<LOCKS><HEADER><TRKORR>A4HK900123</TRKORR></HEADER></LOCKS>`
  - `<TRANSPORTS><headers><TRKORR>A4HK900124</TRKORR><AS4TEXT>Refactor ZCL_ORDER</AS4TEXT><AS4USER>DEVELOPER</AS4USER></headers><headers><TRKORR>A4HK900125</TRKORR><AS4TEXT>Bugfix</AS4TEXT><AS4USER>DEVELOPER</AS4USER></headers></TRANSPORTS>`
  - Wrap in `<?xml version="1.0"?><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values>...</asx:values></asx:abap>`.
- [ ] Create `tests/fixtures/xml/object-transports-empty.xml` — single line: `` (truly empty, mimics the real 200 OK + zero bytes from `$TMP` objects).
- [ ] In `src/adt/transport.ts`, add a new exported function near the bottom (after `getTransportInfo`):
  ```ts
  /**
   * List transport requests related to a specific ABAP object via the per-object
   * `/transports` endpoint (advertised as rel=transport in object structure).
   *
   * Returns the locked transport (if any), all related transports, and candidate
   * transports the object could be added to. Empty body is a normal outcome for
   * $TMP / unrelated objects.
   */
  export async function getObjectTransports(
    http: AdtHttpClient,
    safety: SafetyConfig,
    objectUrl: string,
  ): Promise<{
    lockedTransport?: string;
    relatedTransports: Array<{ id: string; description: string; owner: string; status: string }>;
    candidateTransports: Array<{ id: string; description: string; owner: string }>;
  }> {
    checkOperation(safety, OperationType.Read, 'GetObjectTransports');
    const resp = await http.get(`${objectUrl}/transports`, { Accept: 'application/vnd.sap.as+xml' });
    if (!resp.body || resp.body.trim() === '') {
      return { relatedTransports: [], candidateTransports: [] };
    }
    const info = parseTransportInfo(resp.body);
    // LOCKS represents currently locked-in transport(s); TRANSPORTS lists candidates.
    const related: Array<{ id: string; description: string; owner: string; status: string }> = [];
    if (info.lockedTransport) {
      related.push({ id: info.lockedTransport, description: '', owner: '', status: 'D' });
    }
    return {
      ...(info.lockedTransport ? { lockedTransport: info.lockedTransport } : {}),
      relatedTransports: related,
      candidateTransports: info.existingTransports,
    };
  }
  ```
- [ ] In `tests/unit/adt/transport.test.ts`, add a new `describe('getObjectTransports')` block at the end with ~5 tests:
  1. **URL construction:** asserts `http.get` was called with `'/sap/bc/adt/oo/classes/zcl_test/transports'` and `Accept: 'application/vnd.sap.as+xml'`.
  2. **Empty body returns empty arrays:** mock with body `''` → assert `{ relatedTransports: [], candidateTransports: [] }` and no `lockedTransport`.
  3. **Populated payload extracts lockedTransport:** mock with `loadFixture('object-transports-related.xml')` → assert `lockedTransport === 'A4HK900123'` and `candidateTransports.length === 2`.
  4. **Populated payload populates relatedTransports from LOCKS:** assert `relatedTransports[0].id === 'A4HK900123'`.
  5. **Read-only safety check:** call with a `readOnly: true` safety config → must NOT throw (read operation). Then call with `disallowedOps: 'R'` → MUST throw `AdtSafetyError`.
- [ ] Add `getObjectTransports` to the imports at the top of `transport.test.ts` (line 5-17).
- [ ] Run `npm test -- tests/unit/adt/transport.test.ts` — all tests pass.
- [ ] Run `npm test` — full suite still passes.
- [ ] Run `npm run typecheck` — no errors.

### Task 3: Add `'history'` to SAPTransport schema and tool definition

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`

Wire the new action into the input schema and the tool's JSON-Schema declaration so MCP clients see it.

Steps:

- [ ] In `src/handlers/schemas.ts`, line 422, extend the `action` enum on `SAPTransportSchema`:
  ```ts
  action: z.enum(['list', 'get', 'create', 'release', 'delete', 'reassign', 'release_recursive', 'check', 'history']),
  ```
- [ ] In `src/handlers/tools.ts`, line 1013, add `'history'` to the `action.enum` array of the `SAPTransport` tool. Update the `action.description` (lines 1014-1023) by appending: `history: list transport requests that contain a given object (reverse lookup; requires type, name; works without --enable-transports).`
- [ ] In `src/handlers/tools.ts`, update both `SAPTRANSPORT_DESC_ONPREM` (line 243) and `SAPTRANSPORT_DESC_BTP` (line 251) by appending to the `Actions:` list: `, history (find transports referencing an object — provide type, name; read-only, works without --enable-transports)`.
- [ ] Update the `name` parameter description (line 1030) to mention both `check` and `history`: `'Object name (for check or history actions)'`.
- [ ] Update the `type` parameter description (line 1041) to mention both `check` and `history`: `'For create: transport type K=Workbench (default), W=Customizing, T=Transport of Copies. For check/history: object type (PROG, CLAS, DDLS, etc.)'`.
- [ ] Run `npm run typecheck` — zod enum changes must compile.
- [ ] Run `npm run lint` — must pass.
- [ ] Add ~2 unit tests in `tests/unit/handlers/schemas.test.ts` (search the file first to confirm the pattern; if no schema test file exists, add the assertions in the closest existing handler test):
  1. `SAPTransportSchema.safeParse({ action: 'history', type: 'CLAS', name: 'ZCL_X' }).success === true`
  2. `SAPTransportSchema.safeParse({ action: 'history' }).success === true` — name/type are optional at the schema level (handler enforces "required for history" semantically)
- [ ] Run `npm test` — all tests pass.

### Task 4: Add `case 'history'` to `handleSAPTransport` in `src/handlers/intent.ts`

**Files:**
- Modify: `src/handlers/intent.ts`

Add the new action handler. It should:
1. Validate `type` and `name` are present.
2. Build the object URL via `objectUrlForType(type, name)` (line 1853).
3. Call `getObjectTransports(client.http, client.safety, objectUrl)` for the primary lookup.
4. If `relatedTransports` is empty, attempt a fallback: fetch the object structure to derive the package via `adtcore:packageRef`, then call `getTransportInfo()` to surface candidate transports for the package. If the structure call fails or no package is found, skip the fallback gracefully (still return empty arrays).
5. Build a human-readable `summary` and return JSON.

Steps:

- [ ] At the top of `src/handlers/intent.ts`, add `getObjectTransports` to the existing import from `'../adt/transport.js'`.
- [ ] Locate the `handleSAPTransport` switch (line 2940). After the `case 'check':` block (~line 3029), add a new case **before** the `default:` branch:
  ```ts
  case 'history': {
    const objectType = String(args.type ?? '');
    const objectName = String(args.name ?? '');
    if (!objectType || !objectName) {
      return errorResult('"type" and "name" are required for "history" action.');
    }
    const objectUrl = objectUrlForType(objectType, objectName);
    const primary = await getObjectTransports(client.http, client.safety, objectUrl);

    let candidateTransports = primary.candidateTransports;
    // Fallback: when the per-object endpoint is empty, try to surface candidates via transportchecks.
    if (primary.relatedTransports.length === 0 && candidateTransports.length === 0) {
      try {
        const structure = await client.getStructure(objectName); // returns XML; reuse existing method
        const pkgMatch = structure.match(/<adtcore:packageRef[^>]*adtcore:name="([^"]+)"/);
        const pkg = pkgMatch?.[1];
        if (pkg && pkg !== '$TMP') {
          const info = await getTransportInfo(client.http, client.safety, objectUrl, pkg, '');
          candidateTransports = info.existingTransports;
        }
      } catch {
        // best-effort-fallback — ignore structure lookup failures, return primary result
      }
    }

    const summary =
      primary.lockedTransport
        ? `Object ${objectName} is locked in transport ${primary.lockedTransport}.`
        : primary.relatedTransports.length > 0
          ? `Object ${objectName} is referenced by ${primary.relatedTransports.length} transport(s).`
          : candidateTransports.length > 0
            ? `Object ${objectName} has no active lock; ${candidateTransports.length} transport(s) available for assignment.`
            : `Object ${objectName} has no related or candidate transports (likely $TMP / local object).`;

    return textResult(
      JSON.stringify(
        {
          object: { type: objectType, name: objectName, uri: objectUrl },
          ...(primary.lockedTransport ? { lockedTransport: primary.lockedTransport } : {}),
          relatedTransports: primary.relatedTransports,
          candidateTransports,
          summary,
        },
        null,
        2,
      ),
    );
  }
  ```
- [ ] Update the `default:` error message (line 3032) to include `history`:
  ```ts
  return errorResult(
    `Unknown SAPTransport action: ${action}. Supported: list, get, create, release, delete, reassign, release_recursive, check, history`,
  );
  ```
- [ ] If a unit test file exists at `tests/unit/handlers/intent.test.ts`, add ~2 tests for the routing (mock `client.http.get` to return a fixture; assert JSON shape). If no such file exists, rely on the unit tests from Task 2 plus E2E coverage from Task 6 — do NOT create a new test file just for routing.
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm run lint` — no errors.
- [ ] Run `npm test` — all tests pass.

### Task 5: Integration test against live A4H

**Files:**
- Modify: `tests/integration/transport.integration.test.ts`

Validate `getObjectTransports` against the live `A4H` system using the existing E2E fixture `ZCL_ARC1_TEST` (a `$TMP` class). The expectation: empty arrays returned (no related transports for $TMP). On systems with a transportable package available (env `TEST_TRANSPORT_PACKAGE` set), additionally probe an object in that package.

Steps:

- [ ] Read `tests/integration/transport.integration.test.ts` to confirm the existing helper imports and `getTestClient()` pattern.
- [ ] Add a new `describe('getObjectTransports (object → transports reverse lookup)')` block.
- [ ] Test 1 — `$TMP` object returns empty: call `getObjectTransports(client.http, client.safety, '/sap/bc/adt/oo/classes/zcl_arc1_test')`. Assert `result.relatedTransports.length === 0` and `result.lockedTransport === undefined`. Use `expectSapFailureClass(err, [404], [/not found/i])` in catch and skip via `requireOrSkip(ctx, false, SkipReason.NO_FIXTURE, 'ZCL_ARC1_TEST not found — run npm run test:e2e:fixtures first')` on 404.
- [ ] Test 2 — Transportable object (conditional): use `process.env.TEST_TRANSPORT_PACKAGE` and `process.env.TEST_TRANSPORT_OBJECT_NAME`. If either is unset, `requireOrSkip(ctx, false, SkipReason.NO_TRANSPORT_PACKAGE, 'TEST_TRANSPORT_PACKAGE not configured')`. Otherwise call against the configured object and assert `relatedTransports` is an array (could be empty if the object hasn't been touched).
- [ ] Tag any best-effort cleanup catches with `// best-effort-cleanup`. Every other catch must assert with `expectSapFailureClass`. No empty `catch {}`. No `if (!x) return;`.
- [ ] Run `npm run test:integration` — tests pass or skip with documented reason. (You can use the credentials in `INFRASTRUCTURE.md` for the live `A4H` system at `http://65.109.59.210:50000`.)

### Task 6: E2E test through MCP protocol

**Files:**
- Modify: `tests/e2e/saptransport.e2e.test.ts`

Validate the full MCP JSON-RPC stack for the new action.

Steps:

- [ ] Read `tests/e2e/saptransport.e2e.test.ts` (~line 19+) to confirm the `connectClient()` / `callTool()` / `expectToolSuccess()` helper pattern.
- [ ] Add a new `describe('SAPTransport history action')` block at the end of the file.
- [ ] Test 1 — `history` returns valid JSON for an existing class: `callTool(client, 'SAPTransport', { action: 'history', type: 'CLAS', name: 'ZCL_ARC1_TEST' })`. Parse the response text as JSON. Assert `parsed.object.type === 'CLAS'`, `parsed.object.name === 'ZCL_ARC1_TEST'`, `parsed.relatedTransports` is an array, `parsed.summary` is a non-empty string. Skip via `requireOrSkip(ctx, ...)` if the fixture is missing.
- [ ] Test 2 — `history` returns error when `type` or `name` missing: `callTool(client, 'SAPTransport', { action: 'history' })` — assert via `expectToolError(result)` and that the error text mentions `"type"` or `"name"`.
- [ ] Test 3 — works without `--enable-transports` (mention this explicitly in a comment): the test runs against whatever server is configured for `E2E_MCP_URL`. If that server happens to have transports enabled, the test still passes (the action is independent of that flag). Document in a comment that the action is allowed without `--enable-transports` by design.
- [ ] Run `npm run test:e2e` (requires running MCP server at `E2E_MCP_URL`) — tests pass or skip with documented reason. If you don't have the MCP server set up locally, document that the test exists and rely on CI for execution.

### Task 7: Documentation updates

**Files:**
- Modify: `docs/tools.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `CLAUDE.md`

Keep every artifact that lists `SAPTransport` actions in sync. The `docs/tools.md` SAPTransport section needs the new `history` action and example output. The roadmap needs both the **research correction** (Phase 1 endpoint is `{objectUrl}/transports`, not `transportrequests/reference`) and the status flip to Completed. The feature matrix gets a new row in Section 9. `CLAUDE.md` gets a Key Files row.

Steps:

- [ ] `docs/tools.md` line 343: append `, history` to the `action` row. Add a new row for the `name` and `type` parameter descriptions noting they apply to `check` AND `history` (line 346, 350).
- [ ] `docs/tools.md` Actions list (line 354-363): add a new bullet:
  ```
  - **`history`** — Reverse lookup: given an object (`type` + `name`), list the transport requests that reference it. Returns the locked transport (if any), all related transports, and candidate transports for assignment. Read-only; does NOT require `--enable-transports`.
  ```
- [ ] `docs/tools.md` after the "Check action output" example block (line 365-377): add a "History action output" example:
  ```json
  {
    "object": { "type": "CLAS", "name": "ZCL_ORDER", "uri": "/sap/bc/adt/oo/classes/zcl_order" },
    "lockedTransport": "A4HK900123",
    "relatedTransports": [
      { "id": "A4HK900123", "description": "", "owner": "", "status": "D" }
    ],
    "candidateTransports": [
      { "id": "A4HK900124", "description": "Refactor", "owner": "DEVELOPER" }
    ],
    "summary": "Object ZCL_ORDER is locked in transport A4HK900123."
  }
  ```
- [ ] `docs/tools.md` line 383: extend the Note: `Most actions require --enable-transports. The check and history actions work without it (read-only).`
- [ ] `docs/roadmap.md` line 1369-1411 (FEAT-49 entry): rewrite the **ADT endpoints** section to reflect the verified live behavior. Specifically:
  - Replace the Option 1 (`transportRequest endpoint`) description with a clear statement that this endpoint only resolves the object URI and does NOT return transport data (verified live against A4H 2026-04-17).
  - Add a NEW Option 1 (preferred): the per-object `GET {objectUrl}/transports` endpoint advertised as `rel="http://www.sap.com/adt/relations/transport"` in the object structure response, returning the same `dataname=com.sap.adt.lock.result2` payload as `transportchecks`.
  - Keep Option 2 (`transportchecks`, fallback) and Option 3 (SQL E071, deferred).
  - Update Status from `Not started` to `Completed (2026-04-17)`.
- [ ] `docs/roadmap.md` top matrix (line 50): change row from `4 | FEAT-49 | Object Transport History (Reverse Lookup) | P1 | S | Features` to `~~—~~ | ~~FEAT-49~~ | ~~Object Transport History (Reverse Lookup)~~ | ~~P1~~ | ~~S~~ | ~~Completed 2026-04-17~~`.
- [ ] `docs/roadmap.md` "Phase B" priority list (around line 184): strike through the FEAT-49 line and add a `**completed 2026-04-17**` note.
- [ ] `docs/roadmap.md` "Completed items" section (around line 100-141): add an entry `| FEAT-49 | Object Transport History (Reverse Lookup) | 2026-04-17 | Features |`.
- [ ] `docs/compare/00-feature-matrix.md` Section 9 "Transport / CTS" (line 163): add a new row after `Inactive objects list`:
  ```
  | Object → transport reverse lookup | ✅ (history action) | ❌ | ⚠️ (URI resolve only) | ❌ | ❌ | ❌ | N/A | ⚠️ (URI resolve only) | ❌ |
  ```
  Note: the abap-adt-api `transportReference` only resolves URIs (verified live 2026-04-17), not transports — hence ⚠️.
- [ ] `docs/compare/00-feature-matrix.md` Section 9: also update the "Transport contents" row owner column to mention `history` complements `get` (forward lookup). Optional polish.
- [ ] `docs/compare/00-feature-matrix.md`: update the "Last Updated" date at the top of the file to today.
- [ ] `CLAUDE.md` "Key Files for Common Tasks" table: add a row:
  ```
  | Add object transport history (reverse lookup) | src/adt/transport.ts (getObjectTransports), src/adt/types.ts (ObjectTransportHistory), src/handlers/intent.ts (handleSAPTransport case 'history'), src/handlers/schemas.ts, src/handlers/tools.ts |
  ```
- [ ] Spot-check `README.md` — if SAPTransport features are highlighted in the readme, add a brief note about the new history action. Skip if no transport feature list is present.
- [ ] Run `npm test` and `npm run typecheck` — no code touched in this task, but ensure nothing regressed.

### Task 8: Final verification

- [ ] Run `npm test` — all unit tests pass.
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm run lint` — no errors.
- [ ] Run `npm run test:integration` (when `TEST_SAP_URL` is available) — all tests pass or skip with a documented reason. No silent `if (!x) return;` skips.
- [ ] Manually invoke `SAPTransport(action="history", type="CLAS", name="ZCL_ARC1_TEST")` via `npm run dev` against A4H. Verify: returns valid JSON with `object`, `relatedTransports: []`, `candidateTransports: []`, and the `summary` mentions "$TMP / local object".
- [ ] `git grep -n 'transportRequests/reference' docs/roadmap.md` returns nothing where it claims that endpoint returns transport data (the corrected text should clearly note it only resolves URIs).
- [ ] `docs/roadmap.md` FEAT-49 is marked Completed.
- [ ] `docs/compare/00-feature-matrix.md` has the "Object → transport reverse lookup" row and the "Last Updated" date is today.
- [ ] `CLAUDE.md` "Key Files for Common Tasks" includes the new row.
- [ ] Move this plan to `docs/plans/completed/2026-04-17-feat-49-object-transport-history.md`.
