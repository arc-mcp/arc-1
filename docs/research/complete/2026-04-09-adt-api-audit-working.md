# ADT API Audit: APIs Working as Expected

**Date:** 2026-04-09
**Scope:** All SAP ADT REST API endpoints used in ARC-1 v0.6.0
**Method:** Source code analysis, unit test review (1174 tests, all passing), XML fixture verification, integration test review

---

## Summary

ARC-1 uses **50+ distinct ADT API endpoints** across 8 source modules. This document covers the **APIs verified as correctly implemented** based on unit tests, XML fixture validation, and integration test evidence.

---

## 1. Source Code Read Operations (`src/adt/client.ts`)

### 1.1 Program Source — `GET /sap/bc/adt/programs/programs/{name}/source/main`
- **Status:** Working
- **Tests:** Unit (client.test.ts:42-46), Integration (adt.integration.test.ts:98-104)
- **Verification:** Returns raw ABAP source text. Integration test confirms RSHOWTIM (standard SAP report) returns valid source.
- **Headers:** Default (text/plain response)

### 1.2 Class Source — `GET /sap/bc/adt/oo/classes/{name}/source/main`
- **Status:** Working
- **Tests:** Unit (client.test.ts:48-117), Integration (adt.integration.test.ts:213-261)
- **Verification:** Supports full source retrieval and individual includes. Integration test confirms CL_ABAP_CHAR_UTILITIES and /DMO/CL_FLIGHT_AMDP work.
- **Include paths:** `/sap/bc/adt/oo/classes/{name}/includes/{definitions|implementations|macros|testclasses}`
- **Edge cases tested:** Multiple comma-separated includes, 404 for non-existent includes (graceful fallback), unknown include validation, case normalization

### 1.3 Class Metadata — `GET /sap/bc/adt/oo/classes/{name}`
- **Status:** Working
- **Tests:** Unit (xml-parser.test.ts:546-618), fixture (class-metadata.xml)
- **Verification:** Parses name, description, language, abapLanguageVersion, category (with numeric code mapping), fixPointArithmetic, package. Handles optional fields gracefully.
- **Headers:** Default XML response
- **Accept:** Default (application/xml)

### 1.4 Interface Source — `GET /sap/bc/adt/oo/interfaces/{name}/source/main`
- **Status:** Working
- **Tests:** Unit (client.test.ts:119-122), Integration (adt.integration.test.ts:267-276)
- **Verification:** Returns raw ABAP source text.

### 1.5 Function Module Source — `GET /sap/bc/adt/functions/groups/{group}/fmodules/{name}/source/main`
- **Status:** Working
- **Tests:** Unit (client.test.ts:124-128)
- **Verification:** Requires function group name, which can be auto-resolved via search.

### 1.6 Function Group Metadata — `GET /sap/bc/adt/functions/groups/{name}`
- **Status:** Working
- **Tests:** Unit (xml-parser.test.ts:249-283), fixture (function-group.xml)
- **Verification:** Parses group name and list of function modules. Handles empty groups and single modules.

### 1.7 Function Group Source — `GET /sap/bc/adt/functions/groups/{name}/source/main`
- **Status:** Working
- **Tests:** Unit (client.test.ts via handler tests)
- **Verification:** Returns main include source code.

### 1.8 Include Source — `GET /sap/bc/adt/programs/includes/{name}/source/main`
- **Status:** Working
- **Tests:** Unit (client.test.ts:130-134)

### 1.9 CDS View Source (DDLS) — `GET /sap/bc/adt/ddic/ddl/sources/{name}/source/main`
- **Status:** Working
- **Tests:** Unit (client.test.ts:136-140)

### 1.10 Behavior Definition (BDEF) — `GET /sap/bc/adt/bo/behaviordefinitions/{name}/source/main`
- **Status:** Working
- **Tests:** Unit (client.test.ts:142-146)

### 1.11 Service Definition (SRVD) — `GET /sap/bc/adt/ddic/srvd/sources/{name}/source/main`
- **Status:** Working
- **Tests:** Unit (client.test.ts:148-152)

### 1.12 Metadata Extension (DDLX) — `GET /sap/bc/adt/ddic/ddlx/sources/{name}/source/main`
- **Status:** Working
- **Tests:** Unit (client.test.ts:154-167)
- **Verification:** Correct URL confirmed in test assertion. 404 returns helpful message about inline annotations.

