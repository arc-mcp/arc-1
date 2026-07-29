# NW 7.50 FUGR/FUNC/DDIC surface gaps

## Overview

> **As-shipped correction (2026-07-29).** Tasks 1–3 below planned the FUNC
> `processingType`/`updateTaskKind` **write**. While this plan was executing,
> [PR #634](https://github.com/arc-mcp/arc-1/pull/634) landed the same feature on main
> independently — same parameter names, same live-derived contract, and it additionally supports
> FUNC inside `batch_create`, which Design Principle 8 below had ruled out. Those three tasks were
> therefore **dropped, not shipped from this plan**; `src/handlers/function-processing.ts` +
> `write/create.ts` are the write implementation. Task 4 (the `SAPRead` read-back) shipped and
> complements #634, which exposes no read. Tasks 5–9 shipped as planned. The wire-budget note in
> Design Principle 7 is also superseded: #634 raised `WRITE_WIRE_WALL` to 72 000, so this work
> needed no budget change of its own.
>
> Two contract details the merge surfaced, both recorded in §6b of the dossier: #634's input enum
> omits `collectiveRun` (which SAP does emit on existing modules, so the read side reports SAP's
> value verbatim), and the fmodule resource's native version is release-dependent — 7.50 answers
> `…fmodules.v2+xml`, 758 answers `v3` — so the read negotiates rather than pinning a version.


Six gaps in ARC-1's function-group / function-module / DDIC surface, all found while auditing whether
ARC-1 can install the open-rfc beta fixtures on NetWeaver 7.50. Two are real capability gaps (ADT
supports the operation on 7.50, ARC-1 does not implement it); three are error-quality gaps where the
operation is genuinely impossible on 7.50 but ARC-1 fails with a misleading message instead of a
release hint; one is a stale doc row.

Every ADT fact in this plan was verified live on **npl.marianzeis.de (NW 7.50 SP02)** and
**a4h.marianzeis.de (S/4HANA 2023, SAP_BASIS 758)** on 2026-07-29. The evidence, including the
exact request/response of each spike, is in
[docs/research/2026-07-29-nw750-fixture-create-surface.md](../../research/2026-07-29-nw750-fixture-create-surface.md).
Section references below (§8.1 … §8.4) point into that dossier.

What "done" looks like:
- `SAPWrite type=FUNC` can set a function module's processing type (normal / RFC-enabled / V1 update
  module) and update-task kind, and `SAPRead type=FUNC includeSignature=true` reports them back.
- `SAPWrite type=INCL` with `group=` can create and delete function-group structural includes, not
  just update them.
- DOMA creates and `SAPManage create_package` on a pre-7.52 system return a release hint instead of a
  raw 404 with a contradictory "object not found, use SAPSearch" suffix.
- `SAPRead type=FUGR` works on 7.50 instead of 404-ing.
- No new env vars, no new config flags, no new tools.

## Context

### Current State

- **FM processing type**: `grep -rn "processingType" src/ tests/` returns **zero hits**. The create
  envelope `buildCreateXml('FUNC', …)` in `write-helpers.ts:~681` emits only
  `adtcore:description`/`name`/`type` + `containerRef`. Every FM ARC-1 creates is `normal`; there is
  no way to make one RFC-enabled or an update module, and no way to read the flag back.
- **Structural includes**: `handleSAPWrite` in `write.ts:~160` refuses outright —
  `'SAPWrite type=INCL with group supports action="update" or "edit_unit" only; create/delete of FUGR
  structural includes is unsupported.'` A bare `INCL` create falls through to
  `/sap/bc/adt/programs/includes`, which SAP rejects for `L*` names with
  `500 "Program names L... are reserved for function group includes"`.
- **DOMA on 7.50**: `objectBasePath('DOMA')` (`object-types.ts:~379`) routes straight to
  `/sap/bc/adt/ddic/domains/`, which does not exist before 7.52. The caller gets a 404 plus a hint
  that says the object *was not found* and to use `SAPSearch` — actively wrong for a create, and an
  LLM will loop on it. Contrast `TABL/DT` and `TTYP`, which already have discovery gates
  (`TABL_DT_WRITE_UNAVAILABLE_HINT`, `TTYP_WRITE_UNAVAILABLE_HINT` in `write-helpers.ts:~1127`).
- **DEVC on 7.50**: `SAPManage create_package` POSTs to `/sap/bc/adt/packages`, which is absent
  wholesale on 7.50 → `404 "No suitable resource found"` plus a SICF-misconfiguration hint that
  sends the operator down the wrong path.
- **`SAPRead type=FUGR` on 7.50**: `getFunctionGroup()` (`client.ts:~598`) GETs
  `/sap/bc/adt/functions/groups/{name}/objectstructure` with
  `Accept: application/vnd.sap.adt.objectstructure.v2+xml`. That sub-resource 404s on 7.50 under
  every Accept, so the default FUGR read fails there. Only `expand_includes=true` works.
- **Stale doc row**: `docs/integration-test-skips.md` still lists
  `BACKEND_UNSUPPORTED: DTEL v2 content type not supported on this release` for NW 7.50–7.51. The
  `CONTENT_TYPE_FALLBACKS` v2→v1 retry in `crud.ts:~83` fixed that; DTEL create succeeds on 7.50.

### Target State

- New client pair `getFunctionModuleProperties()` / `setFunctionModuleProperties()` implementing the
  GET → mutate → PUT → read-back-and-assert contract, mirroring `setApiReleaseState()`.
