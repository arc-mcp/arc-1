# ADT object generators — #1121

## Scope and evidence

ADT's *Generate ABAP Repository Objects* wizard runs server-side generators through one framework (`framework=generators.v1`). This note records the wire contract behind `SAPRead(type="GENERATORS")` and `SAPWrite(action="generate")`.

Evidence is ADT communication logs captured on 28 October 2026 with ADT 3.60 (Eclipse 4.40):

| System | Release | Captured |
|---|---|---|
| S/4HANA 2025 FPS01, private cloud | SAP_BASIS 816 | Full `smbc` run on a customizing table with a text table: list, validation (one error, one pass), schema/content, preview, run, read-back; ADT discovery document |
| BTP ABAP Environment 2608 | SAP_BASIS 920 | Generator list only |

The fixtures in `tests/fixtures/generators/` are bodies from these logs with object, package, user and transport names anonymized. Nothing was verified on 758 or older; PR #409 reports different RAP generator ids on 758 (`uiservice`, `webapiservice`), so the framework exists there in some form.

## Discovery

The discovery document lists the collection `/sap/bc/adt/repository/generators` (category term `generators`) with the template `/sap/bc/adt/repository/generators{?referencedObject,fetchAllGenerators,type,id}`. The collection has no `app:accept`, so ARC-1's accept-based discovery map cannot gate on it; ARC-1 treats a 404 on the list as "framework not available".

## Requests

| Step | Request | Response |
|---|---|---|
| List all | `GET /sap/bc/adt/repository/generators?fetchAllGenerators=true`, Accept `application/atom+xml;type=feed`, header `X-sap-adt-feed` | Atom feed, one entry per generator |
| List for an object | `GET …/generators?referencedObject=/sap/bc/adt/ddic/tables/<table>` (lower-case object URI) | Same feed, filtered: `smbc`, `ui-service`, `webapi-service` for a table on 816 |
| Precheck | `GET <validation>?referencedObject=…&checks=referencedObject&checks=authorization`, later `&package=<pkg>&checks=package` | `validationMessages` |
| Schema | `GET <schema>?referencedObject=…&package=…`, Accept `application/vnd.sap.adt.serverdriven.schema.v1+json; framework=generators.v1` | JSON Schema 2020-12 |
| UI hints | `GET <configuration>?…` | Layout/hidden flags for the wizard only; ARC-1 does not use it |
| Proposal | `GET <content>?referencedObject=…&package=…`, Accept `application/vnd.sap.adt.serverdriven.content.v1+json; framework=generators.v1` | Proposed input JSON (names derived from the table) |
| Validate | `POST <validation>?referencedObject=…`, Content-Type `application/vnd.sap.adt.serverdriven.content.v1+json; framework=generators.v1`, body = input | `validationMessages` (`severity` OK/ERROR, `shorttext`) |
| Preview | `POST <preview>?referencedObject=…`, same body, Accept `application/vnd.sap.adt.repository.objects.massoperation.v1+xml` | `massOperation:group` tree; objects carry `Operation=CREATE`, an `adtcore:objectReference` and optionally a code snippet |
| Run | `POST <generator>?referencedObject=…&corrNr=<request>`, same body, Accept `application/vnd.sap.adt.repository.generator.v1+json` | `adtcore:objectReferences` XML with the main object only, despite the JSON content type |

ADT sends schema, configuration and content as one `communication/batch` request; ARC-1 sends the two GETs it needs separately. The body of validation, preview and run was byte-identical in the capture.

Each feed entry links its endpoints by rel: `…/repository/generator/content`, `/schema`, `/uiconfig`, `/validation`, `/preview`, `…/repository/generator` (run), and on some generators `serverdriven/sideeffect`, `serverdriven/valuehelp`, `$actions/fetchData`, `$actions/getArtifacts` or `provider`. Paths differ per generator (`/sap/bc/adt/bct/generators/ui/smbc`, `/sap/bc/adt/rap/generators/ui/ui-service`, `/sap/bc/adt/csn/generators/ui/…`, `/sap/bc/adt/analytics/generators/ui/…`). The validation link carries a `checks=` query that ADT replaces per call. Titles follow the logon language.

## smbc on 816

- The run created 24 objects in the target package: SMBC, TOBJ, three draft tables, seven DDLS, two DDLX, four DCLS, two BDEF, two behavior pools, SRVD and SRVB. Server time was 34 s.
- Validation catches table prerequisites, for example: "Please add a field CONFIGDEPRECATIONCODE with type CONFIG_DEPRECATION_CODE to table … to add Deprecate Action."
- ADT ran one `cts/transportchecks` per preview object before the run. ARC-1 runs the existing create transport pre-flight once, for the main object.
- The SMBC object was active right after the run and readable as before (`GET /sap/bc/adt/bct/smbctyp/<name>`, `/source/main`).
- The input schema contains `options.overwriteExistingObjects` (hidden in the wizard, `false` in the proposal).

## Design decisions

- **Engine and allowlist.** One generic engine covers list, proposal, validation, preview and run. Only ids in `GENERATOR_REGISTRY` run; the list shows all with `supported`. A registry entry fixes the accepted referenced types, the path prefix every advertised endpoint must stay under, and pinned input values.
- **Feed hrefs are untrusted.** Endpoints are taken from the feed but canonicalized with `canonicalHostRelativeAdtPath` and must lie under the registry prefix; the query SAP attached is dropped.
- **Package gate.** All generated objects land in `metadata.package`. ARC-1 checks `allowedPackages` for it before any generator request, sets `metadata` itself and refuses caller overrides of it. `overwriteExistingObjects` is pinned to `false`: overwriting would modify existing objects whose own package was never checked. The run is also refused when the preview lists an operation other than `CREATE`.
- **Operation types.** List, proposal, validation and preview are reads (validation and preview are POSTs that change nothing). The run is `OperationType.Create`, sent through `postCreate` without transient replays and with a 300 s fetch timeout.
- **Tool surface.** `SAPRead type=GENERATORS` and `SAPWrite action=generate` with `generator`; caller overrides travel as JSON in `source`, like other JSON-sourced writes, because a free-form object property is not representable in strict client schemas and the SAPWrite schema sits at its wire-byte wall.
- **Result.** The run reports SAP's object references, the preview list and which of those objects are still in the inactive list.

## Not verified

- A run through a deployed BTP/Cloud Connector route with principal propagation.
- Any generator other than `smbc`, and any run on 920 or 758.
- Behaviour when the package is local (`$TMP`) or the generator needs no transport.
