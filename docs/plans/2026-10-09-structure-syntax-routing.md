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

## Validation

The new regression file failed against main (three failures) and passes with the
shared-handler fix. All 8,074 unit tests, typecheck, lint, policy validation,
build and file-size checks pass. Final diff review found no additional changes
needed.

Live read-only checks on 7.50 and 7.58 passed for both public entry points,
`TABL` and `TABL/DS`, and stored and supplied BAPIRET2 source (16 combinations).
A nonexistent structure remains unvalidated on both releases. T000 on 7.58
still checks through the table endpoint without errors. SAP warnings remain
visible. No SAP objects were changed.

ARCH-01 retains its general discovery-routing proposal; only the reproduced
structure-syntax gap is removed. Other endpoint families are outside this fix.
