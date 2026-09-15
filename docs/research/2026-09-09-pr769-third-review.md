# PR #769: third external-review follow-up

Reviewed baseline: `808de2f0`. Scope: Claude's two new findings, A and B, plus rechecking the
disposition of the three repeated limitations. The feature remains experimental and default-off.

## Findings and patch boundaries

| Item | Assessment | Change |
|---|---|---|
| A: per-user discovery publishes shared hints | Confirmed local identity-boundary regression. Cold discovery uses the caller's SAP session, but its full capability map was published process-wide before root authorization completed. No cross-user source/relation-data leak was demonstrated. | Require `CacheSecurityContext` in `handleLiveRelations`, forward it from dispatch, and publish only for a shared client. Keep per-user fallback discovery request-local, even without a stable user key. |
| B: memoization overrides extractor defaults | Confirmed future-drift risk, not a current parsing difference: all defaults were Cloud. | Export each extractor's existing default and reuse that exact value in its memo key and builder. There is no cache-owned default or new compressor-level override. Explicit language versions remain supported. |
| #6: error bodies outside cumulative successful-body cap | Previously evaluated policy; no new evidence. | No change. Individual error-body, request-attempt, time and admission bounds remain. The successful-byte metric is not total traffic or RSS. |
| #11: native `exists=false` rejects the network | Previously received and evaluated, not omitted: see row 11 of the [complete disposition](2026-09-08-pr769-complete-review.md). No new wire evidence was supplied. | No change. A native unresolved reference is not proven equivalent to an HTTP 404; treating it as safe absence could misrepresent restricted or malformed evidence. Keep the documented protocol limitation. |
| #13: manual redirects and SAML-only systems | Previously diagnosed compatibility limitation; no new evidence. | No change. Keep actionable auth/routing guidance and bounded redirect refusal. This patch does not implement interactive SAML login. |

The minor numeric-coercion consistency note does not justify an unrelated cross-tool schema change.

### Security contract for A

The relevant invariant is per-user isolation (security model I2): one user's SAP response must not
become another user's shared capability evidence. The caller controls the request and its identity,
not the SAP discovery body. Actual user-dependent discovery on a live PP deployment has not been
established; the local reproduction supplies differing SAP responses to demonstrate the reachable
state transition. Severity claims about object-data disclosure would exceed this evidence.

Source-to-sink path: server selects the per-user client → dispatch builds cache security →
relations performs cold discovery → `setCachedDiscovery` updates the destination store. Consumers
include tool definitions, endpoint-availability helpers and later clients' discovery/MIME hints.
Before the fix, even a subsequent denied root read left the shared map populated.

The narrowest fix is at that publication point, matching the existing shared-only `SAPManage.probe`
precedent. It uses the actual client-mode flag, not `config.ppEnabled` or the availability of a user
name. Shared-client cold reuse, known shared-hint reads by per-user clients, destination scoping,
the parallel-refresh guard, and live root/network authorization are preserved. The normal source
cache and parse-cache per-user bypass are unchanged. No new user role, configuration or database.

An independent read-only boundary investigation confirmed the path and compatibility constraints.
The security-fix skill guided the required security parameter, before/after reproduction and
independent candidate review; it did not expand this into a repository-wide security audit.

### Files and regression coverage

- `src/handlers/{dispatch,live-relations}.ts`: required security context and shared-only publication.
- `src/handlers/feature-cache.ts`, `docs_page/live-relations.md`: describe shared-only fallback retention
  and repeated bounded per-user discovery while shared capabilities remain unknown.
- `src/context/{contract,deps,parse-cache}.ts`: extractor-owned parser defaults reused by memoization.
- `tests/unit/handlers/live-relations-discovery.test.ts`: named/default cold PP calls, absent user key,
  separate users with differing discovery, discovery followed by a root 403, shared-hint reuse,
  unchanged tool/availability state, and shared/per-user refresh races. The existing denied-user
  test now actually sets the per-user client flag.
- `tests/unit/context/parse-cache.test.ts`: omitted/explicit default keys share entries; cached and
  uncached builders receive the same effective versions and produce equal results, including 758.

## Validation

Commands use Node 24.11.1. Before the production fix, the discovery suite reproduced **four failures**
(named/default PP publication, another user's discovery skipped, publication before a root 403),
while **14 controls passed**. This is a local mocked-SAP boundary reproduction, not a claim about
the discovery permissions of every SAP release.

1. Syntax/import/type gate: final diff inspected; `npm run typecheck` passed for source, scripts and tests.
2. Original trigger and alternate paths: `npx vitest run tests/unit/handlers/live-relations-discovery.test.ts
   tests/unit/context/parse-cache.test.ts` passed **27 tests**. All four original reproductions now pass;
   shared cold reuse and live per-user authorization controls remain intact.
3. Owning repository checks: `npm test` passed **6,041 tests / 203 files** on the complete rerun.
   `npm run lint`, `npm run validate:policy`, `npm run check:sizes`, and `npm run build` passed.
   Default and enabled snapshots/wire budgets remain unchanged. Lint emitted only the existing
   Biome configuration deprecation notice.
4. Independent candidate review found no concrete remaining bypass or regression in A or B.
   Its artifact-free mocked-HTTP checks covered default/named PP isolation, shared reuse and live
   root/network reads; separate in-memory checks compared omitted, explicit Cloud and 758 parser
   versions across cache misses/hits. The parent independently reviewed all changed callers and
   both sides of the publication guard. Outcome for A and B: **fixed**.
5. Documentation: `mkdocs build --strict --site-dir /tmp/arc1-pr769-third-review-site` passed;
   `git diff --check` passed. The existing MkDocs plugin migration notice is unrelated to this patch.

After independent review, typecheck passed again and the final boundary run of the discovery,
parse-cache, live-relations-review and context-cache-freshness suites passed **62 tests / four files**.

The first full unit run had one UI API test return 404 unexpectedly (**6,040 passed, one failed**).
The isolated unchanged UI suite immediately passed **16/16**. No UI code is changed by this patch;
the initial failure's cause is not established. The full rerun above passed without a UI change.

Read-only live verification: `node /tmp/arc1-pr769-local-verification.mjs` started an isolated,
owned loopback ARC-1 instance, using the production build against a4h client 001 over HTTPS.
It ran the existing `tests/e2e/cache.e2e.test.ts` directly (no fixture-sync/SAP writes): **9 passed**.
It also ran the committed `scripts/smoke-live-relations.ts` with these cases:

| Object | Nodes / edges | Expansions / attempts | Successful metadata bytes | Time |
|---|---:|---:|---:|---:|
| `/BOBF/CL_FRW_FACTORY`, outgoing depth 2 | 20 / 40 | 8 / 11 | 421,134 | 4,527 ms |
| `/BOBF/IF_FRW_CONFIGURATION`, incoming depth 1 | 20 / 19 | 1 / 2 | 54,364 | 1,179 ms |

Both reported truncation and unknown coverage; disabled-action refusal, enabled listing and
missing-root rejection passed. These are shared-client compatibility checks, not live PP isolation
proof. The PP publication boundary is covered by the before/after tests above. Owned verification
servers were stopped; no existing deployment was restarted.

No SAP writes, new BTP resources, role changes or merge are part of this follow-up. Live PP transport
deployment and SAML-only/native unresolved-reference compatibility are not certified by these tests.
