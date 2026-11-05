# Private DDIC/server-driven review corrections — 2 November 2026

The independent review of `9e7ef606a8553d99f5e4d5e6d2d9381e9032fc98` requested changes for four
P2 correctness findings. Its [verbatim report](broader-pinned-pp-writes/codex-ddic-sdo-review-20261102.md)
has SHA-256 `aa6bfb20ad1f7b4e78a08781a627d999acb2008d5bc64c5a4ce89516ea4b7c5f`.
The reviewer was Codex after the actual Claude Opus 5.5 HIGH session reached its usage limit;
neither that report nor this correction is a Claude acceptance verdict.

The second independent review closed DDIC-R1–R4 and found DDIC-R5 below. Its correction awaits
another independent review. All DDIC and
server-driven candidates remain private, with unchanged public capability and invocation refusals.
No live SAP/BTP request, credentials, native mutation or PP qualification was used here.

| Finding | Correction | Offline regression evidence |
| --- | --- | --- |
| DDIC-R1: digit strings treated as numbers regardless of field | Only enumerated native dimension/count paths normalize leading zeroes. Comparison removes leading zeroes as text, with no JavaScript number conversion. Descriptions, labels, message numbers/text and character fixed values remain exact. | DOMA description `007` → `7` sends PUT; an ignored text change reports an unconfirmed save. Distinct integers above the safe-number range differ, while padded numeric dimensions still compare equal. Whitespace-only character values are retained. |
| DDIC-R2: namespace identity lost in the projection | Comparison/hash keys carry stable aliases for exact known namespace URIs and expanded names for every other namespace. Unknown namespace presence survives even with no scalar value. Subtree matchers never authorize dropping foreign namespace fields. Only exact native bookkeeping/reference fields and profile-specific derived lists are omitted. | Same-local-name element/attribute collisions, changed namespace bindings, empty extensions, unknown URI attributes, derived-list lookalikes and extensions inside selected lists refuse loss; equivalent prefix renaming preserves the hash. |
| DDIC-R3: unconditional activation exemptions | Save and activation share `derivedMetadataFields`, using the target/captured definition respectively. Domain/dictionary references require an unambiguous mode and a nonempty native type reference. Explicit built-in dimensions and explicit lock parameters remain evidence. | Active DTEL datatype/length/decimals drift, active TTYP built-in drift and explicit ENQU parameter drift all report activation unconfirmed. Domain-derived DTEL, dictionary-row TTYP and newly generated ENQU parameters remain accepted by the offline model. |
| DDIC-R4: absent/blank language evidence permits MSAG writes | A message update requires namespace-bound native language and master-language values, both usable and equal. Missing, blank, padded or ambiguous identity refuses before PUT; no builder default supplies missing evidence. | Both absent, both empty/blank, either absent, ambiguous language/master-language, padding and existing non-master-language cases all send zero PUTs. |

`metadataHash` now includes namespace identity. Previously captured private hashes must be read again;
no public read companion or stable public hash API exists for these candidates. Numeric padding remains
part of a hash even where a known numeric field compares equal for save verification. This keeps the
precondition sensitive to the captured native representation.

## Validation and evidence limits

The focused six-file DDIC/server-driven suite passes 317 tests, including 44 added regressions. It uses
the repository's recorded XML shapes and a mocked stateful transport; it cannot establish native save,
activation or cleanup behavior. The complete local checks passed:

| Check | Result |
| --- | --- |
| Full unit suite | 506 files, 13,715 tests |
| Typecheck | Source, scripts and tests projects |
| Build | TypeScript plus copied AFF schemas |
| Biome lint | Passed; three existing informational suggestions remain |
| Policy | 135 entries, 14 schemas |
| Size/schema gates after staging | 998 tracked source/test files; all 12 tool-schema scenarios |
| Documentation | Strict MkDocs build |

The verbatim report retains its original Markdown hard-break spaces on the candidate/base lines;
the remainder of the staged patch passes `git diff --check`. Its SHA-256 above is unchanged.

