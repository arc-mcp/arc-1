# Server-driven deletion outcome (#839)

## Root cause and live reproduction

On 816, an active DRTY child inherits from an active base. ARC-1's raw DELETE reports success,
while the base's metadata remains readable without a package. Independently reproduced 2026-09-25
on owned `$TMP` objects after checking the repair function's signature and dry-run permissions.
After deleting the child, restoring only the owned base's directory entry with `TR_TADIR_INTERFACE`
allowed ordinary deletion. Both types and the temporary repair class were confirmed absent.

SAP's `/deletion/check` correctly reports `isDeletable=false`, one strong reference, for the base;
the child reports true. Discovery advertises the check request MIME. Eclipse ADT 3.58.1's bundled
`model/deletion.xsd` and [another client's implementation](https://github.com/fr0ster/mcp-abap-adt-clients/blob/main/src/core/shared/deletionCheckByUri.ts)
corroborate the request. [SAP's deletion guide](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/deleting-development-objects)
describes refusing Dictionary objects still used by another Dictionary object.

## Implementation and review

1. Keep write/package gates. Under the object's lock, call the advertised deletion check with that
   object URI and lock handle. Require exactly one matching, explicitly deletable response;
   refuse a negative/inconclusive response or HTTP failure. Without an advertised check, retain
   compatibility but do not claim dependency safety. Unavailable discovery fails closed.
2. After accepted DELETE and best-effort unlock/session closure, make a fresh canonical metadata
   GET with the type's Accept. Only 404 confirms absence; 200 means the object remains; other
   failures mean absence is unconfirmed. Never issue a destructive retry as recovery.
3. Invalidate caches after an attempted deletion even when confirmation fails. Cleanup failure
   must not hide the deletion outcome. Keep fixed, detail-free guidance safe in minimal mode.
4. Verify regression, dependency refusal, independent deletion, response identity, package gates,
   readback failures, and cache/audit behavior; live-check 758/816 and run local gates.

No automatic TADIR repair ships. This is neither a complete dependency inventory nor an atomic
transaction against changes to other objects. Canonical metadata absence is the readback evidence.
No roadmap impact after checking; a general multi-object deletion workflow remains outside scope.

## Validation

- New dispatcher regressions fail 12 cases on main `c3fcf3df3`; fixed coverage includes cold and
  preloaded discovery, refusals, readback outcomes, minimal errors, package gates and cache/audit.
- Direct HTTPS/Basic on 758 and 816: the checked, locked delete refuses the dependent base and
  preserves its package; child-first deletion then succeeds, with metadata 404 for both objects.
- An intermediate readback-only implementation independently identified the 816 orphan as an
  error; its fixture was repaired and cleaned. Final prechecks avoid that partial deletion.
- Full local gates and totals recorded in the PR. BTP and other SDO families were not exercised
  in dependent-delete scenarios; no claim is made that they share DRTY's backend defect.
