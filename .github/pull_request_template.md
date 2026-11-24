<!-- Use a conventional title (fix:, feat:, docs:, chore:, …) and keep the PR to one coherent
change. Open it as a draft while you are still pushing. PRs that merged with little rework added
about 170 lines; ones above 1,000 lines were usually rebuilt by a maintainer. Fill the relevant fields; use N/A with a reason for the rest. Redact credentials,
tokens, cookies, private keys, and customer data from all examples and test evidence. -->

## Change

- Problem and resulting behavior:
- Related issue(s), dependent PRs, or required package versions: <!-- A feature (new tool action, object
  type, config option, auth path) needs an issue where the scope was agreed first: see CONTRIBUTING.md. -->
- Reproducer or example (before → after):

<!-- For SAP API changes, link the contract evidence: SAP documentation, discovery results,
or a redacted live request/response. A mock accepting a parameter does not prove SAP supports it. -->

## Compatibility and scope

<!-- Mention relevant release/client limitations, configuration or default changes, and safety
or authorization impact. For tool changes, keep the public JSON schema, runtime schema, handler,
examples/docs, and applicable CLI behavior in sync; check batch inputs too when affected. -->

- Compatibility, user-facing updates, and remaining limitations:

## Validation

### Automated checks

- Commands and results (include failed, skipped, or not-run checks):

<!-- For bug fixes, add a regression test that fails before the fix and passes afterward where
practical. Exercise the relevant failure path as well as success; do not count skipped tests as
live coverage. Explain known unrelated failures rather than reporting an unqualified pass. -->

### Real-system testing

For SAP-facing or runtime changes, test against a real SAP system when possible. If you cannot,
explain why and describe the remaining verification scenario. Documentation-only changes can use N/A.

- Status: <!-- Tested / Not tested (reason) / N/A (reason) -->
- Tested build and environment: <!-- ARC-1 commit/artifact/version (not just "latest"), SAP product
  and SAP_BASIS release/SP, deployment/auth route; MCP client/version and OS when relevant. -->
- Scenario and observed result: <!-- Include the actual MCP or `arc1-cli call` input where relevant.
  Distinguish end-to-end coverage from raw ADT/helper-only checks. Verify the backend outcome
  (e.g. read-back, active state, returned rows), not only HTTP 200 or a success message. -->
- Limits and follow-up verification: <!-- Untested releases/routes, write/transport scenarios,
  or final-build verification still needed. Refresh evidence after substantive code changes;
  distinguish earlier-build evidence from tests of this PR's current code. -->

<!-- Use only an authorized test system and disposable objects for write tests. Where affected,
check round-trips preserve untouched data and failures release locks/sessions; record cleanup or
leftovers. Testing every SAP release is not required: state exactly what was and was not tested. -->

## Roadmap

<!-- Check docs_page/roadmap.md for every change, including fixes, docs, refactors, and research.
Add useful deferred work, narrow partially completed ideas, and remove completed items from both
the overview and details in this PR. Preserve links to closed PRs for unfinished ideas.
List the affected IDs and changes below, or write "No roadmap impact" after checking. -->

- [ ] Checked the [idea roadmap](https://github.com/arc-mcp/arc-1/blob/main/docs_page/roadmap.md) and updated it where needed.

## Before requesting review

<!-- These are the points maintainers most often had to add or change on contributed PRs
(AGENTS.md, "Contributing a Change"). -->

- [ ] A feature (new tool action, object type, config option, auth path) has an issue where the scope was agreed.
- [ ] One behavior; no option, environment variable, gate, retry or hint the issue did not ask for.
- [ ] Tests cover the edges this change touches (namespaced `/NS/…` names, cache hits, error paths, batch items) in the existing test files.
- [ ] `docs_page/tools.md` and related pages match the observed behavior, with no release claims I did not verify.
- [ ] Nothing reports success that SAP did not confirm; multi-step writes say what was created, what failed and what is unknown.
- [ ] `npm run check:sizes` and the tool-definition snapshot test pass.
