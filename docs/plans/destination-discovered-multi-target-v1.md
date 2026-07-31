# Destination-Discovered Multi-Target V1

## Status

- **State:** implemented, merged to `main`, and beta-validated for Principal Propagation and shared Basic
- **Code ancestry:** PR #543 remains in the branch history so Wouter's tested multi-runtime work can
  be reused where it fits. The public contract described here replaces the prototype contract.
- **Release model:** experimental and default-off on `main` after beta validation; no long-lived beta
  release branch is required.
- **Target platform:** SAP BTP Cloud Foundry, subaccount destinations, XSUAA, and on-premise
  `PrincipalPropagation` or explicitly enabled `BasicAuthentication`
- **Scale target:** 100 SAP system/client targets is a normal intended deployment; v1 supports at
  most 256 enabled targets.

This document is the normative v1 specification together with accepted ADR-0006 and ADR-0007. When
a code comment, the PR #543 prototype, ADR-0005, or older documentation disagrees with this narrow
experimental exception, this document and those ADRs win.

## Outcome

One ARC-1 CF application can discover explicitly marked BTP subaccount destinations at startup and
serve the same target in two ways:

- a target-pinned endpoint such as `/A4H/100/mcp`; and
- an aggregate endpoint at `/multi/mcp`, where each SAP-contacting tool has one required `target`
  argument such as `A4H/100`.

Both endpoint styles are enabled together with `ARC1_MULTI_TARGET_ENDPOINTS=true`. Bare `/mcp` is
never assigned to a discovered target. An explicitly configured single target may continue to use
`/mcp` side by side with the discovered routes.

Multi-target v1 is deliberately read-only at the mutation boundary. Source and metadata reads are
available by default. Data preview and freestyle SQL require explicit consent in both the ARC-1
instance and the selected destination. All mutation tools and actions remain unavailable on pinned
and aggregate multi-target routes, even for `MCPAdmin` and even if the single-target `/mcp` permits
writes.

The effective permission for a multi-target call is:

```text
instance safety ceiling
  ∩ destination target policy
  ∩ global XSUAA scopes
  ∩ selected SAP identity authorization (propagated user or shared technical user)
  ∩ multi-target v1 read-only hard ceiling
```

There are no target-specific XSUAA roles or role attributes in v1. A user with the global read scope
can see all accepted target identifiers and may attempt any of them. A PrincipalPropagation target
uses the propagated SAP user as the final target-specific authorization boundary. An explicitly
enabled BasicAuthentication target instead uses one shared technical SAP identity for every
authorized caller and therefore is not a per-user SAP authorization boundary.

## Locked Decisions

| Area | V1 decision |
|---|---|
| Activation | `ARC1_MULTI_TARGET_ENDPOINTS=true`; absent/false preserves current behavior. |
| Discovery | One startup snapshot of BTP **subaccount** destinations; no provider, subscriber, cross-subaccount, or SaaS discovery. |
| Candidate marker | `arc1.enabled=true` is the only required ARC-1-specific destination property. |
| Target identity | Standard `sap-sysid` plus required `sap-client`; public ID is normally `SID/CLIENT`. Optional `arc1.target_alias` replaces only the public system segment when independent systems reuse a SID/client. |
| Routes | Both `/<PUBLIC-SYSTEM>/<CLIENT>/mcp` and `/multi/mcp`; no discovered bare `/mcp` alias. |
| Aggregate selection | Required top-level `target` on every SAP-contacting tool; no default, current, or session target. |
| Maximum | 256 enabled candidates. More than 256 makes the discovered registry unavailable; ARC-1 never silently chooses a subset. |
| Authentication | XSUAA only for multi-target endpoints. PrincipalPropagation is recommended and strict per target. `BasicAuthentication` is an explicit shared-identity exception requiring `ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH=true`; there is never fallback between identity modes. |
| Authorization | Existing global scopes; no target-specific XSUAA or role-model change. A scoped additive `@arc-mcp/xsuaa-auth` BTP-destination API change is required for uncached PP lookup and original properties. |
| OAuth scope negotiation | Route metadata advertises only `read`, `data`, `sql`, and `admin`. The initial 401 omits a fixed scope so general MCP clients request the advertised mutation-free set and XSUAA grants only the user's assigned subset. A validated token still needs `read` before route lookup. Reconsider this eager grant before any write-capable multi-target design. |
| Target policy | Read by default; `arc1.allow_data_preview` and `arc1.allow_free_sql` are explicit per-target opt-ins. |
| Writes | Impossible on multi-target routes in v1. Do not document or test a multi-target full-write configuration. |
| Cache | `ARC1_CACHE=none` while the mode is enabled. |
| Tool surface | Standard mode only; no hyperfocused alias, plugins, or optional UI. Explicit additions are offline `SAPLint.lint|lint_and_fix|list_rules`, read-only `SAPTransport.list|get|check|history`, and `SAPDiagnose.atc|unittest`; all other actions remain governed by the structural ceiling and explicit allowlists. |
| Catalog | No standalone HTTP catalog. Aggregate-only `SAPTargets` is read-scoped: readers see it only with more than one active target and receive compact target/description/identity rows; admins see it at zero, one, or many targets and during registry failure, with secret-safe diagnostics and passive shared-auth health. Pinned endpoints never expose it. |
| Target discovery | Aggregate schemas use exact target enums through 16 targets and a syntax pattern from 17–256; `SAPTargets` supplies IDs and descriptions without probing SAP user availability. |
| User availability | Never guessed, probed in bulk, persisted, or negatively cached. A failed target call may be retried immediately. |
| Destination changes | Non-secret fields take effect after a normal CF app restart; no rebuild or MTAR redeployment. Basic `User`/`Password` rotates on the next protected request without restart. |
| Destination count | One selected destination per system/client in v1. A separate design-time/cache destination is deferred. |
| Initial backend | On-premise + PP or explicit shared Basic. S/4HANA Public Cloud/SAML assertion follows after v1 with dedicated testing. |
| Deployment | `mta.yaml` stays at one CF app instance. PP-only multi-target can retain the existing multi-instance behavior, but enabling Basic multi-target requires exactly one instance in v1 because credential-generation protection is process-local. |
| Health | Registry/configuration errors keep `/health` at 200 with an `error` component. Pinned routes return 503, while authenticated aggregate MCP remains reachable so admins can call `SAPTargets`; other aggregate tool calls return a structured registry-unavailable error. Valid snapshots, including zero-target snapshots, report `ready`. |

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
3. A separately configured single target can keep `/mcp`, including its current write behavior.
   The multi-target read-only ceiling applies only to discovered pinned and aggregate routes.
4. Process-wide multi-target prerequisites still apply while the flag is enabled: HTTP transport,
   XSUAA, cache off, standard tool mode, UI off, and no plugins. Strict PP is a per-runtime invariant
   for PrincipalPropagation targets. BasicAuthentication is accepted only under the separate
   default-off instance ceiling and never as PP fallback.
5. If a per-user/strict-PP single-target `/mcp` connection and a discovered target have the same
   connection fingerprint, both remain usable with an operator warning because their policies can
   differ. An actually shared Basic `/mcp` connection cannot overlap a discovered Basic route in v1;
   startup fails rather than provide a second path around the credential guard.
6. API-key and direct OIDC authentication remain unchanged for the single-target `/mcp`, but do not authorize
   pinned multi-target routes or `/multi/mcp` in v1. Multi routes use an XSUAA-only
   verifier chain rather than inspecting a shared `AuthInfo` after authentication.

## Configuration Contract

### Instance configuration

Add the mode flag and an independent, default-off Basic-authentication ceiling:

