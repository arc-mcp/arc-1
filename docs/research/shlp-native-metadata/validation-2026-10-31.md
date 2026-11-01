# SHLP coverage follow-up — 2026-10-31

PR #1141, based on `90abdfc3`. The initial coverage extension left production code unchanged;
the subsequent Claude review led to two small handler fixes recorded below.
All checks on the previous PR head `580d6e07` passed in GitHub, including Node 22/24,
integration, E2E, docs, CodeQL and dependency checks.

## Coverage audit and added tests

| Gap | Evidence added | Result |
|---|---|---|
| SHLP had dispatcher-level live tests but no explicit MCP E2E cases | `tests/e2e/shlp.e2e.test.ts`: tool enumeration, native alias, flags, partial coverage, unavailable/error serialization and unsupported options | 7/7 on A4H 758 and 7/7 on NPL 750, using a fresh local HTTP MCP server and the current compiled source |
| Different callers were tested against different endpoints | Two concurrent bearer identities use the same SAP endpoint, then repeat through SAPContext; per-client cookies and unavailable results remain isolated | Pass |
| Native namespaced fixtures had no durable wire-encoding assertion | Lowercase namespaced input is normalized and encoded exactly once, through direct and proxy transports | Both pass |
| SHLP oversized-response tests covered uncompressed bodies only | Direct transport applies the decoded byte cap; bounded proxy transport requests identity encoding and rejects unexpected gzip | Both pass |
| BTP exclusion was tested locally, but no live BTP compatibility smoke was recorded | Existing five BTP read/search smoke cases plus schema exclusion and pre-network SHLP refusal through both tools | 7/7, authenticated with a named-user OAuth token |

On-prem MCP servers used client 001 with writes, data preview and free SQL disabled. No fixture
creation or SAP mutations were performed. BTP smoke now also accepts `TEST_BTP_ACCESS_TOKEN`,
matching the existing extended BTP suite, so browser authentication can finish before timed cases.
No credentials, tokens or private service keys are included in the evidence.

## Validation and failed attempts

- Full unit run before Claude review: **383 files, 10,626 tests passed** (`npm test -- --reporter=dot --maxWorkers=4`).
- Focused handler suite: 27/27 passed, including five new cases.
- Typecheck, lint, build, policy validation, existing size/schema budgets and strict docs build passed.
- Initial BTP attempts timed out while the system was starting and browser authentication was pending.
  After a successful OAuth callback, all seven smoke cases passed without skips. This validates BTP
  compatibility/exclusion; it does **not** establish positive SHLP support on BTP.
- Two broad local runs encountered the existing shutdown test's five-second child-startup deadline,
  in different signal variants, while the host's one-minute load exceeded 230. An unchanged-base
  checkout passed 12/12, then the PR checkout passed 12/12 in 2.18 seconds. Resource contention is
  the likely explanation; no shutdown timeout or production code was changed to hide the failures.

## Dependency audit follow-up

The first CI run on coverage commit `e5fcfdcd` stopped before tests because the newly published
[GHSA-mrwp-f3q8-3g9p advisory](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p) affected
`follow-redirects@1.16.1`. This is an inherited dependency issue, not evidence of an SHLP failure.

The exact focused patch from [PR #1155](https://github.com/arc-mcp/arc-1/pull/1155), source commit
`46a8afbd`, was cherry-picked as `ef732bab`: both root and AppRouter lockfiles resolve
`follow-redirects@1.16.2`. Only the version, registry URL and integrity fields changed. There are no
new dependencies, audit exceptions or application-source changes.

After fresh installs, both security audits passed, the AppRouter suite passed 5/5, the build passed,
and the full unit suite again passed **383 files / 10,626 tests**. The newly built MCP server also
passed the seven live SHLP E2E cases again on each of 750 and 758. BTP's seven successful live
compatibility/exclusion cases were run before this dependency-only patch.

## Claude review follow-up

The initial review found an auto-detected BTP bypass and missing evidence for the active label.
The shared handler now refuses detected BTP before HTTP, with unit and live auto-mode coverage.
Live BTP smoke passed **8/8** after the fix. The provider/default-state chain was inspected on both
750 and 758; the updated native integration suite passed **8/8 on each**, including a read-only
backend-contract check. [Version evidence](active-version-2026-10-31.md) records the exact method
and limits. No draft mutations or second-user control are claimed.

Both P2 recommendations were implemented: accurate size-limit guidance and pinned direct/proxy
retry, attempt, deadline and cancellation behavior. The focused handler suite passed **44/44**.
Final local validation after these fixes: **383 files / 10,643 unit tests**, **7/7 MCP E2E on each
of 750 and 758**, plus typecheck, lint, build, policy validation, schema/file budgets and strict docs
build all passed. The [Claude follow-up](claude-followup-2026-10-31.md) found no remaining merge
blockers and recommends merging after final CI is green.

## Scope and remaining qualification

Live principal propagation and a restricted SAP user remain unqualified for this feature. The new
same-endpoint identity test and existing proxy tests verify ARC-1 behavior, not SAP role configuration.
The implementation reuses the caller's transport and does not change identity construction.

Complete definitions, append resolution, inactive metadata and positive BTP SHLP support remain out
of scope. Roadmap FEAT-97 was checked; its remaining gap and resume trigger are unchanged.
