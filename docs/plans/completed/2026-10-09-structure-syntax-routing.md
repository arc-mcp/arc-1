# Structure syntax routing

## Reproduction and root cause

On SAP 7.50 and 7.58, `BAPIRET2` exists at `/ddic/structures/BAPIRET2`, not
`/ddic/tables/BAPIRET2`. Both public syntax entry points normalize `TABL/DS` to
`TABL`, then construct the table URL. Supplied source is consequently refused by
the existence guard added in #951. A direct check of the same source against the
structure URL returns `checked: true, hasErrors: false` on both systems.

## Reviewed plan

1. In the shared syntax handler, probe TABL metadata for both stored and supplied
   source. Only a table-root 404 permits trying the structure root.
2. Reuse the resolved URL and existence result for the existing unsaved-source
   guard. Keep other object types and non-404 probe failures unchanged.
3. Cover both entry points, aliases, stored/unsaved source, namespaces, missing
   objects and denied/failed metadata probes. Verify the public calls live on
   both releases.

The review rejected changing global alias normalization or adding a discovery
framework for this bug. Fresh reads avoid stale type routes; no write resolver,
package gate, schema or permission changes are needed. A non-404 failure still
leaves the verdict to SAP's syntax reporter, matching the existing contract.

## Live verification

Read-only checks on 750 SP02 and 758 SP02/client 001/HTTPS Basic passed for both
public tools, both aliases, and stored/supplied BAPIRET2 source. Missing structures
remain unvalidated; T000 still uses the table endpoint. No SAP objects changed.

Roadmap: ARCH-01 retains the general discovery-routing proposal; only the verified
structure-syntax gap is removed. Other endpoint families are outside this fix.
