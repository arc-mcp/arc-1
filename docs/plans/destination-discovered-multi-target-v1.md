# Destination-Discovered Multi-Target V1

## Status

- **State:** implemented and beta-validated; draft PR pending review
- **Implementation branch:** `codex/multi-target-v1`
- **Code ancestry:** PR #543 remains in the branch history so Wouter's tested multi-runtime work can
  be reused where it fits. The public contract described here replaces the prototype contract.
- **Release model:** experimental and default-off on `main` after beta validation; no long-lived beta
  release branch is required.
- **Target platform:** SAP BTP Cloud Foundry, subaccount destinations, XSUAA, on-premise
  `PrincipalPropagation`
- **Scale target:** 100 SAP system/client targets is a normal intended deployment; v1 supports at
  most 256 enabled targets.

This document is the execution plan and normative v1 specification. When a code comment, the PR
#543 prototype, ADR-0005, or older documentation disagrees with it, this document wins until the new
ADR is accepted.

## Outcome

One ARC-1 CF application can discover explicitly marked BTP subaccount destinations at startup and
serve the same target in two ways:

- a target-pinned endpoint such as `/A4H/100/mcp`; and
- an aggregate endpoint at `/multi/mcp`, where each SAP-contacting tool has one required `target`
  argument such as `A4H/100`.

Both endpoint styles are enabled together with `ARC1_MULTI_TARGET_ENDPOINTS=true`. Bare `/mcp` is
never assigned to a discovered target. An explicitly configured legacy single target may continue
to use `/mcp` side by side with the discovered routes.

Multi-target v1 is deliberately read-only at the mutation boundary. Source and metadata reads are
available by default. Data preview and freestyle SQL require explicit consent in both the ARC-1
instance and the selected destination. All mutation tools and actions remain unavailable on pinned
and aggregate multi-target routes, even for `MCPAdmin` and even if the legacy `/mcp` target permits
writes.

The effective permission for a multi-target call is:

```text
instance safety ceiling
  ∩ destination target policy
  ∩ global XSUAA scopes
  ∩ propagated SAP user authorization
  ∩ multi-target v1 read-only hard ceiling
```

There are no target-specific XSUAA roles or role attributes in v1. A user with the global read scope
can see all accepted target identifiers and may attempt any of them. SAP, through principal
propagation, remains the target-specific authorization boundary.

## Locked Decisions

| Area | V1 decision |
|---|---|
| Activation | `ARC1_MULTI_TARGET_ENDPOINTS=true`; absent/false preserves current behavior. |
| Discovery | One startup snapshot of BTP **subaccount** destinations; no provider, subscriber, cross-subaccount, or SaaS discovery. |
| Candidate marker | `arc1.enabled=true` is the only required ARC-1-specific destination property. |
| Target identity | Standard `sap-sysid` plus required `sap-client`; public ID is `SID/CLIENT`. |
| Routes | Both `/<SID>/<CLIENT>/mcp` and `/multi/mcp`; no discovered bare `/mcp` alias. |
| Aggregate selection | Required top-level `target` on every SAP-contacting tool; no default, current, or session target. |
| Maximum | 256 enabled candidates. More than 256 makes the discovered registry unavailable; ARC-1 never silently chooses a subset. |
| Authentication | XSUAA only for multi-target endpoints in v1; strict per-user PP; no shared SAP identity fallback. |
| Authorization | Existing global scopes; no target-specific XSUAA or role-model change. A scoped additive `@arc-mcp/xsuaa-auth` BTP-destination API change is required for uncached PP lookup and original properties. |
| Target policy | Read by default; `arc1.allow_data_preview` and `arc1.allow_free_sql` are explicit per-target opt-ins. |
| Writes | Impossible on multi-target routes in v1. Do not document or test a multi-target full-write configuration. |
| Cache | `ARC1_CACHE=none` while the mode is enabled. |
| Tool surface | Standard mode only; no hyperfocused alias, plugins, optional UI, SAPLint, ATC, or ABAP Unit on multi-target routes. |
| Catalog | Protected JSON `/targets` requires global read and expands automatically for global admin. A browser HTML root is deferred because v1 has no cookie/session login. |
| Target discovery tool | `SAPTargets` exists only on the aggregate server and only when more than one target is accepted. |
| User availability | Never guessed, probed in bulk, persisted, or negatively cached. A failed target call may be retried immediately. |
| Destination changes | Take effect only after a normal CF app restart; no rebuild or MTAR redeployment. |
| PP destination count | One PP destination per system/client in v1. A separate technical/design-time destination is deferred. |
| Initial backend | On-premise + PP. S/4HANA Public Cloud/SAML assertion follows after v1 with dedicated testing. |
| Deployment | Multiple CF app instances are supported and tested; `mta.yaml` stays at one instance by default. |
| Health | Registry/configuration errors keep `/health` at 200 with an `error` component so protected admin diagnostics remain reachable; affected MCP routes return 503. Valid snapshots, including zero-target snapshots, report `ready`. |

## Existing Baseline and Compatibility

PR #543 already provides useful implementation pieces:

- multiple destination runtimes in one process;
- destination-keyed feature state;
- request context and audit target fields;
- HTTP routing to more than one MCP server; and
- unit tests around multi-runtime behavior.

The following PR #543 contracts are prototype-only and must be replaced:

- `SAP_BTP_DESTINATIONS` CSV allowlisting;
- destination-name routes at `/mcp/<destination>`;
- assigning bare `/mcp` to the first/default discovered destination;
- lazy destination discovery and retry after startup;
- `arc1.expose`, `arc1.system`, write policy, second PP destination, and destination-suffixed env
  overrides;
- returning destination names or initialization details to ordinary callers; and
- allowing mutations on a discovered route.
- destination-name cache files/feature-cache keys, inherited `sap-client`, `resolvePpDestinationName`
  fallback, retry memoization, and registry-dependent PRM responses.

The prototype was never released. This PR deletes `SAP_BTP_DESTINATIONS`, `/mcp/<destination>`, its
PRM alias, destination-suffixed env overrides, and its write-capable policy parsing outright. There
is no compatibility period or second hidden multi-destination mode to preserve.

Compatibility rules:

1. With `ARC1_MULTI_TARGET_ENDPOINTS` absent or false, startup, configuration, `/mcp`, tools, auth,
   cache, UI, plugins, and current tests behave exactly as they do today.
2. Enabling multi-target adds routes; it does not repurpose `/mcp`.
3. A separately configured legacy target can keep `/mcp`, including its current write behavior.
   The multi-target read-only ceiling applies only to discovered pinned and aggregate routes.
4. Process-wide multi-target prerequisites still apply while the flag is enabled: HTTP transport,
   XSUAA, cache off, standard tool mode, UI off, and no plugins. Strict PP is a per-runtime invariant
   for discovered targets, not a process-wide legacy setting.
5. If the legacy `/mcp` connection and a discovered target have the same connection fingerprint,
   both remain usable. Log an operator warning because their policies can differ and the duplicate
   exposure is probably accidental.
6. API-key and direct OIDC authentication remain unchanged for legacy `/mcp`, but do not authorize
   `/targets`, pinned multi-target routes, or `/multi/mcp` in v1. Multi routes use an XSUAA-only
   verifier chain rather than inspecting a shared `AuthInfo` after authentication.

## Configuration Contract

### Instance configuration

Add one mode flag:

```yaml
ARC1_MULTI_TARGET_ENDPOINTS: "true"
```

There is deliberately no discovery-scope enum: v1 can only search the bound subaccount. There is no
`targets.yaml`, CSV target list, target-specific environment suffix, or per-target config in
`mta.yaml`.

