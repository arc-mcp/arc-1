# Author review of the write-parity plans

Date: 26 October 2026. Code baseline: `e538bf71197ddb47ea74aca225c340a856d331af`.
Scope: static research/design review only, before the requested independent Claude review.

## Checks and dispositions

| Check | Result |
| --- | --- |
| Owner scope | Git/plugins excluded; deletion/transports/tracing/classic FLP included. The trace/FLP choice was explicitly confirmed. Upgrade expansion for opted-in writers is recorded without inventing approval for read-only writes. |
| PR separation | PR 1 freezes observable behavior and requires two actual production consumers; PR 2 owns capability, schema, role and policy changes. No runtime code was edited. |
| Existing-policy inventory | A local read-only script extracted 38 explicit non-Git `write`/`transports` action entries from `src/authz/policy.ts` before the hyperfocused aliases. All 38 action names occur in the PR 2 plan. This checks name coverage, not correctness of every type/action combination; the implementation must generate that detailed matrix. |
| Source freshness | Corrected the scope to existing editable text representations. Metadata/AFF/text pools do not magically gain source-hash support. Existing optional versus mandatory hashes remain distinct in PR 1. |
| Generated CTS IDs | Added pre-send create admission under unrestricted request policies; post-create denial is not rollback. Restrictive-policy creation remains an explicit support gap. |
| Transport reads and recursive release | Kept write policy separate from transport reads; preserved the stronger unrestricted requirement for recursive release. |
| Route/native target fields | Checked `prepareMultiTargetCall`: aggregate consumes `target`, pinned leaves it intact. The plan preserves CTS `target` while binding backend selection to the route. |
| PP user attribution | The profiler currently uses `client.username`; the plan requires actual SAP identity evidence or an explicit native user and forbids guessing from JWT display/email. |
| Runtime trace bounds | Current single-target trace numeric schemas lack the proposed upper bounds. Marked the 100-execution/24-hour pinned limits as proposed additions rather than existing behavior. |
| Non-repository policy | CTS, tracing/settings and FLP have explicit proposed resource domains. Package restrictions are not claimed to cover them; a new reviewed ADR is required in PR 2. |
| Truthful outcomes | Immediate-active types, two-step trace creation, non-atomic batch effects and absent FLP membership readback are called out. |
| Local references | All Markdown file links in the three draft documents resolve locally. Source anchors inspected against this checkout. |
| Roadmap consistency | FEAT-93 remains unfinished, P2/XL/Architecture; overview/details both say Design in review and link the two plans. Git/plugins are exclusions, not automatically promised follow-ups. |
| Validation scope | `git diff --check` passed. No unit/build/live SAP tests were run: the changes are planning/research documents only. |

## Remaining work before implementation

The proposed resource-domain permissions, role template, generated-ID restriction and extraction
seam need independent design review. Live identity/recording/FLP/trace evidence remains a future
implementation gate. This review neither approves an implementation nor claims runtime parity.

The next review is explicitly Claude Code `claude-opus-5-5`, effort `max`, with Read/Grep/Glob only,
no MCP servers, hooks, shell or file-edit tools. Its findings and subsequent dispositions will be
recorded separately so the author review is not presented as independent evidence.

## Final author check after independent review

The section above records the initial draft review and is intentionally retained. Its original
recursive-release choice was superseded by the consistent parent-request design in the revised
plans. See [dispositions](review-dispositions.md) for F1–F14 and the four small follow-up corrections.
The [follow-up review](claude-followup-review.md) found both plans suitable to guide implementation.
Final corrections were applied by the author; no third independent review is claimed.

Rechecked the action-name inventory, required package responsible identity, one generalized pinned
activation path, active text-pool content evidence, all named qualification gates and PR separation.
The final documents retain Git/plugins exclusions and the explicit trace/FLP inclusion. FEAT-93
is now **Design reviewed**, still unfinished. Local Markdown links/fences and `git diff --check`
pass; the source baseline is unchanged. No runtime, deployment or SAP changes were made, and no
unit/build/live tests were run for this documentation-only task.
