# Issue #798 — data-source blocklist on SAP_BASIS 7.50

**Status:** Fix implemented and validated on 2026-09-17 against NPL/SAP_BASIS 750 and
A4H/SAP_BASIS 758.

## TL;DR

A non-empty `SAP_BLOCKED_DATA_SOURCES` cannot produce an allow decision on SAP_BASIS 7.50 once
lineage reaches a transparent table. ARC-1 must inspect the table's
`@AbapCatalog.replacementObject`, but HEAD unconditionally reads
`GET /sap/bc/adt/ddic/tables/<NAME>/source/main`. SAP introduced the ADT source-based database-table
resource in 7.52, so 7.50 returns `404` and the policy correctly fails closed, but only as the generic
`DATA_LINEAGE_UNRESOLVED` outcome.

The safe fix is **not** to treat 7.50 transparent tables as having no replacement. SAP supports
replacement objects on 7.50, the live 7.50 system contains the documented `DEMO_SUMDIST` replacement
example, and the two available fallback representations omit the replacement relationship. The narrow
fix is to consult already-loaded ADT discovery at the point where replacement metadata is required and
return a dedicated, actionable `DATA_POLICY_UNAVAILABLE` denial before attempting the absent resource.
If discovery is unavailable, the canonical resource's `404` supplies the same evidence after one
metadata request. Direct exact matches and graph-visible transitive matches keep their stronger outcomes.

## Issue and duplicate triage

- Reporter: `MWKAnalytics` (external contributor).
- Claim: all otherwise allowed `SAPQuery`, `SAPRead(TABLE_QUERY)`, and
  `SAPRead(TABLE_CONTENTS)` calls fail on ECC/SAP_BASIS 750 SP23 when the blocklist is non-empty.
- Expected direction: either gate the feature clearly on the missing table-source resource or find a
  safe 7.50 lineage source.
- Classification: confirmed release-specific bug in error/capability handling. The fail-closed decision
  is correct; the undocumented compatibility boundary and generic diagnostic are not.
- Duplicate search: no matching open/closed issue and no prior `docs/research/issues/` dossier was found.
- HEAD is affected at `5bc5310b`: no release/discovery gate exists in the lineage path.

## What HEAD does

The relevant call chain is:

```text
SAPQuery / TABLE_QUERY / TABLE_CONTENTS
  -> AdtClient.dataSourceBlocklistGuard()
  -> DataSourceBlocklistGuard.enforceSqlBatch() / enforceSources() / enforceTableContents()
  -> enforceBlockedDataSources()
  -> resolveDirectSource() via exact repository search
  -> replacementAt()
  -> resolver.readTableSource()
  -> AdtClient.getTable()
  -> GET /sap/bc/adt/ddic/tables/<NAME>/source/main
```

`src/adt/data-source-policy.ts` intentionally expands replacement-object lineage for every transparent
table. `src/adt/client.ts` intentionally does **not** use the read-side `/structures` fallback because
that representation does not expose replacement metadata. Any failed metadata request becomes
`DATA_LINEAGE_UNRESOLVED`; no discovery check runs before the request.

This affects all three public data paths because the guard is correctly placed below their handlers at
the shared ADT-client choke point. An empty list still returns before any metadata work, and a direct
block still denies locally with zero SAP requests.

## Live validation

Credentials came from `INFRASTRUCTURE.md` / `.env.infrastructure`; they are not reproduced here. The
probe instantiated the production `AdtClient`, loaded live discovery, enabled an in-memory blocklist
containing only `USR02`, and invoked the three public client paths.

### Before-fix behavior

| System | Discovery `/ddic/tables` | Request | Observed result |
|---|---:|---|---|
| NPL, SAP_BASIS 750 | absent | `SAPQuery: SELECT CARRID FROM SCARR` | `DATA_LINEAGE_UNRESOLVED`; `GET /ddic/tables/SCARR/source/main -> 404`; `executed=false` |
| NPL, SAP_BASIS 750 | absent | `TABLE_QUERY SCARR` | same 404 and denial |
| NPL, SAP_BASIS 750 | absent | `TABLE_CONTENTS SCARR` | same 404 and denial |
| NPL, SAP_BASIS 750 | absent | direct `USR02` | `DATA_SOURCE_BLOCKED`, zero metadata requests |
| A4H, SAP_BASIS 758 | present | the three `SCARR` requests | all allowed; the actual data preview executed |
| A4H, SAP_BASIS 758 | present | `TABLE_QUERY DEMO_SUMDIST`, block `SCARR` | `DATA_SOURCE_BLOCKED`, path `DEMO_SUMDIST -> DEMO_CDS_SUMDIST -> SCARR` |

Representative 7.50 audit reason:

```text
code=DATA_LINEAGE_UNRESOLVED
sourcePath=[SCARR]
reason=SAP metadata request failed with HTTP 404 during lineage resolution
metadataRequests=2
executed=false
```

### After-fix behavior