```yaml
ARC1_MULTI_TARGET_ENDPOINTS: "true"
# Optional shared-identity exception; keep false/unset for PP-only deployments.
ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH: "false"
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

Every PrincipalPropagation runtime hardcodes `ppEnabled=true` and `ppStrict=true`, regardless of the
existing `SAP_PP_ENABLED`/`SAP_PP_STRICT` values. A BasicAuthentication runtime hardcodes PP off and
obtains only its selected destination's shared credentials. Those existing env values continue to
control only the optional single-target `/mcp` runtime. This per-runtime split preserves current
single-target behavior and prevents PP-to-Basic or Basic-to-PP fallback.

`ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH` defaults to false. When true, an accepted Basic target makes
the process a shared-identity deployment and v1 requires exactly one CF app instance. The guard is
process-wide, not constructed per MCP transport/session. PP-only deployments are not changed by
this option.

Zero destinations is valid. The process must be deployable before the administrator creates the
destinations.

The existing instance values remain the absolute ceiling:

- `SAP_ALLOW_DATA_PREVIEW`;
- `SAP_ALLOW_FREE_SQL`;
- `SAP_DENY_ACTIONS`;
- XSUAA role scopes;
- `ARC1_MAX_CONCURRENT`, `ARC1_RATE_LIMIT`, and auth/HTTP rate limits; and
- error, audit, CORS, and public-URL security settings.

An optional single-target `/mcp` continues to use the existing variables, including
`SAP_BTP_DESTINATION` and, where configured, `SAP_BTP_PP_DESTINATION`. Discovered targets never
inherit those destination names or their policy. They are compared only for the duplicate-connection
warning described above.

`mta.yaml` will contain a commented experimental block, not active placeholder targets. Users who
build their own MTAR from source uncomment the block, keep the conservative instance ceiling, deploy
once, create destinations, and restart the app.

For a multi-only deployment, `SAP_BTP_DESTINATION` and `SAP_BTP_PP_DESTINATION` must be absent. The
base MTA's current `your-basic-destination`/`your-pp-destination` placeholders are removed. Set those
variables only when intentionally retaining a single-target `/mcp`.

### Supported destination properties

An enabled v1 destination has this logical schema:

| Property | Required | Validation and meaning |
|---|---:|---|
| `Name` | yes | Internal BTP identifier. Never exposed to normal read users or used as a route ID. |
| `Type` | yes | Exactly `HTTP`. |
| `URL` | yes | Backend URL resolved through Destination Service. Secret-safe normalized fingerprint only; never returned. |
| `ProxyType` | yes | Exactly `OnPremise`. |
| `Authentication` | yes | `PrincipalPropagation`, or `BasicAuthentication` only when the instance ceiling is enabled. Identity is derived from this property and cannot be overridden by `arc1.*`. |
| `User` / `Password` | Basic only | Required Destination Service secrets for `BasicAuthentication`. Read only from the uncached request-time Find result; never retained in the registry, catalog, revision, logs, audit, or errors. |
| `Preemptive` | Basic only | Optional standard destination boolean. Absent or `true` is accepted; explicit `false` is quarantined. |
| `sap-sysid` | yes | Standard SAP property; exactly `^[A-Z][A-Z0-9]{2}$`. Hyphen and underscore are invalid. |
| `sap-client` | yes | Exactly three digits (`^\d{3}$`). There is no implicit client 100. |
| `Description` | recommended | Single line, at most 160 characters. Missing/invalid values warn and fall back to the resulting public target ID. |
| `sap-language` | no | Optional SAP request language after existing validation; target value wins, otherwise inherit instance `SAP_LANGUAGE`. |
| `CloudConnectorLocationId` | no | Used for lookup/fingerprint; admin output exposes only whether it is present. |
| `arc1.enabled` | yes | Only required ARC-1 property. String boolean; trimmed, case-insensitive `true` enables and `false` disables. |
| `arc1.allow_data_preview` | no | String boolean, default false. Can only narrow/intersect the instance ceiling. |
| `arc1.allow_free_sql` | no | String boolean, default false. Can only narrow/intersect the instance ceiling. It does not automatically enable named data preview. |
| `arc1.target_alias` | no | Public system segment only; `^[A-Z][A-Z0-9-]{1,30}[A-Z0-9]$`. It does not replace the real SID/client or create a second route. |

Property names are case-sensitive. Boolean values accept trimmed case-insensitive `true` and
`false`; every other value is invalid. The docs recommend lowercase values.

There is no `arc1.config_version` in v1. The strict property allowlist is the schema, and there is no
second destination schema to negotiate yet.

The v1 ARC-1 property allowlist intentionally excludes write, package, transport, Git, per-target concurrency,
secondary-destination, and arbitrary header/query configuration. In particular,
`arc1.allow_writes`, `arc1.allowed_packages`, `arc1.allow_transport_writes`, and
`arc1.allow_git_writes` are not a hidden preview. An enabled candidate containing one of them is
quarantined as `UNSUPPORTED_V1_WRITE_CONFIG`.

This does not change the existing `$TMP` default or package gates on a separately configured
single-target `/mcp`. Package policy is simply irrelevant to multi-target v1 because mutations cannot be
listed or dispatched there.

An unknown `arc1.*` property on an enabled candidate quarantines it. This makes spelling mistakes
fail closed. A destination with no valid `arc1.enabled=true` is not a routing candidate. For admin
diagnostics, detect the `arc1.` prefix case-insensitively so a wrong-case key is still visible, but
accept only the exact lowercase allowlisted property names. Thus `ARC1.Enabled` appears as a safe
configuration error instead of disappearing as unrelated.

Treat `Description` as untrusted administrator-controlled display text: normalize Unicode, remove
control characters, collapse line breaks, enforce the length limit, JSON-encode it normally, and
never interpret it as an LLM instruction. It is visible to read users and the LLM only as a label.

When independently installed systems reuse one real SID/client, assign an alias to at least one.
For example, preserve `A4H/001` and add `A4H-2025/001`; both PP and ADT runtimes still use real
`sap-sysid=A4H` and `sap-client=001`. Existing destinations without the property retain
their exact `SID/CLIENT` identity. Adding, removing, or changing an alias requires restart and
changes the pinned URL; one destination never receives both aliased and unaliased routes.

### Examples

Minimum source-read target:

```properties
Name=ARC1_A4H_100_PP
Type=HTTP
URL=http://a4h-abap.internal:50001
ProxyType=OnPremise
Authentication=PrincipalPropagation
sap-sysid=A4H
sap-client=100
Description=A4H development client 100
arc1.enabled=true
```

Shared Basic source-read target (explicit compatibility exception):

```properties
Name=ARC1_NPL_001_BASIC
Type=HTTP
URL=http://npl-abap.internal:50000
ProxyType=OnPremise
Authentication=BasicAuthentication
User=ARC1_READER
Password=<strong-generated-ASCII-password>
Preemptive=true
sap-sysid=NPL
sap-client=001
Description=Read-only NPL client 001 (shared technical identity)
arc1.enabled=true
```

This target is accepted only with `ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH=true`. Every XSUAA-authorized
caller reaches SAP as `ARC1_READER`. Use a dedicated communication/technical user with least
privilege, never `SAP_ALL`; prefer one technical user per SAP client/security boundary. Usernames
must not contain a colon or surrounding whitespace, and ASCII credentials are recommended.

Same-SID/client target with a distinct public route:

```properties
Name=ARC1_A4H_2025_001_PP
Type=HTTP
URL=http://a4h-2025-abap.internal:50001
ProxyType=OnPremise
Authentication=PrincipalPropagation
sap-sysid=A4H
sap-client=001
Description=ABAP Platform 2025 test system (A4H client 001)
arc1.enabled=true
arc1.target_alias=A4H-2025
```

Its public target is `A4H-2025/001`; its real SAP identity remains `A4H/001`.

Data preview and SQL target (still mutation-free):

```properties
Name=ARC1_BWQ_200_PP
Type=HTTP
URL=http://bwq-abap.internal:50001
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

The PP examples intentionally use an HTTP destination URL with virtual port `50001`. The port is an
illustrative convention, not a required backend port: the destination virtual host/port must exactly
match a Cloud Connector mapping whose internal connection uses HTTPS with `X509_RESTRICTED` and allows
the required ADT paths. The destination's `Authentication=PrincipalPropagation` property alone
cannot upgrade an HTTP/`NONE_RESTRICTED` Cloud Connector mapping to HTTPS/`X509_RESTRICTED`. The
Basic target still requires a matching OnPremise Cloud Connector mapping and allowed ADT paths, but
does not use the PP certificate/CERTRULE chain.

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
12. Compute a deterministic registry revision by sorting the complete fixed-field-order canonical
    records and hashing their safe normalized JSON. Destination name alone is not a total order when
    malformed input contains duplicate names. Exclude `loadedAt`, response ordering, timestamps,
    credentials, and raw objects.
