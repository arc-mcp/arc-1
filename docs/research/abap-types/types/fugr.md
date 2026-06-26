# FUGR — Function Group

## TL;DR

`FUGR` is a real TADIR R3TR object type (function group, the container for function modules
and their includes). It is correctly spelled in ARC-1's schema enums and has a working URL
builder. ADT exposes **two** distinct slash subtypes under it: `FUGR/F` (the function group
container) and `FUGR/FF` (an individual function module). ARC-1's `SLASH_TYPE_MAP` maps both
to the bare short type `FUGR`, which is wrong: a `FUGR/FF` is a function module, not a
function group, and routing it to the FUGR handler produces a wrong URL. ARC-1 already has
a separate `FUNC` short type for function modules — `FUGR/FF` should normalize to `FUNC`,
not `FUGR`.

## TADIR ground truth

- **R3TR type**: `FUGR` — Function Group. Real top-level TADIR R3TR object (table `TADIR`,
  `OBJECT = FUGR`, `PGMID = R3TR`).
- **LIMU sub-objects** under FUGR:
  - `LIMU FUNC` — individual function module
  - `LIMU FUGR` — generated container include
  - `LIMU REPS` — generated report includes (top, uxx, …)
  - `LIMU INCL` — user-written includes
- **abap-file-formats support**: ✅ released. Directory
  [`file-formats/fugr/`](https://github.com/SAP/abap-file-formats/tree/main/file-formats/fugr)
  exists and contains `fugr-v1.json` (group schema) plus `func-v1.json` and `reps-v1.json`
  for sub-objects. Confirms the LIMU sub-object structure (function modules are children of
  the FUGR file format, not their own top-level type).
- **Source URL or fixture**: GitHub API listing of
  `repos/SAP/abap-file-formats/contents/file-formats/fugr` returned `fugr-v1.json`,
  `func-v1.json`, `reps-v1.json`.

## ADT slash subtypes

| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| `FUGR/F` | Function group (container, top-level object) | `/sap/bc/adt/functions/groups/<name>` | a4h ✅ (live probe) |
| `FUGR/FF` | Function module (LIMU FUNC under a group) | `/sap/bc/adt/functions/groups/<grp>/fmodules/<fm>` | a4h ✅ (live probe) |
| `FUGR/I`  | Function group main include (returned for `source/main` of FUGR) | `/sap/bc/adt/functions/groups/<grp>/source/main` | a4h ✅ (search hit) |
| `FUGR/PU` | Form routine (PERFORM subroutine) inside a FUGR | per-form ADT URL | Eclipse apidoc only (`ISourceSemanticPosition`) |

Eclipse plugin reference (`com.sap.adt.core.apidoc-3.58.1`) confirms `FUGR/FF` and
`FUGR/PU` literally:
- `com/sap/adt/ris/search/IAdtRepositorySearchParameters.html` line 208: example string
  `"FUGR/FF"`.
- `com/sap/adt/communication/content/plaintext/ISourceSemanticPosition.html` line 212:
  `"Global workbench type (e.g. FUGR/PU for a Form Routine)"`.

## SAP docs & notes

- abap-file-formats README: function group is a released, cloud-supported file format with
  `fugr/` directory and `func`/`reps` sub-schemas.
- ADT REST URL pattern `/sap/bc/adt/functions/groups/{name}` and
  `/sap/bc/adt/functions/groups/{grp}/fmodules/{fm}` is documented implicitly via
  `<atom:link>` discovery on the live system response (see live verification below).
- No SAP Note specifically clarifies FUGR slash forms (searched; nothing topical).

## Other MCP servers / cross-reference

- **mcp-abap-abap-adt-api**: builds function-group URLs as `/sap/bc/adt/functions/groups/`
  and function-module URLs as `/sap/bc/adt/functions/groups/<grp>/fmodules/<fm>` — same as
  ADT, distinguishing the two.
- **abapGit / abap-file-formats**: `fugr/` is the canonical serialization directory; FMs
  serialize as sub-files inside the FUGR object.
- **docs/compare/00-feature-matrix.md**: rows for "Function group" and "Function module" — both
  treated as separate handlable units.

## Live verification

### a4h (S/4HANA 2023)

- Test object (group): `SU_USER`
  - `GET /sap/bc/adt/functions/groups/su_user` → `200`, root element
    `<group:abapFunctionGroup …  adtcore:type="FUGR/F" …>`
- Test object (function module): `BAPI_USER_GETLIST` in group `SU_USER`
  - `GET /sap/bc/adt/functions/groups/su_user/fmodules/bapi_user_getlist` → `200`, root
    element `<fmodule:abapFunctionModule … adtcore:type="FUGR/FF" …>` with
    `<adtcore:containerRef adtcore:type="FUGR/F" adtcore:name="SU_USER"/>`.
- Search hit (objectType=FUGR): returns `<adtcore:objectReference adtcore:type="FUGR/I"
  adtcore:uri="/sap/bc/adt/functions/groups/<grp>/source/main">` for matches whose primary
  workbench type is the main include.
- Search hit (objectType=FUGR/FF): returns `<adtcore:objectReference adtcore:type="FUGR/FF"
  adtcore:uri="/sap/bc/adt/functions/groups/<grp>/fmodules/<fm>" …>`.

### 7.50 (NW 7.50)

- Could not verify directly — credentials not in `.env` for an NW 7.50 system. Inferred
  from `src/probe/catalog.ts:56-61` (`type: 'FUGR'`, `minRelease: 700`, knownObjects
  `['SPOP', 'SUNI']`) and from the fact ADT function-group endpoints have existed since NW
  7.0x; slash codes `FUGR/F` and `FUGR/FF` predate S/4.

## ARC-1 current surface

| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `src/handlers/schemas.ts` SAPREAD_TYPES_ONPREM | 22 | `FUGR` | ✅ |
| `src/handlers/schemas.ts` SAPREAD_TYPES_BTP | 59 | `FUGR` | ✅ (FUGR is creatable in BTP for released only — accept and rely on SAP-side auth) |
| `src/handlers/tools.ts` SAPREAD_TYPES_ONPREM/BTP | 43, 81 | `FUGR` | ✅ |
| `src/handlers/intent.ts` `inferObjectType`-like list | 305 | `FUGR` | ✅ |
| `src/handlers/intent.ts` SLASH_TYPE_MAP | 2565 | `'FUGR/F': 'FUGR'` | ✅ — `FUGR/F` is the group |
| `src/handlers/intent.ts` SLASH_TYPE_MAP | 2566 | `'FUGR/FF': 'FUGR'` | ❌ — `FUGR/FF` is a function module, should map to `FUNC` |
| `src/handlers/intent.ts` `objectBasePath` | 2679-2680 | `'FUGR' → /sap/bc/adt/functions/groups/` | ✅ for FUGR (group); but the same prefix is also returned for `'FUNC'` at 2675-2676 which is wrong — see func.md |
| `src/handlers/intent.ts` `handleSAPRead` switch | 1445-1465 | `case 'FUGR'` reads group source, optional `expand_includes` | ✅ |
| `src/probe/catalog.ts` | 56-61 | `type: 'FUGR'`, URL `/sap/bc/adt/functions/groups/{name}` | ✅ |

## Verdict

- **Status**: `correct` for the bare short type `FUGR`; **wrong** for the alias mapping
  `'FUGR/FF' → 'FUGR'` in `SLASH_TYPE_MAP`.
- **Evidence**: `verified-on-live-system` (a4h) + `verified-from-source` (Eclipse apidoc,
  abap-file-formats).
- **Issue**: `SLASH_TYPE_MAP['FUGR/FF']` collapses two distinct ADT objects (function
  group container vs function module) into the same short type. A caller that hands ARC-1
  a slash code copied from an ADT search response (`FUGR/FF`) will be routed to the FUGR
  read path, which builds `/sap/bc/adt/functions/groups/<name>` and treats `<name>` as the
  group name — but the caller's name is the function module name. Result: 404 or wrong
  source. The function-group URL also drops the required `/fmodules/<fm>` segment.

## Recommendation

- **Change**: in `src/handlers/intent.ts` `SLASH_TYPE_MAP` (line 2566), remap
  `'FUGR/FF': 'FUNC'` (not `'FUGR'`). Keep `'FUGR/F': 'FUGR'`.
- Optionally add `'FUGR/I': 'FUGR'` if we want search-result inputs that arrive with the
  main-include slash code to route to FUGR (the include collapses into the group source).
  Default position: don't alias `FUGR/I` until we see a real caller; it's noise.
- Do NOT add `FUGR/PU` alias — form routines are a sub-source position, not a separately
  readable object via ARC-1's current handlers.
- **Breaking change**: yes, but only for callers that today pass `type: "FUGR/FF"` and
  rely on the (broken) routing. There is no correct outcome for that input today, so this
  is a bug fix, not a behavioral regression.
- **Test gap to close**:
  - Unit test in `tests/unit/handlers/intent.normalize-types.test.ts` (new or existing
    SLASH_TYPE_MAP test): assert `normalizeType('FUGR/FF')` returns `'FUNC'` and
    `normalizeType('FUGR/F')` returns `'FUGR'`.
  - Integration test in `tests/integration/adt.integration.test.ts`: pass
    `{ type: 'FUGR/FF', name: <known FM>, group: <grp> }` to `SAPRead` and assert the
    response body matches the function-module source (not the group main include).
  - E2E sanity: extend the function-module fixture in `tests/e2e/fixtures.ts` to assert
    that an ADT search returning `FUGR/FF` for the fixture FM, fed back into `SAPRead`,
    round-trips successfully.