When the flag is true, validate:

- `SAP_TRANSPORT=http-streamable`;
- XSUAA, Destination, and Connectivity service bindings are present;
- `SAP_XSUAA_AUTH=true`;
- `ARC1_CACHE=none`;
- `ARC1_TOOL_MODE=standard`;
- `ARC1_UI=off`;
- `ARC1_PLUGINS` is empty;
- `SAP_PP_ALLOW_SHARED_COOKIES=false` and `SAP_COOKIE_FILE`/`SAP_COOKIE_STRING` are absent;
- the runtime is BTP CF destination mode, not service-key, cookie, direct URL, or stdio mode; and
- a request reaching a multi-target route authenticated by API key or direct OIDC is rejected.

Every discovered runtime hardcodes `ppEnabled=true` and `ppStrict=true`, regardless of the legacy
`SAP_PP_ENABLED`/`SAP_PP_STRICT` values. Those existing env values continue to control only the
optional legacy `/mcp` runtime. This per-runtime split is required to preserve API-key/direct-OIDC
legacy behavior while giving multi routes strict PP with no shared fallback.

Zero destinations is valid. The process must be deployable before the administrator creates the
destinations.

The existing instance values remain the absolute ceiling:

- `SAP_ALLOW_DATA_PREVIEW`;
- `SAP_ALLOW_FREE_SQL`;
- `SAP_DENY_ACTIONS`;
- XSUAA role scopes;
- `ARC1_MAX_CONCURRENT`, `ARC1_RATE_LIMIT`, and auth/HTTP rate limits; and
- error, audit, CORS, and public-URL security settings.

An optional legacy `/mcp` target continues to use the existing single-target variables, including
`SAP_BTP_DESTINATION` and, where configured, `SAP_BTP_PP_DESTINATION`. Discovered targets never
inherit those destination names or their policy. They are compared only for the duplicate-connection
warning described above.

`mta.yaml` will contain a commented experimental block, not active placeholder targets. Users who
build their own MTAR from source uncomment the block, keep the conservative instance ceiling, deploy
once, create destinations, and restart the app.

For a multi-only deployment, `SAP_BTP_DESTINATION` and `SAP_BTP_PP_DESTINATION` must be absent. The
base MTA's current `your-basic-destination`/`your-pp-destination` placeholders are removed. Set those
variables only when intentionally retaining a legacy `/mcp` target.

### Supported destination properties

An enabled v1 destination has this logical schema:

| Property | Required | Validation and meaning |
|---|---:|---|
| `Name` | yes | Internal BTP identifier. Never exposed to normal read users or used as a route ID. |
| `Type` | yes | Exactly `HTTP`. |
| `URL` | yes | Backend URL resolved through Destination Service. Secret-safe normalized fingerprint only; never returned. |
| `ProxyType` | yes | Exactly `OnPremise`. |
| `Authentication` | yes | Exactly `PrincipalPropagation`. |
| `sap-sysid` | yes | Standard SAP property; exactly `^[A-Z][A-Z0-9]{2}$`. Hyphen and underscore are invalid. |
| `sap-client` | yes | Exactly three digits (`^\d{3}$`). There is no implicit client 100. |
| `Description` | recommended | Single line, at most 160 characters. Missing/invalid values warn and fall back to `SID/CLIENT`. |
| `sap-language` | no | Optional SAP request language after existing validation; target value wins, otherwise inherit instance `SAP_LANGUAGE`. |
| `CloudConnectorLocationId` | no | Used for lookup/fingerprint; admin output exposes only whether it is present. |
| `arc1.enabled` | yes | Only required ARC-1 property. String boolean; trimmed, case-insensitive `true` enables and `false` disables. |
| `arc1.allow_data_preview` | no | String boolean, default false. Can only narrow/intersect the instance ceiling. |
| `arc1.allow_free_sql` | no | String boolean, default false. Can only narrow/intersect the instance ceiling. It does not automatically enable named data preview. |

Property names are case-sensitive. Boolean values accept trimmed case-insensitive `true` and
`false`; every other value is invalid. The docs recommend lowercase values.

There is no `arc1.config_version` in v1. The strict property allowlist is the schema, and there is no
second destination schema to negotiate yet.

The v1 allowlist intentionally excludes write, package, transport, Git, per-target concurrency,
secondary-destination, and arbitrary header/query configuration. In particular,
`arc1.allow_writes`, `arc1.allowed_packages`, `arc1.allow_transport_writes`, and
`arc1.allow_git_writes` are not a hidden preview. An enabled candidate containing one of them is
quarantined as `UNSUPPORTED_V1_WRITE_CONFIG`.

This does not change the existing `$TMP` default or package gates on a separately configured legacy
`/mcp` target. Package policy is simply irrelevant to multi-target v1 because mutations cannot be
listed or dispatched there.

An unknown `arc1.*` property on an enabled candidate quarantines it. This makes spelling mistakes
fail closed. A destination with no valid `arc1.enabled=true` is not a routing candidate. For admin
diagnostics, detect the `arc1.` prefix case-insensitively so a wrong-case key is still visible, but
accept only the exact lowercase allowlisted property names. Thus `ARC1.Enabled` appears as a safe
configuration error instead of disappearing as unrelated.

Treat `Description` as untrusted administrator-controlled display text: normalize Unicode, remove
control characters, collapse line breaks, enforce the length limit, JSON-encode it normally, and
never interpret it as an LLM instruction. It is visible to read users and the LLM only as a label.

### Examples

Minimum source-read target:

```properties
Name=ARC1_A4H_100_PP
Type=HTTP
URL=http://a4h-abap.internal:50000
ProxyType=OnPremise
Authentication=PrincipalPropagation
sap-sysid=A4H
sap-client=100
Description=A4H development client 100
arc1.enabled=true
```

Data preview and SQL target (still mutation-free):

```properties
Name=ARC1_BWQ_200_PP
Type=HTTP
URL=http://bwq-abap.internal:50000
ProxyType=OnPremise
Authentication=PrincipalPropagation
sap-sysid=BWQ
sap-client=200
Description=BW quality analytics client 200
arc1.enabled=true
arc1.allow_data_preview=true
arc1.allow_free_sql=true
```

The second example is effective only when the instance also sets
`SAP_ALLOW_DATA_PREVIEW=true` and `SAP_ALLOW_FREE_SQL=true`, and the user has the corresponding XSUAA
scopes and SAP authorization.

## Discovery and Immutable Registry

### Startup algorithm

1. Obtain the Destination service credentials from the CF binding.
2. Fetch the full subaccount destination collection once with caching disabled.
3. Fetch the full service-instance destination collection and immediately project it to **names
   only** for collision detection. Both list APIs can return credentials; instance-level
   destinations are never selected as v1 targets.
4. Immediately project every response into an allowlisted, secret-free intermediate shape. Never
   retain or log the raw Destination Service response.
5. Count ARC-adjacent entries that have the standard `sap-sysid` or `sap-client` fields but no
   `arc1.*` property. Do not expose their names; the count helps diagnose a missing marker.
6. Identify ARC-related entries (at least one property with a case-insensitive `arc1.` prefix).
7. Parse `arc1.enabled` and normalize safe standard fields.
8. If more than 256 candidates are enabled, activate none and mark the multi registry unavailable
   with `TARGET_LIMIT_EXCEEDED`. Do not choose the first 256.
