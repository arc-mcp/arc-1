# Add Server-Driven Object (SDO) Write — SAPWrite create/update/delete + SAPActivate

## Overview

ABAP Platform 2025 (SAP_BASIS 8.16) introduced ~46 "server-driven" / AFF generic-object
repository types that all share ONE contract: `<blue:blueSource>` XML metadata
(`Accept: application/vnd.sap.adt.blues.v1+xml`) plus an **AFF JSON** source at
`…/{name}/source/main`. PR #356 shipped the discovery-gated generic **read** engine
(`src/adt/server-driven.ts`, `SDO_REGISTRY` of 6 curated types: DESD, DTSC, CSNM, EVTB, EVTO,
COTA). This plan adds the **write** path — create, update-source, delete, and activate —
reusing ~90% of existing machinery.

The write contract was verified end-to-end live on a4h-2025 (816) before this plan:

- **CREATE** = `POST <collection-href>` with a minimal `blue:blueSource` body
  (`adtcore:type`/`adtcore:name`/`adtcore:description` + `<adtcore:packageRef>`),
  Content-Type `application/vnd.sap.adt.blues.vN+xml` → **201**. All 6 registered types were
  probed live: each creates with a per-type `adtcore:type` subtype + blues content-type:

  | code | href | createType | blue content-type |
  |------|------|-----------|-------------------|
  | DESD | `/sap/bc/adt/ddic/desd` | `DESD/TYP` | `blues.v1+xml` |
  | DTSC | `/sap/bc/adt/ddic/dtsc/sources` | `DTSC/TYP` | `blues.v1+xml` |
  | CSNM | `/sap/bc/adt/csn/csnm` | `CSNM/TYP` | `blues.v1+xml` |
  | EVTB | `/sap/bc/adt/businessservices/evtbevb` | `EVTB/EVB` | `blues.v1+xml` |
  | EVTO | `/sap/bc/adt/businessservices/evtoevo` | `EVTO/EVO` | **`blues.v2+xml`** |
  | COTA | `/sap/bc/adt/conn/commtargets` | `COTA/TYP` | `blues.v1+xml` |

  The subtype is NOT uniformly `/TYP` (EVTB uses `/EVB`) and the blues version is NOT uniformly
  v1 (EVTO uses v2) — both are stored per registry entry. The same `blueContentType` is the read
  metadata GET Accept AND the create POST Content-Type for a given type.
- **SOURCE** = lock (crud.ts `lockObject`) → `PUT <url>/source/main?lockHandle=X` with the AFF
  **JSON** body, Content-Type `application/json` → **200** → unlock (crud.ts `unlockObject`).
- **ACTIVATE** = devtools `activate(http, safety, <url>)` → `success=true` (the generic
  activation endpoint handles DESD; no SDO-specific activation needed).
- **DELETE** = lock → `http.delete(<url>?lockHandle=X)` → **200** (verified 404 afterward).

Design intent: extend the existing generic engine and wire it into `SAPWrite`
(create/update/delete) + `SAPActivate` with an early type-branch — exactly mirroring how
the read path early-branches in `handleSAPRead`. No per-type plumbing; the AFF JSON the
caller supplies IS the source (same division of labor as DDLS/CDS — ARC-1 owns the protocol,
the caller owns the content).

## Context

### Current State

- `src/adt/server-driven.ts` exposes **read-only** helpers: `SDO_REGISTRY`,
  `isServerDrivenObjectType(code)`, `supportsServerDrivenObject(http, code)` (discovery gate),
  `getServerDrivenObject(http, safety, code, name)`.
- `handleSAPRead` (`src/handlers/intent.ts` ~line 1495) has an early branch that routes SDO
  types to `getServerDrivenObject` and returns JSON, bypassing the version/draft/cache machinery.
- `handleSAPWrite` (~line 3667) and `handleSAPActivate` (~line 5696) have **no** SDO awareness:
  the 6 codes are absent from `SAPWRITE_TYPES_*`, and `objectBasePath(<sdo>)` throws (its
  `default` case), so any SDO type passed to write/activate would crash, not route.