### 1.13 Service Binding (SRVB) — `GET /sap/bc/adt/businessservices/bindings/{name}`
- **Status:** Working
- **Tests:** Unit (client.test.ts:169-200, xml-parser.test.ts:486-542), fixture (service-binding.xml)
- **Headers:** `Accept: application/vnd.sap.adt.businessservices.servicebinding.v2+xml`
- **Verification:** Parses binding metadata into structured JSON: name, description, OData version (V2/V4), binding type, category (UI/Web API), published status, service definition, release state. Tested with V4 UI and V2 Web API bindings.

### 1.14 Table Definition — `GET /sap/bc/adt/ddic/tables/{name}/source/main`
- **Status:** Working
- **Tests:** Unit (client.test.ts via handler tests)

### 1.15 View Definition — `GET /sap/bc/adt/ddic/views/{name}/source/main`
- **Status:** Working
- **Tests:** Unit (client.test.ts via handler tests)

### 1.16 Structure Definition — `GET /sap/bc/adt/ddic/structures/{name}/source/main`
- **Status:** Working
- **Tests:** Integration (adt.integration.test.ts:137-149) — confirmed with BAPIRET2 and SYST

### 1.17 Domain Metadata — `GET /sap/bc/adt/ddic/domains/{name}`
- **Status:** Working
- **Tests:** Unit (xml-parser.test.ts:362-401), Integration (adt.integration.test.ts:151-166), fixtures (domain-metadata.xml, domain-with-fixvalues.xml)
- **Verification:** Parses dataType, length, decimals, outputLength, conversionExit, signExists, lowercase, valueTable, fixedValues array, package. Integration confirms MANDT (CLNT type) and BUKRS (CHAR with value table T001).

### 1.18 Data Element Metadata — `GET /sap/bc/adt/ddic/dataelements/{name}`
- **Status:** Working
- **Tests:** Unit (xml-parser.test.ts:405-434), Integration (adt.integration.test.ts:167-184), fixture (dataelement-metadata.xml)
- **Verification:** Parses typeKind, typeName, dataType, length, decimals, all four label fields, searchHelp, defaultComponentName, package. Integration confirms MANDT and BUKRS.

### 1.19 Transaction Metadata — `GET /sap/bc/adt/vit/wb/object_type/trant/object_name/{name}`
- **Status:** Working
- **Tests:** Unit (xml-parser.test.ts:438-456), Integration (adt.integration.test.ts:186-207), fixture (transaction-metadata.xml)
- **Verification:** Returns code, description, package. Note: program field is always empty from this endpoint (enriched via SQL in handler). Integration confirms SE38 works and non-existent transactions return 200 with empty data.

### 1.20 Message Class — `GET /sap/bc/adt/msg/messages/{messageClass}`
- **Status:** Working
- **Tests:** Unit (handler tests), returns raw XML

### 1.21 Text Elements — `GET /sap/bc/adt/programs/programs/{name}/textelements`
- **Status:** Working
- **Tests:** Unit (handler tests), returns raw XML

### 1.22 Variants — `GET /sap/bc/adt/programs/programs/{name}/variants`
- **Status:** Working
- **Tests:** Unit (handler tests), returns raw XML

---

## 2. Search Operations (`src/adt/client.ts`)

### 2.1 Object Search — `GET /sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query={q}&maxResults={n}`
- **Status:** Working
- **Tests:** Unit (xml-parser.test.ts:62-111), Integration (adt.integration.test.ts:60-93), fixture (search-results.xml)
- **Verification:** Parses objectType, objectName, description, packageName, uri. Handles single result, empty results, missing attributes. Integration confirms CL_ABAP_* pattern, empty results for non-existent, maxResults limit.

### 2.2 Source Code Search — `GET /sap/bc/adt/repository/informationsystem/textSearch?searchString={s}&maxResults={n}`
- **Status:** Working (with caveats — see issues doc for response parsing)
- **Tests:** Unit (handler tests for probe/availability), Integration (indirectly)
- **Verification:** Feature probe correctly detects availability. Supports objectType and packageName filters.

---

## 3. Package Operations (`src/adt/client.ts`)

### 3.1 Package Contents — `POST /sap/bc/adt/repository/nodestructure?parent_type=DEVC/K&parent_name={name}&withShortDescriptions=true`
- **Status:** Working
- **Tests:** Unit (xml-parser.test.ts:286-302), fixture (package-contents.xml)
- **Verification:** Parses type, name, description, uri from asx:abap nodestructure format. Handles empty packages.
- **Note:** Uses POST (correct for this endpoint — SAP requires POST for nodestructure queries)

---

## 4. Table Data Operations (`src/adt/client.ts`)

