# fr0ster/mcp-abap-adt

> **Repository**: https://github.com/fr0ster/mcp-abap-adt
> **Language**: TypeScript | **License**: MIT | **Stars**: 29
> **Status**: Very Active (v6.5.1, 95+ releases in 5 months, 873+ commits)
> **NPM**: `@mcp-abap-adt/core` — 3,625 monthly downloads
> **Relationship**: Independent TypeScript ADT MCP server with most advanced auth system

---

## Project Overview

A multi-package monorepo MCP server for SAP ADT with ~320 tools organized across 4 exposition tiers (read-only 55, high-level 140, low-level 124, compact 22). v5.0.0 added unified ADT feed tools (SM02 messages, gateway errors, feed reader) and migrated to adt-clients 4.0 factory API. v5.0.7-5.0.8 added 14 activation tools. v5.1.0-5.1.1 added 13 high-level Check handlers (per-type syntax/semantic validation). v5.2.0 added ActivateServiceDefinition/ActivateServiceBinding low-level handlers and replaced `binding_type`/`service_type` with `ServiceBindingVariant` enum. v6.0.0 simplified dump reading (RuntimeListDumps removed — use RuntimeListFeeds with feed_type=dumps) and fixed UpdateInterface on BTP Cloud (corrNr parameter was causing 400 errors when no transport exists). v6.1.0 decoupled RFC connection from legacy system type. Dropped Node 20 support (minimum Node 22). v6.2.x bumped connection/adt-clients deps and added internal debug/trace scripts. v6.3.0 enriched 13 per-type tool descriptions (Class/Program/Table/View/Domain/DataElement/Interface/FunctionModule/BehaviorDefinition/MetadataExtension/ServiceDefinition/ServiceBinding/Structure) with workflow cross-references for RAG ranking. v6.4.0 added per-instance `systemType` option for `EmbeddableMcpServer` (overrides process-global env var). v6.4.1 fixed Dockerfile for HTTP mode + header-based connection. v6.5.0 hardened FM read against group-mismatch silent success (containerRef metadata validation) and added pluggable ReadOnly-vs-HighLevel dedup strategy. Open issue #77 (2026-04-25): UpdateFunctionModule loses parameters — diagnostic probe added, fix not yet shipped. Features the most comprehensive authentication system of any project (9 providers including SAML, OIDC device flow, token exchange). Strict interface isolation via separate npm packages.

Key differentiator: "AI Pairing, Not Vibing (AIPNV)" philosophy — positioned as pair programming assistant, not autopilot.

## Architecture

Multi-package ecosystem with 7+ npm packages under `@mcp-abap-adt` scope:

| Package | Purpose | NPM Monthly |
|---------|---------|-------------|
| `@mcp-abap-adt/core` | Main MCP server, composition root | 3,625 |
| `@mcp-abap-adt/adt-clients` | Builder-first ABAP object CRUD (449 commits in own repo) | 5,074 |
| `@mcp-abap-adt/auth-broker` | Token orchestration (cache → refresh → browser flow) | 1,051 |
| `@mcp-abap-adt/connection` | HTTP transport (CSRF, cookies, sessions) | — |
| `@mcp-abap-adt/logger` | Pino-based structured logging | — |
| `@mcp-abap-adt/configurator` | Auto-config for 11 MCP clients (`mcp-conf` CLI) | — |
| `@mcp-abap-adt/sap-rfc-lite` | Lightweight RFC (replaces archived node-rfc, v4.7.0) | — |

Design principles: Interface-Only Communication (IOC), Dependency Inversion, single composition root.

### Companion Repos
- **fr0ster/mcp-abap-adt-clients** — 449 commits, ADT client library with batch operations, lock registry, WebSocket facade
- **fr0ster/mcp-abap-adt-auth-broker** — JWT authentication broker for multi-destination token management

## Tool Inventory (316 tools across 4 tiers)

