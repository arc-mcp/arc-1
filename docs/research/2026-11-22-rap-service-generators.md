# RAP service generators over ADT

Wire contract behind `SAPWrite(action="generate")`: SAP's server-side generators of ADT's "Generate
ABAP Repository Objects" wizard, used for `ui-service` and `webapi-service`. This note merges the
evidence of two contributor PRs with the checks of the version that shipped:

- [#1122](https://github.com/arc-mcp/arc-1/pull/1122) (Thomas Kaltbeitzel, issue #1121): generic
  engine; ADT communication logs from SAP_BASIS 8.16 (full `smbc` run) and the BTP 920 generator list,
  2026-10-28; 8.16 RAP service runs through ARC-1, 2026-11-12.
- [#1202](https://github.com/arc-mcp/arc-1/pull/1202) (Flavio): live contract of the 7.58 RAP service
  generators over RFC, 2026-11-06, in `$TMP` and a transportable package.
- 2026-11-22: responses captured on 7.58 and 8.16 (now the unit-test fixtures in
  `tests/fixtures/service-generators/`) and live runs through this version on 7.58, 8.16 and 7.50.

## Requests

| Step | Request | 7.58 | 8.16 |
|---|---|---|---|
| Feed | `GET /sap/bc/adt/repository/generators?referencedObject=/sap/bc/adt/ddic/tables/<table>`, Accept `application/atom+xml;type=feed` | `smbc`, `uiservice`, `webapiservice` | `smbc`, `ui-service`, `webapi-service` |
| Proposal | `GET <content>?referencedObject=…&package=…` | `repository.generator.content.v1+json` | `serverdriven.content.v1+json; framework=generators.v1` |
| Validation | `POST <validation>?referencedObject=…&package=…&checks=package,referencedobject,authorization`, body = input | `asx:abap` StatusMessage `DATA/SEVERITY`, `SHORT_TEXT` | `validationMessages` `severity`, `shorttext` |
| Preview | `POST <preview>?referencedObject=…`, same body | flat `adtcore:objectReferences`; `adtcore:description="CREATE"` | nested `massOperation:group` tree; `Operation` property per object, code snippets |
| Run | `POST <generator>?referencedObject=…[&corrNr=…]`, same body | `adtcore:objectReferences` XML with only the binding, although the content type says JSON | same |

Endpoint roots: `/sap/bc/adt/businessservices/generators/<id>` (7.58),
`/sap/bc/adt/rap/generators/ui/<id>` (8.16, and BTP per #1122). Every feed entry links its endpoints
by rel (`…/repository/generator/content`, `/validation`, `/preview`, and `…/repository/generator` for
the run) with the media type in the link's `type`. ARC-1 takes path and media type from the feed,
drops SAP's query, and calls only paths at or below `<root><id>`. The body content type of all three
POSTs is the content link's type. 7.50 has no generator collection: the feed answers 404.

## Input

The proposal is a JSON object that ARC-1 sends back with changes. `metadata` comes first: SAP's
parser is order-sensitive at every level and answers 400 ("attribute value 'metadata' expected") for
another order (#1202). ARC-1 keeps the proposal's key order and sets
`metadata = {…proposal.metadata, package, masterLanguage}`.

| | 7.58 | 8.16 |
|---|---|---|
| Table name | `general.referenceObjectName` | `general.referencedObjectName` |
| Binding name | `businessService.serviceBinding.name` | `businessService.serviceBinding.serviceBindingName` (+ `…Orgn`) |
| Proposal `metadata` | `{}` | `{"package": …}` |
| Other | — | `general.sessionId`, `namespace`, `projectName`; every name has an `…Orgn` twin |

A changed name travels through validation, preview and run (7.58 binding override, live 2026-11-22).
A wrong referenced table name passes SAP's validation (#1202), so ARC-1 refuses changing it.

## What SAP does not check (ARC-1 does)

- **Package and request.** Validation answered OK for a missing package, no package, an invalid
  `corrNr` and another table (#1202). A run without `corrNr` landed on another open request of the
  user (8.16, `smbc`, #1122). With `corrNr` SAP honours it (#1202; 7.58 live 2026-11-22).
- **Collisions.** The preview reports CREATE for existing objects. On 7.58 validation rejects every
  existing object, one per call ("ZARC1_CXG_T_D already exists; choose a different name."). On 8.16
  the proposal already avoids taken names (`…T000`), so a second run creates a second stack; a
  binding renamed to an existing one is refused by validation.
- **Completeness.** The run names only the binding; the planned objects are read back.

## Results

| | 7.58 | 8.16 |
|---|---|---|
| `ui-service` objects | 9: DDLS ×2, BDEF ×2, CLAS, draft TABL, DDLX, SRVD, SRVB | 14: also DCLS ×2, projection CLAS, `NONT`, `RONT` |
| `webapi-service` objects | 7 (no draft table, no DDLX) | 12 (#1122) |
| Real run, `$TMP` | 16 s (ui), 10 s (webapi); all active | 102 s (ui); all active |
| Publish + `service_info` | works | works (2026-11-22; refused in another client earlier, #1122) |

Not in the preview, but recorded: one `G4BA` (named after the binding) and one `SUSH` (hash name) per
run; `smbc` also adds `STOB` objects (#1122). In a transportable package they land on the request and
keep the package undeletable until the request is released, because deleted objects keep TADIR
entries with `DELFLAG=X` (7.58, 2026-11-22).

**Partial failure (7.58, 2026-11-22).** A Web API run on a table without the RAP timestamp fields
answered 422 ("BDEF …: The behavior definition is strict …") after creating all seven objects on the
request. Validation and preview had passed. ARC-1 reported the failure with every object `found`.

## Not verified

- BTP ABAP Environment: the instance was stopped on 2026-11-22 (roadmap FEAT-103).
- `webapi-service` real run on 8.16 through this version (#1122 ran it).
- `smbc` and the other generators (roadmap FEAT-101, FEAT-102).
