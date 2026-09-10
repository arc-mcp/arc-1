# Live relationships: implementation verification

Date: 2026-09-08. Base: main `b70c3c457210e1e08ec819e46e0d8d3ffcee182a`.
Feature: [implementation plan](../plans/live-relationships.md);
operator contract: [experimental live relations](../../docs_page/live-relations.md).

Follow-up: the [external review verification](2026-09-08-pr769-external-review.md) records later
namespace/auth-recovery corrections, repaired live cache tests, both-mode schema parity, and the
updated verification counts. The initial evidence below is historical, not an attestation of those
later fixes.

## Selected implementation

Ship an aggregate-context cache correction and an optional native relation action, not the
database graph experiment. Normal memory/SQLite source caching remains; the root-hash aggregate
shortcut no longer serves or stores dependency contracts. No persistent relationship state,
new database dependency, BTP service, or SAP write was introduced.

All default tool-definition snapshots remain unchanged. Enabling the feature adds one action
to SAPNavigate only when exact discovery evidence exists. Runtime calls are independently gated
by config, mode, read scope, deny actions and the selected SAP identity. No new role is needed.

## Plan review and changes driven by testing

- Reproduced option contamination and stale contracts when only a dependency changes. Real
  handler regression tests cover memory and SQLite, both option orders, retained ETag/304
  reads, legacy records, 403/404 and per-user dependency cache bypass.
- Native “exists=true” does not prove root existence. Independently read CLAS/INTF root metadata;
  require matching active identity and requested ENV/WUL context. Reject arbitrary expansion URIs,
  malformed XML, entities, excessive nesting/records and conflicting object identities.
- Logical calls undercount SAP sends. Count at direct/proxy transport sends; CSRF/retries share
  the request-local allowance and automatic redirects are disabled for this scope.
- Final independent review found another hidden send: Undici Fetch retries HTTP 421 internally.
  A loopback reproduction against the shipping client measured GET: 1 charged / 2 sends, and POST:
  2 charged / 3 sends. The corrective pass moved direct accounting below Fetch to its dispatcher;
  exhausted replays are now refused before sending, while allowed replays are counted correctly.
- Real proxy tests exposed asynchronous Undici teardown errors when discarding CSRF GET bodies.
  The control-response owner now observes the expected abort event and destroys its dedicated
  transport without buffering the body. Direct and proxy never-ending-body tests pass.
- Error-body caps and retry exhaustion must not turn an observed 401/403 into partial success.
  Preserve request-local authorization-failure evidence across response/retry limits.
- Restrict the XML tag scan to characters other than `<`/`>` so repeated opening delimiters
  cannot trigger quadratic scanning. The million-delimiter negative test completes and rejects.
  Reject comments, CDATA and custom processing instructions so apparent closing tags inside them
  cannot hide excessive actual nesting. All three spoofing cases reject; the XML declaration works.
- Prioritize same-package neighbors within breadth-first traversal. In the trial this spent the
  fixed eight-expansion budget on more application relationships than URI-only ordering.
  This is a relevance heuristic; coverage still remains unknown.

## Shipping-code live smoke (not prototype results)

Separate built ARC-1 stdio MCP processes, read-only SAP_BASIS 758 / client 001. Existing Docker
comparison instances were not restarted. TLS verification remained enabled; no source collection,
SQL, SAP mutations, BTP provisioning or paid resources. Final corrective smoke: 11:37 UTC.

| Root / direction / depth | Nodes | Edges | Expansions | SAP sends | Successful metadata bytes | Analysis time |
|---|---:|---:|---:|---:|---:|---:|
| ZCL_SSI_FACTORY / outgoing / 1 | 6 | 5 | 1 | 4 | 312,729 | 1.43 s |
| ZCL_SSI_ENGINE / incoming / 3 | 17 | 20 | 7 | 8 | 34,642 | 3.68 s |
| ZCL_SSI_IMPORT_ACTION / outgoing / 3 | 50 | 71 | 8 | 9 | 74,188 | 3.50 s |
| ZIF_SSI_IMPORTER / incoming / 1 | 11 | 10 | 1 | 2 | 10,629 | 0.66 s |
| ZCL_SSI_IMPORT_ACTION / outgoing / 3, maxResults=5 | 5 | 7 | 4 | 5 | 32,650 | 1.46 s |