The implementation threads one tri-state discovery capability into `replacementAt()`. Loaded
discovery without `/sap/bc/adt/ddic/tables` now produces `DATA_POLICY_UNAVAILABLE`; discovery that
advertises the resource follows the existing source-read path. If discovery is unavailable, a `404`
from the canonical table-source read also produces `DATA_POLICY_UNAVAILABLE`; other failures retain
`DATA_LINEAGE_UNRESOLVED`, as does a `404` when discovery advertised the resource.

The production `AdtClient` was re-run on both live systems after implementation:

| System | Request | Result |
|---|---|---|
| NPL, SAP_BASIS 750 | allowed `SAPQuery SCARR` | `DATA_POLICY_UNAVAILABLE`; one exact-search GET; zero table-source GETs; zero data POSTs |
| NPL, SAP_BASIS 750 | allowed `TABLE_QUERY SCARR` | same |
| NPL, SAP_BASIS 750 | allowed `TABLE_CONTENTS SCARR` | same |
| NPL, SAP_BASIS 750 | direct `USR02` block | `DATA_SOURCE_BLOCKED`; zero GETs; zero data POSTs |
| NPL, SAP_BASIS 750 | CDS root with blocked `SPFLI` alias | `DATA_SOURCE_BLOCKED`, path `DEMO_CDS_SUMDIST -> SPFLI` before replacement inspection |
| A4H, SAP_BASIS 758 | allowed `SCARR` | allowed and executed as before |
| A4H, SAP_BASIS 758 | block `SCARR` through `DEMO_SUMDIST` | `DATA_SOURCE_BLOCKED`, path `DEMO_SUMDIST -> DEMO_CDS_SUMDIST -> SCARR` |

An external follow-up on ECC EhP8 / SAP_BASIS 7.50 SP23 exposed the unknown-discovery case: startup
discovery returned `401` under XSUAA principal propagation, the per-user client inherited an empty
map, and all three allowed `T000` paths fell through to a canonical source `404` and generic
`DATA_LINEAGE_UNRESOLVED`. The exact sequence was reproduced in unit tests before the follow-up fix;
the three paths now return `DATA_POLICY_UNAVAILABLE` after one table-source GET and before data execution.

The contributor re-tested commit `3ce6d2af` on that same system and confirmed the production behavior:
all three `T000` paths returned `DATA_POLICY_UNAVAILABLE` after exactly one table-source `404` and no
data-preview request, while directly blocked `USR02` returned `DATA_SOURCE_BLOCKED` with zero SAP calls.

### The 7.50 fallback is incomplete

Live NPL has the standard table `DEMO_SUMDIST`; repository search classifies it as `TABL/DT`, and its
description is “Aggregation Table with Substitute Object”. Both resources available on that release
omit the relationship:

| 7.50 resource | Result |
|---|---|
| `GET /sap/bc/adt/ddic/structures/DEMO_SUMDIST/source/main` | `200 text/plain`, generated `define type demo_sumdist`, no replacement annotation |
| `GET /sap/bc/adt/vit/wb/object_type/tabldt/object_name/DEMO_SUMDIST` | `200` basic object properties XML, no replacement field/link |

On 758, discovery advertises `/sap/bc/adt/ddic/tables` with
`application/vnd.sap.adt.tables.v2+xml`, and
`GET /sap/bc/adt/ddic/tables/DEMO_SUMDIST/source/main` returns `text/plain` containing:

```abap
@AbapCatalog.replacementObject : 'demo_cds_sumdist'
define table demo_sumdist {
```

This proves that falling back to `/structures` would not merely lose editor fidelity; it would erase a
security-relevant lineage edge on a live 7.50 replacement table.

## Authoritative and independent contract evidence

- SAP's ADT documentation states that the source-based Database Table Editor/resource is available
  from SAP NetWeaver AS ABAP 7.52 SP00. The live discovery feeds agree: absent on 750, present on 758.
- SAP's 7.50 ABAP Dictionary documentation explicitly describes how to inspect a database table or
  view's replacement object in SE11 (`Extras -> Replacement Object`). SAP's ABAP 7.50 release notes
  state that CDS views can be replacement objects for database tables/views. Therefore “replacement
  objects are impossible on 7.50” is false.
- Eclipse ADT evidence in `~/DEV/arc-1-eclipse-adt` and the captured discovery contract in
  `~/DEV/mcp-abap-adt-fr0ster/docs/adt-discovery.xml` identify `/sap/bc/adt/ddic/tables` as the
  `tabldt` collection with the v2 table media type.
- `~/DEV/mcp-abap-adt/src/handlers/handleGetTable.ts` uses the same
  `/ddic/tables/<name>/source/main` read without a legacy fallback. It does not expose another
  replacement-metadata contract.
- SAP's vendored ADT language-server material under `~/DEV/arc-1-lsp` exposes repository/AFF reads but
  no independent 7.50 replacement-object metadata API. Its documented direct table metadata example
  also assumes the normal `/ddic/tables` resource.