13. Mount the pinned and aggregate routes from the snapshot.

### Conflict rules

- Duplicate resulting public target ID: quarantine every claimant as
  `DUPLICATE_TARGET`.
- Duplicate physical URL/client/Cloud Connector location among Basic targets: quarantine every
  claimant as `DUPLICATE_BASIC_CONNECTION`; a public alias cannot duplicate the shared login path.
- Duplicate destination name in the discovery input: quarantine every claimant as
  `DUPLICATE_DESTINATION_NAME`.
- A subaccount destination whose name is also present at service-instance level: exclude it as
  `SHADOWED_BY_INSTANCE`. This matches the Destination Find API precedence risk and prevents PP
  lookup from silently resolving a different object.
- No conflict is broken by ordering, destination update time, or lexical name.

### Runtime drift and shared-credential checks

Every SAP-contacting call performs a fresh, direct Destination Find request using the bound
Destination service. ARC-1 accepts the result only when the response owner identifies a
subaccount destination; an instance owner is `TARGET_CONFIG_CHANGED`, even when its safe fields
match the startup target. This avoids the generic SDK's instance-over-subaccount and provider
fallback selection. Before building the ADT client, compare the result to the startup fingerprint:

- destination name;
- canonical URL;
- authentication type;
- proxy type;
- `sap-client`;
- Cloud Connector location ID; and
- real SID/client and language properties; and
- public target alias and all supported normalized `arc1.*` properties.

Any mismatch rejects the call as `TARGET_CONFIG_CHANGED` and instructs the operator to restart. This
also catches a newly created instance-level destination shadowing a subaccount target. Never refresh
or mutate the snapshot in place.

For BasicAuthentication, the owner-confirmed Find response supplies the request-local credentials.
For PrincipalPropagation, multi-target v1 validates the already authenticated user's JWT with the
Connectivity service jwt-bearer exchange and sends the original JWT as
`SAP-Connectivity-Authentication` (PP Option 2). It does not use a provider destination or an
instance destination as fallback. A failed validation produces no usable PP credential and is not
cached.

This does not change XSUAA scopes, roles, token claims, or the generic authorization model. The
uncached owner check adds Destination Service token acquisition and Find requests to each
SAP-contacting multi-target call; PP also adds its Connectivity validation exchange. Measure
latency and service load in beta before considering narrowly scoped service-token caching.
Immediate drift detection, PP repair, and Basic credential rotation take precedence in v1.

For BasicAuthentication, acquire one process-wide per-target gate before Destination Find and hold
it through credential binding, the authentication canary/feature probe, and tool dispatch. Require
non-empty `User` and `Password`, reject usernames containing a colon or surrounding whitespace, and
derive a credential-generation identifier with a process-random HMAC key. Never retain plaintext
credentials outside the request client. A failed generation is blocked without another SAP attempt;
retain up to four recently blocked generations for 15 minutes so an eventually consistent
old/new/old Find sequence cannot re-admit an old password. The per-target wait queue is bounded at
32 and acquisition times out after 30 seconds with `SAP_TARGET_BUSY`.

A changed Basic credential generation clears successful feature evidence and performs one new
authentication attempt. A successful request marks passive runtime health healthy. The canary
accepts a namespace-correct AtomPub service root; SAP_BASIS 758 can return that valid service with
no workspaces. A conclusive 401/login-page response marks the generation authentication-failed; a
structured SAP ADT 403 marks authorization-failed. Transient network/5xx and unrecognized non-login
2xx protocol responses remain retryable and do not poison the credential generation. Every
effective final or synthetic authentication response goes through one classifier, including HTML
login detection. Never retry a Basic request automatically with another credential generation.

Every ADT client must be constructed with the snapshot client so `src/adt/http.ts` sends the same
`sap-client` on every request. Do not share one mutable ADT client across targets. Shared stateless
code is fine; authentication sessions, safety, feature state, cache state, and request context are
target/user scoped as appropriate.

## Authorization and SAP identity

### XSUAA stays global

Do not add target attributes, dynamic roles, profile/target pairing, or target scopes to
`xs-security.json`. `@arc-mcp/xsuaa-auth` changes are limited to the BTP destination helpers described
above; its verifier and scope model remain unchanged.

Existing functional scopes continue to mean:

| Scope/role | Multi-target effect |
|---|---|
| `read` / Viewer | Authenticate to all multi-target MCP routes and invoke source/metadata reads. On the aggregate endpoint, `SAPTargets` is listed when more than one target is active and returns all accepted target IDs/descriptions. |
| `data` / Data Viewer | Permit target data operations only when the selected target and instance both enable data preview. |
| `sql` / SQL User | Permit `SAPQuery` only when the selected target and instance both enable free SQL. Existing role collections must still include/read-compose the needed read/data scopes. |
| `admin` / Admin | Always receive aggregate `SAPTargets`, including at zero/one targets or registry failure, with expanded secret-safe diagnostics. It does **not** bypass destination policy, SAP auth, or the v1 mutation prohibition. |

All accepted targets are visible to a global read user. This does not prove that the propagated or
shared SAP user is mapped or authorized in any target. V1 deliberately has no per-target ARC ACL because that
would require a reliable user-target entitlement source and a more complex XSUAA model. Administrators
who need different target visibility must use separate ARC-1 instances until a later ACL design is
accepted.

### Route auth order

For `/<PUBLIC-SYSTEM>/<CLIENT>/mcp` and `/multi/mcp`:

1. An unauthenticated request receives registry-independent protected-resource metadata and no fixed
   scope in the 401 challenge. A general MCP client therefore requests the advertised mutation-free
   `read data sql admin` set; XSUAA reduces the grant to the scopes assigned to the authenticated user.
2. Validate the XSUAA token and require at least the global read scope before resolving whether a
   syntactically valid target exists. A valid token without read receives a 403 read-scope challenge.
3. Resolve the target/route from the immutable registry.
4. Apply XSUAA functional scope pruning.
5. Apply the instance and target policy intersection.
6. Resolve the exact destination without cache. For PP, exchange the user's token through
   Destination/Connectivity. For Basic, bind the shared destination credential generation inside
   the process-wide target gate.
7. Let SAP enforce the selected propagated or shared user's system/client authorization.

This order prevents unauthenticated route enumeration. OAuth metadata, health, and standards-required
discovery endpoints may remain public but must contain no target inventory.

`SAPTargets` stops after XSUAA/read authentication and its tool-level scope, deny-action, rate-limit,
and audit checks. It resolves no SAP target and performs no PP, Basic credential lookup, or backend
request. Reader output identifies each target's `identity` as `per-user` or `shared`; admin output
adds only passive secret-free runtime health for shared targets.

Multi-target routes use an XSUAA-only bearer verifier. API-key and direct OIDC tokens fail as 401
with the correct route-family protected-resource metadata challenge before registry membership is
checked. The single-target `/mcp` keeps the existing verifier chain and PP/shared-client behavior.
Copilot Studio's JSON-RPC-on-`/authorize` compatibility alias routes to the XSUAA-only aggregate
server whenever multi-target mode is enabled, including a side-by-side deployment. It must never
prefer a potentially writable single-target `/mcp`; only a single-target-only deployment may map
the alias to `/mcp`.

There is no fallback when PP exchange, Basic login, SAP mapping, or authorization fails. One
destination per target is sufficient for v1. PP is recommended because it retains per-user SAP
identity. Basic is explicitly shared: every scoped XSUAA user reaches SAP as the destination's
technical user, so human attribution requires ARC-1 audit correlation. No target uses a technical
startup probe; the first authorized call may pay feature-probe/canary latency, and feature
availability must never be inferred from an unauthorized user's response.