The 50-node case reported `truncated=true`, reason `expansions`; the five-node case reported
reason `nodes`. Other cases stayed within their requested scopes, not complete SAP-wide coverage.
The first request includes lazy discovery and CSRF bootstrap; later requests reuse ordinary
capability evidence and the session, **not graph results**. Timings are single-run observations,
not latency guarantees or fair old/new performance comparisons.

The smoke also verified: disabled action absent from tools/list; guessed disabled invocation
rejected; nonexistent root rejected; enabled action present after background discovery. The
smoke asserts counts/limits and metadata semantics, not an LLM's ability to reason correctly.

A separate live SAPContext check against the shipping handler used the same root and two dependency
contracts across cold/warm/warm-repeat requests. Cold dependency bodies totaled 15,737 bytes; each
warm request revalidated both dependencies with `304`, transferring zero source-body bytes. All
three context outputs had the same SHA-256. No aggregate record was stored. This confirms source
caching remains useful; it does not claim zero SAP requests on warm calls.

## Automated verification

- Full unit suite after corrective review: **5,897 tests / 199 files passed**.
- Focused relation protocol/traversal/dispatch/transport suite: **111 tests passed**.
- Typecheck (runtime, scripts, tests), production build, lint, policy validation and strict MkDocs
  build passed. Existing Biome configuration-deprecation and MkDocs upstream notices are unrelated.
- Nine existing tool-definition snapshots remain byte-identical; all-gates schema key/type parity
  includes the opt-in fields. Process-wide analysis admission and separate SAP semaphore tested.
- Fault coverage includes cycles/diamonds, dense/high-fanout graphs, node/edge/expansion/send/byte
  limits, queued deadline, stalled body, cancellation, 401/403/missing roots and isolated clients.
  Real-loopback dispatch tests also combine a successful expansion, 401/403 and an oversized error
  body: both remain terminal tool errors, not partial graphs.

Final review covered all 20 source-inventory files plus changed tests, scripts and documentation.
The reproduced 421 issue was assessed as a bounded accounting defect, not an established exploitable
vulnerability, and fixed regardless. The subsequent narrow corrective diff was reviewed and retested;
the earlier immutable scan does not attest to later commits. No unresolved code issue was identified
in this review. The deployment/release and measurement gaps below remain explicit.

## Repeat safely

Build the repository and set `TEST_SAP_URL`, `TEST_SAP_USER`, `TEST_SAP_PASSWORD`, `TEST_SAP_CLIENT`
in the process environment. Do not put credentials in command arguments or commit a local env file.
Set `TEST_RELATION_CASES` to a JSON array of 1–8 valid relations arguments (same schema as the tool),
then run `npx tsx scripts/smoke-live-relations.ts`. The script starts and closes its own read-only
stdio instances, checks default-off behavior, runs the cases, and checks a deliberately missing root.
It does not alter an existing deployment or create SAP fixtures.

## Remaining evidence limits

- Live BTP Cloud Foundry/Cloud Connector principal propagation and other SAP releases were **not**
  revalidated for this feature. Real local HTTP proxy-protocol tests and independent-client tests
  cover transport mechanics and isolation, not deployed SAP role mappings or CC allowlists.
- Normal Destination Service identity setup and startup feature probes happen before/outside the
  analysis budget. There is no claim of a 15-second cap on the complete MCP/identity handshake.
- Bounds limit work/retained metadata; exact peak RSS and long-running production load were not
  measured. No storage-capacity estimate is needed for a request-local graph, but normal source
  caching and audit retention keep their existing operational footprint.
- Native coverage is incomplete. No safe-to-delete, complete transitive impact, precise call-graph,
  cross-version consistency, or retrieval-quality claim is made.
