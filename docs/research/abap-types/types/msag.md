# MSAG — Message Class

## TL;DR
`MSAG` is a real TADIR R3TR type. ADT slash subtype is `MSAG/N`. URL `/sap/bc/adt/messageclass/`. ARC-1's mapping is correct. ARC-1 only exposes `MSAG` for **Write** (not Read in `SAPREAD_TYPES_*`) — that's a coverage gap, not a typing bug.

## TADIR ground truth
- **R3TR type**: `MSAG`
- **LIMU sub-objects**: `MESS` (individual message in a class).
- **abap-file-formats support**: ✅ [`file-formats/msag`](https://github.com/SAP/abap-file-formats/tree/main/file-formats/msag).

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| `MSAG/N` | Message class | `/sap/bc/adt/messageclass/<NAME>` | a4h ✅ |

Live evidence: `objectType=MSAG` and `objectType=MSAG/N` both return `adtcore:type="MSAG/N"` with URLs `/sap/bc/adt/messageclass/...`.

## SAP docs & notes
- ADT plugin `com.sap.adt.messageclass_3.56.1` registers `/sap/bc/adt/messageclass`.
- AFF `msag` schema documents the cloud-released form.

## Other MCP servers / cross-reference
- mcp-abap-abap-adt-api: `MSAG/N`.

## Live verification
### a4h (S/4HANA 2023)
- `GET /repository/informationsystem/search?query=*&objectType=MSAG/N` → 200, `MSAG/N` references.
- `GET /sap/bc/adt/messageclass/SY` → 200.

### 7.50 (NW 7.50)
- Not verified live; same scheme.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `src/handlers/intent.ts` `SLASH_TYPE_MAP` | 2586 | `MSAG/N → MSAG` | ✅ |
| `src/handlers/intent.ts` `objectBasePath` | 2702-2703 | `/sap/bc/adt/messageclass/` | ✅ |
| `src/handlers/schemas.ts` SAPREAD enums | (absent) | n/a | ⚠ MSAG is in WRITE enums (233, 248) but **not** in READ enums (~lines 18-34, 218-234). Coverage gap. |
| `src/handlers/schemas.ts` SAPWRITE enums | 233, 248 | `MSAG` | ✅ |
| `src/probe/catalog.ts` | — | `MSAG` collection `/messageclass`, knownObjects `00`,`SY` | ✅ |
| `src/adt/ddic-xml.ts` | — | MSAG XML builder | ✅ |

## Verdict
- **Status**: correct (typing); **incomplete** (SAPRead doesn't list MSAG even though the read URL works).
- **Evidence**: verified-on-live-system
- **Issue**: typing bug none. Surface coverage gap: callers can't `SAPRead --type MSAG --name SY` because `MSAG` isn't in `SAPREAD_TYPES_*`.

## Recommendation
- Keep slash alias and URL as-is.
- **Add `MSAG`** to `SAPREAD_TYPES_ONPREM` and `SAPREAD_TYPES_BTP` in `src/handlers/schemas.ts` (and to the read switch in `handleSAPRead` in `intent.ts` if not already wired). Reading message classes is non-mutating and useful for translation/lookup workflows.
- **Breaking change**: no — additive.
- **Test gap to close**:
  - Unit: `normalizeObjectType('MSAG/N') === 'MSAG'`.
  - Integration: read `SY` and assert message-class XML root.
