# Native CDS preview contract (#1194)

Verified on SAP_BASIS 758 SP02, client 001, direct HTTPS Basic, using existing SAP demo objects.
These are native API observations, not restricted-user or principal-propagation qualification.

## Identity and request

1. Discovery lists `/sap/bc/adt/datapreview/cds`.
2. Active `/ddic/ddl/sources/<DDLS>?version=active` metadata identifies the exact DDLS/DF object
   and its kind (`view` or `view entity` in these controls).
3. GET `/datapreview/cds/<DDLS>/metadata` returns `tableData.cdsEntityName`, the SQL query target.
   `tableData.name` can instead be the generated SQL view and must not be used as the target.
4. POST `/datapreview/cds?rowNumber=N&ddlSourceName=<DDLS>` accepts a text/plain SELECT body;
   Accept is `application/vnd.sap.adt.datapreview.table.v1+xml`.

All paths above are under `/sap/bc/adt`. Names are encoded per path/query component.
The POST's `ddlSourceName` does **not** bind its SQL body: a harmless control using `I_CURRENCY`
with a SELECT of language keys from `T002` succeeded. ARC-1 must bind the constructed SELECT to
its verified CDS entity and accept only structured identifiers, operators and quoted literals.

## Results and limitations

- `rowNumber=1` can return two rows as lookahead. Trim to the requested cap and report truncation.
  SAP's `totalRows=0` was present even with returned data; it is not a usable total count.
- Metadata for `DEMO_CDS_PARAMETERS` includes repeated `parameters` elements. Initial support
  can refuse these before a data request. Association listing works for `I_CURRENCY`; association
  data navigation remains unqualified.
- `DEMO_CDS_AUTHORITY_LITERAL_2` has no DDLS row filter; its DCL permits airline LH. Both native
  CDS preview and existing TABLE_QUERY hid AA while a SCARR control contained it.
- Classic DDLS `DEMO_CDS_AUTHORITY_LIT_PFCG` defines entity `DEMO_CDS_AUTH_LIT_PFCG` and SQL view
  `DEMO_CDS_LITPFCG`. Its DCL combines a PFCG condition with currency EUR. Both endpoints excluded
  AA/USD when querying the entity, but returned it when querying the SQL view. LH/EUR was visible.
- Both native endpoints use SAP's Open SQL handler and authorization checks. A CDS-specific ARC-1
  action can restrict the exposed query surface; it does not remove SAP permissions, guarantee
  every CDS has DCL, or control access through other clients.
- The 750 SP02 test system advertises matching CDS templates but returned routing 404 for metadata
  and preview of an existing DDLS. Report runtime failure explicitly; do not fall back to freestyle.

This operation does not make the whole deployment CDS-only: other actions and internal metadata queries have separate data paths.
Parameters, association traversal, restricted users and PP/BTP require separate qualification.

Implementation validation used the same system: namespaced `/1BS/CDS_EXP_SALESORDER` resolved to
`/1BS/SADL_V_NAMING2`; a statement longer than 255 characters retained its final restrictive filter;
lookahead was trimmed; blocklist-on classic/view-entity reads succeeded for unrelated exclusions.
Blocking the DDLS stopped before any request; blocking its SQL-view alias or base table stopped
before application data. Parameterized DDLS and SQL-view-as-DDLS inputs were refused.

## Follow-up: restricted-role setup (2026-11-13)

The [reporter tested `300814d` on 758 SP03](https://github.com/arc-mcp/arc-1/issues/1194#issuecomment-6735185286)
with HTTP Streamable and HTTPS Basic. Their authorization trace attributes the metadata 403 to
`S_ADT_RES`: the collection URI was granted, its child metadata URI was not. Eclipse requests that
same child URI. The reporter has not yet confirmed DCL/permission-denial tests after the role change.

The request list and deployment limits are in [CDS previews](../../docs_page/tools.md#cds-previews).
Keep the native metadata check and propagate failures; do not switch to another route after a denial.
The new 403 hint asks Basis to trace the request, without asserting that every 403 has the same cause.
It preserves the native error and uses no object name or response body in its generic guidance.

### Additional native checks

Tested the branch combined with main `706e0556` on SAP_BASIS **758 SP02** and **816 SP01**,
client 001, direct HTTPS Basic using development accounts and existing demo/reference objects only.
Both systems passed literal/classic DCL allow and exclude controls, distinct
DDLS/entity/SQL-view identities, escaped injection-like input, row/lookahead limits, long filters,
parameterized-view/SQL-view-name/unknown-column refusals, DDLS and base-table blocklist denials,
an allowed view with catalog lineage checks, no freestyle POST with the blocklist off, and the
harmless mismatched-body control below. No source, SAP user or role was saved or changed.

- Both systems accepted `SELECT SPRAS FROM T002` with `ddlSourceName=I_CURRENCY` on the native CDS
  collection. That parameter does not bind the SQL body. ARC-1's own entity binding remains essential;
  granting the endpoint is not an approved-view policy for other clients.
- On 758, the installed `CL_ADT_DP_CDS_RES` delegates the submitted SQL to the data-preview helper.
  `CL_ADT_CDS_DATA_PREVIEW_UTIL` then calls `CL_ADT_DP_OPEN_SQL_HANDLER->get_query_result`, which
  generates and runs the query program. This is the shared parser/execution path, not a separate
  CDS-only SQL engine. [SAP Note 3772411](https://me.sap.com/notes/3772411) remains an independent
  prerequisite; no host-expression exploit or mutation was attempted.
  `CL_ADT_DP_OSQL_AUTHORTIY_CHECK` checks the accessed entities through SAP's authorization-check
  factory. These observations do not establish a universal role recipe or transitive table denial.
- The active `CL_ADT_WB_RES_APP->CHECK_RESOURCE_AUTHORIZATION` copies the URI to a 40-character
  value before checking `S_ADT_RES`. Exact long metadata paths are therefore not a view policy.
  Keep the collection grant and have Basis review `/sap/bc/adt/datapreview/cds/*` for its children.
- Fresh-client HTTP request captures on both systems included GET discovery, active DDLS metadata,
  CDS metadata, HEAD and GET core discovery for CSRF, then the CDS POST. The permission request list
  includes this observed CSRF dependency; the legacy-discovery fallback is from the client code.
- LF, CRLF and bare-CR filter literals followed by a column-one `*` and SQL-looking quoted text
  returned empty results on both systems, as did an ordinary multiline literal. No extra rows or
  widened query were observed. These are bounded harmless demo-data controls, not a general parser proof.
- A local HTTP Streamable MCP server against 758 passed six checks with writes/free SQL off:
  DCL allow/exclude, rejection without data scope, rejection of raw `sqlFilter`, separately denied
  `TABLE_QUERY`, and unavailable free SQL. MCP authentication used temporary API keys; this is not
  Entra ID or principal-propagation qualification.

An enabled blocklist cannot currently prove allowed lineage when its fixed catalog reads are denied.
Keep that failure closed. Do not tunnel those reads through `/cds`, bypass the policy, or add a
direct-name allowlist and describe it as transitive protection. The reporter's shared SAP identity
and reviewed-view use case require native role/DCL verification; the default flat preview does not
provide per-Entra-user authorization. Parameters and associations are not needed for their first query.