9. Validate candidate connection fields, target ID, description, and policy.
10. Detect all conflicts, quarantine every claimant, and never select a winner.
11. Build all accepted runtimes and tool surfaces into one immutable process snapshot.
12. Compute a deterministic registry revision by sorting ARC-related entries by destination name
    and hashing fixed-field-order canonical JSON of safe normalized configuration. Exclude
    `loadedAt`, response ordering, timestamps, credentials, and raw objects.
13. Mount the pinned and aggregate routes from the snapshot.

### Conflict rules

- Duplicate public target `(sap-sysid, sap-client)`: quarantine every claimant as
  `DUPLICATE_TARGET`.
- Duplicate destination name in the discovery input: quarantine every claimant as
  `DUPLICATE_DESTINATION_NAME`.
- A subaccount destination whose name is also present at service-instance level: exclude it as
  `SHADOWED_BY_INSTANCE`. This matches the Destination Find API precedence risk and prevents PP
  lookup from silently resolving a different object.
- No conflict is broken by ordering, destination update time, or lexical name.

### Runtime drift check

Per-user PP requires a fresh Destination Find lookup with the SAP Cloud SDK destination cache
bypassed. Before building the user's ADT client, compare the result to the startup fingerprint:

- destination name;
- canonical URL;
- authentication type;
- proxy type;
- `sap-client`;
- Cloud Connector location ID; and
- target SID/client and language properties; and
- all supported normalized `arc1.*` policy properties.

Any mismatch rejects the call as `TARGET_CONFIG_CHANGED` and instructs the operator to restart. This
also catches a newly created instance-level destination shadowing a subaccount target. Never refresh
or mutate the snapshot in place.

The current `@arc-mcp/xsuaa-auth` lookup drops custom/original properties and always sets
`useCache:true`. V1 therefore requires a scoped additive package change that:

- exposes original destination properties needed for the fingerprint;
- offers an explicit uncached per-user lookup used only by multi-target runtimes;
- never stores `authTokens[].error` or another failed PP result; and
- exposes a narrow supported helper for startup destination collection/token acquisition, or a
  package-owned level-specific list API, so ARC-1 does not deep-import private token code.

This does not change XSUAA scopes, roles, token claims, or the generic authorization model. The
uncached lookup adds one Destination Service resolution to each SAP-contacting multi-target call;
measure its latency and service load in beta before considering a success-only cache. Immediate
drift detection and immediate retry after a PP fix take precedence in v1.

Every ADT client must be constructed with the snapshot client so `src/adt/http.ts` sends the same
`sap-client` on every request. Do not share one mutable ADT client across targets. Shared stateless
code is fine; authentication sessions, safety, feature state, cache state, and request context are
target/user scoped as appropriate.

## Authorization and Principal Propagation

### XSUAA stays global

Do not add target attributes, dynamic roles, profile/target pairing, or target scopes to
`xs-security.json`. `@arc-mcp/xsuaa-auth` changes are limited to the BTP destination helpers described
above; its verifier and scope model remain unchanged.

Existing functional scopes continue to mean:

| Scope/role | Multi-target effect |
|---|---|
| `read` / Viewer | Authenticate to the catalogs and all multi-target MCP routes; list all accepted target IDs; invoke source/metadata reads. |
| `data` / Data Viewer | Permit target data operations only when the selected target and instance both enable data preview. |
| `sql` / SQL User | Permit `SAPQuery` only when the selected target and instance both enable free SQL. Existing role collections must still include/read-compose the needed read/data scopes. |
| `admin` / Admin | Receive expanded `/targets` diagnostics. It does **not** bypass destination policy, SAP auth, or the v1 mutation prohibition. |

All accepted targets are visible to a global read user. This does not prove that the propagated SAP
user is mapped or authorized in any target. V1 deliberately has no per-target ARC ACL because that
would require a reliable user-target entitlement source and a more complex XSUAA model. Administrators
who need different target visibility must use separate ARC-1 instances until a later ACL design is
accepted.

### Route auth order

For `/targets`, `/<SID>/<CLIENT>/mcp`, and `/multi/mcp`:

1. Validate XSUAA and require at least the global read scope before resolving whether a syntactically
   valid target exists.
2. Resolve the target/route from the immutable registry.
3. Apply XSUAA functional scope pruning.
4. Apply the instance and target policy intersection.
5. Exchange the user's token through Destination/Connectivity PP.
6. Let SAP enforce the user's system/client authorization.

This order prevents unauthenticated route enumeration. OAuth metadata, health, and standards-required
discovery endpoints may remain public but must contain no target inventory.

Multi-target routes use an XSUAA-only bearer verifier. API-key and direct OIDC tokens fail as 401
with the correct route-family protected-resource metadata challenge before registry membership is
checked. Legacy `/mcp` keeps the existing verifier chain and legacy PP/shared-client behavior.

There is no technical/shared fallback when PP exchange, SAP login, mapping, or authorization fails.
One PP destination per target is sufficient for v1. Document the tradeoffs: no technical-user startup
probe, the first authorized user may pay feature-probe latency, and feature availability must never be
inferred from an unauthorized user's response.

## Endpoint Contract

### Pinned MCP endpoints

Use one snapshot-independent, case-sensitive syntactic matcher for:

```text
/<SID>/<CLIENT>/mcp
```

The matcher runs XSUAA authentication and the global read check before registry lookup. Do not mount
one Express route only for each accepted target: registered and unregistered syntactically valid
paths must both return 401 before authentication. After authentication, an unknown target returns a
generic HTTP 404 without an accepted-target list. Syntactically invalid paths may use the generic
unauthenticated 404 because syntax is not inventory.

Pinned URLs are canonical uppercase and case-sensitive. `/a4h/100/mcp` is not an alias for
`/A4H/100/mcp`. Mount the case-sensitive pinned matcher before legacy lowercase `/mcp` middleware so
the valid SAP SID `MCP` does not collide with the legacy endpoint.

Pinned endpoints keep ordinary argument shapes: no `target`, `system`, `client`, or destination
argument is added. Their tool/action set is still the pruned multi-target read-only surface, not the
legacy full surface.

### OAuth protected-resource metadata

RFC 9728 metadata must be registry-independent:

- for every syntactically valid `/<SID>/<CLIENT>/mcp` resource, the corresponding public PRM URL
  returns 200 whether or not the target exists;
- `/multi/mcp` has its own fixed PRM resource;
- the document echoes the canonical requested resource and shared XSUAA authorization server but
  never consults or exposes the registry; and
- each 401 `WWW-Authenticate` challenge points to metadata whose `resource` exactly matches the MCP
  endpoint the client connected to.

Registered and unregistered-but-valid pinned PRM responses are byte-identical except for the echoed
resource. Delete the prototype `/.well-known/oauth-protected-resource/mcp/:dest` membership check.

### Aggregate MCP endpoint

Mount `/multi/mcp` whenever the mode is enabled, including with zero or one accepted target.

The aggregate server:

- adds exactly one required top-level `target` property to every SAP-contacting core tool;
- validates and removes `target` before the existing Zod handler receives the remaining arguments;
- never remembers a target in MCP session state;
- returns a conclusive unknown-target or unavailable-registry error before PP lookup;
- exposes a stable union of operations enabled on at least one accepted target after instance policy
  and the caller's XSUAA scopes; this is a policy union, not a claim that every backend feature has
  already been probed; and
- rechecks the selected target's effective policy and features for every invocation.

The aggregate implementation carries an immutable target context per call (target ID, descriptor,
effective safety, feature/discovery key, and per-user client). It must never mutate the aggregate
server's shared config. `createServer`'s current one-config-per-server assumption is an explicit
refactor site.

Schema strategy:

- 0 accepted targets: keep the aggregate MCP endpoint alive, expose no SAP-contacting tools, and
  return a controlled `NO_TARGETS_CONFIGURED` result where protocol handling requires it.
