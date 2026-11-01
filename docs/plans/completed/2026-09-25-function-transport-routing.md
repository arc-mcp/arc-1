# Function-group transport routing (#576)

## Root cause and choice

FUNC has no standalone ADT collection, and a FUGR structural include lives below
its group. The generic resolver throws for FUNC and constructs a standalone include
URI for INCL; a missing `/transports` resource then looks like an empty result.
Keep the existing PR and contributor history. Its one group-aware resolver is the
right boundary; no transport engine or write-path redesign is needed.

## Plan and review

Use an explicit group for FUNC/INCL; resolve FUNC's group through existing exact
search when omitted. Decode a group returned as an encoded URI segment before
encoding it for the next URL. Standalone INCL routing stays unchanged. Remove the
history-only catch so transport lookup failures use central error redaction/audit.
Clarify the tool and operator descriptions, including that a new FUNC needs an
explicit group and that `history` reports current locks/candidates, not a complete
historical record. Preserve check's create/modify semantics and all capability gates.

The cache delegates misses to the same exact-name, decoded-group resolver; existing cached values
keep their normal lifetime. Transport URLs reuse the shared group/module builders.

Verify both actions through dispatch, ordinary and namespaced paths, auto-resolution,
missing group, central minimal errors, and unchanged standalone includes. Run live
read-only checks on two releases, with writes disabled. Do not create or alter a
transport merely to exercise routing.

No roadmap impact: ARCH-02 is the separate server-driven generic-routing gap.

## Live verification (2026-09-25)

With writes and transport writes disabled, check(modify)/history passed on 758 and
816 for TR_TADIR_INTERFACE (STRD, explicit and auto group), LSTRDF01 (STRD), and the
standalone ZABAPGIT_FORMS include. SAP reported transport recording for SCTS_OBJ
and local storage for $ABAPGIT. Main rejects the group parameter or throws for FUNC;
the corrected branch addresses the real resources. No objects/transports changed.
The cached resolver also returns decoded `/UI2/UTILS` for `/UI2/CALL_TRANSACTION` and
reads its source on 758/816; a second resolution uses the cache. Locked-result parsing
has unit coverage; no live occupied transport or PP identity was used. This is routing coverage, not
proof of historical completeness or every backend's subresource support.
