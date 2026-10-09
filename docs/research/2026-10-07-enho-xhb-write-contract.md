# ENHO/XHB (BAdI implementation) write contract

Status: **implemented; live-verified on SAP_BASIS 816 on-prem (2026-10-07) in `$TMP` and in a transportable
package with a transport request, and on a second 816 system across several modules (2026-10-08). Enabled on
BTP on 2026-10-08; the final code was re-tested on-prem (ABAP Classic and ABAP Cloud) and on BTP
(2026-10-09).** The create sequence follows a captured Eclipse ADT create; the payload is derived from SAP's
own GET serialization.

## Why

In a project on S/4HANA (SAP_BASIS 816, on-prem), ARC-1 created the package,
transport and the ABAP Cloud implementing class for the released BAdI `SD_APM_SET_APPROVAL_REASON`
(spot `ES_SD_SLS_EXTEND`). The enhancement implementation itself had to be created by hand in Eclipse ADT,
because ARC-1 could only read ENHO. The full plan is in `docs/plans/enho-badi-impl-write.md`.

## Contract as implemented

| Step | Request | Notes |
|---|---|---|
| Gate | ADT discovery advertises `/sap/bc/adt/enhancements/enhoxhb` | Advertised on 758/816 (S/4HANA 2023 and ABAP Platform 2025 trial probes); 750 only advertises `enhoxh`. An unprobed session is not blocked. |
| Spot read | `GET /sap/bc/adt/enhancements/enhsxsb/{spot}` with `Accept: application/vnd.sap.adt.enh.enhs.v2+xml` | Before create and update: BAdIs of the spot, their filter declarations and the spot's `enhs:internal` flag. The media type is the one discovery advertises and the response carries (2026-10-08); the `enhsxsb.v1`–`v4` names return 406. |
| Create | `POST /sap/bc/adt/enhancements/enhoxhb?corrNr=…` with `application/vnd.sap.adt.enh.enhoxhb.v4+xml` | `enho:objectData` with the spot usage and **no** BAdI implementations (`badiContainerXml`), as Eclipse sends it. |
| Save implementations | lock → `PUT …/{name}?lockHandle=…&corrNr=…` → unlock | Full document. Eclipse does the same when the form editor is saved. |
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
- **In `$TMP` a POST with the implementations also stores them**, but the same POST fails in a transportable
  package (next section), so ARC-1 always creates the container first.
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

`SAPRead` shows the condition as `"filter": "LGNUM = '1000' OR LGNUM = '2000'"` (synthetic fixture
`tests/fixtures/xml/enhancement-implementation-filter.xml`), and SAPWrite accepts the same text back.

### Writing filters (816, 2026-10-07)

The `filterProperty` content is the BAdI definition's filter declaration. The spot document
`GET /sap/bc/adt/enhancements/enhsxsb/{spot}` lists, per `<enhs:badiDefinition>`, the interface and
`<enhs:filters><enhs:filter enhs:filterName enhs:filterType><enhs:filterCheck …>` (synthetic fixture
`tests/fixtures/xml/enhancement-spot.xml`). ARC-1 copies the check element, renamed to `enho:filterCheck`;
a filter without a DDIC check (type `S`) becomes `<enho:filterProperty … enho:filterType="S"/>`. The
endpoint Eclipse calls while adding an implementation,
`…/enhsxsb/{spot}/enhancements/definitions?badiImplName=…&packageName=…`, only lists the BAdI names.

Live in `$TMP` with BAdI `EDOC_ADAPTOR` (spot `ES_EDOCUMENT`, filters `COUNTRY` with DDIC check and
`GENERIC_FILTER` of type `S`) and a class implementing its interface; every step was activated successfully:

- `COUNTRY = 'BE' OR COUNTRY = 'NL'` (create), `(COUNTRY = 'DE' OR COUNTRY = 'AT') AND GENERIC_FILTER CP 'X*'`
  and `COUNTRY <> 'US' AND GENERIC_FILTER NP 'TEST*'` (updates): SAP stored the trees as built (`enho:And`,
  nested `enho:Or`, comparators `CP`, `NP`, `&lt;&gt;`) and SAPRead returned the same text.
- Writing SAPRead's JSON back left the stored tree byte-identical; `"filter": ""` removed it.
- An undeclared filter name and a BAdI outside the spot were refused before any write.

abapGit takes a different route: it calls `CL_ENH_TOOL_BADI_IMPL` in ABAP (`add_implementation`, then
`save( run_dark = abap_true )`), which suppresses the dialogs that make an ADT create with implementations
fail in a transportable package.

### Transportable package: implementations in the create POST fail (816, 2026-10-07)

First attempts posted the full document, implementations included. In a transportable package with a
transport request (target set, never released):