- 1 accepted target: inject a one-value enum.
- 2–16 accepted targets: inject an exact enum into each `target` property.
- 17–256 accepted targets: use a string with pattern
  `^[A-Z][A-Z0-9]{2}/[0-9]{3}$`; runtime membership remains authoritative.
- The target field description tells the model to call `SAPTargets` to resolve IDs and descriptions.
- Do not generate a capability-conditioned `oneOf` tree per target. It would multiply schemas and
  exceed client/tool payload budgets.

The threshold is 16 because the current read-only surface is already close to the repository's
50,000-byte wire wall. CI measures synthetic aggregate registries at 16, 17, and 256 targets; do not
raise the existing wall to accommodate duplicated enums.

Target input normalization is separate from general LLM empty-value stripping:

- null, empty, or whitespace-only input returns `TARGET_REQUIRED`;
- trim input and uppercase only the SID segment before validation, so `a4h/100` resolves to the
  canonical `A4H/100` target;
- malformed input returns `INVALID_TARGET`; and
- a valid but absent target returns `UNKNOWN_TARGET`.

The validated `target` key is removed before existing handler Zod validation.

`SAPQuery` is listed only if at least one target is effectively SQL-enabled and the caller has SQL
scope. Its target field follows the same all-target enum/pattern rule as other tools; do not reveal
the SQL-enabled subset through a narrowed schema. Selected-target policy produces
`TARGET_POLICY_DENIED` at runtime. Data-specific `SAPRead` variants follow the same rule.

Do not mutate aggregate or pinned tool schemas after one user's feature probe. Discovered target
schemas use the supported v1 read surface and policy gates; backend feature support is enforced at
runtime. This avoids a low-privilege first caller changing another user's tool list and keeps MCP
sessions stable.

### `SAPTargets`

`SAPTargets` is an aggregate-only, read-scoped discovery tool. Register it only when more than one
target is accepted.

- No input returns all targets, up to the 256 hard maximum.
- Optional `query` filters case-insensitively over target ID and description.
- Output contains only `{ target, description }`.
- Do not return `read`, `data`, `sql`, policy, destination name, availability, SAP user state, or
  admin diagnostics.
- Its description must say that listing a target does not prove the current user's SAP access.

Route `SAPTargets` through the same outer scope, rate-limit, request-ID, and audit pipeline as other
tools, but mark it `requiresSapClient=false`; it performs zero PP or ADT calls and must not receive a
fabricated client. Add its schema/policy entry and conditional tool registration explicitly to all
schema-policy parity validators and fixed synthetic aggregate fixtures.

Multi-target dispatch rejects the hidden hyperfocused `SAP` alias and any plugin/custom tool name,
even if a client calls an unlisted tool directly.

The model learns meaningful labels through `SAPTargets`; ordinary tool schemas do not embed up to 256
descriptions. `SAPTargets` is unnecessary when there is only one target because its exact target enum
is already self-describing enough.

### Authenticated catalog

- `GET /targets` is the canonical authenticated JSON catalog and includes generated VS Code/GitHub
  Copilot examples.
- It requires XSUAA read and sets `Cache-Control: no-store` plus `Vary: Authorization`.
- V1 does not mount a human HTML root: normal browser navigation cannot attach the required bearer
  token and adding a cookie/session login would reintroduce UI and CSRF scope.
- A read user sees only accepted public target data and connection examples.
- An admin receives the expanded diagnostics described below from the same `/targets` URL.

## Administrator Diagnostics Contract

The new end-user/operator page is `docs_page/multi-target-administration.md`. It is the normative
setup and troubleshooting guide and must be kept synchronized with response types and reason codes.

### Read view

For each accepted target, return only:

- `target`;
- sanitized `description`;
- `pinnedEndpoint`;
- `aggregateEndpoint`; and
- generated client configuration using those public URLs.

Never return a BTP destination name, SAP URL, policy detail, excluded destination, or reason code in
the read view.

### Admin expansion

If the same token has global admin, also return:

- registry state: `ready`, `degraded`, or `error`;
- source: `btp-subaccount` (diagnostic label, not a configurable enum);
- snapshot `loadedAt` and secret-free `revision`;
- counts: scanned, unrelated, ARC-adjacent, ARC-related, enabled, active, disabled, ignored, and
  quarantined;
- every **ARC-related** destination, meaning it contains at least one property whose key starts with
  `arc1.` case-insensitively; only exact lowercase allowlisted keys are valid;
- destination name, parseable target ID, sanitized description/fallback, and active routes;
- normalized safe fields: type, proxy type, authentication type, SID, client, language, and
  `hasCloudConnectorLocationId` boolean;
- requested/effective data-preview and free-SQL values plus `limitedByInstance`;
- status, warnings, deterministic reason codes, and safe messages; and
- registry-level discovery/limit errors.

Do not enumerate unrelated destination names. Do not return URL, user, password, client secret,
token, SAML assertion, auth token, certificate, header/query parameters, raw destination objects,
raw Cloud Connector location IDs, or per-user SAP failures/availability.

Reason-code vocabulary:

| Code | Meaning |
|---|---|
| `ACTIVE` | Candidate accepted and routed. |
| `ARC1_ENABLED_MISSING` | ARC-related entry has no `arc1.enabled` marker and is ignored. |
| `ARC1_DISABLED` | ARC-related entry explicitly disabled. |
| `ARC1_ENABLED_INVALID` | Marker is not a valid boolean. |
| `MISSING_NAME` / `INVALID_NAME` | Destination name is absent or unusable. |
| `MISSING_URL` / `INVALID_URL` | Required destination URL is absent or malformed. |
| `MISSING_SYSID` / `INVALID_SYSID` | Standard `sap-sysid` is absent or invalid. |
| `MISSING_CLIENT` / `INVALID_CLIENT` | `sap-client` is absent or invalid. |
| `UNSUPPORTED_TYPE` | Destination is not HTTP. |
| `UNSUPPORTED_PROXY` | Destination is not OnPremise. |
| `UNSUPPORTED_AUTH` | Destination is not PrincipalPropagation. |
| `MISSING_DESCRIPTION` | Non-fatal warning; public label falls back to target ID. |
| `INVALID_LANGUAGE` | Optional `sap-language` is malformed. |
| `UNKNOWN_ARC1_PROPERTY` | Enabled entry uses an unsupported `arc1.*` key. |
| `INVALID_POLICY` | Data/SQL policy value is malformed. |
| `UNSUPPORTED_V1_WRITE_CONFIG` | Enabled entry tries to configure a multi-target mutation. |
| `DUPLICATE_TARGET` | More than one enabled entry claims the same SID/client. |
| `DUPLICATE_DESTINATION_NAME` | Discovery input contains the same name more than once. |
| `SHADOWED_BY_INSTANCE` | Same name exists at service-instance level. |
| `TARGET_LIMIT_EXCEEDED` | More than 256 entries are enabled; no discovered route is active. |
| `REGISTRY_DISCOVERY_ERROR` | Destination discovery failed. |

Instance-policy narrowing is not a reason code: an accepted target keeps `ACTIVE` and exposes
`limitedByInstance: true` in the admin diagnostic when requested data/SQL exceeds the instance
ceiling.

Admin output describes only the current CF process snapshot. In a multi-instance app, compare
`revision` values while diagnosing a rolling update. Normal operation should use a non-rolling
`cf restart` after destination changes so every instance loads the same snapshot.

## Error, Retry, and Audit Contract

Transport authentication failures use HTTP semantics:

