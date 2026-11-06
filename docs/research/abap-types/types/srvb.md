# SRVB — Service Binding

## TL;DR
Canonical TADIR R3TR `SRVB` (RAP service binding — binds an SRVD to a protocol/version like
OData V4 UI/Web-API). Spelling, alias `SRVB/SVB`, and URL prefix
`/sap/bc/adt/businessservices/bindings/` are correct. Note: SRVB's URL deliberately differs
from sibling RAP types — it lives under `/businessservices/`, NOT `/ddic/srvb/`. The probe
catalog explicitly calls this out.

## TADIR ground truth
- **R3TR type**: `SRVB`.
- **LIMU sub-objects**: none (binding has versions, but they're attributes of the SRVB, not
  separate LIMU rows).
- **abap-file-formats support**: ✅ released — `file-formats/srvb/`.

## ADT slash subtypes
| Slash code | Meaning | URL prefix | Verified on |
|---|---|---|---|
| `SRVB/SVB` | Service Binding | `/sap/bc/adt/businessservices/bindings/<name>` | Eclipse plugin grep, probe catalog note |

## SAP docs & notes
- "ABAP RAP — Service Binding" (SAP Help).

## Other MCP servers / cross-reference
- abap-file-formats: serializes binding incl. version/protocol info.
- mcp-abap-abap-adt-api: `SRVB`.

## Live verification
### a4h (S/4HANA 2023)
- E2E RAP test creates SRVB, activates, publishes, deletes — passes on a4h.

### 7.50 (NW 7.50)
- Not available — `minRelease: 754`.

## ARC-1 current surface
| Location | Line(s) | Form used | Correct? |
|---|---|---|---|
| `SLASH_TYPE_MAP` | 2571 | `SRVB/SVB → SRVB` | ✅ |
| `objectBasePath` | 2691–2692 | `/sap/bc/adt/businessservices/bindings/` | ✅ |
| `handleSAPRead` | 1526 | `case 'SRVB'` | ✅ |
| `src/probe/catalog.ts` | 161–167 + note | `SRVB` | ✅ — explicitly notes URL diverges from `/ddic/srvb` |
| Publish action wiring (`/sap/bc/adt/businessservices/odatav2/publishjobs`) | various | special-case in `devtools.ts` | ✅ |
| Service information (`/sap/bc/adt/businessservices/{odatav2,odatav4}/{name}`) | all | `src/adt/service-info.ts` | ✅ |

### Service information contract (SAP_BASIS 758, 2026-11-06)
- `GET …/{odatav2,odatav4}/{binding}?servicename=&serviceversion=&srvdname=`; without `servicename` SAP answers HTTP 400.
- V2 returns `odatav2:serviceList` (`published` per service). V4 returns `odatav4:serviceGroup` (`published` on the group).
- Both nest `serviceInfo:serviceInformation` → `collection` (`name`, `isRoot`) → `navigation` (`name`, `target`).
- `serviceUrl` is relative to the SAP host. An unpublished binding answers 200 with an empty `serviceUrl` and no collections.
- A survey of 200 `Z*` bindings found only OData V2/V4 with one service and one version each; several versions and non-OData bindings were not observed live.

## Verdict
- **Status**: correct
- **Evidence**: verified-from-source + verified-on-live-system
- **Issue**: none

## Recommendation
- Keep as-is. The non-`/ddic/` URL prefix is legitimate — it matches what ADT serves.
- **Breaking change**: no
- **Test gap to close**: none.
