# PR #769: external review verification

The complete review was subsequently supplied. See [the complete-review dispositions](2026-09-08-pr769-complete-review.md)
for all 15 findings and the additional notes. This document preserves the earlier partial-review history.

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

## Follow-up review of `55a4e76c`

The second supplied summary confirms the earlier fixes and retracts the eight-expansion budget
headline. It adds four concrete gaps, all reproduced and addressed below. It still does not
include its referenced ten-item list. PR review bodies and issue/inline comments were checked
again; that list was not present there either. No unseen finding is claimed resolved.

| Follow-up claim | Disposition and implementation |
|---|---|
| Cold discovery parses the XML twice | Confirmed. Extract `parseDiscoveryObject` from the existing mapper and pass the already bounded, validated XML parse to it. Ordinary `parseDiscoveryDocument(string)` retains its previous behavior. An actual `XMLParser.prototype.parse` spy proves a single parse, not just a single wrapper call. |
| Successful fallback discovery is never reused | Confirmed. Publish only successful, supported discovery to the existing destination-scoped capability store. Use the same destination key as configured tools/list. Do not overwrite a nonempty startup/parallel refresh. Roots and networks remain fresh, per-caller reads. |
| Docs parity omits the opt-in schema | Confirmed. Check both modes against the tools reference, with a separate experimental parameter table for opt-in additions/overrides. Negative tests remove each optional-only field/action and insert an optional field into the default table to prove the guard detects drift. |
| Schema budgets omit the enabled branch | Confirmed. Add enabled read-only, full on-premise and full BTP scenarios with the exact discovery capability. Tests assert the action/fields are actually enabled and inflate an opt-in-only description to prove CI catches its growth. Existing default budgets and all wire ceilings remain unchanged. |

### Boundaries and measured cost

This reuses the existing in-memory capability cache, independent of `ARC1_CACHE`; no graph,
object result, source, credentials or authorization decision is added to it. Invalid XML,
unsupported MIME and HTTP discovery failures do not populate this fallback cache. A successful
capability discovery does not grant object access: a second caller denied by SAP still receives
an error without nodes. Named destinations remain isolated. No new dependency, endpoint, role,
database, background job or BTP resource is introduced.

Cold discovery still consumes the current analysis's request/byte/time budgets. Later calls save
that discovery request; these fixes do not relax budgets or promise completion. Real loopback
direct and Connectivity-style transports each verify four attempts on the first one-expansion
call and two on the second: one saving is discovery reuse, the other is the already-existing
CSRF session reuse. Both root and network are fetched again, changed network results are visible,
and successful-byte accounting matches the received bodies.

Measured compact `tools/list` payloads (not tokenizer measurements):

| Configuration | Default bytes | Relations enabled bytes | Added estimated schema tokens |
|---|---:|---:|---:|
| Standard read-only | 45,830 | 46,730 | 225 |
| Full on-premise | 70,765 | 71,665 | 225 |
| Full BTP | 67,285 | 68,185 | 225 |

The delta is **900 bytes** in all three cases, with three additional descriptions. Dedicated
opt-in token ratchets account for that existing feature cost. The largest enabled on-premise
surface has only **335 bytes** left under the unchanged 72,000-byte wire ceiling; future schema
growth may require trimming descriptions, not silently raising that wall. These BTP numbers
measure schema configuration, not a new deployed BTP verification.

### Follow-up verification

- Before the runtime fix, the new discovery-reuse tests reported **10 failures / 2 passes**.
- Final focused suite: **482 passed / 14 files**, covering XML/discovery, both HTTP transports,
  traversal, dispatch, destination cache, both parity guards, docs parity, budgets and snapshots.
- Final complete unit suite: **5,998 passed / 201 files** (24 additional cases over `55a4e76c`).
- Typecheck, lint, production build, policy validation, file/schema-size gates and strict MkDocs
  build passed. Default tool-definition snapshots remain unchanged.
- The isolated read-only ARC-1 HTTP instance passed **9 live cache E2E tests** again. No fixture
  sync, SAP write, existing-instance restart or cloud provisioning was performed.
- Live namespaced stdio smoke at **2026-09-08 13:42 UTC**, SAP_BASIS 758 / client 001:
  `/BOBF/CL_FRW_FACTORY` returned 20 nodes / 40 edges, eight expansions, 11 attempts,
  421,134 successful metadata bytes in 4.61 s; `/BOBF/IF_FRW_CONFIGURATION` returned 20 nodes /
  19 edges, one expansion, two attempts, 54,364 bytes in 0.882 s. Both retained explicit
  truncation and unknown coverage. Default-hidden, disabled-call rejection, enabled listing and
  missing-root rejection also passed. These single runs are not latency or coverage guarantees.

The final diff review checked cache miss/hit/failure paths, destination keys, concurrent refresh,
unchanged parser behavior for ordinary discovery, and non-vacuous guard tests. This was a focused
follow-up, not a repository-wide security scan or a review of the still-unprovided findings.
