# Guided pilot: live ARC-1 versus graph-enabled ARC-1

2026-09-07, 21:00–21:11 UTC. Experimental PR #756; no merge or SAP mutations.

## Verdict

The graph is useful for **package coupling and compact relationship navigation**, but this
pilot does not justify replacing normal ARC retrieval or relying on graph impact alone.
Live where-used found a real RAP behavior-handler dependency missing from the graph. Ordinary
source questions worked equally well with live tools in both arms.

This is an investigator-led pilot of all nine prepared scenarios, **not a blind LLM A/B study**.
One assistant selected and interpreted calls with prior knowledge of the fixture. No independent
model sessions, repeated answer scoring, model token measurements or maintenance ROI were tested.

## Setup and measurement

The [matched pair](2026-09-07-graph-ab-comparison.md) was unchanged: local Docker ports 8181/8182,
same read-only SAP identity, image revision `0bdc0c677818a0b26b32af6237433872b3c04338`, normal
memory cache, and existing BTP HANA graph API. No BTP resources or paid capacity were added.
The ABAP explanation workflow used method listings, targeted source and normal `SAPContext`;
the baseline was not restricted to raw source reads. No ABAP tests were executed.

Index key `A4H-2023-001`, audience `trial`, generation 211, as of
`2026-09-07T12:20:32.454Z`: 122 parsed, two partial and one failed source. The graph was roughly
nine hours behind the live reads. Its `hasMore=false` does not make the underlying index complete.

The external operator directory `/Users/marianzeis/DEV/arc1-graph-comparison` contains
`pilot-call.mjs`, `pilot-calls.jsonl`, `summarize-pilot.mjs` and `pilot-summary.json`.
The journal saves arguments, timing, counters, response size and SHA-256—not source bodies or
credentials. The summary validator checks all eighteen scenario/arm combinations, the 20-call
budget, MCP error flags, graph-only SAP traffic and matching control-response hashes.

94 scenario calls completed without MCP tool errors; some successful `SAPContext` responses
explicitly contained failed dependency reads. Ten graph-only calls, including readiness and a
follow-up, caused zero SAP HTTP-request events. All eight matched P7–P9 response hashes agreed.

### Observed effort—not a speedup benchmark

Each cell is **MCP calls / SAP HTTP requests**. Counts describe the actual chosen workflow, not
the minimum work required for an equivalent answer. The graph arm includes its live checks.

| Scenario | Live | Graph-enabled | Interpretation |
|---|---:|---:|---|
| P1 Engine impact | 12 / 14 | 4 / 4 | Graph compact; live found an additional verified RAP dependency |
| P2 Package coupling | 6 / 22 | 3 / 1 | Live sampled packages/contracts; only graph produced an indexed aggregate ranking |
| P3 Interface change | 17 / 18 | 3 / 1 | Both found seven implementers; baseline verified all seven, graph arm one |
| P4 Directed path | 4 / 73 | 4 / 4 | Broad live context over-fetched; a targeted live strategy could cost much less |
| P5 Parser tests | 7 / 8 | 7 / 7 | Similar selected-test evidence; graph also supplied broader candidates |
| P6 Architecture | 5 / 6 | 6 / 28 | Unequal context caches invalidate timing/traffic comparison; see cache finding |
| P7 Factory behavior | 3 / 9 | 3 / 8 | Same source-grounded answer, no graph needed |
| P8 Unindexed SAP class | 4 / 8 | 4 / 8 | Same live method source and explanation, no graph needed |
| P9 Public methods | 1 / 1 | 1 / 1 | Identical short answer with one live read |

No cache resets were performed between scenarios. Discovery/ETag checks can make one SAPRead
produce more than one SAP request. Some opposite-arm calls overlapped against the same SAP
system. Tool durations exclude MCP initialization, model reasoning, collection and database
maintenance. Returned characters are not model tokens. Do not sum these rows into an ROI claim.
P2 did not exhaust the 20-call allowance or establish that a live ranking was impossible.

## Answers and findings by scenario

Abbreviated class names below use the `ZCL_SSI_` prefix unless written in full. Package names
use `ZSSI_`. All relations are potential static dependencies, not runtime execution evidence.

### P1 — Engine change impact

Graph returned 16 nodes including ENGINE and 38 observations across four packages. The live
where-used investigation established the same set plus `ZBP_SSI_R_IMPRUN`:

- IMPORTER: ENGINE (root), FACTORY, IMPORT, IMPORT_ACTION, UNIT, UNIT_HOOKS, UT_ENG.
- PLAYGROUND: ADP_RUN, GEN_TEST, ROBUST, RUN, SMOKE, UNIT_ENG.
- RAP: RUNNER; additionally `ZBP_SSI_R_IMPRUN` from live where-used and implementation source.
- SAMPLES: SAMPLES, SAMPLES_TEST.