- `resolveObjectPackage(objectUrl)` (`src/adt/client.ts` ~line 1436) does a plain GET (no
  explicit Accept) + regex over `adtcore:packageRef`. SDO metadata only renders under the
  `blues.v1+xml` Accept, so the allowlist ceiling can't currently resolve an SDO object's real
  package without relying on discovery-driven MIME negotiation.

### Target State

- `SAPWrite action=create|update|delete` works for the 6 SDO types, discovery-gated
  (clean "requires SAP_BASIS 8.16+" error on older systems, mirroring the read branch),
  `allowWrites`-gated, and `allowedPackages`-gated against the object's real package.
- `SAPActivate` activates SDO objects (URL routed through the SDO registry href).
- Create leaves the object **inactive** and suggests `SAPActivate` next (consistent with every
  other create path — never auto-activates).
- `source` (the existing optional string param) carries the AFF **JSON**; it is parse-validated
  before the PUT (clean error on malformed JSON) and sent with Content-Type `application/json`.
  ABAP-specific pre-write steps (lint, RAP preflight, CDS guard) are **skipped** for SDO — the
  source is not ABAP.
- Unsupported SAPWrite actions for SDO (edit_method, batch_create, surgery, scaffold/generate)
  return a clear "not supported for server-driven object type X" error.

### Key Files

| File | Role |
|------|------|
| `src/adt/server-driven.ts` | SDO engine — extend with `serverDrivenObjectUrl`, `buildBlueSourceXml`, `createServerDrivenObject`, `updateServerDrivenObjectSource`, `deleteServerDrivenObject` |
| `src/adt/crud.ts` | Reuse `lockObject`/`unlockObject` (the verified lock contract) — no change |
| `src/adt/devtools.ts` | Reuse `activate(http, safety, url)` — no change |
| `src/adt/client.ts` | `resolveObjectPackage(objectUrl, accept?)` — add optional Accept for SDO package resolution |
| `src/handlers/intent.ts` | Early SDO branch in `handleSAPWrite`; SDO URL routing in `handleSAPActivate`; `enforceAllowedPackageForObjectUrl` optional accept |
| `src/handlers/schemas.ts` | Add 6 SDO codes to `SAPWRITE_TYPES_ONPREM` + `SAPWRITE_TYPES_BTP` |
| `src/handlers/tools.ts` | Add 6 SDO codes to the LOCAL `SAPWRITE_TYPES_ONPREM`/`_BTP` copies + the SAPWrite `type` description string |
| `src/authz/policy.ts` | No new entry — SDO create/update/delete map to existing `SAPWrite.create/update/delete` (scope `write`); activate → `SAPActivate.activate` |
| `tests/unit/adt/server-driven.test.ts` | Unit tests for the new write engine functions |
| `tests/unit/handlers/{intent,schemas,tools}.test.ts` | Wiring + type-list-sync tests |
| `tests/integration/adt.integration.test.ts` | Live 816 round-trip (create→source→activate→read→delete), gated/skipped on 758 |
| `tests/e2e/*.e2e.test.ts` | MCP-stack SDO write round-trip, skip-tolerant of the 8.16 gate |

### Design Principles

1. **Reuse, don't reinvent.** Lock/unlock = crud.ts; activate = devtools.ts; discovery gate =
   the existing `supportsServerDrivenObject`. The only SDO-specific code is the `blue:blueSource`
   create body and the JSON source PUT (Content-Type `application/json`).
2. **Early-branch parity with read.** The SDO write branch sits at the top of `handleSAPWrite`
   (after the name-case guard, before the `objectUrlForType` computation that would throw for
   SDO), exactly mirroring the `handleSAPRead` SDO branch.
3. **Read before write is already satisfied** — this plan IS the write follow-up the read module
   docstring named. Keep the module's "read-only" docstring updated to reflect write support.
4. **Safety unchanged in shape.** `checkOperation(safety, OperationType.Create/Update/Delete)`
   via the reused crud.ts/engine functions; `allowWrites` gates every mutation; `allowedPackages`
   gates against the **real** package (create checks the caller-supplied package like every other
   create; update/delete/activate resolve the real package via the blues-Accept metadata GET).
