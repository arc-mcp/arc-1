# Repository graph (experimental)

!!! warning "Experimental — compatible backend required"

    This is an opt-in preview, not part of the default setup. Use an ARC build that contains
    [the adapter](https://github.com/arc-mcp/arc-1/pull/756); do not assume an older installed
    release or `latest` contains it. PostgreSQL and HANA backends now live in this repository,
    with independent builds and experimental setup instructions, but still
    without a published supported installer. **Do not create services just to configure ARC.**

`SAPGraph` queries a separately deployed metadata/relationship index. ARC does not collect
objects, store source, connect to PostgreSQL/HANA, or use AI Core for this feature. Existing
SAPRead, SAPContext and request-driven caches are unchanged. This is **not live SAP where-used**.

The adapter requires a compatible **v2 graph API**. The optional backend is in
`services/repository-graph/`, not the ARC npm/Docker distribution or a hosted service. Follow
[backend setup](repository-graph-backend.md) for Docker PostgreSQL or BTP PostgreSQL/HANA.
Both databases have live API/ARC test evidence. Cloud Connector technical-user collection is
available; an unattended BTP installer is not shipped. The
[detailed specification](repository-graph-specification.md) separates the implemented contract
from the remaining decisions and release gates; proposed settings there are not setup requirements.

## Choose your next step

Keep your existing ARC setup and SAP authentication unchanged. New ARC installations start with
[Deployment](deployment.md) or [BTP Start Here](btp-overview.md); graph setup is optional afterward.

| Situation | Next step |
|---|---|
| You do not have a compatible graph backend | Start with the [offline Docker backend](repository-graph-backend.md#1-local-docker-first-useful-result), then choose BTP only if needed. Use the same reviewed revision for ARC/backend. |
| A local/Docker backend is ready | Confirm the audience below, then [connect locally](#local-connection-one-arc-setting). |
| A BTP backend is ready | Confirm the audience below, then [bind the connection](#btp-cloud-foundry-connection). Same-space deployment is not required by the API contract and does not make the route private. |
| CLI queries work and you want client access | Complete the [acceptance checks](#verify-before-client-exposure), then explicitly enable tools. |

Before connecting, obtain the backend's API version, HTTPS/loopback origin, system key (including
the intended SAP client), audience, and private API key. These values must agree with the backend;
ARC does not create or discover them for you. Start with `ARC1_GRAPH_TOOLS=false`.

## Audience and safety

Only enable this on a single-system instance whose administrator authorizes **all ARC readers**
to see the selected shared metadata. An SAP login or read scope alone does not prove this.
The required sharing declaration is that administrator's explicit decision, not an SAP
authorization check. Metadata can still reveal sensitive names and dependencies.

Existing `read` scope, deny-actions, MCP rate limit, HTTP authentication and audit apply. No new
end-user SAP role is introduced. Graph calls use only an independent graph credential, never
the caller's token or SAP credentials. Strict PP instances still require an authenticated JWT,
but graph calls do not mint SAP sessions. Live SAP tools retain normal per-user authorization.
Multi-target endpoints and restricted-user metadata audiences are unsupported.

## Local connection: one ARC setting

Store the backend-issued key in an owner-readable file (32–4096 printable non-space ASCII
characters). Create an absolute-path connection file, also owner-readable (`0600` on POSIX):

```json
{
  "version": 1,
  "url": "http://127.0.0.1:8091",
  "systemKey": "TRIAL-2023-001",
  "audience": "trial",
  "sharing": "shared-repository-metadata",
  "apiKeyFile": "/absolute/private/graph-api-key"
}
```

The example system/audience matches the offline PoC fixture. Replace both for a live index;
do not label your SAP installation with the example identity just to make a query succeed.

Set `ARC1_GRAPH_CONNECTION_FILE=/absolute/private/graph-connection.json` for internal setup and CLI
diagnostics. MCP clients still see no graph tool and cannot invoke it. Set `ARC1_GRAPH_TOOLS=true`
only when ready to expose it; this separate opt-in defaults to false in both MCP modes.
The descriptor's URL is an **origin**, without path/query/userinfo. HTTP is accepted for literal
loopback hosts. HTTPS is required elsewhere unless the descriptor explicitly sets
`"allowInsecureHttp": true` for an administrator-approved internal network. `SAP_INSECURE`
does not change this rule. There is no TLS-verification bypass or redirect following.

For Docker-to-Docker connections use the service DNS name, explicitly allow that internal HTTP
network if necessary, and mount both files read-only inside ARC at the descriptor's paths.
POSIX file ownership must match ARC's process user; Windows relies on host ACLs instead.

The system key is an operator-assigned index identity, including the intended SAP client. The
adapter validates it against the API on every response; it does not contact SAP to prove that
an operator configured the correct system. Do not reuse a key/audience across unrelated systems.

## BTP Cloud Foundry connection

This section attaches an **already running** compatible backend. It does not provision PostgreSQL,
install the collector, or change SAP destinations. For existing ARC deployments, follow
[BTP Administration](btp-administration.md) for binding/restart changes and preserve the current
customer configuration.

Alternatively set `ARC1_GRAPH_SERVICE_BINDING=arc1-repository-graph` and bind exactly one
**user-provided** service instance with that name. Its `credentials` have the same descriptor
fields, except `apiKey` replaces `apiKeyFile`. Have the backend maintainer supply that credential
JSON in an owner-only private file. For example, with its absolute path in `GRAPH_CREDENTIALS_FILE`
and your observed ARC app name in `ARC1_APP`:

```sh
cf target
cf services
# Only if this graph connection service does not already exist:
cf create-user-provided-service arc1-repository-graph -p "$GRAPH_CREDENTIALS_FILE"
cf bind-service "$ARC1_APP" arc1-repository-graph
```

Review the target org/space and service ownership before these changes. For an existing service,
verify it is the intended graph connection; do not overwrite its credentials or adopt an unrelated
service. Persist both the binding and `ARC1_GRAPH_SERVICE_BINDING=arc1-repository-graph` in the
deployment configuration that owns ARC, with `ARC1_GRAPH_TOOLS=false`, then follow that deployment's
binding refresh/restart procedure. For MTA, `.mtaext` properties can set the ARC flags, but the
existing-service resource and module binding must also be modeled correctly; a property alone
does not bind a service. See the [MTA attachment fragment](repository-graph-backend.md#5-connect-arc-without-exposing-tools-yet);
merge it into operator-owned configuration without replacing existing ARC requirements.

Do not use `.env` for CF deployment settings, paste keys in shell arguments, or rely only on a
temporary `cf set-env` that the next MTA deployment can undo. ARC does not search arbitrary service
bindings. A connection file takes precedence over a binding; `ARC1_GRAPH=off` overrides both.

Same-space deployment does **not** imply private connectivity. SAP BTP lists container-to-container
networking as [unsupported](https://help.sap.com/docs/BTP/65de2977205c403bbc107264b8eccf4b/f8a351c8d81544a2942c911dccaba3c7.html);
the live PoC confirmed a network-policy denial. Use an authenticated HTTPS service route on BTP,
understanding that it is internet-reachable. Other CF providers may support internal routes plus
network policies. The graph query app should have only a database reader identity. A separate collector
app/task gets writer and SAP Destination/Connectivity access: **tasks inherit the parent app's
bindings**, so a task of the query app does not isolate these privileges. One future installer
can configure independently built artifacts. See CF's
[user-provided services](https://docs.cloudfoundry.org/devguide/services/user-provided.html),
[container networking](https://docs.cloudfoundry.org/devguide/deploy-apps/cf-networking.html) and
[tasks](https://docs.cloudfoundry.org/devguide/using-tasks.html).

No service provisioning is performed by this adapter. Free/trial entitlement, region, quota,
network support and the backend's lifecycle must be verified separately before deployment.
PostgreSQL free is time-limited, not a permanent production service; record an export/upgrade owner
and deadline using the [lifecycle requirements](repository-graph-specification.md#85-cost-lifecycle-and-operations).

!!! note "Cloud Connector collection uses its own technical identity"

    The collector supports OnPremise/BasicAuthentication with an explicitly selected Connectivity
    binding. Follow [the collector setup](repository-graph-backend.md#cloud-connector-sap-source).
    ARC's existing bindings are not inherited by a separate app. PrincipalPropagation destinations
    remain rejected: a background task has no end-user JWT. Ordinary ARC PP is unchanged.

For disk, refresh headroom and collector resources, use the [storage sizing guide](repository-graph-sizing.md).

## Verify before client exposure

1. With tools still off, run `arc1-cli graph status` from a process with the private descriptor or
   named service binding. Expect `state=ready` and the intended system key. This proves graph
   readiness, **not** SAP identity, non-empty useful data, or whole-system coverage.
2. Search a known collected object and inspect a known non-empty relationship. Check the latest
   scope/time, unresolved nodes and truncation. Use actual indexed names, not the examples below.
3. Confirm MCP `tools/list` contains no `SAPGraph` and no hyperfocused graph action. Direct graph
   invocation must also fail while `ARC1_GRAPH_TOOLS=false`.
4. Confirm the operator approves shared metadata for all permitted readers. Test ordinary ARC
   safe reads and SAP identity separately; graph success proves neither of those paths.
5. Only then set `ARC1_GRAPH_TOOLS=true` in ARC's owned configuration and restart. Refresh/reconnect
   the MCP client, test one graph query, and retain the backend's experimental limitations.

If not ready, use the status table below. Do not enable tools or broaden SAP permissions to hide a
backend setup failure. CLI examples run where their connection file/binding is available; your
laptop does not automatically inherit a CF app's bindings.

## Use and diagnose

Want to judge whether this is worth enabling? The [live-versus-graph comparison prompts](repository-graph-comparison.md)
cover impact, package coupling, interface changes and live-source controls using verified trial objects.

```sh
arc1-cli graph status
arc1-cli call SAPGraph --json '{"action":"search","query":"order"}'
arc1-cli call SAPGraph --json '{"action":"impact","name":"ZCL_ORDER","type":"CLAS","depth":2}'
arc1-cli call SAPGraph --json '{"action":"path","name":"ZCL_ORDER","type":"CLAS","targetName":"ZIF_ORDER","targetType":"INTF","depth":2}'
```

When `ARC1_GRAPH_TOOLS=true`, MCP exposes the same flat `SAPGraph` arguments. Hyperfocused mode uses
`SAP(action="graph", params={"action":"impact","name":"ZCL_ORDER","type":"CLAS"})`.
Actions: `status`, `search`, `neighbors`, `impact`, `path`, `package_coupling`. Search uses `query`;
traversals require `name`/`type`; path additionally needs `targetName`/`targetType`.
Search is case-insensitive literal substring matching on metadata, not source text or SAP
wildcard syntax: search for `order`, not `*order*`.

Defaults: depth 1 (max 3), direction `both` (`impact` always incoming), limit 20 (max 100),
maxNodes 100, maxEdges 300. Optional `kinds` selects up to ten relation types; impact excludes
package membership (`belongs_to`) and requires at least one dependency kind. The API contract is
in `src/repository-graph/contract.ts`: `POST /v2/query` receives these arguments plus ARC-injected
systemKey/audience. No caller URL, SQL, Cypher, collection or administrative mutation is accepted.

- `coverage` describes the latest **collection scope**, parser version, generation, time and
  parse counts—not proof that the whole SAP system is covered. Graph edges may include last-good
  evidence from older successful parses. Per-edge source version/age is not available yet.
- `startStatus`/`targetStatus` distinguish `found`, `not_indexed` and `ambiguous`; unknown names
  must not be interpreted as zero dependencies. Bare types may match one exact ADT subtype;
  ambiguous DDIC types must not be guessed or merged.
- `hasMore`/`truncationReasons` describe response limits separately from index completeness.
  Nodes are deduplicated, edges reference their IDs, and the returned subgraph is closed.
- A missing path means no path in this indexed traversal scope. Impact is **potential impact**;
  macros, dynamic dispatch, uncollected objects and unsupported syntax limit accuracy.

## Availability, limits and disable

Unconfigured: no graph probe, timer, network request or listed tool. Connected but internal-only:
no MCP graph runtime/probe, tool/list notification, or accepted client call; CLI calls remain available.
A configured and MCP-enabled backend is
probed asynchronously with a two-second deadline. Initially unavailable indexes or those without
a completed generation stay hidden; failed probes back off from two seconds to sixty seconds.
The no-generation state retries after one second. A generation does not guarantee non-empty data
or complete coverage. Healthy rechecks run every thirty
seconds. First availability emits `tools/list_changed` on persistent stdio sessions. A short outage preserves the tool name,
but queries fail explicitly; invalid credentials/protocol responses hide it. No query-result
cache or SAP fallback is used. Reconnect clients that ignore tool-list notifications; stateless
HTTP clients see current availability on their next `tools/list` request.

Query deadline: five seconds including body consumption; response cap: 512,000 bytes after
decompression; at most eight in-flight requests per ARC graph runtime, with immediate busy
errors instead of an unbounded queue. Operator key-file rotation is read on the next request;
file/binding endpoint or descriptor changes require restarting ARC. Malformed settings disable
only the graph and appear as `invalid_connection` in status. Status exits nonzero when not ready.

Set `ARC1_GRAPH=off` and restart to disable with no backend removal. `SAP_DENY_ACTIONS=SAPGraph`
blocks the tool, `SAPGraph.impact` blocks one action, and `SAP.graph` blocks its hyperfocused
alias. Denial does not stop operator-configured background health probes; explicit off does.

| Status/problem | Check next |
|---|---|
| `not_configured` | Explicit off, missing connection setting, or CLI process without the intended binding |
| `invalid_connection` | Absolute paths/owner permissions, exact named user-provided binding, descriptor identity/URL, unsupported multi-target configuration |
| `unauthorized` | Backend key and matching system/audience; do not change the caller's SAP role |
| `incompatible` | Backend API/response contract and identity; use matched artifact versions |
| `not_indexed` | Backend collection has not published a generation; collection runs outside ARC |
| `unavailable` / `busy` | Backend health, reachability, query bounds and load; no automatic SAP fallback |
| CLI ready, tool absent | Default internal-only setting, reader scope/deny policy, or a client needing a refreshed tool list |

Disabling ARC does not stop the separate API, collector schedule, or database lifecycle. Backend
stop/export/removal belongs to its runbook. Keep data volumes on normal Docker shutdown; do not
delete databases or regenerate credentials as a routine retry step.
