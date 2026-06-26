# COMPONENTS — Pseudo: installed software components

## TL;DR
`COMPONENTS` is a **pseudo type**. Calls `GET /sap/bc/adt/system/components` (atom feed)
and returns a list of `{ name, release, description }`. Not a TADIR or ADT object type.

## TADIR ground truth
- **R3TR type**: does not exist
- **LIMU sub-objects**: N/A
- **abap-file-formats support**: ❌
- **Source URL or fixture**: `src/adt/client.ts:625-635`, `src/handlers/intent.ts:1714-1717`.

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| (none) | installed components feed | `/sap/bc/adt/system/components` | a4h ✅, 7.50 ✅ |

Endpoint accepts `application/atom+xml;type=feed`; on backends that 406 the request
ARC-1 silently returns an empty array (`src/adt/client.ts:631-633`).

## SAP docs & notes
- Equivalent to `SAP_BASIS` / component overview shown in tx `SAINT`/`SPAM`. No specific
  ADT doc; the URL is part of the ADT system service.

## Other MCP servers / cross-reference
- No competing MCP server exposes this with the literal name `COMPONENTS`.

## Live verification
### a4h (S/4HANA 2023)
- ADT response: 200 atom feed with one `<entry>` per installed component
  (`SAP_BASIS`, `SAP_ABA`, `S4CORE`, ...).

### 7.50 (NW 7.50)
- ADT response: 200 atom feed with `SAP_BASIS 7.50`, etc.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `src/handlers/schemas.ts` | 40, 73 (Read onprem + BTP) | `COMPONENTS` | ✅ pseudo |
| `src/handlers/intent.ts` SLASH_TYPE_MAP | — | no entry | ✅ |
| `src/handlers/intent.ts` Read switch | 1714-1717 | JSON.stringify of getInstalledComponents | ✅ |
| `src/adt/client.ts` getInstalledComponents | 625-635 | GET with atom Accept; 406 → [] | ✅ |

## Verdict
- **Status**: pseudo (legitimate)
- **Evidence**: verified-from-source
- **Issue**: none

## Recommendation
- **Keep.** Group with other pseudo cross-cutting reads in tool description.
- **Breaking change**: no.
- **Test gap to close**: parser unit test against an atom-feed fixture (probably already
  exists in `tests/unit/adt/xml-parser.test.ts` — verify).
