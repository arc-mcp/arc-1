# Optional repository graph — implementation and acceptance plan

2026-09-06. Base: current ARC-1 main (`38910bbf`). Delivery: one ARC-1 PR; the existing
standalone collector/PostgreSQL project remains independently built in its own repository.
This is an experimental, single-system, explicitly shared-metadata integration, not a
production replacement for SAP authorization or live where-used.

## Research and plan review

The local collector already passes 80 unit tests and two read-only 125-object SAP refreshes.
122 sources parsed, three reported incomplete; last-good preservation has a nonempty-edge
database regression. Live failure preservation alone was vacuous (the three objects had no
previous edges). A 100k-node / 1m-observation synthetic benchmark is sizing evidence, not an
accuracy claim. The old plugin experiment demonstrated SAP-preflight coupling, global-registry
coupling and absence from hyperfocused mode. These drive the native adapter boundary.

Current main already removed warmup and made createServer options object-based. It also has
experimental multi-target routing: graph will remain unavailable there until target/audience
mapping has its own review. Do not port the old checkout's server edits or rewrite plugins.

The [MCP tools contract](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
supports object-root schemas and list-change notifications. A
[CF user-provided binding](https://docs.cloudfoundry.org/devguide/services/user-provided.html)
can carry the same connection contract as a local file. No new SAP role is necessary, but the
administrator must explicitly declare a common metadata audience; an arbitrary SAP login does
not imply authorization to the shared index. Source reads remain per-user SAP operations.

## Implementation sequence

1. Repair the separate API before connecting core: typed v2, scoped credentials, honest
   collection coverage/freshness, bare/slash identity resolution without ambiguous merging,
   search limit+1, start status, closed bounded subgraphs, compact edge endpoints and safe errors.
   Keep v1 only for the old local comparison harness; the native adapter must never fall back.
2. Add an optional, instance-owned HTTP adapter to ARC. One connection file or explicitly
   selected CF binding; default off with no graph requests/timers. Bounded fixed-origin HTTP,
   no redirects, response/schema/system validation, independent key, cancellation, concurrency
   and byte limits. No database driver, source collector, SAP credential forwarding or cache.
3. Add SAPGraph search/neighbors/impact/path/package_coupling and a diagnostic status action;
   hyperfocused SAP(action=graph, params=...) shares the same dispatcher. Common gates precede
   external calls. Graph bypasses only SAP-specific preflight/PP minting, not HTTP authentication
   or explicit strict-JWT requirements. Late availability and recovery require no restart;
   reconnect is the fallback for clients ignoring list-change notifications.
4. Document setup, audience restrictions, results and remaining production gates. Run both
   unit suites, actual MCP and CLI exchanges, read-only live collection/query checks and all
   ARC build/type/lint/policy/size gates. Review the diff against security invariants I1–I7,
   fix findings, rerun affected tests and finally push a new PR without unrelated files.

## Acceptance matrix

| Area | Required evidence |
|---|---|
| Default off | Existing tool snapshots unchanged; no graph fetch/timer/binding reads |
| Configuration | File/binding precedence, explicit disable, malformed/ambiguous settings fail graph closed, no key in diagnostics |
| Authorization | Existing read scope; deny whole tool/sub-action/wrapper; strict JWT; no SAP PP request or token forwarding |
| Isolation | Separate runtimes; configured system enforced in request and response; no multi-target support |
| Network | Redirect, 401 HTML, wrong version/system, malformed JSON, excessive/slow body, cancellation, concurrency |
| Lifecycle | Down startup hidden; late ready listed; outage/recovery; no result cache; stopped runtime has no timers |
| Query truth | Missing != no edges; slash aliases; ambiguous identity stays ambiguous; index partial != response truncation; node closure |
| Integration | Real SDK list/call in standard and hyperfocused modes; CLI without SAP; local PG and read-only SAP evidence |
| Release | Full unit/typecheck/lint/build/policy/size checks; sanitized owned-files-only diff; new PR |

## Explicit later gates (not claimed by this PR)

Durable distributed collection leases/resume/deletion, complete semantic ABAP analysis (includes,
macros, SQL writes, dynamic calls), manual 50-object/100-edge precision/recall oracle, 30-question
comparative study, automatic metadata enrichment/identity consolidation, restricted-user
audiences, HANA contract parity, CF deployment/internal-route smoke and one-command installer.
No new paid/free-tier service provisioning or cloud redeploy is necessary for this local release.
CF tasks inherit parent bindings: future API and collector need distinct app identities.

## Execution record

Implementation and final measurements are recorded in the accompanying results document.
