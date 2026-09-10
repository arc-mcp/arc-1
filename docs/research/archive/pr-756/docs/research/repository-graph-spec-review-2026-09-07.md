> Historical research from PR #756; the persistent graph was not merged.
> [Archive status and current direction](../../README.md) take precedence over the dated instructions below.
> Source: [69d7d596](https://github.com/arc-mcp/arc-1/blob/69d7d596f2bee8740d9629e017b58d6deecb192d/docs/research/repository-graph-spec-review-2026-09-07.md).

# Experimental repository graph: specification and documentation review

2026-09-07. Documentation follow-up to PR #756, runtime baseline `ef5f0e26`.
No runtime, database, cloud resource, credential or live SAP change was made in this review.

## Deliverables

- [Detailed specification](../../docs_page/repository-graph-specification.md): component ownership,
  data/retention model, collection and query contracts, scope/auth boundary, internal/Docker/BTP
  profiles, cost/lifecycle, decision register, implementation sequence and acceptance tests.
- [Canonical experimental setup entry](../../docs_page/repository-graph.md): prerequisites and
  backend availability, internal-first connection, optional CF attachment, verification,
  explicit MCP opt-in, troubleshooting and disable.
- General Deployment and BTP Start Here link the optional entry. The normal Quickstart, default
  BTP runbook, runtime configuration and deployment descriptors are unchanged. The configuration
  reference separates native graph settings from the generic extension framework.
- The earlier PoC plan and ADR point to the current specification. Historical results remain
  historical, not newly claimed tests or current installation requirements.

## Findings that changed the specification

| Finding | Code/evidence inspected | Resulting requirement/correction |
|---|---|---|
| Three PoC stages passed, but actual CF ARC apps were not redeployed | Existing 2026-09-07 validation and PR checks | Distinguish native ARC/binding consumer tests from a production ARC deployment |
| Cloud Connector support cannot be inferred from an Internet destination | Backend `src/sap.ts`, `src/destination.ts` resolve URL/header and make direct requests | Explicit on-premise transport/identity gate; collector-only Cloud SDK spike |
| Graph GIN index exists but search uses `ILIKE` | Backend migration and `PgGraphStore.search` | Require actual query-plan/search-semantics benchmark before indexed-text performance claims |
| Source materialization/parser CPU currently unbounded by bytes/time | Backend `SapClient.getText`, live collector and extractor | Streaming byte cap, parser worker/cancellation, run/RSS budgets; retain last-good evidence on limits |
| Discovery cap is applied before supported-type filtering | `discoverLiveObjects` | Partition/paging and cap/starvation cases; do not call it a full inventory |
| Job columns and migration lock are not durable collection leases | Backend migration/import/collector | Fenced single-writer jobs/resume gate; one collector at a time in the PoC |
| Generation-before/after check is not general multi-writer snapshot isolation | Backend `queryV2` and `importGraph` | Repeatable snapshot publication/query design; out-of-order commit and lease tests |
| Coverage is latest scope, not whole graph; observations can be last-good | Backend `coverage`, source-owned replacement | Richer separately versioned coverage contract; no silent v2 field addition |
| Readiness means a generation exists, not necessarily non-empty data | ARC graph runtime | Correct setup availability wording and require a known non-empty acceptance query |
| No-generation retries are 1 second, unlike failed-probe backoff | ARC graph runtime | Correct the existing blanket 2–60 second description |
| Local descriptor example did not match offline fixture | Backend setup fixture and ARC descriptor | Use `TRIAL-2023-001` / `trial`, explicitly replace for live deployments |
| BTP preparation is account-specific and backend is unpublished | Backend CF manifest, package/setup/credential scripts and repository status | Distribution/portable-installer gate; no invented public install command |

No production guarantee was inferred from schema columns, a passing health response, the same CF
space, synthetic sizing, or a successfully authenticated SAP user. HANA/vector parity remains
deferred, not a mandatory gate for the narrow PostgreSQL experiment.

## Source checks

SAP Docs MCP search/fetch worked during this review. Its supported-feature document confirms
container-to-container networking is unsupported on BTP CF. SAP Cloud SDK's official on-premise
and generic HTTP documentation supports the proposed collector-only connectivity spike. Links
are attached to the relevant specification requirements. Existing free-plan evidence remains
dated to the verified 2026-09-07 provisioning; no additional services were created or upgraded.

## Verification

- Focused graph + documentation + BTP profile/descriptor + plugin manifest tests: **134 passed
  across 12 files**, including five new documentation-contract tests.
- Source/scripts/tests typecheck: pass. Repository lint: pass (two pre-existing informational
  Biome configuration/version notices). `git diff --check`: pass.
- MTA validation: base descriptor, standard override, UI override, single-PP and multi-PP profiles pass.
- Strict MkDocs build: pass. Rendered HTML inspected for the Start Here/Deployment links, graph
  setup/specification headings and local/BTP/acceptance/lifecycle anchors.
- New documentation tests parse the actual connection JSON and CLI query examples against runtime
  contracts, check the action table/default bounds, and preserve the default Quickstart boundary.
- Existing PR head's CI was all green, including Node 22/24 unit jobs, documentation, MTA validation,
  policy, CodeQL, live integration and E2E. That is the runtime baseline, not a claim that these
  cloud-backed jobs were rerun by this documentation-only change.

Initial validation caught an indentation error in the new navigation group and an incorrect test
assumption that the optional `DEFAULT_CONFIG.graphTools` property was explicitly `false` rather
than absent (both keep tools disabled; the parser supplies the false default). Both were corrected
and the relevant checks rerun successfully. No runtime behavior was changed to satisfy a doc test.

## Task walkthrough (raw Markdown and generated HTML)

| Starting task | Reviewed route and next step | Outcome |
|---|---|---|
| New ordinary ARC/BTP setup, no graph requested | Existing Deployment/Start Here → canonical ARC runbook | Graph is optional; no PG/service/role prerequisite introduced |
| Existing local backend, internal evaluation | Graph entry → audience → private descriptor → CLI status + known relationship | Tools remain hidden; file permissions and fixture identity explicit |
| Existing BTP ARC, ready graph backend | Start Here task map → graph connection → observed target/services → owned binding configuration | No guessed route, SAP role, MTA ownership, `.env` deployment or backend provisioning |
| No backend artifact | Graph entry → maintainer/version-matched artifact/runbook | Stops honestly; does not imply a released one-command installer |
| SAP accessible only through Cloud Connector | BTP graph warning → specification on-premise gate | Does not copy PP into a headless collector or claim the public-destination test proves support |
| Restricted/unknown metadata audience | Audience safety section → do not enable | No role-expansion workaround or authentication-as-authorization inference |
| No free plan or private-only API requirement | BTP deployment/lifecycle requirements → stop incompatible profile | No paid fallback or fictitious private same-space network |

This is a maintainer walkthrough and automated contract/build verification, not an independent
customer trial or measured human/LLM usability improvement. The specification requires that
separate fresh-reader exercise before publishing a supported installer.