- `SAPWrite type=FUNC` accepts `processingType` and `updateTaskKind` on `create` and `update` (not on
  `batch_create` — see Design Principle 8). Invalid combinations are rejected client-side with an
  actionable message.
- `SAPRead type=FUNC includeSignature=true` returns `processingType`/`updateTaskKind` alongside the
  parsed signature.
- `SAPWrite type=INCL` + `group=` supports `create` and `delete`.
- Two new discovery gates (`isDomainsEndpointAvailable`, `isPackagesEndpointAvailable`) with hint
  constants, wired into the single-object write path, the `batch_create` path, and `manage.ts`.
- `getFunctionGroup()` falls back to `/sap/bc/adt/repository/objectstructure` on 404.

### Key Files

| File | Role |
|------|------|
| `src/adt/client.ts` | `getFunctionGroup()` (~598), `setApiReleaseState()` (~1053) — the GET→PUT prior art. New FM-property pair goes here. |
| `src/adt/xml-parser.ts` | `parseFunctionGroup()` (~402), `buildApiReleasePutBody()` (~956). New FM-property parse/mutate + projectexplorer parser. |
| `src/handlers/write.ts` | `handleSAPWrite` URL-routing prologue: the INCL+group branch (~160), the TABL/TTYP discovery gates (~173-184). |
| `src/handlers/write/create.ts` | `writeActionCreate` — POST URL/content-type selection (~470-500), FUNC source step (~577), `batch_create` gate copy (~852-859). |
| `src/handlers/write/update-delete.ts` | `writeActionUpdate` (~53), `writeActionDelete` (~260) — generic lock→op→unlock. |
| `src/handlers/write-helpers.ts` | `buildCreateXml` (FUNC ~681, FUGR ~660), `createContentTypeForType` (~108), `needsVendorContentType` (~93), hint constants (~1127). |
| `src/handlers/read.ts` | `handleSAPRead` `case 'FUNC'` (~342, the `includeSignature` block) and `case 'FUGR'` (~381). |
| `src/handlers/feature-cache.ts` | `isTablesEndpointAvailable()` (~64), `isTableTypesEndpointAvailable()` (~75) — the pattern for the two new gates. |
| `src/handlers/manage.ts` | `case 'create_package'` (~100). |
| `src/handlers/{tools,schemas}.ts` | Three-file schema sync for the new SAPWrite params. |
| `tests/fixtures/tool-definitions/*.json` | Frozen LLM-visible tool surface — changes here need `vitest -u` + reviewed diff. |

### Verified Live Evidence

All captured 2026-07-29; full transcripts in the dossier.

- **§8.1 — FM properties need GET → mutate → PUT.** A hand-built minimal envelope (root element +
  `containerRef` + the one attribute) is rejected with `400 ExceptionInvalidData` / *"Unexpected Case
  in Branch"*. GETting the current representation (`Accept: …fmodules.v3+xml`), editing attributes on
  the root element and PUTting the body back **verbatim including atom links** (CT
  `…fmodules.v3+xml`) under a `MODIFY` lock returns 200 and persists. Identical on 7.50 and 758.
  - `processingType="rfc"` → persists (758 additionally auto-fills `rfcScope="notClassified"`,
    `rfcVersion="any"`; 7.50 emits neither).
  - `processingType="update"` + `updateTaskKind="startImmediate"` → both persist.
  - back to `processingType="normal"` → persists, and SAP clears `updateTaskKind` itself.
  - `updateTaskKind` **without** `processingType="update"` → **HTTP 200 and silently ignored**.
  - invalid value → 400 *"Unexpected Case in Branch"* (useless text).
  - After the PUT the FM reads `adtcore:version="inactive"`; a subsequent `SAPActivate` on the group
    keeps the attributes in the active version (verified on 7.50).
- **§8.2 — structural includes.** `POST /sap/bc/adt/functions/groups/{g}/includes` with CT
  **`application/vnd.sap.adt.functions.fincludes.v2+xml`** creates the include on both 7.50 and 758.
  The unversioned type is refused: *"Supported Media Types: …fincludes.v2+xml"*. No group lock and no
  `_package` parameter — the include inherits the group's package. Delete = lock the include →
  `DELETE ?lockHandle=…` → GET 404. Names `L<GRP>F01/O01/E01/T99/F99` all accepted; an arbitrary name
  (`ZZ_ARBITRARY_INC`) → `500 "Attributes for program ZZ_ARBITRARY_INC have not been saved"`. SAP
  maintains the main program itself: create appends `INCLUDE <name>.`, delete comments the line out.
- **§8.3 — FUGR read fallback.** `/functions/groups/{g}/objectstructure` 404s on 7.50 under every
  Accept. `/sap/bc/adt/repository/objectstructure?objectname=ZZSPK750&objecttype=FUGR/F` works there
  — note the **lowercase** parameter names; the camelCase form returns
  `400 "Parameter objectname could not be found"`. The response is a different shape,
  `projectexplorer:objectstructure` with flat `projectexplorer:node` elements, and carries **both**
  includes (`objecttype="FUGR/I"`) and function modules (`objecttype="FUGR/FF"`) — full parity with
  what `parseFunctionGroup()` extracts from the 758 `abapsource:objectStructureElement` tree.
