# SAPActivate phantom success + CLI/server alignment gaps (NW 7.50)

## Summary

`SAPActivate` reported *"Successfully activated"* for an ABAP class that was provably inactive (still failing to compile in Eclipse, visible as inactive in SAP GUI). The false-positive masked five independent bugs, each of which independently should have exposed the problem. The combination produced a silent no-op.

Reproducer:

```bash
npx tsx src/cli.ts activate CLAS ZCL_XXX
# before fix:
#   → Successfully activated CLAS ZCL_XXX.
# after fix:
#   → Activation failed for CLAS ZCL_XXX.
#     Errors:
#     - Activation did not complete — ZCL_XXX is still inactive.
#     - Activation did not complete — ZCL_XXX …EXECUTE_ACTION is still inactive
#       (pending changes owned by <USERID>).
#     Server syntax check (inactive):
#       - Line 52: Result type of the functional method "LX_ERR->IF_MESSAGE~GET_TEXT"
#                  cannot be converted into the type of formal parameter "IV_MSG_TEXT".
```

## Root causes (five, all independent)

### 1. `parseActivationResult` misreads `<ioc:inactiveObjects>` as success

**File:** [src/adt/devtools.ts](src/adt/devtools.ts) — `parseActivationResult()`

SAP's `/sap/bc/adt/activation?method=activate` endpoint can return three response shapes:

- Empty body — success
- `<chkl:messages>` with `<msg>` entries — errors/warnings
- `<ioc:inactiveObjects>` with `<ioc:entry>` — the object is still inactive (and SAP tells us which transport / user owns the pending edit)

The parser only inspected `<msg>` nodes. A response with zero `<msg>` elements but several `<ioc:inactiveObjects>` entries was read as *"no errors → success"*. vibing-steampunk's Go client correctly treats this shape as failure.

**Captured response body (NW 7.50):**

```xml
<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects">
  <ioc:entry><ioc:object/><ioc:transport ioc:user="<USERID>" …/></ioc:entry>
  <ioc:entry><ioc:object …><ioc:ref adtcore:uri="…/ZCL_XXX" …/></ioc:object>…</ioc:entry>
  <ioc:entry><ioc:object …><ioc:ref adtcore:uri="…EXECUTE_ACTION" …/></ioc:object>…</ioc:entry>
</ioc:inactiveObjects>
```

### 2a. `getInactiveObjects` hardcoded to the Cloud endpoint path

**File:** [src/adt/client.ts](src/adt/client.ts) — `getInactiveObjects()`

