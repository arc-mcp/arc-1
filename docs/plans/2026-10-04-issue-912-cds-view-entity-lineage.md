# Issue #912: CDS view-entity lineage

## Problem and evidence

With `SAP_BLOCKED_DATA_SOURCES` non-empty, ordinary CDS view entities and transactional
projection views are denied before their data query. The dependency graph succeeds, but
`parseCdsDependencyGraph` rejects `CDS_VIEW_ENTITY` / `CDS_PROJECTION_VIEW`.
`enforceBlockedDataSources.validateGraph` separately permits only `CDS_VIEW` to recurse.
Changing the parser alone therefore leaves a second denial.

Fresh read-only probes on 2026-10-04, starting from `00ef94514`, reproduced both parser
denials on A4H / client 001 / SAP_BASIS 758 SP02 over HTTPS Basic authentication:

- `DEMO_CDS_SPFLI_ENTITY`: view entity over `SPFLI`.
- `DEMO_MANAGED_ROOT_PROJ`: `provider contract transactional_query`, projection on
  `DEMO_MANAGED_ROOT_WAS`; SAP returns the projection and its underlying root view entity.
- Each query with blocklist `USR02` failed with `DATA_LINEAGE_UNRESOLVED`, two metadata
  requests and zero parsed graph nodes. A classic CDS control returned a row.
- [Issue #912](https://github.com/arc-mcp/arc-1/issues/912) supplies a sanitized SAP_BASIS
  816 SP01 v3 graph containing a projection, two view entities, classic CDS views, four
  tables and three access-control entries. This is reporter evidence, not a fresh 816 run.

## Implementation plan

1. Preserve the 816 issue graph and fresh 758 demo captures as regression fixtures.
   Demonstrate the baseline failure before changing production code.
2. Define one small tuple of traversable CDS view kinds (`CDS_VIEW`, `CDS_VIEW_ENTITY`,
   `CDS_PROJECTION_VIEW`). Reuse it in the parser's SQL kinds and the evaluator's view
   branch so these two checks cannot drift. Keep TABLE and table-function handling as is.
3. Test mixed graphs and direct entity/projection roots, exact aliases and blocked-table
   paths, childless/inactive nodes, replacement inspection of terminal tables, and all
   three auxiliary access-control entries. Verify unsupported kinds still fail closed.
   Exercise the real client boundary: denial must send no application data POST.
4. Run local checks and live allowed/blocked reads through the changed client. Test the
   transactional projection at the freestyle endpoint to distinguish lineage permission
   from SAP SQL support. Record any backend rejection rather than hiding it.
5. Update developer/operator guidance and clarify COMPAT-07's remaining replacement
   identity gap. Review the diff and tests, fix concrete findings, rerun affected checks,
   then create the PR and a separate Claude review prompt.

## Plan review before implementation

- Both kind checks must change; an expanded parser alone is insufficient.
- No new flags, tool arguments, release branches, SQL parsing, metadata endpoints, caching
  or generic CDS-kind matching. The fix is internal and adds no work for an LLM caller.
- Existing root identity, aliases, database-existence checks, child traversal, graph limits,
  exact blocklist matching and terminal-table replacement checks remain authoritative.
- Access control remains context, never a reason to allow a blocked table. Every related
  entry must still be structurally validated, including later siblings.
- Table functions and unobserved entity forms remain unsupported. The view-entity
  replacement catalog join is separate COMPAT-07 work and is not broadened here.
- Live tests use existing SAP demo objects and bounded reads; no SAP object writes needed.
- Fresh 816 principal-propagation/multi-target testing is unavailable in this session;
  fixture replay is explicitly separate from live 758 client testing.

Review outcome: proceed with the shared tuple and existing traversal. No additional
abstraction is needed.

## Completion review

Implemented the shared tuple, three captured fixtures, parser/evaluator/client regressions and
six read-only live scenarios. The parser-only candidate was tested and rejected. A review added
coverage that a terminal-table replacement still blocks through a view entity; no production
change beyond the original kind checks was needed at that stage. The later independent review
identified a wire-parsing gap missed here; see the follow-up below and the
[research and test evidence](../research/2026-10-04-issue-912-cds-lineage.md).

## Reviewed follow-up

Preserve present-but-empty graph properties so SAP's empty `DB_EXISTS` becomes false and the
existing inactive-node guard refuses transient analytical queries. Keep omitted legacy properties
distinct. Verify with fresh XML plus parser/client/live tests, including no POST on all three
governed data paths. Add live association/nested-projection regressions, fix the compatibility and
error-code wording, cite #915's equivalent deployed result, and credit its author in the new commit.
Keep set-operation graphs and implicit conversion dependencies as separately documented roadmap
work. This needs one parser-line correction, with no new policy mode or traversal abstraction.
