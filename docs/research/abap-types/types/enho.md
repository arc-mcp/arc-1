# ENHO — Enhancement Implementation

Use `SAPRead(type="ENHO", name="...")` on on-prem systems. The R3TR type covers
BAdIs, source-code plug-ins and other enhancement technologies; it does not identify
one ADT resource. There is no public slash alias or enhancement write operation.

## Verified read routes (2026-10-01, issue #896)

| Repository subtype | Collection / Accept | Observed behavior |
|---|---|---|
| `ENHO/XHB` | `enhoxhb` / `application/vnd.sap.adt.enh.enhoxhb.v4+xml` | BAdI metadata on SAP_BASIS 758 SP02 and 816 SP01; root `enho:objectData`. |
| `ENHO/XHH` | `enhoxhh` / `application/vnd.sap.adt.enh.enhoxhh.v3+xml` | Hook metadata on 758/816; root `enho:enhancement`. ABAP is at the same object's `/source/main` (`text/plain`). |
| `ENHO/XH` | `enhoxh` / `application/vnd.sap.adt.enh.enho.v1+xml` | Legacy/generic route, not proof of a specific enhancement technology. On 750 it serves BAdI `objectData`; `WDR_TEST_ENH_08_01` on 758/816 fails inside SAP even at this route. |

All paths are under `/sap/bc/adt/enhancements/`, followed by the encoded object
name. Discovery advertised all three collections on 758/816 and only `enhoxh`
on 750. Collection presence alone does not prove every object can be read.

### Routing and payload

The original BAdI GET remains first, preserving its one-request success path and
JSON shape. Only HTTP 400/404/500 triggers one bounded repository search. ARC-1
requires a unique recognized subtype for the exact name. SAP 750 decorates search
names with a display label, so an exact relative URI matching the constructed,
known object path also qualifies. ARC-1 never follows a returned URI, probes all
collections, or retries with another identity. Unknown or ambiguous results keep
the original failure; denied searches and source errors propagate.

XHH returns `source`, `enhancedObject` and `hookImplementations` in addition to the
common metadata. Hook entries retain IDs, spots, programs, methods, overwrite
flags, full enhancement locations and enclosure links. Links are navigation data,
not authorization to fetch another object. Source bytes are not XML-decoded.
Legacy BAdI `isActive` / `isDefault` attributes map to the same boolean fields as
modern `active` / `default` attributes. See the reduced [hook fixture](../../../../tests/fixtures/xml/enhancement-hook.xml).

ENHO uses SAP's unversioned developer view. Explicit `active`/`inactive` requests
are refused rather than silently ignored; omit `version` or use `auto`. No atomic
metadata/source snapshot or inactive-draft contract is claimed. There is no ENHO
source cache, grep, method extraction or write support.

### Live observations and limits

Tests used ARC-1's production `handleToolCall` over direct HTTPS/Basic, client 001,
with no SAP mutations. Build hashes and raw comparisons are retained with the PR's
local evidence; mocks are separate from these observations.

- 758/816: `/AIF/ANS_RESTART_EI` kept the existing BAdI payload with one GET.
- 758/816: `/MFND/CORE_UPD_BDS_CONNECTION` and `/SMFND/DEMO_DEL_BOOKING` exposed
  hook locations and source equal to a direct `/source/main` read. The old BAdI
  route failed with 400/500. Each corrected read made four GETs.
- 750: `/BOBF/CONF_ADT_CHECKABLE` exposed a BAdI through the generic XH route;
  its search name included ` (Enhancement Implementation)` and its flags used
  `isActive` / `isDefault`.
- 758/816: `WDR_TEST_ENH_08_01` still returned SAP 500 at `enhoxh`. ARC-1 keeps
  that status and points to SAP GUI (SE80/SE19) or Eclipse's SAP GUI integration.
  Its underlying enhancement technology was not captured. Issue #896 reports
  class enhancements; this object's generic XH subtype does not prove that case.
- Not verified: the reporter's exact objects, inactive drafts, PP, MCP transport,
  BTP, or working class-enhancement metadata. A route correction cannot repair a
  backend transformation error.

[SAP's source-code plug-in documentation](https://help.sap.com/docs/ABAP_PLATFORM_NEW/c238d694b825421f940829321ffa326a/4ec1abd36e391014adc9fffe4e204223.html)
describes ADT editing from 7.53 and creation from 7.54, and excludes class/function
group enhancements from that support. These are authoring limits, not a promise
about all read endpoints. Enhancement authoring remains [FEAT-03](../../../../docs_page/roadmap.md#feat-03).

## Relation Explorer identity evidence — SAP_BASIS 758 (2026-09-10)

This dated section concerns read-only relationship roots, not new SAPRead operations, writes, or a global slash alias. The metadata root and `adtcore:type` attribute below were retained from an actual metadata **GET**, not a create template. Namespace prefixes are preserved. Authors, descriptions and unrelated fields were removed; identity values were not invented or rewritten.

### ENHO/XHB

- Observed object: `ZABAPGIT_REPOS`; GET `/sap/bc/adt/enhancements/enhoxhb/zabapgit_repos`.
- Recorded: 2026-09-09T22:07:49.315Z; metadata QName: `enho:objectData`.
- [Sanitized wire fixture](../../../../tests/fixtures/relations/enho-xhb.json) also preserves one observed ENV edge and original-body SHA-256 values. It is a projection, not a complete network.

```xml
<enho:objectData adtcore:name="ZABAPGIT_REPOS" adtcore:type="ENHO/XHB" adtcore:version="active" xmlns:enho="http://www.sap.com/adt/enhancements/enho" xmlns:adtcore="http://www.sap.com/adt/core">
<adtcore:packageRef adtcore:uri="/sap/bc/adt/packages/%24test_abapgit" adtcore:type="DEVC/K" adtcore:name="$TEST_ABAPGIT"/>
</enho:objectData>
```

Qualification and limitations: [per-type research](../../2026-09-10-live-relations-types.md). CI binds every qualified native identity to this document and replays the independent recorded fixtures. This proves the observed 758 shapes, not support on other releases or relationship completeness.
