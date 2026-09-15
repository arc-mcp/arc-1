# ARC-1 and SAP's ADT MCP server

Both connect AI assistants to ABAP development workflows. **SAP's ADT MCP server is part of the
developer's IDE. ARC-1 provides SAP operations directly to MCP clients and can also serve a team.**
Start with the connection model, then check the operations your task needs.

SAP sources checked **2026-09-15**; ARC-1 behavior describes this repository revision.

## Choose a starting point

| You need to… | Start with |
| --- | --- |
| Work in an existing Eclipse or VS Code ABAP workspace | [SAP's ADT MCP setup](https://help.sap.com/docs/abap-cloud/abap-development-tools-for-visual-studio-code/configuring-adt-mcp-server-ed94320814734d97801f51a5b6deb802) |
| Use an existing RFC/SNC connection to on-premise SAP | SAP's IDE connection; ARC-1 needs HTTPS or a separately configured bridge |
| Read or edit ABAP from a client without an ABAP editor | [ARC-1 quickstart](quickstart.md) |
| Give a team one endpoint with central permissions and audit | [ARC-1 deployment](deployment.md) |
| Use SAP's AI-assisted ATC fixes or migration agents | [SAP's feature and license requirements](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/prerequisites-and-required-authorizations) |

These are project recommendations. Confirm backend support and client compatibility with a small
development-system trial before choosing a deployment.

## Connection and operation

| Question | ARC-1 | SAP ADT MCP server |
| --- | --- | --- |
| Where does it run? | Local npm/stdio, Docker, or BTP Cloud Foundry | Locally within ADT for Eclipse or VS Code |
| How does the assistant connect? | Stdio, or HTTP with API key/OIDC/XSUAA authentication | Local HTTP `/mcp` endpoint with a generated bearer token |
| How does it reach SAP? | ADT HTTPS; BTP destinations can use Cloud Connector | The IDE's configured ABAP connections; VS Code uses RFC for on-premise/private cloud and HTTP for BTP/public cloud |
| Which SAP identity is used? | Local/shared credentials or per-user principal propagation, depending on configuration | The identity in the selected IDE connection |
| Can it serve several systems? | One target per instance by default; experimental BTP [multi-target mode](multi-target-setup.md) is mutation-free | Destination selection among the IDE's configured systems |
| Who operates it? | The developer or platform team | The developer running the IDE |

