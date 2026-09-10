> Historical research from PR #756; the persistent graph was not merged.
> [Archive status and current direction](../../README.md) take precedence over the dated instructions below.
> This local, uncommitted note was recovered on 2026-09-10; it is not part of that PR commit.

# Live relationships: low-risk integration plan and spike evidence

2026-09-08. **Experimental; proposed implementation, not shipped.**
Follows [the options assessment](../research/2026-09-08-live-relationship-options-and-smoke.md).
Scope: context-cache correctness, native relationship lookup and bounded traversal only.
The existing graph experiment remains unchanged; no deployment, commit, push or merge in this research.

## Recommended decisions

| Decision | Recommended choice | Why this is the lowest-risk useful increment |
|---|---|---|
| Fix aggregate dependency caching | Stop reading/writing assembled dependency answers at the two caller sites | Fixes option and dependent-source freshness bugs; no new invalidation algorithm or DB migration |
| Keep ordinary caching | Preserve source/ETag cache, activation consistency behavior and PP bypass | Live spike retained conditional reads; does not disable the useful normal cache |
| Tool integration | One opt-in `SAPNavigate` action, working name `relations` | No thirteenth default tool, plugin loader, external API or backend package dependency |
| Relationship source | Native Relation Explorer, active-state metadata, CLAS/INTF roots initially | Source-free orientation with useful package/type identity and implementation-include coverage |
| Graph lifetime | Request-local traversal only | No cross-request reverse-index freshness or shared-audience authorization problem |
| Fan-out | Serial expansion, bounded nodes/edges/HTTP sends/time/bytes; two active analyses per process | Easier cancellation, deterministic order and less SAP pressure than parallel traversal |
| Fallback | Explicit guidance to existing source/context/references tools | Avoid silently mixing native metadata, SQL augmentation and parser heuristics in v1 |
| Initial compatibility | Single-target, standard tool mode; qualify Basic and then PP/CC independently | Avoid coupling this change to hyperfocused/multi-target behavior before its contracts are tested |

Names and limits below are proposed, not settings or calls users can use today. The choices do
not require a new database, collector, endpoint route, BTP service, ARC authorization role or AI Core.
Existing SAP authorizations and Cloud Connector resource access still apply; availability is not authorization.

SAP documents Used Objects and Using Objects contexts, with object-type exceptions. We use that
as conceptual grounding; the REST protocol remains empirically verified on A4H 758 only.
[SAP Relation Explorer](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/relation-explorer).

## 1. Context-cache fix

### Smallest production change

- In `src/handlers/context.ts`, remove the source-hash aggregate-hit shortcut. Run normal
  dependency resolution for each SAPContext request.
- In `src/context/compressor.ts`, stop `putDepGraph()` for assembled ABAP dependency answers.
- Keep passing the eligible `CachingLayer` to dependency source reads. **Do not** implement
  this by setting the whole cache to none or passing undefined for every user.
- Keep `contextCacheForDependencyPayloads()`'s current PP bypass. Do not add a shared metadata
  cache or change authorization checks on source hits as part of this fix.
- Leave cache storage interfaces/old records alone initially. They have no remaining runtime
  reader for this path; migration, deletion and legacy statistics cleanup can be separate work.
  Do not wipe ordinary source rows or change SQLite schema just to retire answer reuse.
- Update comments/docs that promise skipping all downstream reads on unchanged root source.
  Existing KTD composition tests must verify fresh dependency context instead of requiring
  `[cached]`; preserve KTD, source-contract formatting and other SAPContext actions.

An expanded cache key fixes depth/maxDeps identity but **not** dependency changes when the root
does not change. Adding a TTL bounds staleness rather than establishing correctness. A validated
dependency manifest could work but needs nearly the same SAP checks as resolving from ETag-cached
sources, plus substantially more invalidation and authorization logic. Defer that complexity.

### Tested

An external seam disabled only aggregate get/put while executing the **actual SAPContext handler**.
Seven controls passed on each of MemoryCache and real SQLite `:memory:` (14 total):