## Endpoint Contract

### Pinned MCP endpoints

Use one snapshot-independent, case-sensitive syntactic matcher for:

```text
/<PUBLIC-SYSTEM>/<CLIENT>/mcp
```

The matcher runs XSUAA authentication and the global read check before registry lookup. Do not mount
one Express route only for each accepted target: registered and unregistered syntactically valid
paths must both return 401 before authentication. After authentication, an unknown target returns a
generic HTTP 404 without an accepted-target list. Syntactically invalid paths may use the generic
unauthenticated 404 because syntax is not inventory.

Pinned URLs are canonical uppercase and case-sensitive. `/a4h/100/mcp` is not an alias for
`/A4H/100/mcp`. The public system segment is either a three-character SID or a 3–32-character route
alias containing uppercase letters, digits, and internal hyphens. Mount the case-sensitive pinned
matcher before the existing lowercase `/mcp` middleware.

Pinned endpoints keep ordinary argument shapes: no `target`, `system`, `client`, or destination
argument is added. Their tool/action set is still the pruned multi-target read-only surface, not the
single-target full surface.

### OAuth protected-resource metadata

RFC 9728 metadata must be registry-independent:

- for every syntactically valid `/<PUBLIC-SYSTEM>/<CLIENT>/mcp` resource, the corresponding public PRM URL
  returns 200 whether or not the target exists;
- `/multi/mcp` has its own fixed PRM resource;
- the document echoes the canonical requested resource and shared XSUAA authorization server but
  never consults or exposes the registry; and
- `scopes_supported` is exactly `read`, `data`, `sql`, and `admin`; the initial 401 challenge omits
  `scope` so MCP's general-client fallback can request that set and XSUAA can issue only the user's
  assigned subset; and
- each 401 `WWW-Authenticate` challenge points to metadata whose `resource` exactly matches the MCP
  endpoint the client connected to.

This is a deliberate interoperability tradeoff, not a precedent for eager write authorization.
Tokens may contain every mutation-free scope assigned to the user from the initial login, increasing
the impact of token theft relative to operation-specific step-up. Short token lifetime, XSUAA role
assignment, the instance/destination/SAP gates, and the structural mutation prohibition bound that
risk in v1. Before multi-target writes are considered, revisit the advertised scopes and require a
new consent/step-up design rather than adding `write`, `transports`, or `git` to this list.

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
  return a controlled `NO_TARGETS_CONFIGURED` result where protocol handling requires it. An admin
  still sees `SAPTargets` for registry diagnostics.
- 1 accepted target: inject a one-value enum.
- 2–16 accepted targets: inject an exact enum into each `target` property.
- 17–256 accepted targets: use a string with pattern
  `^[A-Z][A-Z0-9-]{1,30}[A-Z0-9]/[0-9]{3}$`; runtime membership remains authoritative.
- The target field description tells the model to call `SAPTargets` when it needs configured IDs or
  descriptions; listing a target does not prove that the current SAP user can access it.
- Do not generate a capability-conditioned `oneOf` tree per target. It would multiply schemas and
  exceed client/tool payload budgets.

The threshold is 16 because the current read-only surface is already close to the repository's
50,000-byte wire wall. CI measures synthetic aggregate registries at 16, 17, and 256 targets, plus
the 256-target data/SQL surface; do not raise the existing wall to accommodate duplicated enums.

Target input normalization is separate from general LLM empty-value stripping:

- null, empty, or whitespace-only input returns `TARGET_REQUIRED`;
- trim input and uppercase only the public system segment before validation, so `a4h-2025/001`
  resolves to the canonical `A4H-2025/001` target;
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

Multi-target dispatch rejects the hidden hyperfocused `SAP` alias and any plugin/custom tool name,
even if a client calls an unlisted tool directly.

For 17–256 targets, the model obtains exact IDs and meaningful labels from `SAPTargets`; descriptions
are deliberately not duplicated into every SAP-contacting tool schema. There is no standalone HTTP
target catalog or browser HTML target page in v1. Copyable pinned and aggregate client-configuration
templates remain in end-user documentation instead of being repeated in MCP tool output.

### `SAPTargets` catalog tool

`SAPTargets` is aggregate-only and performs no PP, ADT, feature-probe, or SAP request. Pinned MCP
servers never list or dispatch it.

- A reader sees the tool only when more than one active target exists. No input returns every active
  target as the compact array
  `[{ "target": "A4H/100", "description": "...", "identity": "per-user" }]`.
- An admin sees the tool at zero, one, or many active targets and when discovery or the 256-target
  limit makes the registry unavailable. This keeps diagnostics reachable without a separate HTTP
  endpoint. Active rows reuse the same compact identity field and do not repeat the derivable
  authentication type. Passive Basic health is summarized once under `admin.sharedAuthentication`;
  at most 8 deterministic exception rows include target ID, state, and time, with explicit
  total/returned/truncation metadata. An administrator narrows `query` to inspect a specific target.
- Optional `query` is a case-insensitive string with maximum length 160. Admins may also pass an
  integer `offset` from 0 through 1,000,000 to page safe diagnostics; reader calls reject `offset`.
  The input schema rejects extra properties, and runtime validation mirrors both bounds.
- Reader queries match target ID and sanitized description. Admin queries may additionally
  match destination name, status, reason code, and safe message.
- Admin diagnostics are deterministically paged at 50 rows. Return offset, total, returned,
  truncation, and next-offset metadata so the caller can continue or narrow `query`; never let a
  broad query or an over-limit registry flood the model context.
- The tool description states that configuration visibility is not proof of current-user SAP access.
- Apply the ordinary read scope, `SAP_DENY_ACTIONS`, per-user MCP rate limit, request ID, and start/end
  audit events. Audit only whether a query was supplied (and, if useful, its validated length); never
  write the raw query text to audit or logs.
- Direct calls obey the same role/count rules as `tools/list`; an unlisted direct call cannot bypass
  scope, deny-action, or registry-state handling.

## Administrator Diagnostics Contract

`docs_page/multi-target-setup.md` is the normative deployment/configuration guide.
`docs_page/multi-target-administration.md` is the normative operator/diagnostics contract and must
be kept synchronized with response types and reason codes.

### Read view

Return only the compact array of accepted `{ target, description, identity }` triples, optionally narrowed by
`query`. Never return a BTP destination name, SAP URL, endpoint/client configuration, policy detail,
excluded destination, reason code, registry metadata, or per-user availability in the read view.

### Admin expansion

If the token has global admin, return an envelope
`{ "targets": [...], "admin": { ... } }`: `targets` is the same compact accepted-target list and
`admin` contains:

- registry state: `ready`, `degraded`, or `error`;
- source: `btp-subaccount` (diagnostic label, not a configurable enum);
- snapshot `loadedAt` and secret-free `revision`;
- counts: scanned, unrelated, ARC-adjacent, ARC-related, enabled, active, disabled, ignored, and
  quarantined;
- the registry-level discovery/limit failure, when present; and
- diagnostic mode plus offset/total/returned/truncated/next-offset metadata; and
- exception diagnostics in `admin.destinations` by default: disabled, ignored, quarantined, or
  otherwise non-active **ARC-related** destinations. ARC-related means the destination contains at
  least one property whose key starts with `arc1.` case-insensitively; only exact lowercase
  allowlisted keys are valid.

When an admin supplies `query`, include matching active destination details as well as matching
exceptions. A diagnostic may contain destination name, parseable target ID, sanitized
description/fallback, and:

- normalized safe fields: type, proxy type, authentication type, SID, client, language, and
  `hasCloudConnectorLocationId` boolean;
- requested/effective data-preview and free-SQL values plus `limitedByInstance`;
- status, warnings, deterministic reason codes, and safe messages.

