# FUNC — Function Module

## TL;DR

`FUNC` is **not** a TADIR R3TR object type. It exists only as `TADIR PGMID=LIMU OBJECT=FUNC`
— a sub-object under a parent `R3TR FUGR`. ADT never returns `FUNC/FM` as
`<adtcore:objectType>`; the canonical slash code for an individual function module is
`FUGR/FF`. ARC-1's `SLASH_TYPE_MAP['FUNC/FM'] = 'FUNC'` is invented, never produced by ADT,
and is dead alias surface. The bare short type `FUNC` itself is a legitimate ARC-1
abstraction (it's a useful caller-facing handle for "read/write a function module by group +
name"), but its `objectBasePath` is wrong and the slash alias should be removed and replaced
with `'FUGR/FF': 'FUNC'`.

## TADIR ground truth

- **R3TR type**: **does not exist as R3TR**. Function modules are stored as
  `TADIR PGMID=LIMU, OBJECT=FUNC`, parent `R3TR FUGR <group-name>`. There are no rows in
  TADIR with `PGMID=R3TR, OBJECT=FUNC`.
- **LIMU sub-objects**: N/A — `FUNC` *is itself* a LIMU sub-object of FUGR; it has no
  further LIMU children.
- **abap-file-formats support**: partial / dependent. The repo has
  [`file-formats/fugr/func-v1.json`](https://github.com/SAP/abap-file-formats/tree/main/file-formats/fugr)
  — a schema for individual function modules — but it lives **inside** the FUGR directory,
  reflecting the LIMU-under-FUGR hierarchy. There is no top-level `func/` directory.
- **Source URL or fixture**: GitHub API listing of `file-formats/fugr` returns
  `func-v1.json` as a child file alongside `fugr-v1.json`.

## ADT slash subtypes

| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| `FUGR/FF` | Function module (the actual ADT slash code for a FM) | `/sap/bc/adt/functions/groups/<grp>/fmodules/<fm>` | a4h ✅ live probe |
| `FUNC/FM` | **Does not exist in ADT** | — | not returned by any a4h response; not in Eclipse apidoc |

Eclipse plugin reference (`com.sap.adt.core.apidoc-3.58.1`) — exhaustive grep for
`FUNC/FM`, `FUGR/FF`, `FUNC/`:
- **0** occurrences of `FUNC/FM`.
- 1 occurrence of `FUGR/FF` as a documented example string in
  `IAdtRepositorySearchParameters.html`.
- 0 occurrences of any `FUNC/*` slash form.

## SAP docs & notes

- abap-file-formats README treats function modules as components of FUGR file format, never
  as their own top-level object. Consistent with TADIR.
- `mcp__sap-docs__search` for "FUGR object type" / "function group ADT" / "TADIR FUNC" did
  not return any document calling out `FUNC/FM`. The class `CL_WB_OBJECT_TYPE` constants
  enumerate `FUGR/F`, `FUGR/FF`, `FUGR/PU`, `FUGR/I`, `FUGR/Y`, `FUGR/PD`, `FUGR/PE`,
  `FUGR/PF`; there is no `FUNC/*` constant.
- No SAP Note specifically references `FUNC/FM`.

## Other MCP servers / cross-reference

- **mcp-abap-abap-adt-api**: builds function-module URLs as
  `/sap/bc/adt/functions/groups/{group}/fmodules/{fm}` and never references a `FUNC/FM`
  slash code. Function modules are addressed by (group, name) tuple, not as a top-level
  object.
- **abapGit / abap-file-formats**: function modules serialize as XML fragments under their
  parent FUGR directory; there is no `FUNC` top-level kind.
- **docs/compare/00-feature-matrix.md**: should list "Function module" as a sub-object under
  FUGR rather than as its own row.

## Live verification

### a4h (S/4HANA 2023)

- Test object: `BAPI_USER_GETLIST` (group `SU_USER`)
  - `GET /sap/bc/adt/functions/groups/su_user/fmodules/bapi_user_getlist` → `200`,
    response root `<fmodule:abapFunctionModule … adtcore:type="FUGR/FF" …>`. The `type`
    attribute is `FUGR/FF`, not `FUNC/FM`.
- Repository search by `objectType=FUGR/FF&query=BAPI_USER_GET*` returned function modules
  with `adtcore:type="FUGR/FF"`.
- Repository search by `objectType=FUNC/FM` (not exercised, but inferable) — invalid slash
  code; ADT either ignores the filter or returns an error. There is no productive use.

### 7.50 (NW 7.50)

- Could not verify directly — no NW 7.50 credentials in `.env`. Inferred from the absence
  of `FUNC/FM` in any version of `CL_WB_OBJECT_TYPE` shipped with NW 7.5x and from the
  Eclipse plugin (which targets back to 7.5x SP00 via apidoc 3.58.1) having zero
  occurrences of the string.

## ARC-1 current surface

| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `src/handlers/schemas.ts` SAPREAD_TYPES_ONPREM | 21 | `FUNC` | legacy-tolerable — useful caller-facing alias for "function module" even though no R3TR exists |
| `src/handlers/schemas.ts` SAPREAD_TYPES_BTP | 58 | `FUNC` | legacy-tolerable |
| `src/handlers/schemas.ts` SAPWRITE_TYPES_ONPREM | 221 | `FUNC` | legacy-tolerable |
| `src/handlers/schemas.ts` SAPCONTEXT_TYPES_ONPREM | 569 | `'FUNC'` | legacy-tolerable |
| `src/handlers/tools.ts` type lists | 42, 80, 117 | `FUNC` | legacy-tolerable |
| `src/handlers/intent.ts` SLASH_TYPE_MAP | 2564 | `'FUNC/FM': 'FUNC'` | ❌ **invented** — ADT never emits `FUNC/FM`; remove |
| `src/handlers/intent.ts` `objectBasePath` | 2675-2676 | `case 'FUNC': return '/sap/bc/adt/functions/groups/'` | ❌ — this base prefix points at the **group** collection, not the FM. The bare prefix without `/fmodules/<fm>` will produce a wrong URL if used directly. The actual FUNC read path in `handleSAPRead` (line 1426-1443) bypasses `objectBasePath` and constructs the URL via `client.getFunction(group, name)`, so the broken `objectBasePath` entry is dead code for `FUNC` — but it is misleading and a future caller could reuse it. |
| `src/handlers/intent.ts` `handleSAPRead` `case 'FUNC'` | 1426-1443 | requires `group`, auto-resolves via cache, calls `client.getFunction(group, name)` | ✅ |
| `src/handlers/intent.ts` SAPContext `case 'FUNC'` | 5168-5184 | requires `group` | ✅ |
| `src/adt/client.ts` `revisionsUrlFor` `case 'FUNC'` | 458-464 | builds `/sap/bc/adt/functions/groups/<grp>/fmodules/<fm>/source/main/versions` | ✅ |
| `src/handlers/tools.ts` description | 815 | mentions `FUNC/FM` as an example of a slash-format objectType filter for where-used scope | ❌ — propagates the invented form to LLM-visible documentation |
| `src/handlers/intent.ts` LINTABLE_TYPES | 3704 | `FUNC` | ✅ (lints function-module source) |

## Verdict

- **Status**: bare short type `FUNC` = `legacy-tolerable` (it's an ARC-1 abstraction, not a
  TADIR truth, but it's useful and well-handled by the read/write/context handlers).
  Slash alias `FUNC/FM` = **wrong / invented**. `objectBasePath` for `FUNC` = wrong (dead
  code, but misleading).
- **Evidence**: `verified-on-live-system` (a4h returned `FUGR/FF`, never `FUNC/FM`) +
  `verified-from-source` (Eclipse apidoc has zero `FUNC/FM` occurrences;
  abap-file-formats places `func-v1.json` under `fugr/`, confirming LIMU-under-FUGR
  structure).
- **Issue**: ARC-1 invented `FUNC/FM` as a slash form. This propagates to:
  1. `SLASH_TYPE_MAP` accepting input that ADT never emits.
  2. `tools.ts:815` teaching LLMs to filter where-used scope by `FUNC/FM`, which the
     scope endpoint will reject or silently ignore.
  3. The documented set of "real ADT slash codes" being polluted with a fictional one.

## Recommendation

- **Change 1**: in `src/handlers/intent.ts` `SLASH_TYPE_MAP` (line 2564), **remove**
  `'FUNC/FM': 'FUNC'`. Replace with `'FUGR/FF': 'FUNC'` (this also fixes the wrong
  `'FUGR/FF': 'FUGR'` mapping at line 2566 — see `fugr.md`).
- **Change 2**: in `src/handlers/intent.ts` `objectBasePath` (lines 2675-2676), either
  remove the `case 'FUNC'` branch (its callers already use `client.getFunction(group,
  name)` directly) or document inline that this returns the group collection prefix and
  is **not** sufficient to address an FM (must append `<group>/fmodules/<name>`).
- **Change 3**: in `src/handlers/tools.ts:815`, replace the example `FUNC/FM` with
  `FUGR/FF` in the where-used scope filter description.
- **Keep**: the bare short type `FUNC` in schema enums and tool lists. It is a useful
  caller-facing alias that ARC-1 internally translates to the (group, name) URL. Removing
  it would be a real breaking change with no upside; users will continue to think of
  function modules as a distinct kind even though TADIR disagrees.
- **Breaking change**: yes for `FUNC/FM` slash callers, but there are likely none — ADT
  never emits this code, so the only callers are users who copied it from ARC-1's own
  (incorrect) prior docs. Low blast radius.
- **Test gap to close**:
  - Unit test `tests/unit/handlers/intent.normalize-types.test.ts`: assert
    `normalizeType('FUNC/FM')` is **rejected** (or aliased and emits a deprecation
    warning) and `normalizeType('FUGR/FF')` returns `'FUNC'`.
  - Integration test `tests/integration/adt.integration.test.ts`: feed an ADT search
    response into `SAPRead` and assert that `adtcore:type="FUGR/FF"` round-trips to a
    successful FM read (proves real ADT slash codes work end-to-end).
  - E2E `tests/e2e/where-used.e2e.test.ts` (if exists, else add): assert scope-filter by
    `FUGR/FF` returns FM-only references, and that scope-filter by `FUNC/FM` raises a
    clear error rather than silently filtering nothing.
