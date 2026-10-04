# Issue #912: view entities and projection lineage

Date: 2026-10-04. Baseline: `00ef94514` (ARC-1 1.5.0).
[Issue](https://github.com/arc-mcp/arc-1/issues/912) ·
[Reviewed implementation plan](../plans/2026-10-04-issue-912-cds-view-entity-lineage.md)

## Root cause

The bug is independent of principal propagation or multi-target routing. It reproduces through
the local ADT client on A4H, SAP_BASIS 758 SP02, client 001, using HTTPS Basic authentication.
The same guard is used behind `SAPQuery`, `TABLE_QUERY`, and `TABLE_CONTENTS`.

Repository search correctly resolves the entity's `STOB/DO` result to a DDLS source. The graph
request also succeeds. Two explicit kind checks then prevent normal CDS traversal:

1. `SQL_NODE_KINDS` excluded `CDS_VIEW_ENTITY` and `CDS_PROJECTION_VIEW`, causing the parser to
   throw before recording any graph nodes.
2. `validateGraph` separately accepted only `CDS_VIEW`. Expanding the parser's list alone leaves
   `dependency kind CDS_VIEW_ENTITY/CDS_PROJECTION_VIEW is unsupported` at evaluation time.

The fix shares one three-value `CDS_VIEW_KINDS` tuple between those checks. Everything after kind
classification stays on the existing path: exact alias matching, database-existence validation,
nonempty child requirement, recursive traversal and terminal-table replacement inspection.
There are no new settings, arguments, release conditions, endpoints or caches.

## Live evidence and fixture provenance

Only existing SAP demo definitions were read; no SAP objects or data were changed. Credentials
were loaded locally and are not included. All A4H requests used `https://a4h.marianzeis.de` on 443.

| Fixture | Provenance | SQL dependency chain |
|---|---|---|
| `cds-dependency-graph-758-view-entity.xml` | Fresh A4H 758 SP02 response | `DEMO_CDS_SPFLI_ENTITY` (`CDS_VIEW_ENTITY`) → `SPFLI` |
| `cds-dependency-graph-758-projection.xml` | Fresh A4H 758 SP02 response | `DEMO_MANAGED_ROOT_PROJ` (`CDS_PROJECTION_VIEW`) → `DEMO_MANAGED_ROOT_WAS` (`CDS_VIEW_ENTITY`) → `DEMO_TAB_ROOT_3` |
| `cds-dependency-graph-816-view-entity.xml` | Sanitized 816 SP01 response supplied by the issue reporter; copied from #912 | Projection → two view entities → classic CDS views → four tables; three DCL entries |

Fresh graph requests used:

```text
GET /sap/bc/adt/ddic/ddl/dependencies/graphdata?ddlsourceName=<DDLS>&addMetrics=false
Accept: application/vnd.sap.adt.ddl.SQLDependencyModel.v3+xml
```

Both new kinds returned HTTP 200 with `DB_EXISTS=X`. The entity and DDLS names agree in the
758 captures; the 816 capture also exercises mixed-case `ENTITY_NAME` and distinct classic-CDS
SQL aliases. Search returned `DDLS/DF` and `STOB/DO` pointing to the same DDLS resource.

The source of `DEMO_MANAGED_ROOT_PROJ` explicitly declares `provider contract transactional_query`.
Its underlying `DEMO_MANAGED_ROOT_WAS` is a `define root view entity`. This verifies all three
source forms without creating fixtures in SAP.

SAP's [Dependency Analyzer documentation](https://help.sap.com/docs/ABAP_PLATFORM_NEW/c238d694b825421f940829321ffa326a/bedc1723e35244e188c5a44a5f4f8340.html)
describes SQL dependencies as the graph's scope; the exact wire kinds above are established by
the captures. [Projection-view documentation](https://help.sap.com/docs/abap-cloud/abap-data-models/cds-projection-views?locale=en-US)
provides language context; it is not used to assume that every projection/provider contract is
queryable through the freestyle endpoint.

## Candidate experiments

| Candidate | Result |
|---|---|
| Baseline unchanged | Live view-entity and projection queries with blocklist `USR02` denied with `DATA_LINEAGE_UNRESOLVED`, `metadataRequests=2`, `graphNodes=0`. All 17 initial new regression cases failed. |
| Parser expanded, evaluator unchanged | 5 initial regression cases passed, 12 failed. Parsing succeeds but evaluator rejects the new kinds. Candidate rejected. |
| Shared tuple at both checks | Focused regressions pass; live allowed queries reach SAP; blocked descendants deny before data POST. |

The parser-only candidate was a temporary local experiment and was restored before final checks.
Disabling the blocklist, matching arbitrary `CDS_*` kinds, or treating view entities as terminal
tables would avoid the symptom without proving lineage; none is part of this fix.

## Live results with the fix

The current source was exercised through the integration suite, then `npm run build` output
through `arc1-cli call SAPQuery`. This is local CLI/client coverage, not HTTP/XSUAA/PP coverage.

| Request | Blocklist | Observed result |
|---|---|---|
| `SELECT CARRID FROM DEMO_CDS_SPFLI_ENTITY`, maxRows 1 | `USR02` | Allowed; returned one demo carrier row |
| `SELECT KEY_FIELD FROM DEMO_MANAGED_ROOT_WAS`, maxRows 1 | `USR02` | Allowed; `KEY_FIELD` column, zero rows in this fixture |
| `SELECT KEY_FIELD FROM DEMO_MANAGED_ROOT_PROJ`, maxRows 1 | `USR02` | Allowed; `KEY_FIELD` column, zero rows; SAP accepts this transactional projection query |
| Same view entity | `SPFLI` | `DATA_SOURCE_BLOCKED`, path `DEMO_CDS_SPFLI_ENTITY → SPFLI`; no data POST |
| Same root/projection | `DEMO_TAB_ROOT_3` | `DATA_SOURCE_BLOCKED`; complete root/projection → underlying table path; no data POST |

CLI reproduction (with local SAP credentials configured):

```bash
SAP_URL=https://a4h.marianzeis.de SAP_CLIENT=001 SAP_INSECURE=false \
SAP_ALLOW_FREE_SQL=true SAP_BLOCKED_DATA_SOURCES=USR02 \
node dist/cli.js call SAPQuery \
  --json '{"sql":"SELECT CARRID FROM DEMO_CDS_SPFLI_ENTITY","maxRows":1}'
```

The actual CLI runs explicitly disabled writes, transport writes and Git writes. Repeat with
`DEMO_MANAGED_ROOT_PROJ` / `KEY_FIELD` and blocklist `DEMO_TAB_ROOT_3` for the denial (CLI exit 1).

## Review and verification

- Parser, evaluator and client regressions cover mixed kinds, nested aliases/tables, inactive and
  childless nodes, mismatched roots, later DCL siblings, unknown kinds and table functions.
- Review added an explicit terminal-table replacement denial beneath the new kinds. The existing
  replacement traversal was unchanged, but checking metadata calls alone did not prove that denial.
- Client and live denial tests assert no catalog/application POST for a blocked graph descendant.
  Unblocked reads still inspect terminal-table replacement metadata before their application POST.
- The live blocklist suite passed 17 tests; three existing cluster-table cases skipped because
  A4H's `BSEG` is not a cluster-table fixture. All six new live cases passed.
- Final automated check totals and build revision are recorded in the PR. Unit, typecheck, lint,
  policy, build and size/schema checks were run; the public tool schema is unchanged.

Final scope review found no further actionable defect in the change. This is not a claim of
exhaustive coverage across all SAP releases or provider contracts.

## Remaining boundaries

No fresh 816 SP01 or BTP CF multi-target/principal-propagation run was available; the 816 result
is fixture replay. The particular 758 transactional projection succeeds, but SQL restrictions for
other providers remain SAP's decision. Table functions and unobserved graph kinds still fail closed.

COMPAT-07 remains open: direct entity traversal does not map a DDIC table's view-entity replacement
through `DD02L.VIEWREF` / `DDLDEPENDENCY`. The existing `OBJECTTYPE='VIEW'` join is unchanged. The
reporter's `STOB` observation is useful evidence, but a real table-to-replacement identity capture
is still required before broadening that join.
