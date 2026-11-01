# DOMA — DDIC Domain

## TL;DR
`DOMA` is a real TADIR R3TR type. ADT slash subtype is `DOMA/DD`. URL `/sap/bc/adt/ddic/domains/`. ARC-1's mapping is correct.

## TADIR ground truth
- **R3TR type**: `DOMA`
- **LIMU sub-objects**: `DOMD` (domain definition).
- **abap-file-formats support**: ✅ [`file-formats/doma`](https://github.com/SAP/abap-file-formats/tree/main/file-formats/doma).

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| `DOMA/DD` | Domain | `/sap/bc/adt/ddic/domains/<NAME>` | a4h ✅ |

Live evidence: search with `objectType=DOMA` and `objectType=DOMA/DD` both return `adtcore:type="DOMA/DD"` references with URLs `/sap/bc/adt/ddic/domains/...`.

## SAP docs & notes
- ADT plugin: `/sap/bc/adt/ddic/domains` is the canonical resource.
- AFF schema documents the released cloud form.

## Other MCP servers / cross-reference
- mcp-abap-abap-adt-api: `DOMA/DD`.

## Live verification
### a4h (S/4HANA 2023)
- `GET /repository/informationsystem/search?query=*&objectType=DOMA/DD` → 200, `DOMA/DD` references.
- `GET /sap/bc/adt/ddic/domains/MANDT` → 200.

### 7.50 (NW 7.50)
- Not verified live; same since 7.40.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `src/handlers/intent.ts` `SLASH_TYPE_MAP` | 2584 | `DOMA/DD → DOMA` | ✅ |
| `src/handlers/intent.ts` `objectBasePath` | 2698-2699 | `/sap/bc/adt/ddic/domains/` | ✅ |
| `src/handlers/schemas.ts` enums | 33, 68, 231, 246 | `DOMA` | ✅ |
| `src/probe/catalog.ts` | — | `DOMA` collection `/ddic/domains` | ✅ |
| `src/adt/ddic-xml.ts` | — | DOMA create/update XML builder | ✅ |

## Verdict
- **Status**: correct
- **Evidence**: verified-on-live-system
- **Issue**: none

## Recommendation
- Keep as-is.
- **Breaking change**: none.
- **Test gap to close**: assert `normalizeObjectType('DOMA/DD') === 'DOMA'`.


## Relation Explorer identity evidence — SAP_BASIS 758 (2026-09-10)

This dated section concerns read-only relationship roots, not new SAPRead operations, writes, or a global slash alias. The metadata root and `adtcore:type` attribute below were retained from an actual metadata **GET**, not a create template. Namespace prefixes are preserved. Authors, descriptions and unrelated fields were removed; identity values were not invented or rewritten.

### DOMA/DD

- Observed object: `ZPROD`; GET `/sap/bc/adt/ddic/domains/zprod`.
- Recorded: 2026-09-09T22:07:49.315Z; metadata QName: `doma:domain`.
- [Sanitized wire fixture](../../../../tests/fixtures/relations/doma-dd.json) also preserves one observed ENV edge and original-body SHA-256 values. It is a projection, not a complete network.

```xml
<doma:domain adtcore:name="ZPROD" adtcore:type="DOMA/DD" adtcore:version="active" xmlns:doma="http://www.sap.com/dictionary/domain" xmlns:adtcore="http://www.sap.com/adt/core">
<adtcore:packageRef adtcore:uri="/sap/bc/adt/packages/sdoc" adtcore:type="DEVC/K" adtcore:name="SDOC"/>
</doma:domain>
```

Qualification and limitations: [per-type research](../../2026-09-10-live-relations-types.md). CI binds every qualified native identity to this document and replays the independent recorded fixtures. This proves the observed 758 shapes, not support on other releases or relationship completeness.
