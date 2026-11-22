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
  `tests/fixtures/service-generators/`) and live runs through this version on 7.58, 8.16, 7.50 and
  BTP ABAP Environment (H01), plus an independent re-test by Codex (GPT-6.2-Astra) on 7.58 and 8.16.
- 2026-11-22, second Codex pass: transportable run on 7.58, Web API run on 8.16, collisions only
  ARC-1 catches, namespaced dry run, BTP rename + publish, backend classes and SAP's own MCP tools.

## Requests

| Step | Request | 7.58 | 8.16 |
|---|---|---|---|
| Feed | `GET /sap/bc/adt/repository/generators?referencedObject=/sap/bc/adt/ddic/tables/<table>`, Accept `application/atom+xml;type=feed` | `smbc`, `uiservice`, `webapiservice` | `smbc`, `ui-service`, `webapi-service` |
| Proposal | `GET <content>?referencedObject=…&package=…` | `repository.generator.content.v1+json` | `serverdriven.content.v1+json; framework=generators.v1` |
| Validation | `POST <validation>?referencedObject=…&package=…&checks=package,referencedobject,authorization`, body = input | `asx:abap` StatusMessage `DATA/SEVERITY`, `SHORT_TEXT` | `validationMessages` `severity`, `shorttext` |
| Preview | `POST <preview>?referencedObject=…`, same body | flat `adtcore:objectReferences`; `adtcore:description="CREATE"` | nested `massOperation:group` tree; `Operation` property per object, code snippets |
| Run | `POST <generator>?referencedObject=…[&corrNr=…]`, same body | `adtcore:objectReferences` XML with only the binding, although the content type says JSON | same |

Endpoint roots: `/sap/bc/adt/businessservices/generators/<id>` (7.58),
`/sap/bc/adt/rap/generators/ui/<id>` (8.16 and BTP). Every feed entry links its endpoints by rel
(`…/repository/generator/content`, `/validation`, `/preview`, and `…/repository/generator` for the run)
with the media type in the link's `type`. ARC-1 takes path and media type from the feed, drops SAP's
query, and accepts a link only at its exact expected path (`<root><id>/<rel>`, the run at `<root><id>`),
so a mislabeled link cannot turn a preview into a run. The body content type of all three
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
| Proposal `metadata` | `{}` | `{"package": …}` (BTP: keys in alphabetical order, accepted as sent) |
| Other | — | `general.sessionId`, `namespace`, `projectName`; every name has an `…Orgn` twin |

A changed name travels through validation, preview and run (7.58 binding override, live 2026-11-22).
A wrong referenced table name passes SAP's validation (#1202), so ARC-1 refuses changing it.
7.58 deserializes the input with the Simple Transformation `ST_RAP_GENERATOR` (hence the key order).
On 8.16 `sessionId` ties proposal, validation, preview and run to one stored model, and each `…Orgn`
field holds the proposed name SAP renames from (`CL_RAP_GEN_SRV_ADT_SESSION_HND`), so ARC-1 refuses
changing either.

## What SAP does not check (ARC-1 does)

