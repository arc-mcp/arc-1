# PR #769: core simplicity and value review

Baseline: `df4c4cbe`. Reviewed the complete PR production changes, direct callers, new test suites,
schema/documentation guards, cache backends, public exports and test/deployment paths. This is a
maintainability review of the addition and its integration, not a rewrite of unrelated ARC-1 code.

## Conclusion

Keep this as an **experimental, default-off core action**, not a plugin framework or external
graph service. It adds useful bounded relationship exploration without collection, SQL, a new
database, a new process or new dependencies. The normal navigation tool and cache remain usable
without enabling it. Core quality also requires deleting the aggregate cache machinery that
became unreachable when SAPContext was corrected.

## What was removed

- `CachingLayer.getCachedDepGraph` / `putDepGraph`, their activity/logging paths, and unused
  `CacheHitInfo`: no production callers after removal of the stale aggregate shortcut.
- `Cache` aggregate methods, `CachedContract` / `CachedDepGraph` types, MemoryCache's graph map and
  methods, SQLite aggregate serialization/deserialization methods. None is exported by
  `arc-1/public`; package exports do not expose these internal modules.
- Dead UI event labels/redaction cases for events that can no longer be produced.
- Redundant temporary values in context formatting and a repeated traversal direction expression.

This removes **122 net TypeScript runtime lines**, plus two dead UI labels. It introduces no new
runtime abstraction, configuration switch or storage migration. Tests for the removed APIs are
replaced with retirement/compatibility checks, not retained as a reason to keep dead code.

### Deliberately retained compatibility

SQLite's inert `dep_graphs` table/schema and `contractCount` response field remain. Existing cache
files and tool/UI consumers may observe that count; removing the field or dropping data would be
a different compatibility change. This is a small schema/stats/explicit-clear boundary, not an
aggregate engine. No production code can fetch, deserialize or add these rows. Fresh memory
caches always report zero. Tests seed legacy rows with raw SQL, including malformed JSON, proving
they survive reopen, remain countable/clearable, and cannot override fresh dependency contracts.

The source cache, ETag handling, activation consistency window, API cache and function-group cache
are unchanged. No existing operator cache files are altered by this local review.

## Complexity decisions

| Component | Decision and reason |
|---|---|
| Native adapter | Keep one fixed SAP endpoint adapter. It validates metadata and normalizes the native wire format; there is no backend registry, plugin loader, SQL fallback or arbitrary-URI fetch. |
| Traversal | Keep the small serial breadth-first walk and structural provider interface. It makes cycles, budgets, package boundaries and partial results independently testable. No general graph library or parallel scheduler. |
| Request-attempt hook | Keep at the actual transport-send boundary. Handler-only counting misses CSRF, retry and Undici 421 replay. Direct and Connectivity tests prove those extra sends are real. |
| Separate analysis semaphore | Keep. It bounds whole analyses, while the existing HTTP semaphore bounds individual SAP sends. Reusing one semaphore for both can deadlock. |
| Byte/deadline/auth state | Keep. Tests demonstrate oversized/stalled responses, queued deadlines and recovered/terminal auth failures. Removing these branches changes safety or error semantics. |
| Input and tool projection | Keep small dedicated modules. Runtime validation and the default-off LLM schema serve different boundaries; collapsing them into shared dispatch/tools files increases coupling. Numeric strings remain supported; arrays/booleans are rejected. |
| Parser validation | Keep URI canonicalization, XML size/depth/record checks and strict native shape checks. These are supported by adversarial regressions, not speculative options. |
| Parse memoization | Keep the bounded, content-addressed per-owner memo. It avoids the measured repeated parsing cost without reviving stale aggregates. No AST retention, persistence or new configuration. |
| Discovery caching | Keep the existing destination store and shared-client-only publication. Per-user cold discovery stays request-local; no second cache or user-capability registry. |
| Test overlap | Keep parser, traversal, real transport, handler and schema guards: they detect different failure layers. Delete tests whose only purpose was the removed aggregate APIs. |
| Documentation | One operator-facing feature page plus the existing caching reference. Dated research/review reports preserve evidence; they are not additional runtime/setup requirements. |

