# Roadmap audit — 2026-09-18

This is the evidence record for the 2026-09-18 rewrite of
[`docs_page/roadmap.md`](../../docs_page/roadmap.md). It is not a second roadmap or a changelog.

The audit checked every item that the old roadmap still presented as open against the current
source, tests, documentation, plans, issue/PR state, and—where relevant—the current MCP
authorization specification. Completed, rejected, empty, and fully subsumed entries were removed
from the roadmap instead of being retained as historical clutter.

Baseline: `7a0016e9` (ARC-1 1.3.0). SAP endpoint conclusions use the repository's existing live
research and fixtures; this documentation audit did not run new SAP write probes.

## Decision rules

- **Keep** only a distinct outcome that is not implemented today.
- **Reframe** a partially delivered umbrella item around its remaining gap.
- **Remove — delivered** when the repository already provides the promised outcome.
- **Remove — subsumed** when another retained item contains the only remaining useful work.
- **Remove — rejected/non-actionable** when the entry has no credible product outcome or conflicts
  with the project's boundaries.
- Re-estimate effort end to end, including research, tests, documentation, live verification, and
  cross-repository review—not just typing the implementation.

## Retained and reframed items

| Previous item | Audit decision and evidence | New classification |
|---|---|---|
| DOC-02 Basis Admin Handbook | **Keep, narrow to a Basis-first handbook/index.** Deployment, XSUAA, principal propagation, Cloud Connector, certificate, and administration facts already exist across `docs_page/`; the missing value is role-oriented consolidation and an independent Basis review, not another runbook. | P2 / M / Documentation / Ready |
| ARCH-01 Discovery-driven Endpoint Routing | **Keep.** Discovery and feature gates exist, but source/object routing is not generally derived through a shared resolver. The existing implementation plan still describes a concrete residual gap. The former PR-ε acceptance criterion is folded into this item. | P1 / M / Architecture / Ready |
| SEC-15 Durable DCR Signing Key | **Keep, reduce urgency.** `ARC1_DCR_SIGNING_SECRET` supports operator-managed stability, while automatic storage and rotation remain unsolved. CIMD may reduce DCR use, so deployment demand and rotation semantics should be re-evaluated before implementation. | P2 / L / Auth & Operations / Needs research |
| FEAT-69 Mass Syntax Check | **Keep.** [`src/adt/devtools.ts`](../../src/adt/devtools.ts) still performs a scalar syntax check. ATC object sets are heavier and do not replace a bounded batch of direct syntax checks. | P2 / S / Diagnostics / Ready |
| FEAT-21 ABAP F1 Documentation | **Keep, lower priority.** No implementation was found. Historic endpoint fragility means the value should be proven on multiple releases before exposing another action. | P3 / S / Developer workflow / Needs research |
| FEAT-23 GetProgFullCode | **Keep, narrow to program include expansion.** `expand_includes` in [`src/handlers/read.ts`](../../src/handlers/read.ts) is FUGR-only. [`src/context/deps.ts`](../../src/context/deps.ts) extracts class/type/function dependencies, but does not traverse program `INCLUDE` statements. Manual reads are a workaround, not the promised single-call outcome. Add this to the existing read tool with traversal limits. | P2 / M / Developer workflow / Needs research |
| FEAT-70 Table Technical Settings | **Keep, exclude already-supported source annotations.** TABL DDL can carry delivery class, but data class, size category, buffering, and storage type belong to a separate technical-settings object. [SAP's database-table guide](https://learning.sap.com/courses/building-data-models-with-the-abap-dictionary-and-abap-core-data-services/creating-database-tables_ebc1477d-96ed-414b-82d4-4171da43f4a6) documents that distinction; ARC-1 has no dedicated read/write lifecycle for it. | P2 / M / Object coverage / Needs research |
| FEAT-32 Table Pagination | **Reframe as stable data-preview pagination.** [`src/adt/table-query.ts`](../../src/adt/table-query.ts) documents that the freestyle endpoint does not support generic `OFFSET`. The credible remaining option is conservative keyset pagination for named tables with a provable unique order. | P3 / M / Data access / Needs research |
| FEAT-42 Additional CI Formats | **Keep only JUnit/Code Climate on demand.** Text, JSON, and Checkstyle are already implemented. New serializers are small but should have a consuming CI platform. | P3 / XS / CI / Revisit on trigger |
| OPS-02 Deep Health Check | **Keep, narrow to bounded readiness.** `/health` is intentionally process liveness; a SAP-dependent check still needs timeout, caching/rate, authentication, and secret-safe error semantics. | P3 / S / Operations / Needs research |
| FEAT-36 Type Information | **Keep blocked.** No reliable ADT endpoint was found on available systems; a local pseudo-compiler would be misleading. | P3 / S / Code intelligence / Blocked |
| COMPAT-06 Proxy Support | **Keep, increase effort.** Direct ADT traffic still lacks consistent `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` handling. Redirect, TLS, OAuth, cookies, and BTP non-interference make this more than a one-line dispatcher change. | P2 / M / Compatibility / Ready |
| FEAT-09 ST05/Cross Trace | **Reframe as Cross Trace result reading.** ST05 control is implemented in [`src/adt/diagnostics.ts`](../../src/adt/diagnostics.ts); Cross Trace result retrieval is the distinct remaining capability and needs real bounded payload evidence. | P2 / M / Diagnostics / Needs research |
| FEAT-03 BAdI Support | **Reframe as authoring.** Enhancement implementation metadata and relations can be read, but creation/editing contracts and activation safety are not established. | P2 / L / ABAP authoring / Needs research |
| FEAT-30 ABAP Cleaner | **Keep parked, increase effort.** The research is useful, but the Java runtime, profile/version management, subprocess sandbox, and diff contract create material support cost beyond existing Pretty Printer and abaplint coverage. | P3 / L / Developer workflow / Revisit on trigger |
| FEAT-34 Translation Support | **Reframe around uncovered translation assets.** Text elements and message-class maintenance now cover the common source-bound cases. OTR, translation status, and language-aware workflows remain unproven. | P3 / L / Localization / Needs research |
| FEAT-22 gCTS/abapGit Integration | **Reframe as safe gCTS mutations.** Read operations and conservative abapGit flows exist. Only customer-backed mutations with verifiable postconditions remain credible roadmap material. | P3 / L / Integration / Needs research |
| FEAT-50 ADT Probe Fixture Coverage | **Keep its original probe-classifier scope.** Recorded type-availability fixture sets from more SAP product lines and authorization setups extend [`tests/unit/probe/replay.test.ts`](../../tests/unit/probe/replay.test.ts). Synthetic branch fixtures already exist; additional real-system evidence complements them. | P3 / XS each / Diagnostics / Contributor-driven |
| SEC-14 DNS Rebinding/Host Header | **Keep only for an exposed self-hosted trigger.** [PR #500](https://github.com/arc-mcp/arc-1/pull/500) was deferred. Mandatory auth and recommended reverse proxies lower urgency, but do not make the hardening universally irrelevant. | P3 / M / Security / Revisit on trigger |
| FEAT-07 Native TLS | **Keep only for a topology that cannot use a proxy.** Platform routers and reverse proxies remain the supported default; direct TLS would also need certificate-chain, encrypted-key, reload, and integration-test support. | P3 / M / Operations / Revisit on trigger |
| FEAT-73 Additional SDO Types | **Keep, split conceptually per type.** [`src/adt/server-driven.ts`](../../src/adt/server-driven.ts) does not register DRTY, DRAS, or DSFI. Each still needs live discovery, media-type, metadata, lifecycle, fixture, and schema-budget evidence. | P3 / M / Object coverage / Blocked |
| FEAT-72 CDS Indexes | **Keep blocked.** Discovery markers exist, but no verified seed object or source/lifecycle contract is available. | P3 / M / Object coverage / Blocked |
| FEAT-66 Destructive Confirmation | **Keep blocked, increase effort.** Core interactive confirmation requires a compatible MCP SDK/client set plus persisted intent, expiry, retry, and idempotency semantics; the prior estimate covered only the prompt surface. | P3 / L / Safety & UX / Blocked |
| FEAT-62 Transaction Source/Write | **Keep blocked.** The expected ADT backend is absent on tested 7.50, 7.58, and 8.16 systems. GUI/RFC fallbacks would violate the project boundary. | P3 / M / Object coverage / Blocked |
| FEAT-71 Dictionary Activation Log | **Keep.** The known resource is not a simple GET feed; live failure traffic is needed to prove the request and result lifecycle. | P3 / M / Diagnostics / Needs research |
| FEAT-59 Multi-Tenant API | **Reframe as an embeddable server API.** Experimental mutation-free multi-target HTTP routing is implemented, but a stable per-tenant library/lifecycle surface is not. It should be driven by a real embedding consumer. | P3 / L / Architecture / Revisit on trigger |
| OPS-05 SAP Cloud Logging | **Reframe to Cloud Logging plus OpenTelemetry.** Structured audit sinks exist; supported telemetry export, service binding, signal selection, and operational guidance do not. | P2 / L / Operations / Revisit on trigger |
| FEAT-05 Refactoring | **Reframe to safe rename/extract.** Package moves are implemented. Rename and extract still need a live SAP contract, preview, collision/impact analysis, activation, and partial-failure behavior. | P3 / L / Developer workflow / Needs research |

## Removed items

| Previous item | Disposition | Evidence and reasoning |
|---|---|---|
| DOC-01 Copilot Studio Setup Guide | **Remove — delivered.** | Copilot/Power Platform OAuth and API-key setup is covered by `docs_page/xsuaa-setup.md`, `docs_page/oauth-jwt-setup.md`, and `docs_page/api-key-setup.md`; the published Copilot Studio article is linked from `README.md` and `docs_page/blog-series.md`. |
| PR-ε Remove Static Release Gates | **Remove — subsumed.** | It had no independent implementation target. Its useful acceptance criterion—prefer discovery where proven—now belongs to ARCH-01. |
| FEAT-18 Function Group Bulk Fetch | **Remove — delivered.** | `SAPRead(type="FUGR", expand_includes=true)` and `getFunctionGroupExpanded()` recursively retrieve function-group includes; handler, tool schema, unit tests, integration coverage, and documentation exist. |
| FEAT-25 CDS Unit Tests | **Remove — delivered.** | The repository includes the first-party `generate-cds-unit-test` skill, CDS test-case suggestions on supported releases, generic ABAP Unit execution, and normal write/activate flows. |
| FEAT-26 MCP Client Config Snippets | **Remove — delivered as documentation.** | Client examples exist for Claude, VS Code/Copilot, Cursor, Agent Plugin, stdio, HTTP, and multi-target deployment. A CLI generator is not needed to satisfy the user outcome. |
| FEAT-27 Migration Analysis | **Remove — delivered.** | First-party `migrate-custom-code`, `sap-migration-dossier`, and `sap-clean-core-atc` skills provide ATC-led migration and clean-core analysis. |
| FEAT-28 SAP Compatibility Hardening | **Remove — non-actionable umbrella.** | It mixed unrelated fixes without a bounded outcome. Many named cases have shipped; future compatibility gaps should enter as evidence-backed standalone items. |
| FEAT-60 CLI/Server Alignment | **Remove — delivered for the supported contract.** | `arc1-cli tools` and generic `call` expose server parity with CI coverage. Shortcut commands are intentionally workflow-specific and should be added only for a concrete use case. |
| DOC-03 SAP Community Blog | **Remove — delivered.** | “ARC-1 with Copilot Studio: SAP System Context Beyond Developers” is listed as published on 2026-05-04 in `docs_page/blog-series.md`. |
| FEAT-06 Cloud Readiness Assessment | **Remove — delivered.** | The clean-core ATC, migration, and dossier skills combine release-aware ATC and API classification into the intended assessment workflow. |
| COMPAT-04 BTP `safeUpdateSource` Omission | **Remove — not a current gap.** | The centralized safe-update path already handles optional transport behavior; the old entry itself recorded that the suspected BTP failure was unproven. |
| OPS-03 Multi-System Routing | **Remove — delivered as the approved experimental scope.** | `ARC1_MULTI_TARGET_ENDPOINTS`, pinned and aggregate routes, immutable destination discovery, ADR-0006/0007, and setup/administration docs implement read-only BTP multi-target v1. Future changes belong to the separate v2 plan, not this completed umbrella. |
| FEAT-29 P3 Feature Backlog | **Remove — split, delivered, or rejected.** | This umbrella mixed deprecated SSE; core ABAP execution/debugging ideas that conflict with the no-installed-ABAP boundary; already available UI5, master-language, unused-code, relation, and package-analysis capabilities; and items duplicated by FEAT-59. Credible future outcomes must be re-added separately with evidence and a resume trigger. |

## New item from closing pull requests

| Item | Decision | Classification |
|---|---|---|
| SEC-16 Client ID Metadata Documents (CIMD / SEP-991) | **Add as one cross-repository parked proposal.** [arc-1 PR #711](https://github.com/arc-mcp/arc-1/pull/711) contains the threat model and design decisions; [arc-1 PR #712](https://github.com/arc-mcp/arc-1/pull/712) contains default-off server wiring; [xsuaa-auth PR #57](https://github.com/arc-mcp/xsuaa-auth/pull/57) contains the SSRF-hardened resolver and cache. The MCP 2026-07-28 authorization specification recommends CIMD and retains DCR for compatibility. Closing the PRs should preserve this evidence, not imply that the feature shipped. Cross-repository security review, dependency release, rebase, proxy/path-prefix testing, and live acceptance justify the XL estimate. | P1 / XL / Auth & Compatibility / Parked proposal |

## Result

- Old roadmap: 41 entries presented as open.
- Removed after verification: 13.
- Retained or narrowed: 28.
- Added: 1 cross-repository CIMD proposal.
- Current roadmap: 29 unfinished ideas and no completed-work section.
