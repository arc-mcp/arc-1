# CLAS — ABAP Class

## TL;DR
`CLAS` is a real TADIR R3TR type and the canonical short form. ADT's slash subtype is `CLAS/OC` (Object Class — global class). ARC-1 maps `CLAS/OC → CLAS` correctly. **Bug:** ARC-1 also has `CLAS/LI → CLAS` in `SLASH_TYPE_MAP`, but the real ADT subtype for class sub-includes (definitions/implementations/macros/testclasses) is **`CLAS/I`**, not `CLAS/LI`. `CLAS/LI` is invented.

## TADIR ground truth
- **R3TR type**: `CLAS`
- **LIMU sub-objects**: `CINC` (test classes), `CPUB`/`CPRO`/`CPRI` (public/protected/private sections), `METH` (method).
- **abap-file-formats support**: ✅ released. [`file-formats/clas`](https://github.com/SAP/abap-file-formats/tree/main/file-formats/clas).

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| `CLAS/OC` | Object Class (global class) | `/sap/bc/adt/oo/classes/<NAME>` | a4h ✅ |
| `CLAS/I` | Class sub-include (definitions / implementations / macros / testclasses) | `/sap/bc/adt/oo/classes/<NAME>/includes/<which>` | a4h ✅ — returned by class-root XML for child includes |
| `CLAS/LI` | **Does not exist** | n/a | a4h ❌ — `objectType=CLAS/LI` search returns the same as unfiltered (filter ignored); no object ever carries this type |

Live evidence:
- `GET /sap/bc/adt/oo/classes/CL_ABAP_TYPEDESCR` → root `adtcore:type="CLAS/OC"`; child `<class:include>` elements report `adtcore:type="CLAS/I"`.
- `GET /repository/informationsystem/search?objectType=CLAS/I` returns empty (sub-includes aren't independently indexed as searchable objects).
- `GET /repository/informationsystem/search?objectType=CLAS/LI` returns **non-empty results** but all have `adtcore:type="CLAS/OC"` — i.e., the unknown filter is silently dropped.

## SAP docs & notes
- ADT plugin `com.sap.adt.oo_3.56.1` registers `/sap/bc/adt/oo/classes`.
- abap-file-formats `clas` schema covers the released cloud form.

## Other MCP servers / cross-reference
- mcp-abap-abap-adt-api: uses `CLAS/OC` for the class object; does not define `CLAS/LI`.
- Eclipse ADT internal `WBObjectType` uses `CLAS/I` (with a single `I`) for the synthetic include children of a class. There is no `CLAS/LI` constant in the public API doc dump (`com.sap.adt.core.apidoc-3.58.1`).

## Live verification
### a4h (S/4HANA 2023)
- Object: `CL_ABAP_TYPEDESCR` — root returns `CLAS/OC`, includes report `CLAS/I`.
- `GET /sap/bc/adt/oo/classes/ZCL_ARC1_TEST_UT/includes/testclasses` → 200 (sub-include endpoint is alive but addressed by URL, not by an `objectType` parameter).

### 7.50 (NW 7.50)
- Not verified live; same scheme since 7.40 per Eclipse plugin history.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `src/handlers/intent.ts` `SLASH_TYPE_MAP` | 2561 | `CLAS/OC → CLAS` | ✅ |
| `src/handlers/intent.ts` `SLASH_TYPE_MAP` | 2562 | `CLAS/LI → CLAS` | ❌ invented |
| `src/handlers/intent.ts` `objectBasePath` | 2671 | `/sap/bc/adt/oo/classes/` | ✅ |
| `src/handlers/intent.ts` `classIncludeUrl` | ~2747 | `/sap/bc/adt/oo/classes/<n>/includes/<which>` | ✅ |
| `src/handlers/schemas.ts` enums | 19, 56, 219, 236 | `CLAS` | ✅ |
| `src/probe/catalog.ts` | — | `CLAS`, known `CL_ABAP_TYPEDESCR` | ✅ |

## Verdict
- **Status**: invented alias (`CLAS/LI`); canonical otherwise correct
- **Evidence**: verified-on-live-system
- **Issue**: `CLAS/LI` in `SLASH_TYPE_MAP` is not a real ADT subtype. Real subtype is `CLAS/I` (single `L`-less letter — though see below). Likely origin: someone wrote `LI` thinking "Local Implementation".

## Recommendation
- **Replace** `'CLAS/LI': 'CLAS'` with `'CLAS/I': 'CLAS'` in `SLASH_TYPE_MAP`. Even though `CLAS/I` is never returned by the search API as an independent object, it *is* what `<class:include>` carries in the class XML, so any code path that reads an include's `adtcore:type` and re-feeds it through `normalizeObjectType` will see `CLAS/I` and currently fall through to the un-aliased path.
- Keep `CLAS/LI` for one release as a deprecated alias mapping to `CLAS` (cheap legacy tolerance) but document it as accepted-not-real.
- **Breaking change**: minimal. Only affects users who learned `CLAS/LI` from ARC-1 docs.
- **Test gap to close**: add `tests/unit/handlers/intent.normalize-types.test.ts` asserting `normalizeObjectType('CLAS/I') === 'CLAS'` and that ADT's class-root XML can round-trip its include `adtcore:type` through `normalizeObjectType`.
