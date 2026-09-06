# Optional repository graph (experimental)

`SAPGraph` queries a separately deployed metadata/relationship index. ARC does not collect
objects, store source, connect to PostgreSQL/HANA, or use AI Core for this feature. Existing
SAPRead, SAPContext and request-driven caches are unchanged. This is **not live SAP where-used**.

The adapter requires a compatible **v2 graph API**. The independent local PostgreSQL collector
is a proof of concept, not part of the ARC npm/Docker distribution or a hosted service. This page
configures the ARC adapter; it does not install that backend. HANA parity and automated BTP
deployment are not shipped. See the [implementation plan](https://github.com/arc-mcp/arc-1/blob/main/docs/plans/optional-repository-graph.md)
and [validation record](https://github.com/arc-mcp/arc-1/blob/main/docs/research/repository-graph-validation.md).

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
  "systemKey": "TRIAL-001",
  "audience": "trial",
  "sharing": "shared-repository-metadata",
  "apiKeyFile": "/absolute/private/graph-api-key"
}
```

Set `ARC1_GRAPH_CONNECTION_FILE=/absolute/private/graph-connection.json`, then start ARC normally.
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

Alternatively set `ARC1_GRAPH_SERVICE_BINDING=arc1-repository-graph` and bind exactly one
**user-provided** service instance with that name. Its `credentials` have the same descriptor
fields, except `apiKey` replaces `apiKeyFile`. Pass credentials to CF using a private JSON file,
not shell history. ARC does not search arbitrary service bindings. A connection file takes
precedence over a binding; `ARC1_GRAPH=off` overrides both.

Same-space deployment is possible, but an internal route still needs an explicit CF network
policy. The graph query app should have only a database reader identity. A separate collector
app/task gets writer and SAP Destination/Connectivity access: **tasks inherit the parent app's
bindings**, so a task of the query app does not isolate these privileges. One future installer
can configure independently built artifacts. See CF's
[user-provided services](https://docs.cloudfoundry.org/devguide/services/user-provided.html),
[container networking](https://docs.cloudfoundry.org/devguide/deploy-apps/cf-networking.html) and
[tasks](https://docs.cloudfoundry.org/devguide/using-tasks.html).

No service provisioning is performed by this adapter. Free/trial entitlement, region, quota,
network support and the backend's lifecycle must be verified separately before deployment.

## Use and diagnose

```sh
arc1-cli graph status
arc1-cli call SAPGraph --json '{"action":"search","query":"order"}'
arc1-cli call SAPGraph --json '{"action":"impact","name":"ZCL_ORDER","type":"CLAS","depth":2}'
arc1-cli call SAPGraph --json '{"action":"path","name":"ZCL_ORDER","type":"CLAS","targetName":"ZIF_ORDER","targetType":"INTF","depth":2}'
```

MCP exposes the same flat `SAPGraph` arguments. Hyperfocused mode uses
`SAP(action="graph", params={"action":"impact","name":"ZCL_ORDER","type":"CLAS"})`.
Actions: `status`, `search`, `neighbors`, `impact`, `path`, `package_coupling`. Search uses `query`;
traversals require `name`/`type`; path additionally needs `targetName`/`targetType`.

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

Unconfigured: no graph probe, timer, network request or listed tool. A configured backend is
probed asynchronously with a two-second deadline. Initially unavailable/empty indexes stay
hidden; retries back off from two seconds to sixty seconds. Healthy rechecks run every thirty
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
