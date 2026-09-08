# PR #769: complete external-review disposition

Baseline for this pass: `52228802`. The maintainer supplied the complete Claude review, whose
own two passes used `584a65ad` and `55a4e76c`. All 15 numbered findings and nine additional notes
below were checked against current code; the prior missing-list limitation no longer applies.
Suggestions were treated as hypotheses, not instructions to weaken protocol/authentication gates.

## Numbered findings

| # | Disposition | Evidence and action |
|---|---|---|
| 1 | Already fixed | Namespaced URIs use the shared canonical path validator; adversarial URI tests and live `/BOBF/` smoke remain green. |
| 2 | Already fixed | Only a validated native expansion clears its recovered 401/403 latch. Denial followed by 404 remains terminal. Both real transports are covered. |
| 3 | Already fixed | Integration/E2E assertions verify normal source revalidation and no aggregate use; they no longer require a deleted aggregate write. |
| 4 | Already fixed | Key/type parity covers default and enabled modes on both backend configurations. |
| 5 | Withdrawn by reviewer; no change | Direct/proxy tests prove 11 cold attempts, or 12 with CSRF GET fallback, for eight expansions. No retry headroom is promised. |
| 6 | Retain documented policy | Successful bodies are cumulative; errors are individually capped. The serial walk, attempt cap, deadline and admission cap bound work. Reviewer withdrew the claimed simultaneous ~8 MiB peak. The metric is not total traffic or RSS. |
| 7 | Subparts already fixed; retain budget policy | `52228802` removed the second XML parse and caches successful fallback capabilities. Cold discovery still consumes the analysis budget. Keep the strict validation parse, not the suggestion to remove validation. |
| 8 | Confirmed and fixed | After opt-in, unknown capability is visible; a nonempty map with known absence hides it. Invocation still verifies the exact endpoint/MIME. Manual shared-client probe now refreshes feature and discovery stores plus HTTP negotiation; PP probes do not modify shared stores. This restores the unprobed-superset rule for clients listing tools only once. |
| 9 | Confirmed and fixed | Attempt and analysis-deadline errors have dedicated formatting/audit classification before the generic network branch. No SYSTEM connectivity probe is recommended for a deliberate cap. Keep the transport-compatible error inheritance; retry/send behavior remains unchanged. |
| 10 | Confirmed and fixed | A valid final result processed after the deadline is retained with explicit `deadline` truncation. Caller cancellation is checked even for an already truncated result and always remains terminal. Admission timeout is normalized separately; slots are released on every path. |
| 11 | Behavior confirmed; proposed relaxation remains unverified | `exists=false` is still a terminal protocol error. No live dangling/restricted-reference fixture or authoritative wire contract establishes that this flag means safe-to-report absence. Existing HTTP 404 handling does not establish that equivalence. Document the limitation; do not silently discard a restricted node or claim missing/complete coverage. |
| 12 | Confirmed and fixed | The common pre-validation normalizer drops direction/depth/expandPackages from non-relations actions, including strict-client []/0 placeholders. Real relations keep strict bounds. Numeric strings remain accepted, but arrays/booleans/objects no longer coerce to numbers. Raw Zod use still rejects inapplicable fields; public dispatch normalizes them first. |
| 13 | Compatibility limitation documented; bounded redirect refusal retained | Automatic fetch redirect-following is not an implementation of interactive SAML login. No evidence establishes the claimed successful SSO path across all such systems. Added actionable, minimal-error-safe authentication/routing guidance and documented supported preauthenticated sessions/destinations. No blanket redirect following or authentication weakening. |
| 14 | Positional coupling confirmed and fixed | Resolve SAPNavigate by name before applying its opt-in schema; move the unrelated SAPQuery comment. The discovery fallback is not globally dead: direct getToolDefinitions callers, including the opt-in budget scenarios, supply resolvedFeatures.discoveryMap without a fourth argument. Keep that supported path. |
| 15 | CPU regression confirmed and addressed | Add content-addressed, owner-scoped, bounded memory-only memoization of public contracts and dependency extraction, after source retrieval under existing cache/auth policy. Never memoize aggregates; PP dependency calls bypass it. Conditional source reads intentionally remain. Legacy graph APIs/tables are retained for compatibility, not repurposed; document their inactive status and label startup counts legacyDepGraphs. |

## Additional notes

| Note | Disposition |
|---|---|
| Docs parity omits enabled branch | Already fixed in `52228802`; still checked in both modes. |
| Schema budget omits enabled branch | Already fixed without a signature change, via resolvedFeatures.discoveryMap. Still +900 bytes / +225 estimated tokens, with unchanged wire ceilings. |
| Enabled schema not byte-frozen | Added separate on-premise/BTP SAPNavigate snapshots and assert all other tools equal the default surface. Existing fixtures are unchanged. |
| PP aggregate test is vacuous | Rename it to its actual legacy-record behavior. Add real PP parse-cache bypass tests alongside per-user authorization/source-fetch regressions on memory and SQLite. |
| Parser byte literal and diagnostic drift | Share the byte ceiling with traversal; oversized parser input raises the same response-limit type. Distinguish unsupported comments/CDATA/DTD/entity/PI markup in the error. Keep strict markup rejection. |
| Admission DOMException has no useful type | Normalize expired admission to AdtAnalysisDeadlineError; test the real semaphore queue and release. |
| Traversal mutates/aliases provider edges | Sort a copied array and copy each returned edge. A frozen provider-array regression checks mutation/alias isolation. |
| Direct/proxy 421 counts differ | Correct topology-specific accounting: direct performs two actual sends; proxy performs one without that implicit replay. Equalizing counters would misreport traffic. No change. |
| AGENTS routing missing | Add the opt-in configuration row and route to all six relation modules plus pure parse memoization. |

