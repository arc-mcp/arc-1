# Issue #912: CDS view-entity lineage plan

Status: implemented in [PR #914](https://github.com/arc-mcp/arc-1/pull/914).
Live evidence and remaining boundaries are in the
[research note](../research/2026-10-04-issue-912-cds-lineage.md).

## Implementation

1. Capture the reported 816 graph and fresh 758 view-entity/projection graphs. Reproduce the
   denial with a nonempty, unrelated blocklist before changing production code.
2. Share one tuple of `CDS_VIEW`, `CDS_VIEW_ENTITY`, and `CDS_PROJECTION_VIEW` between parser
   classification and evaluator traversal. Changing only the parser leaves the second denial.
3. Preserve present-but-empty graph properties: SAP's empty `DB_EXISTS` means false, while
   omitted legacy 750 metadata remains unknown. Exercise this with captured analytical-query XML.
4. Verify direct and nested roots, exact aliases, blocked descendants and table replacements,
   empty/inactive nodes, DCL structure and unsupported kinds. Denials must send no data POST.
5. Test bounded reads of existing SAP demos, including associations and nested projections.
   Run local checks, review the implementation, and record precise build/results in the PR.

## Reviewed constraints

Keep existing identity, graph-bound, child-traversal and replacement checks. DCL remains context,
never permission to bypass a blocked source. Table functions and unknown graph kinds fail closed.
No new settings, tool arguments, endpoints, release branches, caches or generic kind matching.
Live tests use existing objects without SAP writes; replayed 816 XML and the reporter's separate
816 deployment evidence must remain distinct from fresh tests of this implementation.

The final implementation meets these constraints with the shared tuple and one parser-line fix.
COMPAT-07's replacement mapping, COMPAT-10's set-operation graphs, and SEC-18's implicit conversion
dependencies remain separate work; none requires broadening this fix.
