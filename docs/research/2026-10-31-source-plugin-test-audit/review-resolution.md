# Claude Code review disposition

The independent review of c282043d found 3 Medium and 7 Low findings, with no Critical or High
finding. It used Claude Code 2.1.308 with the account's default `claude-opus-5-5` model and
read-only tools. [Original report](claude-review.md).

| Finding | Resolution and regression evidence |
| --- | --- |
| 1: structural INCL summary | Summary and sources bind the first actual FUNCTION header. Already-captured base source is reused; an absent capture costs one bounded read. Matching/mismatching headers are tested in both modes. |
| 2: comment regex / oversized source | A linear line scan replaces the multiline backtracking expression. A 256 KiB blank-line scan completes within one second; oversized matching sources retain identities and report the source scan limit. |
| 3: diagnostic overflow | Source diagnostics deduplicate repeated observations. The renderer caps counted diagnostic details before shedding identities, keeps budgets/omissions visible, and returns valid JSON in its metadata fallback. Sixty skipped SAP includes and a 4,000-byte provider reason exercise both cases. Public result/export shapes remain unchanged. |
| 4: traversal branch gaps | Added inherited-owner, same/other-namespace, SAP-under-customer, occurrence, depth and source-unit limit cases. |
| 5: filter and context labels | FUNC partial reads retain the owning-source/base-filter marker. Context is present both in scope text and the structured report. Handler and live MCP assertions cover these fields. |
| 6: missing-provider cutoff state | Node, depth and occurrence limits retain incomplete status and explicit omission counts instead of reporting provider absence. |
| 7: unusual include names | Unsupported generated names are skipped with an explicit issue while a valid sibling remains readable; no guessed route or global protocol stop. |
| 8: nested graph label | In-response element graphs use bounded nested coverage; cheap outer identity lists remain not_expanded. The 750 summary graph case checks this distinction. |
| 9: missing parser parent | An omitted selectedObjectUri cannot match an empty parent URI. Removing the actual parent element is rejected. |
| 10: canonical graph endpoints | Parent and replacement targets use canonical type/name/version keys even when a parent is not among the retained implementations. The nested chain joins back to the canonical root. |

The local audit additionally found that a second query separator could discard location text.
Both a discarded suffix and an ignored wrong-owner context now have rejection regressions.

`source-plugin-review.test.ts` contains the integration regressions. Parser/resource/handler tests
also cover the individual boundaries. The live MCP matrix now includes a structural U01 include
under FUGR context, exercising its default summary as well as explicit summary/sources.

Wrong-context SAP semantics remain unobserved; the feature displays the supplied context and
reports only its checked scope. No assertion of global absence or runtime applicability is made.
BTP positive plug-in bodies, 750 MCP replay and live PP qualification remain explicitly unqualified.