- **§8.4 — discovery keys** (from `tests/fixtures/probe/*/meta.json`, 4 systems):
  `/sap/bc/adt/ddic/domains` and `/sap/bc/adt/packages` are both absent on npl 750 and on a real
  ECC EhP8 / 7.50 SP31 production system, and present on a4h 758 and ABAP Platform 816.
- **Prior art check**: `grep -rn "processingType\|fincludes"` over `~/DEV/mcp-abap-adt` and
  `~/DEV/mcp-abap-adt-fr0ster` → no hits. Neither reference implementation does any of this. SAP's
  own Eclipse plugin `com.sap.adt.functions_3.58.1` (`model/fmodules.xsd`, `model/fincludes.xsd`) is
  the authority for the attribute vocabulary and enum values.

### Design Principles

1. **GET → mutate → PUT, never a hand-built envelope.** §8.1 proves partial bodies are rejected. The
   implementation must fetch the current representation and edit it, exactly like
   `setApiReleaseState()`.
2. **Validate client-side; SAP's errors are useless here.** The enum values come from SAP's own XSD
   (`processingType ∈ {normal, rfc, update}`, `updateTaskKind ∈ {startImmediate,
   immediateStartNoRestart, startDelayed, collectiveRun}`); an invalid value only earns *"Unexpected
   Case in Branch"*. `updateTaskKind` without `processingType="update"` is silently swallowed by SAP
   (200 but no effect) — the classic "200 ≠ honored" trap — so ARC-1 must reject that combination
   before the request.
3. **Read back and assert.** The property PUT is exactly the kind of call where a 200 does not mean
   the value was honored. Confirm with a follow-up GET and fail loudly if the value did not stick.
4. **Release-invariant behavior, release-gated availability.** Every contract in §8.1–§8.3 behaves
   identically on 7.50 and 758. Only *availability* differs, and only for the domains/packages
   endpoints (§8.4), which is what the two new gates encode. The `rfcScope`/`rfcVersion` attributes
   that 758 auto-fills are read-only noise — do not send them, do not assert on them.
5. **Gates mirror the existing shape.** The two new `feature-cache.ts` helpers are one-line siblings
   of `isTablesEndpointAvailable()`; the two hint constants sit beside
   `TABL_DT_WRITE_UNAVAILABLE_HINT`. Do not invent a new gating mechanism.
6. **`undefined` gate means "not probed" — do not block.** `isTablesEndpointAvailable()` returns
   `boolean | undefined`; the existing gates fire only on an explicit `=== false`. Keep that: a
   stdio session that never ran discovery must not start refusing DOMA creates.
7. **Scope boundaries.** No new env vars, no new config flags, no new tools, no new scopes — FUNC and
   INCL writes already map to the `write` scope via `ACTION_POLICY`. Existing read behavior on 758/816
   must not change: the FUGR fallback fires only on a 404 from the current path.
8. **`batch_create` is a separate surface — but FUNC is not part of it.** It has its own item
   sub-schema in `tools.ts`/`schemas.ts` and its own copy of the discovery gates
   (`write/create.ts:~852`), so the new DOMA gate must land there too. It does **not** support FUNC
   creation: the batch loop derives its URL from `objectUrlForType(objType, objName)`
   (`write/create.ts:~887`) and `objectBasePath('FUNC')` throws by design (PR #223, because a generic
   URL builder cannot know the parent group), and `batchObjectSchemaOnprem` (`schemas.ts:~404`) has no
   `group` field. So the FM properties are wired into single-object `create` and `update` only.
   Making FUNC batch-creatable is a separate change and explicitly out of scope here.

## Development Approach

TDD throughout: write the failing unit test first, then the implementation. Unit tests mock the HTTP
layer with `vi.mock('undici', …)` + `mockResponse()` from `tests/helpers/mock-fetch.ts`.

**Fixture provenance.** Two XML fixtures must be captured from a live system, not hand-written:
the 7.50 `projectexplorer:objectstructure` response for a function group, and an `fmodule` GET
representation. Capture them with `curl` against npl/a4h (credentials in `INFRASTRUCTURE.md`), save
under `tests/fixtures/xml/`, and add a header comment recording system + date. Do not hand-edit them
afterwards — a parser asserted only against a hand-written fixture is exactly how invented ADT shapes
have shipped before (see `docs/plans/completed/2026-05-08-audit-purge-invented-adt-types.md`).

**Failure paths are mandatory.** Each code-changing task includes at least one negative test. For the
schema changes specifically, include a polluted-payload test: LLM clients over-populate optional
fields, so cover empty-string optionals and cross-type fields (e.g. `processingType` passed on a
non-FUNC write must be ignored, not crash).

**The LLM-visible surface is frozen.** `tests/fixtures/tool-definitions/*.json` is asserted
byte-for-byte by `tool-definitions-snapshot.test.ts`. Tasks that change `tools.ts` must regenerate it
with `npx vitest run tests/unit/handlers/tool-definitions-snapshot.test.ts -u` and the diff must be
reviewed — it is the contract every MCP client sees.

**Live verification is release-paired.** This area is release-sensitive, so the final task verifies on
both npl (7.50) and a4h (758). For the write features that means a real create → property-set →
`SAPActivate` → read-back cycle, because activation is the only definitive correctness check.
Throwaway objects go in `$TMP` and must be deleted; do not commit smoke scripts.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add FM property parsing and body mutation to the XML layer

