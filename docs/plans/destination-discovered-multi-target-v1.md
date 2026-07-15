# Destination-Discovered Multi-Target V1

## Overview

Implement an experimental, opt-in BTP Cloud Foundry mode in which one ARC-1 process discovers
explicitly marked subaccount destinations at startup and exposes each SAP system/client through a
fixed MCP URL such as `/A4H/100/mcp`. The target is selected by the URL before any tool call; no MCP
tool gains a `system`, `client`, or destination parameter. This retains the important safety property
that a connected MCP client cannot switch SAP targets within a tool call.

The work starts from Wouter's tested PR #543 so its multi-runtime, request-context, and feature-state
work can be reused where it still fits. The target design intentionally replaces the prototype's CSV
allowlist, `/mcp/:destination` routes, default-destination alias, lazy re-resolution, destination-name
policies, and per-destination environment variables. Existing single-target deployments remain the
default and keep their current `/mcp` behavior. Multi-target is enabled only with
`ARC1_MULTI_TARGET=true`, is limited to BTP CF + HTTP + XSUAA + strict on-premise principal
propagation in v1, and may be substantially rewritten while retaining Wouter's commits in the branch
history and attribution.

The deployment owner continues to define an instance-wide safety ceiling in `mta.yaml`/environment
variables. Each exposed destination defines its own narrower client policy. Effective authorization
is `instance ceiling ∩ destination policy ∩ target-bound XSUAA role grant ∩ SAP authorization`.
The current instance-wide XSUAA scopes remain the functional grants for the legacy target. New
static `target_*` profile scopes plus exact `(SID, client)` role attributes are projected into the
ordinary ARC-1 scopes only for a matching discovered route, before tool listing, PP lookup, or
dispatch.
Destinations are read once at startup; changes require a CF app restart. Zero discovered targets is a
healthy, deployable state so an administrator can deploy ARC-1 first and configure destinations
afterward.

## Context

### Current State

- Mainline ARC-1 is single-target by design. `docs/adr/0005-single-system-per-instance.md` is
  accepted, Design Principle 7 in `AGENTS.md` says never add multi-system support, and the existing
  HTTP server always builds a default MCP server at `/mcp`.
- PR #543 proves one process can own more than one destination runtime. It adds
  `src/server/destination-registry.ts`, destination-keyed feature/discovery stores,
  request-context/audit destination fields, and `/mcp/:dest` routing.
- The #543 prototype takes a deploy-time `SAP_BTP_DESTINATIONS` CSV, eagerly initializes a default
  destination, assigns bare `/mcp` to that destination, retries failed destination initialization,
  and lets missing `arc1.*` properties inherit the global policy. It can disclose configured
  destination names and initialization details in HTTP errors. Those behaviors do not match the v1
  decisions in this plan.
- The prototype supports destination-specific `SAP_*_<DEST>` environment variables and an optional
  second `arc1.pp_destination`. Both are removed from the v1 target model: policy belongs to the one
  PP destination for that system/client, and the deployment-level environment is only the global
  ceiling.
- `createPerUserClient()` currently changes the URL after the per-user destination lookup but keeps
  `config.client`; a multi-client implementation must set and verify the target's `sap-client` on
  every per-user client.
- `src/adt/http.ts` always sends the configured client as the `sap-client` query parameter. This is
  the definitive runtime client pin once the correct target client is put into `AdtClientConfig`.
- `ARC1_MAX_CONCURRENT` is one process-wide SAP semaphore. There is no per-target semaphore, and the
  `/mcp` HTTP edge limit is derived from `ARC1_AUTH_RATE_LIMIT`. Sixty target routes must not create
  sixty independent per-IP buckets.
- `xs-security.json` currently defines only instance-wide `read`, `write`, `data`, `sql`,
  `transports`, `git`, and `admin` roles. In addition, the current
  `@arc-mcp/xsuaa-auth` XSUAA verifier copies only verified scopes, username, and email into
  `AuthInfo`; it does not expose `xs.user.attributes`. Target-aware authorization therefore needs a
  small prerequisite package release plus new role templates in ARC-1.
- `mta.yaml` currently contains active placeholder values for `SAP_BTP_DESTINATION` and
  `SAP_BTP_PP_DESTINATION`, deliberately causing startup to fail until they are overridden. That is
  incompatible with deploy-first/configure-destinations-later multi-target setup.
- Cache warmup was removed from current main. Object caching, plugins, the optional UI, ABAP Unit,
  and ATC remain available in ordinary single-target mode but are outside the supported multi-target
  v1 surface.

### Target State

- With `ARC1_MULTI_TARGET` absent/false, configuration, startup, `/mcp`, auth, cache, UI, plugins,
  tools, and all existing tests behave exactly as on main.
- With `ARC1_MULTI_TARGET=true`, startup requires HTTP Streamable transport, XSUAA auth,
  `SAP_PP_ENABLED=true`, `SAP_PP_STRICT=true`, `ARC1_CACHE=none`, `ARC1_UI=off`, no plugins, and BTP
  Destination + Connectivity service bindings. Unsupported combinations fail once with actionable
  configuration errors.
- ARC-1 obtains the subaccount destination collection once at startup. It never searches provider,
  subscriber, instance, or cross-subaccount scopes in v1. `ARC1_MULTI_TARGET` is therefore a boolean;
  there is no misleading `ARC1_TARGET_DISCOVERY=btp-subaccount` enum until another discovery scope
  actually exists.
- A destination becomes a candidate only when `arc1.expose=mcp`. Required connection/route fields
  are `Name`, `URL`, `ProxyType=OnPremise`, `Authentication=PrincipalPropagation`,
  `sap-client` matching `^\d{3}$`, and `arc1.system` matching `^[A-Z][A-Z0-9]{2}$` (SAP SID: exactly
  three uppercase alphanumeric characters, first character a letter). `-` and `_` are not valid SID
  characters.
- The discovered route is `/<SID>/<CLIENT>/mcp`, for example `/A4H/100/mcp`. Bare `/mcp` is never
  assigned to a discovered target, even when exactly one target exists.
- A separately and explicitly configured legacy target may continue to own `/mcp`; legacy and named
  routes can coexist. If the legacy destination also appears in discovery, both paths remain usable
  but ARC-1 logs a warning because the duplication is probably accidental and the two routes may
  have different policies.
- Startup builds one immutable registry snapshot. Invalid exposed destinations are quarantined
  individually. Duplicate destination names quarantine every entry with that name. Duplicate
  `(SID, client)` routes quarantine every claimant. Quarantined entries are absent from routing and
  the catalog. Operators receive warning logs without secrets; external callers receive only generic
  404/502 messages with a request ID.
- No targets is not fatal: `/health` returns 200, the authenticated catalog returns an empty list,
  named MCP routes return generic 404, and startup logs a warning. A CF restart is required after
  adding, editing, or deleting destinations.
- XSUAA remains one application-level OAuth provider for the process; ARC-1 does not create an XSUAA
  instance, OAuth client, or scope per SAP target. `xs-security.json` adds five static target-profile
  marker scopes and target-aware role templates alongside the unchanged legacy scopes/templates.
  Role instances carry one or more exact target values in `SID:CLIENT` form, for example `A4H:100`;
  there are no target wildcards in v1.
- Each role profile has a distinct required attribute so XSUAA's flattened scope/attribute unions
  cannot create a cross-product privilege escalation: `arc1_viewer_targets`,
  `arc1_developer_targets`, `arc1_data_targets`, `arc1_sql_targets`, and
  `arc1_admin_targets`. Each template also carries only its matching `target_viewer`,
  `target_developer`, `target_data`, `target_sql`, or `target_admin` marker scope—not the legacy
  functional scopes. A caller with Developer on `A4D:100` and Viewer on `PRD:100` receives write only
  on A4D and read only on PRD, and neither target role silently authorizes legacy `/mcp`.
- Every discovered named route requires a matching target-aware role even if only one target exists.
  Missing/malformed target attributes fail closed before PP lookup. Existing global roles continue
  to authorize the explicit legacy `/mcp` target and may authorize its exact named alias only when
  the discovered entry matches the legacy destination connection fingerprint; they never authorize
  unrelated discovered targets. Existing `MCPAdmin` is not an all-target wildcard.