Newer SAP (S/4, BTP) exposes the list at `/sap/bc/adt/activation/inactive`; NW 7.50 uses `/sap/bc/adt/activation/inactiveobjects`. The client hardcoded the new path and returned 404 on older systems. The NW 7.50 discovery fixture ([tests/fixtures/xml/discovery-nw750.xml:1129](tests/fixtures/xml/discovery-nw750.xml#L1129)) and [scripts/probe-all.ts:297](scripts/probe-all.ts#L297) both had the correct path — the client method didn't consult either.

### 2b. `parseInactiveObjects` only understood the feed-wrapped shape

**File:** [src/adt/xml-parser.ts](src/adt/xml-parser.ts) — `parseInactiveObjects()`

The parser iterated `<entry>` nodes and expected `<objectReference>` beneath each — the feed shape returned by newer systems. NW 7.50 returns a flat list:

```xml
<adtcore:objectReferences>
  <adtcore:objectReference adtcore:uri="…" adtcore:type="CLAS/OC" adtcore:name="…"/>
  <adtcore:objectReference …/>
  …
</adtcore:objectReferences>
```

No `<entry>` nodes → parser returned `[]` even on a 200 with content. Combined with 2a, this made `SAPRead type=INACTIVE_OBJECTS` useless on the affected system.

### 3a. `SAPDiagnose syntax` had no `version` parameter

**Files:** [src/handlers/schemas.ts](src/handlers/schemas.ts) (SAPDiagnoseSchema), [src/handlers/intent.ts](src/handlers/intent.ts) (`handleSAPDiagnose`), [src/handlers/tools.ts](src/handlers/tools.ts)

The low-level `syntaxCheck()` in `devtools.ts` already supported `{ version: 'active' | 'inactive' }`, but the MCP tool schema didn't expose it and the handler always defaulted to `active`. SAP's `chkrun:version` attribute controls which version the compiler validates, so for any object with pending changes the caller could not reach the real compile error through the tool.

### 3b. `parseSyntaxCheckResult` missed NW 7.50's message shape

**File:** [src/adt/devtools.ts](src/adt/devtools.ts) — `parseSyntaxCheckResult()`

The parser looked for `<msg>` with `@_line`/`@_col` attributes. The NW 7.50 `/sap/bc/adt/checkruns` endpoint returns `<chkrun:checkMessage>` with position encoded inside the `uri` attribute as `uri="…/source/main#start=LINE,COL"`. Two gaps in one: wrong element name, and the line/column were in a fragment component of another attribute.

## Fixes

All changes verified end-to-end against the reproducer system.

| # | File | Change |
|---|---|---|
| 1 | [src/adt/devtools.ts](src/adt/devtools.ts) | `parseActivationResult` now detects `<ioc:inactiveObjects>` entries with an `<object>` child and maps them to error-severity details (includes owning user from `ioc:transport[@_user]`). |
| 1+ | [src/handlers/intent.ts](src/handlers/intent.ts) | On activation failure the handler calls a new `inactiveSyntaxDiagnostic()` and appends per-object compiler errors from the inactive version to the error message. Applied to both single and batch paths. |
| 2a | [src/adt/client.ts](src/adt/client.ts) | `getInactiveObjects` tries `/activation/inactive` first and falls back to `/activation/inactiveobjects` on 404. |
| 2b | [src/adt/xml-parser.ts](src/adt/xml-parser.ts) | `parseInactiveObjects` handles both feed-wrapped and flat `<adtcore:objectReferences>` shapes. |
| 3a | [src/handlers/schemas.ts](src/handlers/schemas.ts), [src/handlers/intent.ts](src/handlers/intent.ts), [src/handlers/tools.ts](src/handlers/tools.ts) | Added `version: 'active' \| 'inactive'` to `SAPDiagnose action=syntax`; plumbed through to `syntaxCheck({ version })`. |
| 3b | [src/adt/devtools.ts](src/adt/devtools.ts) | `parseSyntaxCheckResult` now also collects `<chkrun:checkMessage>` nodes and extracts line/column from `uri="…#start=LINE,COL"`. |
| 4 | [src/adt/devtools.ts](src/adt/devtools.ts) | Two-phase preaudit activation handshake: `parseActivationOutcome()` discriminated union, `confirmPreaudit()` second POST, `rethrowOrLockHint()` NW 7.50 lock-conflict detection. Single-activate now includes `adtcore:name`. |
| 4+ | [src/handlers/intent.ts](src/handlers/intent.ts) | Passes `name` to `activate()` for `adtcore:name` attribute. |
| 5 | [src/adt/crud.ts](src/adt/crud.ts) | `lockObject()` detects NW 7.50 lock-conflict-as-auth-error (400/401/403 + HTML login page) and reclassifies as 409 `lock-conflict`. |
| 6 | [src/adt/http.ts](src/adt/http.ts), [src/server/audit.ts](src/server/audit.ts) | `ARC1_LOG_HTTP_DEBUG=true`: opt-in full request/response body + header logging on `http_request` audit events. Sensitive headers redacted, bodies truncated at 64KB. |

### 4. Two-phase preaudit activation handshake

**Files:** [src/adt/devtools.ts](src/adt/devtools.ts) — `activate()`, `activateBatch()`, `parseActivationOutcome()`, `confirmPreaudit()`

Fixes #1 and #2a above failed to distinguish between a preaudit prompt (`<ioc:inactiveObjects>` with no `<msg>` errors) and a terminal failure. SAP's ADT activation endpoint implements a two-phase protocol:

1. **Phase 1** — Client POSTs the target object with `preauditRequested=true`. SAP returns one of:
   - Empty body (content-length: 0) → clean activation, no follow-up needed.
   - `<chkl:messages>` with `<msg>` errors �� terminal failure (syntax/auth/dependency).
   - `<ioc:inactiveObjects>` with no `<msg>` errors → **preaudit prompt**: SAP lists the related inactive objects (method includes, DDIC dependencies) that must be included for the target to activate cleanly. This is a confirmation step, not a failure.

2. **Phase 2** — On a preaudit prompt, client re-POSTs with `preauditRequested=false` and the full list of object references from the response. SAP commits the activation.

#### What SAP returns in the preaudit prompt

Response content-type: `application/vnd.sap.adt.inactivectsobjects.v1+xml`

```xml
<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects">
  <!-- Entry 1: transport-only row (empty <ioc:object/>) — context, not an activation target -->
  <ioc:entry>
    <ioc:object/>
    <ioc:transport ioc:user="DEVUSER" ioc:linked="false">
      <ioc:ref adtcore:uri="…/object_name/TRKORR001" adtcore:type="/RQ" adtcore:name="TRKORR001"/>
    </ioc:transport>
  </ioc:entry>
  <!-- Entry 2: the class header — activation target -->
  <ioc:entry>
    <ioc:object ioc:user="" ioc:deleted="false">
      <ioc:ref adtcore:uri="/sap/bc/adt/oo/classes/zcl_example"
        adtcore:type="CLAS/OC" adtcore:name="ZCL_EXAMPLE" adtcore:packageName="ZEXAMPLE_PKG"/>
    </ioc:object>
    <ioc:transport/>
  </ioc:entry>
  <!-- Entry 3: method include with linked transport task -->
  <ioc:entry>
    <ioc:object ioc:user="" ioc:deleted="false">
      <ioc:ref adtcore:uri="/sap/bc/adt/oo/classes/zcl_example/source/main#type=CLAS%2FOM;name=SOME_METHOD"
        adtcore:type="CLAS/OM/public" adtcore:name="ZCL_EXAMPLE         SOME_METHOD"
        adtcore:parentUri="/sap/bc/adt/oo/classes/zcl_example"/>
    </ioc:object>
    <ioc:transport ioc:user="DEVUSER" ioc:linked="true">
      <ioc:ref adtcore:uri="…/object_name/TRKORR002" adtcore:type="/RQ" adtcore:name="TRKORR002"/>
    </ioc:transport>
  </ioc:entry>
</ioc:inactiveObjects>
```

Key observations:
- SAP pre-filters the response to objects related to the activation target. Even when the user has many more inactive objects on the target system, only the class and its linked method include appear.
- Transport-only entries (empty `<ioc:object/>`) provide CTS context but are not activation targets. `extractInactiveObjectEntries` already skips these.
- The `ioc:linked="true"` flag on a transport means the inactive object is already assigned to that task.

#### Implementation

`parseActivationOutcome()` returns a discriminated union:

```typescript
type ActivationOutcome =
  | { kind: 'success'; messages: string[]; details: ActivationMessage[] }
  | { kind: 'error'; messages: string[]; details: ActivationMessage[] }
  | { kind: 'preaudit'; refs: Array<{ uri: string; name: string }>; messages: string[]; details: ActivationMessage[] };
```

Both `activate()` and `activateBatch()` use this internally:
- `kind === 'success'` or `kind === 'error'` → return immediately (no second call).
- `kind === 'preaudit'` → call `confirmPreaudit()` which re-POSTs the refs with `preauditRequested=false`. If the second call also returns `preaudit`, it's treated as failure to prevent an infinite loop.

`parseActivationResult()` remains exported for backward compatibility — it collapses `preaudit` to `{ success: false, … }` with "still inactive" messages. Direct callers of `activate()`/`activateBatch()` get the handshake transparently.

A `logger.debug()` line emits the object list before the second POST for audit trail visibility.

#### Also fixed: missing `adtcore:name` in single-object activation

The single-object `activate()` body previously omitted `adtcore:name`, unlike `activateBatch()` and VSP's Go implementation. Now accepts `options.name` and includes it:

```xml
<adtcore:objectReference adtcore:uri="…" adtcore:name="ZCL_EXAMPLE"/>
```

`handleSAPActivate` passes `name` through.

### 5. NW 7.50: activation and lock 401/400/403 on locked objects (ABAP root cause)

**Files:** [src/adt/devtools.ts](src/adt/devtools.ts) (`rethrowOrLockHint`), [src/adt/crud.ts](src/adt/crud.ts) (`lockObject` catch)

On NW 7.50, the `/sap/bc/adt/activation` and `_action=LOCK` endpoints return HTTP 400, 401, or 403 with a generic HTML login page ("Logon Error Message") when the target object is locked by another session (Eclipse, SE80). Other ADT endpoints (reads, syntax checks) work fine with the same credentials in the same process. This is not an authentication failure.

#### ABAP root cause (confirmed via debugger)

Call stack:

```
CL_ADT_LOCK_HANDLE          IF_ADT_LOCK_HANDLE~GET
SAPLSEUQ                    RS_ACCESS_PERMISSION
CL_WB_ACCESS_PERMISSION     IF_WB_ACCESS_PERMISSION~SET_TRANSIENT_LOCK
CL_SEU_ADT_RES_ACTIVATION   LIF_ACTIVATION_MANAGER~SET_TRANSIENT_LOCK
CL_SEU_ADT_RES_ACTIVATION   VALIDATE_OBJ_AND_ENSURE_LOCKED
CL_SEU_ADT_RES_ACTIVATION   ACTIVATE_OBJECTS
CL_SEU_ADT_RES_ACTIVATION   POST
CL_ADT_REST_RESOURCE        IF_REST_HANDLER~HANDLE
```

`SET_TRANSIENT_LOCK` calls `CL_WB_ACCESS_PERMISSION->SET_TRANSIENT_LOCK`, which detects the lock conflict and fills the activation checklist with message `EU6 510` (`MSGV1` = lock owner user ID). Then `lcl_activation_manager->set_transient_lock` (local class of `CL_SEU_ADT_RES_ACTIVATION`) reads the error from the checklist and raises `CX_ADT_RES_NO_ACCESS`:

```abap
RAISE EXCEPTION TYPE cx_adt_res_no_access
  EXPORTING
    textid        = cx_adt_rest=>create_textid_from_msg_params( )
    resource_id   = '' && me->obj_name
    resource_type = '' && me->object
    properties    = l_props.
```

The exception object contains all the information needed for a useful error:
- `MSGV1` = lock owner user ID
- `MSGV2` = object name
- `RESOURCE_TYPE` = object type (e.g. `CLAS`)
- `RESOURCE_ID` = object name

But `CX_ADT_RES_NO_ACCESS` inherits from `cx_adt_rest` and maps to HTTP 403 at the framework level. The exception is caught by `CL_ADT_REST_RESOURCE->IF_REST_HANDLER~HANDLE`, which calls `CL_ADT_EXCEPTION_UTILITY->CREATE_EXC_RESPONSE` to serialize it as the generic HTML login page — discarding the lock owner, object name, and all structured info.

The exception class is wrong for a lock conflict — it should be `CX_ADT_RES_CONFLICT` (→ HTTP 409) or similar. S/4 likely fixed this.

#### Why the HTTP status code varies (400, 401, 403)

The ABAP framework raises `CX_ADT_RES_NO_ACCESS` → HTTP 403. But with cookie-based auth (no `Authorization: Basic` header), SAP's ICM layer sees the 403 + no auth header and transforms it to 401 "no logon data provided". ARC-1's built-in 401 retry handler then clears the cookie jar and retries without session cookies, which returns 400. So the observed status code depends on timing and retry state — all three carry the same HTML login page body.

#### ARC-1 detection

Since the HTTP response doesn't carry structured lock-owner info, ARC-1 detects the pattern by matching `"Logon Error Message"` in the HTML body:

- **Activation** ([src/adt/devtools.ts](src/adt/devtools.ts)): `rethrowOrLockHint()` catches `AdtApiError` with status 400/401/403 + `"Logon Error Message"` in the body. Returns `ActivationResult { success: false }` with a clear "object is locked" message.
- **Lock** ([src/adt/crud.ts](src/adt/crud.ts)): `lockObject()` catches `AdtApiError` with status 400/401/403 + `"Logon Error Message"`. Re-throws as status 409 with "locked by another session" so `classifySapDomainError` routes to the `lock-conflict` category (not the unrelated 423 `enqueue-error` / invalid-handle path).

Verified end-to-end: `SAPWrite` (both `update` and `edit_method`), `SAPActivate`, and standalone lock probes all produce the clear "Object is locked by another session" message when the target system has an Eclipse lock active.

### Refactor done as part of #1+

`tryPostSaveSyntaxCheck()` was split into:

- `inactiveSyntaxDiagnostic(client, type, name)` — the reusable primitive (no type filter)
- `tryPostSaveSyntaxCheck(client, type, name)` — the DDIC-only gate, unchanged externally

## CLI / MCP server alignment

[src/cli.ts](src/cli.ts) exposes two generic entry points (`call`, `tools`) plus a small set of ergonomic shortcuts. The shortcuts fall behind the MCP tool schemas in several places — for example, the `syntax` shortcut does not expose the new `version` parameter, so a user cannot reach the inactive compiler error without dropping to `call SAPDiagnose --arg version=inactive`.

### Shortcut coverage matrix (12 MCP tools)

| MCP tool | CLI shortcut | Knobs exposed on shortcut | Knobs in tool schema but NOT on shortcut |
|---|---|---|---|
| `SAPRead` | `read <type> <name>`, `source <type> <name>` | `type`, `name`, `--flat` | all other `SAPReadSchema` fields (`INACTIVE_OBJECTS` type, `TABLE_CONTENTS`, `VERSIONS`, pagination, etc.) |
| `SAPSearch` | `search <query>` | `query`, `--max` | `objectType`, `packageName`, type scope filters |
| `SAPWrite` | — | — | all (create/update/delete/edit_method, package, source, transport) |
| `SAPActivate` | `activate <type> <name>` | `type`, `name` | `preaudit`, `version`, `objects` (batch), `publish_srvb`/`unpublish_srvb` actions, `service_type` |
| `SAPNavigate` | — | — | all (`definition`, `references`, `completion`, `hierarchy`) |
| `SAPQuery` | `sql <query>` | `query` | `maxRows`, row offsets, other actions |
| `SAPTransport` | — | — | all (`list`, `history`, `info`, `release`) |
| `SAPGit` | — | — | all |
| `SAPContext` | — | — | all |
| `SAPLint` | — (the `lint <file>` CLI command is a **local** offline linter, not the `SAPLint` tool) | — | all (lint/format on live objects, formatter settings) |
| `SAPDiagnose` | `syntax <type> <name>` | `type`, `name` (only the `syntax` action) | `version` ← just added, not wired to CLI; `unittest`, `atc`, `dumps`, `traces`, `quickfix`, `apply_quickfix`, `system_messages`, `gateway_errors` |
| `SAPManage` | — | — | all |


### Proposed alignment direction (not implemented — for issue discussion)

- Add pass-through flags on existing shortcuts where the MCP schema exposes them and the CLI doesn't: `activate --preaudit`, `syntax --version active|inactive`, `read --version active|inactive` (if/when that's added on `SAPRead`).
- Add shortcuts for the five common read/write diagnostic tools currently missing: `inactive`, `refs`, `defs`, `atc`, `transport`, `lock`/`unlock` would all save typing. A short principled list (not 12) keeps the CLI discoverable.

## Why did tests not catch this?

Four blind spots combined:

1. No test activates an object that should fail and asserts the failure surfaces.
2. E2E fixtures ([tests/e2e/fixtures.ts](tests/e2e/fixtures.ts)) are all valid `$TMP` objects with clean source.
3. Complex-object activation tests go through `activateBatch()` (RAP stacks), bypassing the single `activate()` path that had the bug.
4. Unit tests assert the parser's handling of mock responses but never assert the outgoing request body or the post-activation state.

A single E2E test that: creates a class with a deliberate type error → attempts `SAPActivate` → asserts failure → asserts the returned message names the user and includes the compiler text — would have caught all five bugs.

## Open follow-ups

- Consider renaming the local `lint` command to `lint-local` or `offline-lint` to free `lint` for `SAPLint` (the MCP tool), or collapse it under a `local` sub-group.
- Auto-generate at least the required/optional field hints from the Zod schemas so CLI help stays in sync when someone adds a new `SAPDiagnose action=x` or a new `SAPRead type=y`.
- [ ] Clean up XML entity residue in `SyntaxMessage.text` (fast-xml-parser leaves `&quot;` / `&gt;` in attribute values; either post-process in the parser or configure the parser to decode entities in attributes).
- [x] Add unit tests for the preaudit handshake (15 tests in `tests/unit/adt/devtools.test.ts`: `parseActivationOutcome`, `activate()` two-step, `activateBatch()` two-step).
- [ ] Add unit tests for the remaining parser/handler fixes (syntax check, inactive objects parser).
- [ ] Add an E2E regression test: activate an object with a deliberate inactive compile error, assert failure and the specific message surface.
- [ ] Decide direction on CLI/server alignment (see matrix above). This is a UX-level change best treated as its own follow-up.
