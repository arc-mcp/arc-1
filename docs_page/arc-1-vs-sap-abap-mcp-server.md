# ARC-1 and SAP's ADT MCP server

Choose based on where the assistant runs and who operates the SAP connection.
SAP's ADT MCP server runs locally with the IDE. ARC-1 can run locally or provide a shared endpoint.

## Choose a starting point

| Your task | Start with |
| --- | --- |
| Use an assistant with your existing ADT workspace | [SAP's ADT MCP setup](https://help.sap.com/docs/abap-cloud/abap-development-tools-for-visual-studio-code/configuring-adt-mcp-server-ed94320814734d97801f51a5b6deb802) |
| Provide a shared endpoint with central permissions and audit | [ARC-1 deployment](deployment.md) |
| Connect a local assistant directly to SAP over HTTPS | [ARC-1 quickstart](quickstart.md) |
| Evaluate an operation such as SQL, transport review, or method editing | Check the [ARC-1 tool reference](tools.md) and SAP's current tool documentation against your backend. |

These are project recommendations. Test the operations you need on the actual SAP release;
neither a tool count nor a product name establishes backend support.

## Compare the operating models

| Question | ARC-1 | SAP ADT MCP server |
| --- | --- | --- |
| Where does it run? | Local npm/stdio, Docker, or BTP Cloud Foundry | Local HTTP server within ADT tooling |
| Who operates it? | You or your platform team | The developer running the IDE |
| How does a client authenticate? | Local process trust, or HTTP API key/OIDC/XSUAA | A generated bearer token for the local endpoint |
| How are operations restricted? | Server capability flags, user scopes, package rules, and SAP authorization | Check your ADT tool settings and SAP authorizations |
| Where are inputs documented? | [Per-tool reference](tools.md) | [SAP's MCP tools documentation](https://help.sap.com/docs/ABAP_AI/c7f5ef43ab274d078baf22f995fd2161/243d050c1be846e788f38f8c23c45d3a.html) |
| What must you budget for? | MIT-licensed software; infrastructure, SAP access, operations, and your AI client | Check SAP's current product, Joule, and AI-client licensing for the selected features |

SAP documents its local HTTP endpoint and generated bearer token in
[Configuring ADT MCP Server](https://help.sap.com/docs/abap-cloud/abap-development-tools-for-visual-studio-code/configuring-adt-mcp-server-ed94320814734d97801f51a5b6deb802).
ARC-1's implementation and deployment options are described in [Architecture](architecture.md).

## Check capability on your system

1. List the tools exposed by each connected server.
2. Try a read of the same object in each.
3. Test the specific creation, check, or navigation operation you need in a development system.
4. Confirm which SAP identity was used and where its audit evidence is available.

ARC-1 supports classic and modern ABAP workflows, but an individual operation still depends on
SAP discovery, permissions, and release support. It does not provide an interactive SAP GUI or
an IDE debugger. SQL and mutations require explicit opt-ins.

SAP's [RAP130 sample](https://github.com/SAP-samples/abap-platform-rap130/blob/main/exercises/ex01/README.md)
demonstrates ADT MCP tools for object creation, activation, RAP generation, tests, and transports.
That sample still labels the MCP feature experimental and unsuitable for productive use when
checked on **2026-09-15**. Consult the documentation for your installed version before rollout.

## Use both

If your client supports multiple MCP connections, you can configure both servers.
Give them distinct names and state which connection and SAP system the assistant should use.
Check that both connections target the intended system before allowing a write.

A combined setup does not merge their permissions or provide shared transactions. Assign a task
to one connection at a time so its result and audit trail remain clear.

## Policy and support

ARC-1 is community-maintained open-source software. Running it on BTP does not make it a
SAP-supported product. Review [SAP API policy considerations](sap-api-policy-and-architecture.md)
for third-party access and use your SAP contract and product documentation for licensing decisions.

## Sources and review scope

The primary SAP setup and sample pages linked above were checked on **2026-09-15**.
This comparison intentionally avoids volatile install counts, ratings, and fixed tool totals.
The [earlier comparison](https://github.com/arc-mcp/arc-1/blob/f23765f0/docs_page/arc-1-vs-sap-abap-mcp-server.md)
contains the author's June 2026 Eclipse snapshot; those observations are historical, not a current
product-wide capability matrix.
