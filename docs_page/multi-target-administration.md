# Multi-Target Administration

!!! warning "Experimental v1"

    Multi-target mode is default-off and mutation-free. Treat it as a shared read gateway, not as
    256 isolated ARC-1 instances.

This page is the operator reference for security boundaries, registry behavior, diagnostics,
capacity, and incident handling. Follow [Multi-System Setup](multi-target-setup.md) first for the
copy-paste deployment, destination, role, and MCP client configuration.

<a id="administration-model"></a>
<a id="4-configure-xsuaa-roles"></a>
<a id="5-choose-an-endpoint-style"></a>
<a id="vs-codegithub-copilot-pinned-target"></a>
<a id="vs-codegithub-copilot-aggregate-target"></a>

## Operating model

Responsibility is intentionally split across four administrators:

| Owner | Controls | Security effect |
|---|---|---|
| ARC-1 deployment owner | ARC-1 application environment, usually deployed through MTA | Enables the mode and sets the application-wide maximum for data and SQL. |
| BTP destination administrator | One subaccount destination per SAP connection | Defines the real SID/client, optional public route alias, connection, label, and narrower data/SQL opt-ins. |
| Identity administrator | Existing XSUAA role collections | Grants global read, data, SQL, or admin scope. There are no per-target roles in v1. |
| SAP/Basis administrator | PP mapping and SAP authorizations | Determines whether the propagated user can access a selected SAP client and operation. |

A request succeeds only when all applicable layers permit it:

```text
multi-target v1 ceiling
∩ ARC-1 instance ceiling
∩ selected destination policy
∩ XSUAA user scope
∩ propagated SAP authorization
```

No layer can widen an earlier one. `MCPAdmin` cannot bypass SAP authorization or unlock mutations on
multi-target routes.

A pinned route reduces accidental target switching, but it is not an ACL. A global read user can
try every accepted pinned route. The aggregate route introduces an additional wrong-target risk: a
model can select a different authorized system and read data or run SQL there. Keep data/SQL off
unless approved, use distinct factual descriptions, and separate lookalike systems when that risk
is unacceptable.

### When separate instances are safer

Use one ARC-1 instance per target, optionally behind the
[Multi-System Hub](multi-system-hub.md), when you need:

- writes, activation, transport mutation, or Git mutation;
- target-specific visibility or authorization before SAP is contacted;
- different XSUAA tenants, subaccounts, or identity providers;
- hard performance, maintenance, or failure isolation;
- independent production and non-production security boundaries; or
- a security boundary stronger than a shared process with per-request target validation.

Multi-target v1 reduces application sprawl; it does not create independent security or capacity
domains inside one process.

## Process and registry lifecycle

<a id="1-prepare-the-arc-1-application"></a>

### Startup contract

When `ARC1_MULTI_TARGET_ENDPOINTS=true`, startup validation requires:

- `SAP_TRANSPORT=http-streamable` and `SAP_XSUAA_AUTH=true`;
- BTP CF XSUAA, Destination, and Connectivity bindings rather than a service key;
- `ARC1_CACHE=none`, `ARC1_TOOL_MODE=standard`, and `ARC1_UI=off`;
- no plugins, shared cookie source, or `SAP_PP_ALLOW_SHARED_COOKIES` escape hatch; and
- no direct `SAP_URL`, `SAP_USER`, or `SAP_PASSWORD` connection.

Discovered runtimes always force strict per-user Principal Propagation. `SAP_PP_ENABLED` and
`SAP_PP_STRICT` control only an optional single-target `/mcp` runtime; they do not enable or weaken a
discovered target.

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

If a single-target destination is also discovered as a public target route, both endpoints remain
available and may have different effective policies. ARC-1 logs a warning because that duplication
is usually unintentional.

### Discovery, conflicts, and the 256-target ceiling

ARC-1 reads one immutable snapshot of BTP **subaccount** destinations at startup. It also reads
service-instance destination names only to detect same-name shadowing; instance destinations do not
become targets.

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