**Files:**
- Modify: `src/adt/xml-parser.ts` (add near `parseFunctionGroup` at ~402)
- Modify: `src/adt/types.ts` (add the result interface near the other `*Info`/`*Result` types)
- Create: `tests/fixtures/xml/function-module-properties.xml` (captured live — see below)
- Modify: `tests/unit/adt/xml-parser.test.ts`

Pure functions first, no I/O — the client wiring lands in Task 2. SAP rejects partial envelopes
(dossier §8.1), so the "build" half is a *mutation* of a fetched document, not a template. Mirror
`buildApiReleasePutBody()` at `xml-parser.ts:~956`, which does the same GET-body-rewrite trick for
API release state.

Capture the fixture from a live system first (creds in `INFRASTRUCTURE.md`) — a real fmodule GET
response for any existing FM, e.g.:

    curl -s -u <user>:<pw> \
      -H 'Accept: application/vnd.sap.adt.functions.fmodules.v3+xml' \
      'http://a4h.marianzeis.de:50000/sap/bc/adt/functions/groups/srfc/fmodules/rfc_ping?sap-client=001'

- [ ] Capture the fixture above into `tests/fixtures/xml/function-module-properties.xml` with a
      header comment naming the system, release and date. Do not hand-edit it afterwards.
- [ ] Add to `src/adt/types.ts`:

      export type FmProcessingType = 'normal' | 'rfc' | 'update';
      export type FmUpdateTaskKind =
        | 'startImmediate' | 'immediateStartNoRestart' | 'startDelayed' | 'collectiveRun';
      export interface FunctionModuleProperties {
        processingType?: FmProcessingType;
        updateTaskKind?: FmUpdateTaskKind;
        releaseState?: string;
      }

      (The enum members come from SAP's own `model/fmodules.xsd` in
      `com.sap.adt.functions_3.58.1`. `unsupportedKind` exists in the XSD but is a read-only
      degenerate value — do not accept it as input.)
- [ ] Implement `parseFunctionModuleProperties(xml: string): FunctionModuleProperties` reading the
      `fmodule:processingType`, `fmodule:updateTaskKind` and `fmodule:releaseState` attributes of the
      root `fmodule:abapFunctionModule` element. Return `{}` for a document with none of them.
- [ ] Implement `buildFunctionModulePutBody(getXml, props: FunctionModuleProperties): string`. It must
      strip any existing `fmodule:processingType` / `fmodule:updateTaskKind` attributes from the root
      element and insert the requested ones, leaving the rest of the document — including the
      `atom:link` children — byte-identical. Setting `processingType` to anything other than
      `'update'` must also drop `updateTaskKind` (SAP clears it server-side; keeping it in the body
      is misleading).
- [ ] Throw a `TypeError` with the allowed values listed when `props.processingType` is not one of
      the three enum values, or `props.updateTaskKind` is not one of the four.
- [ ] Add unit tests (~10 tests) in a `describe('function module properties')` block in
      `tests/unit/adt/xml-parser.test.ts`: parse the captured fixture; parse a document with no
      attributes → `{}`; round-trip set `rfc` and re-parse; set `update`+`startImmediate` and
      re-parse; set `normal` over an existing `update`+`startImmediate` and assert `updateTaskKind` is
      gone; assert the `atom:link` elements survive the mutation byte-for-byte; and two failure cases
      — invalid `processingType`, invalid `updateTaskKind` — asserting the thrown message names the
      valid values.
- [ ] Run `npm test` — all tests must pass

### Task 2: Add the client GET → mutate → PUT → confirm pair for FM properties

**Files:**
- Modify: `src/adt/client.ts` (new methods near `getFunction`/`getFunctionGroup` at ~598; mirror `setApiReleaseState` at ~1053)
- Modify: `tests/unit/adt/client.test.ts`

This is the I/O half. The contract is proven in dossier §8.1: GET the representation, mutate, PUT it
back verbatim under a `MODIFY` lock, then GET again to confirm — because a 200 from this endpoint does
*not* mean the value was honored (`updateTaskKind` without `processingType="update"` returns 200 and
does nothing).

- [ ] Implement `async getFunctionModuleProperties(group: string, name: string): Promise<FunctionModuleProperties>`.
      Guard with `checkOperation(this.safety, OperationType.Read, 'GetFunctionModuleProperties')` first
      — every ADT endpoint must be safety-guarded. GET
      `/sap/bc/adt/functions/groups/{group_lc}/fmodules/{name_lc}` with
      `Accept: application/vnd.sap.adt.functions.fmodules.v3+xml`, parse with
      `parseFunctionModuleProperties`. Both path segments are lowercased and `encodeURIComponent`-ed,
      matching the existing FUNC URL construction in `write.ts:~155`.
- [ ] Implement `async setFunctionModuleProperties(group, name, props, opts: { transport?: string } = {}): Promise<FunctionModuleProperties>`.
      Guard with `checkOperation(this.safety, OperationType.Update, 'SetFunctionModuleProperties')`.
      Reject `props.updateTaskKind` when `props.processingType !== 'update'` with an
      `Error` reading roughly: *"updateTaskKind only applies when processingType is 'update' — SAP
      accepts the request but silently ignores the value."* Then: GET the current body →
      `buildFunctionModulePutBody` → inside `client.http.withStatefulSession`, `lockObject(…, 'MODIFY')`
      → `http.put(url + '?lockHandle=…', body, 'application/vnd.sap.adt.functions.fmodules.v3+xml')`
      → `unlockObject` in a `finally`. Propagate the lock's `corrNr` as the transport when no explicit
      `transport` is passed, matching `writeActionDelete` in `write/update-delete.ts:~260`.
