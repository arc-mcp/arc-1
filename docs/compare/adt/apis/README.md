# ADT API review reports (ARC-1)

## Executive summary — is everything fine?

**Overall:** ARC-1’s ADT usage is **consistent with standard ADT REST patterns** (paths, CSRF, stateful lock sessions, vendor MIME types where required). Nothing in this review identifies a **definite broken** contract vs a typical NetWeaver / ABAP Platform system.

**Highest-value follow-ups (not blockers):**

1. **Align legacy URLs:** `scripts/e2e-deploy.sh` (and some docs) still mention `/sap/bc/adt/discovery` without `core` — production code uses **`/sap/bc/adt/core/discovery`** ([`01-session-discovery-csrf.md`](01-session-discovery-csrf.md)).
2. **MIME / negotiation:** Endpoints with **vendor-specific** `Accept` / `Content-Type` (SRVB, API release, where-used, AUnit, ATC) are the **most likely** to need updates on newer SAP versions — watch **406** in CI ([`05-rap-cds-srvb.md`](05-rap-cds-srvb.md), [`09-code-intelligence.md`](09-code-intelligence.md), [`13-devtools-check-activate-test-atc-publish.md`](13-devtools-check-activate-test-atc-publish.md)).
3. **UI5 filestore GET headers:** `Accept` / `Content-Type` combinations on **GET** for BSP content may be **suboptimal** for binary files — validate on a real system ([`12-ui5-bsp-filestore.md`](12-ui5-bsp-filestore.md)).
4. **`resolveObjectPackage`:** Regex on XML is **fragile**; parsing with `parseXml` would be more robust ([`17-crud-and-package-resolution.md`](17-crud-and-package-resolution.md)).
5. **Feature probes:** `features.ts` comments say **HEAD** but code uses **GET** — fix comment or implementation ([`16-feature-and-auth-probes.md`](16-feature-and-auth-probes.md)).

**BTP ABAP vs on-prem:** Several areas (classic **PROG**, **FUGR/FM**, freestyle **SQL**, some DDIC reads) may **fail by design** on restricted cloud systems — that is **environmental**, not necessarily a bug ([`02-programs-and-includes.md`](02-programs-and-includes.md), [`04-function-groups.md`](04-function-groups.md), [`10-datapreview-and-freesql.md`](10-datapreview-and-freesql.md)).

---

## SAP ABAP: where server-side code lives (all APIs)

Each numbered report adds **area-specific packages and classes**. Use this section as the **general procedure** on any SAP system.

### 1) ICF — authoritative handler

| Step | Transaction | Action |
|------|-------------|--------|
| 1 | **SICF** | Open **`default_host` → `sap` → `bc` → `adt`** and continue along URL segments after `/sap/bc/adt/` (e.g. `programs` → `programs`, `oo` → `classes`, …). |
| 2 | Service node | Select the leaf that matches the HTTP operation; ensure status **Active**. |
| 3 | Handler | Note the **handler class** (or list) on the service — that is the ABAP entry for the HTTP call. |

### 2) REST stack — common frameworks

| Package / object | Role |
|------------------|------|
| **`SADT_REST`** | ADT REST infrastructure: **`CL_ADT_REST_RESOURCE`** (resource base), **`CL_ADT_REST_REQUEST` / `CL_ADT_REST_RESPONSE`**, content handlers (`CL_ADT_REST_*_HANDLER`), **`CL_ADT_REST_URI`**. |
| **`SADT_REST` (BAdIs)** | **`BADI_ADT_REST_RFC_APPLICATION`** (register REST applications), **`BADI_ADT_REST_AUTHORIZATION`**, accessibility BAdIs — control registration and checks. |
| **`SWB_ADT_TOOL`** | Workbench ADT base: **`CL_WB_ADT_REST_RESOURCE`**, **`CL_WB_ADT_REST_RESOURCE_COLL`**, plugin resources — many object types build on this. |
| **`SEDI_ADT`** | Source / editor ADT: program & include **source** resources (e.g. **`CL_SEDI_ADT_RES_SOURCE`** hierarchy), **`CL_SEDI_ADT_RES_APP_ABAPSOURCE`** (registers `/abapsource/...` services such as code completion). |

### 3) How to list concrete classes on your system

| Method | Detail |
|--------|--------|
| **SAP GUI** | **SE24** / **SE80**: search classes `CL_*ADT*` in the packages named in the report for that API. |
| **Where-used** | From **`CL_ADT_REST_RESOURCE`** or **`CL_WB_ADT_REST_RESOURCE`** → display subclasses / implementers (release-dependent). |
| **ADT in Eclipse** | Open object from handler or framework class; **Where Used** in Project Explorer. |
| **ARC-1 MCP** | **`SAPSearch`** patterns such as `CL_ADT_REST*`, `CL_SEDI_ADT*`, `CL_SEU_ADT*`, `CL_*_ADT_*` on a dev system (read-only). |

### 4) SAP object types you will see

| TADIR / object | Meaning |
|----------------|---------|
| **CLAS** | Resource controllers, HTTP helpers, parsers. |
| **ICF** | Service definition (maintenance via SICF). |
| **ENHS / ENHO** | Enhancement spots / BAdI implementations touching ADT REST. |
| **XSLT** | Simple transformations for Atom/XML in some ADT responses (`SADT_*`, `SEU_ADT`, …). |
| **FUGR** | RFC / function modules behind some checks (not the primary REST surface). |

