# ARC-1 — SAP ADT REST API inventory

**Purpose:** Step 1 of a cross-check workflow: a single catalog of every **`/sap/bc/adt/...`** endpoint pattern the ARC-1 **production code** calls or probes.  
**Next steps (for you / follow-up work):** For each row, validate on a real SAP system (ICF, auth, version), confirm headers and bodies match SAP behavior, map tests (unit vs integration), and note alternatives or pitfalls.

**Scope**

| Included | Excluded |
|----------|----------|
| All `src/**/*.ts` references to `/sap/bc/adt` | OData UI5 deploy service (`/sap/opu/odata/UI5/...`) — used in `src/adt/ui5-repository.ts`, probed as `ui5repo` in `features.ts` |
| CRUD query-string patterns on **arbitrary** object URLs | Docs-only examples under `docs/`, `reports/`, `docs/compare/*.md` (except this file) |
| Feature / auth **probe** URLs in `features.ts` | Test fixtures that only echo URLs (they mirror the same patterns below) |

**Method:** Repository-wide search for `/sap/bc/adt` under `src/`, then manual normalization into path templates.  
**Generated:** 2026-04-12 (repository snapshot).

**Detailed review reports (SAP contract, ARC-1, tests, actions):** see [`docs/compare/adt/apis/README.md`](apis/README.md).

---

## Legend

- `{name}`, `{group}`, `{program}`, `{table}`, etc. — URL-encoded object names (`encodeURIComponent` where implemented).
- `{objectUrl}` — full ADT object URI (e.g. `/sap/bc/adt/programs/programs/ZFOO`), not only the name segment.
- `{sourceUrl}` — typically `.../source/main` for editable sources.
- `{dumpId}`, `{traceId}` — path segments as returned by listing feeds (may contain encoding).
- **Module** — primary TypeScript module implementing the call.

---

## 1. Session, CSRF, and discovery

| # | Method | Path / pattern | Module / function | Notes |
|---|--------|------------------|---------------------|-------|
| 1 | `HEAD` | `/sap/bc/adt/core/discovery` | `src/adt/http.ts` (`fetchCsrfToken` / token refresh) | `X-CSRF-Token: Fetch`. Central for all mutating requests. |
| 2 | `GET` | `/sap/bc/adt/core/discovery` | `src/adt/http.ts` | Used on 401/403 CSRF retry paths. |
| 3 | `GET` | `/sap/bc/adt/core/discovery` | `src/adt/client.ts` (`getSystemInfo`) | Parsed via `parseSystemInfo`. |

---

## 2. Programs (reports)

| # | Method | Path / pattern | Module / function | Notes |
|---|--------|------------------|---------------------|-------|
| 4 | `GET` | `/sap/bc/adt/programs/programs/{name}/source/main` | `client.ts` (`getProgram`) | Core read; plain text body. |
| 5 | `GET` | `/sap/bc/adt/programs/programs/{program}/textelements` | `client.ts` (`getTextElements`) | Text pool / text elements. |
| 6 | `GET` | `/sap/bc/adt/programs/programs/{program}/variants` | `client.ts` (`getVariants`) | Selection screen variants. |

**Create URL (collection):** `POST /sap/bc/adt/programs/programs` — via `createObject` in `crud.ts` / `intent.ts` (not a literal in `client.ts`).

---

## 3. Includes

| # | Method | Path / pattern | Module / function | Notes |
|---|--------|------------------|---------------------|-------|
| 7 | `GET` | `/sap/bc/adt/programs/includes/{name}/source/main` | `client.ts` (`getInclude`) | Include source. |

**Create collection:** `POST /sap/bc/adt/programs/includes` (via CRUD + `intent.ts`).

---

## 4. Classes (OO)