Two established chains are `IMPORT_ACTION → IMPORT → FACTORY → ENGINE` and
`SAMPLES_TEST → SAMPLES → FACTORY → ENGINE`. The factory-to-engine step is a construction/type
reference, not a static method call. UNIT also has a direct `INSTANCE OF zcl_ssi_engine` check.
UNIT and SAMPLES_TEST were verified as ABAP Unit classes; other test-like names remain
candidates unless inspected. The graph's shorter investigation missed the RAP handler below.

### P2 — Package coupling

Indexed directional observations rank as follows:

| From | To | Observations |
|---|---|---:|
| ZSSI_PLAYGROUND | ZSSI_IMPORTER | 53 |
| ZSSI_SAMPLES | ZSSI_IMPORTER | 16 |
| ZSSI_PLAYGROUND | ZSSI_RAP | 7 |
| ZSSI_RAP | ZSSI_IMPORTER | 3 |

ADP_RUN references/calls FACTORY for registration and IMPORT for file import; current source
confirmed both examples for the strongest pair. Counts can include `references` and
`static_call` for the same object pair. They are neither distinct callers nor runtime frequency,
and the missing RAP relationship makes the ranking explicitly index-relative.

The live arm read all four package inventories plus two dependency contexts. This established
examples but not a complete directional ranking. The graph's aggregate is the clearest added
capability. For library extraction, review shared interfaces/types, generated adapter contracts,
registration and test/demo dependencies; these are review recommendations, not proof that any
particular object must move or that the current package boundary is wrong.

### P3 — Importer interface change

Both approaches found seven implementers of `ZIF_SSI_IMPORTER`: ENGINE, IMPORTER_DOUBLE,
ADP_DR, ADP_DR_G, ADP_ORD, ADP_ORD_G and ADP_UPS_G. Live source declarations confirmed them.
The graph classified `implements` directly; native where-used already exposed the seven
classes and interface-qualified methods. Do not claim the graph uniquely discovered them.

The two-hop graph has 16 nodes including the interface. Consumers/candidates include FACTORY,
IMPORT, SAMPLES, UNIT, UNIT_HOOKS, ADP_RUN, GEN_TEST and SAMPLES_TEST. IMPORTER_DOUBLE is the
record/replay test double, with configurable results and call-count inspection. Dynamic class
registrations are not exhaustively enumerated by these static edges. The call-count difference
is inflated by verifying seven declarations in the live arm versus one in the graph workflow.

### P4 — Action-to-engine path

The graph established the three-edge directed path
`IMPORT_ACTION → IMPORT → FACTORY → ENGINE`, without package-membership steps. Live source
confirmed EXECUTE calls IMPORT_FILE, IMPORT_ROWS calls GET_IMPORTER, and the factory constructs
ENGINE when no adapter is registered. This is the shortest path returned within the indexed
three-hop scope, not proof that no shorter unindexed path exists.

The action does not necessarily execute ENGINE: a registered adapter is dynamically selected,
and earlier validation/parsing can return first. Both arms reached that conclusion. A single
live depth-three context request made 70 SAP requests and returned 93,709 characters, including
31 failed dependency reads. This demonstrates broad-context fan-out, not unavoidable live cost.

### P5 — Parser-change tests

Prioritize UNIT_NUM for coercion cases (currency formats, negative numbers, grouping, invalid
input and scientific notation); UNIT_TPL parses generated XLSX output; SAMPLES_TEST contains
PARSE_CSV and COERCE tests. All three were verified as `FOR TESTING` classes, not inferred
from names. SAMPLES_TEST.PARSE_CSV asserts two rows from SAMPLES.SAMPLE_PARSE_CSV, whose
current source calls PARSER.PARSE_CSV: a verified two-hop chain.

The graph additionally broadens candidates through import/util/factory dependencies. This is
test selection, not proven coverage or a test pass. The live pilot followed selected relevant
branches, not every branch out to three hops. No test was executed.

### P6 — Architectural orientation

Source-supported responsibilities: IMPORT_ACTION translates RAP action keys/parameters and
correlates results; IMPORT validates hooks/content, selects CSV/XLSX parsing and orchestrates
row import; FACTORY chooses the importer; ENGINE implements the importer contract; PARSER
provides parsing/coercion; `ZIF_SSI_TYPES`, `ZIF_SSI_IMPORTER` and `ZIF_SSI_HOOKS` hold contracts.

