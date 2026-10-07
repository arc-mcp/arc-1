# ENHO/XHB (BAdI implementation) write contract

Status: **implemented; live-verified in `$TMP` on SAP_BASIS 816 on-prem (2026-10-07). Create in a transportable
package FAILED on the same system (see below) — do not ship as supported until that is understood.** The payload is
derived from SAP's own GET serialization, not from a captured Eclipse create.

## Why

In a project on S/4HANA (SAP_BASIS 816, on-prem), ARC-1 created the package,
transport and the ABAP Cloud implementing class for the released BAdI `SD_APM_SET_APPROVAL_REASON`
(spot `ES_SD_SLS_EXTEND`). The enhancement implementation itself had to be created by hand in Eclipse ADT,
because ARC-1 could only read ENHO. The full plan is in `docs/plans/enho-badi-impl-write.md`.

## Contract as implemented

| Step | Request | Notes |
|---|---|---|
| Gate | ADT discovery advertises `/sap/bc/adt/enhancements/enhoxhb` | Advertised on 758/816 (S/4HANA 2023 and ABAP Platform 2025 trial probes); 750 only advertises `enhoxh`. An unprobed session is not blocked. |
| Create | `POST /sap/bc/adt/enhancements/enhoxhb?corrNr=…` with `application/vnd.sap.adt.enh.enhoxhb.v4+xml` | Full `enho:objectData` body. |
| Confirm implementations | GET the object; only if an implementation is missing: lock → `PUT …/{name}?lockHandle=…` → unlock | Same body. On 816 the POST already stores them, so no lock or PUT happens. Kept for releases where the POST might only create the container. |
| Update | lock → GET (developer view) → merge → PUT → unlock | `src/handlers/write/metadata-update.ts`. |
| Activate | `adtcore:uri="/sap/bc/adt/enhancements/enhoxhb/{name}"` | Before this change `objectBasePath('ENHO')` fell back to `/sap/bc/adt/programs/programs/`, so activation, transport history and the package gate hit the wrong object. |
| Delete | lock → DELETE → unlock | Generic path. |

Body (element order from `tests/fixtures/xml/enhancement-implementation.xml`):

```xml
<enho:objectData xmlns:enho="http://www.sap.com/adt/enhancements/enho" xmlns:adtcore="http://www.sap.com/adt/core"
    xmlns:enhcore="http://www.sap.com/abapsource/enhancementscore"
    adtcore:type="ENHO/XHB" adtcore:name="…" adtcore:description="…" adtcore:masterLanguage="EN" adtcore:responsible="…">
  <adtcore:packageRef adtcore:name="…"/>
  <enho:contentCommon enho:toolType="BADI_IMPL"><enho:usages><enhcore:referencedObject enhcore:program_id="R3TR" enhcore:element_usage="EXTO">
    <enhcore:objectReference adtcore:uri="/sap/bc/adt/enhancements/enhsxsb/{spot}" adtcore:type="ENHS/XSB" adtcore:name="{SPOT}"/>
    <enhcore:mainObjectReference …same…/>
  </enhcore:referencedObject></enho:usages></enho:contentCommon>
  <enho:contentSpecific><enho:badiTechnology><enho:badiImplementations>
    <enho:badiImplementation enho:name="…" enho:shortText="…" enho:example="false" enho:default="false" enho:active="true">
      <enho:enhancementSpot …spot reference…/>
      <enho:badiDefinition adtcore:uri="/sap/bc/adt/vit/wb/object_type/enhsxb/object_name/{SPOT}" adtcore:type="ENHS/XB" adtcore:name="{BADI}"/>
      <enho:implementingClass adtcore:uri="/sap/bc/adt/oo/classes/{class}" adtcore:type="CLAS/OC" adtcore:name="{CLASS}"/>
    </enho:badiImplementation>
  </enho:badiImplementations></enho:badiTechnology></enho:contentSpecific>
</enho:objectData>
```

The BAdI-definition URI uses the spot name as `object_name`; that matches SAP's GET serialization.

## Live results (SAP_BASIS 816, on-prem, `$TMP`, direct HTTPS/Basic, 2026-10-07)

All objects used the `ZARC1` test prefix and were deleted afterwards (GET 404 confirmed).

- **Lifecycle:** `tests/integration/enho.integration.test.ts` passed against the released BAdI
  `SD_APM_SET_APPROVAL_REASON` (spot `ES_SD_SLS_EXTEND`) with a temporary class implementing its interface:
  create → SAPRead returned the expected JSON → update (SAPRead output with `active` flipped) read back
  → SAPActivate → delete.
- **POST alone stores the implementations.** A raw collection POST with the full body, without the
  follow-up PUT, read back with the BAdI implementation in place. ARC-1 therefore reads back after the POST
  and PUTs only when an implementation is missing; on 816 no lock or PUT follows the create.
- **Activation needs the object name.** `batch_create` activated inline with only `adtcore:uri` in the
  reference; SAP answered HTTP 403 `Resource   could not be locked` (blank name) every time. With
  `adtcore:name` added, as `SAPActivate` and `activateAtEnd` already send it, activation succeeded.
  A batch PROG create with the same change still activated.
