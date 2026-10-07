# KTD creation for Business Configuration Maintenance Objects (#933 / #934)

## Research and root cause

`SMBC/TYP` is already recorded as SAP-registered for DOCUMENTATION scope, but the
KTD create handler refuses it because ARC-1 has no verified parent URI route.
Current main fails the contributor's regression test before the KTD POST. This is
an intentional capability boundary rather than a Markdown or activation defect.

SAP_BASIS 758 SP02 discovery advertises `/sap/bc/adt/bct/smbctyp` with
`application/vnd.sap.adt.blues.v1+xml`. A disposable `$TMP` metadata shell created
through this resource read back as `SMBC/TYP` with the expected lowercase URI and
`$TMP` package. KTD creation against its inactive, empty shell returned SAP 400
`Check of condition failed`; the shell was deleted and a cleanup search was empty.
The contributor reports a complete create/update/activate success on an existing
758 BCMO. An independent complete lifecycle still needs an adequate active parent.

The live schema requires a service binding/name/version/root entity set. An
existing published demo V4 binding is available for read-only inspection; a unique
disposable SMBC can reference it without altering the binding or building a new
RAP graph. If activation requires further landscape setup, preserve that limitation
rather than broaden this patch to general SMBC creation support.

## Plan for review

Independently reviewed and approved before implementation. During candidate
testing, an active SMBC also rejected an empty `refObjectDescription`, whereas
providing it allowed the complete KTD lifecycle. The reviewed plan was extended
to add a narrow SMBC-only early error for missing/blank descriptions, preserving
the provided text verbatim and leaving other parent types unchanged.

Implemented and independently reviewed without further findings. The final built
758 lifecycle and all local gates passed; see the
[research and verification record](../research/2026-10-07-ktd-smbc-parent.md).

1. Continue #934 with contributor history and the normal merge of current main.
   Retain the small KTD-specific base-path map: it expresses the one verified
   exception without registering SMBC as a general readable/writable object type.
2. Keep the existing exact `SMBC/TYP` allowlist, parent/name validation, encoding,
   write/package gates, KTD create/update behavior, and unrelated refusal paths.
   Add focused tests proving the new route respects read-only/package denials
   and rejects an unverified SMBC subtype before any KTD request.
3. Update the user tool reference's parent-type list and a concise BCMO example;
   mention that general SMBC read/transport support is outside this fix. Update
   the model-facing parent examples only if useful within the existing token
   budget; do not introduce a new schema argument.
4. Independently test the candidate against a disposable active SMBC on 758:
   KTD create, parent/package metadata verification, Markdown update, activation,
   active readback, second update/readback, then delete KTD and parent and prove
   cleanup. Keep existing binding/configuration objects unchanged. Record exactly
   which lifecycle steps succeed if SAP blocks parent activation.
5. Run focused KTD tests, complete unit suite, typecheck, lint, policy validation,
   schema/file budgets, build, and whitespace checks. Review the final change
   independently and address findings before a normal push to #934. Verify latest
   origin/main is an ancestor immediately before publication.

## Scope and roadmap

The broader #933 request also mentions general SMBC read/transport handling. This
PR intentionally repairs the KTD parent route only; that separate expansion needs
its own object-type evidence and implementation. Existing create package checks
apply to the KTD's own package; confirm `$TMP` in live KTD metadata.

Roadmap checked: no current item describes this narrow KTD routing gap. No roadmap
impact. SAP_BASIS 816 testing is blocked by the known license-check logon error;
do not retry it as part of this work.
