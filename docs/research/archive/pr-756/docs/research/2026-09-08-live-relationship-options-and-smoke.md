> Historical research from PR #756; the persistent graph was not merged.
> [Archive status and current direction](../../README.md) take precedence over the dated instructions below.
> This local, uncommitted note was recovered on 2026-09-10; it is not part of that PR commit.

# Live relationship options: research and smoke results

2026-09-08. Experimental research for PR #756, not an implemented feature or release approval.
Continues the [guided comparison](2026-09-07-graph-guided-pilot.md). No merge.

Follow-up: [low-risk integration plan and deeper spikes](../plans/live-relationships-integration.md)
tests aggregate-cache retirement on memory/SQLite, actual SAP ETag behavior, metadata-only root
validation, discovery reuse, native BFS, HTTP retry accounting, cancellation and default-hidden
schema integration. It refines the first three recommendations without deploying them.

## Recommendation

Prioritize **better live ARC navigation before expanding the persistent graph**:

1. Fix normal SAPContext dependency-cache correctness and introduce a true total-work budget.
2. Add a small, discovery-gated adapter for SAP's native Relation Explorer metadata.
3. Compose bounded, request-local traversal and targeted source/include verification.
4. Reassess a database only for repeated, broad package analytics that this approach cannot serve economically.

Retain the normal source/ETag cache. Do not reintroduce system-wide warmup, add a shared reverse
cache, require HANA/PostgreSQL, or remove the existing experimental graph on the strength of this smoke.
No AI Core, embeddings, new CF application, database or service binding is needed for the proposed
live approach. It still consumes SAP requests and ARC CPU/RAM; it is not zero-cost indexing.

SAP documents incoming and outgoing relationship exploration and separate reference inspection.
This is a useful existing backend capability, not a reason to duplicate an entire index immediately.
The documented UI is **not** proof of a stable, supported public REST contract on every release.
[SAP Relation Explorer](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/relation-explorer).

## Options: value, complexity and risk

These are engineering judgments, not measured development estimates. Complexity includes testing;
risk means the main correctness, authorization or operational risks remaining before implementation.

| Option | Value | Complexity | Risk | Recommendation |
|---|---|---|---|---|
| Repair SAPContext aggregate-cache identity/freshness and total budgets | High: prevents silently wrong context and uncontrolled expansion | Small–medium | Medium: cache compatibility, freshness and user isolation | First, as a separate correctness change |
| Native incoming/outgoing relation metadata | High: names, types, packages and relationships without source downloads | Medium | Medium: release-specific protocol, incomplete native coverage, misleading successful responses | Best next capability; experimental and opt-in |
| Bounded live traversal inside ARC | High: multi-step impact candidates with fewer model/tool round trips | Medium | Medium: SAP pressure, cycles, indirect-result semantics, cancellation | Compose existing/native primitives; no database |
| Metadata-only, include-aware source analysis | Medium–high: precise evidence and native coverage gaps | Medium | Medium–high: grammar gaps, false positives, incorrect relation labels | Targeted fallback; reuse pure extraction knowledge without backend dependencies |
| Cross-request relationship TTL cache | Unproven–medium: repeated queries may benefit | Medium–high | High: stale reverse edges, authorization reuse, multi-instance invalidation | Defer; start with request-only memoization |
| Persistent graph and broad package analytics | High for repeated estate-wide aggregation; less compelling for object-level work | High including operations | High: collection coverage, refresh, shared audience and ongoing ownership | Keep experimental; require demonstrated usage/ROI before expansion |

The graph's durable advantage is answering many aggregate questions without revisiting SAP—not
merely drawing a multi-step path. A live package snapshot is another possible middle ground, but
would need inventory plus many relationship requests. Its load, deletion semantics and refresh
cost have **not** been tested here. A package root did not provide such an aggregate in the smoke.

## Scope and method

- Repository inspected: `codex/optional-repository-graph`, HEAD `69d7d596` before this report.
- Unchanged local Docker pair: graph-off on port 8181, graph-enabled on 8182; deployed revision
  `0bdc0c677818a0b26b32af6237433872b3c04338`, same read-only trial identity and normal memory cache.
- Target: A4H, SAP_BASIS 758 / 2023, client 001, HTTPS with certificate validation.
- New MCP smoke calls used the graph-off instance. Native endpoint probes used the existing
  AdtClient directly with the same SAP identity and safety checks. **No new MCP action was installed.**
- No SAP mutation, ABAP test execution, SQL, BTP provisioning, deployment/configuration change,
  database refresh or paid resource was performed. Only local research artifacts were added.
- The ABAP explanation workflow required live source verification. This exposed the native
  `INSTANCE OF` gap and the missing graph implementation-include edge; neither was waved away.