SAP documents the local endpoint in [ADT MCP configuration](https://help.sap.com/docs/abap-cloud/abap-development-tools-for-visual-studio-code/configuring-adt-mcp-server-ed94320814734d97801f51a5b6deb802)
and connection options in its [VS Code extension](https://marketplace.visualstudio.com/items?itemName=SAPSE.adt-vscode).
For ARC-1's identity choices and the local RFC bridge, see [Authentication](enterprise-auth.md).

## Source editing

In SAP's documented [agentic loop](https://help.sap.com/docs/abap-cloud/abap-development-tools-for-visual-studio-code/scenario-agentic-loop),
MCP tools create and activate the object, while the MCP host's editor tool inserts its implementation
into the open ABAP source file. Connecting a standalone chat client to that MCP endpoint does not
automatically give it those editor capabilities.

ARC-1 exposes source reads, searches, dependency context, and source changes through its own tools.
For example, an assistant can read one class method with [SAPRead](tools/sap-read.md), update it with
[SAPWrite](tools/sap-write.md), and activate it with [SAPActivate](tools/sap-activate.md).
An ABAP editor is not required for those calls. The [class-editing guide](tools/write-class-members.md)
explains method and include selection.

An IDE feature is not necessarily an MCP tool: debugger support in an IDE does not establish that a
remote assistant can control its debugger. ARC-1 does not provide an interactive ABAP debugger.

## Compare the operations you need

SAP's [MCP tool catalog](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/model-context-protocol-tools)
documents destination selection, object creation and activation, transport creation/listing/diffs,
unit tests, repository generators, business-service metadata, and ATC checks and fixes.
Availability depends on the IDE version and backend; use the connected server's tool list for exact
names and inputs.

For ARC-1, these references provide concrete inputs and limitations:

| Task | ARC-1 reference |
| --- | --- |
| Search objects, read source, or follow dependencies | [SAPSearch](tools/sap-search.md), [SAPRead](tools/sap-read.md), [SAPContext](tools/sap-context.md), [SAPNavigate](tools/sap-navigate.md) |
| Create/change ABAP and DDIC objects, or generate RAP objects | [SAPWrite](tools/sap-write.md); check the supported type/action table |
| Run syntax checks, ATC, or unit tests | [SAPDiagnose](tools/sap-diagnose.md), [SAPLint](tools/sap-lint.md) |
| Review/release transports or use Git integration | [SAPTransport](tools/sap-transport.md), [SAPGit](tools/sap-git.md) |
| Preview table data or execute ABAP SQL | [SAPQuery](tools/sap-query.md); each capability needs its own opt-in |
| Read UI5 repository content or manage packages and FLP content | [SAPRead](tools/sap-read.md), [SAPManage](tools/sap-manage.md) |

SAP also provides tasks through its editor, language server, and other IDE features. Compare the
complete workflow in your intended client, including how it obtains source and confirms a save.

ARC-1's standard mode has 12 intent tools with multiple actions. A raw tool count does not measure
coverage. Classic and cloud ABAP also differ: use discovery and the documented per-type restrictions,
not a blanket claim that every object can be created on every release.

## Permissions and team operation

ARC-1 starts read-only. Administrators can limit capabilities, write packages, actions, user scopes,
request rates, and data-result sizes. Shared deployments can record centrally redacted audit events
and propagate each user's identity. These controls require configuration; hosting on BTP alone does
not enable per-user access. See [Authorization](authorization.md) and [BTP setup](btp-overview.md).

SAP's MCP setup lets the developer select exposed tools, and SAP backend authorizations still apply.
Its documented local endpoint should not be treated as a ready-made shared service. A central
deployment needs its own supported design for authentication, identities, and operation.

## Licensing and support

- **ARC-1 software:** MIT-licensed and community-maintained. Budget separately for SAP access, the
  AI client/model, infrastructure, and operation. ARC-1 is not an SAP-supported product.
- **SAP ADT MCP tools:** SAP's tool catalog marks the listed non-AI development tools as not requiring
  a Joule license; the AI ATC fix tools require one. Do not assume every MCP call requires Joule.
- **SAP Joule features:** SAP distinguishes on-stack licensing from side-by-side use with AI Units.
  Check [SAP's administrator prerequisites](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/prerequisites-and-required-authorizations)
  and your contract for the chosen features. Your external coding assistant may require a separate subscription.

SAP announced ADT MCP availability in its [2026 product update](https://community.sap.com/t5/technology-blog-posts-by-sap/abap-ai-chapter-3-we-go-agentic/ba-p/14391469).
Older workshop warnings and June tool snapshots do not establish the support status of a current IDE
release. Follow the documentation for the version you install.

For either approach, confirm endpoint use and data access under the applicable SAP terms. See
[SAP API policy considerations](sap-api-policy-and-architecture.md).

## Try one workflow, or use both

1. Connect each candidate to the same development system and confirm its selected SAP identity.
2. Read a known object using that client's available source-access path.
3. Test your required create/edit/check workflow in a permitted test package, including activation.
4. Check the result, required licenses, and where operational logs are available.

A client that supports multiple MCP connections can use both servers. Give them distinct names and
state which system and connection to use for each task. They do not share transactions or merge
permissions; avoid simultaneous edits to the same object through different connections.

The [June 2026 comparison](https://github.com/arc-mcp/arc-1/blob/f23765f0/docs_page/arc-1-vs-sap-abap-mcp-server.md)
retains the author's historical Eclipse observations. Use it as background, not a current capability inventory.
