# Source preconditions (#850)

## Root cause and scope

Locks protect a single write call. They cannot tell whether a caller's replacement was based on
source read before a human changed the same FORM, method or whole object. A local dispatcher
reproduction on `202ad566` reads fresh source under the lock, overwrites the changed target FORM,
and reports success. #831/#845 preserve surrounding source but do not solve this cross-call case.

## Plan

1. Add `SAPRead(format="editable")`: a fresh, uncached, unversioned developer-view source read
   returning `{source, sourceHash}`. Support ordinary text-source objects and class includes;
   reject mixed version/grep/method/structured requests rather than hash transformed text.
2. Add optional `SAPWrite.expectedSourceHash` for text-source updates and class/procedural surgery.
   Compare SHA-256 of the entire addressed source/include after acquiring the existing SAP lock,
   before any PUT or include initialization. A missing source or mismatched hash refuses the write.
3. Keep ordinary reads and writes compatible. Explicitly document that omitted preconditions are
   unguarded across calls, and whole-source hashing conservatively refuses unrelated source changes.
   Reject preconditions on unsupported operations/types instead of silently ignoring them.
4. Exercise the real dispatcher with drift, unchanged source, read/lock failures, aliases, includes,
   cache settings and safety denials; verify the operation on disposable a4h objects if available.

## Design review

An explicit hash avoids hidden per-user read history, eviction semantics and cache-dependent safety.
No lock crosses a tool call. The hash is a content comparison, not an authorization token or an ABA
change-history detector. Exact UTF-8 source is hashed without whitespace/line-ending normalization.
Supported callers must use the same object/include for read and write. Hash matching is conservative
for unit edits because it covers the containing source, not only one FORM or method.

[HTTP conditional requests](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.1) establish the
lost-update principle, but do not prove SAP ADT honors If-Match on every source endpoint. Compare
locally under the already verified SAP lock rather than assume that endpoint contract. PR #586's
anchor replacement is useful but narrower (PROG/INCL), conflicts with current main, and combines
another feature; it remains separate.

Roadmap checked: ARCH-03 is a distinct within-call RAP scaffold race and remains unchanged.

## Validation and limits

On SAP_BASIS 758 and 816, direct HTTPS/Basic, client 001 and disposable `$TMP` objects: stale
PROG update/edit_unit, CLAS update/edit_method and local-include edit_method all refused the write;
read-back retained the competing change. Re-reading, reconciling and supplying the new hash succeeded;
a second client could relock. Both objects on each system were deleted and metadata returned 404.
No BTP/PP or live FUNC/CDS/interface test is claimed. Unit tests cover routing and refusal boundaries.
Removing the hash assertion makes both cross-call dispatcher regressions fail. The one additional
property raises only the description-count ratchet by one; wire/token ceilings remain unchanged.