The graph offered a compact map with unresolved external targets, for example
`CL_WEB_HTTP_UTILITY`, `CL_ABAP_CONV_CODEPAGE` and XCO names. Unresolved means not resolved
in this index, not absent from SAP. Normal SAPContext also provided useful contracts. Neither
map determines runtime registrations or guarantees transaction behavior. This scenario gives
no clean efficiency winner because the live arm reused a deeper context cache entry.

### P7–P9 — Live-source controls

- GET_IMPORTER uppercases the entity key, looks in its registry, dynamically creates and casts
  a registered class, and returns it. Creation/cast failure sets `ev_setup_error` and leaves the
  result unbound; it **does not** silently fall back. Only an unregistered entity gets ENGINE.
  Other exceptions can propagate from the factory; the import facade has a broader catch.
  A static map cannot enumerate every runtime registration.
- `CL_DEMO_OUTPUT.WRITE` has required `DATA TYPE ANY` plus optional string NAME, EXCLUDE and
  INCLUDE. It forwards these to EXEC_WRITE using the static stream/mode. The helper selects
  text/data handling by type and mode, with a complex-to-JSON branch for certain output modes.
  WRITE itself is not DISPLAY. Its current source remained available despite absence from
  this graph dataset.
- FACTORY has two public class methods: REGISTER and GET_IMPORTER. Both arms answered with
  one SAPRead method listing; invoking graph would add no useful information.

## Confirmed gaps and acceptance tests to add

### 1. Graph excludes important class includes — blocking for broad impact claims

Live where-used for IMPORT returns `ZBP_SSI_R_IMPRUN`. Reading its `implementations` include
finds `lhc_importrun=>importfile`, line 27, calling `zcl_ssi_import=>import_file`.
Graph outgoing neighbors for that indexed class returns **only package membership**.

Code inspection explains the structural gap: `services/repository-graph/src/sources.ts`
constructs only `/source/main`; `src/collector/live-collector.ts` performs one such source read
per discovered object. Behavior-handler implementations and other class includes are not
collected. Source history at collection time was not reconstructed, but the current collector
cannot discover this current edge simply by refreshing the same main-only scope.

Before broader use, test main/local definitions/local implementations/test includes; associate
each observation with its real source resource, handle partial reads and stale-edge removal
per include, and confirm refresh restores this handler-to-import edge. Coverage must disclose
omitted includes. Keep this open rather than treating parser success as whole-object coverage.

### 2. A live where-used result also omitted a verified direct reference

The ENGINE usage response did not list UNIT's direct `INSTANCE OF zcl_ssi_engine` references;
source confirmed those checks at lines 219/228. Graph recorded UNIT → ENGINE. Live traversal
still found UNIT via FACTORY. This does not establish a universal SAP where-used defect;
record relation kind, request/filter and native tree semantics when evaluating recall.
Neither result set is a complete ground truth by itself.

### 3. Normal SAPContext cache ignores requested depth/maxDeps

After the live arm's depth-three/maxDeps-eight request, depth-two/maxDeps-four returned its
cached 36 resolved/31 failed dependencies. Independently, after the graph arm cached depth
two/maxDeps four (14 resolved/six failed), a follow-up asking depth one/maxDeps one returned
that same larger payload. `src/handlers/context.ts` calls `getCachedDepGraph(source)` before
using the requested options; `src/cache/caching-layer.ts` keys that lookup by source hash.

This is normal ARC context caching, not the optional graph backend. Add regression tests for
decreasing and increasing depth/maxDeps in both orders, then ensure cache identity includes
the context-shaping inputs without weakening existing identity/isolation controls. Until fixed,
restart **both** containers between independent scenarios and keep cold/warm protocols explicit.
This pilot did not modify the cache implementation.

### 4. Dynamic-target coverage is narrower than its name suggests

The graph reports `dynamicTargets=0` while factory source contains dynamic CREATE OBJECT.
Inspection of `src/collector/abap-extractor.ts` shows counting for dynamic function calls and
dynamic SQL sources, but no equivalent object-creation count. Test dynamic CREATE OBJECT and
dynamic method dispatch; either account for them or label precisely which constructs the
counter covers. Zero must not be presented as absence of dynamic behavior.

## Next evaluation gate

The pair is usable for the owner's manual comparison now, with these limitations disclosed.
Keep graph opt-in and experimental. Resolve/include these four regression cases before claiming
reliable broad impact coverage; do not expand maintained infrastructure on this evidence alone.
Then run the prepared prompts in fresh isolated chats, at least three repeats per arm, same
model/settings, alternating order. Preserve both correctness failures and tool-selection behavior.
The blind answer-quality and maintenance-value gate remains open.
