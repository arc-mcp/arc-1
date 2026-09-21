# Multi-Target Administration

!!! warning "Experimental v1"

    Multi-target mode is default-off and mutation-free. Treat it as a shared read gateway, not as
    256 isolated ARC-1 instances.

This page is the operator reference for security boundaries, registry behavior, diagnostics,
capacity, and incident handling. Follow [Multi-System Setup](multi-target-setup.md) first for the
copy-paste deployment, destination, role, and MCP client configuration. Common BTP configuration
ownership, XSUAA collection lifecycle, DCR secrets, upgrades, scaling, rollback, logging, and
customer handover live in [BTP Administration](btp-administration.md).

<a id="administration-model"></a>
<a id="4-configure-xsuaa-roles"></a>
<a id="5-choose-an-endpoint-style"></a>
<a id="vs-codegithub-copilot-pinned-target"></a>
<a id="vs-codegithub-copilot-aggregate-target"></a>

## Operating model

Responsibility is intentionally split across administrators:

| Owner | Controls | Security effect |
|---|---|---|
| ARC-1 deployment owner | ARC-1 application environment, usually deployed through MTA | Enables the mode and sets the application-wide maximum for data and SQL. |
| BTP destination administrator | One subaccount destination per SAP connection | Defines the real SID/client, optional public route alias, connection, label, and narrower data/SQL opt-ins. |
| Identity administrator | Existing XSUAA role collections | Grants global read, data, SQL, or admin scope. There are no per-target roles in v1. |
| Cloud Connector administrator | Virtual mappings, principal mode, trust, and exposed paths | Carries the selected destination securely to the intended SAP backend. |
| SAP/Basis administrator | PP mapping or shared technical user, plus SAP authorizations | Determines whether the selected per-user or shared SAP identity can access a client and operation. |

A request succeeds only when all applicable layers permit it:

```text
multi-target v1 ceiling
∩ ARC-1 instance ceiling
∩ selected destination policy
∩ XSUAA user scope
∩ selected SAP identity authorization
```

No layer can widen an earlier one. `MCPAdmin` cannot bypass SAP authorization or unlock mutations on
multi-target routes. PrincipalPropagation targets are `per-user`; explicitly enabled
BasicAuthentication targets are `shared` and use the same SAP technical user for every scoped
XSUAA caller.

### OAuth grant behavior

Multi-target protected-resource metadata advertises `read`, `data`, `sql`, and `admin`, and the
initial 401 does not force one fixed scope. General MCP clients request that mutation-free set;
XSUAA intersects it with the authenticated user's assigned role collections, and ARC-1 filters the
tool/action surface from the resulting token. A validated token without global read still receives
403 before route membership is resolved.

This makes role changes visible after logout/reconnect in clients that do not support reliable MCP
scope step-up. It also means a trusted Admin receives all assigned mutation-free scopes at initial
login. Treat the token accordingly and keep its lifetime short. This model must be redesigned—not
merely expanded—before any multi-target write, transport, or Git scope is introduced.

A pinned route reduces accidental target switching, but it is not an ACL. A global read user can
try every accepted pinned route. The aggregate route introduces an additional wrong-target risk: a
model can select a different authorized system and read data or run SQL there. Keep data/SQL off
unless approved, use distinct factual descriptions, and separate lookalike systems when that risk
is unacceptable.

### When separate instances are safer