Legacy aggregate APIs/tables and audit-event names remain compatibility debt. Removing them would
require a separately scoped interface/storage migration and compatibility review; this patch
does not delete an operator's persisted rows or redefine old rows as valid new parse-cache entries.

## Parse-cache design and measurements

- Key: extraction kind, object name/type where relevant, SHA-256 of the retrieved source, and
  ABAP parser language version. The installed abaplint library version is fixed for the process;
  nothing survives a deployment/restart. No ETag is trusted without first applying source policy.
- One LRU per CachingLayer owner, held by WeakMap: 128 entries and 4 MiB of serialized key/result
  bytes. This is not an exact JavaScript heap/RSS limit. Oversized results bypass the memo.
- Only extracted contract text/dependency records, no AST, aggregate or separate fullSource field.
  An interface contract can itself be its complete interface declaration. Results are independent
  copies. Failed contract extraction is not cached.
- Source retrieval happens first. The existing post-activation source-consistency window is
  unchanged. Failed/denied source reads cannot reach an old parse result. PP dependency calls and
  cache=none bypass memoization entirely. Source freshness is not inferred from the root hash.
- Unit tests cover identity/type/version/content changes, LRU/count/byte limits, failures, mutation
  isolation, warm zero-parse calls, changed dependencies, HTTP 403/404, depth/maxDeps changes, and PP.

Reproduce the CPU-only experiment with `npx tsx scripts/bench-context-parsing.ts` (no SAP or credentials).
Node 24.11.1; parser language 758; seven post-warm-up repetitions; same synthetic classes and
deep-equal outputs for both paths. These numbers exclude SAP/network time and are not an end-to-end
latency promise. The depth-2 measurement includes dependency-name extraction as well as contracts.

| Dependencies | Lines per class | Depth | Uncached median | Warm memo median | Serialized retained bytes |
|---:|---:|---:|---:|---:|---:|
| 20 | 300 | 1 | 59.13 ms | 0.14 ms | 5,510 |
| 20 | 300 | 2 | 141.81 ms | 0.24 ms | 7,640 |
| 20 | 1,000 | 1 | 191.94 ms | 0.32 ms | 5,510 |
| 20 | 1,000 | 2 | 433.93 ms | 0.66 ms | 7,640 |

## SAP documentation and proof limits

SAP search results describe Relation Explorer contexts and the Eclipse UI, but no authoritative
definition of the native wire flag `objectReference exists=false` was obtained. Direct web opens
returned no extractable page body, and the SAP Docs MCP query returned unrelated matches. This is
a retrieval/proof limit, not proof that SAP has no such documentation. The retrieved evidence does
not justify treating the flag as proven deletion. Relevant UI references: [Relation Explorer](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/relation-explorer)
and [Working with the Relation Explorer](https://help.sap.com/docs/ABAP_PLATFORM_NEW/c238d694b825421f940829321ffa326a/eb2dc3a7a5cb4d02af942bbbb7d5120b.html).

SAP documents frontend SSO support; that is not proof that a stateless HTTP fetch completes browser
SAML authentication. This distinction is an inference from the client implementation and the scope
of [SAP's frontend authentication documentation](https://help.sap.com/docs/SAP_NETWEAVER_AS_ABAP_752/c238d694b825421f940829321ffa326a/4ec2b5a56e391014adc9fffe4e204223.html).
No live SAML-only environment or real dangling/restricted native reference was available in this
pass. These remain explicit compatibility/proof limits, not silently accepted protocol variants.

## Validation

- Typecheck, lint, production build, action-policy validation and file/schema-size checks passed.
- Full unit suite: **6,032 passed / 203 files** (34 additional cases over `52228802`).
- Final error/transport/traversal boundary subset: **63 passed** across three files.
- Strict MkDocs build passed. Default snapshots are byte-identical; two new files freeze only
  the enabled navigation schema. Enabled/default wire sizes and hard ceilings are unchanged.
- Read-only live verification used an owned loopback ARC-1 instance against a4h / client 001,
  with normal source memory caching and all SAP write gates off: **9 cache E2E tests passed**.
- Namespaced live smoke on SAP_BASIS 758 again verified `/BOBF/CL_FRW_FACTORY` (20 nodes,
  40 edges, eight expansions, 11 attempts, 421,134 successful metadata bytes) and
  `/BOBF/IF_FRW_CONFIGURATION` (20 nodes, 19 edges, one expansion, two attempts, 54,364 bytes).
  Both explicitly reported truncation and unknown coverage. Default-hidden, guessed disabled
  action rejection, enabled listing and missing-root rejection passed too.
- No SAP writes, BTP provisioning, alternate identities or running-instance restarts. Owned
  verification processes are closed. No merge.

The final diff review traced cache miss/hit/denial paths and PP bypass, typed budget errors and
auth-latch preservation, cancellation during complete/partial results, admission cleanup, schema
normalization and the enabled/default client surface. It found no additional confirmed defect
within this patch. This is not a production-wide security certification, and the explicit proof
limits for native unresolved references and SAML-only environments remain.