- [ ] After the PUT, re-GET and assert the requested values actually stuck; throw an `AdtApiError`
      naming the requested vs observed value if not. Return the confirmed properties.
- [ ] Add unit tests (~8 tests) in a `describe('function module properties')` block in
      `tests/unit/adt/client.test.ts`, mocking undici via `mockResponse()`: happy path for `rfc`
      (assert the PUT Content-Type and that the PUT body is the mutated GET body); happy path for
      `update` + `startImmediate`; the unlock still runs when the PUT rejects; `updateTaskKind`
      without `processingType='update'` throws before any HTTP call; the read-back-mismatch case
      throws; and a safety test asserting a read-only `SafetyConfig` blocks
      `setFunctionModuleProperties`.
- [ ] Run `npm test` — all tests must pass

### Task 3: Expose processingType/updateTaskKind on SAPWrite type=FUNC

**Files:**
- Modify: `src/handlers/tools.ts` (SAPWrite property descriptions)
- Modify: `src/handlers/schemas.ts` (SAPWrite Zod schema + `validateSapWriteInput` at ~362)
- Modify: `src/handlers/write/create.ts` (`writeActionCreate`, after the FUNC source step at ~577)
- Modify: `src/handlers/write/update-delete.ts` (`writeActionUpdate` at ~53)
- Modify: `tests/unit/handlers/schemas.test.ts`
- Modify: `tests/unit/handlers/write-create-batch.test.ts`
- Modify: `tests/fixtures/tool-definitions/*.json` (regenerate, see below)

Wires Task 2 into the tool surface. The properties cannot be set on the create POST — SAP returns 201
and silently ignores them (dossier §8.1) — so this must be a **follow-up call after** the create and
after the source write, not an addition to `buildCreateXml`.

Scope note: do **not** add these to the `batch_create` item schema. FUNC cannot be created through
`batch_create` at all — that loop derives its URL from `objectUrlForType()` (`write/create.ts:~887`)
and `objectBasePath('FUNC')` throws by design, and `batchObjectSchemaOnprem` (`schemas.ts:~404`) has
no `group` field to resolve the parent group with. Single-object `create` and `update` only.

- [ ] Add two optional properties to the on-prem SAPWrite schema in `schemas.ts`: `processingType` as
      `z.enum(['normal','rfc','update']).optional()` and `updateTaskKind` as
      `z.enum(['startImmediate','immediateStartNoRestart','startDelayed','collectiveRun']).optional()`.
      Do **not** use `looseOptionalBoolean`-style coercion — these are string enums and Zod must
      reject unknown values. FUNC write is on-prem-only, so the BTP schema does not need them.
- [ ] Extend `validateSapWriteInput()` (`schemas.ts:~362`) with the cross-field rules, so the caller
      gets a proper Zod path-anchored error instead of a runtime failure: `updateTaskKind` without
      `processingType === 'update'` is an error naming the reason (SAP returns 200 and silently
      ignores it — dossier §8.1), and either property on a non-FUNC `type` is an error. Follow the
      existing empty-string-is-absent convention at the top of that function (`if (!input.include ||
      input.include.trim() === '') return;`) so `processingType: ''` from an over-populating LLM
      client is treated as absent rather than as an invalid enum.
- [ ] Add matching JSON Schema entries in `tools.ts` for the SAPWrite schema, with a description
      stating: FUNC only; `rfc` = Remote-Enabled Module; `update` = V1 update module and requires
      `updateTaskKind`; the change leaves the FM inactive so `SAPActivate` is required. Keep the
      three-file sync (`tools.ts` + `schemas.ts` + handler) intact.
- [ ] In `writeActionCreate` (`write/create.ts`), after the FUNC source step completes and only when
      `type === 'FUNC'` and either property was supplied, call
      `client.setFunctionModuleProperties(group, name, …)` and append a note to the success message
      naming the applied values and that `SAPActivate` is needed. A failure here must surface as an
      error, not be swallowed — the object exists but is not what the caller asked for.
- [ ] Do the same in `writeActionUpdate` (`write/update-delete.ts:~53`) so an existing FM can be
      switched without recreating it. On `update` the properties must be applicable on their own,
      without a `source` payload.
- [ ] Add unit tests (~10 tests): create with `processingType='rfc'` calls the client method with the
      right args; create without either property does **not** call it; `update` with only
      `processingType` and no source still applies it; **failure paths** — `processingType='bogus'`
      rejected by Zod with a message naming valid values, `updateTaskKind` without
      `processingType='update'` rejected with the "silently ignored by SAP" reason,
      `processingType` on `type='CLAS'` rejected; **polluted payload** — `processingType: ''` and
      `updateTaskKind: ''` are treated as absent, not as invalid enums.
- [ ] Regenerate the frozen tool surface:
      `npx vitest run tests/unit/handlers/tool-definitions-snapshot.test.ts -u`, then read the
      fixture diff and confirm it contains only the two new properties.
- [ ] Run `npm test` — all tests must pass

### Task 4: Report processingType/updateTaskKind on SAPRead type=FUNC

**Files:**
- Modify: `src/handlers/read.ts` (`handleSAPRead` `case 'FUNC'`, the `includeSignature` block at ~361)
- Modify: `src/handlers/tools.ts` (the `includeSignature` parameter description)
- Modify: `tests/unit/handlers/read.test.ts`
- Modify: `tests/fixtures/tool-definitions/*.json` (regenerate)