| # | Method | Path / pattern | Module / function | Notes |
|---|--------|------------------|---------------------|-------|
| 8 | `GET` | `/sap/bc/adt/oo/classes/{name}/source/main` | `client.ts` (`getClass`, `getClassStructured`) | Full or main source. |
| 9 | `GET` | `/sap/bc/adt/oo/classes/{name}/includes/{definitions\|implementations\|macros\|testclasses}` | `client.ts` (`getClass`) | Local includes; comma-separated in API. |
| 10 | `GET` | `/sap/bc/adt/oo/classes/{name}` | `client.ts` (`getClassMetadata`) | **No** `/source/main`. `Accept: application/xml`. |

**Create collection:** `POST /sap/bc/adt/oo/classes` (CRUD + `intent.ts`).

---

## 5. Interfaces

| # | Method | Path / pattern | Module / function | Notes |
|---|--------|------------------|---------------------|-------|
| 11 | `GET` | `/sap/bc/adt/oo/interfaces/{name}/source/main` | `client.ts` (`getInterface`) | |

**Create collection:** `POST /sap/bc/adt/oo/interfaces` (CRUD + `intent.ts`).

---

## 6. Function groups and function modules

| # | Method | Path / pattern | Module / function | Notes |
|---|--------|------------------|---------------------|-------|
| 12 | `GET` | `/sap/bc/adt/functions/groups/{group}/fmodules/{name}/source/main` | `client.ts` (`getFunctionModule`) | FM source. |
| 13 | `GET` | `/sap/bc/adt/functions/groups/{name}` | `client.ts` (`getFunctionGroup`) | Group metadata / structure. |
| 14 | `GET` | `/sap/bc/adt/functions/groups/{name}/source/main` | `client.ts` (`getFunctionGroupMain`) | Main include of function group. |

**Create collection:** `POST /sap/bc/adt/functions/groups` (CRUD + `intent.ts`).  
**Intent symbol resolution** may build FM object URI: `/sap/bc/adt/functions/groups/{group}/fmodules/{symName}` — `src/handlers/intent.ts`.

---

## 7. CDS, RAP, service definitions, extensions, bindings

| # | Method | Path / pattern | Module / function | Notes |
|---|--------|------------------|---------------------|-------|
| 15 | `GET` | `/sap/bc/adt/ddic/ddl/sources/{name}/source/main` | `client.ts` (`getCdsView`) | DDLS. |
| 16 | `GET` | `/sap/bc/adt/bo/behaviordefinitions/{name}/source/main` | `client.ts` (`getBehaviorDefinition`) | BDEF. |
| 17 | `GET` | `/sap/bc/adt/ddic/srvd/sources/{name}/source/main` | `client.ts` (`getServiceDefinition`) | SRVD. |
| 18 | `GET` | `/sap/bc/adt/ddic/ddlx/sources/{name}/source/main` | `client.ts` (`getMetadataExtension`) | DDLX. |
| 19 | `GET` | `/sap/bc/adt/businessservices/bindings/{name}` | `client.ts` (`getServiceBinding`) | SRVB; `Accept: application/vnd.sap.adt.businessservices.v1+xml` (see code). |

**Create parents (from `intent.ts` base paths):** collections under `.../ddl/sources/`, `.../bo/behaviordefinitions/`, `.../srvd/sources/`, `.../ddlx/sources/`, `.../businessservices/bindings/` as used by `createObject`.

---

## 8. DDIC tables, views, structures, domains, data elements

| # | Method | Path / pattern | Module / function | Notes |
|---|--------|------------------|---------------------|-------|
| 20 | `GET` | `/sap/bc/adt/ddic/tables/{name}/source/main` | `client.ts` (`getTableDefinition`) | |
| 21 | `GET` | `/sap/bc/adt/ddic/views/{name}/source/main` | `client.ts` (`getViewDefinition`) | |
| 22 | `GET` | `/sap/bc/adt/ddic/structures/{name}/source/main` | `client.ts` (`getStructure`) | |
| 23 | `GET` | `/sap/bc/adt/ddic/domains/{name}` | `client.ts` (`getDomain`) | Object XML, not `.../source/main`. |
| 24 | `GET` | `/sap/bc/adt/ddic/dataelements/{name}` | `client.ts` (`getDataElement`) | Object XML. |

