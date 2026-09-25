# Catalog replacement lineage (#834)

## Root cause and evidence

The policy uses a generated table DDL resource missing on SAP_BASIS 750/751. Its
absence cannot prove the absence of replacement objects. SAP's [replacement-object
example](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENDDIC_REPLACEMENT_OBJECT_ABEXA.html)
redirects `DEMO_SUMDIST` through CDS. The active DD02L/DDLDEPENDENCY join independently
returned these mappings on 758 and 816 (2026-09-25):

| Table | Replacement SQL view | DDLS source |
|---|---|---|
| DEMO_SUMDIST | DEMO_CDS_SUDI | DEMO_CDS_SUMDIST |
| SADL_V_PROXY | SADL_V_SFLIGHT | SADL_V_CDS_SFLIGHT |

SCARR, T000, DD02L and DDLDEPENDENCY returned one active row without a replacement;
a nonexistent name returned none. Issue #834 supplies separate 750 SP23 customer
PP evidence for the catalog fields and individual SELECTs, not execution of the exact joined query. Our 750 SP02 target returns 404 for freestyle data preview itself;
it cannot verify the positive SP23 case. No release-number shortcut is justified.

## Implementation plan and review

Replace the DDL lexer and discovery gate with one fixed, bounded catalog lookup per
distinct table. Require exactly one active transparent-table row, all requested
fields, no error flag, and a unique mapping when VIEWREF is present. Keep SQL-view
and DDLS names distinct; the latter selects the dependency graph and the former
must occur in its aliases. Check both against the blocklist.

This query is authorization metadata, like the ADT graph read: it must not recurse
through the public query policy. Use a private fixed query after the enclosing
Query/FreeSQL gate, with the same caller client and response budget. Explicitly
blocked DD02L/DDLDEPENDENCY refuse before that query. Register and document these
metadata dependencies; never expose a bypass flag or accept caller SQL here.
Catalog rows do not become tool results. Application queries keep full lineage
checks, including when the caller explicitly queries a catalog table.

Keep direct blocked roots at zero SAP calls, request-local reuse, graph/cycle bounds,
minimal-error redaction and one decision audit. Missing endpoint is unavailable;
missing/ambiguous rows, unreadable catalog and unsupported lineage fail closed.
Classic views without proven lineage remain unsupported. The metadata/data checks
are not a transactional snapshot. No changes to SAP permissions or live data.

## Validation boundaries

Client tests cover catalog ambiguity/errors, SQL-view vs DDLS identity, blocked
metadata tables, cumulative byte limits and Query without FreeSQL. Live 758/816
checks allowed all three query entrypoints and denied the replacement SQL-view,
DDLS and SPFLI leaf; catalog blocks produced zero POSTs and direct blocks zero SAP
calls. Sanitized live column datasets are committed as fixtures. Customer PP,
750 SP23 and real S/4 redirected business tables need independent confirmation.
The integration file passes 11 cases on both 758 and 816; 750 SP02 passes six and
skips five unavailable-endpoint or unverified-fixture cases. Endpoint availability
is probed directly, and replacement paths include both SQL-view and DDLS identities.
Roadmap: COMPAT-07 tracks CDS view-entity replacement mapping; COMPAT-08 tracks pooled/clustered
tables. Both remain fail-closed until live evidence supports expanding the resolver. SAP
[documents view entities as replacement objects](https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/ABENDDIC_REPLACEMENT_OBJECTS.html).
