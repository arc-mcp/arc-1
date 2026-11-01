# PR template review: external contributions

Reviewed on 2026-09-18 to improve the contributor prompts in
[the PR template](../../.github/pull_request_template.md).

## Scope

Scanned the metadata of 126 non-bot, externally authored issues and PRs (62 issues and 64 PRs),
using GitHub author associations other than `MEMBER` or `OWNER`. Read a targeted sample of
12 PRs and 8 issues, including their human discussions, for recurring review and verification
gaps. This is a qualitative sample, not a claim to have audited every contribution in depth.
PR descriptions can include subsequent maintainer edits; the examples below describe what the
discussion taught us, not deficiencies attributable to a particular author. Historical problems
are not claims that the current code still has those problems.

## Findings and template changes

| Prompt to add | Evidence from contributions | Why it matters |
| --- | --- | --- |
| Concrete before/after reproducer and backend outcome | [PR #179](https://github.com/arc-mcp/arc-1/pull/179), [issue #728](https://github.com/arc-mcp/arc-1/issues/728), [PR #801](https://github.com/arc-mcp/arc-1/pull/801) | Activation success, ATC completeness, and audit delivery need observed state/findings/read-back, not just a successful response or startup. |
| Evidence that SAP supports a changed API contract | [PR #277](https://github.com/arc-mcp/arc-1/pull/277) | Unit tests passed for a pagination parameter that SAP silently ignored. Link documentation, discovery, or redacted live evidence rather than relying on mock acceptance. |
| Exact SAP release and deployment/authentication/client route | [PR #440](https://github.com/arc-mcp/arc-1/pull/440), [issue #520](https://github.com/arc-mcp/arc-1/issues/520), [issue #798](https://github.com/arc-mcp/arc-1/issues/798) | Cloud Connector behavior differed from direct access; schema compatibility differed by MCP client; discovery/endpoints differed by SAP release. |
| Public-tool coverage and matching examples | [PR #375](https://github.com/arc-mcp/arc-1/pull/375), [issue #690](https://github.com/arc-mcp/arc-1/issues/690) | A helper field needs schema/handler exposure, and working code can still have a misleading example. Exercise the MCP or CLI call the user will actually make. |
| Round-trip preservation, failure paths, and cleanup | [PR #766](https://github.com/arc-mcp/arc-1/pull/766), [PR #768](https://github.com/arc-mcp/arc-1/pull/768), [issue #771](https://github.com/arc-mcp/arc-1/issues/771), [issue #794](https://github.com/arc-mcp/arc-1/issues/794), [issue #805](https://github.com/arc-mcp/arc-1/issues/805) | Validate untouched content, lock/session lifecycle, and realistic transport failures as relevant; successful writes alone do not establish those properties. |
| Tested commit/artifact, relevant platform, and evidence freshness | [PR #807](https://github.com/arc-mcp/arc-1/pull/807), [issue #737](https://github.com/arc-mcp/arc-1/issues/737) | Earlier live evidence is not a test of the final revision or a different auth route; packaged artifacts can behave differently from the checkout. |
| Explicit untested scenarios, skips, and access constraints | [PR #785](https://github.com/arc-mcp/arc-1/pull/785), [PR #779](https://github.com/arc-mcp/arc-1/pull/779), [PR #524](https://github.com/arc-mcp/arc-1/pull/524) | Release-specific coverage, unavailable BTP checks, and reporter verification are useful when their boundaries are explicit. Missing system access should not prevent a contribution. |
| Coherent scope and linked upstream dependencies | [PR #196](https://github.com/arc-mcp/arc-1/pull/196), [PR #524](https://github.com/arc-mcp/arc-1/pull/524) | Bundled changes needed splitting; an integration required an upstream authentication package release. State dependencies and preserve deferred work in the roadmap. |

## Resulting policy

- Test SAP-facing/runtime changes against a real, authorized SAP test system when possible.
  State the tested build, environment, actual scenario, result, and remaining limits. Do not
  imply a cross-release or cross-authentication matrix was tested when only one route was used.
- If live access is unavailable, state the reason and the exact scenario still needing
  verification. Documentation-only changes can use N/A. Mocks and skips are not live evidence.
- Use disposable objects for mutation tests and report cleanup or leftovers. Redact secrets
  and customer data. Check backend postconditions and relevant failure paths.
- Keep prompts conditional and compact; do not require every contributor to test every SAP
  release. Historical examples stay in this note, not in every new PR description.
- Retain the roadmap check for every PR. This review implements contributor guidance and
  creates no additional deferred roadmap item.

The guidance is also linked from [local development](../../docs_page/local-development.md) and
included in [agent testing instructions](../../AGENTS.md#testing).
