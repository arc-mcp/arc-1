# Multi-target administration

Operate an existing multi-target service: diagnose excluded targets, apply destination changes, rotate shared credentials and size capacity. For initial connection, use [Multi-system setup](multi-target-setup.md); for app upgrades and roles, use [BTP administration](btp-administration.md).

| Task | Go to |
|---|---|
| Target missing or excluded | [Registry codes](#status-warning-and-failure-codes) |
| Target call fails | [Access failures and retries](#user-access-failures-and-retries) |
| Destination changed | [Restart and rotation](#restart-drift-detection-rotation-and-cf-instances) |
| Rotate Basic credentials | [Shared-identity controls](#basic-shared-identity-controls) |
| Inspect configuration | [SAPTargets](#saptargets-operator-surface) |
| Set load limits | [Shared capacity](#shared-capacity-and-rate-limits) |

<a id="administration-model"></a>
<a id="4-configure-xsuaa-roles"></a>
<a id="5-choose-an-endpoint-style"></a>
<a id="vs-codegithub-copilot-pinned-target"></a>
<a id="vs-codegithub-copilot-aggregate-target"></a>

## Operating model

Multi-target v1 is experimental, default-off and mutation-free. Every request must pass all five layers:

```text
multi-target ceiling ∩ app ceiling ∩ destination policy ∩ XSUAA scope ∩ SAP authorization
```

The ARC-1 administrator sets maximum capabilities, the Destination administrator selects connection/identity and target policy, the identity administrator assigns global scopes, and Cloud Connector/SAP Basis administrators control network access and SAP authorization. `MCPAdmin` cannot enable multi-target mutations.

PP uses each human's SAP identity. Basic uses one technical identity for all authorized callers. A pinned route is a selection guard, not a target-specific access rule. On an aggregate route, a model can select the wrong allowed target and disclose its source, table data or SQL results as if they came from another system.

### OAuth grant behavior

Routes advertise `read`, `data`, `sql`, and `admin`; XSUAA grants the assigned subset. A token without global `read` receives 403 before route lookup. Role changes require a new login/reconnect.

Admin diagnostics may expose internal target names and policy. Use trusted operator sessions and short-lived Admin tokens. Review [side-by-side `/mcp` access](#optional-single-target-mcp) before assigning Admin.

### When separate instances are safer

Use one ARC-1 instance per target, with a separate MCP connection for each, when you need:

- writes, activation, transport mutation, or Git mutation;
- target-specific visibility or authorization before SAP is contacted;
- different XSUAA tenants, subaccounts, or identity providers;
- hard performance, maintenance, or failure isolation;
- independent production and non-production security boundaries; or
- a security boundary stronger than a shared process with per-request target validation.

## Process and registry lifecycle

<a id="1-prepare-the-arc-1-application"></a>

<a id="startup-contract"></a>

### Startup requirements

When `ARC1_MULTI_TARGET_ENDPOINTS=true`, startup validation requires:

- `SAP_TRANSPORT=http-streamable` and `SAP_XSUAA_AUTH=true`;
- BTP CF XSUAA, Destination, and Connectivity bindings rather than a service key;
- `ARC1_CACHE=none`, `ARC1_TOOL_MODE=standard`, and `ARC1_UI=off`;
- no plugins, shared cookie source, or `SAP_PP_ALLOW_SHARED_COOKIES` escape hatch; and
- no direct `SAP_URL`, `SAP_USER`, or `SAP_PASSWORD` connection.

PrincipalPropagation runtimes always force strict per-user PP. BasicAuthentication runtimes are
accepted only when `ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH=true`; the flag is false by default, and
Basic never becomes fallback for PP. `SAP_PP_ENABLED` and `SAP_PP_STRICT` control only an optional
single-target `/mcp` runtime; they do not change a discovered target's identity mode.

When Basic multi-target is enabled, keep exactly one CF app instance. Its credential-generation
guard and passive authentication health are process-local. PP-only multi-target retains the
existing scaling behavior.

The process may start with zero targets. This supports deploy first, create destinations second,
then restart.

### Optional single-target `/mcp`

An explicitly configured `SAP_BTP_DESTINATION` and optional `SAP_BTP_PP_DESTINATION` may keep one
single target at bare `/mcp`. Discovered targets are never assigned there and do not inherit the
single target's destination names or policy.

The single-target endpoint retains its normal configuration, including possible write/package behavior;
the discovered pinned and aggregate routes remain mutation-free. Process-wide multi-target startup
constraints—cache none, standard tools, UI/plugins/cookies/direct credentials off—still affect the
single-target runtime.

!!! danger "Use least privilege in side-by-side deployments"

    `MCPAdmin` implies all ARC-1 scopes. The token cannot write through multi-target routes, but it
    may write, release transports, or operate Git through a write-enabled single-target `/mcp`. Do not
    grant Admin merely for routine target discovery. Prefer a separate application if operators
    need diagnostics while ordinary users need a writable single-target endpoint.

If a per-user/PP single-target destination is also discovered as a public target route, both
endpoints remain available and may have different effective policies. ARC-1 logs a warning because
that duplication is usually unintentional. A shared-Basic SAP connection cannot be exposed through
both bare `/mcp` and a multi-target route in v1; ARC-1 rejects that configuration at startup.

Copilot Studio's JSON-RPC compatibility traffic sent to `/authorize` always uses the mutation-free
aggregate server while multi-target mode is enabled. It does not select the side-by-side `/mcp`,
even when that single-target endpoint is configured and writable. Connect clients directly to
`/mcp` only when the single-target surface is intentional.

### Discovery, conflicts, and the 256-target ceiling

ARC-1 reads one immutable snapshot of BTP **subaccount** destinations at startup. It also reads
service-instance destination names only to detect same-name shadowing; instance destinations do not
become targets.

Use separate subaccounts for independent destination inventories; another CF space is not an inventory boundary.

Only destinations containing an `arc1.*` property enter detailed ARC-1 validation. A destination is
active only when `arc1.enabled=true` and all connection/identity fields pass validation.

Conflict handling is deterministic and fail closed:

- duplicate destination names quarantine every enabled claimant; disabled or marker-missing entries remain non-active;
- multiple enabled destinations claiming one public target ID quarantine every claimant;
- a subaccount candidate shadowed by a same-name instance destination is excluded; and
- more than 256 enabled candidates activates none of them—ARC-1 never chooses a “first 256”.

Invalid enabled destinations count toward the 256 ceiling. Destination ordering never selects a
winner.

When separate systems reuse a real SID/client, set `arc1.target_alias` on at least one so their
public IDs differ—for example, preserve `A4H/001` and add `A4H-2025/001`. You may alias both for
symmetry. Both descriptors retain real `sid: "A4H"` and `client: "001"`. Duplicate detection uses
the public ID. An alias is model-visible routing metadata, not an authorization boundary; prefer an
alias that starts with the real SID and a factual `Description`.

<a id="3-restart-to-load-changes"></a>

### Restart, drift detection, rotation, and CF instances

Creating, editing, disabling, or deleting a destination does not change a running snapshot. Use a
normal restart so every CF app instance loads the new configuration:

```bash
cf restart <arc1-app-name>
```

No new MTAR or `cf deploy` is required for destination-only changes.

Before each SAP call, ARC-1 resolves the selected destination without a destination cache and
requires the Destination Service response to identify a subaccount owner. An instance-level owner
is rejected even when its safe configuration matches. ARC-1 then compares the safe connection,
public alias, and policy fingerprint with the startup snapshot. A mismatch returns
`TARGET_CONFIG_CHANGED` until restart. PP additionally validates the current user JWT with the
Connectivity service on every call. Failed PP or per-user SAP access is not cached, so mapping and
authorization repairs can be retried immediately.

Basic `User`/`Password` values are intentionally excluded from that fingerprint. ARC-1 loads them
inside a process-wide per-target gate, stores only a keyed generation digest, and uses one backend
authentication attempt for a new generation. A rejected generation stays blocked to protect the
SAP account; changing the destination credentials admits a new generation without restart. For
zero downtime, switch atomically to a second authorized technical user and revoke the former user
only after safe reads succeed. A same-user password change can have a short outage window.

For PP-only scaled deployments, verify that every CF instance reports the same registry revision
through admin `SAPTargets`. To route an authenticated aggregate MCP request to one instance, use
`X-CF-APP-INSTANCE: <app-guid>:<index>` and compare revisions. Do not scale a Basic-enabled v1 app.

### Health states

`/health` intentionally remains HTTP 200 to avoid a CF crash loop.

| Health component | Meaning |
|---|---|
| `multiTarget.status="ready"` | The registry snapshot is usable. Zero active targets and individually quarantined destinations are still valid snapshots. |
| `multiTarget.status="error"` | Discovery failed or the 256-enabled-target ceiling invalidated the entire registry. |

During registry-wide failure, `/multi/mcp` stays reachable so an admin can call `SAPTargets`.
Pinned routes return HTTP 503 and other aggregate tool calls return a structured registry error.
The admin catalog distinguishes `ready`, `degraded`, and `error` configuration states in more
detail than `/health`.

<a id="enabling-data-preview-or-sql"></a>
<a id="2-create-one-destination-per-systemclient"></a>
<a id="data-preview-and-sql-example"></a>
<a id="clone-destinations-safely"></a>

## Destination policy operations

Use the [destination fields](btp-destination-setup.md#multi-target-field-contract) for accepted properties. Data and SQL default to off and require their app ceiling, target opt-in, user scope and SAP authorization.

`limitedByInstance: true` means a target requested more data/SQL access than the app permits; source reads remain active. Unknown or write-related `arc1.*` properties quarantine the target. Change non-secret fields, then restart every instance.

Descriptions appear in model-visible catalogs. Keep them factual and short. [Sanitize destination exports](btp-destination-setup.md#destination-importexport) before sharing.

### Basic shared-identity controls

Basic is a separately enabled shared identity. Use PP instead when per-user SAP attribution, target-specific SAP permissions or horizontal scaling is required.

| Control | Requirement |
|---|---|
| SAP user | Dedicated technical user with only required ADT permissions; no `SAP_ALL` or unnecessary write/transport access. Use a strong ASCII password and rotate credentials regularly. |
| Data and SQL | Keep disabled unless separately approved. SAP attributes these calls to the shared technical user. |
| Client boundaries | Prefer a separate user per SAP client and security boundary |
| Network | Separate principal-type-None (`NONE_RESTRICTED`) Connector mapping, required ADT paths and verified internal HTTPS |
| SAP logon | `/sap/bc/adt` must accept Basic; an SSO HTML response is rejected |
| Credential administration | Restrict/audit destination administrators; monitor expiry, lockout and unexpected logons |
| Deployment | Exactly one CF process; [non-rolling stop/deploy/start](btp-administration.md#non-rolling-update-for-shared-basic), including rollback |
| Audit | Correlate the human XSUAA caller in ARC-1 with the technical user's SAP activity |

**Rotate credentials without restarting:**

1. Prepare a second approved, least-privileged technical user.
2. Update destination `User` and `Password` together; leave non-secret fields unchanged.
3. Verify safe reads through pinned and aggregate routes and inspect shared-auth exceptions.
4. Revoke the previous user after successful verification.

A same-user password change can have a short consistency/outage window because SAP normally cannot accept both passwords. Healthy aggregate counts alone do not prove a new generation was used.

Each Basic target serializes credential validation and dispatch through one bounded process-local gate. Rolling or blue-green deployment creates independent guards even when the desired instance count is one.

<a id="6-read-and-admin-saptargets-views"></a>

## `SAPTargets` operator surface

`SAPTargets` is an authenticated MCP tool available only on `/multi/mcp`. There is no `/targets`
HTTP endpoint and no public target inventory. It goes through normal scope and deny-action checks,
request IDs, audit events, and the per-user MCP limiter when `ARC1_RATE_LIMIT` is configured.

<a id="read-user"></a>

### Reader view

Readers see the tool only when more than one target is active. With no arguments it returns accepted
public IDs, descriptions, and the effective SAP identity mode:

```json
[
  { "target": "A4H/100", "description": "A4H development client 100", "identity": "per-user" },
  { "target": "NPL/001", "description": "Read-only NPL client 001", "identity": "shared" }
]
```

Optional `query` is a case-insensitive filter over target ID and description. The reader result does
not expose destination names, URLs, policy, rejected entries, credentials, or runtime
authentication health. `per-user` means Principal Propagation; `shared` means every caller uses the
destination's technical SAP user. A listed target is configured; it is not proof that the current
user can access SAP.

### Admin user

Admins see `SAPTargets` at zero, one, or many active targets and during registry failure. Their
response wraps the public target list and adds registry diagnostics with secrets removed.

Without `query`, diagnostics contain a bounded page of non-active ARC-related destinations and
their exclusion reasons. With `query`, diagnostics also include matching active targets and can
match target ID, active-target description, destination name, status, code, or safe message.

`admin.sharedAuthentication` contains passive counts for `not_checked`, `checking`, `healthy`,
`configuration_invalid`, `authentication_failed`, `authorization_failed`, and
`temporarily_unavailable`. At most 8 non-normal target rows are returned in `exceptions`, with
explicit total/returned/truncation metadata; narrow `query` to the target ID when that list is
truncated. Reading `SAPTargets` never performs a destination lookup, SAP login, canary, or feature
probe; this is only the last process-local state observed during a real request.

When an active target uses an alias, a matching admin diagnostic correlates its public `target`
with the real `sid` and `client`, and reports the validated value as `arcConfig.targetAlias`.
Readers still receive only `target`, `description`, and `identity`.

| Admin field | Meaning |
|---|---|
| `state` | `ready`: usable registry without quarantine; `degraded`: usable registry with quarantined destinations; `error`: registry-wide failure |
| `source`, `failure` | Inventory source (`btp-subaccount`) and registry-wide failure, if any |
| `loadedAt`, `revision` | Startup snapshot time and safe configuration digest |
| `counts` | Scanned, unrelated, ARC-adjacent/related, enabled, active, disabled, ignored and quarantined totals |
| `destinations` | Safe diagnostic rows with destination name, status, code and policy |
| `sharedAuthentication` | Last observed Basic authentication state, not a live probe |
| `diagnosticMode` | `exceptions` without a query; `matching` with a query, including matching active targets |
| `diagnosticOffset`, `diagnosticTotal`, `diagnosticReturned`, `diagnosticsTruncated` | Page offset, total matches, returned rows and whether the response omits matching rows |
| `diagnosticNextOffset` | Value to pass as `offset` for the next page |

Diagnostics are sorted and paged at 50 rows. When `diagnosticNextOffset` is present, call the tool
again with the same `query` and `offset` set to that value. `offset` is admin-only, accepts integers
from 0 through 1,000,000, and makes every matching destination reachable without one unbounded
result. `query` is optional and limited to 160 characters; extra arguments are rejected. Raw query
text is not written to the audit event.

The inventory counts are separate groups: `arcRelated` contains destinations with an `arc1.*` property, including invalid or disabled candidates; `arcAdjacent` contains destinations with `sap-sysid` or `sap-client` but no `arc1.*` property; `unrelated` contains the remainder. Together they equal `scanned`.

The names of ARC-adjacent destinations are not returned. Their count can help identify a missing
`arc1.enabled=true` without exposing unrelated inventory.

Admin output omits credentials, raw URLs, auth responses, raw location IDs and per-user SAP availability. It still exposes internal destination names and policy: redact it before sharing outside the operator audience. `hasCloudConnectorLocationId` is only a boolean.

<a id="7-understand-status-and-reason-codes"></a>

## Status, warning, and failure codes

| Code | Status / operator action |
|---|---|
| `ACTIVE` | Target is routed. `limitedByInstance` may still show that requested data/SQL was narrowed. |
| `MISSING_DESCRIPTION` | Nonfatal warning on an active target; add a useful factual label. |
| `ARC1_ENABLED_MISSING` | ARC-related destination has no marker; add `arc1.enabled=true` if intended. |
| `ARC1_DISABLED` | Target is explicitly disabled; set true and restart if it should be active. |
| `ARC1_ENABLED_INVALID` | Use a boolean `true` or `false`. |
| `MISSING_NAME` / `INVALID_NAME` | Add or repair the destination name. |
| `MISSING_URL` / `INVALID_URL` | Add a valid HTTP/HTTPS URL. |
| `MISSING_SYSID` / `INVALID_SYSID` | Add/fix `sap-sysid` using the exact three-character format. |
| `INVALID_TARGET_ALIAS` | Remove the alias or use 3–32 uppercase letters/digits with internal hyphens, starting with an uppercase letter and without the client suffix. |
| `MISSING_CLIENT` / `INVALID_CLIENT` | Add/fix the three-digit `sap-client`. |
| `UNSUPPORTED_TYPE` | Use an HTTP destination. |
| `UNSUPPORTED_PROXY` | V1 requires `OnPremise`. |
| `UNSUPPORTED_AUTH` | Use `PrincipalPropagation`, or explicitly permitted `BasicAuthentication`. |
| `BASIC_AUTH_DISABLED` | The Basic destination is quarantined because `ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH` is false/unset. Enable it only after accepting the shared-identity boundary. |
| `BASIC_PREEMPTIVE_DISABLED` | Remove `Preemptive=false` or set it to `true`, then restart. |
| `INVALID_LANGUAGE` | Remove or correct `sap-language`. |
| `UNKNOWN_ARC1_PROPERTY` | Remove or correct the unsupported ARC-1 property. |
| `INVALID_POLICY` | Set the data/SQL property to `true` or `false`. |
| `UNSUPPORTED_V1_WRITE_CONFIG` | Remove write-related properties; writes are unavailable. |
| `DUPLICATE_TARGET` | Give every enabled destination a unique public target ID. Systems sharing a real SID/client need an alias on one or both destinations; every duplicate claimant is quarantined. |
| `DUPLICATE_BASIC_CONNECTION` | Keep exactly one enabled Basic destination for each physical URL/client/Cloud Connector location. Aliases cannot duplicate a shared Basic backend; every claimant is quarantined to preserve the lockout guard. |
| `DUPLICATE_DESTINATION_NAME` | Remove duplicate inputs; every enabled claimant is quarantined and all claimants remain non-routable. |
| `SHADOWED_BY_INSTANCE` | Remove/rename the same-name instance destination or subaccount candidate. |
| `TARGET_LIMIT_EXCEEDED` | Reduce enabled candidates to 256 or fewer and restart; none are active while over limit. |
| `REGISTRY_DISCOVERY_ERROR` | Check Destination binding/token/network health, then restart. |

`LIMITED_BY_INSTANCE` is not a reason code. An active entry keeps `code: "ACTIVE"` and sets
`limitedByInstance: true` when its requested policy exceeds the instance ceiling.

<a id="8-troubleshoot-user-access"></a>

## User access failures and retries

ARC-1 reports the detected failure stage without exposing raw SAP responses:

| Error | Meaning and response |
|---|---|
| `BASIC_CREDENTIALS_MISSING` | The authoritative request-time Find result has no usable `User`/`Password`. Repair the destination and retry without restart. |
| `BASIC_CREDENTIALS_INVALID` | The Basic username contains `:` or surrounding whitespace. Correct the destination and retry without restart. |
| `DESTINATION_AUTH_SETUP_FAILED` | Destination Find or Basic request-client preparation failed safely before ADT. Check the request ID and Destination/Connectivity health; retry only when transient or after repair. |
| `PP_SETUP_FAILED` | Destination/Connectivity lookup or token exchange failed before ADT dispatch. Repair PP/Cloud Connector and retry immediately. |
| `CLOUD_CONNECTOR_ACCESS_DENIED` | BTP Connectivity returned its specific exposure denial before SAP handled the ADT request. PP targets must match the HTTPS/X.509 PP mapping. Basic targets need a separate principal-type-None (`NONE_RESTRICTED`) OnPremise mapping and do not use the PP identity certificate. Allow the required ADT paths, then retry. |
| `SAP_AUTHENTICATION_FAILED` | PP: SAP returned login/401 behavior and mapping/login must be repaired. Basic: SAP rejected the shared credential generation. ARC-1 will not retry that generation for 15 minutes, but an unchanged bad credential can be attempted once again after expiry or process restart. Update destination credentials promptly instead of treating the block as permanent. |
| `SAP_AUTHORIZATION_DENIED` | SAP returned a structured authorization refusal. PP: repair the propagated user's role and retry. Basic canary: repair the technical user's least-privilege ADT role, then restart, wait 15 minutes for the temporary block, or rotate credentials. |
| `SAP_SERVICE_INACTIVE` | The target ICF/ADT service is inactive or unreachable in that form, rather than merely a user-role issue. |
| `SAP_REQUEST_FAILED` | A post-resolution network error or SAP 5xx prevented the request without proving an auth failure. Check Cloud Connector/SAP health and retry once. |
| `SAP_TARGET_BUSY` | The Basic target's bounded serialization queue is full or the wait timed out. Retry after the active request completes; split/load-isolate the target if persistent. |
| `SAP_TARGET_TEMPORARILY_UNAVAILABLE` | The Basic canary had a network, timeout, 429, SAP 5xx, or unrecognized non-login 2xx response. The credential generation is not poisoned; check SAP/intermediary health, then retry. |
| `TARGET_POLICY_DENIED` | Data/SQL is not enabled at every ARC-1 policy layer. |
| `TARGET_CONFIG_CHANGED` | A non-secret destination field no longer matches the startup snapshot. Review it and restart. Basic `User`/`Password` rotation alone does not cause this error. |

PP setup success is not proof of SAP login. PP/per-user access failures are deliberately not
cached: after Basis fixes mapping or authorization, the user can say “try again now” in the same
conversation. Basic failures differ deliberately: the rejected credential generation remains
blocked for 15 minutes, including a bounded set of recently replaced generations. A changed
credential can proceed immediately; process restart also clears the block. An unchanged bad
credential may be attempted once again after expiry, so SAP account-lock monitoring remains
necessary. If a SAP-role repair must refresh cached feature support, restart or rotate credentials; waiting
for the block to expire does not refresh that cache. A changed XSUAA role requires a new OAuth token/sign-in.

Use the returned request ID to correlate ARC-1 audit, Connector and SAP logs. SAP records the technical user for Basic, so human attribution requires the ARC-1 audit record.

<a id="9-size-the-shared-instance"></a>

## Shared capacity and rate limits

Every target and optional single-target route shares one `ARC1_MAX_CONCURRENT` semaphore per CF app
instance. The default 10 means ten concurrent SAP requests across the whole process—not ten per
target. Destination count alone does not justify a higher value; expected active users and SAP
dialog work-process capacity do. A busy target can temporarily occupy all slots.

For PP-only deployments, each additional CF process creates another semaphore, so horizontal
scaling multiplies the possible load on a target. Basic-enabled multi-target v1 must remain at one
CF process because its credential-generation protection is process-local. Size the fleet against
the most constrained SAP target and include every ARC-1 process from other deployments that can
reach it. If substantially different SAP capacities require different caps, split those targets
into separate ARC-1 deployments.

Use the process-sizing formula and initial per-user rates in
[Multi-target shared beta (BTP CF)](rate-limiting.md#multi-target-shared-beta-btp-cf). Do not derive
`ARC1_MAX_CONCURRENT` from user or destination count. `ARC1_RATE_LIMIT` defaults to off;
multi-target logs a warning when it is zero, so start with the documented positive per-user limit and
tune from audit events and measured latency.

ATC and ABAP Unit are available to the existing `read` role in multi-target mode for compatibility
with single-target authorization. They are mutation-free at ARC-1's repository boundary but execute
SAP workloads. ABAP Unit runs harmless tests with short, medium, and long durations; dangerous and critical tests are excluded.
Review this with Basis before customer rollout. Use positive rate limits and an SAP-sized concurrency
cap, or disable one or both with
`SAP_DENY_ACTIONS=SAPDiagnose.atc,SAPDiagnose.unittest`. On a shared Basic target, the workload and
SAP-native attribution belong to the destination technical user even though ARC-1 audits the human
caller.

<a id="10-operational-checklist"></a>

## Operational checklist

Complete the common [BTP checks before users connect](btp-administration.md#pre-customer-acceptance), then check these multi-target details:

- Every target has the intended identity, real SID/client, unique public ID and factual description.
- Admin `SAPTargets` explains exclusions, duplicates, shadowing and policy narrowing; no more than 256 candidates are enabled.
- Every PP-only instance has the same registry revision; Basic-enabled deployments have exactly one process.
- Approved negative-access tests and, if enabled, Basic rotation/retry behavior have been verified.
- Data/SQL, diagnostics, rate limits and shared SAP capacity match the intended audience.
- Separate deployments protect lookalike systems when a wrong-target read is unacceptable.
- Trusted operators alone hold Admin, especially beside a writable `/mcp`.

<a id="deferred-features"></a>

## Deferred from v1

- multi-target writes, activation, transport mutation, and Git mutation;
- a full-write destination template;
- target-specific ARC-1 ACLs or XSUAA roles;
- persisted per-user target availability;
- API-key or direct Entra/IAS OIDC access to multi-target routes;
- SaaS subscriber/provider and cross-subaccount discovery;
- S/4HANA Public Cloud/SAML assertion targets;
- a second technical/design-time destination per target;
- cache modes, plugins, optional UI, and hyperfocused mode;
- SAP-backed lint formatting/settings, transport topology (`layers`/`targets`), and every transport
  mutation;
- a browser HTML catalog or cookie/session login;
- per-target concurrency reservations; and
- live destination refresh without restart.

Repository maintainers can find the architecture, test matrix, and deployment rules in
`docs/plans/destination-discovered-multi-target-v1.md` and
`docs/adr/0006-experimental-read-only-multi-target.md`. The Basic shared-identity exception is
defined by `docs/adr/0007-shared-basic-identity-for-read-only-multi-target.md`.