- **SAP fills attributes ARC-1 does not send.** After create, `contentCommon` carries `adjustmentStatus=""`,
  `upgradeFlag="false"`, `switchSupported="true"`, and each implementation carries `customizingLock=""` and
  `runtimeBehaviorShorttext`. The update round trip (which omits them) succeeded.
- **SAP checks consistency at activation, not on save.** A create with a class that does not implement
  the BAdI interface, and a create naming a BAdI that does not exist in the spot, were both saved (inactive).
  Activation of the first failed with `BAdI interface IF_BADI_INTERFACE is not implemented in class …` and the
  same for the BAdI interface. ARC-1 relays these messages, so pre-write checks would only move the error earlier.
- **Activation and transport routing:** `SAPActivate` and `SAPTransport history` resolved
  `/sap/bc/adt/enhancements/enhoxhb/{name}`, not the former program fallback.

### Update keeps what the JSON does not model (816, 2026-10-07)

SAP stores only what the PUT sends. A rebuilt document reset `customizingLock="X"` to `""` and `example="true"`
to `false`, and **deleted the implementation's filter tree**. `switchSupported`, `upgradeFlag` and
`adjustmentStatus` stayed unchanged (SAP derives them; a raw PUT of `switchSupported="false"` was ignored).
ARC-1 now reads these per implementation from the stored XML and re-sends them unchanged:
`example`, `customizingLock` and SAP's own `<enho:filterTree>` element. Verified live: both attributes and a
`COUNTRY = 'BE'` filter survived an ARC-1 update.

Filter trees look like this (816; SAP's newer `badiDefinition` URI is
`/sap/bc/adt/enhancements/enhsxsb/{spot}#type=enhs%2fxb;name={badi}`):

```xml
<enho:filterTree>
  <enho:filterToken xsi:type="enho:Or"><enho:filterToken xsi:type="enho:Filter" enho:filterName="LGNUM"
    enho:comparator="=" enho:value="1000" enho:filterProperty="#//badi/contentSpecific///{impl}/filterTree/filterProperty.LGNUM"/>…</enho:filterToken>
  <enho:filterProperty enho:filterName="LGNUM" enho:filterType="C"><enho:filterCheck xsi:type="enhcore:DictionaryCheck">
    <enhcore:checkObject adtcore:type="DTEL/DE" adtcore:name="LGNUM"/></enho:filterCheck></enho:filterProperty>
</enho:filterTree>
```

`SAPRead` shows the condition read-only as `"filter": "LGNUM = '1000' OR LGNUM = '2000'"` (synthetic fixture
`tests/fixtures/xml/enhancement-implementation-filter.xml`). SAPWrite refuses a changed or new `filter`, and a
changed BAdI definition on an implementation that has filters, instead of dropping them. Writing filters
needs the filter declaration (`filterProperty`, check object) from the BAdI definition, which ARC-1 cannot
read yet.

### Transportable package: create failed (816, 2026-10-07)

In a temporary transportable package with a transport request (target set, never released):

- The create POST returned **HTTP 500 `Screen output without connection to user`**: SAP tried to show a dialog.
- The POST still wrote a TADIR entry `R3TR ENHO` without enhancement content (no `ENHHEADER` row). ADT could
  not delete it afterwards: DELETE failed with `Could not determine recipients for message type CONDAT`,
  `Parameter corrNr could not be found` (no request) and `No documentation class is assigned to object R3TR ENHO`.
  The orphaned entry blocks deleting its package and needs SAP GUI (SE03 object directory) to remove.
- `$TMP` creates on the same system never showed this. Whether the dialog comes from the payload (something
  Eclipse sends and ARC-1 does not) or from that system's configuration (ALE message type `CONDAT`) is open.

### BTP ABAP environment (trial, 2026-10-07, read-only)

Discovery advertises `/sap/bc/adt/enhancements/enhoxhb` and `/enhsxsb`, and the system contains enhancement
spots, BAdI definitions and XHB implementations (SAP `/AIF/…` objects). Whether any BAdI is released for
customer implementations was not checked. SAPWrite stays `btp: false`.

## Open points

1. **Blocking:** capture Eclipse's create of a BAdI implementation in a transportable package (ABAP
   Communication Log) and compare with ARC-1's POST; find the dialog behind the HTTP 500.
2. Avoid or clean up the orphaned TADIR entry a failed create leaves behind.
3. Filter values: write support needs the BAdI definition's filter declaration.
4. BTP: find a released BAdI and test a create in a BTP package.

## Verification so far

(See the dated sections above for the live update, filter, transport and BTP results.)


- Unit: `tests/unit/adt/enhancement-impl.test.ts` (parse, merge, XML round trip through
  `parseEnhancementImplementation`, escaping, namespaced names) and `tests/unit/handlers/enho-write.test.ts`
  (create POST + PUT, partial-create guidance, validation before write, update merge, spot change refusal,
  delete, activation URI, discovery gate, package allowlist refusal for create/batch_create/update).
- Live: `tests/integration/enho.integration.test.ts` (create → read back → update → activate → delete in `$TMP`),
  driven by `TEST_ENHO_SPOT`, `TEST_ENHO_BADI` and `TEST_ENHO_CLASS`. Passed on SAP_BASIS 816 (see above).