### Read-Only Tier (52 tools)
ReadClass, ReadProgram, ReadInterface, ReadDomain, ReadDataElement, ReadStructure, ReadTable, ReadView, ReadFunctionGroup, ReadFunctionModule, ReadBehaviorDefinition, ReadBehaviorImplementation, ReadMetadataExtension, ReadServiceDefinition, ReadServiceBinding, ReadPackage, GetProgFullCode, GetInclude, GetIncludesList, GetPackageContents, SearchObject, GetObjectsByType, GetObjectsList, GetWhereUsed, GetObjectInfo, GetObjectStructure, GetObjectNodeFromCache, GetAbapAST, GetAbapSemanticAnalysis, GetAbapSystemSymbols, GetAdtTypes, GetInactiveObjects, GetSession, GetSqlQuery, GetTransaction, GetTypeInfo, DescribeByList, GetTransport, ListTransports, GetEnhancements, GetEnhancementSpot, GetEnhancementImpl, RuntimeListFeeds, RuntimeGetDumpById, RuntimeListProfilerTraceFiles, RuntimeGetProfilerTraceData, RuntimeAnalyzeProfilerTrace, RuntimeCreateProfilerTraceParameters, RuntimeRunClassWithProfiling, RuntimeRunProgramWithProfiling _(v6.0.0: RuntimeListDumps removed → use RuntimeListFeeds(feed_type='dumps'); RuntimeAnalyzeDump removed)_

### High-Level Tier (140 tools)
Full CRUD with automatic lock/activate for 16+ object types: Classes (including local definitions, types, macros, test classes), Programs, Interfaces, Domains, Data Elements, Structures, Tables, Views (CDS), Function Groups/Modules, Service Definitions/Bindings, Behavior Definitions/Implementations, Metadata Extensions (DDLX), Packages, Transports, Unit Tests (ABAP + CDS). v5.0.7: Added ActivateObjects (group activation) + 12 per-type Activate handlers. v5.1.0: Added 13 per-type Check handlers (CheckClass, CheckProgram, CheckDomain, CheckDataElement, CheckStructure, CheckTable, CheckView, CheckFunctionGroup, CheckFunctionModule, CheckServiceDefinition, CheckBehaviorDefinition, CheckBehaviorImplementation, CheckMetadataExtension) for syntax/semantic validation per object type.

### Low-Level Tier (122 tools)
Fine-grained per-operation-per-object: Lock/Unlock/Check/Activate/Validate/Create/Update/Delete + generic variants

### Compact Tier (22 tools)
Unified by `object_type` parameter: HandlerCreate, HandlerGet, HandlerUpdate, HandlerDelete, HandlerActivate, HandlerLock, HandlerUnlock, HandlerValidate, HandlerCheckRun, HandlerTransportCreate, HandlerUnitTestRun/Status/Result, HandlerCdsUnitTestStatus/Result, HandlerDumpList/View, HandlerProfileList/Run/View, HandlerServiceBindingListTypes/Validate

## Authentication (9 Providers — Most Advanced)

| Provider | Flow |
|----------|------|
| AuthorizationCodeProvider | Browser-based BTP OAuth2 |
| ClientCredentialsProvider | Machine-to-machine |
| DeviceFlowProvider | Devices without browsers |
| OidcBrowserProvider | Generic OIDC browser flow |
| OidcDeviceFlowProvider | OIDC device flow |
| OidcPasswordProvider | OIDC resource owner password |
| OidcTokenExchangeProvider | OIDC token exchange |
| Saml2BearerProvider | SAML2 bearer assertion |
| Saml2PureProvider | Pure SAML2 flow |

### Header-Based Auth Priority
| Priority | Method | Headers |
|----------|--------|---------|
| 4 (highest) | SAP Destination | `x-sap-destination` |
| 3 | MCP Destination + JWT | `x-mcp-destination` + `x-sap-auth-type=jwt` |
| 2 | Direct JWT | `x-sap-jwt-token` |
| 1 | Basic Auth | `x-sap-login` + `x-sap-password` |

### Token Lifecycle
AuthBroker: cache → refresh_token → browser OAuth2 → typed error. Automatic 401/403 retry.

## Safety/Security

- **Exposition control**: Limit active tool tiers (read-only, high-level, low-level, compact)
- **try-finally unlock**: Fixed in v4.5.0 — prevents lock leaks
- **Sensitive data redaction** in logs (Pino)
- **Session isolation**: HTTP/SSE = fresh connections per-request
- **`--unsafe` flag**: Controls file-based vs in-memory session persistence
- **SAP_SYSTEM_TYPE**: On-premise vs cloud tool availability
- **Lock registry**: Persistent `.locks/active-locks.json` with CLI recovery tools
- **No read-only flag or op filtering** like ARC-1 — relies on exposition control only

