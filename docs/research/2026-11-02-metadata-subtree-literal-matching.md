# Literal metadata subtree matching

CodeQL reported three hostname-regex annotations on the core, TTYP and ENQU namespace constants
at `a3a6ef551b5e3160caa47f3fc748ebdf218e1f5f`. Static triage found no supported exploit path:
these are XML namespace identities, namespace comparisons are exact, and the old subtree helper
escaped every regex metacharacter before constructing its anchored expression. The annotations
were not dismissed in GitHub.

The subtree helper now compares the literal path prefix and its following boundary directly.
It accepts an exact path, one optional decimal repetition index, and child/attribute/presence
boundaries. Prefix siblings, malformed indices and trailing line breaks refuse. Namespace strings
are never interpolated into a regular expression. A structural `test(path)` interface preserves
existing consumers and static RegExp field selectors.

Regressions cover all three reported namespace identities plus Atom, lookalike namespace strings,
repeated entries, exact boundaries and preservation of a lookalike Atom child in metadata hashes.
Existing field-preservation and native-driver tests remain applicable. Final validation and the
exact candidate are recorded in `~/.local/state/arc1-review/pr1142-metadata-literal-author1/result.md`.

This is a clarity/correctness change, not evidence of a previously exploitable hostname bypass.
The static triage artifacts are retained by the Codex Security plugin; runtime regression checks
belong to the subsequent development work. FEAT-93's scope and remaining native/PP/public-admission
requirements are unchanged. Any new source revision still needs its own native execution review.