Primary SAP references:

- [Database Tables — ADT support starts at 7.52 SP00](https://help.sap.com/docs/ABAP_Cloud/abap-development-tools-user-guide/database-tables?locale=en-US)
- [Finding a Replacement Object — SAP NetWeaver 7.50 SPS23](https://help.sap.com/docs/SAP_NETWEAVER_750/ec1c9c8191b74de98feb94001a95dd76/1201f8d4b3e54e6abe111f9f96f19c99.html?version=7.5.23)

No SAP Note is needed for the fix: this is a documented release capability boundary, not a corrected
backend defect.

## Root cause

The blocklist implementation was deliberately designed to fail closed and to inspect replacement
objects, but its original 7.50 integration test only proved that an already-blocked dependency can be
found in the old CDS graph. The “allowed unrelated table” case was skipped because that test system's
data-preview endpoint is unbound. That skip also hid the earlier metadata failure: every allowed path
reaches a transparent-table replacement check, and the check depends on an endpoint that the same
repository already knew was absent before 7.52 for `SAPWrite`.

The root cause is therefore not the fail-closed policy, search classification, or SQL parser. It is a
missing capability boundary between the release-adaptive ADT discovery layer and the replacement-lineage
reader, plus documentation that implied the experimental feature was usable on every supported release.

## Fix options considered

### Selected: discovery-gated, typed per-request denial

At `replacementAt()`, consult a tri-state resolver capability backed by the already-loaded ADT
discovery map:

- `true`: read canonical table source exactly as today;
- `false`: return `DATA_POLICY_UNAVAILABLE` before calling `/ddic/tables`, with guidance to use a
  capable target (normally 7.52+) or keep data access disabled;
- `undefined`: attempt the canonical source read. Its `404` is the only evidence that maps to
  `DATA_POLICY_UNAVAILABLE`; other failures remain `DATA_LINEAGE_UNRESOLVED`.

The check belongs at replacement inspection, not at the start of the request. That preserves:

- zero-call `DATA_SOURCE_BLOCKED` for direct matches;
- `DATA_SQL_UNSUPPORTED` for locally unsupported SQL;
- graph-visible `DATA_SOURCE_BLOCKED` for a transitive CDS dependency on 7.50 before any terminal
  table-source read;
- mixed-release multi-target operation, because support is evaluated on the selected target/client.

### Rejected: `/structures` source fallback or `TABL/DT` means no replacement

Unsafe. Replacement objects exist on 7.50, and the live fallback source for a known replacement table
omits the annotation. This would turn an availability bug into a policy bypass.

### Rejected: query DDIC persistence tables

No documented, release-stable ADT metadata contract was found. Using Data Preview/SQL to authorize
Data Preview/SQL would also create a circular policy bypass and fail on systems where that backend is
unbound or restricted. Internal DDIC storage is not an acceptable authorization contract.

### Rejected: fail process startup

Configuration is parsed before target-specific, often per-user discovery is available. A global startup
failure would also make one 7.50 destination take down a mixed 750/758 multi-target deployment. The
request-scoped discovery gate is both narrower and more accurate.

## Affected files

| File | Required change |
|---|---|
| `src/adt/data-source-policy.ts` | Add the capability input and `DATA_POLICY_UNAVAILABLE`; gate canonical table-source reads without weakening more specific denials. |
| `src/adt/client.ts` | Bind the capability to `AdtHttpClient.hasDiscoveryData()` plus `/ddic/tables` discovery presence. |
| `src/server/audit.ts` | Admit the new stable code in the typed policy audit event. |
| `tests/unit/adt/data-source-policy.test.ts` | Cover unavailable/unknown/available capability semantics and denial precedence. |
| `tests/unit/adt/client.test.ts`, `tests/unit/adt/data-source-policy-client.test.ts` | Prove loaded discovery prevents the absent HTTP request, and unknown discovery reclassifies only the canonical `404`; data remains unexecuted. |
| `tests/unit/handlers/dispatch-misc.test.ts` | Prove minimal-error output remains actionable and backend-safe. |
| `tests/integration/data-source-blocklist.integration.test.ts` | Turn the hidden 7.50 allowed-table skip into a release-specific assertion. |
| `docs_page/{authorization,configuration-reference,security-guide,tools}.md` | State the compatibility boundary and dedicated outcome without duplicating implementation detail across every setup surface. |

No tool schema, Zod input, CLI flag, config parser, authorization scope, data endpoint, or SAP mutation
changes. There is no three-file schema work.

## Out of scope

- Creating an undocumented 7.50 replacement-object resolver.
- Weakening fail-closed lineage behavior.
- Changing empty-list behavior or the SQL grammar.
- Starting the intentionally stopped 816 system; 750 versus 758 is the release-sensitive boundary.
- Posting, labeling, or closing the issue automatically.

## Recommendation

Fix it with the narrow discovery-gated outcome above. Do not implement the tolerant `/structures` or
`TRANSP` fallback.