- The authenticated `GET /` and `GET /targets` catalog requires XSUAA authentication and either
  legacy `read` or at least one target profile that projects to `read`. It lists only routes for which
  the caller has effective target-level read access (including an exact verified legacy alias). It
  returns target labels, MCP URLs, and a generated VS Code/GitHub Copilot `.vscode/mcp.json` sample.
  It never exposes destination names, SAP URLs, Cloud Connector IDs, credentials, policies,
  quarantined targets, or targets assigned only to other users.
- The minimum target is read-only because all target capability properties default false:

  ```properties
  Name=ARC1_A4H_100_PP
  Type=HTTP
  URL=http://a4h-abap:50000
  ProxyType=OnPremise
  Authentication=PrincipalPropagation
  sap-client=100
  arc1.expose=mcp
  arc1.system=A4H
  ```

- Optional destination policy properties are
  `arc1.allow_writes`, `arc1.allow_data_preview`, `arc1.allow_free_sql`,
  `arc1.allow_transport_writes`, `arc1.allow_git_writes`, `arc1.allowed_packages`,
  `arc1.allowed_transports`, `arc1.deny_actions`, and `arc1.max_concurrent`. Unknown `arc1.*`
  properties quarantine that target so typos never silently widen or alter policy. There is no
  `arc1.config_version` in v1: the strict property allowlist is the schema, and a version field would
  add setup ceremony without a second schema to negotiate.
- The instance-wide `SAP_ALLOW_*`, `SAP_ALLOWED_PACKAGES`, `SAP_ALLOWED_TRANSPORTS`, and
  `SAP_DENY_ACTIONS` values remain the absolute ceiling. A destination boolean can only enable a
  capability already allowed globally. Missing destination booleans mean false. Missing
  `arc1.allowed_packages`/`arc1.allowed_transports` inherits the instance ceiling; therefore existing
  `$TMP` default behavior remains unchanged. Existing core writes are supported when the current
  dual-consent gates allow them; transport and Git writes still require their existing additional
  gates.
- Every per-user PP lookup must match the startup snapshot for destination name, canonical URL,
  `Authentication`, `ProxyType`, `sap-client`, and `CloudConnectorLocationId`. Drift fails closed and
  instructs the operator to restart. No shared/technical SAP identity fallback is permitted.
- Discovered targets force object cache off and hide/deny `SAPDiagnose.unittest` and
  `SAPDiagnose.atc` in v1. Global startup validation disables the optional UI and plugins for the
  entire process while multi-target is enabled. These limitations are documented as experimental-v1
  boundaries, not permanent architecture.
- One process-wide semaphore remains the hard SAP fleet ceiling. Each target also has a nested
  semaphore (`arc1.max_concurrent`, default 4) so one target cannot occupy every global slot. One
  process-wide per-user MCP limiter is shared across all routes. One process-wide per-IP MCP HTTP
  limiter is shared across all MCP routes and is configured separately with
  `ARC1_MCP_HTTP_RATE_LIMIT`; OAuth endpoints retain `ARC1_AUTH_RATE_LIMIT`.

### Key Files

| File | Role |
|------|------|
| `src/server/types.ts` | Add explicit multi-target/rate-limit config and target runtime types without changing legacy defaults. |
| `src/server/config.ts` | Parse and validate the v1 mode constraints and the new independent MCP HTTP rate limit. |
| `src/cli-args.ts` | Add the MCP HTTP rate-limit CLI flag; multi-target itself remains BTP env/MTA-only. |
| `xs-security.json` | Preserve legacy scopes/templates and add five static `target_*` marker scopes, required target-profile attributes, and `MCPTarget*` templates. |
| `@arc-mcp/xsuaa-auth` (`src/xsuaa.ts`, `src/types.ts`, tests) | Prerequisite package PR: expose only explicitly allowlisted verified XSUAA user attributes in `AuthInfo`; no ARC-1 target policy belongs in the generic package. |
| `src/authz/target-access.ts` | New exact target-claim parser and marker-scope/attribute profile projection used by routes and catalog. |
| `src/server/destination-discovery.ts` | New startup-only subaccount destination enumeration, allowlisted projection, and secret-safe normalization. |
| `src/server/destination-registry.ts` | Replace the #543 CSV/lazy registry with immutable target validation, conflict quarantine, policy intersection, runtime ownership, and catalog descriptors. |
| `src/server/server.ts` | Wire optional legacy runtime plus discovered runtimes, strict PP client creation, connection fingerprint verification, nested semaphores, and per-target feature state. |
| `src/server/http.ts` | Mount `/<SID>/<CLIENT>/mcp`, target-specific PRM metadata, shared edge limiting, authenticated catalog, and generic errors. |
| `src/server/auth-rate-limit.ts` | Reuse one limiter/store across all MCP route mounts while preserving current OAuth endpoint behavior and audit events. |
| `src/server/context.ts` | Carry the public target ID (`SID/client`) rather than using destination name as request identity. |
| `src/server/audit.ts` | Add a redacted target label to relevant audit events without logging connection/policy data. |
| `src/server/logger.ts` | Attach the target label to structured logs and keep destination payloads out of generic log context. |
| `src/handlers/feature-cache.ts` | Keep feature/discovery state isolated by immutable target ID and preserve the legacy default store. |
| `src/handlers/dispatch.ts` | Apply target request context, target policy, and v1 ATC/unit-test denials to listing and invocation. |
| `src/adt/http.ts` / `src/adt/semaphore.ts` | Compose the existing global semaphore with a target semaphore without multiplying either per PP user. |
| `mta.yaml` | Document the opt-in block, remove active destination placeholders, and retain conservative global ceilings. |
| `.env.example`, `mta-overrides.mtaext.example`, `manifest.yml` | Provide consistent legacy and experimental multi-target examples with no secrets. |
| `docs/adr/0005-single-system-per-instance.md` | Mark the old decision superseded rather than rewriting its historical rationale. |
| `docs/adr/0006-endpoint-pinned-multi-target.md` | New decision record: endpoint-pinned targets are allowed; tool-level target selectors remain forbidden. |
| `docs_page/multi-destination.md` | Replace prototype documentation with the supported destination schema, setup, limits, conflict behavior, and restart model. |
| `docs_page/rate-limiting.md` | Document global/target concurrency and team-size presets for shared multi-target instances. |
| `docs_page/{architecture,authorization,security-guide,configuration-reference,btp-cloud-foundry-deployment,btp-destination-setup,principal-propagation-setup}.md` | Align all user-facing architecture, security, and BTP setup claims. |
| `README.md`, `docs_page/index.md`, `docs_page/roadmap.md`, `docs/compare/00-feature-matrix.md`, `AGENTS.md` | Replace the one-system invariant and advertise the feature as experimental/default-off. |
| `tests/unit/server/destination-discovery.test.ts` | Prove collection parsing, immediate sanitization, and Destination Service failure behavior. |
| `tests/unit/server/destination-registry.test.ts` | Prove validation, defaults, policy intersection, duplicate quarantine, immutable snapshot, and zero-target startup. |
| `tests/unit/server/http-destinations.test.ts` | Prove routing, auth catalog, PRM, generic failures, legacy coexistence, and shared limiter mounting. |
| `tests/unit/authz/target-access.test.ts` | Prove exact claim parsing, mixed-role isolation, scope intersection, legacy compatibility, and fail-closed unattributed tokens. |
| `tests/unit/server/{config,server,auth-rate-limit}.test.ts` | Prove mode constraints, PP drift failure, client pinning, nested concurrency, and limiter defaults. |
| `tests/unit/handlers/feature-cache.test.ts` | Prove no feature/discovery bleed between target IDs or into legacy mode. |
| `tests/integration/multi-target-btp.integration.test.ts` | Exercise real subaccount discovery and destination normalization with BTP service bindings. |
| `tests/e2e/multi-target.e2e.test.ts` | Exercise authenticated MCP reads/writes against endpoint-pinned PP routes and a beta CF deployment. |

