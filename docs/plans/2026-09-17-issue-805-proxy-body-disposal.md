# Issue #805: safe proxy body disposal

## Goal

Keep ordinary BTP proxy reads alive when ARC-1 discards an Undici response body. Preserve status,
headers, cache revalidation, caller-visible errors, response budgets, and existing client ownership.

## Research and plan review

The [research dossier](../research/issues/805-undici-null-body-destroy-crash.md) confirms that bare
`BodyReadable.destroy()` can asynchronously emit `UND_ERR_ABORTED`. A second pass on 2026-09-17 found:

- The same error occurs when cancellation reaches the streaming adapter before its first read.
  Creating an async iterator does not install its error listener until `next()` starts.
- `dump()` handles ordinary empty responses, but waits for an unfinished 205 response. Switching to
  draining would change the existing immediate-discard behavior and introduce extra timing cases.

Use the smallest common fix: a private helper that attaches an error listener and destroys the
discarded body. Reuse it in the four existing teardown paths. Keep client close/destroy ownership
where it is today. No new state machine, dependency, flag, public API, or process exception handler.

## Implementation

1. Add real HTTP/Undici regression tests for 204/205/304, cache revalidation, unexpected encoding,
   headers-only disposal, and cancellation before the first streaming read. Prove they fail on the
   existing source, including asynchronous errors after a response returns.
2. Add `destroyProxyBody(body)` in `src/adt/bounded-response.ts`. Attach the intentional-disposal
   error listener before `body.destroy()`. Use it for null statuses, headers-only responses,
   unexpected encoding, and streaming cancellation/error cleanup.
3. Update the dossier with the refined recommendation and actual validation results. Add an entry
   to the existing unreleased release notes; release-please owns version numbers.

## Verification and review

- Test with real `Client.request()` bodies, since `Readable.from()` lacks Undici's destroy behavior.
- Check bounded and ordinary null responses, preserved ETag/Set-Cookie, source reuse on 304,
  prompt disposal of unfinished bodies, original encoding/abort errors, and closed connections.
- Retain and run the late-data, response-limit, deadline, and cache tests.
- Run typecheck, lint, build, the unit suite, policy validation, and size/schema checks.
- Repeat read-only live conditional reads on the available SAP test systems through the patched
  proxy adapter. Document whether a full CF/Cloud Connector deployment was tested.
- Review the final diff for unnecessary abstractions and altered cleanup ownership. Fix findings
  and rerun the affected checks before creating the PR.

## Release recommendation

Merge the reviewed fix and consider backporting it for 1.2.x. The PR does not publish a release or
change a shared deployment. `ARC1_CACHE=none` remains only a temporary mitigation for the 304 trigger.

## Completion and final review (2026-09-17)

- Implemented the four-path helper; final review found no remaining code or scope issues.
- Baseline: the first 13 regression assertions passed but the run failed with 16 unhandled
  disposal errors. Patched: all 17 lifecycle tests passed, including 20 consecutive runs
  (340 cases), with closed connections and no unhandled errors.
- Full suite: 224 files / 6,885 tests passed in two consecutive final runs. An earlier run
  concurrent with repeat testing timed out in unchanged `oauth-callback.test.ts`; its isolated
  rerun passed all 18 tests. No OAuth code or test timeout was changed.
- Typecheck, lint, build, policy validation, and file/schema budgets passed. Lint reported only
  three existing informational notices outside this patch.
- Live adapter: 24 read-only requests passed across 750/758/816 in both modes, with repeated
  304 responses, preserved ETags, and no process termination.
- Full deployed CF/Cloud Connector smoke remains a deployment-owner check; no SAP objects or
  shared deployments were changed. The research dossier records that limitation explicitly.
