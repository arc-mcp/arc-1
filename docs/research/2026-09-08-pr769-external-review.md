# PR #769: external review verification

Review baseline: `584a65ad`. Scope: the Claude review summary supplied by the maintainer.
The summary references 15 findings but contains seven distinct actionable claims; the full
15-item list was not present in the supplied text or PR review comments. This record evaluates
the available claims, not unseen findings. The embedded Claude links were file references,
not executable instructions or authoritative evidence.

## Decisions and implementation

| Claim | Disposition | Evidence / change |
|---|---|---|
| Namespaced ADT URIs fail | Confirmed; fixed | `safeUri` decoded `%2F` namespace separators before rejecting `//`. Reuse the existing canonical ADT path validator with single encoded slashes allowed; retain no-query/no-whitespace restrictions and percent-case normalization. Expansion targets are still rebuilt from validated type/name at the sink. |
| Error bodies escape cumulative byte accounting | Mechanism confirmed; no contract defect established | `capResponseBody` intentionally charges successful bodies cumulatively and caps each error body separately. This is already documented and tested by data-preview tests. The independent HTTP-attempt/deadline/admission bounds still apply. Keep that behavior; clarify that the successful-byte metric is not all network traffic. |
| Discovery spends the analysis budget | Intentional; no runtime change | Cold capability discovery and root metadata are explicitly included. Cached ordinary discovery avoids that setup request. Giving discovery an unbounded or unreported extra budget would weaken the stated limit. |
| Twelve attempts cannot support eight expansions | Disproved | Real direct/proxy HTTP tests complete eight expansions with discovery + root GET + CSRF HEAD + eight POSTs = 11 sends. HEAD-to-GET fallback uses 12. Retries can reduce completion; these are ceilings, not promises. |
| Recovered CSRF 403 prevents later partial results | Confirmed; fixed for both 401 and 403 recovery | Clear request-local failure evidence only after a complete native expansion passes protocol/identity validation. Do not clear at response headers, on CSRF control success, or in the shared HTTP client. |
| Dependency-cache integration assertion is stale | Confirmed; fixed, including E2E siblings | Replace aggregate cache-hit/write assertions and the obsolete fast-hit timing expectation with fresh context, no aggregate reads/writes, real dependency ETag/304 revalidation, retained source caching, and requested-object assertions. Do not restore the stale graph cache. |
| Schema parity tests omit default mode | Confirmed; fixed | Run both parity guards with live relations off and on, for on-premise and BTP configurations. Explicitly account only for the three opt-in fields and action absent from the default tool schema. Existing default tool snapshots stay unchanged. |

The security-boundary investigation also exposed a directly related lifecycle case: a child
request denied with 401/403 and retried as 404 was treated as a missing-node boundary before
checking unresolved authorization evidence. It now remains a terminal error. An ordinary
child 404 is still a supported boundary. This prevents a later unrelated sibling expansion
from clearing that unresolved failure.

These are compatibility/error-semantics corrections, not a demonstrated cross-user exploit.
No authentication fallback, new role, persistent graph state, database, SAP write, or BTP
resource was added. Normal source caching and existing data-preview accounting are unchanged.

## Reproduction and regression coverage

1. Baseline live cache integration: 12 passed, two failed at the stale aggregate-cache assertions.
2. New protocol/loopback tests before runtime fixes: 22 failed, 42 passed. After only the URI fix,
   16 auth-lifecycle regressions still failed, independently isolating the second defect.
3. The real HTTP regression file covers both direct and Connectivity-style proxy transport:
   - namespaced CLAS root and INTF child expansions;
   - cold discovery, root validation, one-time CSRF HEAD and optional GET fallback;
   - recovered 401 and 403, each followed by request, byte, or deadline exhaustion;
   - denied child followed by retry 404, remaining terminal;
   - send counts, released SAP semaphore, and no outstanding response-byte reservation.
