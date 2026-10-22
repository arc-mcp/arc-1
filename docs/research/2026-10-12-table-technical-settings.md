# Technical table settings: verified ADT contract

Issue [#938](https://github.com/arc-mcp/arc-1/issues/938). Tested on SAP_BASIS
758 SP02 (S/4HANA 2023), 816 SP01 (2025), and BTP ABAP 920 SP05.
The collection is absent on the tested 750 SP02 system.

## Resource and lifecycle

- Collection: `/sap/bc/adt/ddic/db/settings`; resource: `/<encoded-table-name>`.
- Native identity: `TABL/DTT`; parent `containerRef`: `TABL/DT`.
- GET/PUT media type: `application/vnd.sap.adt.table.settings.v2+xml`.
- Lock the settings resource, read XML with `version=inactive` (SAP falls back to active/new when no draft exists),
  replace only supplied fields, PUT with the lock handle and explicit or lock-provided
  `corrNr`, then unlock in the same stateful session. Activation is separate.
- Resolve write/activation package permission from the parent table. Settings metadata
  does not supply its own package reference.

Native metadata contains `dataClassCategory`, `sizeCategory`, and `buffering`
(`allowed`, `type`, `areaKeyFields`). ARC-1 exposes these as partial JSON `source`,
along with boolean `loggingEnabled` for the verified plain `true`/`false` native
field. Its existing raw top-level value is retained. Missing or unfamiliar logging
metadata is omitted from `source` and cannot be updated; other settings remain usable.
Other native fields and attributes survive unchanged. Missing/duplicate scalar fields,
unknown patch keys and ambiguous XML are refused before PUT.

## Draft preservation across users

The 758 recording-transport test reproduced lost pending fields: an unversioned GET
returned user A's inactive draft to A but the older active settings to user B. B's
partial save then replaced A's pending data class. Explicit `version=inactive` exposes
the pending document to both users. Reads prefer it, and updates request it **under
the settings lock**. A requested active read remains explicitly active. Do not infer
draft ownership from `changedBy` or from an unversioned response.

SAP rejected a second user's live lock and a save into a conflicting request (409).
The same user could save into a shared request. CTS recorded `LIMU TABT` for settings.
These are native collaboration rules, not an ARC-1 ownership lock.

## State and SAP validation

New table settings report `version="new"` and accept pending changes before the
parent's first activation. A settings-only activation is refused on 758/816. BTP
returns a warning-only cancellation that previously looked successful. ARC-1 directs
new settings to parent `TABL` activation and checks native state after every later
single/batch `TABL/DTT` activation.

A syntactically valid but nonexistent data class (`ZZZZZ`) is accepted by PUT and
rejected at activation on all three releases. Saving is therefore not a promise
that the settings are valid. Correcting the pending draft and activating succeeds.
No automatic activation, active-version overwrite, draft ownership inference or
transient PUT retry is added.

Native domain `BUFALLOW`: `N` forbidden, `A` allowed but disabled, `X` enabled.
`PUFFERUNG`: empty none, `P` single-record, `G` generic, `X` full. `L` is not a valid
full-buffering code. SAP validates combinations and the number of generic key fields.

## Change-logging flag (#1062)

Verified through public dispatch on 758 SP02 using a disposable `$TMP` table:
`false → true → false`, with separate settings activation. Independent DD09L reads
confirmed `PROTOKOLL`: enabling changed only the inactive row to `X`; activation
made it active; disabling cleared it. A pending size-category edit preserved the flag.
The table was deleted and its absence verified. Transport forwarding uses the existing
qualified `LIMU TABT` path; this logging test did not repeat the recording-package test.

This verifies the table flag, not runtime change recording, which also depends on
`rec/client`. No profile setting or business data was changed. Logging updates on
other SAP releases remain unqualified.

## Scope and remaining qualifications

Storage type and load unit are returned as native values but remain read-only.
No table conversion, SQL fallback, 7.50 compatibility layer, independent
settings create/delete, or CTS cleanup feature is included. Secondary indexes use a
separate resource and belong in their own change.

Transport/two-identity qualification and public-dispatch results are recorded in the
PR validation, including their exact build and auth route. Named-user direct ADT tests
do not establish Principal Propagation or deployed Cloud Foundry coverage.

Reproduction: `tests/integration/table-settings.integration.test.ts` exercises the
public create/read/update/activate/delete lifecycle with a disposable `$TMP` table.
`tests/fixtures/table-settings-758.xml` preserves the native wire shape with identity
fields replaced. Unit tests cover safety, draft preservation, failures and state checks.
