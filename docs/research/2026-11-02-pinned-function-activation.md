# Private FUNC activation adapter

> Historical implementation record, superseded by the [review 18 follow-up](2026-11-02-function-activation-review-followup.md) and [review 19 corrections](2026-11-02-group-activation-review-followup.md). The budget, metadata-proof and review statements below describe the earlier revision.

This candidate extends the existing pinned activation orchestrator with an exact native FUNC
profile. It does not add FUNC to the public capability matrix. FUGR generation, group-owned
include activation and broader/batch expansions remain separate unfinished profiles.

The selected module and its group are validated before lookup or URL construction. A missing
group may be resolved by the existing native search, after which fresh parent/child metadata
proves the actual group and package. The shared scoped client carries the mutation deadline,
cancellation and no-replay policy through lookup, ownership checks and activation.

Before the initial preaudit and any confirmation, the profile validates the exact selected module
reference and independently rechecks native package and recording policy. Expanded group or sibling
references are refused. Encoded namespace separators may differ only in hex case. Native name, type
and deletion markers must agree; malformed, duplicate, absolute, query-bearing and source-fragment
references cannot select another resource. The existing CLAS/INTF/PROG/INCL validators are retained
within the same orchestrator.

The first validation captures the stored inactive source hash. A confirmation rechecks that hash
and refuses a changed draft. A positive native activation result then requires explicit native
active-version metadata with the same owner/package, plus an active-source hash equal to the
preactivation source. An active GET falling back to inactive, mismatched source or failed readback
remains activation-unconfirmed, with the earlier native success preserved in the diagnostic.
This is sequential readback evidence, not an atomic SAP snapshot or a claim about unrelated drafts.

Source reads require text/plain and a bounded native function signature/body frame. The response
budget is one MiB per source or active-metadata read, including error/control responses; the
existing frame parser also limits the signature/footer to 64 KiB. Oversized or unsupported frames
refuse before activation when encountered in preflight. The helper preserves actual stored bytes
for hashing; it does not silently normalize a changed source.

Author validation initially passed 81 focused tests, including 38 new FUNC admission, native
readback, malformed-reference, fallback, source-budget, cancellation and uncertain-outcome cases.
All 486 unit files / 12,999 tests, the three TypeScript projects, build and lint (three existing
infos) passed. After the metadata response-budget addition, all 38 FUNC cases, strict documentation
and 965 tracked source/test file budgets plus 12 schema scenarios also passed. No live test or independent review of this adapter has occurred. The separately reviewed
[active-FUNC deletion experiment](2026-11-02-native-function-protocol.md#seventeenth-review-and-successful-native-active-deletion)
passed at the earlier `5b1669eb` checkpoint; this newer activation profile was not part of that run.

The subsequent author review found that a word-boundary MIME match accepted
`text/plain-unsupported`. A new regression reproduced the false acceptance. The profile now
compares the complete media type before parameters; all 39 focused FUNC cases pass. This source
change and the native-result documentation are included in the next immutable review snapshot.