### Restart, drift detection, and multiple CF instances

Creating, editing, disabling, or deleting a destination does not change a running snapshot. Use a
normal restart so every CF app instance loads the new configuration:

```bash
cf restart <arc1-app-name>
```

No new MTAR or `cf deploy` is required for destination-only changes.

Before each SAP call, ARC-1 resolves the selected PP destination without the SDK cache and compares
its safe connection, public alias, and policy fingerprint with the startup snapshot. A mismatch returns
`TARGET_CONFIG_CHANGED` until restart. Failed PP or SAP access is not cached, so mapping and
authorization repairs can be retried immediately.

After restart, verify that every CF instance reports the same registry revision through admin
`SAPTargets`. To route an authenticated aggregate MCP request to one instance, use
`X-CF-APP-INSTANCE: <app-guid>:<index>` and compare revisions across indexes.

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

The complete field table and minimal/SQL examples are in
[Destination configuration](multi-target-setup.md#destination-configuration). The operational rules
are:

- the only supported v1 keys are `arc1.enabled`, `arc1.allow_data_preview`,
  `arc1.allow_free_sql`, and optional `arc1.target_alias`;
- `arc1.target_alias` changes only the public target/pinned route; real `sap-sysid` and `sap-client`
  remain required for SAP and are visible to admins in diagnostics;
- omitted data/SQL values are false and the two switches are independent;
- unknown `arc1.*` keys and any write/package/transport/Git key quarantine an enabled destination;
- `limitedByInstance: true` means a target requested data or SQL above the current instance ceiling;
  source reads remain active;
- changing any target field or policy requires a restart; and
- there is no `arc1.config_version` or full-write destination profile in v1.

Descriptions are returned to users and models. Treat them as untrusted labels: no prompts,
instructions, credentials, secrets, token-bearing links, or sensitive notes.

Destination exports may contain connection or authentication material. Never commit, attach, paste,
or screenshot an unredacted export. If an example must be shared, remove URLs, location IDs,
credentials, tokens, certificates, and any nonessential topology details.

<a id="6-read-and-admin-saptargets-views"></a>

## `SAPTargets` operator surface

`SAPTargets` is an authenticated MCP tool available only on `/multi/mcp`. There is no `/targets`
HTTP endpoint and no public target inventory. It goes through normal scope and deny-action checks,
request IDs, audit events, and the per-user MCP limiter when `ARC1_RATE_LIMIT` is configured.

<a id="read-user"></a>

### Reader view

Readers see the tool only when more than one target is active. With no arguments it returns accepted
public IDs and descriptions:

```json
[
  { "target": "A4H/100", "description": "A4H development client 100" },
  { "target": "BWQ/200", "description": "BW quality analytics client 200" }
]
```

Optional `query` is a case-insensitive filter over target ID and description. The reader result does
not expose destination names, URLs, policy, rejected entries, or SAP user state. A listed target is
configured; it is not proof that the current user can access SAP.

### Admin user

Admins see `SAPTargets` at zero, one, or many active targets and during registry failure. Their
response wraps the public target list and adds secret-projected registry state.

Without `query`, diagnostics contain a bounded page of non-active ARC-related destinations and
their exclusion reasons. With `query`, diagnostics also include matching active targets and can
match target ID, active-target description, destination name, status, code, or safe message.

When an active target uses an alias, a matching admin diagnostic correlates its public `target`
with the real `sid` and `client`, and reports the validated value as `arcConfig.targetAlias`.
Readers still receive only `target` and `description`.

```json
{
  "targets": [
    { "target": "A4H/100", "description": "A4H development client 100" }
  ],
  "admin": {
    "state": "degraded",
    "source": "btp-subaccount",
    "loadedAt": "<timestamp>",
    "revision": "<sha256-hex>",
    "counts": {
      "scanned": 2,
      "unrelated": 0,
      "arcAdjacent": 0,
      "arcRelated": 2,
      "enabled": 2,
      "active": 1,
      "disabled": 0,
      "ignored": 0,
      "quarantined": 1
    },
    "diagnosticMode": "exceptions",
    "diagnosticOffset": 0,
    "diagnosticTotal": 1,
    "diagnosticReturned": 1,
    "diagnosticsTruncated": false,
    "destinations": [
      {
        "destinationName": "ARC1_INVALID_PP",
        "status": "quarantined",
        "code": "INVALID_SYSID",
        "message": "sap-sysid must match three uppercase alphanumeric characters and start with a letter.",
        "type": "HTTP",
        "authentication": "PrincipalPropagation",
        "proxyType": "OnPremise",
        "client": "100",
        "hasCloudConnectorLocationId": false,
        "arcConfig": { "enabled": true },
        "warnings": []
      }
    ]
  }
}
```

Diagnostics are sorted and paged at 50 rows. When `diagnosticNextOffset` is present, call the tool
again with the same `query` and `offset` set to that value. `offset` is admin-only, accepts integers
from 0 through 1,000,000, and makes every matching destination reachable without one unbounded
result. `query` is optional and limited to 160 characters; extra arguments are rejected. Raw query
text is not written to the audit event.

`arcAdjacent` counts subaccount destinations that contain `sap-sysid` or `sap-client` but no
`arc1.*` marker. Their names are not returned. The count helps identify a likely missing
`arc1.enabled=true` without exposing unrelated inventory.

Admin output never contains:

- destination URLs or raw Destination Service objects;
- users, passwords, client secrets, tokens, SAML assertions, or authorization headers;
- destination query/header properties or certificates;
- raw Cloud Connector location IDs; or
- per-user SAP/PP failures or inferred availability.

`hasCloudConnectorLocationId` is a boolean only, and the revision is derived from safe normalized
configuration. The admin response is still operator-sensitive: it exposes internal destination
names, topology labels, normalized policy, and failure reasons to the MCP client/model. Use it only
in trusted operator sessions and redact it before pasting into issues, pull requests, chats, or
support tickets.

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
| `UNSUPPORTED_AUTH` | V1 requires `PrincipalPropagation`. |
| `INVALID_LANGUAGE` | Remove or correct `sap-language`. |
| `UNKNOWN_ARC1_PROPERTY` | Remove or correct the unsupported ARC-1 property. |
| `INVALID_POLICY` | Set the data/SQL property to `true` or `false`. |
| `UNSUPPORTED_V1_WRITE_CONFIG` | Remove write-related properties; writes are unavailable. |
| `DUPLICATE_TARGET` | Give every enabled destination a unique public target ID. Systems sharing a real SID/client need an alias on one or both destinations; every duplicate claimant is quarantined. |
| `DUPLICATE_DESTINATION_NAME` | Remove duplicate inputs; every enabled claimant is quarantined and all claimants remain non-routable. |
| `SHADOWED_BY_INSTANCE` | Remove/rename the same-name instance destination or subaccount candidate. |
| `TARGET_LIMIT_EXCEEDED` | Reduce enabled candidates to 256 or fewer and restart; none are active while over limit. |
| `REGISTRY_DISCOVERY_ERROR` | Check Destination binding/token/network health, then restart. |

`LIMITED_BY_INSTANCE` is not a reason code. An active entry keeps `code: "ACTIVE"` and sets
`limitedByInstance: true` when its requested policy exceeds the instance ceiling.

<a id="8-troubleshoot-user-access"></a>

## User access failures and retries

ARC-1 reports the proven failure stage without exposing raw SAP responses:

| Error | Meaning and response |
|---|---|
| `PP_SETUP_FAILED` | Destination/Connectivity lookup or token exchange failed before ADT dispatch. Repair PP/Cloud Connector and retry immediately. |
| `SAP_AUTHENTICATION_FAILED` | SAP returned login/401 behavior or an ambiguous post-PP 403. It may be mapping, backend login, or PP configuration; ARC-1 does not claim that the user definitely does not exist. |
| `SAP_AUTHORIZATION_DENIED` | SAP returned a structured authorization refusal for the propagated user. Repair the SAP role and retry. |
| `SAP_SERVICE_INACTIVE` | The target ICF/ADT service is inactive or unreachable in that form, rather than merely a user-role issue. |
| `SAP_REQUEST_FAILED` | A post-PP network error or SAP 5xx prevented the request without proving an auth failure. Check Cloud Connector/SAP health and retry once. |
| `TARGET_POLICY_DENIED` | Data/SQL is not enabled at every ARC-1 policy layer. |
| `TARGET_CONFIG_CHANGED` | The destination no longer matches the startup snapshot. Review it and restart. |

PP setup success is not proof of SAP login. Access failures are deliberately not cached: after
Basis fixes the mapping or authorization, the user can say “try again now” in the same conversation.
A changed XSUAA role requires a new OAuth token/sign-in.

HTTP middleware enforces XSUAA before tool dispatch. Audit events distinguish downstream target
resolution, PP exchange, SAP authentication, SAP authorization, and execution. Whether SAP itself
logs each login attempt depends on SAP security configuration.

<a id="9-size-the-shared-instance"></a>

## Shared capacity and rate limits

Every target and optional single-target route shares one `ARC1_MAX_CONCURRENT` semaphore per CF app
instance. The default 10 means ten concurrent SAP requests across the whole process—not ten per
target. Destination count alone does not justify a higher value; expected active users and SAP
dialog work-process capacity do. A busy target can temporarily occupy all slots.

Each additional CF process creates another semaphore, so horizontal scaling multiplies the possible
load on a target. Size the fleet against the most constrained SAP target and include every ARC-1
process that can reach it, including processes from other deployments. If substantially different
SAP capacities require different caps, split those targets into separate ARC-1 deployments.

The authoritative formula and shared-beta rate starting points are in
[Multi-target shared beta (BTP CF)](rate-limiting.md#multi-target-shared-beta-btp-cf). Do not derive
`ARC1_MAX_CONCURRENT` from user or destination count. `ARC1_RATE_LIMIT` defaults to off;
multi-target logs a warning when it is zero, so start with the documented positive per-user limit and
tune from audit and latency evidence.

<a id="10-operational-checklist"></a>

## Operational checklist

- [ ] The feature is explicitly enabled and all multi-target routes remain mutation-free.
- [ ] XSUAA, Destination, and Connectivity bindings are healthy.
- [ ] Every target uses strict Principal Propagation; no shared SAP identity fallback exists.
- [ ] Every target has a valid real SID, client, factual description, `arc1.enabled=true`, and a unique valid route alias when its SID/client is reused.
- [ ] Data/SQL is approved and enabled only where required at both instance and target layers.
- [ ] No target contains unknown or write-related `arc1.*` keys.
- [ ] Enabled candidate count is 256 or fewer.
- [ ] Admin `SAPTargets` shows no duplicate, shadow, quarantine, or unexpected policy narrowing.
- [ ] Every CF instance reports the same registry revision.
- [ ] Viewer, unmapped-user, SAP-unauthorized, broken-PP, and changed-destination cases were tested.
- [ ] Logs, audit sinks, tickets, and screenshots contain no destination secrets or raw SAP bodies.
- [ ] Rate and concurrency limits were reviewed with Basis.
- [ ] Lookalike production/non-production systems are separated if wrong-target reads are unacceptable.
- [ ] Admin scope is restricted to trusted operator sessions, especially beside writable `/mcp`.

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
- cache modes, plugins, optional UI, hyperfocused mode, SAPLint, ATC, and ABAP Unit;
- a browser HTML catalog or cookie/session login;
- per-target concurrency reservations; and
- live destination refresh without restart.

Repository maintainers can find the architecture, test matrix, and rollout contract in
`docs/plans/destination-discovered-multi-target-v1.md` and
`docs/adr/0006-experimental-read-only-multi-target.md`.