- SAP HTTP counts came from the existing per-container audit counter or direct-client audit
  events. Source bodies were processed transiently; evidence files contain metadata/hashes.
- Caches were not reset. These are functional smoke results, **not** a latency, token, precision/
  recall, load-capacity or independent LLM A/B benchmark. Do not derive a speedup from them.

## 1. Native Relation Explorer: strongest new finding

Live ADT discovery advertises `/sap/bc/adt/objectrelations/network`, `components`, `references`
and relation-set resources. The network request shape was verified against the SAP interface
`IF_ORO_ADT_OBJECT_RELATIONS`, then exercised on the live system:

```http
POST /sap/bc/adt/objectrelations/network
Content-Type: application/vnd.sap.adt.objectrelations.request.v1+xml
Accept: */*
```

```xml
<or:request xmlns:or="http://www.sap.com/adt/objectrelations"
            xmlns:adtcore="http://www.sap.com/adt/core">
  <or:reference adtcore:uri="/sap/bc/adt/oo/classes/zcl_ssi_factory"/>
  <or:preferredContext>ENV</or:preferredContext>
</or:request>
```

On this system, `ENV` selects outgoing Used Objects and `WUL` incoming Using Objects. Response
`networkResponse` includes `activeContext`, object references with URI/type/package, and relations.
The final matrix used **12 network requests, one SAP HTTP request each, with zero source reads**.
Discovery, earlier protocol exploration and independent source verification are additional work.

| Entry / requested context | Returned object references / relations | Evidence |
|---|---:|---|
| FACTORY / ENV | 6 / 5 | ENGINE, interfaces and exception classes; no false local TS_REGISTRATION class |
| FACTORY / WUL | 6 / 5 | Includes IMPORT, ADP_RUN, GEN_TEST, SAMPLES and UNIT |
| IMPORT_ACTION / ENV | 8 / 7 | Finds IMPORT |
| IMPORT / ENV | 16 / 15 | Finds FACTORY |
| ZBP_SSI_R_IMPRUN / ENV | 12 / 11 | Finds IMPORT from the implementation include |
| ENGINE / WUL | 2 / 1 | FACTORY only; misses UNIT's source-level type check |
| UNIT / ENV | 12 / 11 | Also misses the ENGINE type check |
| ZIF_SSI_IMPORTER / WUL | 11 / 10 | Includes seven known implementers and other consumers; does not label implements |
| Package ZSSI_SAMPLES / ENV | 0 / 0 | Empty activeContext: not proof of no package coupling |
| Synthetic absent class / ENV | 1 / 0 | HTTP 200 and exists=true; independent source GET returns 404 |
| FACTORY / ARC_UNKNOWN | 6 / 5 | HTTP 200 silently selects ENV |
| Repeat FACTORY / ENV | 6 / 5 | Same objects and response hash as first request |

Class names abbreviate `ZCL_SSI_` where applicable. Counts are raw object-reference records,
including the root and sometimes duplicate references—not unique nodes. For example, ABAP
type-group references repeat the same URI. The RAP result also contains BDEF and DDLS objects
with the **same name but different URIs/types**. Name-only deduplication loses real objects.

Important adapter rules established by the smoke:

- Check the requested context against the returned `activeContext`. Unrecognized contexts and
  incorrectly shaped request fields can silently fall back to ENV with HTTP 200.
- Normalize direction explicitly: in WUL, `object1` remains the queried root and `object2` the
  consumer. A dependency edge points consumer → root, the reverse of that response ordering.
- Preserve generic native provenance; `parentChild` does not prove a static call, implementation,
  direct source reference or runtime execution. Resolve exact evidence separately when needed.
- Verify the starting object through normal authenticated resolution. Even native `exists=true`
  is insufficient. Empty results need unknown/unsupported/not-found distinctions, not certainty.
- Deduplicate canonical identities while retaining relationship observations. Enforce response
  size limits before parsing and validate returned URIs before any follow-up request.
- Native coverage is not exhaustive. The first matrix run failed an assertion expecting
  UNIT → ENGINE. Live source contains `INSTANCE OF zcl_ssi_engine`; both native directions omit it.
  The rerun records this as an explicit coverage gap, not a successful completeness test.

The final normalization prototype passed eight controls: both directions, unknown/empty contexts,
duplicate URIs, same-name different objects, unknown completeness and the independent absent-object
404. Its first fixture selection incorrectly expected distinct-URI duplicates on IMPORT; inspection
located the actual BDEF/DDLS case on the RAP handler, and the test was corrected transparently.

Native XML was 5,146 bytes for FACTORY ENV, larger than that small class's source. Avoid claims of
universally lower bandwidth or faster SAP computation. The benefit demonstrated is source-free
metadata retrieval and useful native include coverage. Backend cost has not been profiled.