Do not duplicate generated VS Code/GitHub Copilot configuration in `SAPTargets`; documentation shows
the fixed URL templates. Keeping default admin output exception-focused prevents a healthy
256-target estate from injecting a very large diagnostic response into the model context. Return at
most 50 deterministic diagnostic rows in either mode; `diagnosticOffset`, `diagnosticTotal`,
`diagnosticReturned`, `diagnosticsTruncated`, and `diagnosticNextOffset` make paging explicit. The
admin can follow `diagnosticNextOffset` with the same query or narrow the query.

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
| `INVALID_TARGET_ALIAS` | Optional public system alias is malformed. |
| `MISSING_CLIENT` / `INVALID_CLIENT` | `sap-client` is absent or invalid. |
| `UNSUPPORTED_TYPE` | Destination is not HTTP. |
| `UNSUPPORTED_PROXY` | Destination is not OnPremise. |
| `UNSUPPORTED_AUTH` | Destination authentication is neither PrincipalPropagation nor BasicAuthentication. |
| `BASIC_AUTH_DISABLED` | BasicAuthentication was configured while the default-off instance ceiling is false. |
| `BASIC_PREEMPTIVE_DISABLED` | Basic destination explicitly disables preemptive authentication. |
| `MISSING_DESCRIPTION` | Non-fatal warning; public label falls back to target ID. |
| `INVALID_LANGUAGE` | Optional `sap-language` is malformed. |
| `UNKNOWN_ARC1_PROPERTY` | Enabled entry uses an unsupported `arc1.*` key. |
| `INVALID_POLICY` | Data/SQL policy value is malformed. |
| `UNSUPPORTED_V1_WRITE_CONFIG` | Enabled entry tries to configure a multi-target mutation. |
| `DUPLICATE_TARGET` | More than one enabled entry claims the same resulting public target ID. |
| `DUPLICATE_BASIC_CONNECTION` | More than one enabled Basic entry claims the same physical URL/client/Cloud Connector location. Every claimant is quarantined so aliases cannot bypass the shared credential guard. |
| `DUPLICATE_DESTINATION_NAME` | Discovery input contains the same name more than once. |
| `SHADOWED_BY_INSTANCE` | Same name exists at service-instance level. |
| `TARGET_LIMIT_EXCEEDED` | More than 256 entries are enabled; no discovered route is active. |
| `REGISTRY_DISCOVERY_ERROR` | Destination discovery failed. |

Instance-policy narrowing is not a reason code: an accepted target keeps `ACTIVE` and exposes
`limitedByInstance: true` in the admin diagnostic when requested data/SQL exceeds the instance
ceiling.

Admin output describes only the current CF process snapshot. PP-only multi-instance deployments can
compare `revision` values while diagnosing a rolling update. A Basic-enabled multi-target v1 app
must have exactly one CF instance because its credential-generation guard and passive health are
process-local. Normal configuration changes use `cf restart`.

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
| `TARGET_REQUIRED` | Aggregate call omitted `target` or supplied null/empty/whitespace. | Supply a target from the schema enum or call `SAPTargets`. |
| `INVALID_TARGET` | Aggregate target is not valid public-system/client syntax. | Correct the target value. |
| `UNKNOWN_TARGET` | Target ID is syntactically valid but absent from the accepted snapshot. | Call `SAPTargets`; restart after destination changes. |
| `NO_TARGETS_CONFIGURED` | Multi mode is enabled with no accepted targets. | Configure a destination and restart. |
| `MULTI_TARGET_REGISTRY_UNAVAILABLE` | Discovery/limit error prevented a usable registry. | Admin calls `SAPTargets` on `/multi/mcp` and checks health/logs. |
| `TARGET_CONFIG_CHANGED` | Live lookup no longer matches the startup non-secret fingerprint. | Restart ARC-1 after reviewing the destination. Basic `User`/`Password` changes are excluded and rotate hot. |
| `TARGET_POLICY_DENIED` | Instance or destination did not enable data/SQL. | Administrator changes both required gates and restarts for destination changes. |
| `BASIC_CREDENTIALS_MISSING` | Authoritative request-time Basic destination has no usable User/Password. | Repair the destination and retry without restart. |
| `BASIC_CREDENTIALS_INVALID` | Basic username contains `:` or surrounding whitespace. | Correct the destination and retry without restart. |
| `DESTINATION_AUTH_SETUP_FAILED` | Request-time destination lookup or Basic client preparation failed before ADT. | Check Destination/Connectivity and retry only when transient or after repair. |
| `PP_SETUP_FAILED` | Failure is proven to occur before ADT dispatch during Destination/Connectivity lookup or token exchange. | Fix BTP/Cloud Connector setup, then retry. |
| `CLOUD_CONNECTOR_ACCESS_DENIED` | BTP Connectivity returned its verified exposure-denial signature before SAP handled the ADT request. | PP: match the reviewed HTTPS/X.509 PP mapping. Basic: match the reviewed Basic OnPremise mapping; it does not require the PP identity certificate. Allow the required ADT paths, then retry. |
| `SAP_AUTHENTICATION_FAILED` | Backend returned login/401 behavior. For PP, do not claim a specific missing-user cause. For Basic, the credential generation is blocked to protect the SAP account. | Fix PP/mapping or rotate the Basic destination credentials, then retry. |
| `SAP_AUTHORIZATION_DENIED` | Structured SAP 403/authorization refusal. | Grant the required SAP authorization, then retry. |
| `SAP_SERVICE_INACTIVE` | SAP ICF/ADT service is inactive rather than a user authorization issue. | Activate/fix the service, then retry. |
| `SAP_REQUEST_FAILED` | A post-resolution network failure or SAP 5xx prevented the request without proving an authentication cause. | Check Cloud Connector/SAP health, then retry once. |
| `SAP_TARGET_BUSY` | Basic target's bounded serialization queue is full or its 30-second acquisition timed out. | Retry after the active shared-identity request completes. |
| `SAP_TARGET_TEMPORARILY_UNAVAILABLE` | Basic canary had a network, timeout, 429, SAP 5xx, or unrecognized non-login 2xx protocol response. | Retry after checking SAP/intermediary health; the credential generation remains eligible. |

Honor `ARC1_MINIMAL_ERRORS`. Never expose raw SAP HTML/bodies, destination properties, credentials,
authorization headers, assertions, or internal stack traces. Text must remain conclusive for clients
that ignore structured content.

Do not cache PP or per-user SAP authentication/authorization failures—not globally and not in an MCP
session. A user can say “try again now” after Basis fixes mapping or permissions, and the next call
must reach PP/SAP again. Basic authentication/authorization failures are the lockout-protection
exception: the rejected credential generation stays blocked until the destination credentials
change, with bounded old-generation retention for Destination consistency. If XSUAA roles changed,
the user needs a fresh token/sign-in.

Set `retryable: true` for PP, Cloud Connector exposure, SAP authentication, authorization, and
service failures that can change externally. Set it false for unknown target, empty registry, target
policy, and snapshot drift within the current process. “Retryable” permits a user-initiated retry
after a fix; it must not cause an unbounded automatic retry loop.

Audit stages must distinguish:

- ARC/XSUAA authentication;
- target resolution;
- destination resolution and selected identity mode;
- PP exchange, where applicable;
- Basic credential-generation state, where applicable, without the digest or credentials;
- Cloud Connector exposure/access;
- SAP authentication;
- SAP authorization;
- target policy; and
- successful SAP execution.

The existing `auth_pp_created` event proves only PP credential/session creation; it must not be
reported as successful SAP login. Log target ID, safe human XSUAA identity, effective identity mode,
request ID, stage, outcome, and safe error class. Never log secrets or raw authentication response
bodies. For Basic targets, SAP records the shared technical user; correlate it with ARC-1 audit
events for human attribution. SAP-side login/security logging remains dependent on SAP system
configuration and is not guaranteed by ARC-1.

Add the public `target`, effective `identity`, and secret-safe internal `destination` name to the
audit base event. The destination name is operator context and must never enter reader-facing tool
results; never log destination properties, URLs, or credentials. Emit one terminal MCP-call outcome
plus stage-transition events for failures (`target_resolution_failed`, `pp_exchange_failed`,
`shared_auth_failed`, `cloud_connector_access_denied`, `sap_service_unavailable`,
`sap_authentication_failed`, `sap_authorization_failed`, and `target_policy_denied`). The deliberate
shared-Basic success exception is `auth_shared_created`, emitted only after its canary succeeds as
specified by the shared-identity plan. Keep other successful stage detail in structured stderr debug
logs so one successful call does not create several billable BTP Audit Log records.

