# Source preconditions (#850)

## Root cause and scope

Locks protect a single write call. They cannot tell whether a caller's replacement was based on
source read before a human changed the same FORM, method or whole object. A local dispatcher
reproduction on `202ad566` reads fresh source under the lock, overwrites the changed target FORM,
and reports success. #831/#845 preserve surrounding source but do not solve this cross-call case.

## Implementation

1. Add `SAPRead(format="editable")`: a fresh, uncached, unversioned developer-view source read
   returning `{source, sourceHash}`. Support ordinary text-source objects and class includes;
   reject mixed version/grep/method/structured requests rather than hash transformed text.
2. Add optional `SAPWrite.expectedSourceHash` for text-source updates and class/procedural surgery.
   Compare SHA-256 of the entire addressed source/include after acquiring the existing SAP lock,
   before any PUT or include initialization. A missing source or mismatched hash refuses the write.
3. Keep ordinary reads and writes compatible. Explicitly document that omitted preconditions are
   unguarded across calls, and whole-source hashing conservatively refuses unrelated source changes.
   Treat null/blank hashes as omitted; reject non-empty hashes on unsupported operations/types.
4. Exercise the real dispatcher with drift, unchanged source, read/lock failures, aliases, includes,
   cache settings and safety denials; verify the operation on disposable a4h objects if available.

## Design

An explicit hash avoids hidden per-user read history, eviction semantics and cache-dependent safety.
No lock crosses a tool call. The hash is a content comparison, not an authorization token or an ABA
change-history detector. Exact UTF-8 source is hashed without whitespace/line-ending normalization.
Read and write must address the same object/include/group; mismatch errors name the checked URL.
Function-module parameter-only updates derive source under the lock and abort on read failure.
Their parser recognizes SAP’s template comment before an empty signature’s bare terminator;
missing this terminator previously discarded the body despite a successful read. Hash matching
is conservative for unit edits: it covers the containing source, not only one FORM or method.

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
Follow-up live checks on both releases verified INCL+group stale refusal and fresh update/edit_unit,
and guarded/unguarded FUNC parameter updates preserving the body. This run exposed and reproduced
the signature-template parser defect above. All owned FUNC/INCL/FUGR objects were removed (404).
No BTP/PP or live CDS/interface write test is claimed. Mutation checks detect missing hash checks,
accidental include initialization, hashing objectstructure and the template-parser regression.
The description-count ratchet reserves this property and #855’s read-only syntax property so
either merge order passes; wire/token ceilings remain unchanged.
