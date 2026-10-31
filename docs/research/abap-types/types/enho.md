# ENHO — Enhancement Implementation

Use `SAPRead(type="ENHO", name="...")` on on-prem and BTP systems. The R3TR type covers
BAdIs, source-code plug-ins and other enhancement technologies; it does not identify
one ADT resource. There is no public slash alias. Only BAdI implementations (`ENHO/XHB`)
are writable: `SAPWrite type="ENHO"` takes SAPRead's JSON (see
[the write contract](../../2026-10-07-enho-xhb-write-contract.md)).

## Source-code plug-ins on SAP_BASIS 750 (2026-10-28)

Observed read-only on a customer ECC 6.0 EhP8 system (SAP_BASIS 750 SP23, Oracle) through
ARC-1 1.9.0 with principal propagation, for a customer hook implementation (`ENHHEADER`
tool type `HOOK_IMPL`):

| Request | Result |
|---|---|
| Repository search, `objectType=ENHO` | every implementation is `ENHO/XH` with `/sap/bc/adt/enhancements/enhoxh/<name>`; the subtype is not visible |
| `GET /enhancements/enhoxhb/<name>` | fails (not a BAdI implementation) |
| `GET /enhancements/enhoxh/<name>` | HTTP 500 inside SAP |
| `GET /programs/includes/<name>=…=E/source/main` | HTTP 500 |
| `GET /programs/includes/<name>=…=E/source/main/versions` | Atom feed; the active version is revision `00000` with author, timestamp and transport |
| `GET …/versions/<timestamp>/00000/content` | the complete `ENHANCEMENT 1 … ENDENHANCEMENT` block |

The include name is the implementation name padded with `=` to 30 characters plus `E`
(`ENHNAME` is CHAR 30); `D010INC` lists that include under the enhanced program, and
`ENHOBJ` names the enhanced program (`PROG`/`REPS`). The same system holds 118 hook
implementations, 76 BAdI implementations and 4 class enhancements in the customer
namespace. ARC-1 therefore reads the active revision of the enhancement include after the
generic route fails (see "Routing and payload").

Verified with that fallback on the matching development system (same release) through
the MCP transport with principal propagation: customer hook implementations with one and
several `ENHANCEMENT` blocks, an SAP-delivered namespaced implementation
(`/NS/NAME====E`, author `SAP`), a revision with transport and title, `SAPRead INCL` with
and without `grep`, a BAdI implementation still served by `enhoxh` with its unchanged
payload, an unknown name (404 after `enhoxhb`, no fallback), and `version="inactive"`
(no fallback). A class enhancement (`CLASENH`) is served by the same include route; its
source holds the generated local interfaces and an `INCLUDE <name>=…=EIMP`, which is why the
fallback leaves `technology` empty instead of guessing.

Observed on SAP_BASIS 758 SP04 (BW/4HANA development system, same build, principal
propagation): hook implementations keep their `enhoxhh` metadata, hook positions and source
(payload unchanged before and after); BAdI implementations keep the `enhoxhb` payload; class
enhancements, which fail at `enhoxh` with HTTP 500 on 758 as well, are now served through the
include route (`ENHANCEMENT` blocks with the generated local interface and
`INCLUDE <name>=…=EIMP` / `…EM001` references); `SAPRead INCL` on an enhancement include fails
directly with HTTP 500 on 758 too and is served from the revision feed. Not verified: reading
the `EIMP`/`EM001` includes, inactive versions through the feed, and 816.

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

When the generic XH read has a qualified source-unavailable failure, ARC-1 reads the enhancement include's
revision feed and returns the active revision's content as `source` with
`enhancementInclude` and a `note`; a feed that is missing, empty or invalid keeps the
original SAP error, which then lists the include route among the attempted routes.
Content reads denied by SAP propagate unchanged.

The current guard accepts 404, typed `ExceptionResourceReadFailure` 500s, and only the observed
750 unsupported-technology / 758 null-reference 500 bodies when the matching release is probed.
Arbitrary 400/500, authentication, throttling and network failures never authorize revision fallback.
Unqualified generated references such as EIMP are counted as missing sources, without fetching them.

XHH returns `source`, `enhancedObject` and `hookImplementations` in addition to the
common metadata. Hook entries retain IDs, spots, programs, methods, overwrite
flags, full enhancement locations and enclosure links. Links are navigation data,
not authorization to fetch another object. Source bytes are not XML-decoded.
Legacy BAdI `isActive` / `isDefault` attributes map to the same boolean fields as
modern `active` / `default` attributes. See the reduced [hook fixture](../../../../tests/fixtures/xml/enhancement-hook.xml).

ENHO uses SAP's unversioned developer view. Explicit `active`/`inactive` requests
are refused rather than silently ignored; omit `version` or use `auto`. No atomic
metadata/source snapshot or inactive-draft contract is claimed. There is no ENHO
source cache, grep or method extraction; writes cover XHB only.

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
about all read endpoints. Authoring beyond BAdI implementations remains [FEAT-03](../../../../docs_page/roadmap.md#feat-03).

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
