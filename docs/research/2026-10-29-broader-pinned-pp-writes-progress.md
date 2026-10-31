# PR 2 implementation checkpoint — 29 October 2026

PR 1 [#1138](https://github.com/arc-mcp/arc-1/pull/1138) was squash-merged as
`ac8385fa47b6c40c2c77c6507e03c376bfc3b613` after its 16 checks passed. PR 2 starts from that
merged revision on `codex/broader-pinned-pp-writes`.

## Implemented prerequisite

- Pinned package hierarchy reads carry the mutation deadline, cancellation and no-replay policy
  through nodestructure and CSRF. Missing policy refuses. Single-target caching and POST shape stay
  unchanged.
- Each package decision obtains fresh evidence. Its independent server and destination gates may
  share a decision-local result; later preflight/under-lock/activation checks cannot reuse it.
- Pinned activation now uses the shared HTTP facade, preventing the activation engine's child
  budget from extending the original preflight deadline.
- [ADR-0011](../adr/0011-broader-pinned-pp-mutations.md) is proposed. The
  [inventory](broader-pinned-pp-writes/inventory.md) records current mutation rows, types, aliases,
  fields, branch constraints and identity dependencies. Four drift tests require explicit inventory
  updates. This is not the future runtime admission matrix.

No new action or object type is enabled by this checkpoint. The broader adapters, runtime matrix,
catalog/role projection, native policy qualification and documentation remain PR 2 work. FEAT-93
stays open. This draft is not ready for merge or deployment.

## Verification

The local gate run passed **383 files / 10,585 unit tests**, TypeScript, lint, policy validation,
build, file-size and schema budgets. The [gate record](broader-pinned-pp-writes/prerequisite-gates.json)
and [source manifest](broader-pinned-pp-writes/prerequisite-source-manifest.json) identify this checkpoint.
The integration-test-only change was typechecked separately after the gate run.

The A4H client-001 live lifecycle test passed via direct authentication at
`https://a4h.marianzeis.de` on port 443. It created a disposable `$TMP` class, exercised both source
adapters, refused a stale hash, reacquired its lock, activated through the pinned adapter, deleted
the class and independently verified GET 404. This is native adapter regression evidence, **not
XSUAA/PP route qualification**. No CTS release, trace, FLP change or application deployment occurred.

Cloud Foundry initially refused its expired/revoked login. After the owner refreshed it, read-only
inspection confirmed `arc1-ta-677-test` healthy with writes/transport writes off, strict PP, enforced
target authorization, cache-none and the dedicated XSUAA plus shared destination/connectivity
bindings. Its environment was not changed. Broader live PP qualification has not started.

## Review loop and dispositions

The completed [first Claude review](broader-pinned-pp-writes/claude-prerequisite-review.md) ran with
the actual Claude Code model `claude-opus-5-5`, effort `max`, read-only tools, hooks/MCP disabled.
It found no security/blocking defect in the initial prerequisite, conditional on adding handler
cancellation coverage, and reported three low-severity findings:

| Finding | Disposition |
| --- | --- |
| Duplicate subtree walks across the two package gates | Added decision-local sharing; fresh evidence retained across separate checks. Create regression asserts one walk per root per phase. |
| Unrelated request options copied into hierarchy requests | Copy only deadline, signal and fixed no-replay/retry flags; clone/response-option test added. |
| Cache documentation stale | Updated resolver header, developer guide and operator guidance. |
| Missing mid-walk handler cancellation evidence | Added preflight and under-lock aborts on the real HTTP stack: no source GET/PUT; no later child request; owning unlock still attempted. |
| Additional test gaps | Covered server-vs-destination denial, same-root create, activation scope drift, original signal identity, legacy clone isolation, CSRF cancellation/replay refusal and precise failure phase/state. |
| Preexisting activation child-budget extension | Scoped activation through `mutationHttp`; slow-preflight regression asserts original deadline at the activation POST. |

The focused second code review and separate ADR/inventory review both stopped at Claude's account
session limit, reported to reset **21:10 Europe/Berlin on 29 October**. Their
[code-review status](broader-pinned-pp-writes/package-review2-status.md) and
[design-review status](broader-pinned-pp-writes/design-review-status.md) are explicit failures to
complete a review, not approvals. The second-pass source files were frozen; its unreviewed activation
change and the new design still need the requested independent review. No substitute model was used.

Resume those reviews first, address findings and rerun affected checks, then continue the reviewed
P2-A through P2-H work packages. Keep the full scope in this draft PR; do not mistake this
prerequisite checkpoint for completion of the two-PR plan.

## Subsequent work

The interrupted review was completed on 31 October. See the [next checkpoint](2026-10-31-broader-pinned-pp-writes-progress.md) for its dispositions, continued implementation and subsequent review status.
