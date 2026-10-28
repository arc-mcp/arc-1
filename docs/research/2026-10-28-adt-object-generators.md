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
- The preview depends on the options: with `addCopyAction=false` (SAP's proposal for this table) it listed 23 objects, with `addCopyAction=true` 24, the extra one being the copy-parameter DDLS.
- The preview lists the repository objects of the application. The run also created dependent objects that the preview does not list, in the same package and transport: one authorization default (`SUSH`), one `STOB` per DDLS and the Gateway artifact of the service binding (`G4BA`).
- The preview and the run report the transport object under its maintenance name (`<name>`); package listing and transport show it as `<name>T`, the TADIR name with its type suffix.
- Generating the same object set again fails in SAP's validation ("Object … of type Business Configuration Maintenance Object already exists."), both in a dry run and in a real run. SAP does not offer an update preview there.

## Live run through ARC-1

On 28 October 2026 the change was deployed as a test build (`v1.9.0` plus this change) to a single-target write instance on BTP Cloud Foundry (XSUAA, principal propagation through the Cloud Connector) against the 816 system above. An MCP agent ran list, filters, the refusals (missing `objectType`, unsupported generator, package outside `SAP_ALLOWED_PACKAGES`, `overwriteExistingObjects`, `metadata`), SAP's validation error, dry runs with SAP's proposal and with the names of the Eclipse run, the real run, read-back and a second run on the existing objects. All behaved as described in this note.

- The real run created the 24 previewed objects plus the dependent objects above; all were active afterwards (`inactiveObjects` empty, nothing in the inactive list).
- The objects had been generated before in Eclipse and deleted again, with the deletion still recorded in an unreleased transport. The transport pre-flight therefore found the objects locked in that request and used it although no `transport` was passed. That is the documented create behaviour; on a system where the names were never used, a transportable package without `transport` is refused instead.

## Design decisions

- **Engine and allowlist.** One generic engine covers list, proposal, validation, preview and run. Only ids in `GENERATOR_REGISTRY` run; the list shows all with `supported`. A registry entry fixes the accepted referenced types, the path prefix every advertised endpoint must stay under, and pinned input values.
- **Feed hrefs are untrusted.** Endpoints are taken from the feed but canonicalized with `canonicalHostRelativeAdtPath` and must lie under the registry prefix; the query SAP attached is dropped.
- **Package gate.** All generated objects land in `metadata.package`. ARC-1 checks `allowedPackages` for it before any generator request, sets `metadata` itself and refuses caller overrides of it. `overwriteExistingObjects` is pinned to `false`: overwriting would modify existing objects whose own package was never checked. The run is also refused when the preview lists an operation other than `CREATE`.
- **Operation types.** List, proposal, validation and preview are reads (validation and preview are POSTs that change nothing). The run is `OperationType.Create`, sent through `postCreate` without transient replays and with a 300 s fetch timeout.
- **Tool surface.** `SAPRead type=GENERATORS` and `SAPWrite action=generate` with `generator`; caller overrides travel as JSON in `source`, like other JSON-sourced writes, because a free-form object property is not representable in strict client schemas and the SAPWrite schema sits at its wire-byte wall.
- **Result.** The run reports SAP's object references, the preview list and which of those objects are still in the inactive list.

## Not verified

- A transportable package without `transport` on object names the system never saw (the live run hit the lock of an earlier deletion, see above).
- Duration through ARC-1 (the agent could not time calls; Eclipse showed 34 s of server time).
- Any generator other than `smbc`, and any run on 920 or 758.
- Behaviour when the package is local (`$TMP`) or the generator needs no transport.