**Create:** parent collection URLs from `objectUrlForType` in `intent.ts` (`.../tables/`, `.../structures/`, `.../domains/`, `.../dataelements/`).

---

## 9. Transactions (VIT)

| # | Method | Path / pattern | Module / function | Notes |
|---|--------|------------------|---------------------|-------|
| 25 | `GET` | `/sap/bc/adt/vit/wb/object_type/trant/object_name/{name}` | `client.ts` (`getTransaction`) | |

---

## 10. API release state (ABAP Cloud / clean core)

| # | Method | Path / pattern | Module / function | Notes |
|---|--------|------------------|---------------------|-------|
| 26 | `GET` | `/sap/bc/adt/apireleases/{objectUri}` | `client.ts` (`getApiReleaseState`) | `{objectUri}` is **full** ADT URI, encoded as **one** path segment. `Accept: application/vnd.sap.adt.apirelease.v10+xml`. |

---

## 11. Repository search and package tree

| # | Method | Path / pattern | Module / function | Notes |
|---|--------|------------------|---------------------|-------|
| 27 | `GET` | `/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query={query}&maxResults={n}` | `client.ts` (`searchObject`) | Object name quick search. |
| 28 | `GET` | `/sap/bc/adt/repository/informationsystem/textSearch?searchString={pattern}&maxResults={n}[&objectType=...][&packageName=...]` | `client.ts` (`searchSource`) | Source text search; optional filters. |
| 29 | `POST` | `/sap/bc/adt/repository/nodestructure?parent_type=DEVC/K&parent_name={package}&withShortDescriptions=true` | `client.ts` (`getPackageContents`) | Body `undefined`, `Content-Type: application/xml`. |

---

## 12. Code intelligence (navigation, usage, completion)

| # | Method | Path / pattern | Module / function | Notes |
|---|--------|------------------|---------------------|-------|
| 30 | `POST` | `/sap/bc/adt/navigation/target?uri={sourceUrl}&line={line}&column={column}` | `codeintel.ts` (`findDefinition`) | Body: current **source** (`text/plain`). `Accept: application/xml`. |
| 31 | `GET` | `/sap/bc/adt/repository/informationsystem/usageReferences?uri={objectUrl}` | `codeintel.ts` (`findReferences`) | Simpler reference list. `Accept: application/xml`. |
| 32 | `POST` | `/sap/bc/adt/repository/informationsystem/usageReferences/scope` | `codeintel.ts` (`getWhereUsedScope`) | XML body (`usageReferences:scopeRequest`). |
| 33 | `POST` | `/sap/bc/adt/repository/informationsystem/usageReferences?uri={objectUrl}` | `codeintel.ts` (`findWhereUsed`) | `Content-Type: application/vnd.sap.adt.repository.usagereferences.request.v1+xml`; `Accept: application/vnd.sap.adt.repository.usagereferences.result.v1+xml`. |
| 34 | `POST` | `/sap/bc/adt/abapsource/codecompletion/proposals?uri={sourceUrl}&line={line}&column={column}` | `codeintel.ts` (`getCompletion`) | Body: source (`text/plain`). |

---

## 13. Data preview and freestyle SQL

| # | Method | Path / pattern | Module / function | Notes |
|---|--------|------------------|---------------------|-------|
| 35 | `POST` | `/sap/bc/adt/datapreview/ddic?rowNumber={maxRows}&ddicEntityName={table}` | `client.ts` (`getTableContents`) | Optional SQL filter as **body** (`text/plain`). |
| 36 | `POST` | `/sap/bc/adt/datapreview/freestyle?rowNumber={maxRows}` | `client.ts` (`runQuery`) | Full SQL in body (`text/plain`). Gated by safety (`FreeSQL`). |

---

## 14. System components and messages