1. Low-depth/low-limit followed by deeper/broader context equals a cold answer.
2. The opposite order also equals a cold answer.
3. A changed dependency contract appears even with unchanged root source and an old aggregate present.
4. Repeated unchanged dependencies retain source ETag revalidation.
5. A dependency returning 403 does not serve the old contract.
6. A dependency returning 404 does not serve the old contract and evicts its source cache entry.
7. PP mode retains its dependency-cache bypass, including a populated shared cache negative control.

The legacy behavior reproduced both option bugs and stale dependent contracts before testing the
proposed bypass. These are synthetic authorization controls, not live restricted-user certification.

A live `ZCL_SSI_IMPORT_ACTION`, depth 1/maxDeps 2 comparison confirmed actual A4H ETags:

| Case | Dependency source calls | Returned dependency source bytes | Answer |
|---|---:|---:|---|
| Legacy cold | 2 | 15,737 | Four candidates, two resolved, zero failed |
| Legacy warm | 0 | 0 | Cached shortcut; even candidate count changes from four to two |
| Proposed warm | 2 conditional | 0, both not-modified | Byte-identical output hash to cold |
| Proposed repeat | 2 conditional | 0, both not-modified | Same output hash again |

Root source was fetched once and supplied identically to the handler; it is excluded from those
rows. The cache was ephemeral. This establishes correctness/ETag behavior on one small fixture,
not universal speed. Repeated requests trade zero-check answer reuse for additional SAP checks
and contract extraction. Existing maxDeps/depth semantics and the HTTP concurrency cap remain;
this fix alone does not make legacy deep SAPContext expansion globally bounded.

Risk/effort: small implementation, medium regression/performance risk. Prefer this correctness
change independently reviewable; do not bundle an extractor rewrite or a global cache redesign.

## 2. Native relationship lookup inside ARC

### Module and API boundaries

- Put request construction, metadata normalization and response validation in a focused
  `src/adt/repository-relations.ts` module, with a thin AdtClient facade. Name is proposed.
- Accept validated type/name rather than an arbitrary caller-supplied URI in v1. Derive canonical
  CLAS/INTF paths with existing object routing and escaping. Returned URIs are untrusted inputs
  if used for subsequent requests: validate identity/path/type, not just an `/sap/` prefix.
- Resolve the **root metadata** through the same authenticated client before asking for relations.
  This worked without source downloads and rejects a made-up class with 404. Native network
  `exists=true`/HTTP 200 was previously demonstrated to be insufficient.
- Use the network collection and request MIME verified in the earlier report. Check `activeContext`
  equals ENV/WUL as requested. Never treat an empty/different context as a valid empty answer.
- Preserve generic `uses` evidence and native context. Reverse response ordering for WUL.
  Deduplicate by canonical URI/type identity, not just name; preserve BDEF/DDLS same-name nodes.
- Report active-state/native-only coverage explicitly. Neither source call type, method-level
  directness, runtime execution nor whole-system completeness follows from `parentChild`.

### Reuse discovery without turning it into an authorization cache

Do not download discovery for every lookup. ARC already injects discovery data into the client;
feature resolution can derive a capability from the **exact network collection plus request MIME**.
The current `discoveryAcceptFor()` does longest-prefix matching: do not use a generic parent
collection match as proof that the network child exists. Add a small exact-collection accessor
or derive a typed feature from the exact parsed map at existing discovery processing.

Use existing target-scoped discovery/feature lifecycle, not a new relationship cache. A capability
means that a protocol is advertised, **not** that a particular user's request will be authorized.
Root and network reads still use that user's SAP session. For unknown discovery, a bounded lazy
probe can occur on a call; never block `tools/list` on a SAP request. A discovery failure is not
equivalent to a successful document with a missing collection.