The parse memo is a WeakMap keyed by the existing CachingLayer owner. There is no production
cache-clear tool to wire into; backend close occurs during CLI/server shutdown, and the process
exits or the owner becomes unreachable. Adding lifecycle callbacks or a new cache-management API
for a hypothetical long-lived close/reopen workflow would add complexity without a current caller.

## Why it earns a place in core

- For one exact source reference or definition, ordinary SAPNavigate remains the simpler tool.
- For "what uses this class, and what are the next related objects in these packages?", the new
  action performs bounded traversal in one MCP request and reports evidence, unexpanded work and
  scope boundaries consistently. It saves manual tool orchestration, not all SAP requests.
- Fixing SAPContext freshness benefits existing users independently of live relations. The parse
  memo preserves the useful CPU saving while dependency bodies still follow source/auth policy.
- Default tools/list stays byte-identical. Opt-in adds 900 wire bytes (approximately 225 tokens),
  keeps existing hard schema ceilings, and requires only one flag on the existing deployment.
- No source collection, graph storage, BTP provisioning or model/embedding service is needed.

Not a whole-system index, complete call graph, unused-code proof or replacement for runtime data.
Root types remain CLAS/INTF; unresolved native references and SAML-only interactive login remain
documented limitations. These are reasons to retain the experimental label, not add silent fallbacks.

## Verification record

The baseline full unit run passed **6,041 tests / 203 files**. After retirement, the full run passed
**6,036 tests / 203 files**; eight tests dedicated to removed APIs were replaced with three
retirement checks. The focused cache, context, handler and UI run passed **358 tests / 16 files**.

An extra full-suite repetition hit two transient loopback errors (`ECONNRESET` / HTTP parse error)
in the existing security-header suite. That suite and its middleware are unchanged by this PR;
all 15 tests then passed in ten isolated repetitions, and another complete run passed all 6,036
tests without code changes. No assertions were weakened, tests skipped or automatic retries added.
The local socket failure's root cause is unconfirmed; retain it as a test-reliability caveat rather
than representing every local attempt as clean.

Also passed locally: source/scripts/tests typecheck, lint, authorization-policy validation,
file-size and default/opt-in schema budgets, production build, packed-package executable smoke,
strict documentation build and diff whitespace checks. No new dependency or schema fixture change.

### Live SAP checks

Using the existing a4h trial system over verified TLS, without fixture synchronization or SAP
writes: **14 cache integration tests**, **9 MCP cache E2E tests**, default-off tool-list/refusal
checks, enabled tool-list checks and missing-root rejection passed. Two namespaced MCP cases:

| Root and request | Result | Expansions / sends | Successful metadata bytes | Elapsed |
|---|---|---:|---:|---:|
| `/BOBF/CL_FRW_FACTORY`, outgoing, depth 2, max 20 nodes | 20 nodes / 40 edges | 8 / 11 | 421,134 | 4,929 ms |
| `/BOBF/IF_FRW_CONFIGURATION`, incoming, depth 1, max 20 nodes | 20 nodes / 19 edges | 1 / 2 | 54,364 | 1,079 ms |

Both results correctly reported truncation and unknown total coverage. Byte counts above are
successful metadata accounting, not all network traffic. These checks do not claim a live
principal-propagation deployment test; its isolation boundaries are covered by local unit tests.
No new BTP resources were provisioned. Optional slow and BTP-only suites are not included in these
local results; the existing PR pipeline supplies the standard Node 22/24, SAP integration and E2E
gates after push.

### Parse memo recheck

`scripts/bench-context-parsing.ts`, Node 24.11.1, release 758, 20 dependencies, seven warm repetitions;
the benchmark asserts identical output before comparing median CPU times:

| Source lines | Depth | Without memo | Warm memo | Accounted retained bytes |
|---:|---:|---:|---:|---:|
| 300 | 1 | 59.28 ms | 0.13 ms | 5,510 |
| 300 | 2 | 132.82 ms | 0.25 ms | 7,640 |
| 1,000 | 1 | 200.67 ms | 0.33 ms | 5,510 |
| 1,000 | 2 | 453.45 ms | 0.64 ms | 7,640 |

This measures parsing CPU, not SAP/network latency or process RSS. It supports retaining this
small memo, not reintroducing cached whole-context payloads.
