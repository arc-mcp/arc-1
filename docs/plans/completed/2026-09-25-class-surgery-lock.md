# Class surgery preserves editable drafts (#837)

## Root cause

Class method and definition edits derive replacement source before `safeUpdateSource`
locks the class. A completed competing write can be overwritten. Separately, inactive-list
and source caches can select active bytes instead of the editable draft. ETag freshness
does not prove that the selected version is correct.

## Implementation

1. Reproduced both cases through the dispatcher for MAIN and local includes. Verified the live
   editable-source and objectstructure version contract before choosing query parameters.
2. Keep argument validation and the real-package gate. Within one stateful class lock, read
   fresh editable source and, where needed, its matching structure; splice, retain existing
   refusal/lint checks, PUT, and unlock. Remove the cached structure/source helper from the
   general write context. Use one class-specific lock helper, without a generic transform or
   cache framework. Whole-include replacement retains its existing initialization behavior.
3. Cover competing writes, hidden drafts, structure alignment, local includes, refused reads,
   validation failures, package/write gates, transport selection, and cleanup. Verify owned
   disposable classes live, then run repository gates and review the full diff.

## Scope and review

Applies to `edit_method`, MAIN `edit_class_definition`, `edit_method_signature`, `add_method`,
`delete_method`, and `change_method_visibility`. Whole-source replacements and RAP scaffolding
retain their own contracts. Cache invalidation is best-effort so a cache failure cannot replace the SAP write/unlock outcome.
No tool-schema, activation, or unlock-policy redesign.

Roadmap: ARCH-03 tracks the separate read-before-lock gap in RAP scaffold application.

## Validation

- Dispatcher regressions cover draft preservation, refusal/cleanup and cache failures. Missing local
  includes receive include-specific guidance while releasing the class lock without a PUT.
- Direct HTTPS/Basic, two clients using the same test user, owned `$TMP` classes:

  | SAP_BASIS | Source/structure contract | Surgery and cleanup |
  |---|---|---|
  | 758 | Omitted version returns draft; explicit active returns baseline; ranges match each | Competing write completed before LOCK preserved despite primed stale cache; all six actions, local include, refusal/relock; DELETE then metadata 404 |
  | 816 | Same source/structure contract | Same concurrency/actions/include flow; missing-method refusal/relock; DELETE then metadata 404 |

- Sanitized 758 source/structure pairs are in `tests/fixtures/class-surgery/`. The draft adds a
  method, shifts implementation ranges and changes an unrelated method body. Tests exercise the
  dispatcher with that competing change applied immediately before LOCK succeeds.
- Active source remains unchanged until activation. Existing release-aware lint remains unchanged:
  unsupported releases can warn instead of blocking; SAP activation remains authoritative.
  Cross-user ownership, BTP principal propagation and 750 were not exercised live.