Live spike: first discovery was **300,036 bytes**. Reusing its parsed map changed the factory
lookup from 312,729 bytes/three logical calls to **12,693 bytes/two logical calls**, twice, with
the same six nodes/five edges. Both metadata and network remained live. This is eliminated repeated
discovery overhead on one fixture—not a claim that native XML is always smaller than ABAP source.

### Visibility and safety

Recommend one explicit default-off flag, provisionally `ARC1_LIVE_RELATIONS`. It is **not implemented**.
When off, return byte-identical existing tool schemas and reject a manually supplied new action
before SAP access. When on and capability is known available, project the new action/fields into
SAPNavigate; known-unsupported/unknown capability must not silently advertise verified support.
Use the existing feature refresh/list-changed mechanism and keep handshakes network-free.

Proposed input: `action=relations`, `type`, `name`, `direction=incoming|outgoing`, `depth` (default 1,
max 3), bounded `maxResults` (nodes), optional bounded exact `expandPackages`. Package filtering
controls expansion scope, not a new authorization allowlist. Do not hide boundary metadata or
imply omitted packages have no relationships. Raw SQL is unnecessary.

Add an explicit `SAPNavigate.relations` read/Intelligence policy entry, sync Zod/JSON schema and
handler, and enforce the flag at runtime. A schema projection spike confirmed default bytes are
unchanged and existing read-scope/deny-action pruning works; it did **not** install a new Zod action
or prove all runtime dispatch paths. Denial should also avoid leaking action-specific schema hints.

Do not alter `SAPNavigate.references`, hierarchy or CDS `SAPContext.impact` semantics. In particular,
do not reuse where-used's optional SQL implementer augmentation implicitly in the new action.
Keep hyperfocused/multi-target support explicitly unavailable initially, not half-advertised.

Risk/effort: medium. Main uncertainty is release/authorization/transport qualification, not database setup.

## 3. Bounded traversal

Keep this a pure, independently testable breadth-first function over a one-object provider. The
handler owns scope/admission; the ADT adapter owns protocol; the HTTP layer owns physical sends.
No database, plugin lifecycle, background worker or shared request-result map is needed.

Initial proposed limits, to ratify with implementation load tests:

| Control | Initial choice | Enforcement |
|---|---|---|
| Depth | Default 1, max 3 | Native relation steps, not proven source-call hops |
| Returned nodes / edges | 50 / 100; admin hard ceiling | Root counts; deduplicate before charging; report truncation |
| Expanded objects | At most 8 | Serial BFS; visited per request; no repeated expansion of cycles/diamonds |
| Physical SAP HTTP sends | At most 12 | Includes root/discovery/CSRF/retries; does not count IdP/Destination HTTP as SAP sends |
| Deadline | 15 seconds | Shared through admission, semaphore waits, HTTP body and retry backoff |
| Successful decoded metadata bodies | 1 MiB cumulative | Existing response-budget primitive, before string/XML parsing |
| Concurrent whole analyses | 2 per process | Separate admission semaphore; existing SAP HTTP cap remains in force |

Expose only useful result-shaping fields to the LLM, not all operational controls. MCP cancellation
must reach the same request options. Synchronous XML parsing also needs byte/record limits; a timer
alone cannot interrupt it. Bound names, packages, URI lengths and final serialized output.

Use a separate whole-analysis admission lease: wrapping an analysis in the SAP HTTP semaphore
and then acquiring that same semaphore for each request can deadlock. Holding only per-HTTP slots
also does not bound how many analyses retain results between requests. Eight concurrent synthetic
analyses with a separate two-slot lease had a peak of two active walks and clean release.

### Physical-send guard: small but necessary HTTP change

`AdtRequestOptions` already carries deadline, signal and responseBudget. Pass a typed optional
request-counter budget alongside these, and charge at `AdtHttpClient.doFetch` immediately before
an outbound attempt. Preserve it through CSRF/bootstrap/retries. Budget state belongs to request
options, **never mutable per-user/shared client fields**. With no budget supplied, unrelated HTTP
behavior must remain unchanged; do not introduce a process-wide request budget implicitly.