### 4.1 Table Data Preview — `POST /sap/bc/adt/datapreview/ddic?rowNumber={n}&ddicEntityName={table}`
- **Status:** Working
- **Tests:** Unit (xml-parser.test.ts:114-189), Integration (adt.integration.test.ts:112-128), fixture (table-contents.xml)
- **Verification:** Supports both old (asx:abap/COLUMNS/COLUMN) and new (dataPreview namespace) XML formats. Handles single-row, empty column, and pivot from column-oriented to row-oriented. Integration confirms T000 table with MANDT column.
- **Content-Type:** text/plain (SQL filter as body)

### 4.2 Freestyle SQL — `POST /sap/bc/adt/datapreview/freestyle?rowNumber={n}`
- **Status:** Working
- **Tests:** Unit (handler tests for error handling), Integration (safety tests)
- **Verification:** Same response format as table preview. Handler includes helpful error messages for 404 (table name suggestions) and 400 (JOIN limitations note).
- **Content-Type:** text/plain (SQL as body)

---

## 5. System Information (`src/adt/client.ts`)

### 5.1 Discovery — `GET /sap/bc/adt/core/discovery`
- **Status:** Working
- **Tests:** Unit (xml-parser.test.ts:304-359), Integration (adt.integration.test.ts:29-36)
- **Verification:** Parses Atom service document with workspaces and collections. Integration confirms structured JSON with user and collections.
- **Also used for:** CSRF token fetch (HEAD request)

### 5.2 Installed Components — `GET /sap/bc/adt/system/components`
- **Status:** Working
- **Tests:** Unit (xml-parser.test.ts:192-246), Integration (adt.integration.test.ts:39-55), fixture (installed-components.xml)
- **Verification:** Parses Atom feed with name, release, description (semicolon-delimited title). Integration confirms SAP_BASIS presence. Also used for system type detection (BTP vs on-premise).

---

## 6. BSP/UI5 Filestore Operations (`src/adt/client.ts`)

### 6.1 List BSP Apps — `GET /sap/bc/adt/filestore/ui5-bsp/objects`
- **Status:** Working
- **Tests:** Unit (xml-parser.test.ts:622-653), fixture (bsp-app-list.xml)
- **Headers:** `Accept: application/atom+xml`
- **Verification:** Parses Atom feed with app name and description. Handles empty feed and single entry.

### 6.2 Browse BSP Structure — `GET /sap/bc/adt/filestore/ui5-bsp/objects/{app}/content`
- **Status:** Working
- **Tests:** Unit (xml-parser.test.ts:657-706), fixture (bsp-folder-listing.xml)
- **Headers:** `Accept: application/xml`, `Content-Type: application/atom+xml`
- **Verification:** Distinguishes files and folders, extracts etag for files, derives relative paths. Handles empty folders.

### 6.3 Read BSP File — `GET /sap/bc/adt/filestore/ui5-bsp/objects/{app}/{path}/content`
- **Status:** Working
- **Tests:** Unit (client.test.ts via handler tests)
- **Headers:** `Accept: application/xml`, `Content-Type: application/octet-stream`

---

## 7. CRUD Operations (`src/adt/crud.ts`)

### 7.1 Lock Object — `POST {objectUrl}?_action=LOCK&accessMode=MODIFY`
- **Status:** Working
- **Tests:** Unit (crud.test.ts)
- **Headers:** `Accept: application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result`
- **Verification:** Parses LOCK_HANDLE, CORRNR, IS_LOCAL from asx:abap response.

### 7.2 Unlock Object — `POST {objectUrl}?_action=UNLOCK&lockHandle={handle}`
- **Status:** Working
- **Tests:** Unit (crud.test.ts)

### 7.3 Create Object — `POST {parentUrl}?corrNr={transport}`
- **Status:** Working
- **Tests:** Unit (handler tests for batch_create), Integration (lifecycle test)
- **Verification:** Type-specific XML bodies for PROG, CLAS, INTF, INCL, DDLS, BDEF, SRVD, DDLX with correct namespace URIs and element names.

### 7.4 Update Source — `PUT {sourceUrl}?lockHandle={handle}&corrNr={transport}`
- **Status:** Working
- **Tests:** Unit (crud.test.ts, handler tests)
- **Content-Type:** text/plain

### 7.5 Delete Object — `DELETE {objectUrl}?lockHandle={handle}&corrNr={transport}`
- **Status:** Working
- **Tests:** Unit (crud.test.ts, handler tests)

