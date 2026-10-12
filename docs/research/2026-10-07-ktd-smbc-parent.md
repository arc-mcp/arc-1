# KTD documentation for SMBC parents (#933 / #934)

Research and independent verification on 2026-10-07. Scope: the KTD parent route
for Business Configuration Maintenance Objects (`SMBC/TYP`), not general SMBC
read/write/transport support. Continue [PR #934](https://github.com/arc-mcp/arc-1/pull/934)
and retain its contributor history. [Issue #933](https://github.com/arc-mcp/arc-1/issues/933)
also mentions general SMBC tooling, which remains a separate gap.

## Root cause and route evidence

Current main recognizes `SMBC/TYP` as SAP-registered for DOCUMENTATION scope but
refuses KTD creation because it cannot construct a verified parent URI. The
contributor's namespaced regression fails against main and passes with its small
KTD-specific map. No canonical SMBC tool type or generic object routing change is
necessary.

Independent SAP_BASIS 758 SP02 discovery advertises `/sap/bc/adt/bct/smbctyp` with
`application/vnd.sap.adt.blues.v1+xml`. Creating a disposable metadata shell at
that collection returns `adtcore:type="SMBC/TYP"`, its lowercase object URI, and
`adtcore:packageRef` naming `$TMP`. These agree with the contributor's namespaced
package-list URI evidence. The existing name encoding protects namespaced parents;
the regression asserts `/sap/bc/adt/bct/smbctyp/%2Flce%2Fsfc_xyz_trshlds`.

## Candidate experiments and the additional fix

An empty inactive parent shell was insufficient for a complete lifecycle. A
disposable SMBC configured against an existing non-draft Travel service failed
activation with an explicit draft-handling requirement. Neither attempt changed
existing service objects, and both disposable parents were deleted.

A read-only inspection of the existing Book demo's binding, service definition,
and projection behavior established a suitable draft-enabled service. A new SMBC
in `$TMP` referencing that service activated successfully; no new RAP graph was
needed and the existing service was unchanged.

KTD create still returned HTTP 400 `Check of condition failed` when
`refObjectDescription` was omitted. Providing the parent description succeeded.
To rule out activation timing, this was repeated on the same active parent:
create with description succeeded, delete KTD succeeded, create without description
failed, and create with description succeeded again.

The reviewed plan was therefore extended with one narrow guard: `SMBC/TYP` create
requires a nonempty `refObjectDescription`, returning an actionable error before
the POST. It checks trimmed emptiness but preserves the supplied value verbatim.
No description is invented or fetched, and other parent types are unchanged.
Tool prose and examples describe the conditional requirement.

## Final-build validation

The final build used contributor history plus main in merge
`d639e12af4a2a3174cdb25b0c1d62eb34e350619` and this PR's reviewed description guard.
Calls ran through `handleToolCall` from locally built `dist`, over direct
HTTPS/Basic to SAP_BASIS 758 SP02, client 001, with TLS verification enabled and
`allowedPackages=['$TMP']`. The parent setup/cleanup used ARC-1's existing guarded
low-level ADT create, lock/update/unlock, activation, and delete helpers.

Final disposable object: `ZARC934_MUXR1OU0`.

1. Created and activated its SMBC parent.
2. Created a KTD with description, deleted it, and confirmed the omitted-description
   retry now returns the explicit ARC-1 error rather than SAP's opaque HTTP 400.
3. Created the KTD again. Metadata confirmed its own package `$TMP` and parent
   `SMBC/TYP` with URI `/sap/bc/adt/bct/smbctyp/zarc934_muxr1ou0`.
4. Updated Markdown to v1, activated, and read the active text back through SAPRead.
5. Updated to v2, activated, and read it back. The complete parent-reference XML
   remained byte-identical across the updates.
6. Deleted KTD and parent. The final object-name search was empty. Every earlier
   experimental fixture was likewise cleaned up.

The final complete unit suite passed 259 files / 7,847 tests. Typecheck, lint,
policy validation, file/schema budgets, build, and whitespace checks passed.
The SMBC tests cover namespace routing, preserved description text, missing/blank
description, read-only/package denials, and rejection of an unverified SMBC subtype.
They live in their own file to retain the existing DDIC test-size budget.

## Limits and scope

The new route was independently verified on 758 through direct Basic authentication.
A namespaced customer BCMO lifecycle is contributor evidence, while namespace
encoding is independently covered by unit tests. The Fiori app presentation was
not exercised. SAP_BASIS 816 was unavailable due to its known license-check logon
failure; no final-build BTP/PP test is claimed. General SMBC read and transport
support is not added. Roadmap checked before and after: no roadmap impact.
