# Native DDIC and document contracts

These findings are narrow representation rules, not universal SAP equivalences. The
[research index](inventory.md) links current admission and evidence scope.

## Definition preservation

Metadata merging preserves stored master language/system, responsibility, language version and
unknown XML. Field paths retain namespace identity and literal spelling; punctuation is not a
wildcard. Numeric equivalence applies only to known numeric fields. Derived-field exemptions depend
on the selected definition mode and never cover unknown descendants.
[DDIC projection evidence](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-02-pinned-ddic-server-driven.md).

TABL subtype needs exact repository identity and matching collection metadata, not alternative
collection probes. DTEL/TTYP creation needs its follow-up metadata save. Settings/index package
authority comes from the real table. Apparently active index metadata does not override native
activation warnings or prove database adjustment; immediate-active resources have another lifecycle.

## DDIC source readback

A4H structure/table saves added empty code lines and changed existing internal horizontal
separators. Resolved TABL/DS and TABL/DT comparison permits only those differences and its existing
line-ending policy. Separator presence, indentation, trailing/whitespace-only lines, case, tokens,
annotations, literals and comments remain exact, including empty lines inside quoted/commented
spans. Unsupported or ambiguous lexical boundaries refuse before save.

Optimistic hashes remain byte-exact under the lock even when readback compares equivalent. Success
returns the actual stored hash. Unexpected content stays uncertain, without repeat save or
compensating delete. Other source families keep their own proof.
[Captured source and scanner limits](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-03-ddic-ddl-source-readback.md).

## Message classes

Rebuilding MSAG rows lost native links/bookkeeping. Retained rows need unique three-digit identities
and complete opaque XML, with only selected text changes. Message/long-text links bind the exact
class/row; unknown relations or ambiguous identities refuse without following links. Only validated
native modification bookkeeping may change on readback.
[Row preservation](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-03-msag-native-row-preservation.md).

Omission is not native deletion: SAP retained an omitted row after PUT. The A4H controller upserts
ordinary rows, then consumes explicit direct `mc:deletedmessages` / `mc:msgno` instructions in the
MessageClass namespace. Exact final membership still needs verification.
[Removal contract](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-04-msag-explicit-native-removal.md).

Unselected character references keep raw spelling; selected new values are escaped once. The MSAG
profile decodes valid XML references once for identity/hash/comparison: `&#65;` means A, while
`&amp;#65;` means literal reference text. CDATA/comments remain literal. Undefined entities, illegal
code points, duplicate expanded identities and foreign links refuse. Other XML profiles are unchanged.
[Character-reference correction](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-04-msag-native-character-references.md).

## Enhancement documents

An exact present `contentSpecific/badiTechnology` may omit `badiImplementations` when empty. That differs
from missing technology, duplicate lists or foreign namespaces. Unknown XML survives first insertion;
mixed dependency usages remain bound to their individual reference identities.

Save readback derives runtime descriptions, supported virtual/concrete BAdI URI forms and an empty
customizing-lock default. A nonempty lock remains writable content. Only changed intended BAdI/class
dependencies permit known usage recomputation; ordinary edits preserve that receipt. Unknown
attributes/children/extensions stay compared by identity. The supported projection is checked before
PUT too; full optimistic hashes do not lose these fields.
[Native source/readback findings](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-04-enho-native-readback.md).

## Documentation and state links

ENHO and SKTD can advertise a literal `./<exact encoded owner leaf>?version=active|inactive`. Validation
never resolves, decodes or follows it. Foreign owners, traversal, alternate encodings, extra queries,
fragments and duplicate alternatives do not establish state. Declared state and selected body still
matter, and each document family retains its save-comparison rules.
[SKTD](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-04-sktd-relative-state-link.md)
and [ENHO](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-04-enho-relative-state-link.md).

SKTD operation references may acquire derived descriptions only on the single direct reference of
an exact supported element bound to its BDEF parent, owner, element/parent IDs and literal source
fragment. Root/parent descriptions and opaque descendants stay exact. Full metadata hashes include
these labels, so stale/under-lock changes still refuse.
[Reference-label evidence](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-04-sktd-native-reference-labels.md).

Owned RAP documentation creation can add one exact DITA link to BDEF metadata without changing its
source. A qualification observer must bind that explicit transition; normal comparisons cannot ignore
documentation links. The inverse needs confirmed owned deletion and typed absence, not assumed
symmetry. This is not permission to mutate the parent or relax the production document writer.
[Parent-coupling evidence](https://github.com/arc-mcp/arc-1/blob/1636bab36d86df10ba169f816d2bb4555b38419b/docs/research/2026-11-04-rap-document-parent-coupling.md).