### 7.6 Safe Update Pattern (lock -> update -> unlock)
- **Status:** Working
- **Tests:** Unit (crud.test.ts:safeUpdateSource), handler tests for update/edit_method/batch_create
- **Verification:** Uses withStatefulSession() for cookie/CSRF token sharing. Unlock in finally block.

---

## 8. DevTools Operations (`src/adt/devtools.ts`)

### 8.1 Syntax Check — `POST /sap/bc/adt/checkruns`
- **Status:** Working
- **Tests:** Unit (devtools.test.ts:21-82)
- **Content-Type:** `application/vnd.sap.adt.checkobjects+xml`
- **Accept:** `application/vnd.sap.adt.checkmessages+xml`
- **Verification:** Correctly classifies E=error, W=warning, I=info. Tested with clean code, errors only, warnings only, mixed.

### 8.2 Activation — `POST /sap/bc/adt/activation?method=activate&preauditRequested=true`
- **Status:** Working
- **Tests:** Unit (devtools.test.ts:86-131)
- **Verification:** Detects errors from both `severity="error"` and `type="E"` patterns. Extracts shortText messages. Supports single and batch activation.

### 8.3 Batch Activation — Same endpoint, multiple `objectReference` elements
- **Status:** Working
- **Tests:** Unit (devtools.test.ts:135-194)
- **Verification:** Correctly constructs XML with multiple objectReference elements. Used for RAP stack activation (DDLS + BDEF + SRVD + SRVB).

---

## 9. Code Intelligence (`src/adt/codeintel.ts`)

### 9.1 Find Definition — `POST /sap/bc/adt/navigation/target?uri={sourceUrl}&line={n}&column={n}`
- **Status:** Working
- **Tests:** Unit (codeintel.test.ts:31-80)
- **Verification:** Sends source as POST body (text/plain). Parses navigation response for uri, type, name. Returns null for no definition. Includes line/column in URL.

### 9.2 Find References (legacy) — `GET /sap/bc/adt/repository/informationsystem/usageReferences?uri={objectUrl}`
- **Status:** Working
- **Tests:** Unit (codeintel.test.ts:85-112)
- **Verification:** Parses objectReference elements. Returns empty array when none found. Used as fallback when Where-Used fails.

### 9.3 Where-Used Scope — `POST /sap/bc/adt/repository/informationsystem/usageReferences/scope`
- **Status:** Working
- **Tests:** Unit (codeintel.test.ts:116-158), fixture (where-used-scope.xml)
- **Verification:** Returns objectType entries with description and count. Tested with fixture containing PROG/P, CLAS/OC, FUNC/FM entries.

### 9.4 Where-Used (detailed) — `POST /sap/bc/adt/repository/informationsystem/usageReferences?uri={objectUrl}`
- **Status:** Working
- **Tests:** Unit (codeintel.test.ts), fixture (where-used-results.xml)
- **Content-Type:** `application/vnd.sap.adt.repository.usagereferences.request.v1+xml`
- **Accept:** `application/vnd.sap.adt.repository.usagereferences.result.v1+xml`
- **Verification:** Parses referencedObject > adtObject tree structure with packageRef.

### 9.5 Code Completion — `POST /sap/bc/adt/abapsource/codecompletion/proposals?uri={sourceUrl}&line={n}&column={n}`
- **Status:** Working
- **Tests:** Unit (codeintel.test.ts)
- **Verification:** Sends source as POST body. Parses proposal elements with text, description, type.

---

## 10. Transport Management (`src/adt/transport.ts`)

### 10.1 List Transports — `GET /sap/bc/adt/cts/transportrequests?user={user}`
- **Status:** Working
- **Tests:** Unit (transport.test.ts:23-75)
- **Verification:** Parses tm:request elements. Handles multiple transports, user filter, wildcard, empty response.

### 10.2 Get Transport — `GET /sap/bc/adt/cts/transportrequests/{id}`
- **Status:** Working
- **Tests:** Unit (transport.test.ts:79-100)
- **Verification:** Returns null for non-existent transport.

### 10.3 Create Transport — `POST /sap/bc/adt/cts/transportrequests`
- **Status:** Working
- **Tests:** Unit (transport.test.ts)
- **Verification:** Sends tm:root XML with description and optional target package.

### 10.4 Release Transport — `POST /sap/bc/adt/cts/transportrequests/{id}/newreleasejobs`
- **Status:** Working
- **Tests:** Unit (transport.test.ts)

---

## 11. Feature Detection (`src/adt/features.ts`)