### Verified Live Evidence

- 2026-07-15: PR #543 contains a working/tested multi-destination implementation from an external
  contributor and unit coverage for multiple runtimes. This plan deliberately keeps its commit
  ancestry while replacing contracts that no longer match the agreed design.
- 2026-07-14/15: issue #577 feedback supports client-level policies, destination-managed target
  inventory, one PP destination, no non-BTP requirement, and eventual writes. One contributor offered
  later S/4HANA Public Cloud implementation/testing help; Public Cloud therefore stays after v1.
- 2026-07-15: the local CF CLI is authenticated to the BTP CF foundation and can be used for the beta
  deployment and live Destination/Connectivity/XSUAA tests. Commands must not print or commit
  `VCAP_SERVICES`, service keys, tokens, destination passwords, or assertions.
- SAP's Destination Service contract exposes the subaccount collection at
  `/destination-configuration/v1/subaccountDestinations`; SAP Cloud SDK's public package contains
  `fetchDestinations(destinationServiceUri, serviceToken, 'subaccount')`. Use an uncached startup
  call and immediately project the possibly credential-bearing response into ARC-1's allowlisted
  snapshot type.
- The user-verified BTP Cockpit supports export/import in JSON, YAML, and Properties formats. Keeping
  all target policy in destination additional properties lets administrators clone a reviewed
  template without introducing ARC-1-specific YAML packaging or redeployment.
- SAP documents an SID as exactly three uppercase alphanumeric characters with the first character a
  letter. Evidence: SAP Help `SYSTEM_ID` and "Choosing SAP System IDs (SIDs)". Runtime route validation
  therefore uses `^[A-Z][A-Z0-9]{2}$`; hyphen and underscore remain valid in a destination `Name` but
  not in `arc1.system`.
- Current source evidence: `src/adt/http.ts` sets `sap-client` from `AdtClientConfig.client` on every
  SAP request; the correct safety boundary is to construct and verify one client-bound runtime, not
  to add client arguments to tools.
- Current source evidence: `lookupDestinationWithUserToken()` in `@arc-mcp/xsuaa-auth` pins Cloud SDK
  destination caching to `tenant-user`. Multi-target must keep that per-user lookup and add snapshot
  comparison; it must not cache or reuse another user's returned PP auth tokens.
- SAP XSUAA role attributes are designed for instance/data-level authorization and appear in the
  signed `xs.user.attributes` claim for user scenarios. `@sap/xssec` exposes them through the
  verified security context's `getAttributes()` API. The generic auth package can therefore carry an
  explicit allowlist without ARC-1 decoding an unverified JWT or copying arbitrary IdP claims.
- XSUAA flattens the scopes and attributes contributed by all assigned roles into the access token.
  A single `systems` attribute is unsafe: Developer(A4D) + Viewer(PRD) would produce global `write`
  plus both system values. Reusing the legacy functional scopes in target templates is also unsafe
  because a target Developer role would then unlock legacy `/mcp`. Distinct attributes paired with
  distinct static `target_*` marker scopes preserve both the target/profile relationship and the
  legacy/named-route boundary.
- SAP permits adding new attributes and role templates to an XSUAA service descriptor but restricts
  adding/changing attribute references on existing templates. V1 therefore leaves `MCPViewer`,
  `MCPDeveloper`, `MCPDataViewer`, `MCPSqlUser`, and `MCPAdmin` unchanged and adds new
  `MCPTarget*` templates. After that one deployment, administrators can create target roles and role
  collections in BTP Cockpit/CLI without rebuilding ARC-1.
- Current infrastructure provides on-premise A4H through Cloud Connector/PP. The routing feature does
  not add or change ADT endpoints, XML formats, or SAP-release-specific behavior; unit routing tests
  are release-invariant. Live v1 acceptance is on an on-premise PP target. NW 7.50 and ABAP 8.16 ADT
  regression tests remain required for ordinary single-target mode, but do not prove new target
  discovery behavior.
- Current VS Code/GitHub Copilot documentation uses `.vscode/mcp.json` with a `servers` object and a
  remote server entry `{ "type": "http", "url": "https://.../mcp" }`; OAuth is initiated through
  the editor's `Auth` CodeLens. The generated catalog sample follows that exact shape and contains no
  token/header placeholder.

### Design Principles

1. **Endpoint-pinned, never model-selected.** The URL fixes `(SID, client)` before MCP dispatch. No
   tool schema or tool name changes, and no aggregate endpoint is added.
2. **Explicit opt-in and backwards compatibility.** `ARC1_MULTI_TARGET=false` is byte-for-byte legacy
   behavior. Discovered targets never receive `/mcp`; only an explicit legacy target can own it.
3. **One discovery scope in v1.** Enumerate only subaccount destinations from the bound Destination
   service. Do not add instance/provider/subscriber/cross-subaccount behavior or a premature scope
   enum.
4. **Immutable startup snapshot.** Discovery, config, policies, routes, and fingerprints are fixed
   until process restart. Per-user credential lookup stays dynamic but must match the snapshot.
5. **Fail closed locally.** A malformed or conflicted target disappears; other valid targets and
   `/health` remain available. No fallback identity, target, route, policy, or client is selected.
6. **Conflicts have no winner.** Duplicate destination names and duplicate `(SID, client)` routes
   quarantine all claimants. Array order, BTP precedence, and response order never decide exposure.
7. **Five authorization layers.** Instance safety ceiling, destination opt-ins, a signed `target_*`
   profile scope, its exact target attribute, and SAP authorization all must allow an operation.
   ARC-1 projects a matching profile into ordinary downstream functional scopes. Every layer
   restricts; none expands a previous layer.
8. **Destination booleans default deny.** An exposed destination with only the minimum properties is
   source-read-only. Data preview, SQL, writes, transport writes, and Git writes each require explicit
   target consent plus existing global gates.
9. **Principal propagation only.** Discovered targets are on-premise `PrincipalPropagation` and strict
   XSUAA user JWTs in v1. One PP destination per target; no BasicAuth probe companion and no shared
   fallback.
10. **Per-user isolation.** PP tokens, SAP sessions, locks, cookies, and authorization-sensitive state
    are never shared. Feature/discovery state is target-scoped and only authorization-neutral
    capability facts may be shared within that target.
11. **No cache in v1.** Multi-target requires `ARC1_CACHE=none`. This avoids cross-target and
    cross-user cache ambiguity while the routing boundary is experimental.
12. **Bounded shared capacity.** All targets share one global semaphore and one per-user quota; a
    per-target semaphore adds fairness. HTTP edge limiting uses one process-wide bucket per IP across
    all MCP routes, preventing route multiplication from multiplying allowance.
13. **No public or cross-user inventory.** Health is public and contains no targets. Catalog is
    authenticated with `read`, filtered by exact target-role access, and errors never enumerate.
    Principal propagation remains the backend authorization boundary but is not used as an ARC-1
    route-discovery oracle.
14. **Secret-minimal runtime.** Do not log, catalog, audit, serialize, or retain raw destination
    responses. Retain only the validated fields needed for routing, policy, proxying, and drift
    comparison; never fingerprint credentials or PP token values.
15. **Experimental on main, tested separately.** Implement on a short-lived branch and validate with a
    separate beta CF app. Once acceptance gates pass, merge the feature default-off rather than
    maintaining a long-lived beta branch.

## Development Approach

Work test-first within each task. Replace the prototype contract deliberately instead of layering a
second routing model on top of `SAP_BTP_DESTINATIONS`. Keep useful mechanics from #543 only where they
meet the target contract: target-keyed feature state, request context, factory-per-runtime, and
shared semaphore threading are likely reusable; CSV parsing, destination-name routes, lazy retry,
default aliasing, cache files, `arc1.pp_destination`, and suffixed env overrides are not.

Keep discovery and policy parsing pure and deterministic. The Destination Service adapter should do
only token/service calls and immediate projection; registry construction should accept a plain array
so duplicate and quarantine behavior is unit-testable without BTP. Treat the collection as a
multiset even if today's Cockpit normally enforces unique names. Do not deduplicate before conflict
analysis.