## Feature State, Cache, and User Availability

- Multi mode requires `ARC1_CACHE=none` in v1. There is no shared source/object cache behavior to
  reason about across 100 targets.
- Warmup no longer exists and is not part of this design.
- Do not run startup feature probes or construct a shared/default ADT client for discovered targets.
- On the first SAP-contacting call for a target, use that authorized caller's PP-backed client or
  the selected Basic destination's request-local client and a per-target single-flight probe. Cache
  only a completed successful probe by immutable target ID; clear it when a Basic credential
  generation changes.
- Feature state has an explicit `unknown` representation. A 401/403/PP failure leaves it unknown;
  never translate an authorization failure to `available:false` or cache it.
- Do not probe all targets on startup or when `SAPTargets` is called.
- Feature evidence may improve runtime routing/error messages, but it does not rewrite the process's
  MCP tool schemas.
- Do not store per-user target availability in memory, session state, disk, or an external system.
  It becomes stale when SAP access changes and does not survive deployment. A target list is a config
  inventory, not an entitlement inventory.
- Offline `SAPLint.lint|lint_and_fix|list_rules`, read-only
  `SAPTransport.list|get|check|history`, and the reviewed mutation-free `SAPDiagnose` actions are
  exposed through explicit action allowlists. ATC and ABAP Unit execute SAP workloads, retain the
  existing `read` scope, and remain subject to SAP authorization, global concurrency/rate limits,
  and `SAP_DENY_ACTIONS`.
- The optional UI, plugins, and hyperfocused mode are disabled while multi mode is active.

## Concurrency and Rate Limits

- `ARC1_MAX_CONCURRENT` remains one process-wide SAP request semaphore shared by all single-target, pinned,
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
- In-memory limits are per CF app instance. PP-only multiple instances multiply total pressure on
  SAP. Basic-enabled multi-target v1 is restricted to one CF instance.

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

## Health, Restart, Rotation, and Instance Behavior

Health needs component detail without target inventory:

- Discovery succeeds with zero accepted targets: process is healthy; multi component is `ready`
  with zero targets.
- Discovery fails or the 256 limit is exceeded: overall `/health` remains 200, the multi component
  is `error`, and pinned MCP routes return 503. This prevents the CF HTTP health check from
  crash-looping the app.
- Individual invalid/quarantined candidates do not make the process unhealthy if the snapshot itself
  was built; admin diagnostics and warning logs explain them.
- Authenticated aggregate MCP remains reachable in every registry state. An admin can list and call
  `SAPTargets` to inspect the safe failure/exception diagnostics; other aggregate tool calls return
  `MULTI_TARGET_REGISTRY_UNAVAILABLE`. A reader receives no diagnostic tool at zero/one targets or
  registry failure.

Non-secret destination changes are deliberately restart-bound:

1. Export/clone/edit/import destinations in BTP Cockpit or CLI.
2. Validate in Cockpit.
3. Run `cf restart <app>`.
4. Check `/health` and call `SAPTargets` with an admin token through `/multi/mcp`.
5. For a PP-only scaled deployment, query each app instance with
   `X-CF-APP-INSTANCE: <app-guid>:<index>` and compare revisions. Do not scale a Basic-enabled v1
   deployment above one instance.

No MTAR rebuild or `cf deploy` is needed. A Basic destination's `User`/`Password` is the one
exception: rotate it in Cockpit and the next request loads the new generation without restart. For
zero downtime, atomically switch both fields to a second reviewed technical user and revoke the old
user only after safe reads succeed. Same-user password rotation may have a short consistency/outage
window because SAP normally cannot keep both passwords valid. DCR signing configuration must remain
stable across restarts. The MTA keeps one instance by default, which is mandatory whenever Basic
multi-target is enabled; deployment must also avoid rolling/blue-green overlap.

## Implementation Work Plan

### 1. Freeze and publish the architecture baseline before feature code

- Add proposed ADR-0006, qualify ADR-0005, and add ADR-0007 for the explicit shared Basic identity
  exception; reflect both boundaries in the auto-loaded `AGENTS.md` rule.
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

- Add `ARC1_MULTI_TARGET_ENDPOINTS` with default false and
  `ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH` with a separate default false.
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
- Remove active fake single-target destination placeholders from `mta.yaml`. A multi-only deployment
  has no `SAP_BTP_DESTINATION` or `SAP_BTP_PP_DESTINATION`; set them only for an intentional
  single-target `/mcp`.
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
- Canonicalize the revision with a total sort over fixed-field-order safe records; prove shuffled
  discovery order, including duplicate names, produces the same revision and diagnostics.
- Keep raw Destination Service objects out of registry memory.

### 5. Build isolated target runtimes and selected-identity clients

Files:

- `src/server/server.ts`
- `src/server/context.ts`
- `src/handlers/feature-cache.ts`
- `src/adt/client.ts` and `src/adt/http.ts` only where client pinning/state isolation requires it
- `tests/unit/server/server.test.ts`
- `tests/unit/handlers/feature-cache.test.ts`

Work:

- Reuse PR #543's runtime separation where safe.
- Build every discovered config fresh from its sanitized descriptor. Never spread the base single-target
  config; do not copy user/password, cookies, service keys, bearer providers, `SAP_INSECURE`, or
  `SAP_DISABLE_SAML`. Destination/Connectivity determines the discovered route's transport.
- Build target runtimes eagerly from the immutable snapshot, but create no default/shared ADT client
  and run no technical SAP login or startup probe.
- Hardcode strict PP for PrincipalPropagation runtimes while leaving the optional single-target
  runtime's existing PP, API-key, and direct-OIDC behavior unchanged. BasicAuthentication runtimes
  are shared identity and never serve as PP fallback.
- Resolve the exact destination without cache for every SAP-contacting request, require a
  subaccount owner, and verify all non-secret connection, target, language, and supported `arc1.*`
  fingerprint fields. For PP, validate the user JWT through the Connectivity service and use PP
  Option 2 without provider or instance fallback. For Basic,
  acquire the process-wide target gate before lookup, bind a HMAC credential generation, retain no
  raw secret, use a bounded queue/timeout and old-generation blocklist, and hold the gate through
  dispatch. Never cache a failed PP validation; measure Destination and Connectivity service
  latency/load in beta.
- Force the target client into every ADT client/request.
- Keep feature state keyed by public immutable target ID.
- Probe features lazily through the first authorized caller using a per-target single-flight. Cache
  only successful target feature evidence, clear it on Basic generation change, and add an explicit
  unknown state for auth/PP failures.
- Carry an immutable target context per aggregate call; never mutate server-scoped config or client
  state while switching targets.
- Share the one process-wide SAP semaphore.
- Warn on single-target/discovered connection duplication without disabling either route.

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
  `allowTransportWrites=false`, and `allowGitWrites=false`, independently of process-wide or
  single-target write flags, and reject forbidden operations again at the ADT safety boundary.
- Permit source/metadata reads and the explicitly dual-gated data/SQL operations.
- Put effective `allowDataPreview` and `allowFreeSQL` into each target SafetyConfig so synthesized
  SQL/data paths such as `SAPSearch.tadir_lookup_db|both` and
  `SAPDiagnose.odata_perf|authorization_trace` cannot bypass target consent.
- Add `SAPLint` and `SAPTransport` only through explicit action allowlists:
  `lint|lint_and_fix|list_rules` and `list|get|check|history`. Permit the following `SAPDiagnose`
  actions through a separate exact allowlist: `syntax`, `unittest`, `atc`, `atc_variants`,
  `cds_testcases`, `dumps`, `traces`, `trace_requests`, `system_messages`, `gateway_errors`,
  `object_state`, `quickfix`, `odata_perf`, `cds_sql`, `sql_trace_state`, `sql_trace_directory`, and
  `authorization_trace`. The existing data gates still control `odata_perf` and
  `authorization_trace`. Reject every omitted action at both list time and call time.
