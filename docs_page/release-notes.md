# Release Notes

Use this page to check release impact and required actions. For the complete PR list, see
[CHANGELOG.md](https://github.com/arc-mcp/arc-1/blob/main/CHANGELOG.md).

See [Updating](updating.md) for migrations, [Configuration](configuration-reference.md) for settings,
and [Tools Reference](tools.md) for the MCP surface.

## How to read this

- **Change** — the user-visible change, linked to the relevant PR.
- **Impact** — what changes for operators or tool users.
- **Action** — what to do; `none` means no action is required.

ARC-1 follows [semantic versioning](https://semver.org/) from `1.0`. Default-off experimental features,
currently [multi-target mode](multi-target-setup.md), may still change in a minor release.

`1.0.0` onward and every `0.9` release are listed individually. `0.1`–`0.8` are summarized, with the
important `0.7.0` authorization migration retained below.

## 1.2.0 — bounded data access and deployment hardening (2026-09-03)

This release bounds data-preview memory, adds an optional data-source blocklist, identifies direct-connect
systems, fixes local-class method reads, and patches the optional BTP AppRouter.

| Change | Impact | Action |
|---|---|---|
| Add the ARC-1 Updates newsletter | Major release, upgrade, and security updates are available by email. | [Join ARC-1 Updates](newsletter.md). |
| Bound data-preview memory ([#739](https://github.com/arc-mcp/arc-1/pull/739)) | Data-preview bodies are capped at 2 MiB per tool call and two concurrent data results per process by default; `SAPQuery.maxRows` is capped at 10,000. Oversized results return `DATA_RESPONSE_TOO_LARGE` without partial rows, and CF Node old-space now scales with instance memory. | Review batch and file consumers. Prefer fewer rows and columns. To raise limits, size memory and both data-result settings together using the [RAM sizing table](btp-administration.md#data-preview-ram-sizing); Docker/direct-push deployments must also align their numeric `NODE_OPTIONS` limit. |
| Add an experimental data-source blocklist ([#740](https://github.com/arc-mcp/arc-1/pull/740)) | `SAP_BLOCKED_DATA_SOURCES` can deny exact tables or CDS entities, including resolved lineage. It only narrows existing access and adds metadata requests when enabled. Malformed `TABLE_QUERY` identifiers are now rejected. | `none` by default. Before enabling it, read [Authorization & Roles](authorization.md#experimental-data-source-blocklist) and test metadata access and latency. |
| Identify direct-connect systems ([#735](https://github.com/arc-mcp/arc-1/pull/735)) | `ARC1_SYSTEM_LABEL` / `--system-label` adds a single-target system label to MCP instructions. It is ignored in multi-target mode. | Optional: set a stable label such as `ERP production (read-only)` when the client hides `ARC1_SERVER_NAME`. |
| Fix local-class method reads ([#744](https://github.com/arc-mcp/arc-1/pull/744)) | `SAPRead(type="CLAS", method=...)` now selects implementation or test-class includes for local methods. Explicit `include` still wins. | `none` |
| Patch the optional BTP AppRouter ([#738](https://github.com/arc-mcp/arc-1/pull/738)) | Removes a pre-authentication denial-of-service path in `arc1-ui-router`. The AppRouter now requires Node.js 22.12 or newer; the MCP server was not affected. | If you use `mta-ui-approuter.mtaext`, rebuild and redeploy the MTAR. Otherwise, `none`. |

## 1.1.2 — ATC completeness follows SAP's run lifecycle (2026-08-31)

| Change | Impact | Action |
|---|---|---|
| Correct ATC completion evidence ([#729](https://github.com/arc-mcp/arc-1/pull/729)) | ARC-1 follows SAP's asynchronous ATC run to `Completed` instead of comparing informational counters with visible findings. Structured results expose run status and completion evidence. | `none` — runs previously reported as incomplete may now complete successfully. |

## 1.1.1 — you get the scope you asked for (2026-08-20)

| Change | Impact | Action |
|---|---|---|
| Bind the configured ATC variant ([#708](https://github.com/arc-mcp/arc-1/pull/708)) | Omitting `variant` now uses the system default; an unknown variant errors instead of falling back to `DEFAULT`. Results include `variant` and `variantSource`. | Re-baseline stored ATC finding counts because the corrected variant can change results. |
| Stop polling settled ATC worklists ([#710](https://github.com/arc-mcp/arc-1/pull/710)) | Settled runs return promptly. Incomplete runs still report `complete:false`, and `arc1-cli atc` still exits `3`. | `none` |
| Honor `user=*` for transport lists ([#706](https://github.com/arc-mcp/arc-1/pull/706)) | `SAPTransport(action="list", user="*")` now returns all visible owners and preserves SAP ordering. | Expect larger lists; use `user=<name>` to narrow them. |

## 1.1.0 — a truthful CLI for SAP CI workflows (2026-08-18)

The CLI now shares the MCP server's configuration, authentication, authorization, safety, and audit path.

| Change | Impact | Action |
|---|---|---|
| Harden CLI automation ([#703](https://github.com/arc-mcp/arc-1/pull/703)) | Adds stable `unittest`, `atc`, `diff`, and offline `lint` commands. Exit codes are `0` pass, `1` evaluated/tool failure, `2` CLI/config error, and `3` incomplete evidence. Unavailable or uncertain Git operations no longer report success. | Pin the version in CI, preserve exit codes, and treat `3` as incomplete. Remove `SAPGit.commit` callers. See [Updating → v1.1.0](updating.md#v110-clici-hardening-compatibility-changes). |
| Add transport source diffs ([#671](https://github.com/arc-mcp/arc-1/pull/671)) | `arc1 diff` and `SAPTransport(diff)` compare request revisions, including class includes, while retaining non-source objects as inventory. | `none` |
| Add opt-in gzip for WAF-blocked data preview ([#694](https://github.com/arc-mcp/arc-1/pull/694)) | Gzips only the affected data-preview request bodies; it does not relax access controls. | Prefer a scoped WAF fix. If that is unavailable and logs confirm the issue, set `SAP_GZIP_DATAPREVIEW_BODY=true`. |
| Correct ADT source search ([#683](https://github.com/arc-mcp/arc-1/pull/683)) | Source search now uses the live ADT contract and distinguishes disabled service from missing authorization. | `none` |
| Correct `TABLE_QUERY` IN/NOT IN guidance ([#691](https://github.com/arc-mcp/arc-1/pull/691)) | ARC-1 quotes and escapes comma-separated values. | Pass `values: "T000,T001"`, not pre-quoted values. |
| Patch transitive dependencies ([#672](https://github.com/arc-mcp/arc-1/pull/672)) | Updates patched versions of `fast-uri`, `ip-address`, `hono`, and `postcss`. | `none` |
| Fail closed when SAP skips syntax checks ([#681](https://github.com/arc-mcp/arc-1/pull/681)) | A `notProcessed` response now returns `checked:false` instead of an empty clean result. | Consumers must check `checked` as well as `hasErrors`. |
| Fix CSRF/session pairing and 7.50 table functions ([#680](https://github.com/arc-mcp/arc-1/pull/680), [#693](https://github.com/arc-mcp/arc-1/pull/693)) | Bearer-authenticated requests keep tokens with their session cookie; CDS table functions remain writable on SAP_BASIS 750. | `none` |

## 1.0.2 — completes the 1.0.1 release (2026-08-03)

The package is identical to 1.0.1. This release completed its SBOM and MCP Registry publication and fixed
the release-workflow gate ([#669](https://github.com/arc-mcp/arc-1/pull/669)). No action is required.

## 1.0.1 — three total-outage fixes (2026-08-03)

Upgrade if you use strict-schema clients, Windows plugins, or FLP tile listing.

| Change | Impact | Action |
|---|---|---|
| Accept inapplicable FUNC metadata ([#665](https://github.com/arc-mcp/arc-1/pull/665)) | Fixes a 1.0.0 regression that rejected all `SAPWrite` calls from clients that populate every schema field. | `none`; on 1.0.0, set `ARC1_SCHEMA_NULLABLE_OPTIONALS=on` as a workaround. |
| Load plugins on Windows ([#662](https://github.com/arc-mcp/arc-1/pull/662)) | Stops POSIX permission checks from rejecting every Windows plugin path at startup. | `none` |
| Fix FLP tile listing ([#663](https://github.com/arc-mcp/arc-1/pull/663)) | Uses the Pages association and avoids an SAP short dump on every `flp_list_tiles` call. | `none` |
| Correct CTS transport checks ([#659](https://github.com/arc-mcp/arc-1/pull/659)) | Parses candidate requests, locks, and fatal diagnostics correctly; adds `operation=create|modify`. Transport creation remains Workbench-only. | `none` |

## 1.0.0 — semver commitment, experimental multi-target, bounded tool results (2026-07-31)

ARC-1 adopts semantic versioning, adds experimental read-only multi-target routing, bounds large tool results,
and expands ABAP authoring. Cache-warmup settings must be removed before upgrading.

| Change | Impact | Action |
|---|---|---|
| Add experimental multi-target endpoints ([#579](https://github.com/arc-mcp/arc-1/pull/579), [#628](https://github.com/arc-mcp/arc-1/pull/628)) | BTP CF can expose pinned system routes and an aggregate `/multi/mcp` route. The mode is mutation-free and default-off. | Set `ARC1_MULTI_TARGET_ENDPOINTS=true` only after reading [Multi-System Setup](multi-target-setup.md) and [Multi-Target Administration](multi-target-administration.md). |
| Bound tool results and reject unknown parameters ([#583](https://github.com/arc-mcp/arc-1/pull/583)) | Adds caps and truncation metadata to large results, makes transport lists headers-only by default, compacts JSON, and rejects unknown top-level tool arguments. | Fix callers that send unknown arguments. Pass `summary=false` when transport object lists are required. |
| Remove cache warmup ([#573](https://github.com/arc-mcp/arc-1/pull/573)) | Removes repository-wide warmup indexes; usages now query SAP's live index. ARC-1 refuses to start when retired settings remain. | Remove `ARC1_CACHE_WARMUP`, `ARC1_CACHE_WARMUP_PACKAGES`, `--cache-warmup`, `--cache-warmup-packages`, and `SAP_BTP_DESTINATIONS`. Existing SQLite source caches migrate automatically. |
| Expand ABAP authoring ([#571](https://github.com/arc-mcp/arc-1/pull/571), [#637](https://github.com/arc-mcp/arc-1/pull/637), [#634](https://github.com/arc-mcp/arc-1/pull/634), [#612](https://github.com/arc-mcp/arc-1/pull/612), [#604](https://github.com/arc-mcp/arc-1/pull/604)) | Adds `edit_unit`, FUGR structural include CRUD, function-module processing metadata, and DTDC/DSFD support. | `none` |
| Add UIAD reads and ATC variant discovery ([#642](https://github.com/arc-mcp/arc-1/pull/642), [#611](https://github.com/arc-mcp/arc-1/pull/611)) | Adds `SAPRead type="UIAD"` and `SAPDiagnose action="atc_variants"`; server-driven types are discovery-gated. | `none` |
| Improve OAuth discovery and deployment identity ([#632](https://github.com/arc-mcp/arc-1/pull/632), [#606](https://github.com/arc-mcp/arc-1/pull/606)) | Publishes RFC 9728 metadata in OIDC mode and adds `ARC1_SERVER_NAME`. | Set a unique server name for multiple instances. Entra ID users may need `SAP_OIDC_DISCOVERY=false` if discovery returns `AADSTS9010010`. |
| Enable app-to-app principal propagation ([#605](https://github.com/arc-mcp/arc-1/pull/605)) | Allows `OAuth2JWTBearer` token exchange while preserving user identity and existing authorization limits. | Update XSUAA with `cf update-service arc1-mcp-xsuaa -c xs-security.json` or redeploy the MTA. |
| Improve runtime and protocol reliability ([#638](https://github.com/arc-mcp/arc-1/pull/638), [#639](https://github.com/arc-mcp/arc-1/pull/639), [#646](https://github.com/arc-mcp/arc-1/pull/646), [#648](https://github.com/arc-mcp/arc-1/pull/648), [#613](https://github.com/arc-mcp/arc-1/pull/613), [#631](https://github.com/arc-mcp/arc-1/pull/631), [#601](https://github.com/arc-mcp/arc-1/pull/601)) | Fixes PP object creation, startup tool listing, class-include transport writes, AUnit alert parsing, recursive release reconciliation, cookie reload, and browser MCP preflight. | `none` |
| Add tracing and release SBOMs ([#641](https://github.com/arc-mcp/arc-1/pull/641), [#633](https://github.com/arc-mcp/arc-1/pull/633), [#625](https://github.com/arc-mcp/arc-1/pull/625)) | Forwards inbound W3C trace context, records agent identity, publishes npm dependency SBOMs, and monitors AppRouter dependencies. | `none` |

New configuration: `ARC1_SERVER_NAME`, `ARC1_MULTI_TARGET_ENDPOINTS`,
`ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH`, `SAP_OIDC_DISCOVERY`, `SAP_OIDC_SCOPES`, and
`ARC1_MCP_HTTP_RATE_LIMIT`. Defaults remain restrictive; see [Configuration](configuration-reference.md).

Key tool-surface changes: `SAPWrite.edit_unit`; DTDC, DSFD, and UIAD types; `SAPDiagnose.atc_variants`;
`SAPActivate.group`; result caps; `SAPTargets` on `/multi/mcp`; compact JSON results; and MCP server instructions.

Full upgrade checklist: [Updating → v1.0](updating.md#v10-upgrading-from-09x).

## 0.9 line — from ADT tool surface to deployable managed service (2026-05-08 → 2026-07-13)

The `0.9` line expanded authoring, diagnostics, deployment options, and the security boundary. The table keeps
only the user-visible highlights and actions; use [CHANGELOG.md](https://github.com/arc-mcp/arc-1/blob/main/CHANGELOG.md)
for every merged change.

| Version | Date | Highlights | Action |
|---|---|---|---|
| 0.9.27 | 2026-07-13 | Release-plumbing fix only ([#568](https://github.com/arc-mcp/arc-1/pull/568)). | `none` |
| 0.9.26 | 2026-07-13 | Adds `authorization_trace`; HTTP defaults to minimal errors; `ARC1_CACHE=auto` now uses memory, not SQLite ([#560](https://github.com/arc-mcp/arc-1/pull/560), [#552](https://github.com/arc-mcp/arc-1/pull/552), [#557](https://github.com/arc-mcp/arc-1/pull/557)). | Set `ARC1_CACHE=sqlite` if persistence is required. Authorization trace needs data access. |
| 0.9.25 | 2026-07-02 | Adds class text-symbol editing; DCR client IDs no longer expire by default ([#541](https://github.com/arc-mcp/arc-1/pull/541), [#540](https://github.com/arc-mcp/arc-1/pull/540)). | Set a stable `ARC1_DCR_SIGNING_SECRET` on BTP. |
| 0.9.24 | 2026-06-30 | Fixes unterminated `add_method` declarations and removes the incompatible MCPB signature block ([#539](https://github.com/arc-mcp/arc-1/pull/539), [#537](https://github.com/arc-mcp/arc-1/pull/537)). | Re-download the MCPB if a host rejected it. |
| 0.9.23 | 2026-06-29 | Enables BTP ABAP object/package creation, diff labels, and fresh post-activation reads ([#522](https://github.com/arc-mcp/arc-1/pull/522), [#534](https://github.com/arc-mcp/arc-1/pull/534)). | Use a regular cloud sub-package, not `$TMP` or the `ZLOCAL` structure package. |
| 0.9.22 | 2026-06-26 | Adds S/4HANA Public Cloud, `SAPContext.structure`, `odata_perf.clientWaitMs`, and portable schemas by default ([#524](https://github.com/arc-mcp/arc-1/pull/524), [#526](https://github.com/arc-mcp/arc-1/pull/526)). | Set `ARC1_SCHEMA_NULLABLE_OPTIONALS=on` only for a tested strict-schema client. |
| 0.9.21 | 2026-06-25 | Makes HTTP auth and strict PP mandatory; hardens safety; adds TTYP, API release, RAP extensions, FUGR includes, coverage, performance/trace diagnostics, and transport pre-checks ([#487](https://github.com/arc-mcp/arc-1/pull/487)). | Configure HTTP auth. Quickfixes need `write`; `odata_perf` needs data access; activate objects before transport release. |
| 0.9.20 | 2026-06-22 | Adds the default-off UI console and gated non-ADT plugin writes, plus SKTD support ([#485](https://github.com/arc-mcp/arc-1/pull/485), [#474](https://github.com/arc-mcp/arc-1/pull/474)). | Enable UI or raw plugin writes only when required; audit plugins first. |
| 0.9.19 | 2026-06-18 | Extracts XSUAA/PP auth, adds `Custom_*` plugins, and validates three-digit SAP clients ([#456](https://github.com/arc-mcp/arc-1/pull/456), [#454](https://github.com/arc-mcp/arc-1/pull/454)). | Pad clients to three digits; enable only audited plugins. |
| 0.9.18 | 2026-06-16 | Adds source diffs and headers-only transport lists; reduces probe log noise ([#445](https://github.com/arc-mcp/arc-1/pull/445), [#448](https://github.com/arc-mcp/arc-1/pull/448)). | `none` |
| 0.9.17 | 2026-06-15 | Adds `SAPTransport.remove_object`; fixes conditional requests through Cloud Connector ([#432](https://github.com/arc-mcp/arc-1/pull/432), [#440](https://github.com/arc-mcp/arc-1/pull/440)). | `none` |
| 0.9.16 | 2026-06-12 | Initializes class test includes before method surgery ([#429](https://github.com/arc-mcp/arc-1/pull/429)). | `none` |
| 0.9.15 | 2026-06-12 | Adds one-step Claude installation and makes empty environment values fall back to safe defaults ([#425](https://github.com/arc-mcp/arc-1/pull/425), [#427](https://github.com/arc-mcp/arc-1/pull/427)). | Review deployments that intentionally passed empty values. |
| 0.9.14 | 2026-06-11 | Enforces SRVB package gates, isolates PP caches, hardens grep regexes, and fixes MSAG language metadata ([#394](https://github.com/arc-mcp/arc-1/pull/394)). | `none` |
| 0.9.13 | 2026-06-09 | Clamps result limits and hardens abapGit, OAuth redirects, and transport deletion ([#388](https://github.com/arc-mcp/arc-1/pull/388)). | `none` |
| 0.9.12 | 2026-06-09 | Adds server-driven objects and CDS test cases; closes scope/package/auth gaps and fixes boolean parsing ([#356](https://github.com/arc-mcp/arc-1/pull/356), [#352](https://github.com/arc-mcp/arc-1/pull/352), [#363](https://github.com/arc-mcp/arc-1/pull/363)). | Reapply `xs-security.json` for the 30-day refresh-token setting. Data reads still require the `data` scope. |
| 0.9.11 | 2026-06-05 | Adds SAP_BASIS 816 compatibility and stops newer ABAP syntax from blocking writes ([#350](https://github.com/arc-mcp/arc-1/pull/350)). | `none` |
| 0.9.10 | 2026-06-05 | Preserves the TABL write-URL cache in safety-scoped clients ([#335](https://github.com/arc-mcp/arc-1/pull/335)). | `none` |
| 0.9.9 | 2026-06-04 | Adds expanded FUGR reads, transport targets, correct ATC variant binding, and configured master language ([#341](https://github.com/arc-mcp/arc-1/pull/341), [#339](https://github.com/arc-mcp/arc-1/pull/339), [#336](https://github.com/arc-mcp/arc-1/pull/336)). | Check `SAP_LANGUAGE` if created objects must use a different master language. |
| 0.9.8 | 2026-06-01 | Fixes XSUAA OAuth state handling in VS Code ([#325](https://github.com/arc-mcp/arc-1/pull/325)). | `none` |
| 0.9.7 | 2026-05-30 | Adds class-section surgery, object grep, `TABLE_QUERY`, package-subtree rules, and headless BTP user-token exchange ([#307](https://github.com/arc-mcp/arc-1/pull/307), [#316](https://github.com/arc-mcp/arc-1/pull/316), [#309](https://github.com/arc-mcp/arc-1/pull/309)). | `TABLE_QUERY` needs data access. Use `ZFOO/**` for hierarchy-based package scope. |
| 0.9.6 | 2026-05-27 | Adds layered rate limiting and fixes DDIC routing ([#276](https://github.com/arc-mcp/arc-1/pull/276)). | Optionally set `ARC1_RATE_LIMIT` for multi-user deployments. |
| 0.9.5 | 2026-05-11 | Adds TADIR lookup source modes, deferred batch activation, a stable DCR secret, and correct RAP include placement ([#270](https://github.com/arc-mcp/arc-1/pull/270), [#267](https://github.com/arc-mcp/arc-1/pull/267)). | `db`/`both` lookup needs `sql`; set `ARC1_DCR_SIGNING_SECRET` on BTP. |
| 0.9.4 | 2026-05-10 | Adds local-class method editing, RAP implementation generation, structured FUNC parameters, TADIR lookup, object-state diagnostics, and release override ([#261](https://github.com/arc-mcp/arc-1/pull/261), [#260](https://github.com/arc-mcp/arc-1/pull/260)). | Set `SAP_ABAP_RELEASE` only when probing is wrong. |
| 0.9.3 | 2026-05-09 | Adds FUGR/FUNC writes and the Viewer+SQL XSUAA role collection ([#251](https://github.com/arc-mcp/arc-1/pull/251), [#246](https://github.com/arc-mcp/arc-1/pull/246)). | Reapply `xs-security.json` for the new role collection. |
| 0.9.2 | 2026-05-08 | Release-plumbing only ([#244](https://github.com/arc-mcp/arc-1/pull/244)). | `none` |
| 0.9.1 | 2026-05-08 | Fixes descriptions and XML entities; removes npm from the Docker runtime ([#242](https://github.com/arc-mcp/arc-1/pull/242), [#240](https://github.com/arc-mcp/arc-1/pull/240)). | Do not expect `npm` inside the runtime image. |
| 0.9.0 | 2026-05-08 | Removes invented ADT aliases, merges `STRU` into `TABL`, and renames `FTG2` to `FEATURE_TOGGLE` ([#223](https://github.com/arc-mcp/arc-1/pull/223), [#219](https://github.com/arc-mcp/arc-1/pull/219), [#224](https://github.com/arc-mcp/arc-1/pull/224)). | Use canonical types: `FUGR/FF`, `VIEW/DV`, `TRAN/T`, `TABL`, `FEATURE_TOGGLE`, and `MSAG`. |

## 0.1 – 0.8 — early history (2026-03-31 → 2026-05-06)

These versions established ARC-1's TypeScript server, BTP connectivity, 12-tool surface, authorization model,
and deployment support. They are retained for upgrade history.

| Version | Date | Summary |
|---|---|---|
| 0.8.0 | 2026-05-06 | Breaking: stateless HMAC-signed OAuth DCR store; security headers, opt-in CORS, and `ARC1_PUBLIC_URL` |
| 0.7.2 | 2026-04-28 | ETag source cache; active/inactive `version` on `SAPRead`; HANA detection |
| 0.7.1 | 2026-04-27 | Restores `npx arc-1` execution |
| 0.7.0 | 2026-04-26 | Breaking authorization refactor; RAP preflight and scaffolding |
| 0.6.10 | 2026-04-20 | Adds `SAPGit`, the 12th tool; ADT type probe; NW 7.50 coverage |
| 0.6.9 | 2026-04-17 | CDS impact, PrettyPrint, revision/transport history, AUTH/FTG2/ENHO reads, PP fix |
| 0.6.8 | 2026-04-16 | Object package moves, SKTD documents, 503 and CSRF retry |
| 0.6.7 | 2026-04-15 | DCLS, MIME discovery, SAP error hints, concurrency limiter |
| 0.6.6 | 2026-04-14 | CI only: wait for Docker before MCP Registry publication |
| 0.6.5 | 2026-04-14 | ATC quickfixes, type normalization, CDS lint, CF/BTP write fixes |
| 0.6.4 | 2026-04-14 | CI only: MCP Registry OCI annotation |
| 0.6.3 | 2026-04-14 | CI only: MCP Registry `mcpName` |
| 0.6.2 | 2026-04-14 | BTP CF deployment, safe defaults, more writes, package/FLP management, transport enhancements |
| 0.6.1 | 2026-04-10 | API release state, BSP/UI5 types, class hierarchy, CTS negotiation |
| 0.6.0 | 2026-04-08 | Breaking: package allowlist defaults to `$TMP` and is enforced; removes `allowTransportableEdits` |
| 0.5.0 | 2026-04-08 | Breaking scope changes, two-dimensional authorization, Zod validation |
| 0.4.4 | 2026-04-07 | CI only: native arm64 runners |
| 0.4.3 | 2026-04-07 | CI only: separate dependency stage for arm64 |
| 0.4.2 | 2026-04-07 | CI only: avoid QEMU arm64 crash |
| 0.4.1 | 2026-04-07 | CI only: npm self-upgrade fix |
| 0.4.0 | 2026-04-07 | DDIC, DDLX/SRVB, source surgery, caching, diagnostics, where-used, abaplint presets |
| 0.3.0 | 2026-04-01 | Direct BTP ABAP Environment OAuth connectivity |
| 0.2.0 | 2026-03-31 | E2E infrastructure, XML error cleanup, CI hardening, tool improvements |
| 0.1.4 | 2026-03-31 | npm provenance metadata |
| 0.1.3 | 2026-03-31 | npm 11.5+ for trusted publishing |
| 0.1.2 | 2026-03-31 | npm OIDC publishing and docs navigation |
| 0.1.1 | 2026-03-31 | Initial 11-tool TypeScript release |

### Breaking change: 0.7.0 authorization refactor

Version 0.7.0 replaced legacy authorization settings with a single action-policy matrix. ARC-1 stops at
startup if removed settings are still present.

- Remove `SAP_READ_ONLY`, `SAP_BLOCK_DATA`, `SAP_BLOCK_FREE_SQL`, `SAP_ENABLE_TRANSPORTS`,
  `SAP_ENABLE_GIT`, `SAP_ALLOWED_OPS`, `SAP_DISALLOWED_OPS`, `ARC1_PROFILE`, and `ARC1_API_KEY`, plus
  their matching CLI flags.
- Replace them with positive opt-ins: `SAP_ALLOW_WRITES`, `SAP_ALLOW_DATA_PREVIEW`,
  `SAP_ALLOW_FREE_SQL`, `SAP_ALLOW_TRANSPORT_WRITES`, `SAP_ALLOW_GIT_WRITES`, and `SAP_DENY_ACTIONS`.
  The first three mappings invert the old boolean meaning.
- Replace `ARC1_API_KEY` with `ARC1_API_KEYS="key:profile"`. BTP deployments must update
  `xs-security.json` and redeploy the MTA.

See [Updating → v0.7 Authorization Refactor](updating.md#v07-authorization-refactor-breaking-change) for
the full migration and role-collection checks.

## How these notes are maintained

`CHANGELOG.md` remains the exhaustive, machine-generated list. This page records only user-visible impact
and actions.

Add new entries newest-first with the repository's
[`/release-notes` guidance](https://github.com/arc-mcp/arc-1/blob/main/.claude/commands/release-notes.md)
before merging the release PR. Keep the summary to one or two sentences, group related PRs, and move
implementation detail to linked documentation. `tests/unit/server/release-notes.test.ts` checks that every
released version is present; the release workflow links this page from each GitHub Release.