- The create POST returned **HTTP 500 `Screen output without connection to user`**: SAP tried to show a dialog.
- The POST still wrote a TADIR entry `R3TR ENHO` without enhancement content (no `ENHHEADER` row). ADT could
  not delete it afterwards: DELETE failed with `Could not determine recipients for message type CONDAT`,
  `Parameter corrNr could not be found` (no request) and `No documentation class is assigned to object R3TR ENHO`.
  The orphaned entry blocks deleting its package and needs SAP GUI (SE03 object directory) to remove.
- Repeated in a package that was recorded on a transport request, with that request as `corrNr`: same HTTP 500,
  and the object was entered on the request (`R3TR ENHO`, locked) although its content was never created.
  So the failure is not caused by an unrecorded package.
- `$TMP` creates on the same system never showed this.

**Eclipse ADT does it in two steps** (ABAP Communication Log, same package and request): `POST
…/enhoxhb/validation?objtype=enhoxhb&objname=…&spotname=…&package=…` and `POST /sap/bc/adt/cts/transportchecks`,
then `POST /sap/bc/adt/enhancements/enhoxhb?corrNr=…` with the empty container (≈1 KB, 201). Adding a BAdI
implementation in the form editor reads `GET …/enhsxsb/{spot}/enhancements/definitions?badiImplName=…&packageName=…`
and saves with `LOCK` → `PUT …?lockHandle=…&corrNr=…` (200) → `UNLOCK`. Eclipse also refuses to save an
implementing class that does not implement the BAdI interface (client-side check); ARC-1 leaves that check to
activation.

**With the same two steps ARC-1 succeeds:** container POST (201) → PUT with the implementation and `corrNr` →
read back → update → activation → the request lists `R3TR ENHO … (ENHO/XHB)` → delete (TADIR keeps the
deletion record `DELFLAG = X` on the request, as for any transportable deletion).

### BTP ABAP environment (shared trial, 2026-10-07)

Discovery advertises `/sap/bc/adt/enhancements/enhoxhb` and `/enhsxsb`. The release state belongs to the BAdI
definition, not the spot: `GET /sap/bc/adt/apireleases/{encoded spot URI}` answers "No entry found for object
type ENHS", while the BAdI form `…/enhsxsb/{spot}#type=enhs%2fxb;name={badi}` returns the C0/C1 contracts.
Of 1,102 BAdI definitions in 779 spots, 19 are C1-released. For a customer implementation the C1 flag
`useInSAPCloudPlatform` must be true: `CFD_RUNTIME_SOAP_AMOUNT_CONV` is released for key-user apps only, and
both its interface and its BAdI definition were refused ("The use of … is not permitted").

With SAPWrite ENHO enabled locally for BTP (enabled in the code on 2026-10-08), in a cloud package without
transport:

- Create, read back and update worked for both tested BAdIs; the create body is accepted with ARC-1's
  cloud adjustments (`abapLanguageVersion="cloudDevelopment"`, no `responsible`).
- `ADDRESS_PRINT_FORMAT` (filter `RECEIVER_COUNTRY`): create with `RECEIVER_COUNTRY = 'DE'` activated
  successfully; after an update to `RECEIVER_COUNTRY = 'DE' OR RECEIVER_COUNTRY = 'AT'` (read back
  correctly) activation failed with "The use of Class {implementing class} is not permitted" — not explained yet.