Release qualification matters: SAP's ADT 3.56 notes add service-definition Used Objects support
for ABAP environment/Public Cloud 2602. That is evidence of evolving support, not permission to
assume every object/context works on A4H 758.
[SAP ADT 3.56 release notes](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/version-3-56).

`components`, `references`, BO/CDS contexts and relation sets were discovered but not exercised.
SAP documents a separate Get References operation; its REST shape, limits and exact returned
semantics remain a follow-up, not an implemented feature.
[SAP reference inspection](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/displaying-references?locale=de-DE).

## 2. Bounded live impact without a database

An external breadth-first wrapper around existing `SAPNavigate action=references` found **17
objects including ENGINE in seven lookups/seven SAP requests**, including the missing RAP handler.
It retained 20 native usage-candidate observations across the four selected ZSSI packages.

Limits were eight lookups, 30 nodes, three discovery levels and a 20-second between-request
deadline. A one-lookup negative control stopped with FACTORY pending and `partial=true` /
`request_budget`. No limit was hit in the larger fixture; that does not certify complete coverage.

This wrapper is not a new single-call ARC feature. Moving it inside ARC can reduce model/tool
round trips, but seven backend queries remain seven backend queries. The prototype's per-call
timeout can outlast its between-call deadline: production needs cancellation and a shared hard
deadline, not merely another loop condition.

Current where-used containers can omit a directness flag. Their discovery levels are not proven
direct dependency-hop counts. Current `maxResults` filtering/slicing happens after the native
response, so a small returned page does not establish bounded SAP work or wire bytes.

## 3. Metadata-only source fallback

Seven source resources from six classes, including RAP MAIN and implementations, were fed to
the existing core dependency extractor with the A4H grammar version. The corrected collection
used seven MCP calls/eight SAP requests: **69,554 raw source bytes → 3,460 metadata JSON bytes**.
Metadata includes names, kinds, lines and per-resource hashes; no dependency contracts were fetched.

The output retained IMPORT_ACTION → IMPORT → FACTORY → ENGINE and recovered RAP handler → IMPORT
only after including implementation source. This is potential model-output reduction, **not** a
SAP download saving: the source was still fetched, and extraction ran outside ARC in the prototype.

The first harness fed formatted SAPRead include output to the parser, shifting locations by one
line. It was fixed to verify/remove the envelope and the seven sources were recollected. A core
implementation must consume raw client source directly, never parse human-oriented tool text.

Seven authored parser fixtures compared core extraction with the graph backend's pure extractor:

- Core name-first deduplication can retain `type_ref` and discard a more useful `static_call` kind.
- Core can treat a local type or built-in OBJECT as an external dependency; the graph extractor
  filtered those fixtures and retained static-call evidence, including a namespaced example.
- Both ignored comment/string canaries. Malformed source returned an unqualified empty core list,
  while the graph extractor exposed failure/coverage reasons.
- Dynamic object creation was not counted by the graph extractor either. Reuse does not fix it.

Bring the useful pure-parser lessons into a tested core boundary if needed; do not import the
database/API/collector or maintain two permanently divergent parsers. Do not replace the existing
context contract format or fetch all includes by default as an incidental change.

## 4. Correctness fixes before adding another cache

On a previously unqueried `ZCL_SSI_UNIT_NUM`, depth=1/maxDeps=1 resolved one of six dependencies.
The next request, depth=3/maxDeps=8, returned the **cached one-dependency result**. The previous
pilot reproduced the opposite order returning excessive cached context. This is correctness,
not just efficiency.