- missing/invalid/expired XSUAA bearer: 401;
- valid XSUAA token without global read: 403; and
- auth is checked before route existence.

SAP-contacting failures are MCP tool errors (`isError: true`) with concise text and safe structured
content:

```json
{
  "error": "SAP_AUTHORIZATION_DENIED",
  "target": "A4H/100",
  "requestId": "...",
  "retryable": true
}
```

Required classifications:

| Code | Stage/meaning | Retry guidance |
|---|---|---|
| `TARGET_REQUIRED` | Aggregate call omitted `target` or supplied null/empty/whitespace. | Supply a target from `SAPTargets`. |
| `INVALID_TARGET` | Aggregate target is not valid `SID/CLIENT` syntax. | Correct the target value. |
| `UNKNOWN_TARGET` | Target ID is syntactically valid but absent from the accepted snapshot. | Check `/targets`; restart after config changes. |
| `NO_TARGETS_CONFIGURED` | Multi mode is enabled with no accepted targets. | Configure a destination and restart. |
| `MULTI_TARGET_REGISTRY_UNAVAILABLE` | Discovery/limit error prevented a usable registry. | Admin checks `/targets` and health. |
| `TARGET_CONFIG_CHANGED` | Live PP lookup no longer matches startup fingerprint. | Restart ARC-1 after reviewing the destination. |
| `TARGET_POLICY_DENIED` | Instance or destination did not enable data/SQL. | Administrator changes both required gates and restarts for destination changes. |
| `PP_SETUP_FAILED` | Failure is proven to occur before ADT dispatch during Destination/Connectivity lookup or token exchange. | Fix BTP/Cloud Connector setup, then retry. |
| `SAP_AUTHENTICATION_FAILED` | Backend returned login/401 behavior or an ambiguous 403 after PP. Do not claim a specific missing-user cause. | Fix mapping/login/PP, then retry the same conversation. |
| `SAP_AUTHORIZATION_DENIED` | Structured SAP 403/authorization refusal. | Grant the required SAP authorization, then retry. |
| `SAP_SERVICE_INACTIVE` | SAP ICF/ADT service is inactive rather than a user authorization issue. | Activate/fix the service, then retry. |
| `SAP_REQUEST_FAILED` | A post-PP network failure or SAP 5xx prevented the request without proving an authentication cause. | Check Cloud Connector/SAP health, then retry once. |

Honor `ARC1_MINIMAL_ERRORS`. Never expose raw SAP HTML/bodies, destination properties, credentials,
authorization headers, assertions, or internal stack traces. Text must remain conclusive for clients
that ignore structured content.

Do not cache PP, SAP authentication, or SAP authorization failures—not globally and not in an MCP
session. A user can say “try again now” after Basis fixes mapping or permissions, and the next call
must reach PP/SAP again. If XSUAA roles changed, the user needs a fresh token/sign-in.

Set `retryable: true` for PP/SAP authentication, authorization, and service failures that can change
externally. Set it false for unknown target, empty registry, target policy, and snapshot drift within
the current process. “Retryable” permits a user-initiated retry after a fix; it must not cause an
unbounded automatic retry loop.

Audit stages must distinguish:

- ARC/XSUAA authentication;
- target resolution;
- PP destination exchange;
- SAP authentication;
- SAP authorization;
- target policy; and
- successful SAP execution.

The existing `auth_pp_created` event proves only PP credential/session creation; it must not be
reported as successful SAP login. Log target ID, safe user identity, request ID, stage, outcome, and
safe error class. Never log secrets. SAP-side login/security logging remains dependent on SAP system
configuration and is not guaranteed by ARC-1.

Add a public `target` field to the audit base event; never reuse or expose the internal BTP
destination name. Emit one terminal MCP-call outcome plus stage-transition events only for failures
(`target_resolution_failed`, `pp_exchange_failed`, `sap_authentication_failed`,
`sap_authorization_failed`, and `target_policy_denied`). Keep successful stage detail in structured
stderr debug logs so one successful call does not create several billable BTP Audit Log records.

## Feature State, Cache, and User Availability

- Multi mode requires `ARC1_CACHE=none` in v1. There is no shared source/object cache behavior to
  reason about across 100 targets.
- Warmup no longer exists and is not part of this design.
- Do not run startup feature probes or construct a shared/default ADT client for discovered targets.
- On the first SAP-contacting call for a target, use that authorized caller's PP-backed client and a
  per-target single-flight probe. Cache only a completed successful probe by immutable target ID.
- Feature state has an explicit `unknown` representation. A 401/403/PP failure leaves it unknown;
  never translate an authorization failure to `available:false` or cache it.
- Do not probe all targets on startup or when `SAPTargets` is called.
- Feature evidence may improve runtime routing/error messages, but it does not rewrite the process's
  MCP tool schemas.
- Do not store per-user target availability in memory, session state, disk, or an external system.
  It becomes stale when SAP access changes and does not survive deployment. A target list is a config
  inventory, not an entitlement inventory.
- SAPLint, ATC, and ABAP Unit are not exposed on multi-target routes in v1. This is a
  supported-surface choice, not an assertion that they can never work.
- The optional UI, plugins, and hyperfocused mode are disabled while multi mode is active.

## Concurrency and Rate Limits

- `ARC1_MAX_CONCURRENT` remains one process-wide SAP request semaphore shared by all legacy, pinned,
  and aggregate requests.
- Do not add `arc1.max_concurrent` or one semaphore per target in v1. A noisy target can consume the
  shared capacity; per-SID fairness is a follow-up if production evidence requires it.
- Targets with the same SID but different clients normally share one SAP dialog work-process pool;
  sizing must account for that.
- `ARC1_RATE_LIMIT` remains one per-user MCP limit shared across all endpoint styles.
- Add/use one process-wide per-IP MCP HTTP limit (`ARC1_MCP_HTTP_RATE_LIMIT`) shared across all MCP
  routes, including the Copilot JSON-RPC `/authorize` path. It must not create a bucket per target.
  When the new variable is unset, preserve today's derived value
  `max(ARC1_AUTH_RATE_LIMIT * 30, 600)`; `0` explicitly disables it; a positive value replaces the
  derivation. Once explicitly configured, `ARC1_AUTH_RATE_LIMIT` controls OAuth/auth endpoints only.
- In-memory limits are per CF app instance. Multiple instances multiply total pressure on SAP.

Document these starting points, then require load testing and Basis confirmation:

| Expected active users | OAuth/IP/min | MCP HTTP/IP/min | Per user/min | `ARC1_MAX_CONCURRENT` |
|---:|---:|---:|---:|---:|
| 1–5 | 30 | 1,000 | 120 | 10 |
| 6–20 | 60 | 3,000 | 120 | 20 |
| 21–50 | 120 | 7,500 | 180 | 40 |
| 51–100 | 240 | 20,000 | 180 | 60 |

The OAuth value allows login/reconnect bursts behind a shared corporate egress IP; keep it separate
from MCP traffic and monitor rejection events. A client configured with many pinned URLs may perform
one OAuth/DCR flow per URL, so prefer the aggregate endpoint beyond a few targets. The MCP HTTP/IP
value is only a coarse abuse ceiling; concurrency is the main SAP protection. `ARC1_RATE_LIMIT`
currently defaults to off; multi-target startup warns when it remains off but does not fail. A safer
starting concurrency estimate is:

```text
floor(0.6 × rdisp/wp_no_dia / ARC1_CF_instances)
```

Use the smallest value across the backends that share the process. Raise it only with observed SAP
capacity, response time, and queueing data.

## Health, Restart, and Multi-Instance Behavior