Without this, a caller can set the flag but never verify it — and verifying "is this FM really
RFC-enabled?" is the main reason the flag matters. `includeSignature=true` already returns JSON
(`{source, signature}`), so extending that payload is the natural home and leaves the default
plain-source response untouched.

- [ ] In the `args.includeSignature === true` branch, additionally call
      `client.getFunctionModuleProperties(group, name)` and extend the payload to
      `{ source, signature, processingType, updateTaskKind? }`. Omit `updateTaskKind` when SAP does
      not report one.
- [ ] Make the properties read best-effort: if that GET fails, still return `source` + `signature`
      and add a `propertiesError` string to the payload. A metadata hiccup must not break signature
      reading, which is the established behavior callers depend on.
- [ ] Update the `includeSignature` description in `tools.ts` to document the two new payload fields.
- [ ] Add unit tests (~5 tests): payload includes `processingType` for a normal FM; includes both
      fields for an update module; omits `updateTaskKind` when absent; **failure path** — the
      properties GET 404s and the response still carries `source` + `signature` plus
      `propertiesError`; and `includeSignature` unset still returns plain source with no extra HTTP
      call.
- [ ] Regenerate the tool-definition snapshot with
      `npx vitest run tests/unit/handlers/tool-definitions-snapshot.test.ts -u` and review the diff.
- [ ] Run `npm test` — all tests must pass

### Task 5: Support create and delete of FUGR structural includes

**Files:**
- Modify: `src/handlers/write.ts` (the INCL+group branch at ~160 — lift the refusal)
- Modify: `src/handlers/write-helpers.ts` (`buildCreateXml` — add the INCL+group case; `createContentTypeForType`/`needsVendorContentType` at ~93-115)
- Modify: `src/handlers/write/create.ts` (`writeActionCreate` — the collection-URL derivation at ~473)
- Modify: `tests/unit/handlers/write-create-batch.test.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`

Dossier §8.2 proves ADT supports this on both 7.50 and 758 — ARC-1's refusal is self-imposed. The
delete side needs almost nothing: `writeActionDelete` (`write/update-delete.ts:~260`) is already a
generic lock → delete → unlock against `ctx.objectUrl`, and the INCL+group branch already sets
`objectUrl` to the include resource.

Note two contract details that differ from every other create in this file: the collection URL is
`{groupUrl}/includes` (not `objectUrl.replace(/\/[^/]+$/, '')` — that happens to produce the same
string here, so assert it explicitly in a test), and there is **no** `_package` query parameter — the
include inherits the group's package.

- [ ] In `write.ts`, replace the blanket refusal so `create` and `delete` are allowed alongside
      `update`/`edit_unit` for `type === 'INCL'` with a non-empty `group`. Keep refusing
      `create`/`delete` for a **bare** `INCL` with no `group`: that path targets
      `/sap/bc/adt/programs/includes`, where SAP rejects `L*` names with
      `500 "Program names L... are reserved for function group includes"`. The error message for that
      case must tell the caller to pass `group=`.
- [ ] Validate the include name client-side before the request: it must start with `L` followed by the
      group name (case-insensitive). Dossier §8.2: an arbitrary name earns an opaque
      `500 "Attributes for program … have not been saved"`. The rejection message must show the
      expected prefix, e.g. *"FUGR include names must start with L<GROUP> — expected LZORFC_BETA_V1…,
      got ZZ_ARBITRARY_INC."*
- [ ] Add the INCL+group case to `buildCreateXml` emitting:

      <?xml version="1.0" encoding="UTF-8"?>
      <finclude:abapFunctionGroupInclude
          xmlns:finclude="http://www.sap.com/adt/functions/fincludes"
          xmlns:adtcore="http://www.sap.com/adt/core"
          adtcore:description="…" adtcore:name="LZFOOF01" adtcore:type="FUGR/I">
        <adtcore:containerRef adtcore:name="ZFOO" adtcore:type="FUGR/F"
                              adtcore:uri="/sap/bc/adt/functions/groups/zfoo"/>
      </finclude:abapFunctionGroupInclude>

      The `containerRef` URI is lowercased, matching the FUNC envelope at ~681.
- [ ] Route the create to Content-Type `application/vnd.sap.adt.functions.fincludes.v2+xml`. The
      unversioned type is refused by SAP with an explicit *"Supported Media Types"* message, so this
      must be the versioned one — add it through `vendorContentTypeForType`/`needsVendorContentType`
      rather than a special case at the call site.
- [ ] Ensure no `_package` parameter is sent for this create (the `needsPackageParam` list in
      `write/create.ts:~478` must not gain INCL).
- [ ] Add unit tests (~10 tests): create posts to `/functions/groups/{g}/includes` with the
      `fincludes.v2+xml` content type and no `_package` param; the emitted XML matches the shape
      above; delete locks the include URL (not the group URL) and issues DELETE with the lock handle;
      update still works unchanged; **failure paths** — a name not starting with `L<GROUP>` is
      rejected before any HTTP call with a message naming the expected prefix, a bare `INCL` create
      with no `group` is refused and points at `group=`, and an `update` on INCL+group still resolves
      its package through the include's `containerRef` (the existing fail-closed gate must stay
      intact).
- [ ] Run `npm test` — all tests must pass