Use exact parsers, not truthiness: booleans are only `true`/`false` (case-insensitive if documented),
client is exactly three digits, SID is exact uppercase SAP syntax, concurrency is a bounded positive
integer, CSV lists trim empty entries, and unknown `arc1.*` keys quarantine. Non-ARC destination
properties such as `WebIDEEnabled=true` are ignored. Parse only destinations with
`arc1.expose=mcp`; unrelated subaccount destinations are projected/discarded without policy errors.

Policy tests must cover both directions. A destination `true` under a global `false` remains false;
a destination false under global true is false; absent target capabilities are false; absent package
scope inherits the global `$TMP`/allowlist; a supplied package/transport list intersects using the
same semantics as `deriveUserSafetyFromProfile`; deny actions union/narrow rather than replace.
Writes reuse every existing `checkOperation`, package, transport, Git, scope, and SAP authorization
gate. Do not create a multi-target-only write path.

Snapshot drift comparison must be security-oriented and stable. Canonicalize only syntactic URL
equivalence needed to avoid false drift (for example a trailing slash); never follow redirects or
resolve a caller-controlled host. Compare the startup and per-user results before constructing an
ADT client. Copy the target client into `AdtClientConfig.client` and add a unit assertion that a route
for client `200` emits `sap-client=200`, not the legacy/global client. On mismatch, return a minimal
tool error and log a request-correlated operator warning without old/new URLs or auth material.

HTTP tests must verify route order and auth middleware, not only handler functions. Exact named
routes should be mounted from the immutable registry so each route can advertise exact Protected
Resource Metadata. Unknown routes, conflicts, and initialization failures return indistinguishable
generic responses. The shared MCP HTTP rate limiter must be instantiated once and mounted across
legacy, named, and Copilot `/authorize` JSON-RPC paths; do not allocate a store per named route.

Unit tests mock Destination Service and PP lookups. Integration tests use real BTP service bindings
and fail fast if explicitly selected credentials are missing; do not introduce silent early returns
or permanent `it.skip`. E2E uses an isolated beta CF app and an explicit user access token produced by
the normal XSUAA OAuth flow. Temporary destinations must use a unique prefix, be exported/backed up
before modification, and be removed in best-effort cleanup. Never print destination exports because
they may contain passwords. Read-only PP acceptance runs first. A write test is allowed only on a
dedicated `$TMP` target with global and destination write consent; create, activate, read, and delete
a unique object so activation proves correctness and cleanup is visible.

