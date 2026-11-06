# RAP service generators over ADT

Live contract of the generators behind Eclipse's "Generate ABAP Repository Objects" wizard, observed on
on-premise SAP_BASIS 758 over RFC on 2026-11-06, with disposable objects in `$TMP` that were removed
afterwards. `SAPWrite action=generate_service` implements it.

## Contract

- `GET /sap/bc/adt/repository/generators?referencedObject={table uri}` lists the generators as an Atom feed.
  Without `referencedObject` the feed holds only a filter link. It offered `smbc`, `uiservice` and `webapiservice`.
- Each entry links resources under `/sap/bc/adt/businessservices/generators/{id}` (`smbc`: `/sap/bc/adt/bct/generators/smbc`):

| Resource | Method | Media type | Result |
|---|---|---|---|
| `/content` | GET | `application/vnd.sap.adt.repository.generator.content.v1+json` | Default content for the table |
| `/schema` | GET | `...generator.schema.v1+json` | JSON schema |
| `/uiconfig` | GET | `...generator.uiconfig.v1+json` | Wizard hints |
| `/validation` | POST | Sends content JSON; accepts `application/vnd.sap.as+xml;charset=utf-8;dataname=com.sap.adt.StatusMessage` | HTTP 200 with `SEVERITY` and `SHORT_TEXT` |
| `/preview` | POST | Sends content JSON; accepts `...generator.preview.v1+xml` | `adtcore:objectReferences` |
| (none) | POST | Sends content JSON; accepts `...generator.v1+json` | Generates; HTTP 200 |

## Behavior ARC-1 has to compensate for

- **The JSON parser is order-sensitive at every level.** `metadata` must come first, and `referenceObjectName`
  must precede `description` inside `general`. A wrong order answers HTTP 400 with a parser message, such as
  "attribute value 'metadata' expected". A missing section fails the same way.
- **Validation is the only collision check.** It rejects each existing object: CDS view, class, draft table,
  projection, service definition and binding. It reports one problem per call.
- **The preview does not detect collisions.** It reports `CREATE` for objects that already exist.
- **Validation does not check the package, the transport or the reference.** It answered OK for a package that
  does not exist, without a package, with an invalid `corrNr`, for a table that does not exist, and when
  `general.referenceObjectName` named another table.
- **The preview fails on incomplete content.** Over RFC it raised `INPUT_DATA_NOT_SUFFICIENT`, so it must run
  after a successful validation.
- **The generation response is incomplete.** It named only the service binding, although nine objects were
  created. Its `Content-Type` says JSON while the body is XML. Objects must be read back.

## Result of a generation

`uiservice` created a CDS view entity, a behavior definition, an implementation class, a draft table, a projection
view, a projection behavior definition, a metadata extension, a service definition and a binding. All were active.
The binding was not published; after `SAPActivate action=publish_srvb`, `SAPRead type=SRVB include=service_info`
returned its URL and entity set. `webapiservice` previews eight objects, without the metadata extension. Only its
schema, defaults, validation and preview were exercised; no Web API stack was generated.

## Not verified

- **Transports.** How a generation receives its transport was not observed. Validation accepts any `corrNr`, so it
  proves nothing. `generate_service` therefore accepts `$TMP` only (roadmap FEAT-98).
- **Other routes and releases.** HTTP, BTP and other releases were not tested, so the action is on-premise only.
- **A generation that fails midway.** ARC-1 reads the objects back and reports them, but no live partial failure
  was observed, so SAP's rollback behavior is unknown.
- **`smbc`.** The maintenance-object generator is not exposed. Its transport handling differs and it was not exercised.
