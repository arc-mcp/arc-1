# BDEF live assertion repair

**Follow-up:** [Current cache-fixture repair and BTP requalification](2026-11-01-cache-fixture-and-btp-requalification.md) records the completed CI result and nine fresh BTP cases on this unchanged runtime. Earlier results below are retained as historical evidence.

The original final CI run on `92ca5bb41`
([run 41280502545](https://github.com/arc-mcp/arc-1/actions/runs/41280502545))
completed with two integration failures: the new BDEF assertion and the existing
where-used fixture. Integration had 278 passed / 2 failed / 116 skipped. E2E had
159 passed / 0 failed / 11 skipped, including both then-existing BDEF cases.

## Correct the assertion, preserve the bounds

The BDEF summary correctly preserved its base and reported incomplete coverage:
zero identities, a deadline omission, three sends / 1,344 decoded bytes / 2,007 ms.
The live helper incorrectly asserted a minimum of one identity even when the
optional phase exhausted its two-second allowance. That exception also prevented
its following positive source and repeated-call checks from executing.

`assertBdefExtensions` now permits an empty summary only when an incomplete provider
reports a deadline, request or response-byte limit and the corresponding omission
is positive. Unexpected empty results still fail. It continues to reject denied,
unsupported and unadvertised results, changed bases, wrong identities/versions,
summary source bodies and excess sends/bytes/output. Sources still require both
`DEMO_RAP_EXTEND1` and `DEMO_RAP_EVENT_EXT` as identities and separately labelled
authored bodies. Integration and MCP source verification now have independent test
cases; summary completion cannot prevent them from executing.

No production file, limit, timeout, fixture, scope or retry changed. The tracked
`src/` hash remains
`5f8058ccc1b685e0875113e5a9f820d99f47cb234d4f8f822a5475ab661cf664`,
identical to the previously reviewed and qualified runtime `a2a86b74a`.

## Verification and review

- 419 unit files / **11,321 tests passed**, with four workers. All source/scripts/tests
  typechecks, lint, action policy, build and size/schema gates pass. The standard-full
  schema remains 74,945/75,000 bytes. The 24 new assertion regressions include invalid
  partial states, inconsistent omissions, positive sources and retained invariants.
- The first default-worker full run saw an unchanged 30 ms DDIC transport test
  observe one send rather than two. That test passed unchanged in a focused 59-test
  run and in both subsequent complete capped-worker runs. No timeout was raised.
- Read-only A4H 758 / client 001 / HTTPS 443 / existing Basic identity: both updated
  integration cases and all three loopback HTTP/MCP cases pass. The MCP server had
  writes, data preview and SQL disabled and was stopped after testing. These are
  direct/local-server checks, not deployed CF/PP qualification.
- The BTP readiness endpoint still returns HTTP 503. Both BTP integration cases
  were skipped in the A4H invocation; no fresh BTP execution is claimed.
- Claude Code reviewed an immutable archive of the staged test tree, with only
  Read/Grep/Glob and no edits, execution, MCP or customizations. The first review
  found missing regression coverage for summary body leakage and unsupported
  rejection. Those cases were added, retaining positive identities so their failure
  is independent of the empty-result check. The final confirmation reports **no
  actionable findings**. The reviewed diff hash is preserved in the evidence and
  checked against the committed test diff.

[Machine-readable evidence](2026-11-01-bdef-summary-assertion-repair.json) records
both review targets, counts and original CI results. Full CI will run on the repair
commit; its result belongs to PR #1145 and is not claimed here in advance.

## Separate where-used failure

The unchanged `where-used-details.integration.test.ts` failed because the consumer
was absent from both native HTTP 200 responses, observed through 3,661 ms after
activation. This matches the existing intermittent issue
[#1057](https://github.com/arc-mcp/arc-1/issues/1057). Earlier ordinary-present /
scoped-missing observations and a retained pair missing after ten seconds mean
simple indexing delay is not an established cause or fix.

The where-used fixture, assertions, timing and runtime reader are unchanged here.
No polling, blanket retries, skipped assertion or index rebuild was added. The class
PR's one unchanged integration retry passed; that confirms intermittency, not a
root-cause fix. Retain the original failure evidence when assessing CI readiness.

## Roadmap

Checked `docs_page/roadmap.md` before and after the repair. No roadmap impact;
FEAT-03 is enhancement authoring and remains unchanged. Class #1146 remains the
merge dependency; nothing was merged as part of this repair.