Do not put live integration/E2E commands in the global validation list because they require BTP/SAP
state. Run them in Task 10 and final verification. The implementation may remain a draft until the
beta matrix passes and Wouter reviews the architecture delta.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Replace the prototype configuration contract with explicit v1 mode gates

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/config.ts`
- Modify: `src/cli-args.ts`
- Modify: `.env.example`
- Modify: `tests/unit/server/config.test.ts`
- Modify: `tests/unit/server/server.test.ts`

Make multi-target a clearly bounded deployment mode before changing routing. Legacy defaults must
remain unchanged, and no `SAP_BTP_DESTINATIONS` compatibility alias should survive in the new mode.

- [ ] Add `multiTarget: boolean` with default false, parsed from `ARC1_MULTI_TARGET`; keep it env-only
      because v1 is a BTP CF deployment mode, not a local/stdio feature.
- [ ] Add `mcpHttpRateLimit: number` parsed from `ARC1_MCP_HTTP_RATE_LIMIT` and
      `--mcp-http-rate-limit`. Use a conservative default of `3000` requests/minute/IP for the shared
      MCP HTTP surface; `0` disables only this MCP edge layer, not OAuth limiting.
- [ ] Keep `ARC1_AUTH_RATE_LIMIT` at 20/min/IP for OAuth endpoints and `ARC1_RATE_LIMIT` as the shared
      per-user tool-call quota. Remove the derived `authRateLimit * 30` contract only for MCP routes;
      retain all existing OAuth behavior.
- [ ] Delete parsing/types/docs for `SAP_BTP_DESTINATIONS`, destination-specific `SAP_*_<DEST>`
      overrides, and `arc1.pp_destination`; the one discovered destination is also the PP
      destination.
- [ ] Validate multi-target requires `http-streamable`, XSUAA, `SAP_PP_ENABLED=true`, explicitly
      strict PP, Destination/Connectivity bindings at runtime, `ARC1_CACHE=none`, `ARC1_UI=off`, and
      no `ARC1_PLUGINS`.
- [ ] Validate multi-target rejects service-key/cookie auth and all stdio/API-key-only/OIDC-only
      configurations. Keep ordinary mixed-auth/single-target behavior unchanged outside the mode.
- [ ] Add config tests for default-off compatibility, every invalid combination, zero targets being
      allowed, `ARC1_MCP_HTTP_RATE_LIMIT` valid/invalid/zero handling, and CLI-over-env precedence.
- [ ] Add a regression test that the current single-target `DEFAULT_CONFIG` still creates a server
      without target discovery.
- [ ] Run focused tests: `npm test -- tests/unit/server/config.test.ts tests/unit/server/server.test.ts`.

### Task 2: Discover and sanitize marked subaccount destinations once at startup

**Files:**
- Create: `src/server/destination-discovery.ts`
- Create: `tests/unit/server/destination-discovery.test.ts`
- Modify: `src/server/server.ts`
- Modify: `package.json` only if an already-declared SAP Cloud SDK import cannot provide the required API

Build a narrow adapter around the BTP Destination Service. Do not make raw Destination Service
responses the registry's data model.

- [ ] Obtain one provider service token from the existing bound Destination service and call the
      subaccount collection once with caching disabled. Use the existing direct
      `@sap-cloud-sdk/connectivity` dependency; do not add a second OAuth implementation or expose
      client credentials to the registry.
- [ ] Define a `RawDiscoveredDestination` boundary type only at the adapter and immediately project
      each result into an allowlisted candidate containing `Name`, `URL`, `ProxyType`,
      `Authentication`, `sap-client`, `CloudConnectorLocationId`, and string-valued `arc1.*`
      additional properties. Drop `User`, `Password`, certificates, auth tokens, and all unrelated
      fields before returning.
- [ ] Do not log the raw payload, serialized destination objects, SAP URL, password, token, or
      assertion on success or failure. Log only collection count and a request-independent startup
      correlation marker.
- [ ] Filter candidate selection by exact `arc1.expose=mcp`; ignore unrelated destinations even when
      they contain ordinary properties such as `WebIDEEnabled=true`.
- [ ] Make a Destination Service collection failure non-fatal to HTTP process startup: treat the
      registry as empty, emit an error/warning stating discovery failed, and keep `/health` healthy.
      Do not retry until restart in v1.
- [ ] Add unit tests for the exact subaccount call, cache disabled, exposure filtering, immediate
      secret removal, unrelated destination handling, zero results, malformed collection entries,
      and service/token failures.
- [ ] Add a source-level/log spy assertion that secret fields cannot reach logger calls.
- [ ] Run focused tests: `npm test -- tests/unit/server/destination-discovery.test.ts`.

### Task 3: Build an immutable fail-closed target registry and effective policies

**Files:**
- Rewrite: `src/server/destination-registry.ts`
- Rewrite: `tests/unit/server/destination-registry.test.ts`
- Modify: `src/server/types.ts`
- Modify: `src/adt/safety.ts` only if a named helper is needed for policy intersection

Replace the prototype's name allowlist/lazy runtime with a pure two-phase registry: validate all
candidates, then quarantine every conflict before exposing any route.

- [ ] Define immutable `TargetId`, `TargetSnapshot`, `TargetPolicy`, `TargetConflict`, and public
      catalog descriptor types. The public ID is `${SID}/${client}`; the internal snapshot also holds
      destination name and the connection fingerprint.
- [ ] Parse `arc1.system` with `^[A-Z][A-Z0-9]{2}$` and require `sap-client` with `^\d{3}$`. Require
      non-empty name/URL, HTTP(S) URL, `ProxyType=OnPremise`, and
      `Authentication=PrincipalPropagation`.
- [ ] Parse only the documented optional `arc1.*` keys. Unknown keys, malformed booleans/lists,
      invalid `arc1.max_concurrent`, or an unsupported connection property quarantine only that
      candidate.
- [ ] Default all target capability booleans to false. Default target concurrency to 4 with a bounded
      accepted range of 1–32. Do not add `arc1.config_version`, environment, role, or a second PP
      destination property.
- [ ] Compute effective safety as the instance ceiling narrowed by target booleans/lists and deny
      actions. Preserve the existing `$TMP` package default when target packages are absent. Prove
      target properties can never broaden global flags, package patterns, transport patterns, or
      denied actions.
- [ ] Force target cache off and add `SAPDiagnose.unittest` plus `SAPDiagnose.atc` to the target's
      effective deny list for v1 without changing the legacy server's tool surface.
- [ ] Detect duplicate destination names across the original multiset and quarantine every matching
      entry before route construction. Do not let `Map.set()` or first/last response order select a
      winner.
- [ ] Detect duplicate `(SID, client)` routes among otherwise valid candidates and quarantine every
      claimant. A target involved in either conflict must not appear in `targets()`, `resolve()`, or
      catalog output.
- [ ] Produce warning records with conflict type, safe destination name(s), and route label where
      available; never include URL, credential, or policy values.
- [ ] Keep the registry immutable for process lifetime. There is no lazy retry, reload endpoint,
      filesystem watcher, destination polling, or runtime mutation in v1.
- [ ] Add tests for minimum read-only config, every validation failure, unknown property, policy
      intersection, `$TMP` inheritance, route construction, duplicate names, duplicate routes,
      order independence, mixed valid/invalid entries, all-invalid, and zero-target registries.
- [ ] Run focused tests: `npm test -- tests/unit/server/destination-registry.test.ts`.

### Task 4: Add target-bound XSUAA roles and verified attribute transport

**External prerequisite PR in `arc-mcp/xsuaa-auth`:**
- Modify: `src/xsuaa.ts`
- Modify: `src/types.ts`
- Modify: `src/facade.ts` if the public facade threads the new verifier option
- Modify: `src/index.ts` only if a new public type must be exported
- Modify: `tests/xsuaa.test.ts`
- Modify: `tests/facade.test.ts` or the closest option-threading test
- Modify: `README.md` and `SECURITY.md`

**ARC-1 files:**
- Modify: `xs-security.json`
- Create: `src/authz/target-access.ts`
- Modify: `src/authz/policy.ts` if shared scope constants/types move there
- Modify: `src/server/http.ts`
- Modify: `src/server/server.ts`
- Modify: `package.json` and `package-lock.json` after the package release
- Create: `tests/unit/authz/target-access.test.ts`
- Modify: `tests/unit/server/http-destinations.test.ts`
- Modify: `tests/unit/server/server.test.ts`

Carry only verified, allowlisted XSUAA user attributes across the generic auth boundary, then bind
the existing functional scopes to exact ARC-1 targets. Do not put SAP target parsing, role-profile
semantics, or catalog policy into `@arc-mcp/xsuaa-auth`.

#### `@arc-mcp/xsuaa-auth` prerequisite

- [ ] Add an optional `userAttributeNames: readonly string[]` (final public name may follow package
      conventions) to `createXsuaaTokenVerifier()` and thread it through the facade. The default is
      empty and omits `extra.userAttributes`, so every existing consumer receives byte-for-byte
      equivalent `AuthInfo` and no extra claims.
- [ ] After `@sap/xssec` successfully creates the security context, read attributes only through
      `securityContext.getAttributes()`. Copy only requested names into a typed
      `AuthInfo.extra.userAttributes` record and normalize accepted scalar/array strings to immutable
      string arrays. Do not decode the raw JWT again or trust a caller-supplied claim object.
- [ ] When a consumer opts in, treat absent attributes as an empty record. Drop or reject malformed
      non-string values under a documented fail-closed contract; never coerce objects/numbers to
      target strings.
- [ ] Never log attribute names and values together, role collections, raw claims, or tokens. Debug
      output may contain only counts and presence booleans.
- [ ] Test default compatibility, selected-name projection, unselected claim removal, scalar/array
      normalization, malformed values, absent user attributes, signature/issuer failure, and PII/log
      redaction. Include a test showing that API-key, OIDC, and client-credentials paths do not
      accidentally acquire XSUAA user attributes.
- [ ] Document that the package verifies and transports attributes but does not interpret them as
      authorization. Release a compatible package version and update ARC-1 only after its package CI
      and security tests pass.

#### ARC-1 target roles and enforcement

- [ ] Preserve all existing functional scopes and role templates unchanged. Add static marker scopes
      `target_viewer`, `target_developer`, `target_data`, `target_sql`, and `target_admin`; these are
      profile markers for named routes and are never accepted as legacy `/mcp` functional scopes.
      Add required string attributes
      `arc1_viewer_targets`, `arc1_developer_targets`, `arc1_data_targets`, `arc1_sql_targets`, and
      `arc1_admin_targets` with `valueRequired=true`, plus parallel `MCPTargetViewer`,
      `MCPTargetDeveloper`, `MCPTargetDataViewer`, `MCPTargetSqlUser`, and `MCPTargetAdmin` role
      templates. Each template carries only its corresponding `target_*` marker scope and attribute;
      it does not carry `read`, `write`, `data`, `sql`, `transports`, `git`, or `admin`.
- [ ] Pass exactly those five attribute names to the XSUAA verifier. Do not expose arbitrary
      `xs.user.attributes` through ARC-1's request context, plugins, audit events, or public extension
      API.
- [ ] Add the five `target_*` marker scopes to ARC-1's XSUAA accepted-scope list, OAuth metadata, and
      DCR/authorization scope handling. Preserve existing legacy scope qualification and requests.
      Test that a named-route OAuth flow actually requests/receives the marker scopes while an
      existing `/mcp` client continues to work with only the legacy scopes.
- [ ] Parse each attribute value as exact `SID:CLIENT` using
      `^[A-Z][A-Z0-9]{2}:\d{3}$`. One role may contain multiple exact targets for teams that share
      authorization. Reject/ignore malformed values with a redacted warning; do not support `*`,
      globbing, prefixes, destination names, URLs, or environment labels in v1.
- [ ] Activate a profile only when both its signed marker scope and its exact target attribute match.
      Project active profiles to target-local functional scopes: Viewer=`read`;
      Developer=`read,write,transports,git`; DataViewer=`data`; SqlUser=`data,sql`; Admin=all current
      functional scopes. Union profiles that match the same exact target. A marker without its
      attribute, or an attribute without its marker, grants nothing.
- [ ] Perform target authorization immediately after authentication and exact route resolution, but
      before Destination Service PP lookup, runtime creation, `tools/list`, or tool dispatch. Pass a
      cloned `AuthInfo` containing only target-effective scopes downstream so existing scope checks,
      schema pruning, `deriveUserSafety()`, plugins, and audits cannot accidentally observe global
      scopes from another target.
- [ ] Require target attributes for every destination-discovered named route, including a one-target
      deployment. Missing attributes, unsupported token types, or no matching target profile return
      the same generic 404 as an unknown target and must not trigger a PP lookup.
- [ ] Keep global legacy roles valid for `/mcp`; ignore every `target_*` scope there. Legacy roles may
      also authorize the named alias of that same explicit legacy destination only after destination
      name and connection fingerprint match the discovered snapshot; SID/client similarity alone is
      insufficient. Standard legacy scopes never authorize any other discovered target, and global
      `MCPAdmin` is not an implicit all-target role. Conversely, a target role alone never authorizes
      `/mcp`.
- [ ] Filter `/` and `/targets` with the same target-access function. Require authentication and
      either legacy `read` or at least one target profile that projects to `read`; include only routes
      whose target-effective scopes contain `read`, and generate the VS Code sample only from that
      filtered list. A token with marker scopes but no currently readable target receives 403 rather
      than an unfiltered or misleading inventory.
- [ ] Add the mandatory escalation regression: Developer(`A4D:100`) + Viewer(`PRD:100`) must yield
      write on A4D and read-only on PRD. Also test reversed role order, multiple targets in one role,
      profile union on one target, marker-without-attribute, attribute-without-marker,
      malformed/absent attributes, target-role isolation from `/mcp`, global admin isolation from
      named targets, legacy alias matching/mismatch, catalog filtering, and no unauthorized PP
      lookup.
- [ ] Document SAP's 16 KB XSUAA token limit and inspect a representative 60-target user token during
      beta acceptance. Exact short target values should remain compact, but v1 must report token
      issuance failures as identity configuration errors rather than weakening authorization.
- [ ] Run focused ARC-1 tests:
      `npm test -- tests/unit/authz/target-access.test.ts tests/unit/server/http-destinations.test.ts tests/unit/server/server.test.ts`.

### Task 5: Isolate target runtime state and verify principal-propagation destination drift

**Files:**
- Modify: `src/server/server.ts`
- Modify: `src/server/context.ts`
- Modify: `src/handlers/feature-cache.ts`
- Modify: `src/handlers/dispatch.ts`
- Modify: `src/adt/http.ts`
- Modify: `tests/unit/server/server.test.ts`
- Modify: `tests/unit/handlers/feature-cache.test.ts`
- Modify: `tests/unit/adt/http.test.ts`

Construct one runtime per accepted snapshot while preserving per-request PP identity. A dynamic
per-user lookup may refresh credentials but may not silently change the target connection.

- [ ] Refactor startup so a legacy server factory is optional and exists only when an explicit
      legacy SAP URL/destination is configured. Do not create a dummy default server from the first
      discovered target.
- [ ] Create per-target runtime config from the immutable snapshot, including exact URL, client,
      system type, effective safety, deny actions, and target ID. Do not copy destination usernames
      or passwords into a discovered runtime.
- [ ] Key feature/discovery stores and request context by public target ID, not destination name.
      Preserve the existing empty/default key for legacy mode.
- [ ] Keep capability probing lazy for PP targets: run it with the first authenticated user's client,
      cache only authorization-neutral system capability facts, and never cache 401/403 as "feature
      absent". Coalesce concurrent first probes per target.
- [ ] Build a connection fingerprint from destination name, canonical URL, `Authentication`,
      `ProxyType`, `sap-client`, and `CloudConnectorLocationId`. Do not include credentials,
      assertions, tokens, or user identity.
- [ ] After every `lookupDestinationWithUserToken()` call, compare the returned connection fields to
      the startup fingerprint before applying auth tokens. Any mismatch returns a minimal
      request-correlated error and instructs the operator to restart; no field is silently accepted.
- [ ] Set both `AdtClientConfig.baseUrl` and `.client` from the verified target snapshot. Ensure
      `sap-client=200` is emitted for a `/.../200/mcp` runtime even if global/legacy client is 100.
- [ ] Keep PP failures fail-closed for JWTs and reject non-user/API-key tokens under strict mode. Do
      not fall back to a shared client for probing, reads, writes, or errors.
- [ ] Ensure sessions, cookies, CSRF state, locks, per-user tokens, and `withSafety()` clients are not
      shared between targets or users. Only immutable config, global limiter/semaphore objects, and
      authorization-neutral target feature facts may be shared.
- [ ] Add tests for two clients on one SID, two SIDs, concurrent first probe, authorization-failure
      non-caching, every fingerprint mismatch field, syntactically equivalent URL normalization,
      client override, strict PP failure, and legacy feature-cache behavior.
- [ ] Run focused tests: `npm test -- tests/unit/server/server.test.ts tests/unit/handlers/feature-cache.test.ts tests/unit/adt/http.test.ts`.

### Task 6: Mount endpoint-pinned MCP routes, protected metadata, and an authenticated catalog

**Files:**
- Modify: `src/server/http.ts`
- Rewrite: `tests/unit/server/http-destinations.test.ts`
- Modify: `tests/unit/server/http.test.ts`
- Modify: `src/server/app-url.ts` only if a shared public-URL join helper is needed

Expose exact routes from the immutable registry and make OAuth metadata agree with each target's
resource URL. Avoid a broad parameter route that can enumerate or reinterpret arbitrary path input.

- [ ] Mount each accepted target at exact `/<SID>/<CLIENT>/mcp`. Route literals come only from
      validated registry values; URL-encode/join with a shared helper and retain generic fallback
      404 handling.
- [ ] Never map a discovered target to `/mcp`. Mount `/mcp` only when the optional legacy server
      factory exists. If there is no legacy target, `/mcp` returns the same generic 404 as an unknown
      target.
- [ ] Detect when an explicit legacy destination also appears as a discovered target. Keep both
      routes active, allow their policies/configs to differ, and log one startup warning identifying
      the duplication without connection details.
- [ ] Serve target-specific Protected Resource Metadata for the exact named resource path and make
      its `resource` value the exact public target URL. Ensure the named route's unauthenticated 401
      points to that PRM URL rather than root `/mcp` metadata.
- [ ] Reuse the existing XSUAA authorization server/scopes; do not create one OAuth client/provider
      per target. Apply Task 4's target authorization before the PP/server factory and preserve the
      path-prefix-aware `ARC1_PUBLIC_URL` behavior.
- [ ] Advertise legacy functional scopes on the legacy resource, the five `target_*` marker scopes on
      discovered named resources, and their union only where shared authorization-server metadata
      requires it. Verify DCR/authorization requests for a named resource include the marker scopes;
      do not make users request or receive one scope per concrete destination.
- [ ] Add authenticated `GET /` and `GET /targets` handlers requiring legacy `read` or at least one
      target profile that projects to `read`, then filter the registry through Task 4's
      target-effective check. JSON includes ARC-1 version, only the caller's accepted target labels
      and exact MCP URLs, and a VS Code/GitHub Copilot sample with
      `{ "servers": { "arc1-A4H-100": { "type": "http", "url": ".../A4H/100/mcp" } } }`.
- [ ] Return HTML from `/` only if it is a simple server-rendered representation of the same sanitized
      data; `/targets` remains the canonical JSON. Do not enable or depend on the optional ARC1 UI.
- [ ] Exclude destination names, SAP/internal URLs, policies, auth types, Cloud Connector IDs,
      conflict details, and quarantined targets from catalog responses.
- [ ] Make unknown/invalid/quarantined targets and internal resolution failures return generic
      non-enumerating errors. Put details only in redacted request-correlated operator logs.
- [ ] Add full Express tests for zero targets, one target, 60 targets, unknown SID/client, duplicate
      quarantine absence, `/mcp` absent/present, legacy/named coexistence, unauthenticated catalog
      401, target-read catalog filtering, another user's targets being absent, insufficient global
      scope, sanitized JSON/HTML, exact PRM resource, correct `WWW-Authenticate`, and path-prefix
      deployments.
- [ ] Run focused tests: `npm test -- tests/unit/server/http-destinations.test.ts tests/unit/server/http.test.ts`.

### Task 7: Add shared MCP edge limits and nested global/target concurrency

**Files:**
- Modify: `src/server/auth-rate-limit.ts`
- Modify: `src/server/http.ts`
- Modify: `src/server/server.ts`
- Modify: `src/adt/semaphore.ts` or create `src/adt/composite-semaphore.ts`
- Modify: `tests/unit/server/auth-rate-limit.test.ts`
- Modify: `tests/unit/server/http-destinations.test.ts`
- Modify: `tests/unit/adt/http.test.ts`

Prevent both target-count amplification and noisy-target starvation. Limits are process-wide unless
the property explicitly says target.

- [ ] Instantiate one `ARC1_MCP_HTTP_RATE_LIMIT` middleware/store for all direct MCP paths. Do not
      create a fresh `express-rate-limit` store while looping over target routes.
- [ ] Apply the same MCP edge bucket to legacy `/mcp`, every named MCP route, and Copilot Studio
      JSON-RPC forwarded through `/authorize`. Keep OAuth `/register`, normal `/authorize`, `/token`,
      `/revoke`, and callback on `ARC1_AUTH_RATE_LIMIT`.
- [ ] Keep `ARC1_RATE_LIMIT` one shared per-user quota across all target routes so a user cannot
      multiply their allowance by connecting to more systems.
- [ ] Retain one `ARC1_MAX_CONCURRENT` FIFO semaphore across every target and user. Add one runtime
      target semaphore using `arc1.max_concurrent` (default 4).
- [ ] Acquire the global and target permits in one consistent order and release both in `finally` on
      success, SAP error, timeout, abort, and retry. Avoid deadlocks and do not multiply semaphores per
      PP user.
- [ ] Preserve current Retry-After behavior. A retried SAP request remains bound to the same target
      and both capacity layers.
- [ ] Add tests proving requests across routes share one IP bucket, OAuth and MCP buckets are
      independent, per-user counts span targets, global cap spans targets, target cap isolates a hot
      target, FIFO progress, and no permit leak on errors.
- [ ] Add CodeQL-conscious direct middleware mounts or a tested shared-store construction that keeps
      the existing missing-rate-limiting query closed; document any necessary code shape in comments.
- [ ] Run focused tests: `npm test -- tests/unit/server/auth-rate-limit.test.ts tests/unit/server/http-destinations.test.ts tests/unit/adt/http.test.ts`.

### Task 8: Complete audit, error, and security boundaries for target routing

**Files:**
- Modify: `src/server/audit.ts`
- Modify: `src/server/logger.ts`
- Modify: `src/server/context.ts`
- Modify: `src/handlers/dispatch.ts`
- Modify: `src/server/server.ts`
- Modify: `docs/security-model.md`
- Modify: `tests/unit/server/server.test.ts`
- Modify: `tests/unit/handlers/dispatch-misc.test.ts`
- Create or modify: audit/logger unit tests matching existing sink coverage

Make the target visible enough for operators to audit without leaking destination configuration to
users or sinks.

- [ ] Add a normalized public `target` field (`A4H/100`) to tool lifecycle, PP creation, rate-limit,
      and SAP HTTP audit events. Keep legacy events backward compatible by omitting it when no named
      target is active.
- [ ] Attach target ID automatically from `AsyncLocalStorage` so nested ADT HTTP events cannot forget
      it. Do not attach raw destination objects or route parameters.
- [ ] Retain destination name only where an operator must repair discovery/config conflicts; ensure
      central audit redaction and structured log serializers cannot emit URL, passwords, tokens,
      assertions, `VCAP_SERVICES`, or policy payloads.
- [ ] Give external initialization/drift errors a generic message plus `requestId`; keep actionable
      field-level details in server logs. Test `ARC1_MINIMAL_ERRORS` cannot be bypassed by a target
      error.
- [ ] Ensure target-local ATC/unittest denials apply both to `tools/list` pruning and direct crafted
      calls. Legacy single-target calls remain unchanged.
- [ ] Add security regression tests for unknown route enumeration, cross-target feature state,
      cross-user PP tokens, raw destination logging, fail-open PP fallback, policy widening, and
      credential-bearing collection responses.
- [ ] Update `docs/security-model.md` with endpoint-confusion, destination-admin policy, inventory
      disclosure, conflict, drift, and shared-process blast-radius threats plus the mitigations and
      accepted residual risks.
- [ ] Run focused tests for dispatch, logger/audit sinks, and server PP behavior.

### Task 9: Update deployment descriptors, ADRs, and end-user documentation

**Files:**
- Modify: `mta.yaml`
- Modify: `mta-overrides.mtaext.example`
- Modify: `manifest.yml`
- Modify: `.env.example`
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `docs/adr/0005-single-system-per-instance.md`
- Create: `docs/adr/0006-endpoint-pinned-multi-target.md`
- Modify: `docs/multi-destination-evaluation.md`
- Rewrite: `docs_page/multi-destination.md`
- Modify: `docs_page/configuration-reference.md`
- Modify: `docs_page/architecture.md`
- Modify: `docs_page/authorization.md`
- Modify: `docs_page/security-guide.md`
- Modify: `docs_page/btp-cloud-foundry-deployment.md`
- Modify: `docs_page/btp-destination-setup.md`
- Modify: `docs_page/principal-propagation-setup.md`
- Modify: `docs_page/rate-limiting.md`
- Modify: `docs_page/index.md`
- Modify: `docs_page/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `mkdocs.yml` if navigation changes