- A delete right after that failed activation returned HTTP 409 (TK/754, "Error when creating object directory
  entry"); a retry a little later succeeded.

Follow-up the same day, to isolate the failure:

- `ADDRESS_PRINT_FORMAT` (filter) and `BADI_IAM_BUSINESS_USER` (no filter): create → activate → ARC-1 update
  without changes → activate: all succeeded. SAP's stored content before and after the ARC-1 update was
  identical (only navigation links differ between the active and inactive version).
- The failing sequence repeated exactly (create with `RECEIVER_COUNTRY = 'DE'` → activate → update to
  `… OR RECEIVER_COUNTRY = 'AT'` → activate): succeeded. The earlier "use of Class … is not permitted" did not
  reproduce. In both runs the freshly created class first activated with the warning "Implementation missing
  for method …" although the method was in the source; activating the class again cleared it. That points at
  the class create on this shared trial, not at the ENHO write.

### Second system, several modules (816, 2026-10-08)

A second on-prem S/4HANA system (SAP_BASIS 816), in a new transportable package with a local transport
request, through the real tool dispatcher. Eight BAdIs from SD, PP, eDocument, HR, FI/CO and QM; three of them
released (C1: `SD_SLS_CHECK_BEFORE_SAVE`, `SD_SLS_MODIFY_ITEM_REQDATE`, `BD_MFGORDER_CHECK_BEFORE_SAVE`), the
others not. Each got a class implementing its interface. Nine enhancement implementations were created; all
objects were deleted afterwards.

Worked and activated:

- Two implementations of different BAdIs in one ENHO (one created inactive); a later update that left
  `shortText`/`active` out kept the stored values; a short text with `< & " äöü` round-tripped.
- Filters of type `N` (NUMC), `C` and `S`, with and without DDIC check (data element, domain, value table),
  on single-use BAdIs, a BAdI with fallback class and BAdIs with context mode `S`; every comparator
  (`= <> < <= > >= CP NP`) on its own.
- An omitted `filter` kept the stored tree, `""` removed it, a new one was rebuilt; writing SAPRead's JSON back
  changed nothing in SAP's stored XML except its own active/inactive version link (header attributes included).
- `batch_create` with a class and the ENHO that uses it, in dependency order.
- Validation before any write: BAdI not in the spot, spot change, undeclared filter, filter syntax, unknown
  key, duplicate implementation name, missing spot.

SAP refused, with readable activation errors: a second active implementation of a single-use BAdI with an
overlapping filter (`Conflict between adjustment …`), and a filter that overlaps SAP's own implementation.

Fixed after this run:

- **An OR of different filters inside an AND** (`(A = '1' OR B = '2') AND C = '3'`, also deeper) is refused by
  SAP with HTTP 400 `I::000 BADI_IMPL`. An OR of one filter's values inside an AND, and any OR of AND groups,
  are stored. ARC-1 now refuses the rejected shape before the PUT and names the equivalent OR-of-ANDs form.
- **SAP-internal spots** (`<enhs:contentCommon enhs:internal="true">`, e.g. `ES_FILL_COUNTRY_TAX_DATA`): the
  create POST fails with HTTP 400 `Internal SAP enhancement; no implementation allowed in customer namespace`
  but still writes a TADIR entry `R3TR ENHO` that ADT can neither read nor delete (404). ARC-1 now refuses a
  Z/Y create for such a spot before the POST; the live retry left no TADIR entry. For a Z/Y create the spot
  read is therefore required, also without implementations; a failed read stops the create.

### Re-test of the final code: ABAP Classic, ABAP Cloud and BTP (2026-10-09)

Head `1892b7d8`, through the real tool dispatcher.

On-prem (the second 816 system), one classic package and one package whose ABAP language version was set to
"ABAP for Cloud Development" in Eclipse (`pak:languageVersion="5"`; ARC-1 cannot set it yet):

- Classic: a released and an unreleased BAdI (with filter), update, activation, `batch_create` with its class.
  The stored `abapLanguageVersion` stayed `standard`; a stored filter survived an update without `filter`
  while the short text contained `/>` (SAP stores `>` as `&gt;`, so the attribute-regex fix is a safeguard);
  `O_APPL = <>` and an internal-spot create without implementations were refused before any write, the latter
  without a TADIR entry.
- ABAP Cloud: classes and ENHOs created there got `cloudDevelopment` from the package. Released BAdIs (one with
  a filter that changed) created, updated and activated; the version stayed `cloudDevelopment` after every
  update. An unreleased BAdI was saved but refused at activation: "The use of BAdI Definition … is not
  permitted". `switchSupported` reads `false` in that package.
- Writing SAPRead's JSON back changed nothing in SAP's stored XML in either package.

BTP trial: the ENHO test in `tests/integration/btp-tool-dispatch.integration.test.ts` passed for
`ADDRESS_PRINT_FORMAT` with `RECEIVER_COUNTRY = 'DE'` and for `BADI_IAM_BUSINESS_USER` without filter
(create → read back → activate → update → `cloudDevelopment` kept → activate → delete).

All test objects were deleted.

## Open points

1. Setting an object's or package's ABAP language version is not possible through ARC-1 (roadmap); the cloud
   package above was switched in Eclipse.
2. Optional: Eclipse's `…/enhoxhb/validation` and `transportchecks` calls before the create; ARC-1 resolves the
   transport itself and relies on activation for consistency checks.

## Verification so far

(See the dated sections above for the live update, filter, transport and BTP results.)


- Unit: `tests/unit/adt/enhancement-impl.test.ts` (parse, merge, XML round trip through
  `parseEnhancementImplementation`, escaping, namespaced names) and `tests/unit/handlers/enho-write.test.ts`
  (create POST + PUT, partial-create guidance, validation before write, update merge, spot change refusal,
  delete, activation URI, discovery gate, package allowlist refusal for create/batch_create/update).
- Live: `tests/integration/enho.integration.test.ts` (create → read back → update → activate → delete in `$TMP`),
  driven by `TEST_ENHO_SPOT`, `TEST_ENHO_BADI` and `TEST_ENHO_CLASS`. Passed on SAP_BASIS 816 (see above).