5. **Never auto-activate.** Create returns "inactive — Next step: SAPActivate", consistent with
   all create paths.
6. **Honest scope.** DESD is verified end-to-end. All 6 registered types get identical generic
   plumbing; whether a specific create succeeds depends on the caller's AFF JSON being valid for
   that type (and any server-side dependencies) — the same contract as DDLS. Docs say so.

## Development Approach

- Foundation first (engine functions + package-resolution plumbing), then wiring (handlers),
  then schema/type-list sync, then tests, then docs.
- Every engine function takes `(http, safety, …)` and calls `checkOperation` (directly or via the
  reused crud.ts functions). Mirror the existing `getServerDrivenObject` signature style.
- Unit tests mock the HTTP layer with the same `mockHttp` helper already in
  `server-driven.test.ts` (path-routed `get`; extend it with `post`/`put`/`delete`/
  `withStatefulSession` spies).
- Integration test uses `getTestClient()` + `generateUniqueName()`; gate on
  `supportsServerDrivenObject` and skip via `requireOrSkip` on non-816 systems.
- Run `npm test`, `npm run typecheck`, `npm run lint` after each task.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: SDO write engine functions in `server-driven.ts`

**Files:**
- Modify: `src/adt/server-driven.ts`
- Modify: `tests/unit/adt/server-driven.test.ts`

Add the generic write primitives to the existing engine module. These reuse crud.ts
`lockObject`/`unlockObject` (import them) for the source-PUT and delete flows. The create body
and JSON source PUT are the only SDO-specific bits. Verified live: create→201, PUT json→200,
delete→200.

- [ ] Add `export function serverDrivenObjectUrl(code: string, name: string): string` returning
      `` `${SDO_REGISTRY[code].href}/${encodeURIComponent(name)}` `` (throw `AdtApiError(400)` for
      an unknown code, matching `getServerDrivenObject`). Refactor `getServerDrivenObject` to use it.