Make setup copyable and make every old one-system claim consciously historical, superseded, or
updated. Do not leave two contradictory supported configurations in published docs.

- [ ] Change active MTA destination placeholders into commented legacy examples so a fresh MTAR can
      deploy and pass `/health` before destinations exist. Document that enabling a legacy `/mcp`
      target still requires setting the legacy destination explicitly.
- [ ] Add a commented multi-target block in `mta.yaml` with
      `ARC1_MULTI_TARGET=true`, `ARC1_CACHE=none`, `ARC1_RATE_LIMIT=120`,
      `ARC1_MCP_HTTP_RATE_LIMIT=3000`, `ARC1_MAX_CONCURRENT=40`, UI off, plugins absent, strict PP,
      and conservative `SAP_ALLOW_*` ceilings. State that these are a 6–20 active-user starting point,
      not universal capacity guarantees.
- [ ] Document sizing presets: 1–5 active users = MCP HTTP 1000, user 120, global 10, target 4;
      6–20 = 3000/120/20 (or 40 only when SAP capacity permits)/4; 21–50 = 7500/180/40/6;
      51–100 = 15000/180/60/6–8. Keep the authoritative SAP formula
      `floor(0.6 * rdisp/wp_no_dia / ARC1_instances)` and warn that client targets sharing one SID
      consume the same SAP dialog pool.