Use one ARC-1 instance per target, optionally behind an external router such as
[`arc-mcp/mcp-hub`](https://github.com/arc-mcp/mcp-hub), when you need:

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

A CF space is not a hard destination-inventory boundary. If two ARC-1 populations must not share
subaccount destination visibility, isolate them in separate subaccounts or another deliberate
platform boundary. Same-name instance destinations are quarantined rather than allowed to override
a subaccount target through normal Destination Service lookup precedence.

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
zero downtime, switch atomically to a second reviewed technical user and revoke the former user
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
- changing any target field or policy requires a restart, except Basic `User`/`Password` rotation;
  and
- there is no `arc1.config_version` or full-write destination profile in v1.

Descriptions are returned to users and models. Treat them as untrusted labels: no prompts,
instructions, credentials, secrets, token-bearing links, or sensitive notes.

Destination exports may contain connection or authentication material. Never commit, attach, paste,
or screenshot an unredacted export. If an example must be shared, remove URLs, location IDs,
credentials, tokens, certificates, and any nonessential topology details.

### Basic shared-identity controls

BasicAuthentication is a compatibility option, not the recommended enterprise identity model.
Enabling it separates responsibility deliberately: the deployment owner permits shared identity,
the destination administrator controls the credential, XSUAA controls which humans may call ARC-1,
and SAP authorizes only the technical user.

- Use a dedicated communication/technical user with the minimum ADT permissions required by the
  exposed read actions. Never use `SAP_ALL`; read-like ADT POST operations may still require the
  documented `S_ADT_RES` activities.
- Do not assign developer-wide, transport, activation, or write authorizations merely because the
  user is technical. Multi-target v1 cannot use them, and they enlarge the impact of credential
  misuse outside ARC-1.
- Prefer a different technical user per client and security boundary. Do not share one credential
  across unrelated production and non-production systems.
- Configure password-expiry and account-lock monitoring in SAP according to the customer's policy.
  Alert on impending expiry, locked users, repeated failed logons, and unexpected use outside the
  reviewed ADT paths. ARC-1 audit records identify the human XSUAA caller; SAP records only the
  shared technical user.
- Use a separate Cloud Connector mapping with principal type None (`NONE_RESTRICTED` in the API),
  restricted ADT paths, and an internal HTTPS connection to SAP. An HTTP internal hop exposes the
  reusable Basic password; ARC-1 cannot verify the mapping protocol.
- Confirm `/sap/bc/adt` accepts HTTP Basic for the technical user. ARC-1 suppresses SAML and rejects
  a 2xx HTML/SSO login page; it cannot make an SSO-only ICF logon procedure accept Basic.
- Restrict and audit destination-administrator access as credential-administrator access.
- Keep data/SQL off unless approved; SAP attributes those calls to the technical user.
- Keep exactly one CF app instance and deploy it non-rolling. A rolling/blue-green replacement can
  temporarily create a second independent guard even when the desired count is one. A Basic target
  serializes request-time destination lookup,
  credential-generation validation, canary/feature handling, and dispatch through one bounded
  process-local gate.
- For zero-downtime rotation, prepare a second least-privileged technical user, atomically update
  both destination `User` and `Password`, perform safe reads through the pinned and aggregate
  routes, and only then revoke the former user. For a same-user password change, accept a possible
  consistency/outage window: SAP normally cannot keep both passwords valid. Verify rotation with
  successful safe reads and absence of a shared-auth exception; aggregate healthy counts alone do
  not prove that a new credential generation was used. Do not change another destination field in
  the same rotation unless you also plan a restart.

If per-user SAP attribution, target-specific SAP authorization, or horizontal scaling is required,
use Principal Propagation or separate ARC-1 applications.

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
response wraps the public target list and adds secret-projected registry state.

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

```json
{
  "targets": [
    {
      "target": "NPL/001",
      "description": "Read-only NPL client 001",
      "identity": "shared"
    }
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
    "sharedAuthentication": {
      "targets": 1,
      "statusCounts": { "healthy": 1 }
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

ARC-1 reports the proven failure stage without exposing raw SAP responses:

| Error | Meaning and response |
|---|---|
| `BASIC_CREDENTIALS_MISSING` | The authoritative request-time Find result has no usable `User`/`Password`. Repair the destination and retry without restart. |
| `BASIC_CREDENTIALS_INVALID` | The Basic username contains `:` or surrounding whitespace. Correct the destination and retry without restart. |
| `DESTINATION_AUTH_SETUP_FAILED` | Destination Find or Basic request-client preparation failed safely before ADT. Check the request ID and Destination/Connectivity health; retry only when transient or after repair. |
| `PP_SETUP_FAILED` | Destination/Connectivity lookup or token exchange failed before ADT dispatch. Repair PP/Cloud Connector and retry immediately. |
| `CLOUD_CONNECTOR_ACCESS_DENIED` | BTP Connectivity returned its specific exposure denial before SAP handled the ADT request. PP targets must match the reviewed HTTPS/X.509 PP mapping. Basic targets need a separate reviewed principal-type-None (`NONE_RESTRICTED`) OnPremise mapping and do not use the PP identity certificate. Allow the required ADT paths, then retry. |
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
necessary. A changed XSUAA role requires a new OAuth token/sign-in.

HTTP middleware enforces XSUAA before tool dispatch. Audit events distinguish downstream target
resolution, effective identity mode, PP exchange where applicable, Basic credential-generation
state, Cloud Connector exposure denial, SAP authentication, SAP authorization, and execution. Raw
authentication bodies and secrets are suppressed. SAP sees only the technical user for Basic
targets, so human attribution requires the ARC-1 request/audit record. Whether SAP itself logs each
login attempt depends on SAP security configuration.

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

The authoritative formula and shared-beta rate starting points are in
[Multi-target shared beta (BTP CF)](rate-limiting.md#multi-target-shared-beta-btp-cf). Do not derive
`ARC1_MAX_CONCURRENT` from user or destination count. `ARC1_RATE_LIMIT` defaults to off;
multi-target logs a warning when it is zero, so start with the documented positive per-user limit and
tune from audit and latency evidence.

ATC and ABAP Unit are available to the existing `read` role in multi-target mode for compatibility
with single-target authorization. They are mutation-free at ARC-1's repository boundary but execute
SAP workloads (ABAP Unit currently includes all risk levels and short, medium, and long durations).
Review this with Basis before customer rollout. Use positive rate limits and an SAP-sized concurrency
cap, or disable one or both with
`SAP_DENY_ACTIONS=SAPDiagnose.atc,SAPDiagnose.unittest`. On a shared Basic target, the workload and
SAP-native attribution belong to the destination technical user even though ARC-1 audits the human
caller.

<a id="10-operational-checklist"></a>

## Operational checklist

- [ ] The feature is explicitly enabled and all multi-target routes remain mutation-free.
- [ ] XSUAA, Destination, and Connectivity bindings are healthy.
- [ ] Every target has an intentional identity: strict Principal Propagation, or explicitly enabled Basic with no fallback between modes.
- [ ] PP destinations match an HTTPS/`X509_RESTRICTED` mapping and CERTRULE setup; Basic destinations match a separate principal-type-None mapping with internal HTTPS and a Basic-capable ADT ICF logon procedure. All required ADT paths are allowed.
- [ ] Basic uses a least-privileged technical user (not `SAP_ALL`), strong reviewed credentials, password-expiry/account-lock monitoring, audited destination administration, and exactly one non-rolling CF instance.
- [ ] Every target has a valid real SID, client, factual description, `arc1.enabled=true`, and a unique valid route alias when its SID/client is reused.
- [ ] Data/SQL is approved and enabled only where required at both instance and target layers.
- [ ] No target contains unknown or write-related `arc1.*` keys.
- [ ] Enabled candidate count is 256 or fewer.
- [ ] Admin `SAPTargets` shows no duplicate, shadow, quarantine, or unexpected policy narrowing.
- [ ] PP-only scaled deployments report the same registry revision on every instance; Basic-enabled deployments have exactly one instance.
- [ ] Viewer, unmapped-user, SAP-unauthorized, broken-PP, changed-destination, and (if enabled) Basic credential rotation/lockout-protection cases were tested.
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
- cache modes, plugins, optional UI, and hyperfocused mode;
- SAP-backed lint formatting/settings, transport topology (`layers`/`targets`), and every transport
  mutation;
- a browser HTML catalog or cookie/session login;
- per-target concurrency reservations; and
- live destination refresh without restart.

Repository maintainers can find the architecture, test matrix, and rollout contract in
`docs/plans/destination-discovered-multi-target-v1.md` and
`docs/adr/0006-experimental-read-only-multi-target.md`. The Basic shared-identity exception is
defined by `docs/adr/0007-shared-basic-identity-for-read-only-multi-target.md`.