- [ ] Extend each `SDO_REGISTRY` entry from `{ href, label }` to
      `{ href, label, createType, blueContentType }` using the live-verified table in the Overview
      (DESD→`DESD/TYP`/v1, DTSC→`DTSC/TYP`/v1, CSNM→`CSNM/TYP`/v1, EVTB→`EVTB/EVB`/v1,
      EVTO→`EVTO/EVO`/**v2**, COTA→`COTA/TYP`/v1). Update `getServerDrivenObject`'s metadata GET Accept
      to use `entry.blueContentType` (DESD stays v1 — existing read test unaffected — but EVTO read now
      correctly requests v2). The `supportsServerDrivenObject` gate is unchanged (its `.includes('blues')`
      substring matches both v1 and v2).
- [ ] Add `export function buildBlueSourceXml(code, name, pkg, description, language?): string`
      producing the verified create body using `entry.createType` for `adtcore:type`:
      `<blue:blueSource xmlns:blue="http://www.sap.com/wbobj/blue" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:type="<entry.createType>" adtcore:name="…" adtcore:description="…"[ adtcore:masterLanguage="…"]><adtcore:packageRef adtcore:name="<pkg>"/></blue:blueSource>`.
      Add a tiny local `escapeXml` (or import the existing one from `xml-parser.ts` if exported) for
      description/name. When `language` is set, include `adtcore:masterLanguage` (normalize via the same
      approach as ddic-xml `normalizeAdtLanguage`; optional, default omit).
- [ ] Add `export async function createServerDrivenObject(http, safety, code, name, opts: { package: string; description: string; language?: string; transport?: string }): Promise<string>`:
      `checkOperation(safety, OperationType.Create, 'CreateServerDrivenObject')`, build the body,
      `POST entry.href` with Content-Type `entry.blueContentType` (v1 for most, v2 for EVTO) and
      `?corrNr=<transport>` when transport is set; return `resp.body`.
- [ ] Add `export async function updateServerDrivenObjectSource(http, safety, code, name, sourceJson: string, opts: { transport?: string } = {}): Promise<void>`:
      `withStatefulSession` → `lockObject` → `PUT serverDrivenObjectUrl(code,name)+'/source/main'?lockHandle=…(&corrNr=…)`
      with body `sourceJson` and Content-Type `application/json` → `unlockObject` in `finally`. Wrap the
      Update `checkOperation(safety, OperationType.Update, 'UpdateServerDrivenObjectSource')` at the top.
- [ ] Add `export async function deleteServerDrivenObject(http, safety, code, name, opts: { transport?: string } = {}): Promise<void>`:
      `checkOperation(safety, OperationType.Delete, …)` → `withStatefulSession` → `lockObject` →
      `http.delete(serverDrivenObjectUrl+'?lockHandle=…(&corrNr=…)')` → best-effort `unlockObject` in
      `finally` (swallow unlock failure — object already deleted; mirror `handleSAPWrite` delete case).
- [ ] Update the module docstring: replace "Read-only. The write path … is a deliberate follow-up"
      with a note that write (create/update/delete) is now supported.
- [ ] Add unit tests (~10 tests): `serverDrivenObjectUrl` (encodes name, throws on unknown);
      `buildBlueSourceXml` (correct root, per-type `createType` suffix, packageRef, optional
      masterLanguage, XML-escapes description); `createServerDrivenObject` (POSTs the registry href
      with `blues.v1+xml`, passes `corrNr` when transport set); `updateServerDrivenObjectSource`
      (lock→PUT `application/json` to `/source/main?lockHandle=`→unlock order; unlock runs even when
      PUT throws); `deleteServerDrivenObject` (lock→delete→unlock; tolerates unlock failure);
      `checkOperation` blocks each when `allowWrites=false` (use a read-only safety config and assert
      `AdtSafetyError`). Extend the file's `mockHttp` helper with `post`/`put`/`delete`/
      `withStatefulSession` spies (have `withStatefulSession(cb)` just `await cb(theMock)`).
- [ ] Run `npm test` — all tests must pass.

### Task 2: SDO-aware package resolution

**Files:**
- Modify: `src/adt/client.ts`
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/adt/client.test.ts`

The `allowedPackages` ceiling must resolve an existing SDO object's REAL package, but SDO metadata
only renders under the `blues.v1+xml` Accept. Thread an optional Accept so update/delete/activate of
SDO objects gate correctly even without relying on discovery-driven MIME negotiation. No-op when
`allowedPackages` is unrestricted (the default), so this only matters for restricted deployments.

- [ ] In `src/adt/client.ts` change `resolveObjectPackage(objectUrl: string, accept?: string)`:
      when `accept` is provided, pass `{ Accept: accept }` to `this.http.get(objectUrl, …)`. Existing
      callers (no accept) are unchanged.
- [ ] In `src/handlers/intent.ts` change `enforceAllowedPackageForObjectUrl(client, objectUrl, label, accept?)`
      to forward `accept` to `client.resolveObjectPackage(objectUrl, accept)`. All existing call sites
      keep working (accept defaults undefined).
- [ ] Add a module-level constant `const BLUES_ACCEPT = 'application/vnd.sap.adt.blues.v1+xml';`
      near the SDO imports for reuse by the write/activate branches (Tasks 3 & 4).
- [ ] Add unit tests (~3 tests): `resolveObjectPackage` sends the Accept header when provided and
      omits it otherwise (assert via the mock-fetch header capture); parses `adtcore:packageRef` from a
      `blue:blueSource` body. Reuse the existing `client.test.ts` mock-fetch setup.
- [ ] Run `npm test` — all tests must pass.

### Task 3: Wire SDO create/update/delete into `handleSAPWrite`

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Add an early branch in `handleSAPWrite` that intercepts SDO types BEFORE the `objectUrl`
computation (~line 3724) — `objectBasePath(<sdo>)` would otherwise throw. Mirror the read branch's
discovery gate + clean error. Import the new engine functions + `serverDrivenObjectUrl` +
`BLUES_ACCEPT`.

- [ ] Import `createServerDrivenObject`, `updateServerDrivenObjectSource`, `deleteServerDrivenObject`,
      `serverDrivenObjectUrl` from `../adt/server-driven.js` (alongside the existing read imports).
- [ ] Insert the branch after the `NAME_CASE_GUARD_ACTIONS` check (~line 3709) and before the
      `let objectUrl` block (~line 3724):
      `if (isServerDrivenObjectType(type)) { return handleServerDrivenObjectWrite(...); }`
- [ ] Implement `async function handleServerDrivenObjectWrite(client, action, type, name, args, config, cachingLayer)`:
      - Gate: `if (supportsServerDrivenObject(client.http, type) === false) return errorResult("SAPWrite type=<type> (server-driven object) requires SAP_BASIS 8.16+ …")` (mirror read wording).
      - `create`: `const pkg = String(args.package ?? '$TMP')`; `await checkPackage(client.safety, pkg, client.getPackageHierarchyResolver())`;
        `const description = String(args.description ?? name)`; call `createServerDrivenObject(client.http, client.safety, type, name, { package: pkg, description, language: config.language, transport })`.
        If `args.source` is a non-empty string: parse-validate it as JSON (`try { JSON.parse(source) } catch { return errorResult('SDO source must be valid AFF JSON: …') }`) then
        `updateServerDrivenObjectSource(...)`. Invalidate cache defensively
        (`cachingLayer?.invalidate(type, name, 'all'); cachingLayer?.inactiveLists.invalidate(client.username)`).
        Return `Created <type> <name> in package <pkg>[ and wrote source]. Next step: SAPActivate(type="<type>", name="<name>").`
      - `update`: require `args.source` (error if absent); parse-validate JSON; enforce package via
        `enforceAllowedPackageForObjectUrl(client, serverDrivenObjectUrl(type, name), 'Operations on <type> <name>', BLUES_ACCEPT)`;
        `updateServerDrivenObjectSource(...)`; invalidate; return success text.
      - `delete`: enforce package (same helper + `BLUES_ACCEPT`); `deleteServerDrivenObject(...)`;
        invalidate; return `Deleted <type> <name>.`
      - default (any other action incl. `batch_create`, `edit_method`, surgery, scaffold/generate):
        `return errorResult('Action "<action>" is not supported for server-driven object type <type>. Supported: create, update, delete (source is AFF JSON), and SAPActivate.')`.
- [ ] Add unit tests (~8 tests) in `intent.test.ts`: SDO create routes to `createServerDrivenObject`
      with pkg/description (mock the engine via `vi.mock('../../../src/adt/server-driven.js', …)` or
      mock the http layer and assert the POST); create+source also calls source update; update without
      source errors; malformed JSON source errors; delete routes to `deleteServerDrivenObject`;
      unsupported action (`edit_method`) errors; the 8.16 gate returns the clean error when
      `supportsServerDrivenObject` is false. Follow the existing intent.test.ts SDO-read test patterns.
- [ ] Run `npm test` — all tests must pass.

### Task 4: Wire SDO activation into `handleSAPActivate`

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

`SAPActivate.type` is `z.string().optional()` (no enum), so SDO codes already validate. Only the URL
routing needs the SDO case — `objectBasePath(<sdo>)` throws, so the single-activation `objectUrl`
computation (~line 5916, the `else { objectUrl = objectUrlForType(type, name) }` arm) must branch for
SDO first. The downstream `enforceAllowedPackageForObjectUrl` + `activate` flow then works unchanged
(verified: activate(DESD) → success).

- [ ] In `handleSAPActivate` single-activation URL block (~line 5891-5918), add
      `else if (isServerDrivenObjectType(type)) { objectUrl = serverDrivenObjectUrl(type, name); }`
      before the final `else` (generic `objectUrlForType`).
- [ ] Pass `BLUES_ACCEPT` to the package-enforcement call for SDO so the real package resolves under
      the blues Accept: branch the existing `enforceAllowedPackageForObjectUrl(client, objectUrl, \`Activation of ${type} '${name}'\`)`
      to forward `isServerDrivenObjectType(type) ? BLUES_ACCEPT : undefined` as the 4th arg.
- [ ] (Batch activation `objects[]`): SDO is intentionally **not** added to the batch-activation URL
      resolver in this plan (batch is RAP-stack-oriented). Leave batch unchanged; the single path covers
      SDO. Add a one-line code comment noting SDO activation is single-object only.
- [ ] Add unit tests (~3 tests): single activate of an SDO type builds the registry URL and calls
      `activate` with it; activate of an SDO on a non-8.16 system surfaces the SAP 404/error cleanly
      (mock `activate` to throw `AdtApiError(404)` and assert the error result). Mock the http/activate
      layer as the existing activate tests do.
- [ ] Run `npm test` — all tests must pass.

### Task 5: Add SDO codes to the SAPWrite type lists + descriptions

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`
- Modify: `tests/unit/handlers/tools.test.ts`

The 6 SDO codes must appear in BOTH the Zod enums (`schemas.ts`) AND the JSON-Schema enums
(`tools.ts` keeps its own local copies) or they're invisible to LLM clients / rejected by validation.
Mirror exactly how PR #356 added them to the SAPRead lists.

- [ ] In `src/handlers/schemas.ts`: append `'DESD', 'DTSC', 'CSNM', 'EVTB', 'EVTO', 'COTA'` to
      `SAPWRITE_TYPES_ONPREM` (~line 345) and `SAPWRITE_TYPES_BTP` (~line 367). Add a short
      `// Server-driven objects (8.16+) — write via the generic blue:blueSource + AFF JSON engine` comment.
- [ ] In `src/handlers/tools.ts`: append the same 6 codes to the LOCAL `SAPWRITE_TYPES_ONPREM` (~line
      138) and `SAPWRITE_TYPES_BTP` (~line 158) arrays. Update the SAPWrite `type` property description
      string(s) to mention the SDO write types (mirror the SAPRead description that lists DESD/EVTB/…),
      noting "source is AFF JSON; create leaves the object inactive — follow with SAPActivate; 8.16+ /
      discovery-gated".
- [ ] In `tests/unit/handlers/schemas.test.ts` + `tools.test.ts`: extend the existing
      SAPWRITE/SAPREAD list-sync tests to assert the 6 SDO codes are present in the write enums and that
      schemas.ts and tools.ts copies stay in sync (there is likely an existing "tools.ts and schemas.ts
      type lists match" test — update its expected set). Add ~4 assertions.
- [ ] Run `npm test` — all tests must pass.

### Task 6: Integration + E2E tests (live SDO write round-trip)

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`
- Modify (or create): an E2E test under `tests/e2e/` (e.g. extend an existing `*.e2e.test.ts`)

The unit tests mock HTTP; this task proves the real round-trip against the live 816 system and the
full MCP stack. DESD is the verified type; gate on `supportsServerDrivenObject` and skip cleanly on
758/7.50.

- [ ] Integration: add a describe block "SDO write (server-driven objects)" using `getTestClient()`.
      Gate: load discovery (the test client triggers discovery on first request; or call a read first),
      then `requireOrSkip(ctx, supportsServerDrivenObject(client.http, 'DESD') || undefined, SkipReason.UNSUPPORTED_BACKEND)`.
      Use `generateUniqueName('ZARC1_SDOW')` for a `$TMP` DESD. Exercise via the **handlers**
      (`handleToolCall('SAPWrite', { action:'create', type:'DESD', name, package:'$TMP', description, source: '<AFF JSON>' })`
      → `SAPActivate` → `SAPRead type=DESD` assert source persisted → `SAPWrite action=delete` → assert
      gone). AFF JSON body: `{"formatVersion":"1","header":{"description":"…","originalLanguage":"en","abapLanguageVersion":"cloudDevelopment"}}`.
      Wrap create/delete in try/finally (best-effort delete cleanup tagged `// best-effort-cleanup`).
      Assert each step's success shape; never empty-catch.
- [ ] Integration: add a second assertion that the discovery gate returns false on a non-816 control
      is **not** needed here (the skip covers it) — instead assert the gate error path: calling
      `handleSAPWrite` create for an SDO when `supportsServerDrivenObject` is false yields the clean
      8.16 error (can be a unit test in Task 3; skip if already covered).
- [ ] E2E: add a transient SDO write test (create→read→delete a `$TMP` DESD through the MCP JSON-RPC
      stack via `callTool`). Make it skip-tolerant: if create returns the 8.16-unavailable error,
      classify it via `classifyToolErrorSkip` (extend the helper's taxonomy if needed, keeping the four
      skip-policy files in sync per CLAUDE.md) and `requireOrSkip`. Clean up in `try/finally`.
- [ ] Run `npm test` (unit) — all pass. Document that integration/E2E need the live 816 system
      (`TEST_SAP_URL` → a4h-2025) and are skipped otherwise.

### Task 7: Documentation, roadmap, feature matrix, skills

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/tools.md`
- Modify: `docs/research/abap-platform-2025-816-compatibility.md`
- Modify: `docs/roadmap.md`
- Modify: `compare/00-feature-matrix.md`
- Review: `.claude/commands/*.md`

- [ ] `CLAUDE.md`: update the existing "Add server-driven object (SDO) read via SAPRead" Key Files row
      to cover write — note `createServerDrivenObject`/`updateServerDrivenObjectSource`/
      `deleteServerDrivenObject` + `serverDrivenObjectUrl` + `buildBlueSourceXml` in
      `src/adt/server-driven.ts`, the `handleServerDrivenObjectWrite` early branch in `handleSAPWrite`,
      the SDO URL routing in `handleSAPActivate`, the 6 codes in `SAPWRITE_TYPES_*` (schemas + tools),
      `resolveObjectPackage(accept?)` for SDO package gating, and the verified contract (POST
      blue:blueSource → 201; PUT /source/main application/json; activate via devtools; delete via lock +
      http.delete). Note create is JSON-source + leaves inactive; lint/preflight/CDS-guard skipped.
- [ ] `docs/tools.md`: in the SAPWrite section, document SDO create/update/delete (source = AFF JSON,
      8.16+, discovery-gated, follow with SAPActivate) and list the 6 types.
- [ ] `docs/research/abap-platform-2025-816-compatibility.md`: mark the SDO **write** follow-up done
      (it currently says read shipped, write is the follow-up). Add the verified write contract +
      "DESD verified end-to-end" note.
- [ ] `docs/roadmap.md`: mark the 816 SDO write item completed / update the current-state matrix row.
- [ ] `compare/00-feature-matrix.md`: update the SDO / ABAP-Cloud-types row to reflect read **+ write**;
      refresh "Last Updated".
- [ ] Skills: scan `.claude/commands/*.md` for any that could leverage SDO write (e.g. an
      implement-feature skill) or that reference SDO as read-only; update references. If none apply,
      note "no skill changes needed" (no checkbox churn).
- [ ] Run `npm run typecheck` + `npm run lint` (docs-only edits won't break tests, but keep the tree green).

### Task 8: Final verification

- [ ] Run full test suite: `npm test` — all tests pass.
- [ ] Run typecheck: `npm run typecheck` — no errors.
- [ ] Run lint: `npm run lint` — no errors (the pre-existing `biome.json:2:14` schema-version warning
      is unrelated; do not "fix" it).
- [ ] Confirm the three-file tool-schema sync (CLAUDE.md invariant): the 6 SDO codes exist in
      `tools.ts` (JSON Schema) AND `schemas.ts` (Zod) AND are handled in `intent.ts` (the SDO write
      branch). Grep to verify.
- [ ] Live smoke (if `TEST_SAP_URL` → a4h-2025 / 816 available): run
      `npm run test:integration` and confirm the SDO write round-trip passes; on 758 confirm it skips
      cleanly (not fails).
- [ ] Move this plan to `docs/plans/completed/`.
