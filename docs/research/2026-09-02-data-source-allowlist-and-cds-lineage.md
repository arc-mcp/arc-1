# Data-source allowlisting with CDS lineage enforcement

**Date:** 2026-09-02

**Status:** Production allowlist concept complete; minimal experimental blocklist implemented and verified

**Scope:** `SAPQuery`, `SAPRead(TABLE_CONTENTS)`, `SAPRead(TABLE_QUERY)`, and adjacent fixed-query consumers

## Executive decision

ARC-1 can enforce an object-level data boundary, but a single flat table/view allowlist is not sufficient.
The recommended design is a **root-scoped, deny-overrides data-policy manifest**:

- A `root` is an object the caller may select directly.
- Each root has an administrator-reviewed set of dependencies that may contribute data transitively but
  are **not** thereby selectable directly.
- Every direct SQL source is parsed before SAP is called. Every CDS root is expanded through SAP's own
  active SQL dependency graph. Replacement objects and table-function implementations are resolved as
  additional edges.
- An unlisted direct source, an unapproved transitive dependency, an explicit deny, an ambiguous alias,
  an unsupported source kind, a parser failure, or incomplete lineage blocks the request.
- `WITH PRIVILEGED ACCESS`, host expressions, dynamic data sources, client overrides, secondary database
  connections, external schemas, and CDS association path expressions are rejected in the first strict
  version.

The rollout should be staged:

1. **Immediately disable ARC-1 SQL/data preview on the live A4H instance until SAP Security Note
   3772411 is applied.** A4H is SAP_BASIS 758 SP02; SAP identifies 758 SP07 as the corrected support
   package. The note is not present in A4H's SNOTE header table. No exploit was attempted.
2. Ship strict allowlisting for the server-built, single-root `TABLE_QUERY` and unfiltered
   `TABLE_CONTENTS` paths first. Keep `SAPQuery` disabled in restricted deployments.
3. Add a deliberately narrow, AST-validated `SAPQuery` subset only after the parser, lineage resolver,
   alias handling, and negative bypass corpus are complete.
4. For the highest-assurance production data plane, expose curated CDS data products through SAP SQL
   services (or an application API) and leave ADT freestyle SQL disabled.

This is an **object boundary**, not row- or column-level data loss prevention. Freezing the CDS definition
with an optional digest can also prevent a previously approved view from exposing new fields or removing
filters without policy review.

## Minimal experimental blocklist follow-up

The first implementation deliberately does not attempt the full root-scoped manifest above. It introduces
one optional exact-name emergency brake, `SAP_BLOCKED_DATA_SOURCES`. An empty list preserves current
behavior. A non-empty list activates strict pre-execution analysis across the three data-preview entry
points and denies both direct matches and matches in SAP's active CDS dependency graph.

The adversarial implementation review rejected a direct-name-only version for four concrete reasons:

1. `SAPQuery` can place sources in joins, unions, nested subqueries, and CTEs.
2. A queryable CDS entity name must first be mapped to its DDLS source before the graph endpoint can be
   called.
3. A transparent DDIC table can carry `@AbapCatalog.replacementObject`, so selecting the table can execute a
   CDS view with a different lineage.
4. ARC-1 cannot currently prove the base lineage of a classic `VIEW/DV`, and the CDS graph identifies table
   functions without expanding their AMDP `USING` dependencies.

Accordingly, the experimental mode fails closed on incomplete SQL or lineage rather than pretending the
configured list was checked. Its initial free-SQL subset is one completely parsed, static ABAP SQL
`SELECT`/`WITH`; host expressions, dynamic sources, privileged access, client overrides, secondary
connections, association paths, and unsupported grammar are refused. Filtered DDIC preview is also refused;
structured `TABLE_QUERY` remains available.

Live revalidation on 2026-09-02 confirmed the two graph contracts used by the implementation plan:

| Target | Root response | Terminal sources | Required media type |
|---|---|---|---|
| SAP_BASIS 758 A4H | `DDLS/DF DEMO_CDS_SUMDIST` with entity/database aliases | `TABL/DT SCARR`, `TABL/DT SPFLI` | `application/vnd.sap.adt.ddl.SQLDependencyModel.v3+xml` with `addMetrics=true` |
| SAP_BASIS 750 NPL | `STOB/DO demo_cds_sumdist` | `TABL/DT SCARR`, `TABL/DT SPFLI` | `application/vnd.sap.adt.elementinfo+xml` |

Exact ADT search on 758 also returned the queryable `STOB/DO` entry with a URI under
`/ddic/ddl/sources/<DDLS>/source/main#name=<entity>`, which is the non-heuristic entity-to-DDLS mapping.
The generated SQL view `DEMO_CDS_AGG` appeared only as `VIEW/DV`, while its source DDLS was
`DEMO_CDS_AGGREGATE`; the initial policy therefore refuses that alias instead of parsing a localized
description. Table source for `DEMO_SUMDIST` again showed replacement object `DEMO_CDS_SUMDIST`.

The reviewed executable plan is
[docs/plans/completed/2026-09-02-experimental-data-source-blocklist.md](../plans/completed/2026-09-02-experimental-data-source-blocklist.md).