### 11.1 Feature Probes — `GET` to 6 feature endpoints
- **Status:** Working
- **Tests:** Unit (features.test.ts)
- **Endpoints probed:**
  - `/sap/bc/adt/ddic/sysinfo/hanainfo` (HANA)
  - `/sap/bc/adt/abapgit/repos` (abapGit)
  - `/sap/bc/adt/ddic/ddl/sources` (RAP/CDS)
  - `/sap/bc/adt/debugger/amdp` (AMDP)
  - `/sap/bc/adt/filestore/ui5-bsp` (UI5)
  - `/sap/bc/adt/cts/transportrequests` (Transport)

### 11.2 Text Search Probe — `GET /sap/bc/adt/repository/informationsystem/textSearch?searchString=SY-SUBRC&maxResults=1`
- **Status:** Working
- **Tests:** Unit (features.test.ts)
- **Verification:** Classifies 401/403 (auth), 404 (SICF not active), 500 (framework error), 501 (SAP_BASIS too old).

### 11.3 Auth Probe — `GET` to search and transport endpoints
- **Status:** Working
- **Tests:** Unit (features.test.ts)

### 11.4 System Detection — `GET /sap/bc/adt/system/components`
- **Status:** Working
- **Verification:** Detects BTP (SAP_CLOUD component) vs on-premise. Extracts SAP_BASIS release for abaplint version mapping.

---

## 12. HTTP Transport (`src/adt/http.ts`)

### 12.1 CSRF Token Fetch — `HEAD /sap/bc/adt/core/discovery` with `X-CSRF-Token: fetch`
- **Status:** Working
- **Tests:** Unit (http.test.ts)
- **Verification:** HEAD is 5s vs 56s for GET on slow systems. Token cached and refreshed on 403.

### 12.2 Cookie Jar — Session cookie persistence
- **Status:** Working
- **Tests:** Unit (http.test.ts), Integration (adt.integration.test.ts:393-399)
- **Verification:** SAP ties CSRF tokens to SAP_SESSIONID_* cookies. Without persistence, POST fails with 403.

### 12.3 Stateful Sessions — `X-sap-adt-sessiontype: stateful`
- **Status:** Working
- **Tests:** Unit (http.test.ts, crud.test.ts)
- **Verification:** Lock/modify/unlock must share session cookies.

---

## 13. Diagnostics (`src/adt/diagnostics.ts`)

### 13.1 List Dumps — `GET /sap/bc/adt/runtime/dumps`
- **Status:** Working
- **Tests:** Unit (diagnostics.test.ts:57-100), fixture (dumps-list.xml)
- **Headers:** `Accept: application/atom+xml;type=feed`
- **Verification:** Parses Atom feed with user, error type, program, timestamp, dump ID. Supports $top and $query filters.

### 13.2 Get Dump Detail — `GET /sap/bc/adt/runtime/dump/{id}` + `GET /sap/bc/adt/runtime/dump/{id}/formatted`
- **Status:** Working
- **Tests:** Unit (diagnostics.test.ts), fixtures (dump-detail.xml, dump-formatted.txt)
- **Verification:** Parallel fetch of XML metadata and formatted plain text. Parses error, exception, program, user, timestamp, chapters, termination URI.

### 13.3 List Traces — `GET /sap/bc/adt/runtime/traces/abaptraces`
- **Status:** Working
- **Tests:** Unit (diagnostics.test.ts)
- **Headers:** `Accept: application/atom+xml;type=feed`

### 13.4 Trace Hitlist — `GET /sap/bc/adt/runtime/traces/abaptraces/{id}/hitlist`
- **Status:** Working
- **Tests:** Unit (diagnostics.test.ts)

### 13.5 Trace Statements — `GET /sap/bc/adt/runtime/traces/abaptraces/{id}/statements`
- **Status:** Working
- **Tests:** Unit (diagnostics.test.ts)

### 13.6 Trace DB Accesses — `GET /sap/bc/adt/runtime/traces/abaptraces/{id}/dbAccesses`
- **Status:** Working
- **Tests:** Unit (diagnostics.test.ts)

---

## 14. ATC Check (`src/adt/devtools.ts`)

### 14.1 Create ATC Run — `POST /sap/bc/adt/atc/runs?worklistId=1`
- **Status:** Working (with caveats — see issues doc for parser limitations)
- **Tests:** Unit (devtools.test.ts)

### 14.2 Get ATC Worklist — `GET /sap/bc/adt/atc/worklists/{id}`
- **Status:** Working
- **Headers:** `Accept: application/atc.worklist.v1+xml`
