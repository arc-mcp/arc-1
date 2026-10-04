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
The review follow-up below also corrects parsing of SAP's empty `DB_EXISTS` value so that the
existing database-existence check actually receives false for that wire representation.

## Live evidence and fixture provenance

Only existing SAP demo definitions were read; no SAP objects or data were changed. Credentials
were loaded locally and are not included. All A4H requests used `https://a4h.marianzeis.de` on 443.

| Fixture | Provenance | SQL dependency chain |
|---|---|---|
| `cds-dependency-graph-758-view-entity.xml` | Fresh A4H 758 SP02 response | `DEMO_CDS_SPFLI_ENTITY` (`CDS_VIEW_ENTITY`) → `SPFLI` |
| `cds-dependency-graph-758-projection.xml` | Fresh A4H 758 SP02 response | `DEMO_MANAGED_ROOT_PROJ` (`CDS_PROJECTION_VIEW`) → `DEMO_MANAGED_ROOT_WAS` (`CDS_VIEW_ENTITY`) → `DEMO_TAB_ROOT_3` |
| `cds-dependency-graph-816-view-entity.xml` | Sanitized 816 SP01 response supplied by the issue reporter; copied from #912 | Projection → two view entities → classic CDS views → four tables; three DCL entries |
| `cds-dependency-graph-758-analytical-query.xml` | Fresh A4H 758 SP02 response during review follow-up | `DEMO_ANALYTICAL_QUERY`: `CDS_PROJECTION_VIEW` with empty `DB_EXISTS` and populated children |

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

The initial self-review missed the empty-property case subsequently identified by Claude; see
the correction and fresh regression evidence below. Passing kind tests alone did not establish
that the database-existence check was exercised by real SAP XML.

## Remaining boundaries

No fresh 816 SP01 or BTP CF multi-target/principal-propagation run of this PR was available.
The reporter supplies separate deployed 816 evidence for equivalent kind handling in #915,
summarized below. This PR's own 816 coverage remains fixture replay. The 758 transient analytical
query is now refused on empty `DB_EXISTS`. Table functions and unobserved graph kinds still fail closed.

COMPAT-07 remains open: direct entity traversal does not map a DDIC table's view-entity replacement
through `DD02L.VIEWREF` / `DDLDEPENDENCY`. The existing `OBJECTTYPE='VIEW'` join is unchanged. The
reporter's `STOB` observation is useful evidence, but a real table-to-replacement identity capture
is still required before broadening that join.

## Review follow-up