## Transport (MCP Protocol)

| Transport | Supported |
|-----------|-----------|
| stdio | Yes (default) |
| HTTP Streamable | Yes (`--http-port`) |
| SSE | Yes (`--sse-port`) |
| TLS/HTTPS | Yes (v4.6.0: `--tls-cert`, `--tls-key`, `--tls-ca`) |

## Configuration

- CLI args, environment variables, YAML config files
- `--mcp=<destination>`: service key selection
- `--auth-broker`: force auth-broker usage
- `--connection-type`: http or rfc
- Health endpoint: `GET /mcp/health` (v4.3.0)
- Configurator: `mcp-conf --client cline --name abap --mcp TRIAL`

## Testing

- Jest (unit + integration)
- Integration tests by handler tier and object type
- YAML test config (`test-config.yaml`)
- Global setup/teardown for lifecycle
- Test helpers: HighTester, LowTester, LambdaTester
- Husky + lint-staged pre-commit hooks (v4.5.2)

## Dependencies

Runtime: @modelcontextprotocol/sdk ^1.27.1, axios ^1.13.6, fast-xml-parser ^5.4.2, xml-js ^1.6.11, pino ^10.1.0, js-yaml ^4.1.1, zod ^4.3.6
Optional: @mcp-abap-adt/sap-rfc-lite (replaces archived node-rfc, v4.7.0)
Dev: Biome, Jest, TypeScript, Express, Husky

## Release History (Major Milestones)