The real transport over a local server demonstrated that max logical calls=1 can still produce
**HEAD + POST + retried POST**. A temporary hook at doFetch capped physical sends at two and stopped
the retry before sending. Production needs a typed error recognized across catch/retry/audit
paths; the spike's per-instance monkey-patch must not become production architecture.

Reuse the existing response-budget class with an endpoint-family label; do not blindly rename
all data-preview types. Its current accounting is cumulative for successful bodies, per-response
for errors, and deliberately excluded from CSRF bootstrap. Thus **1 MiB is not a total wire-byte
cap including failures/auth**. Physical sends/deadlines bound repetition. CC's CSRF GET fallback
and control-body ownership/limits need dedicated validation before claiming fully bounded BTP
behavior; do not silently change existing data-preview/CSRF semantics to satisfy this feature.

The existing primitives handle cancellation while queued, mid-body and during Retry-After. Local
tests exercised those paths with the real transport and verified no queued send and slot release.
Node supports the composed AbortSignal primitives ARC uses; timers are not a substitute for passing
the signal into I/O. [Node 22 AbortSignal documentation](https://nodejs.org/download/release/latest-jod/docs/api/globals.html).

### Output and failure contract

Return root identity, direction, nodes, edges, provenance, expansion scope, counts, observed time,
coverage limitations and explicit stop reasons. Separate **scope boundary** (depth/type/package)
from **truncation** (request/node/edge/byte/time budgets). A traversal ending is not proof of complete
SAP impact. The prototype combines these as `limitsReached`; production should make them distinct.

Root not found, invalid arguments and 401/403 are terminal errors. Do not return a success-shaped
partial after authorization failure or retry under another identity. A bounded interruption after
valid expansions may return a clearly partial result, with the failed expansion identified and
unverified data excluded. Initial malformed/context-mismatched responses must not become empty success.
A disappearing child should be marked unresolved, never taken as proof it has no consumers.

Keep source fallback explicit in v1. The previous source-confirmed UNIT → ENGINE type-check gap
still applies. Native impact is candidate discovery, not a safe-to-delete or complete-unused result.

## Live traversal results

Fresh direct A4H clients used one discovery and one metadata validation per graph; no source was
downloaded by these graph cases. Four selected ZSSI packages controlled CLAS/INTF expansion.

| Query | Nodes / unique directed edges | Native expansions | Total logical / observed SAP request events |
|---|---:|---:|---:|
| FACTORY outgoing, depth 1 | 6 / 5 | 1 | 3 / 3 |
| ENGINE incoming, depth 3 | 17 / 20 | 7 | 9 / 9 |
| IMPORT_ACTION outgoing, depth 3 | 42 / 63 | 8 | 10 / 10 |

Incoming found the RAP handler. Outgoing preserved IMPORT_ACTION → IMPORT → FACTORY → ENGINE.
All report depth boundaries/unknown coverage. These counts are not runtime-call edges, a full
system index or evidence that the configured limits suit arbitrary large SAP classes.

Four additional live controls passed: missing root prevented the network request; a 128-byte
native response limit rejected the body; a pre-aborted request made no SAP call; and a consumed
logical budget stopped before relationship lookup. Fault injection used only localhost/synthetic
providers, not intentional SAP authentication failures or SAP modifications.

## Implementation checklist and acceptance gates

- [x] Research current modules and run cache/native/traversal integration spikes.
- [x] 14 cache controls, 14 offline/loopback controls, seven live native cases, live ETag comparison
  and discovery-reuse comparison completed. 399 existing unit tests passed across 11 files
  (209 focused + 190 HTTP); default schema snapshots passed. These are not tests of shipped changes.
- [ ] **Commit A — correctness:** remove only aggregate context get/put; migrate spike assertions
  into unit tests; preserve KTD/source/PP behaviors; document additional conditional reads.
- [ ] **Commit B — dormant adapter/budgets:** exact capability lookup, metadata-root validation,
  ENV/WUL parser, URI checks, optional physical-send guard and typed errors; add hostile/proxy fixtures.
- [ ] **Commit C — opt-in action at depth 1:** runtime flag + policy + Zod/JSON projection + handler;
  test flag-off guessed calls, no-read scope, explicit denial, absent/unknown capability and startup
  handshake timing. Standard/default snapshots remain byte-identical; add enabled-only snapshots.
- [ ] **Commit D — bounded traversal:** request-local BFS, separate admission lease, depth/type/
  package boundaries, deterministic output, physical/byte/time budgets and cancellations. Tests
  include two interleaved identities, first/child failure, cycles, diamonds, huge hubs and slot cleanup.
- [ ] **Local acceptance:** serve a new isolated local ARC test instance with the actual implementation;
  verify MCP list/call/CLI paths and the live cases above. Prototypes are not substitutes for this.
- [ ] **BTP gate:** use an isolated trial test instance and existing Destination/Connectivity;
  test native metadata/relations with technical Basic and PP/restricted-user pairs, including
  proxy identity encoding, CSRF GET fallback, late response cancellation and limits. Do not add
  paid resources, widen permissions or bypass CC to make a failing case green.
- [ ] **Cross-release gate:** verify an older backend and BTP ABAP/another current release, or
  explicitly advertise the narrower tested compatibility. No UI documentation implies REST parity.
- [ ] **Human/LLM docs:** one experimental live-relationships page; one flag and verification step
  for Docker/CF, no DB setup. Explain current source vs native candidates vs indexed graph; include
  empty/missing/denied/limited examples and a targeted SAPRead/SAPContext follow-up.
- [ ] Full normal gates and diff review after implementation; rerun matched prompts before claiming
  answer-quality or maintenance ROI. Leave the graph PR and all changes unmerged unless requested.

## Remaining uncertainties and implementation boundaries

No additional product decision is needed to start the small correctness change and dormant adapter.
The recommended flag name/API/limits can be finalized during implementation, with reviewed schema
diffs. Production compatibility remains gated by actual PP/CC and release tests—not an assumption
that everyone with ADT access has identical visibility.

Before exposing the new action, resolve the control-body limit/CC fallback gap and ensure budget
errors are preserved and never retried. The current source cache's activation grace window and
legacy deep SAPContext fan-out are existing behavior, not redesigned or certified by this research.
No guarantees of method-level directness, complete dynamic calls, package-wide aggregates, inactive
source parity, durable refresh, caching ROI or database replacement follow from these tests.

The SAP Docs MCP search responded but returned low-relevance offline results; its separate Help
search alias returned “Unknown tool”. Official SAP Help and Node documentation were used instead,
alongside code inspection and live/loopback evidence. No unverified third-party recipe determines
the protocol or authorization design.

## Reproduction artifacts

Operator folder: `/Users/marianzeis/DEV/arc1-graph-comparison`; source/credentials are not stored in
the repository. Scripts use existing owner-private configuration and the adjacent source checkout.
Run with Node 22+:

```sh
node --import ../arc-1-repository-graph/node_modules/tsx/dist/loader.mjs integration-cache-spike.mjs
node --import ../arc-1-repository-graph/node_modules/tsx/dist/loader.mjs integration-controls-spike.mjs
node --import ../arc-1-repository-graph/node_modules/tsx/dist/loader.mjs integration-native-live.mjs
node --import ../arc-1-repository-graph/node_modules/tsx/dist/loader.mjs integration-cache-live.mjs
node --import ../arc-1-repository-graph/node_modules/tsx/dist/loader.mjs integration-discovery-reuse-live.mjs
```

The shared prototype is `integration-relations-spike.mjs`. Corresponding JSON evidence files
retain metrics and metadata, not complete SAP source or credentials. The exact-discovery check
was tightened after the first native run; its structured parser/gate was then tested offline
and in the live reuse run. No production file was modified to run these prototypes.
