# INCL — ABAP Include

## TL;DR
`INCL` is **ARC-1's canonical short form** for ABAP includes — but it is NOT a TADIR R3TR type. In SAP, includes are TADIR `R3TR PROG` rows with attribute `SUBC=I`, and ADT exposes them with the slash subtype **`PROG/I`** (under URL `/sap/bc/adt/programs/includes/`). ARC-1 correctly aliases `PROG/I → INCL` in `SLASH_TYPE_MAP` and uses the right URL. The made-up name `INCL` is harmless internal shorthand.

## TADIR ground truth
- **R3TR type**: does not exist as `R3TR INCL`. Includes live in TADIR as `R3TR PROG` with `TRDIR-SUBC = 'I'`.
- **LIMU sub-objects**: `REPS` (the include's source).
- **abap-file-formats support**: ❌ — no `incl/` directory in [SAP/abap-file-formats](https://github.com/SAP/abap-file-formats/tree/main/file-formats). Includes are not a separate cloud-released type; they are an attribute of `prog`.

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| `PROG/I` | Include (also covers FUGR-generated `L*` includes) | `/sap/bc/adt/programs/includes/<NAME>` | a4h ✅ |
| `INCL/I` | **Does not exist** as ADT objectType | n/a | a4h ❌ — search with this filter returns empty |

Live evidence: `GET /repository/informationsystem/search?objectType=INCL/I` → empty result set; `objectType=PROG/I` → returns includes correctly. ADT never emits a slash code starting with `INCL/`.

## SAP docs & notes
- ADT plugin `com.sap.adt.programs_3.56.1` exposes both `programs/programs` and `programs/includes` collections.
- abapGit serializes includes inside the parent program / FUGR.

## Other MCP servers / cross-reference
- mcp-abap-abap-adt-api: uses `PROG/I` directly; doesn't introduce a separate `INCL` short form.
- Eclipse `WBObjectType`: registers includes under `PROG/I`.

## Live verification
### a4h (S/4HANA 2023)
- `GET /repository/informationsystem/search?query=*&objectType=PROG/I` → 200 with `adtcore:type="PROG/I"`.
- `GET /sap/bc/adt/programs/includes/<NAME>/source/main` → 200.

### 7.50 (NW 7.50)
- Not verified live; endpoint stable since 7.0.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `src/handlers/intent.ts` `SLASH_TYPE_MAP` | 2560 | `PROG/I → INCL` | ✅ |
| `src/handlers/intent.ts` `objectBasePath` | 2677 | `INCL → /sap/bc/adt/programs/includes/` | ✅ |
| `src/handlers/schemas.ts` enums | 23, 222 | `INCL` | ✅ (canonical short ARC-1 made up — fine, internal-only) |
| `src/probe/catalog.ts` | — | `INCL` collection `/programs/includes` | ✅ |

## Verdict
- **Status**: legacy-tolerable. `INCL` is ARC-1-internal pseudo-canonical; it is not a TADIR or AFF type but does map cleanly onto a real ADT subtype (`PROG/I`).
- **Evidence**: verified-on-live-system
- **Issue**: only the conceptual one that `INCL` invites callers to ask for an `R3TR INCL` that doesn't exist. Low risk.

## Recommendation
- Keep `INCL` as the canonical short form (changing now is breaking and adds no value — ADT itself splits `programs/programs` from `programs/includes` so a separate ARC-1 short form is justified).
- **Do not** add an `INCL/I` alias — it would teach LLM clients a fake slash code.
- Document in the tool description for `SAPRead`/`SAPWrite` that `INCL` is shorthand for `PROG/I`.
- **Breaking change**: none.
- **Test gap to close**: assert `normalizeObjectType('PROG/I') === 'INCL'` and that `objectBasePath('INCL') === '/sap/bc/adt/programs/includes/'`.


## Relation Explorer identity evidence — SAP_BASIS 758 (2026-09-10)

This dated section concerns read-only relationship roots, not new SAPRead operations, writes, or a global slash alias. The metadata root and `adtcore:type` attribute below were retained from an actual metadata **GET**, not a create template. Namespace prefixes are preserved. Authors, descriptions and unrelated fields were removed; identity values were not invented or rewritten.

### PROG/I

- Observed object: `ZABAPGIT_FORMS`; GET `/sap/bc/adt/programs/includes/zabapgit_forms`.
- Recorded: 2026-09-09T22:07:49.315Z; metadata QName: `include:abapInclude`.
- [Sanitized wire fixture](../../../../tests/fixtures/relations/prog-i.json) also preserves one observed ENV edge and original-body SHA-256 values. It is a projection, not a complete network.

```xml
<include:abapInclude adtcore:name="ZABAPGIT_FORMS" adtcore:type="PROG/I" adtcore:version="active" xmlns:include="http://www.sap.com/adt/programs/includes" xmlns:abapsource="http://www.sap.com/adt/abapsource" xmlns:adtcore="http://www.sap.com/adt/core">
<adtcore:packageRef adtcore:uri="/sap/bc/adt/packages/%24abapgit" adtcore:type="DEVC/K" adtcore:name="$ABAPGIT"/>
</include:abapInclude>
```

Qualification and limitations: [per-type research](../../2026-09-10-live-relations-types.md). CI binds every qualified native identity to this document and replays the independent recorded fixtures. This proves the observed 758 shapes, not support on other releases or relationship completeness.