| Version | Date | Key Changes |
|---------|------|-------------|
| v5.2.0 | Apr 15, 2026 | ActivateServiceDefinition/ActivateServiceBinding handlers (#59, #60). Replaced `binding_type`/`service_type` with `binding_variant` (ServiceBindingVariant enum: ODATA_V2_UI, ODATA_V2_WEB_API, ODATA_V4_UI, ODATA_V4_WEB_API). SERVICE_BINDING_VARIANT_MAP for centralized ADT parameter derivation. Shared SRVD fixtures for integration tests. |
| v5.0.9-5.1.1 | Apr 13, 2026 | 13 high-level Check handlers (per-type syntax/semantic validation, #54). Try/finally lock fix (#57). Dropped Node 20, minimum Node 22. Fixed stdio log leak (#46), CSRF cookie corruption on sequential creates (#45). Skip syntax check on save-without-activate (#52). Total tools: 316. |
| v5.0.6-5.0.8 | Apr 13, 2026 | ActivateObjects group activation tool + 12 per-type Activate handlers + ActivateObjectLow. Post-merge fix: renamed low-level handler names/descriptions for LLM discoverability. [Eval](fr0ster/evaluations/feat-49-activate-objects.md) |
| v5.0.0-5.0.1 | Apr 11-12, 2026 | RuntimeListFeeds (unified ADT feed reader), RuntimeListSystemMessages (SM02), RuntimeGetGatewayErrorLog (/IWFND/ERROR_LOG with detail view), adt-clients 4.0 factory API migration. Removed compact wrappers in v5.0.1 (LLM confusion). [Deep dive](fr0ster/evaluations/v5.0.0-release-deep-dive.md) |
| v4.9.0 | Apr 9, 2026 | Minor release between v4.8.x and v5.0.0 |
| v4.8.0-4.8.7 | Apr 2-8, 2026 | Structured dump list, dump lookup by datetime+user, from/to time filters, search TSV format |
| v4.7.0-4.7.1 | Apr 1, 2026 | Replaced archived `node-rfc` with `@mcp-abap-adt/sap-rfc-lite` |
| v4.6.0 | Mar 31, 2026 | HTTPS/TLS support for MCP server |
| v4.5.0-4.5.2 | Mar 26-27, 2026 | try-finally lock fix (9 handlers), 415/406 Content-Type auto-retry via adt-clients 3.12.0 (per-endpoint caching), ListTransports Accept negotiation rewrite, RAG-optimized SearchObject description, auth priority fix. [Deep dive](fr0ster/evaluations/v4.5.0-release-deep-dive.md) |
| v4.4.0 | Mar 22, 2026 | Tool descriptions enriched for embedding-based discovery |
| v4.3.0 | Mar 19, 2026 | `/mcp/health` endpoint, improved request logging |
| v4.0.0-4.1.1 | Mar 13, 2026 | Major version bump (v3→v4) |
| v3.x | Mar 3-6, 2026 | Short-lived (3 releases) |
| v2.x | Dec 30, 2025 - Feb 23, 2026 | ~20 releases |
| v1.1.0 | Nov 21, 2025 | First release |

**Total: 95+ releases in ~5 months. Average: ~4 releases/week.**

## Known Issues

| Issue | Description | Relevant to ARC-1? |
|-------|-------------|-------------------|
| #22 | Lock leak — try-catch instead of try-finally for unlock | **Resolved** — ARC-1 already uses try-finally |
| #22, #23, #25 | 415 Content-Type errors — SAP needs specific Accept/Content-Type | **Resolved** — ARC-1 already has 406/415 auto-retry in http.ts ([evaluation](fr0ster/evaluations/415-content-type-retry.md), [deep dive](fr0ster/evaluations/v4.5.0-release-deep-dive.md)) |
| #24 | SAP_JWT_TOKEN overrides SAP_AUTH_TYPE | **No action** — ARC-1 infers auth type from credentials, no priority conflict ([evaluation](fr0ster/evaluations/dce44ca-auth-type-priority.md)) |
| #7, #6 | 409 conflict details not propagated to LLM | **Verify** — check ARC-1 AdtApiError includes SAP error body ([evaluation](fr0ster/evaluations/issue-7-6-409-error-details.md)) |
| #13 | Check runs fail with non-EN languages | **Verify** — check ARC-1 syntax check/ATC parsing uses language-independent attributes ([evaluation](fr0ster/evaluations/issue-13-i18n-check-handling.md)) |
| #30 | Object history + transport contents | **Medium** — transport contents useful, object history lower priority ([evaluation](fr0ster/evaluations/issue-30-object-history-transport-contents.md)) |
| #31 | RuntimeRunClassWithProfiling stale trace ID | **Not applicable** — ARC-1 doesn't have execute-with-profiling |
| #33, #32 | Test infra: transport/lock conflicts | **Not relevant** — specific to their multi-system test setup |
| BTP Cloud | Data preview may not work | Yes — document BTP limitations |

---

## Features This Project Has That ARC-1 Lacks

| Feature | Priority | Effort | Notes |
|---------|----------|--------|-------|
| **GetInactiveObjects** (list pending activations) | Medium | 0.5d | `GET /sap/bc/adt/activation/inactive` — shows what needs activation. Natural LLM workflow: list inactive → batch activate. |
| **SM02 system messages** (RuntimeListSystemMessages) | Medium | 0.5d | AI agent situational awareness (maintenance windows, system announcements) |
| **Gateway error log** (RuntimeGetGatewayErrorLog) | Medium | 1d | /IWFND/ERROR_LOG with detail view — essential for OData debugging. On-prem only. |
| **Unified ADT feed reader** (RuntimeListFeeds) | Low | 0.5d | Feed descriptor/variant discovery. ARC-1 already has dump + trace feeds. |
| **9 auth providers** (SAML, OIDC device flow, etc.) | Low | 5d+ | Only if enterprise demand |
| **TLS/HTTPS for MCP server** | Critical | 1d | Required for production without reverse proxy |
| **sap-rfc-lite** (RFC connectivity) | Low | 3d | Alternative to ADT HTTP |
| **Auto-configurator** for 11 MCP clients | High | 2d | Great onboarding UX |
| **SSE transport** | Medium | 2d | If clients need it |
| **Runtime profiling** (execute + profile) | Medium | 2d | Extend SAPDiagnose |
| **Runtime dump analysis** (list + analyze) | Critical | 1d | Basic diagnostic gap |
| **ABAP AST parsing** (JSON syntax tree) | Medium | 3d | Could enhance code intelligence |
| **Semantic analysis + system symbols** | Medium | 3d | Advanced code intel |
| **Enhancement discovery** (spots + implementations) | Medium | 2d | Useful for customization |
| **CDS unit testing** (create/run/check) | Medium | 1d | Extend SAPDiagnose |
| **Embeddable server** (EmbeddableMcpServer) | Low | 1d | SDK/library use case |
| **GetProgFullCode** (recursive includes) | High | 1d | Reduces round trips |
| ~~**Content-Type 415 auto-retry**~~ | ~~Critical~~ | ~~0.5d~~ | ✅ **Done** — ARC-1 has 406/415 auto-retry in http.ts. Only gap: per-endpoint caching (P3 optimization). [Deep dive](fr0ster/evaluations/v4.5.0-release-deep-dive.md) |
| **Compact mode** (22 tools) | Low | 2d | ARC-1 already has intent-based |
| **RAG-optimized tool descriptions** | Medium | 1d | Improve embedding discoverability |
| **DDLX/Metadata Extension** (read + CRUD) | Critical | 1d | RAP completeness |
| **Health check endpoint** | — | — | ARC-1 already has /health |
| **Lock registry with crash recovery** | Low | 2d | Persistent lock state |
| **Batch HTTP operations** (multipart/mixed) | Medium | 2d | Reduces SAP round trips |
| ~~**Service Binding read/CRUD**~~ | ~~High~~ | ~~1d~~ | ✅ **Done** — ARC-1 has full SRVB read/create/activate/publish/unpublish/delete. Gap: publish endpoint hardcodes `odatav2` (should use `odatav4` for V4 bindings). |

## Features ARC-1 Has That This Project Lacks

- abaplint integration (local offline linting)
- SQLite caching
- Read-only mode + op filtering + package filtering + SQL blocking + transport gating + dry-run
- MCP scope system (OAuth scope-gated tools)
- BTP Destination Service (built-in, not just service keys)
- Principal propagation (per-user SAP identity)
- Cloud Connector proxy
- Audit logging (BTP Audit Log sink)
- MCP elicitation (interactive parameter collection)
- Intent-based routing (11 vs 287 tools — simpler LLM decision surface)
- npm `arc-1` package + Docker image
- Context compression (SAPContext with depth control)
- BOR business objects read
- Messages (T100) read
- release-please CI/CD pipeline

---

## Changelog & Relevance Tracker

| Date | Change | Relevant? | Action for ARC-1 | Status |
|------|--------|-----------|-------------------|--------|
| 2026-06-22 | v7.2.0–v7.2.1 — `d1688c9` **DNS-rebinding protection** (Host/Origin allowlist) for HTTP/SSE (#120); `f57f165` GetStructuresList returns append structures (#121) | **High** (security) | **GAP**: ARC-1 validates `Origin`/CORS + OAuth redirect/issuer hosts but **not** the `Host` header — no DNS-rebinding defense for localhost / stdio-HTTP-bridge deployments where a browser can reach `/mcp`. MCP SDK 1.29.0 exposes `enableDnsRebindingProtection`/`allowedHosts` but marks them `@deprecated` ("use external middleware"), so it needs a hand-rolled Express middleware + an `ARC1_ALLOWED_HOSTS` knob (loopback-auto-protect default). A4 (DNS-rebinding) is named as a threat in `docs/security-model.md:75` with no control. → roadmap **SEC-14** (plan written: `docs/plans/2026-06-25-sec-14-dns-rebinding-host-validation.md`). Append-structures read = minor DDIC detail. | ⏸ **IMPLEMENTED then DEFERRED (PR #500)**: mandatory HTTP auth is the primary rebind control; Host validation only matters in the no-auth mode a real deploy shouldn't use, so it's parked to avoid the `ARC1_ALLOWED_HOSTS` setup surface. |
| 2026-06-19 | v7.1.0–v7.1.3 — `248c851` function-group include MCP tools (read/list + **CRUD**); `864e769` UpdateFunctionInclude `activate` flag | **Medium** | **PARTIAL**: ARC-1 reads FUGR includes (`getFunctionGroupExpanded`) + writes FUNC modules & standalone INCL, but cannot create/update/delete a FUGR's *structural* includes (LZ…TOP / L…UXX / PBO/PAI). The class analogue already exists (`safeUpdateClassInclude`, `crud.ts`). Small gap — fold into FEAT-18 when next touching FUGR. | ✅ **DONE (structural-include UPDATE) — PR #505**: `SAPWrite update type=INCL`+`group` edits LZ…TOP / form includes (lock-the-include, fail-closed package gate); live-verified 758 + 816. Structural create/delete remains out of scope. |
| 2026-06-11 | v7.0.0–v7.0.3 — BREAKING `e9c1a33` EmbeddableMcpServer dedups Read/Get by default; `a304a25` 423 lock fix (adt-clients 5.4.4); `03ec60a`/`5e43453` master language from SAP_LANGUAGE | No / Resolved | Dedup = architecture-specific to fr0ster's ReadOnly-vs-HighLevel tier split (N/A — ARC-1's 12 intent tools have no Read/Get duplication). 423 lock: ARC-1 **already** handles it release-aware (`errors.ts:559` → SM12-actionable hint). Master language: ARC-1 shipped #343. | Done |
| 2026-05-28 | v6.11.0–v6.11.3 — `0ac4c58` FM lock/unlock wiring + dead `filePath` cleanup; `01d2974`/`46a0917` ReadProgram rejects non-PROG types + structured include errors; `e6d8e7a` remove redundant GetProgFullCode | Low | ARC-1's intent tools + `object-types.ts` normalization already reject wrong types; FM lock handled by centralized stateful session. Include-traversal read remains FEAT-23 (P2). | Evaluated |
| 2026-05-23 | v6.9.0–v6.10.0 — `e9b8da3` **certificate (X.509/mTLS) + Kerberos/SPNEGO auth**; `1f2cd7a` NTLM hard-reject; `07a63f6` SearchSource time budget + partial results | **Low/Med** | **Cert/Kerberos = GAP**, but Low relevance: ARC-1 is BTP-native (Basic/cookie/OAuth/XSUAA/OIDC/PP); `applyAuthHeader` is Basic-only. mTLS + SPNEGO only matter for on-prem CERTRULE / Kerberos-SSO shops. Defer unless a customer needs direct-to-SAP cert auth. | Track |
| 2026-05-13 | v6.6.0–v6.8.0 — `65d6edc` **SearchSource** (grep across a package's PROG/FUGR/CLAS source) + `cf5491d` package masks (#87); `b18d6f8` **RuntimeRunClass/RuntimeRunProgram** with optional profiling (#84/#85); `8d84741` trace-lookup tunables | **Med** | (1) SearchSource = **ALREADY-HAVE**: ARC-1's `SAPSearch searchType='source_code'` → `informationsystem/textSearch` (package-scoped, line-level matches). (2) RuntimeRunClass: *execute* stays a deliberate non-goal (roadmap **29c**, security — running arbitrary ABAP from an LLM); the *profiling* half maps to **FEAT-09** (ARC-1 reads existing traces, cannot yet create one). | Evaluated |
| 2026-04-25 | Issue #77 (open) + commit `3a3fa65` — UpdateFunctionModule loses parameters; diagnostic probe-update-fm script added to investigate ADT read-modify-write semantics on FMs | **High** | ARC-1 has a related latent bug: SAPWrite(type='FUNC', action='update') would build the wrong URL (`objectBasePath('FUNC')` returns `/functions/groups/` not the `fmodules` endpoint) AND wouldn't preserve parameters. Either remove FUNC from `SAPWRITE_TYPES_ONPREM` until upstream fix lands, or implement properly. Watch fr0ster's investigation. | [Eval](fr0ster/evaluations/issue-77-fm-update-parameter-loss.md) |
| 2026-04-24 | v6.5.0-v6.5.1 — `795633a` FM group validation against ADT containerRef metadata; `1246cc2` pluggable ReadOnly-vs-HighLevel dedup strategy | **Medium** | (1) `795633a`: ADT silently resolves FM by name regardless of group in URL — wrong-group request returns right FM's source. ARC-1 has the same latent bug in `getFunction(group, name)` — consider hardening when next touching FM code path. (2) `1246cc2`: dedup is architecture-specific to fr0ster's tier split; not applicable to ARC-1. | [Eval](fr0ster/evaluations/795633a-fm-group-validation.md) |
| 2026-04-21 | v6.4.0-v6.4.1 — `b2ef76d` Dockerfile HTTP-mode fix + `--allow-destination-header` for header-based connections (#71); `c726f70` per-instance systemType for EmbeddableMcpServer (#69) | **Low** | (1) Dockerfile: ARC-1 already has http-streamable default + correct paths. Optional `HEALTHCHECK` directive is a small DX polish. Header-based per-request connection switching = multi-tenant gateway feature, defer. (2) Per-instance systemType: not applicable to ARC-1 (one process per system); track for any future embed/SDK. | [Eval](fr0ster/evaluations/b2ef76d-dockerfile-http-fix.md), [Eval](fr0ster/evaluations/c726f70-per-instance-systemtype.md) |
| 2026-04-20 | Issue #68 (closed, superseded by #69) — Add CreateProgram / UpdateProgram / DeleteProgram for classic executable reports | No | ARC-1 already supports PROG CRUD via SAPWrite (`case 'PROG'` in `buildCreateXml` + `objectBasePath`, ZARC1_TEST_REPORT covered in `tests/e2e/fixtures.ts`). Win for the intent-based architecture. | [Eval](fr0ster/evaluations/issue-68-program-crud.md) |
| 2026-04-19 | Issue #67 (closed) — Refresh dependencies and lockfile after adt-clients drops node-rfc | No | ARC-1 doesn't use node-rfc. | — |
| 2026-04-17 | v6.3.0 — Issue #66 + 12 enrichment commits — RAG-driven cross-references between Create/Update/Read tool descriptions | **Low** | Not applicable in the same form (ARC-1's 12 intent-based tools sidestep RAG ranking). Lesson at workflow-ordering granularity: 1–2 lines in `SAPWrite`/`SAPActivate` description explaining the `create→update→activate` chain. Bundle into next docstring touch. | [Eval](fr0ster/evaluations/issue-66-tool-description-enrichment.md) |
| 2026-04-17 | v6.2.0-v6.2.2 — Connection/adt-clients dependency bump (`de1dfff`); debug/trace scripts (`dab9963`, `8bbaa8a`); SAP_SYSTEM_TYPE docs | No | Internal dev tooling + dep bumps. ARC-1 has scripts/probe-adt-types.ts for similar diagnostic purposes. | — |
| 2026-04-16 | v6.0.0 — BREAKING: remove RuntimeListDumps (use RuntimeListFeeds(dumps) instead); fix UpdateInterface on BTP Cloud — corrNr param causes 400 on BTP when no transport (#61, #62) | **Medium** | (1) Dump simplification validates ARC-1's "defer" decision — datetime+user lookup had timezone bugs, fr0ster removed it 2 weeks after adding. ARC-1's simpler dump_id-only flow was correct. (2) UpdateInterface fix: **not applicable to ARC-1** — centralized `safeUpdateSource()` in `crud.ts` uses `transport ?? (lock.corrNr \|\| undefined)` for ALL types, so INTF updates already work correctly on BTP. | [Eval](fr0ster/evaluations/c2b8006-dump-simplify-updateintf-fix.md) |
| 2026-04-16 | v6.1.0 — RFC connection decoupled from legacy system type | No | ARC-1 is HTTP-only | — |
| 2026-04-15 | v5.2.0 — ActivateServiceDefinition/ActivateServiceBinding + ServiceBindingVariant enum (#59, #60) | **Medium** | Activation: ARC-1 already handles via SAPActivate — no action. ServiceBindingVariant: ARC-1's `normalizeSrvbBindingType()` is already more LLM-friendly (fuzzy parsing vs strict enum). **Bug found**: ARC-1 hardcodes `odatav2` in publish/unpublish endpoints — should use `odatav4` for V4 bindings. Fix `publishServiceBinding()`/`unpublishServiceBinding()` in devtools.ts. | **Done (PR #130, 2026-04-15)** |
| 2026-04-13 | v5.0.7-5.0.8 — ActivateObjects group activation + 12 per-type Activate handlers (289→303 tools) | **No action** | ARC-1 already has SAPActivate with batch_activate. Gap: GetInactiveObjects endpoint (P2). Post-merge naming fix validates ARC-1's intent-based approach. | [Eval](fr0ster/evaluations/feat-49-activate-objects.md) |
| 2026-04-12 | v5.0.1 — Removed compact feed wrappers (LLM confusion, 292→289 tools) | Lesson | Validates ARC-1's intent-based approach — duplicate tools confuse LLMs | Done |
| 2026-04-11 | v5.0.0 — RuntimeListFeeds, RuntimeListSystemMessages (SM02), RuntimeGetGatewayErrorLog (/IWFND/ERROR_LOG), adt-clients 4.0 factory API | **Medium** | Add `system_messages` + `gateway_errors` actions to SAPDiagnose | [Eval](fr0ster/evaluations/v5.0.0-release-deep-dive.md) |
| 2026-04-09 | v4.9.0 — Minor release | No | — | — |
| 2026-04-08 | v4.8.2-4.8.7 — Merge RuntimeAnalyzeDump into RuntimeGetDumpById, search TSV format (#40) | Medium | Search TSV format: consider for SAPSearch optimization | [Eval](fr0ster/evaluations/8a22669-search-tsv-format.md) |
| 2026-04-02 | v4.8.0-4.8.1 — Structured dump list, datetime+user lookup, from/to filters | Medium | Defer — ARC-1 SAPDiagnose dumps work fine as-is | Evaluated |
| 2026-04-01 | v4.7.0-4.7.1 — sap-rfc-lite replaces node-rfc | No | ARC-1 uses HTTP only | — |
| 2026-03-31 | v4.6.0 — TLS/HTTPS support | **Critical** | Add TLS support for HTTP Streamable | TODO |
| 2026-03-27 | v4.5.2 — Husky + lint-staged pre-commit hook | No | ARC-1 already has Biome pre-commit | Done |
| 2026-03-26 | v4.5.1 — ListTransports Accept negotiation rewrite | **Resolved** | Covered by ARC-1's global 415/406 retry in http.ts | Done |
| 2026-03-26 | v4.5.0 — adt-clients 3.12.0 (415/406 auto-retry + per-endpoint caching) | **Resolved** | ARC-1 already has 415/406 retry. Per-endpoint caching is P3 optimization. [Deep dive](fr0ster/evaluations/v4.5.0-release-deep-dive.md) | Done |
| 2026-03-26 | v4.4.2 — Lock leak fix (try-finally in 9 handlers) | Resolved | ARC-1 already uses try-finally via centralized `safeUpdateSource()`. [Eval](fr0ster/evaluations/32ab9d4-try-finally-unlock.md) | Done |
| 2026-03-26 | v4.4.1 — RAG-optimized SearchObject description | No | Not relevant — ARC-1 uses intent routing, not RAG discovery | Evaluated |
| 2026-03-26 | Auth priority fix (#24) | No | ARC-1 infers auth from credentials — no priority conflict | Evaluated |
| 2026-03-22 | v4.4.0 — Embedding-optimized descriptions | No | Same as above — RAG not applicable | Evaluated |
| 2026-03-19 | v4.3.0 — /mcp/health endpoint | No | ARC-1 already has /health | — |
| 2026-03-14 | v4.2.0 — Read handlers with source + metadata | Medium | Consider adding include_metadata to SAPRead | Evaluated |
| 2026-03-13 | v4.0.0 — SAP_SYSTEM_TYPE, available_in, legacy support | Mixed | System type: done. available_in: not needed (11 tools). Legacy: out of scope. | Evaluated |
| 2026-03-06 | v3.2.1 — Legacy system auto-detection, RFC auth | No | ARC-1 targets 7.50+, HTTP only | — |
| 2026-03-04 | v3.1.0-3.2.0 — Create/Update separation, table contents | Medium | Keep current combined create+write. Table contents: already have RunQuery | Evaluated |
| 2026-02-09 | v2.2.0 — MCP client auto-configurator | Medium | Implement lightweight `arc-1 config` snippet printer | TODO |

_Last updated: 2026-06-24 (deep scan v6.5.1 → v7.2.1: 22 releases, 97 commits). Net: 1 new security GAP (DNS-rebinding → SEC-14); 2 PARTIALs (FUGR structural-include CRUD; cert/Kerberos auth — both low/med, deferred); SearchSource + 423 lock confirmed ALREADY-HAVE; v5.2.0 odatav4 publish bug now Done (PR #130)._

> **Detailed commit-level tracking**: See [fr0ster/commits.json](fr0ster/commits.json) and [fr0ster/evaluations/](fr0ster/evaluations/) for per-commit analysis.
