# SOD2 — API Package Assignment

Verified 2026-10-29 from Eclipse ADT 3.60.3 (plugin `com.sap.adt.com.sod2` 3.60.1) communication logs
against S/4HANA, SAP_BASIS 8.16 SP01. Fixtures in `tests/fixtures/xml/sod2-*.xml` are anonymized
copies of those responses.

| Contract | Observed value |
|---|---|
| ADT type | `SOD2` (no slash subtype; search uses `objectType=SOD2`) |
| Collection | `/sap/bc/adt/aps/com/sod2`, advertised by discovery with `application/vnd.sap.adt.blues.v1+xml` |
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
OData V2 EDMX was 527 KB). ARC-1 adds ignorable whitespace before grep or line-range reads: XML is
broken only between directly adjacent tags, JSON is re-indented outside string literals without a
parse round trip. A document above 100,000 characters needs `grep` or `lineStart`/`lineEnd`.

## Not covered

Creating, changing and deleting assignments; reading the API package (SOD1). Not verified on
SAP_BASIS 7.58 or BTP ABAP Environment; availability is discovery-gated.