- [ ] Explain `ARC1_MAX_CONCURRENT=40` is an educated starting point for the intended 20-system ×
      3-client deployment only when backend capacity supports it. The local A4H recovery profile may
      have only 10 dialog WPs, so test/beta values must follow live `rdisp/wp_no_dia`, not copy 40.
- [ ] Document the minimum read-only destination, every optional property/default, global-vs-target
      ownership, `$TMP` inheritance, strict SID/client formats, conflict quarantine, drift/restart
      rule, and one-PP-destination trade-offs (no unauthenticated startup health/probe, first-user
      probe latency, no technical-user fallback).
- [ ] Document that destinations can be exported/imported through BTP Cockpit in Properties/YAML/JSON
      for templating, but exported files may contain secrets and must not be committed or pasted into
      logs/issues.
- [ ] Document the unchanged legacy and new target-aware XSUAA templates, the five target attributes,
      exact `SID:CLIENT` values, one-or-many targets per role, role/role-collection creation through
      BTP Cockpit/CLI, assignment lifecycle, and the five-layer authorization intersection. Adding a
      destination requires an ARC-1 restart and a role assignment before any user can see it, but no
      MTAR rebuild after the target templates have been deployed once.
- [ ] Document catalog access and include a sanitized `.vscode/mcp.json` example. Clarify that it lists
      only targets carrying effective target-level `read`, while the propagated SAP user must still
      be authorized/mapped in every listed client. Include the Developer(A4D) + Viewer(PRD) example
      and explain why a single flattened `systems` attribute is forbidden.
- [ ] Document the 16 KB XSUAA token limit, recommend grouping multiple exact targets into one role
      only when the user population and role profile truly match, and provide a diagnostic for token
      issuance failures. Do not introduce target wildcards merely to reduce claim size.
- [ ] Document v1 exclusions: S/4HANA Public Cloud/SAMLAssertion, SaaS/subscriber discovery,
      instance/provider/cross-subaccount discovery, hot reload, cache, plugins, UI, ATC, ABAP Unit,
      API-key/OIDC/client-credentials access to discovered routes, target wildcards, and an aggregate
      endpoint. Credit Geert-Jan's offer for the Public Cloud follow-up without promising a release.
