# SOD2 — API Package Assignment

Verified 2026-10-29 from Eclipse ADT 3.60.3 (plugin `com.sap.adt.com.sod2` 3.60.1) communication logs
against S/4HANA, SAP_BASIS 8.16 SP01. Fixtures in `tests/fixtures/xml/sod2-*.xml` are anonymized
copies of those responses.

| Contract | Observed value |
|---|---|
| ADT type | `SOD2` (no slash subtype; search uses `objectType=SOD2`) |
| Collection | `/sap/bc/adt/aps/com/sod2`, advertised by discovery with `application/vnd.sap.adt.blues.v1+xml`; a display-only user gets the collection with an empty `<app:accept/>`, so ARC-1 gates on the listing, not on the media type |
| Metadata | `GET` collection + lowercase name, `application/vnd.sap.adt.blues.v1+xml`, root `sod2:sod2` (namespace `http://www.sap.com/oda/sod2`), ETag/304 supported |
| ORD document | `GET …/sod2/$ordfile?packageAssignmentId=<NAME>`, `application/vnd.sap.adt.oda.ordfile+xml` → `<sod2:ordFile><sod2:ordDocumentFile>` |
| Resource definition | `GET …/sod2/$swaggerfile?packageAssignmentId=<NAME>`, `application/vnd.sap.adt.oda.swaggerfile+xml` → `<sod2:swaggerFile>` with `<sod2:jsonFile>` and `<sod2:edmxFile>` |

Discovery lists `$ordfile`, `$swaggerfile` and `$apidetails` as template links of the collection.
Both downloads are stateless single GETs without version parameter; the object path uses the
lowercase name, the query parameter the upper-case name.

## Resource definition slots

The two slots are the "JSON" and "EDMX" tabs of the Eclipse dialog, which always shows both. Their
names do not describe the content, so ARC-1 classifies each slot by content:

| API type (`apiWbObjectType`) | `jsonFile` | `edmxFile` |
|---|---|---|
| OData V4 (G4BA) | OpenAPI 3.0.0 | EDMX 4.0 |
| OData V2 from SEGW | empty element | EDMX 1.0 |
| SOAP inbound (WEBI) / outbound | `"openapi": "2.0"` (Swagger-shaped) | WSDL 1.1 |
| Event (RONT) | AsyncAPI 2.0.0 with `maxLength` | AsyncAPI 2.0.0 without `maxLength` |
| RFC (SRFC) | `aco:rfcSignature` XML | identical |
| SQL service (SQL1) | sqlapi 1.0.2 | identical |
| Custom class (CLAS) | OpenAPI 3.0.2 | identical |

An assignment without definitions answers `200` with `<sod2:ordDocumentFile/>` (ORD) and `200` with
an empty body and no Content-Type (resource definition). The ORD document's `resourceDefinitions`
can advertise formats ADT does not deliver (OpenAPI for SEGW OData V2, EDMX for the custom class),
so it is not used to decide availability. Button visibility in Eclipse is client logic;
`pluginConfigs` in the metadata only covers `default_consumption_bundle_group`.

## Size and line structure

EDMX, WSDL, RFC signatures, ORD documents and several JSON specifications arrive on one line (a SEGW
OData V2 EDMX was 527 KB). Before grep or line-range reads, ARC-1 separates adjacent XML tags in element-only content and keeps mixed-content subtrees intact.
Documents with a DOCTYPE retain their original layout. JSON indentation is capped at eight levels
and preserves string and number literals and duplicate keys. Each result is limited to 100,000
characters. Use grep or a smaller line range for larger documents. SAP returns the complete
wrapper on each request. ARC-1 limits its decompressed size to 8 MiB before parsing.

## Writes

Create, update and delete share the SOD1 contract, see [sod1.md](sod1.md). The create document carries
`packageID` (the API package), `apiWbObjectType`, `apiWbObjectName`, `apiSubWbObjectType` and
`apiSubWbObjectName`; for an OData V4 service binding (G4BA) the sub-object is `G4S` with the
service group name padded to 36 characters followed by the version. Eclipse's "Documentation Link"
field writes `documentationLinkReplacement`; SAP then returns the same URL in `documentationLink`. SAP accepts a manual documentation link only when the API package is an internal ODA package (`type` `1`); otherwise the save is refused ("manual documentation link is only allowed for internal ODA packages"). Tags follow the SOD1 rules (value help per category).

## Direct CLI verification, 2026-11-20

The 7.58 test system returned an empty ORD slot for all seven discoverable assignments. On 8.16
all nine contained SAP's HTML 403 page in a successful ADT response. The 8.16 class
`CL_APS_ODA_WBI_SOD2_ORD` calls the internal HTTP service and copies the response body even
on failure. `CL_APS_ORD_DOCUMENT_HTTP_SRV=>CO_ORD_SERVICE_PATH` identifies
`/sap/bc/http/sap/ord_document/ApiResources` and `/sap/bc/http/sap/ord_document/EventResources`.
ARC-1 reports the embedded failure. The 7.58 empty slot remains a successful empty result.

Resource definitions take a different path. On 8.16 `CL_APS_ODA_WBI_SOD2_SWAGGER` calls
`get_swagger_file` once per format and copies each provider's bytes into the corresponding slot.
Neither release returned an HTML page in these slots. Both returned OpenAPI 2.0 and WSDL 1.1 for
`OP_CO_KEY_MAP_RPLCTCO` and `OP_CO_KEY_MAP_RPLCTRQ`; the remaining assignments had empty
definitions. The test client read a single document, searched OpenAPI, and read and searched the 28,005-byte
WSDL for `OP_CO_KEY_MAP_RPLCTCO`. Breaking between whole tags gave 834 lines with a longest
line of 622 characters. The previous display had 834 lines with a longest line of 621.

Both releases registered a SOD2 pointing to `CL_ABAP_CHAR_UTILITIES`, then returned a 500 on
metadata construction because the constructor is private. The create result now distinguishes
confirmed creation from failed read-back. ADT exact lookup identified the assignment, URI and
`$TMP` package on both systems. The normal single-target delete call verified that evidence against
the allowlist and successfully removed the unreadable assignment.

## Not covered

`$apidetails` and the value helps (`apiobjecttype`, `tadir`, `odatav4groupservice`,
`leadingbusinessobjecttype`). BTP ABAP Environment remains unverified and the types are excluded from its tool schemas.
