> Historical research from PR #756; the persistent graph was not merged.
> [Archive status and current direction](../README.md) take precedence over the dated instructions below.
> Source: [69d7d596](https://github.com/arc-mcp/arc-1/blob/69d7d596f2bee8740d9629e017b58d6deecb192d/docs_page/repository-graph-comparison.md).

# Compare live ARC-1 with the graph (experimental)

The question is whether the optional graph earns its collection and maintenance cost—not just
whether a graph query is fast. Compare **live ARC-1** with **the same ARC-1 plus SAPGraph**.
The graph arm keeps all normal live tools and the normal request-driven cache.

## What the graph should help with

Its strongest candidates are repeated **cross-package impact, dependency paths, interface
relationships, and package coupling** over a previously indexed scope. These combine many
relationships without asking SAP for each one during the investigation.

This is not a claim that SAP cannot find dependencies. SAP's
[Where-Used Function](https://help.sap.com/docs/ABAP_PLATFORM_BW4HANA/c238d694b825421f940829321ffa326a/4ec2385e6e391014adc9fffe4e204223.html)
already includes indirect usages, and the
[Relation Explorer](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/relation-explorer)
supports exploring related objects. The potential advantage here is a bounded, reusable index
that an MCP client can traverse and aggregate, with fewer live calls. Correctness and total
investigation effort still need an A/B evaluation.

## Use a fair pair

- Use the same reviewed ARC revision, SAP system/client/identity, safety ceiling, memory/CPU
  limits, model, and normal cache mode. Disable graph with `ARC1_GRAPH=off` in the baseline.
- In the graph arm, use the [graph setup](repository-graph.md) and explicitly enable
  `ARC1_GRAPH_TOOLS=true`. Do not give the baseline graph credentials.
- Enable **only one of the two MCP servers** in each fresh chat. Repeat with the identical
  prompt in a new chat using the other server. Do not paste the first answer into the second.
- Keep cold-start and warm-cache measurements separate. For cold local ARC caches, restart
  both instances before the pair; this does not clear SAP or HANA caches. Alternate arm order.
- Do not force the graph arm to use SAPGraph in the main test. Tool selection is part of the
  product's usefulness. A graph-only latency test is a separate engineering measurement.

The examples below were checked against A4H 2023/client 001 on 2026-09-07. They use actual
`ZSSI_*` objects, not invented benchmark names. Other systems need equivalent indexed objects.
The larger SAP-demo soak index is a separate dataset; these prompts do not query it.

Start each chat with this common instruction, followed by one question:

```text
Use only the SAP MCP server enabled for this comparison. Work read-only on A4H,
client 001. For relationship analysis, limit the scope to ZSSI_IMPORTER,
ZSSI_PLAYGROUND, ZSSI_RAP and ZSSI_SAMPLES. Use at most 20 tool calls and keep
the answer under 500 words. Do not execute tests or change SAP objects.
Distinguish verified facts from hypotheses. Give object names, relation types
and supporting evidence. State coverage, freshness and limits when available;
missing evidence is not proof that a dependency does not exist.
```

## Start with these three questions

### 1. Change impact across packages

```text
We may change ZCL_SSI_ENGINE. Find potentially affected objects through direct
and indirect dependencies, up to three levels. Group them by package, distinguish
direct references from indirect paths, and identify candidate tests to inspect.
Show two concrete dependency chains. Do not claim runtime execution is proven.
```

Why it is promising: one incoming graph traversal can replace several separate investigations.
The graph finds **16 nodes including the engine**, with **38 relation observations**, across
four packages. That is not 38 callers or proof that every affected object has been found.

### 2. Package coupling and separation

```text
Across ZSSI_IMPORTER, ZSSI_PLAYGROUND, ZSSI_RAP and ZSSI_SAMPLES, which package
depends most strongly on which other package? Rank the directional dependencies,
explain exactly what your counts measure, and show two object-level examples for
the strongest pair. Assess what would complicate extracting ZSSI_IMPORTER into
a reusable library. Separate architectural suggestions from observed facts.
```

Why it is promising: this asks for an aggregate view, not just one object's source. Graph counts
are **relation observations**, not distinct object pairs, method calls or runtime frequencies.
For example, `references` and `static_call` can both describe the same object pair. The current
coupling action aggregates the configured index, so filter its returned rows to the requested
packages and report any result-limit truncation.

### 3. Interface contract change

```text
We may change the ZIF_SSI_IMPORTER contract. Find its implementations in the
four packages, then identify potentially affected consumers up to two levels.
Keep implementations separate from objects that merely reference the interface.
Identify a test double and verify one implementation against current source.
```

Why it is promising: typed `implements` edges distinguish implementers from general references.
Seven implementation declarations were verified in live source. Static relations still cannot
identify every dynamically selected implementation at runtime.

## Additional useful questions

### 4. Explain a connection between two distant objects

```text
Is there a directed dependency path of at most three steps from
ZCL_SSI_IMPORT_ACTION to ZCL_SSI_ENGINE? Show the shortest path you can establish,
label each relation, and verify it against current source. Explain why this path
does or does not prove that the engine always executes when the action runs.
Do not use package membership as a dependency step.
```

Verified static path: `ZCL_SSI_IMPORT_ACTION → ZCL_SSI_IMPORT → ZCL_SSI_FACTORY →
ZCL_SSI_ENGINE`. The factory also dynamically instantiates a registered class; therefore this
static path is not a guarantee of runtime execution. The graph has no per-edge source lines, so
the live source step matters.

### 5. Select tests for a parser change

```text
If ZCL_SSI_PARSER changes, which tests or test-like classes in the four packages
should we inspect first? Trace dependencies up to three levels and explain each
candidate's relevance. In particular, investigate ZCL_SSI_SAMPLES_TEST. Verify
test status from source; do not equate a class name containing TEST with coverage.
Do not run the tests.
```

Verified example: `ZCL_SSI_SAMPLES_TEST → ZCL_SSI_SAMPLES → ZCL_SSI_PARSER`.
This supports candidate selection, not proven test coverage or actual runtime usage.

### 6. Understand an unfamiliar subsystem

```text
Give me a concise architectural map starting at ZCL_SSI_IMPORT_ACTION, following
outgoing dependencies up to three levels. Group responsibilities into action
handling, import orchestration, factory/engine, parsing, and shared contracts.
Read only the source needed to justify those labels. Clearly mark unresolved
external objects and explain what the map cannot tell us about dynamic behavior.
```

This tests the useful combination: graph for orientation, live SAPRead/SAPContext for meaning.
Do not infer detailed behavior from names or turn metadata search into a semantic-search claim.

## Controls: places the graph should not win automatically

Run these in both arms as well. A useful graph feature must know when to use live tools.

```text
Explain how ZCL_SSI_FACTORY.GET_IMPORTER chooses an importer today, including
dynamic class selection, fallback behavior and exception handling. Ground the
answer in current source. Can a static dependency map enumerate every possible
runtime implementation? Explain the limitation.
```

```text
Read CL_DEMO_OUTPUT.WRITE and explain its current method signature and behavior.
This source-reading question is outside the ZSSI package scope. If an index does
not contain this class, continue using live SAP rather than declaring it absent.
```

```text
Find the current source of ZCL_SSI_FACTORY and list its public methods. Keep the
answer short; do not perform dependency analysis unless necessary.
```

The first control is important: the current collector reports `dynamicTargets=0` for its latest
scope even though live factory source contains dynamic object creation. That counter is **not**
a guarantee that the code has no dynamic dispatch. `CL_DEMO_OUTPUT` was not indexed in this
dataset but its `WRITE` method was readable live in the deployed test.

## Score answers, not just response time

For each prompt/arm record:

| Measure | What to record |
|---|---|
| Correctness | Manually verified objects/edges, wrong relations, unsupported runtime claims |
| Useful coverage | Required facts found within the declared scope; unresolved or missing facts |
| Effort | End-to-end time, MCP tool calls, actual SAP requests, model tokens when available |
| Honesty | Freshness/partial index/truncation disclosed; no “safe to delete” from missing edges |
| Usability | Did the assistant pick appropriate tools without tool-specific coaching? |

Live where-used results can contain package/class/method tree containers; their row count is
not directly comparable to graph node or observation counts. Do not publish a speedup based on
two queries with different meanings. Run each prompt at least three times per arm with the same
model and settings before drawing a conclusion. A maintainer review should decide whether the
saved effort is worth ongoing collection, database and parser maintenance.

## Boundaries

- The dataset is partial: the latest collection had 122 fully parsed sources, two partial parses
  and one failure, as of 2026-09-07 12:20:32 UTC. This is not a whole-system ABAP index.
- Traversals are bounded to three hops, 100 nodes and 300 observations. An untruncated response
  is still only complete relative to that indexed traversal scope.
- No source is stored in the graph. No embeddings, AI Core, semantic RAG, runtime trace or
  business-data analysis is involved. Normal ARC source reads/caches remain separate.
- This shared metadata audience is authorized only for the owner's trial test. It is not a
  model for serving users with different or unknown SAP object visibility.
- Client connection formats differ. Localhost endpoints work with local desktop MCP clients,
  not cloud-hosted connectors without an explicitly secured remote deployment.

## First guided pilot: findings and known gaps

All nine scenarios were exercised against both instances on 2026-09-07. This was a guided
investigation with prior knowledge and warm caches, **not a blind LLM A/B benchmark**.
Package coupling was the clearest additional capability. Both approaches found seven interface
implementers, and the three live-source controls returned matching evidence without graph calls.

Two important caveats for your own comparison:

- The current collector reads class `/source/main`, not all includes. Live where-used and the
  `implementations` include confirmed `ZBP_SSI_R_IMPRUN → ZCL_SSI_IMPORT`, but the graph held
  only package membership for that behavior pool. Graph impact is therefore incomplete even
  for some indexed classes. Inspect RAP handlers/local/test includes live when relevant.
- Normal `SAPContext` can reuse a previously cached deeper result after depth/maxDeps are
  reduced. This is separate from SAPGraph. Restart both comparison containers between
  independent scenarios; a fresh chat alone does not reset their server caches. This does
  not invalidate source reads, but it prevents treating these pilot timings as a fair speedup.

Both deployments remain unchanged; these findings are open. The experimental graph must
remain an aid to investigation, not a sole authority for change safety or test completeness.