The [native qualification requirements](2026-11-02-pinned-ddic-server-driven.md#fresh-native-evidence-required-before-public-admission)
remain open. In particular, obtain fresh stored/saved/active metadata for built-in and domain-based
DTELs, built-in and dictionary-row TTYPs, and ENQU definitions with explicit versus generated
parameters. Preserve every native namespace and field in that evidence. Verify language and master
language for MSAG in master and translated views, including refusal where identity cannot be proven.
Native defaults, derived fields and empty-value equivalence must be confirmed per family/release before
public admission. Two successful PP writers, transportable flows, refusal controls, read companions,
catalog/schema review and the broader PR acceptance remain separate work.

FEAT-93 is narrowed to acknowledge these review corrections while keeping fresh independent review,
native evidence, public admission and PP qualification open.


## DDIC-R5: exact subtree boundaries after review 2

The [verbatim second independent review](broader-pinned-pp-writes/codex-ddic-sdo-review2-20261102.md)
reviewed `7a1e8aefec0e33a4d279a31857aa43b0607990d7`. Its SHA-256 is
`97f88f178b53910fd35b5c0caacafcf4a2d26927b98a694c809c23a4f97daf4c`.
It closed the four earlier P2s but requested changes for DDIC-R5: a selected path prefix such as
`/ttyp:rowType` also authorized deleting the unselected same-namespace sibling `rowTypeOptions`.
These are adversarial preservation examples, not claims that A4H currently returns those fields.

The new `metadataSubtree` matcher quotes the selected path literally and requires an exact final
segment, an optional repeated-entry index, then end-of-path, a child, attribute or presence boundary.
Every DOMA value-table/fixed-value, TTYP row-type and ENQU table/parameter subtree selector uses
that shared boundary. Native namespace restrictions remain independent and unchanged.

The analogous matcher audit found and corrected the ENQU explicit-parameter presence check: a
`lockParametersExtra` sibling no longer counts as an explicit parameter definition. The generated
list omission paths already checked exact boundaries and now reuse the same helper. TTYP derived
built-in fields already have an explicit boundary; scalar selections, MSAG row/flag patterns and
create-assigned root fields already match exact complete fields. The owner collection prefix ends
at a slash and rejects nested owners; the TABL discovery prefix is followed by exact DT/DS admission.
No broader type, mode, namespace, native contract or public capability is admitted.

Before changing production code, all nine new real-handler prefix-sibling regressions failed:
the previous handler reported success after rebuilding away the extra field. With the correction,
they refuse before PUT, keep the stored document unchanged and complete owning-session unlock and
close. Six positive handler cases still save the exact intended subtrees, including repeated DOMA
fixed values and ENQU parameters. Eight projection cases cover exact descendants/attributes,
repeated entries, similarly named siblings, malformed repetition suffixes and derived-preservation
boundaries. The six-file focused suite now passes **340 tests** (23 added).

For this correction, the full unit suite passes **506 files / 13,738 tests**. Typecheck, build,
Biome lint (the same three existing informational suggestions), policy validation (135 entries /
14 schemas), staged sizes (998 source/test files and 12 schema scenarios) and strict MkDocs also
pass.

The reproduction and final validation logs are retained at
`~/.local/state/arc1-review/pr1142-ddic-author3/`. This is author verification of the correction,
not independent acceptance. The fresh native, PP, transportable-flow, read-companion and public
admission requirements above remain open; the original review verdict is retained without edits.

## Independent correction acceptance

The [third review](broader-pinned-pp-writes/codex-ddic-sdo-review3-20261102.md) closed DDIC-R5
at `b6dc05d4d`, independently passed all 340 focused tests and verified the immutable snapshot.
It accepts private integration only. The correction is integrated with the binding, package and
trace candidates; shared delete/activation retain both families' profiles. Native, PP and public
admission remain separate requirements.