- Pinned schemas gain no `target` argument, but use the same pruned multi-target read-only surface as
  aggregate routes; they are not byte-identical to the single-target full surface.
- Add shallow aggregate `target` injection without duplicating handler Zod schemas.
- Validate/strip target before normal dispatch.
- Implement exact target enums through 16 targets and the compact syntax pattern for 17–256.
- Add aggregate-only `SAPTargets` with role/count-sensitive listing and dispatch: readers see it only
  above one active target; admins see it at any count and during registry failure; pinned servers
  never expose it.
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
  before case-insensitive single-target `/mcp` middleware.
- Never bind a discovered target to `/mcp`.
- Run a dedicated XSUAA-only verifier without a fixed scope in the initial 401, then require read
  from the validated token before registry membership lookup. An authenticated syntactically valid
  but absent pinned target receives a generic HTTP 404; a valid token without read receives 403.
- Reuse one per-user and one per-IP MCP limiter across every route.
- Keep OAuth rate limiting separate.
- Make unknown/malformed paths generic to unauthenticated callers.
- Implement registry-independent RFC 9728 metadata for every syntactically valid pinned resource
  plus fixed aggregate metadata. The `resource` and `WWW-Authenticate` metadata URL must match the
  endpoint exactly and must not reveal membership.

### 8. Add role-sensitive `SAPTargets` diagnostics

Files:

- `src/server/multi-target-tools.ts`
- `src/server/multi-target-server.ts`
- `src/server/server.ts`
- `src/authz/policy.ts`
- `scripts/validate-action-policy.ts`
- new response/view helper if needed, for example `src/server/multi-target-catalog.ts`
- focused MCP tool and HTTP aggregate-route tests

Work:

- Keep the aggregate MCP transport reachable through registry failure while pinned target routes
  remain unavailable; non-catalog aggregate calls fail with the structured registry error.
- Return only compact target/description/identity rows to readers and only when more than one active
  target exists.
- Always expose the tool to admins, including zero/one targets and unavailable registries. Default
  admin output contains state/counts/failure plus exception diagnostics; a validated query may reveal
  matching active safe details.
- Page either admin diagnostic mode at 50 deterministic rows and report
  offset/total/returned/truncated/next-offset metadata so broad queries and over-limit registries
  remain context-safe without making later rows unreachable.
- Define strict `{ query?: string(max 160), offset?: integer(0..1_000_000) }` input with no extra
  properties; `offset` is admin-only. Never log or audit the raw query.
- Route the tool through read-scope, deny-action, per-user rate-limit, request-ID, and audit handling,
  but never construct a PP/ADT client or run feature probes.
- Do not mount a standalone HTTP target catalog or generate per-target client configuration in tool
  output. Keep fixed VS Code/GitHub Copilot examples in documentation.
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
  classify only the verified plain-text BTP Connectivity exposure denial as
  `CLOUD_CONNECTOR_ACCESS_DENIED`, and keep any body-marker heuristic narrow and signature-scoped
  under ADR-0002.
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
- `docs_page/multi-target-setup.md`
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
- External `arc-mcp/mcp-hub` documentation: <https://github.com/arc-mcp/mcp-hub>
- `docs_page/index.md`, `docs_page/roadmap.md`, `docs/compare/00-feature-matrix.md`
- `mkdocs.yml`

ADR requirements:

- Preserve ADR-0005 as historical and mark it superseded/qualified, not silently rewritten.
- Explain why pinned routes retain structural binding.
- Explain why the aggregate endpoint is acceptable for the read-only v1: target is explicit and
  required on every call, there is no default/session state, selected-target policy is rechecked,
  and mutations are structurally removed.
- Accept explicitly that a wrong aggregate target can disclose data/SQL from the wrong authorized
  system. Record mitigations: explicit target every call, meaningful `SAPTargets` labels,
  no remembered/default target, runtime policy recheck, SQL/data off by default, and separate instances for lookalike
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
- Update “12 tools” claims to explain that standard single-target mode remains 12 tools while
  multi-target v1 exposes up to eight permitted SAP-contacting tools plus conditional aggregate-only
  `SAPTargets`.
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
- exact real SID/client, optional public alias, description, and boolean validation;
- unknown ARC property and unsupported write config fail closed;
- missing description warns and falls back;
- duplicate target/name and instance shadow quarantine every claimant;
- only ARC-related destinations appear in admin diagnostics; unrelated names do not;
- raw URLs, credentials, tokens, headers, certs, and location IDs are unreachable from retained
  discovery/registry object graphs and never serialize/log;
- discovery failure keeps health 200, makes pinned routes return 503, keeps aggregate MCP reachable
  for admin `SAPTargets`, and gives other aggregate calls a structured registry error, with or
  without a single-target `/mcp`;
- single-target `/mcp` unchanged and never auto-assigned;
- strict-PP single-target and discovered duplicate fingerprint warning with both routes usable;
- actually shared Basic bare-route overlap fails startup, and duplicate Basic physical claimants
  are quarantined symmetrically;
- pinned schemas have no target argument and use the frozen multi read-only surface;
- aggregate schemas have exactly one required target argument;
- exact enums at 1 and 16 targets plus the syntax pattern at 17 and 256, including target
  null/empty/lowercase/malformed/unknown;
- aggregate is mounted at 0/1 targets;
- `SAPTargets` is absent from pinned servers, appears to aggregate readers only above one active
  target, and appears to aggregate admins at 0/1/many targets and registry failure;
- reader `SAPTargets` returns only compact target/description/identity rows; admin default output returns
  state/counts/failure and exception diagnostics, while a validated query includes matching active
  safe details;
- admin diagnostics are deterministically paged at 50 with correct
  offset/total/returned/truncated/next-offset metadata for both many exceptions and broad active
  queries, and every page remains reachable;
- `SAPTargets.query` rejects values above 160, `offset` rejects non-integers/out-of-range/read-user
  use, extra properties fail, reader/admin filtering is case-insensitive, and raw query text never
  reaches logs or audit;
- direct `SAPTargets` calls preserve the same scope/count/role/deny rules, share the per-user rate
  limiter/request ID/audit pipeline, and perform no PP, ADT, SAP, or feature-probe call;
- no target/session memory and cross-call target switches are explicit;
- global Viewer sees all accepted targets but SAP can deny a selected one;
- data and SQL require instance + destination + scope + SAP auth;
- no multi-target mutation or lock appears or dispatches, including for admin and a write-enabled
  single-target `/mcp`; every discovered SafetyConfig hardcodes writes/transport/Git false;
- offline SAPLint, read-only transport inspection, ATC, and ABAP Unit appear and dispatch, while
  every omitted `SAPLint`/`SAPTransport` action, hidden `SAP`, and `Custom_*` remains absent and a
  direct invocation fails;
- auth occurs before route resolution and public endpoints do not enumerate targets; no standalone
  HTTP target-catalog route is mounted;
- initial multi-target 401 challenges omit `scope`, protected-resource metadata advertises exactly
  `read data sql admin`, XSUAA role grants determine the returned subset, and a validated token
  without read receives 403 before route resolution;
- read/admin `SAPTargets` views differ exactly as specified and remain secret-safe;
- uncached PP drift across connection/policy fields, SAP client pinning, lazy success-only feature
  probing, explicit unknown feature state, and no discovered default/shared client;
- auth failures are not cached and can succeed on immediate retry;
- one global semaphore and shared rate buckets across all routes;
- cache/UI/plugins/hyperfocused constraints and the exact lint/transport/ATC/unit-test action
  allowlists;
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

Create the beta deployment in a dedicated CF space in the existing test subaccount. A different
route alone is not isolation: the fixed MTA module and service names can otherwise update an
existing deployment in the same space. The local CF/BTP CLI login must be refreshed before the live
run; never print service keys, `VCAP_SERVICES`, tokens, assertions, or destination credentials.

#### Operator-driven tests that can be automated