### Task 6: Add DOMA and DEVC discovery gates for pre-7.52 systems

**Files:**
- Modify: `src/handlers/feature-cache.ts` (add two helpers beside `isTableTypesEndpointAvailable` at ~75)
- Modify: `src/handlers/write-helpers.ts` (two hint constants beside `TTYP_WRITE_UNAVAILABLE_HINT` at ~1137)
- Modify: `src/handlers/write.ts` (the discovery-gate block at ~173-184)
- Modify: `src/handlers/write/create.ts` (the `batch_create` gate copy at ~852-859)
- Modify: `src/handlers/manage.ts` (`case 'create_package'` at ~100)
- Modify: `tests/unit/handlers/feature-cache.test.ts`
- Modify: `tests/unit/handlers/write-ddic.test.ts`

Both endpoints are absent wholesale before 7.52 (dossier §8.4, confirmed on two independent 7.50
systems). Today DOMA create returns a 404 whose hint says the object *was not found* and suggests
`SAPSearch` — for a create that is actively wrong and an LLM will loop on it. `create_package`
returns a SICF-misconfiguration hint that sends the operator down the wrong path.

- [ ] Add `isDomainsEndpointAvailable(destination?)` and `isPackagesEndpointAvailable(destination?)`
      to `feature-cache.ts`, exact siblings of `isTablesEndpointAvailable()` (~64), checking
      `map.has('/sap/bc/adt/ddic/domains')` and `map.has('/sap/bc/adt/packages')`. Both return
      `boolean | undefined` — `undefined` when discovery was never populated.
- [ ] Add `DOMA_WRITE_UNAVAILABLE_HINT` and `DEVC_WRITE_UNAVAILABLE_HINT` to `write-helpers.ts`,
      worded like the existing TABL/TTYP hints: name the missing endpoint, state that NW 7.50/7.51 do
      not ship it and that it arrived in 7.52, and give the SE11 / SE80-SE21 fallback.
- [ ] Gate DOMA `create` in `write.ts` alongside the existing TABL/TTYP checks, firing only on an
      explicit `=== false` so an unprobed session is never blocked.
- [ ] Add the same DOMA gate to the `batch_create` path in `write/create.ts:~852` — it is a separate
      copy of the gate block, not shared code, and it uses a different failure shape: push
      `{ type, name, packageName, status: 'failed', error: DOMA_WRITE_UNAVAILABLE_HINT }` onto
      `results` and `break`, exactly like the TABL/DT and TTYP gates immediately above it.
- [ ] Gate `create_package` in `manage.ts` before the `checkOperation` call, returning
      `errorResult(DEVC_WRITE_UNAVAILABLE_HINT)`.
- [ ] Add unit tests (~8 tests): each helper returns `true`/`false`/`undefined` for the three discovery
      states; DOMA create returns the hint when the gate is `false`; DOMA create proceeds when the
      gate is `true`; **DOMA create proceeds when the gate is `undefined`** (the regression that would
      break stdio sessions); `batch_create` with a DOMA item returns the hint; `create_package`
      returns the DEVC hint when the gate is `false`.
- [ ] Run `npm test` — all tests must pass

### Task 7: Fall back to the generic objectstructure resource for FUGR reads on pre-7.52

**Files:**
- Modify: `src/adt/client.ts` (`getFunctionGroup` at ~598)
- Modify: `src/adt/xml-parser.ts` (new parser beside `parseFunctionGroup` at ~402)
- Create: `tests/fixtures/xml/function-group-projectexplorer.xml` (captured live from npl 7.50)
- Modify: `tests/unit/adt/xml-parser.test.ts`
- Modify: `tests/unit/adt/client.test.ts`

`SAPRead type=FUGR` currently fails outright on 7.50 because
`/functions/groups/{g}/objectstructure` does not exist there (dossier §8.3). The generic
`/sap/bc/adt/repository/objectstructure` does, and carries the same information in a different shape.
**The query parameters are lowercase** — `objectname` / `objecttype`; the camelCase spelling returns
`400 "Parameter objectname could not be found"`.

Capture the fixture from npl first:

    curl -sk -u <user>:<pw> \
      -H 'Accept: application/vnd.sap.adt.objectstructure.v2+xml' \
      'https://npl.marianzeis.de/sap/bc/adt/repository/objectstructure?objectname=<FUGR>&objecttype=FUGR%2FF&sap-client=001'

- [ ] Capture the response above for a function group that has at least one include and one function
      module, into `tests/fixtures/xml/function-group-projectexplorer.xml`, with a header comment
      naming system, release and date.
- [ ] Implement `parseFunctionGroupNodes(xml: string): { name, functions, includes }` in
      `xml-parser.ts`, reading flat `projectexplorer:node` elements and bucketing by the `objecttype`
      attribute: `FUGR/FF` → `functions`, `FUGR/I` → `includes`. Skip folder nodes
      (`isfolder="true"`, which carry a `description` but no `objectname`). Note the attribute names
      here are **lowercase and unprefixed** (`objecttype`, `objectname`, `isfolder`) — unlike the
      namespaced `adtcore:type`/`adtcore:name` that `parseFunctionGroup` reads.
- [ ] In `getFunctionGroup()`, catch a 404 from the existing request and retry against
      `/sap/bc/adt/repository/objectstructure?objectname={NAME}&objecttype=FUGR%2FF`, parsing with the
      new function. The group name is not in the fallback response body, so carry it through from the
      argument. Any non-404 error must propagate unchanged.
