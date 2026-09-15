# SAP BTP: Start Here

Use this page to choose the correct ARC-1 topology and documentation path before creating services,
destinations, or role collections. It is a map, not a second deployment runbook. The canonical
commands remain in [BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md).

**Documentation version:** the website and repository `main` can be newer than your deployment.
For an existing installation, use the guides and examples from the source revision used to build
its artifact; ask the deployment owner if that revision is unknown. Proposed settings in
`docs/plans/` or `docs/research/` are not setup requirements.

!!! tip "Recommended starting path"

    For most teams connecting ARC-1 to one or more on-premise SAP systems, start with a
    **read-only BTP Cloud Foundry deployment using XSUAA and Principal Propagation**:

    Follow [BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md). Step 4 selects a
    single-PP or multi-PP example from the same checkout; keep following that runbook through acceptance.

    Start with the topology table below only when that recommendation does not fit your landscape.

## Choose the topology

| Your SAP landscape | ARC-1 shape | SAP identity | Continue with |
|--------------------|-------------|--------------|---------------|
| One on-premise SAP system/client | One `/mcp` endpoint | Principal Propagation recommended | [Cloud Foundry Deployment](btp-cloud-foundry-deployment.md) — single-PP profile |
| Several on-premise systems or clients, mutation-free access | Pinned `/<SYSTEM>/<CLIENT>/mcp` routes plus `/multi/mcp` | Principal Propagation recommended; shared Basic is an explicit exception | [Cloud Foundry Deployment](btp-cloud-foundry-deployment.md) — multi-PP profile |
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

<a id="1-deploy-the-btp-application-boundary"></a>
<a id="2-configure-who-may-call-arc-1"></a>
<a id="3-configure-how-each-call-reaches-sap"></a>
<a id="4-add-multi-system-routing-only-when-required"></a>
<a id="5-hand-over-operations"></a>

Follow the [deployment runbook](btp-cloud-foundry-deployment.md) from prerequisites through
acceptance. It brings in the Destination, Connector, Basis and IAM owners at the required steps;
single-PP startup destinations must exist before the configured app starts. Do not treat the
specialist pages as additional deployments to perform afterward.

For an existing deployment, use the [task map below](#find-the-right-page-quickly) to add a target,
change access, diagnose a failure or plan an upgrade. Destination changes and role changes have
different activation rules; the linked administration guides own those details.

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

For a shared customer handoff, the [optional worksheet](btp-setup-worksheet.md) records inputs and
results. It does not add setup steps.

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