Once a real XSUAA user has completed the authorization-code flow, the test runner can keep the
access token in memory and automate these cases through CF/BTP APIs and MCP JSON-RPC. A CF or BTP
CLI token alone cannot replace this step: it is not the ARC-1 XSUAA user token and cannot prove
ARC-1 scopes or Principal Propagation.

1. With more than one active target, a mapped Viewer successfully calls `SAPTargets` and performs
   source/system reads on pinned and aggregate routes; an admin receives diagnostics at every target
   count and registry failure.
2. A valid XSUAA read user without SAP mapping produces the captured HTTP status/content-type/body
   signature and the conservative safe classification.
3. A propagated SAP user that exists but lacks ADT authorization produces a captured structured SAP
   403 classified as `SAP_AUTHORIZATION_DENIED`.
4. A deliberately broken pre-ADT Destination/Connectivity lookup produces `PP_SETUP_FAILED`; a
   missing or disallowed Cloud Connector exposure produces `CLOUD_CONNECTOR_ACCESS_DENIED`; and a
   post-PP ambiguous 401 defaults to `SAP_AUTHENTICATION_FAILED`.
5. After Basis fixes mapping/authorization, retry in the same MCP session succeeds—proving no denial
   cache.
6. Missing XSUAA read returns HTTP 403 before Destination Service/SAP.
7. Route client and ADT `sap-client` match for multiple clients of one SID.
8. Data/SQL work only on a target with both instance and destination consent.
9. Editing a destination without restart causes fingerprint drift rejection; restart loads the new
   revision.
10. PP-only: two CF app instances expose the same routes/revision and share DCR behavior. Basic:
    the MTA descriptor and deployment procedure require exactly one non-rolling CF app instance,
    and startup warns that the credential guard is process-local. Runtime cannot prove the CF scale,
    so the operator also verifies `cf app` reports `1/1` before opening the service.
11. Seed unique sentinel strings in a test destination password, token-like property, URL, and
    location ID, then assert those sentinels are absent from logs, audit sink, `/health`,
    `SAPTargets`, MCP errors, and serialized discovery. Also seed a unique query sentinel and prove
    its raw value is absent from logs and audit events. Verify absence from retained in-process
    registry object graphs separately in an automated unit/integration test.
12. Exercise zero, one, and many active targets; duplicate target/name, shadow, invalid destination,
    and destination-disable cases; restore the reviewed destination state after every test.
13. Prove valid-but-unknown, malformed, lowercase, bare `/mcp`, and `/targets` routes have the
    documented authenticated and unauthenticated behavior.
14. Basic: verify default-off quarantine, mixed PP/Basic targets, shared identity labeling, absent
    or true Preemptive acceptance, explicit false rejection, missing/malformed credentials, one
    successful canary, centralized 401/login-page classification, no automatic retry, queue
    full/timeout behavior, and complete secret absence from registry/catalog/log/audit/error data.
15. Rotate a Basic password without restart. Prove the next request uses the new generation, the
    old generation stays blocked across an old/new/old Destination consistency sequence, successful
    feature evidence is cleared, and transient SAP/network failure does not poison the generation.

#### Human-assisted identity and client matrix

These checks need either an interactive login or identities/clients the repository and CF/BTP CLIs
cannot synthesize safely:

1. Use separate users for Viewer, Data Viewer, Viewer + SQL, Admin, no ARC-1 role, no SAP mapping,
   and SAP-mapped-without-ADT authorization. Do not test a lower role by adding it to an Admin user:
   XSUAA scope union leaves that user an admin.
2. In VS Code/GitHub Copilot, connect once to a pinned URL and once to `/multi/mcp`; verify tool
   lists, `SAPTargets` visibility, target argument behavior, one read per target, reconnect, and
   “try again now” after an access repair.
3. Repeat the aggregate OAuth/tool/read flow in Cursor. A pinned Cursor connection is needed only if
   its transport/OAuth behavior differs from the aggregate result.
4. Repeat the aggregate flow in Microsoft Copilot Studio, including popup consent, reconnect, and a
   tool call. Its hosted callback and popup behavior cannot be proven by CLI JSON-RPC.
5. When SAP Platform 2025 and S/4HANA 2023 share the same real `sap-sysid`/`sap-client`, configure
   a distinct public ID by aliasing one or both, enable both, restart, and prove pinned plus
   aggregate `SYSTEM` reads reach the intended releases. Separately prove a duplicate-alias test
   quarantines every claimant, then restore the reviewed destination state and restart.

For every live case, record the app GUID/version, registry revision, CF instance index, user role,
endpoint style, expected result, and actual result. Record the ARC-1 request ID when the request
reaches MCP dispatch; for pre-auth HTTP responses, `/health`, protected-resource metadata, and route
404s, record the HTTP status and available correlation evidence instead. Never record access/refresh
tokens, assertions, destination exports, raw URLs, or credentials.

Do not run multi-target write CRUD. Before customer rollout, smoke-test offline lint, read-only
transport inspection, ATC, and ABAP Unit on one pinned PP target; repeat ATC/Unit on aggregate or
shared Basic only where that identity mode is actually in scope and Basis has approved the load.

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
- [x] No credentials/tokens/assertions/headers/query params/certs in logs, errors, health,
      `SAPTargets`, audit, or revision material; raw catalog queries are not logged or audited.
- [x] Unknown ARC configuration fails closed.
- [x] Duplicate/shadow conflicts have no implicit winner.
- [x] More than 256 enabled targets activates none.
- [x] Multi-target mutations are absent from schemas and rejected again at dispatch/safety layers.
- [x] Multi-target lock/enqueue operations are absent and rejected at the safety layer.
- [x] Data/SQL require instance, target, XSUAA, and SAP consent.
- [x] XSUAA auth is checked before route existence.
- [x] PrincipalPropagation is strict and has no shared-identity fallback; BasicAuthentication is a
      separate default-off target identity, never a fallback.
- [x] Basic credentials are request-local, secret-free in all retained/output state, protected by a
      process-wide bounded generation guard, and require exactly one non-rolling CF instance in v1.
- [x] Discovered configs are built fresh and cannot inherit credentials/cookies/bearer providers or
      construct a default shared ADT client.
- [x] Route target and ADT client agree on `sap-client`.
- [x] Runtime non-secret destination drift fails closed until restart; only Basic User/Password
      rotation is hot-loaded through the protected generation path.
- [x] Unauthorized user failures cannot poison shared feature state.
- [x] Per-user negative access results are never cached; rejected Basic credential generations are
      blocked only for account-lockout protection with bounded retention.
- [x] Read/admin `SAPTargets` separation and zero/one/failure-state admin access are test-covered.
- [x] Global semaphore/rate limit cannot be multiplied by target count.
- [x] RFC 9728 metadata and unauthenticated route behavior cannot reveal registry membership.
- [x] Raw discovery secrets are unreachable from the retained registry object graph.
- [x] Single-target `/mcp` compatibility is test-covered.

## Deferred Beyond V1

The proposed sequencing, security gates, acceptance matrix, and rollback rules for these items are
tracked in the [multi-target v2 roadmap](multi-target-v2-roadmap.md). That roadmap is not normative
until its individual ADRs and pull requests are accepted.

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
- plugins, optional UI integration, and hyperfocused mode;
- SAP-backed lint formatting/settings, transport topology (`layers`/`targets`), transport
  mutations, and dedicated ATC/ABAP Unit workload grants/quotas beyond the v1 global controls;
- a standalone HTTP/browser target catalog and cookie/session login;
- dynamic destination refresh without restart; and
- a write-safe aggregate routing model.

## Ready-to-Implement Exit Criteria

The implementation can start when this document and the administrator page agree on:

- exact flag and destination property names;
- routes and aggregate schema rules;
- global XSUAA roles and `SAPTargets` visibility;
- the read-only/data/SQL policy intersection;
- the 256-target fail-closed behavior;
- admin safe fields and reason codes;
- error classifications and retry behavior; and
- the test/rollout sequence.

Those decisions are now locked in this plan. Any change to target visibility, write support,
discovery scope, or aggregate target semantics requires an explicit plan/ADR update before code is
merged.
