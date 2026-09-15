# SAP BTP: choose a setup

<a id="sap-btp-start-here"></a>

Deploy ARC-1 on SAP Business Technology Platform (BTP) Cloud Foundry so your team can use AI tools with SAP. First choose your SAP landscape, then follow one setup guide.

For most on-premise teams, use **read-only access with XSUAA (SAP's OAuth service) and Principal Propagation**. Each person connects to SAP as their own SAP user.

## Choose your setup

<a id="choose-the-topology"></a>

| Your SAP landscape | Start here |
|---|---|
| One on-premise system/client | [Cloud Foundry deployment](btp-cloud-foundry-deployment.md), single-PP profile |
| Several on-premise systems or clients | [Cloud Foundry deployment](btp-cloud-foundry-deployment.md), multi-PP profile |
| BTP ABAP Environment | [BTP ABAP Environment setup](btp-abap-environment.md) |
| S/4HANA Public Cloud developer extensibility | [S/4HANA Public Cloud setup](s4hana-public-cloud.md) |
| Several systems that need write access | One ARC-1 instance per target; see the external [mcp-hub project](https://github.com/arc-mcp/mcp-hub) |

Single-target access uses `/mcp`. Experimental multi-target access uses pinned `/<SYSTEM>/<CLIENT>/mcp` routes and `/multi/mcp`. Multi-target routes are **mutation-free**: no object writes, activation, transport/Git mutation, or plugins. Principal Propagation is recommended; shared Basic is a separately enabled exception.

For a single-target `/mcp` alongside multi-target routes, review the [independent configuration and access risks](multi-target-administration.md#optional-single-target-mcp).

## Deploy and verify

<a id="follow-the-setup-in-this-order"></a>
<a id="1-deploy-the-btp-application-boundary"></a>
<a id="2-configure-who-may-call-arc-1"></a>
<a id="3-configure-how-each-call-reaches-sap"></a>
<a id="4-add-multi-system-routing-only-when-required"></a>
<a id="5-hand-over-operations"></a>
<a id="minimum-customer-acceptance"></a>

Follow the [Cloud Foundry deployment runbook](btp-cloud-foundry-deployment.md) through verification and handover. It tells you when to involve the Destination, Cloud Connector, SAP Basis, and identity administrators. The [optional worksheet](btp-setup-worksheet.md) records their inputs and test results.

Use documentation and examples from **the source revision that built your deployed artifact**. The website and repository `main` may be newer. Ask the person who deployed the service for the revision if it is unknown.

## Where settings belong

<a id="keep-each-value-in-one-place"></a>

| Setting | Location |
|---|---|
| Product defaults, service bindings, role templates | Repository `mta.yaml` |
| Durable app settings, safety limits, route, instance count | Customer `.mtaext` |
| SAP URL/client, authentication, Connector location | BTP subaccount destination |
| Human ARC-1 scopes | XSUAA role collections |
| SAP network access, trust, user mapping, SAP roles | Cloud Connector and SAP |
| ARC-1 endpoint and OAuth registration | MCP client |

Keep destination credentials out of the customer `.mtaext` and MCP client configuration. See [configuration precedence](configuration-precedence.md) for overrides and deployment behavior.

## Find the right page quickly

| Task | Guide |
|---|---|
| Build and deploy ARC-1 | [Cloud Foundry deployment](btp-cloud-foundry-deployment.md) |
| Set destination fields and authentication | [Destination reference](btp-destination-setup.md) |
| Configure Connector and SAP user mapping | [Principal Propagation](principal-propagation-setup.md) |
| Assign ARC-1 permissions | [Authorization and roles](authorization.md) |
| Fix XSUAA login or role assignment | [XSUAA](xsuaa-setup.md) |
| Add a system or client | [Multi-target setup](multi-target-setup.md) |
| Diagnose an excluded or quarantined target | [Multi-target administration](multi-target-administration.md) |
| Change settings, upgrade, or roll back | [BTP administration](btp-administration.md) |
| Inspect logs | [Log analysis](log-analysis.md) |