Health needs component detail without target inventory:

- Discovery succeeds with zero accepted targets: process is healthy; multi component is `ready`
  with zero targets.
- Discovery fails or the 256 limit is exceeded: overall `/health` remains 200, the multi component
  is `error`, and affected MCP routes return 503. This prevents the CF HTTP health
  check from crash-looping the app and keeps admin diagnostics available.
- Individual invalid/quarantined candidates do not make the process unhealthy if the snapshot itself
  was built; admin diagnostics and warning logs explain them.
- Protected `/targets` remains available in every state so an admin can see the registry error. A
  read user receives an empty accepted-target list, never the diagnostic details.

Destination changes are deliberately restart-bound:

1. Export/clone/edit/import destinations in BTP Cockpit or CLI.
2. Validate in Cockpit.
3. Run a normal non-rolling `cf restart <app>`.
4. Check `/health` and admin `/targets`.
5. Query each app instance using the CF router's `X-CF-APP-INSTANCE: <app-guid>:<index>` header and
   compare registry revisions if multiple instances disagree.

No MTAR rebuild or `cf deploy` is needed. DCR signing configuration must remain stable across
instances/restarts as already documented. The MTA keeps one instance by default, but tests must prove
two instances can serve the same immutable config and auth clients.

## Implementation Work Plan

### 1. Freeze and publish the architecture baseline before feature code

- Add proposed ADR-0006 and qualify ADR-0005 plus the auto-loaded `AGENTS.md` rule so this
  experimental read-only exception is not rejected as out of scope by future agents.
- Update the old evaluation/hub pages that still describe target-bound XSUAA roles or one instance
  per system as the only permitted design.
- Commit this plan, ADR, administration page, and documentation qualification before starting code
  or asking Wouter to review the new PR. An uncommitted working-tree plan is not a reviewable spec.
- Record the exact PR #543 merge-base/commits in the new PR description.
- Run the existing unit suite before refactoring.
- Preserve useful attribution and tests; do not preserve prototype APIs merely for compatibility.
- Keep all work on `codex/multi-target-v1` and open a draft PR for Wouter's review before beta
  deployment.

### 2. Add mode configuration and validation

Files:

- `src/server/types.ts`
- `src/server/config.ts`
- `src/server/server.ts`
- `tests/unit/server/config.test.ts`
- `mta.yaml`, `.env.example`, `manifest.yml`, `mta-overrides.mtaext.example`

Work:

- Add `ARC1_MULTI_TARGET_ENDPOINTS` with default false.
- Add shared MCP HTTP/IP rate configuration. Unset preserves the existing derived cap; `0`
  explicitly disables it; a positive value replaces the derivation on all MCP routes and the
  Copilot JSON-RPC `/authorize` branch.
- Enforce the mode constraints listed above with actionable startup errors.
- Require `SAP_XSUAA_AUTH=true` and validate the actual BTP bindings/mode in server startup where
  `VCAP_SERVICES` and env-only destination inputs are available, not only in `config.ts`.
- Allow zero configured/discovered targets.
- Delete the unreleased prototype contract outright: `SAP_BTP_DESTINATIONS`, `/mcp/<destination>`,
  its PRM alias, destination-suffixed env overrides, write policy parser, destination-name cache
  files/keys, inherited client fallback, PP-destination fallback, and retry memoization.
- Remove active fake legacy destination placeholders from `mta.yaml`. A multi-only deployment has
  no `SAP_BTP_DESTINATION` or `SAP_BTP_PP_DESTINATION`; set them only for an intentional legacy
  `/mcp` target.
- Add the commented MTA example with the conservative read-only ceiling and rate recommendations.

### 3. Implement secret-safe Destination Service discovery

Files:

- new `src/server/destination-discovery.ts`
- `src/server/xsuaa.ts` or the existing Destination Service binding helper only where integration is
  required
- a separate additive `@arc-mcp/xsuaa-auth` dependency PR for supported level-specific listing,
  token acquisition, original destination properties, and uncached find-by-name
- new `tests/unit/server/destination-discovery.test.ts`

Work:

- Fetch subaccount destinations once and instance-level names once.
- Disable SDK/service caching for the startup read.
- Immediately project raw results to allowlisted fields.
- Add a deep object-graph reachability test proving that credentials/tokens/raw destination objects
  cannot be reached from discovery or registry results, not merely that serialization omits them.
- Detect ARC-related entries without leaking unrelated names.
- Count but do not name ARC-adjacent destinations that look like SAP targets but lack `arc1.*`.
- Return a sanitized discovery result even when individual entries are malformed.
- Classify service/token/network failures without logging response bodies or credentials.
- Use only public package exports; do not deep-import token helpers or duplicate OAuth logic in
  ARC-1.

### 4. Replace the prototype registry

Files:

- `src/server/destination-registry.ts`
- `src/server/types.ts`
- `tests/unit/server/destination-registry.test.ts`

Work:

- Parse the exact destination schema and string booleans.
- Normalize target IDs and descriptions.
- Apply the 256 fail-closed maximum.
- Detect duplicate route/name and cross-level shadow conflicts symmetrically.
- Compute requested/effective data and SQL policy from the global ceiling.
- Quarantine unsupported write and unknown ARC properties.
- Produce immutable public descriptors, admin descriptors, runtime fingerprints, and revision.
- Canonicalize the revision with sorted destination names and fixed-field-order JSON; prove shuffled
  discovery order produces the same revision.
- Keep raw Destination Service objects out of registry memory.

### 5. Build isolated target runtimes and PP clients

Files:

- `src/server/server.ts`
- `src/server/context.ts`
- `src/handlers/feature-cache.ts`
- `src/adt/client.ts` and `src/adt/http.ts` only where client pinning/state isolation requires it
- `tests/unit/server/server.test.ts`
- `tests/unit/handlers/feature-cache.test.ts`

Work:

- Reuse PR #543's runtime separation where safe.
- Build every discovered config fresh from its sanitized descriptor. Never spread the legacy base
  config; do not copy user/password, cookies, service keys, bearer providers, `SAP_INSECURE`, or
  `SAP_DISABLE_SAML`. Destination/Connectivity determines the discovered route's transport.
- Build target runtimes eagerly from the immutable snapshot, but create no default/shared ADT client
  and run no technical SAP login or startup probe.
- Hardcode strict PP per discovered runtime while leaving the optional legacy runtime's existing PP,
  API-key, and direct-OIDC behavior unchanged.
- Resolve PP credentials with an uncached Destination lookup for every SAP-contacting request and
  verify all connection, target, language, and supported `arc1.*` fingerprint fields. Never cache a
  failed lookup or `authTokens[].error`; measure the added Destination Service latency/load in beta.
- Force the target client into every ADT client/request.
- Keep feature state keyed by public immutable target ID.
- Probe features lazily through the first authorized caller using a per-target single-flight. Cache
  only successful target feature evidence and add an explicit unknown state for auth/PP failures.
- Carry an immutable target context per aggregate call; never mutate server-scoped config or client
  state while switching targets.
- Share the one process-wide SAP semaphore.
- Warn on legacy/discovered connection duplication without disabling either route.

### 6. Enforce the multi-target read-only surface

Files:

- `src/authz/policy.ts`
- `src/handlers/dispatch.ts`
- `src/handlers/tools.ts`
- `src/handlers/schemas.ts`
- `src/adt/safety.ts`
- `scripts/validate-action-policy.ts`
- new focused helper such as `src/server/multi-target-tools.ts`
- tool-definition fixtures/tests

Work:

- Define built-in mutation structurally as `OperationType` in the existing mutation set and add a
  validator invariant that built-in scope/opType mappings remain equivalent. Multi-target's safety
  hard cap additionally forbids `OperationType.Lock` because it creates a real SAP enqueue.
- Construct every discovered `SafetyConfig` with `allowWrites=false`,
  `allowTransportWrites=false`, and `allowGitWrites=false`, independently of legacy/global write
  flags, and reject forbidden operations again at the ADT safety boundary.
- Permit source/metadata reads and the explicitly dual-gated data/SQL operations.
- Put effective `allowDataPreview` and `allowFreeSQL` into each target SafetyConfig so synthesized
  SQL/data paths such as `SAPSearch.tadir_lookup_db|both` and
  `SAPDiagnose.odata_perf|authorization_trace` cannot bypass target consent.
- Remove SAPLint from the multi surface. Hide `SAPDiagnose.atc|unittest` and inject a fixed
  multi-target denylist for those actions so a direct unlisted call is also rejected.
- Pinned schemas gain no `target` argument, but use the same pruned multi-target read-only surface as
  aggregate routes; they are not byte-identical to the legacy full surface.
- Add shallow aggregate `target` injection without duplicating handler Zod schemas.
- Validate/strip target before normal dispatch.
- Implement the 1–16 enum and 17–256 pattern behavior.
- Implement `SAPTargets` with the exact minimal output and registration rule.
- Route `SAPTargets` through scope/rate/request-ID/audit dispatch with `requiresSapClient=false` and
  no PP/ADT client construction.
- Reject the hidden hyperfocused `SAP` alias and every `Custom_*`/non-allowlisted tool on multi
  routes even if a client invokes it without listing tools first.
- Enforce selected-target policy again at call time.

### 7. Mount routes and global XSUAA authorization

Files:

- `src/server/http.ts`
- `src/server/mcp-rate-limit.ts`
- `src/server/auth-rate-limit.ts`
- `src/server/xsuaa.ts`
- `tests/unit/server/http-destinations.test.ts`
- rate-limit tests

Work:

- Mount one case-sensitive syntactic pinned-route matcher plus `/multi/mcp` from one snapshot; put it
  before case-insensitive legacy `/mcp` middleware.
- Never bind a discovered target to `/mcp`.
- Run a dedicated XSUAA-only verifier and require read before registry membership lookup. An
  authenticated syntactically valid but absent pinned target receives a generic HTTP 404.
- Reuse one per-user and one per-IP MCP limiter across every route.
- Keep OAuth rate limiting separate.
- Make unknown/malformed paths generic to unauthenticated callers.
- Implement registry-independent RFC 9728 metadata for every syntactically valid pinned resource
  plus fixed aggregate metadata. The `resource` and `WWW-Authenticate` metadata URL must match the
  endpoint exactly and must not reveal membership.

### 8. Add authenticated public and admin JSON catalog

Files:

- `src/server/http.ts`
- new response/view helper if needed, for example `src/server/target-catalog.ts`
- `tests/unit/server/target-catalog.test.ts`
- HTTP route tests

Work:

- Implement protected JSON `/targets`. Do not mount an HTML root in v1 because header-bearer auth
  gives normal browser navigation no safe login/session mechanism.
- Generate absolute URLs from the validated public base URL/request context.
- Generate a VS Code/GitHub Copilot MCP example.
- Return only the public view to read users.
- Expand the same response for admin with the exact safe diagnostic contract and reason codes.
- Add `no-store`, `Vary: Authorization`, normal JSON encoding, and security headers.
- Prove no secret/raw destination field can cross serialization.

### 9. Make PP/SAP errors retryable and conclusive

Files:

- `src/adt/errors.ts`
- `src/server/server.ts`
- `src/handlers/dispatch.ts`
- `src/server/audit.ts`
- `src/server/logger.ts`
- focused unit tests

Work:

- Separate XSUAA, target, PP exchange, SAP login, SAP authorization, and service-inactive stages.
- Classify `PP_SETUP_FAILED` only when failure is proven before ADT dispatch. Default an ambiguous
  post-PP 401 response to `SAP_AUTHENTICATION_FAILED`, use `SAP_REQUEST_FAILED` for network/5xx,
  and keep any body-marker
  heuristic release/signature-scoped under ADR-0002.
- Add safe structured error content with code, target, request ID, and retryability.
- Make PP-context hints stop recommending `SAP_USER`/`SAP_PASSWORD`.
- Ensure no negative auth/availability cache exists.
- Preserve minimal-error behavior.
- Audit login attempts/outcomes without raw bodies or tokens.

### 10. Update ADRs and all documentation

Files:

- `docs/adr/0005-single-system-per-instance.md`
- `docs/adr/0006-experimental-read-only-multi-target.md`
- `AGENTS.md`
- `README.md`
- `docs_page/multi-destination.md`
- `docs_page/multi-target-administration.md`
- `docs_page/configuration-reference.md`
- `docs_page/authorization.md`
- `docs_page/enterprise-auth.md`
- `docs_page/security-guide.md`
- `docs_page/rate-limiting.md`
- `docs_page/btp-cloud-foundry-deployment.md`
- `docs_page/btp-destination-setup.md`
- `docs_page/principal-propagation-setup.md`
- `docs_page/architecture.md`
- `docs/multi-destination-evaluation.md`
- `docs_page/multi-system-hub.md`
- `docs_page/index.md`, `docs_page/roadmap.md`, `docs/compare/00-feature-matrix.md`
- `mkdocs.yml`

ADR requirements:

- Preserve ADR-0005 as historical and mark it superseded/qualified, not silently rewritten.
- Explain why pinned routes retain structural binding.
- Explain why the aggregate endpoint is acceptable for the read-only v1: target is explicit and
  required on every call, there is no default/session state, selected-target policy is rechecked,
  and mutations are structurally removed.
- Accept explicitly that a wrong aggregate target can disclose data/SQL from the wrong authorized
  system. Record mitigations: explicit target every call, `SAPTargets` labels, no remembered/default
  target, runtime policy recheck, SQL/data off by default, and separate instances for lookalike
  production/non-production systems requiring a stronger boundary.
- Record that future writes require a separate security review/ADR and may change the aggregate
  design.

Documentation requirements:

- Clearly label experimental/default-off and BTP CF-only scope.
- Include minimum and data/SQL destination samples.
- State that full write access is impossible on multi-target routes in v1; do not include a write
  sample.
- Document global roles, visibility, PP tradeoffs, restart/no-redeploy flow, 256 maximum, duplicate
  behavior, admin diagnostics, rates, pinned-URL OAuth/DCR multiplication, and all deferred features.
- Update “12 tools” claims to explain that standard single-target mode remains 12 tools while the
  aggregate multi server conditionally adds `SAPTargets`; retain the existing
  `multi-destination.md` slug for link stability even though the feature is named multi-target.
- Add explicit rows for `ARC1_MULTI_TARGET_ENDPOINTS` and `ARC1_MCP_HTTP_RATE_LIMIT` to both
  `docs_page/configuration-reference.md` and the `AGENTS.md` configuration table, including defaults,
  mode restrictions, and the inherited-rate-limit migration behavior.
- Remove `SAP_BTP_DESTINATIONS`, destination-name route, default discovered `/mcp`, and target-specific
  XSUAA guidance from the final user-facing contract.

### 11. Unit and contract test matrix

Required automated cases:

