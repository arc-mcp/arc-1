> Historical research from PR #756; the persistent graph was not merged.
> [Archive status and current direction](../../README.md) take precedence over the dated instructions below.
> Source: [69d7d596](https://github.com/arc-mcp/arc-1/blob/69d7d596f2bee8740d9629e017b58d6deecb192d/docs/research/2026-09-07-graph-ab-comparison.md).

# Live ARC-1 versus graph-enabled ARC-1: running comparison pair

2026-09-07. Experimental PR #756 remains unmerged. This is deployment and deterministic tool
verification evidence, **not a completed LLM answer-quality benchmark**.

Follow-up: the [guided nine-scenario pilot](2026-09-07-graph-guided-pilot.md) records actual
investigations, matching source controls and newly confirmed gaps. It remains distinct from
the fresh-chat repeated A/B evaluation below.

## Deployment decision and boundaries

CF preflight found 3,712/4,096 MiB in use and 10/10 routes. An unmapped SAP-docs route belongs
to another deployment and was deliberately left alone. No CF services, applications, routes,
entitlements or database sizes were changed. The comparison uses two local Docker containers
with the existing BTP HANA graph API; it adds no billed BTP resource.

Operator directory: `/Users/marianzeis/DEV/arc1-graph-comparison` (outside the ARC repository).
Its README covers startup, shutdown, credentials, connection entries and repeat verification.
Private files are 0600 inside a 0700 directory. They are mounted, not copied into image layers
or supplied as command-line secrets. No MCP client configuration was silently changed.

| Arm | Local endpoint | Difference |
|---|---|---|
| `arc1-live-ab` | `http://127.0.0.1:8181/mcp` | `ARC1_GRAPH=off`, no graph credentials |
| `arc1-graph-ab` | `http://127.0.0.1:8182/mcp` | Same live tools plus enabled `SAPGraph` |

Both are built from `0bdc0c677818a0b26b32af6237433872b3c04338`, image
`sha256:d2f6652fff44938132a8b5c973173e28d66447c00a057d77a1c5ef236846b975`, ARC version 1.2.0.
The shared image is 234,824,696 bytes locally. Both have 512 MiB/one CPU ceilings, run as the
same non-root UID, use read-only root filesystems, drop capabilities and bind only loopback.
Immediately after the first verification, Docker reported approximately 87/90 MiB memory
usage; this is an idle observation, not peak sizing or a production minimum.

SAP target is A4H 2023/client 001 at the approved TLS origin `https://a4h.marianzeis.de`.
Credentials were resolved from the existing `ARC_INDEX_SAP_2023` Internet/Basic destination
and snapshotted privately for both containers. Both runtime SAP connections are direct HTTPS;
this comparison is **not** another CC transport test. The existing graph dataset's last refresh
was collected through CC. The BTP graph app is still HANA-backed using its reader binding.

Shared viewer identity and identical memory-cache/safety settings apply to both arms. Writes,
free SQL, business-data preview and plugin execution are disabled. Nine permitted live tools
are listed; graph adds a tenth. Default standard mode has twelve intent tool definitions, but
the authenticated viewer/safety-filtered list is the relevant surface here.

## Verification performed

The external operator harness uses the real MCP SDK over HTTP, not handler-only mocks:

- Both handshakes succeed with distinct server names. Anonymous calls return 401.
- SAPRead SYSTEM results match, as do every non-graph environment setting and every live tool
  definition/schema. The baseline never receives a graph credential.
- Baseline SAPGraph is both unlisted and invocation-blocked; graph-enabled SAPGraph is ready.
- All six graph action families pass, including two directed paths, typed implementers,
  incoming impact and package coupling. Invalid depth 4 is rejected.
- Ten representative graph calls pass. Non-indexed `CL_DEMO_OUTPUT` returns zero nodes with
  `not_indexed`; its WRITE method remains readable using live SAPRead.
- Six live class reads return matching active source through both arms and contain the expected
  relationship targets. Source hashes, not source bodies, are saved in the operator evidence.
- All seven graph-reported ZIF_SSI_IMPORTER implementers were checked for an explicit live
  `INTERFACES zif_ssi_importer.` declaration.
- Live SAPNavigate references works. Its initial response includes class/method/package
  containers, so neither its 13 rows nor its latency is treated as an equivalent graph result.
- Both containers were restarted and the matched-schema/source checks passed again.

The operator harness adds identical, test-only SAP-request metrics in both arms by observing
the existing audit emitter. It emits only event type, elapsed time and HTTP status; no bodies,
URLs, users or credentials. Core source and HTTP transport are unchanged. This stays outside
ARC's maintained feature code.

Important measurement correction: ordinary stderr omits successful debug-level HTTP audit
events. The first naive log-count check therefore could not establish zero traffic. It was
replaced before acceptance with the explicit metric and a positive live-read control. The final
isolated measurement saw one SAP event for that control and **zero** during twenty sequential
graph-only impact calls. Other tests/clients must not run concurrently during this measurement.

Final query sample at 13:55:30 UTC:

| Query | Samples | p50 | p95 | Range | SAP request events |
|---|---:|---:|---:|---:|---:|
| Engine impact, incoming, depth 3 | 20 | 265 ms | 348 ms | 253–608 ms | 0 |

This includes local MCP plus HTTPS to the US10 graph API and HANA queries. It excludes collection,
LLM reasoning and end-to-end user-answer time. These timings establish feasibility, not a
speedup over a semantically equivalent live investigation. Median/p95 use nearest ranks.

## Prompt anchors verified against the actual dataset

| Question | Verified evidence |
|---|---|
| Engine change impact | 16 nodes including the engine, 38 observations, four packages, no response truncation |
| Importer interface contract | Seven explicit implementers; two-hop incoming impact returns 16 nodes/27 observations |
| Action-to-engine explanation | IMPORT_ACTION → IMPORT → FACTORY → ENGINE, three directed edges |
| Parser-change test selection | SAMPLES_TEST → SAMPLES → PARSER, two directed edges |
| Package coupling | PLAYGROUND → IMPORTER: 53; SAMPLES → IMPORTER: 16; PLAYGROUND → RAP: 7; RAP → IMPORTER: 3 observations |
| Unknown-index control | CL_DEMO_OUTPUT absent from this index but WRITE readable live |
| Static-graph limit | Factory source uses dynamic CREATE OBJECT TYPE (registered class), plus a static engine fallback |

All abbreviated object/package names above have their `ZCL_SSI_`/`ZSSI_` prefixes in the
[copy-paste prompt guide](../../docs_page/repository-graph-comparison.md). Package counts can
count distinct relation kinds on the same object pair; they are not distinct callers.

Current index: logical key `A4H-2023-001`, shared audience `trial`, latest generation 211,
timestamp 2026-09-07 12:20:32.454 UTC, scope `Z*:Z*`, extractor
`transient-source-v2-abap758`, 122 fully parsed sources, two partial parses and one failure.
The earlier collection evidence recorded 282 nodes/715 observations for this HANA key.
The separate larger SOAK and synthetic SCALE datasets were not selected or changed.

The generation's `dynamicTargets=0` does not prove absence of dynamic dispatch: live factory
source shows dynamic object creation. Make this an explicit model-honesty control. Graph edges
still lack per-edge source lines/age, and last-good evidence can predate the latest generation.

## Remaining evaluation—not assumed complete

Use the nine prompts, same model/settings, fresh chats and one enabled server per arm. Repeat
at least three times and alternate arm order. Score verified relationship accuracy, useful
coverage, time, SAP traffic, tool calls/tokens and handling of missing/dynamic evidence. Do not
provide the reviewer notes as answer hints to the model. Keep cold/warm runs separate.

No real multi-user, full-system precision/recall, automated collection refresh, restricted-audience
authorization, managed-service recovery or production-readiness conclusion follows from this
test. The local endpoints need the Mac/Docker; the graph also needs the existing HANA free
instance running. There is no newly installed background scheduler or remote connector route.