Reviewed the user-supplied Claude report and all of closed
[PR #915](https://github.com/arc-mcp/arc-1/pull/915), commit
`f5ee3673604826a0c23c1a6899b7020aceefb198`, by issue author Thomas Kaltbeitzel (`kalti-enbw`).

| Finding | Assessment and action |
|---|---|
| Empty `DB_EXISTS` is lost | Confirmed on fresh A4H XML. Preserve empty keyed properties with `value ?? ''`; no new traversal branch needed. |
| Inactive tests only mutate parsed objects | Valid gap. Add captured analytical-query XML, raw empty/whitespace nested-property tests, legacy omitted-property compatibility, and no-POST checks across all three governed data methods. |
| New kind comment overclaims 750 coverage | Corrected to identify 758 SP02 and 816 SP01 for view-entity/projection kinds, adopting #915's distinction. |
| Old red/green totals | Original 17-case figures described an earlier test cohort. The submitted `2c2f034e` change has 22 new unit cases; Claude verified all 22 fail on baseline and 17 fail with parser-only changes. Current follow-up totals are recorded in the PR. |
| Harder lineage shapes | Rechecked `DEMO_CDS_ASSOCIATION_VE` and `DEMO_CDS_PV_PARENT` live. Added allow/deny integration cases for dereferenced association targets and a nested projection. |
| Reporter credit and additional evidence | Follow-up commit uses Thomas's published author identity, as requested. Cite #915's deployed evidence separately from tests of this branch. |
| Stale `DATA_SOURCE_UNRESOLVED` docs | Corrected the two operator tables to current error codes. |
| CDS set-operation graphs | Reproduced the existing `TYPE=SELECT` rejection on `DEMO_CDS_UNION_VE`. Documented the distinction from caller SQL `UNION` and parked COMPAT-10. No new graph kinds accepted. |
| Implicit conversion tables | Confirmed omission from four live demo graphs. Documented the coverage limit and parked SEC-18; no speculative source parser or table allowlist added. |

### Empty-property reproduction and fix

`DEMO_ANALYTICAL_QUERY` declares `define transient view entity ... provider contract analytical_query`.
The live graph contains `<abapsource:entry abapsource:key="DB_EXISTS"/>` on its
`CDS_PROJECTION_VIEW` root, which still has seven SQL nodes including ordinary database tables.

At `2c2f034e`, the parser drops this entry and `databaseExists` becomes undefined. A bounded query
with `USR02` blocked gets a policy allow (`metadataRequests=5`, `graphNodes=7`), followed by SAP
HTTP 400: entities of this kind cannot be used there. This reproduced the reviewer's behavior
change; it did not return application rows.

The one-line parser change preserves present-but-empty values. The existing conversion to
`databaseExists: false` and existing refusal then apply before catalog or application POSTs.
Omitted `DB_EXISTS` remains undefined for the captured legacy 750 graph. Empty `TYPE` still fails
classification; empty aliases, relation and DCL flags do not become data sources or grants.

Before the change, three new raw-XML regression cases failed (analytical root plus two nested
empty representations), while the legacy omission control passed. After the change, parser,
evaluator and client tests pass. Fresh A4H tests deny the analytical query on `SAPQuery`,
`TABLE_QUERY` and `TABLE_CONTENTS` with zero POSTs and retain the existing allowed demo reads.
Replaying the final 105 focused cases against previous PR head `2c2f034e` gives six failures
(three raw-XML cases plus three client denials) and 99 passes; restoring the fix gives 105 passes.
The review follow-up's full unit suite passes 7,799 tests. Typecheck, lint, policy validation, build and
size/schema checks also pass. The rebuilt CLI independently denies the analytical query with two
metadata requests, while the ordinary transactional projection still succeeds.

The extended live suite passes 24 tests with the same three pre-existing cluster-table fixture
skips. The additional cases include `DEMO_CDS_ASSOCIATION_VE → SCARR` and
`DEMO_CDS_PV_PARENT → DEMO_CDS_PV_CHILD → DEMO_CDS_VIEW_CHILD → DEMO_DDIC_TYPES`.
The association allow case returns a carrier row; the nested projection returns its expected
column with zero rows. No 553-graph scan was repeated and no SAP objects/data were changed.

After merging main `b65276d8` (which added unrelated navigation/dependency tests), the combined
branch passes 7,826 unit tests across 256 files and repeats the live suite at 24 passed / 3 skipped.
Typecheck, lint, policy validation, build and size/schema checks pass again. The only merge conflict
was the roadmap's adjacent compatibility rows; both branches' ideas and evidence are preserved.

### What transfers from PR #915

The two production kind checks accept the same exact kinds in #914 and #915. #915 uses separate
parser and traversal lists; #914 keeps its single tuple to prevent drift. Both originally drop
empty `DB_EXISTS`, so #915 does not address Claude's finding. Its seven added tests overlap the
coverage already in #914, including direct entity roots, childless nodes, blocked intermediates,
mixed graphs and terminal-table inspection. Its 816 XML adds a declaration and provenance comment
to the same issue capture; this PR preserves the original issue bytes and documents provenance here.

Thomas reports testing v1.5.0 plus #915's change in MTAR `arc1-mcp_1.5.0+fix912` on S/4HANA
SAP_BASIS 816 SP01, BTP CF `/multi/mcp`, principal propagation and VS Code/GitHub Copilot.
He reports successful view-entity/root/projection reads, aggregates, a join with a transparent
table and `TABLE_QUERY`; the standard view entity `CUAN_ME_ME_QR_AUTH_USER_SEARCH` is correctly
blocked through `USR02`, including its `TABLE_QUERY` and join variants. This is useful independent
evidence for the equivalent kind change. It does not establish 816 coverage of this exact commit
or the later empty-property correction.

### Separately tracked limitations

Fresh source/graph reads for `DEMO_CDS_CURR_CONV` / `DEMO_CDS_CURR_CONV_VE` show
`currency_conversion` but list only `DEMO_PRICES` as the terminal table. The corresponding
`DEMO_CDS_UNIT_CONVERSION` / `DEMO_CDS_UNIT_CONVERSION_VE` pair uses `unit_conversion` and lists
only `DEMO_EXPRESSIONS`. SAP documents [currency conversion's TCUR tables](https://help.sap.com/docs/SUPPORT_CONTENT/bwplaolap/3361384061.html)
and [unit conversion's T006 settings](https://help.sap.com/docs/SUPPORT_CONTENT/abapcdsaq/5430648154.html).
The graphs therefore omit implicit dependencies for classic views as well as view entities.
This follow-up inspected metadata; it did not trace database accesses or query blocked
customizing data. SEC-18 captures the remaining proof/design work.

`DEMO_CDS_UNION_VE` still fails closed at its structural `SELECT` nodes. Supporting their
non-object identities and all set-operation branches requires separate captured-contract work
(COMPAT-10); merely broadening `SQL_NODE_KINDS` would be insufficient.
