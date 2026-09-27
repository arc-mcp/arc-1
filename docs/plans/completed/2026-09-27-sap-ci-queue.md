# Preserve waiting SAP CI jobs

## Cause and evidence

All three live jobs share `…-sap-live-a4h` with `cancel-in-progress: false`.
GitHub still defaults to one pending job and replaces it when another arrives.
For example, #859's [integration job](https://github.com/arc-mcp/arc-1/actions/runs/36302948915/job/108574590753)
was cancelled without executing a step. This is separate from the unresolved SAP 816 session incident.

[GitHub's queue contract](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
supports `queue: max` (up to 100 waiting jobs) while keeping one running job.
The existing PR-head check precedes the queue, so it cannot detect a head that changes while waiting.

## Plan and review

1. Add `queue: max` to integration, E2E and the manual slow job; preserve their shared group and cancellation setting.
2. Express the existing head check as one pinned github-script step, reused with a YAML anchor before queuing and at the start of each queued PR job.
   Require an open PR with the event's head; API errors fail closed. Manual dispatch remains explicit and allowed.
3. Gate work after the queued check, including SAP preflight and unconditional cleanup/report steps, so stale jobs exit cheaply.
   Once SAP work starts, let it finish its normal teardown; do not cancel it on later pushes.
4. Execute the actual guard script with mocked GitHub responses and test parsed workflow contracts. Compare the old and new queue settings on GitHub with
   three short dummy jobs per group, no checkout and no SAP credentials. Keep the probe out of the implementation diff.
5. Update the developer guide with queue limits, stale-job behavior and rollout limits.

Review: preserve the fork/title/unit gates, integration-before-E2E dependency, and manual-only slow profile.
Reuse one step, with no new scheduler or local action package. Native API objects avoid shell interpolation and Bash-only unit tests. YAML aliases are [supported by GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations).
Existing runs use their old workflow revision; a head may still change after the final check. Neither case justifies interrupting SAP cleanup.
No roadmap impact: the roadmap has no pending-job queue item; FEAT-42 concerns CLI output formats.

## Outcome

Implemented with no runtime or SAP API changes. The [GitHub scheduler probe](https://github.com/arc-mcp/arc-1/actions/runs/36305668513)
ran three dummy jobs under each policy: the default cancelled one without a step; `queue: max` completed all three sequentially.
The probe used isolated concurrency groups, no checkout and no SAP credentials; its overall cancellation is the expected control result.

All seven local gates passed, including 7,328 unit tests in 242 files and strict docs.
Four deliberate regressions (missing slow-job queue, accepting closed PRs, missing queued check, and unguarded SAP preflight)
each failed the workflow tests. The retained limits above still apply; real SAP CI will run on the PR head.