- [ ] Leave the 758/816 path untouched — the fallback must only fire on 404.
- [ ] Add unit tests (~8 tests): parse the captured fixture and assert both the include and the
      function-module lists; folder nodes are skipped; an empty node set yields empty arrays;
      `getFunctionGroup` uses the primary path when it returns 200 and does **not** issue a second
      request; a 404 triggers exactly one fallback request with lowercase `objectname`/`objecttype`
      parameters; **failure paths** — a 403 on the primary path propagates without a fallback attempt,
      and a 404 on both paths surfaces the error.
- [ ] Run `npm test` — all tests must pass

### Task 8: Update documentation to as-shipped behavior

**Files:**
- Modify: `docs_page/tools.md` (SAPWrite FUNC/INCL sections, SAPRead `includeSignature` row ~67, SAPWrite `type` row ~270)
- Modify: `docs_page/roadmap.md` (Completed section + Current State matrix)
- Modify: `docs/compare/00-feature-matrix.md` (rows ~164-166 and ~352; refresh "Last Updated")
- Modify: `AGENTS.md` (Key Files rows for FUNC/FUGR writes)
- Modify: `docs/dev-guide.md` (matching detailed rows)
- Modify: `docs/integration-test-skips.md` (remove the stale DTEL row)
- Verify: `.claude/commands/*.md` (skills referencing FUNC/FUGR behavior)

Runs after implementation so the docs describe what actually shipped. Be explicit about the
release gating: over-promising docs create false-troubleshooting loops.

- [ ] Document `processingType`/`updateTaskKind` in `docs_page/tools.md` under SAPWrite: FUNC only,
      the three/four enum values, that `updateTaskKind` requires `processingType="update"`, that the
      change leaves the FM inactive so `SAPActivate` is required, and that it is applied by a
      follow-up property PUT because SAP ignores these attributes on the create POST. Update the
      `includeSignature` row to list the new payload fields.
- [ ] Document FUGR structural-include `create`/`delete` in `docs_page/tools.md`, including the
      `L<GROUP>…` naming rule and that SAP maintains the main program's `INCLUDE` line itself (adding
      it on create, commenting it out on delete).
- [ ] Document the two new release gates wherever the TABL/TTYP 7.50 gates are already described, and
      note that `SAPRead type=FUGR` now works on 7.50 via the generic objectstructure fallback.
- [ ] **Remove the stale row** `BACKEND_UNSUPPORTED: DTEL v2 content type not supported on this
      release` from `docs/integration-test-skips.md`. It is wrong: the `CONTENT_TYPE_FALLBACKS` v2→v1
      retry (`src/adt/crud.ts:~83`) makes DTEL create succeed on 7.50 — verified live 2026-07-29.
      Also correct the "DTEL 415" mention in the E2E fixture-sync paragraph.
- [ ] Update `AGENTS.md`: the "FUGR/FUNC write (#250)" row gains the property-PUT gotcha (SAP ignores
      the attributes on create), and the "FUGR structural-include write" row loses "Update only;
      structural create/delete unsupported". Keep rows terse — one gotcha each — and put the detail in
      `docs/dev-guide.md`.
- [ ] Add a Completed entry to `docs_page/roadmap.md` describing the six changes with the live-verified
      systems and releases, linking the dossier.
- [ ] Update `docs/compare/00-feature-matrix.md`: the FUNC write row gains processing-type management,
      the FUGR structural-include row (~352) changes from update-only, and "Last Updated" is refreshed.
- [ ] Grep `.claude/commands/*.md` for FUNC/FUGR/include references and update any that state ARC-1
      cannot create structural includes or cannot set RFC-enablement.
- [ ] Run `npm test` — all tests must pass

### Task 9: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Confirm `tests/fixtures/tool-definitions/*.json` was regenerated and the diff contains **only**
      the intended new SAPWrite properties and the `includeSignature` description change
- [ ] Live verification on **npl (NW 7.50)** — credentials in `INFRASTRUCTURE.md`, all objects in
      `$TMP`, deleted afterwards: create a FUGR; create an FM with structured `parameters` and
      `processingType="rfc"`; create a second FM with `processingType="update"` and
      `updateTaskKind="startImmediate"`; create a structural include `L<GRP>F01` and write source into
      it; run `SAPActivate` on the group and confirm it succeeds; then `SAPRead type=FUNC
      includeSignature=true` on both FMs and confirm the **active** version reports `rfc` and
      `update`/`startImmediate` respectively. Activation is the definitive correctness check.
- [ ] Live verification on **a4h (SAP_BASIS 758)**: repeat the same cycle to confirm the behavior is
      release-invariant
- [ ] Live gate checks on npl: `SAPWrite action=create type=DOMA` returns the new release hint (not
      the "object not found, use SAPSearch" text), `SAPManage action=create_package` returns the DEVC
      hint, and `SAPRead type=FUGR` on an existing group now succeeds and lists both its includes and
      its function modules
- [ ] Live regression check on a4h: `SAPRead type=FUGR` still uses the primary objectstructure path
      and returns the same payload as before this change
- [ ] Delete every throwaway object created above and confirm each returns 404; do not commit any
      smoke scripts
- [ ] Move this plan to `docs/plans/completed/`, then fix the relative links inside it (completed
      plans sit one directory deeper, so `../research/…` becomes `../../research/…`)
