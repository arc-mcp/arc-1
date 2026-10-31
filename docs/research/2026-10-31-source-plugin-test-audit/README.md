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