- mode off is byte/behavior compatible where snapshots apply;
- startup with fixed synthetic registries of 0, 1, 2, 16, 17, and 256 accepted targets;
- 257 enabled candidates disables the discovered registry without selecting a subset;
- exact SID/client/description/boolean validation;
- unknown ARC property and unsupported write config fail closed;
- missing description warns and falls back;
- duplicate target/name and instance shadow quarantine every claimant;
- only ARC-related destinations appear in admin diagnostics; unrelated names do not;
- raw URLs, credentials, tokens, headers, certs, and location IDs are unreachable from retained
  discovery/registry object graphs and never serialize/log;
- discovery failure keeps health 200, exposes safe admin diagnostics, and makes affected MCP routes
  return 503 with or without legacy `/mcp`;
- legacy `/mcp` unchanged and never auto-assigned;
- legacy and discovered duplicate fingerprint warning with both routes usable;
- pinned schemas have no target argument and use the frozen multi read-only surface;
- aggregate schemas have exactly one required target argument;
- 1–16 enum and 17–256 pattern behavior, including target null/empty/lowercase/malformed/unknown;
- aggregate is mounted at 0/1 targets;
- `SAPTargets` appears only at >1 and returns only target/description;
- no target/session memory and cross-call target switches are explicit;
- global Viewer sees all accepted targets but SAP can deny a selected one;
- data and SQL require instance + destination + scope + SAP auth;
- no multi-target mutation or lock appears or dispatches, including for admin and a write-enabled
  legacy ceiling; every discovered SafetyConfig hardcodes writes/transport/Git false;
- ATC, ABAP Unit, SAPLint, hidden `SAP`, and `Custom_*` are absent and direct invocation fails;
- auth occurs before route resolution and public endpoints do not enumerate targets;
- read/admin `/targets` views differ exactly as specified;
- uncached PP drift across connection/policy fields, SAP client pinning, lazy success-only feature
  probing, explicit unknown feature state, and no discovered default/shared client;
- auth failures are not cached and can succeed on immediate retry;
- one global semaphore and shared rate buckets across all routes;
- cache/UI/plugins/hyperfocused/SAPLint/ATC/unit-test constraints;
- stable registry revision across processes with identical safe config.

Run at minimum:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Update tool-definition fixtures intentionally using the fixed synthetic registries. Add aggregate
schema budget scenarios at 16, 17, and 256 targets; keep the existing 50,000-byte wall unchanged.

### 12. BTP integration and E2E acceptance

Create a separate beta CF app/route in the existing test subaccount. The local CF/BTP CLI login must
be refreshed before the live run; never print service keys, `VCAP_SERVICES`, tokens, assertions, or
destination credentials.

Automate or document these acceptance cases:

1. Mapped Viewer successfully lists targets and performs source/system reads on pinned and aggregate
   routes.
2. A valid XSUAA read user without SAP mapping produces the captured HTTP status/content-type/body
   signature and the conservative safe classification.
3. A propagated SAP user that exists but lacks ADT authorization produces a captured structured SAP
   403 classified as `SAP_AUTHORIZATION_DENIED`.
4. A deliberately broken pre-ADT Destination/Connectivity lookup produces `PP_SETUP_FAILED`; a
   post-PP ambiguous 401 defaults to `SAP_AUTHENTICATION_FAILED`.
5. After Basis fixes mapping/authorization, retry in the same MCP session succeeds—proving no denial
   cache.
6. Missing XSUAA read returns HTTP 403 before Destination Service/SAP.
7. Route client and ADT `sap-client` match for multiple clients of one SID.
8. Data/SQL work only on a target with both instance and destination consent.
9. Editing a destination without restart causes fingerprint drift rejection; restart loads the new
   revision.
10. Two CF app instances expose the same routes/revision; one DCR client established through one
    instance completes MCP requests pinned via `X-CF-APP-INSTANCE` to the other instance.
11. Seed unique sentinel strings in a test destination password, token-like property, URL, and
    location ID, then assert those sentinels are absent from logs, audit sink, `/health`, `/targets`,
    MCP errors, serialized discovery, and retained registry object graphs.
12. VS Code/GitHub Copilot connects using both generated endpoint styles.

Do not run multi-target write CRUD. ATC and ABAP Unit are not acceptance requirements for this
feature.

### 13. Review and rollout

- Publish the draft PR with this design summary and explain that a new PR was needed because the
  public contract differs materially from PR #543 while retaining its useful commits and credit.
- Ask Wouter to review destination semantics, collision handling, and the reuse/replacement of his
  registry work.
- Ask Geert-Jan for a post-v1 S/4HANA Public Cloud/SAML assertion follow-up, not a v1 blocker.
- Run the beta app against real on-prem PP and collect the actual 401/403/PP response shapes before
  marking ready.
- Merge to `main` only default-off and experimental, after all compatibility and secret-leak tests
  pass.
- No separate permanent beta branch is necessary; the feature flag and beta CF app provide the
  isolation.

## Security Review Checklist

- [x] No unauthenticated target enumeration.
- [x] No destination name or connection details in read-user output.
- [x] No raw Destination Service object retained after projection.
- [x] No credentials/tokens/assertions/headers/query params/certs in logs, errors, health, catalogs,
      audit, or revision material.
- [x] Unknown ARC configuration fails closed.
- [x] Duplicate/shadow conflicts have no implicit winner.
- [x] More than 256 enabled targets activates none.
- [x] Multi-target mutations are absent from schemas and rejected again at dispatch/safety layers.
- [x] Multi-target lock/enqueue operations are absent and rejected at the safety layer.
- [x] Data/SQL require instance, target, XSUAA, and SAP consent.
- [x] XSUAA auth is checked before route existence.
- [x] PP is strict and has no shared identity fallback.
- [x] Discovered configs are built fresh and cannot inherit credentials/cookies/bearer providers or
      construct a default shared ADT client.
- [x] Route target and ADT client agree on `sap-client`.
- [x] Runtime destination drift fails closed until restart.
- [x] Unauthorized user failures cannot poison shared feature state.
- [x] Negative access results are never cached.
- [x] Read/admin catalog separation is test-covered.
- [x] Global semaphore/rate limit cannot be multiplied by target count.
- [x] RFC 9728 metadata and unauthenticated route behavior cannot reveal registry membership.
- [x] Raw discovery secrets are unreachable from the retained registry object graph.
- [x] Legacy `/mcp` compatibility is test-covered.

## Deferred Beyond V1

- writes, activation, transport writes, and Git writes on multi-target routes;
- any full-write destination sample;
- target-specific ARC ACLs/XSUAA entitlements;
- persisted or externally sourced per-user target availability;
- API-key or direct Entra/IAS OIDC auth for multi-target routes;
- SaaS provider/subscriber and cross-subaccount discovery;
- S/4HANA Public Cloud/SAML assertion targets;
- separate design-time/technical destinations and target pairing;
- per-SID/per-target fair concurrency;
- additional SQL parsing, statement allowlisting, or row-governance controls beyond the existing
  free-SQL/data gates;
- cache modes other than none;
- plugins, optional UI integration, hyperfocused mode, SAPLint, ATC, and ABAP Unit;
- a browser HTML target page and cookie/session login;
- dynamic destination refresh without restart; and
- a write-safe aggregate routing model.

## Ready-to-Implement Exit Criteria

The implementation can start when this document and the administrator page agree on:

- exact flag and destination property names;
- routes and aggregate schema rules;
- global XSUAA roles and catalog visibility;
- the read-only/data/SQL policy intersection;
- the 256-target fail-closed behavior;
- admin safe fields and reason codes;
- error classifications and retry behavior; and
- the test/rollout sequence.

Those decisions are now locked in this plan. Any change to target visibility, write support,
discovery scope, or aggregate target semantics requires an explicit plan/ADR update before code is
merged.
