# Declarative v2 review corrections

The [independent review](broader-pinned-pp-writes/native-declarative-v2-review1.md) rejected
`5884adc722f5dba8f85cd6c425b51840b4785880` for two P2 evidence-binding gaps and one P3 runtime
contract mismatch. No real preparation, GET-only preflight or native attempt ran at that revision.
The original v1 failure and separately successful cleanup remain consumed and unchanged.

The shared native HTTP observer now revalidates the exact request after its asynchronous deletion
guard, before recording or sending DELETE. This closes source/evidence drift during both the
independent owner receipt and dependency-absence reads, for both fixed families. The original
guard still validates the receipt and stop state. Own UNLOCK and bounded session close retain
their narrow exception, so a refused DELETE does not strand the owning session.

The common runner also rechecks source and bound evidence after independent final-absence reads.
Drift makes that evidence unconfirmed and the result failed, while preserving the workflow's own
separate observations. It cannot publish a successful bound lifecycle using changed intent,
SM12 receipts or screenshot bytes. The claimed attempt remains consumed after this refusal.

V2 now requires `ARC1_LOG_HTTP_DEBUG` to be absent, including explicit false/empty values, matching
the documented runtime condition and the existing recovery entry. The review did not demonstrate
a secret leak; this corrects the stricter experiment contract.

Eleven added regressions failed before these fixes and pass afterward: four actual-driver cases
across both families and owner/child guard drift, three real temporary evidence-file changes
during final confirmation, and four debug values. The two targeted suites pass all 128 tests.
Full author validation and the immutable candidate revision are recorded in
`~/.local/state/arc1-review/pr1142-native-v2-fixes-author1/result.md`.

This follow-up is not native execution approval. Review the corrected immutable revision before
preparing its permanent intent. Genuine fresh SM12 observations, the actual successful preflight
ID and the other fixed prerequisites remain required. No native outcome, PP evidence or public
admission follows from these offline regressions; FEAT-93 remains open.

The [second independent review](broader-pinned-pp-writes/native-declarative-v2-review2.md) approved
the bounded phase chain at `a3a6ef551b5e3160caa47f3fc748ebdf218e1f5f`, subject to genuine fresh
prerequisites. No real phase ran. Subsequent test isolation and
[literal metadata matching](2026-11-02-metadata-subtree-literal-matching.md) change the source
revision; that historical approval does not transfer to the new candidate.

The [renewed independent review](broader-pinned-pp-writes/native-declarative-v2-review3-independent.md)
approves the separate bounded phases at `a0681f531efc452edaf8fca0777cfce0d0312ef6` only in the
frozen `codex/native-declarative-v2-qualification` checkout. It compared the unchanged native code
and ran 563 focused tests plus 592 matcher comparisons. The separate
[matcher review](broader-pinned-pp-writes/native-declarative-v2-review3.md) discloses its original
harness authorship; it is not the independent native approval. Its
[erratum](broader-pinned-pp-writes/native-declarative-v2-review3-erratum.md) corrects an unsupported
claim about JavaScript end-anchor behavior: both old and new matchers refuse the tested terminal
line breaks. No previously accepted newline or hostname bypass is established.

Offline preparation completed once at 22:20:10 UTC on 2 November, without credentials or SAP
mutation. Root inspected the saved six-owner intent and source/dependency graph. GET-only preflight,
the one claimed native attempt and fresh external zero-lock controls remain pending; preparation
does not provide native lifecycle, PP or public-admission evidence. The original v1/recovery
attempts remain consumed. Main development continues in a separate checkout.
