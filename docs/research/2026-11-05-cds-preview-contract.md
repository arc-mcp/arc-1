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