- **Table, package and request.** Validation answered OK for a missing package, no package, an
  invalid `corrNr` and another table (#1202); on 7.58 the feed, validation and preview also accept a
  table that does not exist (2026-11-22). A never-activated table reports `adtcore:version="new"` in
  its metadata (7.58 and 8.16; `"active"` once activated, `"inactive"` with a pending draft): 7.58 plans
  a stack for it, 8.16 validation dumps (`ASSERT`, HTTP 500). ARC-1 reads the table and the package and asks
  `/sap/bc/adt/cts/transportchecks` about a new object in the package: local packages (BTP `ZLOCAL`
  subpackages) take no request, recording packages need one. Only a complete answer (`RESULT=S`; seen
  on 7.58, 8.16 and BTP) counts: BTP `ZLOCAL` answers `DLVUNIT=ZLOCAL` with an empty `RECORDING`, a
  7.58 `HOME` package `RECORDING=X`. A run without `corrNr` landed on another open request of the
  user (8.16, `smbc`, #1122). With `corrNr` SAP honours it (#1202; 7.58 live 2026-11-22).
- **Collisions.** The preview reports CREATE for existing objects. On 7.58 validation rejects every
  existing object, one per call ("ZARC1_CXG_T_D already exists; choose a different name."). On 8.16
  the proposal already avoids taken names (`…T000`), so a second run creates a second stack; a
  binding or a projection class renamed to an existing one is refused by validation, but a draft
  table renamed to an existing table and a root entity named like an existing access control pass
  validation and preview. ARC-1's own check refused both with zero run requests (8.16, 2026-11-22).
- **Operation.** Both preview formats name `CREATE` for every object; ARC-1 refuses anything else.
- **Redirects.** The run is sent with redirects off; a 3xx answer is reported as a failure with the
  read-back, not as success (a 307/308 test server got exactly one run request).
- **Completeness.** The run names only the binding. ARC-1 GETs every planned object's own preview URI:
  404 means it does not exist, otherwise `adtcore:packageRef` gives its package (all generated types
  on 7.58, 8.16 and BTP, `NONT`/`RONT` included). A repository search is not exact enough (page limit).

## Results

| | 7.58 | 8.16 | BTP (H01) |
|---|---|---|---|
| `ui-service` objects | 9: DDLS ×2, BDEF ×2, CLAS, draft TABL, DDLX, SRVD, SRVB | 14: also DCLS ×2, projection CLAS, `NONT`, `RONT` | 14, as 8.16 |
| `webapi-service` objects | 7 (no draft table, no DDLX) | 12 (#1122; through ARC-1 2026-11-22) | not run |
| Real run | `$TMP`: 16 s (ui), 10 s (webapi); transportable package on a request: 16 s (ui); all active | `$TMP`: 33–102 s (ui), 31 s (webapi); all active | `ZLOCAL` subpackage: 49–76 s (ui, also with a renamed binding); all active |
| Publish + `service_info` | works | works (2026-11-22; refused in another client earlier, #1122) | works (99 s) |

Not in the preview, but recorded: one `G4BA` (named after the binding) and one `SUSH` (hash name) per
run; `smbc` also adds `STOB` objects (#1122). The 7.58 transportable run put all nine planned objects
plus `G4BA` and `SUSH` on the given request. In a transportable package they land on the request and
keep the package undeletable until the request is released, because deleted objects keep TADIR
entries with `DELFLAG=X` (7.58, 2026-11-22).

**Partial failure (7.58, 2026-11-22).** A Web API run on a table without the RAP timestamp fields
answered 422 ("BDEF …: The behavior definition is strict …") after creating all seven objects on the
request. Validation and preview had passed. ARC-1 reported the failure with every object `found`.

Namespaced names: on 8.16 a dry run with a `/DMO/R_…` root name read every `%2f` preview URI (404, new)
and passed; not run.

## SAP's own clients

SAP's ADT MCP server (VS Code `sapse.adt-vscode` 1.2.1) has three generator tools,
`abap_objects_generator_list`, `…_get_schema` and `…_run` (earlier `abap_generators-*`). `run` takes the
whole input as a JSON string plus a transport, validates, previews and runs in one call, and returns the
validation messages and the generated names. Its transport check asks about the first preview object
only; there is no separate dry run and no read-back. Backend providers: 7.58
`CL_RAP_GEN_ADT_UI_OBJ_GEN_TABL` / `…_WS_OBJ_GEN_TABL`; 8.16 `CL_RAP_GEN_ADT_UI_SRV_TABL` /
`…_WS_SRV_TABL` over `CL_RAP_GEN_ADT_CMN_SRV_TABL`.

## Not verified

- `smbc` and the other generators (roadmap FEAT-101, FEAT-102).
- A run into a package that is imported into another system (the 7.58 test request has no target).
