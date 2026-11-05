# ENHO/SKTD review corrections

Date: 2026-11-02. The [independent report](2026-11-02-pinned-enhancement-documents-review1-verbatim.md)
is preserved byte-for-byte; SHA-256 `d6f5a62dc8465aab8261cfe2c9580712467e25d13a1ce8d81c492ef8b0e03f38`. It reviewed original feature
`249eb70703b7b95d077be4852167c323f8095c85`. This follow-up is on the combined primary/feature/read
branch; the [read companion](2026-11-02-enhancement-editable-reads.md) remains a separate commit.

## Disposition

- **F1, P2:** A private wrapper now qualifies KTD lexical write slots against their namespace
  and exact document-owned structural paths before the shared legacy rewrite. Native slot names
  under opaque extensions are refused even when they use the genuine KTD namespace. Foreign
  bindings, ambiguous or non-text structural leaves, lexical markers inside comments/CDATA and
  unknown prefix/layout contracts fail closed. This qualification is shared by update, dry-run
  and post-create save. A second comparison preserves all attributes, fields and opaque content
  outside the verified native body/short-text value slots; short-text-only edits cannot alter bodies.
  The ordinary single-target rewrite is unchanged. Read companions preserve native prefix aliases;
  receiving a hash does not imply a lexical layout is writable.
- **F2, P3:** Document activation uses `selected-document-owner-only` and
  `document-active-verification`, including the attempted scope on verification failures after
  native submission. SRVB retains its existing service-binding scope/phase. Native submission
  and cleanup uncertainty remain explicit; reporting does not retry or roll back work.

`writer-before-fix.log` preserves eight failing regressions before the corrections: nested foreign
and genuine KTD slots, foreign body/short-text slots, dry-run qualification and three document
activation aliases. The added controls cover lexical comments and an already-created shell whose
follow-up save is refused, with no PUT or replay. Existing multi-node accumulation, short texts,
opaque preservation, create and SRVB tests remain required.

## Limits

This correction uses controlled offline native-shaped fixtures, not fresh SAP evidence. It
intentionally refuses unqualified native structures instead of broadening the legacy transform.
Current-build native local/transported CRUD/activation, every claimed KTD parent/layout, classic
and cloud BAdI variants, two mapped writers and public capability admission remain open.
The combined writer/read candidate still needs independent source-bound review.

## Final combined offline gates

Node 22.21.1: all 529 files / 14,987 unit tests pass, including 39 editable-document and
80 document-writer tests. Source/scripts/tests typecheck, build, lint, policy, staged file/schema
budgets and strict documentation build pass. Seven tool-definition snapshots change only the
editable format description. The historical writer and read research remains separate from
this final combined evidence; no native or public readiness is implied.

## Review 2: semantic KTD attributes (2026-11-03)

The [verbatim independent report](2026-11-03-pinned-enhancement-documents-review2-verbatim.md)
reviews `30580655f06d0948b2038bb452e7e8fa55bf77f6`; its SHA-256 is
`f0b19ec525ad490a6aab98cf3c4d3e719aa0cbb8639393deea3e4ba873cc7ad2`.
It closes original F1/F2 but identifies F3/F4 below. The author reran its unchanged 22 probes
against that base: 16 passed and the six reported alternate-spelling cases failed.

- **F3, P2 — native root identity.** The private structural qualifier now supplies the parsed
  native owner name to an explicit shared KTD rewrite profile. Root selection, namespace-aware
  route qualification, ambiguity checks and short-text routes use that identity. Attribute aliases,
  single quotes and spacing around `=` remain supported without rebuilding the XML. The legacy
  profile is unchanged. Reordered empty nodes now select the actual root; explicit routes and the
  single documented field fallback retain their prior meaning.
- **F4, P2 — native long-text eligibility.** The same qualifier derives a complete per-element
  writability list from attributes on each structurally owned native element, using namespace
  bindings and one-pass XML entity decoding. A present obligation has precedence, unknown or empty
  values refuse, then `canHaveDocumentation` applies; only missing flags retain text-slot
  compatibility. The shared lexical locator requires one proof per located element and uses it
  before changing a body. Unchanged forbidden bodies remain byte-preserved when another node is
  edited. Short-text eligibility stays a separate native contract. Opaque foreign attributes do
  not become native policy fields.

All 22 original review probes now pass. New real-adapter regressions cover the supported lexical
spellings, empty-node ordering, ambiguity, presence/precedence, forbidden and unknown values,
missing flags, short texts, unchanged forbidden content, fresh reads under lock, changed eligibility,
preview refusal, post-create follow-up and opaque attributes. Encoded owner names that the existing
native owner parser cannot resolve remain explicitly refused; this patch does not broaden that
parser or alternate short-text slot serialization contracts. Early test construction incorrectly
classified numeric-entity owner names as supported and used an ambiguous root H2 in positive flag
controls; the fixtures were corrected to the established contracts without relaxing source guards.

The current-build native/PP/public-admission limits above remain unchanged. This follow-up needs
independent immutable re-review; author regression results are not an integration approval.

## Review 3: native short-text eligibility (2026-11-03)

The [verbatim independent report](2026-11-03-pinned-enhancement-documents-review3-verbatim.md)
reviews `ba32e31cd45511a95f4b39e591bc290248a56204`; SHA-256
`3bdde5f56dc34555bb9cedb60c7fef95390e537d6f5da3218b651c4c8f61dcb6`.
It closes F3/F4 but finds F5: an opaque attribute containing lexical `sktd:obligation="optional"`
can override an actually forbidden native short-text obligation; the reverse decoy incorrectly
blocks a writable slot. The author reproduced all four new failures before changing source.

**F5, P2 — corrected.** The native rewrite profile now also carries each structurally owned
short-text obligation, qualified by its namespace rather than attribute text elsewhere. The shared
writer uses that obligation for eligibility. Its native-only tag/value locator respects quoted
attribute boundaries and replaces just the actual `sktd:text` value span, retaining surrounding
quotes, whitespace and all opaque bytes. Value-like text in foreign attributes cannot become a
replacement target. The default legacy profile retains its existing behavior. Missing or unsupported
aliased native value slots refuse; no foreign metadata is rejected merely for containing a decoy.

All 26 unchanged review3 probes pass after the correction. The focused 255-test suite includes
24 new cases for forbidden/optional/mandatory/missing/unknown obligations, aliases and XML
spellings, opaque values containing both obligation and value decoys, quote/equals-space and opaque lookalike-element preservation,
preview refusal and an already-created shell whose follow-up short-text save is refused. Only the
intended native value changes in accepted cases; refusals send no PUT. Independent re-review and
the native/PP/public-admission gates remain open.