- [ ] Mark ADR-0005 `Superseded by ADR-0006`; preserve its original rationale as historical context.
      ADR-0006 must explain why endpoint-pinned target routes satisfy the anti-confused-deputy goal
      while tool parameters and runtime target switching remain forbidden.
- [ ] Update `AGENTS.md` Design Principle 7, task routing, config table, architecture flow, security
      invariants, and key files so future agents do not reject or accidentally broaden the feature.
- [ ] Update README, site index, roadmap, and feature matrix as experimental/default-off. Keep dated
      research documents historically accurate; add a supersession note instead of rewriting their
      past conclusions.
- [ ] Build docs locally if a docs command exists and check repository-wide references to
      `SAP_BTP_DESTINATIONS`, `/mcp/:dest`, `/mcp/<name>`, default destination aliasing,
      `arc1.pp_destination`, suffixed target env vars, and absolute "never multi-system" language.

### Task 10: Add real BTP integration and authenticated multi-target E2E acceptance

**Files:**
- Create: `tests/integration/multi-target-btp.integration.test.ts`
- Create: `tests/e2e/multi-target.e2e.test.ts`
- Modify: `tests/e2e/helpers.ts`
- Modify: `tests/e2e/vitest.e2e.config.ts`
- Modify: `tests/helpers/skip-policy.ts` only if a genuinely new runtime prerequisite category is needed
- Modify: `docs/integration-test-skips.md` only when the shared taxonomy changes
- Create or modify: beta deployment/runbook script under `scripts/` if repeatable setup cannot use existing CF commands

Validate the feature through real Destination Service, Cloud Connector, XSUAA, PP, and SAP, not only
mocked Express handlers. The beta app must be separate from currently used ARC-1 applications.

- [ ] Extend the E2E HTTP client helper to accept an explicit user bearer token without logging it.
      Fail fast when the multi-target E2E suite is selected without `E2E_ACCESS_TOKEN`; do not silently
      pass or skip the whole suite.
- [ ] Deploy a separate `arc1-multi-target-beta` CF app from this branch, bind existing test
      Destination/Connectivity/XSUAA services, use a unique route, `ARC1_CACHE=none`, UI/plugins off,
      and concurrency values sized to the live test SAP system. Do not replace the current production
      or ordinary E2E app.
- [ ] Create/export temporary PP destinations with a unique `ARC1_E2E_` prefix for: one valid
      read-only target, one second valid target/client if available, one malformed target, one
      duplicate-name input where the test adapter can reproduce it, and two destinations claiming one
      route. Back up before modification and clean up after the run without printing exports.
- [ ] Add live integration assertions for subaccount collection discovery, marker filtering,
      minimum property parsing, proxy/location ID retention, secret sanitization, zero matches, and
      service error handling. Integration credentials are a setup requirement and must fail fast when
      this suite is explicitly invoked.
- [ ] E2E zero-target startup first: verify `/health` 200, `/targets` requires auth then returns empty,
      `/mcp` and named routes do not enumerate, and adding a destination has no effect before restart.
- [ ] Create temporary target-aware XSUAA roles/collections for the test users without modifying the
      legacy role templates. Cover one Viewer target, one Developer target, and—where two routes are
      available—Developer(A4D/client) + Viewer(second target). Record only role names and target IDs,
      never tokens or unrelated user attributes, and remove temporary assignments in cleanup.
- [ ] Restart and verify valid targets appear only at `/<SID>/<CLIENT>/mcp`, catalog/VS Code sample
      URLs are exact and filtered per test user, `/mcp` remains absent without legacy config, PRM and
      401 metadata match the target resource, and malformed/conflicted/unauthorized targets remain
      absent.
- [ ] With a mapped XSUAA user, connect through PP and run `tools/list`, `SAPRead SYSTEM`, and one
      source read on every available test target. Verify the reported SAP client/system matches the
      route and no request leaks to another target.
- [ ] With an unmapped/unauthorized user or client, verify PP fails closed and never reaches a shared
      technical identity. Confirm login/auth failures are present in redacted CF/audit logs with
      request/target correlation and no assertion/token.
- [ ] Prove target authorization runs before PP: a valid XSUAA user without the target attribute gets
      the generic non-enumerating response and produces no Destination Service user-token lookup.
      Prove the mixed Developer/Viewer user cannot list or call write actions on the Viewer target.
- [ ] Exercise destination drift: change `sap-client` or URL after startup, prove the next per-user
      call is rejected, restart, then prove the new valid snapshot is used. Restore the destination in
      best-effort cleanup.
- [ ] If a dedicated `$TMP` development target is available, set both global and target write consent,
      create/activate/read/delete a unique class or program, and prove an out-of-package write is
      refused. Also prove target `allow_writes=true` cannot override global false. Do not run this
      against production/read-only QA clients.
- [ ] Run shared-capacity smoke with concurrent reads across at least two routes and verify global and
      target caps from logs/timing without exhausting SAP dialog work processes.
- [ ] Run `npm run test:integration` plus the selected live multi-target integration file with the
      required BTP binding environment.
- [ ] Run `E2E_MCP_URL=https://<beta>/<SID>/<CLIENT>/mcp npm run test:e2e` for the ordinary regression
      surface, then run the new multi-target E2E file with explicit target URLs and user token.
- [ ] Record only sanitized outcomes (target labels, counts, status, version, timestamps) in the PR;
      never attach destination exports, CF env, access tokens, PP assertions, or credentials.

### Task 11: Final verification and plan completion

- [ ] Run full unit suite: `npm test` — all tests pass.
- [ ] Run typecheck: `npm run typecheck` — no errors.
- [ ] Run lint: `npm run lint` — no errors.
- [ ] Run build: `npm run build` — no errors and MTA build inputs are present.
- [ ] Run the integration and E2E commands from Task 10 against the separate beta CF app; attach only
      sanitized pass/fail evidence to the draft PR.
- [ ] Verify a current single-target legacy deployment from the same build still serves only `/mcp`,
      keeps its existing cache/UI/plugin/tool behavior, and does not call subaccount discovery.
- [ ] Verify a multi-target deployment with no legacy target has no `/mcp` alias, while a deployment
      with an explicitly configured legacy target serves both `/mcp` and named routes and emits the
      intended duplicate warning when applicable.
- [ ] Verify duplicate destination names and duplicate routes expose none of the conflicting targets
      regardless of input order; external responses and catalog remain non-enumerating.
- [ ] Verify the minimum destination is read-only; data, SQL, writes, transports, and Git require
      their target opt-ins plus target-bound role scopes, global ceiling, and SAP authorization;
      missing package config keeps `$TMP` behavior.
- [ ] Verify Developer(A4D) + Viewer(PRD) cannot write to PRD; global legacy roles and `MCPAdmin`
      cannot access unrelated discovered targets; unattributed/API-key/OIDC/client-credentials tokens
      cannot reach PP lookup; and the catalog never reveals another user's targets.
- [ ] Verify every named route's PRM, `WWW-Authenticate`, catalog URL, and generated VS Code entry is
      exact under both root and `ARC1_PUBLIC_URL` path-prefix deployments.
- [ ] Inspect logs/audit output for secrets and cross-target labels; confirm raw destination payloads,
      URLs, credentials, tokens, assertions, policies, and `VCAP_SERVICES` never appear.
- [ ] Search for stale implementation contracts:
      `rg -n 'SAP_BTP_DESTINATIONS|/mcp/:dest|/mcp/<name>|arc1\.pp_destination|SAP_ALLOW_.*_<DEST>|one SAP system per instance|never ARC-1' .`
      and resolve every non-historical match.
- [ ] Run the security checklist in `docs/security-model.md` for auth/PP, safety ceilings, URL routing,
      logs/audit, caches, request limits, and shared-process isolation.
- [ ] Obtain Wouter's review of the new architecture and attribution/history approach before marking
      the draft ready. Resolve design feedback or record a deliberate follow-up issue.
- [ ] Move this plan to `docs/plans/completed/destination-discovered-multi-target-v1.md` only after all
      acceptance evidence is complete, and update any plan links in the PR description.