| # | Method | Path / pattern | Module / function | Notes |
|---|--------|------------------|---------------------|-------|
| 37 | `GET` | `/sap/bc/adt/system/components` | `client.ts` (`getInstalledComponents`), `features.ts` (`detectSystemFromComponents`) | Atom feed; also drives BTP vs on-prem heuristic. |
| 38 | `GET` | `/sap/bc/adt/msg/messages/{messageClass}` | `client.ts` (`getMessages`) | Raw XML / text per SAP response. |

---

## 15. UI5 / BSP filestore (ADT read-only file browser)

| # | Method | Path / pattern | Module / function | Notes |
|---|--------|------------------|---------------------|-------|
| 39 | `GET` | `/sap/bc/adt/filestore/ui5-bsp/objects[?name=&maxResults=]` | `client.ts` (`listBspApps`) | `Accept: application/atom+xml`. |
| 40 | `GET` | `/sap/bc/adt/filestore/ui5-bsp/objects/{objectPath}/content` | `client.ts` (`getBspAppStructure`) | Folder listing; custom headers in code (`Accept` / `Content-Type`). |
| 41 | `GET` | `/sap/bc/adt/filestore/ui5-bsp/objects/{objectPath}/content` | `client.ts` (`getBspFileContent`) | File bytes; `Accept: application/xml`, `Content-Type: application/octet-stream` on request. |

---

## 16. Development tools (checks, activation, tests, ATC, service publish)

| # | Method | Path / pattern | Module / function | Notes |
|---|--------|------------------|---------------------|-------|
| 42 | `POST` | `/sap/bc/adt/checkruns` | `devtools.ts` (`syntaxCheck`) | `Content-Type: application/vnd.sap.adt.checkobjects+xml`; `Accept: application/vnd.sap.adt.checkmessages+xml`. Body references `adtcore:uri="{objectUrl}"`. |
| 43 | `POST` | `/sap/bc/adt/activation?method=activate&preauditRequested=true` | `devtools.ts` (`activate`, `activateBatch`) | XML object reference list. |
| 44 | `POST` | `/sap/bc/adt/businessservices/odatav2/publishjobs?servicename={name}&serviceversion={version}` | `devtools.ts` (`publishServiceBinding`) | |
| 45 | `POST` | `/sap/bc/adt/businessservices/odatav2/unpublishjobs?servicename={name}&serviceversion={version}` | `devtools.ts` (`unpublishServiceBinding`) | |
| 46 | `POST` | `/sap/bc/adt/abapunit/testruns` | `devtools.ts` (`runUnitTests`) | `Content-Type: application/vnd.sap.adt.abapunit.testruns.config.v4+xml`; `Accept: application/vnd.sap.adt.abapunit.testruns.result.v2+xml`. |
| 47 | `POST` | `/sap/bc/adt/atc/runs?worklistId=1` | `devtools.ts` (`runAtcCheck`) | Creates run; parses worklist id from response. |
| 48 | `GET` | `/sap/bc/adt/atc/worklists/{worklistId}` | `devtools.ts` (`runAtcCheck`) | `Accept: application/atc.worklist.v1+xml`. |

---

## 17. CTS transports

| # | Method | Path / pattern | Module / function | Notes |
|---|--------|------------------|---------------------|-------|
| 49 | `GET` | `/sap/bc/adt/cts/transportrequests[?user={user}]` | `transport.ts` (`listTransports`) | `Accept: application/vnd.sap.adt.transportorganizertree.v1+xml`. |
| 50 | `GET` | `/sap/bc/adt/cts/transportrequests/{transportId}` | `transport.ts` (`getTransport`) | Same Accept. |
| 51 | `POST` | `/sap/bc/adt/cts/transportrequests` | `transport.ts` (`createTransport`) | `Content-Type` / `Accept: application/vnd.sap.adt.transportorganizer.v1+xml`. |
| 52 | `POST` | `/sap/bc/adt/cts/transportrequests/{transportId}/newreleasejobs` | `transport.ts` (`releaseTransport`) | Release (no body). |

---

