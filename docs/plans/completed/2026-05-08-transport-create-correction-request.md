# SAPTransport.create — switch to CreateCorrectionRequest endpoint, default DEVCLASS to $TMP

## Overview

`SAPTransport(action="create")` is broken on NetWeaver 7.5x backends today. The current implementation posts a `<tm:root>` body to `/sap/bc/adt/cts/transportrequests` (the legacy CTS organizer endpoint). NW 7.5x's `CL_ADT_TM_RESOURCE` rejects that with HTTP 400 *"user action  is not supported"* regardless of where `tm:useraction` is placed (root attribute, request attribute, namespaceless, query parameter — all four were verified live on `npl.marianzeis.de`). PR #225 correctly diagnosed the gap and switched to the same endpoint Eclipse ADT and `marcellourbani/abap-adt-api` use: `POST /sap/bc/adt/cts/transports` with the `asx:abap` `CreateCorrectionRequest` schema. That endpoint works on both NW 7.50 and S/4HANA 2023 — verified live on `npl.marianzeis.de` and `a4h.marianzeis.de`.

The downside of PR #225 as written: the `CreateCorrectionRequest` endpoint requires `<DEVCLASS>` server-side (HTTP 500 *"Specify a package"* if empty), so PR #225 makes the `package` parameter mandatory for every `SAPTransport(action="create")` call — a `feat!` breaking change. This plan keeps the endpoint switch (which is necessary) but **defaults `DEVCLASS` to `$TMP` when the caller doesn't supply a package**. `$TMP` was verified to work on both systems and produces a normal type-K Workbench transport with no specific routing — functionally equivalent to what SE10 produces when you create a request without picking a target. Result: a non-breaking `fix:` rather than a `fix!:`, and existing callers (including the E2E suite, which calls `create` without a package) keep working unchanged.

The key design decision is that the `transportType` parameter (K/W/T) on `createTransport()` becomes a no-op — the new endpoint infers the transport type from the package's TADIR transport route, not from the request body. We remove it from the function signature (per CLAUDE.md "delete unused completely"). The `type` field on the `SAPTransport` tool schema stays — it's still used by `check`/`history` actions for object types — but its create-specific branch in the tool description is dropped.

## Context

### Current State

- `src/adt/transport.ts:80-102` — `createTransport(http, safety, description, targetPackage?, transportType='K')` posts `<tm:root>` to `/sap/bc/adt/cts/transportrequests` with `application/vnd.sap.adt.transportorganizer.v1+xml`. Response is XML with `<tm:request tm:number="...">`.
- `src/handlers/intent.ts:4752-4762` — handler reads `args.description`, `args.type` (defaulting to `'K'`), passes `undefined` as the package argument.
- `src/handlers/tools.ts:1212-1228` — tool description says *"create: create a new transport request"* and lists `type` as relevant for create.
- Live behavior:
  - On `a4h.marianzeis.de` (S/4HANA 2023): the legacy endpoint works without a package.
  - On `npl.marianzeis.de` (NW 7.50 SP02): the legacy endpoint fails with HTTP 400 *"user action  is not supported"*. The integration test `tests/integration/transport.integration.test.ts:140-148` has a `BACKEND_UNSUPPORTED` skip wired up for this, and the E2E test `tests/e2e/saptransport.e2e.test.ts:60-65` uses `classifyToolErrorSkip` to skip the same way.
- PR #225 (open, fix branch `fix/cts-create-useraction`) switches to the new endpoint but forces a mandatory `package` parameter (`feat!:` breaking change).

### Target State

