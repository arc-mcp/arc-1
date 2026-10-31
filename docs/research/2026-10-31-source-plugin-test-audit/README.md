# Source plug-in test gap audit — 2026-10-31

Follow-up to stage 2 (`c1fc0684`) before publishing its stacked PR. The audit first replayed the
existing family/handler suites with V8 coverage: 63 tests, 94.03% lines, 85.08% branches and
100% functions across the three source plug-in modules. Coverage guided review; it is not a
claim that all combinations or releases are qualified.

The missing behavioral regressions were unadvertised providers in both modes, independent
per-body and cumulative decoded-byte limits, cyclic/orphan enhancement parents, extra location
fragments, and mixed unavailable-root/positive-child traversal. Eight added unit tests reproduce
those cases. They exposed two defects: a missing-provider summary could claim `returned`, and
a second fragment in an attachment location was ignored. Both are fixed. A root with no provider
is `not_advertised`; mixed positive/unknown traversal remains `incomplete`. Locations accept one
validated fragment only. The resulting family/handler suite has 71 tests; the full suite passes
10,709 tests before the updated DDIC prerequisite is integrated.

The final focused audit has 94.48% lines, 87.22% branches and 100% functions;
`coverage.json` retains the per-module totals.

## BTP ABAP 920 live coverage

`tests/integration/btp-source-plugin.integration.test.ts` is read-only. It authenticates through the
existing BTP service key/OAuth user and uses a read-only client and tool scope. It supports a
pre-acquired TEST_BTP_ACCESS_TOKEN so a run can use one browser login. No credentials, tokens,
raw source or SAP diagnostic bodies are saved in the evidence.

The two live tests passed, covering none/summary/sources for FUNC RFC_SYSTEM_INFO (resolved
owning group SRFC) and FUGR SRFC. Every original base block was byte-for-byte identical.

- FUNC metadata advertised no provider: both modes accurately reported `not_advertised`, with
  one optional send each.
- FUGR's small root identity provider returned a valid empty list in two sends. Its sources mode
  stopped at exactly 20 sends and reported incomplete traversal with explicit source omissions.
- The target reported SAP_BASIS 920 and SAP_CLOUD. `btp-920-live.json` retains the bounded
  summaries/counts, source-block hashes and preserved-base hashes.

These tests qualify contract behavior on those standard objects. No positive injected plug-in
body on BTP was observed or manufactured. PROG/INCL remain excluded by the current public BTP
schema. Other BTP objects, releases, effective switch applicability and atomic snapshots remain
unqualified. No SAP writes or helper installation were needed.

Reproduce with Node 24 and:

```sh
TEST_BTP_SERVICE_KEY_FILE=~/.config/arc-1/btp-abap-service-key.json \
  npx vitest run --config vitest.integration.config.ts \
  tests/integration/btp-source-plugin.integration.test.ts
```

The first request uses browser OAuth unless TEST_BTP_ACCESS_TOKEN is supplied privately. Optional
TEST_BTP_SOURCE_FUNCTION and TEST_BTP_SOURCE_GROUP select an existing read fixture; a missing
function is an explicit fixture skip, never a fabricated successful test.

No roadmap impact: FEAT-03 remains about enhancement authoring; COMPAT-19 remains about IDE
navigation. Neither is completed by these read-only source discovery checks.

## Public MCP coverage

Six read-only tests in `tests/e2e/source-plugin-extensions.e2e.test.ts` passed against a fresh
local HTTP MCP server backed by a4h (758), with TLS verification enabled, all mutation gates
disabled, and cache disabled. No fixture synchronization or SAP writes ran. The tests exercise
listTools, none/automatic/summary/sources, positive contextual INCL, two FUNC examples, FUGR,
partial-read defaults, explicit owning-source scope, preserved base blocks and output/request caps.
`mcp-758-live.json` contains summaries and hashes, with no raw source bodies. The optional 750
PROG case is provided for E2E_SOURCE_PLUGIN_TARGET=npl; this follow-up did not replay it over MCP.

Run against an already-started server for the selected qualified SAP target (without invoking
the mutation-producing general E2E fixture setup):

```sh
E2E_SOURCE_PLUGIN_TARGET=a4h E2E_MCP_URL=http://127.0.0.1:<port>/mcp \
  npx vitest run --config tests/e2e/vitest.e2e.config.ts \
  tests/e2e/source-plugin-extensions.e2e.test.ts
```

The prerequisite is stacked on DDIC PR #1143 at c16ab455a, including its MCP helper tests and
follow-redirects patch. Its original imported commits have identical patch IDs; dependency
ancestry is aligned without rewriting the stage-2 commits already consumed by later stages.
The merge retained both adapters' docs, smoke-script lint entries, and BTP qualification limits.

## Final validation before Claude Code review

After integrating the prerequisite and adding the public MCP suite: all 392 unit files / 10,714
tests pass; the BTP integration suite passes 2 tests; the 758 MCP suite passes 6 tests. Typecheck
covers src, scripts and tests. Biome lint, ACTION_POLICY validation, build, file-size and tool-schema
ratchets pass. npm ci reports zero dependency vulnerabilities with the prerequisite's lockfile.
The branch remains read-only with no SAP objects created or changed.


## Review fixes and refreshed validation

[Claude Code's report](claude-review.md) and the [finding-by-finding disposition](review-resolution.md)
record the completed independent review. All ten actionable findings were addressed, along with
the local malformed-query finding. Post-review validation passes 393 unit files / 10,737 tests,
two live BTP tests and seven public MCP tests on 758, including a structural U01 include under
FUGR context in default summary, explicit summary and sources modes. All baseline blocks remain
identical. Refreshed live evidence files above supersede their pre-review versions.

The 106 focused source/foundation/handler tests pass. `post-review-coverage.json` includes the
shared renderer now exercised by source diagnostic floods and reports 96.32% lines, 86.58%
branches and 100% functions across it and the three source modules. Source discovery itself
has 97.95% lines / 91.66% branches. Coverage is a guide, not a qualification guarantee.

The renderer change retains the stable result/export shapes while bounding diagnostic details
and maintaining valid JSON, required report fields, omission counts and consumed budgets when
metadata exceeds the compact summary allowance. Source/graph output remains under the same
existing byte cap. The review fixes do not broaden authorization, routes or BTP public types.