## 18. Runtime diagnostics (dumps, traces)

| # | Method | Path / pattern | Module / function | Notes |
|---|--------|------------------|---------------------|-------|
| 53 | `GET` | `/sap/bc/adt/runtime/dumps[?$top=...][&$query=...]` | `diagnostics.ts` (`listDumps`) | Atom feed. |
| 54 | `GET` | `/sap/bc/adt/runtime/dump/{dumpId}` | `diagnostics.ts` (`getDump`) | `Accept: application/vnd.sap.adt.runtime.dump.v1+xml`. |
| 55 | `GET` | `/sap/bc/adt/runtime/dump/{dumpId}/formatted` | `diagnostics.ts` (`getDump`) | `Accept: text/plain`. |
| 56 | `GET` | `/sap/bc/adt/runtime/traces/abaptraces` | `diagnostics.ts` (`listTraces`) | Atom feed. |
| 57 | `GET` | `/sap/bc/adt/runtime/traces/abaptraces/{traceId}/hitlist` | `diagnostics.ts` (`getTraceHitlist`) | |
| 58 | `GET` | `/sap/bc/adt/runtime/traces/abaptraces/{traceId}/statements` | `diagnostics.ts` (`getTraceStatements`) | |
| 59 | `GET` | `/sap/bc/adt/runtime/traces/abaptraces/{traceId}/dbAccesses` | `diagnostics.ts` (`getTraceDbAccesses`) | |

---

## 19. Feature detection and auth probes (`features.ts`)

These URLs are invoked with **`client.get`** (not HEAD — see implementation). Used when feature mode is `auto`, or for startup diagnostics.

| # | Method | Path / pattern | Purpose in ARC-1 |
|---|--------|------------------|------------------|
| 60 | `GET` | `/sap/bc/adt/ddic/sysinfo/hanainfo` | Probe `hana` |
| 61 | `GET` | `/sap/bc/adt/abapgit/repos` | Probe `abapGit` |
| 62 | `GET` | `/sap/bc/adt/ddic/ddl/sources` | Probe `rap` (RAP/CDS) |
| 63 | `GET` | `/sap/bc/adt/debugger/amdp` | Probe `amdp` |
| 64 | `GET` | `/sap/bc/adt/filestore/ui5-bsp` | Probe `ui5` |
| 65 | `GET` | `/sap/bc/adt/cts/transportrequests` | Probe `transport` |
| 66 | `GET` | `/sap/bc/adt/repository/informationsystem/textSearch?searchString=SY-SUBRC&maxResults=1` | `probeTextSearch` |
| 67 | `GET` | `/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=CL_ABAP_*&maxResults=1` | `probeAuthorization` — search |
| 68 | `GET` | `/sap/bc/adt/cts/transportrequests?user=__PROBE__` | `probeAuthorization` — transport |

**Non-ADT probe (same file):** `GET /sap/opu/odata/UI5/ABAP_REPOSITORY_SRV` — feature `ui5repo`; not duplicated in the numbered ADT table above.

---

## 20. Generic object operations (CRUD) — any ADT object URL

Implemented in `src/adt/crud.ts`. `{objectUrl}` is the **object** URI (not necessarily `.../source/main`). `{sourceUrl}` is usually `.../source/main`.

| # | Method | Pattern | Function |
|---|--------|---------|----------|
| 69 | `POST` | `{objectUrl}?_action=LOCK&accessMode={MODIFY\|...}` | `lockObject` |
| 70 | `POST` | `{objectUrl}?_action=UNLOCK&lockHandle={handle}` | `unlockObject` |
| 71 | `POST` | `{objectUrl}[?corrNr={transport}]` | `createObject` |
| 72 | `PUT` | `{sourceUrl}[?lockHandle=...][&corrNr=...]` | `updateSource` |
| 73 | `DELETE` | `{objectUrl}?lockHandle=...[&corrNr=...]` | `deleteObject` |

**Package resolution:** `GET {objectUrl}` — `client.ts` (`resolveObjectPackage`); regex on `adtcore:packageRef`.