[SAPContext](https://github.com/arc-mcp/arc-1/blob/69d7d596f2bee8740d9629e017b58d6deecb192d/src/handlers/context.ts) looks up the aggregate by root source hash through
[CachingLayer](https://github.com/arc-mcp/arc-1/blob/69d7d596f2bee8740d9629e017b58d6deecb192d/src/cache/caching-layer.ts). Requested depth/maxDeps are not part of that
identity. [MemoryCache](https://github.com/arc-mcp/arc-1/blob/69d7d596f2bee8740d9629e017b58d6deecb192d/src/cache/memory.ts) has no dependency-graph TTL. An unchanged root
also does not prove its dependencies' contracts are unchanged; an options-key fix alone is incomplete.

Choose a conservative bypass when freshness/shape cannot be established, or define versioned
identity covering object/system/client, source version/include/hash, extractor version and result
options, plus explicit dependent-contract revalidation. Test both memory and SQLite behavior.
Retain normal source ETag revalidation. A seven-variant tuple-key sketch passed locally but is
not an implemented cache fix or proof of freshness.

The existing per-user dependency-payload cache bypass was independently asserted and must remain:
[cache security](https://github.com/arc-mcp/arc-1/blob/69d7d596f2bee8740d9629e017b58d6deecb192d/src/handlers/cache-security.ts). Request-local memoization must stay inside
one authenticated target/request; no shared metadata audience exception is needed for this design.
Native endpoint authorization and disclosure of related objects still require per-user tests.

Also, `maxDeps` is a per-expansion limit, not a total request budget: an in-memory compressor
fixture with maxDeps=1/depth=3 fetched two dependency objects. Budget discovery, root validation,
contract/source reads, retries and fallbacks together, alongside the existing SAP concurrency cap.

## Proposed implementation sequence and release gates

This sequence is a recommendation, not authorization implied by the completed research:

1. **Correctness PR:** cache regressions in both option orders and dependent-source changes;
   explicit total-work limits without silently redefining legacy maxDeps. Preserve PP bypass,
   source-cache behavior, deny actions and existing output compatibility.
2. **Native adapter behind experimental opt-in:** isolated `src/adt/` module and small AdtClient
   facade. Start with CLAS/INTF incoming/outgoing, negotiated from discovery. No new top-level MCP
   tool. Prefer one `SAPNavigate` action (working name `relations`) with direction and bounded
   depth; do not silently change `references` or CDS `impact` semantics. Keep the new action and
   its options out of default tool schemas; flag name/API remain proposed, not usable settings.
3. **Composition:** pure request-local traversal, URI/type identity, cycles, native/source
   provenance, coverage warnings and explicit limits. Use existing references or selected raw
   source/includes only when requested or needed; never fallback from 401/403 to another identity.
4. **Compatibility:** root existence, unknown/empty contexts, ENV/WUL direction, duplicate
   identities, malformed XML, oversize responses, cancellation, 401/403/404/429 and retry budgets.
   Freeze default tool snapshots; synchronize handler, Zod/JSON schema, policy and docs when
   introducing the opt-in action. Preserve the current CDS impact routing.
5. **Deployment qualification:** direct A4H is proven; Cloud Connector, PP, restricted-user pairs,
   older releases and BTP ABAP native-relation access are not. Reuse existing Destination/
   Connectivity and per-user AdtClient. Check Cloud Connector permits the required objectrelations
   paths and SAP authorizations permit the calls; do not assume every existing role does so.
   No mandatory new ARC role/database/service is proposed. If unavailable, fail clearly or use
   explicitly qualified existing live tools, never broader credentials.
6. **Acceptance/ROI:** rerun the nine comparison prompts with matched bounded workflows and
   independent fresh sessions, repeated cold/warm runs, answer correctness/coverage, requests,
   bytes, time and failure behavior. Include RAP handler and INSTANCE OF counterexamples. Only
   then claim better answers, cost savings or that a persistent graph is unnecessary.

Human/LLM documentation should offer one entry: live relationships for object-level navigation,
normal SAPRead/SAPContext for source verification, optional graph for indexed aggregate questions.
Label the new mode experimental and explain that empty/limited results do not prove no impact.
An admin should not need a new database setup guide to try the live mode.

## Evidence and verification status

- Existing focused baseline: **169 unit tests passed across five files** (deps, compressor,
  caching-layer, manage-context, codeintel). These passing existing tests do not cover/fix the
  newly reproduced cache bug or certify the proposed feature.
- External live traversal/metadata smoke completed, including budget-stop and source assertions.
- Seven synthetic parser fixtures and seven option-key variants completed; known failures above
  are findings, not parser correctness certification.
- Final native 12-request matrix completed with disclosed negative semantics/coverage gaps;
  eight additional normalization/existence controls passed. Earlier protocol exploration also
  encountered 400/405 responses before the valid request shape was established.
- No core implementation, deployment, graph refresh, new cloud resources, commit, push or merge.

Operator-only reproduction artifacts are under `/Users/marianzeis/DEV/arc1-graph-comparison`:
`live-options-smoke.mjs`, `live-options-evidence.json`, `live-options-synthetic.mjs`,
`live-options-synthetic.json`, `native-relations-probe.mjs`, `native-relations-smoke.mjs`,
`native-relations-evidence.json`, `native-relations-normalization-smoke.mjs` and its
`native-relations-normalization-evidence.json`. They require owner-private configuration and the
local pair; they are not portable committed integration tests. The cache smoke's first-uncached
precondition will not repeat on an already-warm root. Do not restart shared deployments silently.

Run operator scripts from that directory with Node 22+ and
`node --import ../arc-1-repository-graph/node_modules/tsx/dist/loader.mjs <script.mjs>`.
The final metadata-only recollection used `live-options-smoke.mjs --metadata-only` to preserve
the prior cache/traversal evidence while fixing raw-source line locations.