The final security pass changed three implementation details before release. Replacement annotations are now
recognized by a small DDL lexer that ignores SAP-documented
[ABAP DDL line and block comments](https://help.sap.com/docs/ABAP_PLATFORM/f2e545608079437ab165c105649b89db/4ed24bd56e391014adc9fffe4e204223.html?version=1709.008)
and unrelated quoted literals;
duplicate, malformed, or unterminated constructs fail closed. SAP API/network failures are converted to stable,
client-safe lineage reasons so `ARC1_MINIMAL_ERRORS` cannot be bypassed by retyping a backend error as a policy
error. Dependency XML is capped at 5,000,000 characters before the XML parser, in addition to the 64-level and
1,000-node traversal limits.

The final maintainability pass also moved the existing structured `TABLE_QUERY` builder to
`src/adt/table-query.ts` and kept the live metadata adapter beside the lineage evaluator. This reduced the ADT
client facade to 1,642 lines and tightened its CI size budget from 1,730 to 1,680 lines instead of raising the
ratchet for the feature.

## Goal and security property

The desired property is:

> A request may return data only when every caller-controlled entry point is explicitly queryable and
> every object that can contribute data to that request belongs to the reviewed dependency closure for
> that entry point. Explicit denies win at every level.

Examples:

- If only `TABL:SCARR` is a root, `SELECT * FROM SCARR` is allowed and `SELECT * FROM SPFLI` is blocked.
- If `DDLS:DEMO_CDS_SUMDIST` is a root with dependencies `TABL:SCARR` and `TABL:SPFLI`, querying the CDS
  root is allowed. Querying `SPFLI` directly is still blocked.
- A higher CDS view is blocked unless it is itself an approved root. If it is approved but its live
  lineage adds `TABL:SFLIGHT`, it is blocked until that dependency is reviewed and added.
- A deny on `TABL:USR02` blocks direct access and any approved-looking view that resolves to `USR02`.

### Non-goals

- Row filters, field masking, aggregation thresholds, purpose limitation, and result-content scanning.
- Treating CDS DCL as a substitute for the object boundary.
- Governing every possible data-bearing ARC-1 response. Dumps, traces, source code, arbitrary extension
  `ctx.http.get()` calls, and application APIs need their own controls if the requirement is full DLP.
- Replacing SAP authorization. The ARC-1 policy is an additional server ceiling.

## Current ARC-1 behavior

ARC-1 currently has capability gates, not data-object gates.

| Surface | Scope and safety gate | SAP endpoint | Current object restriction |
|---|---|---|---|
| `SAPRead(TABLE_CONTENTS)` | `data` + `allowDataPreview` | `POST /sap/bc/adt/datapreview/ddic` | None |
| `SAPRead(TABLE_QUERY)` | `data` + `allowDataPreview` | `POST /sap/bc/adt/datapreview/freestyle` | Single server-built source, but any valid name |
| `SAPQuery` | `sql` + `allowFreeSQL` | `POST /sap/bc/adt/datapreview/freestyle` | None; caller supplies SQL |
| `SAPSearch(tadir_lookup, source=db|both)` | `sql` + `allowFreeSQL` | Freestyle SQL over `TADIR` | Fixed ARC-1 query |
| Authorization trace and some code-intelligence fallbacks | `data`/`sql` gates | Fixed queries over metadata tables | Fixed ARC-1 query |

The call chain is:

```text
MCP arguments
  -> dispatch scope / deny-action / Zod checks
  -> SAPRead or SAPQuery handler
  -> AdtClient.getTableContents / runTableQuery / runQuery
  -> data-preview POST
```

`src/adt/safety.ts` knows only the booleans `allowDataPreview` and `allowFreeSQL`. The authorization matrix
in `src/authz/policy.ts` separates `data` and `sql` scopes, but neither layer evaluates an object name or
query. `src/handlers/query.ts` contains targeted regular expressions for IN-list chunking and error
enrichment; it is not a security SQL parser. The public documentation explicitly says the package
allowlist is write-only and that read restrictions must currently be enforced in SAP roles.

The enforcement point must be below all user-facing handlers and before the HTTP POST. Otherwise a newly
added caller of `AdtClient.runQuery()` can bypass a handler-only check. Fixed internal metadata queries
need a separate, non-public control-plane capability rather than a caller-settable bypass flag.

## Authoritative SAP findings

### CDS DCL is entry-point authorization, not transitive authorization

SAP documents that CDS access control applies to the CDS entity selected directly in ABAP SQL. A
consuming CDS entity does not automatically inherit the DCL of its data source; the higher entity needs
its own access control. SAP also documents that `WITH PRIVILEGED ACCESS` disables the CDS check. See
[Access Control](https://help.sap.com/docs/ABAP_PLATFORM_NEW/67e4075c942e43d4a9f6f891a8dafcf4/85cb9cf7c3eb442b82451a8294747785.html),
[ABAP Authorization Concept for CDS Entities](https://help.sap.com/docs/ABAP_PLATFORM_NEW/ad77b44570314f6d8c3a8a807273084c/42e2fef6fdd74d7e9195d58aae2b83f6.html),
and [Accessing CDS Objects](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/accessing-cds-objects).

Consequences:

- Allowing a higher view because an underlying view has DCL is unsafe.
- Allowing a lower view does not authorize an unlisted higher view.
- The strict SQL subset must reject privileged access even if SAP would authorize its use.
- A CDS annotation such as `#NOT_REQUIRED` or `#NOT_ALLOWED` is not evidence that the data is acceptable.

### Requested names do not fully identify runtime data sources

ABAP SQL supports DDIC tables/views, CDS persistent entities, table functions, hierarchies, path
expressions, and newer external entities. A DDIC table or view may have a CDS replacement object, and
selecting the DDIC object then accesses the replacement. Accessing the generated DDIC SQL view behind an
obsolete CDS view loses CDS semantics including DCL and CDS client handling. See
[SELECT, data source](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABAPSELECT_DATA_SOURCE.html)
and [Replacement Object](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENREPLACEMENT_OBJECT_GLOSRY.html).

CDS associations are joins on demand. An association target may not contribute data to a normal select,
but a path expression can instantiate it. See
[Associations](https://help.sap.com/docs/abap-cloud/abap-data-models/cds-associations?version=sap_cross_product_abap).

Consequences:

- Policy identities must be typed and canonical; string equality on the submitted name is inadequate.
- Replacement edges must be expanded.
- Generated SQL view aliases should be refused in strict mode; callers should use the CDS entity.
- Version 1 should reject caller-supplied association paths. This avoids granting a latent navigation
  capability that is absent from the root's ordinary dependency graph.

### SAP provides an active CDS SQL dependency graph

SAP's Dependency Analyzer is intended to show the database tables, database views, CDS views, and CDS
table functions used by a CDS view. See
[Dependency Analyzer](https://help.sap.com/docs/ABAP_PLATFORM_NEW/f2e545608079437ab165c105649b89db/bedc1723e35244e188c5a44a5f4f8340.html).

The Eclipse ADT 3.60 bundles independently confirm the discovery relation and media types:

- Discovery relation:
  `http://www.sap.com/adt/categories/ddic/ddl/dependencies/graphdata`
- URI template:
  `/sap/bc/adt/ddic/ddl/dependencies/graphdata{?ddlsourceName*,addMetrics*}`
- New media types:
  `application/vnd.sap.adt.ddl.SQLDependencyModel.v1+xml` through `v3+xml`
- Older media type:
  `application/vnd.sap.adt.elementinfo+xml`

This endpoint is a stronger security input than `src/context/cds-deps.ts`. The current helper parses CDS
with regular expressions and, on the live `I_ABAPPACKAGE` source, incorrectly treated the keyword
`parent` from `association to parent ...` as a dependency. That is acceptable for best-effort context;
it is not acceptable for an authorization decision.

### CDS table functions can be resolved, but need a second step

The dependency graph identifies a table-function node but does not expand its implementation tables.
The table-function DDL names its `implemented by method` target. SAP requires ABAP-managed database
objects used by an AMDP procedure/function to be declared in the method's `USING` list. The list can also
refer to other AMDP methods. External logical schemas have separate syntax. See
[METHOD, BY DATABASE PROCEDURE/FUNCTION](https://help.sap.com/docs/abap-cloud/abap-keyword/method-by-database-procedure-function-graph-workspace?locale=en-US&state=PRODUCTION&version=latest)
and [Table Functions](https://help.sap.com/docs/ABAP_PLATFORM_NEW/67e4075c942e43d4a9f6f891a8dafcf4/ed4c5fc6d3fd43ebb355f12aa1e73757.html).

For an initial strict release, the defensible rule is to reject any graph containing a table function.
A later release can resolve the DDL source, the implementing class method, and all transitive `USING`
entries, while rejecting `USING SCHEMA`, missing source, or parser ambiguity.

### SAP authorization is useful defense in depth, not the requested lineage boundary

SAP Security Note [3772411](https://me.sap.com/notes/3772411) and its explanatory Note
[3776714](https://me.sap.com/notes/3776714) state that the ADT SQL Console is a generic table-access
surface governed by `S_TABU_NAM`/`S_TABU_DIS`; the temporary mitigation for the 2026 vulnerability is to
remove both authorizations. KBA [3664213](https://me.sap.com/notes/3664213) says Data Preview uses
`VIEW_AUTHORITY_CHECK`, checks those objects, and can fall back to broader development authorization in
some private-cloud scenarios.

`S_TABU_NAM` can name a table or view exactly; `S_TABU_DIS` grants by table authorization group. These are
valuable least-privilege controls, but the evidence does not establish a transitive base-source check for
every CDS wrapper. They therefore cannot satisfy this requirement alone.

`S_SQL_VIEW` is frequently confused with the ADT SQL Console. SAP documents it for privileged **SQL
services** exposed through SQL service definitions/bindings, not for ADT Data Preview. See
[Authorization Objects and Access Control for SQL Services](https://help.sap.com/docs/ABAP_PLATFORM_NEW/d28ccbeac239408eb37cd06d3de41ef6/68cd63c47a824a3eb2a45fe5998f026e.html).

## Verified live contracts and behavior

### SAP_BASIS 758: A4H

The following checks were run with the repository CLI against A4H client 001. Result data is summarized;
no credentials or sensitive row values are retained here.

| Check | Observed result |
|---|---|
| `SAPQuery: SELECT * FROM SCARR` | Succeeded; direct arbitrary table access when SQL gate is open |
| `SAPQuery: SELECT * FROM I_ABAPPACKAGE` | Succeeded; CDS entity access |
| `SCARR INNER JOIN SPFLI` | Succeeded; multiple direct sources in one request |
| `I_ABAPPACKAGE WITH PRIVILEGED ACCESS` | Succeeded; the backend accepted explicit DCL bypass syntax |
| `TABLE_CONTENTS SCARR` | Succeeded through the DDIC endpoint |
| `TABLE_QUERY I_ABAPPACKAGE` | Succeeded through the freestyle endpoint |
| Graph `I_ABAPPACKAGE` | Root `DDLS:I_ABAPPACKAGE`, data source `TABL:TDEVC`, DCL state included |
| Graph `DEMO_CDS_SUMDIST` | `TABL:SCARR` and `TABL:SPFLI` |
| Graph `DEMO_CDS_ASSOCIATION` | `SPFLI` plus `SCARR`; the CDS projection dereferences the association |
| Graph `DEMO_CDS_ASSOC_SPFLI_SCARR` | Only `SPFLI`; the association is merely exposed and not instantiated |
| Graph `CDS_WITH_TABLE_FUNCTION_3` | Transitive nested CDS views plus three table-function nodes |
| `DEMO_CS_TABLE_FUNCTION` implementation | `CL_DEMO_CS_AMDP=>FLIGHT_ANALYSIS` declares two tables in `USING` |
| Replacement table `DEMO_SUMDIST` | Table source declares replacement `DEMO_CDS_SUMDIST`; querying it returns the replacement view's result shape |

The SAP/Eclipse contract and live 758 endpoint support:

```text
GET /sap/bc/adt/ddic/ddl/dependencies/graphdata
    ?ddlsourceName=DEMO_CDS_SUMDIST
    &addMetrics=true
Accept: application/vnd.sap.adt.ddl.SQLDependencyModel.v3+xml
```

The response was `200` with media type `...SQLDependencyModel.v3+xml` and nested
`abapsource:elementInfo` nodes. Each dependency carries `adtcore:type`, `adtcore:name`, and properties
such as `TYPE`, `RELATION`, `ENTITY_NAME`, `NODE_NAME`, and access-control state. The response content,
not only its status, was checked.

A repeat implementation-time probe found that the live endpoint can be omitted from ARC-1's parsed discovery
map even while the direct request succeeds. The implementation therefore uses the advertised media type when
available and otherwise probes the fixed read-only endpoint with v3, then the old element-info media type only
after media negotiation rejects v3. Any absence or malformed response remains a hard denial.

### SAP_BASIS 750: NPL750

The 7.50 endpoint supports the same dependency request without requiring `addMetrics`:

```text
/sap/bc/adt/ddic/ddl/dependencies/graphdata{?ddlsourceName*}
```

It requires the older `Accept: application/vnd.sap.adt.elementinfo+xml`. Live graph reads for
`DEMO_CDS_SUMDIST` and `DEMO_CDS_ASSOCIATION` returned `200` and the expected `SCARR`/`SPFLI` nodes.

On this particular NPL installation, all three data execution paths returned `404 No suitable resource
found` even though discovery lists them:

- `/sap/bc/adt/datapreview/ddic`
- `/sap/bc/adt/datapreview/freestyle` through `TABLE_QUERY`
- `/sap/bc/adt/datapreview/freestyle` through `SAPQuery`

This is the already documented unbound-handler condition, not an allowlist behavior difference. The
policy must run before the data endpoint, so it remains testable on 7.50 even when execution cannot
complete.

Implementation-time verification found two additional 7.50 wire differences: quick search decorates exact
names as `SCARR (Database Table)` / `DEMO_CDS_SUMDIST (Entity)` and pairs the latter with a decorated
`DDLS/DF` result; and the generic `/ddic/structures/` TABL fallback omits a real table's replacement-object
annotation. The resolver strips only the final display decoration while retaining exact technical-name matching.
The policy scans all graph aliases before replacement reads, then requires the canonical table-source endpoint
for replacement proof. Consequently it still returns the precise blocked path for known graph matches on 750,
but otherwise fails unresolved when that canonical endpoint is absent rather than treating lossy fallback source
as evidence that no replacement exists.

### SAP_BASIS 816

The local 816 container was intentionally offline during this research and was not started for a
read-only concept study. The design does not rely on a 758-only parser feature: it negotiates the
dependency media type from discovery and fails closed on unknown shapes. Nevertheless, 816 must be in
the implementation integration matrix because ARC-1 deliberately demotes some `abaplint` parser errors
above release 758 for linting; an authorization parser must never inherit that permissive behavior.

### SAP Security Note 3772411 applicability on A4H

- Live component: `SAP_BASIS 758`, support package `SAPK-75802INSAPBASIS` (SP02).
- SAP's correction list for 758 names `SAPK-75807INSAPBASIS` (SP07).
- A fixed read of A4H's SNOTE header for Notes 3772411, 3776714, and 3790544 returned no rows.
- No host-expression method call or DML proof of concept was executed. Version/support-package and SNOTE
  evidence is enough to require mitigation.

The allowlist feature does not replace this patch. Rejecting every host expression is defense in depth,
but the SAP correction remains mandatory.

### Representative verification commands

The live calls used the repository CLI with connection details supplied through the existing environment;
credentials are intentionally omitted. Representative commands were:

```bash
node dist/cli.js --allow-free-sql true sql "SELECT * FROM SCARR" --output json
node dist/cli.js --allow-free-sql true sql \
  "SELECT * FROM I_ABAPPACKAGE WITH PRIVILEGED ACCESS" --output json
node dist/cli.js --allow-data-preview true call SAPRead \
  --json '{"type":"TABLE_CONTENTS","name":"SCARR"}' --output json
node dist/cli.js --allow-data-preview true call SAPRead \
  --json '{"type":"TABLE_QUERY","name":"I_ABAPPACKAGE"}' --output json
```

The graph contract was verified with an authenticated `GET` to the discovery-advertised URI, negotiating
the release-specific response type rather than hard-coding a single version:

```text
758: /sap/bc/adt/ddic/ddl/dependencies/graphdata
       ?ddlsourceName=DEMO_CDS_SUMDIST&addMetrics=true
     Accept: application/vnd.sap.adt.ddl.SQLDependencyModel.v3+xml

750: /sap/bc/adt/ddic/ddl/dependencies/graphdata
       ?ddlsourceName=DEMO_CDS_SUMDIST
     Accept: application/vnd.sap.adt.elementinfo+xml
```

The checks retained and inspected the returned XML/JSON content in temporary files during research; no
data rows, cookies, passwords, or authorization headers were committed. No new replay fixture is committed
because the task is a design study, while implementation will need sanitized 7.50 and 7.58 graph fixtures.

## Cross-implementation findings

- `~/DEV/arc-1-eclipse-adt/api/21-data-preview-and-query.md` confirms the two data-preview endpoint
  families and recommends preserving the distinction between named preview and free SQL.
- The active Eclipse bundles contain `SQLDependencyAnalyzerService` and discover the graph endpoint
  described above. This is SAP's own client implementation witness.
- `~/DEV/arc-1-lsp/docs/adt-ls-reference.md` reports no free-SQL or data-preview method in SAP's ADT
  language-server tool surface. It cannot provide an alternate enforcement hook.
- `~/DEV/mcp-abap-adt-fr0ster` forwards caller SQL to the same freestyle endpoint and does not implement
  object allowlisting or lineage checks. It is useful endpoint corroboration, not a policy model.
- The other local MCP reference implementation did not expose a competing lineage-aware query design.

## Threat and bypass inventory

The policy must account for all of the following before it can claim the security property:

1. Multiple `FROM`/`JOIN` sources.
2. Nested subqueries, `UNION`, and any CTE syntax accepted by a backend.
3. CDS views layered over unapproved views/tables.
4. DCL non-inheritance and explicit privileged access.
5. CDS association path traversal.
6. DDIC replacement objects.
7. CDS entity names, DDL source names, generated SQL view names, and case/namespace aliases.
8. Classic DDIC views whose source definition ARC-1 cannot currently read through its normal `VIEW`
   path.
9. CDS table functions and transitive AMDP `USING` entries.
10. External entities/logical schemas and secondary database connections.
11. Dynamic table/source expressions.
12. Host expressions. SAP Note 3772411 shows why "read-only SELECT" is not enough on an unpatched SQL
    Console stack.
13. `TABLE_CONTENTS.sqlFilter`. Its current validation rejects `SELECT` only when it is the first token;
    it is not a complete expression parser.
14. Name sanitization. `TABLE_QUERY` currently strips invalid identifier characters; policy matching must
    evaluate the exact normalized identifier actually sent, and strict mode should reject rather than
    silently rewrite a submitted name.
15. IN-list chunking. Every generated statement must be authorized, not only the original string.
16. Error-enrichment queries such as `SELECT * FROM <table>` after an unknown-column error.
17. Fixed internal queries over `TADIR`, `DD03L`, `SEOMETAREL`, `SUAUTHVALTRC`, and `TOBJ`.
18. Per-user `withSafety()` clones and per-target multi-target clients.
19. Cached lineage becoming stale after CDS activation or external transports.
20. Extension tools: `ctx.client` omits SQL/data methods, but `ctx.http.get()` is a generic SAP read path.

## Options evaluated

Scores use 1 (poor) through 5 (strong). "Guarantee" is the ability to meet the stated object-lineage
property, not general SAP security.

| Option | Guarantee | Delivery effort | Operations | Compatibility | Verdict |
|---|---:|---:|---:|---:|---|
| 1. SAP roles/DCL only | 2 | 2 | 3 | 4 | Defense in depth; does not meet lineage requirement |
| 2. Direct requested-name allowlist | 2 | 1 | 5 | 5 | Too easy to bypass with wrappers/replacements |
| 3. One flat transitive allowlist | 3 | 3 | 2 | 4 | Secure only if direct and dependency permissions are separated; otherwise leaks lower layers |
| 4. Root-scoped manifest + live lineage | 5 | 4 | 4 | 4 | **Recommended ARC-1 design** |
| 5. Structured named queries only | 4 | 2 | 4 | 5 | Recommended first delivery stage; intentionally removes free SQL |
| 6. Curated SAP SQL service/application API | 5 | 5 | 3 | 3 | Best high-assurance production architecture; larger product change |

### Option 1: SAP roles and CDS DCL only

Use a least-privilege SAP identity, exact `S_TABU_NAM` display grants, restricted `S_TABU_DIS`, and DCL on
every exposed CDS root.

**Strengths:** SAP-enforced, per-user when principal propagation is used, and still effective if ARC-1 is
misconfigured.

**Weaknesses:** DCL is not inherited; authorization on a named view is not demonstrated to inspect its
entire lineage; privileged access is deliberately available to authorized SQL Console users; broad
`S_DEVELOP` can complicate the Data Preview flow.

**Decision:** mandatory defense in depth, not the ARC-1 solution.

### Option 2: direct requested-name allowlist

Match the `name` passed to `TABLE_QUERY`/`TABLE_CONTENTS` or names after `FROM`/`JOIN` in `SAPQuery`.

**Strengths:** small, fast, easy to explain.

**Weaknesses:** trusts an approved CDS wrapper without checking its sources; misses replacements,
generated SQL view aliases, table functions, path traversal, and parser edge cases.

**Decision:** reject.

### Option 3: one flat allowlist for direct and transitive objects

Expand every view and require all nodes to occur in one global list.

**Strengths:** catches wrapper views and is simpler than root-specific manifests.

**Weaknesses:** if `SPFLI` must appear in the list so an approved aggregate can use it, a naive
implementation also permits direct `SELECT * FROM SPFLI`. Separating an "allowed as dependency" bit from
an "allowed as root" bit turns this into the core of Option 4. Large global lists also make review and
change ownership difficult.

**Decision:** do not ship as one undifferentiated list.

### Option 4: root-scoped policy manifest with active lineage

Maintain exact queryable roots and the dependency closure approved for each root. Resolve the closure
from the active SAP definition before the data call and compare it with the manifest.

**Strengths:** satisfies direct-versus-transitive semantics; a dependency grant does not become a direct
grant; a view change that adds a source fails closed; policy can be reviewed as code; deny rules give an
emergency brake.

**Weaknesses:** needs canonicalization, graph parsing, caching/invalidation, table-function handling, and
a conservative SQL parser. ARC-1-to-SAP checking is not transactionally atomic with query execution.

**Decision:** recommended product design.

### Option 5: disable free SQL; allow only structured named reads

Apply Option 4 to `TABLE_QUERY` and unfiltered `TABLE_CONTENTS`; hide/block `SAPQuery` whenever strict
policy is active.

**Strengths:** the server controls the statement skeleton and has exactly one direct root; it removes the
largest parser and CVE-adjacent surface. The existing `TABLE_QUERY` value builder already quotes values
and prevents subqueries in `IN`.

**Weaknesses:** no joins, aggregates, subqueries, or ad hoc analysis. `TABLE_CONTENTS.sqlFilter` must be
disabled or fully parsed.

**Decision:** recommended first shippable stage and a valid permanent profile for sensitive systems.

### Option 6: curated SAP SQL service or application API

Expose only governed CDS data products through a service definition/binding or a purpose-built API, then
disable ADT Data Preview/SQL Console access for the ARC-1 runtime identity.

**Strengths:** SAP owns exposure and authorization at the data-product boundary; it avoids accepting
arbitrary SQL through a development endpoint; service contracts can include row-level DCL in business-user
mode.

**Weaknesses:** new protocol/tooling, SAP development and operations work, CDS-only orientation, and
`S_SQL_VIEW` still authorizes exposed roots rather than independently proving the whole business lineage.
The CDS model still needs governance.

**Decision:** preferred architecture where the requirement is hard production isolation rather than
developer convenience.

## Recommended policy model

Use a versioned JSON/YAML policy file rather than a comma-separated environment variable. The closure and
metadata are too structured for a safe CSV. Environment/CLI configuration should point to the file; BTP
multi-target deployments should reference a named policy per target rather than embedding the policy in
Destination properties.

Illustrative shape:

```yaml
version: 1
default: deny
targets:
  A4H/001:
    deny:
      - TABL:USR02
    roots:
      - source: TABL:SCARR
        dependencies: []
      - source: DDLS:DEMO_CDS_SUMDIST
        dependencies:
          - TABL:SCARR
          - TABL:SPFLI
        definitionDigest: sha256:optional-review-pin
```

Semantics:

- Version 1 accepts exact, uppercase, typed identities only. No wildcard roots.
- `roots[].source` grants direct selection.
- `roots[].dependencies` grants contribution only while resolving that root.
- A SQL statement with several direct sources requires every source to be a root. Each root's live closure
  must be a subset of that root's dependency list.
- `deny` applies to roots, aliases, and every transitive node. It always wins.
- A conflict between allow and deny is a startup error and a runtime deny.
- Omitting a target policy means no data/SQL access on that target, even if a Destination asks for it.
- A policy may explicitly opt into legacy unrestricted access, but only with a conspicuous value such as
  `default: allow`; an empty/missing list must never mean allow-all in strict mode.
- A definition digest is optional for object-only controls and recommended when a CDS root is also relied
  upon for filtering or field minimization.

The operator workflow should include a read-only command that resolves a candidate root on a selected
target and prints the typed closure and definition hashes. The administrator reviews that output and adds
it to the manifest. ARC-1 should not silently learn and approve new dependencies.

## Recommended authorization pipeline

```text
validated tool arguments
  -> classify user data request vs fixed internal metadata request
  -> parse/construct exact direct SQL sources
  -> reject forbidden syntax and incomplete parses
  -> canonicalize each source and all aliases
  -> load active CDS graph / replacement / table-function edges
  -> compare each root-specific live closure with policy
  -> apply deny-overrides
  -> record an allow/deny audit decision
  -> only then POST to the data-preview endpoint
```

### SQL analysis

For `TABLE_QUERY`, authorize the exact validated table/CDS identifier before building SQL. In strict mode,
reject an identifier if normalization would change it instead of silently stripping characters.

For `TABLE_CONTENTS`, authorize its root. Initially permit only an empty filter. Later, wrap the filter in
a synthetic select and require a complete condition AST with no host markers, subqueries, or dynamic
expressions.

For `SAPQuery`, use `@abaplint/core`'s ABAP AST as one input, not regular expressions. Local feasibility
tests with the repository's current `@abaplint/core` 2.120.37 found static `DatabaseTable` nodes for simple
sources, joins, and nested subqueries, and distinct AST nodes for:

- `SQLPrivilegedAccess`
- `SQLClient`
- `DatabaseConnection`
- dynamic data-source expressions
- CDS `SQLPathForEntity`

CTEs require a recursive walk of statement/expression nodes; a convenience search on only one subtree can
miss their sources. A host expression exposes an `@` token but its inner method reference is not labeled as
a method call by the syntax-only tree, so strict mode should reject every caller-supplied host marker rather
than attempt to classify safe and unsafe host expressions.

Authorization parsing rules must be stricter than linting:

- exactly one complete `SELECT` request;
- no parser errors or unconsumed text;
- no host marker, privileged access, dynamic source, client override, database connection, external
  `PROVIDED BY`, association path, or unsupported source kind;
- all statements created by IN-list chunking are independently checked;
- release syntax newer than the supported security parser is refused, never downgraded to a warning.

### CDS lineage resolution

1. Resolve the submitted CDS entity to its DDLS source using ADT repository search/URI evidence.
2. Negotiate the dependency graph endpoint from discovery.
3. Parse the nested graph and require recognized node types, names, relations, and `DB_EXISTS` state.
4. Expand every view node until terminal typed sources are reached. The live endpoint already returns a
   transitive graph for nested views, but traversal code should not assume that every release does.
5. Ignore DCL state for allow/deny; keep it only as audit context.
6. If an exposed association is not in the graph, it is safe only because version 1 rejects caller path
   expressions. If path support is added, resolve every path segment and authorize its target closure.

### Replacement and classic views

For a transparent table, read its normal ADT table source and parse
`@AbapCatalog.replacementObject`. If present, add the replacement CDS and its graph to the closure.

The current `AdtClient.getView()` VIT path returns metadata, not the base-table definition, on both tested
on-prem releases. Version 1 should therefore reject classic `VIEW/DV` roots and generated CDS SQL view
names. A later implementation may use a narrowly scoped internal metadata read such as `DD26S`, but only
after its release behavior and authorization are tested. Never treat a missing view definition as a
terminal object.

### Table functions

Version 1 should deny them. The expansion path for a later version is:

1. Resolve the graph's `STOB/DO` entity to its DDLS source URI.
2. Read the table-function DDL and extract `implemented by method class=>method`.
3. Read the exact class method and parse every `USING` object.
4. Recurse into CDS entities and AMDP methods.
5. Reject external `USING SCHEMA`, missing/inactive source, dynamic ambiguity, cycles beyond a bounded
   traversal, or an unrecognized object type.

Live evidence shows this is feasible: `CDSFRWK_TF_FLIGHT_DETAILS` resolves to
`CL_AMDP_TABLE_FUNC_IMPL=>DBFUNC_01`, whose `USING` list contains `SFLIGHT`.

### Caching and time-of-check/time-of-use

Cache only successful, complete lineage results. Key by target, client, canonical root, active source
ETag/hash, graph media type, and policy version. Invalidate on ARC-1 activation/write operations and use a
short TTL for changes made outside ARC-1.

For stricter operation, verify the active definition digest immediately before execution. There remains a
small race because the graph check and query are separate SAP requests. A dedicated SAP-side endpoint or
curated SQL service is required if the boundary must be atomic against concurrent repository activation.

### Fixed internal queries

Do not put `TADIR`, `DD03L`, `SEOMETAREL`, `SUAUTHVALTRC`, and `TOBJ` into every user's queryable root list.
That would make control-plane dependencies directly selectable. Instead:

- define private, enumerated internal query operations;
- build every identifier and condition server-side;
- expose no `internal=true` argument or generic bypass to MCP/plugin callers;
- return only the metadata fields needed by the feature;
- audit the purpose and table;
- keep user-supplied data paths on the normal policy pipeline.

## Failure behavior and audit contract

Policy failures should be typed and actionable without leaking the contents of the denied object:

```text
DATA_SOURCE_DENIED: direct source DDLS:ZC_ORDER is not a queryable root for target A4H/001
DATA_LINEAGE_DENIED: DDLS:ZC_ORDER depends on an unapproved source (policy order-read-v3)
DATA_LINEAGE_UNRESOLVED: active lineage could not be proven; request was not sent to SAP
SQL_SYNTAX_FORBIDDEN: WITH PRIVILEGED ACCESS is disabled by ARC-1 data policy
```

Client errors may identify the first denied typed object for administrators, subject to
`ARC1_MINIMAL_ERRORS`. Audit records should contain request ID, target, policy ID/version, canonical direct
sources, closure hash, matched rule, decision, and reason. Do not log SQL literals, returned values, or SAP
credentials.

## Backward compatibility and rollout

Two compatibility choices are possible:

1. **Opt-in strict mode:** existing `allowDataPreview=true`/`allowFreeSQL=true` behavior remains broad when
   no policy is configured. Configuring a policy activates default-deny behavior. This avoids an upgrade
   break but preserves the current foot-gun.
2. **Fail-closed major change:** enabling either gate without a policy denies all; unrestricted operation
   requires an explicit `default: allow`. This best matches ARC-1's safe-default principles.

Recommendation: introduce opt-in strict mode in the next compatible release with a high-severity startup
warning for broad mode, then make a policy or explicit unrestricted acknowledgement mandatory in the next
major release. In experimental multi-target mode, be stricter immediately: no target policy means no
`data`/`sql` tools for that target.

Suggested staged delivery:

1. Patch/mitigate SAP Note 3772411; no ARC code required for this prerequisite.
2. Policy parser, exact typed identities, root/dependency semantics, deny override, startup validation,
   config/effective-policy visibility.
3. SAP graph client with 7.50 old-media and 7.58 v3 negotiation; transparent-table replacement resolver.
4. `TABLE_QUERY` and unfiltered `TABLE_CONTENTS` enforcement; strict mode blocks `sqlFilter` and
   `SAPQuery`.
5. Audit and negative integration corpus.
6. Conservative `SAPQuery` AST subset.
7. Optional table-function expansion and definition digests.

## ARC-1 implementation impact map

### New modules suggested

- `src/data-policy/types.ts` — versioned manifest and typed canonical identities.
- `src/data-policy/parse.ts` — file loading, validation, conflicts, exact-match indexes.
- `src/data-policy/sql-analyzer.ts` — strict ABAP SQL AST and forbidden-syntax checks.
- `src/data-policy/lineage.ts` — graph traversal, root-scoped evaluation, cache keys.
- `src/adt/cds-dependency-graph.ts` — discovery/media negotiation and XML parsing.
- `src/data-policy/errors.ts` — typed client/audit errors.

### Existing source files affected

- `src/server/types.ts`, `src/server/config.ts`, `src/cli-args.ts`, `src/cli.ts` — configuration and
  `config show`.
- `.env.example` — policy configuration and unrestricted acknowledgement.
- `src/adt/safety.ts` — effective policy reference and new data decision errors.
- `src/server/server.ts` — base client wiring and `withSafety()`/per-user propagation.
- `src/adt/client.ts` — common pre-POST enforcement for all three data methods; exact name validation;
  internal fixed-query vocabulary.
- `src/handlers/query.ts` — authorize original and chunked statements; remove regex from the security
  boundary.
- `src/handlers/read.ts` — strict `TABLE_CONTENTS` filter behavior and root-aware errors.
- `src/handlers/search.ts`, `src/handlers/navigate.ts`, `src/handlers/where-used.ts`,
  `src/adt/codeintel.ts`, `src/adt/authorization-trace.ts` — migrate fixed metadata reads to private
  internal operations.
- `src/server/effective-policy-log.ts` — visible strict/broad mode and policy digest.
- `src/server/destination-registry.ts`, `src/server/multi-target-runtime.ts`,
  `src/server/multi-target-destination-config.ts`, `src/server/multi-target-tools.ts` — target-specific
  policy selection and tool pruning.
- `src/server/safe-http-client.ts` — document or close the generic extension GET boundary when strict
  data isolation is claimed.
- `src/context/cds-deps.ts` — retain for context only; explicitly do not reuse as authorization evidence.

### Tests affected or required

- `tests/unit/adt/safety.test.ts`
- `tests/unit/adt/client.test.ts`
- `tests/unit/adt/table-query.test.ts`
- new `tests/unit/data-policy/{parse,sql-analyzer,lineage}.test.ts`
- `tests/unit/handlers/read.test.ts`
- `tests/unit/handlers/query-errors.test.ts`
- `tests/unit/handlers/search-navigate.test.ts`
- `tests/unit/authz/policy.test.ts`
- `tests/unit/server/config.test.ts`
- `tests/unit/server/effective-policy-log.test.ts`
- `tests/unit/server/destination-registry.test.ts`
- `tests/unit/server/multi-target-runtime.test.ts`
- `tests/unit/server/multi-target-tools.test.ts`
- `tests/unit/server/safe-http-client.test.ts`
- tool-definition snapshots if descriptions/schema change.

The negative SQL corpus must include joins, nested subqueries, unions, CTEs, comments, string literals
containing keywords, namespaces, aliases, dynamic sources, host markers, privileged access, client
overrides, database connections, external entities, association paths, multiple statements, malformed
source, and chunked IN lists. Lineage fixtures should cover nested CDS, used and unused associations,
replacement objects, classic views, table functions, cycles, unknown node types, missing objects, and graph
media negotiation.

### Documentation affected

- `docs_page/configuration-reference.md`
- `docs_page/authorization.md`
- `docs_page/security-guide.md`
- `docs_page/tools.md`
- `docs_page/multi-target-setup.md`
- `docs_page/multi-target-administration.md`
- `docs_page/updating.md`

## Implementation acceptance criteria

1. A policy that exposes only `TABL:SCARR` allows direct structured reads of `SCARR` and blocks `SPFLI`,
   joins, subqueries, aliases, and higher views.
2. An approved CDS root succeeds only when its live graph is a subset of its reviewed dependencies.
3. Adding a new base source to the active CDS definition causes a deny without restarting or editing the
   policy.
4. A dependency-only object cannot be queried directly.
5. A deny wins through a higher CDS view and through a replacement object.
6. Generated DDIC SQL view names, classic views, table functions, paths, external sources, and unresolved
   types fail closed in version 1.
7. Every host expression and `WITH PRIVILEGED ACCESS` is rejected before an SAP data POST.
8. Fixed metadata features keep working without making their tables user-queryable.
9. Per-user safety clones and every multi-target route preserve the correct target policy.
10. Audit output proves which policy/closure allowed or denied the request without logging data.
11. Unit, typecheck, lint, and full tests pass; live tests cover 7.50 graph negotiation and 7.58 execution
    plus graph enforcement. SAP_BASIS 816 is tested when the container is available.
12. The deployment runbook requires SAP Note 3772411 or a later correcting support package before
    `SAP_ALLOW_FREE_SQL=true` is accepted as production-safe.

## Experimental implementation verification

The minimal blocklist was tested after its final security corrections on 2026-09-02:

- Full unit regression: 184 files, 5,466 tests passed, no failures.
- Full A4H SAP_BASIS 758 integration regression: 16 files passed and 3 capability-gated files skipped;
  225 tests passed and 81 skipped, no failures. The six blocklist tests included direct denial with zero SAP
  calls, live CDS transitive denial, live replacement-object denial, an allowed static query, empty-list
  compatibility, and denial-message data-value redaction.
- Focused NPL SAP_BASIS 750 run: 3 tests passed and 3 documented backend-capability tests skipped. The old
  dependency media type was negotiated after the live v3 request returned 406, and the transitive denial was
  decided before the unbound data-preview endpoint.
- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check:sizes`, `npm run validate:policy`,
  `npm run btp:validate`, `npm run docs:build`, `npm pack --dry-run`, and `git diff --check` completed
  successfully. Lint reported only the repository's existing Biome schema and deprecated-configuration
  informational notices; the documentation build reported the existing unrelated release-notes anchor notice.
- A completed branch-diff security review reported one medium authorization bypass in raw-regex replacement
  annotation parsing and one low diagnostic disclosure in policy-error wrapping. Both were corrected and
  covered by focused exploit-path regressions before the final test runs.
- SAP_BASIS 816 was not claimed: its local Docker target was unavailable because the daemon was not running.

## Open decisions before planning implementation

1. Is strict policy required only for built-in data-preview/SQL tools, or must it also close extension
   `ctx.http.get()` and other possible data-bearing read surfaces?
2. Should version 1 permanently hide `SAPQuery` under strict policy, or is a conservative single-release
   SQL subset required in the first delivery?
3. Is object-level lineage sufficient, or must policy also pin columns/filters with definition digests?
4. Should classic DDIC views and table functions remain permanently unsupported or be included in the
   first implementation scope?
5. Is backward-compatible opt-in strict mode acceptable, or should the next release require a policy (or
   an explicit unrestricted acknowledgement) whenever SQL/data preview is enabled?

## Final recommendation

Adopt **Option 4**, delivered first as **Option 5**:

- Exact, root-scoped allow entries.
- Dependency-only entries that never grant direct access.
- Global/target deny entries that always win.
- SAP's active dependency graph as the primary CDS lineage source.
- Replacement-object expansion.
- Default deny and fail closed on incomplete evidence.
- `TABLE_QUERY` first; unfiltered `TABLE_CONTENTS` second; `SAPQuery` disabled until a strict AST subset is
  proven.
- Least-privilege SAP roles and DCL as independent defense in depth.
- Curated SQL services/application APIs for production environments that need the strongest boundary.

Before any of this is enabled on A4H, apply SAP Security Note 3772411 (or the correcting 758 support
package) and confirm the result with the SAP security/Basis owner.

## Phase 1 exit gate

- [x] Exact data-preview and CDS dependency endpoints are known, and live response content—not only HTTP
  status—was verified.
- [x] SAP's Eclipse ADT implementation, SAP's ADT language-server surface, and another ADT-over-MCP
  implementation were checked.
- [x] Release behavior was checked on SAP_BASIS 750 and 758; 816 is explicitly recorded as an implementation
  test obligation because the local system was offline.
- [x] Affected ARC-1 source, test, documentation, clone, multi-target, and extension-adjacent paths are
  listed.
- [x] Findings, commands, live observations, options, open decisions, and cited evidence are captured in
  this dossier.