---

## 21. Handler base paths (`src/handlers/intent.ts`)

Used to build `{objectUrl}` / create collection parents (same paths as sections 2–9, repeated here for traceability from SAPWrite):

- `/sap/bc/adt/programs/programs/`
- `/sap/bc/adt/oo/classes/`
- `/sap/bc/adt/oo/interfaces/`
- `/sap/bc/adt/functions/groups/`
- `/sap/bc/adt/programs/includes/`
- `/sap/bc/adt/ddic/ddl/sources/`
- `/sap/bc/adt/bo/behaviordefinitions/`
- `/sap/bc/adt/ddic/srvd/sources/`
- `/sap/bc/adt/ddic/ddlx/sources/`
- `/sap/bc/adt/businessservices/bindings/`
- `/sap/bc/adt/ddic/tables/`
- `/sap/bc/adt/ddic/structures/`
- `/sap/bc/adt/ddic/domains/`
- `/sap/bc/adt/ddic/dataelements/`
- `/sap/bc/adt/vit/wb/object_type/trant/object_name/`

---

## 22. Production `src/` files touching this list

| File | Role |
|------|------|
| `src/adt/client.ts` | High-level reads, search, package, data preview, BSP, discovery, components |
| `src/adt/http.ts` | CSRF `HEAD`/`GET` on `core/discovery`, default `Accept`, retries |
| `src/adt/crud.ts` | Lock / unlock / create / put source / delete |
| `src/adt/devtools.ts` | Syntax check, activation, AUnit, ATC, SRVB publish |
| `src/adt/codeintel.ts` | Definition, references, where-used, completion |
| `src/adt/diagnostics.ts` | Dumps and ABAP traces |
| `src/adt/transport.ts` | CTS |
| `src/adt/features.ts` | Feature + auth probes |
| `src/adt/xml-parser.ts` | Comments reference many response shapes (not separate HTTP calls) |
| `src/adt/types.ts` | Type documentation for several endpoints |
| `src/handlers/intent.ts` | URL builders + orchestration |

---

## 23. Related repo locations (non-`src`, for the next review step)

- **Tests:** `tests/unit/adt/*.test.ts`, `tests/integration/*.integration.test.ts`, `tests/e2e/*.e2e.test.ts` — mock or exercise the same URLs.
- **Older discovery URL:** `scripts/e2e-deploy.sh` and some docs use **`/sap/bc/adt/discovery`** (no `core`). Production HTTP client uses **`/sap/bc/adt/core/discovery`** — flag for consistency check.
- **Prior audits:** `docs/research/complete/2026-04-09-adt-api-audit-working.md`, `adt-api-audit-issues.md`, `adt-api-audit-documentation-and-unused.md` — may list extra endpoints **not** implemented in ARC-1 (gap / future work).

---

## 24. Count summary

- **Numbered ADT endpoint rows (this document):** 73 patterns, plus **section 21** (path prefixes) and **generic CRUD** (69–73) that apply to many object types.
- **SAP OData (non-ADT) used by ARC-1:** `src/adt/ui5-repository.ts` → `/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV/...`.

---

## Next-step checklist (per endpoint)

For each row in sections 1–20, plan to:

1. **SAP system:** Confirm ICF + authorization for the configured user (and PP destination if used).
2. **Contract:** Method, path, required query params, `Content-Type` / `Accept`, sample payload or body.
3. **ARC-1:** Caller, error handling (`AdtApiError`, safety operation name), and whether **406/415** retry logic in `http.ts` applies.
4. **Tests:** Unit fixture coverage vs integration / E2E on a real system.
5. **Alternatives:** SAP version differences, BTP ABAP restrictions, and whether Eclipse ADT uses a newer MIME variant — document if ARC-1 should negotiate differently.

This inventory is **code-complete for `src/`** as of the scan date; if new ADT calls are added, regenerate from the repo (search `/sap/bc/adt` under `src/`).
