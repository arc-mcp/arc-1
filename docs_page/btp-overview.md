# SAP BTP: Start Here

Use this page to choose the correct ARC-1 topology and documentation path before creating services,
destinations, or role collections. It is a map, not a second deployment runbook. The canonical
commands remain in [BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md).

!!! tip "Recommended starting path"

    For most teams connecting ARC-1 to one or more on-premise SAP systems, start with a
    **read-only BTP Cloud Foundry deployment using XSUAA and Principal Propagation**:

    1. Follow the [BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md) runbook.
    2. Use [Principal Propagation](principal-propagation-setup.md) so SAP receives the real user.
    3. Choose the normal `/mcp` setup for one system/client, or add
       [Multi-Target Setup](multi-target-setup.md) for mutation-free access to several targets.

    Start with the topology table below only when that recommendation does not fit your landscape.

## Choose the topology

| Your SAP landscape | ARC-1 shape | SAP identity | Continue with |
|--------------------|-------------|--------------|---------------|
| One on-premise SAP system/client | One `/mcp` endpoint | Principal Propagation recommended | [Cloud Foundry Deployment](btp-cloud-foundry-deployment.md), then [Destination Reference](btp-destination-setup.md) and [Principal Propagation](principal-propagation-setup.md) |
| Several on-premise systems or clients, mutation-free access | Pinned `/<SYSTEM>/<CLIENT>/mcp` routes plus `/multi/mcp` | Principal Propagation recommended; shared Basic is an explicit exception | [Cloud Foundry Deployment](btp-cloud-foundry-deployment.md), then [Multi-Target Setup](multi-target-setup.md) |
| One general `/mcp` endpoint beside mutation-free multi-target routes | Independent single-target and multi-target configurations in one app | Configure each path independently | Read the [side-by-side risks](multi-target-administration.md#optional-single-target-mcp) before deployment |
| BTP ABAP Environment | One `/mcp` endpoint | `OAuth2UserTokenExchange` | [BTP ABAP Environment](btp-abap-environment.md) |
| S/4HANA Public Cloud developer extensibility | One `/mcp` endpoint | Per-user SAML/OAuth exchange | [S/4HANA Public Cloud](s4hana-public-cloud.md) |
| Writable access to several SAP systems with stronger isolation | One ARC-1 instance per target behind a router | Identity and safety policy per instance | External [`arc-mcp/mcp-hub`](https://github.com/arc-mcp/mcp-hub) project |

!!! warning "Multi-target v1 is mutation-free"

    The discovered multi-target routes do not expose object writes, activation, transport mutation,
    Git mutation, plugins, or controlled execution. A writable single-target `/mcp` may coexist,
    but it remains an independent configuration. Do not widen multi-target access by copying
    single-target write settings into destinations.

## Follow the setup in this order

### 1. Deploy the BTP application boundary

Follow [BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md) to build the MTAR, create the
XSUAA, Destination, and Connectivity services, bind them to ARC-1, apply a customer-owned MTA
extension, and complete the initial health check.

The first accepted deployment should be read-only. Prove identity, target routing, authorization,
audit, and rollback before widening any single-target safety ceiling.

### 2. Configure who may call ARC-1

[XSUAA](xsuaa-setup.md) authenticates MCP users. [Authorization & Roles](authorization.md) explains
the ARC-1 scopes and the instance safety ceiling. Assign the least-privilege role collection before
the user's first login; after changing a role, obtain a new token and reconnect clients that cache
their tool catalog.

This is Layer A authorization. It does not choose a SAP user and cannot override SAP authorization.

### 3. Configure how each call reaches SAP

The [BTP Destination Reference](btp-destination-setup.md) defines supported destination fields and
authentication modes. For on-premise per-user identity, complete the
[Principal Propagation](principal-propagation-setup.md) sequence across Destination Service, Cloud
Connector, STRUST/CERTRULE, SU01, and SAP roles.

This is Layer B identity. In strict Principal Propagation mode, a mapping failure is an error; ARC-1
never falls back to a technical user.

### 4. Add multi-system routing only when required

For the experimental shared read gateway, follow [Multi-Target Setup](multi-target-setup.md). It
defines the destination marker, route IDs, data/SQL opt-ins, MCP client examples, and safe smoke
tests. Then use [Multi-Target Administration](multi-target-administration.md) for exclusions,
registry revisions, scaling, shared-Basic controls, and incidents.

A new or non-secret changed multi-target destination becomes active only after every ARC-1 process
has restarted. Destination username/password rotation for the shared-Basic exception is the narrow
request-time exception documented in the administration guide.

### 5. Hand over operations

[BTP Administration](btp-administration.md) owns the post-deployment lifecycle: configuration
ownership, role-collection repair, DCR signing-secret handling, change/restart decisions, scaling,
upgrades, rollback, monitoring, and customer acceptance.

## Keep each value in one place

| Control plane | Store here | Do not store here |
|---------------|------------|-------------------|
| Repository `mta.yaml` | Product defaults, service topology, bindings, role templates and collections | Customer destinations or secrets |
| Customer `.mtaext` | Durable route, instance count, selected single target, and application safety ceilings | Destination credentials |
| BTP subaccount destination | SAP URL/client, authentication mode, Cloud Connector location, and supported target-local multi-target policy | Global ARC-1 authorization or write policy |
| XSUAA role collections | Human ARC-1 scopes | SAP users, passwords, or per-target assumptions in v1 |
| Cloud Connector and SAP | Network resources, trust, certificate mapping, SAP roles | MCP OAuth roles |
| MCP client | ARC-1 endpoint URL and OAuth registration state | Destination or SAP credentials |

The BTP Destination administrator and XSUAA role administrator control different boundaries. Keep
that separation: a destination says how ARC-1 reaches one SAP target; a role collection says what
the authenticated human may ask ARC-1 to do.

## Minimum customer acceptance

Before handing the endpoint to users:

- [ ] The deployed version and customer `.mtaext` are recorded and reproducible.
- [ ] Every expected XSUAA role collection exists, contains roles from the current XSUAA instance,
      and has been tested with a fresh token.
- [ ] A Viewer can complete a safe read and cannot call data, SQL, or mutation actions.
- [ ] Principal Propagation identifies the real SAP user; shared Basic identifies only the approved
      technical user and remains an explicitly accepted exception.
- [ ] Multi-target Admin diagnostics explain every accepted and excluded destination without
      exposing credentials or internal URLs.
- [ ] Rate limits, SAP concurrency, instance count, audit access, upgrade, and rollback ownership are
      documented.
- [ ] Unsupported capabilities are explicit to users and MCP client owners.

For the full commands and evidence checklist, continue with
[service verification](btp-cloud-foundry-deployment.md#10-verify-the-service-in-layers) and
[handover](btp-cloud-foundry-deployment.md#11-handover-and-ongoing-operation).

## Find the right page quickly

| Question | Page |
|----------|------|
| How do I build and deploy the MTAR? | [BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md) |
| Which destination fields and authentication modes are valid? | [BTP Destination Reference](btp-destination-setup.md) |
| How do I configure Cloud Connector and SAP certificate mapping? | [Principal Propagation](principal-propagation-setup.md) |
| How do roles, scopes, and the instance ceiling interact? | [Authorization & Roles](authorization.md) |
| Why does XSUAA login, DCR, or a role assignment fail? | [XSUAA](xsuaa-setup.md) |
| How do I add several system/client targets? | [Multi-Target Setup](multi-target-setup.md) |
| Why was a destination excluded or quarantined? | [Multi-Target Administration](multi-target-administration.md) |
| Does this change need restart, restage, or redeploy? | [BTP Administration](btp-administration.md#change-and-restart-matrix) |
| How do I update or roll back ARC-1? | [Updating](updating.md) and [BTP Administration](btp-administration.md) |
| What should I inspect in logs? | [Log Analysis](log-analysis.md) |