- `createTransport()` posts an `asx:abap` `CreateCorrectionRequest` body to `/sap/bc/adt/cts/transports` with `application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.CreateCorrectionRequest` content-type and `text/plain` accept. Response body is a path like `/com.sap.cts/object_record/<id>`; transport ID is the last path segment.
- Function signature: `createTransport(http, safety, description, targetPackage?, objectUrl?)`. When `targetPackage` is `undefined`/empty, default to `'$TMP'` internally. The legacy `transportType` parameter is removed (the SAP backend now infers type from the package's TADIR route).
- Handler in `intent.ts` passes `args.package` straight through (`undefined` if not supplied) — the default-to-`$TMP` lives inside `createTransport()` so all callers (handler, integration tests, E2E tests) get the same behavior.
- Both S/4HANA 2023 and NW 7.50 successfully create transports with the default `$TMP` package — verified live during the planning research.
- Integration and E2E tests drop the `BACKEND_UNSUPPORTED: transport create not supported` skip block — the new endpoint works on NW 7.50.
- Tool description for `package` is reworded to mention the optional behavior on create; the `type` description drops the create-specific clause.

### Key Files

| File | Role |
|------|------|
| `src/adt/transport.ts` | Core transport ADT operations — rewrite `createTransport()` (endpoint, body shape, content-type, accept, response parser, `$TMP` default) |
| `src/handlers/intent.ts` | Handler routing — `handleSAPTransport()` `create` branch passes `args.package` straight through |
| `src/handlers/tools.ts` | Tool definition — refresh `package` description (now used by create), drop create-specific clause from `type` description |
| `tests/unit/adt/transport.test.ts` | Unit tests for transport functions — rewrite `createTransport` tests for the new endpoint, body, response shape; drop K/W/T-via-body tests; add `$TMP`-default test |
| `tests/unit/handlers/intent.test.ts` | Handler unit tests — rewrite `create` tests for the new body shape; drop K/W type-passes-through tests; add `package` and `$TMP`-default tests |
| `tests/integration/transport.integration.test.ts` | Integration tests — remove `user action is not supported` skip blocks; drop K/W per-type tests; add `$TMP`-default test |
| `tests/e2e/saptransport.e2e.test.ts` | E2E tests — remove the same `classifyToolErrorSkip` early-return for `user action is not supported` |
| `docs_page/tools.md` | SAPTransport tool reference — note `$TMP` default and that `package` controls the transport route |
| `docs/integration-test-skips.md` | Skip taxonomy — remove or update the `transport create not supported on this SAP release` row |
| `CLAUDE.md` | Key Files table — update the transport-related row to reflect the new endpoint shape |

### Design Principles

1. **Endpoint switch is necessary** — verified live on NW 7.50, the legacy `/transportrequests` POST genuinely doesn't work for create regardless of `useraction` placement. The new `/transports` `CreateCorrectionRequest` endpoint is the only cross-release option (Eclipse ADT and abap-adt-api both use it).

2. **`$TMP` default keeps the change non-breaking** — `$TMP` was verified to work as `DEVCLASS` on both S/4HANA 2023 and NW 7.50, producing a normal type-K Workbench transport with empty target. Functionally equivalent to the SE10 "no-package" workflow. Existing callers that pass `undefined`/no `package` keep working.

3. **Default lives in `createTransport()`, not the handler** — so all call paths (handler, integration tests, E2E tests, future direct callers) get the same `$TMP` default without each having to know the rule.

4. **`transportType` parameter is removed entirely** — per CLAUDE.md ("If you are certain that something is unused, you can delete it completely"). The new endpoint infers K/W/T from the package's TADIR route, so the legacy `transportType` argument has no effect on the SAP side. K/W/T integration tests that asserted body content are dropped.

5. **No package allowlist gate on transport create** — `createTransport()` already only calls `checkTransport()` (which validates `allowWrites + allowTransportWrites + allowedTransports`), not `checkPackage()`. The `DEVCLASS` in `CreateCorrectionRequest` is a transport-routing hint, not an "owning package" — the transport itself is package-agnostic. Defaulting to `$TMP` does not bypass any safety surface that was previously enforced. Three layers still apply: user scope `transports`, server `allowWrites + allowTransportWrites`, and SAP-side `S_TRANSPRT`.

6. **Commit message uses `fix:` not `fix!:`** — release-please will treat this as a patch-level change. No breaking-change marker because callers that omit `package` keep working.

7. **Keep the `type` field on the schema** — it's still used by the `check` and `history` actions (for object types like `PROG`/`CLAS`). Only the create-specific clause in the description is removed.

## Development Approach

Tasks are ordered: source rewrite first (with its unit tests bundled so the suite stays green), handler wiring next (with its tests), tool description, integration/E2E test cleanups, documentation, final verification. Each task ends with `npm test` so ralphex's per-task validation pass works. Integration and E2E tests are updated but only run during final verification (they need live SAP credentials).

The unit-test rewrites are not optional — they currently assert the legacy endpoint, body, and response shape. Skipping them would break the `npm test` run after Task 1.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Rewrite createTransport() to use the CreateCorrectionRequest endpoint with $TMP default

**Files:**
- Modify: `src/adt/transport.ts`
- Modify: `tests/unit/adt/transport.test.ts`

Switch the SAP endpoint from `/sap/bc/adt/cts/transportrequests` (legacy organizer) to `/sap/bc/adt/cts/transports` (CreateCorrectionRequest), which is the only endpoint that works on both NW 7.50 and S/4HANA 2023. Default `targetPackage` to `'$TMP'` internally so existing callers that don't pass a package keep working. Update the unit tests in the same task because they currently assert the legacy body/endpoint and would otherwise fail.

- [ ] In `src/adt/transport.ts`, replace the `createTransport()` function (currently lines 79–102) with a new implementation:
  - Signature: `export async function createTransport(http: AdtHttpClient, safety: SafetyConfig, description: string, targetPackage?: string, objectUrl?: string): Promise<string>`. Drop the old `transportType` parameter — it's not honored by the new endpoint.
  - Keep the safety check: `checkTransport(safety, '', 'CreateTransport', true);`
  - Resolve the effective DEVCLASS at the top of the function: `const devclass = (targetPackage && targetPackage.trim()) || '$TMP';`
  - Build the request body using the `asx:abap` envelope:
    ```typescript
    const refXml = objectUrl ? `<REF>${escapeXmlAttr(objectUrl)}</REF>` : '<REF/>';
    const body = `<?xml version="1.0" encoding="UTF-8"?><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
      <asx:values>
        <DATA>
          <DEVCLASS>${escapeXmlAttr(devclass)}</DEVCLASS>
          <REQUEST_TEXT>${escapeXmlAttr(description)}</REQUEST_TEXT>
          ${refXml}
          <OPERATION>I</OPERATION>
        </DATA>
      </asx:values>
    </asx:abap>`;
    ```
  - POST to `/sap/bc/adt/cts/transports` with content-type `'application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.CreateCorrectionRequest'` and Accept `'text/plain'`.
  - Parse the response: SAP returns a path like `/com.sap.cts/object_record/<id>`. Extract the transport ID as the last path segment: `String(resp.body ?? '').trim().split('/').pop() ?? ''`.
  - Add a JSDoc block above the function explaining: why this endpoint (NW 7.50 doesn't accept the legacy POST); that DEVCLASS defaults to `$TMP`; that the SAP backend infers transport type (K/W/T) from the package's TADIR route, so callers can no longer force a type via the body.
- [ ] Verify the JSDoc references both verified test systems by name (S/4HANA 2023 on `a4h.marianzeis.de` and NW 7.50 SP02 on `npl.marianzeis.de`) so future readers know where the diagnosis came from.
- [ ] In `src/handlers/intent.ts:4756`, the existing call is `await createTransport(client.http, client.safety, description, undefined, transportType)`. After the signature change, the 5th positional argument silently changes meaning (was `transportType`, now `objectUrl`) — TypeScript won't catch this because both are optional strings. **Do not fix it in this task** — Task 2 owns the handler change. Leave a comment on that line: `// FIXME(plan-task-2): 5th arg is now objectUrl, not transportType — Task 2 rewrites this call`. The runtime impact is harmless (the test value gets passed as an objectUrl in `<REF>`, which SAP will reject only if it's not a valid URL — but tests run with controlled inputs and Task 2 lands first in the same plan run).
- [ ] In `tests/unit/adt/transport.test.ts`, rewrite the `describe('createTransport', …)` block (currently lines ~195–234):
  - Update the "is blocked when transports not enabled" test signature to pass a package (or use `undefined` — both should hit the `checkTransport` path before `targetPackage` is read).
  - Replace the legacy XML response fixture (`<tm:request tm:number="..."/>`) with the new path response (`/com.sap.cts/object_record/DEVK900002`) in all `mockHttp(...)` setups.
  - Replace assertions on `tm:desc`, `tm:type`, `tm:target` with assertions on `<DEVCLASS>`, `<REQUEST_TEXT>`, `<REF/>`/`<REF>...</REF>`, `<OPERATION>I</OPERATION>`.
  - Add a test "defaults DEVCLASS to $TMP when targetPackage is undefined" that calls `createTransport(http, enabledSafety, 'desc')` and asserts the body contains `<DEVCLASS>$TMP</DEVCLASS>`.
  - Add a test "defaults DEVCLASS to $TMP when targetPackage is empty string" that calls with `''` and asserts the same.
  - Add a test "explicit package overrides $TMP default" that calls with `'ZTEST'` and asserts the body contains `<DEVCLASS>ZTEST</DEVCLASS>`.
  - Add a test "includes <REF> when objectUrl is provided" that passes `'/sap/bc/adt/oo/classes/zcl_foo'` and asserts the body contains `<REF>/sap/bc/adt/oo/classes/zcl_foo</REF>` (and not `<REF/>`).
  - Update the URL/content-type/Accept tests in the "CTS media types and namespaces" describe block (~lines 535–610): the create call now hits `/sap/bc/adt/cts/transports`, content-type contains `application/vnd.sap.as+xml` and `dataname=com.sap.adt.CreateCorrectionRequest`, Accept is `text/plain`.
  - Replace the `describe('createTransport with transport type', …)` block (~lines 396–419) with a single comment explaining that K/W/T is no longer carried in the request body — the SAP backend infers it from the package's TADIR route. Drop the three K/W/T assertion tests; they no longer reflect reality.
- [ ] Add unit tests (~6 tests total in this task — 4 new, ~2 reworked from existing): default-$TMP-when-undefined, default-$TMP-when-empty, explicit-override, REF-when-objectUrl, content-type, response-path-parsing.
- [ ] Run `npm test` — transport unit tests pass. Note: tests in `tests/unit/handlers/intent.test.ts` will still fail because they reference the old body shape; Task 2 fixes those. If `npm test` fails, narrow the run to `npx vitest run tests/unit/adt/transport.test.ts` to confirm the transport file alone is green.

### Task 2: Update handleSAPTransport create branch and refresh handler tests

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Wire the new `createTransport()` signature into the handler. The `args.package` value flows through; `createTransport()` itself applies the `$TMP` default. The `args.type` field is no longer used by create (the new endpoint infers type from the package's transport route), so we drop it from the create call.

- [ ] In `src/handlers/intent.ts:4752-4762`, update the `case 'create':` block:
  - Drop the `const transportType = String(args.type ?? 'K');` line.
  - Read the package: `const targetPackage = args.package ? String(args.package) : undefined;` (preserve undefined when not supplied — `createTransport()` will apply the `$TMP` default).
  - Call: `const id = await createTransport(client.http, client.safety, description, targetPackage);`
  - Keep the empty-id error fallback message unchanged.
- [ ] In `tests/unit/handlers/intent.test.ts`, update the `describe('SAPTransport handler routing', …)` block (around line 8587):
  - Replace the `'create with type W passes type through'` test (around line 8652) with a new test `'create with package passes DEVCLASS through'` that calls `SAPTransport` with `{ action: 'create', description: 'pkg test', package: 'ZTEST' }`, mocks the response as `/com.sap.cts/object_record/DEVK900099`, and asserts the request body contains `<DEVCLASS>ZTEST</DEVCLASS>`.
  - Replace the `'create without type defaults to K'` test (around line 8669) with `'create without package defaults DEVCLASS to $TMP'`. Mock the response as `/com.sap.cts/object_record/DEVK900099`, then assert the body contains `<DEVCLASS>$TMP</DEVCLASS>`. (The K/W/T type defaulting is no longer a thing — SAP infers from the package route.)
  - Search for any remaining `tm:type` or `tm:desc` references in the SAPTransport block and update them to the new body shape (`<REQUEST_TEXT>`, `<DEVCLASS>`).
  - Update the response-mock for any other create-related test in the SAPTransport block to use the path-style response (`/com.sap.cts/object_record/<ID>`), not the XML `<tm:request tm:number="...">`.
- [ ] Verify there are no remaining test failures from the body/response shape change. If a test outside the SAPTransport block uses `createTransport`, update it the same way.
- [ ] Add unit tests (~2 tests as the rewrites described above; both replace existing tests rather than add, so test count stays roughly flat).
- [ ] Run `npm test` — all unit tests now pass.

### Task 3: Update SAPTransport tool definition

**Files:**
- Modify: `src/handlers/tools.ts`

Refresh the tool input-schema descriptions so the LLM sees accurate guidance about the new `create` semantics: `package` is optional and defaults to `$TMP`, and `type` is no longer used by create (the SAP backend infers transport type from the package's transport route).

- [ ] In `src/handlers/tools.ts:1199`, update the `create:` clause inside the `action` enum description:
  - Old: `'create: create a new transport request. ' +`
  - New: `'create: create a new transport request (description required; package optional, defaults to $TMP — pass an explicit package to influence the transport route/type). ' +`
- [ ] In `src/handlers/tools.ts:1214`, update the `package` property description:
  - Old: `description: 'Package name (for check action)'`
  - New: `description: 'Package name. For create: optional — defaults to $TMP, pass an explicit package to influence the transport route (SAP infers K/W/T from the package\'s TADIR route). For check: required.'`
- [ ] In `src/handlers/tools.ts:1224-1228`, update the `type` property description to drop the create-specific clause:
  - Old: `'For create: transport type K=Workbench (default), W=Customizing, T=Transport of Copies. For check/history: object type (PROG, CLAS, DDLS, etc.)'`
  - New: `'Object type for check/history actions (PROG, CLAS, DDLS, etc.). Not used by create — transport type is inferred from the package\'s TADIR route on the new CreateCorrectionRequest endpoint.'`
- [ ] No new tool-definition unit tests are needed — the description fields are exercised indirectly via existing handler tests (which Task 2 already updated).
- [ ] Run `npm test` — all tests still pass.

### Task 4: Update integration tests for the new endpoint

**Files:**
- Modify: `tests/integration/transport.integration.test.ts`

Remove the `BACKEND_UNSUPPORTED: transport create not supported on this SAP release` skip blocks — the new endpoint works on NW 7.50 (verified live on `npl.marianzeis.de` during planning research). Drop the K/W/T per-type tests because the request body no longer carries `tm:type`, so they'd test nothing meaningful. Add a `$TMP`-default test that exercises the new no-package code path.

- [ ] Open `tests/integration/transport.integration.test.ts` and remove the `try/catch` skip wrapping in the create test (around lines 132–148): the `if (err instanceof Error && /user action\s+is not supported/i.test(err.message))` block is no longer needed — the new endpoint doesn't produce that error.
- [ ] Same for the create-and-delete test around lines 232–242: remove the `try/catch` around `createTransport`. Just call it directly.
- [ ] Replace the `describe('createTransport with type', …)` block (around lines 261–305) with a single inline comment: `// K/W/T transport type is no longer driven by the request body — the CreateCorrectionRequest endpoint infers the type from the target package's transport route in TADIR. Per-type integration tests would need separate Customizing/Workbench packages and aren't portable, so they're removed.` Drop the two test cases (`'creates a Customizing transport (type W)'` and `'creates a Transport of Copies (type T)'`).
- [ ] Add a new test inside the `describe('createTransport', …)` block: `'creates a transport without explicit package (defaults to $TMP)'`. It calls `await createTransport(client.http, client.safety, 'ARC-1 IT default-tmp ${Date.now()}')`, expects a transport ID matching `/^[A-Z0-9]+K\d+$/`, calls `getTransport()` to verify it's a real transport (id matches, description matches, owner is the calling user), then deletes it via `deleteTransport(client.http, client.safety, id, true)` in a `try/finally` for cleanup. Tag the cleanup catch with `// best-effort-cleanup`.
- [ ] In the `describe('reassignTransport', …)` and `describe('releaseTransportRecursive', …)` blocks (around lines 277–325), the `requireOrSkip(ctx, pkg, SkipReason.NO_TRANSPORT_PACKAGE)` calls and the explicit `pkg` argument to `createTransport(...)` are now redundant — those tests don't actually depend on a Z* package, they just test reassign/release. Remove both: the `requireOrSkip` line and the `pkg` positional arg. The tests now create their throwaway transport with the `$TMP` default and clean up via `deleteTransport`. This widens the systems on which these tests can run (no longer need `TEST_TRANSPORT_PACKAGE` set).
- [ ] Verify all remaining `createTransport(...)` call sites in this file are valid against the new signature — `(http, safety, description, targetPackage?, objectUrl?)`. The old `transportType` argument is gone; remove any positional `'K'`/`'W'`/`'T'` strings.
- [ ] Run `npm test` (unit only — no SAP needed). Integration tests are exercised in the final-verification task.

### Task 5: Update E2E tests to drop the user-action-not-supported skip

**Files:**
- Modify: `tests/e2e/saptransport.e2e.test.ts`

Remove the `classifyToolErrorSkip` early-return block in the create-transport E2E test. The new endpoint works on NW 7.50, so the skip pattern (`/user action\s+is not supported/i`) no longer fires.

- [ ] In `tests/e2e/saptransport.e2e.test.ts`, locate the `describe('SAPTransport create + get', …)` block. Inside the `'creates a transport and returns a valid transport ID'` test (around lines 47–74), remove the block:
  ```typescript
  // Known NW 7.50 backend gap: transport create returns 400
  // "user action is not supported". All downstream tests depend on this.
  const releaseSkip = classifyToolErrorSkip(result);
  if (releaseSkip !== null) {
    transportsEnabled = false;
    return ctx.skip(releaseSkip);
  }
  ```
  Keep the `allowTransportWrites=false` check — that one is still relevant for read-only deployments.
- [ ] Search the whole file for other references to `'user action'` or `classifyToolErrorSkip` and remove them only if they are guarding the same assumption (the create call failing on NW 7.50). Leave any `classifyToolErrorSkip` calls that guard against unrelated `BACKEND_UNSUPPORTED` failures (e.g. release-on-empty-system).
- [ ] Confirm the test file still compiles — if removing the early return creates an unused-variable warning for `transportsEnabled`, leave the variable in place (it's still used by downstream `if (!transportsEnabled) return ctx.skip(...)` checks for `allowTransportWrites=false`).
- [ ] Add unit tests: not applicable — this task only updates E2E tests, which are exercised in the final-verification task.
- [ ] Run `npm test` — all unit tests still pass (E2E tests are not in the unit lane).

### Task 6: Update documentation — tools, skip taxonomy, CLAUDE.md

**Files:**
- Modify: `docs_page/tools.md`
- Modify: `docs/integration-test-skips.md`
- Modify: `CLAUDE.md`

Update the user-facing tool reference, the test-skip taxonomy, and the AI-assistant Key Files table so the new behavior is documented and the now-obsolete skip is removed.

- [ ] In `docs_page/tools.md` around line 416 (`## SAPTransport`), update the SAPTransport section:
  - Update the introductory sentence (line 418) to clarify that create now uses the ADT `CreateCorrectionRequest` endpoint and works across NW 7.50+ and S/4HANA.
  - Update the parameter table row for `package` (line 426): replace `Package name (for check action, e.g. ZDEV)` with `Package name. Optional for create (defaults to $TMP — pass an explicit package to influence the transport route). Required for check.`
  - Update the parameter table row for `type` (line 432): drop the create-specific clause. New text: `For check/history: object type (PROG, CLAS, DDLS, etc.). Not used by create — the SAP backend infers transport type from the package's TADIR route.`
  - Update the `create` action bullet under Actions (line 442): `**create** — Create a new transport request. Requires description. Optional package (defaults to $TMP — explicit package controls the transport route, which determines K/W/T type).`
- [ ] In `docs/integration-test-skips.md`, find the row containing `transport create not supported on this SAP release` (around line 62) and remove that entire row. The reason is no longer valid — the new endpoint works on NW 7.50. Also remove the corresponding sentence in the *"When to investigate"* paragraph that follows (`If 'transport create not supported' fires on a production NW system, this is worth a bug report — our backend-compat probing may need tightening.`) — replace it with: `Note (2026-05-08): the previous "transport create not supported" entry was removed when SAPTransport.create switched to the CreateCorrectionRequest endpoint, which works on NW 7.50.`
- [ ] In `CLAUDE.md`, find the row in the "Key Files for Common Tasks" table for *"Add object transport history (reverse lookup)"* (search for the literal text — it cites `getObjectTransports` and `transport.ts`). Insert a new row **immediately after** that row, before the gCTS / abapGit row:
  ```
  | Modify SAPTransport.create endpoint or DEVCLASS default | `src/adt/transport.ts` (`createTransport` — POSTs `/sap/bc/adt/cts/transports` with `asx:abap` `CreateCorrectionRequest`; defaults DEVCLASS to `$TMP` when caller omits `targetPackage`), `src/handlers/intent.ts` (`handleSAPTransport` case `create`), `src/handlers/tools.ts` (tool description for `package`/`type`), `tests/unit/adt/transport.test.ts`, `tests/integration/transport.integration.test.ts` |
  ```
  Use the same `\| ... \|` markdown-table format as the surrounding rows (don't add blank lines).
- [ ] No code changes in this task — only doc updates. Skip the test checkbox.
- [ ] Run `npm test` — all tests still pass.

### Task 7: Final verification

**Files:**
- (read-only checks plus a plan file move)

Run the full validation pass and confirm the change works against both real systems before declaring the plan complete.

- [ ] Run `npm test` — full unit suite passes (1300+ tests).
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm run lint` — no errors.
- [ ] Optional but recommended: run `npm run test:integration` against `a4h.marianzeis.de` (S/4HANA 2023). Expected: `creates a transport without explicit package (defaults to $TMP)` passes; `creates a transport via CreateCorrectionRequest endpoint` passes; the previous `BACKEND_UNSUPPORTED` skip block does not fire.
- [ ] Optional but recommended: run `npm run test:integration` against `npl.marianzeis.de` (NW 7.50 SP02). Expected: same tests pass; no `user action is not supported` skips remain.
- [ ] Confirm the diff does not include `feat!` or breaking-change markers — this is a `fix:` (the change is non-breaking thanks to the `$TMP` default).
- [ ] Move this plan to `docs/plans/completed/2026-05-08-transport-create-correction-request.md`.