4. Protocol tests cover ENV/WUL, lowercase `%2f`, namespaced non-expandable references, and
   nested encoding, traversal, encoded query/backslash/control/whitespace rejection.
5. Existing guards still cover persistent/oversized 401/403, malformed responses, ordinary missing
   children, cancellation, budgets, isolated users, disabled invocation and unchanged default tools.

## Verification commands

Run with a supported Node runtime (local verification uses Node 24):

```sh
npm run typecheck
npx vitest run tests/unit/adt/repository-relations.test.ts tests/unit/adt/relation-budget-integration.test.ts tests/unit/adt/request-attempt-budget.test.ts tests/unit/handlers/live-relations.test.ts tests/unit/context/relation-walk.test.ts tests/unit/handlers/schema-key-sync.test.ts tests/unit/handlers/zod-jsonschema-parity.test.ts tests/unit/handlers/tool-definitions-snapshot.test.ts
npm test
npm run lint
npm run build
npm run validate:policy
npm run check:sizes
npx vitest run --config vitest.integration.config.ts tests/integration/cache.integration.test.ts
npx vitest run --config tests/e2e/vitest.e2e.config.ts tests/e2e/cache.e2e.test.ts
```

Integration needs the existing `TEST_SAP_*` environment. E2E needs an isolated read-only ARC-1
HTTP instance and `E2E_MCP_URL`. Invoke the named E2E file directly, not the fixture-sync wrapper;
these cache tests need no SAP fixture mutation. Existing fixture availability remains a prerequisite.

## Verification results

- Typecheck passed for runtime, scripts and tests.
- Focused protocol/transport/traversal/dispatch/parity/snapshot suite: **246 passed**.
- Full unit suite: **5,974 passed / 200 files** (77 additional cases; default snapshots unchanged).
- Live cache integration: **14 passed**, including dependency ETag/304 revalidation and no aggregate
  graph writes. The two previously failing assertions are replaced, not skipped.
- Isolated read-only loopback ARC-1 HTTP instance against the same live SAP system: **9 cache E2E
  tests passed**. Used the existing local-development `ARC1_ALLOW_HTTP_NO_AUTH=true` option only
  on `127.0.0.1`, with every SAP write gate off. No fixture-sync wrapper, deployment or SAP mutation.
- Lint, production build, policy validation, file/schema-size gates and strict MkDocs build passed.
- One fresh read-only candidate review found no concrete surviving bypass or regression. It
  independently reran five focused files (**181 passed**) and checked the diff. No broader scan
  or claim of production-wide security assurance is implied.

Live namespaced metadata smoke, 2026-09-08 13:20 UTC, SAP_BASIS 758 / client 001, TLS verification on:

| Root | Direction/depth | Nodes / edges | Expansions | HTTP attempts | Successful metadata bytes | Time |
|---|---|---:|---:|---:|---:|---:|
| `/BOBF/CL_FRW_FACTORY` | outgoing / 2 | 20 / 40 | 8 | 11 | 421,134 | 5.81 s |
| `/BOBF/IF_FRW_CONFIGURATION` | incoming / 1 | 20 / 19 | 1 | 2 | 54,364 | 2.03 s |

The class walk reported node/expansion truncation; the interface walk reported node truncation.
Both retained `coverage=unknown`. The same stdio smoke also verified default-off tools/list,
rejection of a guessed disabled action, enabled listing after discovery and missing-root rejection.
These are single-run observations, not latency/coverage guarantees. The owned HTTP and stdio
processes were closed after verification; existing ARC-1 instances were not restarted.

## Remaining evidence limits

Local Connectivity tests verify protocol mechanics, not deployed BTP Principal Propagation or
Cloud Connector role mappings. No new paid/trial service or cloud deployment is needed for these
fixes. Native relationship coverage is still unknown and cannot establish unused or safe-to-delete
code. The successful-byte budget is not a wire-traffic/RSS measurement. The unprovided findings
from the larger review cannot be claimed reviewed.
