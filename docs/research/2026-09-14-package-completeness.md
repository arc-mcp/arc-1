# Package listing completeness (customer B-5)

## Root cause and evidence

`SAPRead(type=DEVC)` returns only an array from ADT quick search. The effective
limit defaults to 200 and clamps to 1–1000; the response says nothing about that
cap. This encourages callers to mistake a partial listing for a package inventory.

Read-only requests on A4H (SAP_BASIS 758 SP02, client 001, 14 September 2026)
listed `SABAPDEMOS` with limits 1, 2 and 5. Every request returned HTTP 200 and
exactly that many references. The XML root contained only object references and
its namespace: no total, continuation link or explicit truncation flag. Existing
package-reader documentation records another limitation: ADT search omits some
legacy objects, including SEGW service versions. Fewer rows than requested cannot
establish a complete repository inventory.

## Decision and compatibility

The first text block remains the existing JSON array. A second block reports the
observed count and limit, possible truncation, and unknown inventory completeness.
The existing structured format returns one `{objects, listing}` JSON document for
CLI consumers. Keeping explicit unknown completeness avoids suggesting that a
below-limit search is a complete repository inventory.

Request and response use the same limit clamp. No extra SAP call is needed and no
pagination or total is inferred. The public client continues returning an array.
Scripts that concatenate MCP text blocks should select structured format instead.

## Live facts

| System | Check | Outcome |
|---|---|---|
| 7.58, SABAPDEMOS | Text and structured reads, limit 2 | Two objects; limit reached, possible truncation, unknown completeness; original first-block array retained |
| 7.58, disposable local package | Create/read/delete lifecycle | Both formats agreed; package cleanup succeeded |

The focused dispatch tests cover below-limit, exact-limit and zero clamped to one,
plus the structured envelope. Existing client tests cover the remaining limit and
mapping cases. Constant completeness fields are intentional contract information;
removing them or the structured envelope would change consumers' response shapes.