> **Disclaimer:** Package and class names **change between releases** (7.5x, S/4HANA, ABAP Platform, BTP ABAP). The per-report tables are **indicative**; **SICF + SE24 on your SID** are source of truth.

---

This folder contains **per-area reports** derived from `docs/compare/adt/arc-1-adt-api-inventory.md`. Each report walks through the endpoints in that area with:

- SAP system (ICF, authorization, principal propagation)
- HTTP contract (method, path, query, headers, sample body)
- ARC-1 callers, `AdtSafetyError` / `AdtApiError`, and **406/415** retry behavior
- Tests (unit vs integration / E2E)
- Alternatives (version, BTP, MIME negotiation)
- **Actions:** what to verify or change, and a **verdict** (no code change assumed unless noted)

## Report index

Each numbered report includes **SAP ABAP-side: implementation & relevant objects** (ICF path, typical packages/classes, TADIR types, links to related reports where probes reuse endpoints).

| File | Inventory sections | Topics |
|------|-------------------|--------|
| [01-session-discovery-csrf.md](01-session-discovery-csrf.md) | 1 (rows 1–3) | `HEAD`/`GET` `/sap/bc/adt/core/discovery`, CSRF |
| [02-programs-and-includes.md](02-programs-and-includes.md) | 2–3 (4–7, create collections) | Program source, text elements, variants, includes |
| [03-oo-classes-and-interfaces.md](03-oo-classes-and-interfaces.md) | 4–5 (8–11) | Class source/includes/metadata, interfaces |
| [04-function-groups.md](04-function-groups.md) | 6 (12–14) | FUGR metadata and source |
| [05-rap-cds-srvb.md](05-rap-cds-srvb.md) | 7 (15–19) | DDLS, BDEF, SRVD, DDLX, SRVB |
| [06-ddic-tables-views.md](06-ddic-tables-views.md) | 8 (20–24) | Tables, views, structures, domains, DTEL |
| [07-vit-transactions-and-api-release.md](07-vit-transactions-and-api-release.md) | 9–10 (25–26) | T-code VIT, API release state |
| [08-repository-search-and-package.md](08-repository-search-and-package.md) | 11 (27–29) | quickSearch, textSearch, nodestructure |
| [09-code-intelligence.md](09-code-intelligence.md) | 12 (30–34) | Navigation, usage, completion |
| [10-datapreview-and-freesql.md](10-datapreview-and-freesql.md) | 13 (35–36) | DDIC preview, freestyle SQL |
| [11-system-components-and-messages.md](11-system-components-and-messages.md) | 14 (37–38) | Components Atom feed, message class XML |
| [12-ui5-bsp-filestore.md](12-ui5-bsp-filestore.md) | 15 (39–41) | UI5 BSP listing and file read |
| [13-devtools-check-activate-test-atc-publish.md](13-devtools-check-activate-test-atc-publish.md) | 16 (42–48) | checkruns, activation, AUnit, ATC, publish |
| [14-cts-transports.md](14-cts-transports.md) | 17 (49–52) | Transport list/create/release |
| [15-runtime-diagnostics.md](15-runtime-diagnostics.md) | 18 (53–59) | Dumps, traces |
| [16-feature-and-auth-probes.md](16-feature-and-auth-probes.md) | 19 (60–68) | Startup probes (note: uses GET, not HEAD) |
| [17-crud-and-package-resolution.md](17-crud-and-package-resolution.md) | 20 (69–73) + `GET` object | Lock/unlock/create/PUT/DELETE, `resolveObjectPackage` |

## Global: SAP ICF and authorization

- **ICF:** ADT services live under **`/sap/bc/adt/`** in **SICF** (`default_host` → `sap` → `bc` → `adt`). Sub-nodes must be **active** for the corresponding API to respond (404 if inactive).
- **SAP auth:** Developers typically need **`S_ADT_RES`** (and often **`S_DEVELOP`**) with activities appropriate for read vs POST-heavy “reads”. Transport objects add **`S_TRANSPRT`**. Exact requirements are **system-dependent**; validate with SU53 on failure.
- **Principal propagation (PP):** When enabled, the **same URLs** are called but the HTTP client adds **`SAP-Connectivity-Authentication`** (or related proxy auth). **ICF on the ABAP side is unchanged**; effective SAP user comes from the mapped identity. Test with the **same PP user** you use in production.

## Global: ARC-1 HTTP errors and negotiation

- **`AdtApiError`:** Thrown in `AdtHttpClient.handleResponse` for **status ≥ 400** (`src/adt/http.ts`), carrying `statusCode`, `path`, and body snippet.
- **`AdtSafetyError`:** Thrown **before** HTTP from `checkOperation` / `checkPackage` / `checkTransport` (`src/adt/safety.ts`).
- **406/415 retry:** **All** requests through `AdtHttpClient.request()` may retry **once** on **406** (Accept fallback) or **415** (Content-Type → `application/xml` fallback). Custom `Accept` / `Content-Type` on an endpoint still participates in this logic.

## Global: tests

- **Unit:** `tests/unit/adt/*.test.ts` — mocks `fetch`, covers URL construction and parsers.
- **Integration:** `tests/integration/adt.integration.test.ts` (and others) — real SAP when `TEST_SAP_*` set.
- **E2E:** `tests/e2e/*.e2e.test.ts` — MCP against a running server.

## OData (not ADT)

UI5 ABAP Repository **`/sap/opu/odata/UI5/ABAP_REPOSITORY_SRV`** is documented only in inventory §24; no separate file here unless extended later.
